import type { AgentToolSurfacePresentation } from "../../../packages/gateway-protocol/src/schema/worker-gateway-tool.js";
import { messageToolOwnsVisibleReply } from "../../auto-reply/source-reply-delivery-mode.js";
import {
  buildAgentProfileSystemPrompt,
  filterToolsByAgentProfile,
  resolveAgentProfile,
  resolveAgentProfilePreserveToolNames,
  type ResolvedAgentProfile,
} from "../agent-profiles.js";
import { finalizeAgentToolAvailability } from "../agent-tool-availability.js";
import type { HookContext } from "../agent-tools.before-tool-call.js";
import {
  CODE_MODE_EXEC_TOOL_NAME,
  CODE_MODE_WAIT_TOOL_NAME,
  createCodeModeTools,
} from "../code-mode.js";
import type { ModelSizeClass } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveConversationCapabilityProfile } from "../conversation-capability-profile.js";
import { mergeForcedEmbeddedAttemptToolsAllow } from "../embedded-agent-runner/run/attempt-tool-construction-plan.js";
import {
  filterLocalModelLeanTools,
  resolveLocalModelLeanPreserveToolNames,
} from "../local-model-lean.js";
import type { ScheduledToolPolicyContext } from "../scheduled-tool-policy.js";
import { filterRuntimeCompatibleTools } from "../tool-schema-projection.js";
import { TOOL_SEARCH_CONTROL_TOOL_NAMES } from "../tool-search-types.js";
import {
  clearToolSearchCatalog,
  createToolSearchCatalogRef,
  createToolSearchTools,
  type ToolSearchCatalogToolExecutor,
} from "../tool-search.js";
import {
  applyAgentToolSurfaceCatalog,
  resolveAgentToolSurfacePlan,
  type AgentToolSurfacePlanParams,
} from "../tool-surface-plan.js";
import type { AnyAgentTool } from "../tools/common.js";
import { createAgentHarnessPromptToolPolicy } from "./prompt-tool-policy.js";

const CODE_MODE_CONTROL_ALLOWLIST_NAMES = [CODE_MODE_EXEC_TOOL_NAME, CODE_MODE_WAIT_TOOL_NAME];

type PreparedToolSurface = Pick<
  Parameters<typeof createCodeModeTools>[0],
  "abortSignal" | "executeTool" | "forceRestartSafeTools" | "toolExecutionAllow" | "codeModeSkills"
> & { preserveToolNames: Iterable<string> };

export function createAgentHarnessToolSurfaceRuntimeCore(
  input: Omit<
    AgentToolSurfacePlanParams,
    "forceDirectMessageTool" | "toolsEnabled" | "isRawModelRun"
  > & {
    abortSignal?: AbortSignal;
    executeTool?: ToolSearchCatalogToolExecutor;
    presentation?: AgentToolSurfacePresentation;
    forceMessageTool?: boolean;
    isRawModelRun?: boolean;
    model?: { contextWindow?: number };
    contextTokenBudget?: number;
    modelToolsEnabled: boolean;
    /** False when the harness cannot dispatch an unregistered catalog name directly. */
    supportsDeferredToolCalls?: boolean;
    prompt?: string;
    runId?: string;
    runtimeToolAllowlist?: readonly string[];
    sessionId?: string;
    scheduledToolPolicy?: ScheduledToolPolicyContext;
    sourceReplyDeliveryMode?: string;
  },
) {
  const presentation = input.presentation;
  const params = presentation
    ? {
        ...input,
        config: { tools: { codeMode: presentation.codeMode, toolSearch: presentation.toolSearch } },
      }
    : input;
  const forceDirectMessageTool =
    presentation?.forceDirectMessageTool ?? messageToolOwnsVisibleReply(params);
  const agentProfile = resolveAgentProfile({
    config: params.config,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelSizeClass: params.model?.modelSizeClass,
  });
  const plan = presentation
    ? {
        codeModeControlsEnabled: presentation.codeMode.enabled,
        toolSearchControlsEnabled: presentation.toolSearch.enabled,
        toolSearchConfig: presentation.toolSearch,
        toolSearchRuntimeConfig: params.config,
      }
    : resolveAgentToolSurfacePlan({
        ...params,
        resolvedProfile: agentProfile,
        forceDirectMessageTool,
        toolsEnabled: params.modelToolsEnabled,
        isRawModelRun: params.isRawModelRun === true,
      });
  if (params.supportsDeferredToolCalls === false && plan.toolSearchConfig.mode === "directory") {
    plan.toolSearchConfig = { ...plan.toolSearchConfig, mode: "tools" };
    plan.toolSearchRuntimeConfig = {
      ...plan.toolSearchRuntimeConfig,
      tools: {
        ...plan.toolSearchRuntimeConfig?.tools,
        toolSearch: plan.toolSearchConfig,
      },
    };
  }
  const {
    codeModeControlsEnabled,
    toolSearchControlsEnabled,
    toolSearchConfig,
    toolSearchRuntimeConfig,
  } = plan;
  const toolSearchCatalogRef =
    toolSearchControlsEnabled || codeModeControlsEnabled ? createToolSearchCatalogRef() : undefined;
  const runtimeToolAllowlist = mergeForcedEmbeddedAttemptToolsAllow(params.runtimeToolAllowlist, {
    forceToolNames: [
      ...(toolSearchControlsEnabled ? TOOL_SEARCH_CONTROL_TOOL_NAMES : []),
      ...(codeModeControlsEnabled ? CODE_MODE_CONTROL_ALLOWLIST_NAMES : []),
    ],
  });
  const toolSearchCatalogExecutor =
    toolSearchControlsEnabled || codeModeControlsEnabled ? params.executeTool : undefined;
  const capabilityProfile = resolveConversationCapabilityProfile({
    config: params.config,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    runtimeToolAllowlist,
    scheduledToolPolicy: params.scheduledToolPolicy,
  });
  const agentProfilePreserveToolNames = resolveAgentProfilePreserveToolNames({
    toolNames: capabilityProfile.policy.explicitToolOverrideAllowlist,
    forceMessageTool: params.forceMessageTool,
    sourceReplyDeliveryMode: params.sourceReplyDeliveryMode,
  });
  let runtimePreserveToolNames: string[] | undefined;
  const preserveRuntimeTools = () =>
    (runtimePreserveToolNames ??= resolveLocalModelLeanPreserveToolNames({
      toolNames: capabilityProfile.policy.explicitToolOverrideAllowlist,
      forceMessageTool: params.forceMessageTool,
      sourceReplyDeliveryMode: params.sourceReplyDeliveryMode,
    }));
  const compactTools = (
    tools: AnyAgentTool[],
    options: {
      hookContext?: HookContext;
      agentProfileApplied?: boolean;
      localModelLeanApplied?: boolean;
      prepared?: PreparedToolSurface;
    } = {},
  ) => {
    const prepared = options.prepared;
    const preserveToolNames =
      prepared?.preserveToolNames ??
      (options.localModelLeanApplied ? undefined : preserveRuntimeTools());
    // Native harness callers may supply raw tools, while the bundled tool constructor
    // already applied the full prepared policy and must not be filtered a second time.
    const projectedProfileTools = options.agentProfileApplied
      ? tools
      : filterToolsByAgentProfile({
          tools,
          config: params.config,
          agentId: params.agentId,
          sessionKey: params.sessionKey,
          modelProvider: params.modelProvider,
          modelId: params.modelId,
          resolvedProfile: agentProfile,
          preserveToolNames: agentProfilePreserveToolNames,
        });
    // Core already projected bundle/client tools. Its newly added controls still
    // need the final lean pass; native constructors may have applied both passes.
    const projectedUncompactedTools =
      prepared || options.localModelLeanApplied
        ? projectedProfileTools
        : filterLocalModelLeanTools({
            ...params,
            tools: projectedProfileTools,
            preserveToolNames,
          });
    let effectiveTools = prepared
      ? projectedUncompactedTools
      : filterRuntimeCompatibleTools(projectedUncompactedTools).tools;
    const codeModeSkills = prepared?.codeModeSkills ?? presentation?.skills;
    const createControls = codeModeControlsEnabled
      ? createCodeModeTools
      : toolSearchControlsEnabled &&
          !effectiveTools.some((tool) => TOOL_SEARCH_CONTROL_TOOL_NAMES.has(tool.name))
        ? createToolSearchTools
        : undefined;
    const controls = createControls
      ? createControls({
          ...params,
          runtimeConfig: codeModeControlsEnabled ? params.config : toolSearchRuntimeConfig,
          modelContextWindowTokens: params.contextTokenBudget ?? params.model?.contextWindow,
          catalogRef: toolSearchCatalogRef,
          abortSignal: prepared?.abortSignal ?? params.abortSignal,
          executeTool: prepared?.executeTool ?? params.executeTool,
          forceRestartSafeTools: prepared?.forceRestartSafeTools,
          toolExecutionAllow: prepared?.toolExecutionAllow,
          codeModeSkills,
        })
      : [];
    const compacted = applyAgentToolSurfaceCatalog({
      ...params,
      tools: [...controls, ...effectiveTools],
      toolSearchRuntimeConfig,
      codeModeControlsEnabled,
      toolSearchConfig,
      forceDirectMessageTool,
      catalogRef: toolSearchCatalogRef,
      toolHookContext: options.hookContext,
      toolExecutionAllow: prepared?.toolExecutionAllow,
      codeModeSkills,
    });
    const projectedProfileCompactedTools = options.agentProfileApplied
      ? compacted.tools
      : filterToolsByAgentProfile({
          tools: compacted.tools,
          config: params.config,
          agentId: params.agentId,
          sessionKey: params.sessionKey,
          modelProvider: params.modelProvider,
          modelId: params.modelId,
          resolvedProfile: agentProfile,
          preserveToolNames: agentProfilePreserveToolNames,
        });
    const projectedCompactedTools =
      !prepared && options.localModelLeanApplied
        ? projectedProfileCompactedTools
        : filterLocalModelLeanTools({
            ...params,
            tools: projectedProfileCompactedTools,
            sessionKey: prepared ? undefined : params.sessionKey,
            preserveToolNames,
          });
    const schemaProjection = filterRuntimeCompatibleTools(projectedCompactedTools);
    effectiveTools = schemaProjection.tools;
    if (!compacted.catalogRegistered) {
      finalizeAgentToolAvailability(effectiveTools, {
        toolExecutionAllow: prepared?.toolExecutionAllow,
      });
    }
    return {
      tools: effectiveTools,
      catalog: compacted,
      projectedTools: projectedCompactedTools,
      diagnostics: schemaProjection.diagnostics,
      promptToolPolicy: createAgentHarnessPromptToolPolicy({
        tools: effectiveTools,
        catalogRef: toolSearchCatalogRef,
        codeModeControlsEnabled,
        toolSearchPrompt: toolSearchControlsEnabled
          ? {
              config: toolSearchRuntimeConfig,
              contextTokenBudget: params.contextTokenBudget ?? params.model?.contextWindow,
            }
          : undefined,
      }),
    };
  };
  return {
    plan,
    agentProfile,
    buildAgentProfileSystemPrompt: (promptParams: {
      sourceReplyDeliveryMode?: string;
      toolNames: Iterable<string>;
      runtimeSystemPrompt?: string;
    }) =>
      buildAgentProfileSystemPrompt({
        resolvedProfile: agentProfile,
        ...promptParams,
      }),
    codeModeControlsEnabled,
    compactTools,
    config: toolSearchControlsEnabled ? toolSearchRuntimeConfig : params.config,
    includeToolSearchControls: toolSearchControlsEnabled,
    runtimeToolAllowlist,
    toolSearchCatalogRef,
    toolSearchControlsEnabled,
    cleanup: () => clearToolSearchCatalog({ catalogRef: toolSearchCatalogRef }),
    toolSearchCatalogExecutor,
  };
}
