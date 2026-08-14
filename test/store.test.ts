import { describe, it, expect } from "vitest";
import { openStore } from "../src/store.js";

describe("openStore", () => {
  it("inserts and aggregates probes", () => {
    const store = openStore();
    store.insertProbe({ targetName: "a", url: "http://x", ok: 1, detail: "HTTP 200", probedAt: "2024-01-01T00:00:00Z" });
    store.insertProbe({ targetName: "a", url: "http://x", ok: 1, detail: "HTTP 200", probedAt: "2024-01-02T00:00:00Z" });
    store.insertProbe({ targetName: "a", url: "http://x", ok: 0, detail: "timeout", probedAt: "2024-01-03T00:00:00Z" });
    store.insertProbe({ targetName: "b", url: null, ok: 0, detail: "n/a", probedAt: "2024-01-01T00:00:00Z" });

    const agg = store.aggTargets();
    const a = agg.find((r) => r.targetName === "a");
    expect(a).toBeDefined();
    expect(a?.totalProbes).toBe(3);
    expect(a?.successProbes).toBe(2);
    expect(a?.currentStatus).toBe("down");
    expect(a?.availabilityPct).toBeCloseTo(66.7, 1);
    const b = agg.find((r) => r.targetName === "b");
    expect(b?.currentStatus).toBe("down");
    store.close();
  });

  it("empty store yields empty aggregates", () => {
    const store = openStore();
    expect(store.aggTargets()).toEqual([]);
    store.close();
  });
});