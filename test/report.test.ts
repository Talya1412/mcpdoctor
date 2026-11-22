import { expect, it } from "vitest";
import { parseMcpConfigObject } from "../src/config.js";
import { renderJson } from "../src/report.js";
import type { AuditReport } from "../src/types.js";

it("keeps scanner provenance in JSON without exporting config values", () => {
  const entries = parseMcpConfigObject({
    mcpServers: {
      local: { command: "npx", args: ["tool", "fixture-arg"], env: { API_TOKEN: "fixture-token" } },
      remote: { url: "https://example.invalid/mcp?token=fixture-url-token" },
    },
  }, "fixture.json");
  const report: AuditReport = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { total: 2, ok: 2, stale: 0, zombie: 0, insecure: 0, missing: 0, unreachable: 0, criticalCount: 0, highCount: 0 },
    verdicts: [],
    scanners: { entries },
  };

  const json = renderJson(report);

  expect(JSON.parse(json).scanners.entries).toEqual([
    { name: "local", transport: "stdio", sourceFile: "fixture.json" },
    { name: "remote", transport: "http", sourceFile: "fixture.json" },
  ]);
  expect(json).not.toContain("fixture-token");
  expect(json).not.toContain("fixture-arg");
  expect(json).not.toContain("fixture-url-token");
});
