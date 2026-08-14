// mcpdoctor — network reachability probe.

import type { HealthResult, McpServerEntry } from "./types.js";

/**
 * Probe reachability of an MCP server entry. Never throws.
 * http/sse → HEAD request with 5s timeout. stdio → n/a.
 */
export async function probeHealth(entry: McpServerEntry): Promise<HealthResult> {
  if ((entry.transport === "http" || entry.transport === "sse") && entry.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(entry.url, { method: "HEAD", redirect: "follow", signal: controller.signal });
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