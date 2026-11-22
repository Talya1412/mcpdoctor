// mcpdoctor — shared type contracts.
// Every module imports from here. Do NOT change field names/shapes without
// updating every consumer. These are the fix-point between the core engines
// and the CLI/report/monitor layers.

// ---------------------------------------------------------------------------
// MCP server entries (parsed from config files)
// ---------------------------------------------------------------------------

/** How an MCP server is launched */
export type McpTransport = "stdio" | "http" | "sse";

/** Source runtime the server targets */
export type McpRuntime = "npx" | "uvx" | "python" | "node" | "binary" | "command";

/** A single raw server entry as authored in an MCP config file. */
export interface McpServerEntry {
  /** server name / key in the config object */
  name: string;
  /** where it's launched from */
  command: string;
  /** args, typically the package name and/or runtime switches */
  args: string[];
  /** env vars, if any */
  env?: Record<string, string>;
  /** "stdio" | "http" | "sse" — inferred from config shape or url */
  transport: McpTransport;
  /** url for remote servers (http/sse) */
  url?: string;
  /** which config file this came from (relative path) */
  sourceFile: string;
}

/** Package spec resolved from a command/args, or null if not resolvable. */
export interface PackageRef {
  /** registry name, e.g. "@modelcontextprotocol/server-filesystem" */
  name: string;
  /** specifier: "name" | "name@range" | "name@version" */
  spec: string;
  /** unique key across refs — spec for distinct ranges so same-name-different-spec resolves independently */
  key: string;
  /** pre-parsed version/range, or '*' for latest */
  range: string;
  /** null if the command isn't a package manager invocation */
  runtime: McpRuntime | null;
}

// ---------------------------------------------------------------------------
// Registry metadata (npm)
// ---------------------------------------------------------------------------

export interface VersionMeta {
  version: string;
  /** npm `time[version]` publish timestamp (ISO) or null */
  publishedAt: string | null;
  /** npm dist-tag "latest" value at query time */
  isLatest: boolean;
  /** this release is marked deprecated by npm */
  deprecated?: boolean;
}

export interface RegistryMeta {
  name: string;
  /** last publish across all versions */
  latestPublishAt: string | null;
  /** latest version per dist-tags.latest */
  latestVersion: string | null;
  /** npm dist-tags other than latest may select a different release channel */
  distTags?: Readonly<Record<string, string>>;
  /** all versions with metadata (may be truncated) */
  versions: VersionMeta[];
  /** npm downloads for last month (from downloads API) or null */
  downloadsLast30d: number | null;
  /** true if package was deprecated (deprecated field set) */
  deprecated: boolean;
  /** whether this exact (name, version) exists */
  versionExists: boolean;
  /** resolved concrete version for the requested range ('*' → latest) */
  resolvedVersion: string | null;
}

// ---------------------------------------------------------------------------
// OSV vulnerability results
// ---------------------------------------------------------------------------

export interface VulnRef {
  id: string;
  summary: string;
  /** severity or null */
  severity: string | null;
  /** OSV database, e.g. "OSV", "GHSA", "CVE" */
  database: string;
}

export interface PackageVulns {
  name: string;
  resolvedVersion: string | null;
  vulns: VulnRef[];
}

// ---------------------------------------------------------------------------
// Health / staleness
// ---------------------------------------------------------------------------

export type Verdict = "ok" | "stale" | "zombie" | "insecure" | "missing" | "unreachable";

export interface HealthResult {
  /** reachable via network probe (remote servers) — null when n/a (stdio) */
  reachable: boolean | null;
  /** HTTP status / latency detail */
  detail: string;
}

export interface AuditVerdict {
  name: string;
  /** primary verdict — the first/problem found */
  verdict: Verdict;
  /** human-readable explanation */
  reason: string;
  /** all problems, ordered by severity */
  problems: Array<{
    severity: "critical" | "high" | "medium" | "low" | "info";
    message: string;
  }>;
  /** resolved package version, if resolvable */
  resolvedVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Build-of-materials output
// ---------------------------------------------------------------------------

export interface BomItem {
  serverName: string;
  sourceFile: string;
  transport: McpTransport;
  packageName: string | null;
  requestedSpec: string | null;
  runtime: McpRuntime | null;
  resolvedVersion: string | null;
  install: string | null;
}

export interface BomReport {
  sourceFiles: string[];
  items: BomItem[];
}

// ---------------------------------------------------------------------------
// Audit report (aggregated)
// ---------------------------------------------------------------------------

export type ReportFormat = "markdown" | "json" | "table";

export interface AuditSummary {
  total: number;
  ok: number;
  stale: number;
  zombie: number;
  insecure: number;
  missing: number;
  unreachable: number;
  /** repositories with critical-or-high findings */
  criticalCount: number;
  highCount: number;
}

export interface AuditReport {
  generatedAt: string;
  summary: AuditSummary;
  /** per-server verdicts */
  verdicts: AuditVerdict[];
  /** exactly the count of servers, sanity check */
  scanners: {
    entries: McpServerEntry[];
  };
}

// ---------------------------------------------------------------------------
// Uptime monitoring / SQLite records
// ---------------------------------------------------------------------------

export interface UptimeTargetSpec {
  name: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
}

export interface UptimeProbeResult {
  ok: boolean;
  detail: string;
  atMs: number;
}

export interface UptimeRecord {
  id: number;
  targetName: string;
  url: string | null;
  ok: number; // 0/1
  detail: string;
  probedAt: string; // ISO
}

/** Per-target aggregated history for report rows */
export interface UptimeAggregate {
  targetName: string;
  url: string | null;
  currentStatus: "up" | "down" | "unknown";
  availabilityPct: number;
  totalProbes: number;
  successProbes: number;
  lastChangedAt: string | null;
}
