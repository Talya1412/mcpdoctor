// mcpdoctor — bill-of-materials builder.

import { resolvePackageRef } from "./config.js";
import type { BomItem, BomReport, McpServerEntry, McpRuntime, PackageRef, RegistryMeta } from "./types.js";

function installFor(ref: PackageRef | null, meta: RegistryMeta | null): string | null {
  if (!ref) return null;
  if (!ref.runtime) return null;
  const r: McpRuntime = ref.runtime;
  const base = r === "uvx" ? "uvx" : r === "python" ? "python -m" : r === "binary" ? ref.name : "npx";
  const pinned = meta?.resolvedVersion ? `${ref.name}@${meta.resolvedVersion}` : ref.name;
  if (r === "binary") return `${pinned} (binary)`;
  return `${base} ${pinned}`;
}

/** Build a bill-of-materials from entries + fetched registry metadata. */
export function buildBom(
  entries: McpServerEntry[],
  metas: Map<string, RegistryMeta>
): BomReport {
  const sourceFiles: string[] = [];
  const seen = new Set<string>();
  const items: BomItem[] = entries.map((e) => {
    if (!seen.has(e.sourceFile)) {
      seen.add(e.sourceFile);
      sourceFiles.push(e.sourceFile);
    }
    const ref = resolvePackageRef(e);
    const meta = ref ? metas.get(ref.name) ?? null : null;
    const resolvedVersion = meta?.resolvedVersion ?? null;
    return {
      serverName: e.name,
      sourceFile: e.sourceFile,
      transport: e.transport,
      packageName: ref?.name ?? null,
      requestedSpec: ref?.spec ?? null,
      runtime: ref?.runtime ?? null,
      resolvedVersion,
      install: installFor(ref, meta),
    };
  });
  return { sourceFiles, items };
}