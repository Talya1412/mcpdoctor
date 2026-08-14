import { describe, it, expect } from "vitest";
import { parseMcpConfigObject, resolvePackageRef } from "../src/config.js";
import type { McpServerEntry } from "../src/types.js";

const SRC = "test/mcp.json";

function entry(partial: Partial<McpServerEntry>): McpServerEntry {
  return { name: "s", command: "", args: [], transport: "stdio", sourceFile: SRC, ...partial };
}

describe("resolvePackageRef", () => {
  it("npx -y pkg", () => {
    const r = resolvePackageRef(entry({ command: "npx", args: ["-y", "some-pkg"] }));
    expect(r).toEqual({ name: "some-pkg", spec: "some-pkg", key: "some-pkg", range: "*", runtime: "npx" });
  });

  it("bunx pkg@2", () => {
    const r = resolvePackageRef(entry({ command: "bunx", args: ["tool@2.1.0"] }));
    expect(r).toEqual({ name: "tool", spec: "tool@2.1.0", key: "tool@2.1.0", range: "2.1.0", runtime: "npx" });
  });

  it("uvx tool", () => {
    const r = resolvePackageRef(entry({ command: "uvx", args: ["mcp-tool"] }));
    expect(r).toEqual({ name: "mcp-tool", spec: "mcp-tool", key: "mcp-tool", range: "*", runtime: "uvx" });
  });

  it("python -m module", () => {
    const r = resolvePackageRef(entry({ command: "python", args: ["-m", "mcp.server"] }));
    expect(r).toEqual({ name: "mcp.server", spec: "mcp.server", key: "mcp.server", range: "*", runtime: "python" });
  });

  it("git binary", () => {
    const r = resolvePackageRef(entry({ command: "git", args: [] }));
    expect(r).toEqual({ name: "git", spec: "git", key: "git", range: "*", runtime: "binary" });
  });

  it("scoped npx package", () => {
    const r = resolvePackageRef(entry({ command: "npx", args: ["@scope/pkg"] }));
    expect(r).toEqual({ name: "@scope/pkg", spec: "@scope/pkg", key: "@scope/pkg", range: "*", runtime: "npx" });
  });

  it("pnpm dlx pkg", () => {
    const r = resolvePackageRef(entry({ command: "pnpm", args: ["dlx", "server"] }));
    expect(r).toEqual({ name: "server", spec: "server", key: "server", range: "*", runtime: "npx" });
  });

  it("node not a package", () => {
    expect(resolvePackageRef(entry({ command: "node", args: ["server.js"] }))).toBeNull();
  });

  it("npx -c shell command is not a package", () => {
    expect(resolvePackageRef(entry({ command: "npx", args: ["-c", "node -v"] }))).toBeNull();
    expect(resolvePackageRef(entry({ command: "npx", args: ["--call", "node -v"] }))).toBeNull();
  });
});

describe("parseMcpConfigObject", () => {
  it("parses mcpServers map", () => {
    const entries = parseMcpConfigObject(
      { mcpServers: { a: { command: "npx", args: ["x"] }, b: { url: "http://h/path/to/sse" } } },
      SRC
    );
    expect(entries).toHaveLength(2);
    const a = entries.find((e) => e.name === "a");
    const b = entries.find((e) => e.name === "b");
    expect(a?.transport).toBe("stdio");
    expect(b?.transport).toBe("sse");
    expect(b?.url).toBe("http://h/path/to/sse");
  });

  it("parses flat top-level map without mcpServers", () => {
    const entries = parseMcpConfigObject(
      { s1: { command: "npx", args: ["z"] }, notServer: { foo: "bar" } },
      SRC
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("s1");
  });

  it("detects http transport", () => {
    const entries = parseMcpConfigObject({ mcpServers: { r: { url: "http://example.com/mcp" } } }, SRC);
    expect(entries[0]?.transport).toBe("http");
  });

  it("returns empty on non-object", () => {
    expect(parseMcpConfigObject(null, SRC)).toEqual([]);
    expect(parseMcpConfigObject("x", SRC)).toEqual([]);
  });
});