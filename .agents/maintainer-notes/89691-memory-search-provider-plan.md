# Issue 89691 Memory Search Provider Plan

This is a narrow implementation plan for `openclaw/openclaw#89691`.
It intentionally avoids the broader provider-handle architecture.

## Goal

Stop embedded `active-memory` recall from silently using FTS-only keyword search when a concrete memory embedding provider is configured but missing at runtime.

Keyword-only fallback should remain valid for intentional FTS-only mode and for approved local/auto degradation. It should not hide a lost configured provider such as `openai`.

## Current Problem

`MemoryIndexManager` treats `this.provider === null` as FTS-only search.
That state currently covers several different cases:

- user intentionally configured `provider: "none"`
- auto/local embeddings degraded and fallback is acceptable
- the configured provider adapter was never visible
- an embedded runtime searched with a stale or different provider registry

The last two cases should be unavailable errors, not keyword-only fallback.

## Proposed Fix

1. Add a small provider requirement classifier near memory config/provider state resolution.
   It should distinguish:
   - `fts-only`: explicit `provider: "none"`
   - `optional`: `auto` or local/auto paths where degradation can fall back
   - `required`: explicit concrete provider ids such as `openai`, `ollama`, or `my-openai-compatible`

2. Thread that classification into `MemoryIndexManager` state.
   Keep it local to the memory manager/provider state boundary. Do not add a new public config field.

3. Change the FTS-only branch in `MemoryIndexManager.search()`.
   If `providerRequirement === "required"` and `this.provider` is null, return or throw a structured provider-unavailable error before keyword search.

4. Preserve current FTS behavior for legitimate cases.
   `provider: "none"` should still search FTS.
   Local worker degradation should keep the existing local-degraded path and fallback handling.
   Auto-selection should only fall back when the current product behavior already allows it.

5. Improve diagnostics for the required-provider-missing case.
   Include:
   - requested provider id
   - current provider lifecycle state
   - registered memory embedding provider ids
   - agent id
   - whether this is default, status, or CLI manager purpose

6. Let `memory_search` surface that error as its existing unavailable result.
   The tool already has `buildMemorySearchUnavailableResult()` and a 15s deadline.
   Reuse that shape instead of adding another result format.

7. Ensure `active-memory` treats the unavailable memory-search result as terminal.
   Current code already watches terminal `memory_search` unavailable records.
   Add coverage proving the new provider-missing result takes that path instead of timing out.

## Likely Files

- `extensions/memory-core/src/memory/manager-provider-state.ts`
- `extensions/memory-core/src/memory/manager.ts`
- `extensions/memory-core/src/memory/embeddings.ts`
- `extensions/memory-core/src/tools.ts`
- `extensions/active-memory/index.ts`
- `src/plugins/memory-embedding-provider-runtime.ts`

## Tests

Add focused coverage before broad integration work.

1. Memory manager unit test:
   - config has `agents.defaults.memorySearch.provider = "openai"`
   - no `openai` memory embedding adapter is registered
   - search does not enter FTS-only keyword fallback
   - result is provider-unavailable with requested provider diagnostics

2. FTS-only preservation test:
   - config has `provider = "none"`
   - no provider registered
   - search still returns keyword results

3. Local degradation preservation test:
   - local provider fails with the existing local worker failure shape
   - manager marks local degraded
   - existing fallback behavior remains unchanged

4. Active-memory regression:
   - embedded active-memory invokes `memory_search`
   - configured provider is required but unavailable
   - active-memory returns `status: "unavailable"` or equivalent terminal unavailable state
   - it does not wait for the full active-memory watchdog

## Non-Goals

- Do not redesign provider capability loading around immutable runtime handles.
- Do not add new user config.
- Do not remove intentional FTS-only mode.
- Do not make all provider misses fatal; only explicit required providers should fail fast.
- Do not solve startup plugin planning here. That belongs to `#89651` / `#89652`.

## Product Decision Needed

Confirm the policy:

When `memorySearch.provider` is an explicit concrete provider and that provider is missing at runtime, OpenClaw should fail fast with a visible unavailable result instead of silently falling back to FTS-only search.

If maintainers agree, the implementation can stay narrow and production-ready without the broader provider-handle refactor.

## Suggested Verification

Use the narrow local runner first:

```sh
node scripts/run-vitest.mjs extensions/memory-core/src/memory/index.test.ts extensions/memory-core/src/tools.test.ts extensions/active-memory/index.test.ts src/plugins/memory-runtime.test.ts
```

If the fix touches plugin runtime lookup or activation, follow with the relevant plugin registry tests and `pnpm build` in the approved remote/Testbox path.
