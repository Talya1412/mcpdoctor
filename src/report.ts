// mcpdoctor — report renderers.

import pc from "picocolors";
import type { AuditReport, BomReport, ReportFormat, Verdict } from "./types.js";

const VERDICT_COLOR: Record<Verdict, (s: string) => string> = {
  ok: (s) => pc.green(s),
  stale: (s) => pc.yellow(s),
  zombie: (s) => pc.red(s),
  insecure: (s) => pc.bold(pc.red(s)),
  missing: (s) => pc.red(s),
  unreachable: (s) => pc.magenta(s),
};

const BADGE: Record<Verdict, string> = {
  ok: "OK",
  stale: "STALE",
  zombie: "ZOMBIE",
  insecure: "INSECURE",
  missing: "MISSING",
  unreachable: "UNREACHABLE",
};

export function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# mcpdoctor audit report`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Servers scanned: ${report.summary.total}`);
  lines.push("");
  for (const v of report.verdicts) {
    lines.push(`#### ${v.name}`);
    lines.push("");
    lines.push(`**${v.verdict}** — ${v.reason}`);
    lines.push("");
    if (v.problems.length > 0) {
      for (const p of v.problems) {
        lines.push(`- [${p.severity}] ${p.message}`);
      }
      lines.push("");
    }
    if (v.resolvedVersion) {
      lines.push(`Resolved version: \`${v.resolvedVersion}\``);
      lines.push("");
    }
  }
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| total | ${report.summary.total} |`);
  lines.push(`| ok | ${report.summary.ok} |`);
  lines.push(`| stale | ${report.summary.stale} |`);
  lines.push(`| zombie | ${report.summary.zombie} |`);
  lines.push(`| insecure | ${report.summary.insecure} |`);
  lines.push(`| missing | ${report.summary.missing} |`);
  lines.push(`| unreachable | ${report.summary.unreachable} |`);
  lines.push("");
  return lines.join("\n");
}

function visible(s: string): string {
  // strip ANSI escape sequences so column padding counts display width, not
  // the invisible color codes picocolors embeds
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(s: string, width: number): string {
  const vis = visible(s);
  const padLen = vis.length >= width ? 0 : width - vis.length;
  return s + " ".repeat(padLen);
}

export function renderTable(report: AuditReport): string {
  const head = ["name", "verdict", "version", "reason"];
  const widths = [14, 13, 12, 40];
  const rows: string[][] = report.verdicts.map((v) => [
    v.name,
    VERDICT_COLOR[v.verdict](BADGE[v.verdict]),
    v.resolvedVersion ?? "-",
    v.reason,
  ]);
  const lines: string[] = [];
  lines.push(head.map((h, i) => pad(h, widths[i] ?? 1)).join(" | "));
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of rows) {
    lines.push(r.map((c, i) => pad(c, widths[i] ?? 1)).join(" | "));
  }
  return lines.join("\n");
}

export function renderJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderBomTable(bom: BomReport): string {
  const head = ["server", "transport", "package", "version", "install"];
  const widths = [14, 9, 30, 12, 40];
  const lines: string[] = [];
  lines.push(head.map((h, i) => pad(h, widths[i] ?? 1)).join(" | "));
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const it of bom.items) {
    lines.push(
      [it.serverName, it.transport, it.packageName ?? "-", it.resolvedVersion ?? "-", it.install ?? "-"]
        .map((c, i) => pad(c, widths[i] ?? 1))
        .join(" | ")
    );
  }
  return lines.join("\n");
}

export function renderBomJson(bom: BomReport): string {
  return JSON.stringify(bom, null, 2);
}

export function renderBomMarkdown(bom: BomReport): string {
  const lines: string[] = ["# mcpdoctor BOM", ""];
  for (const f of bom.sourceFiles) lines.push(`- source: \`${f}\``);
  lines.push("");
  for (const it of bom.items) {
    lines.push(`#### ${it.serverName}`);
    lines.push(`- transport: ${it.transport}`);
    lines.push(`- package: ${it.packageName ?? "-"}`);
    lines.push(`- version: ${it.resolvedVersion ?? "-"}`);
    lines.push(`- install: ${it.install ?? "-"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderReport(report: AuditReport, format: ReportFormat): string {
  switch (format) {
    case "markdown":
      return renderMarkdown(report);
    case "json":
      return renderJson(report);
    case "table":
      return renderTable(report);
  }
}