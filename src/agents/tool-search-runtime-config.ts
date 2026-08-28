// Applies Tool Search overlays on top of the selected runtime config.
import type { ModelSizeClass } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  applyAgentProfileToolSearchDefaults,
  type ResolvedAgentProfile,
} from "./agent-profiles.js";
import { resolveAgentRuntimeToolConfig } from "./tool-runtime-config.js";

export function resolveAgentToolSearchRuntimeConfig(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: ModelSizeClass;
  resolvedProfile?: ResolvedAgentProfile;
  forceDirectMessageTool?: boolean;
}): OpenClawConfig | undefined {
  // Select before overlay cloning; cloning source config first loses snapshot identity and can
  // reintroduce unresolved SecretRefs into plugin tool factories.
  const runtimeConfig = resolveAgentRuntimeToolConfig(params.config);
  if (params.forceDirectMessageTool) {
    return runtimeConfig;
  }
  return applyAgentProfileToolSearchDefaults({
    config: runtimeConfig,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelSizeClass: params.modelSizeClass,
    resolvedProfile: params.resolvedProfile,
  });
}
