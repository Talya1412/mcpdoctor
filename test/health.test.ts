import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMcpConfigObject } from "../src/config.js";
import { probeHealth } from "../src/health.js";
import { runMonitor } from "../src/monitor.js";

afterEach(() => vi.unstubAllGlobals());

describe("probeHealth", () => {
  it("tries GET after HEAD 405 with an Allow header and closes the SSE body", async () => {
    const [entry] = parseMcpConfigObject({ mcpServers: { fixture: { url: "https://example.invalid/mcp" } } }, "fixture.json");
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405, headers: { Allow: "GET" } }))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    expect(await probeHealth(entry!)).toEqual({ reachable: true, detail: "HTTP 200" });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://example.invalid/mcp", expect.objectContaining({
      method: "GET",
      headers: { Accept: "text/event-stream" },
    }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("runMonitor", () => {
  it("loads the current targets before a probe tick", async () => {
    const loadEntries = vi.fn().mockReturnValue([]);

    await runMonitor(loadEntries, { once: true, dbPath: ":memory:" });

    expect(loadEntries).toHaveBeenCalledOnce();
  });
});
