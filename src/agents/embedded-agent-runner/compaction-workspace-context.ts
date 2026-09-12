/**
 * Resolves the workspace files a direct compaction request sends to the model.
 *
 * The same Agent Profile workspace-context budget that bounds a live turn also
 * bounds this prompt, so a small-profile session cannot exceed its cap merely
 * because its transcript needed compaction.
 */
import type { ChatType } from "../../channels/chat-type.js";
import type { ModelSizeClass } from "../../config/types.models.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveAgentProfile } from "../agent-profiles.js";
import { prepareAgentProfileWorkspaceContext } from "../agent-profiles/workspace-context.js";
import { resolveBootstrapContextForRun } from "../bootstrap-files.js";
import type { EmbeddedContextFile } from "../embedded-agent-helpers.js";

export async function resolveCompactionContextFiles(params: {
  config?: OpenClawConfig;
  agentId: string;
  sessionKey?: string;
  sessionId: string;
  chatType?: ChatType;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  modelSizeClass?: ModelSizeClass;
  warn?: (message: string) => void;
}): Promise<EmbeddedContextFile[]> {
  const resolvedBootstrap = await resolveBootstrapContextForRun({
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    chatType: params.chatType,
    agentId: params.agentId,
    warn: params.warn,
  });
  const resolvedProfile = resolveAgentProfile({
    config: params.config,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.provider,
    modelId: params.modelId,
    modelSizeClass: params.modelSizeClass,
  });
  const profileContext = await prepareAgentProfileWorkspaceContext({
    resolvedProfile,
    bootstrapFiles: resolvedBootstrap.bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    agentId: params.agentId,
    warn: params.warn,
  });
  return profileContext?.contextFiles ?? resolvedBootstrap.contextFiles;
}
