import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  SandboxAgent,
  SandboxAgentEntrypointScope,
  SandboxAgentRuntimeSourceConfig,
  SandboxAgentRuntimeSourceMode,
  SandboxAgentTriggerType,
  SandboxAgentUpdateInput,
  SandboxAgentUpsertInput,
  SandboxProject,
  SandboxProjectSourceType,
  SandboxProjectUpdateInput,
  SandboxProjectUpsertInput,
} from "../sandbox/types/index";
import {
  optionString,
  optionalJsonObject,
  parseBooleanOption,
  parseCsvOption,
  parseSandboxRuntimeModeOption,
  parseSandboxRuntimePromotionPolicyOption,
  requiredTeamId,
  resolveSandboxClient,
  runCommand,
} from "./common";

const PROJECT_SOURCE_UPLOAD_MAX_FILES = 1500;
const PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
const PROJECT_SOURCE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export function parseProjectSourceType(
  value: string | boolean | undefined
): SandboxProjectSourceType {
  const sourceType =
    typeof value === "string" && value.trim() ? value.trim() : "manual";
  if (
    sourceType !== "github_repo" &&
    sourceType !== "internal_repo" &&
    sourceType !== "template" &&
    sourceType !== "manual"
  ) {
    throw new Error(
      "source-type must be one of github_repo, internal_repo, template, manual"
    );
  }
  return sourceType;
}

export function parseAgentEntrypointScope(
  value: string | boolean | undefined
): SandboxAgentEntrypointScope | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("entrypoint-scope must be a non-empty value");
  }
  const scope = value.trim() as SandboxAgentEntrypointScope;
  if (
    scope !== "entire_manifest" &&
    scope !== "start" &&
    scope !== "action" &&
    scope !== "service" &&
    scope !== "schedule"
  ) {
    throw new Error(
      "entrypoint-scope must be one of entire_manifest, start, action, service, schedule"
    );
  }
  return scope;
}

export function parseAgentTriggerType(
  value: string | boolean | undefined
): SandboxAgentTriggerType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("trigger-type must be a non-empty value");
  }
  const triggerType = value.trim() as SandboxAgentTriggerType;
  if (
    triggerType !== "manual" &&
    triggerType !== "schedule" &&
    triggerType !== "endpoint" &&
    triggerType !== "background"
  ) {
    throw new Error(
      "trigger-type must be one of manual, schedule, endpoint, background"
    );
  }
  return triggerType;
}

export function parseAgentRuntimeSourceMode(
  value: string | boolean | undefined
): SandboxAgentRuntimeSourceMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("runtime-source-mode must be a non-empty value");
  }
  const mode = value.trim() as SandboxAgentRuntimeSourceMode;
  if (
    mode !== "latest_source" &&
    mode !== "published_snapshot" &&
    mode !== "auto"
  ) {
    throw new Error(
      "runtime-source-mode must be one of latest_source, published_snapshot, auto"
    );
  }
  return mode;
}

export function buildAgentRuntimeSourceConfig(
  options: Record<string, string | boolean>
): Partial<SandboxAgentRuntimeSourceConfig> | undefined {
  const mode = parseAgentRuntimeSourceMode(options.runtimeSourceMode);
  const sourceRef = optionString(options, "sourceRef");
  const sourceCommitSha = optionString(options, "sourceCommitSha");
  const publishedSnapshotId =
    optionString(options, "publishedSnapshotId") ||
    optionString(options, "snapshotId");
  const publishedSnapshotName =
    optionString(options, "publishedSnapshotName") ||
    optionString(options, "snapshotName");
  const publishedSnapshotVersion =
    optionString(options, "publishedSnapshotVersion") ||
    optionString(options, "snapshotVersion");
  const buildStatus = optionString(options, "buildStatus");
  const validationStatus = optionString(options, "validationStatus");
  const validatedAt = optionString(options, "validatedAt");
  const config: Partial<SandboxAgentRuntimeSourceConfig> = {
    ...(mode ? { mode } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(sourceCommitSha ? { sourceCommitSha } : {}),
    ...(publishedSnapshotId ? { publishedSnapshotId } : {}),
    ...(publishedSnapshotName ? { publishedSnapshotName } : {}),
    ...(publishedSnapshotVersion ? { publishedSnapshotVersion } : {}),
    ...(buildStatus ? { buildStatus } : {}),
    ...(validationStatus ? { validationStatus } : {}),
    ...(validatedAt ? { validatedAt } : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
}

function buildAgentRuntimeSourcePolicy(
  options: Record<string, string | boolean>,
  source: "manual" | "diagnostic" = "manual"
) {
  const requirePublishedSnapshot = parseBooleanOption(
    options.requirePublishedSnapshot
  );
  const allowLatestSource = parseBooleanOption(options.allowLatestSource);
  if (!requirePublishedSnapshot && !allowLatestSource && source === "manual") {
    return undefined;
  }
  return {
    source,
    ...(requirePublishedSnapshot ? { requirePublishedSnapshot } : {}),
    ...(allowLatestSource || source === "diagnostic"
      ? { allowLatestSource: allowLatestSource || source === "diagnostic" }
      : {}),
  };
}

export function buildProjectUpsertInput(
  options: Record<string, string | boolean>
): SandboxProjectUpsertInput {
  const usage = "usage: project create --team-id <id> --name <name>";
  const teamId = requiredTeamId(options, usage);
  const name = optionString(options, "name");
  if (!name) {
    throw new Error(
      `${usage} [--source-type manual|github_repo|internal_repo|template]`
    );
  }
  const sourceType = parseProjectSourceType(options.sourceType);
  const repoUrl =
    optionString(options, "repoUrl") || optionString(options, "repo");
  const sourceConfig = {
    ...(optionalJsonObject(options, "sourceConfig", "source-config") ?? {}),
    ...(repoUrl ? { repoUrl } : {}),
  };
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  return {
    teamId,
    name,
    sourceType,
    ...(optionString(options, "slug")
      ? { slug: optionString(options, "slug") }
      : {}),
    ...(optionString(options, "description")
      ? { description: optionString(options, "description") }
      : {}),
    ...(options.status === "active" ||
    options.status === "disabled" ||
    options.status === "archived"
      ? { status: options.status }
      : {}),
    ...(Object.keys(sourceConfig).length > 0 ? { sourceConfig } : {}),
    ...(optionString(options, "normalizedSourceIdentity")
      ? {
          normalizedSourceIdentity: optionString(
            options,
            "normalizedSourceIdentity"
          ),
        }
      : {}),
    ...(optionString(options, "externalId")
      ? { externalId: optionString(options, "externalId") }
      : {}),
    ...(optionString(options, "gitProvider")
      ? { gitProvider: optionString(options, "gitProvider") }
      : {}),
    ...(optionString(options, "gitHost")
      ? { gitHost: optionString(options, "gitHost") }
      : {}),
    ...(optionString(options, "gitOwner")
      ? { gitOwner: optionString(options, "gitOwner") }
      : {}),
    ...(optionString(options, "gitRepo")
      ? { gitRepo: optionString(options, "gitRepo") }
      : {}),
    ...(optionString(options, "gitBranch")
      ? { gitBranch: optionString(options, "gitBranch") }
      : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "internalRepoPath")
      ? { internalRepoPath: optionString(options, "internalRepoPath") }
      : {}),
    ...(optionString(options, "templateSourceProjectId")
      ? {
          templateSourceProjectId: optionString(
            options,
            "templateSourceProjectId"
          ),
        }
      : {}),
    ...(optionString(options, "templateRepoUrl")
      ? { templateRepoUrl: optionString(options, "templateRepoUrl") }
      : {}),
    ...(optionString(options, "templateBranch")
      ? { templateBranch: optionString(options, "templateBranch") }
      : {}),
    ...(optionString(options, "templateRemoteSha")
      ? { templateRemoteSha: optionString(options, "templateRemoteSha") }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function buildProjectUpdateInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxProjectUpdateInput {
  const repoUrl =
    optionString(options, "repoUrl") || optionString(options, "repo");
  const sourceConfig = optionalJsonObject(
    options,
    "sourceConfig",
    "source-config"
  );
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  return {
    teamId,
    ...(optionString(options, "name")
      ? { name: optionString(options, "name") }
      : {}),
    ...(optionString(options, "slug")
      ? { slug: optionString(options, "slug") }
      : {}),
    ...(optionString(options, "description")
      ? { description: optionString(options, "description") }
      : {}),
    ...(options.status === "active" ||
    options.status === "disabled" ||
    options.status === "archived"
      ? { status: options.status }
      : {}),
    ...(options.sourceType !== undefined
      ? { sourceType: parseProjectSourceType(options.sourceType) }
      : {}),
    ...(sourceConfig || repoUrl
      ? {
          sourceConfig: {
            ...(sourceConfig ?? {}),
            ...(repoUrl ? { repoUrl } : {}),
          },
        }
      : {}),
    ...(optionString(options, "normalizedSourceIdentity")
      ? {
          normalizedSourceIdentity: optionString(
            options,
            "normalizedSourceIdentity"
          ),
        }
      : {}),
    ...(optionString(options, "externalId")
      ? { externalId: optionString(options, "externalId") }
      : {}),
    ...(optionString(options, "gitProvider")
      ? { gitProvider: optionString(options, "gitProvider") }
      : {}),
    ...(optionString(options, "gitHost")
      ? { gitHost: optionString(options, "gitHost") }
      : {}),
    ...(optionString(options, "gitOwner")
      ? { gitOwner: optionString(options, "gitOwner") }
      : {}),
    ...(optionString(options, "gitRepo")
      ? { gitRepo: optionString(options, "gitRepo") }
      : {}),
    ...(optionString(options, "gitBranch")
      ? { gitBranch: optionString(options, "gitBranch") }
      : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "internalRepoPath")
      ? { internalRepoPath: optionString(options, "internalRepoPath") }
      : {}),
    ...(optionString(options, "templateSourceProjectId")
      ? {
          templateSourceProjectId: optionString(
            options,
            "templateSourceProjectId"
          ),
        }
      : {}),
    ...(optionString(options, "templateRepoUrl")
      ? { templateRepoUrl: optionString(options, "templateRepoUrl") }
      : {}),
    ...(optionString(options, "templateBranch")
      ? { templateBranch: optionString(options, "templateBranch") }
      : {}),
    ...(optionString(options, "templateRemoteSha")
      ? { templateRemoteSha: optionString(options, "templateRemoteSha") }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function buildAgentUpsertInput(
  options: Record<string, string | boolean>
): SandboxAgentUpsertInput {
  const usage =
    "usage: agent create --team-id <id> --project-id <id> --name <name>";
  const teamId = requiredTeamId(options, usage);
  const projectId = optionString(options, "projectId");
  const name = optionString(options, "name");
  if (!projectId || !name) {
    throw new Error(usage);
  }
  const entrypointScope = parseAgentEntrypointScope(options.entrypointScope);
  const entrypointName = optionString(options, "entrypointName");
  const triggerType = parseAgentTriggerType(options.triggerType);
  const runtimeMode = parseSandboxRuntimeModeOption(options.runtimeMode);
  const promotionPolicy = parseSandboxRuntimePromotionPolicyOption(
    options.runtimePromotionPolicy
  );
  const runtimeSource = buildAgentRuntimeSourceConfig(options);
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  return {
    teamId,
    projectId,
    name,
    ...(optionString(options, "slug")
      ? { slug: optionString(options, "slug") }
      : {}),
    ...(optionString(options, "description")
      ? { description: optionString(options, "description") }
      : {}),
    ...(options.status === "active" ||
    options.status === "disabled" ||
    options.status === "archived"
      ? { status: options.status }
      : {}),
    ...(entrypointScope
      ? {
          selectedEntrypoint: {
            scope: entrypointScope,
            name: entrypointName || null,
          },
        }
      : {}),
    ...(triggerType ? { triggerType } : {}),
    ...(runtimeMode ? { defaultRuntimeMode: runtimeMode } : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "sourceRefOverride")
      ? { sourceRefOverride: optionString(options, "sourceRefOverride") }
      : {}),
    ...(promotionPolicy ? { defaultPromotionPolicy: promotionPolicy } : {}),
    ...(runtimeSource ? { runtimeSource } : {}),
    ...(optionalJsonObject(options, "endpointPolicy", "endpoint-policy")
      ? {
          endpointPolicy: optionalJsonObject(
            options,
            "endpointPolicy",
            "endpoint-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(
      options,
      "backgroundTaskPolicy",
      "background-task-policy"
    )
      ? {
          backgroundTaskPolicy: optionalJsonObject(
            options,
            "backgroundTaskPolicy",
            "background-task-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "resourcePolicy", "resource-policy")
      ? {
          defaultResourcePolicy: optionalJsonObject(
            options,
            "resourcePolicy",
            "resource-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "lifecyclePolicy", "lifecycle-policy")
      ? {
          defaultLifecyclePolicy: optionalJsonObject(
            options,
            "lifecyclePolicy",
            "lifecycle-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "checkpointPolicy", "checkpoint-policy")
      ? {
          defaultCheckpointPolicy: optionalJsonObject(
            options,
            "checkpointPolicy",
            "checkpoint-policy"
          ),
        }
      : {}),
    ...(parseCsvOption(options.requiredIntegrations).length > 0
      ? {
          requiredIntegrationRefs: parseCsvOption(options.requiredIntegrations),
        }
      : {}),
    ...(parseCsvOption(options.requiredEnv).length > 0
      ? { requiredEnvironmentVariableRefs: parseCsvOption(options.requiredEnv) }
      : {}),
    ...(optionalJsonObject(options, "schedulePolicy", "schedule-policy")
      ? {
          schedulePolicy: optionalJsonObject(
            options,
            "schedulePolicy",
            "schedule-policy"
          ),
        }
      : {}),
    ...(optionString(options, "externalId")
      ? { externalId: optionString(options, "externalId") }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function buildAgentUpdateInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxAgentUpdateInput {
  const entrypointScope = parseAgentEntrypointScope(options.entrypointScope);
  const entrypointName = optionString(options, "entrypointName");
  const triggerType = parseAgentTriggerType(options.triggerType);
  const runtimeMode = parseSandboxRuntimeModeOption(options.runtimeMode);
  const promotionPolicy = parseSandboxRuntimePromotionPolicyOption(
    options.runtimePromotionPolicy
  );
  const runtimeSource = buildAgentRuntimeSourceConfig(options);
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  return {
    teamId,
    ...(optionString(options, "projectId")
      ? { projectId: optionString(options, "projectId") }
      : {}),
    ...(optionString(options, "name")
      ? { name: optionString(options, "name") }
      : {}),
    ...(optionString(options, "slug")
      ? { slug: optionString(options, "slug") }
      : {}),
    ...(optionString(options, "description")
      ? { description: optionString(options, "description") }
      : {}),
    ...(options.status === "active" ||
    options.status === "disabled" ||
    options.status === "archived"
      ? { status: options.status }
      : {}),
    ...(entrypointScope
      ? {
          selectedEntrypoint: {
            scope: entrypointScope,
            name: entrypointName || null,
          },
        }
      : {}),
    ...(triggerType ? { triggerType } : {}),
    ...(runtimeMode ? { defaultRuntimeMode: runtimeMode } : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "sourceRefOverride")
      ? { sourceRefOverride: optionString(options, "sourceRefOverride") }
      : {}),
    ...(promotionPolicy ? { defaultPromotionPolicy: promotionPolicy } : {}),
    ...(runtimeSource ? { runtimeSource } : {}),
    ...(optionalJsonObject(options, "endpointPolicy", "endpoint-policy")
      ? {
          endpointPolicy: optionalJsonObject(
            options,
            "endpointPolicy",
            "endpoint-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(
      options,
      "backgroundTaskPolicy",
      "background-task-policy"
    )
      ? {
          backgroundTaskPolicy: optionalJsonObject(
            options,
            "backgroundTaskPolicy",
            "background-task-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "resourcePolicy", "resource-policy")
      ? {
          defaultResourcePolicy: optionalJsonObject(
            options,
            "resourcePolicy",
            "resource-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "lifecyclePolicy", "lifecycle-policy")
      ? {
          defaultLifecyclePolicy: optionalJsonObject(
            options,
            "lifecyclePolicy",
            "lifecycle-policy"
          ),
        }
      : {}),
    ...(optionalJsonObject(options, "checkpointPolicy", "checkpoint-policy")
      ? {
          defaultCheckpointPolicy: optionalJsonObject(
            options,
            "checkpointPolicy",
            "checkpoint-policy"
          ),
        }
      : {}),
    ...(parseCsvOption(options.requiredIntegrations).length > 0
      ? {
          requiredIntegrationRefs: parseCsvOption(options.requiredIntegrations),
        }
      : {}),
    ...(parseCsvOption(options.requiredEnv).length > 0
      ? { requiredEnvironmentVariableRefs: parseCsvOption(options.requiredEnv) }
      : {}),
    ...(optionalJsonObject(options, "schedulePolicy", "schedule-policy")
      ? {
          schedulePolicy: optionalJsonObject(
            options,
            "schedulePolicy",
            "schedule-policy"
          ),
        }
      : {}),
    ...(optionString(options, "externalId")
      ? { externalId: optionString(options, "externalId") }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function formatProjectLine(project: SandboxProject): string {
  const source = project.gitRepo
    ? `${project.gitOwner ?? "_"}/${project.gitRepo}`
    : project.internalRepoPath ??
      project.templateRepoUrl ??
      project.normalizedSourceIdentity;
  return [
    project.id,
    project.status,
    project.sourceType,
    project.name,
    source,
  ].join("  ");
}

export function formatAgentLine(agent: SandboxAgent): string {
  const entrypoint = agent.selectedEntrypoint.name
    ? `${agent.selectedEntrypoint.scope}:${agent.selectedEntrypoint.name}`
    : agent.selectedEntrypoint.scope;
  const runtimeSource = agent.runtimeSource
    ? [
        agent.runtimeSource.mode,
        agent.runtimeSource.publishedSnapshotName ??
          agent.runtimeSource.publishedSnapshotId ??
          agent.runtimeSource.sourceRef,
      ]
        .filter((value): value is string => Boolean(value))
        .join(":")
    : "latest_source";
  return [
    agent.id,
    agent.status,
    agent.triggerType,
    agent.defaultRuntimeMode,
    runtimeSource,
    entrypoint,
    agent.name,
  ].join("  ");
}

function isSafeProjectSourcePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.includes("\0") &&
    !path.isAbsolute(filePath) &&
    !filePath.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")
  );
}

function shouldSkipProjectSourcePath(filePath: string): boolean {
  return filePath.split(/[\\/]+/).some((segment) => {
    const lower = segment.toLowerCase();
    return (
      lower === ".git" ||
      lower === "node_modules" ||
      lower === ".next" ||
      lower === ".turbo" ||
      lower.startsWith(".env")
    );
  });
}

async function resolveProjectSourceUploadBranch(
  projectPath: string,
  options: Record<string, string | boolean>
): Promise<string | null> {
  const explicit = optionString(options, "branch");
  if (explicit) return explicit;
  const branch = await runCommand("git", ["branch", "--show-current"], {
    cwd: projectPath,
  });
  if (branch.code !== 0) return null;
  return branch.stdout.trim() || null;
}

async function collectProjectSourceUploadEntries(projectPath: string): Promise<{
  entries: Array<{ path: string; type: "file"; contentsBase64: string }>;
  fileCount: number;
  totalBytes: number;
}> {
  const files = await runCommand(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: projectPath }
  );
  if (files.code !== 0) {
    throw new Error(
      `git ls-files failed: ${
        files.stderr.trim() || files.stdout.trim() || "unknown error"
      }`
    );
  }

  const sourcePaths = files.stdout
    .split("\0")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter((filePath) => {
      const normalized = filePath.replace(/\\/g, "/");
      return (
        isSafeProjectSourcePath(normalized) &&
        !shouldSkipProjectSourcePath(normalized)
      );
    });
  if (sourcePaths.length === 0) {
    throw new Error("no source files found to upload");
  }
  if (sourcePaths.length > PROJECT_SOURCE_UPLOAD_MAX_FILES) {
    throw new Error(
      `too many source files to upload: ${sourcePaths.length} > ${PROJECT_SOURCE_UPLOAD_MAX_FILES}`
    );
  }

  let totalBytes = 0;
  const entries: Array<{ path: string; type: "file"; contentsBase64: string }> = [];
  for (const sourcePath of sourcePaths.sort()) {
    const absolutePath = path.resolve(projectPath, sourcePath);
    const relative = path.relative(projectPath, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`source path escapes project: ${sourcePath}`);
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) continue;
    if (stat.size > PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES) {
      throw new Error(
        `source file is too large: ${sourcePath} (${stat.size} bytes)`
      );
    }
    totalBytes += stat.size;
    if (totalBytes > PROJECT_SOURCE_UPLOAD_MAX_BYTES) {
      throw new Error(
        `source upload is too large: ${totalBytes} > ${PROJECT_SOURCE_UPLOAD_MAX_BYTES}`
      );
    }
    entries.push({
      path: sourcePath.replace(/\\/g, "/"),
      type: "file",
      contentsBase64: Buffer.from(await fs.readFile(absolutePath)).toString(
        "base64"
      ),
    });
  }

  return { entries, fileCount: entries.length, totalBytes };
}

export async function runProjectCommand(
  options: Record<string, string | boolean>,
  rest: string[]
): Promise<void> {
  const subcommand = rest[0] || "list";
  const client = await resolveSandboxClient(options);

  if (subcommand === "list") {
    const teamId = requiredTeamId(options, "usage: project list");
    const projects = await client.projects.list({ teamId });
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify({ projects }, null, 2));
      return;
    }
    if (projects.length === 0) {
      console.log("no sandbox projects found");
      return;
    }
    for (const project of projects) {
      console.log(formatProjectLine(project));
    }
    return;
  }

  if (subcommand === "create" || subcommand === "upsert") {
    const project = await client.projects.upsert(
      buildProjectUpsertInput(options)
    );
    console.log(JSON.stringify({ project }, null, 2));
    return;
  }

  if (subcommand === "get") {
    const projectId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: project get <projectId>");
    if (!projectId) {
      throw new Error("usage: project get <projectId> --team-id <id>");
    }
    const project = await client.projects.get(projectId, { teamId });
    console.log(JSON.stringify({ project }, null, 2));
    return;
  }

  if (subcommand === "update") {
    const projectId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: project update <projectId>");
    if (!projectId) {
      throw new Error("usage: project update <projectId> --team-id <id>");
    }
    const project = await client.projects.update(
      projectId,
      buildProjectUpdateInput(teamId, options)
    );
    console.log(JSON.stringify({ project }, null, 2));
    return;
  }

  if (subcommand === "sync") {
    const projectId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: project sync <projectId>");
    if (!projectId) {
      throw new Error("usage: project sync <projectId> --team-id <id>");
    }
    const project = await client.projects.sync(projectId, { teamId });
    console.log(JSON.stringify({ project }, null, 2));
    return;
  }

  if (subcommand === "source-upload" || subcommand === "upload-source") {
    const projectId = rest[1]?.trim();
    const teamId = requiredTeamId(
      options,
      "usage: project source-upload <projectId>"
    );
    if (!projectId) {
      throw new Error(
        "usage: project source-upload <projectId> --team-id <id> [--path <dir>]"
      );
    }
    const projectPath = path.resolve(optionString(options, "path") || ".");
    const branch = await resolveProjectSourceUploadBranch(projectPath, options);
    const commitMessage =
      optionString(options, "commitMessage") ||
      optionString(options, "commit-message") ||
      "Upload OpenPond project source";
    const collected = await collectProjectSourceUploadEntries(projectPath);
    const project = await client.projects.uploadSource(projectId, {
      teamId,
      entries: collected.entries,
      ...(branch ? { branch } : {}),
      commitMessage,
    });
    console.log(
      JSON.stringify(
        {
          project,
          uploaded: {
            path: projectPath,
            branch,
            fileCount: collected.fileCount,
            totalBytes: collected.totalBytes,
          },
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "archive") {
    const projectId = rest[1]?.trim();
    const teamId = requiredTeamId(
      options,
      "usage: project archive <projectId>"
    );
    if (!projectId) {
      throw new Error("usage: project archive <projectId> --team-id <id>");
    }
    const project = await client.projects.archive(projectId, { teamId });
    console.log(JSON.stringify({ project }, null, 2));
    return;
  }

  throw new Error(
    "usage: project <list|create|upsert|get|update|sync|source-upload|archive> [--team-id <id>] [--name <name>]"
  );
}

export async function runAgentCommand(
  options: Record<string, string | boolean>,
  rest: string[]
): Promise<void> {
  const subcommand = rest[0] || "list";
  const client = await resolveSandboxClient(options);

  if (subcommand === "list") {
    const teamId = requiredTeamId(options, "usage: agent list");
    const agents = await client.agents.list({ teamId });
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify({ agents }, null, 2));
      return;
    }
    if (agents.length === 0) {
      console.log("no sandbox agents found");
      return;
    }
    for (const agent of agents) {
      console.log(formatAgentLine(agent));
    }
    return;
  }

  if (subcommand === "create" || subcommand === "upsert") {
    const agent = await client.agents.upsert(buildAgentUpsertInput(options));
    console.log(JSON.stringify({ agent }, null, 2));
    return;
  }

  if (subcommand === "get") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: agent get <agentId>");
    if (!agentId) {
      throw new Error("usage: agent get <agentId> --team-id <id>");
    }
    const agent = await client.agents.get(agentId, { teamId });
    console.log(JSON.stringify({ agent }, null, 2));
    return;
  }

  if (subcommand === "run") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: agent run <agentId>");
    if (!agentId) {
      throw new Error("usage: agent run <agentId> --team-id <id>");
    }
    const idempotencyKey = optionString(options, "idempotencyKey");
    const triggerType = parseAgentTriggerType(options.triggerType);
    const runtimeMode = parseSandboxRuntimeModeOption(options.runtimeMode);
    const inputObject = optionalJsonObject(options, "input", "input");
    const metadata = optionalJsonObject(options, "metadata", "metadata");
    const runtimeSourcePolicy = buildAgentRuntimeSourcePolicy(options);
    const result = await client.agents.run(agentId, {
      teamId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(triggerType ? { triggerType } : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(inputObject ? { input: inputObject } : {}),
      ...(metadata ? { metadata } : {}),
      ...(runtimeSourcePolicy ? { runtimeSourcePolicy } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "bind-runtime-source" || subcommand === "bind-source") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(
      options,
      "usage: agent bind-runtime-source <agentId>"
    );
    if (!agentId) {
      throw new Error(
        "usage: agent bind-runtime-source <agentId> --team-id <id> --runtime-source-mode latest_source|published_snapshot|auto"
      );
    }
    const runtimeSource = buildAgentRuntimeSourceConfig(options);
    if (!runtimeSource?.mode) {
      throw new Error(
        "usage: agent bind-runtime-source <agentId> --team-id <id> --runtime-source-mode latest_source|published_snapshot|auto"
      );
    }
    const agent = await client.agents.update(agentId, {
      teamId,
      runtimeSource,
    });
    console.log(JSON.stringify({ agent, runtimeSource: agent.runtimeSource }, null, 2));
    return;
  }

  if (subcommand === "run-test") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: agent run-test <agentId>");
    if (!agentId) {
      throw new Error("usage: agent run-test <agentId> --team-id <id>");
    }
    const idempotencyKey = optionString(options, "idempotencyKey");
    const inputObject = optionalJsonObject(options, "input", "input");
    const metadata = optionalJsonObject(options, "metadata", "metadata");
    const runtimeMode = parseSandboxRuntimeModeOption(options.runtimeMode);
    const result = await client.agents.run(agentId, {
      teamId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(inputObject ? { input: inputObject } : {}),
      metadata: {
        ...(metadata ?? {}),
        source: "agent_run_test",
      },
      runtimeSourcePolicy: buildAgentRuntimeSourcePolicy(
        options,
        "diagnostic"
      ),
    });
    console.log(
      JSON.stringify(
        {
          resolvedRuntimeSource: result.run.runtimeSource,
          agent: result.agent,
          run: result.run,
          sandbox: result.sandbox ?? null,
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "update") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: agent update <agentId>");
    if (!agentId) {
      throw new Error("usage: agent update <agentId> --team-id <id>");
    }
    const agent = await client.agents.update(
      agentId,
      buildAgentUpdateInput(teamId, options)
    );
    console.log(JSON.stringify({ agent }, null, 2));
    return;
  }

  if (subcommand === "archive") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(options, "usage: agent archive <agentId>");
    if (!agentId) {
      throw new Error("usage: agent archive <agentId> --team-id <id>");
    }
    const agent = await client.agents.archive(agentId, { teamId });
    console.log(JSON.stringify({ agent }, null, 2));
    return;
  }

  throw new Error(
    "usage: agent <list|create|upsert|get|update|run|run-test|bind-runtime-source|archive> [--team-id <id>] [--project-id <id>] [--name <name>]"
  );
}
