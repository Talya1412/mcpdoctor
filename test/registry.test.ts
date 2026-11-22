import { afterEach, describe, it, expect, vi } from "vitest";
import { buildMeta, fetchRegistryMeta, getResolvedVersion, satisfies } from "../src/registry.js";

afterEach(() => vi.unstubAllGlobals());

type Meta = { versions: { version: string }[]; latestVersion: string | null };

function meta(versions: string[], latest: string | null): Meta {
  return { versions: versions.map((v) => ({ version: v })), latestVersion: latest };
}

describe("satisfies", () => {
  it("matches exact versions", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  });

  it("matches * and empty", () => {
    expect(satisfies("4.5.6", "*")).toBe(true);
    expect(satisfies("4.5.6", "")).toBe(true);
  });

  it("matches caret ranges", () => {
    expect(satisfies("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfies("1.9.0", "^1.2.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.0")).toBe(false);
    // ^0.x stays within minor 0 (0.4.x => <0.5.0)
    expect(satisfies("0.4.9", "^0.4.0")).toBe(true);
    expect(satisfies("0.5.0", "^0.4.0")).toBe(false);
  });

  it("matches tilde ranges", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  });

  it("matches >= and compound ranges", () => {
    expect(satisfies("2.5.0", ">=2.0.0")).toBe(true);
    expect(satisfies("1.9.0", ">=2.0.0")).toBe(false);
    expect(satisfies("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  });

  it("enforces partial comparator bounds", () => {
    expect(satisfies("1.5.0", ">=1 <2")).toBe(true);
    expect(satisfies("2.0.0", ">=1 <2")).toBe(false);
  });

  it("excludes pre-releases from stable npm ranges", () => {
    expect(satisfies("1.5.0-beta.1", "^1.0.0")).toBe(false);
    expect(satisfies("1.5.0-beta.2", ">=1.5.0-beta.1 <2")).toBe(true);
  });

  it("lower bound required", () => {
    expect(satisfies("0.1.0", ">=1.0.0")).toBe(false);
  });

  it("treats > as exclusive (not >=", () => {
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
    expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfies("2.0.0", ">1.0.0")).toBe(true);
  });

  it("supports short caret ranges", () => {
    expect(satisfies("1.9.9", "^1")).toBe(true);
    expect(satisfies("2.0.0", "^1")).toBe(false);
    expect(satisfies("1.9.9", "^1.2")).toBe(true);
    expect(satisfies("2.0.0", "^1.2")).toBe(false);
  });

  it("supports short tilde ranges", () => {
    expect(satisfies("1.2.9", "~1.2")).toBe(true);
    expect(satisfies("1.3.0", "~1.2")).toBe(false);
    expect(satisfies("1.9.9", "~1")).toBe(true);
    expect(satisfies("2.0.0", "~1")).toBe(false);
  });

  it("supports x-range / short versions", () => {
    expect(satisfies("1.5.0", "1.x")).toBe(true);
    expect(satisfies("2.0.0", "1.x")).toBe(false);
    expect(satisfies("1.5.0", "1.5.x")).toBe(true);
    expect(satisfies("1.6.0", "1.5.x")).toBe(false);
    expect(satisfies("1.5.0", "1.5")).toBe(true);
  });

  it("supports || alternative ranges", () => {
    expect(satisfies("1.2.0", "^1.0.0 || ^2.0.0")).toBe(true);
    expect(satisfies("2.5.0", "^1.0.0 || ^2.0.0")).toBe(true);
    expect(satisfies("3.0.0", "^1.0.0 || ^2.0.0")).toBe(false);
  });

  it("supports <= as inclusive", () => {
    expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "<=1.2.3")).toBe(false);
  });
});

describe("getResolvedVersion", () => {
  it("returns latest for *", () => {
    expect(getResolvedVersion(meta(["1.0.0", "2.0.0"], "2.0.0"), "*")).toBe("2.0.0");
  });

  it("returns exact present version", () => {
    expect(getResolvedVersion(meta(["1.0.0", "1.2.3"], "1.0.0"), "1.2.3")).toBe("1.2.3");
  });

  it("returns best range match", () => {
    const m = meta(["1.0.0", "1.5.0", "1.9.0", "2.0.0"], "2.0.0");
    expect(getResolvedVersion(m, "^1.0.0")).toBe("1.9.0");
  });

  it("falls back to latest for unpublished exact version", () => {
    const m = meta(["1.0.0", "1.1.0"], "1.1.0");
    expect(getResolvedVersion(m, "9.9.9")).toBe("1.1.0");
  });

  it("returns null when no versions", () => {
    expect(getResolvedVersion(meta([], null), "^1.0.0")).toBeNull();
  });

  it("keeps unresolved ranges separate from the latest release", () => {
    const m = meta(["1.0.0", "1.5.0", "2.0.0"], "2.0.0");
    expect(getResolvedVersion(m, ">=1 <2")).toBe("1.5.0");
    expect(getResolvedVersion(m, "^3.0.0")).toBeNull();
  });

  it("resolves explicit npm distribution tags", () => {
    const m = buildMeta("package", {
      name: "package",
      versions: { "1.0.0": {}, "2.0.0-beta.1": {} },
      "dist-tags": { latest: "1.0.0", beta: "2.0.0-beta.1" },
    });
    expect(m).not.toBeNull();
    expect(getResolvedVersion(m!, "latest")).toBe("1.0.0");
    expect(getResolvedVersion(m!, "beta")).toBe("2.0.0-beta.1");
    expect(getResolvedVersion(m!, "unknown-tag")).toBeNull();
  });
});

it("reports deprecation for the selected npm release", async () => {
  const name = "fixture-deprecation";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.startsWith("https://api.npmjs.org") ? { downloads: 10 } : {
      name,
      "dist-tags": { latest: "2.0.0" },
      versions: { "1.0.0": { deprecated: "use 2.x" }, "2.0.0": {} },
    };
    return new Response(JSON.stringify(body));
  }));

  const lookup = (range: string) => fetchRegistryMeta({ name, range, spec: `${name}@${range}`, key: `${name}@${range}`, runtime: "npx" });

  expect((await lookup("1.0.0"))?.deprecated).toBe(true);
  expect((await lookup("2.0.0"))?.deprecated).toBe(false);
});
