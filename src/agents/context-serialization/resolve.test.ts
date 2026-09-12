import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveAgentProfile } from "../agent-profiles.js";
import { resolveContextSerialization } from "./resolve.js";

function resolve(config: OpenClawConfig = {}) {
  const resolvedProfile = resolveAgentProfile({
    config,
    agentId: "main",
    modelProvider: "llama-cpp",
    modelId: "qwen3.6-35b-a3b",
  });
  return resolveContextSerialization({ config, agentId: "main", resolvedProfile });
}

describe("context serialization resolution", () => {
  it("uses the small profile lean mode for the default Qwen model", () => {
    expect(resolve()).toEqual({ mode: "lean", source: "agent-profile" });
  });

  it("lets defaults reset the selected profile to default", () => {
    expect(resolve({ agents: { defaults: { contextSerialization: "default" } } })).toEqual({
      mode: "default",
      source: "defaults-explicit",
    });
  });

  it("lets a per-agent value override defaults", () => {
    expect(
      resolve({
        agents: {
          defaults: { contextSerialization: "default" },
          entries: { main: { contextSerialization: "lean" } },
        },
      }),
    ).toEqual({ mode: "lean", source: "agent-explicit" });
  });

  it("falls back to default without a profile value", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { agentProfileId: "openclaw/base" } },
    };
    const resolvedProfile = resolveAgentProfile({ config, agentId: "main" });

    expect(resolveContextSerialization({ config, agentId: "main", resolvedProfile })).toEqual({
      mode: "default",
      source: "fallback",
    });
  });
});
