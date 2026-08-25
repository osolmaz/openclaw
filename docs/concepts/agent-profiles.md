---
summary: "How OpenClaw selects model-specific prompt and tool behavior"
title: "Agent Profiles"
read_when:
  - You want OpenClaw to select a smaller tool surface for a model
  - You need to override automatic model-profile selection
  - You are migrating from experimental.localModelLean
---

Agent Profiles are named, validated sets of agent-harness behavior. OpenClaw
selects one profile after it resolves the model and before it builds the tool
surface.

Agent Profiles do not select a model or change provider transport, credentials,
context-window settings, or local serving configuration.

## Built-in profiles

| Profile           | Parent          | Initial behavior                                   |
| ----------------- | --------------- | -------------------------------------------------- |
| `openclaw/base`   | none            | Standard OpenClaw behavior and fallback            |
| `openclaw/small`  | `openclaw/base` | Lean direct tools and bounded Tool Search defaults |
| `openclaw/medium` | `openclaw/base` | Base behavior with a stable medium-model identity  |
| `openclaw/large`  | `openclaw/base` | Base behavior with a stable large-model identity   |

## Automatic selection

An omitted selector behaves like `auto`. OpenClaw uses this order:

1. Explicit per-agent profile.
2. Explicit default profile.
3. Exact model binding.
4. Trusted model-size binding.
5. `openclaw/base`.

The built-in registry binds `llama-cpp/qwen3.6-35b-a3b` to
`openclaw/small`. An exact model binding takes precedence over model size.

Trusted model-size classes select these profiles:

| Model-size class | Profile           |
| ---------------- | ----------------- |
| `tiny`           | `openclaw/small`  |
| `small`          | `openclaw/small`  |
| `medium`         | `openclaw/medium` |
| `large`          | `openclaw/large`  |

OpenClaw does not infer parameter count from model names. Trusted configured
metadata uses `models.providers.<provider>.models[].modelSizeClass`. Unknown
model-size metadata falls back to `openclaw/base` unless an exact binding
matches.

## Configuration

Use automatic selection globally:

```json5
{
  agents: {
    defaults: {
      agentProfileId: "auto",
    },
  },
}
```

Select a profile explicitly:

```json5
{
  agents: {
    defaults: {
      agentProfileId: "openclaw/small",
    },
  },
}
```

Override one agent:

```json5
{
  agents: {
    defaults: {
      agentProfileId: "auto",
    },
    entries: {
      local: {
        model: "llama-cpp/qwen3.6-35b-a3b",
        agentProfileId: "openclaw/small",
      },
    },
  },
}
```

## Small profile behavior

`openclaw/small` removes heavyweight optional tools from the direct model
surface: `browser`, `automations`, `message`, `image_generate`,
`music_generate`, `video_generate`, `tts`, and `pdf`.

Explicitly allowed tools and delivery-required tools remain available. When
`tools.toolSearch` is unset, the profile enables bounded structured Tool Search
with `tool_search`, `tool_describe`, and `tool_call`. Explicit Tool Search
configuration always wins.

The profile keeps `exec` directly visible. Normal tool policy, sandboxing, and
exec approvals still apply.

## Diagnostics

`/context detail` and `/context json` include the selected profile id and
selection source in the stored system-prompt report. They also show the direct
tool schemas used for the request.

## Legacy migration

Run `openclaw doctor --fix` to migrate
`agents.defaults.experimental.localModelLean` and per-agent equivalents.
Enabled values become `agentProfileId: "openclaw/small"`; disabled values are
removed. Doctor also migrates onboarding ownership metadata.

## Related

- [Local models](/gateway/local-models)
- [Context](/concepts/context)
- [Tool Search](/tools/tool-search)
