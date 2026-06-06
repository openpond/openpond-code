export const SANDBOX_RUNTIME_ENVIRONMENT_IDS = [
  "openpond-coding-core-v1",
] as const;

export type SandboxRuntimeEnvironmentId =
  (typeof SANDBOX_RUNTIME_ENVIRONMENT_IDS)[number];

export type SandboxRuntimeEnvironmentCapability =
  | "files"
  | "exec"
  | "processes"
  | "pty"
  | "ports"
  | "preview"
  | "git";

export type SandboxRuntimeEnvironment = {
  id: SandboxRuntimeEnvironmentId;
  label: string;
  description: string;
  version: number;
  workspaceRoot: string;
  defaultExecutionProfileId: string;
  requiredTools: string[];
  excludedToolchains: string[];
  capabilities: SandboxRuntimeEnvironmentCapability[];
};

export type SandboxRuntimeEnvironmentSummary = Omit<
  SandboxRuntimeEnvironment,
  "description"
>;
