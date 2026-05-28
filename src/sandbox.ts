import { apiFetch, readApiJson } from "./api-core";
import {
  DEFAULT_OPENPOND_API_BASE_URL,
  DEFAULT_OPENPOND_WEB_BASE_URL,
} from "./urls";

export type SandboxState = "creating" | "running" | "stopped" | "archived" | "deleted" | "error";

export type SandboxRuntimeDriver = "simulated-firecracker" | "remote-firecracker";

export type SandboxResources = {
  cpu: number;
  memoryGb: number;
  diskGb: number;
};

export type SandboxBudget = {
  maxUsd: string;
};

export type SandboxEnvVarInput = {
  name: string;
  value?: string;
  secretRef?: string;
};

export type SandboxQuotaPolicy = {
  maxDurationSeconds: number;
  idleTimeoutSeconds: number;
  maxCommands: number;
  maxOpenPorts: number;
  maxSnapshots: number;
  maxSpendUsd: string;
};

export type SandboxVolumeProvisionInput = {
  name?: string;
  mountPath?: string;
  storageGb?: number;
  deleteOnSandboxDelete?: boolean;
};

export type SandboxIntegrationProvider =
  | "google"
  | "slack"
  | "github"
  | "x"
  | "notion"
  | "linear";

export type SandboxIntegrationConnectionStatus =
  | "active"
  | "revoked"
  | "error";

export type SandboxIntegrationConnectionStatusFilter =
  | SandboxIntegrationConnectionStatus
  | "all";

export type SandboxIntegrationConnection = {
  id: string;
  provider: SandboxIntegrationProvider;
  ownerUserId: string;
  teamId: string;
  providerAccountId: string;
  providerAccountName: string | null;
  providerWorkspaceId: string | null;
  providerWorkspaceName: string | null;
  scopes: string[];
  status: SandboxIntegrationConnectionStatus;
  connectedAt: string;
  lastRefreshedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SandboxIntegrationLeaseInput = {
  leaseId: string;
  provider: SandboxIntegrationProvider;
  scopes?: string[];
  capabilities?: string[];
  resourcePolicy?: Record<string, unknown>;
  expiresAt?: string;
  proxyUrl?: string;
  required?: boolean;
};

export type SandboxIntegrationConnectionLeaseInput = {
  connectionId: string;
  scopes?: string[];
  capabilities: string[];
  resourcePolicy?: Record<string, unknown>;
  expiresAt?: string;
  ttlSeconds?: number;
  required?: boolean;
};

export type SandboxIntegrationLeaseRef = {
  leaseId: string;
  provider: SandboxIntegrationProvider;
  scopes: string[];
  capabilities: string[];
  resourcePolicy: Record<string, unknown>;
  expiresAt: string | null;
  proxyUrl: string | null;
  required: boolean;
};

export type SandboxCreateInput = {
  repo?: string;
  teamId?: string;
  projectId?: string;
  agentId?: string;
  command?: string;
  visibility?: "private" | "team";
  resources?: Partial<SandboxResources>;
  budget?: Partial<SandboxBudget>;
  env?: SandboxEnvVarInput[];
  networkPolicy?: Record<string, unknown>;
  quotas?: Partial<SandboxQuotaPolicy>;
  volumes?: SandboxVolumeProvisionInput[];
  integrationLeases?: SandboxIntegrationLeaseInput[];
  integrationConnectionLeases?: SandboxIntegrationConnectionLeaseInput[];
  metadata?: Record<string, unknown>;
};

export type SandboxCreateOptions = {
  async?: boolean;
};

export type SandboxScheduleType = "rate" | "cron" | "once";
export type SandboxScheduleRuntimePolicy =
  | "run_and_stop"
  | "run_and_archive"
  | "run_and_delete"
  | "use_existing_running";
export type SandboxScheduleTargetKind = "action" | "command";
export type SandboxScheduleLifecycleStatus =
  | "active"
  | "completed"
  | "expired"
  | "max_runs_reached"
  | "stopped"
  | "failed"
  | "deleted";
export type SandboxScheduleSyncStatus = "pending" | "syncing" | "synced" | "failed";
export type SandboxScheduleRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";
export type SandboxScheduleRunCleanupStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "skipped";
export type SandboxScheduleManagementSource = "api" | "ui" | "openpond.yaml";

export type SandboxScheduleTarget = {
  kind: SandboxScheduleTargetKind;
  actionName: string | null;
  command: string | null;
  requiresStart: boolean;
};

export type SandboxScheduleCreateInput = {
  teamId?: string;
  projectId?: string;
  agentId?: string;
  sourceSandboxId?: string;
  snapshotId?: string;
  templateId?: string;
  name: string;
  description?: string;
  scheduleType: SandboxScheduleType;
  scheduleExpression: string;
  timezone?: string;
  enabled?: boolean;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  maxRuns?: number | null;
  runtimePolicy?: SandboxScheduleRuntimePolicy;
  target?: Partial<SandboxScheduleTarget>;
  actionName?: string;
  command?: string;
  requiresStart?: boolean;
  budget?: Partial<SandboxBudget>;
  resources?: Partial<SandboxResources>;
  quotas?: Partial<SandboxQuotaPolicy>;
  lifecycle?: Record<string, unknown>;
  retentionPolicy?: Record<string, unknown>;
  env?: SandboxEnvVarInput[];
  integrationLeases?: SandboxIntegrationLeaseInput[];
  metadata?: Record<string, unknown>;
  managementSource?: SandboxScheduleManagementSource;
  manifestPath?: string;
};

export type SandboxScheduleUpdateInput = Partial<
  Omit<SandboxScheduleCreateInput, "teamId" | "sourceSandboxId" | "snapshotId" | "templateId">
> & {
  description?: string | null;
};

export type SandboxScheduleRecord = {
  id: string;
  teamId: string;
  ownerUserId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  scheduleType: SandboxScheduleType;
  scheduleExpression: string;
  enabled: boolean;
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  maxRuns: number | null;
  executionCount: number;
  lifecycleStatus: SandboxScheduleLifecycleStatus;
  lifecycleReason: string | null;
  runtimePolicy: SandboxScheduleRuntimePolicy;
  sourceSandboxId: string | null;
  snapshotId: string | null;
  templateId: string | null;
  target: SandboxScheduleTarget;
  budget: SandboxBudget | null;
  resources: SandboxResources | null;
  quotas: Partial<SandboxQuotaPolicy> | null;
  lifecycle: Record<string, unknown> | null;
  retentionPolicy: Record<string, unknown> | null;
  env: SandboxEnvVarInput[];
  integrationLeases: SandboxIntegrationLeaseInput[];
  metadata: Record<string, unknown>;
  managementSource: SandboxScheduleManagementSource;
  manifestPath: string | null;
  awsScheduleProvider: "eventbridge_scheduler" | null;
  awsScheduleName: string | null;
  awsScheduleArn: string | null;
  syncStatus: SandboxScheduleSyncStatus;
  syncError: string | null;
  syncRequestedAt: string | null;
  lastSyncedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: SandboxScheduleRunStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type SandboxScheduleRun = {
  id: string;
  scheduleId: string;
  sandboxId: string | null;
  teamId: string;
  ownerUserId: string;
  idempotencyKey: string;
  status: SandboxScheduleRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  durationSeconds: number | null;
  totalUsd: string | null;
  receiptId: string | null;
  logRef: string | null;
  artifactRefs: string[];
  failureReason: string | null;
  cleanupStatus: SandboxScheduleRunCleanupStatus;
  stopPolicyApplied: SandboxScheduleRuntimePolicy | null;
  logs: string[];
  output: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SandboxForkInput = {
  snapshotId?: string;
  visibility?: "private" | "team";
  resources?: Partial<SandboxResources>;
  budget?: Partial<SandboxBudget>;
  env?: SandboxEnvVarInput[];
  networkPolicy?: Record<string, unknown>;
  quotas?: Partial<SandboxQuotaPolicy>;
  volumes?: SandboxVolumeProvisionInput[];
  integrationLeases?: SandboxIntegrationLeaseInput[];
  metadata?: Record<string, unknown>;
};

export type SandboxForkOptions = {
  async?: boolean;
};

export type SandboxTemplateLaunchInput = Omit<SandboxForkInput, "snapshotId"> & {
  snapshotId?: string;
  templateName?: string;
  version?: string;
  useCase?: string;
  schedules?: SandboxScheduleCreateInput[];
};

export type SandboxSecretScope = "team" | "project" | "template";
export type SandboxSecretStatus = "active" | "revoked" | "deleted";
export type SandboxSecretAttachmentTarget =
  | "sandbox"
  | "template"
  | "project"
  | "agent"
  | "replay";

export type SandboxSecretAttachmentMetadata = {
  envName: string;
  targetType: SandboxSecretAttachmentTarget;
  targetId: string;
  attachedAt: string;
  detachedAt: string | null;
};

export type SandboxSecretMetadata = {
  id: string;
  teamId: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  scope: SandboxSecretScope;
  status: SandboxSecretStatus;
  secretRef: string;
  currentVersion: number | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  deletedAt: string | null;
  attachments?: SandboxSecretAttachmentMetadata[];
};

export type SandboxSecretCreateInput = {
  teamId?: string;
  name: string;
  value: string;
  description?: string;
  scope?: SandboxSecretScope;
};

export type SandboxSecretRotateInput = {
  teamId?: string;
  value: string;
};

export type SandboxSecretAttachInput = {
  teamId?: string;
  envName: string;
  targetType: SandboxSecretAttachmentTarget;
  targetId: string;
};

export type SandboxSecretListResponse = {
  secrets: SandboxSecretMetadata[];
};

export type SandboxSecretResponse = {
  secret: SandboxSecretMetadata;
};

export type SandboxExecInput = {
  command: string;
  timeoutSeconds?: number;
};

export type SandboxProcessStartInput = {
  command: string;
  timeoutSeconds?: number;
};

export type SandboxProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stopped";

export type SandboxProcess = {
  id: string;
  command: string;
  status: SandboxProcessStatus;
  output: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  outputBytes: number;
  truncated?: boolean;
};

export type SandboxPreviewAccess = "private" | "public";

export type SandboxPreviewCorsPolicy = {
  allowOrigins?: string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
};

export type SandboxPreviewHeaderPolicy = {
  responseHeaders?: Record<string, string>;
};

export type SandboxPreviewAuthPolicyInput =
  | {
      mode: "bearer";
      token: string;
    }
  | {
      mode: "header";
      headerName: string;
      headerValue: string;
    };

export type SandboxPreviewAuthPolicy =
  | {
      mode: "bearer";
      tokenSha256: string;
    }
  | {
      mode: "header";
      headerName: string;
      headerValueSha256: string;
    };

export type SandboxPtyStartInput = {
  command?: string;
  timeoutSeconds?: number;
  rows?: number;
  cols?: number;
};

export type SandboxPtyInput = {
  dataBase64: string;
};

export type SandboxPtyStatus = "running" | "exited" | "failed" | "timed_out" | "stopped";

export type SandboxPtySession = {
  id: string;
  command: string;
  status: SandboxPtyStatus;
  output: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  outputBytes: number;
  rows: number;
  cols: number;
  truncated?: boolean;
};

export type SandboxOpenPortInput = {
  port: number;
  label?: string;
  access?: SandboxPreviewAccess;
  autoStart?: boolean;
  customDomain?: string;
  cors?: SandboxPreviewCorsPolicy;
  headerPolicy?: SandboxPreviewHeaderPolicy;
  authPolicy?: SandboxPreviewAuthPolicyInput;
};

export type SandboxGitStatus = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  porcelain: string;
};

export type SandboxGitDiffInput = {
  baseRef?: string;
};

export type SandboxGitDiff = {
  isRepo: boolean;
  baseRef: string | null;
  diff: string;
};

export type SandboxGitBranchInput = {
  branch: string;
  create?: boolean;
  startPoint?: string;
};

export type SandboxGitBranch = {
  isRepo: boolean;
  branch: string | null;
  output: string;
  status: SandboxGitStatus;
};

export type SandboxGitCommitInput = {
  message: string;
  paths?: string[];
  all?: boolean;
};

export type SandboxGitCommit = {
  isRepo: boolean;
  commitHash: string | null;
  output: string;
  status: SandboxGitStatus;
};

export type SandboxGitPullInput = {
  remote?: string;
  branch?: string;
  rebase?: boolean;
  ffOnly?: boolean;
};

export type SandboxGitPushInput = {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
};

export type SandboxGitRemoteOperation = {
  isRepo: boolean;
  remote: string | null;
  branch: string | null;
  output: string;
  status: SandboxGitStatus;
};

export type SandboxFileRef = {
  path: string;
  sizeBytes: number;
  updatedAt: string;
  isBinary?: boolean | null;
  previewable?: boolean;
};

export type SandboxFileEntry = SandboxFileRef & {
  type: "file" | "directory";
};

export type SandboxFileDownloadInput = {
  path: string;
  offsetBytes?: number;
  maxBytes?: number;
};

export type SandboxFileListInput = {
  path?: string;
  recursive?: boolean;
  maxEntries?: number;
};

export type SandboxFileMkdirInput = {
  path: string;
  recursive?: boolean;
};

export type SandboxFileMoveInput = {
  fromPath: string;
  toPath: string;
  overwrite?: boolean;
};

export type SandboxFileSearchInput = {
  query: string;
  path?: string;
  maxResults?: number;
};

export type SandboxFileSearchMatch = {
  path: string;
  line: number;
  preview: string;
};

export type SandboxPricingRate = {
  key: "cpu" | "memory" | "disk" | "durable_volume_storage";
  label: string;
  unit: string;
  unitPriceUsd: string;
  unitPriceHourlyUsd: string;
  unitPriceMonthlyUsd: string | null;
};

export type SandboxPublicResourceTierKey =
  | "tiny"
  | "small"
  | "default"
  | "builder"
  | "heavy-builder";

export type SandboxKeepRunningEstimateLineItem = {
  label: string;
  quantity: number;
  unit: string;
  hourlyUsd: string;
  monthlyUsd: string;
};

export type SandboxKeepRunningEstimate = {
  resources: SandboxResources;
  matchedTierKey: SandboxPublicResourceTierKey | null;
  hourlyUsd: string;
  monthlyUsd: string;
  durationDays: number;
  pricingSource: "openpond_poc_config";
  lineItems: SandboxKeepRunningEstimateLineItem[];
};

export type SandboxPublicResourceTier = {
  key: SandboxPublicResourceTierKey;
  label: string;
  description: string;
  resources: SandboxResources;
  goodFit: string[];
  poorFit: string[];
  keepRunningEstimate: SandboxKeepRunningEstimate;
};

export type SandboxPricingRateCard = {
  currency: "USD";
  source: "openpond_poc_config";
  effectiveAt: string;
  rates: SandboxPricingRate[];
  tiers: SandboxPublicResourceTier[];
};

export type SandboxCostLineItemSummary = {
  label: string;
  unit: string;
  quantity: number;
  amountUsd: string;
};

export type SandboxCostSandboxSummary = {
  sandboxId: string;
  state: SandboxState;
  repo: string | null;
  createdAt: string;
  updatedAt: string;
  receiptCount: number;
  totalUsd: string;
  durationSeconds: number;
  latestReceiptRef: string | null;
  latestReceiptAt: string | null;
};

export type SandboxCostSummary = {
  teamId: string;
  ownerUserId: string;
  pricing: SandboxPricingRateCard;
  summary: {
    sandboxCount: number;
    runningCount: number;
    stoppedCount: number;
    archivedCount: number;
    receiptCount: number;
    totalUsd: string;
    totalDurationSeconds: number;
    activeReservedUsd: string;
    activeRemainingBudgetUsd: string;
    activeRunnerSlots: number;
  };
  lineItems: SandboxCostLineItemSummary[];
  sandboxes: SandboxCostSandboxSummary[];
  recentReceipts: SandboxReceipt[];
  generatedAt: string;
};

export type SandboxBillingStatus = {
  sandboxId: string;
  state: SandboxState;
  billingModel: "reserve_capture" | "session";
  reservationStatus: SandboxReservation["status"];
  budgetUsd: string;
  reservedUsd: string;
  capturedUsd: string;
  remainingBudgetUsd: string;
  mppMode: NonNullable<SandboxReservation["mpp"]>["mode"] | null;
  sessionRef: string | null;
  channelId: string | null;
  depositUsd: string | null;
  acceptedCumulativeUsd: string | null;
  remainingSessionUsd: string | null;
  tickCount: number;
  lastTickAt: string | null;
  finalizedAt: string | null;
  lastReceiptRef: string | null;
  keepRunningEstimate?: SandboxKeepRunningEstimate;
};

export type SandboxReservation = {
  id: string;
  status: "reserved" | "captured" | "released";
  reservedUsd: string;
  capturedUsd: string;
  mpp?: {
    mode: "simulated_poc" | "mpp_service_hook" | "mpp_session_hook";
    settlementRail: "tempo_usdce";
    reservationRef: string;
    sessionRef?: string | null;
    channelId?: string | null;
    depositUsd?: string | null;
    acceptedCumulativeUsd?: string | null;
    remainingUsd?: string | null;
    tickCount?: number;
    lastTickAt?: string | null;
    finalizedAt?: string | null;
    lastReceiptRef?: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type SandboxReceiptLineItem = {
  label: string;
  quantity: number;
  unit: string;
  unitPriceUsd: string;
  amountUsd: string;
};

export type SandboxReceipt = {
  id: string;
  sandboxId: string;
  reservationId: string;
  status: "captured" | "released";
  reason:
    | "stopped"
    | "deleted"
    | "archived"
    | "budget_exhausted"
    | "duration_exceeded"
    | "idle_timeout"
    | "manual_capture";
  totalUsd: string;
  durationSeconds: number;
  lineItems: SandboxReceiptLineItem[];
  mpp: {
    mode: "simulated_poc" | "mpp_service_hook" | "mpp_session_hook";
    settlementRail: "tempo_usdce";
    receiptRef: string;
    sessionRef?: string | null;
    channelId?: string | null;
    acceptedCumulativeUsd?: string | null;
    depositUsd?: string | null;
    remainingUsd?: string | null;
  };
  createdAt: string;
};

export type SandboxCommand = {
  id: string;
  command: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  output: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
};

export type SandboxPreviewPort = {
  id: string;
  port: number;
  label: string | null;
  url: string;
  targetUrl?: string | null;
  customDomain?: string | null;
  access: SandboxPreviewAccess;
  autoStart?: boolean;
  cors?: SandboxPreviewCorsPolicy;
  headerPolicy?: SandboxPreviewHeaderPolicy;
  authPolicy?: SandboxPreviewAuthPolicy;
  token: string;
  createdAt: string;
};

export type SandboxSnapshotTemplateVisibility = "private" | "team";

export type SandboxSnapshotTemplateInput = {
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  visibility?: SandboxSnapshotTemplateVisibility;
  useCase?: string;
};

export type SandboxSnapshotTemplate = {
  name: string;
  version: string;
  description: string | null;
  tags: string[];
  visibility: SandboxSnapshotTemplateVisibility;
  useCase: string | null;
};

export type SandboxSnapshotReplayRetentionClass =
  | "ephemeral"
  | "cached"
  | "pinned";

export type SandboxSnapshotReplayState = "draft" | "validated" | "published";

export type SandboxSnapshotReplayManifest = {
  state: SandboxSnapshotReplayState;
  retention: {
    class: SandboxSnapshotReplayRetentionClass;
    ttlSeconds: number | null;
  };
  metadata?: Record<string, unknown>;
};

export type SandboxSnapshotValidationCommandResult = {
  command: string;
  cwd: string | null;
  status: SandboxCommand["status"];
  exitCode: number | null;
  output: string;
  startedAt: string;
  completedAt: string | null;
};

export type SandboxSnapshotValidationProbeResult = {
  name: string | null;
  port: number;
  path: string;
  expectedStatus: number;
  actualStatus: number | null;
  ok: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type SandboxSnapshotValidationResult = {
  id: string;
  status: "passed" | "failed";
  sourceSandboxId: string;
  validationSandboxId: string | null;
  snapshotId: string;
  commands: SandboxSnapshotValidationCommandResult[];
  probes: SandboxSnapshotValidationProbeResult[];
  cleanup: {
    action: "stop" | "delete" | "archive";
    status: "succeeded" | "failed" | "skipped";
    error: string | null;
  };
  error: string | null;
  startedAt: string;
  completedAt: string;
};

export type SandboxSnapshotValidateInput = {
  cleanup?: "stop" | "delete" | "archive";
};

export type SandboxSnapshotTemplateUpdateInput = {
  description?: string | null;
  tags?: string[];
  visibility?: SandboxSnapshotTemplateVisibility;
  useCase?: string | null;
};

export type SandboxSnapshotRetentionUpdateInput = {
  class?: SandboxSnapshotReplayRetentionClass;
  ttlSeconds?: number | null;
};

export type SandboxSnapshotUpdateInput = {
  template?: SandboxSnapshotTemplateUpdateInput;
  retention?: SandboxSnapshotRetentionUpdateInput;
};

export type SandboxSnapshotInput = Record<string, unknown>;

export type SandboxSnapshot = {
  id: string;
  sandboxId: string;
  name: string;
  state: "ready";
  sizeGb: number;
  template?: SandboxSnapshotTemplate | null;
  replay?: SandboxSnapshotReplayManifest | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type SandboxSnapshotJob = {
  id: string;
  snapshotId: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type SandboxArchiveRef = {
  id: string;
  sandboxId: string;
  snapshotId: string | null;
  storage: "simulated" | "runner_local" | "s3";
  createdAt: string;
  restoredAt: string | null;
};

export type SandboxSnapshotCatalogEntry = {
  id: string;
  kind: "snapshot" | "archive";
  sandboxId: string;
  sandboxState: SandboxState;
  sandboxRepo: string | null;
  teamId: string;
  projectId?: string | null;
  agentId?: string | null;
  name: string;
  snapshot: SandboxSnapshot | null;
  archive: SandboxArchiveRef | null;
  sizeGb: number | null;
  storage: SandboxArchiveRef["storage"] | "snapshot" | null;
  storageCost?: {
    sizeGb: number | null;
    retentionClass: SandboxSnapshotReplayRetentionClass | null;
    estimatedMonthlyUsd: string | null;
    pricingSource: "configured" | "not_configured";
  };
  template: SandboxSnapshotTemplate | null;
  replay?: SandboxSnapshotReplayManifest | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type SandboxTemplateCatalogEntry = {
  id: string;
  snapshotId: string;
  sandboxId: string;
  sandboxState: SandboxState;
  sandboxRepo: string | null;
  teamId: string;
  projectId: string | null;
  agentId: string | null;
  name: string;
  version: string;
  description: string | null;
  tags: string[];
  visibility: SandboxSnapshotTemplateVisibility;
  useCase: string | null;
  sizeGb: number | null;
  source?: {
    repo: string | null;
    ref: string | null;
    commitSha: string | null;
    projectId: string | null;
    agentId: string | null;
  };
  storageCost?: SandboxSnapshotCatalogEntry["storageCost"];
  replay: SandboxSnapshotReplayManifest;
  snapshot: SandboxSnapshot;
  createdAt: string;
};

export type SandboxTemplateBuildStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SandboxTemplateBuildPublishStatus =
  | "skipped"
  | "published"
  | "failed";

export type SandboxTemplateBuildCreateInput = {
  teamId?: string;
  sourceRepoUrl?: string;
  sourceProjectId?: string;
  branch?: string;
  manifestPath?: string;
  publish?: boolean;
};

export type SandboxTemplateBuildRecord = {
  id: string;
  teamId: string;
  sourceProjectId: string | null;
  sourceRepoUrl: string;
  sourceOwner: string;
  sourceRepo: string;
  sourceBranch: string;
  sourceCommitSha: string | null;
  manifestPath: string;
  manifestHash: string | null;
  manifest: Record<string, unknown> | null;
  status: SandboxTemplateBuildStatus;
  buildSandboxId: string | null;
  snapshotId: string | null;
  validationSandboxId: string | null;
  validation: Record<string, unknown> | null;
  publishStatus: SandboxTemplateBuildPublishStatus | null;
  logs: string[];
  error: string | null;
  requestedByUserId: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OpenPondOrganizationRole = "owner" | "admin" | "member";

export type OpenPondOrganizationStatus = "active" | "disabled" | "archived";

export type OpenPondOrganization = {
  teamId: string;
  slug: string;
  name: string;
  displayName: string;
  role: OpenPondOrganizationRole;
  status: OpenPondOrganizationStatus;
  primaryContactEmail: string | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpenPondOrganizationCreateInput = {
  displayName: string;
  slug?: string | null;
  primaryContactEmail?: string | null;
  customDomain?: string | null;
};

export type OpenPondOrganizationUpdateInput = Partial<
  OpenPondOrganizationCreateInput & {
    status: OpenPondOrganizationStatus;
  }
>;

export type OpenPondOrganizationMember = {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: OpenPondOrganizationRole;
  createdAt: string;
};

export type OpenPondOrganizationMemberUpsertInput = {
  email: string;
  role: OpenPondOrganizationRole;
};

export type OpenPondOrganizationMcpServerStatus =
  | "active"
  | "disabled"
  | "rotating";

export type OpenPondOrganizationMcpServer = {
  id: string;
  teamId: string;
  slug: string;
  displayName: string;
  resourceUrl: string;
  transportUrl: string;
  toolset: string[];
  status: OpenPondOrganizationMcpServerStatus;
  generatedByUserId: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpenPondOrganizationMcpGenerateInput = {
  origin?: string | null;
  toolset?: string[] | null;
};

export type SandboxProjectStatus = "active" | "disabled" | "archived";
export type SandboxProjectSourceType =
  | "github_repo"
  | "internal_repo"
  | "template"
  | "manual";

export type SandboxAgentStatus = "active" | "disabled" | "archived";
export type SandboxAgentWorkflowIntent =
  | "one_off"
  | "scheduled"
  | "code_change"
  | "evaluation"
  | "integration_task";
export type SandboxAgentTriggerType =
  | "manual"
  | "schedule"
  | "endpoint"
  | "background";
export type SandboxAgentEntrypointScope =
  | "entire_manifest"
  | "start"
  | "action"
  | "service"
  | "schedule";
export type SandboxAgentRunStatus =
  | "queued"
  | "runtime_created"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SandboxAgentSelectedEntrypoint = {
  scope: SandboxAgentEntrypointScope;
  name: string | null;
};

export type SandboxProject = {
  id: string;
  teamId: string;
  createdByUserId: string;
  name: string;
  slug: string;
  description: string | null;
  status: SandboxProjectStatus;
  sourceType: SandboxProjectSourceType;
  sourceConfig: Record<string, unknown>;
  normalizedSourceIdentity: string;
  externalId: string | null;
  gitProvider: string | null;
  gitHost: string | null;
  gitOwner: string | null;
  gitRepo: string | null;
  gitBranch: string | null;
  defaultBranch: string | null;
  internalRepoPath: string | null;
  templateSourceProjectId: string | null;
  templateRepoUrl: string | null;
  templateBranch: string | null;
  templateRemoteSha: string | null;
  sandboxManifest: Record<string, unknown> | null;
  sandboxActionRegistry: Record<string, unknown> | null;
  sandboxManifestHash: string | null;
  sandboxManifestPath: string | null;
  sandboxManifestSyncedAt: string | null;
  sandboxManifestError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SandboxAgent = {
  id: string;
  teamId: string;
  createdByUserId: string;
  name: string;
  slug: string;
  description: string | null;
  status: SandboxAgentStatus;
  projectId: string;
  workflowIntent: SandboxAgentWorkflowIntent | null;
  selectedEntrypoint: SandboxAgentSelectedEntrypoint;
  triggerType: SandboxAgentTriggerType;
  endpointPolicy: Record<string, unknown>;
  backgroundTaskPolicy: Record<string, unknown>;
  defaultRuntimeMode: SandboxRuntimeMode;
  defaultBranch: string | null;
  sourceRefOverride: string | null;
  defaultPromotionPolicy: SandboxRuntimePromotionPolicy;
  defaultResourcePolicy: Record<string, unknown>;
  defaultLifecyclePolicy: Record<string, unknown>;
  defaultCheckpointPolicy: Record<string, unknown>;
  requiredIntegrationRefs: string[];
  requiredEnvironmentVariableRefs: string[];
  schedulePolicy: Record<string, unknown>;
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SandboxAgentRun = {
  id: string;
  teamId: string;
  projectId: string;
  agentId: string;
  requestedByUserId: string;
  idempotencyKey: string | null;
  triggerType: SandboxAgentTriggerType;
  status: SandboxAgentRunStatus;
  runtimeId: string | null;
  sandboxId: string | null;
  selectedEntrypoint: SandboxAgentSelectedEntrypoint;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type SandboxProjectUpsertInput = {
  teamId: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  status?: SandboxProjectStatus;
  sourceType: SandboxProjectSourceType;
  sourceConfig?: Record<string, unknown>;
  normalizedSourceIdentity?: string | null;
  externalId?: string | null;
  gitProvider?: string | null;
  gitHost?: string | null;
  gitOwner?: string | null;
  gitRepo?: string | null;
  gitBranch?: string | null;
  defaultBranch?: string | null;
  internalRepoPath?: string | null;
  templateSourceProjectId?: string | null;
  templateRepoUrl?: string | null;
  templateBranch?: string | null;
  templateRemoteSha?: string | null;
  metadata?: Record<string, unknown>;
};

export type SandboxAgentUpsertInput = {
  teamId: string;
  projectId: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  status?: SandboxAgentStatus;
  workflowIntent?: SandboxAgentWorkflowIntent | null;
  selectedEntrypoint?: Partial<SandboxAgentSelectedEntrypoint> | null;
  triggerType?: SandboxAgentTriggerType;
  endpointPolicy?: Record<string, unknown>;
  backgroundTaskPolicy?: Record<string, unknown>;
  defaultRuntimeMode?: SandboxRuntimeMode;
  defaultBranch?: string | null;
  sourceRefOverride?: string | null;
  defaultPromotionPolicy?: SandboxRuntimePromotionPolicy;
  defaultResourcePolicy?: Record<string, unknown>;
  defaultLifecyclePolicy?: Record<string, unknown>;
  defaultCheckpointPolicy?: Record<string, unknown>;
  requiredIntegrationRefs?: string[];
  requiredEnvironmentVariableRefs?: string[];
  schedulePolicy?: Record<string, unknown>;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
};

export type SandboxAgentRunInput = {
  teamId: string;
  idempotencyKey?: string | null;
  triggerType?: SandboxAgentTriggerType;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runtimeMode?: SandboxRuntimeMode;
};

export type SandboxProjectListResponse = { projects: SandboxProject[] };
export type SandboxProjectResponse = { project: SandboxProject };
export type SandboxAgentListResponse = { agents: SandboxAgent[] };
export type SandboxAgentResponse = { agent: SandboxAgent };
export type SandboxAgentRunResponse = {
  agent: SandboxAgent;
  run: SandboxAgentRun;
};

export type SandboxRecord = {
  id: string;
  state: SandboxState;
  runtimeDriver: SandboxRuntimeDriver;
  repo: string | null;
  repoRef?: string | null;
  sourceCommitSha?: string | null;
  teamId: string;
  projectId: string | null;
  agentId: string | null;
  runtimeId?: string | null;
  visibility: "private" | "team";
  ownerUserId: string;
  billingAccountId: string;
  resources: SandboxResources;
  budget: SandboxBudget;
  quotas?: SandboxQuotaPolicy;
  reservation: SandboxReservation;
  commands: SandboxCommand[];
  processes?: SandboxProcess[];
  ptySessions?: SandboxPtySession[];
  integrationLeases?: SandboxIntegrationLeaseRef[];
  previewPorts: SandboxPreviewPort[];
  snapshots?: SandboxSnapshot[];
  snapshotJobs?: SandboxSnapshotJob[];
  archive?: SandboxArchiveRef | null;
  receipts: SandboxReceipt[];
  logs: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  archivedAt?: string | null;
  deletedAt: string | null;
};

export type SandboxCreateResponse = {
  sandbox: SandboxRecord;
};

export type SandboxSnapshotCatalogResponse = {
  snapshots: SandboxSnapshotCatalogEntry[];
};

export type SandboxTemplateCatalogResponse = {
  templates: SandboxTemplateCatalogEntry[];
};

export type SandboxRuntimeMode =
  | "readonly"
  | "attempt"
  | "feature"
  | "rollout"
  | "replay"
  | "template_build"
  | "scheduled_run"
  | "patch_only"
  | "hotfix"
  | "multi_feature_batch";

export type SandboxRuntimeStatus =
  | "created"
  | "materializing"
  | "running"
  | "waiting_for_user"
  | "paused"
  | "checkpointed"
  | "ready_for_review"
  | "promoting"
  | "promoted"
  | "archived"
  | "failed"
  | "expired";

export type SandboxRuntimePromotionPolicy =
  | "none"
  | "manual"
  | "auto_after_checks";

export type SandboxRuntimeActorType = "agent" | "user" | "service" | "schedule";

export type SandboxRuntimePermissions = {
  git: {
    read: boolean;
    writeSourceRef: boolean;
    promote: boolean;
  };
  snapshots: {
    create: boolean;
    restore: boolean;
    checkpoint: boolean;
  };
  artifacts: {
    read: boolean;
    write: boolean;
  };
  sandbox: {
    exec: boolean;
    lifecycle: boolean;
  };
};

export type SandboxRuntime = {
  id: string;
  teamId: string;
  ownerUserId: string;
  createdByUserId: string;
  projectId: string | null;
  agentId: string | null;
  mode: SandboxRuntimeMode;
  status: SandboxRuntimeStatus;
  repoId: string | null;
  baseBranch: string;
  baseSha: string | null;
  sourceRef: string | null;
  currentSha: string | null;
  sandboxId: string | null;
  rootfsSnapshotId: string | null;
  dependencySnapshotId: string | null;
  checkpointSnapshotIds: string[];
  artifactRefs: string[];
  promotionPolicy: SandboxRuntimePromotionPolicy;
  permissions: SandboxRuntimePermissions;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  archivedAt: string | null;
};

export type SandboxRuntimeEvent = {
  id: string;
  runtimeId: string;
  teamId: string;
  sequence: number;
  actorType: SandboxRuntimeActorType;
  actorId: string;
  type: string;
  summary: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  payloadStorageKey: string | null;
  prevEventHash: string | null;
  eventHash: string;
  stateHash: string | null;
  commitSha: string | null;
  snapshotId: string | null;
  logRef: string | null;
  artifactRefs: string[];
  createdAt: string;
};

export type SandboxRuntimeCreateInput = {
  teamId?: string;
  projectId?: string;
  agentId?: string;
  mode?: SandboxRuntimeMode;
  baseBranch?: string;
  baseSha?: string;
  sandboxId?: string;
  rootfsSnapshotId?: string;
  dependencySnapshotId?: string;
  promotionPolicy?: SandboxRuntimePromotionPolicy;
  metadata?: Record<string, unknown>;
};

export type SandboxRuntimeSandboxCreateInput = SandboxCreateInput;

export type SandboxRuntimeEventInput = {
  type: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
  lifecycleHint?: Record<string, unknown>;
  commitSha?: string | null;
  snapshotId?: string | null;
  logRef?: string | null;
  artifactRefs?: string[];
};

export type SandboxRuntimeCheckpointInput = {
  name?: string;
  rootfsSnapshotId?: string;
  dependencySnapshotId?: string;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type SandboxRuntimePromoteInput = {
  expectedTargetSha: string;
  validationState?: "pending" | "passed";
  summary?: string;
};

export type SandboxRuntimeTransitionInput = {
  status: SandboxRuntimeStatus;
  expectedVersion: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type SandboxRuntimeListResponse = {
  runtimes: SandboxRuntime[];
};

export type SandboxRuntimeResponse = {
  runtime: SandboxRuntime;
};

export type SandboxRuntimeSandboxResponse = SandboxCreateResponse & {
  runtime: SandboxRuntime;
};

export type SandboxRuntimeEventResponse = {
  runtime: SandboxRuntime;
  event: SandboxRuntimeEvent;
};

export type SandboxRuntimeEventsResponse = {
  runtimeId: string;
  events: SandboxRuntimeEvent[];
};

export type SandboxRuntimePromoteResponse = {
  runtime: SandboxRuntime;
  promotedSha: string;
};

export type SandboxIntegrationConnectionsResponse = {
  teamId: string;
  connections: SandboxIntegrationConnection[];
};

export type SandboxIntegrationLeasesResponse = {
  sandbox: SandboxRecord;
  integrationLeases: SandboxIntegrationLeaseRef[];
};

export type SandboxExecResponse = {
  sandbox: SandboxRecord;
  command: SandboxCommand;
};

export type SandboxProcessStartResponse = {
  sandbox: SandboxRecord;
  process: SandboxProcess;
};

export type SandboxProcessListResponse = {
  sandbox: SandboxRecord;
  processes: SandboxProcess[];
};

export type SandboxProcessStatusResponse = {
  sandbox: SandboxRecord;
  process: SandboxProcess;
  output?: string;
  cursor?: number;
  completed?: boolean;
};

export type SandboxProcessStopResponse = {
  sandbox: SandboxRecord;
  process: SandboxProcess;
};

export type SandboxPtyStartResponse = {
  sandbox: SandboxRecord;
  pty: SandboxPtySession;
};

export type SandboxPtyListResponse = {
  sandbox: SandboxRecord;
  ptys: SandboxPtySession[];
};

export type SandboxPtyStatusResponse = {
  sandbox: SandboxRecord;
  pty: SandboxPtySession;
  output?: string;
  cursor?: number;
  completed?: boolean;
};

export type SandboxPtyInputResponse = {
  sandbox: SandboxRecord;
  pty: SandboxPtySession;
};

export type SandboxPtyStopResponse = {
  sandbox: SandboxRecord;
  pty: SandboxPtySession;
};

export type SandboxOpenPortResponse = {
  sandbox: SandboxRecord;
  preview: SandboxPreviewPort;
};

export type SandboxSnapshotResponse = {
  sandbox: SandboxRecord;
  snapshot: SandboxSnapshot;
};

export type SandboxSnapshotValidationResponse = {
  sandbox: SandboxRecord;
  snapshot: SandboxSnapshot;
  validation: SandboxSnapshotValidationResult;
};

export type SandboxForkResponse = {
  sandbox: SandboxRecord;
  sourceSandbox: SandboxRecord;
  snapshot: SandboxSnapshot | null;
};

export type SandboxTemplateLaunchResponse = SandboxForkResponse & {
  template: SandboxTemplateCatalogEntry;
  schedules?: SandboxScheduleRecord[];
};

export type SandboxScheduleListResponse = {
  schedules: SandboxScheduleRecord[];
};

export type SandboxScheduleResponse = {
  schedule: SandboxScheduleRecord;
};

export type SandboxScheduleRunListResponse = {
  runs: SandboxScheduleRun[];
};

export type SandboxScheduleRunResponse = {
  schedule: SandboxScheduleRecord;
  run: SandboxScheduleRun;
};

export type SandboxReplayInput = {
  snapshotId: string;
  sourceSandboxId?: string;
  entrypoint?: string;
  params?: Record<string, unknown>;
  budget?: Partial<SandboxBudget>;
  maxDurationSeconds?: number;
  idleTimeoutSeconds?: number;
  cleanup?: "stop" | "delete" | "archive";
  artifactPaths?: string[];
  integrationLeases?: SandboxIntegrationLeaseInput[];
  idempotencyKey?: string;
};

export type SandboxReplayState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type SandboxReplayArtifact = {
  path: string;
  status: "captured" | "missing" | "failed";
  sizeBytes: number | null;
  contentsBase64?: string;
  error: string | null;
};

export type SandboxReplayRecord = {
  id: string;
  teamId: string;
  ownerUserId: string;
  sourceSandboxId: string;
  snapshotId: string;
  sandboxId: string | null;
  state: SandboxReplayState;
  entrypoint: {
    name: string | null;
    command: string;
    cwd: string | null;
  };
  params: Record<string, unknown>;
  budget: SandboxBudget;
  maxDurationSeconds: number | null;
  idleTimeoutSeconds: number | null;
  integrationLeases: SandboxIntegrationLeaseInput[];
  artifactPaths: string[];
  artifacts: SandboxReplayArtifact[];
  logs: string[];
  receipts: SandboxReceipt[];
  commandId: string | null;
  exitCode: number | null;
  error: string | null;
  cleanup: {
    action: "stop" | "delete" | "archive";
    status: "pending" | "succeeded" | "failed" | "skipped";
    error: string | null;
  };
  idempotencyKey: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type SandboxReplayResponse = {
  replay: SandboxReplayRecord;
};

export type SandboxReplayListResponse = {
  replays: SandboxReplayRecord[];
};

export type SandboxReplayLogsResponse = {
  replayId: string;
  logs: string[];
};

export type SandboxReplayArtifactsResponse = {
  replayId: string;
  artifacts: SandboxReplayArtifact[];
};

export type SandboxTemplateBuildResponse = {
  build: SandboxTemplateBuildRecord;
};

export type SandboxTemplateBuildListResponse = {
  builds: SandboxTemplateBuildRecord[];
};

export type SandboxTemplateBuildLogsResponse = {
  buildId: string;
  logs: string[];
};

export type OpenPondOrganizationsResponse = {
  organizations: OpenPondOrganization[];
};

export type OpenPondOrganizationResponse = {
  organization: OpenPondOrganization;
};

export type OpenPondOrganizationMembersResponse = {
  members: OpenPondOrganizationMember[];
};

export type OpenPondOrganizationMemberResponse = {
  member: OpenPondOrganizationMember;
};

export type OpenPondOrganizationMcpServerResponse = {
  mcpServer: OpenPondOrganizationMcpServer | null;
};

export type SandboxReceiptResponse = {
  sandbox: SandboxRecord;
  receipt: SandboxReceipt;
};

export type SandboxStartResponse = {
  sandbox: SandboxRecord;
};

export type SandboxRestoreResponse = {
  sandbox: SandboxRecord;
};

export type SandboxReceiptsResponse = {
  receipts: SandboxReceipt[];
};

export type SandboxLogsResponse = {
  logs: string[];
};

export type SandboxGitStatusResponse = {
  sandbox: SandboxRecord;
  status: SandboxGitStatus;
};

export type SandboxGitDiffResponse = {
  sandbox: SandboxRecord;
  diff: SandboxGitDiff;
};

export type SandboxGitBranchResponse = {
  sandbox: SandboxRecord;
  branch: SandboxGitBranch;
};

export type SandboxGitCommitResponse = {
  sandbox: SandboxRecord;
  commit: SandboxGitCommit;
};

export type SandboxGitPullResponse = {
  sandbox: SandboxRecord;
  pull: SandboxGitRemoteOperation;
};

export type SandboxGitPushResponse = {
  sandbox: SandboxRecord;
  push: SandboxGitRemoteOperation;
};

export type SandboxFileUploadResponse = {
  sandbox: SandboxRecord;
  file: SandboxFileRef;
};

export type SandboxFileDownloadResponse = {
  sandbox: SandboxRecord;
  file: SandboxFileRef & {
    contentsBase64: string;
    offsetBytes: number;
    returnedBytes: number;
    totalSizeBytes: number;
    truncated: boolean;
  };
};

export type SandboxFileListResponse = {
  sandbox: SandboxRecord;
  files: SandboxFileEntry[];
};

export type SandboxFileDeleteResponse = {
  sandbox: SandboxRecord;
  deleted: {
    path: string;
  };
};

export type SandboxFileMkdirResponse = {
  sandbox: SandboxRecord;
  directory: SandboxFileEntry;
};

export type SandboxFileMoveResponse = {
  sandbox: SandboxRecord;
  moved: {
    fromPath: string;
    toPath: string;
  };
  file: SandboxFileEntry;
};

export type SandboxFileStatResponse = {
  sandbox: SandboxRecord;
  file: SandboxFileEntry;
};

export type SandboxFileSearchResponse = {
  sandbox: SandboxRecord;
  matches: SandboxFileSearchMatch[];
};

export type SandboxBillingStatusResponse = {
  sandbox: SandboxRecord;
  billing: SandboxBillingStatus;
};

export type SandboxPricingResponse = {
  pricing: SandboxPricingRateCard;
};

export type SandboxCostSummaryResponse = {
  costs: SandboxCostSummary;
};

export type SandboxSmokeOptions = {
  repo?: string;
  budgetUsd?: string;
  cpu?: number;
  memoryGb?: number;
  diskGb?: number;
  keep?: boolean;
  preview?: boolean;
  snapshot?: boolean;
  fork?: boolean;
  expectedRuntimeDriver?: SandboxRuntimeDriver;
  expectedMppMode?: NonNullable<SandboxReservation["mpp"]>["mode"];
};

export type SandboxSmokeSummary = {
  deleted: boolean;
  execOutput: string;
  fileRoundtrip: boolean;
  forkSandboxId: string | null;
  previewStatus: number | null;
  receiptRefs: Array<string | null>;
  reservationRef: string | null;
  runId: string;
  sandboxId: string;
  snapshotId: string | null;
  state: SandboxState;
};

export type OpenPondSandboxClientOptions = {
  baseUrl?: string;
  sandboxApiUrl?: string;
  apiKey: string;
};

export type OpenPondSandboxMcpServerConfig = {
  name: "openpond-sandboxes";
  transport: "streamable-http";
  url: string;
  headers: Record<string, string>;
};

export type OpenPondRuntimeFilesHandle = {
  write(path: string, contents: string): Promise<SandboxFileUploadResponse>;
  read(path: string): Promise<string>;
  readResponse(
    input: string | SandboxFileDownloadInput,
  ): Promise<SandboxFileDownloadResponse>;
  list(input?: SandboxFileListInput): Promise<SandboxFileListResponse>;
  delete(
    path: string,
    input?: { recursive?: boolean },
  ): Promise<SandboxFileDeleteResponse>;
  search(input: SandboxFileSearchInput): Promise<SandboxFileSearchResponse>;
  stat(path: string): Promise<SandboxFileStatResponse>;
  mkdir(input: string | SandboxFileMkdirInput): Promise<SandboxFileMkdirResponse>;
  move(input: SandboxFileMoveInput): Promise<SandboxFileMoveResponse>;
};

export type OpenPondRuntimeCommandsHandle = {
  run(command: string | SandboxExecInput): Promise<SandboxExecResponse>;
};

export type OpenPondRuntimePortsHandle = {
  expose(port: number | SandboxOpenPortInput): Promise<SandboxOpenPortResponse>;
};

export type RuntimeWorkflowCheckpointHintInput = {
  reason?: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
  artifactRefs?: string[];
};

export type RuntimeWorkflowWaitForUserInput = {
  reason?: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
};

export type RuntimeWorkflowKeepAliveInput = {
  reason?: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
  until?: string | Date;
  seconds?: number;
};

export type OpenPondSandboxRuntimeHandle = {
  id: string;
  initial: SandboxRuntime | null;
  get(): Promise<SandboxRuntime>;
  sandbox(input?: SandboxRuntimeSandboxCreateInput): Promise<SandboxRecord>;
  resume(input?: SandboxRuntimeSandboxCreateInput): Promise<SandboxRecord>;
  createSandbox(
    input?: SandboxRuntimeSandboxCreateInput,
  ): Promise<SandboxRuntimeSandboxResponse>;
  status(
    input: SandboxRuntimeTransitionInput | SandboxRuntime["status"],
  ): Promise<SandboxRuntime>;
  events(): Promise<SandboxRuntimeEventsResponse>;
  event(input: SandboxRuntimeEventInput): Promise<SandboxRuntimeEventResponse>;
  recordCommit(
    commitSha: string,
    input?: Omit<SandboxRuntimeEventInput, "commitSha" | "type"> & {
      type?: string;
    },
  ): Promise<SandboxRuntimeEventResponse>;
  checkpointHint(
    input?: RuntimeWorkflowCheckpointHintInput,
  ): Promise<SandboxRuntimeEventResponse>;
  waitForUser(input?: RuntimeWorkflowWaitForUserInput): Promise<SandboxRuntime>;
  keepAlive(
    input?: RuntimeWorkflowKeepAliveInput,
  ): Promise<SandboxRuntimeEventResponse>;
  checkpoint(input: SandboxRuntimeCheckpointInput): Promise<SandboxRuntime>;
  files: OpenPondRuntimeFilesHandle;
  commands: OpenPondRuntimeCommandsHandle;
  ports: OpenPondRuntimePortsHandle;
  promote(
    input: SandboxRuntimePromoteInput,
    options?: { teamId?: string },
  ): Promise<SandboxRuntimePromoteResponse>;
  archive(expectedVersion?: number): Promise<SandboxRuntime>;
};

function runtimeKeepaliveUntilIso(
  input: RuntimeWorkflowKeepAliveInput | undefined,
): string {
  if (input?.until instanceof Date) {
    return input.until.toISOString();
  }
  if (typeof input?.until === "string" && input.until.trim()) {
    return new Date(input.until).toISOString();
  }
  const seconds =
    typeof input?.seconds === "number" && Number.isFinite(input.seconds)
      ? Math.max(1, Math.trunc(input.seconds))
      : 60;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export class OpenPondSandboxClient {
  private readonly apiKey: string;
  private readonly apiRootUrl: string;
  private readonly sandboxApiUrl: string;

  constructor(options: OpenPondSandboxClientOptions) {
    this.apiKey = options.apiKey;
    this.sandboxApiUrl = normalizeSandboxApiUrl(
      options.sandboxApiUrl ?? options.baseUrl ?? DEFAULT_OPENPOND_API_BASE_URL,
    );
    this.apiRootUrl = apiRootUrlFromSandboxApiUrl(this.sandboxApiUrl);
  }

  readonly runtimes = {
    list: (input: {
      teamId?: string;
      projectId?: string;
      agentId?: string;
    } = {}) =>
      this.listSandboxRuntimes(input),
    create: (input: SandboxRuntimeCreateInput) =>
      this.createSandboxRuntime(input),
    handle: (runtimeId: string, initial: SandboxRuntime | null = null) =>
      this.sandboxRuntime(runtimeId, initial),
    get: (runtimeId: string) => this.getSandboxRuntime(runtimeId),
    createSandbox: (
      runtimeId: string,
      input: SandboxRuntimeSandboxCreateInput = {},
    ) => this.createSandboxRuntimeSandbox(runtimeId, input),
    updateStatus: (runtimeId: string, input: SandboxRuntimeTransitionInput) =>
      this.updateSandboxRuntimeStatus(runtimeId, input),
    events: (runtimeId: string) => this.listSandboxRuntimeEvents(runtimeId),
    event: (runtimeId: string, input: SandboxRuntimeEventInput) =>
      this.emitSandboxRuntimeEvent(runtimeId, input),
    checkpoint: (runtimeId: string, input: SandboxRuntimeCheckpointInput = {}) =>
      this.checkpointSandboxRuntime(runtimeId, input),
    promote: (
      runtimeId: string,
      input: SandboxRuntimePromoteInput,
      options: { teamId?: string } = {},
    ) => this.promoteSandboxRuntime(runtimeId, input, options),
  };

  readonly sandboxes = {
    list: (input: {
      teamId?: string;
      projectId?: string;
      agentId?: string;
    } = {}) =>
      this.list(input),
    create: (input: SandboxCreateInput) => this.create(input),
    get: (sandboxId: string) => this.get(sandboxId),
    pricing: () => this.pricing(),
    costs: (input: {
      teamId?: string;
      projectId?: string;
      agentId?: string;
    } = {}) =>
      this.costs(input),
  };

  readonly projects = {
    list: (input: { teamId: string }) => this.listProjects(input),
    upsert: (input: SandboxProjectUpsertInput) => this.upsertProject(input),
    get: (projectId: string, input: { teamId: string }) =>
      this.getProject(projectId, input),
    archive: (projectId: string, input: { teamId: string }) =>
      this.archiveProject(projectId, input),
  };

  readonly agents = {
    list: (input: { teamId: string }) => this.listAgents(input),
    upsert: (input: SandboxAgentUpsertInput) => this.upsertAgent(input),
    get: (agentId: string, input: { teamId: string }) =>
      this.getAgent(agentId, input),
    archive: (agentId: string, input: { teamId: string }) =>
      this.archiveAgent(agentId, input),
    run: (agentId: string, input: SandboxAgentRunInput) =>
      this.runAgent(agentId, input),
  };

  list(input: {
    teamId?: string;
    projectId?: string;
    agentId?: string;
  } = {}): Promise<SandboxRecord[]> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.agentId) query.set("agentId", input.agentId);
    return this.request<{ sandboxes: SandboxRecord[] }>(
      query.size > 0 ? `?${query.toString()}` : "",
    ).then((payload) => payload.sandboxes);
  }

  listSecrets(input: {
    teamId?: string;
  } = {}): Promise<SandboxSecretMetadata[]> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    return this.requestApiRoot<SandboxSecretListResponse>(
      `/sandbox-secrets${query.size > 0 ? `?${query.toString()}` : ""}`,
    ).then((payload) => payload.secrets);
  }

  getSecret(
    secretId: string,
    input: { teamId?: string } = {},
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    return this.requestApiRoot<SandboxSecretResponse>(
      `/sandbox-secrets/${encodeURIComponent(secretId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    ).then((payload) => payload.secret);
  }

  createSecret(input: SandboxSecretCreateInput): Promise<SandboxSecretMetadata> {
    return this.requestApiRoot<SandboxSecretResponse>("/sandbox-secrets", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((payload) => payload.secret);
  }

  rotateSecret(
    secretId: string,
    input: SandboxSecretRotateInput,
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    const { teamId: _teamId, ...body } = input;
    return this.requestApiRoot<SandboxSecretResponse>(
      `/sandbox-secrets/${encodeURIComponent(secretId)}/rotate${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ).then((payload) => payload.secret);
  }

  attachSecret(
    secretId: string,
    input: SandboxSecretAttachInput,
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    const { teamId: _teamId, ...body } = input;
    return this.requestApiRoot<SandboxSecretResponse>(
      `/sandbox-secrets/${encodeURIComponent(secretId)}/attach${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ).then((payload) => payload.secret);
  }

  revokeSecret(
    secretId: string,
    input: { teamId?: string } = {},
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    return this.requestApiRoot<SandboxSecretResponse>(
      `/sandbox-secrets/${encodeURIComponent(secretId)}/revoke${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      { method: "POST" },
    ).then((payload) => payload.secret);
  }

  deleteSecret(
    secretId: string,
    input: { teamId?: string } = {},
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    return this.requestApiRoot<SandboxSecretResponse>(
      `/sandbox-secrets/${encodeURIComponent(secretId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      { method: "DELETE" },
    ).then((payload) => payload.secret);
  }

  snapshotCatalog(
    input: {
      teamId?: string;
      projectId?: string;
      agentId?: string;
      q?: string;
      kind?: "snapshot" | "archive";
      replayState?: "draft" | "validated" | "published";
      visibility?: SandboxSnapshotTemplateVisibility;
      tag?: string;
      useCase?: string;
      limit?: number;
    } = {},
  ): Promise<SandboxSnapshotCatalogResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.agentId) query.set("agentId", input.agentId);
    if (input.q) query.set("q", input.q);
    if (input.kind) query.set("kind", input.kind);
    if (input.replayState) query.set("replayState", input.replayState);
    if (input.visibility) query.set("visibility", input.visibility);
    if (input.tag) query.set("tag", input.tag);
    if (input.useCase) query.set("useCase", input.useCase);
    if (input.limit) query.set("limit", String(input.limit));
    return this.request<SandboxSnapshotCatalogResponse>(
      `/catalog/snapshots${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  listSandboxRuntimes(input: {
    teamId?: string;
    projectId?: string;
    agentId?: string;
  } = {}): Promise<SandboxRuntime[]> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.agentId) query.set("agentId", input.agentId);
    return this.requestApiRoot<SandboxRuntimeListResponse>(
      `/runtimes${query.size > 0 ? `?${query.toString()}` : ""}`,
    ).then((payload) => payload.runtimes);
  }

  listProjects(input: { teamId: string }): Promise<SandboxProject[]> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxProjectListResponse>(
      `/projects?${query.toString()}`,
    ).then((payload) => payload.projects);
  }

  upsertProject(input: SandboxProjectUpsertInput): Promise<SandboxProject> {
    return this.requestApiRoot<SandboxProjectResponse>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((payload) => payload.project);
  }

  getProject(
    projectId: string,
    input: { teamId: string },
  ): Promise<SandboxProject> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxProjectResponse>(
      `/projects/${encodeURIComponent(projectId)}?${query.toString()}`,
    ).then((payload) => payload.project);
  }

  archiveProject(
    projectId: string,
    input: { teamId: string },
  ): Promise<SandboxProject> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxProjectResponse>(
      `/projects/${encodeURIComponent(projectId)}?${query.toString()}`,
      { method: "DELETE" },
    ).then((payload) => payload.project);
  }

  listAgents(input: { teamId: string }): Promise<SandboxAgent[]> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxAgentListResponse>(
      `/agents?${query.toString()}`,
    ).then((payload) => payload.agents);
  }

  upsertAgent(input: SandboxAgentUpsertInput): Promise<SandboxAgent> {
    return this.requestApiRoot<SandboxAgentResponse>("/agents", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((payload) => payload.agent);
  }

  getAgent(agentId: string, input: { teamId: string }): Promise<SandboxAgent> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxAgentResponse>(
      `/agents/${encodeURIComponent(agentId)}?${query.toString()}`,
    ).then((payload) => payload.agent);
  }

  archiveAgent(
    agentId: string,
    input: { teamId: string },
  ): Promise<SandboxAgent> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxAgentResponse>(
      `/agents/${encodeURIComponent(agentId)}?${query.toString()}`,
      { method: "DELETE" },
    ).then((payload) => payload.agent);
  }

  runAgent(
    agentId: string,
    input: SandboxAgentRunInput,
  ): Promise<SandboxAgentRunResponse> {
    return this.requestApiRoot<SandboxAgentRunResponse>(
      `/agents/${encodeURIComponent(agentId)}/run`,
      {
        method: "POST",
        headers: {
          Prefer: "respond-async",
        },
        body: JSON.stringify(input),
      },
    );
  }

  createSandboxRuntime(input: SandboxRuntimeCreateInput): Promise<SandboxRuntime> {
    return this.requestApiRoot<SandboxRuntimeResponse>("/runtimes", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((payload) => payload.runtime);
  }

  sandboxRuntime(
    runtimeId: string,
    initial: SandboxRuntime | null = null,
  ): OpenPondSandboxRuntimeHandle {
    const currentSandbox = async (
      input: SandboxRuntimeSandboxCreateInput = {},
    ): Promise<SandboxRecord> => {
      const runtime = await this.getSandboxRuntime(runtimeId);
      if (runtime.sandboxId) {
        return this.get(runtime.sandboxId);
      }
      return this.createSandboxRuntimeSandbox(runtimeId, input).then(
        (payload) => payload.sandbox,
      );
    };
    const resume = async (
      input: SandboxRuntimeSandboxCreateInput = {},
    ): Promise<SandboxRecord> => {
      const runtime = await this.getSandboxRuntime(runtimeId);
      if (!runtime.sandboxId) {
        return this.createSandboxRuntimeSandbox(runtimeId, input).then(
          (payload) => payload.sandbox,
        );
      }
      const sandbox = await this.get(runtime.sandboxId);
      if (sandbox.state === "stopped") {
        return this.start(sandbox.id).then((payload) => payload.sandbox);
      }
      if (sandbox.state === "archived") {
        return this.restore(sandbox.id).then((payload) => payload.sandbox);
      }
      if (sandbox.state === "deleted" || sandbox.state === "error") {
        return this.createSandboxRuntimeSandbox(runtimeId, input).then(
          (payload) => payload.sandbox,
        );
      }
      return sandbox;
    };
    const checkpointHint = (
      input: RuntimeWorkflowCheckpointHintInput = {},
    ) =>
      this.emitSandboxRuntimeEvent(runtimeId, {
        type: "workflow.checkpoint_hint",
        summary: input.summary ?? input.reason ?? "Workflow checkpoint hint",
        payload: {
          ...input.payload,
          reason: input.reason ?? null,
        },
        artifactRefs: input.artifactRefs,
        lifecycleHint: {
          kind: "checkpoint",
          reason: input.reason ?? null,
        },
      });
    const waitForUser = async (
      input: RuntimeWorkflowWaitForUserInput = {},
    ) => {
      await this.emitSandboxRuntimeEvent(runtimeId, {
        type: "workflow.waiting_for_user",
        summary: input.summary ?? input.reason ?? "Waiting for user",
        payload: {
          ...input.payload,
          reason: input.reason ?? null,
        },
        lifecycleHint: {
          kind: "waiting_for_user",
          reason: input.reason ?? null,
        },
      });
      const current = await this.getSandboxRuntime(runtimeId);
      if (current.status === "waiting_for_user") return current;
      return this.updateSandboxRuntimeStatus(runtimeId, {
        status: "waiting_for_user",
        expectedVersion: current.version,
        summary: input.summary ?? input.reason,
        metadata: {
          workflowWaitForUserReason: input.reason ?? null,
        },
      });
    };
    const keepAlive = (input: RuntimeWorkflowKeepAliveInput = {}) => {
      const keepaliveUntil = runtimeKeepaliveUntilIso(input);
      return this.emitSandboxRuntimeEvent(runtimeId, {
        type: "workflow.keepalive",
        summary: input.summary ?? input.reason ?? "Workflow keepalive",
        payload: {
          ...input.payload,
          reason: input.reason ?? null,
          keepaliveUntil,
        },
        lifecycleHint: {
          kind: "keepalive",
          reason: input.reason ?? null,
          keepaliveUntil,
        },
      });
    };
    return {
      id: runtimeId,
      initial,
      get: () => this.getSandboxRuntime(runtimeId),
      sandbox: currentSandbox,
      resume,
      createSandbox: (input = {}) =>
        this.createSandboxRuntimeSandbox(runtimeId, input),
      status: async (input) => {
        if (typeof input !== "string") {
          return this.updateSandboxRuntimeStatus(runtimeId, input);
        }
        const current = await this.getSandboxRuntime(runtimeId);
        return this.updateSandboxRuntimeStatus(runtimeId, {
          status: input,
          expectedVersion: current.version,
        });
      },
      events: () => this.listSandboxRuntimeEvents(runtimeId),
      event: (input) => this.emitSandboxRuntimeEvent(runtimeId, input),
      recordCommit: (commitSha, input = {}) =>
        this.emitSandboxRuntimeEvent(runtimeId, {
          ...input,
          type: input.type ?? "git.commit",
          commitSha,
        }),
      checkpointHint,
      waitForUser,
      keepAlive,
      checkpoint: (input) => this.checkpointSandboxRuntime(runtimeId, input),
      files: {
        write: async (path, contents) =>
          this.uploadFile((await resume()).id, path, contents),
        read: async (path) => this.downloadFile((await resume()).id, path),
        readResponse: async (input) =>
          this.downloadFileResponse((await resume()).id, input),
        list: async (input = {}) => this.listFiles((await resume()).id, input),
        delete: async (path, input = {}) =>
          this.deleteFile((await resume()).id, path, input),
        search: async (input) => this.searchFiles((await resume()).id, input),
        stat: async (path) => this.statFile((await resume()).id, path),
        mkdir: async (input) => this.mkdir((await resume()).id, input),
        move: async (input) => this.moveFile((await resume()).id, input),
      },
      commands: {
        run: async (command) =>
          this.exec(
            (await resume()).id,
            typeof command === "string" ? { command } : command,
          ),
      },
      ports: {
        expose: async (port) =>
          this.openPort(
            (await resume()).id,
            typeof port === "number" ? { port } : port,
          ),
      },
      promote: (input, options = {}) =>
        this.promoteSandboxRuntime(runtimeId, input, options),
      archive: async (expectedVersion) => {
        const version =
          expectedVersion ??
          (await this.getSandboxRuntime(runtimeId)).version;
        return this.updateSandboxRuntimeStatus(runtimeId, {
          status: "archived",
          expectedVersion: version,
        });
      },
    };
  }

  getSandboxRuntime(runtimeId: string): Promise<SandboxRuntime> {
    return this.requestApiRoot<SandboxRuntimeResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}`,
    ).then((payload) => payload.runtime);
  }

  createSandboxRuntimeSandbox(
    runtimeId: string,
    input: SandboxRuntimeSandboxCreateInput = {},
  ): Promise<SandboxRuntimeSandboxResponse> {
    return this.requestApiRoot<SandboxRuntimeSandboxResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/sandbox`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  updateSandboxRuntimeStatus(
    runtimeId: string,
    input: SandboxRuntimeTransitionInput,
  ): Promise<SandboxRuntime> {
    return this.requestApiRoot<SandboxRuntimeResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.runtime);
  }

  listSandboxRuntimeEvents(
    runtimeId: string,
  ): Promise<SandboxRuntimeEventsResponse> {
    return this.requestApiRoot<SandboxRuntimeEventsResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/events`,
    );
  }

  emitSandboxRuntimeEvent(
    runtimeId: string,
    input: SandboxRuntimeEventInput,
  ): Promise<SandboxRuntimeEventResponse> {
    return this.requestApiRoot<SandboxRuntimeEventResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/events`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  checkpointSandboxRuntime(
    runtimeId: string,
    input: SandboxRuntimeCheckpointInput,
  ): Promise<SandboxRuntime> {
    return this.requestApiRoot<SandboxRuntimeResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/checkpoints`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.runtime);
  }

  promoteSandboxRuntime(
    runtimeId: string,
    input: SandboxRuntimePromoteInput,
    options: { teamId?: string } = {},
  ): Promise<SandboxRuntimePromoteResponse> {
    const query = new URLSearchParams();
    if (options.teamId) query.set("teamId", options.teamId);
    return this.requestApiRoot<SandboxRuntimePromoteResponse>(
      `/runtimes/${encodeURIComponent(runtimeId)}/promote${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  forkSnapshot(
    snapshotId: string,
    input: SandboxForkInput & { teamId?: string; projectId?: string } = {},
    options: SandboxForkOptions = {},
  ): Promise<SandboxForkResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (options.async) query.set("async", "1");
    const { teamId: _teamId, projectId: _projectId, ...body } = input;
    return this.request<SandboxForkResponse>(
      `/catalog/snapshots/${encodeURIComponent(snapshotId)}/fork${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
        headers: options.async ? { Prefer: "respond-async" } : undefined,
        body: JSON.stringify({
          ...body,
          snapshotId,
        }),
      },
    );
  }

  templates(
    input: {
      teamId?: string;
      projectId?: string;
      q?: string;
      name?: string;
      version?: string;
      visibility?: SandboxSnapshotTemplateVisibility;
      tag?: string;
      useCase?: string;
      limit?: number;
    } = {},
  ): Promise<SandboxTemplateCatalogResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.q) query.set("q", input.q);
    if (input.name) query.set("name", input.name);
    if (input.version) query.set("version", input.version);
    if (input.visibility) query.set("visibility", input.visibility);
    if (input.tag) query.set("tag", input.tag);
    if (input.useCase) query.set("useCase", input.useCase);
    if (input.limit) query.set("limit", String(input.limit));
    return this.request<SandboxTemplateCatalogResponse>(
      `/templates${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  launchTemplate(
    input: SandboxTemplateLaunchInput & { teamId?: string; projectId?: string },
  ): Promise<SandboxTemplateLaunchResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    const { teamId: _teamId, projectId: _projectId, ...body } = input;
    return this.request<SandboxTemplateLaunchResponse>(
      `/templates/launch${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  listSchedules(input: {
    teamId?: string;
    projectId?: string;
    sourceSandboxId?: string;
  } = {}): Promise<SandboxScheduleListResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.sourceSandboxId) query.set("sourceSandboxId", input.sourceSandboxId);
    return this.request<SandboxScheduleListResponse>(
      `/schedules${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  createSchedule(input: SandboxScheduleCreateInput): Promise<SandboxScheduleResponse> {
    const query = new URLSearchParams();
    if (input.projectId) query.set("projectId", input.projectId);
    const { projectId: _projectId, ...body } = input;
    return this.request<SandboxScheduleResponse>(
      `/schedules${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  getSchedule(scheduleId: string): Promise<SandboxScheduleResponse> {
    return this.request<SandboxScheduleResponse>(
      `/schedules/${encodeURIComponent(scheduleId)}`,
    );
  }

  updateSchedule(
    scheduleId: string,
    input: SandboxScheduleUpdateInput,
  ): Promise<SandboxScheduleResponse> {
    return this.request<SandboxScheduleResponse>(
      `/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  }

  deleteSchedule(scheduleId: string): Promise<SandboxScheduleResponse> {
    return this.request<SandboxScheduleResponse>(
      `/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: "DELETE",
      },
    );
  }

  listScheduleRuns(
    scheduleId: string,
    input: { limit?: number } = {},
  ): Promise<SandboxScheduleRunListResponse> {
    const query = new URLSearchParams();
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.request<SandboxScheduleRunListResponse>(
      `/schedules/${encodeURIComponent(scheduleId)}/runs${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  runScheduleNow(
    scheduleId: string,
    input: { idempotencyKey?: string } = {},
  ): Promise<SandboxScheduleRunResponse> {
    return this.request<SandboxScheduleRunResponse>(
      `/schedules/${encodeURIComponent(scheduleId)}/run`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  listTemplateBuilds(input: {
    teamId: string;
  }): Promise<SandboxTemplateBuildRecord[]> {
    const query = new URLSearchParams({ teamId: input.teamId });
    return this.requestApiRoot<SandboxTemplateBuildListResponse>(
      `/sandbox-template-builds?${query.toString()}`,
    ).then((payload) => payload.builds);
  }

  createTemplateBuild(
    input: SandboxTemplateBuildCreateInput,
  ): Promise<SandboxTemplateBuildRecord> {
    return this.requestApiRoot<SandboxTemplateBuildResponse>(
      "/sandbox-template-builds",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.build);
  }

  getTemplateBuild(buildId: string): Promise<SandboxTemplateBuildRecord> {
    return this.requestApiRoot<SandboxTemplateBuildResponse>(
      `/sandbox-template-builds/${encodeURIComponent(buildId)}`,
    ).then((payload) => payload.build);
  }

  getTemplateBuildLogs(buildId: string): Promise<SandboxTemplateBuildLogsResponse> {
    return this.requestApiRoot<SandboxTemplateBuildLogsResponse>(
      `/sandbox-template-builds/${encodeURIComponent(buildId)}/logs`,
    );
  }

  cancelTemplateBuild(buildId: string): Promise<SandboxTemplateBuildRecord> {
    return this.requestApiRoot<SandboxTemplateBuildResponse>(
      `/sandbox-template-builds/${encodeURIComponent(buildId)}/cancel`,
      {
        method: "POST",
      },
    ).then((payload) => payload.build);
  }

  listOrganizations(): Promise<OpenPondOrganization[]> {
    return this.requestApiRoot<OpenPondOrganizationsResponse>("/organizations").then(
      (payload) => payload.organizations,
    );
  }

  createOrganization(
    input: OpenPondOrganizationCreateInput,
  ): Promise<OpenPondOrganization> {
    return this.requestApiRoot<OpenPondOrganizationResponse>("/organizations", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((payload) => payload.organization);
  }

  getOrganization(slug: string): Promise<OpenPondOrganization> {
    return this.requestApiRoot<OpenPondOrganizationResponse>(
      `/organizations/${encodeURIComponent(slug)}`,
    ).then((payload) => payload.organization);
  }

  updateOrganization(
    slug: string,
    input: OpenPondOrganizationUpdateInput,
  ): Promise<OpenPondOrganization> {
    return this.requestApiRoot<OpenPondOrganizationResponse>(
      `/organizations/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.organization);
  }

  listOrganizationMembers(slug: string): Promise<OpenPondOrganizationMember[]> {
    return this.requestApiRoot<OpenPondOrganizationMembersResponse>(
      `/organizations/${encodeURIComponent(slug)}/members`,
    ).then((payload) => payload.members);
  }

  upsertOrganizationMember(
    slug: string,
    input: OpenPondOrganizationMemberUpsertInput,
  ): Promise<OpenPondOrganizationMember> {
    return this.requestApiRoot<OpenPondOrganizationMemberResponse>(
      `/organizations/${encodeURIComponent(slug)}/members`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.member);
  }

  getOrganizationMcpServer(slug: string): Promise<OpenPondOrganizationMcpServer | null> {
    return this.requestApiRoot<OpenPondOrganizationMcpServerResponse>(
      `/organizations/${encodeURIComponent(slug)}/mcp-server`,
    ).then((payload) => payload.mcpServer);
  }

  generateOrganizationMcpServer(
    slug: string,
    input: OpenPondOrganizationMcpGenerateInput = {},
  ): Promise<OpenPondOrganizationMcpServer | null> {
    return this.requestApiRoot<OpenPondOrganizationMcpServerResponse>(
      `/organizations/${encodeURIComponent(slug)}/mcp-server`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ).then((payload) => payload.mcpServer);
  }

  rotateOrganizationMcpServer(slug: string): Promise<OpenPondOrganizationMcpServer | null> {
    return this.requestApiRoot<OpenPondOrganizationMcpServerResponse>(
      `/organizations/${encodeURIComponent(slug)}/mcp-server/rotate`,
      {
        method: "POST",
      },
    ).then((payload) => payload.mcpServer);
  }

  disableOrganizationMcpServer(slug: string): Promise<OpenPondOrganizationMcpServer | null> {
    return this.requestApiRoot<OpenPondOrganizationMcpServerResponse>(
      `/organizations/${encodeURIComponent(slug)}/mcp-server/disable`,
      {
        method: "POST",
      },
    ).then((payload) => payload.mcpServer);
  }

  enableOrganizationMcpServer(slug: string): Promise<OpenPondOrganizationMcpServer | null> {
    return this.requestApiRoot<OpenPondOrganizationMcpServerResponse>(
      `/organizations/${encodeURIComponent(slug)}/mcp-server/enable`,
      {
        method: "POST",
      },
    ).then((payload) => payload.mcpServer);
  }

  startReplay(input: SandboxReplayInput & { teamId?: string; projectId?: string }): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    const { teamId: _teamId, projectId: _projectId, ...body } = input;
    return this.requestApiRoot<SandboxReplayResponse>(
      `/sandbox-replays${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  listReplays(input: { teamId?: string; projectId?: string } = {}): Promise<SandboxReplayListResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    return this.requestApiRoot<SandboxReplayListResponse>(
      `/sandbox-replays${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  getReplay(replayId: string, input: { teamId?: string; projectId?: string } = {}): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    return this.requestApiRoot<SandboxReplayResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  getReplayLogs(
    replayId: string,
    input: { teamId?: string; projectId?: string } = {},
  ): Promise<SandboxReplayLogsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    return this.requestApiRoot<SandboxReplayLogsResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}/logs${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  getReplayArtifacts(
    replayId: string,
    input: { teamId?: string; projectId?: string } = {},
  ): Promise<SandboxReplayArtifactsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    return this.requestApiRoot<SandboxReplayArtifactsResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}/artifacts${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  cancelReplay(replayId: string, input: { teamId?: string; projectId?: string } = {}): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    return this.requestApiRoot<SandboxReplayResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}/cancel${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
      },
    );
  }

  integrationConnections(
    input: {
      teamId?: string;
      projectId?: string;
      agentId?: string;
      status?: SandboxIntegrationConnectionStatusFilter;
    } = {},
  ): Promise<SandboxIntegrationConnectionsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.agentId) query.set("agentId", input.agentId);
    if (input.status) query.set("status", input.status);
    return this.requestApiRoot<SandboxIntegrationConnectionsResponse>(
      `/integrations/connections${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  mcpServerConfig(): OpenPondSandboxMcpServerConfig {
    return {
      name: "openpond-sandboxes",
      transport: "streamable-http",
      url: `${this.sandboxApiUrl}/mcp`,
      headers: {
        "openpond-api-key": this.apiKey,
      },
    };
  }

  create(input: SandboxCreateInput, options: SandboxCreateOptions = {}): Promise<SandboxRecord> {
    return this.request<SandboxCreateResponse>("", {
      method: "POST",
      headers: options.async ? { Prefer: "respond-async" } : undefined,
      body: JSON.stringify(input),
    }).then((payload) => payload.sandbox);
  }

  get(sandboxId: string): Promise<SandboxRecord> {
    return this.request<{ sandbox: SandboxRecord }>(`/${encodeURIComponent(sandboxId)}`).then(
      (payload) => payload.sandbox,
    );
  }

  exec(sandboxId: string, input: SandboxExecInput): Promise<SandboxExecResponse> {
    return this.request<SandboxExecResponse>(`/${encodeURIComponent(sandboxId)}/exec`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  startProcess(
    sandboxId: string,
    input: SandboxProcessStartInput,
  ): Promise<SandboxProcessStartResponse> {
    return this.request<SandboxProcessStartResponse>(
      `/${encodeURIComponent(sandboxId)}/processes`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  listProcesses(sandboxId: string): Promise<SandboxProcessListResponse> {
    return this.request<SandboxProcessListResponse>(
      `/${encodeURIComponent(sandboxId)}/processes`,
    );
  }

  getProcess(
    sandboxId: string,
    processId: string,
    input: { since?: number } = {},
  ): Promise<SandboxProcessStatusResponse> {
    const query = new URLSearchParams();
    if (input.since !== undefined) query.set("since", String(Math.max(0, input.since)));
    return this.request<SandboxProcessStatusResponse>(
      `/${encodeURIComponent(sandboxId)}/processes/${encodeURIComponent(processId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  stopProcess(sandboxId: string, processId: string): Promise<SandboxProcessStopResponse> {
    return this.request<SandboxProcessStopResponse>(
      `/${encodeURIComponent(sandboxId)}/processes/${encodeURIComponent(processId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async streamProcessOutput(
    sandboxId: string,
    processId: string,
    input: { since?: number } = {},
  ): Promise<void> {
    const query = new URLSearchParams();
    if (input.since !== undefined) query.set("since", String(Math.max(0, input.since)));
    const response = await apiFetch(
      this.sandboxApiUrl,
      this.apiKey,
      `/${encodeURIComponent(sandboxId)}/processes/${encodeURIComponent(processId)}/stream${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
    if (!response.body) {
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let separatorIndex = buffered.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const event = buffered.slice(0, separatorIndex);
          buffered = buffered.slice(separatorIndex + 2);
          const output = parseProcessOutputEvent(event);
          if (output) process.stdout.write(output);
          separatorIndex = buffered.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  startPty(
    sandboxId: string,
    input: SandboxPtyStartInput = {},
  ): Promise<SandboxPtyStartResponse> {
    return this.request<SandboxPtyStartResponse>(`/${encodeURIComponent(sandboxId)}/pty`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listPtys(sandboxId: string): Promise<SandboxPtyListResponse> {
    return this.request<SandboxPtyListResponse>(`/${encodeURIComponent(sandboxId)}/pty`);
  }

  getPty(
    sandboxId: string,
    ptyId: string,
    input: { since?: number } = {},
  ): Promise<SandboxPtyStatusResponse> {
    const query = new URLSearchParams();
    if (input.since !== undefined) query.set("since", String(Math.max(0, input.since)));
    return this.request<SandboxPtyStatusResponse>(
      `/${encodeURIComponent(sandboxId)}/pty/${encodeURIComponent(ptyId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  writePtyInput(
    sandboxId: string,
    ptyId: string,
    input: string | Uint8Array | SandboxPtyInput,
  ): Promise<SandboxPtyInputResponse> {
    return this.request<SandboxPtyInputResponse>(
      `/${encodeURIComponent(sandboxId)}/pty/${encodeURIComponent(ptyId)}/input`,
      {
        method: "POST",
        body: JSON.stringify(normalizePtyInput(input)),
      },
    );
  }

  stopPty(sandboxId: string, ptyId: string): Promise<SandboxPtyStopResponse> {
    return this.request<SandboxPtyStopResponse>(
      `/${encodeURIComponent(sandboxId)}/pty/${encodeURIComponent(ptyId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async streamPtyOutput(
    sandboxId: string,
    ptyId: string,
    input: { since?: number } = {},
  ): Promise<void> {
    const query = new URLSearchParams();
    if (input.since !== undefined) query.set("since", String(Math.max(0, input.since)));
    const response = await apiFetch(
      this.sandboxApiUrl,
      this.apiKey,
      `/${encodeURIComponent(sandboxId)}/pty/${encodeURIComponent(ptyId)}/stream${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
    if (!response.body) {
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let separatorIndex = buffered.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const event = buffered.slice(0, separatorIndex);
          buffered = buffered.slice(separatorIndex + 2);
          const output = parseProcessOutputEvent(event);
          if (output) process.stdout.write(output);
          separatorIndex = buffered.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  uploadFile(
    sandboxId: string,
    path: string,
    contents: string,
  ): Promise<SandboxFileUploadResponse> {
    return this.uploadFileBase64(
      sandboxId,
      path,
      Buffer.from(contents, "utf-8").toString("base64"),
    );
  }

  uploadFileBase64(
    sandboxId: string,
    path: string,
    contentsBase64: string,
  ): Promise<SandboxFileUploadResponse> {
    return this.request<SandboxFileUploadResponse>(`/${encodeURIComponent(sandboxId)}/files`, {
      method: "POST",
      body: JSON.stringify({
        path,
        contentsBase64,
      }),
    });
  }

  async downloadFile(sandboxId: string, path: string): Promise<string> {
    const payload = await this.downloadFileResponse(sandboxId, path);
    return Buffer.from(payload.file.contentsBase64, "base64").toString("utf-8");
  }

  downloadFileResponse(
    sandboxId: string,
    input: string | SandboxFileDownloadInput,
  ): Promise<SandboxFileDownloadResponse> {
    const normalized = typeof input === "string" ? { path: input } : input;
    const query = new URLSearchParams({ path: normalized.path });
    if (normalized.offsetBytes !== undefined) {
      query.set("offsetBytes", String(normalized.offsetBytes));
    }
    if (normalized.maxBytes !== undefined) {
      query.set("maxBytes", String(normalized.maxBytes));
    }
    return this.request<SandboxFileDownloadResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
    );
  }

  listFiles(
    sandboxId: string,
    input: SandboxFileListInput = {},
  ): Promise<SandboxFileListResponse> {
    const query = new URLSearchParams({ list: "1" });
    if (input.path) query.set("path", input.path);
    if (input.recursive !== undefined) query.set("recursive", String(input.recursive));
    if (input.maxEntries !== undefined) query.set("maxEntries", String(input.maxEntries));
    return this.request<SandboxFileListResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
    );
  }

  deleteFile(
    sandboxId: string,
    path: string,
    input: { recursive?: boolean } = {},
  ): Promise<SandboxFileDeleteResponse> {
    const query = new URLSearchParams({ path });
    if (input.recursive !== undefined) query.set("recursive", String(input.recursive));
    return this.request<SandboxFileDeleteResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
      {
        method: "DELETE",
      },
    );
  }

  statFile(sandboxId: string, path: string): Promise<SandboxFileStatResponse> {
    const query = new URLSearchParams({ stat: "1", path });
    return this.request<SandboxFileStatResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
    );
  }

  mkdir(
    sandboxId: string,
    input: string | SandboxFileMkdirInput,
  ): Promise<SandboxFileMkdirResponse> {
    const normalized = typeof input === "string" ? { path: input } : input;
    const query = new URLSearchParams({ path: normalized.path });
    if (normalized.recursive !== undefined) query.set("recursive", String(normalized.recursive));
    return this.request<SandboxFileMkdirResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
      {
        method: "PUT",
      },
    );
  }

  moveFile(
    sandboxId: string,
    input: SandboxFileMoveInput,
  ): Promise<SandboxFileMoveResponse> {
    const query = new URLSearchParams({
      fromPath: input.fromPath,
      toPath: input.toPath,
    });
    if (input.overwrite !== undefined) query.set("overwrite", String(input.overwrite));
    return this.request<SandboxFileMoveResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
      {
        method: "PATCH",
      },
    );
  }

  searchFiles(
    sandboxId: string,
    input: SandboxFileSearchInput,
  ): Promise<SandboxFileSearchResponse> {
    const query = new URLSearchParams({
      search: "1",
      query: input.query,
    });
    if (input.path) query.set("path", input.path);
    if (input.maxResults !== undefined) query.set("maxResults", String(input.maxResults));
    return this.request<SandboxFileSearchResponse>(
      `/${encodeURIComponent(sandboxId)}/files?${query.toString()}`,
    );
  }

  openPort(sandboxId: string, input: SandboxOpenPortInput): Promise<SandboxOpenPortResponse> {
    return this.request<SandboxOpenPortResponse>(`/${encodeURIComponent(sandboxId)}/ports`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createSnapshot(
    sandboxId: string,
    input: SandboxSnapshotInput,
  ): Promise<SandboxSnapshotResponse> {
    return this.request<SandboxSnapshotResponse>(
      `/${encodeURIComponent(sandboxId)}/snapshots`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  updateSnapshot(
    sandboxId: string,
    snapshotId: string,
    input: SandboxSnapshotUpdateInput,
  ): Promise<SandboxSnapshotResponse> {
    return this.request<SandboxSnapshotResponse>(
      `/${encodeURIComponent(sandboxId)}/snapshots/${encodeURIComponent(snapshotId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  }

  validateSnapshot(
    sandboxId: string,
    snapshotId: string,
    input: SandboxSnapshotValidateInput = {},
  ): Promise<SandboxSnapshotValidationResponse> {
    return this.request<SandboxSnapshotValidationResponse>(
      `/${encodeURIComponent(sandboxId)}/snapshots/${encodeURIComponent(snapshotId)}/validate`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  publishSnapshot(
    sandboxId: string,
    snapshotId: string,
  ): Promise<SandboxSnapshotResponse> {
    return this.request<SandboxSnapshotResponse>(
      `/${encodeURIComponent(sandboxId)}/snapshots/${encodeURIComponent(snapshotId)}/publish`,
      {
        method: "POST",
      },
    );
  }

  fork(
    sandboxId: string,
    input: SandboxForkInput = {},
  ): Promise<SandboxForkResponse> {
    return this.request<SandboxForkResponse>(`/${encodeURIComponent(sandboxId)}/fork`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  stop(sandboxId: string): Promise<SandboxReceiptResponse> {
    return this.request<SandboxReceiptResponse>(`/${encodeURIComponent(sandboxId)}/stop`, {
      method: "POST",
    });
  }

  start(sandboxId: string): Promise<SandboxStartResponse> {
    return this.request<SandboxStartResponse>(`/${encodeURIComponent(sandboxId)}/start`, {
      method: "POST",
    });
  }

  restore(sandboxId: string): Promise<SandboxRestoreResponse> {
    return this.request<SandboxRestoreResponse>(
      `/${encodeURIComponent(sandboxId)}/restore`,
      {
        method: "POST",
      },
    );
  }

  delete(sandboxId: string): Promise<SandboxRecord> {
    return this.request<{ sandbox: SandboxRecord }>(`/${encodeURIComponent(sandboxId)}`, {
      method: "DELETE",
    }).then((payload) => payload.sandbox);
  }

  receipts(sandboxId: string): Promise<SandboxReceipt[]> {
    return this.request<SandboxReceiptsResponse>(`/${encodeURIComponent(sandboxId)}/receipts`).then(
      (payload) => payload.receipts,
    );
  }

  logs(sandboxId: string): Promise<string[]> {
    return this.request<SandboxLogsResponse>(`/${encodeURIComponent(sandboxId)}/logs`).then(
      (payload) => payload.logs,
    );
  }

  gitStatus(sandboxId: string): Promise<SandboxGitStatusResponse> {
    return this.request<SandboxGitStatusResponse>(`/${encodeURIComponent(sandboxId)}/git/status`);
  }

  gitDiff(sandboxId: string, input: SandboxGitDiffInput = {}): Promise<SandboxGitDiffResponse> {
    return this.request<SandboxGitDiffResponse>(`/${encodeURIComponent(sandboxId)}/git/diff`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  gitBranch(
    sandboxId: string,
    input: SandboxGitBranchInput,
  ): Promise<SandboxGitBranchResponse> {
    return this.request<SandboxGitBranchResponse>(
      `/${encodeURIComponent(sandboxId)}/git/branch`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  gitCommit(
    sandboxId: string,
    input: SandboxGitCommitInput,
  ): Promise<SandboxGitCommitResponse> {
    return this.request<SandboxGitCommitResponse>(
      `/${encodeURIComponent(sandboxId)}/git/commit`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  gitPull(
    sandboxId: string,
    input: SandboxGitPullInput = {},
  ): Promise<SandboxGitPullResponse> {
    return this.request<SandboxGitPullResponse>(
      `/${encodeURIComponent(sandboxId)}/git/pull`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  gitPush(
    sandboxId: string,
    input: SandboxGitPushInput = {},
  ): Promise<SandboxGitPushResponse> {
    return this.request<SandboxGitPushResponse>(
      `/${encodeURIComponent(sandboxId)}/git/push`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  billing(sandboxId: string): Promise<SandboxBillingStatusResponse> {
    return this.request<SandboxBillingStatusResponse>(`/${encodeURIComponent(sandboxId)}/billing`);
  }

  pricing(): Promise<SandboxPricingResponse> {
    return this.request<SandboxPricingResponse>("/pricing");
  }

  costs(input: {
    teamId?: string;
    projectId?: string;
    agentId?: string;
  } = {}): Promise<SandboxCostSummaryResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.agentId) query.set("agentId", input.agentId);
    return this.request<SandboxCostSummaryResponse>(
      `/costs${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  integrationLeases(sandboxId: string): Promise<SandboxIntegrationLeasesResponse> {
    return this.request<SandboxIntegrationLeasesResponse>(
      `/${encodeURIComponent(sandboxId)}/integrations`,
    );
  }

  attachIntegrationConnection(
    sandboxId: string,
    input: SandboxIntegrationConnectionLeaseInput,
  ): Promise<SandboxIntegrationLeasesResponse> {
    return this.request<SandboxIntegrationLeasesResponse>(
      `/${encodeURIComponent(sandboxId)}/integrations`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  removeIntegrationLease(
    sandboxId: string,
    leaseId: string,
  ): Promise<SandboxIntegrationLeasesResponse> {
    return this.request<SandboxIntegrationLeasesResponse>(
      `/${encodeURIComponent(sandboxId)}/integrations`,
      {
        method: "DELETE",
        body: JSON.stringify({ leaseId }),
      },
    );
  }

  async smoke(options: SandboxSmokeOptions = {}): Promise<SandboxSmokeSummary> {
    const runId = `openpond-code-smoke-${Date.now()}`;
    const expectedExec = `openpond-code-exec-ok:${runId}`;
    const expectedPreview = `openpond-code-preview-ok:${runId}`;
    const expectedFile = `openpond-code-file-ok:${runId}`;
    const previewPort = 4173;
    let sandboxId: string | null = null;
    let forkSandboxId: string | null = null;
    let deleted = false;
    let forkDeleted = false;

    try {
      const sandbox = await this.waitForCreateReady(
        await this.create(
          {
            repo: options.repo ?? "https://github.com/octocat/Hello-World",
            resources: {
              cpu: options.cpu ?? 1,
              memoryGb: options.memoryGb ?? 1,
              diskGb: options.diskGb ?? 8,
            },
            budget: { maxUsd: options.budgetUsd ?? "0.05" },
            quotas: {
              maxSpendUsd: options.budgetUsd ?? "0.05",
              maxDurationSeconds: 600,
              idleTimeoutSeconds: 600,
              maxOpenPorts: 2,
            },
            metadata: {
              runId,
              source: "openpond-code-sandbox-smoke",
            },
          },
          { async: true },
        ),
      );
      sandboxId = sandbox.id;

      const expectedRuntimeDriver = options.expectedRuntimeDriver ?? "remote-firecracker";
      if (sandbox.runtimeDriver !== expectedRuntimeDriver) {
        throw new Error(`expected ${expectedRuntimeDriver}, got ${sandbox.runtimeDriver}`);
      }

      const expectedMppMode = options.expectedMppMode;
      if (expectedMppMode && sandbox.reservation.mpp?.mode !== expectedMppMode) {
        throw new Error(
          `expected ${expectedMppMode} reservation, got ${sandbox.reservation.mpp?.mode ?? "none"}`,
        );
      }
      if (!expectedMppMode && !sandbox.reservation.mpp?.mode) {
        throw new Error("expected sandbox reservation MPP metadata");
      }

      const exec = await this.exec(sandbox.id, {
        command: [
          `printf '${expectedExec}\\n'`,
          "test -f README && printf 'repo-clone-ok\\n'",
          "cat > server.js <<'EOF'",
          `Bun.serve({ port: ${previewPort}, fetch() { return new Response('${expectedPreview}'); } });`,
          "EOF",
          "nohup bun server.js > server.log 2>&1 & sleep 1",
        ].join("\n"),
        timeoutSeconds: 120,
      });
      if (exec.command.status !== "succeeded") {
        throw new Error(`expected command success, got ${exec.command.status}`);
      }
      if (!exec.command.output.includes(expectedExec)) {
        throw new Error("expected exec marker");
      }

      await this.uploadFile(sandbox.id, "openpond-code-smoke.txt", expectedFile);
      const downloaded = await this.downloadFile(sandbox.id, "openpond-code-smoke.txt");
      if (downloaded !== expectedFile) {
        throw new Error("expected file roundtrip marker");
      }

      let snapshotId: string | null = null;
      if (options.snapshot || options.fork) {
        const snapshotResponse = (await this.createSnapshot(sandbox.id, {
          async: true,
          name: `openpond-code-smoke-${runId}`,
          replay: {
            entrypoints: [
              {
                command: "cat openpond-code-smoke.txt",
                name: "default",
              },
            ],
            retention: {
              class: "pinned",
            },
            safety: {
              cleanup: "delete",
              idleTimeoutSeconds: 600,
              internetEgress: "block",
              maxDurationSeconds: 600,
              maxSpendUsd: options.budgetUsd ?? "0.05",
              publicPreview: false,
            },
            validation: {
              commands: [
                {
                  command: "test -f openpond-code-smoke.txt",
                },
              ],
            },
          },
        })) as SandboxSnapshotResponse & {
          snapshotJob?: { snapshotId?: string; status?: string; error?: string | null };
        };
        const snapshot =
          snapshotResponse.snapshot ??
          (
            await this.waitForSnapshotReady(
            sandbox.id,
            snapshotResponse.snapshotJob?.snapshotId,
            )
          ).snapshot;
        snapshotId = snapshot.id;
        if (snapshot.state !== "ready") {
          throw new Error(
            `expected ready snapshot, got ${snapshot.state}`,
          );
        }
      }

      if (options.fork) {
        if (!snapshotId) {
          throw new Error("expected snapshot id before fork");
        }
        const forked = await this.waitForCreateReady(
          (
            await this.forkSnapshot(snapshotId, {
              budget: { maxUsd: options.budgetUsd ?? "0.05" },
              metadata: {
                source: "openpond-code-sandbox-smoke-fork",
                templateSnapshotId: snapshotId,
              },
            }, { async: true })
          ).sandbox,
        );
        forkSandboxId = forked.id;
        const forkExec = await this.exec(forked.id, {
          command: "cat openpond-code-smoke.txt",
          timeoutSeconds: 120,
        });
        if (forkExec.command.status !== "succeeded") {
          throw new Error(`expected fork command success, got ${forkExec.command.status}`);
        }
        if (!forkExec.command.output.includes(expectedFile)) {
          throw new Error("expected fork snapshot marker");
        }
        if (!options.keep) {
          await this.delete(forked.id);
          forkDeleted = true;
        }
      }

      let previewStatus: number | null = null;
      if (options.preview !== false) {
        const opened = await this.openPort(sandbox.id, {
          label: "openpond-code-smoke",
          port: previewPort,
        });
        const preview = await fetch(opened.preview.url);
        previewStatus = preview.status;
        const body = await preview.text();
        if (preview.status !== 200) {
          throw new Error(`expected preview HTTP 200, got ${preview.status}`);
        }
        if (!body.includes(expectedPreview)) {
          throw new Error("expected preview marker");
        }
      }

      const stopped = await this.stop(sandbox.id);
      const readback = await this.get(sandbox.id);
      const receipts = await this.receipts(sandbox.id);
      if (stopped.sandbox.state !== "stopped" || readback.state !== "stopped") {
        throw new Error("expected stopped sandbox");
      }
      if (receipts.length === 0) {
        throw new Error("expected receipt readback");
      }

      if (!options.keep) {
        await this.delete(sandbox.id);
        deleted = true;
      }

      return {
        deleted,
        execOutput: exec.command.output.trim(),
        fileRoundtrip: true,
        forkSandboxId,
        previewStatus,
        receiptRefs: receipts.map((receipt) => receipt.mpp.receiptRef ?? null),
        reservationRef: sandbox.reservation.mpp?.reservationRef ?? null,
        runId,
        sandboxId: sandbox.id,
        snapshotId,
        state: readback.state,
      };
    } finally {
      if (forkSandboxId && !options.keep && !forkDeleted) {
        await this.delete(forkSandboxId).catch(() => undefined);
      }
      if (sandboxId && !options.keep && !deleted) {
        await this.delete(sandboxId).catch(() => undefined);
      }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await apiFetch(this.sandboxApiUrl, this.apiKey, path, init);
    return readApiJson<T>(response, "Sandbox request");
  }

  private async requestApiRoot<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await apiFetch(this.apiRootUrl, this.apiKey, path, init);
    return readApiJson<T>(response, "OpenPond API request");
  }

  private async waitForCreateReady(sandbox: SandboxRecord): Promise<SandboxRecord> {
    if (sandbox.state === "running" || sandbox.state === "stopped") {
      return sandbox;
    }
    if (sandbox.state === "error") {
      throw new Error(`sandbox create failed: ${sandbox.id}\n${sandbox.logs.join("\n")}`);
    }

    const timeoutMs = 12 * 60_000;
    const pollMs = 3_000;
    const deadline = Date.now() + timeoutMs;
    let latest = sandbox;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      latest = await this.get(sandbox.id);
      if (latest.state === "running" || latest.state === "stopped") {
        return latest;
      }
      if (latest.state === "error") {
        throw new Error(`sandbox create failed: ${latest.id}\n${latest.logs.join("\n")}`);
      }
    }

    throw new Error(
      `sandbox create did not reach running state before timeout: ${latest.id} (${latest.state})`,
    );
  }

  private async waitForSnapshotReady(
    sandboxId: string,
    snapshotId?: string,
  ): Promise<SandboxSnapshotResponse> {
    if (!snapshotId) {
      throw new Error("snapshot job did not return snapshot id");
    }
    const timeoutMs = 12 * 60_000;
    const pollMs = 3_000;
    const deadline = Date.now() + timeoutMs;
    let latest = await this.get(sandboxId);
    while (Date.now() < deadline) {
      const snapshot = latest.snapshots?.find((item) => item.id === snapshotId);
      if (snapshot?.state === "ready") {
        return { sandbox: latest, snapshot };
      }
      const job = latest.snapshotJobs?.find((item) => item.snapshotId === snapshotId);
      if (job?.status === "failed") {
        throw new Error(`snapshot job failed: ${job.error ?? snapshotId}`);
      }
      await sleep(pollMs);
      latest = await this.get(sandboxId);
    }
    throw new Error(`snapshot did not reach ready state before timeout: ${snapshotId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createOpenPondSandboxClient(
  options: OpenPondSandboxClientOptions,
): OpenPondSandboxClient {
  return new OpenPondSandboxClient(options);
}

export function normalizeSandboxApiUrl(baseUrlOrApiUrl: string): string {
  const trimmed = baseUrlOrApiUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    throw new Error("sandbox API URL must be non-empty");
  }
  const url = new URL(trimmed);
  const normalizedPath = url.pathname.replace(/\/$/, "");
  if (
    normalizedPath.endsWith("/v1/sandboxes") ||
    normalizedPath.endsWith("/api/sandboxes")
  ) {
    return `${url.origin}${normalizedPath}`;
  }
  if (normalizedPath.endsWith("/v1")) {
    return `${url.origin}${normalizedPath}/sandboxes`;
  }
  if (isOpenPondHostedApiHost(url.hostname)) {
    return `${url.origin}${normalizedPath}/v1/sandboxes`;
  }
  if (url.origin === DEFAULT_OPENPOND_WEB_BASE_URL) {
    return `${DEFAULT_OPENPOND_API_BASE_URL}/v1/sandboxes`;
  }
  return `${url.origin}${normalizedPath}/api/sandboxes`;
}

function isOpenPondHostedApiHost(hostname: string): boolean {
  return (
    hostname === "api.openpond.ai" ||
    (hostname.startsWith("api") && hostname.endsWith(".openpond.ai"))
  );
}

function apiRootUrlFromSandboxApiUrl(sandboxApiUrl: string): string {
  const suffix = "/sandboxes";
  if (!sandboxApiUrl.endsWith(suffix)) {
    throw new Error("sandbox API URL must end with /sandboxes");
  }
  return sandboxApiUrl.slice(0, -suffix.length);
}

function parseProcessOutputEvent(event: string): string | null {
  if (!event.includes("event: output")) {
    return null;
  }
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  if (dataLines.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as { output?: unknown };
    return typeof parsed.output === "string" ? parsed.output : null;
  } catch {
    return null;
  }
}

function normalizePtyInput(input: string | Uint8Array | SandboxPtyInput): SandboxPtyInput {
  if (typeof input === "string") {
    return { dataBase64: Buffer.from(input, "utf-8").toString("base64") };
  }
  if (input instanceof Uint8Array) {
    return { dataBase64: Buffer.from(input).toString("base64") };
  }
  return input;
}
