// mcpdoctor — audit orchestrator.

import { gatherEntries, parseMcpConfig, resolvePackageRef } from "./config.js";
import { probeHealth } from "./health.js";
import { queryVulns } from "./osv.js";
import { fetchAllMetas } from "./registry.js";
import { composeVerdict, stalenessVerdict } from "./staleness.js";
import { pool } from "./net.js";
import type {
  AuditReport,
  AuditSummary,
  AuditVerdict,
  McpServerEntry,
  PackageRef,
  RegistryMeta,
  ReportFormat,
} from "./types.js";

export interface AuditOptions {
  format?: ReportFormat;
  config?: string;
  noCves?: boolean;
}

function emptySummary(): AuditSummary {
  return {
    total: 0,
    ok: 0,
    stale: 0,
    zombie: 0,
    insecure: 0,
    missing: 0,
    unreachable: 0,
    criticalCount: 0,
    highCount: 0,
  };
}

function uniqueRefs(entries: McpServerEntry[]): PackageRef[] {
  const seen = new Set<string>();
  const out: PackageRef[] = [];
  for (const e of entries) {
    const ref = resolvePackageRef(e);
    if (!ref) continue;
    if (ref.runtime === "binary") continue; // bare binaries (git, docker) aren't npm packages
    const key = ref.spec;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * Run a full audit. Never crashes on a single bad entry — such entries are
 * marked missing/problem and the audit continues.
 */
export async function runAudit(
  cwd: string,
  opts: AuditOptions = {}
): Promise<AuditReport> {
  const noCves = opts.noCves ?? false;
  let entries: McpServerEntry[];
  if (opts.config) {
    entries = parseMcpConfig(opts.config);
  } else {
    entries = gatherEntries(cwd).entries;
  }

  const refs = uniqueRefs(entries);
  const metas = await fetchAllMetas(refs);

  // vulns per unique ref
  const vulnResults = await pool(
    refs,
    async (ref) => {
      const meta = metas.get(ref.name);
      const resolved = meta?.resolvedVersion ?? null;
      const vulns = noCves ? [] : await queryVulns(ref.name, resolved);
      return { name: ref.name, resolvedVersion: resolved, vulns };
    },
    8
  );
  const vulnMap = new Map(vulnResults.map((v) => [v.name, v]));

  // health per entry
  const healthResults = await pool(entries, probeHealth, 8);

  const summary = emptySummary();
  summary.total = entries.length;

  const verdicts: AuditVerdict[] = entries.map((e, i) => {
    const ref = resolvePackageRef(e);
    const meta: RegistryMeta | null = ref && ref.runtime !== "binary" ? metas.get(ref.name) ?? null : null;
    // A server with NO npm-auditable package is a remote (url) server, a
    // bare binary (git/docker), or a python/node module — none "missing" on
    // npm. Report purely on reachability (health).
    const noPackage = ref === null || ref.runtime === "binary";
    const staleness = noPackage
      ? { verdict: "ok" as const, reason: e.transport === "http" || e.transport === "sse" ? "remote server (no npm package)" : "non-npm command (not auditable)", daysSincePublish: null }
      : stalenessVerdict(meta);
    const resolved = meta?.resolvedVersion ?? null;
    const vulns = ref ? vulnMap.get(ref.name) ?? null : null;
    const health = healthResults[i] ?? { reachable: null, detail: "probe skipped" };
    const verdict = composeVerdict({
      name: e.name,
      registry: meta,
      staleness,
      vulns,
      health,
      resolvedVersion: resolved,
    });

    if (verdict.verdict === "insecure") {
      summary.insecure += 1;
    } else if (verdict.verdict === "missing") summary.missing += 1;
    else if (verdict.verdict === "zombie") summary.zombie += 1;
    else if (verdict.verdict === "stale") summary.stale += 1;
    else if (verdict.verdict === "unreachable") summary.unreachable += 1;
    else summary.ok += 1;

    for (const p of verdict.problems) {
      if (p.severity === "critical") summary.criticalCount += 1;
      if (p.severity === "high") summary.highCount += 1;
    }
    return verdict;
  });

  return {
    generatedAt: new Date().toISOString(),
    summary,
    verdicts,
    scanners: { entries },
  };
}