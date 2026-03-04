import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  buildConfiguredAcpSessionKey,
  resolveConfiguredAcpBindingRecord,
} from "./persistent-bindings.js";

const baseCfg = {
  session: { mainKey: "main", scope: "per-sender" },
  agents: {
    list: [{ id: "codex" }, { id: "claude" }],
  },
} satisfies OpenClawConfig;

describe("resolveConfiguredAcpBindingRecord", () => {
  it("resolves discord channel ACP binding from channel-local config", () => {
    const cfg = {
      ...baseCfg,
      channels: {
        discord: {
          guilds: {
            "guild-1": {
              channels: {
                "1478836151241412759": {
                  bindings: {
                    acp: {
                      enabled: true,
                      agentId: "codex",
                      cwd: "/repo/openclaw",
                    },
                  },
                },
              },
            },
          },
        },
      },
    } satisfies OpenClawConfig;

    const resolved = resolveConfiguredAcpBindingRecord({
      cfg,
      channel: "discord",
      accountId: "default",
      conversationId: "1478836151241412759",
    });

    expect(resolved?.spec.channel).toBe("discord");
    expect(resolved?.spec.conversationId).toBe("1478836151241412759");
    expect(resolved?.spec.agentId).toBe("codex");
    expect(resolved?.record.targetSessionKey).toContain("agent:codex:acp:binding:discord:default:");
    expect(resolved?.record.metadata?.source).toBe("config");
  });

  it("falls back to parent discord channel when conversation is a thread id", () => {
    const cfg = {
      ...baseCfg,
      channels: {
        discord: {
          guilds: {
            "guild-1": {
              channels: {
                "channel-parent-1": {
                  bindings: {
                    acp: {
                      enabled: true,
                      agentId: "codex",
                    },
                  },
                },
              },
            },
          },
        },
      },
    } satisfies OpenClawConfig;

    const resolved = resolveConfiguredAcpBindingRecord({
      cfg,
      channel: "discord",
      accountId: "default",
      conversationId: "thread-123",
      parentConversationId: "channel-parent-1",
    });

    expect(resolved?.spec.conversationId).toBe("channel-parent-1");
    expect(resolved?.record.conversation.conversationId).toBe("channel-parent-1");
  });

  it("resolves telegram forum topic bindings using canonical conversation ids", () => {
    const cfg = {
      ...baseCfg,
      channels: {
        telegram: {
          groups: {
            "-1001234567890": {
              topics: {
                "42": {
                  bindings: {
                    acp: {
                      enabled: true,
                      agentId: "claude",
                      backend: "acpx",
                    },
                  },
                },
              },
            },
          },
        },
      },
    } satisfies OpenClawConfig;

    const canonical = resolveConfiguredAcpBindingRecord({
      cfg,
      channel: "telegram",
      accountId: "default",
      conversationId: "-1001234567890:topic:42",
    });
    const splitIds = resolveConfiguredAcpBindingRecord({
      cfg,
      channel: "telegram",
      accountId: "default",
      conversationId: "42",
      parentConversationId: "-1001234567890",
    });

    expect(canonical?.spec.conversationId).toBe("-1001234567890:topic:42");
    expect(splitIds?.spec.conversationId).toBe("-1001234567890:topic:42");
    expect(canonical?.spec.agentId).toBe("claude");
    expect(canonical?.spec.backend).toBe("acpx");
    expect(splitIds?.record.targetSessionKey).toBe(canonical?.record.targetSessionKey);
  });

  it("skips telegram non-group topic configs", () => {
    const cfg = {
      ...baseCfg,
      channels: {
        telegram: {
          groups: {
            "123456789": {
              topics: {
                "42": {
                  bindings: {
                    acp: {
                      enabled: true,
                      agentId: "claude",
                    },
                  },
                },
              },
            },
          },
        },
      },
    } satisfies OpenClawConfig;

    const resolved = resolveConfiguredAcpBindingRecord({
      cfg,
      channel: "telegram",
      accountId: "default",
      conversationId: "123456789:topic:42",
    });
    expect(resolved).toBeNull();
  });
});

describe("buildConfiguredAcpSessionKey", () => {
  it("is deterministic for the same conversation binding", () => {
    const sessionKeyA = buildConfiguredAcpSessionKey({
      channel: "discord",
      accountId: "default",
      conversationId: "1478836151241412759",
      agentId: "codex",
      mode: "persistent",
    });
    const sessionKeyB = buildConfiguredAcpSessionKey({
      channel: "discord",
      accountId: "default",
      conversationId: "1478836151241412759",
      agentId: "codex",
      mode: "persistent",
    });
    expect(sessionKeyA).toBe(sessionKeyB);
  });
});
