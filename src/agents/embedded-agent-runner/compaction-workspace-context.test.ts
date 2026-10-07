import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { resolveBootstrapContextForRun } from "../bootstrap-files.js";
import { resolveCompactionContextFiles } from "./compaction-workspace-context.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function totalChars(files: Array<{ content: string }>): number {
  return files.reduce((sum, file) => sum + file.content.length, 0);
}

describe("resolveCompactionContextFiles", () => {
  async function makeWorkspace(prefix: string) {
    const workspace = await fs.realpath(tempDirs.make(prefix));
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "a".repeat(12_000));
    await fs.writeFile(path.join(workspace, "SOUL.md"), "Helpful and concise");
    await fs.writeFile(path.join(workspace, "IDENTITY.md"), "Name: Bob\nEmoji: 🦞");
    await fs.writeFile(path.join(workspace, "USER.md"), "User: Onur");
    return workspace;
  }

  it("bounds direct compaction context with the small profile budget", async () => {
    const workspace = await makeWorkspace("openclaw-compaction-small-");
    const files = await resolveCompactionContextFiles({
      config: { agents: { defaults: { workspace } } },
      agentId: "main",
      sessionId: "session-small",
      sessionKey: "agent:main:session-small",
      workspaceDir: workspace,
      modelSizeClass: "small",
      warn: () => {},
    });
    const agentsFile = files.find((file) => file.path === path.join(workspace, "AGENTS.md"));
    const identityFile = files.find((file) => file.path === path.join(workspace, "IDENTITY.md"));

    expect(totalChars(files)).toBeLessThanOrEqual(8_000);
    expect(agentsFile?.content.length).toBeLessThan(12_000);
    expect(identityFile?.content).toContain("Name: Bob");
    expect(identityFile?.content).toContain("Emoji: 🦞");
  });

  it("leaves base-profile compaction context unchanged", async () => {
    const workspace = await makeWorkspace("openclaw-compaction-base-");
    const config = { agents: { defaults: { workspace } } };
    const files = await resolveCompactionContextFiles({
      config,
      agentId: "main",
      sessionId: "session-base",
      sessionKey: "agent:main:session-base",
      workspaceDir: workspace,
      warn: () => {},
    });
    const expected = await resolveBootstrapContextForRun({
      workspaceDir: workspace,
      config,
      sessionKey: "agent:main:session-base",
      sessionId: "session-base",
      agentId: "main",
    });

    expect(files).toEqual(expected.contextFiles);
  });
});
