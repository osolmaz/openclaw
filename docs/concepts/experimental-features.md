---
summary: "What experimental flags mean in OpenClaw and which ones are currently documented"
title: "Experimental features"
read_when:
  - You see an `.experimental` config key and want to know whether it is stable
  - You want to try preview runtime features without confusing them with normal defaults
  - You want one place to find the currently documented experimental flags
---

Experimental features are preview surfaces controlled by config flags. They need more real-world mileage before their shape and behavior become long-lived contracts.

- Off by default unless the feature docs state otherwise. Swarm is enabled by default with an explicit opt-out.
- Shape and behavior can change faster than stable config.
- Prefer a stable path when one already exists.
- Roll out broadly only after testing in a smaller environment first.

All [plugin APIs](/plugins/sdk-overview#api-stability) are also experimental.
That stability label does not require a Labs switch for ordinary plugins; the
Custom plugin UI flag below controls user-installed native browser code only.

## Currently documented flags

| Surface          | Key                                                                     | Use it when                                                                                                                       | More                                                                                   |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex harness    | `plugins.entries.codex.config.appServer.experimental.sandboxExecServer` | You want native Codex app-server 0.143.0 or newer to target an OpenClaw sandbox-backed exec-server instead of disabling Code Mode | [Codex harness reference](/plugins/codex-harness-reference#sandboxed-native-execution) |
| Code Mode        | `tools.codeMode.enabled`                                                | You want compact code-orchestrated access to a hidden OpenClaw tool catalog                                                       | [Code Mode](/tools/code-mode)                                                          |
| Cloud workers    | `cloudWorkers.desktop`                                                  | You want to watch or control desktop-capable cloud worker environments from the Control UI                                        | [Cloud Worker Desktop](/gateway/cloud-workers#desktop-interactive)                     |
| Custom plugin UI | `gateway.controlUi.experimental.customPlugins`                          | You want trusted user-installed plugins to add native Control UI views or replace built-in views                                  | [Feature plugins](/plugins/feature-plugins#enable-custom-plugin-ui)                    |
| Swarm            | `tools.swarm.enabled`                                                   | You want Code Mode scripts to orchestrate bounded groups of sub-agents in parallel                                                | [Swarm](/tools/swarm)                                                                  |

## Control UI Labs

Open **Settings → Agents & Tools → Labs** to manage experiments that have a
Control UI switch. Enabling or disabling a lab patches the canonical Gateway
config immediately; the page shows a restart hint only when a feature requires
one.

Labs includes Code Mode, Swarm, Tool Search, Custom plugin UI,
Tool-loop detection, Lean tools for local models, Message audit metadata, and
Cloud Worker Desktop. Message audit metadata, Cloud Worker Desktop, and Custom
plugin UI require a Gateway restart. Custom plugin UI also requires reloading
connected browser tabs; the other listed switches normally take effect for
future agent runs without restarting.

Custom plugin UI is off by default. Enabled bundled plugins, including
Workboard, retain their native UI with the setting off. Backend APIs and
ordinary plugins remain available, and installing or approving a plugin
artifact does not enable the lab.

Code Mode remains disabled until you turn on its Labs switch or explicitly set
`tools.codeMode` to `true` or `"auto"`. The Labs switch writes `"auto"`, so it
engages only for models marked as preferred Code Mode performers; it does not
force Code Mode on for every model.

Swarm is enabled by default, including when `tools.swarm` is omitted or sets
only limits. Turn off its Labs switch, set `tools.swarm: false`, or set
`tools.swarm.enabled: false` to opt out. Per-agent overrides remain available;
an agent that sets only limits inherits global enablement. Swarm does not
enable Code Mode or grant tools: Code Mode's Swarm API requires an executable
native `sessions_spawn` tool, while the low-level flow also requires
`agents_wait`. See [Swarm requirements](/tools/swarm#requirements).

## Experimental does not mean hidden

An experimental feature should say so plainly in docs and in the config path itself, not hide behind a stable-looking default knob.

## Related

- [Agent Profiles](/concepts/agent-profiles)
- [Features](/concepts/features)
- [Release channels](/install/development-channels)
