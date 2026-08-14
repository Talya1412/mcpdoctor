<div align="center">

# mcpdoctor

### The `npm audit` for your MCP server stack

One command scans your MCP configs, finds **dead, stale, zombie and insecure** servers, pins your versions, and monitors uptime.

[![npm version](https://img.shields.io/npm/v/mcpdoctor.svg)](https://www.npmjs.com/package/mcpdoctor)
[![npm downloads](https://img.shields.io/npm/dm/mcpdoctor.svg)](https://www.npmjs.com/package/mcpdoctor)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)

</div>

---

> MCP servers are the new supply chain. 52% are dead. 75% ship a known-vulnerability dependency. Nobody was checking — until now.

## What it does

MCP servers are wired into agents on vibes — no lockfile, no CVE scan, no freshness check. `mcpdoctor` closes that gap in one command:

- **Audit** every MCP server in your configs — `.mcp.json`, `.cursor/mcp.json`, Claude/Cursor/Windsurf global configs.
- **Detect** dead packages, stale releases (90d+), zombies (365d+), known CVEs (via OSV), and unreachable remote/HTTP servers.
- **Lockfix** — pin your MCP server versions to a lockfile before they drift and break.
- **Monitor** — continuous uptime tracking for your remote servers, stored locally in SQLite.

## Install

Requires Node.js 18+.

```sh
npx mcpdoctor          # works out of the box, no global install
```

or install globally:

```sh
npm install -g mcpdoctor
```

## Quick start

```sh
# Audit all detected MCP configs in the current directory
npx mcpdoctor

# Audit a specific config, markdown report
npx mcpdoctor -c .cursor/mcp.json -f markdown

# Bill of materials — what versions are you actually running?
npx mcpdoctor bom --json

# Pin your versions to a lockfile
npx mcpdoctor lockfix --write

# Watch your remote servers' uptime (Ctrl+C to stop)
npx mcpdoctor monitor
```

## Example output

```text
name           | verdict       | version      | reason
---------------+---------------+--------------+-----------------------------------------
filesystem     | OK            | 1.2.3        | healthy
github         | STALE         | 0.5.0        | last publish 142 days ago
legacy-tool    | ZOMBIE        | 0.1.0        | no publish in 400 days
deprecated-x   | INSECURE      | 1.0.0        | CVE-2025-XXXXX: known vulnerability
ghost-server   | MISSING       | -            | package not found on npm
remote-api     | UNREACHABLE   | -            | HTTP 502
```

## Commands

| Command | Description |
| --- | --- |
| `mcpdoctor` / `mcpdoctor audit` | Scan configs, audit each server, print report |
| `mcpdoctor bom` | Bill of materials — resolved versions + install commands |
| `mcpdoctor lockfix` | Generate/print a lockfile of pinned server versions |
| `mcpdoctor monitor` | Continuous uptime monitoring for remote servers |
| `mcpdoctor -v` | Print version |

### Options

`audit`:

- `-f, --format <markdown|json|table>` — output format (default `table`)
- `-c, --config <path>` — audit a specific config file instead of auto-discover
- `--no-cves` — skip the OSV CVE lookup (faster)

`monitor`:

- `--once` — probe once and exit
- `--interval <ms>` — probe interval (default `60000`)
- `--db <path>` — SQLite db path (default `mcpdoctor.db`)
- `--refresh` — rescan config files each tick

## How verdicts work

| Verdict | Meaning |
| --- | --- |
| `OK` | Resolved, published recently, reachable, no known CVEs |
| `STALE` | Last publish ≥ 90 days ago |
| `ZOMBIE` | Last publish ≥ 365 days ago |
| `INSECURE` | Known vulnerability in resolved version, or unpublished package |
| `MISSING` | Package no longer exists on npm (or unpublished) |
| `UNREACHABLE` | Remote/HTTP server failed a live health probe |

Verdict severity order: `INSECURE > MISSING > ZOMBIE > STALE > UNREACHABLE > OK`.

## Supported configs & runtimes

Auto-discovered config files:

- `.mcp.json`, `mcp.json`
- `.cursor/mcp.json`
- `.claude/settings.json`
- `windsurf/mcp_config.json`
- Claude global config (`claude_desktop_config.json` / `~/.claude.json`)

Supported runtimes: `npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `uvx`, `uv`, `pipx`, `python -m`, plus remote `http`/`sse` servers by URL. Bare binaries (`git`, `docker`, …) are marked non-auditable rather than phantom-missing.

## Privacy

Everything runs locally. Metadata and CVE lookups hit the public npm registry and OSV (open-source vulnerability DB) over HTTPS — no telemetry, no account, no data leaves for analytics. Uptime history is a local SQLite file.

## Roadmap

- [x] Audit, BOM, lockfix, uptime monitor
- [x] CVE lookup via OSV
- [ ] `mcpdoctor doctor` — one-shot all commands
- [ ] Auto-pin into source configs
- [ ] MCP conformance / contract-drift detection
- [ ] Group/project reporting + CI mode (exit non-zero on insecure)

## License

MIT — see [LICENSE](LICENSE).