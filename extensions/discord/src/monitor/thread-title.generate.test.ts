import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  runSimpleCompletionForAgentMock: vi.fn(),
  extractAssistantTextMock: vi.fn(),
  logVerboseMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/agent-runtime")>();
  return {
    ...actual,
    runSimpleCompletionForAgent: hoisted.runSimpleCompletionForAgentMock,
    extractAssistantText: hoisted.extractAssistantTextMock,
  };
});

vi.mock("openclaw/plugin-sdk/runtime-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/runtime-env")>();
  return {
    ...actual,
    logVerbose: hoisted.logVerboseMock,
  };
});

let generateThreadTitle: typeof import("./thread-title.js").generateThreadTitle;

beforeEach(async () => {
  vi.resetModules();
  hoisted.runSimpleCompletionForAgentMock.mockReset();
  hoisted.extractAssistantTextMock.mockReset();
  hoisted.logVerboseMock.mockReset();

  hoisted.runSimpleCompletionForAgentMock.mockResolvedValue({
    selection: {
      provider: "anthropic",
      modelId: "claude-opus-4-6",
      agentDir: "/tmp/openclaw-agent",
    },
    response: {},
  });
  hoisted.extractAssistantTextMock.mockReturnValue("Generated title");
  ({ generateThreadTitle } = await import("./thread-title.js"));
});

describe("generateThreadTitle", () => {
  it("calls shared one-shot completion with aws-sdk allowance", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValueOnce({
      selection: {
        provider: "openrouter",
        modelId: "anthropic/claude-sonnet-4-5",
        profileId: "work",
        agentDir: "/tmp/openclaw-agent",
      },
      response: {},
    });
    const cfg = {
      agents: {
        defaults: {
          model: "openrouter/anthropic/claude-sonnet-4-5@work",
        },
      },
    } as OpenClawConfig;

    await generateThreadTitle({
      cfg,
      agentId: "main",
      messageText: "Need a generated title.",
    });

    expect(hoisted.runSimpleCompletionForAgentMock).toHaveBeenCalledWith({
      cfg,
      agentId: "main",
      context: expect.objectContaining({
        systemPrompt:
          "Generate a concise Discord thread title (3-6 words). Return only the title. Use channel context when provided and avoid redundant channel-name words unless needed for clarity.",
      }),
      options: expect.objectContaining({
        maxTokens: 24,
        temperature: 0.2,
        signal: expect.any(AbortSignal),
      }),
      allowMissingApiKeyModes: ["aws-sdk"],
    });
  });

  it("passes model override refs into shared completion helper", async () => {
    const cfg = {} as OpenClawConfig;
    await generateThreadTitle({
      cfg,
      agentId: "main",
      modelRef: "openai/gpt-4.1-mini@local",
      messageText: "Need a generated title.",
    });

    expect(hoisted.runSimpleCompletionForAgentMock).toHaveBeenCalledWith({
      cfg,
      agentId: "main",
      modelRef: "openai/gpt-4.1-mini@local",
      context: expect.any(Object),
      options: expect.any(Object),
      allowMissingApiKeyModes: ["aws-sdk"],
    });
  });

  it("returns null when shared completion cannot resolve selection", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValueOnce({
      error: "No model configured for agent main.",
    });

    const result = await generateThreadTitle({
      cfg: {} as OpenClawConfig,
      agentId: "main",
      messageText: "Need a thread title.",
    });

    expect(result).toBeNull();
    expect(hoisted.logVerboseMock).toHaveBeenCalledWith(
      "thread-title: No model configured for agent main. (agent=main, model=unknown)",
    );
  });

  it("returns null when shared completion auth lookup fails", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValue({
      error: 'No API key resolved for provider "anthropic" (auth mode: api-key).',
      selection: {
        provider: "anthropic",
        modelId: "claude-opus-4-6",
        agentDir: "/tmp/openclaw-agent",
      },
    });

    const result = await generateThreadTitle({
      cfg: {} as OpenClawConfig,
      agentId: "main",
      messageText: "Need a thread title.",
    });

    expect(result).toBeNull();
    expect(hoisted.logVerboseMock).toHaveBeenCalledWith(
      'thread-title: No API key resolved for provider "anthropic" (auth mode: api-key). (agent=main, model=anthropic/claude-opus-4-6)',
    );
  });

  it("builds contextual prompt and forwards completion options", async () => {
    const result = await generateThreadTitle({
      cfg: {} as OpenClawConfig,
      agentId: "main",
      messageText: "Summarize deployment blockers and owner follow-ups.",
      channelName: "release-status",
      channelDescription: "Deploy updates and incident notes",
    });

    expect(result).toBe("Generated title");
    expect(hoisted.runSimpleCompletionForAgentMock).toHaveBeenCalledTimes(1);
    expect(hoisted.runSimpleCompletionForAgentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          systemPrompt:
            "Generate a concise Discord thread title (3-6 words). Return only the title. Use channel context when provided and avoid redundant channel-name words unless needed for clarity.",
          messages: [
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining("Channel: release-status"),
            }),
          ],
        }),
      }),
    );
    expect(
      hoisted.runSimpleCompletionForAgentMock.mock.calls[0]?.[0]?.context?.messages?.[0]?.content,
    ).toContain("Channel description: Deploy updates and incident notes");
    expect(hoisted.runSimpleCompletionForAgentMock.mock.calls[0]?.[0]?.options).toEqual(
      expect.objectContaining({
        maxTokens: 24,
        temperature: 0.2,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns null when shared completion returns an execution error", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValueOnce({
      error: "network timeout",
      selection: {
        provider: "anthropic",
        modelId: "claude-opus-4-6",
        agentDir: "/tmp/openclaw-agent",
      },
    });

    const result = await generateThreadTitle({
      cfg: {} as OpenClawConfig,
      agentId: "main",
      messageText: "Generate title.",
    });

    expect(result).toBeNull();
    expect(hoisted.logVerboseMock).toHaveBeenCalledWith(
      "thread-title: network timeout (agent=main, model=anthropic/claude-opus-4-6)",
    );
  });

  it("logs the provider error when the completion returns no usable title text", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValueOnce({
      selection: {
        provider: "openai-codex",
        modelId: "gpt-5.4",
        agentDir: "/tmp/openclaw-agent",
      },
      response: {
        stopReason: "error",
        errorMessage: '{"detail":"Unsupported parameter: temperature"}',
      },
    });
    hoisted.extractAssistantTextMock.mockReturnValueOnce("");

    const result = await generateThreadTitle({
      cfg: {} as OpenClawConfig,
      agentId: "main",
      messageText: "Generate title.",
    });

    expect(result).toBeNull();
    expect(hoisted.logVerboseMock).toHaveBeenCalledWith(
      'thread-title: empty title response for agent main (model=openai-codex/gpt-5.4, stopReason=error error={"detail":"Unsupported parameter: temperature"})',
    );
  });
});
