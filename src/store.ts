// mcpdoctor — uptime persistence via node:sqlite (built-in) with in-memory fallback.

import type { UptimeAggregate, UptimeRecord } from "./types.js";

type AnyRow = Record<string, unknown>;

interface DbLike {
  exec(sql: string): unknown;
  run(sql: string, ...params: unknown[]): unknown;
  all(sql: string, ...params: unknown[]): AnyRow[];
  insertProbe(record: Omit<UptimeRecord, "id">): void;
  aggTargets(limit: number): UptimeAggregate[];
  close(): void;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
}

let DatabaseSyncCtor: (() => new (path: string, options?: { timeout?: number }) => SqliteDatabase) | null = null;
try {
  // node:sqlite available in Node 22.5+
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = () => mod.DatabaseSync;
} catch {
  DatabaseSyncCtor = null;
}

interface MemoryRow {
  id: number;
  target: string;
  url: string | null;
  ok: number;
  detail: string;
  probed_at: string;
}

export interface UptimeStore {
  insertProbe(record: Omit<UptimeRecord, "id">): void;
  aggTargets(limit?: number): UptimeAggregate[];
  close(): void;
}

function makeMemoryStore(): UptimeStore {
  const rows: MemoryRow[] = [];
  let nextId = 1;
  return {
    insertProbe(r) {
      rows.push({ id: nextId++, target: r.targetName, url: r.url ?? null, ok: r.ok, detail: r.detail, probed_at: r.probedAt });
    },
    aggTargets(limit = 1000) {
      const byTarget = new Map<string, MemoryRow[]>();
      for (const r of rows) {
        const arr = byTarget.get(r.target) ?? [];
        arr.push(r);
        byTarget.set(r.target, arr);
      }
      const out: UptimeAggregate[] = [];
      for (const [target, arr] of byTarget) {
        const sorted = [...arr].sort((a, b) => a.id - b.id);
        const success = sorted.filter((r) => r.ok === 1).length;
        const total = sorted.length;
        const last = sorted[sorted.length - 1];
        out.push({
          targetName: target,
          url: last?.url ?? null,
          currentStatus: last === undefined ? "unknown" : last.ok === 1 ? "up" : "down",
          availabilityPct: total === 0 ? 0 : Math.round((success / total) * 1000) / 10,
          totalProbes: total,
          successProbes: success,
          lastChangedAt: sorted[0]?.probed_at ?? null,
        });
      }
      return out.slice(0, limit);
    },
    close() {},
  };
}

function makeSqliteStore(dbPath: string): UptimeStore {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite unavailable");
  const db = new (DatabaseSyncCtor())(dbPath, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(
    `CREATE TABLE IF NOT EXISTS probes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      url TEXT,
      ok INTEGER NOT NULL,
      detail TEXT,
      probed_at TEXT NOT NULL)`
  );
  const ins = db.prepare("INSERT INTO probes(target, url, ok, detail, probed_at) VALUES (?, ?, ?, ?, ?)");
  const agg = db.prepare(
    `SELECT target, SUM(ok) success, COUNT(*) total,
       (SELECT url FROM probes p2 WHERE p2.target = probes.target ORDER BY id DESC LIMIT 1) url,
       (SELECT ok FROM probes p2 WHERE p2.target = probes.target ORDER BY id DESC LIMIT 1) last_ok,
       (SELECT probed_at FROM probes p2 WHERE p2.target = probes.target ORDER BY id ASC LIMIT 1) first_at
     FROM probes GROUP BY target`
  );
  return {
    insertProbe(r) {
      ins.run(r.targetName, r.url ?? null, r.ok, r.detail, r.probedAt);
    },
    aggTargets(limit = 1000) {
      const rows = agg.all() as Array<Record<string, unknown>>;
      const out: UptimeAggregate[] = rows.map((row) => {
        const target = String(row["target"] ?? "");
        const total = Number(row["total"] ?? 0);
        const success = Number(row["success"] ?? 0);
        const lastOk = row["last_ok"] === null || row["last_ok"] === undefined ? null : Number(row["last_ok"]);
        const currentStatus = lastOk === 1 ? "up" : lastOk === 0 ? "down" : "unknown";
        return {
          targetName: target,
          url: row["url"] === null || row["url"] === undefined ? null : String(row["url"]),
          currentStatus,
          availabilityPct: total === 0 ? 0 : Math.round((success / total) * 1000) / 10,
          totalProbes: total,
          successProbes: success,
          lastChangedAt: row["first_at"] === null || row["first_at"] === undefined ? null : String(row["first_at"]),
        };
      });
      return out.slice(0, limit);
    },
    close() {
      db.close();
    },
  };
}

/**
 * Open an uptime store. Uses node:sqlite if available (Node 22.5+), else an
 * in-memory fallback. Never throws on sqlite absence.
 */
export function openStore(dbPath = "mcpdoctor.db"): UptimeStore {
  try {
    return makeSqliteStore(dbPath);
  } catch {
    console.warn("[mcpdoctor] node:sqlite unavailable — uptime history will not persist across runs (Node 22.5+ recommended)");
    return makeMemoryStore();
  }
}