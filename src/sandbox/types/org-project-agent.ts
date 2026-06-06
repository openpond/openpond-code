import type {
  SandboxRecord,
  SandboxRuntimeMode,
  SandboxRuntimePromotionPolicy,
} from "./index";
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
export type SandboxAgentRuntimeSourceMode =
  | "latest_source"
  | "published_snapshot"
  | "auto";
export type SandboxAgentRuntimeSourcePolicySource =
  | "manual"
  | "schedule"
  | "endpoint"
  | "background"
  | "microsoft_teams"
  | "diagnostic";

export type SandboxAgentRuntimeSourceConfig = {
  mode: SandboxAgentRuntimeSourceMode;
  sourceRef: string | null;
  sourceCommitSha: string | null;
  publishedSnapshotId: string | null;
  publishedSnapshotName: string | null;
  publishedSnapshotVersion: string | null;
  buildStatus: string | null;
  validationStatus: string | null;
  validatedAt: string | null;
};

export type SandboxAgentResolvedRuntimeSource =
  SandboxAgentRuntimeSourceConfig & {
    resolvedMode: "latest_source" | "published_snapshot";
    policySource: SandboxAgentRuntimeSourcePolicySource;
    reason: string;
    resolvedAt: string;
  };

export type SandboxAgentRuntimeSourcePolicy = {
  requirePublishedSnapshot?: boolean;
  allowLatestSource?: boolean;
  source?: SandboxAgentRuntimeSourcePolicySource;
};

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
  runtimeSource: SandboxAgentRuntimeSourceConfig;
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
  runtimeSource: SandboxAgentResolvedRuntimeSource | null;
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

export type SandboxProjectUpdateInput = { teamId: string } & Partial<
  Omit<SandboxProjectUpsertInput, "teamId">
>;

export type SandboxProjectSourceUploadEntry = {
  path: string;
  type: "file" | "directory";
  contentsBase64?: string;
};

export type SandboxProjectSourceUploadInput = {
  teamId: string;
  entries: SandboxProjectSourceUploadEntry[];
  branch?: string | null;
  commitMessage?: string | null;
};

export type SandboxProjectGitRemote = {
  repoUrl: string;
  uiUrl: string;
  teamSlug: string;
  projectSlug: string;
  defaultBranch: string;
};

export type SandboxProjectGitRemoteResponse = {
  project: SandboxProject;
  repo: SandboxProjectGitRemote;
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
  runtimeSource?: Partial<SandboxAgentRuntimeSourceConfig> | null;
  requiredIntegrationRefs?: string[];
  requiredEnvironmentVariableRefs?: string[];
  schedulePolicy?: Record<string, unknown>;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
};

export type SandboxAgentUpdateInput = { teamId: string } & Partial<
  Omit<SandboxAgentUpsertInput, "teamId">
>;

export type SandboxAgentRunInput = {
  teamId: string;
  idempotencyKey?: string | null;
  triggerType?: SandboxAgentTriggerType;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runtimeMode?: SandboxRuntimeMode;
  runtimeSourcePolicy?: SandboxAgentRuntimeSourcePolicy;
};

export type SandboxProjectListResponse = { projects: SandboxProject[] };
export type SandboxProjectResponse = { project: SandboxProject };
export type SandboxAgentListResponse = { agents: SandboxAgent[] };
export type SandboxAgentResponse = { agent: SandboxAgent };
export type SandboxAgentRunResponse = {
  agent: SandboxAgent;
  run: SandboxAgentRun;
  sandbox?: SandboxRecord | null;
};
