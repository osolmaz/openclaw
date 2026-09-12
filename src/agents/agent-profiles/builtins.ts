import { validateAgentProfile, type AgentProfileResource } from "agentprofiles";
import type { AgentProfileId } from "../../config/agent-profile-ids.js";
import type { ModelSizeClass } from "../../config/types.models.js";

export type BuiltInAgentProfile = {
  id: AgentProfileId;
  resource: AgentProfileResource;
};

export type BuiltInAgentProfileBinding =
  | {
      selector: { providerId: string; modelId: string };
      profileId: AgentProfileId;
    }
  | {
      selector: { modelSizeClass: ModelSizeClass };
      profileId: AgentProfileId;
    };

function defineBuiltInAgentProfile(id: AgentProfileId, value: unknown): BuiltInAgentProfile {
  const resource = validateAgentProfile(value);
  const resourceId = `${resource.metadata.namespace}/${resource.metadata.name}`;
  if (resourceId !== id) {
    throw new Error(`Built-in Agent Profile id mismatch: expected ${id}, got ${resourceId}`);
  }
  return { id, resource };
}

export const BUILT_IN_AGENT_PROFILES: readonly BuiltInAgentProfile[] = [
  defineBuiltInAgentProfile("openclaw/base", {
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "openclaw", name: "base" },
    spec: { common: {} },
  }),
  defineBuiltInAgentProfile("openclaw/small", {
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "openclaw", name: "small" },
    extends: "openclaw/base",
    spec: {
      common: {},
      "openclaw.ai": {
        contextSerialization: "lean",
        toolProfile: "lean",
        prompt: {
          workspaceContext: {
            totalMaxChars: 8_000,
            sections: {
              agents: { maxChars: 4_000, overflow: "truncate" },
              soul: { maxChars: 2_000, overflow: "truncate" },
              identity: { maxChars: 1_024, overflow: "error" },
              user: { maxChars: 2_000, overflow: "truncate" },
            },
            additional: {
              maxCharsPerFile: 1_000,
              totalMaxChars: 2_000,
              overflow: "truncate",
              files: [],
            },
          },
        },
      },
    },
  }),
  defineBuiltInAgentProfile("openclaw/medium", {
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "openclaw", name: "medium" },
    extends: "openclaw/base",
    spec: { common: {} },
  }),
  defineBuiltInAgentProfile("openclaw/large", {
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "openclaw", name: "large" },
    extends: "openclaw/base",
    spec: { common: {} },
  }),
];

export const BUILT_IN_AGENT_PROFILE_BINDINGS = [
  {
    selector: { providerId: "llama-cpp", modelId: "qwen3.6-35b-a3b" },
    profileId: "openclaw/small",
  },
  { selector: { modelSizeClass: "tiny" }, profileId: "openclaw/small" },
  { selector: { modelSizeClass: "small" }, profileId: "openclaw/small" },
  { selector: { modelSizeClass: "medium" }, profileId: "openclaw/medium" },
  { selector: { modelSizeClass: "large" }, profileId: "openclaw/large" },
] as const satisfies readonly BuiltInAgentProfileBinding[];
