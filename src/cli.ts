#!/usr/bin/env node
// mcpdoctor — CLI entrypoint.

import { Command } from "commander";
import { runAudit } from "./audit.js";
import { buildBom } from "./bom.js";
import { gatherEntries, parseMcpConfig, resolvePackageRef } from "./config.js";
import { computeLockfix, writeLockfile } from "./lockfix.js";
import { runMonitor } from "./monitor.js";
import { fetchAllMetas } from "./registry.js";
import { renderBomJson, renderBomMarkdown, renderBomTable, renderReport } from "./report.js";
import type { McpServerEntry, ReportFormat } from "./types.js";

const program = new Command();

program
  .name("mcpdoctor")
  .description("npm audit for your MCP server stack")
  .version("0.1.0", "-v, --version", "output the version number");

function normalizeFormat(f: string): ReportFormat {
  if (f === "json") return "json";
  if (f === "markdown") return "markdown";
  return "table";
}

function loadEntries(config?: string): McpServerEntry[] {
  return config ? parseMcpConfig(config) : gatherEntries(process.cwd()).entries;
}

async function loadMetasFor(entries: McpServerEntry[]) {
  const refs = entries
    .map((e) => resolvePackageRef(e))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return fetchAllMetas(refs);
}

program
  .command("audit", { isDefault: true })
  .description("scan MCP configs and report on server health")
  .option("-f, --format <markdown|json|table>", "output format", "table")
  .option("-c, --config <path>", "explicit config file override")
  .option("--no-cves", "skip vulnerability lookup")
  .action(async (opts: { format: string; config?: string; cves: boolean }) => {
    const format = normalizeFormat(opts.format);
    const report = await runAudit(process.cwd(), {
      format,
      config: opts.config,
      noCves: !opts.cves,
    });
    process.stdout.write(renderReport(report, format) + "\n");
  });

program
  .command("bom")
  .description("print the bill-of-materials for discovered MCP servers")
  .option("-c, --config <path>", "explicit config file override")
  .option("-f, --format <table|json|markdown>", "output format", "table")
  .action(async (opts: { config?: string; format: string }) => {
    const entries = loadEntries(opts.config);
    const metas = await loadMetasFor(entries);
    const bom = buildBom(entries, metas);
    const fmt = opts.format;
    const out =
      fmt === "json" ? renderBomJson(bom) : fmt === "markdown" ? renderBomMarkdown(bom) : renderBomTable(bom);
    process.stdout.write(out + "\n");
  });

program
  .command("lockfix")
  .description("suggest pinned versions for MCP server packages")
  .option("-c, --config <path>", "explicit config file override")
  .option("--write", "write mcpdoctor.lock.json")
  .option("--file <path>", "lockfile path to write", "mcpdoctor.lock.json")
  .action(async (opts: { config?: string; write?: boolean; file: string }) => {
    const entries = loadEntries(opts.config);
    const metas = await loadMetasFor(entries);
    const pins = computeLockfix(entries, metas);
    if (opts.write) {
      const lock = writeLockfile(pins, opts.file);
      process.stdout.write(JSON.stringify(lock, null, 2) + "\n");
    } else {
      for (const p of pins) {
        process.stdout.write(`${p.serverName}\t${p.oldSpec}\t->\t${p.pinnedSpec}\n`);
      }
      if (pins.length === 0) process.stdout.write("no resolvable packages\n");
    }
  });

program
  .command("monitor")
  .description("uptime monitor over discovered MCP servers")
  .option("--once", "probe once and exit")
  .option("--interval <ms>", "interval between probes", "60000")
  .option("--db <path>", "sqlite db path", "mcpdoctor.db")
  .option("-c, --config <path>", "explicit config file override")
  .option("--refresh", "rescan config each tick")
  .action((opts: { once?: boolean; interval: string; db: string; config?: string }) => {
    const intervalMs = Number(opts.interval) || 60000;
    void runMonitor(loadEntries(opts.config), {
      intervalMs,
      once: opts.once,
      dbPath: opts.db,
    });
  });

void program.parseAsync(process.argv);