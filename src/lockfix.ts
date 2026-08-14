// mcpdoctor — lockfix: pin resolved versions.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolvePackageRef } from "./config.js";
import type { McpServerEntry, PackageRef, RegistryMeta } from "./types.js";

export interface LockPin {
  server: string;
  package: string;
  spec: string;
  resolved: string;
}

export interface Lockfile {
  lockfileVersion: number;
  generatedAt: string;
  pins: LockPin[];
}

/** Compute pin for each resolvable package. */
export function computeLockfix(
  entries: McpServerEntry[],
  metas: Map<string, RegistryMeta>
): Array<{ name: string; serverName: string; oldSpec: string; pinnedSpec: string }> {
  const pins: Array<{ name: string; serverName: string; oldSpec: string; pinnedSpec: string }> = [];
  for (const e of entries) {
    const ref: PackageRef | null = resolvePackageRef(e);
    if (!ref) continue;
    const meta = metas.get(ref.name);
    const resolved = meta?.resolvedVersion;
    if (!resolved) continue;
    pins.push({
      name: ref.name,
      serverName: e.name,
      oldSpec: ref.spec,
      pinnedSpec: `${ref.name}@${resolved}`,
    });
  }
  return pins;
}

export function toLockfile(pins: Array<{ name: string; serverName: string; oldSpec: string; pinnedSpec: string }>): Lockfile {
  const lps: LockPin[] = pins.map((p) => {
    const split = p.pinnedSpec.indexOf("@", p.pinnedSpec.startsWith("@") ? 1 : 0);
    const pkg = split === -1 ? p.name : p.pinnedSpec.slice(0, split);
    const resolved = split === -1 ? "" : p.pinnedSpec.slice(split + 1);
    return { server: p.serverName, package: pkg, spec: p.oldSpec, resolved };
  });
  return { lockfileVersion: 1, generatedAt: new Date().toISOString(), pins: lps };
}

/** Write lockfile to disk. */
export function writeLockfile(
  pins: Array<{ name: string; serverName: string; oldSpec: string; pinnedSpec: string }>,
  file = "mcpdoctor.lock.json"
): Lockfile {
  const lock = toLockfile(pins);
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n", "utf8");
  return lock;
}

/** Read and return a lockfile's pins (for display). */
export function applyLockfile(file: string): LockPin[] | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Lockfile;
    return parsed.pins ?? [];
  } catch {
    return null;
  }
}