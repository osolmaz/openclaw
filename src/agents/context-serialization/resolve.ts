import type { ContextSerialization } from "../../config/context-serialization.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { ResolvedAgentProfile } from "../agent-profiles.js";
import { resolveAgentConfig } from "../agent-scope-config.js";

export type ContextSerializationSource =
  | "agent-explicit"
  | "defaults-explicit"
  | "agent-profile"
  | "fallback";

export type ResolvedContextSerialization = {
  mode: ContextSerialization;
  source: ContextSerializationSource;
};

/** Resolves one context serialization mode for the complete model turn. */
export function resolveContextSerialization(params: {
  config?: OpenClawConfig;
  agentId: string;
  resolvedProfile: ResolvedAgentProfile;
}): ResolvedContextSerialization {
  const agentMode = params.config
    ? resolveAgentConfig(params.config, params.agentId)?.contextSerialization
    : undefined;
  if (agentMode !== undefined) {
    return { mode: agentMode, source: "agent-explicit" };
  }

  const defaultMode = params.config?.agents?.defaults?.contextSerialization;
  if (defaultMode !== undefined) {
    return { mode: defaultMode, source: "defaults-explicit" };
  }

  const profileMode = params.resolvedProfile.profile.spec.common.contextSerialization;
  if (profileMode !== undefined) {
    return { mode: profileMode, source: "agent-profile" };
  }

  return { mode: "default", source: "fallback" };
}
