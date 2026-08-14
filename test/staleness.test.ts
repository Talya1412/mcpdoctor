import { describe, it, expect, vi } from "vitest";
import { composeVerdict, stalenessVerdict, STALE_DAYS, ZOMBIE_DAYS } from "../src/staleness.js";
import type { HealthResult, PackageVulns, RegistryMeta } from "../src/types.js";

const DAY = 24 * 60 * 60 * 1000;

function meta(publishedDaysAgo: number | null, over: Partial<RegistryMeta> = {}): RegistryMeta | null {
  if (publishedDaysAgo === null) return null;
  return {
    name: "pkg",
    latestPublishAt: new Date(Date.now() - publishedDaysAgo * DAY).toISOString(),
    latestVersion: "1.0.0",
    versions: [{ version: "1.0.0", publishedAt: null, isLatest: true }],
    downloadsLast30d: null,
    deprecated: false,
    versionExists: true,
    resolvedVersion: "1.0.0",
    ...over,
  };
}

const HEALTH_OK: HealthResult = { reachable: null, detail: "stdio (n/a)" };

describe("stalenessVerdict", () => {
  it("missing when null meta", () => {
    const v = stalenessVerdict(null);
    expect(v.verdict).toBe("missing");
    expect(v.daysSincePublish).toBeNull();
  });

  it("ok when fresh", () => {
    expect(stalenessVerdict(meta(10))?.verdict).toBe("ok");
  });

  it("stale at >= STALE_DAYS", () => {
    const v = stalenessVerdict(meta(100));
    expect(v.verdict).toBe("stale");
  });

  it("zombie at >= ZOMBIE_DAYS", () => {
    const v = stalenessVerdict(meta(400));
    expect(v.verdict).toBe("zombie");
  });
});

describe("composeVerdict", () => {
  it("ok when healthy", () => {
    const v = composeVerdict({
      name: "s",
      registry: meta(5),
      staleness: stalenessVerdict(meta(5)),
      vulns: null,
      health: HEALTH_OK,
      resolvedVersion: "1.0.0",
    });
    expect(v.verdict).toBe("ok");
  });

  it("insecure beats zombie", () => {
    const vulns: PackageVulns = {
      name: "pkg",
      resolvedVersion: "1.0.0",
      vulns: [{ id: "GHSA-abc", summary: "bad", severity: "critical", database: "GHSA" }],
    };
    const v = composeVerdict({
      name: "s",
      registry: meta(400),
      staleness: stalenessVerdict(meta(400)),
      vulns,
      health: HEALTH_OK,
      resolvedVersion: "1.0.0",
    });
    expect(v.verdict).toBe("insecure");
    expect(v.problems[0]?.message).toContain("GHSA-abc");
  });

  it("missing beats stale", () => {
    const v = composeVerdict({
      name: "s",
      registry: null,
      staleness: stalenessVerdict(null),
      vulns: null,
      health: HEALTH_OK,
      resolvedVersion: null,
    });
    expect(v.verdict).toBe("missing");
  });

  it("unreachable last", () => {
    const v = composeVerdict({
      name: "s",
      registry: meta(5),
      staleness: stalenessVerdict(meta(5)),
      vulns: null,
      health: { reachable: false, detail: "HttpError" },
      resolvedVersion: "1.0.0",
    });
    expect(v.verdict).toBe("unreachable");
  });

  it("zombie over stale ordering preserved", () => {
    const v = composeVerdict({
      name: "s",
      registry: meta(400),
      staleness: stalenessVerdict(meta(400)),
      vulns: null,
      health: HEALTH_OK,
      resolvedVersion: "1.0.0",
    });
    expect(v.verdict).toBe("zombie");
  });

  it("deprecated package is insecure", () => {
    const v = composeVerdict({
      name: "s",
      registry: meta(5, { deprecated: "use foo" }),
      staleness: stalenessVerdict(meta(5, { deprecated: "use foo" })),
      vulns: null,
      health: HEALTH_OK,
      resolvedVersion: "1.0.0",
    });
    expect(v.verdict).toBe("insecure");
    expect(v.problems.some((p) => p.message.includes("deprecated"))).toBe(true);
  });

  it("phantom pin to never-published version is insecure", () => {
    const reg: RegistryMeta = {
      name: "pkg",
      latestPublishAt: new Date().toISOString(),
      latestVersion: "1.0.0",
      versions: [{ version: "1.0.0", publishedAt: null, isLatest: true }],
      downloadsLast30d: null,
      deprecated: false,
      versionExists: true,
      resolvedVersion: "1.0.0",
    };
    const v = composeVerdict({
      name: "s",
      registry: reg,
      staleness: { verdict: "ok", reason: "last publish 0 days ago", daysSincePublish: 0 },
      vulns: null,
      health: HEALTH_OK,
      resolvedVersion: "1.0.0",
      requestedRange: "9.9.9",
    });
    expect(v.verdict).toBe("insecure");
    expect(v.problems.some((p) => p.message.includes("9.9.9"))).toBe(true);
  });
});