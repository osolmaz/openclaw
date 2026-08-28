/** OpenClaw behavior applied from resolved Agent Profiles. */
import { messageToolOwnsVisibleReply } from "../auto-reply/source-reply-delivery-mode.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import type { ModelSizeClass } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { SMALL_AGENT_TOOL_SEARCH_GUIDANCE } from "./agent-profiles/builtins.js";
import { resolveAgentProfile, type ResolvedAgentProfile } from "./agent-profiles/resolve.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { compileGlobPatterns, matchesAnyGlobPattern } from "./glob-pattern.js";
import { expandToolGroups, normalizeToolPolicyName } from "./tool-policy.js";
import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";

export { resolveAgentProfile };
export type { ResolvedAgentProfile };

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
const TOOL_SEARCH_PROMPT_TOOL_NAMES = ["tool_search", "tool_describe", "tool_call"] as const;
const LEAN_TOOL_SEARCH_DEFAULTS = {
  enabled: true,
  mode: "tools",
  searchDefaultLimit: 5,
  maxSearchLimit: 10,
} as const;

export function buildAgentProfileSystemPrompt(params: {
  resolvedProfile: ResolvedAgentProfile;
  sourceReplyDeliveryMode?: string;
  toolNames: Iterable<string>;
  runtimeSystemPrompt?: string;
}): string | undefined {
  const source = params.resolvedProfile.profile.spec.common.systemPrompt;
  if (!source) {
    return undefined;
  }
  if (!("text" in source)) {
    throw new Error(
      `Built-in Agent Profile ${params.resolvedProfile.profile.id} must use an inline system prompt`,
    );
  }
  const toolNames = new Set(params.toolNames);
  const messageToolAvailable = toolNames.has("message");
  const toolSearchAvailable = TOOL_SEARCH_PROMPT_TOOL_NAMES.every((name) => toolNames.has(name));
  const sourceText = toolSearchAvailable
    ? source.text.trim()
    : source.text.replace(` ${SMALL_AGENT_TOOL_SEARCH_GUIDANCE}`, "").trim();
  const deliveryInstruction =
    params.sourceReplyDeliveryMode === "message_tool_only" && messageToolAvailable
      ? `Send the visible reply with the message tool. After it succeeds, return exactly ${SILENT_REPLY_TOKEN}.`
      : messageToolAvailable
        ? "Return the visible reply as assistant text. Use the message tool only when the user asks you to send to another target."
        : "Return the visible reply as assistant text.";
  return [sourceText, deliveryInstruction, params.runtimeSystemPrompt?.trim()]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
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
  modelSizeClass?: ModelSizeClass;
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
  modelSizeClass?: ModelSizeClass;
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
