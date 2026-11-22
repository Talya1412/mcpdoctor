// mcpdoctor — network reachability probe.

import type { HealthResult, McpServerEntry } from "./types.js";

/**
 * Probe reachability of an MCP server entry. Never throws.
 * http/sse → HEAD request with 5s timeout; falls back to GET when the server
 * rejects HEAD (405/501 — common for SSE and streamable-HTTP endpoints).
 * stdio → n/a (spawning would auto-install package-manager deps).
 */
export async function probeHealth(entry: McpServerEntry): Promise<HealthResult> {
  if ((entry.transport === "http" || entry.transport === "sse") && entry.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      let res = await fetch(entry.url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      if (res.status === 405 || res.status === 501) {
        await res.body?.cancel().catch(() => undefined);
        res = await fetch(entry.url, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          redirect: "follow",
          signal: controller.signal,
        });
      }
      await res.body?.cancel().catch(() => undefined);
      return { reachable: res.ok, detail: `HTTP ${res.status}` };
    } catch (err) {
      const name = err instanceof Error ? err.name : "UnknownError";
      return { reachable: false, detail: name };
    } finally {
      clearTimeout(timer);
    }
  }
  return { reachable: null, detail: "stdio (n/a)" };
}
