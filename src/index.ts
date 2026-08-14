// mcpdoctor — public API surface for programmatic use.

export { runAudit, type AuditOptions } from "./audit.js";
export { buildBom } from "./bom.js";
export {
  discoverConfigFiles,
  gatherEntries,
  isMcpConfigCandidate,
  parseMcpConfig,
  parseMcpConfigObject,
  resolvePackageRef,
} from "./config.js";
export { probeHealth } from "./health.js";
export { computeLockfix, applyLockfile, writeLockfile, type Lockfile, type LockPin } from "./lockfix.js";
export { runMonitor, runOnce } from "./monitor.js";
export { getJson, pool } from "./net.js";
export { queryVulns } from "./osv.js";
export {
  buildMeta,
  fetchAllMetas,
  fetchRegistryMeta,
  getResolvedVersion,
  satisfies,
} from "./registry.js";
export { renderJson, renderMarkdown, renderTable } from "./report.js";
export { composeVerdict, stalenessVerdict, STALE_DAYS, ZOMBIE_DAYS } from "./staleness.js";
export { openStore } from "./store.js";
export type {
  AuditReport,
  AuditSummary,
  AuditVerdict,
  BomItem,
  BomReport,
  HealthResult,
  McpRuntime,
  McpServerEntry,
  McpTransport,
  PackageRef,
  PackageVulns,
  RegistryMeta,
  ReportFormat,
  UptimeAggregate,
  UptimeProbeResult,
  UptimeRecord,
  UptimeTargetSpec,
  Verdict,
  Verdict as McpVerdict,
  VersionMeta,
  VulnRef,
} from "./types.js";
