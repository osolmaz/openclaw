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

## Ownership

OpenClaw uses the `agentprofiles` package for the portable resource envelope,
`spec.common`, domain-section shape, and base validation. The package treats
domain-named sections as opaque JSON objects. It does not define or validate
OpenClaw fields.

OpenClaw owns `spec["openclaw.ai"]`. OpenClaw strictly validates this section
and resolves it with OpenClaw-owned defaults and inheritance rules. The resolved
values select OpenClaw runtime behavior:

```yaml
spec:
  common:
    systemPrompt:
      text: You are a concise assistant.
  openclaw.ai:
    contextSerialization: lean
    toolProfile: lean
```

The OpenClaw adapter stays in the OpenClaw repository. There is no global
adapter registry or separate adapter package. Portable profile resolution and
OpenClaw extension resolution remain separate.

## Built-in profiles

| Profile           | Parent          | Initial behavior                                                        |
| ----------------- | --------------- | ----------------------------------------------------------------------- |
| `openclaw/base`   | none            | Standard OpenClaw behavior and fallback                                 |
| `openclaw/small`  | `openclaw/base` | Minimum prompt, lean tools, Tool Search, and lean context serialization |
| `openclaw/medium` | `openclaw/base` | Base behavior with a stable medium-model identity                       |
| `openclaw/large`  | `openclaw/base` | Base behavior with a stable large-model identity                        |

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

Set context serialization independently of the selected profile:

```json5
{
  agents: {
    defaults: {
      contextSerialization: "lean",
    },
    entries: {
      fullContext: {
        contextSerialization: "default",
      },
    },
  },
}
```

Per-agent configuration overrides default configuration. Default configuration
overrides the selected profile. If none sets the value, OpenClaw uses
`default`.

## Small profile behavior

`openclaw/small` replaces the standard OpenClaw system prompt with a built-in
minimum prompt. The minimum prompt covers tool-result truth, deferred tool use,
on-demand `AGENTS.md` loading, private data, risky actions, concise replies, and
active delivery behavior. It does not inject workspace files or the skill
catalog. The model can read applicable workspace instructions and use deferred
tools when the task needs them.

The profile also removes the same heavyweight optional tools as the retired
Lean toggle: `browser`, `automations`, `message`, `image_generate`,
`music_generate`, `video_generate`, `tts`, and `pdf`.

Explicitly allowed tools and delivery-required tools remain available. When
`tools.toolSearch` is unset, the profile enables bounded structured Tool Search
with `tool_search`, `tool_describe`, and `tool_call`. Explicit Tool Search
configuration always wins.

The profile keeps `exec` directly visible. Normal tool policy, sandboxing, and
exec approvals still apply.

The profile selects `contextSerialization: "lean"` from its `openclaw.ai`
section. Lean serialization removes active-session copies from channel history
only when their durable message IDs prove that they are duplicates. It keeps unmatched backlog, ambiguous entries,
speaker attribution, reply and thread facts, mentions, delivery facts, tool
calls, and tool results. It also replaces the verbose current-turn metadata
wrapper with a short protected block. Set `contextSerialization: "default"` in
normal config to keep the previous representation while using the other small
profile behavior.

## Diagnostics

`/context detail` and `/context json` include the selected profile id and
selection source in the stored system-prompt report. They also show the direct
tool schemas used for the request. Detailed context reports show the context
serialization value and source, default and serialized character counts,
durable-ID removal counts, and provider input tokens when the provider reports
them. Reports do not include private message content.

## Legacy migration

Run `openclaw doctor --fix` to migrate
`agents.defaults.experimental.localModelLean` and per-agent equivalents.
Enabled values become `agentProfileId: "openclaw/small"`; disabled values become
`agentProfileId: "openclaw/base"` so per-agent Lean opt-outs remain opt-outs.
Doctor also migrates onboarding ownership metadata.

## Related

- [Local models](/gateway/local-models)
- [Context](/concepts/context)
- [Tool Search](/tools/tool-search)
