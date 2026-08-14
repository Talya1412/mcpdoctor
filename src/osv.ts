// mcpdoctor — OSV CVE lookup (public, no auth).

import { getJson } from "./net.js";
import type { VulnRef } from "./types.js";

const OSV_URL = "https://api.osv.dev/v1/query";

interface OsvResponse {
  vulns?: Array<OsvVuln>;
}

interface OsvVuln {
  id?: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type?: string; score?: string }>;
}

function databasePrefix(id: string): string {
  const m = /^([A-Za-z]+)-/.exec(id);
  return m ? m[1]!.toUpperCase() : "OSV";
}

function severityOf(v: OsvVuln): string | null {
  if (v.database_specific && typeof v.database_specific.severity === "string") {
    return v.database_specific.severity;
  }
  if (Array.isArray(v.severity) && v.severity.length > 0) {
    const s = v.severity[0];
    if (s && typeof s.score === "string") return s.score;
  }
  return null;
}

/**
 * Query OSV for known vulnerabilities at `resolvedVersion`. Never throws.
 * Returns [] when no version given or on any network/parse error.
 */
export async function queryVulns(
  name: string,
  resolvedVersion: string | null
): Promise<VulnRef[]> {
  if (!resolvedVersion) return [];
  try {
    const doc = await getJson<OsvResponse>(OSV_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem: "npm" }, version: resolvedVersion }),
      noCache: true,
    });
    const raw = doc?.vulns ?? [];
    const out: VulnRef[] = [];
    for (const v of raw) {
      const id = v.id ?? "";
      if (!id) continue;
      // Skip entries that are pure aliases of another advisory (no own id body).
      if (/^(GHSA|CVE|OSV|DLA|PYSEC|GO|RUSTSEC)-/.test(id)) {
        out.push({ id, summary: v.summary ?? "", severity: severityOf(v), database: databasePrefix(id) });
      }
    }
    return out;
  } catch {
    return [];
  }
}