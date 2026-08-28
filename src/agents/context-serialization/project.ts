import type { CurrentInboundPromptContext } from "../embedded-agent-runner/run/params.js";
import {
  escapeInternalRuntimeContextDelimiters,
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
  OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
  OPENCLAW_RUNTIME_CONTEXT_NOTICE,
  OPENCLAW_RUNTIME_EVENT_HEADER,
} from "../internal-runtime-context.js";
import type { ResolvedContextSerialization } from "./resolve.js";

const LEAN_RUNTIME_CONTEXT_HEADER =
  "OpenClaw runtime facts. Use them privately for the active request.";

export type ContextSerializationReport = {
  mode: ResolvedContextSerialization["mode"];
  source: ResolvedContextSerialization["source"];
  defaultChars: number;
  serializedChars: number;
  removedSessionMessages: number;
  deduplicatedMessages: number;
};

export function selectCurrentInboundContext(params: {
  context: CurrentInboundPromptContext | undefined;
  serialization: ResolvedContextSerialization;
  preferResumableText?: boolean;
}): { text: string; report: ContextSerializationReport } {
  const context = params.context;
  const defaultText = params.preferResumableText
    ? (context?.resumableText ?? context?.text ?? "")
    : (context?.text ?? "");
  const leanText = params.preferResumableText
    ? (context?.leanResumableText ?? context?.leanText ?? defaultText)
    : (context?.leanText ?? defaultText);
  const isLean = params.serialization.mode === "lean";
  const text = isLean ? leanText : defaultText;
  return {
    text,
    report: {
      mode: params.serialization.mode,
      source: params.serialization.source,
      defaultChars: defaultText.length,
      serializedChars: text.length,
      removedSessionMessages: isLean
        ? (context?.serializationStats?.removedSessionMessages ?? 0)
        : 0,
      deduplicatedMessages: isLean ? (context?.serializationStats?.deduplicatedMessages ?? 0) : 0,
    },
  };
}

export function serializeRuntimeContext(params: {
  runtimeContext: string;
  kind: "next-turn" | "runtime-event";
  mode: ResolvedContextSerialization["mode"];
}): string {
  if (params.mode === "default") {
    return [
      params.kind === "runtime-event"
        ? OPENCLAW_RUNTIME_EVENT_HEADER
        : OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
      OPENCLAW_RUNTIME_CONTEXT_NOTICE,
      "",
      INTERNAL_RUNTIME_CONTEXT_BEGIN,
      params.runtimeContext,
      INTERNAL_RUNTIME_CONTEXT_END,
    ].join("\n");
  }

  return [
    params.kind === "runtime-event" ? OPENCLAW_RUNTIME_EVENT_HEADER : LEAN_RUNTIME_CONTEXT_HEADER,
    INTERNAL_RUNTIME_CONTEXT_BEGIN,
    escapeInternalRuntimeContextDelimiters(params.runtimeContext),
    INTERNAL_RUNTIME_CONTEXT_END,
  ].join("\n");
}
