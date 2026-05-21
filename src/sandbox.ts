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
  appId?: string;
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

export type SandboxTemplateLaunchInput = Omit<SandboxForkInput, "snapshotId"> & {
  snapshotId?: string;
  templateName?: string;
  version?: string;
  useCase?: string;
};

export type SandboxSecretScope = "team" | "app" | "template";
export type SandboxSecretStatus = "active" | "revoked" | "deleted";
export type SandboxSecretAttachmentTarget =
  | "sandbox"
  | "template"
  | "app"
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
  targetType: "sandbox" | "template" | "app" | "replay";
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
  appId: string | null;
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
  appId: string | null;
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
    appId: string | null;
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
  sourceAppId?: string;
  branch?: string;
  manifestPath?: string;
  publish?: boolean;
};

export type SandboxTemplateBuildRecord = {
  id: string;
  teamId: string;
  sourceAppId: string | null;
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

export type SandboxRecord = {
  id: string;
  state: SandboxState;
  runtimeDriver: SandboxRuntimeDriver;
  repo: string | null;
  teamId: string;
  appId: string | null;
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

export type SandboxSmokeOptions = {
  repo?: string;
  budgetUsd?: string;
  cpu?: number;
  memoryGb?: number;
  diskGb?: number;
  keep?: boolean;
  preview?: boolean;
  expectedRuntimeDriver?: SandboxRuntimeDriver;
  expectedMppMode?: NonNullable<SandboxReservation["mpp"]>["mode"];
};

export type SandboxSmokeSummary = {
  deleted: boolean;
  execOutput: string;
  fileRoundtrip: boolean;
  previewStatus: number | null;
  receiptRefs: Array<string | null>;
  reservationRef: string | null;
  runId: string;
  sandboxId: string;
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

  list(input: { teamId?: string; appId?: string } = {}): Promise<SandboxRecord[]> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.request<{ sandboxes: SandboxRecord[] }>(
      query.size > 0 ? `?${query.toString()}` : "",
    ).then((payload) => payload.sandboxes);
  }

  listSecrets(input: {
    teamId?: string;
    appId?: string;
  } = {}): Promise<SandboxSecretMetadata[]> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.requestApiRoot<SandboxSecretListResponse>(
      `/sandbox-secrets${query.size > 0 ? `?${query.toString()}` : ""}`,
    ).then((payload) => payload.secrets);
  }

  getSecret(
    secretId: string,
    input: { teamId?: string; appId?: string } = {},
  ): Promise<SandboxSecretMetadata> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
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
      appId?: string;
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
    if (input.appId) query.set("appId", input.appId);
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

  forkSnapshot(
    snapshotId: string,
    input: SandboxForkInput & { teamId?: string; appId?: string } = {},
  ): Promise<SandboxForkResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    const { teamId: _teamId, appId: _appId, ...body } = input;
    return this.request<SandboxForkResponse>(
      `/catalog/snapshots/${encodeURIComponent(snapshotId)}/fork${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        method: "POST",
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
      appId?: string;
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
    if (input.appId) query.set("appId", input.appId);
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
    input: SandboxTemplateLaunchInput & { teamId?: string; appId?: string },
  ): Promise<SandboxTemplateLaunchResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    const { teamId: _teamId, appId: _appId, ...body } = input;
    return this.request<SandboxTemplateLaunchResponse>(
      `/templates/launch${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(body),
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

  startReplay(input: SandboxReplayInput & { teamId?: string; appId?: string }): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    const { teamId: _teamId, appId: _appId, ...body } = input;
    return this.requestApiRoot<SandboxReplayResponse>(
      `/sandbox-replays${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  listReplays(input: { teamId?: string; appId?: string } = {}): Promise<SandboxReplayListResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.requestApiRoot<SandboxReplayListResponse>(
      `/sandbox-replays${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  }

  getReplay(replayId: string, input: { teamId?: string; appId?: string } = {}): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.requestApiRoot<SandboxReplayResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  getReplayLogs(
    replayId: string,
    input: { teamId?: string; appId?: string } = {},
  ): Promise<SandboxReplayLogsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.requestApiRoot<SandboxReplayLogsResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}/logs${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  getReplayArtifacts(
    replayId: string,
    input: { teamId?: string; appId?: string } = {},
  ): Promise<SandboxReplayArtifactsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
    return this.requestApiRoot<SandboxReplayArtifactsResponse>(
      `/sandbox-replays/${encodeURIComponent(replayId)}/artifacts${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
    );
  }

  cancelReplay(replayId: string, input: { teamId?: string; appId?: string } = {}): Promise<SandboxReplayResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
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
      appId?: string;
      status?: SandboxIntegrationConnectionStatusFilter;
    } = {},
  ): Promise<SandboxIntegrationConnectionsResponse> {
    const query = new URLSearchParams();
    if (input.teamId) query.set("teamId", input.teamId);
    if (input.appId) query.set("appId", input.appId);
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

  create(input: SandboxCreateInput): Promise<SandboxRecord> {
    return this.request<SandboxCreateResponse>("", {
      method: "POST",
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
    let deleted = false;

    try {
      const sandbox = await this.create({
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
      });
      sandboxId = sandbox.id;

      const expectedRuntimeDriver = options.expectedRuntimeDriver ?? "remote-firecracker";
      if (sandbox.runtimeDriver !== expectedRuntimeDriver) {
        throw new Error(`expected ${expectedRuntimeDriver}, got ${sandbox.runtimeDriver}`);
      }

      const expectedMppMode = options.expectedMppMode ?? "mpp_service_hook";
      if (sandbox.reservation.mpp?.mode !== expectedMppMode) {
        throw new Error(
          `expected ${expectedMppMode} reservation, got ${sandbox.reservation.mpp?.mode ?? "none"}`,
        );
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
        previewStatus,
        receiptRefs: receipts.map((receipt) => receipt.mpp.receiptRef ?? null),
        reservationRef: sandbox.reservation.mpp?.reservationRef ?? null,
        runId,
        sandboxId: sandbox.id,
        state: readback.state,
      };
    } finally {
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
  if (url.hostname === "api.openpond.ai" || url.hostname.startsWith("api.")) {
    return `${url.origin}${normalizedPath}/v1/sandboxes`;
  }
  if (url.origin === DEFAULT_OPENPOND_WEB_BASE_URL) {
    return `${DEFAULT_OPENPOND_API_BASE_URL}/v1/sandboxes`;
  }
  return `${url.origin}${normalizedPath}/api/sandboxes`;
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
