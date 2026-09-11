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

  it("deeply inherits workspace context and merges additional files by path", () => {
    const resolved = resolveOpenClawAgentProfileExtension([
      {
        id: "openclaw/parent",
        resource: profile({
          name: "parent",
          extension: {
            prompt: {
              workspaceContext: {
                totalMaxChars: 8_000,
                sections: {
                  identity: { maxChars: 1_024, overflow: "error" },
                  soul: { maxChars: 2_000 },
                },
                additional: {
                  maxCharsPerFile: 500,
                  files: [{ path: "notes/PROJECT.md", overflow: "truncate" }],
                },
              },
            },
          },
        }),
      },
      {
        id: "openclaw/child",
        resource: profile({
          name: "child",
          extension: {
            prompt: {
              workspaceContext: {
                sections: { soul: { include: false } },
                additional: {
                  totalMaxChars: 900,
                  files: [{ path: "notes/PROJECT.md", maxChars: 700 }, { path: "CONTEXT.md" }],
                },
              },
            },
          },
        }),
      },
    ]);

    expect(resolved?.prompt?.workspaceContext).toEqual({
      totalMaxChars: 8_000,
      sections: {
        identity: { maxChars: 1_024, overflow: "error" },
        soul: { maxChars: 2_000, include: false },
      },
      additional: {
        maxCharsPerFile: 500,
        totalMaxChars: 900,
        files: [
          { path: "notes/PROJECT.md", overflow: "truncate", maxChars: 700 },
          { path: "CONTEXT.md" },
        ],
      },
    });
  });

  it.each([
    { additional: { files: [{ path: "../secret.md" }] } },
    { additional: { files: [{ path: "/etc/passwd" }] } },
    { additional: { files: [{ path: "notes/*.md" }] } },
    { additional: { files: [{ path: "notes.md" }, { path: "notes.md" }] } },
  ])("rejects unsafe or duplicate declared paths: $additional", (workspaceContext) => {
    expect(() =>
      resolveOpenClawAgentProfileExtension([
        {
          id: "openclaw/invalid",
          resource: profile({
            name: "invalid",
            extension: { prompt: { workspaceContext } },
          }),
        },
      ]),
    ).toThrow(/Invalid openclaw\.ai section/s);
  });

  it("rejects unknown workspace context fields", () => {
    expect(() =>
      resolveOpenClawAgentProfileExtension([
        {
          id: "openclaw/invalid",
          resource: profile({
            name: "invalid",
            extension: {
              prompt: { workspaceContext: { tokenLimit: 2_000 } },
            },
          }),
        },
      ]),
    ).toThrow(/Invalid openclaw\.ai section.*tokenLimit/s);
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
