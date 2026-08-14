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
  let raw: string | null = null;
  if (v.database_specific && typeof v.database_specific.severity === "string") {
    raw = v.database_specific.severity;
  }
  if (raw === null && Array.isArray(v.severity) && v.severity.length > 0) {
    const s = v.severity[0];
    if (s && typeof s.score === "string") raw = s.score;
  }
  if (raw === null) return null;
  // Normalize to a canonical severity string: critical/high/medium/low.
  const lower = raw.toLowerCase();
  if (lower.includes("critical")) return "critical";
  if (lower.includes("high")) return "high";
  if (lower.includes("moderate")) return "medium";
  if (lower.includes("low")) return "low";
  // Numeric CVSS: >=9 critical, >=7 high, >=4 medium, else low.
  const n = Number.parseFloat(raw);
  if (!Number.isNaN(n)) {
    if (n >= 9) return "critical";
    if (n >= 7) return "high";
    if (n >= 4) return "medium";
    return "low";
  }
  return lower;
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