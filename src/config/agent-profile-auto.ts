import { isCloudModelRef } from "@openclaw/model-catalog-core/model-catalog-refs";
import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import type { OpenClawConfig } from "./types.openclaw.js";

const AUTO_SMALL_PROFILE_PROVIDER_IDS = new Set(["lmstudio", "ollama"]);

function shouldAutoSelectSmallProfile(providerId: string, modelRef: string): boolean {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!AUTO_SMALL_PROFILE_PROVIDER_IDS.has(normalizedProviderId)) {
    return false;
  }
  if (normalizedProviderId !== "ollama") {
    return true;
  }
  return !isCloudModelRef(modelRef);
}

function resolveDefaultModelRef(config: OpenClawConfig): string | undefined {
  const model = config.agents?.defaults?.model;
  return typeof model === "string" ? model : model?.primary;
}

function clearAutoModel(config: OpenClawConfig): OpenClawConfig {
  const wizard = { ...config.wizard };
  delete wizard.agentProfileAutoModel;
  return { ...config, wizard };
}

/** Maintains onboarding-owned profile selection while preserving explicit user configuration. */
export function applyAutoAgentProfile(params: {
  config: OpenClawConfig;
  providerId: string;
  modelRef: string;
  previousModelRef?: string;
}): {
  config: OpenClawConfig;
  changed: boolean;
  enabled: boolean;
} {
  const selector = params.config.agents?.defaults?.agentProfileId;
  const autoModel = params.config.wizard?.agentProfileAutoModel;
  const onboardingOwnsSetting =
    autoModel !== undefined &&
    (params.previousModelRef ?? resolveDefaultModelRef(params.config)) === autoModel;
  if (!shouldAutoSelectSmallProfile(params.providerId, params.modelRef)) {
    if (!autoModel) {
      return { config: params.config, changed: false, enabled: false };
    }
    const config = clearAutoModel(params.config);
    if (!onboardingOwnsSetting || selector !== "openclaw/small") {
      return { config, changed: true, enabled: false };
    }
    const defaults = { ...params.config.agents?.defaults };
    delete defaults.agentProfileId;
    return {
      config: {
        ...config,
        agents: {
          ...config.agents,
          defaults,
        },
      },
      changed: true,
      enabled: false,
    };
  }
  if (selector !== undefined) {
    if (!autoModel) {
      return { config: params.config, changed: false, enabled: false };
    }
    if (!onboardingOwnsSetting || selector !== "openclaw/small") {
      return { config: clearAutoModel(params.config), changed: true, enabled: false };
    }
    if (autoModel === params.modelRef) {
      return { config: params.config, changed: false, enabled: false };
    }
    return {
      config: {
        ...params.config,
        wizard: { ...params.config.wizard, agentProfileAutoModel: params.modelRef },
      },
      changed: true,
      enabled: false,
    };
  }
  return {
    config: {
      ...params.config,
      wizard: {
        ...params.config.wizard,
        agentProfileAutoModel: params.modelRef,
      },
      agents: {
        ...params.config.agents,
        defaults: {
          ...params.config.agents?.defaults,
          agentProfileId: "openclaw/small",
        },
      },
    },
    changed: true,
    enabled: true,
  };
}
