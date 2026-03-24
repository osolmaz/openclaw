import {
  extractAssistantText,
  runSimpleCompletionForAgent,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";

const DEFAULT_THREAD_TITLE_TIMEOUT_MS = 10_000;
const MAX_THREAD_TITLE_SOURCE_CHARS = 600;
const MAX_THREAD_TITLE_CHANNEL_NAME_CHARS = 120;
const MAX_THREAD_TITLE_CHANNEL_DESCRIPTION_CHARS = 320;
const DISCORD_THREAD_TITLE_MAX_TOKENS = 24;
const DISCORD_THREAD_TITLE_TEMPERATURE = 0.2;
const DISCORD_THREAD_TITLE_SYSTEM_PROMPT =
  "Generate a concise Discord thread title (3-6 words). Return only the title. Use channel context when provided and avoid redundant channel-name words unless needed for clarity.";

export async function generateThreadTitle(params: {
  cfg: OpenClawConfig;
  agentId: string;
  messageText: string;
  modelRef?: string;
  channelName?: string;
  channelDescription?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const sourceText = params.messageText.trim();
  if (!sourceText) {
    return null;
  }

  const promptText = truncateThreadTitleSourceText(sourceText);
  const userMessage = buildThreadTitleUserMessage({
    sourceText: promptText,
    channelName: params.channelName,
    channelDescription: params.channelDescription,
  });
  const timeoutMs = resolveThreadTitleTimeoutMs(params.timeoutMs);
  const result = await completeThreadTitle({
    cfg: params.cfg,
    agentId: params.agentId,
    modelRef: params.modelRef,
    userMessage,
    timeoutMs,
  });
  if ("error" in result) {
    const modelLabel = result.selection
      ? `${result.selection.provider}/${result.selection.modelId}`
      : "unknown";
    logVerbose(`thread-title: ${result.error} (agent=${params.agentId}, model=${modelLabel})`);
    return null;
  }

  const assistantText = extractAssistantText(result.response);
  const generated = normalizeGeneratedThreadTitle(assistantText);
  if (generated) {
    return generated;
  }

  const responseFailure = summarizeThreadTitleFailure(result.response);
  if (responseFailure) {
    const modelLabel = `${result.selection.provider}/${result.selection.modelId}`;
    logVerbose(
      `thread-title: empty title response for agent ${params.agentId} (model=${modelLabel}, ${responseFailure})`,
    );
  }
  return null;
}

async function completeThreadTitle(params: {
  cfg: OpenClawConfig;
  agentId: string;
  modelRef?: string;
  userMessage: string;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    return await runSimpleCompletionForAgent({
      cfg: params.cfg,
      agentId: params.agentId,
      ...(params.modelRef ? { modelRef: params.modelRef } : {}),
      allowMissingApiKeyModes: ["aws-sdk"],
      context: {
        systemPrompt: DISCORD_THREAD_TITLE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: params.userMessage,
            timestamp: Date.now(),
          },
        ],
      },
      options: {
        maxTokens: DISCORD_THREAD_TITLE_MAX_TOKENS,
        temperature: DISCORD_THREAD_TITLE_TEMPERATURE,
        signal: controller.signal,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function summarizeThreadTitleFailure(response: {
  stopReason?: unknown;
  errorMessage?: unknown;
}): string | null {
  const stopReason = typeof response.stopReason === "string" ? response.stopReason.trim() : "";
  const errorMessage =
    typeof response.errorMessage === "string" ? response.errorMessage.trim() : "";
  if (stopReason === "error" && errorMessage) {
    return `stopReason=error error=${errorMessage}`;
  }
  if (stopReason) {
    return `stopReason=${stopReason}`;
  }
  if (errorMessage) {
    return `error=${errorMessage}`;
  }
  return null;
}

function buildThreadTitleUserMessage(params: {
  sourceText: string;
  channelName?: string;
  channelDescription?: string;
}): string {
  const channelName = normalizeTitleContextField(
    params.channelName,
    MAX_THREAD_TITLE_CHANNEL_NAME_CHARS,
  );
  const channelDescription = normalizeTitleContextField(
    params.channelDescription,
    MAX_THREAD_TITLE_CHANNEL_DESCRIPTION_CHARS,
  );
  const messageLines: string[] = [];
  if (channelName) {
    messageLines.push(`Channel: ${channelName}`);
  }
  if (channelDescription) {
    messageLines.push(`Channel description: ${channelDescription}`);
  }
  messageLines.push(`Message:\n${params.sourceText}`);
  return messageLines.join("\n\n");
}

function truncateThreadTitleSourceText(sourceText: string): string {
  if (sourceText.length <= MAX_THREAD_TITLE_SOURCE_CHARS) {
    return sourceText;
  }
  return `${sourceText.slice(0, MAX_THREAD_TITLE_SOURCE_CHARS)}...`;
}

function resolveThreadTitleTimeoutMs(timeoutMs: number | undefined): number {
  return Math.max(100, Math.floor(timeoutMs ?? DEFAULT_THREAD_TITLE_TIMEOUT_MS));
}

export function normalizeGeneratedThreadTitle(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  let firstLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!firstLine && trimmed.startsWith("```")) {
      continue;
    }
    firstLine = trimmed;
    break;
  }
  return stripThreadTitleWrappers(firstLine);
}

function stripThreadTitleWrappers(raw: string): string {
  let current = raw.trim();
  let previous = "";
  while (current && current !== previous) {
    previous = current;
    current = current.replace(/^["'`]+|["'`]+$/g, "").trim();
    current = current.replace(/^\*\*(.+)\*\*$/u, "$1").trim();
    current = current.replace(/^__(.+)__$/u, "$1").trim();
    current = current.replace(/^\*(.+)\*$/u, "$1").trim();
    current = current.replace(/^_(.+)_$/u, "$1").trim();
    current = current.replace(/^~~(.+)~~$/u, "$1").trim();
  }
  return current;
}

function normalizeTitleContextField(raw: string | undefined, maxChars: number): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const singleLine = value.replace(/\s+/g, " ");
  if (singleLine.length <= maxChars) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxChars)}...`;
}
