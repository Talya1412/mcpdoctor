// mcpdoctor — discover + parse MCP config files and resolve package refs.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  McpServerEntry,
  McpRuntime,
  McpTransport,
  PackageRef,
} from "./types.js";

/** Candidate config paths (relative to cwd), in priority order. */
export function candidatePaths(cwd: string): string[] {
  const rel: Array<[string, string]> = [
    [".mcp.json", ".mcp.json"],
    ["mcp.json", "mcp.json"],
    [".cursor/mcp.json", ".cursor/mcp.json"],
    [".claude/settings.json", ".claude/settings.json"],
    ["windsurf/mcp_config.json", "windsurf/mcp_config.json"],
  ];
  const paths = rel.map(([, r]) => resolve(cwd, r));
  if (process.platform === "win32" && process.env.APPDATA) {
    paths.push(
      resolve(process.env.APPDATA, "Claude", "claude_desktop_config.json")
    );
  } else {
    const home = homedir();
    paths.push(join(home, ".claude.json"));
    paths.push(join(home, ".config", "Claude", "claude_desktop_config.json"));
  }
  return paths;
}

/** Return existing candidate config file paths. */
export function discoverConfigFiles(cwd: string): string[] {
  return candidatePaths(cwd).filter((p) => existsSync(p));
}

/** Is this path one of the known MCP config candidates? */
export function isMcpConfigCandidate(file: string): boolean {
  return discoverConfigFiles(process.cwd()).includes(resolve(file));
}

function detectTransport(url: string | undefined): McpTransport {
  if (url === undefined) return "stdio";
  if (url.includes("/sse")) return "sse";
  if (url.startsWith("http")) return "http";
  return "stdio";
}

function toServer(
  name: string,
  raw: Record<string, unknown>,
  sourceFile: string
): McpServerEntry | null {
  const command = typeof raw["command"] === "string" ? raw["command"] : "";
  const url = typeof raw["url"] === "string" ? raw["url"] : undefined;
  if (command === "" && url === undefined) return null;

  let args: string[] = [];
  if (Array.isArray(raw["args"])) {
    args = raw["args"].filter((a): a is string => typeof a === "string");
  }

  let env: Record<string, string> | undefined;
  if (raw["env"] && typeof raw["env"] === "object") {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw["env"] as Record<string, unknown>)) {
      if (typeof v === "string") e[k] = v;
    }
    if (Object.keys(e).length > 0) env = e;
  }

  let transport: McpTransport = "stdio";
  if (url !== undefined) {
    transport = detectTransport(url);
  } else {
    const rawTransport = raw["transport"];
    if (rawTransport === "sse") transport = "sse";
    else if (rawTransport === "http") transport = "http";
  }

  return {
    name,
    command,
    args,
    env,
    transport,
    url,
    sourceFile,
  };
}

/**
 * Parse a single MCP config file. Supports `{ mcpServers: {...} }` or a flat
 * top-level map of servers (string-keyed entries with command/url).
 */
export function parseMcpConfig(file: string): McpServerEntry[] {
  const text = readFileSync(file, "utf8");
  const data: unknown = JSON.parse(text);
  return parseMcpConfigObject(data, file);
}

/** Parse an already-decoded config object (useful for tests). */
export function parseMcpConfigObject(
  data: unknown,
  sourceFile: string
): McpServerEntry[] {
  if (data === null || typeof data !== "object") return [];

  const obj = data as Record<string, unknown>;
  let servers: Record<string, unknown>;
  if (obj["mcpServers"] && typeof obj["mcpServers"] === "object") {
    servers = obj["mcpServers"] as Record<string, unknown>;
  } else {
    // Flat map: keep entries that look like MCP servers (command or url string).
    servers = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "object" && v !== null) {
        const e = v as Record<string, unknown>;
        if (
          typeof e["command"] === "string" ||
          typeof e["url"] === "string"
        ) {
          servers[k] = e;
        }
      }
    }
  }

  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (raw === null || typeof raw !== "object") continue;
    const e = toServer(name, raw as Record<string, unknown>, sourceFile);
    if (e) entries.push(e);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Package resolution
// ---------------------------------------------------------------------------

const FLAG_ARGS = new Set([
  "-y",
  "--yes",
  "-p",
  "--package",
  "@latest",
  "--latest",
  "-c",
  "--command",
]);

/** First non-flag arg, skipping recognized specifier/flag values. */
function firstPackageArg(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a.startsWith("-")) continue;
    if (FLAG_ARGS.has(a)) {
      // `-p <pkg>` / `--package <pkg>`: consume the value as the package.
      if (a === "-p" || a === "--package" || a === "-c" || a === "--command") {
        const val = args[i + 1];
        if (val !== undefined) return val;
      }
      continue;
    }
    return a;
  }
  return null;
}

function splitSpec(arg: string): { name: string; range: string; spec: string } {
  // Scoped name with range: "@scope/name@1.2.3" — split on last '@' after the
  // leading scope char.
  if (arg.startsWith("@")) {
    const idx = arg.indexOf("@", 1);
    if (idx === -1) {
      return { name: arg, range: "*", spec: arg };
    }
    return {
      name: arg.slice(0, idx),
      range: arg.slice(idx + 1) || "*",
      spec: arg,
    };
  }
  const idx = arg.indexOf("@");
  if (idx === -1) {
    return { name: arg, range: "*", spec: arg };
  }
  return {
    name: arg.slice(0, idx),
    range: arg.slice(idx + 1) || "*",
    spec: arg,
  };
}

/**
 * Resolve a package ref from a server entry's command + args.
 * Returns null when the command is not a recognized package-manager invocation.
 */
export function resolvePackageRef(entry: McpServerEntry): PackageRef | null {
  const cmd = entry.command;
  const args = entry.args;
  const base = cmd.split(/\s+/)[0] ?? cmd;

  // npx / npx.cmd / bunx / pnpm dlx / yarn dlx
  if (
    base === "npx" ||
    base === "npx.cmd" ||
    base === "bunx" ||
    base === "pnpm" ||
    base === "yarn"
  ) {
    // pnpm/yarn use a `dlx` subcommand before the package name.
    let candidateArgs = args;
    if ((base === "pnpm" || base === "yarn") && args[0] === "dlx") {
      candidateArgs = args.slice(1);
    }
    const pkg = firstPackageArg(candidateArgs);
    if (!pkg) return null;
    const { name, range, spec } = splitSpec(pkg);
    return { name, range, spec, runtime: "npx" };
  }

  // pnpm dlx <pkg> — pnpm subcommand handled above (first non-flag arg).

  // uvx / uv pipx
  if (base === "uvx" || base === "uv") {
    const pkg = firstPackageArg(args);
    if (!pkg) return null;
    const { name, range, spec } = splitSpec(pkg);
    return { name, range, spec, runtime: "uvx" };
  }

  if (base === "pipx") {
    const pkg = firstPackageArg(args);
    if (!pkg) return null;
    const { name, range, spec } = splitSpec(pkg);
    return { name, range, spec, runtime: "uvx" };
  }

  // python -m <module>
  if (base === "python" || base === "python3") {
    const mIdx = args.findIndex((a) => a === "-m");
    const mod = mIdx !== -1 ? args[mIdx + 1] : undefined;
    if (mod && !mod.startsWith("-")) {
      return { name: mod, spec: mod, range: "*", runtime: "python" };
    }
    return null;
  }

  // node <script> — not a package.
  if (base === "node" || base === "node.exe") {
    return null;
  }

  // deno run — not a package.
  if (base === "deno") return null;

  // Direct binary commands (git, docker, ...) — treat as binary.
  if (base === "" ) {
    return null;
  }
  // Heuristic: a bare command name with no path separator is a binary.
  if (!base.includes("/") && !base.includes("\\") && !base.includes(" ")) {
    return { name: base, spec: base, range: "*", runtime: "binary" };
  }

  return null;
}

/**
 * Gather all entries from discovered config files under cwd.
 */
export function gatherEntries(cwd: string): { files: string[]; entries: McpServerEntry[] } {
  const files = discoverConfigFiles(cwd);
  const entries: McpServerEntry[] = [];
  for (const f of files) {
    try {
      entries.push(...parseMcpConfig(f));
    } catch {
      // skip unparsable config files
    }
  }
  return { files, entries };
}

export type { McpRuntime };
