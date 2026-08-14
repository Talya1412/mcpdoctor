// mcpdoctor — bill-of-materials builder.

import { resolvePackageRef } from "./config.js";
import type { BomItem, BomReport, McpServerEntry, McpRuntime, PackageRef, RegistryMeta } from "./types.js";

function installFor(ref: PackageRef | null, meta: RegistryMeta | null): string | null {
  if (!ref || !ref.runtime) return null;
  const r: McpRuntime = ref.runtime;
  // Only npm-installable runtimes get an `@version` suffix; python modules and
  // PyPI tools (uvx) install by name only.
  const pinned = r === "npx" && meta?.resolvedVersion ? `${ref.name}@${meta.resolvedVersion}` : ref.name;
  if (r === "binary") return `${ref.name} (binary)`;
  if (r === "python") return `python -m ${pinned}`;
  if (r === "uvx") return `uvx ${pinned}`;
  return `npx ${pinned}`;
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
    const meta = ref ? metas.get(ref.key) ?? null : null;
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