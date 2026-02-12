#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  getAppRuntimeSummary,
  executeHostedTool,
  getDeploymentDetail,
  getDeploymentLogs,
  getDeploymentStatus,
  getLatestDeploymentForApp,
  getUserPerformance,
  getTemplateStatus,
  listApps,
  listTemplateBranches,
  listUserTools,
  createHeadlessApps,
  createRepo,
  createAgentFromPrompt,
  deployApp,
  deployLatestTemplate,
  getAppEnvironment,
  updateAppEnvironment,
  executeUserTool,
  runAssistantMode,
  submitPositionsTx,
  type AppListItem,
} from "./api";
import {
  DEFAULT_CACHE_TTL_MS,
  getCachedApps,
  getCachedTools,
  setCachedApps,
  setCachedTools,
} from "./cache";
import { loadConfig, saveGlobalConfig, type LocalConfig } from "./config";
import { consumeStream, formatStreamItem } from "./stream";

type Command =
  | "login"
  | "tool"
  | "deploy"
  | "apps"
  | "repo"
  | "template"
  | "opentool"
  | "help";

type RepoTarget = { handle: string; repo: string };

function parseArgs(argv: string[]) {
  const args = [...argv];
  const command = (args.shift() || "") as Command;
  const options: Record<string, string | boolean> = {};
  const rest: string[] = [];

  while (args.length > 0) {
    const next = args.shift()!;
    if (next.startsWith("--")) {
      const rawKey = next.slice(2);
      const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = args[0] && !args[0].startsWith("--") ? args.shift()! : "true";
      options[key] = value;
    } else {
      rest.push(next);
    }
  }

  return { command, options, rest };
}

function resolveBaseUrl(config: LocalConfig): string {
  const envBase = process.env.OPENPOND_BASE_URL;
  const base = envBase || config.baseUrl || "https://openpond.ai";
  return base.replace(/\/$/, "");
}

function resolvePublicApiBaseUrl(): string {
  const envBase = process.env.OPENPOND_API_URL;
  const base = envBase || "https://api.openpond.ai";
  return base.replace(/\/$/, "");
}

function normalizeTemplateRepoUrl(input: string, baseUrl: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("template must be non-empty");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
  }
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const [owner, repoRaw] = trimmed.includes("/")
    ? trimmed.split("/", 2)
    : ["openpondai", trimmed];
  const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
  if (!owner || !repo) {
    throw new Error("template must be <owner>/<repo> or a full https URL");
  }
  return `${normalizedBase}/${owner}/${repo}.git`;
}

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function parseBooleanOption(value: string | boolean | undefined): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

function parseTimeOption(value: string | boolean | undefined, label: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return String(parsed);
  }
  throw new Error(`${label} must be a unix ms timestamp or ISO date`);
}

function resolveApiKey(config: LocalConfig): string | null {
  const envKey = process.env.OPENPOND_API_KEY?.trim();
  if (envKey) return envKey;
  const stored = config.apiKey?.trim();
  if (stored) return stored;
  const legacy = config.token?.trim();
  if (legacy && legacy.startsWith("opk_")) return legacy;
  return null;
}

function resolveTemplateEnvironment(value: string | undefined): "preview" | "production" {
  if (!value) return "production";
  const normalized = value.toLowerCase();
  if (normalized === "preview" || normalized === "production") {
    return normalized;
  }
  throw new Error("env must be preview or production");
}

const UI_API_KEY_URL = "https://openpond.ai/settings/api-keys";

async function promptForApiKey(): Promise<string> {
  console.log("Open the OpenPond UI to create an API key:");
  console.log(UI_API_KEY_URL);
  const rl = createInterface({ input, output });
  try {
    const value = (await rl.question("Paste your OpenPond API key: ")).trim();
    if (!value) {
      throw new Error("API key is required");
    }
    if (!value.startsWith("opk_")) {
      console.log("warning: API keys usually start with opk_.");
    }
    return value;
  } finally {
    rl.close();
  }
}

async function ensureApiKey(config: LocalConfig, baseUrl: string): Promise<string> {
  const existing = resolveApiKey(config);
  if (existing) return existing;
  const apiKey = await promptForApiKey();
  await saveGlobalConfig({ apiKey, baseUrl });
  console.log("saved api key to ~/.openpond/config.json");
  return apiKey;
}

async function promptConfirm(question: string, defaultValue = false): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await rl.question(`${question} ${suffix} `))
      .trim()
      .toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function promptForPath(defaultPath: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`Local path (default: ${defaultPath}): `)).trim();
    return answer || defaultPath;
  } finally {
    rl.close();
  }
}

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; inherit?: boolean } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.inherit ? "inherit" : "pipe",
    });
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      proc.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function getGitRemoteUrl(
  cwd: string,
  remoteName: string
): Promise<string | null> {
  const result = await runCommand("git", ["remote", "get-url", remoteName], { cwd });
  if (result.code !== 0) return null;
  const url = result.stdout.trim();
  return url.length > 0 ? url : null;
}

function resolveRepoUrl(response: {
  repoUrl?: string | null;
  gitHost?: string | null;
  gitOwner?: string | null;
  gitRepo?: string | null;
}): string {
  if (response.repoUrl) return response.repoUrl;
  if (response.gitHost && response.gitOwner && response.gitRepo) {
    return `https://${response.gitHost}/${response.gitOwner}/${response.gitRepo}.git`;
  }
  throw new Error("repoUrl missing from API response");
}

function formatTokenizedRepoUrl(repoUrl: string, token: string): string {
  const url = new URL(repoUrl);
  const encodedToken = encodeURIComponent(token);
  return `${url.protocol}//x-access-token:${encodedToken}@${url.host}${url.pathname}`;
}

function formatTokenizedRepoUrlForPrint(repoUrl: string): string {
  const url = new URL(repoUrl);
  return `${url.protocol}//x-access-token:$OPENPOND_API_KEY@${url.host}${url.pathname}`;
}

function redactToken(value: string): string {
  return value.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

function warnOnRepoHostMismatch(repoUrl: string): void {
  const envBase = process.env.OPENPOND_BASE_URL;
  if (!envBase) return;
  try {
    const baseHost = new URL(envBase).hostname;
    const repoHost = new URL(repoUrl).hostname;
    if (baseHost && repoHost && baseHost !== repoHost) {
      console.warn(
        `warning: repo host (${repoHost}) does not match OPENPOND_BASE_URL (${baseHost})`
      );
      console.warn(
        "warning: verify your git host configuration matches OPENPOND_BASE_URL."
      );
    }
  } catch {
    // ignore malformed env base or repo URL
  }
}

function parseHandleRepo(value: string): RepoTarget {
  const parts = value.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("expected <handle>/<repo>");
  }
  return { handle: parts[0]!, repo: parts[1]! };
}

function normalizeRepoName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

async function fetchAppsWithCache(params: {
  apiBase: string;
  apiKey: string;
  forceRefresh?: boolean;
}): Promise<AppListItem[]> {
  if (!params.forceRefresh) {
    const cached = await getCachedApps({
      apiBase: params.apiBase,
      apiKey: params.apiKey,
      ttlMs: DEFAULT_CACHE_TTL_MS,
    });
    if (cached) {
      return cached;
    }
  }
  const apps = await listApps(params.apiBase, params.apiKey);
  await setCachedApps({
    apiBase: params.apiBase,
    apiKey: params.apiKey,
    apps,
  });
  return apps;
}

async function fetchToolsWithCache(params: {
  apiBase: string;
  apiKey: string;
  forceRefresh?: boolean;
}): Promise<unknown[]> {
  if (!params.forceRefresh) {
    const cached = await getCachedTools({
      apiBase: params.apiBase,
      apiKey: params.apiKey,
      ttlMs: DEFAULT_CACHE_TTL_MS,
    });
    if (cached) {
      return cached;
    }
  }
  const result = await listUserTools(params.apiBase, params.apiKey);
  const tools = Array.isArray(result.tools) ? result.tools : [];
  await setCachedTools({
    apiBase: params.apiBase,
    apiKey: params.apiKey,
    tools,
  });
  return tools;
}

async function resolveAppTarget(
  apiBase: string,
  apiKey: string,
  target: string
): Promise<{ app: AppListItem; handle: string; repo: string }> {
  const { handle, repo } = parseHandleRepo(target);
  const apps = await fetchAppsWithCache({ apiBase, apiKey });
  const normalizedRepo = normalizeRepoName(repo);
  const match = apps.find((app) => {
    if (app.handle && app.handle !== handle) {
      return false;
    }
    const candidates = [
      app.repo,
      app.gitRepo,
      app.internalToolName,
      app.name,
      app.id,
    ].map(normalizeRepoName);
    return candidates.includes(normalizedRepo);
  });
  if (!match) {
    throw new Error(`app not found for ${handle}/${repo}`);
  }
  return { app: match, handle, repo };
}

async function pollDeploymentLogs(params: {
  baseUrl: string;
  apiKey: string;
  deploymentId: string;
  prefix: string;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  const intervalMs = params.intervalMs ?? 5000;
  const timeoutMs = params.timeoutMs ?? 4 * 60 * 1000;
  const seen = new Set<string>();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const logs = await getDeploymentLogs(
      params.baseUrl,
      params.apiKey,
      params.deploymentId
    );
    const newLogs = logs.filter((log) => !seen.has(log.id));
    for (const log of newLogs) {
      seen.add(log.id);
    }
    for (const log of newLogs) {
      console.log(`${params.prefix}${log.message}`);
    }

    const status = await getDeploymentStatus(
      params.baseUrl,
      params.apiKey,
      params.deploymentId
    );
    if (status.status === "failed") {
      console.log(`${params.prefix}deployment failed`);
      return;
    }
    if (status.status === "running" || status.status === "deployed") {
      console.log(`${params.prefix}deployment complete`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log(`${params.prefix}deployment still in progress`);
}

async function runTemplateStatus(
  _options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const status = await getTemplateStatus(apiBase, apiKey, app.id);
  console.log(JSON.stringify(status, null, 2));
}

async function runTemplateBranches(
  _options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branches = await listTemplateBranches(apiBase, apiKey, app.id);
  console.log(JSON.stringify(branches, null, 2));
}

async function runTemplateUpdate(
  options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const envRaw =
    typeof options.env === "string"
      ? options.env
      : typeof options.environment === "string"
        ? options.environment
        : undefined;
  const environment = resolveTemplateEnvironment(envRaw);
  const result = await deployLatestTemplate(apiBase, apiKey, app.id, {
    environment,
  });
  console.log(JSON.stringify(result, null, 2));
}

function printHelp(): void {
  console.log("OpenPond CLI (API key only)");
  console.log("");
  console.log("Usage:");
  console.log("  openpond login [--api-key <key>]");
  console.log("  openpond tool list <handle>/<repo>");
  console.log("  openpond tool run <handle>/<repo> <tool> [--body <json>] [--method <METHOD>]");
  console.log("  openpond deploy watch <handle>/<repo> [--branch <branch>]");
  console.log("  openpond template status <handle>/<repo>");
  console.log("  openpond template branches <handle>/<repo>");
  console.log("  openpond template update <handle>/<repo> [--env preview|production]");
  console.log(
    "  openpond repo create --name <name> [--path <dir>] [--template <owner/repo|url>] [--template-branch <branch>] [--env <json>] [--empty|--opentool] [--token] [--auto-schedule-migration <true|false>]"
  );
  console.log("  openpond repo push [--path <dir>] [--branch <branch>]");
  console.log("  openpond apps list [--handle <handle>] [--refresh]");
  console.log("  openpond apps tools");
  console.log("  openpond apps deploy <handle>/<repo> [--env preview|production] [--watch]");
  console.log("  openpond apps env get <handle>/<repo>");
  console.log("  openpond apps env set <handle>/<repo> --env <json>");
  console.log("  openpond apps performance [--app-id <id>]");
  console.log("  openpond apps summary <handle>/<repo>");
  console.log("  openpond apps assistant <plan|performance> <handle>/<repo> --prompt <text>");
  console.log(
    "  openpond apps store events [--source <source>] [--status <csv>] [--symbol <symbol>] [--wallet-address <0x...>] [--since <ms|iso>] [--until <ms|iso>] [--limit <n>] [--cursor <cursor>] [--history <true|false>] [--params <json>]"
  );
  console.log("  openpond apps trade-facts [--app-id <id>]");
  console.log("  openpond apps agent create --prompt <text> [--template-id <id>]");
  console.log(
    "  openpond apps tools execute <appId> <deploymentId> <tool> [--body <json>] [--method <METHOD>] [--headers <json>] [--summary <true|false>]"
  );
  console.log(
    "  openpond apps positions tx [--method <GET|POST>] [--body <json>] [--params <json>]"
  );
  console.log("  openpond opentool <init|validate|build> [args]");
  console.log("");
  console.log("Env:");
  console.log("  OPENPOND_API_KEY, OPENPOND_BASE_URL, OPENPOND_API_URL, OPENPOND_TOOL_URL");
}

async function runLogin(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(config);
  const rawApiKey =
    typeof options.apiKey === "string"
      ? options.apiKey
      : typeof options.key === "string"
        ? options.key
        : null;
  const apiKey = rawApiKey ? rawApiKey.trim() : await promptForApiKey();
  if (!apiKey) {
    throw new Error("API key is required");
  }
  if (!apiKey.startsWith("opk_")) {
    console.log("warning: API keys usually start with opk_.");
  }
  await saveGlobalConfig({ apiKey, baseUrl });
  console.log("saved api key to ~/.openpond/config.json");
}

async function runToolList(options: Record<string, string | boolean>, target: string) {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const latest = await getLatestDeploymentForApp(apiBase, apiKey, app.id, { branch });
  if (!latest?.id) {
    console.log("no deployments found");
    return;
  }
  const detail = await getDeploymentDetail(apiBase, apiKey, latest.id);
  const toolsRaw =
    (detail && Array.isArray(detail.toolsJson) ? detail.toolsJson : null) ||
    (detail && typeof detail.metadataJson === "object" && detail.metadataJson
      ? (detail.metadataJson as { tools?: unknown }).tools
      : null);
  const tools = Array.isArray(toolsRaw) ? toolsRaw : [];
  if (tools.length === 0) {
    console.log("no tools found");
    return;
  }
  for (const tool of tools) {
    const record = tool as Record<string, unknown>;
    const profile = (record.profile || record.function) as Record<string, unknown> | undefined;
    const name =
      (record.name as string | undefined) ||
      (profile?.name as string | undefined) ||
      "unknown";
    const description =
      (record.description as string | undefined) ||
      (profile?.description as string | undefined) ||
      "";
    console.log(description ? `${name} - ${description}` : name);
  }
}

async function runToolRun(
  options: Record<string, string | boolean>,
  target: string,
  toolName: string
) {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const latest = await getLatestDeploymentForApp(apiBase, apiKey, app.id, { branch });
  if (!latest?.id) {
    throw new Error("no deployments found");
  }
  let body: unknown = undefined;
  if (typeof options.body === "string") {
    try {
      body = JSON.parse(options.body);
    } catch {
      throw new Error("tool body must be valid JSON");
    }
  }
  const method =
    typeof options.method === "string" ? String(options.method).toUpperCase() : "POST";
  const result = await executeHostedTool(uiBase, apiKey, {
    appId: app.id,
    deploymentId: latest.id,
    toolName,
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    body,
    headers: apiKey ? { "openpond-api-key": apiKey } : undefined,
  });
  if (!result.ok) {
    throw new Error(result.error || `tool failed (${result.status})`);
  }
  const output = result.data ?? { ok: true };
  console.log(JSON.stringify(output, null, 2));
}

async function runDeployWatch(
  options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app, handle, repo } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const deploymentId =
    typeof options.deploymentId === "string" ? String(options.deploymentId) : undefined;
  const latest =
    deploymentId
      ? { id: deploymentId }
      : await getLatestDeploymentForApp(apiBase, apiKey, app.id, {
          branch,
        });
  if (!latest?.id) {
    console.log("no deployments found");
    return;
  }
  await pollDeploymentLogs({
    baseUrl: apiBase,
    apiKey,
    deploymentId: latest.id,
    prefix: `[${handle}/${repo}] `,
    intervalMs: options.interval ? Number(options.interval) : undefined,
    timeoutMs: options.timeout ? Number(options.timeout) : undefined,
  });
}

async function runRepoCreate(
  options: Record<string, string | boolean>,
  nameParts: string[]
): Promise<void> {
  const name =
    (typeof options.name === "string" ? options.name : null) || nameParts.join(" ");
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error(
      "usage: repo create --name <name> [--path <dir>] [--template <owner/repo|url>] [--template-branch <branch>] [--empty|--opentool] [--token] [--auto-schedule-migration <true|false>]"
    );
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();

  const templateInput = typeof options.template === "string" ? options.template.trim() : "";
  if (templateInput && (options.empty === "true" || options.opentool === "true")) {
    throw new Error("choose one: --template or --empty/--opentool");
  }
  if (options.empty === "true" && options.opentool === "true") {
    throw new Error("choose one: --empty or --opentool");
  }

  const description =
    typeof options.description === "string" ? options.description.trim() : undefined;
  const templateBranch =
    typeof options.templateBranch === "string" && options.templateBranch.trim().length > 0
      ? options.templateBranch.trim()
      : undefined;
  const envVars =
    typeof options.env === "string"
      ? (parseJsonOption(options.env, "env") as Record<string, string>)
      : undefined;
  if (envVars) {
    if (typeof envVars !== "object" || Array.isArray(envVars)) {
      throw new Error("env must be a JSON object");
    }
    for (const [key, value] of Object.entries(envVars)) {
      if (typeof value !== "string") {
        throw new Error(`env value for ${key} must be a string`);
      }
    }
  }

  if (templateInput) {
    if (options.deployOnPush !== undefined) {
      console.warn("deploy-on-push is not used for template create (auto deploys)");
    }
    const templateRepoUrl = normalizeTemplateRepoUrl(templateInput, uiBase);
    const response = await createHeadlessApps(apiBase, apiKey, [
      {
        name: trimmedName,
        ...(description ? { description } : {}),
        templateRepoUrl,
        ...(templateBranch ? { templateBranch } : {}),
        ...(envVars ? { envVars } : {}),
      },
    ]);
    const item = response.items?.[0];
    if (!item || item.status !== "ok" || !item.appId) {
      throw new Error(item?.error || "Template create failed");
    }
    console.log(`app_id: ${item.appId}`);
    if (item.deploymentId) {
      console.log(`deployment_id: ${item.deploymentId}`);
    }
    if (item.conversationId) {
      console.log(`conversation_id: ${item.conversationId}`);
    }
    return;
  }

  const defaultPath = process.cwd();
  const rawPath =
    typeof options.path === "string"
      ? options.path
      : typeof options.dir === "string"
        ? options.dir
        : null;
  const targetPath =
    rawPath && rawPath.trim().length > 0
      ? rawPath.trim()
      : input.isTTY
        ? await promptForPath(defaultPath)
        : defaultPath;
  const repoPath = path.resolve(targetPath);

  if (existsSync(repoPath)) {
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      throw new Error(`path is not a directory: ${repoPath}`);
    }
  } else {
    await fs.mkdir(repoPath, { recursive: true });
  }

  const entries = await fs.readdir(repoPath);
  const nonGitEntries = entries.filter((entry) => entry !== ".git");
  const isEmpty = nonGitEntries.length === 0;
  const force = parseBooleanOption(options.yes) || parseBooleanOption(options.force);
  if (!isEmpty && !force) {
    const proceed = await promptConfirm(
      `Directory is not empty (${repoPath}). Continue?`,
      false
    );
    if (!proceed) {
      console.log("aborted");
      return;
    }
  }

  const gitDir = path.join(repoPath, ".git");
  const hasGit = existsSync(gitDir);
  if (!hasGit) {
    const proceed = force ? true : await promptConfirm("Initialize git repository here?", true);
    if (!proceed) {
      console.log("aborted");
      return;
    }
    const result = await runCommand("git", ["init"], { cwd: repoPath });
    if (result.code !== 0) {
      throw new Error(
        `git init failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`
      );
    }
  }

  const originUrl = await getGitRemoteUrl(repoPath, "origin");
  if (originUrl && !force) {
    const proceed = await promptConfirm(
      `Remote "origin" already set (${originUrl}). Replace it?`,
      false
    );
    if (!proceed) {
      console.log("aborted");
      return;
    }
  }

  const repoInit =
    options.opentool === "true" ? "opentool" : "empty";
  const deployOnPush = parseBooleanOption(options.deployOnPush);
  const autoScheduleMigrationOption = options.autoScheduleMigration;
  const autoScheduleMigrationSpecified =
    typeof autoScheduleMigrationOption === "string" ||
    typeof autoScheduleMigrationOption === "boolean";
  const autoScheduleMigration = autoScheduleMigrationSpecified
    ? parseBooleanOption(autoScheduleMigrationOption)
    : undefined;

  const response = await createRepo(apiBase, apiKey, {
    name: trimmedName,
    ...(description ? { description } : {}),
    ...(repoInit ? { repoInit } : {}),
    ...(envVars ? { envVars } : {}),
    ...(deployOnPush ? { deployOnPush: true } : {}),
    ...(autoScheduleMigrationSpecified ? { autoScheduleMigration } : {}),
  });

  const repoUrl = resolveRepoUrl(response);
  warnOnRepoHostMismatch(repoUrl);
  const useTokenRemote =
    parseBooleanOption(options.token) || parseBooleanOption(options.setRemoteToken);
  const tokenRemote = formatTokenizedRepoUrl(repoUrl, apiKey);
  const remoteUrl = useTokenRemote ? tokenRemote : repoUrl;
  const remoteArgs = originUrl
    ? ["remote", "set-url", "origin", remoteUrl]
    : ["remote", "add", "origin", remoteUrl];
  const remoteResult = await runCommand("git", remoteArgs, { cwd: repoPath });
  if (remoteResult.code !== 0) {
    throw new Error(
      `git remote failed: ${
        redactToken(remoteResult.stderr.trim() || remoteResult.stdout.trim() || "unknown error")
      }`
    );
  }

  const displayRemote = useTokenRemote ? formatTokenizedRepoUrlForPrint(repoUrl) : repoUrl;
  console.log(`app_id: ${response.appId}`);
  if (response.gitOwner && response.gitRepo) {
    console.log(`repo: ${response.gitOwner}/${response.gitRepo}`);
  }
  console.log(`remote: ${displayRemote}`);
  console.log("next: git add . && git commit -m \"init\"");
  const defaultBranch = response.defaultBranch || "master";
  console.log(`next: openpond repo push --path ${repoPath} --branch ${defaultBranch}`);
  if (!useTokenRemote) {
    console.log(
      `token-remote (non-interactive): git -C ${repoPath} remote set-url origin ${formatTokenizedRepoUrlForPrint(
        repoUrl
      )}`
    );
  }

  try {
    await fetchAppsWithCache({ apiBase, apiKey, forceRefresh: true });
  } catch (error) {
    console.warn("cache refresh failed", error);
  }
}

async function resolveGitBranch(repoPath: string): Promise<string | null> {
  const result = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
  });
  if (result.code !== 0) return null;
  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}

async function runRepoPush(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, baseUrl);

  const rawPath =
    typeof options.path === "string"
      ? options.path
      : typeof options.dir === "string"
        ? options.dir
        : null;
  const repoPath = path.resolve(rawPath && rawPath.trim().length > 0 ? rawPath.trim() : ".");
  const gitDir = path.join(repoPath, ".git");
  if (!existsSync(gitDir)) {
    throw new Error(`git repo not found at ${repoPath} (missing .git)`);
  }

  const originUrl = await getGitRemoteUrl(repoPath, "origin");
  if (!originUrl) {
    throw new Error("origin remote not set; run `openpond repo create` first");
  }
  warnOnRepoHostMismatch(originUrl);

  const branchOption = typeof options.branch === "string" ? options.branch.trim() : "";
  const resolvedBranch = branchOption || (await resolveGitBranch(repoPath));
  if (!resolvedBranch) {
    throw new Error("unable to resolve git branch; pass --branch");
  }

  let tokenRemote: string;
  try {
    tokenRemote = formatTokenizedRepoUrl(originUrl, apiKey);
  } catch {
    throw new Error("origin remote must be https for tokenized pushes");
  }
  const keepTokenRemote =
    parseBooleanOption(options.keepTokenRemote) ||
    parseBooleanOption(options.token) ||
    parseBooleanOption(options.setRemoteToken);
  const alreadyTokenized = originUrl.includes("x-access-token:");
  const restoreUrl = !keepTokenRemote && !alreadyTokenized ? originUrl : null;

  const previousPrompt = process.env.GIT_TERMINAL_PROMPT;
  process.env.GIT_TERMINAL_PROMPT = "0";
  try {
    if (!alreadyTokenized) {
      const setResult = await runCommand(
        "git",
        ["remote", "set-url", "origin", tokenRemote],
        { cwd: repoPath }
      );
      if (setResult.code !== 0) {
        throw new Error(
          `git remote set-url failed: ${
            redactToken(setResult.stderr.trim() || setResult.stdout.trim() || "unknown error")
          }`
        );
      }
    }

    const pushResult = await runCommand(
      "git",
      ["push", "-u", "origin", resolvedBranch],
      { cwd: repoPath, inherit: true }
    );
    if (pushResult.code !== 0) {
      throw new Error("git push failed");
    }
  } finally {
    if (restoreUrl) {
      await runCommand("git", ["remote", "set-url", "origin", restoreUrl], {
        cwd: repoPath,
      }).catch(() => null);
    }
    if (previousPrompt === undefined) {
      delete process.env.GIT_TERMINAL_PROMPT;
    } else {
      process.env.GIT_TERMINAL_PROMPT = previousPrompt;
    }
  }
}

async function runOpentool(rawArgs: string[]): Promise<void> {
  if (rawArgs.length === 0) {
    throw new Error("usage: opentool <init|validate|build> [args]");
  }
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = await runCommand(command, ["opentool", ...rawArgs], {
    inherit: true,
  });
  if (result.code !== 0) {
    throw new Error("opentool command failed");
  }
}

async function runAppsTools(): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const tools = await fetchToolsWithCache({ apiBase, apiKey });
  console.log(JSON.stringify(tools, null, 2));
}

async function runAppsList(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const handle = typeof options.handle === "string" ? String(options.handle) : undefined;
  const normalizedHandle = handle ? normalizeRepoName(handle) : null;
  const forceRefresh =
    options.refresh !== undefined ? parseBooleanOption(options.refresh) : undefined;
  const apps = await fetchAppsWithCache({
    apiBase,
    apiKey,
    forceRefresh,
  });
  const filtered = normalizedHandle
    ? apps.filter((app) => {
        const candidate = normalizeRepoName(app.handle || app.gitOwner);
        return candidate === normalizedHandle;
      })
    : apps;
  if (filtered.length === 0) {
    console.log("no apps found");
    return;
  }
  for (const app of filtered) {
    const owner = app.handle || app.gitOwner || "unknown";
    const repo = app.repo || app.gitRepo || app.name || app.id;
    const status = app.latestDeployment?.status || "no-deploy";
    const branch = app.latestDeployment?.gitBranch || app.defaultBranch || "-";
    console.log(`${owner}/${repo}  ${status}  ${branch}  ${app.id}`);
  }
}

async function runAppsPerformance(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const appId = typeof options.appId === "string" ? String(options.appId) : undefined;
  const performance = await getUserPerformance(apiBase, apiKey, { appId });
  console.log(JSON.stringify(performance, null, 2));
}

async function runAppsSummary(
  _options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const summary = await getAppRuntimeSummary(apiBase, apiKey, app.id);
  console.log(JSON.stringify(summary, null, 2));
}

async function runAppsAssistant(
  options: Record<string, string | boolean>,
  mode: "plan" | "performance",
  target: string,
  contentParts: string[]
): Promise<void> {
  const prompt =
    (typeof options.prompt === "string" ? options.prompt : null) ||
    contentParts.join(" ");
  if (!prompt.trim()) {
    throw new Error("usage: apps assistant <plan|performance> <handle>/<repo> --prompt <text>");
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await runAssistantMode(apiBase, apiKey, {
    appId: app.id,
    mode,
    prompt: prompt.trim(),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsAgentCreate(
  options: Record<string, string | boolean>,
  contentParts: string[]
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const prompt =
    (typeof options.prompt === "string" ? options.prompt : null) ||
    contentParts.join(" ");
  if (!prompt.trim()) {
    throw new Error("usage: apps agent create --prompt <text>");
  }

  const templateId = typeof options.templateId === "string" ? options.templateId : undefined;
  const templateRepoUrl =
    typeof options.templateRepoUrl === "string" ? options.templateRepoUrl : undefined;
  const templateBranch =
    typeof options.templateBranch === "string" ? options.templateBranch : undefined;
  const templateLocalPath =
    typeof options.templateLocalPath === "string" ? options.templateLocalPath : undefined;
  if (templateLocalPath && String(templateLocalPath).trim().length > 0) {
    throw new Error("templateLocalPath is not supported; use templateId or templateRepoUrl");
  }
  const envVars =
    typeof options.env === "string"
      ? (parseJsonOption(options.env, "env") as Record<string, string>)
      : undefined;
  if (envVars) {
    if (typeof envVars !== "object" || Array.isArray(envVars)) {
      throw new Error("env must be a JSON object");
    }
    for (const [key, value] of Object.entries(envVars)) {
      if (typeof value !== "string") {
        throw new Error(`env value for ${key} must be a string`);
      }
    }
  }

  const template =
    templateId || templateRepoUrl || templateBranch || envVars
      ? {
          templateId,
          templateRepoUrl,
          templateBranch,
          envVars,
        }
      : undefined;

  const deployEnvironment =
    typeof options.deployEnvironment === "string"
      ? options.deployEnvironment === "preview"
        ? "preview"
        : "production"
      : undefined;
  const deployDisabled =
    options.deployDisabled !== undefined ? parseBooleanOption(options.deployDisabled) : undefined;
  const streamDeployLogs =
    options.streamDeployLogs !== undefined ? parseBooleanOption(options.streamDeployLogs) : true;

  const response = await createAgentFromPrompt(apiBase, apiKey, {
    prompt: prompt.trim(),
    ...(template ? { template } : {}),
    ...(deployEnvironment ? { deployEnvironment } : {}),
    ...(deployDisabled !== undefined ? { deployDisabled } : {}),
    streamDeployLogs,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`agent create failed: ${response.status} ${text}`);
  }

  let conversationId: string | null = null;
  let appId: string | null = null;
  let deploymentId: string | null = null;

  await consumeStream(response, {
    onConversationId: (id) => {
      conversationId = id;
    },
    onItems: (items) => {
      for (const item of items) {
        const line = formatStreamItem(item);
        if (line) {
          console.log(line);
        }
        const typed = item as Record<string, unknown>;
        if (!appId && typeof typed.appId === "string") {
          appId = typed.appId;
        }
        if (!deploymentId && typeof typed.deploymentId === "string") {
          deploymentId = typed.deploymentId;
        }
      }
    },
  });

  if (conversationId) {
    console.log(`conversation_id: ${conversationId}`);
  }
  if (appId) {
    console.log(`app_id: ${appId}`);
  }
  if (deploymentId) {
    console.log(`deployment_id: ${deploymentId}`);
  }

  try {
    await fetchAppsWithCache({ apiBase, apiKey, forceRefresh: true });
    await fetchToolsWithCache({ apiBase, apiKey, forceRefresh: true });
  } catch (error) {
    console.warn("cache refresh failed", error);
  }
}

async function runAppsToolsExecute(
  options: Record<string, string | boolean>,
  appId: string,
  deploymentId: string,
  toolName: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const methodRaw =
    typeof options.method === "string" ? String(options.method).toUpperCase() : undefined;
  const method =
    methodRaw && ["GET", "POST", "PUT", "DELETE"].includes(methodRaw)
      ? (methodRaw as "GET" | "POST" | "PUT" | "DELETE")
      : undefined;
  if (methodRaw && !method) {
    throw new Error("method must be GET, POST, PUT, or DELETE");
  }
  const body =
    typeof options.body === "string"
      ? parseJsonOption(String(options.body), "body")
      : undefined;
  const headers =
    typeof options.headers === "string"
      ? (parseJsonOption(String(options.headers), "headers") as Record<string, string>)
      : undefined;
  const scheduleId =
    typeof options.scheduleId === "string" ? String(options.scheduleId) : undefined;
  const notifyEmail = parseBooleanOption(options.notifyEmail);
  const withSummary =
    parseBooleanOption(options.summary) || parseBooleanOption(options.withSummary);
  const result = await executeUserTool(apiBase, apiKey, {
    appId,
    deploymentId,
    toolName,
    scheduleId,
    method,
    body,
    headers,
    notifyEmail: notifyEmail || undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (withSummary && result.ok) {
    const summary = await getAppRuntimeSummary(apiBase, apiKey, appId);
    console.log(JSON.stringify({ summary }, null, 2));
  }
}

async function runAppsEnvSet(
  options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const rawEnv =
    typeof options.env === "string"
      ? options.env
      : typeof options.vars === "string"
        ? options.vars
        : typeof options.envVars === "string"
          ? options.envVars
          : null;
  if (!rawEnv) {
    throw new Error("usage: apps env set <handle>/<repo> --env <json>");
  }
  const parsed = parseJsonOption(rawEnv, "env");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("env must be a JSON object");
  }
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error(`env value for ${key} must be a string`);
    }
    if (!key.startsWith("OPENTOOL_PUBLIC_")) {
      throw new Error("only OPENTOOL_PUBLIC_ env vars can be set");
    }
    envVars[key] = value;
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await updateAppEnvironment(apiBase, apiKey, app.id, { envVars });
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsEnvGet(
  _options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await getAppEnvironment(apiBase, apiKey, app.id);
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsDeploy(
  options: Record<string, string | boolean>,
  target: string
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl();
  const apiKey = await ensureApiKey(config, uiBase);
  const { app, handle, repo } = await resolveAppTarget(apiBase, apiKey, target);
  const envRaw =
    typeof options.env === "string"
      ? options.env
      : typeof options.environment === "string"
        ? options.environment
        : undefined;
  const environment = resolveTemplateEnvironment(envRaw);
  const result = await deployApp(apiBase, apiKey, app.id, { environment });
  console.log(JSON.stringify(result, null, 2));

  const shouldWatch =
    parseBooleanOption(options.watch) ||
    parseBooleanOption(options.wait) ||
    parseBooleanOption(options.follow);
  if (!shouldWatch) return;

  await pollDeploymentLogs({
    baseUrl: apiBase,
    apiKey,
    deploymentId: result.deploymentId,
    prefix: `[${handle}/${repo}] `,
    intervalMs: options.interval ? Number(options.interval) : undefined,
    timeoutMs: options.timeout ? Number(options.timeout) : undefined,
  });
}

async function runAppsPositionsTx(
  options: Record<string, string | boolean>
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const methodRaw =
    typeof options.method === "string" ? String(options.method).toUpperCase() : "POST";
  const method = methodRaw === "GET" ? "GET" : "POST";
  if (methodRaw !== "GET" && methodRaw !== "POST") {
    throw new Error("method must be GET or POST");
  }
  let query: Record<string, string> | undefined;
  if (method === "GET" && typeof options.params === "string") {
    const parsed = parseJsonOption(String(options.params), "params");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("params must be a JSON object");
    }
    query = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === undefined) continue;
      query[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  const body =
    method === "POST" && typeof options.body === "string"
      ? parseJsonOption(String(options.body), "body")
      : undefined;
  const result = await submitPositionsTx(apiBase, apiKey, {
    method,
    body,
    query,
  });
  console.log(JSON.stringify(result, null, 2));
}

function resolveStoreEventsParams(
  options: Record<string, string | boolean>
): Record<string, string> | undefined {
  let params: Record<string, string> = {};
  if (typeof options.params === "string") {
    const parsed = parseJsonOption(String(options.params), "params");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("params must be a JSON object");
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === undefined) continue;
      params[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }

  const addParam = (key: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    params[key] = value;
  };

  addParam("source", typeof options.source === "string" ? options.source.trim() : undefined);
  addParam(
    "walletAddress",
    typeof options.walletAddress === "string" ? options.walletAddress.trim() : undefined
  );
  addParam("symbol", typeof options.symbol === "string" ? options.symbol.trim() : undefined);
  addParam("cursor", typeof options.cursor === "string" ? options.cursor.trim() : undefined);
  addParam("status", typeof options.status === "string" ? options.status.trim() : undefined);
  addParam("since", parseTimeOption(options.since, "since"));
  addParam("until", parseTimeOption(options.until, "until"));

  if (typeof options.limit === "string" && options.limit.trim().length > 0) {
    const parsed = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("limit must be a number");
    }
    addParam("limit", String(parsed));
  }

  if (options.history !== undefined) {
    addParam("history", parseBooleanOption(options.history) ? "true" : "false");
  }

  return Object.keys(params).length ? params : undefined;
}

async function runAppsStoreEvents(
  options: Record<string, string | boolean>
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const query = resolveStoreEventsParams(options);
  const result = await submitPositionsTx(apiBase, apiKey, {
    method: "GET",
    query,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsTradeFacts(
  options: Record<string, string | boolean>
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl();
  const appId = typeof options.appId === "string" ? options.appId : undefined;
  const performance = await getUserPerformance(apiBase, apiKey, { appId });
  if (
    performance &&
    typeof performance === "object" &&
    "trades" in performance &&
    Array.isArray((performance as { trades?: unknown }).trades)
  ) {
    console.log(JSON.stringify((performance as { trades: unknown }).trades, null, 2));
    return;
  }
  console.log(JSON.stringify(performance, null, 2));
}

async function main() {
  const { command, options, rest } = parseArgs(process.argv.slice(2));

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "login") {
    await runLogin(options);
    return;
  }

  if (command === "tool") {
    const subcommand = rest[0];
    if (subcommand === "list") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: tool list <handle>/<repo>");
      }
      await runToolList(options, target);
      return;
    }
    if (subcommand === "run") {
      const target = rest[1];
      const toolName = rest[2];
      if (!target || !toolName) {
        throw new Error("usage: tool run <handle>/<repo> <tool> [--body <json>]");
      }
      await runToolRun(options, target, toolName);
      return;
    }
    throw new Error("usage: tool <list|run> <handle>/<repo> [args]");
  }

  if (command === "deploy") {
    const subcommand = rest[0] || "watch";
    if (subcommand !== "watch") {
      throw new Error("usage: deploy watch <handle>/<repo> [--branch <branch>]");
    }
    const target = rest[1];
    if (!target) {
      throw new Error("usage: deploy watch <handle>/<repo> [--branch <branch>]");
    }
    await runDeployWatch(options, target);
    return;
  }

  if (command === "template") {
    const subcommand = rest[0] || "status";
    const target = rest[1];
    if (!target) {
      throw new Error(
        "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]"
      );
    }
    if (subcommand === "status") {
      await runTemplateStatus(options, target);
      return;
    }
    if (subcommand === "branches") {
      await runTemplateBranches(options, target);
      return;
    }
    if (subcommand === "update") {
      await runTemplateUpdate(options, target);
      return;
    }
    throw new Error(
      "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]"
    );
  }

  if (command === "repo") {
    const subcommand = rest[0] || "create";
    if (subcommand === "create") {
      await runRepoCreate(options, rest.slice(1));
      return;
    }
    if (subcommand === "push") {
      await runRepoPush(options);
      return;
    }
    throw new Error(
      "usage: repo <create|push> [--name <name>] [--path <dir>] [--branch <branch>]"
    );
  }

  if (command === "apps") {
    const subcommand = rest[0];
    if (subcommand === "list") {
      await runAppsList(options);
      return;
    }
    if (subcommand === "tools") {
      if (rest[1] === "execute") {
        const appId = rest[2];
        const deploymentId = rest[3];
        const toolName = rest[4];
        if (!appId || !deploymentId || !toolName) {
          throw new Error(
            "usage: apps tools execute <appId> <deploymentId> <tool> [--body <json>]"
          );
        }
        await runAppsToolsExecute(options, appId, deploymentId, toolName);
        return;
      }
      await runAppsTools();
      return;
    }
    if (subcommand === "deploy") {
      const target = rest[1];
      if (!target) {
        throw new Error(
          "usage: apps deploy <handle>/<repo> [--env preview|production] [--watch]"
        );
      }
      await runAppsDeploy(options, target);
      return;
    }
    if (subcommand === "env" && rest[1] === "get") {
      const target = rest[2];
      if (!target) {
        throw new Error("usage: apps env get <handle>/<repo>");
      }
      await runAppsEnvGet(options, target);
      return;
    }
    if (subcommand === "env" && rest[1] === "set") {
      const target = rest[2];
      if (!target) {
        throw new Error("usage: apps env set <handle>/<repo> --env <json>");
      }
      await runAppsEnvSet(options, target);
      return;
    }
    if (subcommand === "performance") {
      await runAppsPerformance(options);
      return;
    }
    if (subcommand === "summary") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: apps summary <handle>/<repo>");
      }
      await runAppsSummary(options, target);
      return;
    }
    if (subcommand === "assistant") {
      const mode = rest[1];
      const target = rest[2];
      if ((mode !== "plan" && mode !== "performance") || !target) {
        throw new Error(
          "usage: apps assistant <plan|performance> <handle>/<repo> --prompt <text>"
        );
      }
      await runAppsAssistant(options, mode, target, rest.slice(3));
      return;
    }
    if (subcommand === "store" && rest[1] === "events") {
      await runAppsStoreEvents(options);
      return;
    }
    if (subcommand === "trade-facts") {
      await runAppsTradeFacts(options);
      return;
    }
    if (subcommand === "agent" && rest[1] === "create") {
      await runAppsAgentCreate(options, rest.slice(2));
      return;
    }
    if (subcommand === "positions" && rest[1] === "tx") {
      await runAppsPositionsTx(options);
      return;
    }
    throw new Error(
      "usage: apps <list|tools|deploy|env get|env set|performance|summary|assistant|store events|trade-facts|agent create|positions tx> [args]"
    );
  }

  if (command === "opentool") {
    await runOpentool(process.argv.slice(3));
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
