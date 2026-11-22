// mcpdoctor — pure staleness/verdict logic.

import semver from "semver";
import type {
  AuditVerdict,
  HealthResult,
  PackageVulns,
  RegistryMeta,
  Verdict,
} from "./types.js";

export const STALE_DAYS = 90;
export const ZOMBIE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StalenessVerdict {
  verdict: Verdict;
  reason: string;
  daysSincePublish: number | null;
}

export function stalenessVerdict(meta: RegistryMeta | null): StalenessVerdict {
  if (!meta || !meta.latestPublishAt) {
    return {
      verdict: "missing",
      reason: "package not found on npm (or unpublished)",
      daysSincePublish: null,
    };
  }
  const pub = Date.parse(meta.latestPublishAt);
  if (Number.isNaN(pub)) {
    return {
      verdict: "ok",
      reason: "unable to determine publish date",
      daysSincePublish: null,
    };
  }
  const daysSincePublish = Math.floor((Date.now() - pub) / DAY_MS);
  if (daysSincePublish >= ZOMBIE_DAYS) {
    return { verdict: "zombie", reason: `no publish in ${daysSincePublish} days`, daysSincePublish };
  }
  if (daysSincePublish >= STALE_DAYS) {
    return { verdict: "stale", reason: `last publish ${daysSincePublish} days ago`, daysSincePublish };
  }
  return { verdict: "ok", reason: `last publish ${daysSincePublish} days ago`, daysSincePublish };
}

export interface ComposeInputs {
  name: string;
  registry: RegistryMeta | null;
  staleness: StalenessVerdict;
  vulns: PackageVulns | null;
  health: HealthResult;
  resolvedVersion: string | null;
  /** exact pinned version requested, if the user pinned a concrete version */
  requestedRange?: string;
}

interface Problem {
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
}

const PRIORITY: Record<Verdict, number> = {
  insecure: 1,
  missing: 2,
  zombie: 3,
  stale: 4,
  unreachable: 5,
  ok: 6,
};

/**
 * Combine registry verdict + vulns + health into one AuditVerdict.
 * Ordering: insecure > missing > zombie > stale > unreachable > ok.
 */
export function composeVerdict(inputs: ComposeInputs): AuditVerdict {
  const problems: Problem[] = [];

  const criticalVulns = inputs.vulns?.vulns ?? [];
  let hasCritical = false;
  let hasHigh = false;
  for (const v of criticalVulns) {
    const sev = (v.severity ?? "").toLowerCase();
    const problemSeverity: Problem["severity"] =
      sev === "critical" ? "critical" : sev === "high" ? "high" : sev === "medium" ? "medium" : sev === "low" ? "low" : "high";
    problems.push({
      severity: problemSeverity,
      message: `CVE ${v.id}: ${v.summary || "known vulnerability"} (severity ${v.severity ?? "n/a"})`,
    });
    if (problemSeverity === "critical") hasCritical = true;
    else if (problemSeverity === "high") hasHigh = true;
  }

  if (inputs.staleness.verdict !== "ok") {
    problems.push({ severity: "medium", message: inputs.staleness.reason });
  }
  // Deprecated package = known insecure (README: deprecated-x → INSECURE).
  if (inputs.registry?.deprecated) {
    problems.push({
      severity: "high",
      message: "package is deprecated (unmaintained / discouraged)",
    });
  }
  // Phantom pin: user pinned an exact version that was never published.
  const exactRequested = semver.valid(inputs.requestedRange?.trim() ?? "");
  const unresolved = inputs.registry !== null && inputs.requestedRange !== undefined && inputs.resolvedVersion === null;
  if (inputs.registry && exactRequested !== null &&
      !inputs.registry.versions.some((v) => semver.valid(v.version) === exactRequested)) {
    problems.push({
      severity: "high",
      message: `pinned version ${inputs.requestedRange} was never published (resolved to ${inputs.resolvedVersion ?? "latest"})`,
    });
  } else if (unresolved) {
    problems.push({ severity: "medium", message: `no published version matches ${inputs.requestedRange}` });
  }
  if (inputs.health.reachable === false) {
    problems.push({ severity: "info", message: `unreachable: ${inputs.health.detail}` });
  }

  let verdict: Verdict = "ok";
  const sevOf = (p: Problem): number => (p.severity === "critical" ? 0 : 1);
  if (hasCritical) verdict = "insecure";
  else if (problems.some((p) => p.severity === "high")) verdict = "insecure";
  else if (unresolved || inputs.staleness.verdict === "missing") verdict = "missing";
  else if (inputs.staleness.verdict === "zombie") verdict = "zombie";
  else if (inputs.staleness.verdict === "stale") verdict = "stale";
  else if (inputs.health.reachable === false) verdict = "unreachable";

  problems.sort((a, b) => sevOf(a) - sevOf(b));

  const reason =
    problems.find((p) => p.severity === "critical" || p.severity === "high")?.message ??
    problems[0]?.message ??
    "healthy";

  return { name: inputs.name, verdict, reason, problems, resolvedVersion: inputs.resolvedVersion };
}

export { PRIORITY };
