import { describe, expect, it } from "vitest";
import { buildExecRunConfig } from "./agent-exec.js";

describe("agent exec Agent Profile override", () => {
  it("overrides per-agent profile selections", () => {
    const config = buildExecRunConfig({
      base: { agents: { entries: { ops: { agentProfileId: "openclaw/large" } } } },
      cwd: "/run/here",
      opts: { agentProfile: "openclaw/small" },
    });

    expect(config.agents?.defaults?.agentProfileId).toBe("openclaw/small");
    expect(config.agents?.entries?.ops?.agentProfileId).toBe("openclaw/small");
  });

  it("overrides list-based agent profile selections", () => {
    const config = buildExecRunConfig({
      base: {
        agents: {
          list: [
            {
              id: "ops",
              model: "openai/gpt-5.6-sol",
              agentProfileId: "openclaw/large",
            },
          ],
        },
      },
      cwd: "/run/here",
      opts: { agentProfile: "openclaw/small" },
    });

    expect(config.agents?.list).toEqual([
      expect.objectContaining({
        id: "ops",
        model: "openai/gpt-5.6-sol",
        workspace: "/run/here",
        agentProfileId: "openclaw/small",
      }),
    ]);
  });
});
