import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelSizeClass } from "../config/types.models.js";
import {
  applyAgentProfileToolSearchDefaults,
  buildAgentProfileSystemPrompt,
  filterToolsByAgentProfile,
  resolveAgentProfile,
  resolveAgentProfilePreserveToolNames,
} from "./agent-profiles.js";
import type { AnyAgentTool } from "./agent-tools.types.js";

function tools(names: string[]): AnyAgentTool[] {
  return names.map((name) => ({ name })) as AnyAgentTool[];
}

const heavyTools = [
  "read",
  "browser",
  "cron",
  "message",
  "image_generate",
  "music_generate",
  "pdf",
  "tts",
  "video_generate",
  "exec",
];

describe("Agent Profile selection", () => {
  it("selects the small profile for the existing Qwen model", () => {
    const resolved = resolveAgentProfile({
      modelProvider: "llama-cpp",
      modelId: "qwen3.6-35b-a3b",
    });

    expect(resolved.profile.id).toBe("openclaw/small");
    expect(resolved.profile.ancestry).toEqual(["openclaw/base", "openclaw/small"]);
    expect(resolved.selectionSource).toBe("model");
  });

  it.each([
    ["tiny", "openclaw/small"],
    ["small", "openclaw/small"],
    ["medium", "openclaw/medium"],
    ["large", "openclaw/large"],
  ] as const)("maps %s model metadata to %s", (modelSizeClass, expectedProfileId) => {
    const resolved = resolveAgentProfile({ modelSizeClass });

    expect(resolved.profile.id).toBe(expectedProfileId);
    expect(resolved.selectionSource).toBe("model-size");
  });

  it("lets an exact model binding override model size", () => {
    const resolved = resolveAgentProfile({
      modelProvider: "llama-cpp",
      modelId: "qwen3.6-35b-a3b",
      modelSizeClass: "medium",
    });

    expect(resolved.profile.id).toBe("openclaw/small");
    expect(resolved.selectionSource).toBe("model");
  });

  it("falls back to the base profile without trusted matching facts", () => {
    const resolved = resolveAgentProfile({
      modelProvider: "custom",
      modelId: "unknown-7b",
    });

    expect(resolved.profile.id).toBe("openclaw/base");
    expect(resolved.selectionSource).toBe("fallback");
  });

  it("uses an explicit default profile before automatic bindings", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { agentProfileId: "openclaw/large" } },
    };
    const resolved = resolveAgentProfile({
      config,
      modelProvider: "llama-cpp",
      modelId: "qwen3.6-35b-a3b",
    });

    expect(resolved.profile.id).toBe("openclaw/large");
    expect(resolved.selectionSource).toBe("defaults-explicit");
  });

  it("uses a per-agent profile before an explicit default", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { agentProfileId: "openclaw/large" },
        entries: {
          main: { agentProfileId: "openclaw/small" },
        },
      },
    };
    const resolved = resolveAgentProfile({ config, agentId: "main" });

    expect(resolved.profile.id).toBe("openclaw/small");
    expect(resolved.selectionSource).toBe("agent-explicit");
  });

  it("lets a per-agent auto selector bypass an explicit default", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { agentProfileId: "openclaw/large" },
        entries: {
          main: { agentProfileId: "auto" },
        },
      },
    };
    const resolved = resolveAgentProfile({
      config,
      agentId: "main",
      modelSizeClass: "small",
    });

    expect(resolved.profile.id).toBe("openclaw/small");
    expect(resolved.selectionSource).toBe("model-size");
  });
});

describe("small profile prompt behavior", () => {
  const resolvedProfile = resolveAgentProfile({
    modelProvider: "llama-cpp",
    modelId: "qwen3.6-35b-a3b",
  });

  it("uses a minimum prompt instead of the standard OpenClaw prompt", () => {
    const prompt = buildAgentProfileSystemPrompt({
      resolvedProfile,
      messageToolAvailable: false,
    });

    expect(prompt).toContain("You are a personal assistant running inside OpenClaw.");
    expect(prompt).toContain("use tool_search to find a deferred tool");
    expect(prompt).toContain("read the applicable AGENTS.md instructions");
    expect(prompt).toContain("Return the visible reply as assistant text.");
    expect(prompt?.length).toBeLessThan(1_000);
  });

  it("preserves runtime-supplied system instructions", () => {
    const prompt = buildAgentProfileSystemPrompt({
      resolvedProfile,
      messageToolAvailable: false,
      runtimeSystemPrompt: "Complete the delegated task: RUNTIME_CONTEXT_MARKER",
    });

    expect(prompt).toContain("RUNTIME_CONTEXT_MARKER");
  });

  it("preserves message-owned delivery instructions", () => {
    const prompt = buildAgentProfileSystemPrompt({
      resolvedProfile,
      sourceReplyDeliveryMode: "message_tool_only",
      messageToolAvailable: true,
    });

    expect(prompt).toContain("Send the visible reply with the message tool.");
    expect(prompt).toContain("return exactly NO_REPLY");
  });

  it("leaves the base profile on the standard prompt path", () => {
    expect(
      buildAgentProfileSystemPrompt({
        resolvedProfile: resolveAgentProfile({}),
        messageToolAvailable: false,
      }),
    ).toBeUndefined();
  });
});

describe("small profile tool behavior", () => {
  const smallConfig: OpenClawConfig = {
    agents: { defaults: { agentProfileId: "openclaw/small" } },
  };

  it("filters heavyweight tools", () => {
    expect(
      filterToolsByAgentProfile({
        tools: tools(heavyTools),
        config: smallConfig,
      }).map((tool) => tool.name),
    ).toEqual(["read", "exec"]);
  });

  it("keeps explicit tool groups and names", () => {
    expect(
      filterToolsByAgentProfile({
        tools: tools(heavyTools),
        config: smallConfig,
        preserveToolNames: ["browser", "cron", "group:messaging", "group:media", "pdf"],
      }).map((tool) => tool.name),
    ).toEqual(heavyTools);
  });

  it("keeps forced message delivery", () => {
    const preserveToolNames = resolveAgentProfilePreserveToolNames({
      forceMessageTool: true,
    });

    expect(
      filterToolsByAgentProfile({
        tools: tools(["read", "message", "exec"]),
        config: smallConfig,
        preserveToolNames,
      }).map((tool) => tool.name),
    ).toEqual(["read", "message", "exec"]);
  });

  it("treats a global wildcard as non-preserving", () => {
    expect(
      filterToolsByAgentProfile({
        tools: tools(["read", "browser", "image_generate"]),
        config: smallConfig,
        preserveToolNames: ["image_*", "*"],
      }).map((tool) => tool.name),
    ).toEqual(["read", "image_generate"]);
  });

  it("leaves base profile tools unchanged", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { agentProfileId: "openclaw/base" } },
    };

    expect(
      filterToolsByAgentProfile({
        tools: tools(["read", "browser", "message", "exec"]),
        config,
      }).map((tool) => tool.name),
    ).toEqual(["read", "browser", "message", "exec"]);
  });
});

describe("small profile Tool Search defaults", () => {
  it("enables bounded Tool Search when unset", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { agentProfileId: "openclaw/small" } },
    };

    expect(applyAgentProfileToolSearchDefaults({ config })?.tools?.toolSearch).toEqual({
      enabled: true,
      mode: "tools",
      searchDefaultLimit: 5,
      maxSearchLimit: 10,
    });
  });

  it("preserves explicit Tool Search configuration", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { agentProfileId: "openclaw/small" } },
      tools: { toolSearch: { enabled: false, mode: "directory" } },
    };

    expect(applyAgentProfileToolSearchDefaults({ config })).toBe(config);
  });

  it("selects the Qwen profile before applying defaults", () => {
    const config: OpenClawConfig = {};

    expect(
      applyAgentProfileToolSearchDefaults({
        config,
        modelProvider: "llama-cpp",
        modelId: "qwen3.6-35b-a3b",
      })?.tools?.toolSearch,
    ).toMatchObject({ enabled: true, mode: "tools" });
  });

  it("does not change config for an unmatched model", () => {
    const config: OpenClawConfig = {};

    expect(
      applyAgentProfileToolSearchDefaults({
        config,
        modelProvider: "custom",
        modelId: "unknown",
      }),
    ).toBe(config);
  });

  it.each<ModelSizeClass>(["tiny", "small"])(
    "enables Tool Search for %s model metadata",
    (modelSizeClass) => {
      expect(
        applyAgentProfileToolSearchDefaults({
          config: {},
          modelSizeClass,
        })?.tools?.toolSearch,
      ).toMatchObject({ enabled: true });
    },
  );
});
