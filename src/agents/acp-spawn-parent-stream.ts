import { onAgentEvent } from "../infra/agent-events.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { scopedHeartbeatWakeOptions } from "../routing/session-key.js";

const DEFAULT_STREAM_FLUSH_MS = 2_500;
const DEFAULT_NO_OUTPUT_NOTICE_MS = 60_000;
const DEFAULT_NO_OUTPUT_POLL_MS = 15_000;
const STREAM_BUFFER_MAX_CHARS = 4_000;
const STREAM_SNIPPET_MAX_CHARS = 220;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function startAcpSpawnParentStreamRelay(params: {
  runId: string;
  parentSessionKey: string;
  childSessionKey: string;
  agentId: string;
  streamFlushMs?: number;
  noOutputNoticeMs?: number;
  noOutputPollMs?: number;
}): () => void {
  const runId = params.runId.trim();
  const parentSessionKey = params.parentSessionKey.trim();
  if (!runId || !parentSessionKey) {
    return () => {};
  }

  const streamFlushMs =
    typeof params.streamFlushMs === "number" && Number.isFinite(params.streamFlushMs)
      ? Math.max(0, Math.floor(params.streamFlushMs))
      : DEFAULT_STREAM_FLUSH_MS;
  const noOutputNoticeMs =
    typeof params.noOutputNoticeMs === "number" && Number.isFinite(params.noOutputNoticeMs)
      ? Math.max(0, Math.floor(params.noOutputNoticeMs))
      : DEFAULT_NO_OUTPUT_NOTICE_MS;
  const noOutputPollMs =
    typeof params.noOutputPollMs === "number" && Number.isFinite(params.noOutputPollMs)
      ? Math.max(250, Math.floor(params.noOutputPollMs))
      : DEFAULT_NO_OUTPUT_POLL_MS;

  const relayLabel = truncate(compactWhitespace(params.agentId), 40) || "ACP child";
  const contextPrefix = `acp-spawn:${runId}`;
  const wake = () => {
    requestHeartbeatNow(
      scopedHeartbeatWakeOptions(parentSessionKey, { reason: "acp:spawn:stream" }),
    );
  };
  const emit = (text: string, contextKey: string) => {
    const cleaned = text.trim();
    if (!cleaned) {
      return;
    }
    enqueueSystemEvent(cleaned, { sessionKey: parentSessionKey, contextKey });
    wake();
  };

  let disposed = false;
  let pendingText = "";
  let lastProgressAt = Date.now();
  let stallNotified = false;
  let flushTimer: NodeJS.Timeout | undefined;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = undefined;
  };

  const flushPending = () => {
    clearFlushTimer();
    if (!pendingText) {
      return;
    }
    const snippet = truncate(compactWhitespace(pendingText), STREAM_SNIPPET_MAX_CHARS);
    pendingText = "";
    if (!snippet) {
      return;
    }
    emit(`${relayLabel}: ${snippet}`, `${contextPrefix}:progress`);
  };

  const scheduleFlush = () => {
    if (disposed || flushTimer || streamFlushMs <= 0) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushPending();
    }, streamFlushMs);
    flushTimer.unref?.();
  };

  const stopNoOutputWatcher = setInterval(() => {
    if (disposed || noOutputNoticeMs <= 0) {
      return;
    }
    if (stallNotified) {
      return;
    }
    if (Date.now() - lastProgressAt < noOutputNoticeMs) {
      return;
    }
    stallNotified = true;
    emit(
      `${relayLabel} has produced no output for ${Math.round(noOutputNoticeMs / 1000)}s. It may be waiting for interactive input.`,
      `${contextPrefix}:stall`,
    );
  }, noOutputPollMs);
  stopNoOutputWatcher.unref?.();

  emit(
    `Started ${relayLabel} session ${params.childSessionKey}. Streaming progress updates to parent session.`,
    `${contextPrefix}:start`,
  );

  const unsubscribe = onAgentEvent((event) => {
    if (disposed || event.runId !== runId) {
      return;
    }

    if (event.stream === "assistant") {
      const data = event.data;
      const delta =
        toTrimmedString((data as { delta?: unknown } | undefined)?.delta) ??
        toTrimmedString((data as { text?: unknown } | undefined)?.text);
      if (!delta) {
        return;
      }

      if (stallNotified) {
        stallNotified = false;
        emit(`${relayLabel} resumed output.`, `${contextPrefix}:resumed`);
      }

      lastProgressAt = Date.now();
      pendingText += delta;
      if (pendingText.length > STREAM_BUFFER_MAX_CHARS) {
        pendingText = pendingText.slice(-STREAM_BUFFER_MAX_CHARS);
      }
      if (pendingText.length >= STREAM_SNIPPET_MAX_CHARS || delta.includes("\n\n")) {
        flushPending();
        return;
      }
      scheduleFlush();
      return;
    }

    if (event.stream !== "lifecycle") {
      return;
    }

    const phase = toTrimmedString((event.data as { phase?: unknown } | undefined)?.phase);
    if (phase === "end") {
      flushPending();
      const startedAt = toFiniteNumber(
        (event.data as { startedAt?: unknown } | undefined)?.startedAt,
      );
      const endedAt = toFiniteNumber((event.data as { endedAt?: unknown } | undefined)?.endedAt);
      const durationMs =
        startedAt != null && endedAt != null && endedAt >= startedAt
          ? endedAt - startedAt
          : undefined;
      if (durationMs != null) {
        emit(
          `${relayLabel} run completed in ${Math.max(1, Math.round(durationMs / 1000))}s.`,
          `${contextPrefix}:done`,
        );
      } else {
        emit(`${relayLabel} run completed.`, `${contextPrefix}:done`);
      }
      dispose();
      return;
    }

    if (phase === "error") {
      flushPending();
      const errorText = toTrimmedString((event.data as { error?: unknown } | undefined)?.error);
      if (errorText) {
        emit(`${relayLabel} run failed: ${errorText}`, `${contextPrefix}:error`);
      } else {
        emit(`${relayLabel} run failed.`, `${contextPrefix}:error`);
      }
      dispose();
    }
  });

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearFlushTimer();
    clearInterval(stopNoOutputWatcher);
    unsubscribe();
  };

  return dispose;
}
