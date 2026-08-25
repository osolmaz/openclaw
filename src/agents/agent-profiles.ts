/** Built-in Agent Profile registry, selection, and OpenClaw tool behavior. */
import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import { messageToolOwnsVisibleReply } from "../auto-reply/source-reply-delivery-mode.js";
import type { AgentProfileId, AgentProfileSelector } from "../config/agent-profile-ids.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { resolveAgentConfig } from "./agent-scope-config.js";
import { resolveSessionAgentIds } from "./agent-scope.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { compileGlobPatterns, matchesAnyGlobPattern } from "./glob-pattern.js";
import { expandToolGroups, normalizeToolPolicyName } from "./tool-policy.js";
import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";

export type AgentProfileModelSizeClass = "tiny" | "small" | "medium" | "large";
export type AgentProfileSelectionSource =
  | "agent-explicit"
  | "defaults-explicit"
  | "model"
  | "model-size"
  | "fallback";

type AgentProfileThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type AgentProfileSystemPrompt = { text: string } | { file: { path: string } };
type BuiltInAgentProfile = {
  id: AgentProfileId;
  extends?: AgentProfileId;
  spec: {
    common: {
      systemPrompt?: AgentProfileSystemPrompt;
      thinkingLevel?: AgentProfileThinkingLevel;
    };
    "openclaw.ai"?: {
      toolProfile?: "lean";
    };
  };
};
type ResolvedBuiltInAgentProfile = Omit<BuiltInAgentProfile, "extends"> & {
  ancestry: readonly AgentProfileId[];
};
type AgentProfileBinding =
  | {
      selector: { providerId: string; modelId: string };
      profileId: AgentProfileId;
    }
  | {
      selector: { modelSizeClass: AgentProfileModelSizeClass };
      profileId: AgentProfileId;
    };

export type ResolvedAgentProfile = {
  profile: ResolvedBuiltInAgentProfile;
  selectionSource: AgentProfileSelectionSource;
};

const BUILT_IN_AGENT_PROFILES: readonly BuiltInAgentProfile[] = [
  {
    id: "openclaw/base",
    spec: { common: {} },
  },
  {
    id: "openclaw/small",
    extends: "openclaw/base",
    spec: { common: {}, "openclaw.ai": { toolProfile: "lean" } },
  },
  {
    id: "openclaw/medium",
    extends: "openclaw/base",
    spec: { common: {} },
  },
  {
    id: "openclaw/large",
    extends: "openclaw/base",
    spec: { common: {} },
  },
];

const BUILT_IN_AGENT_PROFILE_BINDINGS = [
  {
    selector: { providerId: "llama-cpp", modelId: "qwen3.6-35b-a3b" },
    profileId: "openclaw/small",
  },
  { selector: { modelSizeClass: "tiny" }, profileId: "openclaw/small" },
  { selector: { modelSizeClass: "small" }, profileId: "openclaw/small" },
  { selector: { modelSizeClass: "medium" }, profileId: "openclaw/medium" },
  { selector: { modelSizeClass: "large" }, profileId: "openclaw/large" },
] as const satisfies readonly AgentProfileBinding[];

const LEAN_TOOL_DENY_NAMES = new Set([
  "browser",
  AUTOMATIONS_TOOL_NAME,
  "image_generate",
  "message",
  "music_generate",
  "pdf",
  "tts",
  "video_generate",
]);
const LEAN_TOOL_SEARCH_DEFAULTS = {
  enabled: true,
  mode: "tools",
  searchDefaultLimit: 5,
  maxSearchLimit: 10,
} as const;

const profilesById = new Map(
  BUILT_IN_AGENT_PROFILES.map((profile) => [profile.id, profile] as const),
);
const resolvedProfilesById = new Map<AgentProfileId, ResolvedBuiltInAgentProfile>();

function resolveBuiltInProfile(
  profileId: AgentProfileId,
  ancestry: readonly AgentProfileId[] = [],
): ResolvedBuiltInAgentProfile {
  const cached = resolvedProfilesById.get(profileId);
  if (cached) {
    return cached;
  }
  if (ancestry.includes(profileId)) {
    throw new Error(`Agent Profile inheritance cycle: ${[...ancestry, profileId].join(" -> ")}`);
  }
  const profile = profilesById.get(profileId);
  if (!profile) {
    throw new Error(`Unknown built-in Agent Profile: ${profileId}`);
  }
  const parent = profile.extends
    ? resolveBuiltInProfile(profile.extends, [...ancestry, profileId])
    : undefined;
  const openClawSpec =
    parent?.spec["openclaw.ai"] || profile.spec["openclaw.ai"]
      ? {
          ...parent?.spec["openclaw.ai"],
          ...profile.spec["openclaw.ai"],
        }
      : undefined;
  const resolved: ResolvedBuiltInAgentProfile = {
    id: profile.id,
    ancestry: [...(parent?.ancestry ?? []), profile.id],
    spec: {
      common: { ...parent?.spec.common, ...profile.spec.common },
      ...(openClawSpec ? { "openclaw.ai": openClawSpec } : {}),
    },
  };
  resolvedProfilesById.set(profileId, resolved);
  return resolved;
}

function resolveProfileAgentId(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
}): string | undefined {
  const explicitAgentId =
    typeof params.agentId === "string" && params.agentId.trim()
      ? normalizeAgentId(params.agentId)
      : undefined;
  if (params.config) {
    return resolveSessionAgentIds({
      config: params.config,
      agentId: explicitAgentId,
      sessionKey: params.sessionKey,
    }).sessionAgentId;
  }
  const parsedSessionAgentId = parseAgentSessionKey(params.sessionKey)?.agentId;
  return (
    explicitAgentId ?? (parsedSessionAgentId ? normalizeAgentId(parsedSessionAgentId) : undefined)
  );
}

function resolveConfiguredSelector(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
}): { selector: AgentProfileSelector; source?: AgentProfileSelectionSource } {
  const agentId = resolveProfileAgentId(params);
  const agentSelector =
    params.config && agentId
      ? resolveAgentConfig(params.config, agentId)?.agentProfileId
      : undefined;
  if (agentSelector) {
    return {
      selector: agentSelector,
      source: agentSelector === "auto" ? undefined : "agent-explicit",
    };
  }
  const defaultsSelector = params.config?.agents?.defaults?.agentProfileId;
  return {
    selector: defaultsSelector ?? "auto",
    source: defaultsSelector && defaultsSelector !== "auto" ? "defaults-explicit" : undefined,
  };
}

function resolveAutomaticBinding(params: {
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: AgentProfileModelSizeClass;
}): { profileId: AgentProfileId; source: AgentProfileSelectionSource } {
  const providerId = params.modelProvider ? normalizeProviderId(params.modelProvider) : undefined;
  const modelId = params.modelId?.trim().toLowerCase();
  const modelBinding = BUILT_IN_AGENT_PROFILE_BINDINGS.find(
    (binding) =>
      "modelId" in binding.selector &&
      binding.selector.providerId === providerId &&
      binding.selector.modelId === modelId,
  );
  if (modelBinding) {
    return { profileId: modelBinding.profileId, source: "model" };
  }
  const sizeBinding = BUILT_IN_AGENT_PROFILE_BINDINGS.find(
    (binding) =>
      "modelSizeClass" in binding.selector &&
      binding.selector.modelSizeClass === params.modelSizeClass,
  );
  if (sizeBinding) {
    return { profileId: sizeBinding.profileId, source: "model-size" };
  }
  return { profileId: "openclaw/base", source: "fallback" };
}

export function resolveAgentProfile(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: AgentProfileModelSizeClass;
}): ResolvedAgentProfile {
  const configured = resolveConfiguredSelector(params);
  if (configured.selector !== "auto") {
    return {
      profile: resolveBuiltInProfile(configured.selector),
      selectionSource: configured.source ?? "defaults-explicit",
    };
  }
  const automatic = resolveAutomaticBinding(params);
  return {
    profile: resolveBuiltInProfile(automatic.profileId),
    selectionSource: automatic.source,
  };
}

function resolvePreservedToolNames(names?: Iterable<string>) {
  if (!names) {
    return [];
  }
  return compileGlobPatterns({
    raw: expandToolGroups([...names]).filter((name) => normalizeToolPolicyName(name) !== "*"),
    normalize: normalizeToolPolicyName,
  });
}

export function resolveAgentProfilePreserveToolNames(params?: {
  toolNames?: Iterable<string>;
  forceMessageTool?: boolean;
  sourceReplyDeliveryMode?: string;
}): string[] {
  const names = [...(params?.toolNames ?? [])];
  if (params && messageToolOwnsVisibleReply(params)) {
    names.push("message");
  }
  return [...new Set(names)];
}

export function filterToolsByAgentProfile(params: {
  tools: AnyAgentTool[];
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: AgentProfileModelSizeClass;
  resolvedProfile?: ResolvedAgentProfile;
  preserveToolNames?: Iterable<string>;
}): AnyAgentTool[] {
  const resolved = params.resolvedProfile ?? resolveAgentProfile(params);
  if (resolved.profile.spec["openclaw.ai"]?.toolProfile !== "lean") {
    return params.tools;
  }
  const preservedToolNames = resolvePreservedToolNames(params.preserveToolNames);
  return params.tools.filter((tool) => {
    const normalizedName = normalizeToolPolicyName(tool.name);
    return (
      matchesAnyGlobPattern(normalizedName, preservedToolNames) ||
      !LEAN_TOOL_DENY_NAMES.has(normalizedName)
    );
  });
}

export function applyAgentProfileToolSearchDefaults(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  modelProvider?: string;
  modelId?: string;
  modelSizeClass?: AgentProfileModelSizeClass;
  resolvedProfile?: ResolvedAgentProfile;
}): OpenClawConfig | undefined {
  if (!params.config) {
    return params.config;
  }
  const resolved = params.resolvedProfile ?? resolveAgentProfile(params);
  if (resolved.profile.spec["openclaw.ai"]?.toolProfile !== "lean") {
    return params.config;
  }
  if (params.config.tools?.toolSearch !== undefined) {
    return params.config;
  }
  return {
    ...params.config,
    tools: {
      ...params.config.tools,
      toolSearch: LEAN_TOOL_SEARCH_DEFAULTS,
    },
  };
}
