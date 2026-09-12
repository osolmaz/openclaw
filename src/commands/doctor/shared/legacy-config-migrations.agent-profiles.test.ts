import { describe, expect, it } from "vitest";
import { LEGACY_CONFIG_MIGRATIONS_AGENT_PROFILES } from "./legacy-config-migrations.agent-profiles.js";

function migrate(raw: Record<string, unknown>) {
  const changes: string[] = [];
  LEGACY_CONFIG_MIGRATIONS_AGENT_PROFILES[0]?.apply(raw, changes);
  return { changes, raw };
}

describe("legacy Agent Profile migration", () => {
  it("moves default and per-agent enabled Lean flags to the small profile", () => {
    const result = migrate({
      agents: {
        defaults: { experimental: { localModelLean: true } },
        entries: {
          coding: { experimental: { localModelLean: true } },
        },
        list: [{ id: "legacy", experimental: { localModelLean: true } }],
      },
    });

    expect(result.raw).toEqual({
      agents: {
        defaults: { agentProfileId: "openclaw/small" },
        entries: { coding: { agentProfileId: "openclaw/small" } },
        list: [{ id: "legacy", agentProfileId: "openclaw/small" }],
      },
    });
    expect(result.changes).toHaveLength(3);
  });

  it("maps disabled flags to base and preserves other experimental values", () => {
    const result = migrate({
      agents: {
        defaults: {
          experimental: { localModelLean: false, otherPreview: true },
        },
      },
    });

    expect(result.raw).toEqual({
      agents: {
        defaults: {
          agentProfileId: "openclaw/base",
          experimental: { otherPreview: true },
        },
      },
    });
  });

  it("preserves per-agent opt-outs from an enabled default", () => {
    const result = migrate({
      agents: {
        defaults: { experimental: { localModelLean: true } },
        entries: { full: { experimental: { localModelLean: false } } },
        list: [{ id: "legacy-full", experimental: { localModelLean: false } }],
      },
    });

    expect(result.raw).toEqual({
      agents: {
        defaults: { agentProfileId: "openclaw/small" },
        entries: { full: { agentProfileId: "openclaw/base" } },
        list: [{ id: "legacy-full", agentProfileId: "openclaw/base" }],
      },
    });
  });

  it("keeps an explicit profile when the legacy flag is enabled", () => {
    const result = migrate({
      agents: {
        defaults: {
          agentProfileId: "openclaw/large",
          experimental: { localModelLean: true },
        },
      },
    });

    expect(result.raw).toEqual({
      agents: { defaults: { agentProfileId: "openclaw/large" } },
    });
    expect(result.changes[0]).toContain("kept the explicit Agent Profile");
  });

  it("renames onboarding ownership provenance", () => {
    const result = migrate({
      wizard: { localModelLeanAutoModel: "ollama/qwen3:8b" },
    });

    expect(result.raw).toEqual({
      wizard: { agentProfileAutoModel: "ollama/qwen3:8b" },
    });
  });
});
