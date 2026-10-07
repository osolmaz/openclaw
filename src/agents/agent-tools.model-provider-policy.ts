import type { ModelCompatConfig, ModelSizeClass } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { filterToolsByAgentProfile, type ResolvedAgentProfile } from "./agent-profiles.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { filterLocalModelLeanTools } from "./local-model-lean.js";
import { resolveNativeWebSearchRoute } from "./native-web-search.js";
import type { PreparedModelRuntimeSnapshot } from "./prepared-model-runtime.types.js";

export function applyModelProviderToolPolicy(
  toolsInput: AnyAgentTool[],
  params?: {
    config?: OpenClawConfig;
    modelProvider?: string;
    modelApi?: string;
    modelBaseUrl?: string;
    modelId?: string;
    agentId?: string;
    sessionKey?: string;
    agentDir?: string;
    preparedModelRuntime?: Pick<PreparedModelRuntimeSnapshot, "metadataSnapshot">;
    modelCompat?: ModelCompatConfig;
    modelSizeClass?: ModelSizeClass;
    resolvedAgentProfile?: ResolvedAgentProfile;
    suppressManagedWebSearch?: boolean;
    runtimeToolAllowlist?: string[];
    localModelLeanPreserveToolNames?: string[];
    agentProfilePreserveToolNames?: string[];
  },
): AnyAgentTool[] {
  const profileFilteredTools = filterToolsByAgentProfile({
    tools: toolsInput,
    config: params?.config,
    agentId: params?.agentId,
    sessionKey: params?.sessionKey,
    modelProvider: params?.modelProvider,
    modelId: params?.modelId,
    modelSizeClass: params?.modelSizeClass,
    resolvedProfile: params?.resolvedAgentProfile,
    preserveToolNames: params?.agentProfilePreserveToolNames ?? params?.runtimeToolAllowlist,
  });
  const tools = filterLocalModelLeanTools({
    tools: profileFilteredTools,
    config: params?.config,
    agentId: params?.agentId,
    sessionKey: params?.sessionKey,
    preserveToolNames: params?.localModelLeanPreserveToolNames ?? params?.runtimeToolAllowlist,
  });

  if (
    params?.suppressManagedWebSearch !== false &&
    resolveNativeWebSearchRoute({
      config: params?.config,
      modelProvider: params?.modelProvider,
      modelApi: params?.modelApi,
      modelBaseUrl: params?.modelBaseUrl,
      modelId: params?.modelId,
      agentId: params?.agentId,
      sessionKey: params?.sessionKey,
      agentDir: params?.agentDir,
      runtimeToolAllowlist: params?.runtimeToolAllowlist,
      pluginMetadataSnapshot: params?.preparedModelRuntime?.metadataSnapshot,
    }).kind === "native"
  ) {
    return tools.filter((tool) => tool.name !== "web_search");
  }
  return tools;
}
