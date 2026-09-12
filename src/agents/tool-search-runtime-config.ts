// Applies Tool Search overlays on top of the selected runtime config.
import type { ModelSizeClass } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  applyAgentProfileToolSearchDefaults,
  type ResolvedAgentProfile,
} from "./agent-profiles.js";
import { resolveAgentRuntimeToolConfig } from "./tool-runtime-config.js";

const TOOL_SEARCH_DEFAULTS = {
  enabled: true,
  mode: "tools",
  searchDefaultLimit: 5,
  maxSearchLimit: 10,
} as const;

export function resolveAgentToolSearchRuntimeConfig(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: ModelSizeClass;
  resolvedProfile?: ResolvedAgentProfile;
  model?: { toolSearchMode?: "tools" | false };
  completionPrivateMessageOnly?: boolean;
}): OpenClawConfig | undefined {
  // Select before overlay cloning; cloning source config first loses snapshot identity and can
  // reintroduce unresolved SecretRefs into plugin tool factories.
  const runtimeConfig = resolveAgentRuntimeToolConfig(params.config);
  if (params.completionPrivateMessageOnly) {
    return runtimeConfig;
  }
  const profileConfig = applyAgentProfileToolSearchDefaults({
    config: runtimeConfig,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelSizeClass: params.modelSizeClass,
    resolvedProfile: params.resolvedProfile,
  });
  if (
    !profileConfig ||
    profileConfig !== runtimeConfig ||
    profileConfig.tools?.toolSearch !== undefined ||
    params.model?.toolSearchMode !== "tools"
  ) {
    return profileConfig;
  }
  return {
    ...profileConfig,
    tools: {
      ...profileConfig.tools,
      toolSearch: TOOL_SEARCH_DEFAULTS,
    },
  };
}
