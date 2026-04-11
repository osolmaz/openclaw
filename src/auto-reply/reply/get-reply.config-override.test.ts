import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { loadGetReplyModuleForTest } from "./get-reply.test-loader.js";
import "./get-reply.test-runtime-mocks.js";

const mocks = vi.hoisted(() => ({
  resolveReplyDirectives: vi.fn(),
  initSessionState: vi.fn(),
  resolveChannelModelOverride: vi.fn<(...args: unknown[]) => unknown>(() => undefined),
}));
vi.mock("../../channels/model-overrides.js", () => ({
  resolveChannelModelOverride: mocks.resolveChannelModelOverride,
}));
vi.mock("./directive-handling.defaults.js", () => ({
  resolveDefaultModel: vi.fn(() => ({
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
    aliasIndex: new Map(),
  })),
}));
vi.mock("./get-reply-directives.js", () => ({
  resolveReplyDirectives: (...args: unknown[]) => mocks.resolveReplyDirectives(...args),
}));
vi.mock("./get-reply-inline-actions.js", () => ({
  handleInlineActions: vi.fn(async () => ({ kind: "reply", reply: { text: "ok" } })),
}));
vi.mock("./session.js", () => ({
  initSessionState: (...args: unknown[]) => mocks.initSessionState(...args),
}));

let getReplyFromConfig: typeof import("./get-reply.js").getReplyFromConfig;
let loadConfigMock: typeof import("../../config/config.js").loadConfig;

async function loadGetReplyRuntimeForTest() {
  ({ getReplyFromConfig } = await loadGetReplyModuleForTest({ cacheKey: import.meta.url }));
  ({ loadConfig: loadConfigMock } = await import("../../config/config.js"));
}

function buildCtx(overrides: Partial<MsgContext> = {}): MsgContext {
  return {
    Provider: "telegram",
    Surface: "telegram",
    ChatType: "direct",
    Body: "hello",
    BodyForAgent: "hello",
    RawBody: "hello",
    CommandBody: "hello",
    SessionKey: "agent:main:telegram:123",
    From: "telegram:user:42",
    To: "telegram:123",
    Timestamp: 1710000000000,
    ...overrides,
  };
}

describe("getReplyFromConfig configOverride", () => {
  beforeEach(async () => {
    await loadGetReplyRuntimeForTest();
    vi.stubEnv("OPENCLAW_ALLOW_SLOW_REPLY_TESTS", "1");
    mocks.resolveReplyDirectives.mockReset();
    mocks.initSessionState.mockReset();
    mocks.resolveChannelModelOverride.mockReset();
    vi.mocked(loadConfigMock).mockReset();

    vi.mocked(loadConfigMock).mockReturnValue({});
    mocks.resolveReplyDirectives.mockResolvedValue({ kind: "reply", reply: { text: "ok" } });
    mocks.resolveChannelModelOverride.mockReturnValue(undefined);
    mocks.initSessionState.mockResolvedValue({
      sessionCtx: {},
      sessionEntry: {},
      previousSessionEntry: {},
      sessionStore: {},
      sessionKey: "agent:main:telegram:123",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: "/tmp/sessions.json",
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: false,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges configOverride over fresh loadConfig()", async () => {
    vi.mocked(loadConfigMock).mockReturnValue({
      channels: {
        telegram: {
          botToken: "resolved-telegram-token",
        },
      },
      agents: {
        defaults: {
          userTimezone: "UTC",
        },
      },
    } satisfies OpenClawConfig);

    await getReplyFromConfig(buildCtx(), undefined, {
      agents: {
        defaults: {
          userTimezone: "America/New_York",
        },
      },
    } as OpenClawConfig);

    expect(mocks.resolveReplyDirectives).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          channels: expect.objectContaining({
            telegram: expect.objectContaining({
              botToken: "resolved-telegram-token",
            }),
          }),
          agents: expect.objectContaining({
            defaults: expect.objectContaining({
              userTimezone: "America/New_York",
            }),
          }),
        }),
      }),
    );
  });

  it("preserves a user model override even when the channel is pinned", async () => {
    const sessionEntry = {
      channel: "discord",
      chatType: "channel",
      groupId: "1492296441803182130",
      providerOverride: "openai-codex",
      modelOverride: "gpt-5.4",
      modelOverrideSource: "user",
      authProfileOverride: "openai-codex:default",
      authProfileOverrideSource: "user",
    };
    mocks.initSessionState.mockResolvedValue({
      sessionCtx: {},
      sessionEntry,
      previousSessionEntry: {},
      sessionStore: {
        "agent:main:discord:channel:1492296441803182130": sessionEntry,
      },
      sessionKey: "agent:main:discord:channel:1492296441803182130",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: undefined,
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: false,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
    mocks.resolveChannelModelOverride.mockReturnValue({
      channel: "discord",
      model: "vllm/gemma4-26b",
    });
    mocks.initSessionState.mockResolvedValue({
      sessionCtx: {},
      sessionEntry,
      previousSessionEntry: {},
      sessionStore: {
        "agent:main:discord:channel:1492296441803182130": sessionEntry,
      },
      sessionKey: "agent:main:discord:channel:1492296441803182130",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: undefined,
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: false,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
    vi.mocked(loadConfigMock).mockReturnValue({
      channels: {
        modelByChannel: {
          discord: {
            "1492296441803182130": "vllm/gemma4-26b",
          },
        },
      },
    } satisfies OpenClawConfig);

    await getReplyFromConfig(
      buildCtx({
        Provider: "discord",
        Surface: "discord",
        ChatType: "channel",
        SessionKey: "agent:main:discord:channel:1492296441803182130",
        To: "channel:1492296441803182130",
      }),
      undefined,
      undefined,
    );

    expect(mocks.resolveReplyDirectives).toHaveBeenCalledOnce();
    expect(sessionEntry.providerOverride).toBe("openai-codex");
    expect(sessionEntry.modelOverride).toBe("gpt-5.4");
    expect(sessionEntry.authProfileOverride).toBe("openai-codex:default");
  });
});
