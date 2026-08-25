---
summary: "What experimental flags mean in OpenClaw and which ones are currently documented"
title: "Experimental features"
read_when:
  - You see an `.experimental` config key and want to know whether it is stable
  - You want to try preview runtime features without confusing them with normal defaults
  - You want one place to find the currently documented experimental flags
---

Experimental features are preview surfaces behind explicit flags. They need more real-world mileage before they get a stable default or a long-lived contract.

- Off by default unless a doc describes a narrow automatic setup rule.
- Shape and behavior can change faster than stable config.
- Prefer a stable path when one already exists.
- Roll out broadly only after testing in a smaller environment first.

## Currently documented flags

| Surface       | Key                                                                     | Use it when                                                                                                                       | More                                                                                   |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex harness | `plugins.entries.codex.config.appServer.experimental.sandboxExecServer` | You want native Codex app-server 0.143.0 or newer to target an OpenClaw sandbox-backed exec-server instead of disabling Code Mode | [Codex harness reference](/plugins/codex-harness-reference#sandboxed-native-execution) |
| Code Mode     | `tools.codeMode.enabled`                                                | You want compact code-orchestrated access to a hidden OpenClaw tool catalog                                                       | [Code Mode](/tools/code-mode)                                                          |
| Cloud workers | `cloudWorkers.desktop`                                                  | You want to watch or control desktop-capable cloud worker environments from the Control UI                                        | [Cloud Worker Desktop](/gateway/cloud-workers#desktop-interactive)                     |
| Swarm         | `tools.swarm.enabled`                                                   | You want Code Mode scripts to orchestrate bounded groups of sub-agents in parallel                                                | [Swarm](/tools/swarm)                                                                  |

## Control UI Labs

Open **Settings → Agents & Tools → Labs** to manage experiments that have a
Control UI switch. Enabling or disabling a lab patches the canonical Gateway
config immediately; the page shows a restart hint only when a feature requires
one.

The currently shipped Labs entries are Code Mode, Swarm, Tool Search,
Tool-loop detection, Message audit metadata, and Cloud Worker Desktop. Message audit metadata and Cloud Worker Desktop require a
Gateway restart; the other switches normally take effect for future agent runs
without restarting.

## Experimental does not mean hidden

An experimental feature should say so plainly in docs and in the config path itself, not hide behind a stable-looking default knob.

## Related

- [Agent Profiles](/concepts/agent-profiles)
- [Features](/concepts/features)
- [Release channels](/install/development-channels)
