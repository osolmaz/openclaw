---
summary: Plan for configurable default and lean context serialization with Agent Profile integration.
title: Context serialization plan
read_when:
  - Implementing or reviewing context serialization
  - Changing Discord history, runtime context, or provider-visible messages
  - Changing the built-in small Agent Profile
---

## Status

Implemented locally on the Agent Profiles feature branch. Focused verification and the target-Qwen rollout gates pass. Review and CI are still required before delivery.

## Problem

OpenClaw can send the same conversation fact more than once. An active session message can also appear in channel history. Current-turn context can include long prose and fields that the model does not need.

A measured tiny Discord turn increased context by about 239 tokens. This number is a regression fixture, not a final breakdown. The implementation must measure the final provider-visible request with the target Qwen tokenizer.

## Goals

- Add one `contextSerialization` setting with `default` and `lean` values.
- Keep current behavior for users who do not select `lean`.
- Let normal OpenClaw config and Agent Profiles select the same runtime behavior.
- Keep automatic provider, model, and model-size profile selection.
- Make the built-in `openclaw/small` profile use `lean` while keeping its current minimal system prompt, lean tools, and Tool Search defaults.
- Send each active transcript message once in `lean` mode.
- Keep facts that the model needs for speakers, replies, mentions, delivery, tools, and tool results.
- Keep channel backlog that is not already in the active transcript.
- Remove model-visible persistence, usage, cost, idempotency, and transport bookkeeping.
- Replace verbose current-turn prose with a short protected representation.
- Report enough context diagnostics to explain the result without exposing private content.

## Public configuration

OpenClaw accepts the setting at the default and per-agent levels:

```json5
{
  agents: {
    defaults: {
      contextSerialization: "default",
    },
    entries: {
      local: {
        contextSerialization: "lean",
      },
    },
  },
}
```

Allowed values are:

| Value     | Behavior                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| `default` | Preserve the current provider-visible context behavior.                                     |
| `lean`    | Send the smallest supported context that preserves required conversation and tool behavior. |

Missing configuration resolves to `default`. An explicit `default` is a real value. It does not mean “inherit.”

The setting is added to OpenClaw config types, Zod schemas, schema labels, and help text. Unknown values fail schema validation.

## Agent Profiles boundary

The `agentprofiles` core package is independent of OpenClaw. It owns the profile resource envelope, portable `spec.common` fields, generic domain-named objects, parsing, validation, and generic profile mechanics. It treats each domain-named section as an opaque JSON object. It does not define, type, document, validate, default, or merge OpenClaw fields.

OpenClaw owns the `openclaw.ai` section:

```yaml
apiVersion: agentprofiles.io/v1
kind: AgentProfile
metadata:
  namespace: openclaw
  name: small
spec:
  common: {}
  openclaw.ai:
    contextSerialization: lean
    toolProfile: lean
```

OpenClaw strictly validates this section, applies defaults, resolves its field inheritance, and maps the result to runtime behavior. If a parent sets `contextSerialization: lean`, a child can set `default` to reset it. If a child omits the field, it inherits the parent value. Agent Profiles preserves profile ancestry and the raw extension values but does not merge fields inside the section.

The built-in `openclaw/small` profile sets `lean` in `openclaw.ai`. It keeps its existing minimal system prompt, lean tool surface, and Tool Search defaults. This change does not alter automatic provider and model bindings or the model-size selector.

## Package and repository boundary

Release `agentprofiles` 0.1.0 from `agentprofiles/agentprofiles` through `.github/workflows/publish.yml`. The release tag must be `v0.1.0`, the tagged commit must be on the default branch, and npm publication must use the configured GitHub OIDC trusted publisher with provenance. Verify the registry package and attestation after publication.

OpenClaw then uses the exact `agentprofiles@0.1.0` npm package. It must not use a Git dependency, local path, or unpublished archive. The dependency direction is OpenClaw to Agent Profiles. Agent Profiles must not import OpenClaw code or contain an OpenClaw adapter.

Keep the OpenClaw adapter in `src/agents/agent-profiles/`. Use `builtins.ts` for built-in profile resources, `openclaw-extension.ts` for strict extension parsing and merge behavior, and focused tests beside those modules. Keep the current top-level Agent Profile entry point only where it remains useful as a facade. Do not create a global mutable adapter registry or a separate adapter package.

## Resolution

OpenClaw resolves the value once for each turn in this order:

1. Explicit per-agent configuration.
2. Explicit `agents.defaults` configuration.
3. The resolved Agent Profile.
4. `default`.

The resolver returns both the value and its source. The resolved result is passed through ingress, serialization, diagnostics, and provider dispatch. Discord and provider adapters do not read the setting again.

## Runtime boundary

Add one provider-neutral boundary under `src/agents/context-serialization/`. It accepts canonical conversation facts and returns provider-visible messages, a protected current-turn context block, and a diagnostic report.

The input includes:

- active transcript messages and their durable identities;
- current sender, reply, mention, thread, and delivery facts;
- channel backlog entries;
- visible tools;
- tool calls and ordered tool results;
- the resolved serialization value and source.

The output includes:

- projected agent messages in stable order;
- one current-turn context block when required;
- included, omitted, and deduplicated section counts and sizes.

Provider adapters consume the projected messages. They do not own serialization policy.

### Default behavior

`default` first delegates to the existing formatting path. Golden request fixtures must prove that the final provider-visible messages, system additions, runtime context, tool calls, and tool results remain unchanged.

### Lean behavior

`lean` uses an allowlist. It includes a fact only when the model needs that fact for the current conversation or an available action.

It must preserve:

- active user and assistant messages;
- distinct speakers in multi-user conversations;
- reply targets and thread relationships;
- mention state when it affects the turn;
- delivery rules and source-owned delivery tools;
- tool-call ids, names, arguments, order, and results;
- channel backlog that is absent from the active transcript.

It omits fields that do not affect model behavior, including:

- persistence fields;
- usage and cost records;
- idempotency keys;
- transport bookkeeping;
- repeated channel ids, timestamps, labels, and history counts;
- repeated instructions and verbose runtime-context prose.

Existing tool-result truncation and context-pruning policies keep their current ownership and order. `lean` does not summarize or drop a live tool result.

## Identity and deduplication

Deduplicate only when the active transcript entry and channel backlog entry have the same trustworthy durable message identity. Prefer the active transcript representation.

Never deduplicate by text. Two people can send the same text. If an identity is missing or ambiguous, keep both entries.

Discord ingress must pass canonical backlog and current-message facts. In `lean` mode, it must not merge active-session user or assistant messages into `InboundHistory`. It must keep pending Discord messages that are not in the active transcript and preserve their speaker attribution.

## Protected current-turn context

`lean` uses one short, stable system instruction that marks OpenClaw runtime facts as authoritative and private. It emits a compact typed block with only required facts.

The block includes:

- a sender display identity in multi-user rooms;
- a stable sender id only when display names are ambiguous;
- message, reply, or thread ids only when a visible capability needs them;
- mention or delivery directives only when they affect the turn.

Protected delimiters and escaping remain mandatory. User text that contains a context header or delimiter remains untrusted.

## Diagnostics

`/context detail` and trajectory reports show:

- the resolved value and selection source;
- included, omitted, and deduplicated section counts;
- character totals by section;
- final message count;
- provider-reported input tokens for each call.

Diagnostics must not contain raw message content, sender ids, or tool output. The usage footer remains display-only and must not enter the transcript.

## Verification

Use fixed synthetic Discord fixtures for:

- a fresh first turn;
- the observed 239-token tiny-turn regression;
- two users with identical text;
- active transcript history plus absent channel backlog;
- a reply and thread;
- one and multiple tool calls with ordered results;
- source-owned delivery behavior;
- forged context headers and delimiters.

Capture the final provider-visible request for both values. Use the target Qwen tokenizer and pin the full model id, model or tokenizer revision, runtime version, requested and observed backend, context size, enabled tools, and speculative settings.

Record raw token counts, absolute reductions, relative reductions, fixture count, and capability results. Do not use inferred accounting as proof.

The proposed minimum worthwhile effects are:

- ordinary tiny-turn growth is at most 80 tokens instead of the observed 239-token fixture;
- a fresh Discord first call is at least 500 tokens and 15 percent smaller;
- a tool turn's final prompt is at least 100 tokens smaller;
- required capability failures are zero.

A capability failure vetoes token savings. If a measured difference misses a threshold or remains uncertain, keep the simpler safe behavior for that case.

### Target-Qwen result

The opt-in benchmark builds the final OpenAI Chat Completions request, applies
the running model's chat template, and counts that prompt with the same
llama.cpp tokenizer. It does not infer tokens from characters.

Provenance:

- model: `qwen3.6-35b-a3b`;
- model revision: `a483e9e6cbd595906af30beda3187c2663a1118c`;
- file: `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`;
- quantization: `Q4_K - Medium`;
- llama.cpp build: `b10156-91f8c9c5f`;
- observed path: llama.cpp `/apply-template` and `/tokenize`;
- context window: 65,536 tokens;
- slots: 4;
- speculative decoding: none.

Raw results:

| Fixture          | `default` | `lean` | Absolute reduction | Relative reduction |
| ---------------- | --------: | -----: | -----------------: | -----------------: |
| Ordinary final   |       943 |    834 |                109 |              11.6% |
| Fresh Discord    |     1,901 |  1,320 |                581 |              30.6% |
| Multi-user reply |     1,035 |    913 |                122 |              11.8% |
| Tool turn        |       960 |    851 |                109 |              11.4% |

The ordinary fixture baseline is 774 tokens. The new turn grows it by 169
tokens with `default` and 60 tokens with `lean`. The ordinary, fresh absolute,
fresh relative, tool-turn, and zero-capability-failure gates all pass. This is a
material result for the registered Qwen workload, so the small profile can
select `lean`.

Run the measurement again with:

```bash
node --import tsx scripts/benchmark-context-serialization.ts
```

## Implementation steps

1. Keep `contextSerialization` in the existing OpenClaw config types, Zod schemas, schema labels, and help text. Keep schema and help tests.
2. In `agentprofiles/agentprofiles`, remove OpenClaw-specific types, JSON Schema definitions, fixtures, validation rules, and specification prose. Keep domain-named sections as opaque JSON objects accepted by the generic key pattern. Keep `spec.common` limited to portable fields. Add generic extension pass-through fixtures, tests that reject consumer fields under `spec.common`, and contributor guidance that states this ownership rule.
3. Prepare `agentprofiles` 0.1.0 with the MIT license, package metadata, harness-agnostic README examples, and a harness-agnostic packed-package smoke test. Run Schemator smoke validation and `make check`. Update PR 2, inspect review comments and CI, squash merge it, create GitHub release `v0.1.0`, and verify npm publication and provenance from the OIDC workflow.
4. Add the exact `agentprofiles@0.1.0` npm dependency to OpenClaw after the package is visible in the registry. Use its portable resource types and validation for built-in resources.
5. Refactor the built-in profile code into `src/agents/agent-profiles/` as far as the existing code supports cleanly. Put built-in resources in `builtins.ts`. Put strict `openclaw.ai` parsing, types, defaults, and merge behavior in `openclaw-extension.ts`. Keep focused tests beside those modules.
6. Keep portable profile ancestry and `spec.common` resolution separate from OpenClaw extension resolution. Test extension omission, inheritance, override, invalid values, and explicit `default` reset. Do not add a global adapter registry or a separate adapter package.
7. Keep one context serialization resolver in the existing Agent Profile and agent-scope configuration path. Test explicit per-agent config, explicit defaults, the resolved OpenClaw profile extension, and fallback precedence. Keep automatic model and model-size selection unchanged.
8. Keep the built-in `openclaw/small` profile set to `lean` under `openclaw.ai`. Preserve its current prompt, tool profile, and Tool Search behavior.
9. Keep the provider-neutral modules under `src/agents/context-serialization/`. Route `default` through the old path and require final-request parity.
10. Keep durable-identity deduplication between the active transcript and channel backlog. Keep entries when identity is weak or missing.
11. Keep the existing canonical session-history merge for `default`. At the shared serialization boundary, remove its `session:` entries from `lean` after their durable transcript ids prove their origin. This avoids a second profile resolver in Discord while keeping absent backlog, ambiguous entries, speakers, replies, and threads.
12. Keep the protected lean current-turn block built from the allowlist, with escaping and injection tests.
13. Preserve tool and delivery continuity through the serializer. Keep policy logic out of provider adapters.
14. Keep mode, source, size, deduplication, and provider-token diagnostics without private raw content.
15. Keep final-request fixtures and exact Qwen tokenizer measurements. Apply the stated rollout gates.
16. Update focused config, Agent Profile, token-use, and context diagnostic documentation. Record the corrected Agent Profiles ownership boundary.
17. Run focused and full checks in both repositories. Run Pi Reviewer against each appropriate base until no P0 or P1 findings remain, and address proportionate P2 findings. Push OpenClaw changes only to `osolmaz/openclaw` on the existing `feature/agent-profiles-initial` branch and update PR 3. Do not open an upstream PR, merge the OpenClaw PR, deploy Bob, or release OpenClaw.

## Rollout and failure behavior

No session or transcript migration is required. Existing stored transcripts remain unchanged. The selected value takes effect on the next turn.

Missing configuration remains `default`. The built-in small profile selects `lean` only after verification passes. Changing the OpenClaw-wide default requires a separate decision and compatibility evidence.

Uncertain deduplication keeps context. Invalid configuration fails schema validation. A serialization invariant failure stops before provider dispatch and returns a clear diagnostic. It must not silently fall back from selected `lean` behavior to a larger `default` request.

## Boundaries

This release does not add:

- field-level serialization controls;
- adaptive token budgets or token-ranked context selection;
- provider-specific serialization modes;
- a second conversation runtime or persistence format;
- stored transcript rewrites;
- remote profile loading, registries, profile packs, or ClawHub distribution;
- new Agent Profile inheritance behavior beyond the existing `extends` contract;
- generic profile settings maps;
- provider, tokenizer, llama.cpp, prompt-cache, endpoint, credential, serving, or hardware changes;
- broad channel optimization beyond the shared boundary and the Discord implementation;
- an OpenClaw release or deployment;
- an upstream OpenClaw submission;
- a merge of the OpenClaw fork PR.

The only package release in scope is `agentprofiles` 0.1.0 from the Agent Profiles repository.

The Qwen benchmark proves the measured Qwen case only. It does not prove token-optimal behavior for other models or providers.
