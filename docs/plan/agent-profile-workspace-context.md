---
summary: Plan for OpenClaw-owned workspace-context controls in Agent Profiles.
title: Agent Profile workspace context plan
read_when:
  - Implementing or reviewing Agent Profile prompt controls
  - Changing workspace-file injection or bootstrap budgets
  - Changing the built-in small Agent Profile
---

## Status

Implementation is in progress on the existing Agent Profiles fork branch. The OpenClaw pull request must remain unmerged until local verification, review, and CI are complete.

## Problem

The built-in `openclaw/small` profile currently replaces the complete OpenClaw system prompt. This keeps the prompt small, but it also removes normal workspace identity. A model can then know that it runs in OpenClaw without knowing the configured assistant name.

OpenClaw also has operator bootstrap limits, but an Agent Profile cannot yet select a smaller, compositional workspace-file budget. The existing sequential total limit does not divide a small budget fairly across several useful files.

## Ownership

The `agentprofiles` package owns only the portable resource envelope, portable `spec.common` fields, and generic domain-section shape. It treats `spec["openclaw.ai"]` as opaque data.

OpenClaw owns all fields below `spec["openclaw.ai"].prompt.workspaceContext`, including parsing, strict validation, inheritance, defaults, file loading, allocation, diagnostics, and runtime mapping. The OpenClaw adapter stays in `src/agents/agent-profiles/`. There is no global adapter registry and no separate adapter package.

Prompt workspace context, conversation serialization, skills, tool schemas, tool selection, and memory are separate controls.

## Profile contract

The OpenClaw extension can contain this shape:

```yaml
spec:
  openclaw.ai:
    prompt:
      workspaceContext:
        totalMaxChars: 8000
        sections:
          identity:
            include: true
            maxChars: 1024
            overflow: error
          soul:
            include: true
            maxChars: 2048
            overflow: truncate
          user:
            include: true
            maxChars: 2048
            overflow: truncate
          agents:
            include: true
            maxChars: 4096
            overflow: truncate
        additional:
          maxCharsPerFile: 1000
          totalMaxChars: 2000
          overflow: truncate
          files:
            - path: PROJECT.md
```

Canonical section names map to these workspace files:

| Section    | File          |
| ---------- | ------------- |
| `agents`   | `AGENTS.md`   |
| `soul`     | `SOUL.md`     |
| `identity` | `IDENTITY.md` |
| `user`     | `USER.md`     |

A section is included unless `include` is `false`. An omitted field inherits from the parent profile. Child scalar fields replace parent scalar fields. Known section objects merge by section name. Additional file entries merge by normalized path, and a child entry replaces fields for the same path.

Additional files must be declared with exact workspace-relative paths. Absolute paths, empty paths, traversal outside the workspace, glob patterns, and duplicate normalized paths are invalid. OpenClaw does not scan for undeclared files.

`BOOTSTRAP.md`, `BOOT.md`, and memory are not additional workspace-context sections. Their existing lifecycle and privacy rules remain separate.

## Allocation

OpenClaw applies these steps in order:

1. Load canonical files through the existing guarded workspace loader.
2. Load only declared additional files through the same workspace containment and file-size guards.
3. Remove sections with `include: false`.
4. Compute each file's effective limit as the lower of the profile limit and the existing operator or runtime file limit.
5. For `overflow: error`, reject content that exceeds its effective file limit. Otherwise reserve its actual bounded size in full.
6. For `overflow: truncate`, cap the file to its effective file limit with the existing UTF-safe truncation marker.
7. Apply the additional-file pool limit to truncatable additional files.
8. Reserve all protected content. If protected content alone exceeds the aggregate profile budget, stop with a clear error.
9. Divide the remaining aggregate budget across truncatable content in proportion to each file's actual bounded size. Use deterministic largest-remainder rounding with the original file order as the tie-breaker.
10. Emit context files in stable canonical order followed by declared additional-file order.

The aggregate budget uses characters because OpenClaw can enforce it before provider tokenization. It is not an exact token limit. The built-in `openclaw/small` value is 8,000 characters, which is a rough 2,000-token proxy at four characters per token.

Existing operator limits, privacy gates, workspace containment, source identity checks, file-size security limits, and runtime hard limits remain upper ceilings. A profile can tighten these limits but cannot increase them.

## Diagnostics and failures

The stored system-prompt report records the selected profile budget, actual raw and injected character totals, per-section allocation, truncation causes, missing declared files, and load failures. It does not store file content.

Invalid extension data fails Agent Profile resolution. A protected section that exceeds its effective file limit, protected content that cannot fit the aggregate budget, an unsafe custom path, or a guarded load failure produces a clear error before provider dispatch. The runtime must not silently fall back to a larger prompt.

## Built-in small profile

`openclaw/small` no longer sets `spec.common.systemPrompt`. It uses the normal OpenClaw prompt composer and the OpenClaw-owned workspace-context policy. It keeps `IDENTITY.md` available, uses an 8,000-character aggregate workspace-context cap, and keeps lean context serialization, lean tools, Tool Search defaults, and automatic model selection.

This change does not add an alias or alter a model runtime. The profile's workspace budget does not claim that the complete provider request is below 2,000 tokens.

## Verification

Focused tests must cover:

- strict extension validation;
- deep inheritance and explicit child replacement;
- canonical and declared additional sections;
- undeclared-file exclusion;
- workspace containment and guarded load failures;
- per-file, additional-pool, and aggregate limits;
- protected identity and protected-content failures;
- deterministic proportional scaling and UTF-safe truncation;
- operator limits as upper ceilings;
- report diagnostics without raw content;
- composed prompt output that contains the configured identity for `openclaw/small`.

Run the focused Agent Profile, bootstrap, prompt, report, configuration, and context-serialization tests. Run the context-serialization benchmark and retain its registered Qwen gates. Then run the full repository check, Pi Reviewer against the existing pull-request base, comment inspection, and relevant CI. Push only the existing `feature/agent-profiles-initial` branch to `osolmaz/openclaw`, update pull request 3, and leave it unmerged.

## Boundaries

This work does not:

- change the portable Agent Profiles package or its schema;
- add provider-specific prompt controls;
- impose an exact tokenizer-based total prompt limit;
- change conversation serialization semantics;
- change skills, tool schemas, tool selection, or memory lifecycle;
- scan or inject undeclared workspace files;
- add a compatibility path, adapter package, or mutable registry;
- change a model runtime, alias, deployment, or Bob state;
- open an upstream OpenClaw pull request;
- merge or release OpenClaw.
