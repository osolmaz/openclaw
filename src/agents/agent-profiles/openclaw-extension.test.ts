import { validateAgentProfile, type AgentProfileResource } from "agentprofiles";
import { describe, expect, it } from "vitest";
import { resolveOpenClawAgentProfileExtension } from "./openclaw-extension.js";

function profile(params: { name: string; extension?: unknown }): AgentProfileResource {
  return validateAgentProfile({
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "openclaw", name: params.name },
    spec: {
      common: {},
      ...(params.extension === undefined ? {} : { "openclaw.ai": params.extension }),
    },
  });
}

describe("OpenClaw Agent Profile extension", () => {
  it("uses scalar replacement and lets default reset inherited lean mode", () => {
    const resolved = resolveOpenClawAgentProfileExtension([
      {
        id: "openclaw/parent",
        resource: profile({
          name: "parent",
          extension: { contextSerialization: "lean", toolProfile: "lean" },
        }),
      },
      {
        id: "openclaw/child",
        resource: profile({
          name: "child",
          extension: { contextSerialization: "default" },
        }),
      },
    ]);

    expect(resolved).toEqual({
      contextSerialization: "default",
      toolProfile: "lean",
    });
  });

  it("rejects fields that OpenClaw does not own", () => {
    expect(() =>
      resolveOpenClawAgentProfileExtension([
        {
          id: "openclaw/invalid",
          resource: profile({
            name: "invalid",
            extension: { contextSerialization: "lean", contextPosture: "compact" },
          }),
        },
      ]),
    ).toThrow(/Invalid openclaw\.ai section.*contextPosture/s);
  });

  it("rejects invalid OpenClaw field values", () => {
    expect(() =>
      resolveOpenClawAgentProfileExtension([
        {
          id: "openclaw/invalid",
          resource: profile({
            name: "invalid",
            extension: { toolProfile: "full" },
          }),
        },
      ]),
    ).toThrow(/Invalid openclaw\.ai section.*toolProfile/s);
  });

  it("returns no extension when the ancestry has none", () => {
    expect(
      resolveOpenClawAgentProfileExtension([
        { id: "openclaw/base", resource: profile({ name: "base" }) },
      ]),
    ).toBeUndefined();
  });
});
