import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const hoisted = vi.hoisted(() => ({
  resolveModelMock: vi.fn(),
  getApiKeyForModelMock: vi.fn(),
  applyLocalNoAuthHeaderOverrideMock: vi.fn(),
  setRuntimeApiKeyMock: vi.fn(),
  resolveCopilotApiTokenMock: vi.fn(),
  completeMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: hoisted.completeMock,
}));

vi.mock("./pi-embedded-runner/model.js", () => ({
  resolveModel: hoisted.resolveModelMock,
}));

vi.mock("./model-auth.js", () => ({
  getApiKeyForModel: hoisted.getApiKeyForModelMock,
  applyLocalNoAuthHeaderOverride: hoisted.applyLocalNoAuthHeaderOverrideMock,
}));

vi.mock("./github-copilot-token.js", () => ({
  resolveCopilotApiToken: hoisted.resolveCopilotApiTokenMock,
}));

let prepareSimpleCompletionModel: typeof import("./simple-completion-runtime.js").prepareSimpleCompletionModel;
let runSimpleCompletionForAgent: typeof import("./simple-completion-runtime.js").runSimpleCompletionForAgent;

function cfgWithDefaultModel(model: string): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model,
      },
    },
  } as OpenClawConfig;
}

beforeEach(async () => {
  vi.resetModules();
  hoisted.resolveModelMock.mockReset();
  hoisted.getApiKeyForModelMock.mockReset();
  hoisted.applyLocalNoAuthHeaderOverrideMock.mockReset();
  hoisted.setRuntimeApiKeyMock.mockReset();
  hoisted.resolveCopilotApiTokenMock.mockReset();
  hoisted.completeMock.mockReset();

  hoisted.applyLocalNoAuthHeaderOverrideMock.mockImplementation((model: unknown) => model);

  hoisted.resolveModelMock.mockReturnValue({
    model: {
      provider: "anthropic",
      id: "claude-opus-4-6",
    },
    authStorage: {
      setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
    },
    modelRegistry: {},
  });
  hoisted.getApiKeyForModelMock.mockResolvedValue({
    apiKey: "sk-test",
    source: "env:TEST_API_KEY",
    mode: "api-key",
  });
  hoisted.resolveCopilotApiTokenMock.mockResolvedValue({
    token: "copilot-runtime-token",
    expiresAt: Date.now() + 60_000,
    source: "cache:/tmp/copilot-token.json",
    baseUrl: "https://api.individual.githubcopilot.com",
  });
  hoisted.completeMock.mockResolvedValue({
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
  });
  ({ prepareSimpleCompletionModel, runSimpleCompletionForAgent } =
    await import("./simple-completion-runtime.js"));
});

describe("prepareSimpleCompletionModel", () => {
  it("resolves model auth and sets runtime api key", async () => {
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: " sk-test ",
      source: "env:TEST_API_KEY",
      mode: "api-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
      agentDir: "/tmp/openclaw-agent",
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "anthropic",
          id: "claude-opus-4-6",
        }),
        auth: expect.objectContaining({
          mode: "api-key",
          source: "env:TEST_API_KEY",
        }),
      }),
    );
    expect(hoisted.setRuntimeApiKeyMock).toHaveBeenCalledWith("anthropic", "sk-test");
  });

  it("returns error when model resolution fails", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      error: "Unknown model: anthropic/missing-model",
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "missing-model",
    });

    expect(result).toEqual({
      error: "Unknown model: anthropic/missing-model",
    });
    expect(hoisted.getApiKeyForModelMock).not.toHaveBeenCalled();
  });

  it("returns error when api key is missing and mode is not allowlisted", async () => {
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      source: "models.providers.anthropic",
      mode: "api-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });

    expect(result).toEqual({
      error: 'No API key resolved for provider "anthropic" (auth mode: api-key).',
      auth: {
        source: "models.providers.anthropic",
        mode: "api-key",
      },
    });
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("continues without api key when auth mode is allowlisted", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "amazon-bedrock",
        id: "anthropic.claude-sonnet-4-5",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      source: "aws-sdk default chain",
      mode: "aws-sdk",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "amazon-bedrock",
      modelId: "anthropic.claude-sonnet-4-5",
      allowMissingApiKeyModes: ["aws-sdk"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "amazon-bedrock",
          id: "anthropic.claude-sonnet-4-5",
        }),
        auth: {
          source: "aws-sdk default chain",
          mode: "aws-sdk",
        },
      }),
    );
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("exchanges github token when provider is github-copilot", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_test",
      source: "profile:github-copilot:default",
      mode: "token",
    });

    await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(hoisted.resolveCopilotApiTokenMock).toHaveBeenCalledWith({
      githubToken: "ghu_test",
    });
    expect(hoisted.setRuntimeApiKeyMock).toHaveBeenCalledWith(
      "github-copilot",
      "copilot-runtime-token",
    );
  });

  it("returns exchanged copilot token in auth.apiKey for github-copilot provider", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_original_github_token",
      source: "profile:github-copilot:default",
      mode: "token",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }

    // The returned auth.apiKey should be the exchanged runtime token,
    // not the original GitHub token
    expect(result.auth.apiKey).toBe("copilot-runtime-token");
    expect(result.auth.apiKey).not.toBe("ghu_original_github_token");
  });

  it("applies exchanged copilot baseUrl to returned model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-copilot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "ghu_test",
      source: "profile:github-copilot:default",
      mode: "token",
    });
    hoisted.resolveCopilotApiTokenMock.mockResolvedValueOnce({
      token: "copilot-runtime-token",
      expiresAt: Date.now() + 60_000,
      source: "cache:/tmp/copilot-token.json",
      baseUrl: "https://api.copilot.enterprise.example",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-copilot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }
    expect(result.model).toEqual(
      expect.objectContaining({
        baseUrl: "https://api.copilot.enterprise.example",
      }),
    );
  });

  it("returns error when getApiKeyForModel throws", async () => {
    hoisted.getApiKeyForModelMock.mockRejectedValueOnce(new Error("Profile not found: copilot"));

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });

    expect(result).toEqual({
      error: 'Auth lookup failed for provider "anthropic": Profile not found: copilot',
    });
    expect(hoisted.setRuntimeApiKeyMock).not.toHaveBeenCalled();
  });

  it("applies local no-auth header override before returning model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "local-openai",
        id: "chat-local",
        api: "openai-completions",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getApiKeyForModelMock.mockResolvedValueOnce({
      apiKey: "custom-local",
      source: "models.providers.local-openai (synthetic local key)",
      mode: "api-key",
    });
    hoisted.applyLocalNoAuthHeaderOverrideMock.mockReturnValueOnce({
      provider: "local-openai",
      id: "chat-local",
      api: "openai-completions",
      headers: { Authorization: null },
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "local-openai",
      modelId: "chat-local",
    });

    expect(hoisted.applyLocalNoAuthHeaderOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "local-openai",
        id: "chat-local",
      }),
      expect.objectContaining({
        apiKey: "custom-local",
        source: "models.providers.local-openai (synthetic local key)",
        mode: "api-key",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({
          headers: expect.objectContaining({ Authorization: null }),
        }),
      }),
    );
  });
});

describe("runSimpleCompletionForAgent", () => {
  it("strips temperature for codex one-shot completions", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "openai-codex",
        id: "gpt-5.4",
        api: "openai-codex-responses",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });

    const result = await runSimpleCompletionForAgent({
      cfg: cfgWithDefaultModel("openai-codex/gpt-5.4"),
      agentId: "main",
      context: {
        systemPrompt: "Generate a title.",
        messages: [],
      },
      options: {
        maxTokens: 24,
        temperature: 0.2,
      },
    });

    expect(result).not.toHaveProperty("error");
    expect(hoisted.completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        id: "gpt-5.4",
        api: "openai-codex-responses",
      }),
      expect.objectContaining({
        systemPrompt: "Generate a title.",
      }),
      expect.objectContaining({
        apiKey: "sk-test",
        maxTokens: 24,
      }),
    );
    expect(hoisted.completeMock.mock.calls[0]?.[2]).not.toHaveProperty("temperature");
  });

  it("preserves temperature for non-codex one-shot completions", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "anthropic",
        id: "claude-opus-4-6",
        api: "anthropic-messages",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });

    await runSimpleCompletionForAgent({
      cfg: cfgWithDefaultModel("anthropic/claude-opus-4-6"),
      agentId: "main",
      context: {
        systemPrompt: "Generate a title.",
        messages: [],
      },
      options: {
        maxTokens: 24,
        temperature: 0.2,
      },
    });

    expect(hoisted.completeMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        apiKey: "sk-test",
        maxTokens: 24,
        temperature: 0.2,
      }),
    );
  });

  it("returns the selection when execution throws", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "anthropic",
        id: "claude-opus-4-6",
        api: "anthropic-messages",
      },
      authStorage: {
        setRuntimeApiKey: hoisted.setRuntimeApiKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.completeMock.mockRejectedValueOnce(new Error("network timeout"));

    const result = await runSimpleCompletionForAgent({
      cfg: cfgWithDefaultModel("anthropic/claude-opus-4-6"),
      agentId: "main",
      context: {
        systemPrompt: "Generate a title.",
        messages: [],
      },
    });

    expect(result).toEqual({
      error: "network timeout",
      selection: {
        provider: "anthropic",
        modelId: "claude-opus-4-6",
        agentDir: expect.any(String),
      },
    });
  });
});
