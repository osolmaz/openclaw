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

export const SMALL_AGENT_TOOL_SEARCH_GUIDANCE =
  "When available, use tool_search to find a deferred tool, tool_describe when its arguments are unclear, and tool_call to invoke it.";

const SMALL_AGENT_SYSTEM_PROMPT = `You are a personal assistant running inside OpenClaw.
Follow the user's request. Be direct and concise. Use tools when needed, and do not claim success until a tool result confirms it.
Tool availability and policy are authoritative. ${SMALL_AGENT_TOOL_SEARCH_GUIDANCE}
Before changing files, read the applicable AGENTS.md instructions. Read other workspace files only when needed.
Keep credentials and private data secret. Ask before destructive, irreversible, costly, or externally visible actions unless the user clearly authorized them.`;

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
      common: {
        systemPrompt: { text: SMALL_AGENT_SYSTEM_PROMPT },
      },
      "openclaw.ai": {
        contextSerialization: "lean",
        toolProfile: "lean",
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
