import path from "node:path";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { EmbeddedContextFile } from "../embedded-agent-helpers.js";
import {
  buildBootstrapContextFiles,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
  trimBootstrapContent,
  USER_BOOTSTRAP_MAX_CHARS,
} from "../embedded-agent-helpers/bootstrap.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
  readDeclaredWorkspaceContextFile,
  type WorkspaceBootstrapFile,
  workspaceFilesShareSourceIdentity,
} from "../workspace.js";
import type {
  OpenClawWorkspaceContext,
  OpenClawWorkspaceContextSection,
  WorkspaceContextOverflow,
} from "./openclaw-extension.js";
import type { ResolvedAgentProfile } from "./resolve.js";

const CANONICAL_SECTION_BY_FILE = new Map<string, WorkspaceContextCanonicalSection>([
  [DEFAULT_AGENTS_FILENAME.toLowerCase(), "agents"],
  [DEFAULT_SOUL_FILENAME.toLowerCase(), "soul"],
  [DEFAULT_IDENTITY_FILENAME.toLowerCase(), "identity"],
  [DEFAULT_USER_FILENAME.toLowerCase(), "user"],
]);

export type WorkspaceContextCanonicalSection = "agents" | "soul" | "identity" | "user";
export type WorkspaceContextTruncationCause =
  | "section-limit"
  | "additional-pool-limit"
  | "aggregate-limit";

export type WorkspaceContextAllocationEntry = {
  section: string;
  kind: "canonical" | "additional";
  path: string;
  missing: boolean;
  overflow: WorkspaceContextOverflow;
  rawChars: number;
  effectiveMaxChars: number;
  injectedChars: number;
  truncated: boolean;
  causes: WorkspaceContextTruncationCause[];
};

export type AgentProfileWorkspaceContextReport = {
  totalMaxChars: number;
  operatorMaxChars: number;
  operatorTotalMaxChars: number;
  rawChars: number;
  injectedChars: number;
  truncatedChars: number;
  entries: WorkspaceContextAllocationEntry[];
};

type WorkspaceContextSourceFile = {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
};

type AllocationEntry = {
  section: string;
  kind: "canonical" | "additional";
  source: WorkspaceContextSourceFile;
  overflow: WorkspaceContextOverflow;
  effectiveMaxChars: number;
  rawContent: string;
  rawChars: number;
  perFileContent: string;
  poolContent: string;
  finalContent: string;
  causes: WorkspaceContextTruncationCause[];
};

function normalizeDeclaredPath(value: string): string {
  return value.trim().replace(/\\/gu, "/");
}

function effectiveFileMaxChars(params: {
  name: string;
  profileMaxChars?: number;
  operatorMaxChars: number;
}): number {
  const operatorMaxChars =
    params.name.toLowerCase() === DEFAULT_USER_FILENAME.toLowerCase()
      ? Math.min(params.operatorMaxChars, USER_BOOTSTRAP_MAX_CHARS)
      : params.operatorMaxChars;
  return Math.max(1, Math.min(operatorMaxChars, params.profileMaxChars ?? operatorMaxChars));
}

function missingFileContent(file: WorkspaceContextSourceFile): string {
  return `[MISSING] Expected at: ${file.path}`;
}

function boundContent(params: {
  content: string;
  name: string;
  maxChars: number;
  overflow: WorkspaceContextOverflow;
  section: string;
}): string {
  const content = params.content.trimEnd();
  if (params.overflow === "error") {
    if (content.length > params.maxChars) {
      throw new Error(
        `Agent Profile workspace context section ${params.section} is ${content.length} chars, above its effective ${params.maxChars}-char limit with overflow=error`,
      );
    }
    return content;
  }
  return trimBootstrapContent(content, params.name, params.maxChars).content;
}

function proportionalLimits(
  entries: readonly AllocationEntry[],
  budget: number,
): Map<AllocationEntry, number> {
  const result = new Map<AllocationEntry, number>();
  const demands = entries.map((entry) => entry.finalContent.length);
  const totalDemand = demands.reduce((sum, value) => sum + value, 0);
  if (totalDemand <= budget) {
    entries.forEach((entry, index) => result.set(entry, demands[index] ?? 0));
    return result;
  }
  if (budget <= 0 || totalDemand === 0) {
    entries.forEach((entry) => result.set(entry, 0));
    return result;
  }

  const ranked = entries.map((entry, index) => {
    const exact = (demands[index]! * budget) / totalDemand;
    const floor = Math.floor(exact);
    result.set(entry, floor);
    return { entry, index, remainder: exact - floor };
  });
  let remaining = budget - [...result.values()].reduce((sum, value) => sum + value, 0);
  ranked.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const candidate of ranked) {
    if (remaining <= 0) {
      break;
    }
    result.set(candidate.entry, (result.get(candidate.entry) ?? 0) + 1);
    remaining -= 1;
  }
  return result;
}

function applyProportionalLimit(params: {
  entries: AllocationEntry[];
  budget: number;
  cause: WorkspaceContextTruncationCause;
}): void {
  const limits = proportionalLimits(params.entries, params.budget);
  for (const entry of params.entries) {
    const limit = limits.get(entry) ?? 0;
    if (limit >= entry.finalContent.length) {
      continue;
    }
    entry.causes.push(params.cause);
    entry.finalContent =
      limit > 0 ? trimBootstrapContent(entry.rawContent, entry.source.name, limit).content : "";
  }
}

function sectionPolicy(
  policy: OpenClawWorkspaceContext,
  section: WorkspaceContextCanonicalSection,
): OpenClawWorkspaceContextSection {
  return policy.sections?.[section] ?? {};
}

function makeAllocationEntry(params: {
  section: string;
  kind: "canonical" | "additional";
  source: WorkspaceContextSourceFile;
  overflow: WorkspaceContextOverflow;
  maxChars?: number;
  operatorMaxChars: number;
}): AllocationEntry {
  const rawContent = params.source.missing
    ? missingFileContent(params.source)
    : (params.source.content ?? "").trimEnd();
  const effectiveMaxChars = effectiveFileMaxChars({
    name: params.source.name,
    profileMaxChars: params.maxChars,
    operatorMaxChars: params.operatorMaxChars,
  });
  const perFileContent = boundContent({
    content: rawContent,
    name: params.source.name,
    maxChars: effectiveMaxChars,
    overflow: params.overflow,
    section: params.section,
  });
  return {
    section: params.section,
    kind: params.kind,
    source: params.source,
    overflow: params.overflow,
    effectiveMaxChars,
    rawContent,
    rawChars: rawContent.length,
    perFileContent,
    poolContent: perFileContent,
    finalContent: perFileContent,
    causes: perFileContent.length < rawContent.length ? ["section-limit"] : [],
  };
}

async function loadAdditionalFiles(params: {
  policy: OpenClawWorkspaceContext;
  workspaceDir: string;
  canonicalFiles: readonly WorkspaceContextSourceFile[];
  operatorMaxChars: number;
}): Promise<AllocationEntry[]> {
  const additional = params.policy.additional;
  if (!additional?.files?.length) {
    return [];
  }
  const canonicalPaths = new Set(params.canonicalFiles.map((file) => path.resolve(file.path)));
  const entries: AllocationEntry[] = [];
  for (const declaration of additional.files) {
    const relativePath = normalizeDeclaredPath(declaration.path);
    const loaded = await readDeclaredWorkspaceContextFile({
      workspaceDir: params.workspaceDir,
      relativePath,
    });
    if (!loaded.ok) {
      const detail = loaded.error instanceof Error ? loaded.error.message : loaded.reason;
      throw new Error(
        `Unable to load declared Agent Profile workspace context ${relativePath}: ${detail}`,
      );
    }
    if (
      canonicalPaths.has(path.resolve(loaded.path)) ||
      params.canonicalFiles.some((file) => workspaceFilesShareSourceIdentity(file, loaded))
    ) {
      throw new Error(
        `Declared Agent Profile workspace context ${relativePath} duplicates a canonical workspace file`,
      );
    }
    entries.push(
      makeAllocationEntry({
        section: `additional:${relativePath}`,
        kind: "additional",
        source: {
          name: path.basename(relativePath),
          path: loaded.path,
          content: loaded.content,
          missing: false,
        },
        overflow: declaration.overflow ?? additional.overflow ?? "truncate",
        maxChars: declaration.maxChars ?? additional.maxCharsPerFile,
        operatorMaxChars: params.operatorMaxChars,
      }),
    );
  }
  return entries;
}

function applyAdditionalPool(entries: AllocationEntry[], policy: OpenClawWorkspaceContext): void {
  const additional = entries.filter((entry) => entry.kind === "additional");
  if (additional.length === 0) {
    return;
  }
  const poolLimit = policy.additional?.totalMaxChars;
  if (poolLimit === undefined) {
    return;
  }
  const protectedChars = additional
    .filter((entry) => entry.overflow === "error")
    .reduce((sum, entry) => sum + entry.finalContent.length, 0);
  if (protectedChars > poolLimit) {
    throw new Error(
      `Protected Agent Profile additional workspace context requires ${protectedChars} chars, above its ${poolLimit}-char pool limit`,
    );
  }
  applyProportionalLimit({
    entries: additional.filter((entry) => entry.overflow === "truncate"),
    budget: poolLimit - protectedChars,
    cause: "additional-pool-limit",
  });
  for (const entry of additional) {
    entry.poolContent = entry.finalContent;
  }
}

function applyAggregateLimit(entries: AllocationEntry[], totalMaxChars: number): void {
  const protectedChars = entries
    .filter((entry) => entry.overflow === "error")
    .reduce((sum, entry) => sum + entry.finalContent.length, 0);
  if (protectedChars > totalMaxChars) {
    throw new Error(
      `Protected Agent Profile workspace context requires ${protectedChars} chars, above its effective ${totalMaxChars}-char aggregate limit`,
    );
  }
  applyProportionalLimit({
    entries: entries.filter((entry) => entry.overflow === "truncate"),
    budget: totalMaxChars - protectedChars,
    cause: "aggregate-limit",
  });
}

export async function prepareAgentProfileWorkspaceContext(params: {
  resolvedProfile: ResolvedAgentProfile;
  bootstrapFiles: WorkspaceBootstrapFile[];
  workspaceDir: string;
  config?: OpenClawConfig;
  agentId?: string | null;
  warn?: (message: string) => void;
}): Promise<
  | {
      sourceFiles: WorkspaceContextSourceFile[];
      contextFiles: EmbeddedContextFile[];
      report: AgentProfileWorkspaceContextReport;
    }
  | undefined
> {
  const policy = params.resolvedProfile.profile.spec["openclaw.ai"]?.prompt?.workspaceContext;
  if (!policy) {
    return undefined;
  }

  const operatorMaxChars = resolveBootstrapMaxChars(params.config, params.agentId);
  const operatorTotalMaxChars = resolveBootstrapTotalMaxChars(params.config, params.agentId);
  const totalMaxChars = Math.min(
    policy.totalMaxChars ?? operatorTotalMaxChars,
    operatorTotalMaxChars,
  );
  const canonicalFiles: WorkspaceContextSourceFile[] = [];
  const passthroughFiles: WorkspaceBootstrapFile[] = [];
  const entries: AllocationEntry[] = [];

  for (const file of params.bootstrapFiles) {
    const section = CANONICAL_SECTION_BY_FILE.get(file.name.toLowerCase());
    if (!section) {
      passthroughFiles.push(file);
      continue;
    }
    const sectionConfig = sectionPolicy(policy, section);
    if (sectionConfig.include === false) {
      continue;
    }
    canonicalFiles.push(file);
    entries.push(
      makeAllocationEntry({
        section,
        kind: "canonical",
        source: file,
        overflow: sectionConfig.overflow ?? "truncate",
        maxChars: sectionConfig.maxChars,
        operatorMaxChars,
      }),
    );
  }

  entries.push(
    ...(await loadAdditionalFiles({
      policy,
      workspaceDir: params.workspaceDir,
      canonicalFiles,
      operatorMaxChars,
    })),
  );
  applyAdditionalPool(entries, policy);
  applyAggregateLimit(entries, totalMaxChars);

  const managedContextFiles = entries
    .filter((entry) => entry.finalContent.length > 0)
    .map((entry) => ({ path: entry.source.path, content: entry.finalContent }));
  const managedChars = managedContextFiles.reduce((sum, file) => sum + file.content.length, 0);
  const remainingOperatorChars = operatorTotalMaxChars - managedChars;
  const passthroughContextFiles =
    remainingOperatorChars > 0
      ? buildBootstrapContextFiles(passthroughFiles, {
          maxChars: operatorMaxChars,
          totalMaxChars: remainingOperatorChars,
          warn: params.warn,
        })
      : [];

  for (const entry of entries) {
    if (entry.finalContent.length < entry.rawChars) {
      params.warn?.(
        `Agent Profile workspace context ${entry.section} is ${entry.rawChars} chars; injecting ${entry.finalContent.length} chars (${entry.causes.join(", ")})`,
      );
    }
  }

  const sourceFiles = [...entries.map((entry) => entry.source), ...passthroughFiles];
  const contextFiles = [...managedContextFiles, ...passthroughContextFiles];
  const rawChars = entries.reduce((sum, entry) => sum + entry.rawChars, 0);
  const injectedChars = entries.reduce((sum, entry) => sum + entry.finalContent.length, 0);
  return {
    sourceFiles,
    contextFiles,
    report: {
      totalMaxChars,
      operatorMaxChars,
      operatorTotalMaxChars,
      rawChars,
      injectedChars,
      truncatedChars: Math.max(0, rawChars - injectedChars),
      entries: entries.map((entry) => ({
        section: entry.section,
        kind: entry.kind,
        path: entry.source.path,
        missing: entry.source.missing,
        overflow: entry.overflow,
        rawChars: entry.rawChars,
        effectiveMaxChars: entry.effectiveMaxChars,
        injectedChars: entry.finalContent.length,
        truncated: entry.finalContent.length < entry.rawChars,
        causes: entry.causes,
      })),
    },
  };
}
