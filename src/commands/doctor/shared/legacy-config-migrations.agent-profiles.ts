import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "../../../config/legacy.shared.js";
import { isBlockedObjectKey } from "../../../infra/prototype-keys.js";

function hasLegacyLeanFlag(value: unknown): boolean {
  const experimental = getRecord(getRecord(value)?.experimental);
  return experimental ? Object.hasOwn(experimental, "localModelLean") : false;
}

function hasAgentEntryLeanFlag(value: unknown): boolean {
  const entries = getRecord(value);
  return entries
    ? Object.entries(entries).some(
        ([id, entry]) => !isBlockedObjectKey(id) && hasLegacyLeanFlag(entry),
      )
    : false;
}

function hasAgentListLeanFlag(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => hasLegacyLeanFlag(entry));
}

const LEGACY_AGENT_PROFILE_RULES: LegacyConfigRule[] = [
  {
    path: ["agents", "defaults", "experimental", "localModelLean"],
    message:
      'agents.defaults.experimental.localModelLean moved to agents.defaults.agentProfileId. Run "openclaw doctor --fix".',
  },
  {
    path: ["agents", "entries"],
    message:
      'agents.entries.*.experimental.localModelLean moved to agentProfileId. Run "openclaw doctor --fix".',
    match: hasAgentEntryLeanFlag,
  },
  {
    path: ["agents", "list"],
    message:
      'agents.list[].experimental.localModelLean moved to agentProfileId. Run "openclaw doctor --fix".',
    match: hasAgentListLeanFlag,
  },
  {
    path: ["wizard", "localModelLeanAutoModel"],
    message:
      'wizard.localModelLeanAutoModel moved to wizard.agentProfileAutoModel. Run "openclaw doctor --fix".',
  },
];

function migrateLegacyLeanFlag(
  agent: Record<string, unknown>,
  pathLabel: string,
  changes: string[],
): void {
  const experimental = getRecord(agent.experimental);
  if (!experimental || !Object.hasOwn(experimental, "localModelLean")) {
    return;
  }
  const leanEnabled = experimental.localModelLean === true;
  if (leanEnabled && agent.agentProfileId === undefined) {
    agent.agentProfileId = "openclaw/small";
    changes.push(`Moved ${pathLabel}.experimental.localModelLean → ${pathLabel}.agentProfileId.`);
  } else {
    changes.push(
      leanEnabled
        ? `Removed ${pathLabel}.experimental.localModelLean; kept the explicit Agent Profile.`
        : `Removed ${pathLabel}.experimental.localModelLean.`,
    );
  }
  delete experimental.localModelLean;
  if (Object.keys(experimental).length === 0) {
    delete agent.experimental;
  }
}

function migrateLegacyAgentProfiles(raw: Record<string, unknown>, changes: string[]): void {
  const agents = getRecord(raw.agents);
  if (agents) {
    const defaults = getRecord(agents.defaults);
    if (defaults) {
      migrateLegacyLeanFlag(defaults, "agents.defaults", changes);
    }
    const entries = getRecord(agents.entries);
    if (entries) {
      for (const [id, entry] of Object.entries(entries)) {
        if (isBlockedObjectKey(id)) {
          continue;
        }
        const agent = getRecord(entry);
        if (agent) {
          migrateLegacyLeanFlag(agent, `agents.entries.${id}`, changes);
        }
      }
    }
    if (Array.isArray(agents.list)) {
      for (const [index, entry] of agents.list.entries()) {
        const agent = getRecord(entry);
        if (agent) {
          migrateLegacyLeanFlag(agent, `agents.list[${index}]`, changes);
        }
      }
    }
  }

  const wizard = getRecord(raw.wizard);
  if (!wizard || !Object.hasOwn(wizard, "localModelLeanAutoModel")) {
    return;
  }
  if (wizard.agentProfileAutoModel === undefined) {
    wizard.agentProfileAutoModel = wizard.localModelLeanAutoModel;
    changes.push("Moved wizard.localModelLeanAutoModel → wizard.agentProfileAutoModel.");
  } else {
    changes.push("Removed wizard.localModelLeanAutoModel; kept wizard.agentProfileAutoModel.");
  }
  delete wizard.localModelLeanAutoModel;
}

export const LEGACY_CONFIG_MIGRATIONS_AGENT_PROFILES: LegacyConfigMigrationSpec[] = [
  defineLegacyConfigMigration({
    id: "agents.localModelLean->agentProfileId",
    describe: "Move legacy local-model Lean settings to Agent Profiles",
    legacyRules: LEGACY_AGENT_PROFILE_RULES,
    apply: migrateLegacyAgentProfiles,
  }),
];
