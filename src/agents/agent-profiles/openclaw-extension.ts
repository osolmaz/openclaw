import type { AgentProfileResource } from "agentprofiles";
import { z } from "zod";
import {
  CONTEXT_SERIALIZATION_MODES,
  type ContextSerialization,
} from "../../config/context-serialization.js";

const AGENT_PROFILE_EXTENSION_SECTION = "openclaw.ai";

const openClawAgentProfileExtensionSchema = z
  .object({
    contextSerialization: z.enum(CONTEXT_SERIALIZATION_MODES).optional(),
    toolProfile: z.literal("lean").optional(),
  })
  .strict();

export type OpenClawAgentProfileExtension = {
  contextSerialization?: ContextSerialization;
  toolProfile?: "lean";
};

function formatOpenClawExtensionError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function parseOpenClawAgentProfileExtension(params: {
  profileId: string;
  value: unknown;
}): OpenClawAgentProfileExtension | undefined {
  if (params.value === undefined) {
    return undefined;
  }
  const parsed = openClawAgentProfileExtensionSchema.safeParse(params.value);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${AGENT_PROFILE_EXTENSION_SECTION} section in Agent Profile ${params.profileId}: ${formatOpenClawExtensionError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function resolveOpenClawAgentProfileExtension(
  ancestry: readonly {
    id: string;
    resource: AgentProfileResource;
  }[],
): OpenClawAgentProfileExtension | undefined {
  let resolved: OpenClawAgentProfileExtension | undefined;
  for (const profile of ancestry) {
    const extension = parseOpenClawAgentProfileExtension({
      profileId: profile.id,
      value: profile.resource.spec[AGENT_PROFILE_EXTENSION_SECTION],
    });
    if (extension) {
      resolved ??= {};
      Object.assign(resolved, extension);
    }
  }
  return resolved;
}
