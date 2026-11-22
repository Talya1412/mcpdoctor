// mcpdoctor — npm registry metadata and version resolution.

import semver from "semver";
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
// npm version resolution (pure)
// ---------------------------------------------------------------------------

export function satisfies(version: string, range: string): boolean {
  return semver.satisfies(version, range);
}

/** Preserve the latest fallback for a missing exact pin so the audit can suggest a replacement. */
export function getResolvedVersion(
  meta: Pick<RegistryMeta, "versions" | "latestVersion" | "distTags">,
  range: string
): string | null {
  const requested = range.trim();
  if (requested === "" || requested === "*" || requested === "latest") return meta.latestVersion;

  const versions = meta.versions.map((release) => release.version);
  const exact = semver.valid(requested);
  if (exact !== null) {
    if (versions.includes(requested)) return requested;
    return versions.find((version) => semver.valid(version) === exact) ?? meta.latestVersion;
  }

  const tagged = meta.distTags?.[requested];
  if (typeof tagged === "string" && versions.includes(tagged)) return tagged;
  return semver.maxSatisfying(versions, requested);
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
  const versions: VersionMeta[] = versionKeys.map((v) => {
    const release = doc.versions?.[v];
    const deprecated = release !== null && typeof release === "object" &&
      "deprecated" in release && typeof release.deprecated === "string";
    return {
      version: v,
      publishedAt: typeof times[v] === "string" ? (times[v] as string) : null,
      isLatest: v === latestVersion,
      deprecated,
    };
  });
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
    distTags,
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
  const exact = semver.valid(pkg.range.trim());
  const versionExists = exact !== null && meta.versions.some((v) => semver.valid(v.version) === exact);
  const deprecated = meta.deprecated || meta.versions.some((v) => v.version === resolvedVersion && v.deprecated);
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
  return { ...meta, resolvedVersion, versionExists, deprecated };
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
