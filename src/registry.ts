// mcpdoctor — npm registry metadata + minimal semver range matching (no deps).

import { getJson, HttpError, pool } from "./net.js";
import type { PackageRef, RegistryMeta, VersionMeta } from "./types.js";

const REGISTRY_URL = "https://registry.npmjs.org";
const DOWNLOADS_URL = "https://api.npmjs.org/downloads/point/last-month";

interface RegistryDoc {
  name?: string;
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
  deprecated?: string;
  versions?: Record<string, unknown>;
}

interface DownloadsDoc {
  downloads?: number;
}

export interface RegistryMetaFn {
  (pkg: PackageRef): Promise<RegistryMeta | null>;
}

// ---------------------------------------------------------------------------
// Semver primitives (pure)
// ---------------------------------------------------------------------------

type Numbers = [number, number, number];
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(v: string): Numbers | null {
  const m = VERSION_RE.exec(v.trim());
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: Numbers | null, b: Numbers | null): number {
  if (a === null || b === null) return 0;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function isPlainVersion(s: string): boolean {
  return VERSION_RE.test(s.trim()) && !s.trim().startsWith("v ") && !s.includes("*");
}

/** Parse a possibly-partial version ("1", "1.2", "1.2.3", "1.x") into components. */
function parsePartial(v: string): { nums: Numbers; has: [boolean, boolean, boolean] } | null {
  const t = v.trim();
  if (t === "" || t === "x" || t === "X" || t === "*") return null;
  const segs = t.split(".");
  if (segs.length > 3) return null;
  const nums: Numbers = [0, 0, 0];
  const has: [boolean, boolean, boolean] = [false, false, false];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (/^[xX*]$/.test(s)) {
      has[i] = false;
      continue;
    }
    if (!/^\d+$/.test(s)) return null;
    nums[i] = Number(s);
    has[i] = true;
  }
  return { nums, has };
}

type Op = ">=" | ">" | "<" | "<=" | "=";
interface Comparator {
  op: Op;
  ver: Numbers;
}

const join = (n: Numbers): string => `${n[0]}.${n[1]}.${n[2]}`;

/** Expand a single range token into comparators. */
function expandToken(token: string): Comparator[] {
  const t = token.trim();
  if (t === "" || t === "*") return [];
  let op: Op | null = null;
  let rest = t;
  if (t.startsWith(">=")) {
    op = ">=";
    rest = t.slice(2);
  } else if (t.startsWith("<=")) {
    op = "<=";
    rest = t.slice(2);
  } else if (t.startsWith(">")) {
    op = ">";
    rest = t.slice(1);
  } else if (t.startsWith("<")) {
    op = "<";
    rest = t.slice(1);
  } else if (t.startsWith("=")) {
    op = "=";
    rest = t.slice(1);
  }

  if (op !== null) {
    const p = parseVersion(rest);
    if (!p) return [];
    return [{ op, ver: p }];
  }

  // caret / tilde
  if (t.startsWith("^")) {
    const p = parsePartial(t.slice(1));
    if (!p) return [];
    return caretComparators(p);
  }
  if (t.startsWith("~")) {
    const p = parsePartial(t.slice(1));
    if (!p) return [];
    return tildeComparators(p);
  }

  // x-style short range: 1, 1.2, 1.x, 1.2.x
  const p = parsePartial(t);
  if (!p) return [];
  if (p.has[0] && p.has[1] && p.has[2]) {
    return [{ op: "=", ver: p.nums }];
  }
  return shortComparators(p);
}

/** ^x.y.z → [>=x.y.z, <upper]. upper per caret rules incl ^0. */
function caretComparators(p: { nums: Numbers; has: [boolean, boolean, boolean] }): Comparator[] {
  const [major, minor, patch] = p.nums;
  const lower: Numbers = p.nums;
  let upper: Numbers;
  if (major !== 0) {
    upper = [major + 1, 0, 0];
  } else {
    // major === 0: ^0.x stays within minor, ^0.0.x within patch
    if (minor !== 0) upper = [0, minor + 1, 0];
    else if (patch !== 0) upper = [0, 0, patch + 1];
    else if (p.has[1]) upper = [0, 1, 0];
    else upper = [1, 0, 0];
  }
  return [
    { op: ">=", ver: lower },
    { op: "<", ver: upper },
  ];
}

/** ~x.y.z → [>=x.y.z, <x.(y+1).0]. ~1 → [>=1.0.0, <2.0.0]. */
function tildeComparators(p: { nums: Numbers; has: [boolean, boolean, boolean] }): Comparator[] {
  const [major, minor] = p.nums;
  const lower: Numbers = p.nums;
  let upper: Numbers;
  if (p.has[1]) upper = [major, minor + 1, 0];
  else upper = [major + 1, 0, 0];
  return [
    { op: ">=", ver: lower },
    { op: "<", ver: upper },
  ];
}

/** Short / x ranges: 1 → <2.0.0; 1.2 or 1.2.x → <1.3.0. */
function shortComparators(p: { nums: Numbers; has: [boolean, boolean, boolean] }): Comparator[] {
  const [major, minor] = p.nums;
  const lower: Numbers = p.nums;
  let upper: Numbers;
  if (p.has[1]) upper = [major, minor + 1, 0];
  else upper = [major + 1, 0, 0];
  return [
    { op: ">=", ver: lower },
    { op: "<", ver: upper },
  ];
}

/**
 * Minimal semver `satisfies(version, range)`. Supports ^ ~ >= > <= < = exact,
 * x/short ranges (1, 1.2, 1.x), combined (">=1.0.0 <2.0.0") and `||`.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;

  // OR groups: any group satisfying the version wins.
  for (const group of r.split("||")) {
    if (satisfiesGroup(v, group)) return true;
  }
  return false;
}

function satisfiesGroup(v: Numbers, group: string): boolean {
  const comparators: Comparator[] = [];
  for (const token of group.split(/\s+/)) {
    comparators.push(...expandToken(token));
  }
  if (comparators.length === 0) return true;
  for (const c of comparators) {
    const d = cmp(v, c.ver);
    if (c.op === ">=") {
      if (d < 0) return false;
    } else if (c.op === ">") {
      if (d <= 0) return false;
    } else if (c.op === "<") {
      if (d >= 0) return false;
    } else if (c.op === "<=") {
      if (d > 0) return false;
    } else if (c.op === "=") {
      if (d !== 0) return false;
    }
  }
  return true;
}

/** Highest version in `versions` satisfying `range`, if any. */
function bestMatch(versions: string[], range: string): string | null {
  let best: string | null = null;
  let bestP: Numbers | null = null;
  for (const ver of versions) {
    const p = parseVersion(ver);
    if (!p) continue;
    if (!satisfies(ver, range)) continue;
    if (bestP === null || cmp(p, bestP) > 0) {
      best = ver;
      bestP = p;
    }
  }
  return best;
}

/**
 * Resolve a concrete version for `range` given registry metadata.
 * Pure; unit-tested. Returns exact-for-exact when present, best match for
 * ranges, or latest as a fallback for unpublished/phantom versions.
 */
export function getResolvedVersion(
  meta: Pick<RegistryMeta, "versions" | "latestVersion">,
  range: string
): string | null {
  const latest = meta.latestVersion;
  const verNames = meta.versions.map((v) => v.version);
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*") return latest;
  if (isPlainVersion(trimmed)) {
    return verNames.includes(trimmed) ? trimmed : (latest ?? null);
  }
  const match = bestMatch(verNames, trimmed);
  return match ?? (latest ?? null);
}

// ---------------------------------------------------------------------------
// Registry network access
// ---------------------------------------------------------------------------

const META_CACHE = new Map<string, RegistryMeta | null>();

/**
 * Fetch registry metadata ONCE per package name (cached). Does NOT depend on
 * the requested range — version resolution is applied per-call later so
 * multiple ranges of the same package resolve independently.
 */
async function fetchRawMeta(name: string): Promise<RegistryMeta | null> {
  const cached = META_CACHE.get(name);
  if (cached !== undefined) return cached;

  const escaped = name.startsWith("@") ? name.replace("/", "%2f") : name;
  const url = `${REGISTRY_URL}/${escaped}`;
  let doc: RegistryDoc | null = null;
  try {
    doc = await getJson<RegistryDoc | null>(url);
  } catch (err) {
    // Only an explicit 404 proves the package doesn't exist; transient
    // network errors must not poison the cache (monitor is long-lived).
    if (err instanceof HttpError && err.status === 404) {
      META_CACHE.set(name, null);
    }
    return null;
  }
  if (!doc || typeof doc !== "object") {
    META_CACHE.set(name, null);
    return null;
  }
  const meta = buildMeta(name, doc);
  META_CACHE.set(name, meta);
  return meta;
}

export function buildMeta(name: string, doc: RegistryDoc): RegistryMeta | null {
  if (typeof doc.name !== "string") return null;
  const distTags = doc["dist-tags"] ?? {};
  const latestVersion = typeof distTags["latest"] === "string" ? distTags["latest"] : null;
  const times = doc.time ?? {};
  const versionKeys = Object.keys(doc.versions ?? {});
  const versions: VersionMeta[] = versionKeys.map((v) => ({
    version: v,
    publishedAt: typeof times[v] === "string" ? (times[v] as string) : null,
    isLatest: v === latestVersion,
  }));
  const published: number[] = [];
  for (const v of versions) {
    if (v.publishedAt) {
      const t = Date.parse(v.publishedAt);
      if (!Number.isNaN(t)) published.push(t);
    }
  }
  const latestPublishAt =
    published.length > 0 ? new Date(Math.max(...published)).toISOString() : null;
  return {
    name,
    latestPublishAt,
    latestVersion,
    versions,
    downloadsLast30d: null,
    deprecated: typeof doc.deprecated === "string",
    versionExists: false, // set by caller
    resolvedVersion: null, // set by caller
  };
}

/**
 * Fetch metadata for one package, resolving the concrete version for THIS
 * package's range. Range-independent metadata is cached by name; the
 * resolvedVersion/versionExists fields are computed per call (pure, not cached).
 */
export async function fetchRegistryMeta(pkg: PackageRef): Promise<RegistryMeta | null> {
  const meta = await fetchRawMeta(pkg.name);
  if (!meta) return null;
  const resolvedVersion = getResolvedVersion(meta, pkg.range);
  const versionExists = meta.versions.some((v) => v.version === pkg.range);
  // downloads (non-fatal, best-effort) — attach to raw cached meta once.
  if (meta.downloadsLast30d === null) {
    try {
      const dl = await getJson<DownloadsDoc | null>(
        `${DOWNLOADS_URL}/${encodeURIComponent(pkg.name)}`
      );
      if (dl && typeof dl.downloads === "number") meta.downloadsLast30d = dl.downloads;
    } catch {
      // non-fatal
    }
  }
  return { ...meta, resolvedVersion, versionExists };
}

/** Fetch metadata for many packages, bounded concurrency, keyed by spec. */
export async function fetchAllMetas(
  pkgs: PackageRef[],
  metaFn: RegistryMetaFn = fetchRegistryMeta
): Promise<Map<string, RegistryMeta>> {
  const out = new Map<string, RegistryMeta>();
  const results = await pool(pkgs, async (p) => ({ p, m: await metaFn(p) }), 8);
  for (const { p, m } of results) {
    if (m) out.set(p.key, m);
  }
  return out;
}
