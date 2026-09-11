import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateAgentProfile } from "agentprofiles";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenClawAgentProfileExtension } from "./openclaw-extension.js";
import type { ResolvedAgentProfile } from "./resolve.js";
import { prepareAgentProfileWorkspaceContext } from "./workspace-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function resolvedProfile(extension?: unknown): ResolvedAgentProfile {
  const resource = validateAgentProfile({
    apiVersion: "agentprofiles.io/v1",
    kind: "AgentProfile",
    metadata: { namespace: "test", name: "profile" },
    spec: {
      common: {},
      ...(extension === undefined ? {} : { "openclaw.ai": extension }),
    },
  });
  return {
    profile: {
      id: "openclaw/base",
      ancestry: ["openclaw/base"],
      spec: {
        common: resource.spec.common,
        "openclaw.ai": resolveOpenClawAgentProfileExtension([{ id: "test/profile", resource }]),
      },
    },
    selectionSource: "fallback",
  };
}

async function workspace() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "profile-context-")));
  tempDirs.push(dir);
  return dir;
}

function source(
  dir: string,
  name: "AGENTS.md" | "SOUL.md" | "IDENTITY.md" | "USER.md",
  content: string,
) {
  return { name, path: path.join(dir, name), content, missing: false } as const;
}

describe("Agent Profile workspace context", () => {
  it("does nothing when the profile has no workspace context policy", async () => {
    expect(
      await prepareAgentProfileWorkspaceContext({
        resolvedProfile: resolvedProfile(),
        bootstrapFiles: [],
        workspaceDir: await workspace(),
      }),
    ).toBeUndefined();
  });

  it("reserves protected identity and scales truncatable sections deterministically", async () => {
    const dir = await workspace();
    const result = await prepareAgentProfileWorkspaceContext({
      resolvedProfile: resolvedProfile({
        prompt: {
          workspaceContext: {
            totalMaxChars: 110,
            sections: {
              identity: { maxChars: 10, overflow: "error" },
              agents: { maxChars: 100, overflow: "truncate" },
              soul: { maxChars: 200, overflow: "truncate" },
            },
          },
        },
      }),
      bootstrapFiles: [
        source(dir, "AGENTS.md", "a".repeat(100)),
        source(dir, "SOUL.md", "s".repeat(200)),
        source(dir, "IDENTITY.md", "Bob"),
      ],
      workspaceDir: dir,
    });

    expect(result?.report.injectedChars).toBeLessThanOrEqual(110);
    expect(result?.contextFiles.find((file) => file.path.endsWith("IDENTITY.md"))?.content).toBe(
      "Bob",
    );
    expect(result?.report.entries.map((entry) => [entry.section, entry.injectedChars])).toEqual([
      ["agents", 36],
      ["soul", 70],
      ["identity", 3],
    ]);
    expect(
      result?.report.entries.slice(0, 2).every((entry) => entry.causes.includes("aggregate-limit")),
    ).toBe(true);
  });

  it("uses operator limits as upper ceilings", async () => {
    const dir = await workspace();
    const result = await prepareAgentProfileWorkspaceContext({
      resolvedProfile: resolvedProfile({
        prompt: {
          workspaceContext: {
            totalMaxChars: 10_000,
            sections: { soul: { maxChars: 5_000 } },
          },
        },
      }),
      bootstrapFiles: [source(dir, "SOUL.md", "s".repeat(1_000))],
      workspaceDir: dir,
      config: {
        agents: { defaults: { bootstrapMaxChars: 300, bootstrapTotalMaxChars: 400 } },
      },
    });

    expect(result?.report.totalMaxChars).toBe(400);
    expect(result?.report.entries[0]).toMatchObject({
      effectiveMaxChars: 300,
      injectedChars: 299,
      causes: ["section-limit"],
    });
  });

  it("loads only declared additional files and applies their pool cap", async () => {
    const dir = await workspace();
    await fs.writeFile(path.join(dir, "PROJECT.md"), "p".repeat(200));
    await fs.writeFile(path.join(dir, "UNDECLARED.md"), "must not load");
    const result = await prepareAgentProfileWorkspaceContext({
      resolvedProfile: resolvedProfile({
        prompt: {
          workspaceContext: {
            totalMaxChars: 500,
            sections: { agents: { include: false } },
            additional: {
              maxCharsPerFile: 180,
              totalMaxChars: 90,
              files: [{ path: "PROJECT.md" }],
            },
          },
        },
      }),
      bootstrapFiles: [source(dir, "AGENTS.md", "agent instructions")],
      workspaceDir: dir,
    });

    expect(result?.contextFiles).toHaveLength(1);
    expect(result?.contextFiles[0]?.path).toBe(path.join(dir, "PROJECT.md"));
    expect(result?.contextFiles[0]?.content).not.toContain("must not load");
    expect(result?.report.entries[0]).toMatchObject({
      section: "additional:PROJECT.md",
      effectiveMaxChars: 180,
      injectedChars: 90,
      causes: ["section-limit", "additional-pool-limit"],
    });
  });

  it("fails rather than truncating protected content", async () => {
    const dir = await workspace();
    await expect(
      prepareAgentProfileWorkspaceContext({
        resolvedProfile: resolvedProfile({
          prompt: {
            workspaceContext: {
              totalMaxChars: 100,
              sections: { identity: { maxChars: 4, overflow: "error" } },
            },
          },
        }),
        bootstrapFiles: [source(dir, "IDENTITY.md", "Bob the OpenClaw assistant")],
        workspaceDir: dir,
      }),
    ).rejects.toThrow(/identity.*above its effective 4-char limit.*overflow=error/s);
  });

  it("fails when a declared file cannot be loaded through workspace guards", async () => {
    const dir = await workspace();
    await expect(
      prepareAgentProfileWorkspaceContext({
        resolvedProfile: resolvedProfile({
          prompt: {
            workspaceContext: {
              additional: { files: [{ path: "missing.md" }] },
            },
          },
        }),
        bootstrapFiles: [],
        workspaceDir: dir,
      }),
    ).rejects.toThrow(/Unable to load declared Agent Profile workspace context missing\.md/s);
  });

  it("rejects a declared symlink that escapes the workspace", async () => {
    const dir = await workspace();
    const outside = await workspace();
    await fs.writeFile(path.join(outside, "secret.md"), "secret");
    await fs.symlink(path.join(outside, "secret.md"), path.join(dir, "linked.md"));

    await expect(
      prepareAgentProfileWorkspaceContext({
        resolvedProfile: resolvedProfile({
          prompt: {
            workspaceContext: {
              additional: { files: [{ path: "linked.md" }] },
            },
          },
        }),
        bootstrapFiles: [],
        workspaceDir: dir,
      }),
    ).rejects.toThrow(/Unable to load declared Agent Profile workspace context linked\.md/s);
  });
});
