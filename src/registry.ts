// mcpdoctor — npm registry metadata + minimal semver range matching (no deps).

import { getJson, pool } from "./net.js";
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

const META_CACHE = new Map<string, Promise<RegistryMeta | null>>();

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

function isPlainVersion(s: string): boolean {
  return VERSION_RE.test(s.trim()) && !s.trim().startsWith("v ") && !s.includes("*");
}

interface Bound {
  op: ">=" | "<" | "=";
  ver: string;
}

function parseToken(token: string): Bound | null {
  const t = token.trim();
  if (t.startsWith(">=")) {
    const v = t.slice(2).trim();
    return parseVersion(v) ? { op: ">=", ver: v } : null;
  }
  if (t.startsWith("<=")) {
    const v = t.slice(2).trim();
    return parseVersion(v) ? { op: "<", ver: v } : null;
  }
  if (t.startsWith("<")) {
    const v = t.slice(1).trim();
    return parseVersion(v) ? { op: "<", ver: v } : null;
  }
  if (t.startsWith(">")) {
    const v = t.slice(1).trim();
    return parseVersion(v) ? { op: ">=", ver: v } : null;
  }
  if (t.startsWith("^") || t.startsWith("~")) {
    const v = t.slice(1).trim();
    return parseVersion(v) ? { op: ">=", ver: v } : null;
  }
  if (VERSION_RE.test(t)) return { op: "=", ver: t };
  return null;
}

function maxCeiling(range: string): string | null {
  for (const t of range.split(/\s+/)) {
    const trimmed = t.trim();
    const m = /^~(\d+)\.(\d+)\.(\d+)($|-)/.exec(trimmed);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      return `${m[1]}.${Number(m[2]) + 1}.0`;
    }
    const c = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
    if (c && c[1] !== undefined && c[2] !== undefined) {
      if (Number(c[1]) === 0) return `0.${Number(c[2]) + 1}.0`;
      return `${Number(c[1]) + 1}.0.0`;
    }
  }
  return null;
}

/** Minimal semver `satisfies(version, range)`. Supports ^, ~, >=, >=x <y, exact, *. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;

  const ceiling = maxCeiling(r);
  if (ceiling && cmp(v, parseVersion(ceiling)) >= 0) return false;

  let lowerMet = false;
  let anyTok = false;
  for (const token of r.split(/\s+/)) {
    const t = token.trim();
    if (t === "" || t === "*") continue;
    anyTok = true;
    const bound = parseToken(t);
    if (!bound) return false;
    const bv = parseVersion(bound.ver)!;
    if (bound.op === "=") {
      if (cmp(v, bv) !== 0) return false;
      lowerMet = true;
    } else if (bound.op === "<") {
      if (t.startsWith("<=") ? cmp(v, bv) > 0 : cmp(v, bv) >= 0) return false;
    } else {
      if (cmp(v, bv) >= 0) lowerMet = true;
    }
  }
  return !anyTok || lowerMet;
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
 * Pure; unit-tested.
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

const GLOBAL_META_CACHE = new Map<string, RegistryMeta | null>();

async function fetchRawMeta(name: string): Promise<RegistryMeta | null> {
  const cached = GLOBAL_META_CACHE.get(name);
  if (cached !== undefined) return cached;
  const url = `${REGISTRY_URL}/${encodeURIComponent(name)}`;
  let doc: RegistryDoc | null = null;
  try {
    doc = await getJson<RegistryDoc | null>(url);
  } catch (err) {
    // 404 → null
    if (err instanceof Error && /404/.test(err.message)) {
      GLOBAL_META_CACHE.set(name, null);
      return null;
    }
    GLOBAL_META_CACHE.set(name, null);
    return null;
  }
  if (!doc || typeof doc !== "object") {
    GLOBAL_META_CACHE.set(name, null);
    return null;
  }
  const meta = buildMeta(name, doc);
  GLOBAL_META_CACHE.set(name, meta);
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
 * Fetch full metadata for one package. Returns null when not found.
 * Adds downloads where possible.
 */
export async function fetchRegistryMeta(pkg: PackageRef): Promise<RegistryMeta | null> {
  const cacheKey = pkg.name;
  if (META_CACHE.has(cacheKey)) return META_CACHE.get(cacheKey)!;
  const p = (async (): Promise<RegistryMeta | null> => {
    const meta = await fetchRawMeta(pkg.name);
    if (!meta) return null;
    const resolvedVersion = getResolvedVersion(meta, pkg.range);
    const versionExists = pkg.range !== "*" && meta.versions.some((v) => v.version === pkg.range);
    // downloads
    try {
      const dl = await getJson<DownloadsDoc | null>(`${DOWNLOADS_URL}/${encodeURIComponent(pkg.name)}`);
      if (dl && typeof dl.downloads === "number") meta.downloadsLast30d = dl.downloads;
    } catch {
      // non-fatal
    }
    meta.resolvedVersion = resolvedVersion;
    meta.versionExists = versionExists;
    return meta;
  })();
  META_CACHE.set(cacheKey, p);
  return p;
}

/** Fetch metadata for many packages, bounded concurrency. */
export async function fetchAllMetas(
  pkgs: PackageRef[],
  metaFn: RegistryMetaFn = fetchRegistryMeta
): Promise<Map<string, RegistryMeta>> {
  const out = new Map<string, RegistryMeta>();
  const results = await pool(pkgs, async (p) => ({ p, m: await metaFn(p) }), 8);
  for (const { p, m } of results) {
    if (m) out.set(p.name, m);
  }
  return out;
}