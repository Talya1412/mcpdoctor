// mcpdoctor — uptime monitor loop.

import pc from "picocolors";
import { probeHealth } from "./health.js";
import type { UptimeProbeResult, McpServerEntry, UptimeTargetSpec } from "./types.js";
import { openStore } from "./store.js";

export interface MonitorOptions {
  intervalMs?: number;
  once?: boolean;
  dbPath?: string;
}

/** Probe all entries and produce results. Pure of persistence. */
export async function runOnce(entries: McpServerEntry[]): Promise<UptimeProbeResult[]> {
  return Promise.all(
    entries.map(async (e) => {
      const h = await probeHealth(e);
      const ok = h.reachable === true;
      return { ok, detail: h.detail, atMs: Date.now() };
    })
  );
}

export function specFor(entry: McpServerEntry): UptimeTargetSpec {
  return {
    name: entry.name,
    transport: entry.transport,
    url: entry.url ?? null,
    command: entry.command || null,
  };
}

/**
 * Run the monitor loop: probe -> store -> log -> repeat/exit.
 */
export async function runMonitor(
  entries: McpServerEntry[],
  opts: MonitorOptions = {}
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 60_000;
  const dbPath = opts.dbPath ?? "mcpdoctor.db";
  const store = openStore(dbPath);

  const shutdown = () => {
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    for await (const _tick of ticker(intervalMs)) {
      const specs = entries.map(specFor);
      const healths = await Promise.all(entries.map(probeHealth));
      for (let i = 0; i < healths.length; i++) {
        const h = healths[i];
        const spec = specs[i];
        if (h === undefined || spec === undefined) continue;
        // stdio servers have no reachability — nothing to monitor.
        if (h.reachable === null) {
          console.log(`${pc.gray("[--]")} ${spec.name} stdio (n/a)`);
          continue;
        }
        const ok = h.reachable === true;
        store.insertProbe({
          targetName: spec.name,
          url: spec.url,
          ok: ok ? 1 : 0,
          detail: h.detail,
          probedAt: new Date().toISOString(),
        });
        const arrow = ok ? pc.green("[up]") : pc.red("[down]");
        console.log(`${arrow} ${spec.name} ${h.detail}`);
      }
      if (opts.once) break;
    }
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    store.close();
  }
}

async function* ticker(intervalMs: number): AsyncGenerator<void, void, unknown> {
  while (true) {
    yield;
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}