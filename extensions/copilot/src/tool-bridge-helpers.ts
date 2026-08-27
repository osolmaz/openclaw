import type { AnyAgentTool } from "openclaw/plugin-sdk/agent-harness-runtime";

export function hasNonWildcardGlobAllowlist(toolsAllow: string[] | undefined): boolean {
  return (toolsAllow ?? []).some((entry) => {
    const trimmed = entry.trim();
    return trimmed !== "*" && trimmed.includes("*");
  });
}

export function readInlinePluginToolMeta(tool: {
  name: string;
  pluginId?: unknown;
}): { pluginId: string } | undefined {
  const pluginId = tool.pluginId;
  return typeof pluginId === "string" && pluginId.trim() ? { pluginId } : undefined;
}

export function findDuplicateToolNames(sourceTools: AnyAgentTool[]): string[] {
  const counts = new Map<string, number>();
  for (const sourceTool of sourceTools) {
    if (typeof sourceTool.name !== "string" || sourceTool.name.length === 0) {
      continue;
    }
    counts.set(sourceTool.name, (counts.get(sourceTool.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .toSorted();
}
