import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { resolveAgentProfile } from "../../agent-profiles.js";
import { buildAgentSystemPrompt } from "../../system-prompt.js";
import { prepareEmbeddedAttemptBootstrap } from "./attempt-bootstrap-prepare.js";
import { createAttemptSetupFixture } from "./attempt-setup.test-support.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("prepareEmbeddedAttemptBootstrap", () => {
  async function prepare(params: { agentWorkspace: string; sessionWorkspace: string }) {
    return await prepareEmbeddedAttemptBootstrap({
      attempt: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        trigger: "user",
        bootstrapWorkspaceDir: params.agentWorkspace,
        isCanonicalWorkspace: params.agentWorkspace === params.sessionWorkspace,
        config: { agents: { defaults: { workspace: params.agentWorkspace } } },
      } as EmbeddedRunAttemptParams,
      setup: createAttemptSetupFixture({
        effectiveWorkspace: params.sessionWorkspace,
        resolvedWorkspace: params.sessionWorkspace,
      }),
      agentProfile: resolveAgentProfile({}),
      hasReadTool: true,
      isRawModelRun: false,
    });
  }

  it("layers execution project instructions after agent bootstrap files", async () => {
    const agentWorkspace = await fs.realpath(tempDirs.make("openclaw-agent-workspace-"));
    const sessionWorkspace = await fs.realpath(tempDirs.make("openclaw-session-workspace-"));
    await fs.writeFile(path.join(agentWorkspace, "AGENTS.md"), "Canonical agent instructions");
    await fs.writeFile(path.join(agentWorkspace, "SOUL.md"), "Canonical agent soul");
    await fs.writeFile(path.join(sessionWorkspace, "AGENTS.md"), "Execution project context");
    await fs.writeFile(path.join(sessionWorkspace, "SOUL.md"), "Execution soul must stay private");

    const result = await prepare({ agentWorkspace, sessionWorkspace });
    const executionAgentsIndex = result.contextFiles.findIndex(
      (file) => file.path === path.join(sessionWorkspace, "AGENTS.md"),
    );
    const lastAgentFileIndex = result.contextFiles.findLastIndex((file) =>
      file.path.startsWith(`${agentWorkspace}${path.sep}`),
    );

    expect(executionAgentsIndex).toBeGreaterThan(lastAgentFileIndex);
    expect(result.contextFiles[executionAgentsIndex]).toEqual(
      expect.objectContaining({
        path: path.join(sessionWorkspace, "AGENTS.md"),
        content: "Execution project context",
      }),
    );
    expect(result.contextFiles).toContainEqual(
      expect.objectContaining({
        path: path.join(agentWorkspace, "SOUL.md"),
        content: "Canonical agent soul",
      }),
    );
    expect(result.contextFiles).not.toContainEqual(
      expect.objectContaining({ path: path.join(sessionWorkspace, "SOUL.md") }),
    );
  });

  it("remaps injected paths into the prompt workspace while accounting keeps source paths", async () => {
    // Sandbox runs show the model the copy path; injection accounting still has
    // to recognize the host file it loaded, or its bytes read as never injected.
    const workspace = await fs.realpath(tempDirs.make("openclaw-remap-workspace-"));
    const promptWorkspace = await fs.realpath(tempDirs.make("openclaw-remap-prompt-"));
    const agents = "Sandboxed agent instructions";
    await fs.writeFile(path.join(workspace, "AGENTS.md"), agents);

    const result = await prepareEmbeddedAttemptBootstrap({
      attempt: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        trigger: "user",
        bootstrapWorkspaceDir: workspace,
        isCanonicalWorkspace: true,
        config: { agents: { defaults: { workspace } } },
      } as EmbeddedRunAttemptParams,
      setup: createAttemptSetupFixture({
        effectiveWorkspace: promptWorkspace,
        resolvedWorkspace: workspace,
      }),
      agentProfile: resolveAgentProfile({}),
      hasReadTool: true,
      isRawModelRun: false,
    });

    expect(result.contextFiles).toContainEqual(
      expect.objectContaining({
        path: path.join(promptWorkspace, "AGENTS.md"),
        content: agents,
      }),
    );
    expect(result.bootstrapInjectionStats).toContainEqual(
      expect.objectContaining({
        path: path.join(workspace, "AGENTS.md"),
        rawChars: agents.length,
        injectedChars: agents.length,
        truncated: false,
      }),
    );
  });

  it("keeps same-workspace bootstrap output byte-identical", async () => {
    const workspace = await fs.realpath(tempDirs.make("openclaw-same-workspace-"));
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "Same workspace instructions");
    await fs.writeFile(path.join(workspace, "SOUL.md"), "Same workspace soul");

    const explicit = await prepare({ agentWorkspace: workspace, sessionWorkspace: workspace });
    const omitted = await prepareEmbeddedAttemptBootstrap({
      attempt: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        trigger: "user",
        isCanonicalWorkspace: true,
        config: { agents: { defaults: { workspace } } },
      } as EmbeddedRunAttemptParams,
      setup: createAttemptSetupFixture({
        effectiveWorkspace: workspace,
        resolvedWorkspace: workspace,
      }),
      agentProfile: resolveAgentProfile({}),
      hasReadTool: true,
      isRawModelRun: false,
    });

    expect(explicit).toEqual(omitted);
  });

  it("composes the small profile with bounded workspace identity", async () => {
    const workspace = await fs.realpath(tempDirs.make("openclaw-small-profile-workspace-"));
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "a".repeat(12_000));
    await fs.writeFile(path.join(workspace, "SOUL.md"), "Helpful and concise");
    await fs.writeFile(path.join(workspace, "IDENTITY.md"), "Name: Bob\nEmoji: 🦞");
    await fs.writeFile(path.join(workspace, "USER.md"), "User: Onur");
    const agentProfile = resolveAgentProfile({ modelSizeClass: "small" });

    const result = await prepareEmbeddedAttemptBootstrap({
      attempt: {
        sessionId: "session-small",
        sessionKey: "agent:main:session-small",
        trigger: "user",
        isCanonicalWorkspace: true,
        config: { agents: { defaults: { workspace } } },
      } as EmbeddedRunAttemptParams,
      setup: createAttemptSetupFixture({
        effectiveWorkspace: workspace,
        resolvedWorkspace: workspace,
      }),
      agentProfile,
      hasReadTool: true,
      isRawModelRun: false,
    });
    const systemPrompt = buildAgentSystemPrompt({
      workspaceDir: workspace,
      contextFiles: result.contextFiles,
      toolNames: ["read", "exec"],
      promptMode: "full",
    });

    expect(result.workspaceContextReport).toMatchObject({
      totalMaxChars: 8_000,
      injectedChars: expect.any(Number),
    });
    expect(result.workspaceContextReport?.injectedChars).toBeLessThanOrEqual(8_000);
    expect(systemPrompt).toContain("You are a personal assistant running inside OpenClaw.");
    expect(systemPrompt).toContain("Name: Bob");
    expect(systemPrompt).toContain("Emoji: 🦞");
  });
});
