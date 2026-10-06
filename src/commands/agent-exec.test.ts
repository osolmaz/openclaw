import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { expectDefined } from "@openclaw/normalization-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { AgentRunTerminalOutcomeError } from "../agents/agent-run-terminal-error.js";
import { captureAgentToolSourceExecutionGuard } from "../agents/agent-tool-source-execution-guard.js";
import { wrapToolWithBeforeToolCallHook } from "../agents/agent-tools.before-tool-call.js";
import { createAgentHarnessToolSurfaceRuntimeCore } from "../agents/harness/tool-surface-bridge.js";
import { createStubTool } from "../agents/test-helpers/agent-tool-stubs.js";
import { enqueueExecutionIdentityContextAtAdmission } from "../audit/execution-identity-admission.js";
import {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/io.js";
import { withEnvAsync } from "../test-utils/env.js";
import { resolveExecBaseConfig } from "./agent-exec-input.js";
import { classifyAgentExecResult } from "./agent-exec-result.js";
import { runAgentExecWithMock } from "./agent-exec.test-helpers.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const externalTempDirs: string[] = [];
const execFileAsync = promisify(execFile);

function successResult(text = "done") {
  return {
    payloads: [{ text }],
    meta: {
      durationMs: 25,
      finalAssistantVisibleText: text,
      agentMeta: {
        sessionId: "session-result",
        provider: "openai",
        model: "gpt-5.6-sol",
        usage: { input: 10, output: 2, total: 12 },
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearRuntimeConfigSnapshot();
  cleanupTempDirs(externalTempDirs);
});

describe("agent exec strict result classification", () => {
  it.each([
    {
      payload: { isError: true },
      meta: { durationMs: 10 },
      status: "error",
      kind: "error_payload",
      message: "Agent run failed",
    },
    {
      payload: { text: "timed out", isError: true },
      meta: { durationMs: 600_000, aborted: true, stopReason: "timeout" },
      status: "timeout",
      kind: "timeout",
      message: "timed out",
    },
  ])("classifies $message", ({ payload, meta, status, kind, message }) => {
    expect(classifyAgentExecResult({ payloads: [payload], meta })).toMatchObject({
      ok: false,
      status,
      error: { kind, message },
    });
  });

  it("projects only documented payload fields and the outer tool summary", () => {
    const toolSummary = { calls: 2, tools: ["read", "write"], failures: 1, totalToolTimeMs: 25 };
    const envelope = classifyAgentExecResult({
      payloads: [
        {
          text: "done",
          mediaUrl: null,
          audioAsVoice: true,
          presentation: { blocks: [] },
          channelData: { private: true },
        },
      ],
      meta: { durationMs: 10, toolSummary },
    });
    expect(envelope.payloads).toEqual([{ text: "done", mediaUrl: null }]);
    expect(envelope.toolSummary).toEqual(toolSummary);
  });
  it("classifies projected production error payloads as failure", () => {
    const envelope = classifyAgentExecResult(
      successResult("projected error text"),
      false,
      "projected error text",
    );
    expect(envelope).toMatchObject({
      ok: false,
      status: "error",
      final: "",
      payloads: [{ text: "projected error text", isError: true }],
      error: { kind: "error_payload", message: "projected error text" },
    });
  });
});

describe("agent exec command composition", () => {
  it("treats invalid timeout syntax as an ordinary usage error", async () => {
    const runtime = createTestRuntime();

    const result = await runAgentExecWithMock(
      "inspect",
      { timeout: "nope", json: true },
      runtime,
      vi.fn(async () => successResult()),
    );

    expect(result).toMatchObject({
      exitCode: 1,
      envelope: { status: "error", error: { kind: "exception" } },
    });
  });

  it("maps embedded terminal-outcome timeouts to exit code 2", async () => {
    const runtime = createTestRuntime();
    const timeout = new AgentRunTerminalOutcomeError(
      new Error("attempt aborted before prompt submission"),
      {
        reason: "hard_timeout",
        status: "timeout",
        timeoutPhase: "provider",
        providerStarted: true,
      },
    );

    const result = await runAgentExecWithMock(
      "inspect",
      { json: true },
      runtime,
      vi.fn(async () => {
        throw timeout;
      }),
    );

    expect(result).toMatchObject({
      exitCode: 2,
      envelope: {
        status: "timeout",
        error: {
          kind: "timeout",
          message: "attempt aborted before prompt submission",
        },
      },
    });
  });

  it("rejects invalid programmatic Code Mode values", async () => {
    const runtime = createTestRuntime();

    const result = await runAgentExecWithMock(
      "inspect",
      { codeMode: "invalid" as never },
      runtime,
      vi.fn(async () => successResult()),
    );

    expect(result).toMatchObject({
      exitCode: 1,
      envelope: {
        status: "error",
        error: { kind: "exception", message: "--code-mode must be one of direct, auto, code." },
      },
    });
  });
  it("writes plain final text to stdout when diagnostics are routed to stderr", async () => {
    const source = `
      import { registerHooks } from "node:module";
      import { agentExecCommand } from "./src/commands/agent-exec.ts";
      import { enableConsoleCapture, routeLogsToStderr } from "./src/logging/console.ts";
      import { defaultRuntime } from "./src/runtime.ts";

      routeLogsToStderr();
      enableConsoleCapture();
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === "./agent.js" && context.parentURL?.endsWith("/commands/agent-exec.ts")) {
            return {
              url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(`export const agentCommand = async () => (${JSON.stringify(successResult("india"))});`)}),
              shortCircuit: true,
            };
          }
          return nextResolve(specifier, context);
        },
      });
      const result = await agentExecCommand("inspect", {}, defaultRuntime);
      process.exitCode = result.exitCode;
    `;

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: path.resolve(import.meta.dirname, "../.."),
        encoding: "utf8",
        env: { ...process.env, OPENCLAW_TEST_RUNTIME_LOG: "1" },
      },
    );

    expect(stdout).toBe("india\n");
    expect(stderr).not.toContain("india");
  });

  it("flushes opted-in identity evidence through its owned direct-local writer", async () => {
    const root = tempDirs.make("openclaw-agent-exec-audit-");
    setRuntimeConfigSnapshot({ logging: { audit: { executionIdentity: true } } });
    const result = await runAgentExecWithMock(
      "inspect",
      { stateDir: root },
      createTestRuntime(),
      async () => {
        expect(
          enqueueExecutionIdentityContextAtAdmission(
            {
              runId: "run",
              agentId: "main",
              ingress: { kind: "local-cli", boundary: "agent-command.local", state: "present" },
              runtime: { kind: "embedded" },
            },
            {
              enabled: true,
              contextId: "context",
              executionId: "execution",
              now: Date.now(),
              runtimeInstanceId: "runtime",
            },
          ),
        ).toMatchObject({ accepted: true });
        return successResult();
      },
    );
    expect(result.exitCode).toBe(0);
    const database = new DatabaseSync(path.join(root, "state", "openclaw.sqlite"), {
      readOnly: true,
    });
    try {
      const row = database
        .prepare("SELECT context_json FROM execution_identity_contexts WHERE execution_id = ?")
        .get("execution") as { context_json: string };
      expect(JSON.parse(row.context_json)).toMatchObject({
        contextId: "context",
        executionId: "execution",
        runId: "run",
        ingress: { kind: "local-cli", state: "present" },
      });
    } finally {
      database.close();
    }
  });

  it("keeps operator-installed plugins hidden under --isolated", async () => {
    const operatorStateDir = tempDirs.make("openclaw-agent-exec-plugin-isolated-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: operatorStateDir }, async () => {
      const result = await runAgentExecWithMock(
        "inspect",
        { isolated: true },
        createTestRuntime(),
        async () => {
          const { resolveDefaultPluginExtensionsDir } = await import("../plugins/install-paths.js");
          const extensionsDir = resolveDefaultPluginExtensionsDir();
          expect(extensionsDir).not.toBe(path.join(operatorStateDir, "extensions"));
          expect(path.basename(path.dirname(extensionsDir))).toMatch(/^openclaw-agent-exec-/u);
          return successResult();
        },
      );
      expect(result.exitCode).toBe(0);
    });
  });

  it.each([
    { mode: "direct", configured: true, capability: "preferred", enabled: false },
    { mode: "code", configured: false, capability: "capable", enabled: true },
    { mode: "auto", configured: false, capability: "preferred", enabled: true },
  ] as const)(
    "honors --code-mode $mode over model settings ($capability)",
    async ({ mode, configured, capability, enabled }) => {
      const runtime = createTestRuntime();
      const codeMode = { enabled: configured, maxOutputBytes: 4096 };
      setRuntimeConfigSnapshot({
        agents: {
          defaults: {
            systemAgent: { agentId: "main" },
            models: { "test/model-a": { codeMode: configured } },
          },
          entries: {
            main: { models: { "test/model-a": { codeMode: configured } } },
          },
        },
        tools: { codeMode, toolSearch: false },
      });
      let visibleTools: string[] | undefined;
      try {
        const result = await runAgentExecWithMock(
          "inspect",
          { codeMode: mode, model: "test/model-a", agentProfile: "openclaw/small" },
          runtime,
          vi.fn(async (invocation) => {
            const config = expectDefined(getRuntimeConfigSnapshot(), "isolated run config");
            expect(config.tools?.codeMode).toEqual(codeMode);
            expect(config.agents?.defaults?.experimental?.localModelLean).toBe(true);
            const surface = createAgentHarnessToolSurfaceRuntimeCore({
              config,
              agentId: "main",
              modelProvider: "test",
              modelId: "model-a",
              model: { compat: { codeMode: capability } },
              codeModeOverride: invocation.codeModeOverride as boolean | "auto" | undefined,
              modelToolsEnabled: true,
              executeTool: async () => ({ content: [], details: {} }),
            });
            try {
              visibleTools = surface
                .compactTools([createStubTool("read")])
                .tools.map((tool) => tool.name);
            } finally {
              surface.cleanup();
            }
            return successResult();
          }),
        );
        expect(result.exitCode).toBe(0);
        expect(visibleTools).toEqual(enabled ? ["exec", "wait"] : ["read"]);
      } finally {
        clearRuntimeConfigSnapshot();
      }
    },
  );

  it("preserves context overflow when temporary-state cleanup also fails", async () => {
    const runtime = createTestRuntime();
    const { log, error } = runtime;
    let observedStateDir = "";
    vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("cleanup denied"));

    const result = await runAgentExecWithMock("inspect", { json: true }, runtime, async () => {
      observedStateDir = process.env.OPENCLAW_STATE_DIR ?? "";
      return {
        ...successResult("partial answer"),
        meta: {
          durationMs: 25,
          error: { kind: "context_overflow", message: "original run failure" },
        },
      };
    });
    externalTempDirs.push(observedStateDir);

    expect(result).toMatchObject({
      exitCode: 1,
      envelope: {
        status: "error",
        final: "partial answer",
        payloads: [{ text: "partial answer" }],
        error: { kind: "context_overflow", message: "original run failure" },
      },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(result.envelope);
    expect(error).toHaveBeenCalledWith("original run failure");
    expect(error).toHaveBeenCalledWith("Agent exec cleanup failed: cleanup denied");
  });

  it("reports exhaustion of the ordered explicit fallback chain", async () => {
    const runtime = createTestRuntime();
    const runAgent = vi.fn(async (opts: Record<string, unknown>) => {
      if (typeof opts.onModelFallbackExhausted !== "function") {
        throw new Error("Missing fallback outcome callback");
      }
      opts.onModelFallbackExhausted();
      return successResult();
    });

    const result = await runAgentExecWithMock(
      "inspect",
      {
        model: "openai/gpt-5.6-sol",
        fallback: ["anthropic/claude-sonnet-4-6", "google/gemini-3.1-pro-preview"],
      },
      runtime,
      runAgent,
    );

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.6-sol",
        modelFallbacksOverride: ["anthropic/claude-sonnet-4-6", "google/gemini-3.1-pro-preview"],
      }),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      exitCode: 1,
      envelope: { ok: false, status: "error", error: { kind: "fallback_exhausted" } },
    });
  });

  it("undoes environment mutations made by loading the config", async () => {
    const seedDir = tempDirs.make("openclaw-agent-exec-envseed-");
    const seedPath = path.join(seedDir, "openclaw.json");
    await fs.writeFile(
      seedPath,
      JSON.stringify({ env: { vars: { OPENCLAW_EXEC_ENV_PROBE: "from-config" } } }),
      "utf8",
    );
    const runtime = createTestRuntime();
    let observedDuringRun: string | undefined;

    await runAgentExecWithMock(
      "inspect",
      { config: seedPath },
      runtime,
      vi.fn(async () => {
        observedDuringRun = process.env.OPENCLAW_EXEC_ENV_PROBE;
        return successResult();
      }),
    );

    expect(observedDuringRun).toBe("from-config");
    // Config-applied values must not outlive the command, or a later isolated
    // run in the same process would inherit them.
    expect(process.env.OPENCLAW_EXEC_ENV_PROBE).toBeUndefined();
  });

  it("leaves no runtime config snapshot behind when the caller had none", async () => {
    clearRuntimeConfigSnapshot();
    const { runtime } = createRuntime();

    await agentExecCommand("inspect", {}, runtime, {
      runAgent: vi.fn(async () => successResult()),
    });

    // Resolving the ambient config pins a snapshot of its own, so "previous" has
    // to be read before that happens or cleanup reinstalls exec's own load.
    expect(getRuntimeConfigSnapshot() ?? undefined).toBeUndefined();
  });

  it("restores a caller's runtime config snapshot after the run", async () => {
    const callerSnapshot = {
      models: { providers: { caller: { baseUrl: "https://caller.invalid", models: [] } } },
    };
    setRuntimeConfigSnapshot(callerSnapshot);
    const { runtime } = createRuntime();
    let observedDuringRun: string | undefined;

    try {
      await agentExecCommand("inspect", {}, runtime, {
        runAgent: vi.fn(async () => {
          observedDuringRun = getRuntimeConfigSnapshot()?.tools?.profile;
          return successResult();
        }),
      });

      // The run sees exec's composed config...
      expect(observedDuringRun).toBe("coding");
      // ...and the caller gets its own back afterwards.
      expect(getRuntimeConfigSnapshot()?.models?.providers?.caller?.baseUrl).toBe(
        "https://caller.invalid",
      );
    } finally {
      clearRuntimeConfigSnapshot();
    }
  });

  it("publishes no config env values when the config load fails", async () => {
    const seedDir = tempDirs.make("openclaw-agent-exec-badenv-");
    const seedPath = path.join(seedDir, "openclaw.json");
    // The loader owns this: it applies `env.vars` only after validation passes,
    // and restores them from its own catch. Pinned here because the observable
    // contract matters regardless of which layer enforces it.
    await fs.writeFile(
      seedPath,
      JSON.stringify({
        env: { vars: { OPENCLAW_EXEC_FAILED_PROBE: "from-rejected-config" } },
        agents: { defaults: { sandbox: { mode: "not-a-real-mode" } } },
      }),
      "utf8",
    );
    const { runtime } = createRuntime();

    const result = await agentExecCommand("inspect", { config: seedPath }, runtime, {
      runAgent: vi.fn(async () => successResult()),
    });

    expect(result.exitCode).not.toBe(0);
    expect(process.env.OPENCLAW_EXEC_FAILED_PROBE).toBeUndefined();
  });

  it("leaves an explicit state directory untouched", async () => {
    const stateDir = tempDirs.make("openclaw-agent-exec-state-");
    const marker = path.join(stateDir, "keep.txt");
    await fs.writeFile(marker, "keep", "utf8");
    const { runtime } = createRuntime();

    await agentExecCommand("inspect", { stateDir }, runtime, {
      runAgent: vi.fn(async () => {
        expect(process.env.OPENCLAW_STATE_DIR).toBe(stateDir);
        return successResult();
      }),
    });

    await expect(fs.readFile(marker, "utf8")).resolves.toBe("keep");
    // The run config inherits the ambient config, so a retained state dir must
    // never receive a serialized copy of it.
    await expect(fs.readdir(stateDir)).resolves.toEqual(["keep.txt"]);
  });
});

describe("agent exec run config layering", () => {
  it("keeps the run scoped to the invocation folder over any config", () => {
    const config = buildExecRunConfig({
      base: { agents: { defaults: { workspace: "/elsewhere", skipBootstrap: false } } },
      cwd: "/run/here",
    });

    expect(config.agents?.defaults?.workspace).toBe("/run/here");
    expect(config.agents?.defaults?.skipBootstrap).toBe(true);
    expect(config.skills?.load?.watch).toBe(false);
  });

  it("never downgrades a configured sandbox or shell env to the exec defaults", () => {
    const config = buildExecRunConfig({
      base: {
        env: { shellEnv: { enabled: true } },
        agents: { defaults: { sandbox: { mode: "all" } } },
        tools: { profile: "full" },
      },
      cwd: "/run/here",
    });

    expect(config.agents?.defaults?.sandbox?.mode).toBe("all");
    expect(config.env?.shellEnv?.enabled).toBe(true);
    expect(config.tools?.profile).toBe("full");
  });

  it("applies coding one-shot defaults when the config leaves them unset", () => {
    const config = buildExecRunConfig({ base: {}, cwd: "/run/here" });

    expect(config.agents?.defaults?.sandbox?.mode).toBe("off");
    expect(config.env?.shellEnv?.enabled).toBe(false);
    expect(config.tools?.profile).toBe("coding");
    expect(config.tools?.fs?.workspaceOnly).toBe(true);
  });

  it("leaves exec host routing to the configured sandbox", () => {
    const sandboxed = buildExecRunConfig({
      base: { agents: { defaults: { sandbox: { mode: "all" } } } },
      cwd: "/run/here",
    });

    expect(sandboxed.agents?.defaults?.sandbox?.mode).toBe("all");
    expect(sandboxed.tools?.exec?.host).toBeUndefined();
    expect(buildExecRunConfig({ base: {}, cwd: "/run/here" }).tools?.exec?.host).toBeUndefined();
  });

  it("carries config-owned provider and harness surfaces into the run", () => {
    const config = buildExecRunConfig({
      base: {
        models: { providers: { custom: { baseUrl: "https://example.invalid", models: [] } } },
        tools: { codeMode: { enabled: true } },
      },
      cwd: "/run/here",
    });

    expect(config.models?.providers?.custom?.baseUrl).toBe("https://example.invalid");
    expect(config.tools?.codeMode).toMatchObject({ enabled: true });
  });

  it("pins per-agent workspaces to the invocation folder", () => {
    const config = buildExecRunConfig({
      base: { agents: { entries: { ops: { workspace: "/elsewhere" } } } },
      cwd: "/run/here",
    });

    expect(config.agents?.entries?.ops?.workspace).toBe("/run/here");
  });

  it("drops inherited agent directories so run state stays in the state dir", () => {
    const config = buildExecRunConfig({
      base: {
        agents: {
          entries: { ops: { agentDir: "/persistent/agents/ops", model: "openai/gpt-5.6-sol" } },
        },
      },
      cwd: "/run/here",
    });

    expect(config.agents?.entries?.ops?.agentDir).toBeUndefined();
    // Only the directory is dropped; the rest of the entry is still inherited.
    expect(config.agents?.entries?.ops?.model).toBe("openai/gpt-5.6-sol");
  });

  it("drops an inherited session store so the invocation state dir owns the agent database", () => {
    const config = buildExecRunConfig({
      base: {
        session: {
          store: "/persistent/agents/{agentId}/sessions/sessions.json",
          mainKey: "primary",
        },
      },
      cwd: "/run/here",
    });

    expect(config.session?.store).toBeUndefined();
    expect(config.session?.mainKey).toBe("primary");
  });

  it("drops an inherited harness cwd so --cwd wins", () => {
    const config = buildExecRunConfig({
      base: {
        agents: {
          entries: {
            ops: { runtime: { type: "acp", acp: { agent: "codex", cwd: "/other/repo" } } },
          },
        },
      },
      cwd: "/run/here",
    });

    const runtime = config.agents?.entries?.ops?.runtime;
    expect(runtime?.type === "acp" ? runtime.acp?.cwd : "unset").toBeUndefined();
    // The rest of the harness selection survives.
    expect(runtime?.type === "acp" ? runtime.acp?.agent : undefined).toBe("codex");
  });

  it("keeps Code Mode limits while selecting the small Agent Profile", () => {
    const config = buildExecRunConfig({
      base: { tools: { codeMode: { enabled: true, maxOutputBytes: 4096 } } },
      cwd: "/run/here",
      opts: { agentProfile: "openclaw/small" },
    });

    expect(config.tools?.codeMode).toEqual({ enabled: true, maxOutputBytes: 4096 });
    expect(config.agents?.defaults?.agentProfileId).toBe("openclaw/small");
  });
});

describe("agent exec base config resolution", () => {
  it("rejects a missing or invalid pinned config instead of falling back", async () => {
    const missing = path.join(tempDirs.make("openclaw-agent-exec-seed-"), "absent.json");
    await expect(resolveExecBaseConfig({ config: missing })).rejects.toThrow(
      "--config file not found",
    );

    const broken = await writeSeed("{ this is not a config");
    await expect(resolveExecBaseConfig({ config: broken })).rejects.toThrow();
  });

  async function writeSeed(body: string): Promise<string> {
    const dir = tempDirs.make("openclaw-agent-exec-seed-");
    const seedPath = path.join(dir, "openclaw.json");
    await fs.writeFile(seedPath, body, "utf8");
    return seedPath;
  }

  it("rejects --config paired with a mode that reads no config", async () => {
    const seedPath = await writeSeed("{}");

    await expect(resolveExecBaseConfig({ config: seedPath, isolated: true })).rejects.toThrow(
      "--config cannot be combined with --isolated",
    );
    await expect(resolveExecBaseConfig({ config: seedPath, authEnvOnly: true })).rejects.toThrow(
      "--config cannot be combined with --auth-env-only",
    );
  });
});

describe("agent exec tool lifetime", () => {
  const runtime = createTestRuntime();

  it("closes retained tool closures when the invocation ends", async () => {
    const source = vi.fn(async () => ({ content: [], details: {} }));
    let retained: ReturnType<typeof wrapToolWithBeforeToolCallHook> | undefined;
    const result = await runAgentExecWithMock("inspect", {}, runtime, async () => {
      retained = wrapToolWithBeforeToolCallHook({ ...createStubTool("read"), execute: source });
      return successResult();
    });

    expect(result.exitCode).toBe(0);
    await expect(retained?.execute("late", {})).rejects.toThrow();
    expect(source).not.toHaveBeenCalled();
  });

  it("retained effect guards cannot borrow a replacement invocation's authority", async () => {
    let retainedGuard: (() => void) | undefined;
    const effect = vi.fn();
    await runAgentExecWithMock("inspect", {}, runtime, async () => {
      retainedGuard = captureAgentToolSourceExecutionGuard();
      return successResult();
    });
    const replacement = await runAgentExecWithMock("inspect", {}, runtime, async () => {
      expect(() => {
        retainedGuard?.();
        effect();
      }).toThrow("execution scope is no longer active");
      return successResult();
    });
    expect(replacement.exitCode).toBe(0);
    expect(effect).not.toHaveBeenCalled();
  });
});
