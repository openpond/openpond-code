import type { ChatRequestBody } from "./types";
import {
  DEFAULT_OPENPOND_API_BASE_URL,
  DEFAULT_OPENPOND_WEB_BASE_URL,
} from "./urls";

const DEFAULT_OPENPOND_API_HOST = new URL(DEFAULT_OPENPOND_API_BASE_URL).hostname;
const DEFAULT_OPENPOND_WEB_HOST = new URL(DEFAULT_OPENPOND_WEB_BASE_URL).hostname;

export type ToolManifest = {
  version?: string;
  tools: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: unknown;
    };
  }>;
};

export async function apiFetch(
  baseUrl: string,
  token: string | null,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  const apiKey = process.env.OPENPOND_API_KEY;
  const trimmedToken = token?.trim() || "";
  const tokenIsApiKey = trimmedToken.startsWith("opk_");
  const effectiveApiKey = apiKey || (tokenIsApiKey ? trimmedToken : null);
  if (effectiveApiKey && !headers.has("openpond-api-key")) {
    headers.set("openpond-api-key", effectiveApiKey);
  }
  if (token) {
    headers.set("Authorization", tokenIsApiKey ? `ApiKey ${trimmedToken}` : `Bearer ${token}`);
  } else if (apiKey && !headers.has("Authorization")) {
    headers.set("Authorization", `ApiKey ${apiKey}`);
  }
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] || "";
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  try {
    const json = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type CreateLocalProjectInput = {
  name: string;
  templateRepoUrl?: string;
  templateBranch?: string;
  envVars?: Record<string, string>;
};

export type CreateRepoRequest = {
  name: string;
  description?: string;
  repoInit?: "opentool" | "empty";
  templateRepoUrl?: string;
  templateBranch?: string;
  envVars?: Record<string, string>;
  deployOnPush?: boolean;
  autoScheduleMigration?: boolean;
};

export type CreateRepoResponse = {
  appId: string;
  gitOwner?: string | null;
  gitRepo?: string | null;
  gitHost?: string | null;
  repoUrl?: string | null;
  defaultBranch?: string;
};

export type HeadlessAppRequest = {
  name?: string;
  description?: string;
  templateRepoUrl?: string;
  templateBranch?: string;
  templateName?: string;
  envVars?: Record<string, string>;
  visibility?: "private" | "public";
};

export type HeadlessAppResponse = {
  status: "ok" | "error";
  appId?: string;
  deploymentId?: string;
  conversationId?: string;
  error?: string;
};

export type HeadlessAppsResponse = {
  items: HeadlessAppResponse[];
};

export type TemplateStatusResponse = {
  templateRepoUrl: string;
  templateBranch: string;
  remoteSha: string;
  lastAppliedSha: string | null;
  updateAvailable: boolean;
};

export type TemplateBranchesResponse = {
  templateRepoUrl: string;
  templateBranch: string;
  defaultBranch: string;
  branches: string[];
};

export type TemplateDeployLatestRequest = {
  environment: "preview" | "production";
};

export type TemplateDeployLatestResponse = {
  deploymentId: string;
  version: number;
  templateCommitSha: string;
};

export type AppEnvironmentUpdateRequest = {
  envVars: Record<string, string>;
};

export type AppEnvironmentUpdateResponse = {
  environment: Record<string, string>;
};

export type AppEnvironmentGetResponse = {
  environment: Record<string, string>;
};

export type AppListItem = {
  id: string;
  name: string;
  description: string | null;
  appType: string | null;
  visibility: "public" | "private";
  gitOwner: string | null;
  gitRepo: string | null;
  gitProvider: string | null;
  gitHost: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
  teamId: string | null;
  teamName: string | null;
  handle: string | null;
  repo: string | null;
  latestDeployment: {
    id: string;
    status: string;
    deploymentDomain: string | null;
    internalUrl: string | null;
    createdAt: string;
    isProduction: boolean | null;
    gitBranch: string | null;
  } | null;
};

export type AppRuntimeSummary = {
  app: {
    appId: string;
    name: string;
    description: string | null;
    teamId: string;
    templateRepoUrl: string | null;
    templateBranch: string | null;
    initialPromptSnapshot: string | null;
  };
  runtime: {
    latestDeployment: {
      id: string;
      status: string;
      isProduction: boolean | null;
      createdAt: string;
    } | null;
    schedules: {
      total: number;
      enabled: number;
      disabled: number;
    };
    notifications: {
      scheduleEmailsEnabled: boolean;
      scheduleTweetsEnabled: boolean;
    };
    toolNotifyEmail: {
      notifyEmailEnabledCount: number;
      toolsConfiguredCount: number;
    };
    lastScheduleRun: {
      id: string;
      status: string;
      executionTime: string;
      scheduleName: string;
      errorMessage: string | null;
    } | null;
    lastToolRun: {
      id: string;
      status: string;
      endpoint: string;
      toolName: string | null;
      method: string | null;
      createdAt: string;
      executionTime: number | null;
      error: string | null;
    } | null;
  };
  wallet: {
    personalWalletAddress: string | null;
    operatingWalletAddress: string | null;
    arbitrum: {
      eth: { raw: string; formatted: string } | null;
      usdc: { raw: string; formatted: string } | null;
    };
    hyperliquid: {
      mainnet: {
        accountValue: number | null;
        withdrawable: number | null;
        totalMarginUsed: number | null;
        error?: string;
      };
      testnet: {
        accountValue: number | null;
        withdrawable: number | null;
        totalMarginUsed: number | null;
        error?: string;
      };
    };
  };
  asOf: string;
};

export type AppSchedulesResponse = {
  schedules?: unknown[];
};

export type OpenPondAccountProduct = {
  id: string;
  userProductId: string;
  openPondProductId: string | null;
  name: string;
  description: string[] | null;
  type: "subscription" | "credit_pack" | string;
  status: "active" | "expired" | "cancelled" | string;
  startDate: string | null;
  endDate: string | null;
  dailyInputTokens: number | null;
  dailyOutputTokens: number | null;
  dailyMessageLimit: number | null;
  monthlyInputTokens: number | null;
  monthlyOutputTokens: number | null;
  monthlyCost: string | null;
  credits: string | null;
  price: string | null;
  currency: string;
  duration: number | null;
  restrictedModels: string[] | null;
  gatewayEntitlements: unknown | null;
  duckHoldings: number | null;
  isActive: boolean | null;
};

export type OpenPondAccount = {
  id: string;
  email: string | null;
  name: string | null;
  handle: string | null;
  image: string | null;
  timezone: string | null;
  turnkeyWalletAddress: string | null;
  turnkeyOperatingWalletAddress: string | null;
  isAdmin: boolean;
  isVerified: boolean;
  dailyAgentAppId: string | null;
  dailyAgentDeploymentId: string | null;
  credits: string;
};

export type OpenPondAccountResponse = {
  account: OpenPondAccount;
  products: OpenPondAccountProduct[];
  asOf: string;
};

export type OpenPondApiHealthResponse = {
  status: string;
  service?: string;
  timestamp?: string;
  version?: string | null;
};

export type OpenPondApiHealth = {
  reachable: boolean;
  authenticated: boolean | null;
  apiBase: string;
  latencyMs: number;
  status: number | null;
  service: string | null;
  checkedAt: string;
  account?: OpenPondAccount | null;
  error?: string;
};

export type AssistantMode = "plan" | "performance";

export type AssistantRunRequest = {
  appId: string;
  mode: AssistantMode;
  prompt: string;
};

export type AssistantRunResponse = {
  ok: boolean;
  mode: AssistantMode;
  conversationId: string;
  response: string;
};

export async function listApps(
  apiBase: string,
  token: string,
  options?: { handle?: string }
): Promise<AppListItem[]> {
  const params = new URLSearchParams();
  if (options?.handle) {
    params.set("handle", options.handle);
  }
  const query = params.toString();
  const response = await apiFetch(
    apiBase,
    token,
    `/apps/list${query ? `?${query}` : ""}`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Apps list failed: ${response.status} ${text}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    apps?: AppListItem[];
  };
  return Array.isArray(payload.apps) ? payload.apps : [];
}

export async function createLocalProject(
  baseUrl: string,
  token: string,
  input: CreateLocalProjectInput
): Promise<{ appId: string }> {
  const response = await apiFetch(baseUrl, token, "/api/projects/local", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Create project failed: ${response.status} ${text}`);
  }
  return (await response.json()) as { appId: string };
}

export async function createRepo(
  apiBase: string,
  apiKey: string,
  input: CreateRepoRequest
): Promise<CreateRepoResponse> {
  const response = await apiFetch(apiBase, apiKey, "/apps/repo/create", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Repo create failed: ${response.status} ${text}`);
  }
  return (await response.json()) as CreateRepoResponse;
}

export async function createHeadlessApps(
  baseUrl: string,
  token: string,
  items: HeadlessAppRequest[]
): Promise<HeadlessAppsResponse> {
  const response = await apiFetch(baseUrl, token, "/v4/apps/headless", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Headless create failed: ${response.status} ${text}`);
  }
  return (await response.json()) as HeadlessAppsResponse;
}

export async function getTemplateStatus(
  apiBase: string,
  token: string,
  appId: string
): Promise<TemplateStatusResponse> {
  const response = await apiFetch(
    apiBase,
    token,
    `/v4/apps/${appId}/template/status`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Template status failed: ${response.status} ${text}`);
  }
  return (await response.json()) as TemplateStatusResponse;
}

export async function listTemplateBranches(
  apiBase: string,
  token: string,
  appId: string
): Promise<TemplateBranchesResponse> {
  const response = await apiFetch(
    apiBase,
    token,
    `/v4/apps/${appId}/template/branches`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Template branches failed: ${response.status} ${text}`);
  }
  return (await response.json()) as TemplateBranchesResponse;
}

export async function deployLatestTemplate(
  apiBase: string,
  token: string,
  appId: string,
  input: TemplateDeployLatestRequest
): Promise<TemplateDeployLatestResponse> {
  const response = await apiFetch(
    apiBase,
    token,
    `/v4/apps/${appId}/template/deploy-latest`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Template deploy failed: ${response.status} ${text}`);
  }
  return (await response.json()) as TemplateDeployLatestResponse;
}

export async function updateAppEnvironment(
  apiBase: string,
  token: string,
  appId: string,
  input: AppEnvironmentUpdateRequest
): Promise<AppEnvironmentUpdateResponse> {
  const response = await apiFetch(
    apiBase,
    token,
    `/v4/apps/${appId}/environment`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Environment update failed: ${response.status} ${text}`);
  }
  return (await response.json()) as AppEnvironmentUpdateResponse;
}

export async function getAppEnvironment(
  apiBase: string,
  token: string,
  appId: string
): Promise<AppEnvironmentGetResponse> {
  const response = await apiFetch(
    apiBase,
    token,
    `/v4/apps/${appId}/environment`,
    {
      method: "GET",
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Environment get failed: ${response.status} ${text}`);
  }
  return (await response.json()) as AppEnvironmentGetResponse;
}

export async function fetchToolManifest(
  baseUrl: string,
  token: string
): Promise<ToolManifest> {
  const response = await apiFetch(baseUrl, token, "/api/tools/manifest", {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Manifest fetch failed: ${response.status} ${text}`);
  }
  return (await response.json()) as ToolManifest;
}

export async function listUserTools(
  baseUrl: string,
  token: string
): Promise<{ tools?: unknown[] }> {
  const response = await apiFetch(baseUrl, token, "/apps/tools", {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tools lookup failed: ${response.status} ${text}`);
  }
  return (await response.json()) as { tools?: unknown[] };
}

export async function listAppSchedules(
  baseUrl: string,
  token: string,
  appId: string
): Promise<AppSchedulesResponse> {
  const response = await apiFetch(
    baseUrl,
    token,
    `/apps/${encodeURIComponent(appId)}/schedules`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Schedules lookup failed: ${response.status} ${text}`);
  }
  return (await response.json()) as AppSchedulesResponse;
}

export type AgentCreateRequest = {
  prompt: string;
  template?: {
    name?: string;
    description?: string;
    templateRepoUrl?: string;
    templateBranch?: string;
    envVars?: Record<string, string>;
  };
  deployEnvironment?: "preview" | "production";
  deployDisabled?: boolean;
  autoDeployOnFinish?: boolean;
  streamDeployLogs?: boolean;
};

export async function createAgentFromPrompt(
  baseUrl: string,
  token: string,
  payload: AgentCreateRequest
): Promise<Response> {
  return apiFetch(baseUrl, token, "/apps/agent/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getUserPerformance(
  baseUrl: string,
  token: string,
  options?: { appId?: string }
): Promise<unknown> {
  const params = new URLSearchParams();
  if (options?.appId) {
    params.set("appId", options.appId);
  }
  const qs = params.toString();
  const response = await apiFetch(
    baseUrl,
    token,
    `/apps/performance${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Performance lookup failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export async function getAppRuntimeSummary(
  baseUrl: string,
  token: string,
  appId: string
): Promise<AppRuntimeSummary> {
  const params = new URLSearchParams({ appId });
  const response = await apiFetch(
    baseUrl,
    token,
    `/apps/summary?${params.toString()}`,
    {
      method: "GET",
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Summary lookup failed: ${response.status} ${text}`);
  }
  return (await response.json()) as AppRuntimeSummary;
}

export async function getOpenPondAccount(
  baseUrl: string,
  token: string
): Promise<OpenPondAccountResponse> {
  const response = await apiFetch(baseUrl, token, "/account", {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Account lookup failed: ${response.status} ${text}`);
  }
  return (await response.json()) as OpenPondAccountResponse;
}

export async function checkOpenPondApiHealth(
  baseUrl: string,
  token?: string | null
): Promise<OpenPondApiHealth> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const normalizedBase = baseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${normalizedBase}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - started;
    const payload = (await response.json().catch(() => ({}))) as Partial<OpenPondApiHealthResponse>;
    let authenticated: boolean | null = null;
    let account: OpenPondAccount | null = null;

    if (token?.trim()) {
      try {
        const accountPayload = await getOpenPondAccount(normalizedBase, token);
        authenticated = true;
        account = accountPayload.account;
      } catch {
        authenticated = false;
      }
    }

    return {
      reachable: response.ok,
      authenticated,
      apiBase: normalizedBase,
      latencyMs,
      status: response.status,
      service: typeof payload.service === "string" ? payload.service : null,
      checkedAt,
      account,
      ...(response.ok ? {} : { error: response.statusText || `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      reachable: false,
      authenticated: token?.trim() ? false : null,
      apiBase: normalizedBase,
      latencyMs: Date.now() - started,
      status: null,
      service: null,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAssistantMode(
  baseUrl: string,
  token: string,
  payload: AssistantRunRequest
): Promise<AssistantRunResponse> {
  const response = await apiFetch(baseUrl, token, "/apps/assistant/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Assistant run failed: ${response.status} ${text}`);
  }
  return (await response.json()) as AssistantRunResponse;
}

export async function postAgentDigest(
  baseUrl: string,
  token: string,
  body: { content: string; runAt?: string; metadata?: Record<string, unknown> }
): Promise<unknown> {
  const response = await apiFetch(baseUrl, token, "/apps/agent/digest", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Agent digest failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export async function executeUserTool(
  baseUrl: string,
  token: string,
  body: {
    appId: string;
    deploymentId: string;
    toolName: string;
    scheduleId?: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    notifyEmail?: boolean;
  }
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const response = await apiFetch(baseUrl, token, "/apps/tools/execute", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : text || response.statusText,
    };
  }
  return {
    ok: true,
    status: response.status,
    data: payload,
  };
}

export async function submitPositionsTx(
  baseUrl: string,
  token: string,
  params: {
    method: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string>;
  }
): Promise<unknown> {
  const qs =
    params.query && Object.keys(params.query).length > 0
      ? `?${new URLSearchParams(params.query).toString()}`
      : "";
  const response = await apiFetch(baseUrl, token, `/apps/positions/tx${qs}`, {
    method: params.method,
    body:
      params.method === "POST" && params.body !== undefined
        ? JSON.stringify(params.body)
        : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Positions request failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export type BacktestRunRequest = {
  appId: string;
  deploymentId: string;
  toolName?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  symbol?: string;
  timeframeStart?: string;
  timeframeEnd?: string;
  lookbackDays?: number;
  initialEquityUsd?: number;
  source?: string;
  fillModel?: string;
  feeModel?: string;
  slippageBps?: number;
  headers?: Record<string, string>;
};

export async function submitBacktestRun(
  baseUrl: string,
  token: string,
  body: BacktestRunRequest
): Promise<unknown> {
  const response = await apiFetch(baseUrl, token, "/apps/backtests/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Backtest run failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export async function submitBacktestTx(
  baseUrl: string,
  token: string,
  params: {
    method: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string>;
  }
): Promise<unknown> {
  const qs =
    params.query && Object.keys(params.query).length > 0
      ? `?${new URLSearchParams(params.query).toString()}`
      : "";
  const response = await apiFetch(baseUrl, token, `/apps/backtests/tx${qs}`, {
    method: params.method,
    body:
      params.method === "POST" && params.body !== undefined
        ? JSON.stringify(params.body)
        : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Backtests request failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export async function submitBacktestDetail(
  baseUrl: string,
  token: string,
  query: Record<string, string>
): Promise<unknown> {
  const qs = new URLSearchParams(query).toString();
  const response = await apiFetch(baseUrl, token, `/apps/backtests/detail?${qs}`, {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Backtest detail failed: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

export async function chatRequest(
  baseUrl: string,
  token: string,
  body: ChatRequestBody
): Promise<Response> {
  const resolvedBody: ChatRequestBody = { ...body };
  if (token && (!resolvedBody.userId || !resolvedBody.teamId)) {
    const payload = decodeJwtPayload(token);
    const userId =
      typeof payload?.user_id === "string" ? payload.user_id : undefined;
    const teamId =
      typeof payload?.organization_id === "string"
        ? payload.organization_id
        : undefined;
    if (!resolvedBody.userId && userId) {
      resolvedBody.userId = userId;
    }
    if (!resolvedBody.teamId && teamId) {
      resolvedBody.teamId = teamId;
    }
  }
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/api/training")) {
    return apiFetch(trimmed, token, "/chat/completions", {
      method: "POST",
      body: JSON.stringify(resolvedBody),
    });
  }
  return apiFetch(trimmed, token, "/api/chat/apps", {
    method: "POST",
    body: JSON.stringify(resolvedBody),
  });
}

export async function commitFiles(
  baseUrl: string,
  token: string,
  appId: string,
  files: Record<string, string>,
  commitMessage: string
): Promise<{ commitSha: string }> {
  const response = await apiFetch(baseUrl, token, `/v4/apps/${appId}/commits`, {
    method: "POST",
    body: JSON.stringify({ files, message: commitMessage }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Commit failed: ${response.status} ${text}`);
  }
  return (await response.json()) as { commitSha: string };
}

export async function deployApp(
  baseUrl: string,
  token: string,
  appId: string,
  input?: {
    environment?: "preview" | "production";
    commitSha?: string;
    branch?: string;
  }
): Promise<{
  deploymentId: string;
  environment?: "preview" | "production";
  url?: string;
  version?: number;
  commitSha?: string;
}> {
  const environment = input?.environment ?? "production";
  const response = await apiFetch(
    baseUrl,
    token,
    `/v4/apps/${appId}/deployments`,
    {
      method: "POST",
      body: JSON.stringify({
        environment,
        ...(input?.commitSha ? { commitSha: input.commitSha } : {}),
        ...(input?.branch ? { branch: input.branch } : {}),
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Deploy failed: ${response.status} ${text}`);
  }
  return (await response.json()) as { deploymentId: string };
}

export type DeploymentLogEntry = {
  id: string;
  type?: string;
  message: string;
  createdAt: string;
};

export async function getDeploymentLogs(
  apiBase: string,
  token: string,
  deploymentId: string
): Promise<DeploymentLogEntry[]> {
  const response = await apiFetch(
    apiBase,
    token,
    `/apps/deployments/${deploymentId}/logs`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Deployment logs failed: ${response.status} ${text}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    logs?: Array<{
      id?: string;
      type?: string;
      message?: string;
      createdAt?: string | Date;
    }>;
  };
  const logs = Array.isArray(payload.logs) ? payload.logs : [];
  return logs.map((log) => {
    const createdAt =
      typeof log.createdAt === "string"
        ? log.createdAt
        : log.createdAt instanceof Date
          ? log.createdAt.toISOString()
          : new Date().toISOString();
    return {
      id: typeof log.id === "string" ? log.id : `${Math.random()}`,
      type: typeof log.type === "string" ? log.type : undefined,
      message: typeof log.message === "string" ? log.message : "",
      createdAt,
    };
  });
}

export async function getDeploymentStatus(
  apiBase: string,
  token: string,
  deploymentId: string
): Promise<{ status?: string }> {
  const response = await apiFetch(
    apiBase,
    token,
    `/apps/deployments/${deploymentId}/status`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Deployment status failed: ${response.status} ${text}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    deployment?: { status?: string };
  };
  return { status: payload.deployment?.status };
}

export async function getLatestDeploymentForApp(
  apiBase: string,
  token: string,
  appId: string,
  options?: { status?: string[]; createdAfter?: string; branch?: string }
): Promise<{ id?: string; status?: string } | null> {
  const params = new URLSearchParams();
  if (options?.status && options.status.length > 0) {
    params.set("status", options.status.join(","));
  }
  if (options?.createdAfter) {
    params.set("createdAfter", options.createdAfter);
  }
  if (options?.branch) {
    params.set("branch", options.branch);
  }
  const query = params.toString();
  const response = await apiFetch(
    apiBase,
    token,
    `/apps/${appId}/deployments/latest${query ? `?${query}` : ""}`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Latest deployment lookup failed: ${response.status} ${text}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    deployment?: { id?: string; status?: string } | null;
  };
  if (!payload.deployment) return null;
  return {
    id: payload.deployment.id,
    status: payload.deployment.status,
  };
}

export type DeploymentDetail = {
  id: string;
  appId: string;
  status: string;
  createdAt: string;
  gitBranch: string | null;
  toolsJson?: unknown;
  metadataJson?: unknown;
};

export async function getDeploymentDetail(
  apiBase: string,
  token: string,
  deploymentId: string
): Promise<DeploymentDetail | null> {
  const response = await apiFetch(
    apiBase,
    token,
    `/apps/deployments/${deploymentId}`,
    { method: "GET" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Deployment fetch failed: ${response.status} ${text}`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    deployment?: DeploymentDetail | null;
  };
  return payload.deployment ?? null;
}

export type ToolExecuteRequest = {
  appId: string;
  deploymentId: string;
  toolName: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export type ToolExecuteResponse = {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

function normalizeToolPathSegment(toolName: string): string {
  const trimmed = toolName.trim().replace(/^\/+/, "");
  return encodeURIComponent(trimmed || "tool");
}

export function resolveWorkerBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const workerEnv = process.env.OPENPOND_TOOL_URL;
  if (workerEnv) {
    return workerEnv.replace(/\/$/, "");
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const mappedHost = (() => {
      if (host === "apps.openpond.live") {
        return null;
      }
      if (
        host === DEFAULT_OPENPOND_API_HOST ||
        host === DEFAULT_OPENPOND_WEB_HOST ||
        host === "openpond.live" ||
        host === "www.openpond.live"
      ) {
        return "https://apps.openpond.live";
      }
      return null;
    })();
    if (mappedHost) {
      return mappedHost;
    }
    const isLocal = host === "localhost" || host === "127.0.0.1";
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (isLocal && port === "3000") {
      return trimmed;
    }
  } catch {
    // fall through to trimmed
  }
  return trimmed;
}

export async function executeHostedTool(
  baseUrl: string,
  token: string,
  payload: ToolExecuteRequest
): Promise<ToolExecuteResponse> {
  const workerBase = resolveWorkerBaseUrl(baseUrl);
  const toolPath = normalizeToolPathSegment(payload.toolName);
  const deploymentPrefix = payload.deploymentId
    ? `/${payload.appId}/deployments/${payload.deploymentId}`
    : `/${payload.appId}`;
  const requestPath = `${deploymentPrefix}/${toolPath}`;
  const headers = new Headers(payload.headers || {});
  const method = payload.method ?? "POST";
  const body =
    payload.body === undefined || method === "GET"
      ? undefined
      : JSON.stringify(payload.body);
  const response = await apiFetch(workerBase, token, requestPath, {
    method,
    body,
    headers,
  });
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const dataOk =
    data && typeof data === "object" && "ok" in data
      ? Boolean((data as { ok?: unknown }).ok)
      : true;
  const ok = response.ok && dataOk;
  const status =
    data && typeof data === "object" && "status" in data
      ? Number((data as { status?: unknown }).status) || response.status
      : response.status;
  const error =
    data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error)
      : response.ok
      ? undefined
      : text || response.statusText;
  const payloadData =
    data && typeof data === "object" && "data" in data
      ? (data as { data?: unknown }).data
      : data;
  return { ok, status, data: payloadData, error };
}
