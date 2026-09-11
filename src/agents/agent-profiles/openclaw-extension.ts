import path from "node:path";
import type { AgentProfileResource } from "agentprofiles";
import { z } from "zod";
import {
  CONTEXT_SERIALIZATION_MODES,
  type ContextSerialization,
} from "../../config/context-serialization.js";

const AGENT_PROFILE_EXTENSION_SECTION = "openclaw.ai";
const WORKSPACE_CONTEXT_OVERFLOW_MODES = ["truncate", "error"] as const;

const positiveCharsSchema = z.number().int().positive();
const workspaceContextOverflowSchema = z.enum(WORKSPACE_CONTEXT_OVERFLOW_MODES);
const workspaceContextSectionSchema = z
  .object({
    include: z.boolean().optional(),
    maxChars: positiveCharsSchema.optional(),
    overflow: workspaceContextOverflowSchema.optional(),
  })
  .strict();

function normalizeDeclaredPath(value: string): string {
  return value.trim().replace(/\\/gu, "/");
}

function isSafeDeclaredPath(value: string): boolean {
  const normalized = normalizeDeclaredPath(value);
  if (
    !normalized ||
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    /[*?[\]{}]/u.test(normalized)
  ) {
    return false;
  }
  const segments = normalized.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const additionalWorkspaceContextFileSchema = z
  .object({
    path: z
      .string()
      .refine(
        isSafeDeclaredPath,
        "must be an exact workspace-relative path without traversal or globs",
      ),
    maxChars: positiveCharsSchema.optional(),
    overflow: workspaceContextOverflowSchema.optional(),
  })
  .strict();

const additionalWorkspaceContextSchema = z
  .object({
    maxCharsPerFile: positiveCharsSchema.optional(),
    totalMaxChars: positiveCharsSchema.optional(),
    overflow: workspaceContextOverflowSchema.optional(),
    files: z
      .array(additionalWorkspaceContextFileSchema)
      .superRefine((files, ctx) => {
        const seen = new Set<string>();
        for (const [index, file] of files.entries()) {
          const normalized = normalizeDeclaredPath(file.path);
          if (seen.has(normalized)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "path"],
              message: `duplicate declared path: ${normalized}`,
            });
          }
          seen.add(normalized);
        }
      })
      .optional(),
  })
  .strict();

const workspaceContextSchema = z
  .object({
    totalMaxChars: positiveCharsSchema.optional(),
    sections: z
      .object({
        agents: workspaceContextSectionSchema.optional(),
        soul: workspaceContextSectionSchema.optional(),
        identity: workspaceContextSectionSchema.optional(),
        user: workspaceContextSectionSchema.optional(),
      })
      .strict()
      .optional(),
    additional: additionalWorkspaceContextSchema.optional(),
  })
  .strict();

const openClawAgentProfileExtensionSchema = z
  .object({
    contextSerialization: z.enum(CONTEXT_SERIALIZATION_MODES).optional(),
    toolProfile: z.literal("lean").optional(),
    prompt: z
      .object({
        workspaceContext: workspaceContextSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WorkspaceContextOverflow = (typeof WORKSPACE_CONTEXT_OVERFLOW_MODES)[number];
export type OpenClawWorkspaceContextSection = z.infer<typeof workspaceContextSectionSchema>;
export type OpenClawAdditionalWorkspaceContextFile = z.infer<
  typeof additionalWorkspaceContextFileSchema
>;
export type OpenClawWorkspaceContext = z.infer<typeof workspaceContextSchema>;

export type OpenClawAgentProfileExtension = {
  contextSerialization?: ContextSerialization;
  toolProfile?: "lean";
  prompt?: {
    workspaceContext?: OpenClawWorkspaceContext;
  };
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

function mergeWorkspaceContext(
  parent: OpenClawWorkspaceContext | undefined,
  child: OpenClawWorkspaceContext,
): OpenClawWorkspaceContext {
  const mergedAdditionalFiles = new Map<string, OpenClawAdditionalWorkspaceContextFile>();
  for (const file of parent?.additional?.files ?? []) {
    mergedAdditionalFiles.set(normalizeDeclaredPath(file.path), file);
  }
  for (const file of child.additional?.files ?? []) {
    const normalized = normalizeDeclaredPath(file.path);
    mergedAdditionalFiles.set(normalized, {
      ...mergedAdditionalFiles.get(normalized),
      ...file,
      path: normalized,
    });
  }

  const sections =
    parent?.sections || child.sections
      ? {
          ...(parent?.sections?.agents || child.sections?.agents
            ? { agents: { ...parent?.sections?.agents, ...child.sections?.agents } }
            : {}),
          ...(parent?.sections?.soul || child.sections?.soul
            ? { soul: { ...parent?.sections?.soul, ...child.sections?.soul } }
            : {}),
          ...(parent?.sections?.identity || child.sections?.identity
            ? { identity: { ...parent?.sections?.identity, ...child.sections?.identity } }
            : {}),
          ...(parent?.sections?.user || child.sections?.user
            ? { user: { ...parent?.sections?.user, ...child.sections?.user } }
            : {}),
        }
      : undefined;
  const additional =
    parent?.additional || child.additional
      ? {
          ...parent?.additional,
          ...child.additional,
          ...(mergedAdditionalFiles.size > 0
            ? { files: [...mergedAdditionalFiles.values()] }
            : child.additional?.files
              ? { files: [] }
              : {}),
        }
      : undefined;

  return {
    ...parent,
    ...child,
    ...(sections ? { sections } : {}),
    ...(additional ? { additional } : {}),
  };
}

function mergeOpenClawExtension(
  parent: OpenClawAgentProfileExtension | undefined,
  child: OpenClawAgentProfileExtension,
): OpenClawAgentProfileExtension {
  const childWorkspaceContext = child.prompt?.workspaceContext;
  const prompt =
    parent?.prompt || child.prompt
      ? {
          ...parent?.prompt,
          ...child.prompt,
          ...(childWorkspaceContext
            ? {
                workspaceContext: mergeWorkspaceContext(
                  parent?.prompt?.workspaceContext,
                  childWorkspaceContext,
                ),
              }
            : {}),
        }
      : undefined;
  return {
    ...parent,
    ...child,
    ...(prompt ? { prompt } : {}),
  };
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
      resolved = mergeOpenClawExtension(resolved, extension);
    }
  }
  return resolved;
}
