import type { OpenPondSandboxClient } from "./client";
import type {
  SandboxAgentRunInput,
  SandboxAgentUpdateInput,
  SandboxAgentUpsertInput,
  SandboxCreateInput,
  SandboxProjectUpdateInput,
  SandboxProjectUpsertInput,
  SandboxRuntime,
  SandboxRuntimeCheckpointInput,
  SandboxRuntimeCreateInput,
  SandboxRuntimeEventInput,
  SandboxRuntimePromoteInput,
  SandboxRuntimeSandboxCreateInput,
  SandboxRuntimeTransitionInput,
} from "./types/index";

export function createSandboxRuntimeNamespace(client: OpenPondSandboxClient) {
  return {
    list: (
      input: {
        teamId?: string;
        projectId?: string;
        agentId?: string;
      } = {}
    ) => client.listSandboxRuntimes(input),
    create: (input: SandboxRuntimeCreateInput) =>
      client.createSandboxRuntime(input),
    handle: (runtimeId: string, initial: SandboxRuntime | null = null) =>
      client.sandboxRuntime(runtimeId, initial),
    get: (runtimeId: string) => client.getSandboxRuntime(runtimeId),
    createSandbox: (
      runtimeId: string,
      input: SandboxRuntimeSandboxCreateInput = {}
    ) => client.createSandboxRuntimeSandbox(runtimeId, input),
    updateStatus: (runtimeId: string, input: SandboxRuntimeTransitionInput) =>
      client.updateSandboxRuntimeStatus(runtimeId, input),
    events: (runtimeId: string) => client.listSandboxRuntimeEvents(runtimeId),
    event: (runtimeId: string, input: SandboxRuntimeEventInput) =>
      client.emitSandboxRuntimeEvent(runtimeId, input),
    checkpoint: (
      runtimeId: string,
      input: SandboxRuntimeCheckpointInput = {}
    ) => client.checkpointSandboxRuntime(runtimeId, input),
    promote: (
      runtimeId: string,
      input: SandboxRuntimePromoteInput,
      options: { teamId?: string } = {}
    ) => client.promoteSandboxRuntime(runtimeId, input, options),
  };
}

export function createSandboxNamespace(client: OpenPondSandboxClient) {
  return {
    list: (
      input: {
        teamId?: string;
        projectId?: string;
        agentId?: string;
      } = {}
    ) => client.list(input),
    create: (input: SandboxCreateInput) => client.create(input),
    get: (sandboxId: string) => client.get(sandboxId),
    pricing: () => client.pricing(),
    costs: (
      input: {
        teamId?: string;
        projectId?: string;
        agentId?: string;
      } = {}
    ) => client.costs(input),
  };
}

export function createSandboxProjectNamespace(client: OpenPondSandboxClient) {
  return {
    list: (input: { teamId: string }) => client.listProjects(input),
    upsert: (input: SandboxProjectUpsertInput) => client.upsertProject(input),
    get: (projectId: string, input: { teamId: string }) =>
      client.getProject(projectId, input),
    update: (projectId: string, input: SandboxProjectUpdateInput) =>
      client.updateProject(projectId, input),
    sync: (projectId: string, input: { teamId: string }) =>
      client.syncProject(projectId, input),
    archive: (projectId: string, input: { teamId: string }) =>
      client.archiveProject(projectId, input),
  };
}

export function createSandboxAgentNamespace(client: OpenPondSandboxClient) {
  return {
    list: (input: { teamId: string }) => client.listAgents(input),
    upsert: (input: SandboxAgentUpsertInput) => client.upsertAgent(input),
    get: (agentId: string, input: { teamId: string }) =>
      client.getAgent(agentId, input),
    update: (agentId: string, input: SandboxAgentUpdateInput) =>
      client.updateAgent(agentId, input),
    archive: (agentId: string, input: { teamId: string }) =>
      client.archiveAgent(agentId, input),
    run: (agentId: string, input: SandboxAgentRunInput) =>
      client.runAgent(agentId, input),
  };
}
