import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, promises as fs, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import yaml from "js-yaml";

import type {
  SandboxAgent,
  SandboxAgentEditWorkItemOpenInput,
  SandboxAgentEntrypointScope,
  SandboxAgentSourceCheckKind,
  SandboxAgentSourceChecksRequestInput,
  SandboxAgentSourcePublishInput,
  SandboxAgentRuntimeSourceConfig as SandboxAgentSourceConfig,
  SandboxAgentRuntimeSourceMode as SandboxAgentSourceMode,
  SandboxAgentTriggerType,
  SandboxAgentUpdateInput,
  SandboxAgentUpsertInput,
  SandboxCodingWorkItem,
  SandboxCodingWorkItemActivity,
  SandboxCodingWorkItemBackgroundInput,
  SandboxCodingWorkItemChatInput,
  SandboxCodingWorkItemPromotionInput,
  SandboxProject,
  SandboxProjectSourceType,
  SandboxProjectUpdateInput,
  SandboxProjectUpsertInput,
} from "../sandbox/types/index";
import {
  formatSandboxTemplateDiagnostics,
  validateSandboxTemplateYaml,
} from "../sandbox-template/manifest";
import {
  optionString,
  optionalJsonObject,
  parseBooleanOption,
  parseCsvOption,
  parseIntegerOption,
  parseSandboxWorkflowModeOption,
  parseSandboxRuntimePromotionPolicyOption,
  requiredTeamId,
  resolveSandboxClient,
  runCommand,
} from "./common";

const PROJECT_SOURCE_UPLOAD_MAX_FILES = 1500;
const PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
const PROJECT_SOURCE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const AGENT_SDK_SOURCE_UPLOAD_METADATA_PATH =
  ".openpond/source-upload-metadata.json";
const AGENT_SDK_VENDOR_TARBALL_PATH =
  ".openpond/vendor/openpond-agent-sdk.tgz";
const AGENT_SDK_VENDOR_NPM_DEPENDENCY_DIR = ".openpond/vendor/npm";
const AGENT_SDK_MATERIALIZED_DEPENDENCY_SPEC =
  `file:${AGENT_SDK_VENDOR_TARBALL_PATH}`;
const AGENT_SDK_SYNTHESIZED_OPENPOND_YAML_SENTINEL =
  "# openpond-agent-sdk-source-upload: synthesized-openpond-yaml";
const AGENT_SDK_GENERATED_ARTIFACTS = [
  ".openpond/agent-inspect.json",
  ".openpond/agent-manifest.json",
  ".openpond/action-registry.json",
  ".openpond/openpond-manifest.preview.yaml",
  ".openpond/runtime-bridge.mjs",
  ".openpond/validator-report.md",
];

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

export function parseAgentSourceMode(
  value: string | boolean | undefined,
  optionName = "source-mode"
): SandboxAgentSourceMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${optionName} must be a non-empty value`);
  }
  const mode = value.trim() as SandboxAgentSourceMode;
  if (
    mode !== "latest_source" &&
    mode !== "published_snapshot" &&
    mode !== "auto"
  ) {
    throw new Error(
      `${optionName} must be one of latest_source, published_snapshot, auto`
    );
  }
  return mode;
}

export function buildAgentSourceConfig(
  options: Record<string, string | boolean>
): Partial<SandboxAgentSourceConfig> | undefined {
  const hasSourceMode = Object.prototype.hasOwnProperty.call(
    options,
    "sourceMode"
  );
  const mode = parseAgentSourceMode(
    hasSourceMode ? options.sourceMode : options.runtimeSourceMode,
    hasSourceMode ? "source-mode" : "runtime-source-mode"
  );
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
  const config: Partial<SandboxAgentSourceConfig> = {
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

function buildAgentSourcePolicy(
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

function parseAgentSourceCheckKind(
  value: string | boolean | undefined
): SandboxAgentSourceCheckKind | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("check-kind must be a non-empty value");
  }
  const checkKind = value.trim() as SandboxAgentSourceCheckKind;
  if (
    checkKind !== "validate" &&
    checkKind !== "eval" &&
    checkKind !== "publish_review" &&
    checkKind !== "all"
  ) {
    throw new Error(
      "check-kind must be one of validate, eval, publish_review, all"
    );
  }
  return checkKind;
}

function parsePositiveLimit(
  value: string | boolean | undefined
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseIntegerOption(value, "limit");
  if (parsed === undefined) return undefined;
  if (parsed <= 0) throw new Error("limit must be greater than 0");
  return parsed;
}

function buildAgentSourceChecksInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxAgentSourceChecksRequestInput {
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  const checkKind = parseAgentSourceCheckKind(options.checkKind);
  return {
    teamId,
    ...(optionString(options, "sourceRef")
      ? { sourceRef: optionString(options, "sourceRef") }
      : {}),
    ...(optionString(options, "baseSha")
      ? { baseSha: optionString(options, "baseSha") }
      : {}),
    ...(checkKind ? { checkKind } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function buildAgentSourcePublishInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxAgentSourcePublishInput {
  return {
    teamId,
    ...(optionString(options, "expectedManifestHash")
      ? { expectedManifestHash: optionString(options, "expectedManifestHash") }
      : {}),
    ...(optionString(options, "expectedSourceCommitSha")
      ? {
          expectedSourceCommitSha: optionString(
            options,
            "expectedSourceCommitSha"
          ),
        }
      : {}),
    ...(optionString(options, "evalStatus")
      ? { evalStatus: optionString(options, "evalStatus") }
      : {}),
    ...(optionString(options, "workItemId")
      ? { workItemId: optionString(options, "workItemId") }
      : {}),
    ...(optionString(options, "taskRunId")
      ? { taskRunId: optionString(options, "taskRunId") }
      : {}),
    ...(optionString(options, "traceArtifactRef")
      ? { traceArtifactRef: optionString(options, "traceArtifactRef") }
      : {}),
    ...(optionString(options, "evalResultArtifactRef")
      ? { evalResultArtifactRef: optionString(options, "evalResultArtifactRef") }
      : {}),
  };
}

function buildAgentEditOpenInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxAgentEditWorkItemOpenInput {
  const projectId = optionString(options, "projectId");
  if (!projectId) {
    throw new Error(
      "agent edit open requires --project-id <id> so the edit work item is project scoped"
    );
  }
  const initialMessage =
    optionString(options, "initialMessage") ||
    optionString(options, "message") ||
    optionString(options, "prompt");
  return {
    teamId,
    projectId,
    ...(initialMessage ? { initialMessage } : {}),
    ...(optionString(options, "sourceRef")
      ? { sourceRef: optionString(options, "sourceRef") }
      : {}),
    ...(optionString(options, "baseSha")
      ? { baseSha: optionString(options, "baseSha") }
      : {}),
  };
}

function buildCodingWorkItemChatInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxCodingWorkItemChatInput {
  const message =
    optionString(options, "message") || optionString(options, "prompt");
  if (!message) {
    throw new Error("agent edit chat requires --message <text>");
  }
  const mode = optionString(options, "chatMode") || "queue_cloud";
  if (mode !== "sync_cloud" && mode !== "queue_cloud") {
    throw new Error(
      "agent edit chat --chat-mode must be sync_cloud or queue_cloud"
    );
  }
  const payload = optionalJsonObject(options, "payload", "payload");
  return {
    teamId,
    message,
    mode,
    ...(optionString(options, "sourceRef")
      ? { sourceRef: optionString(options, "sourceRef") }
      : {}),
    ...(optionString(options, "baseSha")
      ? { baseSha: optionString(options, "baseSha") }
      : {}),
    ...(payload ? { payload } : {}),
  };
}

function buildCodingWorkItemBackgroundInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxCodingWorkItemBackgroundInput {
  const payload = optionalJsonObject(options, "payload", "payload");
  return {
    teamId,
    ...(optionString(options, "prompt")
      ? { prompt: optionString(options, "prompt") }
      : {}),
    ...(optionString(options, "sourceRef")
      ? { sourceRef: optionString(options, "sourceRef") }
      : {}),
    ...(optionString(options, "baseSha")
      ? { baseSha: optionString(options, "baseSha") }
      : {}),
    ...(optionString(options, "sourceRuntimeId")
      ? { sourceRuntimeId: optionString(options, "sourceRuntimeId") }
      : {}),
    ...(optionString(options, "sourceSandboxId")
      ? { sourceSandboxId: optionString(options, "sourceSandboxId") }
      : {}),
    ...(optionString(options, "agentId")
      ? { agentId: optionString(options, "agentId") }
      : {}),
    ...(optionalJsonObject(options, "agentEdit", "agent-edit")
      ? { agentEdit: optionalJsonObject(options, "agentEdit", "agent-edit") }
      : {}),
    ...(optionalJsonObject(options, "setup", "setup")
      ? { setup: optionalJsonObject(options, "setup", "setup") }
      : {}),
    ...(optionalJsonObject(options, "validation", "validation")
      ? { validation: optionalJsonObject(options, "validation", "validation") }
      : {}),
    ...(optionalJsonObject(options, "branchPolicy", "branch-policy")
      ? {
          branchPolicy: optionalJsonObject(
            options,
            "branchPolicy",
            "branch-policy"
          ),
        }
      : {}),
    ...(payload ? { payload } : {}),
  };
}

function buildCodingWorkItemPromotionInput(
  teamId: string,
  options: Record<string, string | boolean>
): SandboxCodingWorkItemPromotionInput {
  const ref = optionString(options, "ref") || optionString(options, "artifactRef");
  if (!ref) throw new Error("result promotion requires --ref <artifact-ref>");
  const metadata = optionalJsonObject(options, "metadata", "metadata");
  return {
    teamId,
    ref,
    ...(metadata ? { metadata } : {}),
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalStringField(
  record: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalStringArrayField(
  record: Record<string, unknown> | null | undefined,
  key: string
): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function optionalRecordField(
  record: Record<string, unknown> | null | undefined,
  key: string
): Record<string, unknown> | null {
  const value = record?.[key];
  return isJsonRecord(value) ? value : null;
}

function optionalRecordArrayField(
  record: Record<string, unknown> | null | undefined,
  key: string
): Array<Record<string, unknown>> {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonRecord);
}

function optionalBooleanField(
  record: Record<string, unknown> | null | undefined,
  key: string
): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function activityPayloads(
  activity: SandboxCodingWorkItemActivity[]
): Record<string, unknown>[] {
  return activity
    .map((item) => item.payload)
    .filter(isJsonRecord);
}

function compactDeployPlanFromPayloads(
  payloads: Record<string, unknown>[]
): Record<string, unknown> | null {
  const payload = payloads.find(
    (item) =>
      optionalStringField(item, "deployPlanStatus") ||
      optionalBooleanField(item, "canDeploy") !== null ||
      optionalBooleanField(item, "canRun") !== null ||
      optionalStringArrayField(item, "blockedReasons").length > 0 ||
      optionalStringArrayField(item, "staleReasons").length > 0
  );
  if (!payload) return null;

  const checks = isJsonRecord(payload.checks) ? payload.checks : null;
  const deployPlan: Record<string, unknown> = {};
  const status =
    optionalStringField(payload, "deployPlanStatus") ??
    optionalStringField(payload, "status");
  const canDeploy = optionalBooleanField(payload, "canDeploy");
  const canRun = optionalBooleanField(payload, "canRun");
  const blockedReasons = optionalStringArrayField(payload, "blockedReasons");
  const staleReasons = optionalStringArrayField(payload, "staleReasons");
  const artifactPaths = optionalStringArrayField(payload, "artifactPaths");

  if (status) deployPlan.status = status;
  if (canRun !== null) deployPlan.canRun = canRun;
  if (canDeploy !== null) deployPlan.canDeploy = canDeploy;
  for (const key of ["agentId", "projectId", "sourceRef", "baseSha"]) {
    const value = optionalStringField(payload, key);
    if (value) deployPlan[key] = value;
  }
  if (blockedReasons.length > 0) deployPlan.blockedReasons = blockedReasons;
  if (staleReasons.length > 0) deployPlan.staleReasons = staleReasons;
  if (artifactPaths.length > 0) deployPlan.artifactPaths = artifactPaths;
  if (checks) deployPlan.checks = checks;

  return Object.keys(deployPlan).length > 0 ? deployPlan : null;
}

function summarizeSourceCheckStatus(
  workItem: SandboxCodingWorkItem,
  activity: SandboxCodingWorkItemActivity[]
) {
  const payloads = activityPayloads(activity);
  const deployPlan =
    payloads
      .map((payload) => payload.deployPlan)
      .find(isJsonRecord) ?? compactDeployPlanFromPayloads(payloads);
  const requestedCheckKind =
    payloads
      .map(
        (payload) =>
          optionalStringField(payload, "checkKind") ??
          optionalStringField(payload, "requestedCheckKind")
      )
      .find(Boolean) ?? null;
  const traceArtifactRefs = uniqueStrings([
    optionalStringField(workItem, "traceArtifactRef"),
    ...payloads.map((payload) => optionalStringField(payload, "traceArtifactRef")),
    ...payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "traceArtifactRefs")
    ),
  ]);
  const evalResultArtifactRefs = uniqueStrings([
    optionalStringField(workItem, "evalResultArtifactRef"),
    ...payloads.map((payload) =>
      optionalStringField(payload, "evalResultArtifactRef")
    ),
    ...payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "evalResultArtifactRefs")
    ),
  ]);
  const publishBlockers = uniqueStrings([
    ...optionalStringArrayField(
      isJsonRecord(deployPlan) ? deployPlan : null,
      "blockedReasons"
    ),
    ...payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "blockedReasons")
    ),
    ...payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "publishBlockers")
    ),
  ]);
  const sourceMaterialization =
    payloads
      .map((payload) => optionalRecordField(payload, "sourceMaterialization"))
      .find(Boolean) ?? null;
  const setup =
    payloads.map((payload) => optionalRecordField(payload, "setup")).find(Boolean) ??
    null;
  const sourceUploadMetadata =
    payloads
      .map((payload) => optionalRecordField(payload, "sourceUploadMetadata"))
      .find(Boolean) ?? null;
  const policyDiscovery =
    payloads
      .map((payload) => optionalRecordField(payload, "policyDiscovery"))
      .find(Boolean) ?? null;
  const discoveredRequiredChecks = uniqueStrings([
    ...payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "discoveredRequiredChecks")
    ),
    ...optionalStringArrayField(policyDiscovery, "requiredChecks"),
  ]);
  const checkRuns = payloads.flatMap((payload) =>
    optionalRecordArrayField(payload, "checkRuns")
  );
  const validation =
    payloads
      .map((payload) => optionalRecordField(payload, "validation"))
      .find(Boolean) ?? null;
  const evalSummary =
    payloads
      .map((payload) => optionalRecordField(payload, "eval"))
      .find(Boolean) ??
    payloads
      .map((payload) => optionalRecordField(payload, "evalSummary"))
      .find(Boolean) ??
    null;
  const validatorArtifactRefs = uniqueStrings(
    payloads.flatMap((payload) =>
      optionalStringArrayField(payload, "validatorArtifactRefs")
    )
  );
  const patchArtifactRef =
    payloads
      .map((payload) => optionalStringField(payload, "patchArtifactRef"))
      .find(Boolean) ?? null;
  const draftSourceRef =
    payloads
      .map((payload) => optionalStringField(payload, "draftSourceRef"))
      .find(Boolean) ?? null;
  const finalResultState =
    payloads
      .map((payload) => optionalStringField(payload, "finalResultState"))
      .find(Boolean) ?? null;
  return {
    workItemId: workItem.id,
    workItemStatus: optionalStringField(workItem, "status"),
    latestTaskRunId: optionalStringField(workItem, "latestTaskRunId"),
    latestRuntimeId: optionalStringField(workItem, "latestRuntimeId"),
    latestSandboxId: optionalStringField(workItem, "latestSandboxId"),
    sourceMaterialization,
    sourceUploadMetadata,
    setup,
    policyDiscovery,
    discoveredRequiredChecks,
    checkRuns,
    validation,
    eval: evalSummary,
    requestedCheckKind,
    deployPlan,
    traceArtifactRefs,
    evalResultArtifactRefs,
    validatorArtifactRefs,
    patchArtifactRef,
    draftSourceRef,
    finalResultState,
    publishBlockers,
  };
}

function unsafePublicOutputKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("raw") ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "log" ||
    normalized === "logs" ||
    normalized === "events" ||
    normalized === "eventstream" ||
    normalized === "fulloutput" ||
    normalized === "processoutput" ||
    normalized === "tracejson" ||
    normalized === "evaljson" ||
    normalized === "evalresultsjson"
  );
}

function compactPublicValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 512
      ? `${value.slice(0, 512)}...[truncated:${value.length}]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => compactPublicValue(item));
  }
  if (isJsonRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (unsafePublicOutputKey(key)) continue;
      output[key] = compactPublicValue(item);
    }
    return output;
  }
  return value;
}

function compactRecordFields(
  record: Record<string, unknown> | null | undefined,
  fields: string[]
): Record<string, unknown> | null {
  if (!record) return null;
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in record)) continue;
    output[field] = compactPublicValue(record[field]);
  }
  return Object.keys(output).length > 0 ? output : null;
}

function compactWorkItem(
  workItem: SandboxCodingWorkItem
): Record<string, unknown> {
  return (
    compactRecordFields(workItem, [
      "id",
      "projectId",
      "assignedAgentId",
      "status",
      "sourceRef",
      "baseSha",
      "latestTaskRunId",
      "latestRuntimeId",
      "latestSandboxId",
      "traceArtifactRef",
      "evalResultArtifactRef",
      "createdAt",
      "updatedAt",
    ]) ?? { id: workItem.id }
  );
}

function compactArtifact(
  artifact: Record<string, unknown>
): Record<string, unknown> {
  return (
    compactRecordFields(artifact, [
      "id",
      "kind",
      "ref",
      "taskRunId",
      "runtimeId",
      "sandboxId",
      "createdAt",
    ]) ?? {}
  );
}

function compactActivityPayload(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  return compactRecordFields(payload, [
    "checkKind",
    "requestedCheckKind",
    "deployPlanStatus",
    "canDeploy",
    "canRun",
    "blockedReasons",
    "staleReasons",
    "artifactPaths",
    "agentId",
    "projectId",
    "sourceRef",
    "baseSha",
    "sourceMaterialization",
    "sourceUploadMetadata",
    "setup",
    "policyDiscovery",
    "discoveredRequiredChecks",
    "checkRuns",
    "validation",
    "eval",
    "evalSummary",
    "traceArtifactRef",
    "traceArtifactRefs",
    "evalResultArtifactRef",
    "evalResultArtifactRefs",
    "validatorArtifactRefs",
    "patchArtifactRef",
    "draftSourceRef",
    "finalResultState",
    "publishBlockers",
  ]);
}

function compactWorkItemActivity(
  activity: SandboxCodingWorkItemActivity
): Record<string, unknown> {
  const output =
    compactRecordFields(activity, [
      "id",
      "type",
      "kind",
      "status",
      "summary",
      "message",
      "createdAt",
      "updatedAt",
    ]) ?? { id: activity.id };
  const payload = compactActivityPayload(
    optionalRecordField(activity, "payload")
  );
  if (payload) output.payload = payload;
  return output;
}

function compactSourceCheckStatus(
  status: Record<string, unknown>
): Record<string, unknown> {
  return (
    compactRecordFields(status, [
      "workItemId",
      "workItemStatus",
      "latestTaskRunId",
      "latestRuntimeId",
      "latestSandboxId",
      "sourceMaterialization",
      "sourceUploadMetadata",
      "setup",
      "policyDiscovery",
      "discoveredRequiredChecks",
      "checkRuns",
      "validation",
      "eval",
      "requestedCheckKind",
      "deployPlan",
      "traceArtifactRefs",
      "evalResultArtifactRefs",
      "validatorArtifactRefs",
      "patchArtifactRef",
      "draftSourceRef",
      "finalResultState",
      "publishBlockers",
    ]) ?? { workItemId: optionalStringField(status, "workItemId") ?? "unknown" }
  );
}

function compactWorkItemStatusResult(status: {
  workItem: SandboxCodingWorkItem;
  activity: SandboxCodingWorkItemActivity[];
  sourceCheckStatus?: Record<string, unknown> | null;
}) {
  const sourceCheckStatus = isJsonRecord(status.sourceCheckStatus)
    ? status.sourceCheckStatus
    : summarizeSourceCheckStatus(status.workItem, status.activity);
  return {
    workItem: compactWorkItem(status.workItem),
    activity: status.activity.map((item) => compactWorkItemActivity(item)),
    sourceCheckStatus: compactSourceCheckStatus(sourceCheckStatus),
  };
}

function compactBackgroundResult(
  result: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const workItem = optionalRecordField(result, "workItem");
  if (workItem) output.workItem = compactWorkItem(workItem as SandboxCodingWorkItem);
  const activity = optionalRecordField(result, "activity");
  if (activity) {
    output.activity = compactWorkItemActivity(
      activity as SandboxCodingWorkItemActivity
    );
  }
  for (const key of [
    "taskRun",
    "runtime",
    "session",
    "link",
    "toolSummary",
    "accepted",
    "status",
  ]) {
    if (key in result) output[key] = compactPublicValue(result[key]);
  }
  return output;
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
  const workflowMode = parseSandboxWorkflowModeOption(options.workflowMode);
  const promotionPolicy = parseSandboxRuntimePromotionPolicyOption(
    options.runtimePromotionPolicy
  );
  const agentSource = buildAgentSourceConfig(options);
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
    ...(workflowMode ? { defaultWorkflowMode: workflowMode } : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "sourceRefOverride")
      ? { sourceRefOverride: optionString(options, "sourceRefOverride") }
      : {}),
    ...(promotionPolicy ? { defaultPromotionPolicy: promotionPolicy } : {}),
    ...(agentSource ? { runtimeSource: agentSource } : {}),
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
  const workflowMode = parseSandboxWorkflowModeOption(options.workflowMode);
  const promotionPolicy = parseSandboxRuntimePromotionPolicyOption(
    options.runtimePromotionPolicy
  );
  const agentSource = buildAgentSourceConfig(options);
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
    ...(workflowMode ? { defaultWorkflowMode: workflowMode } : {}),
    ...(optionString(options, "defaultBranch")
      ? { defaultBranch: optionString(options, "defaultBranch") }
      : {}),
    ...(optionString(options, "sourceRefOverride")
      ? { sourceRefOverride: optionString(options, "sourceRefOverride") }
      : {}),
    ...(promotionPolicy ? { defaultPromotionPolicy: promotionPolicy } : {}),
    ...(agentSource ? { runtimeSource: agentSource } : {}),
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
  const agentSource = agent.runtimeSource
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
    agent.defaultWorkflowMode,
    agentSource,
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
      lower === ".openpond" ||
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
  const sourcePaths = await collectProjectSourceUploadPaths(projectPath);
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

async function collectProjectSourceUploadPaths(
  projectPath: string
): Promise<string[]> {
  const files = await runCommand(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: projectPath }
  );
  if (files.code !== 0) {
    if (existsSync(path.join(projectPath, ".git"))) {
      throw new Error(
        `git ls-files failed: ${
          files.stderr.trim() || files.stdout.trim() || "unknown error"
        }`
      );
    }
    return collectFilesystemProjectSourceUploadPaths(projectPath);
  }

  return files.stdout
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
}

async function collectFilesystemProjectSourceUploadPaths(
  projectPath: string
): Promise<string[]> {
  const sourcePaths: string[] = [];
  async function visit(relativeDir: string): Promise<void> {
    const absoluteDir = path.join(projectPath, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, "/");
      if (
        !isSafeProjectSourcePath(relativePath) ||
        shouldSkipProjectSourcePath(relativePath)
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (entry.isFile()) sourcePaths.push(relativePath);
    }
  }

  try {
    await visit("");
  } catch (error) {
    throw new Error(
      `filesystem source scan failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return sourcePaths;
}

async function collectAgentSdkProjectSourceUploadEntries(
  projectPath: string,
  existingEntries: Array<{ path: string }>
): Promise<{
  entries: Array<{ path: string; type: "file"; contentsBase64: string }>;
  generatedManifestPath: string | null;
  synthesizedOpenPondYaml: boolean;
  uploadMetadataPath: string | null;
  uploadMetadata: Record<string, unknown> | null;
  uploadMetadataHash: { sha256: string; sizeBytes: number } | null;
}> {
  if (!isAgentSdkProject(projectPath)) {
    return {
      entries: [],
      generatedManifestPath: null,
      synthesizedOpenPondYaml: false,
      uploadMetadataPath: null,
      uploadMetadata: null,
      uploadMetadataHash: null,
    };
  }

  await runAgentSdkProjectCheck(projectPath, "build");
  await runAgentSdkProjectCheck(projectPath, "validate");
  await runAgentSdkProjectCheck(projectPath, "eval");

  const packageJson = readAgentSdkProjectPackageJson(projectPath);
  const materializedDependency = await buildAgentSdkMaterializedDependency(
    projectPath,
    packageJson
  );
  const manifestPath = ".openpond/openpond-manifest.preview.yaml";
  const manifestSource = await fs.readFile(path.join(projectPath, manifestPath), "utf8");
  const openPondYamlSource = sanitizeAgentSdkRuntimeManifestForOpenPondYaml(
    manifestSource,
    materializedDependency?.dependencySetup ?? null
  );
  const manifestResult = validateSandboxTemplateYaml(openPondYamlSource);
  if (!manifestResult.ok) {
    throw new Error(
      `generated ${manifestPath} failed sandbox-template validation after openpond.yaml sanitization:\n${formatSandboxTemplateDiagnostics(
        manifestResult.diagnostics
      )}`
    );
  }

  const entries: Array<{ path: string; type: "file"; contentsBase64: string }> = [];
  if (materializedDependency?.rewrittenPackageJson) {
    entries.push(
      projectSourceUploadTextEntry(
        "package.json",
        `${JSON.stringify(materializedDependency.rewrittenPackageJson, null, 2)}\n`
      )
    );
  }
  for (const tarball of materializedDependency?.tarballs ?? []) {
    entries.push(
      projectSourceUploadBufferEntry(tarball.path, tarball.contents)
    );
  }
  for (const artifactPath of AGENT_SDK_GENERATED_ARTIFACTS) {
    if (!existsSync(path.join(projectPath, artifactPath))) continue;
    entries.push(await projectSourceUploadFileEntry(projectPath, artifactPath));
  }

  const hasAuthoredOpenPondYaml =
    existingEntries.some((entry) => entry.path === "openpond.yaml") ||
    existsSync(path.join(projectPath, "openpond.yaml"));
  if (!hasAuthoredOpenPondYaml) {
    entries.push(projectSourceUploadTextEntry("openpond.yaml", openPondYamlSource));
  } else {
    const authoredSource = await fs.readFile(path.join(projectPath, "openpond.yaml"), "utf8");
    const authoredResult = validateSandboxTemplateYaml(authoredSource);
    if (!authoredResult.ok) {
      throw new Error(
        `authored openpond.yaml failed sandbox-template validation:\n${formatSandboxTemplateDiagnostics(
          authoredResult.diagnostics
        )}`
      );
    }
  }
  const uploadMetadata = await buildAgentSdkSourceUploadMetadata(projectPath, {
    packageJson,
    generatedManifestPath: manifestPath,
    synthesizedOpenPondYaml: !hasAuthoredOpenPondYaml,
    openPondYamlSource,
    dependencySetup: materializedDependency?.dependencySetup ?? null,
  });
  const uploadMetadataSource = `${JSON.stringify(uploadMetadata, null, 2)}\n`;
  const uploadMetadataHash = {
    sha256: sha256Hex(Buffer.from(uploadMetadataSource, "utf8")),
    sizeBytes: Buffer.byteLength(uploadMetadataSource, "utf8"),
  };
  entries.push(
    projectSourceUploadTextEntry(
      AGENT_SDK_SOURCE_UPLOAD_METADATA_PATH,
      uploadMetadataSource
    )
  );

  return {
    entries,
    generatedManifestPath: manifestPath,
    synthesizedOpenPondYaml: !hasAuthoredOpenPondYaml,
    uploadMetadataPath: AGENT_SDK_SOURCE_UPLOAD_METADATA_PATH,
    uploadMetadata,
    uploadMetadataHash,
  };
}

async function buildAgentSdkSourceUploadMetadata(
  projectPath: string,
  params: {
    packageJson: Record<string, unknown>;
    generatedManifestPath: string;
    synthesizedOpenPondYaml: boolean;
    openPondYamlSource: string;
    dependencySetup: Record<string, unknown> | null;
  }
): Promise<Record<string, unknown>> {
  const packageManager = detectAgentSdkPackageManager(projectPath, params.packageJson);
  const commandHints = buildAgentSdkCommandHints(params.packageJson, packageManager);
  const artifactHashes: Record<
    string,
    { sha256: string; sizeBytes: number }
  > = {};
  for (const artifactPath of AGENT_SDK_GENERATED_ARTIFACTS) {
    const absolutePath = path.join(projectPath, artifactPath);
    if (!existsSync(absolutePath)) continue;
    const contents = await fs.readFile(absolutePath);
    artifactHashes[artifactPath] = {
      sha256: sha256Hex(contents),
      sizeBytes: contents.byteLength,
    };
  }
  artifactHashes["openpond.yaml"] = {
    sha256: sha256Hex(Buffer.from(params.openPondYamlSource, "utf8")),
    sizeBytes: Buffer.byteLength(params.openPondYamlSource, "utf8"),
  };

  return {
    schema: "openpond.agent.source_upload.v1",
    sourceTreeMode: "typescript_agent_sdk",
    packageManager,
    sdk: {
      packageName: "openpond-agent-sdk",
      versionSpec: readOpenPondAgentSdkVersionSpec(params.packageJson),
    },
    commands: commandHints,
    ...(params.dependencySetup ? { dependencySetup: params.dependencySetup } : {}),
    generatedManifestPath: params.generatedManifestPath,
    synthesizedOpenPondYaml: params.synthesizedOpenPondYaml,
    openPondYamlMode: params.synthesizedOpenPondYaml ? "synthesized" : "authored",
    artifactHashes,
  };
}

function readAgentSdkProjectPackageJson(
  projectPath: string
): Record<string, unknown> {
  const packageJsonPath = path.join(projectPath, "package.json");
  return JSON.parse(readFileSyncUtf8(packageJsonPath)) as Record<
    string,
    unknown
  >;
}

function detectAgentSdkPackageManager(
  projectPath: string,
  packageJson: Record<string, unknown>
): "bun" | "npm" | "pnpm" | "yarn" | "unknown" {
  const packageManager = packageJson.packageManager;
  if (typeof packageManager === "string") {
    const name = packageManager.split("@")[0];
    if (name === "bun" || name === "npm" || name === "pnpm" || name === "yarn") {
      return name;
    }
  }
  if (
    existsSync(path.join(projectPath, "bun.lock")) ||
    existsSync(path.join(projectPath, "bun.lockb"))
  ) {
    return "bun";
  }
  if (existsSync(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (
    existsSync(path.join(projectPath, "package-lock.json")) ||
    existsSync(path.join(projectPath, "npm-shrinkwrap.json"))
  ) {
    return "npm";
  }
  return "unknown";
}

function buildAgentSdkCommandHints(
  packageJson: Record<string, unknown>,
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | "unknown"
): Record<string, string> {
  return {
    inspect: buildAgentSdkCommandHint(
      packageJson,
      packageManager,
      "agent:inspect",
      "openpond-agent inspect --json"
    ),
    build: buildAgentSdkCommandHint(
      packageJson,
      packageManager,
      "agent:build",
      "openpond-agent build"
    ),
    validate: buildAgentSdkCommandHint(
      packageJson,
      packageManager,
      "agent:validate",
      "openpond-agent validate"
    ),
    eval: buildAgentSdkCommandHint(
      packageJson,
      packageManager,
      "agent:eval",
      "openpond-agent eval"
    ),
  };
}

function buildAgentSdkCommandHint(
  packageJson: Record<string, unknown>,
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | "unknown",
  scriptName: string,
  fallback: string
): string {
  const scripts = packageJson.scripts;
  const hasScript =
    scripts &&
    typeof scripts === "object" &&
    !Array.isArray(scripts) &&
    typeof (scripts as Record<string, unknown>)[scriptName] === "string";
  if (!hasScript) return fallback;
  if (packageManager === "pnpm") return `pnpm run ${scriptName}`;
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  if (packageManager === "npm") return `npm run ${scriptName}`;
  return `bun run ${scriptName}`;
}

function readOpenPondAgentSdkVersionSpec(
  packageJson: Record<string, unknown>
): string | null {
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = packageJson[key];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    const value = (dependencies as Record<string, unknown>)["openpond-agent-sdk"];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function buildAgentSdkMaterializedDependency(
  projectPath: string,
  packageJson: Record<string, unknown>
): Promise<{
  rewrittenPackageJson: Record<string, unknown>;
  tarballs: AgentSdkMaterializedTarball[];
  dependencySetup: Record<string, unknown>;
} | null> {
  const sdkSource = resolveLocalOpenPondAgentSdkMaterializationSource(
    projectPath,
    packageJson
  );
  if (!sdkSource) return null;

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "openpond-agent-sdk-pack-"));
  try {
    const sdkContents =
      sdkSource.kind === "package_root"
        ? await packOpenPondAgentSdkPackageRoot(sdkSource.packageRoot, tempDir)
        : sdkSource.tarballContents;
    const sdkDependencyTarballs = await packAgentSdkRuntimeDependencyTarballs({
      sdkPackageJson: sdkSource.packageJson,
      dependencyBaseDir: sdkSource.dependencyBaseDir,
      tempDir,
    });
    const rewrittenPackageJson = rewriteAgentSdkPackageJsonForMaterialization(
      packageJson,
      sdkDependencyTarballs
    );
    const packageManager = detectAgentSdkPackageManager(projectPath, packageJson);
    const installCommand = agentSdkDependencyInstallCommand(packageManager);
    const sdkPackage = {
      packageName: "openpond-agent-sdk",
      source: "uploaded_tarball",
      path: AGENT_SDK_VENDOR_TARBALL_PATH,
      sha256: sha256Hex(sdkContents),
      sizeBytes: sdkContents.byteLength,
    };
    return {
      rewrittenPackageJson,
      tarballs: [
        {
          ...sdkPackage,
          contents: sdkContents,
        },
        ...sdkDependencyTarballs,
      ],
      dependencySetup: {
        required: true,
        packageManager,
        installCommand,
        commands: [installCommand],
        packageJsonPath: "package.json",
        expectedBinaryPath: "node_modules/.bin/openpond-agent",
        generatedArtifactDirectory: ".openpond",
        sdkPackage,
        dependencyPackages: sdkDependencyTarballs.map((tarball) => ({
          packageName: tarball.packageName,
          source: tarball.source,
          versionSpec: tarball.versionSpec,
          path: tarball.path,
          sha256: tarball.sha256,
          sizeBytes: tarball.sizeBytes,
        })),
      },
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

type AgentSdkMaterializedTarball = {
  packageName: string;
  source: "uploaded_tarball" | "npm_dependency_tarball";
  versionSpec?: string;
  path: string;
  contents: Buffer;
  sha256: string;
  sizeBytes: number;
};

async function packOpenPondAgentSdkPackageRoot(
  sdkPackageRoot: string,
  tempDir: string
): Promise<Buffer> {
  const pack = await runCommand(
    "npm",
    ["pack", "--silent", "--pack-destination", tempDir, sdkPackageRoot],
    { cwd: sdkPackageRoot }
  );
  if (pack.code !== 0) {
    const details = [pack.stderr.trim(), pack.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `failed to pack openpond-agent-sdk for source upload${details ? `:\n${details}` : ""}`
    );
  }
  const tarballName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!tarballName) {
    throw new Error("failed to pack openpond-agent-sdk for source upload: npm pack did not return a tarball name");
  }
  return fs.readFile(path.join(tempDir, tarballName));
}

async function packAgentSdkRuntimeDependencyTarballs(params: {
  sdkPackageJson: Record<string, unknown>;
  dependencyBaseDir: string;
  tempDir: string;
}): Promise<AgentSdkMaterializedTarball[]> {
  const dependencies = recordStringMap(params.sdkPackageJson.dependencies);
  const tarballs: AgentSdkMaterializedTarball[] = [];
  for (const [packageName, versionSpec] of Object.entries(dependencies).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const packTarget = npmPackTargetForDependency({
      packageName,
      versionSpec,
      dependencyBaseDir: params.dependencyBaseDir,
    });
    const pack = await runCommand(
      "npm",
      ["pack", "--silent", "--pack-destination", params.tempDir, packTarget],
      { cwd: params.sdkPackageRoot }
    );
    if (pack.code !== 0) {
      const details = [pack.stderr.trim(), pack.stdout.trim()]
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `failed to pack openpond-agent-sdk dependency ${packageName}${details ? `:\n${details}` : ""}`
      );
    }
    const tarballName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tarballName) {
      throw new Error(
        `failed to pack openpond-agent-sdk dependency ${packageName}: npm pack did not return a tarball name`
      );
    }
    const contents = await fs.readFile(path.join(params.tempDir, tarballName));
    tarballs.push({
      packageName,
      source: "npm_dependency_tarball",
      versionSpec,
      path: `${AGENT_SDK_VENDOR_NPM_DEPENDENCY_DIR}/${sanitizeNpmPackageNameForVendor(
        packageName
      )}.tgz`,
      contents,
      sha256: sha256Hex(contents),
      sizeBytes: contents.byteLength,
    });
  }
  return tarballs;
}

function npmPackTargetForDependency(params: {
  packageName: string;
  versionSpec: string;
  dependencyBaseDir: string;
}): string {
  if (params.versionSpec.startsWith("file:")) {
    return path.resolve(
      params.dependencyBaseDir,
      params.versionSpec.slice("file:".length)
    );
  }
  return `${params.packageName}@${params.versionSpec}`;
}

function sanitizeNpmPackageNameForVendor(packageName: string): string {
  return packageName
    .replace(/^@/, "")
    .replace(/[\/\\]/g, "__")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

type OpenPondAgentSdkMaterializationSource =
  | {
      kind: "package_root";
      packageRoot: string;
      dependencyBaseDir: string;
      packageJson: Record<string, unknown>;
    }
  | {
      kind: "tarball";
      tarballPath: string;
      tarballContents: Buffer;
      dependencyBaseDir: string;
      packageJson: Record<string, unknown>;
    };

function resolveLocalOpenPondAgentSdkMaterializationSource(
  projectPath: string,
  packageJson: Record<string, unknown>
): OpenPondAgentSdkMaterializationSource | null {
  const versionSpec = readOpenPondAgentSdkVersionSpec(packageJson);
  if (versionSpec?.startsWith("file:")) {
    const candidate = path.resolve(projectPath, versionSpec.slice("file:".length));
    if (isOpenPondAgentSdkPackageRoot(candidate)) {
      return {
        kind: "package_root",
        packageRoot: candidate,
        dependencyBaseDir: candidate,
        packageJson: JSON.parse(
          readFileSyncUtf8(path.join(candidate, "package.json"))
        ) as Record<string, unknown>,
      };
    }
    if (isLocalNpmTarball(candidate)) {
      const tarballContents = readFileSync(candidate);
      const tarballPackageJson =
        readPackageJsonFromNpmTarball(tarballContents);
      if (tarballPackageJson.name === "openpond-agent-sdk") {
        return {
          kind: "tarball",
          tarballPath: candidate,
          tarballContents,
          dependencyBaseDir: path.dirname(candidate),
          packageJson: tarballPackageJson,
        };
      }
    }
  }
  if (versionSpec?.startsWith("workspace:")) {
    const candidate = findOpenPondAgentSdkPackageRootInAncestors(projectPath);
    if (candidate) {
      return {
        kind: "package_root",
        packageRoot: candidate,
        dependencyBaseDir: candidate,
        packageJson: JSON.parse(
          readFileSyncUtf8(path.join(candidate, "package.json"))
        ) as Record<string, unknown>,
      };
    }
  }
  return null;
}

function findOpenPondAgentSdkPackageRootInAncestors(projectPath: string): string | null {
  let current = path.resolve(projectPath);
  while (true) {
    if (isOpenPondAgentSdkPackageRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isOpenPondAgentSdkPackageRoot(candidate: string): boolean {
  const packageJsonPath = path.join(candidate, "package.json");
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSyncUtf8(packageJsonPath)) as {
      name?: unknown;
    };
    return parsed.name === "openpond-agent-sdk";
  } catch {
    return false;
  }
}

function isLocalNpmTarball(candidate: string): boolean {
  if (!existsSync(candidate)) return false;
  try {
    return (
      statSync(candidate).isFile() &&
      (candidate.endsWith(".tgz") || candidate.endsWith(".tar.gz"))
    );
  } catch {
    return false;
  }
}

function readPackageJsonFromNpmTarball(
  tarballContents: Buffer
): Record<string, unknown> {
  const tarContents = gunzipSync(tarballContents);
  let offset = 0;
  while (offset + 512 <= tarContents.length) {
    const header = tarContents.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("failed to read openpond-agent-sdk tarball: invalid entry size");
    }

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (entryPath === "package/package.json") {
      return JSON.parse(
        tarContents.subarray(dataStart, dataEnd).toString("utf8")
      ) as Record<string, unknown>;
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error("failed to read openpond-agent-sdk tarball: missing package.json");
}

function readTarString(
  header: Buffer,
  start: number,
  length: number
): string {
  const field = header.subarray(start, start + length);
  const nullIndex = field.indexOf(0);
  return field
    .subarray(0, nullIndex === -1 ? field.length : nullIndex)
    .toString("utf8");
}

function rewriteAgentSdkPackageJsonForMaterialization(
  packageJson: Record<string, unknown>,
  dependencyTarballs: AgentSdkMaterializedTarball[]
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = { ...packageJson };
  const dependencies = recordCopy(rewritten.dependencies);
  const overrides = recordCopy(rewritten.overrides);
  dependencies["openpond-agent-sdk"] = AGENT_SDK_MATERIALIZED_DEPENDENCY_SPEC;
  for (const tarball of dependencyTarballs) {
    const dependencySpec = `file:${tarball.path}`;
    dependencies[tarball.packageName] = dependencySpec;
    overrides[tarball.packageName] = dependencySpec;
  }
  rewritten.dependencies = dependencies;
  if (Object.keys(overrides).length > 0) {
    rewritten.overrides = overrides;
  }

  for (const key of ["devDependencies", "peerDependencies"]) {
    const entries = recordCopy(rewritten[key]);
    delete entries["openpond-agent-sdk"];
    if (Object.keys(entries).length > 0) {
      rewritten[key] = entries;
    } else {
      delete rewritten[key];
    }
  }

  return rewritten;
}

function recordStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string" && entryValue.trim()) {
      entries[key] = entryValue.trim();
    }
  }
  return entries;
}

function recordCopy(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function agentSdkDependencyInstallCommand(
  packageManager: "bun" | "npm" | "pnpm" | "yarn" | "unknown"
): string {
  if (packageManager === "npm") return "npm install --offline";
  if (packageManager === "pnpm") return "pnpm install --offline";
  if (packageManager === "yarn") return "yarn install --offline";
  return "bun install --offline";
}

function sha256Hex(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function dependencySetupCommands(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.commands)) {
    return record.commands.filter(
      (command): command is string =>
        typeof command === "string" && command.trim() !== ""
    );
  }
  return typeof record.installCommand === "string" && record.installCommand.trim()
    ? [record.installCommand.trim()]
    : [];
}

function mergeManifestSetupCommands(
  manifest: Record<string, unknown>,
  commands: string[]
): Record<string, unknown> {
  if (commands.length === 0) return manifest;
  const setup =
    manifest.setup && typeof manifest.setup === "object" && !Array.isArray(manifest.setup)
      ? recordCopy(manifest.setup)
      : {};
  const existingCommands = Array.isArray(setup.commands)
    ? setup.commands.filter(
        (command): command is string =>
          typeof command === "string" && command.trim() !== ""
      )
    : [];
  const mergedCommands = [...commands];
  for (const command of existingCommands) {
    if (!mergedCommands.includes(command)) mergedCommands.push(command);
  }
  return {
    ...manifest,
    setup: {
      ...setup,
      commands: mergedCommands,
    },
  };
}

function sanitizeAgentSdkRuntimeManifestForOpenPondYaml(
  source: string,
  dependencySetup: Record<string, unknown> | null
): string {
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `${AGENT_SDK_SYNTHESIZED_OPENPOND_YAML_SENTINEL}\n${source}`;
  }
  const manifest = mergeManifestSetupCommands(
    { ...(parsed as Record<string, unknown>) },
    dependencySetupCommands(dependencySetup)
  );
  delete manifest.schema;
  sanitizeGeneratedManifestNamedCommands(manifest, "actions");
  sanitizeGeneratedManifestNamedCommands(manifest, "services");
  return `${AGENT_SDK_SYNTHESIZED_OPENPOND_YAML_SENTINEL}\n${yaml.dump(manifest, { lineWidth: -1, noRefs: true })}`;
}

function sanitizeGeneratedManifestNamedCommands(
  manifest: Record<string, unknown>,
  key: "actions" | "services"
): void {
  if (!Array.isArray(manifest[key])) return;
  manifest[key] = manifest[key].map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const sanitized = { ...(entry as Record<string, unknown>) };
    delete sanitized.id;
    delete sanitized.label;
    return sanitized;
  });
}

function isAgentSdkProject(projectPath: string): boolean {
  if (!existsSync(path.join(projectPath, "agent", "agent.ts"))) return false;
  const packageJsonPath = path.join(projectPath, "package.json");
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSyncUtf8(packageJsonPath)) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
    };
    return Boolean(
      parsed.dependencies?.["openpond-agent-sdk"] ||
        parsed.devDependencies?.["openpond-agent-sdk"] ||
        parsed.peerDependencies?.["openpond-agent-sdk"]
    );
  } catch {
    return false;
  }
}

function readFileSyncUtf8(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

async function runAgentSdkProjectCheck(
  projectPath: string,
  commandName: "build" | "validate" | "eval"
): Promise<void> {
  const command = resolveLocalAgentSdkCommand(projectPath);
  const result = await runCommand(command.command, [...command.args, commandName, "--cwd", projectPath], {
    cwd: projectPath,
  });
  if (result.code !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(
      `openpond agent ${commandName} failed for ${projectPath}${details ? `:\n${details}` : ""}`
    );
  }
}

async function projectSourceUploadFileEntry(
  projectPath: string,
  relativePath: string
): Promise<{ path: string; type: "file"; contentsBase64: string }> {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!isSafeProjectSourcePath(normalized) || normalized.startsWith(".env")) {
    throw new Error(`unsafe generated source path: ${relativePath}`);
  }
  const absolutePath = path.join(projectPath, normalized);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`generated source path is not a file: ${relativePath}`);
  }
  if (stat.size > PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES) {
    throw new Error(`generated source file is too large: ${relativePath} (${stat.size} bytes)`);
  }
  return {
    path: normalized,
    type: "file",
    contentsBase64: Buffer.from(await fs.readFile(absolutePath)).toString("base64"),
  };
}

function projectSourceUploadTextEntry(
  relativePath: string,
  contents: string
): { path: string; type: "file"; contentsBase64: string } {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!isSafeProjectSourcePath(normalized) || normalized.startsWith(".env")) {
    throw new Error(`unsafe generated source path: ${relativePath}`);
  }
  const byteLength = Buffer.byteLength(contents, "utf8");
  if (byteLength > PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES) {
    throw new Error(`generated source file is too large: ${relativePath} (${byteLength} bytes)`);
  }
  return {
    path: normalized,
    type: "file",
    contentsBase64: Buffer.from(contents, "utf8").toString("base64"),
  };
}

function projectSourceUploadBufferEntry(
  relativePath: string,
  contents: Buffer
): { path: string; type: "file"; contentsBase64: string } {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!isSafeProjectSourcePath(normalized) || normalized.startsWith(".env")) {
    throw new Error(`unsafe generated source path: ${relativePath}`);
  }
  if (contents.byteLength > PROJECT_SOURCE_UPLOAD_MAX_FILE_BYTES) {
    throw new Error(
      `generated source file is too large: ${relativePath} (${contents.byteLength} bytes)`
    );
  }
  return {
    path: normalized,
    type: "file",
    contentsBase64: contents.toString("base64"),
  };
}

function mergeProjectSourceUploadEntries(
  collected: {
    entries: Array<{ path: string; type: "file"; contentsBase64: string }>;
    fileCount: number;
    totalBytes: number;
  },
  extraEntries: Array<{ path: string; type: "file"; contentsBase64: string }>
) {
  const byPath = new Map<string, { path: string; type: "file"; contentsBase64: string }>();
  for (const entry of collected.entries) byPath.set(entry.path, entry);
  for (const entry of extraEntries) byPath.set(entry.path, entry);
  const entries = Array.from(byPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const totalBytes = entries.reduce(
    (sum, entry) => sum + Buffer.byteLength(entry.contentsBase64, "base64"),
    0
  );
  if (entries.length > PROJECT_SOURCE_UPLOAD_MAX_FILES) {
    throw new Error(`too many source files to upload: ${entries.length} > ${PROJECT_SOURCE_UPLOAD_MAX_FILES}`);
  }
  if (totalBytes > PROJECT_SOURCE_UPLOAD_MAX_BYTES) {
    throw new Error(`source upload is too large: ${totalBytes} > ${PROJECT_SOURCE_UPLOAD_MAX_BYTES}`);
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
    const agentSdk = await collectAgentSdkProjectSourceUploadEntries(
      projectPath,
      collected.entries
    );
    const upload = mergeProjectSourceUploadEntries(collected, agentSdk.entries);
    const project = await client.projects.uploadSource(projectId, {
      teamId,
      entries: upload.entries,
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
            fileCount: upload.fileCount,
            totalBytes: upload.totalBytes,
            ...(agentSdk.generatedManifestPath
              ? {
                  agentSdk: {
                    generatedManifestPath: agentSdk.generatedManifestPath,
                    generatedEntryCount: agentSdk.entries.length,
                    synthesizedOpenPondYaml: agentSdk.synthesizedOpenPondYaml,
                    uploadMetadataPath: agentSdk.uploadMetadataPath,
                    uploadMetadataHash: agentSdk.uploadMetadataHash,
                    commands: agentSdk.uploadMetadata?.commands,
                    dependencySetup: agentSdk.uploadMetadata?.dependencySetup,
                    packageManager: agentSdk.uploadMetadata?.packageManager,
                    sourceTreeMode: agentSdk.uploadMetadata?.sourceTreeMode,
                    artifactHashes: agentSdk.uploadMetadata?.artifactHashes,
                  },
                }
              : {}),
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
  if (shouldDelegateLocalAgentSdkCommand(subcommand, options)) {
    await runLocalAgentSdkCommand(options, rest);
    return;
  }
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
    const workflowMode = parseSandboxWorkflowModeOption(options.workflowMode);
    const inputObject = optionalJsonObject(options, "input", "input");
    const metadata = optionalJsonObject(options, "metadata", "metadata");
    const agentSourcePolicy = buildAgentSourcePolicy(options);
    const result = await client.agents.run(agentId, {
      teamId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(triggerType ? { triggerType } : {}),
      ...(workflowMode ? { workflowMode } : {}),
      ...(inputObject ? { input: inputObject } : {}),
      ...(metadata ? { metadata } : {}),
      ...(agentSourcePolicy ? { runtimeSourcePolicy: agentSourcePolicy } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "bind-runtime-source" || subcommand === "bind-source") {
    const agentId = rest[1]?.trim();
    const teamId = requiredTeamId(
      options,
      "usage: agent bind-source <agentId>"
    );
    if (!agentId) {
      throw new Error(
        "usage: agent bind-source <agentId> --team-id <id> --source-mode latest_source|published_snapshot|auto"
      );
    }
    const agentSource = buildAgentSourceConfig(options);
    if (!agentSource?.mode) {
      throw new Error(
        "usage: agent bind-source <agentId> --team-id <id> --source-mode latest_source|published_snapshot|auto"
      );
    }
    const agent = await client.agents.update(agentId, {
      teamId,
      runtimeSource: agentSource,
    });
    console.log(
      JSON.stringify({ agent, agentSource: agent.runtimeSource }, null, 2)
    );
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
    const workflowMode = parseSandboxWorkflowModeOption(options.workflowMode);
    const result = await client.agents.run(agentId, {
      teamId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(workflowMode ? { workflowMode } : {}),
      ...(inputObject ? { input: inputObject } : {}),
      metadata: {
        ...(metadata ?? {}),
        source: "agent_run_test",
      },
      runtimeSourcePolicy: buildAgentSourcePolicy(
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

  if (subcommand === "edit") {
    const editCommand = rest[1]?.trim();
    const targetId = rest[2]?.trim();
    const usage =
      "usage: agent edit <open|chat|activity|background|request-checks|check-status|checkpoint-result|commit-result|pr-result> <id> --team-id <id>";
    const teamId = requiredTeamId(options, usage);
    if (!editCommand || !targetId) {
      throw new Error(usage);
    }
    if (editCommand === "open") {
      const result = await client.agents.openEditWorkItem(
        targetId,
        buildAgentEditOpenInput(teamId, options)
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (editCommand === "chat") {
      const result = await client.workItems.chat(
        targetId,
        buildCodingWorkItemChatInput(teamId, options)
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (editCommand === "activity") {
      const activity = await client.workItems.activity(targetId, {
        teamId,
        limit: parsePositiveLimit(options.limit),
      });
      console.log(
        JSON.stringify(
          { activity: activity.map((item) => compactWorkItemActivity(item)) },
          null,
          2
        )
      );
      return;
    }
    if (editCommand === "background") {
      const result = await client.workItems.handleBackground(
        targetId,
        buildCodingWorkItemBackgroundInput(teamId, options)
      );
      console.log(JSON.stringify(compactBackgroundResult(result), null, 2));
      return;
    }
    if (editCommand === "request-checks") {
      const result = await client.agents.requestSourceChecks(
        targetId,
        buildAgentSourceChecksInput(teamId, options)
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (editCommand === "check-status") {
      const status = await client.workItems.status(targetId, {
        teamId,
        limit: parsePositiveLimit(options.limit),
        includeArchived: true,
      });
      console.log(
        JSON.stringify(
          compactWorkItemStatusResult(status),
          null,
          2
        )
      );
      return;
    }
    if (
      editCommand === "checkpoint-result" ||
      editCommand === "commit-result" ||
      editCommand === "pr-result"
    ) {
      const input = buildCodingWorkItemPromotionInput(teamId, options);
      const artifact =
        editCommand === "checkpoint-result"
          ? await client.workItems.promoteCheckpoint(targetId, input)
          : editCommand === "commit-result"
            ? await client.workItems.promoteCommit(targetId, input)
            : await client.workItems.promotePullRequest(targetId, input);
      console.log(
        JSON.stringify({ artifact: compactArtifact(artifact) }, null, 2)
      );
      return;
    }
    throw new Error(usage);
  }

  if (subcommand === "source") {
    const sourceCommand = rest[1]?.trim();
    const agentId = rest[2]?.trim();
    const usage =
      "usage: agent source <deploy-plan|checks|check-status|manifest-snapshots|publish> <id> --team-id <id>";
    const teamId = requiredTeamId(options, usage);
    if (!sourceCommand || !agentId) {
      throw new Error(usage);
    }
    if (sourceCommand === "deploy-plan") {
      const deployPlan = await client.agents.sourceDeployPlan(agentId, {
        teamId,
      });
      console.log(JSON.stringify({ deployPlan }, null, 2));
      return;
    }
    if (sourceCommand === "manifest-snapshots") {
      const manifestSnapshots = await client.agents.manifestSnapshots(agentId, {
        teamId,
        limit: parsePositiveLimit(options.limit),
      });
      console.log(JSON.stringify({ manifestSnapshots }, null, 2));
      return;
    }
    if (sourceCommand === "checks") {
      const result = await client.agents.requestSourceChecks(
        agentId,
        buildAgentSourceChecksInput(teamId, options)
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (sourceCommand === "check-status") {
      const status = await client.workItems.status(agentId, {
        teamId,
        limit: parsePositiveLimit(options.limit),
        includeArchived: true,
      });
      console.log(
        JSON.stringify(
          compactWorkItemStatusResult(status),
          null,
          2
        )
      );
      return;
    }
    if (sourceCommand === "publish") {
      const result = await client.agents.publishSource(
        agentId,
        buildAgentSourcePublishInput(teamId, options)
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    throw new Error(usage);
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
    "usage: agent <inspect|build|validate|eval|traces|list|create|upsert|get|update|run|run-test|bind-source|source|edit|archive> [--team-id <id>] [--project-id <id>] [--name <name>]"
  );
}

const LOCAL_AGENT_SDK_COMMANDS = new Set([
  "inspect",
  "build",
  "validate",
  "eval",
  "traces",
]);

function shouldDelegateLocalAgentSdkCommand(
  subcommand: string,
  options: Record<string, string | boolean>
): boolean {
  if (LOCAL_AGENT_SDK_COMMANDS.has(subcommand)) return true;
  return subcommand === "run" && !optionString(options, "teamId");
}

async function runLocalAgentSdkCommand(
  options: Record<string, string | boolean>,
  rest: string[]
): Promise<void> {
  const subcommand = rest[0] || "inspect";
  const cwd = path.resolve(
    optionString(options, "cwd") || optionString(options, "path") || "."
  );
  const args = [subcommand, ...rest.slice(1), "--cwd", cwd];
  if (parseBooleanOption(options.json)) args.push("--json");
  appendForwardedOption(args, options, "input", "input");
  appendForwardedOption(args, options, "inputFile", "input-file");

  const command = resolveLocalAgentSdkCommand(cwd);
  const result = await runCommand(command.command, [...command.args, ...args], {
    cwd,
    inherit: true,
  });
  if (result.code !== 0) process.exitCode = result.code ?? 1;
}

function appendForwardedOption(
  args: string[],
  options: Record<string, string | boolean>,
  optionKey: string,
  cliName: string
): void {
  const value = optionString(options, optionKey);
  if (value) args.push(`--${cliName}`, value);
}

function resolveLocalAgentSdkCommand(cwd: string): {
  command: string;
  args: string[];
} {
  const packageDistCli = path.join(
    cwd,
    "node_modules",
    "openpond-agent-sdk",
    "dist",
    "cli.js"
  );
  if (existsSync(packageDistCli)) return { command: "bun", args: [packageDistCli] };
  const localBin = path.join(cwd, "node_modules", ".bin", "openpond-agent");
  if (existsSync(localBin)) return { command: localBin, args: [] };
  const packageCli = path.join(
    cwd,
    "node_modules",
    "openpond-agent-sdk",
    "src",
    "cli.ts"
  );
  if (existsSync(packageCli)) return { command: "bun", args: [packageCli] };
  return { command: "openpond-agent", args: [] };
}
