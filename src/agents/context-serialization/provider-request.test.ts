import { describe, expect, it } from "vitest";
import type { Context, Model } from "../../llm/types.js";
import {
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
  OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
  OPENCLAW_RUNTIME_CONTEXT_NOTICE,
} from "../internal-runtime-context.js";
import { buildOpenAICompletionsParams } from "../openai-transport-stream.js";
import { serializeRuntimeContext } from "./project.js";

const model: Model<"openai-completions"> = {
  id: "qwen3.6-35b-a3b",
  name: "Qwen3.6 35B A3B",
  api: "openai-completions",
  provider: "llama-cpp",
  baseUrl: "http://127.0.0.1:8080/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 65_536,
  maxTokens: 4_096,
};

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function buildMessages(mode: "default" | "lean"): Context["messages"] {
  const runtimeContext =
    mode === "default"
      ? [
          "Conversation info: ⟦openclaw:ctx⟧",
          "```json",
          '{"chat_id":"discord:synthetic","message_id":"current-1","timestamp":"2026-08-27T10:00:00Z"}',
          "```",
        ].join("\n")
      : 'Context: {"message_id":"current-1"}';
  return [
    { role: "user", content: "Read the file.", timestamp: 1 },
    {
      role: "assistant",
      api: "openai-completions",
      provider: "llama-cpp",
      model: model.id,
      content: [
        { type: "toolCall", id: "call-read-1", name: "read", arguments: { path: "README.md" } },
      ],
      usage: emptyUsage,
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call-read-1",
      toolName: "read",
      content: [{ type: "text", text: "Synthetic contents." }],
      isError: false,
      timestamp: 3,
    },
    {
      role: "user",
      content: serializeRuntimeContext({ runtimeContext, kind: "next-turn", mode }),
      timestamp: 4,
      runtimeContextCarrier: true,
    },
    { role: "user", content: "Reply with the result.", timestamp: 5 },
  ];
}

function buildProviderMessages(mode: "default" | "lean") {
  const payload = buildOpenAICompletionsParams(
    model,
    {
      systemPrompt: "Synthetic small-profile prompt.",
      messages: buildMessages(mode),
      tools: [
        {
          name: "read",
          description: "Read a file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    },
    undefined,
  );
  return payload["messages"] as Array<Record<string, unknown>>;
}

function findCarrier(messages: Array<Record<string, unknown>>) {
  return messages.find(
    (message) =>
      message["role"] === "user" &&
      JSON.stringify(message["content"]).includes(INTERNAL_RUNTIME_CONTEXT_BEGIN),
  );
}

describe("context serialization at the provider request boundary", () => {
  it("keeps the default runtime carrier byte-compatible", () => {
    const carrier = findCarrier(buildProviderMessages("default"));
    expect(carrier?.["content"]).toBe(
      [
        OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
        OPENCLAW_RUNTIME_CONTEXT_NOTICE,
        "",
        INTERNAL_RUNTIME_CONTEXT_BEGIN,
        "Conversation info: ⟦openclaw:ctx⟧",
        "```json",
        '{"chat_id":"discord:synthetic","message_id":"current-1","timestamp":"2026-08-27T10:00:00Z"}',
        "```",
        INTERNAL_RUNTIME_CONTEXT_END,
      ].join("\n"),
    );
  });

  it("emits the short lean carrier in the final provider-visible messages", () => {
    const carrier = findCarrier(buildProviderMessages("lean"));
    const content = String(carrier?.["content"]);

    expect(content).toContain('Context: {"message_id":"current-1"}');
    expect(content).not.toContain("chat_id");
    expect(content).not.toContain("timestamp");
    expect(content).not.toContain(OPENCLAW_RUNTIME_CONTEXT_NOTICE);
  });

  it("preserves ordered tool calls and results in both modes", () => {
    for (const mode of ["default", "lean"] as const) {
      const messages = buildProviderMessages(mode);
      const assistantIndex = messages.findIndex((message) => message["role"] === "assistant");
      const toolIndex = messages.findIndex((message) => message["role"] === "tool");
      const assistant = messages[assistantIndex] as {
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
      const tool = messages[toolIndex];

      expect(assistantIndex).toBeGreaterThan(0);
      expect(toolIndex).toBe(assistantIndex + 1);
      expect(assistant.tool_calls?.[0]).toEqual({
        type: "function",
        id: "call-read-1",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      });
      expect(tool?.["tool_call_id"]).toBe("call-read-1");
      expect(tool?.["content"]).toBe("Synthetic contents.");
    }
  });
});
