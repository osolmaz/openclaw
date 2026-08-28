import { validateAgentProfile } from "agentprofiles";
import { describe, expect, it } from "vitest";
import { BUILT_IN_AGENT_PROFILES } from "./builtins.js";
import { resolveOpenClawAgentProfileExtension } from "./openclaw-extension.js";

function builtIn(id: string) {
  const profile = BUILT_IN_AGENT_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Missing built-in Agent Profile: ${id}`);
  }
  return profile;
}

describe("built-in Agent Profile resources", () => {
  it("passes every resource through the released portable validator", () => {
    for (const profile of BUILT_IN_AGENT_PROFILES) {
      expect(validateAgentProfile(profile.resource)).toBe(profile.resource);
    }
  });

  it("keeps OpenClaw settings out of portable common fields", () => {
    const small = builtIn("openclaw/small");

    expect(small.resource.spec.common).toEqual({
      systemPrompt: expect.objectContaining({ text: expect.any(String) }),
    });
    expect(small.resource.spec.common).not.toHaveProperty("contextSerialization");
    expect(resolveOpenClawAgentProfileExtension([small])).toEqual({
      contextSerialization: "lean",
      toolProfile: "lean",
    });
  });
});
