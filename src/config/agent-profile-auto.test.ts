import { describe, expect, it } from "vitest";
import { applyAutoAgentProfile } from "./agent-profile-auto.js";

describe("Agent Profile onboarding defaults", () => {
  it.each([
    ["ollama", true],
    ["OLLAMA", true],
    ["lmstudio", true],
    ["ollama-cloud", false],
    ["sglang", false],
    ["vllm", false],
    ["openai", false],
  ])("classifies %s conservatively", (providerId, expected) => {
    const modelRef = `${providerId}/test-model`;
    const result = applyAutoAgentProfile({ config: {}, providerId, modelRef });

    expect(result.enabled).toBe(expected);
    expect(result.changed).toBe(expected);
    expect(result.config.agents?.defaults?.agentProfileId).toBe(
      expected ? "openclaw/small" : undefined,
    );
    expect(result.config.wizard?.agentProfileAutoModel).toBe(expected ? modelRef : undefined);
  });

  it.each([
    ["ollama/qwen3:8b", true],
    ["ollama/local-cloud", true],
    ["ollama/invalid:cloud-cloud", true],
    ["ollama/kimi-k2.5:cloud", false],
    ["ollama/glm-5.2:cloud", false],
    ["ollama/gpt-oss:120b-cloud", false],
    ["ollama/KIMI-K2.5:CLOUD", false],
  ])("classifies the verified Ollama model source %s", (modelRef, expected) => {
    const result = applyAutoAgentProfile({ config: {}, providerId: "ollama", modelRef });

    expect(result.enabled).toBe(expected);
    expect(result.config.agents?.defaults?.agentProfileId).toBe(
      expected ? "openclaw/small" : undefined,
    );
  });

  it.each(["auto", "openclaw/base", "openclaw/large"] as const)(
    "preserves an explicit selector %s",
    (agentProfileId) => {
      const config = { agents: { defaults: { agentProfileId } } };

      expect(
        applyAutoAgentProfile({
          config,
          providerId: "ollama",
          modelRef: "ollama/test-model",
        }),
      ).toEqual({ config, changed: false, enabled: false });
    },
  );

  it("lifts only an onboarding-owned profile for a later non-local route", () => {
    const config = {
      wizard: { agentProfileAutoModel: "ollama/test-model" },
      agents: {
        defaults: {
          model: "ollama/test-model",
          agentProfileId: "openclaw/small" as const,
        },
      },
    };

    const result = applyAutoAgentProfile({
      config,
      providerId: "openai",
      modelRef: "openai/gpt-test",
    });

    expect(result.changed).toBe(true);
    expect(result.config.agents?.defaults?.agentProfileId).toBeUndefined();
    expect(result.config.wizard?.agentProfileAutoModel).toBeUndefined();
  });

  it("preserves a user-changed selector and clears stale ownership", () => {
    const config = {
      wizard: { agentProfileAutoModel: "ollama/old-model" },
      agents: {
        defaults: {
          model: "openai/gpt-test",
          agentProfileId: "openclaw/large" as const,
        },
      },
    };

    const result = applyAutoAgentProfile({
      config,
      providerId: "openai",
      modelRef: "openai/gpt-test",
    });

    expect(result.config.agents?.defaults?.agentProfileId).toBe("openclaw/large");
    expect(result.config.wizard?.agentProfileAutoModel).toBeUndefined();
  });

  it("updates ownership when onboarding changes one local model to another", () => {
    const config = {
      wizard: { agentProfileAutoModel: "ollama/old-model" },
      agents: {
        defaults: {
          model: "ollama/old-model",
          agentProfileId: "openclaw/small" as const,
        },
      },
    };

    const result = applyAutoAgentProfile({
      config,
      providerId: "ollama",
      modelRef: "ollama/new-model",
    });

    expect(result.changed).toBe(true);
    expect(result.config.wizard?.agentProfileAutoModel).toBe("ollama/new-model");
    expect(result.config.agents?.defaults?.agentProfileId).toBe("openclaw/small");
  });

  it("accepts explicit previous-model ownership after provider setup changes the default", () => {
    const previousModelRef = "ollama/qwen3:8b";
    const selectedModelRef = "openai/gpt-5.6-luna";
    const result = applyAutoAgentProfile({
      config: {
        wizard: { agentProfileAutoModel: previousModelRef },
        agents: {
          defaults: {
            model: { primary: selectedModelRef },
            agentProfileId: "openclaw/small",
          },
        },
      },
      providerId: "openai",
      modelRef: selectedModelRef,
      previousModelRef,
    });

    expect(result.config.agents?.defaults?.model).toEqual({ primary: selectedModelRef });
    expect(result.config.agents?.defaults?.agentProfileId).toBeUndefined();
    expect(result.config.wizard?.agentProfileAutoModel).toBeUndefined();
  });
});
