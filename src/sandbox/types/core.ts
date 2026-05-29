export type SandboxState =
  | "creating"
  | "running"
  | "stopped"
  | "archived"
  | "deleted"
  | "error";

export type SandboxRuntimeDriver =
  | "simulated-firecracker"
  | "remote-firecracker";

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

export type SandboxIntegrationConnectionStatus = "active" | "revoked" | "error";

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
