#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  checkOpenPondApiHealth,
  getAppRuntimeSummary,
  executeHostedTool,
  getDeploymentDetail,
  getDeploymentLogs,
  getDeploymentStatus,
  getLatestDeploymentForApp,
  getOpenPondAccount,
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
  updateAppCodeVisibility,
  executeUserTool,
  runAssistantMode,
  submitPositionsTx,
  submitBacktestDetail,
  submitBacktestRun,
  submitBacktestTx,
  type AppListItem,
} from "./api";
import {
  DEFAULT_CACHE_TTL_MS,
  getCachedApps,
  getCachedTools,
  setCachedApps,
  setCachedTools,
} from "./cache";
import {
  listConfiguredProfiles,
  loadConfig,
  saveGlobalConfig,
  saveProfileApiKey,
  setActiveProfile,
  type LocalConfig,
} from "./config";
import { consumeStream, formatStreamItem } from "./stream";
import { DEFAULT_OPENPOND_API_BASE_URL, DEFAULT_OPENPOND_WEB_BASE_URL } from "./urls";
import {
  createOpenPondSandboxClient,
  type OpenPondSandboxClient,
  type OpenPondOrganization,
  type OpenPondOrganizationCreateInput,
  type OpenPondOrganizationMcpGenerateInput,
  type OpenPondOrganizationMcpServer,
  type OpenPondOrganizationMember,
  type OpenPondOrganizationMemberUpsertInput,
  type OpenPondOrganizationRole,
  type OpenPondOrganizationUpdateInput,
  type SandboxCreateInput,
  type SandboxEnvVarInput,
  type SandboxIntegrationConnectionLeaseInput,
  type SandboxRecord,
  type SandboxReplayArtifact,
  type SandboxReplayInput,
  type SandboxReplayRecord,
  type SandboxScheduleCreateInput,
  type SandboxSecretMetadata,
  type SandboxSnapshotValidateInput,
  type SandboxSmokeOptions,
  type SandboxTemplateBuildCreateInput,
  type SandboxTemplateBuildRecord,
} from "./sandbox";
import {
  OPENPOND_MANIFEST_FILE_NAME,
  SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME,
  SANDBOX_TEMPLATE_BUILD_PLAN_KIND,
  formatSandboxTemplateDiagnostics,
  sandboxTemplateBuildPlan,
  sandboxTemplateBuildMetadata,
  sandboxTemplateExecutableEntries,
  sandboxTemplateJsonSchema,
  sandboxTemplateScaffoldFiles,
  validateSandboxTemplateYaml,
  type SandboxTemplateBuildPlan,
  type SandboxTemplateExecutable,
  type SandboxTemplateManifest,
  type SandboxTemplatePort,
} from "./sandbox-template";

const DEFAULT_OPENPOND_API_HOST = new URL(DEFAULT_OPENPOND_API_BASE_URL).hostname;
const DEFAULT_OPENPOND_WEB_HOST = new URL(DEFAULT_OPENPOND_WEB_BASE_URL).hostname;

type Command =
  | "login"
  | "profiles"
  | "account"
  | "health"
  | "tool"
  | "deploy"
  | "backtest"
  | "apps"
  | "repo"
  | "sandbox"
  | "sandbox-template"
  | "organization"
  | "organizations"
  | "template"
  | "opentool"
  | "check-update"
  | "version"
  | "help";

function getInstalledCliVersion(): string {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const raw = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function parseSemver(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return [major, minor, patch];
}

function compareSemver(left: string, right: string): number | null {
  const l = parseSemver(left);
  const r = parseSemver(right);
  if (!l || !r) return null;
  for (let i = 0; i < 3; i += 1) {
    if (l[i]! < r[i]!) return -1;
    if (l[i]! > r[i]!) return 1;
  }
  return 0;
}

async function fetchLatestNpmVersion(packageName: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`npm registry request failed: ${response.status} ${text}`.trim());
    }
    const payload = (await response.json().catch(() => ({}))) as {
      version?: unknown;
    };
    if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
      throw new Error("npm registry payload missing version");
    }
    return payload.version.trim();
  } finally {
    clearTimeout(timer);
  }
}

type RepoTarget = { handle: string; repo: string };

function parseArgs(argv: string[]) {
  const args = [...argv];
  let command = "" as Command;
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
      if (!command) {
        command = next as Command;
      } else {
        rest.push(next);
      }
    }
  }

  return { command, options, rest };
}

function resolveAccountOption(options: Record<string, string | boolean>): string | null {
  const raw =
    typeof options.account === "string"
      ? options.account
      : typeof options.profile === "string"
        ? options.profile
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "true") {
    throw new Error("account must be a non-empty value");
  }
  return trimmed;
}

function resolveBaseUrlOption(options: Record<string, string | boolean>): string | null {
  const raw =
    typeof options.baseUrl === "string"
      ? options.baseUrl
      : typeof options.baseurl === "string"
        ? options.baseurl
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "true") {
    throw new Error("baseurl must be a non-empty value");
  }
  return trimmed.replace(/\/$/, "");
}

function resolveApiBaseUrlOption(options: Record<string, string | boolean>): string | null {
  const raw =
    typeof options.apiBaseUrl === "string"
      ? options.apiBaseUrl
      : typeof options.apiBaseurl === "string"
        ? options.apiBaseurl
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "true") {
    throw new Error("api-base-url must be a non-empty value");
  }
  return trimmed.replace(/\/$/, "");
}

function resolveChatApiBaseUrlOption(options: Record<string, string | boolean>): string | null {
  const raw =
    typeof options.chatApiBaseUrl === "string"
      ? options.chatApiBaseUrl
      : typeof options.chatApiBaseurl === "string"
        ? options.chatApiBaseurl
        : typeof options.chatApiUrl === "string"
          ? options.chatApiUrl
          : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "true") {
    throw new Error("chat-api-base-url must be a non-empty value");
  }
  return trimmed.replace(/\/$/, "");
}

function resolveSandboxApiUrlOption(options: Record<string, string | boolean>): string | null {
  const raw =
    typeof options.sandboxApiUrl === "string"
      ? options.sandboxApiUrl
      : typeof options.sandboxApiurl === "string"
        ? options.sandboxApiurl
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "true") {
    throw new Error("sandbox-api-url must be a non-empty value");
  }
  return trimmed.replace(/\/$/, "");
}

function resolveSandboxBaseUrl(
  config: LocalConfig,
  options: Record<string, string | boolean>,
): string {
  const envName =
    typeof options.env === "string"
      ? options.env.trim().toLowerCase()
      : typeof options.environment === "string"
        ? options.environment.trim().toLowerCase()
        : "";
  if (envName === "staging") {
    return "https://api.staging-api.openpond.ai";
  }
  if (envName && envName !== "production") {
    throw new Error("sandbox env must be staging or production");
  }
  const base =
    process.env.OPENPOND_SANDBOX_BASE_URL ||
    process.env.OPENPOND_API_URL ||
    config.apiBaseUrl ||
    mapUiBaseToApiBase(process.env.OPENPOND_BASE_URL || config.baseUrl) ||
    DEFAULT_OPENPOND_API_BASE_URL;
  return base.replace(/\/$/, "");
}

function resolveBaseUrl(config: LocalConfig): string {
  const envBase = process.env.OPENPOND_BASE_URL;
  const base = envBase || config.baseUrl || DEFAULT_OPENPOND_WEB_BASE_URL;
  return base.replace(/\/$/, "");
}

function mapUiBaseToApiBase(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  const trimmed = baseUrl.replace(/\/$/, "");
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (
      host === DEFAULT_OPENPOND_WEB_HOST ||
      host === "openpond.live" ||
      host === "www.openpond.live"
    ) {
      return DEFAULT_OPENPOND_API_BASE_URL;
    }
    if (host === DEFAULT_OPENPOND_API_HOST || host.startsWith("api.")) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

function resolvePublicApiBaseUrl(config?: LocalConfig): string {
  const envBase = process.env.OPENPOND_API_URL;
  const configuredApiBase = config?.apiBaseUrl?.trim();
  const mapped = mapUiBaseToApiBase(process.env.OPENPOND_BASE_URL || config?.baseUrl);
  const base = envBase || configuredApiBase || mapped || DEFAULT_OPENPOND_API_BASE_URL;
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
  const [owner, repoRaw] = trimmed.includes("/") ? trimmed.split("/", 2) : ["openpondai", trimmed];
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

function parseNumberOption(value: string | boolean | undefined, label: string): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function parseIntegerOption(
  value: string | boolean | undefined,
  label: string,
): number | undefined {
  const parsed = parseNumberOption(value, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function parseCsvOption(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSandboxEnvOptions(
  options: Record<string, string | boolean>,
): SandboxEnvVarInput[] {
  const refs = parseSandboxEnvAssignments(options.envRef, "env-ref").map(
    ({ name, value }) => ({ name, secretRef: value }),
  );
  const literals = parseSandboxEnvAssignments(
    options.envLiteral,
    "env-literal",
  ).map(({ name, value }) => {
    if (
      isSecretLikeEnvName(name) &&
      !parseBooleanOption(options.allowPlainSecretEnv)
    ) {
      throw new Error(
        `refusing plaintext value for secret-like env ${name}; create a sandbox secret and pass --env-ref ${name}=openpond://secret/...`,
      );
    }
    return { name, value };
  });
  const env = [...refs, ...literals];
  const names = new Set<string>();
  for (const item of env) {
    if (names.has(item.name)) {
      throw new Error(`duplicate sandbox env var: ${item.name}`);
    }
    names.add(item.name);
  }
  return env;
}

function parseSandboxTemplateEnvOptions(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): SandboxEnvVarInput[] {
  const env = parseSandboxEnvOptions(options);
  const provided = new Set(env.map((item) => item.name));
  const providedByName = new Map(env.map((item) => [item.name, item]));
  for (const requirement of manifest.inputs.env) {
    const value = providedByName.get(requirement.name);
    if (value?.value !== undefined && requirement.secret !== false) {
      throw new Error(
        `sandbox template env ${requirement.name} requires a secret ref. Pass --env-ref ${requirement.name}=openpond://secret/...`,
      );
    }
  }
  const missing = manifest.inputs.env
    .filter((item) => item.required && !provided.has(item.name))
    .map((item) => item.name);
  if (missing.length > 0) {
    throw new Error(
      `missing required sandbox template env refs: ${missing.join(", ")}. Pass --env-ref NAME=openpond://secret/...`,
    );
  }
  return env;
}

function parseSandboxEnvAssignments(
  value: string | boolean | undefined,
  label: string,
): Array<{ name: string; value: string }> {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator <= 0) {
        throw new Error(`${label} entries must use NAME=value`);
      }
      const name = item.slice(0, separator).trim();
      const entryValue = item.slice(separator + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`${label} has invalid env name: ${name}`);
      }
      if (!entryValue) {
        throw new Error(`${label} value is required for ${name}`);
      }
      return { name, value: entryValue };
    });
}

function isSecretLikeEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|DATABASE_URL|DSN)/i.test(
    name,
  );
}

async function readSandboxSecretValue(
  options: Record<string, string | boolean>,
  label: string,
): Promise<string> {
  if (typeof options.value === "string" || typeof options.secretValue === "string") {
    throw new Error("sandbox secret values must be provided with --stdin or the masked prompt");
  }
  const useStdin = parseBooleanOption(options.stdin);
  if (useStdin) {
    const value = await readAllStdin();
    if (!value) throw new Error(`${label} read no secret value from stdin`);
    return value;
  }
  if (!process.stdin.isTTY) {
    throw new Error(`${label} requires --stdin when not running in a TTY`);
  }
  const value = await readMaskedLine(`${label}: `);
  if (!value) throw new Error(`${label} cannot be empty`);
  return value;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function readMaskedLine(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;
    let value = "";
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.off("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      stdin.pause();
      stderr.write("\n");
    }

    function onData(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of buffer) {
        if (byte === 3) {
          cleanup();
          reject(new Error("secret prompt cancelled"));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 127 || byte === 8) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stderr.write("\b \b");
          }
          continue;
        }
        value += Buffer.from([byte]).toString("utf8");
        stderr.write("*");
      }
    }

    stderr.write(prompt);
    stdin.resume();
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

function summarizeSandboxSecret(secret: SandboxSecretMetadata): Record<string, unknown> {
  return {
    id: secret.id,
    teamId: secret.teamId,
    name: secret.name,
    scope: secret.scope,
    status: secret.status,
    secretRef: secret.secretRef,
    currentVersion: secret.currentVersion,
    updatedAt: secret.updatedAt,
    lastUsedAt: secret.lastUsedAt,
    attachedDestinations: secret.attachments?.length ?? 0,
  };
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

const UI_API_KEY_URL = `${DEFAULT_OPENPOND_WEB_BASE_URL}/settings/api-keys`;

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
  await saveGlobalConfig({
    apiKey,
    baseUrl,
    activeProfile: config.activeProfile,
  });
  console.log("saved api key to ~/.openpond/config.json");
  return apiKey;
}

async function promptConfirm(question: string, defaultValue = false): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
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
  options: { cwd?: string; inherit?: boolean } = {},
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

async function runShellCommand(
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutSeconds?: number;
    inherit?: boolean;
  } = {},
): Promise<CommandResult & { timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: true,
      stdio: options.inherit ? "inherit" : "pipe",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutSeconds && options.timeoutSeconds > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, options.timeoutSeconds * 1000);
    }
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
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function getGitRemoteUrl(cwd: string, remoteName: string): Promise<string | null> {
  const result = await runCommand("git", ["remote", "get-url", remoteName], {
    cwd,
  });
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
        `warning: repo host (${repoHost}) does not match OPENPOND_BASE_URL (${baseHost})`,
      );
      console.warn("warning: verify your git host configuration matches OPENPOND_BASE_URL.");
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
  target: string,
): Promise<{ app: AppListItem; handle: string; repo: string }> {
  const { handle, repo } = parseHandleRepo(target);
  const apps = await fetchAppsWithCache({ apiBase, apiKey });
  const normalizedRepo = normalizeRepoName(repo);
  const match = apps.find((app) => {
    if (app.handle && app.handle !== handle) {
      return false;
    }
    const candidates = [app.repo, app.gitRepo, app.id].map(normalizeRepoName);
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
    const logs = await getDeploymentLogs(params.baseUrl, params.apiKey, params.deploymentId);
    const newLogs = logs.filter((log) => !seen.has(log.id));
    for (const log of newLogs) {
      seen.add(log.id);
    }
    for (const log of newLogs) {
      console.log(`${params.prefix}${log.message}`);
    }

    const status = await getDeploymentStatus(params.baseUrl, params.apiKey, params.deploymentId);
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
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const status = await getTemplateStatus(apiBase, apiKey, app.id);
  console.log(JSON.stringify(status, null, 2));
}

async function runTemplateBranches(
  _options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branches = await listTemplateBranches(apiBase, apiKey, app.id);
  console.log(JSON.stringify(branches, null, 2));
}

async function runTemplateUpdate(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
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

async function runSandboxTemplateCommand(
  options: Record<string, string | boolean>,
  rest: string[],
): Promise<void> {
  const subcommand = rest[0] || "validate";

  if (subcommand === "validate") {
    const filePath = resolveSandboxTemplateFilePath(options);
    const source = await fs.readFile(filePath, "utf8");
    const result = validateSandboxTemplateYaml(source);
    if (!result.ok) {
      console.error(formatSandboxTemplateDiagnostics(result.diagnostics));
      process.exitCode = 1;
      return;
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: filePath,
          name: result.manifest.name,
          version: result.manifest.version,
          start: result.manifest.start.command,
          actions: result.manifest.actions.map((action) => action.name),
          services: result.manifest.services.map((service) => service.name),
          schedules: result.manifest.schedules.map((schedule) => schedule.name),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "print-schema") {
    console.log(JSON.stringify(sandboxTemplateJsonSchema(), null, 2));
    return;
  }

  if (subcommand === "scaffold") {
    const outputPath = resolveSandboxTemplateScaffoldPath(options);
    const rawName =
      typeof options.name === "string" && options.name.trim().length > 0
        ? options.name.trim()
        : path.basename(outputPath);
    const description =
      typeof options.description === "string" && options.description.trim().length > 0
        ? options.description.trim()
        : undefined;
    const files = sandboxTemplateScaffoldFiles({ name: rawName, description });
    const manifestPath = path.join(outputPath, OPENPOND_MANIFEST_FILE_NAME);
    if (existsSync(manifestPath)) {
      throw new Error(`${OPENPOND_MANIFEST_FILE_NAME} already exists at ${manifestPath}`);
    }
    await fs.mkdir(outputPath, { recursive: true });
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(outputPath, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents, "utf8");
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: outputPath,
          files: Object.keys(files).sort((left, right) => left.localeCompare(right)),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "build") {
    await runSandboxTemplateBuild(options);
    return;
  }

  if (subcommand === "run") {
    await runSandboxTemplateLocal(options, "run");
    return;
  }

  if (subcommand === "dev") {
    await runSandboxTemplateLocal(options, "dev");
    return;
  }

  if (subcommand === "action") {
    await runSandboxTemplateExistingSandboxAction(options, rest.slice(1));
    return;
  }

  if (subcommand === "start") {
    await runSandboxTemplateStart(options);
    return;
  }

  throw new Error(
    `usage: sandbox-template <validate|print-schema|scaffold|build|run|dev|start|action> [--file ${OPENPOND_MANIFEST_FILE_NAME}] [--path <dir>] [--name <name>]`,
  );
}

async function runSandboxTemplateBuild(
  options: Record<string, string | boolean>,
): Promise<void> {
  const context = await loadSandboxTemplateManifestContext(options);
  const outputPath = resolveSandboxTemplateBuildOutputPath(options, context.projectPath);
  const plan = sandboxTemplateBuildPlan({
    manifest: context.manifest,
    manifestFile: path.relative(context.projectPath, context.filePath) || OPENPOND_MANIFEST_FILE_NAME,
    projectRoot: path.relative(path.dirname(outputPath), context.projectPath) || ".",
  });
  const shouldWrite = !parseBooleanOption(options.noWrite);
  if (shouldWrite) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  const metadata = sandboxTemplateBuildMetadata(context.manifest);
  const executables = sandboxTemplateExecutableEntries(context.manifest);
  console.log(
    JSON.stringify(
      {
        ok: true,
        file: context.filePath,
        output: shouldWrite ? outputPath : null,
        ...metadata,
        startCommand: executables[0]?.command ?? null,
        plan,
      },
      null,
      2,
    ),
  );
}

async function loadSandboxTemplateManifestContext(
  options: Record<string, string | boolean>,
): Promise<{
  filePath: string;
  projectPath: string;
  manifest: SandboxTemplateManifest;
}> {
  const filePath = resolveSandboxTemplateFilePath(options);
  const source = await fs.readFile(filePath, "utf8");
  const result = validateSandboxTemplateYaml(source);
  if (!result.ok) {
    process.exitCode = 1;
    throw new Error(formatSandboxTemplateDiagnostics(result.diagnostics));
  }
  return {
    filePath,
    projectPath: path.dirname(filePath),
    manifest: result.manifest,
  };
}

function resolveSandboxTemplateBuildOutputPath(
  options: Record<string, string | boolean>,
  projectPath: string,
): string {
  const rawOutput =
    typeof options.output === "string" && options.output.trim()
      ? options.output.trim()
      : typeof options.out === "string" && options.out.trim()
        ? options.out.trim()
        : "";
  if (rawOutput) return path.resolve(process.cwd(), rawOutput);
  const rawOutputDir =
    typeof options.outputDir === "string" && options.outputDir.trim()
      ? options.outputDir.trim()
      : typeof options.outDir === "string" && options.outDir.trim()
        ? options.outDir.trim()
        : "dist";
  return path.resolve(projectPath, rawOutputDir, SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME);
}

async function loadSandboxTemplateBuildPlan(
  options: Record<string, string | boolean>,
): Promise<{
  plan: SandboxTemplateBuildPlan;
  filePath: string;
  projectPath: string;
}> {
  const rawBuild =
    typeof options.build === "string" && options.build.trim()
      ? options.build.trim()
      : typeof options.plan === "string" && options.plan.trim()
        ? options.plan.trim()
        : "";
  if (rawBuild) {
    const filePath = path.resolve(process.cwd(), rawBuild);
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as SandboxTemplateBuildPlan;
    if (parsed.kind !== SANDBOX_TEMPLATE_BUILD_PLAN_KIND || parsed.schemaVersion !== 1) {
      throw new Error(`invalid sandbox template build plan: ${filePath}`);
    }
    return {
      plan: parsed,
      filePath,
      projectPath: path.resolve(path.dirname(filePath), parsed.projectRoot),
    };
  }

  const context = await loadSandboxTemplateManifestContext(options);
  return {
    plan: sandboxTemplateBuildPlan({
      manifest: context.manifest,
      manifestFile: path.relative(context.projectPath, context.filePath) || OPENPOND_MANIFEST_FILE_NAME,
      projectRoot: context.projectPath,
    }),
    filePath: context.filePath,
    projectPath: context.projectPath,
  };
}

type SandboxTemplateScalarInputs = Record<string, unknown>;

type SandboxTemplateUploadSpec = {
  inputName: string;
  multiple: boolean;
  targetPath: string;
};

type SandboxTemplateUploadRequest = {
  inputName: string;
  localPaths: string[];
  spec: SandboxTemplateUploadSpec;
};

type SandboxTemplateUploadedFile = {
  inputName: string;
  localPath: string;
  sandboxPath: string;
  sizeBytes: number;
};

type LocalSandboxTemplateVolume = {
  name: string | null;
  mountPath: string;
  localPath: string;
};

type LocalSandboxTemplateCommandResult = {
  command: string;
  cwd: string;
  status: "succeeded" | "failed" | "timed_out";
  output: string;
  exitCode: number | null;
};

async function runSandboxTemplateLocal(
  options: Record<string, string | boolean>,
  mode: "run" | "dev",
): Promise<void> {
  const { plan, filePath, projectPath } = await loadSandboxTemplateBuildPlan(options);
  const executable = resolveSandboxTemplateLocalExecutable(plan.manifest, options, mode);
  const input = await resolveSandboxTemplateStartInput(plan.manifest, options, projectPath);
  const volumes = await prepareLocalSandboxTemplateVolumes(plan.manifest, projectPath);
  const setupCommands = await runLocalSandboxTemplateSetupCommands(plan.manifest, projectPath, options);
  const uploadedFiles = await prepareLocalSandboxTemplateUploads(input.uploadRequests, projectPath);
  const commandInput = {
    ...input.scalars,
    ...formatUploadedFileParams(uploadedFiles, input.uploadRequests),
  };
  const replay = await writeLocalSandboxTemplateReplayParams(projectPath, executable, commandInput);
  const previews = localSandboxTemplatePreviews(executable);
  if (mode === "dev" || executable.kind === "service") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          file: filePath,
          template: plan.manifest.name,
          executable: summarizeSandboxTemplateExecutable(executable),
          volumes,
          setupCommands,
          uploadedFiles,
          input: commandInput,
          replayParamsPath: replay.paramsPath,
          previews,
          status: "starting",
        },
        null,
        2,
      ),
    );
    const result = await runLocalSandboxTemplateCommand(projectPath, executable, replay, {
      inherit: true,
      timeoutSeconds: executable.timeoutSeconds,
    });
    if (result.status !== "succeeded") process.exitCode = 1;
    return;
  }

  const execution = await runLocalSandboxTemplateCommand(projectPath, executable, replay, {
    timeoutSeconds: executable.timeoutSeconds ?? 900,
  });
  const artifacts = await collectLocalSandboxTemplateArtifacts(projectPath, executable.artifactPaths);
  if (execution.status !== "succeeded") process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        ok: execution.status === "succeeded",
        mode,
        file: filePath,
        template: plan.manifest.name,
        executable: summarizeSandboxTemplateExecutable(executable),
        volumes,
        setupCommands,
        uploadedFiles,
        input: commandInput,
        replayParamsPath: replay.paramsPath,
        execution,
        previews,
        artifacts,
      },
      null,
      2,
    ),
  );
}

async function runSandboxTemplateExistingSandboxAction(
  options: Record<string, string | boolean>,
  rest: string[],
): Promise<void> {
  const sandboxId =
    rest[0]?.trim() ||
    (typeof options.sandboxId === "string" ? options.sandboxId.trim() : "");
  const actionName =
    rest[1]?.trim() ||
    (typeof options.action === "string" ? options.action.trim() : "") ||
    (typeof options.target === "string" ? options.target.trim() : "");
  if (!sandboxId || !actionName) {
    throw new Error(`usage: sandbox-template action <sandboxId> <actionName> [--file ${OPENPOND_MANIFEST_FILE_NAME}]`);
  }
  const { plan, filePath, projectPath } = await loadSandboxTemplateBuildPlan(options);
  const executable = resolveSandboxTemplateActionExecutable(plan.manifest, actionName);
  const input = await resolveSandboxTemplateStartInput(plan.manifest, options, projectPath);
  const client = await resolveSandboxClient(options);
  const uploadedFiles = await uploadSandboxTemplateStartFiles(
    client,
    sandboxId,
    input.uploadRequests,
  );
  const commandInput = {
    ...input.scalars,
    ...formatUploadedFileParams(uploadedFiles, input.uploadRequests),
  };
  const execution = await runSandboxTemplateExecutable(client, sandboxId, executable, commandInput);
  console.log(
    JSON.stringify(
      {
        ok: true,
        file: filePath,
        sandboxId,
        executable: summarizeSandboxTemplateExecutable(executable),
        uploadedFiles,
        input: commandInput,
        execution,
        expectedArtifacts: executable.artifactPaths,
      },
      null,
      2,
    ),
  );
}

function resolveSandboxTemplateLocalExecutable(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
  mode: "run" | "dev",
): SandboxTemplateExecutable {
  if (
    mode === "dev" &&
    typeof options.target !== "string" &&
    typeof options.action !== "string" &&
    typeof options.service !== "string" &&
    typeof options.entrypoint !== "string"
  ) {
    const firstService = sandboxTemplateExecutableEntries(manifest).find(
      (candidate) => candidate.kind === "service",
    );
    if (firstService) return firstService;
  }
  return resolveSandboxTemplateStartExecutable(manifest, options);
}

function resolveSandboxTemplateActionExecutable(
  manifest: SandboxTemplateManifest,
  actionName: string,
): SandboxTemplateExecutable {
  const match = sandboxTemplateExecutableEntries(manifest).find(
    (candidate) => candidate.kind === "action" && candidate.name === actionName,
  );
  if (!match) {
    const actions = manifest.actions.map((action) => action.name).join(", ") || "(none)";
    throw new Error(`manifest action not found: ${actionName}. Available actions: ${actions}`);
  }
  return match;
}

function summarizeSandboxTemplateExecutable(executable: SandboxTemplateExecutable): Record<string, unknown> {
  return {
    kind: executable.kind,
    name: executable.name,
    command: executable.command,
    cwd: executable.cwd ?? null,
    timeoutSeconds: executable.timeoutSeconds ?? null,
    ports: executable.ports,
    artifactPaths: executable.artifactPaths,
  };
}

async function prepareLocalSandboxTemplateVolumes(
  manifest: SandboxTemplateManifest,
  projectPath: string,
): Promise<LocalSandboxTemplateVolume[]> {
  const volumes: LocalSandboxTemplateVolume[] = [];
  for (const volume of manifest.volumes) {
    const mountPath =
      typeof volume.mountPath === "string" && volume.mountPath.trim()
        ? volume.mountPath.trim()
        : volume.name
          ? `/workspace/volumes/${volume.name}`
          : "";
    if (!mountPath) continue;
    const localPath = path.resolve(projectPath, normalizeLocalWorkspacePath(mountPath));
    await fs.mkdir(localPath, { recursive: true });
    volumes.push({
      name: volume.name ?? null,
      mountPath,
      localPath,
    });
  }
  return volumes;
}

async function runLocalSandboxTemplateSetupCommands(
  manifest: SandboxTemplateManifest,
  projectPath: string,
  options: Record<string, string | boolean>,
): Promise<LocalSandboxTemplateCommandResult[]> {
  const timeoutSeconds =
    parseIntegerOption(options.setupTimeoutSeconds, "setup-timeout-seconds") ?? 900;
  const results: LocalSandboxTemplateCommandResult[] = [];
  for (const command of manifest.setup.commands) {
    const result = await runLocalShellCommandResult(command, projectPath, {
      timeoutSeconds,
    });
    results.push(result);
    if (result.status !== "succeeded") {
      throw new Error(`local setup command failed: ${command}\n${result.output}`);
    }
  }
  return results;
}

async function prepareLocalSandboxTemplateUploads(
  requests: SandboxTemplateUploadRequest[],
  projectPath: string,
): Promise<SandboxTemplateUploadedFile[]> {
  const uploaded: SandboxTemplateUploadedFile[] = [];
  for (const request of requests) {
    for (const localPath of request.localPaths) {
      const contents = await fs.readFile(localPath);
      const sandboxPath = joinSandboxUploadPath(
        request.spec.targetPath,
        path.basename(localPath),
      );
      const destination = path.resolve(projectPath, normalizeLocalWorkspacePath(sandboxPath));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(localPath, destination);
      uploaded.push({
        inputName: request.inputName,
        localPath,
        sandboxPath,
        sizeBytes: contents.byteLength,
      });
    }
  }
  return uploaded;
}

async function writeLocalSandboxTemplateReplayParams(
  projectPath: string,
  executable: SandboxTemplateExecutable,
  input: SandboxTemplateScalarInputs,
): Promise<{ paramsPath: string; encoded: string }> {
  const paramsJson = `${JSON.stringify({ input }, null, 2)}\n`;
  const encoded = Buffer.from(paramsJson, "utf8").toString("base64");
  const paramsPath = path.join(projectPath, "openpond-replay-params.json");
  await fs.writeFile(paramsPath, paramsJson, "utf8");
  if (executable.cwd) {
    const cwdParamsPath = path.join(projectPath, executable.cwd, "openpond-replay-params.json");
    if (cwdParamsPath !== paramsPath) {
      await fs.mkdir(path.dirname(cwdParamsPath), { recursive: true });
      await fs.writeFile(cwdParamsPath, paramsJson, "utf8");
    }
  }
  return { paramsPath, encoded };
}

async function runLocalSandboxTemplateCommand(
  projectPath: string,
  executable: SandboxTemplateExecutable,
  replay: { encoded: string },
  options: { timeoutSeconds?: number; inherit?: boolean } = {},
): Promise<LocalSandboxTemplateCommandResult> {
  const cwd = executable.cwd
    ? path.resolve(projectPath, executable.cwd)
    : projectPath;
  return runLocalShellCommandResult(executable.command, cwd, {
    env: {
      OPENPOND_REPLAY_PARAMS_BASE64: replay.encoded,
    },
    timeoutSeconds: options.timeoutSeconds,
    inherit: options.inherit,
  });
}

async function runLocalShellCommandResult(
  command: string,
  cwd: string,
  options: {
    env?: Record<string, string>;
    timeoutSeconds?: number;
    inherit?: boolean;
  } = {},
): Promise<LocalSandboxTemplateCommandResult> {
  const result = await runShellCommand(command, {
    cwd,
    env: options.env,
    timeoutSeconds: options.timeoutSeconds,
    inherit: options.inherit,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("");
  return {
    command,
    cwd,
    status: result.timedOut ? "timed_out" : result.code === 0 ? "succeeded" : "failed",
    output,
    exitCode: result.code,
  };
}

function localSandboxTemplatePreviews(
  executable: SandboxTemplateExecutable,
): Array<Record<string, unknown>> {
  return executable.ports.map((port) => ({
    port: port.port,
    label: port.label ?? null,
    access: port.access,
    url: `http://127.0.0.1:${port.port}${port.path}`,
  }));
}

async function collectLocalSandboxTemplateArtifacts(
  projectPath: string,
  artifactPaths: string[],
): Promise<Array<{ path: string; exists: boolean; sizeBytes: number | null }>> {
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const localPath = path.resolve(projectPath, normalizeLocalWorkspacePath(artifactPath));
    try {
      const stat = await fs.stat(localPath);
      artifacts.push({ path: artifactPath, exists: stat.isFile(), sizeBytes: stat.size });
    } catch {
      artifacts.push({ path: artifactPath, exists: false, sizeBytes: null });
    }
  }
  return artifacts;
}

function normalizeLocalWorkspacePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/workspace\//, "")
    .replace(/^workspace\//, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`invalid workspace path: ${value}`);
  }
  return normalized;
}

async function runSandboxTemplateStart(options: Record<string, string | boolean>): Promise<void> {
  const filePath = resolveSandboxTemplateFilePath(options);
  const projectPath = path.dirname(filePath);
  const source = await fs.readFile(filePath, "utf8");
  const result = validateSandboxTemplateYaml(source);
  if (!result.ok) {
    console.error(formatSandboxTemplateDiagnostics(result.diagnostics));
    process.exitCode = 1;
    return;
  }

  const manifest = result.manifest;
  const executable = resolveSandboxTemplateStartExecutable(manifest, options);
  const input = await resolveSandboxTemplateStartInput(manifest, options, projectPath);
  const repo = await resolveSandboxTemplateStartRepo(manifest, options, projectPath);
  const client = await resolveSandboxClient(options);
  const createInput = buildSandboxTemplateStartCreateInput(manifest, options, repo);
  const sandbox = await createSandboxTemplateStartSandbox(client, createInput, repo);
  await waitForSandboxTemplateRunnerReady(client, sandbox.id);
  const setupCommands = await runSandboxTemplateSetupCommands(client, sandbox.id, manifest, options);
  const uploadedFiles = await uploadSandboxTemplateStartFiles(
    client,
    sandbox.id,
    input.uploadRequests,
  );
  const commandInput = {
    ...input.scalars,
    ...formatUploadedFileParams(uploadedFiles, input.uploadRequests),
  };
  const execution = await runSandboxTemplateExecutable(client, sandbox.id, executable, commandInput);
  const previews = await openSandboxTemplatePorts(client, sandbox.id, executable.ports);
  const schedules = await createSandboxTemplateStartSchedules(
    client,
    sandbox.id,
    manifest,
    options,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: filePath,
        repo,
        executable: {
          kind: executable.kind,
          name: executable.name,
          command: executable.command,
        },
        sandbox: summarizeSandbox(sandbox),
        setupCommands,
        uploadedFiles,
        input: commandInput,
        execution,
        previews,
        schedules,
        expectedArtifacts: executable.artifactPaths,
      },
      null,
      2,
    ),
  );
}

function resolveSandboxTemplateStartExecutable(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): SandboxTemplateExecutable {
  const executables = sandboxTemplateExecutableEntries(manifest);
  const action = typeof options.action === "string" ? options.action.trim() : "";
  const service = typeof options.service === "string" ? options.service.trim() : "";
  const target = typeof options.target === "string" ? options.target.trim() : "";
  const entrypoint =
    typeof options.entrypoint === "string" ? options.entrypoint.trim() : "";
  const requested = action || service || target || entrypoint || "start";
  const kind = action ? "action" : service ? "service" : "";
  const match = executables.find(
    (candidate) =>
      candidate.name === requested && (!kind || candidate.kind === kind),
  );
  if (!match) {
    throw new Error(
      `manifest executable not found: ${requested}. Available: ${executables
        .map((candidate) => `${candidate.kind}:${candidate.name}`)
        .join(", ")}`,
    );
  }
  return match;
}

function buildSandboxTemplateStartCreateInput(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
  repo: string,
): SandboxCreateInput {
  const budgetUsd =
    typeof options.budgetUsd === "string" && options.budgetUsd.trim()
      ? options.budgetUsd.trim()
      : typeof options.budget === "string" && options.budget.trim()
        ? options.budget.trim()
        : "0.05";
  const maxDurationSeconds = parseIntegerOption(options.maxDurationSeconds, "max-duration-seconds");
  const idleTimeoutSeconds = parseIntegerOption(options.idleTimeoutSeconds, "idle-timeout-seconds");
  const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
  const appId = typeof options.appId === "string" ? options.appId.trim() : "";
  const env = parseSandboxTemplateEnvOptions(manifest, options);
  return {
    repo,
    ...(teamId ? { teamId } : {}),
    ...(appId ? { appId } : {}),
    resources: manifest.resources ?? {},
    budget: { maxUsd: budgetUsd },
    quotas: {
      maxSpendUsd: budgetUsd,
      ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
      ...(idleTimeoutSeconds !== undefined ? { idleTimeoutSeconds } : {}),
    },
    ...(env.length > 0 ? { env } : {}),
    volumes: manifest.volumes,
    metadata: {
      source: "openpond-code-sandbox-template-start",
      manifestFile: OPENPOND_MANIFEST_FILE_NAME,
      template: {
        name: manifest.name,
        version: manifest.version,
        useCase: manifest.useCase,
      },
    },
  };
}

type SandboxTemplateStartScheduleMode = "enabled" | "disabled";

type SandboxTemplateScheduleOverride = Partial<SandboxScheduleCreateInput> & {
  cron?: string;
  rate?: string;
  once?: string;
  target?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

async function createSandboxTemplateStartSchedules(
  client: OpenPondSandboxClient,
  sandboxId: string,
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): Promise<Array<Record<string, unknown>>> {
  const selection = resolveSandboxTemplateStartScheduleSelection(manifest, options);
  if (!selection) {
    return [];
  }
  const overrides = parseSandboxTemplateScheduleOverrides(manifest, options);
  const appId = typeof options.appId === "string" ? options.appId.trim() : "";
  const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
  const created: Array<Record<string, unknown>> = [];
  for (const schedule of selection.schedules) {
    const input = buildSandboxTemplateStartScheduleInput({
      manifest,
      schedule,
      override: overrides.get(schedule.name),
      mode: selection.mode,
      sourceSandboxId: sandboxId,
      teamId,
      appId,
    });
    const result = await client.createSchedule(input);
    created.push({
      id: result.schedule.id,
      name: result.schedule.name,
      enabled: result.schedule.enabled,
      scheduleType: result.schedule.scheduleType,
      scheduleExpression: result.schedule.scheduleExpression,
      syncStatus: result.schedule.syncStatus,
      awsScheduleArn: result.schedule.awsScheduleArn ?? null,
      target: result.schedule.target,
    });
  }
  return created;
}

function resolveSandboxTemplateStartScheduleSelection(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): { mode: SandboxTemplateStartScheduleMode; schedules: SandboxTemplateManifest["schedules"] } | null {
  const enableRaw = options.enableSchedules ?? options.enableSchedule;
  const disableRaw = options.disableSchedules ?? options.disableSchedule;
  if (enableRaw !== undefined && disableRaw !== undefined) {
    throw new Error("pass only one of --enable-schedules or --disable-schedules");
  }

  let mode: SandboxTemplateStartScheduleMode | null = null;
  let rawSelection: string | boolean | undefined;
  if (enableRaw !== undefined) {
    mode = "enabled";
    rawSelection = enableRaw;
  } else if (disableRaw !== undefined) {
    mode = "disabled";
    rawSelection = disableRaw;
  } else if (options.schedules !== undefined) {
    rawSelection = options.schedules;
    const rawMode =
      typeof options.scheduleMode === "string"
        ? options.scheduleMode.trim().toLowerCase()
        : "disabled";
    if (rawMode === "none") {
      return null;
    }
    if (rawMode !== "enabled" && rawMode !== "disabled") {
      throw new Error("--schedule-mode must be enabled, disabled, or none");
    }
    mode = rawMode;
  }

  if (!mode) {
    return null;
  }
  if (manifest.schedules.length === 0) {
    return { mode, schedules: [] };
  }
  const selectedNames = parseSandboxTemplateScheduleNameSelection(
    rawSelection,
    manifest,
  );
  const schedules =
    selectedNames === null
      ? manifest.schedules
      : manifest.schedules.filter((schedule) => selectedNames.has(schedule.name));
  return { mode, schedules };
}

function parseSandboxTemplateScheduleNameSelection(
  value: string | boolean | undefined,
  manifest: SandboxTemplateManifest,
): Set<string> | null {
  if (value === undefined || value === true) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw || raw === "true" || raw.toLowerCase() === "all") {
    return null;
  }
  if (raw.toLowerCase() === "none") {
    return new Set();
  }
  const known = new Set(manifest.schedules.map((schedule) => schedule.name));
  const selected = new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const name of selected) {
    if (!known.has(name)) {
      throw new Error(`manifest schedule not found: ${name}`);
    }
  }
  return selected;
}

function parseSandboxTemplateScheduleOverrides(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): Map<string, SandboxTemplateScheduleOverride> {
  const raw =
    typeof options.scheduleOverrides === "string"
      ? options.scheduleOverrides
      : typeof options.scheduleOverride === "string"
        ? options.scheduleOverride
        : "";
  if (!raw.trim()) {
    return new Map();
  }
  const parsed = parseJsonOption(raw, "schedule-overrides");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("schedule-overrides must be a JSON object keyed by schedule name");
  }
  const known = new Set(manifest.schedules.map((schedule) => schedule.name));
  const out = new Map<string, SandboxTemplateScheduleOverride>();
  for (const [name, override] of Object.entries(parsed)) {
    if (!known.has(name)) {
      throw new Error(`schedule override target does not exist: ${name}`);
    }
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      throw new Error(`schedule override for ${name} must be an object`);
    }
    out.set(name, override as SandboxTemplateScheduleOverride);
  }
  return out;
}

function buildSandboxTemplateStartScheduleInput(params: {
  manifest: SandboxTemplateManifest;
  schedule: SandboxTemplateManifest["schedules"][number];
  override: SandboxTemplateScheduleOverride | undefined;
  mode: SandboxTemplateStartScheduleMode;
  sourceSandboxId: string;
  teamId: string;
  appId: string;
}): SandboxScheduleCreateInput {
  const schedule = mergeSandboxTemplateScheduleOverride(
    params.schedule,
    params.override,
  );
  const expression = sandboxTemplateScheduleExpression(schedule);
  return {
    sourceSandboxId: params.sourceSandboxId,
    ...(params.teamId ? { teamId: params.teamId } : {}),
    ...(params.appId ? { appId: params.appId } : {}),
    name: schedule.name,
    ...(schedule.description ? { description: schedule.description } : {}),
    ...expression,
    ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
    enabled:
      typeof params.override?.enabled === "boolean"
        ? params.override.enabled
        : params.mode === "enabled",
    ...(schedule.startAt ? { startAt: schedule.startAt } : {}),
    ...(schedule.endAt ? { endAt: schedule.endAt } : {}),
    ...(schedule.maxRuns !== undefined ? { maxRuns: schedule.maxRuns } : {}),
    runtimePolicy: schedule.runtimePolicy,
    target: sandboxTemplateScheduleCommandTarget(params.manifest, schedule),
    ...(schedule.budget ? { budget: schedule.budget } : {}),
    ...(schedule.resources ? { resources: schedule.resources } : {}),
    ...(schedule.quotas ? { quotas: schedule.quotas } : {}),
    ...(schedule.lifecycle ? { lifecycle: schedule.lifecycle } : {}),
    ...(schedule.retentionPolicy ? { retentionPolicy: schedule.retentionPolicy } : {}),
    ...(schedule.env ? { env: schedule.env } : {}),
    ...(schedule.integrationLeases
      ? {
          integrationLeases:
            schedule.integrationLeases as unknown as SandboxScheduleCreateInput["integrationLeases"],
        }
      : {}),
    metadata: {
      ...(schedule.metadata ?? {}),
      manifestScheduleName: schedule.name,
      source: "openpond-code-sandbox-template-start",
    },
    managementSource: "openpond.yaml",
    manifestPath: OPENPOND_MANIFEST_FILE_NAME,
  };
}

function mergeSandboxTemplateScheduleOverride(
  schedule: SandboxTemplateManifest["schedules"][number],
  override: SandboxTemplateScheduleOverride | undefined,
): SandboxTemplateManifest["schedules"][number] {
  if (!override) {
    return schedule;
  }
  return {
    ...schedule,
    ...override,
    target:
      schedule.target || override.target
        ? {
            ...(schedule.target ?? {}),
            ...(override.target ?? {}),
          }
        : undefined,
    metadata:
      schedule.metadata || override.metadata
        ? {
            ...(schedule.metadata ?? {}),
            ...(override.metadata ?? {}),
          }
        : undefined,
  } as SandboxTemplateManifest["schedules"][number];
}

function sandboxTemplateScheduleExpression(
  schedule: SandboxTemplateManifest["schedules"][number],
): Pick<SandboxScheduleCreateInput, "scheduleType" | "scheduleExpression"> {
  if (schedule.scheduleExpression) {
    return {
      scheduleType: schedule.scheduleType ?? "cron",
      scheduleExpression: schedule.scheduleExpression,
    };
  }
  if (schedule.rate) {
    return {
      scheduleType: "rate",
      scheduleExpression: /^rate\(/i.test(schedule.rate)
        ? schedule.rate
        : `rate(${schedule.rate})`,
    };
  }
  if (schedule.once) {
    return {
      scheduleType: "once",
      scheduleExpression: /^at\(/i.test(schedule.once)
        ? schedule.once
        : `at(${schedule.once})`,
    };
  }
  return {
    scheduleType: "cron",
    scheduleExpression: schedule.cron ?? "",
  };
}

function sandboxTemplateScheduleCommandTarget(
  manifest: SandboxTemplateManifest,
  schedule: SandboxTemplateManifest["schedules"][number],
): NonNullable<SandboxScheduleCreateInput["target"]> {
  const explicitCommand = schedule.command ?? schedule.target?.command ?? null;
  if (explicitCommand) {
    return {
      kind: "command",
      command: explicitCommand,
      requiresStart:
        schedule.requiresStart ?? schedule.target?.requiresStart ?? false,
    };
  }

  const targetKind = schedule.target?.kind ?? "action";
  if (targetKind === "start") {
    return {
      kind: "command",
      command: manifest.start.command,
      requiresStart:
        schedule.requiresStart ??
        schedule.target?.requiresStart ??
        manifest.start.requiresStart ??
        false,
    };
  }
  if (targetKind === "service") {
    const serviceName = schedule.target?.name ?? "";
    const service = manifest.services.find((item) => item.name === serviceName);
    if (!service) {
      throw new Error(`schedule service target does not exist: ${serviceName}`);
    }
    return {
      kind: "command",
      command: service.command,
      requiresStart:
        schedule.requiresStart ??
        schedule.target?.requiresStart ??
        service.requiresStart ??
        false,
    };
  }

  const actionName =
    schedule.actionName ??
    schedule.action ??
    schedule.target?.actionName ??
    (schedule.target?.kind === "action" ? schedule.target?.name : undefined);
  const action = manifest.actions.find((item) => item.name === actionName);
  if (!action) {
    throw new Error(`schedule action target does not exist: ${actionName ?? ""}`);
  }
  return {
    kind: "command",
    command: action.command,
    requiresStart:
      schedule.requiresStart ??
      schedule.target?.requiresStart ??
      action.requiresStart ??
      false,
  };
}

async function createSandboxTemplateStartSandbox(
  client: OpenPondSandboxClient,
  input: SandboxCreateInput,
  repo: string,
): Promise<SandboxRecord> {
  const requestedAt = Date.now();
  try {
    return await client.create(input);
  } catch (error) {
    if (!isLikelySandboxCreateTimeout(error)) {
      throw error;
    }
    console.warn("warning: sandbox create timed out; checking for the created sandbox record");
    return recoverTimedOutSandboxCreate(client, input, repo, requestedAt);
  }
}

function isLikelySandboxCreateTimeout(error: unknown): boolean {
  return error instanceof Error && /\b(504|timed out|timeout)\b/i.test(error.message);
}

async function recoverTimedOutSandboxCreate(
  client: OpenPondSandboxClient,
  input: SandboxCreateInput,
  repo: string,
  requestedAt: number,
): Promise<SandboxRecord> {
  const timeoutMs = 120_000;
  const pollMs = 3_000;
  const deadline = Date.now() + timeoutMs;
  const repoIdentity = normalizeSandboxTemplateRepoIdentity(repo);
  const metadata = input.metadata ?? {};
  while (Date.now() < deadline) {
    const sandboxes = await client.list({
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.appId ? { appId: input.appId } : {}),
    });
    const match = sandboxes
      .filter((sandbox) => {
        if (!sandbox.repo) return false;
        if (normalizeSandboxTemplateRepoIdentity(sandbox.repo) !== repoIdentity) return false;
        const createdAt = Date.parse(sandbox.createdAt);
        if (Number.isFinite(createdAt) && createdAt < requestedAt - 30_000) return false;
        if (metadata.source && sandbox.metadata?.source !== metadata.source) return false;
        return true;
      })
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    if (match?.state === "running" || match?.state === "stopped") {
      return match;
    }
    if (match?.state === "error") {
      throw new Error(`sandbox create failed after timeout: ${match.id}\n${match.logs.join("\n")}`);
    }
    await sleep(pollMs);
  }
  throw new Error("sandbox create timed out and no matching created sandbox reached running state");
}

async function waitForSandboxTemplateRunnerReady(
  client: OpenPondSandboxClient,
  sandboxId: string,
): Promise<void> {
  const timeoutMs = 120_000;
  const pollMs = 3_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await client.exec(sandboxId, {
        command: "true",
        timeoutSeconds: 30,
      });
      if (result.command.status === "succeeded" && result.command.exitCode === 0) {
        return;
      }
      lastError = new Error(
        `readiness command ${result.command.status} with exit code ${String(result.command.exitCode)}`,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableSandboxRunnerReadyError(error)) {
        throw error;
      }
    }
    await sleep(pollMs);
  }
  throw new Error(
    `sandbox runner was not ready after create: ${formatUnknownError(lastError)}`,
  );
}

function isRetryableSandboxRunnerReadyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /\b(502|503|504|timed out|timeout|sandbox_not_found|sandbox_not_ready|sandbox_runner_failed)\b/i.test(
      error.message,
    )
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function normalizeSandboxTemplateRepoIdentity(repoUrl: string): string {
  return normalizeSandboxTemplateRepoUrl(repoUrl).replace(/\.git$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSandboxTemplateStartRepo(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
  projectPath: string,
): Promise<string> {
  const explicitRepo = typeof options.repo === "string" ? options.repo.trim() : "";
  if (explicitRepo) {
    return normalizeSandboxTemplateRepoUrl(explicitRepo);
  }

  await ensureGitRepository(projectPath);
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  let originUrl = await getGitRemoteUrl(projectPath, "origin");
  if (!originUrl) {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const response = await createRepo(apiBase, apiKey, {
      name: manifest.name,
      description: manifest.description,
      repoInit: "empty",
      ...(teamId ? { teamId } : {}),
    });
    originUrl = resolveRepoUrl(response);
    const remoteResult = await runCommand("git", ["remote", "add", "origin", originUrl], {
      cwd: projectPath,
    });
    if (remoteResult.code !== 0) {
      throw new Error(
        `git remote add failed: ${
          remoteResult.stderr.trim() || remoteResult.stdout.trim() || "unknown error"
        }`,
      );
    }
  }

  warnOnRepoHostMismatch(originUrl);
  await ensureGitCommitForSandboxTemplateStart(projectPath, options);
  if (!parseBooleanOption(options.noPush)) {
    const branch = await resolveSandboxTemplateStartBranch(projectPath, options);
    await pushGitBranchForSandboxTemplateStart(projectPath, originUrl, branch, apiKey, options);
  }
  return normalizeSandboxTemplateRepoUrl(originUrl);
}

async function ensureGitRepository(projectPath: string): Promise<void> {
  const gitDir = path.join(projectPath, ".git");
  if (existsSync(gitDir)) return;
  const result = await runCommand("git", ["init"], { cwd: projectPath });
  if (result.code !== 0) {
    throw new Error(
      `git init failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
    );
  }
}

async function ensureGitCommitForSandboxTemplateStart(
  projectPath: string,
  options: Record<string, string | boolean>,
): Promise<void> {
  const status = await runCommand("git", ["status", "--porcelain"], { cwd: projectPath });
  if (status.code !== 0) {
    throw new Error(
      `git status failed: ${status.stderr.trim() || status.stdout.trim() || "unknown error"}`,
    );
  }
  const head = await runCommand("git", ["rev-parse", "--verify", "HEAD"], { cwd: projectPath });
  const hasHead = head.code === 0;
  const dirty = status.stdout.trim().length > 0;
  if (!dirty && hasHead) return;

  const shouldCommit =
    parseBooleanOption(options.commit) ||
    parseBooleanOption(options.yes) ||
    (input.isTTY
      ? await promptConfirm(
          hasHead
            ? "Commit local changes before starting the sandbox?"
            : "Create the initial git commit before starting the sandbox?",
          !hasHead,
        )
      : false);

  if (!shouldCommit) {
    if (!hasHead) {
      throw new Error("local repository has no commits; pass --commit or commit before starting");
    }
    if (dirty) {
      console.warn("warning: uncommitted local changes will not be included in the sandbox");
    }
    return;
  }

  const add = await runCommand("git", ["add", "-A"], { cwd: projectPath });
  if (add.code !== 0) {
    throw new Error(`git add failed: ${add.stderr.trim() || add.stdout.trim() || "unknown error"}`);
  }
  const message =
    typeof options.commitMessage === "string" && options.commitMessage.trim()
      ? options.commitMessage.trim()
      : `start ${OPENPOND_MANIFEST_FILE_NAME} sandbox`;
  const commit = await runCommand("git", ["commit", "-m", message], { cwd: projectPath });
  if (commit.code !== 0) {
    const output = commit.stderr.trim() || commit.stdout.trim();
    if (output.includes("nothing to commit") && hasHead) return;
    throw new Error(`git commit failed: ${output || "unknown error"}`);
  }
}

async function resolveSandboxTemplateStartBranch(
  projectPath: string,
  options: Record<string, string | boolean>,
): Promise<string> {
  const branchOption = typeof options.branch === "string" ? options.branch.trim() : "";
  const branch = branchOption || (await resolveGitBranch(projectPath));
  if (!branch) {
    throw new Error("unable to resolve git branch; pass --branch");
  }
  return branch;
}

async function pushGitBranchForSandboxTemplateStart(
  projectPath: string,
  originUrl: string,
  branch: string,
  apiKey: string,
  options: Record<string, string | boolean>,
): Promise<void> {
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
      const setResult = await runCommand("git", ["remote", "set-url", "origin", tokenRemote], {
        cwd: projectPath,
      });
      if (setResult.code !== 0) {
        throw new Error(
          `git remote set-url failed: ${redactToken(
            setResult.stderr.trim() || setResult.stdout.trim() || "unknown error",
          )}`,
        );
      }
    }
    const push = await runCommand("git", ["push", "-u", "origin", branch], {
      cwd: projectPath,
      inherit: true,
    });
    if (push.code !== 0) {
      throw new Error("git push failed");
    }
  } finally {
    if (restoreUrl) {
      await runCommand("git", ["remote", "set-url", "origin", restoreUrl], {
        cwd: projectPath,
      }).catch(() => null);
    }
    if (previousPrompt === undefined) {
      delete process.env.GIT_TERMINAL_PROMPT;
    } else {
      process.env.GIT_TERMINAL_PROMPT = previousPrompt;
    }
  }
}

function normalizeSandboxTemplateRepoUrl(repoUrl: string): string {
  const parsed = new URL(repoUrl);
  parsed.username = "";
  parsed.password = "";
  const text = parsed.toString();
  return text.endsWith(".git") ? text : `${text.replace(/\/$/, "")}.git`;
}

async function resolveSandboxTemplateStartInput(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
  projectPath: string,
): Promise<{
  scalars: SandboxTemplateScalarInputs;
  uploadRequests: SandboxTemplateUploadRequest[];
}> {
  const scalars = parseSandboxTemplateScalarInputs(options);
  const uploadSpecs = collectSandboxTemplateUploadSpecs(manifest);
  const uploadRequests: SandboxTemplateUploadRequest[] = [];
  const fileInputs = parseSandboxTemplateFileInputOptions(options);
  for (const [inputName, rawValue] of Object.entries(fileInputs)) {
    const spec = uploadSpecs.get(inputName);
    if (!spec) {
      throw new Error(`${inputName} is not declared as a file upload input in ${OPENPOND_MANIFEST_FILE_NAME}`);
    }
    const localPaths = await expandSandboxTemplateUploadPaths(rawValue, projectPath);
    if (!spec.multiple && localPaths.length > 1) {
      throw new Error(`${inputName} accepts one file, got ${localPaths.length}`);
    }
    uploadRequests.push({ inputName, localPaths, spec });
  }

  const requiredInputs = Array.isArray(manifest.inputs.schema.required)
    ? manifest.inputs.schema.required.filter((value): value is string => typeof value === "string")
    : [];
  for (const inputName of requiredInputs) {
    if (uploadSpecs.has(inputName) && !uploadRequests.some((request) => request.inputName === inputName)) {
      throw new Error(`${inputName} is required; pass --input-file ${inputName}=<path> or --input-files ${inputName}=<glob>`);
    }
  }

  return { scalars, uploadRequests };
}

function parseSandboxTemplateScalarInputs(
  options: Record<string, string | boolean>,
): SandboxTemplateScalarInputs {
  const rawInputs =
    typeof options.inputs === "string"
      ? options.inputs
      : typeof options.inputJson === "string"
        ? options.inputJson
        : typeof options.params === "string"
          ? options.params
          : "";
  const scalars = rawInputs
    ? (parseJsonOption(rawInputs, "inputs") as SandboxTemplateScalarInputs)
    : {};
  if (!scalars || typeof scalars !== "object" || Array.isArray(scalars)) {
    throw new Error("inputs must be a JSON object");
  }
  const rawInput = typeof options.input === "string" ? options.input.trim() : "";
  if (rawInput) {
    const [name, value] = parseKeyValueOption(rawInput, "input");
    scalars[name] = value;
  }
  return scalars;
}

function parseSandboxTemplateFileInputOptions(
  options: Record<string, string | boolean>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const rawFile = typeof options.inputFile === "string" ? options.inputFile.trim() : "";
  if (rawFile) {
    const [name, value] = parseKeyValueOption(rawFile, "input-file");
    out[name] = value;
  }
  const rawFiles = typeof options.inputFiles === "string" ? options.inputFiles.trim() : "";
  if (rawFiles) {
    const [name, value] = parseKeyValueOption(rawFiles, "input-files");
    out[name] = value;
  }
  return out;
}

function parseKeyValueOption(value: string, label: string): [string, string] {
  const index = value.indexOf("=");
  if (index <= 0) {
    throw new Error(`${label} must be formatted as name=value`);
  }
  const key = value.slice(0, index).trim();
  const raw = value.slice(index + 1).trim();
  if (!key || !raw) {
    throw new Error(`${label} must be formatted as name=value`);
  }
  return [key, raw];
}

function collectSandboxTemplateUploadSpecs(
  manifest: SandboxTemplateManifest,
): Map<string, SandboxTemplateUploadSpec> {
  const properties = asPlainRecord(manifest.inputs.schema.properties);
  const specs = new Map<string, SandboxTemplateUploadSpec>();
  for (const [inputName, rawProperty] of Object.entries(properties)) {
    const property = asPlainRecord(rawProperty);
    const upload = asPlainRecord(
      property["x-openpond-upload"] ?? property.xOpenPondUpload,
    );
    if (!upload) continue;
    const targetPath =
      typeof upload.targetPath === "string" && upload.targetPath.trim()
        ? normalizeSandboxUploadTargetPath(upload.targetPath)
        : "";
    if (!targetPath) {
      throw new Error(`${inputName} upload metadata is missing targetPath`);
    }
    const multiple =
      upload.multiple === true ||
      property.type === "array" ||
      asPlainRecord(property.items)?.format === "file";
    specs.set(inputName, { inputName, multiple, targetPath });
  }
  return specs;
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeSandboxUploadTargetPath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/workspace\//, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`invalid upload target path: ${value}`);
  }
  if (normalized.split("/").some(isSandboxEnvFileName)) {
    throw new Error("sandbox template uploads cannot target .env* files; create sandbox secrets and pass refs with --env-ref");
  }
  return normalized;
}

async function expandSandboxTemplateUploadPaths(
  rawValue: string,
  projectPath: string,
): Promise<string[]> {
  const values = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const paths = (
    await Promise.all(values.map((value) => expandSandboxTemplateUploadPath(value, projectPath)))
  ).flat();
  if (paths.length === 0) {
    throw new Error(`no files matched ${rawValue}`);
  }
  return paths;
}

async function expandSandboxTemplateUploadPath(
  rawValue: string,
  projectPath: string,
): Promise<string[]> {
  const absolute = path.resolve(projectPath, rawValue);
  if (!rawValue.includes("*")) {
    assertSandboxTemplateUploadPathAllowed(absolute);
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      throw new Error(`upload path is not a file: ${absolute}`);
    }
    return [absolute];
  }
  const directory = path.dirname(absolute);
  const basename = path.basename(absolute);
  const regex = globBasenameToRegExp(basename);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const matchingEntries = entries
    .filter((entry) => entry.isFile() && regex.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const blocked = matchingEntries.find((entry) => isSandboxEnvFileName(entry.name));
  if (blocked) {
    throw new Error("sandbox template uploads cannot include .env* files; create sandbox secrets and pass refs with --env-ref");
  }
  return matchingEntries
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function assertSandboxTemplateUploadPathAllowed(localPath: string): void {
  if (isSandboxEnvFileName(path.basename(localPath))) {
    throw new Error("sandbox template uploads cannot include .env* files; create sandbox secrets and pass refs with --env-ref");
  }
}

function isSandboxEnvFileName(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

function globBasenameToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

async function runSandboxTemplateSetupCommands(
  client: OpenPondSandboxClient,
  sandboxId: string,
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>,
): Promise<Array<{ command: string; status: string; exitCode: number | null }>> {
  const timeoutSeconds =
    parseIntegerOption(options.setupTimeoutSeconds, "setup-timeout-seconds") ?? 900;
  const results: Array<{ command: string; status: string; exitCode: number | null }> = [];
  for (const command of manifest.setup.commands) {
    const result = await runSandboxTemplateShellCommand(
      client,
      sandboxId,
      command,
      timeoutSeconds,
    );
    results.push({
      command,
      status: result.status,
      exitCode: result.exitCode,
    });
    if (result.status !== "succeeded" || result.exitCode !== 0) {
      throw new Error(`setup command failed: ${command}\n${result.output}`);
    }
  }
  return results;
}

async function uploadSandboxTemplateStartFiles(
  client: OpenPondSandboxClient,
  sandboxId: string,
  requests: SandboxTemplateUploadRequest[],
): Promise<SandboxTemplateUploadedFile[]> {
  const uploaded: SandboxTemplateUploadedFile[] = [];
  for (const request of requests) {
    for (const localPath of request.localPaths) {
      const contents = await fs.readFile(localPath);
      const sandboxPath = joinSandboxUploadPath(
        request.spec.targetPath,
        path.basename(localPath),
      );
      await client.uploadFileBase64(sandboxId, sandboxPath, contents.toString("base64"));
      uploaded.push({
        inputName: request.inputName,
        localPath,
        sandboxPath,
        sizeBytes: contents.byteLength,
      });
    }
  }
  return uploaded;
}

function joinSandboxUploadPath(targetPath: string, basename: string): string {
  return `${targetPath.replace(/\/+$/, "")}/${basename.replace(/^\/+/, "")}`;
}

function formatUploadedFileParams(
  uploadedFiles: SandboxTemplateUploadedFile[],
  requests: SandboxTemplateUploadRequest[],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const request of requests) {
    const files = uploadedFiles
      .filter((file) => file.inputName === request.inputName)
      .map((file) => file.sandboxPath);
    out[request.inputName] = request.spec.multiple ? files : files[0] ?? "";
  }
  return out;
}

async function runSandboxTemplateExecutable(
  client: OpenPondSandboxClient,
  sandboxId: string,
  executable: SandboxTemplateExecutable,
  input: SandboxTemplateScalarInputs,
): Promise<Record<string, unknown>> {
  await uploadSandboxTemplateReplayParams(client, sandboxId, input);
  const command = formatSandboxTemplateCommand(executable);
  const timeoutSeconds = executable.timeoutSeconds;
  if (executable.kind === "service") {
    const result = await client.startProcess(sandboxId, {
      command,
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    });
    return { kind: "service", process: result.process };
  }
  const result = await runSandboxTemplateProcessToCompletion(
    client,
    sandboxId,
    command,
    timeoutSeconds ?? 900,
  );
  if (result.status !== "succeeded" || result.exitCode !== 0) {
    throw new Error(`template command failed: ${executable.name}\n${result.output}`);
  }
  return { kind: executable.kind, process: result };
}

async function runSandboxTemplateShellCommand(
  client: OpenPondSandboxClient,
  sandboxId: string,
  command: string,
  timeoutSeconds?: number,
): Promise<{
  command: string;
  status: string;
  output: string;
  exitCode: number | null;
}> {
  return runSandboxTemplateProcessToCompletion(client, sandboxId, command, timeoutSeconds ?? 900);
}

async function uploadSandboxTemplateReplayParams(
  client: OpenPondSandboxClient,
  sandboxId: string,
  input: SandboxTemplateScalarInputs,
): Promise<void> {
  const paramsJson = `${JSON.stringify({ input }, null, 2)}\n`;
  await client.uploadFileBase64(
    sandboxId,
    "openpond-replay-params.json",
    Buffer.from(paramsJson, "utf8").toString("base64"),
  );
}

async function runSandboxTemplateProcessToCompletion(
  client: OpenPondSandboxClient,
  sandboxId: string,
  command: string,
  timeoutSeconds: number,
): Promise<{
  command: string;
  status: string;
  output: string;
  exitCode: number | null;
  processId: string;
}> {
  const started = await client.startProcess(sandboxId, { command, timeoutSeconds });
  let current = started.process;
  const deadline = Date.now() + timeoutSeconds * 1000 + 30_000;
  while (current.status === "running" && Date.now() < deadline) {
    await sleep(3_000);
    const polled = await client.getProcess(sandboxId, current.id);
    current = polled.process;
  }
  return {
    command: current.command,
    status: current.status,
    output: current.output,
    exitCode: current.exitCode,
    processId: current.id,
  };
}

function formatSandboxTemplateCommand(executable: SandboxTemplateExecutable): string {
  const paramsPath = quoteShellArg(replayParamsPathForExecutable(executable));
  const envPrefix = `OPENPOND_REPLAY_PARAMS_BASE64="$(base64 -w0 ${paramsPath} 2>/dev/null || base64 ${paramsPath} | tr -d '\\n')"`;
  const command = `${envPrefix} ${executable.command}`;
  if (!executable.cwd) return command;
  return `cd ${quoteShellArg(executable.cwd)} && ${command}`;
}

function replayParamsPathForExecutable(executable: SandboxTemplateExecutable): string {
  if (!executable.cwd) return "openpond-replay-params.json";
  const cwd = executable.cwd.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  return path.posix.relative(cwd, "openpond-replay-params.json") || "openpond-replay-params.json";
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function openSandboxTemplatePorts(
  client: OpenPondSandboxClient,
  sandboxId: string,
  ports: SandboxTemplatePort[],
): Promise<Array<Record<string, unknown>>> {
  const previews: Array<Record<string, unknown>> = [];
  for (const port of ports) {
    const result = await client.openPort(sandboxId, {
      port: port.port,
      ...(port.label ? { label: port.label } : {}),
      access: port.access,
      autoStart: false,
    });
    previews.push(result.preview as unknown as Record<string, unknown>);
  }
  return previews;
}

function resolveSandboxTemplateFilePath(options: Record<string, string | boolean>): string {
  const rawFile =
    typeof options.file === "string" && options.file.trim().length > 0
      ? options.file.trim()
      : typeof options.manifest === "string" && options.manifest.trim().length > 0
        ? options.manifest.trim()
        : OPENPOND_MANIFEST_FILE_NAME;
  return path.resolve(process.cwd(), rawFile);
}

function resolveSandboxTemplateScaffoldPath(options: Record<string, string | boolean>): string {
  const rawPath =
    typeof options.path === "string" && options.path.trim().length > 0
      ? options.path.trim()
      : typeof options.dir === "string" && options.dir.trim().length > 0
        ? options.dir.trim()
        : process.cwd();
  return path.resolve(process.cwd(), rawPath);
}

function printHelp(): void {
  console.log("OpenPond CLI (API key only)");
  console.log("");
  console.log("Usage:");
  console.log("  openpond --version");
  console.log("  openpond --check-update");
  console.log("  openpond login [--api-key <key>]");
  console.log("  openpond profiles list");
  console.log("  openpond profiles use <name>");
  console.log(
    "  openpond profiles save <name> --api-key <key> [--base-url <url>] [--api-base-url <url>] [--chat-api-base-url <url>]",
  );
  console.log("  openpond account");
  console.log("  openpond health");
  console.log("  openpond tool list <handle>/<repo>");
  console.log("  openpond tool run <handle>/<repo> <tool> [--body <json>] [--method <METHOD>]");
  console.log(
    "  openpond backtest run <handle>/<repo> <tool> [--body <json>] [--branch <branch>] [--deployment-id <id>]",
  );
  console.log(
    "  openpond backtest events <handle>/<repo> [--run-id <id>] [--source <source>] [--status <csv>] [--symbol <symbol>] [--wallet-address <0x...>] [--since <ms|iso>] [--until <ms|iso>] [--limit <n>] [--cursor <cursor>] [--params <json>]",
  );
  console.log("  openpond backtest get <handle>/<repo> --run-id <id>");
  console.log("  openpond deploy watch <handle>/<repo> [--branch <branch>]");
  console.log("  openpond template status <handle>/<repo>");
  console.log("  openpond template branches <handle>/<repo>");
  console.log("  openpond template update <handle>/<repo> [--env preview|production]");
  console.log(`  openpond sandbox-template validate [--file ${OPENPOND_MANIFEST_FILE_NAME}]`);
  console.log("  openpond sandbox-template print-schema");
  console.log("  openpond sandbox-template scaffold [--path <dir>] [--name <name>]");
  console.log(`  openpond sandbox-template build [--file ${OPENPOND_MANIFEST_FILE_NAME}] [--output dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}]`);
  console.log(`  openpond sandbox-template run [--file ${OPENPOND_MANIFEST_FILE_NAME}|--build dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}] [--target <name>|--action <name>|--service <name>]`);
  console.log(`  openpond sandbox-template dev [--file ${OPENPOND_MANIFEST_FILE_NAME}|--build dist/${SANDBOX_TEMPLATE_BUILD_PLAN_FILE_NAME}] [--service <name>]`);
  console.log(
    `  openpond sandbox-template start [--file ${OPENPOND_MANIFEST_FILE_NAME}] [--env-ref NAME=openpond://secret/...] [--input-file name=path] [--input-files name=glob] [--target <name>|--action <name>|--service <name>] [--enable-schedules [all|name,...]|--disable-schedules [all|name,...]] [--schedule-overrides <json>] [--commit] [--no-push]`,
  );
  console.log(`  openpond sandbox-template action <sandboxId> <actionName> [--file ${OPENPOND_MANIFEST_FILE_NAME}]`);
  console.log(
    "  openpond repo create --name <name> [--team-id <id>] [--path <dir>] [--template <owner/repo|url>] [--template-branch <branch>] [--env <json>] [--empty|--opentool] [--token] [--auto-schedule-migration <true|false>]",
  );
  console.log("  openpond repo push [--path <dir>] [--branch <branch>]");
  console.log("  openpond organizations list");
  console.log("  openpond organizations create --name <name> [--slug <slug>] [--primary-contact-email <email>]");
  console.log("  openpond organizations update <slug> [--name <name>] [--status active|disabled|archived]");
  console.log("  openpond organizations members <slug>");
  console.log("  openpond organizations member-upsert <slug> --email <email> --role owner|admin|member");
  console.log("  openpond organizations mcp-get <slug>");
  console.log("  openpond organizations mcp-generate <slug> [--origin <url>] [--toolset <csv>]");
  console.log("  openpond organizations mcp-rotate <slug>");
  console.log("  openpond organizations mcp-disable <slug>");
  console.log("  openpond organizations mcp-enable <slug>");
  console.log("  openpond organizations mcp-probe <slug> [--origin <url>] [--tool <name>] [--arguments <json>] [--access-token <token>]");
  console.log("  openpond organizations mcp-authorize <slug> [--origin <url>] [--scope <csv|space>] [--tool <name>] [--arguments <json>] [--open]");
  console.log("  openpond sandbox list [--env staging] [--sandbox-api-url <url>]");
  console.log("  openpond sandbox mcp-config [--env staging] [--sandbox-api-url <url>]");
  console.log("  openpond sandbox secrets [--team-id <id>] [--json]");
  console.log("  openpond sandbox secret-create --name <ENV_NAME> [--team-id <id>] [--stdin]");
  console.log("  openpond sandbox secret-rotate <secretId> [--team-id <id>] [--stdin]");
  console.log("  openpond sandbox secret-revoke <secretId> [--team-id <id>]");
  console.log("  openpond sandbox secret-delete <secretId> [--team-id <id>]");
  console.log("  openpond sandbox secret-attach <secretId> --env-name <ENV_NAME> --target-type sandbox|template|app|replay --target-id <id>");
  console.log("  openpond sandbox snapshots [--team-id <id>] [--app-id <id>]");
  console.log("  openpond sandbox templates [--team-id <id>] [--app-id <id>] [--query <text>] [--name <name>] [--use-case <id>]");
  console.log("  openpond sandbox template-builds --team-id <id>");
  console.log("  openpond sandbox template-build-create --team-id <id> --source-repo-url <url> [--branch <branch>] [--publish]");
  console.log("  openpond sandbox template-build-get <buildId>");
  console.log("  openpond sandbox template-build-logs <buildId>");
  console.log("  openpond sandbox template-build-cancel <buildId>");
  console.log("  openpond sandbox template-build-watch <buildId> [--interval-ms 5000] [--timeout-ms 900000]");
  console.log("  openpond sandbox replay-start --team-id <id> --snapshot-id <id> [--entrypoint <name>] [--params <json>] [--artifact-paths <csv>]");
  console.log("  openpond sandbox replay-get <replayId> [--team-id <id>]");
  console.log("  openpond sandbox replay-logs <replayId> [--team-id <id>]");
  console.log("  openpond sandbox replay-cancel <replayId> [--team-id <id>]");
  console.log("  openpond sandbox replay-watch <replayId> [--team-id <id>] [--interval-ms 5000] [--timeout-ms 900000]");
  console.log("  openpond sandbox replay-artifacts <replayId> [--team-id <id>]");
  console.log("  openpond sandbox template-launch [--snapshot-id <id>|--template-name <name>|--use-case <id>] [--version <v>] [--team-id <id>] [--budget-usd 0.05]");
  console.log(
    "  openpond sandbox snapshot-fork <snapshotId> [--team-id <id>] [--app-id <id>] [--budget-usd 0.05]",
  );
  console.log(
    "  openpond sandbox snapshot-create <sandboxId> --name <name> [--template-name <name>] [--template-version <v>] [--template-visibility private|team] [--validation-command <cmd>]",
  );
  console.log(
    "  openpond sandbox snapshot-validate <sandboxId> <snapshotId> [--cleanup delete|stop|archive]",
  );
  console.log("  openpond sandbox snapshot-publish <sandboxId> <snapshotId>");
  console.log(
    "  openpond sandbox create [--repo <url>] [--budget-usd 0.05] [--env-ref NAME=openpond://secret/...] [--env-literal NAME=value]",
  );
  console.log('  openpond sandbox exec <sandboxId> --command "bun test"');
  console.log(
    "  openpond sandbox port <sandboxId> --port 4173 [--access private|public] [--auto-start] [--domain app.example.com] [--auth-token <token>|--auth-header <name> --auth-header-value <value>]",
  );
  console.log("  openpond sandbox stop <sandboxId>");
  console.log("  openpond sandbox delete <sandboxId>");
  console.log("  openpond sandbox receipts <sandboxId>");
  console.log("  openpond sandbox logs <sandboxId>");
  console.log("  openpond sandbox billing <sandboxId>");
  console.log("  openpond sandbox integration-connections [--team-id <id>] [--app-id <id>] [--status active|all]");
  console.log("  openpond sandbox integration-leases <sandboxId>");
  console.log(
    "  openpond sandbox integration-attach <sandboxId> --integration-connection <id> --integration-capabilities <csv>",
  );
  console.log("  openpond sandbox integration-remove <sandboxId> --lease-id <id>");
  console.log('  openpond sandbox process-start <sandboxId> --command "bun dev"');
  console.log("  openpond sandbox process-list <sandboxId>");
  console.log("  openpond sandbox process-get <sandboxId> <processId> [--since <cursor>]");
  console.log("  openpond sandbox process-stop <sandboxId> <processId>");
  console.log("  openpond sandbox process-stream <sandboxId> <processId> [--since <cursor>]");
  console.log('  openpond sandbox pty-start <sandboxId> [--command "/bin/sh"]');
  console.log("  openpond sandbox pty-list <sandboxId>");
  console.log("  openpond sandbox pty-get <sandboxId> <ptyId> [--since <cursor>]");
  console.log('  openpond sandbox pty-write <sandboxId> <ptyId> --input "ls"');
  console.log("  openpond sandbox pty-stop <sandboxId> <ptyId>");
  console.log("  openpond sandbox pty-stream <sandboxId> <ptyId> [--since <cursor>]");
  console.log('  openpond sandbox upload-file <sandboxId> --path <path> --contents "text"');
  console.log("  openpond sandbox download-file <sandboxId> --path <path>");
  console.log("  openpond sandbox list-files <sandboxId> [--path <path>]");
  console.log("  openpond sandbox search-files <sandboxId> --query <text> [--path <path>]");
  console.log("  openpond sandbox delete-file <sandboxId> --path <path> [--recursive]");
  console.log("  openpond sandbox stat-file <sandboxId> --path <path>");
  console.log("  openpond sandbox mkdir <sandboxId> --path <path>");
  console.log("  openpond sandbox move-file <sandboxId> --from-path <path> --to-path <path>");
  console.log("  openpond sandbox git-status <sandboxId>");
  console.log("  openpond sandbox git-diff <sandboxId> [--base-ref <ref>]");
  console.log(
    "  openpond sandbox git-branch <sandboxId> --branch <name> [--create] [--start-point <ref>]",
  );
  console.log(
    '  openpond sandbox git-commit <sandboxId> --message "..." [--all|--paths <csv>]',
  );
  console.log("  openpond sandbox git-pull <sandboxId> [--remote origin] [--branch main] [--rebase|--ff-only false]");
  console.log("  openpond sandbox git-push <sandboxId> [--remote origin] [--branch main] [--set-upstream] [--force-with-lease]");
  console.log("  openpond sandbox smoke --env staging [--account <profile>] [--keep]");
  console.log("  openpond apps list [--handle <handle>] [--refresh]");
  console.log("  openpond apps code-visibility <handle>/<repo> --visibility public|private");
  console.log("  openpond apps tools");
  console.log("  openpond apps deploy <handle>/<repo> [--env preview|production] [--watch]");
  console.log("  openpond apps env get <handle>/<repo>");
  console.log("  openpond apps env set <handle>/<repo> --env <json>");
  console.log("  openpond apps performance [--app-id <id>]");
  console.log("  openpond apps summary <handle>/<repo>");
  console.log("  openpond apps assistant <plan|performance> <handle>/<repo> --prompt <text>");
  console.log(
    "  openpond apps store events [--source <source>] [--status <csv>] [--symbol <symbol>] [--wallet-address <0x...>] [--since <ms|iso>] [--until <ms|iso>] [--limit <n>] [--cursor <cursor>] [--history <true|false>] [--params <json>]",
  );
  console.log("  openpond apps trade-facts [--app-id <id>]");
  console.log("  openpond apps agent create --prompt <text> [--team-id <id>] [--template-id <id>]");
  console.log(
    "  openpond apps tools execute <appId> <deploymentId> <tool> [--body <json>] [--method <METHOD>] [--headers <json>] [--summary <true|false>]",
  );
  console.log(
    "  openpond apps positions tx [--method <GET|POST>] [--body <json>] [--params <json>]",
  );
  console.log("  openpond check-update");
  console.log("  openpond opentool <init|validate|build> [args]");
  console.log("");
  console.log("Global options:");
  console.log("  --account <name> (alias: --profile <name>)");
  console.log("  --base-url <url> (alias: --baseurl)");
  console.log("  --api-base-url <url> (API endpoint for this profile)");
  console.log("  --chat-api-base-url <url> (hosted chat/model endpoint for this profile)");
  console.log("  --sandbox-api-url <url> (exact /v1/sandboxes or /api/sandboxes endpoint)");
  console.log("");
  console.log("Env:");
  console.log(
    "  OPENPOND_API_KEY, OPENPOND_ACCOUNT, OPENPOND_BASE_URL, OPENPOND_API_URL, OPENPOND_CHAT_API_URL, OPENPOND_TOOL_URL, OPENPOND_SANDBOX_BASE_URL, OPENPOND_SANDBOX_API_URL",
  );
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
  await saveProfileApiKey({
    handle: config.activeProfile?.handle || "default",
    apiKey,
    baseUrl,
    apiBaseUrl: config.apiBaseUrl,
    chatApiBaseUrl: config.chatApiBaseUrl,
    setActive: true,
  });
  console.log("saved api key to ~/.openpond/config.json");
}

async function runProfiles(
  options: Record<string, string | boolean>,
  rest: string[],
): Promise<void> {
  const subcommand = rest[0] || "list";
  if (subcommand === "list") {
    const profiles = await listConfiguredProfiles();
    console.log(JSON.stringify({ profiles }, null, 2));
    return;
  }

  if (subcommand === "use") {
    const handle = rest[1];
    if (!handle) {
      throw new Error("usage: profiles use <name> [--base-url <url>]");
    }
    const profile = await setActiveProfile(handle, {
      baseUrl: resolveBaseUrlOption(options),
    });
    console.log(JSON.stringify({ profile }, null, 2));
    return;
  }

  if (subcommand === "save") {
    const handle = rest[1];
    if (!handle) {
      throw new Error(
        "usage: profiles save <name> --api-key <key> [--base-url <url>] [--api-base-url <url>] [--chat-api-base-url <url>]",
      );
    }
    const rawApiKey =
      typeof options.apiKey === "string"
        ? options.apiKey
        : typeof options.key === "string"
          ? options.key
          : null;
    const apiKey = rawApiKey ? rawApiKey.trim() : await promptForApiKey();
    const environment =
      typeof options.environment === "string"
        ? options.environment
        : typeof options.env === "string"
          ? options.env
          : undefined;
    const profile = await saveProfileApiKey({
      handle,
      apiKey,
      baseUrl: resolveBaseUrlOption(options),
      apiBaseUrl: resolveApiBaseUrlOption(options),
      chatApiBaseUrl: resolveChatApiBaseUrlOption(options),
      environment,
      setActive: true,
    });
    console.log(JSON.stringify({ profile }, null, 2));
    return;
  }

  throw new Error("usage: profiles <list|use|save> [args]");
}

async function runAccount(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const account = await getOpenPondAccount(apiBase, apiKey);
  console.log(JSON.stringify(account, null, 2));
}

async function runHealth(_options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = resolveApiKey(config);
  const health = await checkOpenPondApiHealth(apiBase, apiKey);
  console.log(JSON.stringify(health, null, 2));
}

async function runToolList(options: Record<string, string | boolean>, target: string) {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const latest = await getLatestDeploymentForApp(apiBase, apiKey, app.id, {
    branch,
  });
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
      (record.name as string | undefined) || (profile?.name as string | undefined) || "unknown";
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
  toolName: string,
) {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const latest = await getLatestDeploymentForApp(apiBase, apiKey, app.id, {
    branch,
  });
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
  const method = typeof options.method === "string" ? String(options.method).toUpperCase() : "POST";
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

async function runBacktestRun(
  options: Record<string, string | boolean>,
  target: string,
  toolName: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const deploymentId =
    typeof options.deploymentId === "string" ? String(options.deploymentId) : undefined;
  const latest = deploymentId
    ? { id: deploymentId }
    : await getLatestDeploymentForApp(apiBase, apiKey, app.id, { branch });
  if (!latest?.id) {
    throw new Error("no deployments found");
  }

  const bodyRaw =
    typeof options.body === "string" ? parseJsonOption(String(options.body), "body") : {};
  if (!bodyRaw || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    throw new Error("body must be a JSON object");
  }

  const method = typeof options.method === "string" ? String(options.method).toUpperCase() : "POST";
  const payload = {
    ...(bodyRaw as Record<string, unknown>),
    appId: app.id,
    deploymentId: latest.id,
    toolName,
    method: method as "GET" | "POST" | "PUT" | "DELETE",
  };
  const result = await submitBacktestRun(apiBase, apiKey, payload);
  console.log(JSON.stringify(result, null, 2));
}

async function runDeployWatch(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app, handle, repo } = await resolveAppTarget(apiBase, apiKey, target);
  const branch = typeof options.branch === "string" ? String(options.branch) : undefined;
  const deploymentId =
    typeof options.deploymentId === "string" ? String(options.deploymentId) : undefined;
  const latest = deploymentId
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
  nameParts: string[],
): Promise<void> {
  const name = (typeof options.name === "string" ? options.name : null) || nameParts.join(" ");
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error(
      "usage: repo create --name <name> [--team-id <id>] [--path <dir>] [--template <owner/repo|url>] [--template-branch <branch>] [--empty|--opentool] [--token] [--auto-schedule-migration <true|false>]",
    );
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const teamId =
    typeof options.teamId === "string" && options.teamId.trim()
      ? options.teamId.trim()
      : undefined;

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
    const response = await createHeadlessApps(
      apiBase,
      apiKey,
      [
        {
          name: trimmedName,
          ...(description ? { description } : {}),
          templateRepoUrl,
          ...(templateBranch ? { templateBranch } : {}),
          ...(envVars ? { envVars } : {}),
        },
      ],
      teamId,
    );
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
    const proceed = await promptConfirm(`Directory is not empty (${repoPath}). Continue?`, false);
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
        `git init failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
      );
    }
  }

  const originUrl = await getGitRemoteUrl(repoPath, "origin");
  if (originUrl && !force) {
    const proceed = await promptConfirm(
      `Remote "origin" already set (${originUrl}). Replace it?`,
      false,
    );
    if (!proceed) {
      console.log("aborted");
      return;
    }
  }

  const repoInit = options.opentool === "true" ? "opentool" : "empty";
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
    ...(teamId ? { teamId } : {}),
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
      `git remote failed: ${redactToken(
        remoteResult.stderr.trim() || remoteResult.stdout.trim() || "unknown error",
      )}`,
    );
  }

  const displayRemote = useTokenRemote ? formatTokenizedRepoUrlForPrint(repoUrl) : repoUrl;
  console.log(`app_id: ${response.appId}`);
  if (response.gitOwner && response.gitRepo) {
    console.log(`repo: ${response.gitOwner}/${response.gitRepo}`);
  }
  console.log(`remote: ${displayRemote}`);
  console.log('next: git add . && git commit -m "init"');
  const defaultBranch = response.defaultBranch || "master";
  console.log(`next: openpond repo push --path ${repoPath} --branch ${defaultBranch}`);
  if (!useTokenRemote) {
    console.log(
      `token-remote (non-interactive): git -C ${repoPath} remote set-url origin ${formatTokenizedRepoUrlForPrint(
        repoUrl,
      )}`,
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
      const setResult = await runCommand("git", ["remote", "set-url", "origin", tokenRemote], {
        cwd: repoPath,
      });
      if (setResult.code !== 0) {
        throw new Error(
          `git remote set-url failed: ${redactToken(
            setResult.stderr.trim() || setResult.stdout.trim() || "unknown error",
          )}`,
        );
      }
    }

    const pushResult = await runCommand("git", ["push", "-u", "origin", resolvedBranch], {
      cwd: repoPath,
      inherit: true,
    });
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

async function runCheckUpdate(): Promise<void> {
  const packageName = "openpond-code";
  const installed = getInstalledCliVersion();
  const latest = await fetchLatestNpmVersion(packageName);
  const installCommand = `npm i -g ${packageName}@${latest}`;
  const cmp = compareSemver(installed, latest);

  if (cmp === 0) {
    console.log(`${packageName} is up to date (${installed})`);
    return;
  }

  if (cmp === -1) {
    console.log(`Update available: ${installed} -> ${latest}`);
    console.log(`Run: ${installCommand}`);
    return;
  }

  if (cmp === 1) {
    console.log(`Installed version (${installed}) is newer than npm latest (${latest}).`);
    return;
  }

  if (installed === latest) {
    console.log(`${packageName} is up to date (${installed})`);
    return;
  }

  console.log(`Installed: ${installed}`);
  console.log(`Latest: ${latest}`);
  console.log(`Run: ${installCommand}`);
}

async function runAppsTools(): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const tools = await fetchToolsWithCache({ apiBase, apiKey });
  console.log(JSON.stringify(tools, null, 2));
}

async function runAppsList(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
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
    const repo = app.repo || app.gitRepo || app.id;
    const status = app.latestDeployment?.status || "no-deploy";
    const branch = app.latestDeployment?.gitBranch || app.defaultBranch || "-";
    const codeVisibility = app.codeVisibility || "unknown";
    console.log(
      `${owner}/${repo}  ${status}  ${branch}  code=${codeVisibility}  ${app.id}`,
    );
  }
}

async function runAppsCodeVisibility(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const visibility =
    typeof options.visibility === "string"
      ? options.visibility.trim()
      : typeof options.codeVisibility === "string"
      ? options.codeVisibility.trim()
      : "";

  if (visibility !== "public" && visibility !== "private") {
    throw new Error(
      "usage: apps code-visibility <handle>/<repo> --visibility public|private",
    );
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app, handle, repo } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await updateAppCodeVisibility(
    apiBase,
    apiKey,
    app.id,
    visibility,
  );
  console.log(
    `${handle}/${repo} code_visibility=${result.app?.codeVisibility ?? visibility} app_id=${app.id}`,
  );
}

async function runAppsPerformance(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const appId = typeof options.appId === "string" ? String(options.appId) : undefined;
  const performance = await getUserPerformance(apiBase, apiKey, { appId });
  console.log(JSON.stringify(performance, null, 2));
}

async function runAppsSummary(
  _options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const summary = await getAppRuntimeSummary(apiBase, apiKey, app.id);
  console.log(JSON.stringify(summary, null, 2));
}

async function runAppsAssistant(
  options: Record<string, string | boolean>,
  mode: "plan" | "performance",
  target: string,
  contentParts: string[],
): Promise<void> {
  const prompt =
    (typeof options.prompt === "string" ? options.prompt : null) || contentParts.join(" ");
  if (!prompt.trim()) {
    throw new Error("usage: apps assistant <plan|performance> <handle>/<repo> --prompt <text>");
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
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
  contentParts: string[],
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const prompt =
    (typeof options.prompt === "string" ? options.prompt : null) || contentParts.join(" ");
  if (!prompt.trim()) {
    throw new Error("usage: apps agent create --prompt <text> [--team-id <id>]");
  }
  const templateRepoUrl =
    typeof options.templateRepoUrl === "string" ? options.templateRepoUrl : undefined;
  const templateBranch =
    typeof options.templateBranch === "string" ? options.templateBranch : undefined;
  const templateLocalPath =
    typeof options.templateLocalPath === "string" ? options.templateLocalPath : undefined;
  const teamId =
    typeof options.teamId === "string" && options.teamId.trim()
      ? options.teamId.trim()
      : undefined;
  if (templateLocalPath && String(templateLocalPath).trim().length > 0) {
    throw new Error("templateLocalPath is not supported; use templateRepoUrl");
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
    templateRepoUrl || templateBranch || envVars
      ? {
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
    ...(teamId ? { teamId } : {}),
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
  toolName: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
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
    typeof options.body === "string" ? parseJsonOption(String(options.body), "body") : undefined;
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
  target: string,
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
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await updateAppEnvironment(apiBase, apiKey, app.id, {
    envVars,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsEnvGet(
  _options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await getAppEnvironment(apiBase, apiKey, app.id);
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsDeploy(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiBase = resolvePublicApiBaseUrl(config);
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

async function runAppsPositionsTx(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
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
  options: Record<string, string | boolean>,
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
    typeof options.walletAddress === "string" ? options.walletAddress.trim() : undefined,
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

function resolveBacktestEventsParams(
  options: Record<string, string | boolean>,
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
    typeof options.walletAddress === "string" ? options.walletAddress.trim() : undefined,
  );
  addParam("symbol", typeof options.symbol === "string" ? options.symbol.trim() : undefined);
  addParam("cursor", typeof options.cursor === "string" ? options.cursor.trim() : undefined);
  addParam("status", typeof options.status === "string" ? options.status.trim() : undefined);
  addParam(
    "backtestRunId",
    typeof options.runId === "string"
      ? options.runId.trim()
      : typeof options.backtestRunId === "string"
        ? options.backtestRunId.trim()
        : undefined,
  );
  addParam("since", parseTimeOption(options.since, "since"));
  addParam("until", parseTimeOption(options.until, "until"));

  if (typeof options.limit === "string" && options.limit.trim().length > 0) {
    const parsed = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("limit must be a number");
    }
    addParam("limit", String(parsed));
  }

  return Object.keys(params).length ? params : undefined;
}

async function runAppsStoreEvents(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const query = resolveStoreEventsParams(options);
  const result = await submitPositionsTx(apiBase, apiKey, {
    method: "GET",
    query,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runBacktestEvents(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const query = {
    ...(resolveBacktestEventsParams(options) ?? {}),
    appId: app.id,
  };
  const result = await submitBacktestTx(apiBase, apiKey, {
    method: "GET",
    query,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runBacktestGet(
  options: Record<string, string | boolean>,
  target: string,
): Promise<void> {
  const runId =
    typeof options.runId === "string"
      ? options.runId.trim()
      : typeof options.backtestRunId === "string"
        ? options.backtestRunId.trim()
        : "";
  if (!runId) {
    throw new Error("usage: backtest get <handle>/<repo> --run-id <id>");
  }

  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
  const { app } = await resolveAppTarget(apiBase, apiKey, target);
  const result = await submitBacktestDetail(apiBase, apiKey, {
    appId: app.id,
    runId,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runAppsTradeFacts(options: Record<string, string | boolean>): Promise<void> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const apiBase = resolvePublicApiBaseUrl(config);
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

async function resolveSandboxClient(
  options: Record<string, string | boolean>,
): Promise<OpenPondSandboxClient> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const sandboxApiUrl =
    resolveSandboxApiUrlOption(options) || process.env.OPENPOND_SANDBOX_API_URL?.trim() || null;
  return createOpenPondSandboxClient(
    sandboxApiUrl
      ? { apiKey, sandboxApiUrl }
      : { apiKey, baseUrl: resolveSandboxBaseUrl(config, options) },
  );
}

function formatSandboxLine(sandbox: SandboxRecord): string {
  const mppMode = sandbox.reservation.mpp?.mode ?? "no-mpp";
  const captured = sandbox.reservation.capturedUsd;
  const budget = sandbox.budget.maxUsd;
  const repo = sandbox.repo ?? "-";
  return [
    sandbox.id,
    sandbox.state,
    sandbox.runtimeDriver,
    `spent=${captured}/${budget}`,
    mppMode,
    repo,
  ].join("  ");
}

function formatSnapshotCatalogLine(snapshot: {
  id: string;
  kind: string;
  sandboxId: string;
  name: string;
  storage: string | null;
  sizeGb: number | null;
  template?: {
    name: string;
    version: string;
  } | null;
  replay?: {
    state?: string | null;
    retention?: {
      class?: string | null;
    } | null;
  } | null;
  storageCost?: {
    estimatedMonthlyUsd: string | null;
    retentionClass: string | null;
  } | null;
  createdAt: string;
}): string {
  const template = snapshot.template
    ? `${snapshot.template.name}@${snapshot.template.version}`
    : "-";
  const retention =
    snapshot.replay?.retention?.class ??
    snapshot.storageCost?.retentionClass ??
    "-";
  const replayState = snapshot.replay?.state ?? "-";
  const monthlyUsd = snapshot.storageCost?.estimatedMonthlyUsd ?? "-";
  return [
    snapshot.id,
    snapshot.kind,
    snapshot.name,
    snapshot.sandboxId,
    `storage=${snapshot.storage ?? "-"}`,
    `sizeGb=${snapshot.sizeGb ?? "-"}`,
    `template=${template}`,
    `replay=${replayState}`,
    `retention=${retention}`,
    `monthlyUsd=${monthlyUsd}`,
    snapshot.createdAt,
  ].join("  ");
}

function formatSandboxTemplateLine(template: {
  snapshotId: string;
  sandboxId: string;
  name: string;
  version: string;
  visibility: string;
  useCase: string | null;
  tags?: string[];
  replay?: {
    state?: string | null;
    retention?: {
      class?: string | null;
    } | null;
  } | null;
  storageCost?: {
    estimatedMonthlyUsd: string | null;
    retentionClass: string | null;
  } | null;
  createdAt: string;
}): string {
  const tags = template.tags && template.tags.length > 0 ? template.tags.join(",") : "-";
  const retention =
    template.replay?.retention?.class ??
    template.storageCost?.retentionClass ??
    "-";
  const replayState = template.replay?.state ?? "-";
  const monthlyUsd = template.storageCost?.estimatedMonthlyUsd ?? "-";
  return [
    template.name,
    `version=${template.version}`,
    `snapshot=${template.snapshotId}`,
    `sandbox=${template.sandboxId}`,
    `visibility=${template.visibility}`,
    `useCase=${template.useCase ?? "-"}`,
    `tags=${tags}`,
    `replay=${replayState}`,
    `retention=${retention}`,
    `monthlyUsd=${monthlyUsd}`,
    template.createdAt,
  ].join("  ");
}

function formatOrganizationLine(organization: OpenPondOrganization): string {
  return [
    organization.slug,
    `team=${organization.teamId}`,
    `role=${organization.role}`,
    `status=${organization.status}`,
    organization.displayName,
  ].join("  ");
}

function formatOrganizationMemberLine(member: OpenPondOrganizationMember): string {
  return [
    member.email ?? member.userId,
    `user=${member.userId}`,
    `role=${member.role}`,
    member.createdAt,
  ].join("  ");
}

function formatOrganizationMcpServerLine(
  server: OpenPondOrganizationMcpServer | null,
): string {
  if (!server) return "no mcp server configured";
  return [
    server.slug,
    `team=${server.teamId}`,
    `status=${server.status}`,
    `tools=${server.toolset.join(",") || "-"}`,
    server.resourceUrl,
  ].join("  ");
}

type McpProbeHttpResult = {
  url: string;
  status: number;
  ok: boolean;
  headers: {
    contentType: string | null;
    location: string | null;
    wwwAuthenticate: string | null;
  };
  body: unknown;
};

const DEFAULT_MCP_AUTHORIZE_SCOPES = [
  "estimate.read",
  "estimate.write",
  "estimate.execute",
  "artifacts.read",
  "artifacts.write",
] as const;

type McpOAuthTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type McpOAuthCallbackListener = {
  close: () => Promise<void>;
  redirectUri: string;
  waitForCallback: () => Promise<{ code: string; state: string }>;
};

function normalizeMcpResourceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (!trimmed) {
    throw new Error("MCP resource URL must be non-empty");
  }
  const parsed = new URL(trimmed);
  return parsed.toString().replace(/\/$/, "");
}

function resolveMcpProbeResourceUrl(
  server: OpenPondOrganizationMcpServer | null,
  options: Record<string, string | boolean>,
): string {
  const explicit =
    typeof options.resourceUrl === "string" && options.resourceUrl.trim()
      ? options.resourceUrl.trim()
      : typeof options.url === "string" && options.url.trim()
        ? options.url.trim()
        : "";
  if (explicit) {
    return normalizeMcpResourceUrl(explicit);
  }
  if (!server?.resourceUrl) {
    throw new Error("organization does not have an MCP server; run organizations mcp-generate first");
  }
  return normalizeMcpResourceUrl(server.resourceUrl);
}

function resolveMcpProbeOrigin(
  resourceUrl: string,
  options: Record<string, string | boolean>,
): string {
  const explicit =
    typeof options.origin === "string" && options.origin.trim()
      ? options.origin.trim()
      : "";
  if (explicit) {
    return normalizeMcpResourceUrl(explicit);
  }
  return new URL(resourceUrl).origin;
}

function randomOauthToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function buildMcpOauthPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function parseMcpOAuthScopes(options: Record<string, string | boolean>): string[] {
  const raw =
    typeof options.scope === "string" && options.scope.trim()
      ? options.scope
      : typeof options.scopes === "string" && options.scopes.trim()
        ? options.scopes
        : "";
  if (!raw) {
    return [...DEFAULT_MCP_AUTHORIZE_SCOPES];
  }
  const scopes = raw
    .split(/[,\s]+/g)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0) {
    throw new Error("scope must include at least one OAuth scope");
  }
  return scopes;
}

function resolveMcpOAuthClientId(options: Record<string, string | boolean>): string {
  const value =
    typeof options.clientId === "string" && options.clientId.trim()
      ? options.clientId.trim()
      : "openpond-code-mcp-proof";
  if (value === "true") {
    throw new Error("client-id must be a non-empty value");
  }
  return value;
}

function resolveMcpOAuthTimeoutMs(options: Record<string, string | boolean>): number {
  const timeoutSeconds =
    parseIntegerOption(options.timeoutSeconds, "timeout-seconds") ??
    parseIntegerOption(options.timeout, "timeout") ??
    180;
  if (timeoutSeconds <= 0) {
    throw new Error("timeout must be greater than zero");
  }
  return timeoutSeconds * 1000;
}

function resolveMcpOAuthCallbackPort(options: Record<string, string | boolean>): number {
  const port = parseIntegerOption(options.callbackPort, "callback-port") ?? 0;
  if (port < 0 || port > 65535) {
    throw new Error("callback-port must be between 0 and 65535");
  }
  return port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startMcpOAuthCallbackListener(input: {
  expectedState: string;
  port: number;
  timeoutMs: number;
}): Promise<McpOAuthCallbackListener> {
  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let resolveCallback:
    | ((value: { code: string; state: string }) => void)
    | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;
  const callbackPromise = new Promise<{ code: string; state: string }>(
    (resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    },
  );

  const settle = (
    response: ServerResponse,
    status: number,
    body: string,
    result?: { code: string; state: string },
    error?: Error,
  ) => {
    if (settled) {
      response.writeHead(204).end();
      return;
    }
    settled = true;
    response.writeHead(status, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(body);
    if (timeout) clearTimeout(timeout);
    if (result) {
      resolveCallback?.(result);
    } else {
      rejectCallback?.(error ?? new Error("oauth_callback_failed"));
    }
  };

  const server = createServer((request, response) => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (state !== input.expectedState) {
      settle(
        response,
        400,
        "<!doctype html><title>OpenPond OAuth failed</title><p>State mismatch. Return to the terminal and retry.</p>",
        undefined,
        new Error("oauth_state_mismatch"),
      );
      return;
    }
    if (error) {
      settle(
        response,
        400,
        "<!doctype html><title>OpenPond OAuth denied</title><p>Authorization was not completed. Return to the terminal.</p>",
        undefined,
        new Error(`oauth_authorization_failed:${error}`),
      );
      return;
    }
    if (!code) {
      settle(
        response,
        400,
        "<!doctype html><title>OpenPond OAuth failed</title><p>Missing authorization code. Return to the terminal and retry.</p>",
        undefined,
        new Error("oauth_code_missing"),
      );
      return;
    }
    settle(
      response,
      200,
      "<!doctype html><title>OpenPond OAuth complete</title><p>Authorization complete. You can return to the terminal.</p>",
      { code, state },
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(input.port, "127.0.0.1");
  });

  const address = server.address() as AddressInfo | null;
  if (!address || typeof address.port !== "number") {
    await closeServer(server);
    throw new Error("oauth_callback_listener_failed");
  }

  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCallback?.(new Error("oauth_callback_timeout"));
    }
  }, input.timeoutMs);

  return {
    close: async () => {
      if (timeout) clearTimeout(timeout);
      await closeServer(server).catch(() => {});
    },
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    waitForCallback: () => callbackPromise,
  };
}

function openUrlWithSystemBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function buildMcpOAuthAuthorizeUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resourceUrl: string;
  scopes: string[];
  state: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resourceUrl);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function exchangeMcpOAuthAuthorizationCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  origin: string;
  redirectUri: string;
}): Promise<McpOAuthTokenResponse> {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", input.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("code", input.code);
  params.set("code_verifier", input.codeVerifier);

  const response = await fetch(`${input.origin}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = await readMcpProbeBody(response);
  if (!response.ok) {
    throw new Error(`oauth_token_exchange_failed:${response.status}:${JSON.stringify(body)}`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("oauth_token_exchange_invalid_response");
  }
  const token = body as Record<string, unknown>;
  if (typeof token.access_token !== "string" || !token.access_token.trim()) {
    throw new Error("oauth_token_exchange_missing_access_token");
  }
  return {
    access_token: token.access_token,
    ...(typeof token.expires_in === "number" ? { expires_in: token.expires_in } : {}),
    ...(typeof token.refresh_token === "string" ? { refresh_token: token.refresh_token } : {}),
    ...(typeof token.scope === "string" ? { scope: token.scope } : {}),
    ...(typeof token.token_type === "string" ? { token_type: token.token_type } : {}),
  };
}

async function readMcpProbeBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.toLowerCase().includes("application/json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

async function fetchMcpProbe(
  url: string,
  init: RequestInit = {},
): Promise<McpProbeHttpResult> {
  const response = await fetch(url, init);
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: {
      contentType: response.headers.get("content-type"),
      location: response.headers.get("location"),
      wwwAuthenticate: response.headers.get("www-authenticate"),
    },
    body: await readMcpProbeBody(response),
  };
}

function buildMcpJsonRpcRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  return params
    ? { jsonrpc: "2.0", id, method, params }
    : { jsonrpc: "2.0", id, method };
}

function parseMcpToolArguments(
  options: Record<string, string | boolean>,
): Record<string, unknown> {
  const raw =
    typeof options.arguments === "string" && options.arguments.trim()
      ? options.arguments
      : typeof options.args === "string" && options.args.trim()
        ? options.args
        : "";
  if (!raw) {
    return {};
  }
  const parsed = parseJsonOption(raw, "arguments");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function postMcpJsonRpcProbe(input: {
  resourceUrl: string;
  id: number;
  method: string;
  params?: Record<string, unknown>;
  accessToken?: string;
}): Promise<McpProbeHttpResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (input.accessToken) {
    headers.authorization = `Bearer ${input.accessToken}`;
  }
  return fetchMcpProbe(input.resourceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(buildMcpJsonRpcRequest(input.id, input.method, input.params)),
  });
}

async function probeOrganizationMcp(input: {
  resourceUrl: string;
  origin: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  accessToken?: string;
}): Promise<Record<string, unknown>> {
  const resourceUrl = normalizeMcpResourceUrl(input.resourceUrl);
  const origin = normalizeMcpResourceUrl(input.origin);
  const protectedResourceUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
  const authorizationServerUrl = `${origin}/.well-known/oauth-authorization-server`;
  const [
    protectedResource,
    authorizationServer,
    directGetChallenge,
    initialize,
    toolsList,
    unauthenticatedToolCall,
    authenticatedToolCall,
  ] = await Promise.all([
    fetchMcpProbe(protectedResourceUrl),
    fetchMcpProbe(authorizationServerUrl),
    fetchMcpProbe(resourceUrl),
    postMcpJsonRpcProbe({
      resourceUrl,
      id: 1,
      method: "initialize",
    }),
    postMcpJsonRpcProbe({
      resourceUrl,
      id: 2,
      method: "tools/list",
    }),
    postMcpJsonRpcProbe({
      resourceUrl,
      id: 3,
      method: "tools/call",
      params: {
        name: input.toolName,
        arguments: input.toolArguments,
      },
    }),
    input.accessToken
      ? postMcpJsonRpcProbe({
          resourceUrl,
          id: 4,
          method: "tools/call",
          params: {
            name: input.toolName,
            arguments: input.toolArguments,
          },
          accessToken: input.accessToken,
        })
      : Promise.resolve(null),
  ]);

  return {
    resourceUrl,
    origin,
    protectedResource,
    authorizationServer,
    directGetChallenge,
    initialize,
    toolsList,
    unauthenticatedToolCall,
    ...(authenticatedToolCall ? { authenticatedToolCall } : {}),
  };
}

function formatTemplateBuildLine(build: SandboxTemplateBuildRecord): string {
  return [
    build.id,
    `team=${build.teamId}`,
    `status=${build.status}`,
    `publish=${build.publishStatus ?? "-"}`,
    `source=${build.sourceRepoUrl}`,
    `branch=${build.sourceBranch}`,
    `snapshot=${build.snapshotId ?? "-"}`,
    `error=${build.error ?? "-"}`,
    build.createdAt ?? "-",
  ].join("  ");
}

function formatReplayLine(replay: SandboxReplayRecord): string {
  return [
    replay.id,
    `team=${replay.teamId}`,
    `state=${replay.state}`,
    `snapshot=${replay.snapshotId}`,
    `sandbox=${replay.sandboxId ?? "-"}`,
    `command=${replay.commandId ?? "-"}`,
    `exit=${replay.exitCode ?? "-"}`,
    `cleanup=${replay.cleanup.action}:${replay.cleanup.status}`,
    `error=${replay.error ?? "-"}`,
    replay.createdAt,
  ].join("  ");
}

function summarizeReplayArtifact(artifact: SandboxReplayArtifact): Record<string, unknown> {
  return {
    path: artifact.path,
    status: artifact.status,
    sizeBytes: artifact.sizeBytes,
    error: artifact.error,
    ...(artifact.contentsBase64
      ? {
          contentsBase64: artifact.contentsBase64,
        }
      : {}),
  };
}

function normalizeSnapshotValidationCleanup(
  value: unknown,
): SandboxSnapshotValidateInput["cleanup"] | undefined {
  if (typeof value !== "string") return undefined;
  const cleanup = value.trim();
  if (cleanup === "delete" || cleanup === "stop" || cleanup === "archive") {
    return cleanup;
  }
  throw new Error("snapshot-validate --cleanup must be delete, stop, or archive");
}

function normalizeReplayCleanup(value: unknown): SandboxReplayInput["cleanup"] | undefined {
  if (typeof value !== "string") return undefined;
  const cleanup = value.trim();
  if (cleanup === "delete" || cleanup === "stop" || cleanup === "archive") {
    return cleanup;
  }
  throw new Error("replay cleanup must be delete, stop, or archive");
}

function buildSandboxReplayInput(
  options: Record<string, string | boolean>,
): SandboxReplayInput & { teamId?: string; appId?: string } {
  const snapshotId =
    typeof options.snapshotId === "string" && options.snapshotId.trim()
      ? options.snapshotId.trim()
      : typeof options.snapshot === "string" && options.snapshot.trim()
        ? options.snapshot.trim()
        : "";
  if (!snapshotId) {
    throw new Error("replay-start requires --snapshot-id <id>");
  }
  const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
  const appId = typeof options.appId === "string" ? options.appId.trim() : "";
  const sourceSandboxId =
    typeof options.sourceSandboxId === "string" && options.sourceSandboxId.trim()
      ? options.sourceSandboxId.trim()
      : "";
  const entrypoint =
    typeof options.entrypoint === "string" && options.entrypoint.trim()
      ? options.entrypoint.trim()
      : "";
  const params =
    typeof options.params === "string" && options.params.trim()
      ? parseJsonOption(options.params, "params")
      : {};
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("params must be a JSON object");
  }
  const budgetUsd =
    typeof options.budgetUsd === "string" && options.budgetUsd.trim()
      ? options.budgetUsd.trim()
      : typeof options.budget === "string" && options.budget.trim()
        ? options.budget.trim()
        : "";
  const maxDurationSeconds = parseIntegerOption(options.maxDurationSeconds, "max-duration-seconds");
  const idleTimeoutSeconds = parseIntegerOption(options.idleTimeoutSeconds, "idle-timeout-seconds");
  const artifactPaths = parseCsvOption(options.artifactPaths);
  const idempotencyKey =
    typeof options.idempotencyKey === "string" && options.idempotencyKey.trim()
      ? options.idempotencyKey.trim()
      : "";
  const cleanup = normalizeReplayCleanup(options.cleanup);
  return {
    snapshotId,
    ...(teamId ? { teamId } : {}),
    ...(appId ? { appId } : {}),
    ...(sourceSandboxId ? { sourceSandboxId } : {}),
    ...(entrypoint ? { entrypoint } : {}),
    params: params as Record<string, unknown>,
    ...(budgetUsd ? { budget: { maxUsd: budgetUsd } } : {}),
    ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
    ...(idleTimeoutSeconds !== undefined ? { idleTimeoutSeconds } : {}),
    ...(artifactPaths.length > 0 ? { artifactPaths } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(cleanup ? { cleanup } : {}),
  };
}

function buildSandboxCreateInput(options: Record<string, string | boolean>): SandboxCreateInput {
  const repo = typeof options.repo === "string" ? options.repo.trim() : "";
  const command =
    typeof options.command === "string" && options.command.trim()
      ? options.command.trim()
      : undefined;
  const budgetUsd =
    typeof options.budgetUsd === "string" && options.budgetUsd.trim()
      ? options.budgetUsd.trim()
      : typeof options.budget === "string" && options.budget.trim()
        ? options.budget.trim()
        : "0.05";
  const cpu = parseNumberOption(options.cpu, "cpu");
  const memoryGb = parseNumberOption(options.memoryGb, "memory-gb");
  const diskGb = parseNumberOption(options.diskGb, "disk-gb");
  const maxDurationSeconds = parseIntegerOption(options.maxDurationSeconds, "max-duration-seconds");
  const idleTimeoutSeconds = parseIntegerOption(options.idleTimeoutSeconds, "idle-timeout-seconds");
  const volumeName =
    typeof options.volumeName === "string" && options.volumeName.trim()
      ? options.volumeName.trim()
      : "";
  const volumeMountPath =
    typeof options.volumeMountPath === "string" && options.volumeMountPath.trim()
      ? options.volumeMountPath.trim()
      : "";
  const volumeStorageGb = parseIntegerOption(options.volumeStorageGb, "volume-storage-gb");
  const volumeDeleteOnSandboxDelete =
    options.volumeDeleteOnSandboxDelete !== undefined
      ? parseBooleanOption(options.volumeDeleteOnSandboxDelete)
      : undefined;
  const integrationConnection =
    typeof options.integrationConnection === "string"
      ? options.integrationConnection.trim()
      : "";
  const integrationCapabilities = parseCsvOption(options.integrationCapabilities);
  const integrationScopes = parseCsvOption(options.integrationScopes);
  const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
  const appId = typeof options.appId === "string" ? options.appId.trim() : "";
  const env = parseSandboxEnvOptions(options);

  if (integrationConnection && integrationCapabilities.length === 0) {
    throw new Error("integration-capabilities is required with integration-connection");
  }

  return {
    ...(repo ? { repo } : {}),
    ...(teamId ? { teamId } : {}),
    ...(appId ? { appId } : {}),
    ...(command ? { command } : {}),
    resources: {
      ...(cpu !== undefined ? { cpu } : {}),
      ...(memoryGb !== undefined ? { memoryGb } : {}),
      ...(diskGb !== undefined ? { diskGb } : {}),
    },
    budget: { maxUsd: budgetUsd },
    quotas: {
      maxSpendUsd: budgetUsd,
      ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
      ...(idleTimeoutSeconds !== undefined ? { idleTimeoutSeconds } : {}),
    },
    ...(env.length > 0 ? { env } : {}),
    ...(volumeName || volumeMountPath || volumeStorageGb !== undefined
      ? {
          volumes: [
            {
              ...(volumeName ? { name: volumeName } : {}),
              ...(volumeMountPath ? { mountPath: volumeMountPath } : {}),
              ...(volumeStorageGb !== undefined ? { storageGb: volumeStorageGb } : {}),
              ...(volumeDeleteOnSandboxDelete !== undefined
                ? { deleteOnSandboxDelete: volumeDeleteOnSandboxDelete }
                : {}),
            },
          ],
        }
      : {}),
    ...(integrationConnection
      ? {
          integrationConnectionLeases: [
            {
              connectionId: integrationConnection,
              ...(integrationScopes.length > 0
                ? { scopes: integrationScopes }
                : {}),
              capabilities: integrationCapabilities,
              ttlSeconds: 60 * 60,
            },
          ],
        }
      : {}),
    metadata: {
      source: "openpond-code",
    },
  };
}

function buildSandboxIntegrationAttachInput(
  options: Record<string, string | boolean>,
): SandboxIntegrationConnectionLeaseInput {
  const connectionId =
    typeof options.integrationConnection === "string"
      ? options.integrationConnection.trim()
      : "";
  const capabilities = parseCsvOption(options.integrationCapabilities);
  const scopes = parseCsvOption(options.integrationScopes);
  if (!connectionId || capabilities.length === 0) {
    throw new Error(
      "usage: sandbox integration-attach <sandboxId> --integration-connection <id> --integration-capabilities <csv>",
    );
  }
  return {
    connectionId,
    ...(scopes.length > 0 ? { scopes } : {}),
    capabilities,
    ttlSeconds: 60 * 60,
  };
}

function parseOrganizationRole(value: string | boolean | undefined): OpenPondOrganizationRole {
  const role = typeof value === "string" ? value.trim() : "";
  if (role === "owner" || role === "admin" || role === "member") {
    return role;
  }
  throw new Error("role must be owner, admin, or member");
}

function buildOrganizationCreateInput(
  options: Record<string, string | boolean>,
): OpenPondOrganizationCreateInput {
  const displayName =
    typeof options.displayName === "string" && options.displayName.trim()
      ? options.displayName.trim()
      : typeof options.name === "string" && options.name.trim()
        ? options.name.trim()
        : "";
  if (!displayName) {
    throw new Error("usage: organizations create --name <name> [--slug <slug>]");
  }
  return {
    displayName,
    ...(typeof options.slug === "string" && options.slug.trim()
      ? { slug: options.slug.trim() }
      : {}),
    ...(typeof options.primaryContactEmail === "string" && options.primaryContactEmail.trim()
      ? { primaryContactEmail: options.primaryContactEmail.trim() }
      : {}),
    ...(typeof options.customDomain === "string" && options.customDomain.trim()
      ? { customDomain: options.customDomain.trim() }
      : {}),
  };
}

function buildOrganizationUpdateInput(
  options: Record<string, string | boolean>,
): OpenPondOrganizationUpdateInput {
  const input: OpenPondOrganizationUpdateInput = {};
  const displayName =
    typeof options.displayName === "string" && options.displayName.trim()
      ? options.displayName.trim()
      : typeof options.name === "string" && options.name.trim()
        ? options.name.trim()
        : "";
  if (displayName) input.displayName = displayName;
  if (typeof options.slug === "string" && options.slug.trim()) {
    input.slug = options.slug.trim();
  }
  if (typeof options.primaryContactEmail === "string") {
    input.primaryContactEmail = options.primaryContactEmail.trim() || null;
  }
  if (typeof options.customDomain === "string") {
    input.customDomain = options.customDomain.trim() || null;
  }
  if (typeof options.status === "string" && options.status.trim()) {
    const status = options.status.trim();
    if (status !== "active" && status !== "disabled" && status !== "archived") {
      throw new Error("status must be active, disabled, or archived");
    }
    input.status = status;
  }
  if (Object.keys(input).length === 0) {
    throw new Error("organizations update requires at least one changed field");
  }
  return input;
}

function buildOrganizationMemberInput(
  options: Record<string, string | boolean>,
): OpenPondOrganizationMemberUpsertInput {
  const email = typeof options.email === "string" ? options.email.trim() : "";
  if (!email) {
    throw new Error("usage: organizations member-upsert <slug> --email <email> --role <role>");
  }
  return {
    email,
    role: parseOrganizationRole(options.role),
  };
}

function buildOrganizationMcpGenerateInput(
  options: Record<string, string | boolean>,
): OpenPondOrganizationMcpGenerateInput {
  return {
    ...(typeof options.origin === "string" && options.origin.trim()
      ? { origin: options.origin.trim() }
      : {}),
    ...(typeof options.toolset === "string" && options.toolset.trim()
      ? { toolset: parseCsvOption(options.toolset) }
      : {}),
  };
}

function buildTemplateBuildCreateInput(
  options: Record<string, string | boolean>,
): SandboxTemplateBuildCreateInput {
  const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
  const sourceRepoUrl =
    typeof options.sourceRepoUrl === "string" ? options.sourceRepoUrl.trim() : "";
  const sourceAppId =
    typeof options.sourceAppId === "string" ? options.sourceAppId.trim() : "";
  const branch = typeof options.branch === "string" ? options.branch.trim() : "";
  const manifestPath =
    typeof options.manifestPath === "string" ? options.manifestPath.trim() : "";
  if (!teamId) {
    throw new Error("template-build-create requires --team-id <id>");
  }
  if (!sourceRepoUrl && !sourceAppId) {
    throw new Error("template-build-create requires --source-repo-url <url> or --source-app-id <id>");
  }
  return {
    teamId,
    ...(sourceRepoUrl ? { sourceRepoUrl } : {}),
    ...(sourceAppId ? { sourceAppId } : {}),
    ...(branch ? { branch } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    publish: parseBooleanOption(options.publish),
  };
}

function buildSnapshotCreateInput(
  options: Record<string, string | boolean>,
): Record<string, unknown> {
  const name = typeof options.name === "string" ? options.name.trim() : "";
  if (!name) {
    throw new Error("snapshot-create requires --name <name>");
  }
  const templateName =
    typeof options.templateName === "string" ? options.templateName.trim() : "";
  const templateVersion =
    typeof options.templateVersion === "string" && options.templateVersion.trim()
      ? options.templateVersion.trim()
      : "0.1.0";
  const templateVisibility =
    typeof options.templateVisibility === "string" && options.templateVisibility.trim()
      ? options.templateVisibility.trim()
      : "private";
  if (
    templateVisibility !== "private" &&
    templateVisibility !== "team"
  ) {
    throw new Error("template-visibility must be private or team");
  }
  const validationCommand =
    typeof options.validationCommand === "string" && options.validationCommand.trim()
      ? options.validationCommand.trim()
      : "test -d .";
  const entrypointCommand =
    typeof options.entrypointCommand === "string" && options.entrypointCommand.trim()
      ? options.entrypointCommand.trim()
      : "true";
  const useCase =
    typeof options.useCase === "string" && options.useCase.trim()
      ? options.useCase.trim()
      : undefined;
  const description =
    typeof options.description === "string" && options.description.trim()
      ? options.description.trim()
      : undefined;
  const tags = parseCsvOption(options.tags);
  const input: Record<string, unknown> = {
    ...(parseBooleanOption(options.async) ? { async: true } : {}),
    name,
    replay: {
      entrypoints: [
        {
          command: entrypointCommand,
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
        maxSpendUsd: "0.05",
        publicPreview: false,
      },
      validation: {
        commands: [
          {
            command: validationCommand,
          },
        ],
      },
    },
  };
  if (templateName) {
    input.template = {
      name: templateName,
      version: templateVersion,
      ...(description ? { description } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      visibility: templateVisibility,
      ...(useCase ? { useCase } : {}),
    };
  }
  return input;
}

function summarizeSandbox(sandbox: SandboxRecord): Record<string, unknown> {
  return {
    id: sandbox.id,
    state: sandbox.state,
    runtimeDriver: sandbox.runtimeDriver,
    repo: sandbox.repo,
    budgetUsd: sandbox.budget.maxUsd,
    capturedUsd: sandbox.reservation.capturedUsd,
    reservationRef: sandbox.reservation.mpp?.reservationRef ?? null,
    mppMode: sandbox.reservation.mpp?.mode ?? null,
    integrationLeases: sandbox.integrationLeases?.map((lease) => ({
      leaseId: lease.leaseId,
      provider: lease.provider,
      capabilities: lease.capabilities,
    })) ?? [],
    previewPorts: sandbox.previewPorts.map((preview) => ({
      port: preview.port,
      label: preview.label,
      url: preview.url,
      customDomain: preview.customDomain ?? null,
    })),
    latestReceipt: sandbox.receipts.at(-1)?.mpp.receiptRef ?? null,
  };
}

async function runOrganizationsCommand(
  options: Record<string, string | boolean>,
  rest: string[],
): Promise<void> {
  const subcommand = rest[0] || "list";
  const client = await resolveSandboxClient(options);
  const outputJson = parseBooleanOption(options.json);

  if (subcommand === "list") {
    const organizations = await client.listOrganizations();
    if (outputJson) {
      console.log(JSON.stringify({ organizations }, null, 2));
      return;
    }
    if (organizations.length === 0) {
      console.log("no organizations found");
      return;
    }
    for (const organization of organizations) {
      console.log(formatOrganizationLine(organization));
    }
    return;
  }

  if (subcommand === "create") {
    const organization = await client.createOrganization(buildOrganizationCreateInput(options));
    console.log(JSON.stringify({ organization }, null, 2));
    return;
  }

  if (subcommand === "get") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations get <slug>");
    }
    const organization = await client.getOrganization(slug);
    console.log(JSON.stringify({ organization }, null, 2));
    return;
  }

  if (subcommand === "update") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations update <slug> [--name <name>]");
    }
    const organization = await client.updateOrganization(
      slug,
      buildOrganizationUpdateInput(options),
    );
    console.log(JSON.stringify({ organization }, null, 2));
    return;
  }

  if (subcommand === "members" || subcommand === "member-list") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations members <slug>");
    }
    const members = await client.listOrganizationMembers(slug);
    if (outputJson) {
      console.log(JSON.stringify({ members }, null, 2));
      return;
    }
    if (members.length === 0) {
      console.log("no organization members found");
      return;
    }
    for (const member of members) {
      console.log(formatOrganizationMemberLine(member));
    }
    return;
  }

  if (subcommand === "member-upsert" || subcommand === "member-add") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations member-upsert <slug> --email <email> --role <role>");
    }
    const member = await client.upsertOrganizationMember(
      slug,
      buildOrganizationMemberInput(options),
    );
    console.log(JSON.stringify({ member }, null, 2));
    return;
  }

  if (subcommand === "mcp-get" || subcommand === "mcp-server") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations mcp-get <slug>");
    }
    const mcpServer = await client.getOrganizationMcpServer(slug);
    if (outputJson) {
      console.log(JSON.stringify({ mcpServer }, null, 2));
      return;
    }
    console.log(formatOrganizationMcpServerLine(mcpServer));
    return;
  }

  if (subcommand === "mcp-generate") {
    const slug = rest[1];
    if (!slug) {
      throw new Error("usage: organizations mcp-generate <slug> [--origin <url>]");
    }
    const mcpServer = await client.generateOrganizationMcpServer(
      slug,
      buildOrganizationMcpGenerateInput(options),
    );
    console.log(JSON.stringify({ mcpServer }, null, 2));
    return;
  }

  if (subcommand === "mcp-probe" || subcommand === "mcp-inspect") {
    const slug = rest[1];
    if (!slug) {
      throw new Error(
        "usage: organizations mcp-probe <slug> [--origin <url>] [--tool <name>] [--arguments <json>] [--access-token <token>]",
      );
    }
    const mcpServer = await client.getOrganizationMcpServer(slug);
    const resourceUrl = resolveMcpProbeResourceUrl(mcpServer, options);
    const origin = resolveMcpProbeOrigin(resourceUrl, options);
    const toolName =
      typeof options.tool === "string" && options.tool.trim()
        ? options.tool.trim()
        : typeof options.toolName === "string" && options.toolName.trim()
          ? options.toolName.trim()
          : "estimate_search_history";
    const toolArguments = parseMcpToolArguments(options);
    const accessToken =
      typeof options.accessToken === "string" && options.accessToken.trim()
        ? options.accessToken.trim()
        : "";
    const probe = await probeOrganizationMcp({
      resourceUrl,
      origin,
      toolName,
      toolArguments,
      ...(accessToken ? { accessToken } : {}),
    });
    console.log(JSON.stringify({ mcpServer, probe }, null, 2));
    return;
  }

  if (subcommand === "mcp-authorize" || subcommand === "mcp-oauth") {
    const slug = rest[1];
    if (!slug) {
      throw new Error(
        "usage: organizations mcp-authorize <slug> [--origin <url>] [--scope <csv|space>] [--tool <name>] [--arguments <json>] [--open]",
      );
    }
    const mcpServer = await client.getOrganizationMcpServer(slug);
    const resourceUrl = resolveMcpProbeResourceUrl(mcpServer, options);
    const origin = resolveMcpProbeOrigin(resourceUrl, options);
    const clientId = resolveMcpOAuthClientId(options);
    const scopes = parseMcpOAuthScopes(options);
    const state = randomOauthToken(18);
    const codeVerifier = randomOauthToken(48);
    const codeChallenge = buildMcpOauthPkceChallenge(codeVerifier);
    const callback = await startMcpOAuthCallbackListener({
      expectedState: state,
      port: resolveMcpOAuthCallbackPort(options),
      timeoutMs: resolveMcpOAuthTimeoutMs(options),
    });
    const authorizationUrl = buildMcpOAuthAuthorizeUrl({
      authorizationEndpoint: `${origin}/oauth/authorize`,
      clientId,
      codeChallenge,
      redirectUri: callback.redirectUri,
      resourceUrl,
      scopes,
      state,
    });
    console.error("Open this URL to authorize the organization MCP connection:");
    console.error(authorizationUrl);
    console.error(`Waiting for OAuth callback on ${callback.redirectUri}`);
    if (parseBooleanOption(options.open)) {
      try {
        openUrlWithSystemBrowser(authorizationUrl);
      } catch (error) {
        console.error(
          `Unable to open a browser automatically: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    try {
      const callbackResult = await callback.waitForCallback();
      const token = await exchangeMcpOAuthAuthorizationCode({
        clientId,
        code: callbackResult.code,
        codeVerifier,
        origin,
        redirectUri: callback.redirectUri,
      });
      const toolName =
        typeof options.tool === "string" && options.tool.trim()
          ? options.tool.trim()
          : typeof options.toolName === "string" && options.toolName.trim()
            ? options.toolName.trim()
            : "estimate_search_history";
      const toolArguments = parseMcpToolArguments(options);
      const probe = await probeOrganizationMcp({
        accessToken: token.access_token,
        origin,
        resourceUrl,
        toolArguments,
        toolName,
      });
      const printToken = parseBooleanOption(options.printToken);
      console.log(
        JSON.stringify(
          {
            mcpServer,
            oauth: {
              accessTokenReceived: true,
              clientId,
              expiresIn: token.expires_in ?? null,
              refreshTokenReceived: Boolean(token.refresh_token),
              scope: token.scope ?? scopes.join(" "),
              tokenType: token.token_type ?? "Bearer",
              ...(printToken
                ? {
                    accessToken: token.access_token,
                    refreshToken: token.refresh_token ?? null,
                  }
                : {}),
            },
            probe,
          },
          null,
          2,
        ),
      );
    } finally {
      await callback.close();
    }
    return;
  }

  if (
    subcommand === "mcp-rotate" ||
    subcommand === "mcp-disable" ||
    subcommand === "mcp-enable"
  ) {
    const slug = rest[1];
    if (!slug) {
      throw new Error(`usage: organizations ${subcommand} <slug>`);
    }
    const mcpServer =
      subcommand === "mcp-rotate"
        ? await client.rotateOrganizationMcpServer(slug)
        : subcommand === "mcp-disable"
          ? await client.disableOrganizationMcpServer(slug)
          : await client.enableOrganizationMcpServer(slug);
    console.log(JSON.stringify({ mcpServer }, null, 2));
    return;
  }

  throw new Error(
    "usage: organizations <list|create|get|update|members|member-upsert|mcp-get|mcp-generate|mcp-probe|mcp-authorize|mcp-rotate|mcp-disable|mcp-enable> [args]",
  );
}

async function runSandboxCommand(
  options: Record<string, string | boolean>,
  rest: string[],
): Promise<void> {
  const subcommand = rest[0] || "list";
  const client = await resolveSandboxClient(options);

  if (subcommand === "list") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const sandboxes = await client.list({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    if (sandboxes.length === 0) {
      console.log("no sandboxes found");
      return;
    }
    for (const sandbox of sandboxes) {
      console.log(formatSandboxLine(sandbox));
    }
    return;
  }

  if (subcommand === "mcp-config" || subcommand === "mcp-url") {
    const config = client.mcpServerConfig();
    console.log(
      JSON.stringify(
        {
          ...config,
          headers: {
            "openpond-api-key": "set OPENPOND_API_KEY or use your saved openpond profile",
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "secrets" || subcommand === "secret-list") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const secrets = await client.listSecrets({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    if (parseBooleanOption(options.json)) {
      console.log(
        JSON.stringify({ secrets: secrets.map(summarizeSandboxSecret) }, null, 2),
      );
      return;
    }
    if (secrets.length === 0) {
      console.log("no sandbox secrets found");
      return;
    }
    for (const secret of secrets) {
      console.log(
        `${secret.name}\t${secret.status}\tv${secret.currentVersion ?? "current"}\t${secret.secretRef}`,
      );
    }
    return;
  }

  if (subcommand === "secret-create") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const name = typeof options.name === "string" ? options.name.trim() : "";
    const description =
      typeof options.description === "string" && options.description.trim()
        ? options.description.trim()
        : undefined;
    const scope =
      options.scope === "app" || options.scope === "template" || options.scope === "team"
        ? options.scope
        : undefined;
    if (!name) {
      throw new Error("usage: sandbox secret-create --name <ENV_NAME> [--team-id <id>] [--stdin]");
    }
    const value = await readSandboxSecretValue(options, `Value for ${name}`);
    const secret = await client.createSecret({
      ...(teamId ? { teamId } : {}),
      name,
      value,
      ...(description ? { description } : {}),
      ...(scope ? { scope } : {}),
    });
    console.log(JSON.stringify({ secret: summarizeSandboxSecret(secret) }, null, 2));
    return;
  }

  if (subcommand === "secret-rotate") {
    const secretId = rest[1];
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    if (!secretId) {
      throw new Error("usage: sandbox secret-rotate <secretId> [--team-id <id>] [--stdin]");
    }
    const value = await readSandboxSecretValue(options, "New secret value");
    const secret = await client.rotateSecret(secretId, {
      ...(teamId ? { teamId } : {}),
      value,
    });
    console.log(JSON.stringify({ secret: summarizeSandboxSecret(secret) }, null, 2));
    return;
  }

  if (subcommand === "secret-attach") {
    const secretId = rest[1];
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const envName = typeof options.envName === "string" ? options.envName.trim() : "";
    const targetType =
      options.targetType === "sandbox" ||
      options.targetType === "template" ||
      options.targetType === "app" ||
      options.targetType === "replay"
        ? options.targetType
        : undefined;
    const targetId = typeof options.targetId === "string" ? options.targetId.trim() : "";
    if (!secretId || !envName || !targetType || !targetId) {
      throw new Error(
        "usage: sandbox secret-attach <secretId> --env-name <ENV_NAME> --target-type sandbox|template|app|replay --target-id <id>",
      );
    }
    const secret = await client.attachSecret(secretId, {
      ...(teamId ? { teamId } : {}),
      envName,
      targetType,
      targetId,
    });
    console.log(JSON.stringify({ secret: summarizeSandboxSecret(secret) }, null, 2));
    return;
  }

  if (subcommand === "secret-revoke" || subcommand === "secret-delete") {
    const secretId = rest[1];
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    if (!secretId) {
      throw new Error(`usage: sandbox ${subcommand} <secretId> [--team-id <id>]`);
    }
    const secret =
      subcommand === "secret-revoke"
        ? await client.revokeSecret(secretId, {
            ...(teamId ? { teamId } : {}),
          })
        : await client.deleteSecret(secretId, {
            ...(teamId ? { teamId } : {}),
          });
    console.log(JSON.stringify({ secret: summarizeSandboxSecret(secret) }, null, 2));
    return;
  }

  if (subcommand === "snapshots" || subcommand === "snapshot-catalog") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const query =
      typeof options.query === "string" && options.query.trim()
        ? options.query.trim()
        : typeof options.q === "string" && options.q.trim()
          ? options.q.trim()
          : "";
    const tag = typeof options.tag === "string" ? options.tag.trim() : "";
    const useCase = typeof options.useCase === "string" ? options.useCase.trim() : "";
    const replayState =
      typeof options.replayState === "string" ? options.replayState.trim() : "";
    const catalog = await client.snapshotCatalog({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
      ...(query ? { q: query } : {}),
      ...(tag ? { tag } : {}),
      ...(useCase ? { useCase } : {}),
      ...(replayState === "draft" ||
      replayState === "validated" ||
      replayState === "published"
        ? { replayState }
        : {}),
    });
    if (catalog.snapshots.length === 0) {
      console.log("no sandbox snapshots found");
      return;
    }
    for (const snapshot of catalog.snapshots) {
      console.log(formatSnapshotCatalogLine(snapshot));
    }
    return;
  }

  if (subcommand === "templates" || subcommand === "template-catalog") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const query =
      typeof options.query === "string" && options.query.trim()
        ? options.query.trim()
        : typeof options.q === "string" && options.q.trim()
          ? options.q.trim()
          : "";
    const name =
      typeof options.name === "string" && options.name.trim()
        ? options.name.trim()
        : typeof options.templateName === "string" && options.templateName.trim()
          ? options.templateName.trim()
          : "";
    const version = typeof options.version === "string" ? options.version.trim() : "";
    const tag = typeof options.tag === "string" ? options.tag.trim() : "";
    const useCase = typeof options.useCase === "string" ? options.useCase.trim() : "";
    const catalog = await client.templates({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
      ...(query ? { q: query } : {}),
      ...(name ? { name } : {}),
      ...(version ? { version } : {}),
      ...(tag ? { tag } : {}),
      ...(useCase ? { useCase } : {}),
    });
    if (catalog.templates.length === 0) {
      console.log("no sandbox templates found");
      return;
    }
    for (const template of catalog.templates) {
      console.log(formatSandboxTemplateLine(template));
    }
    return;
  }

  if (subcommand === "template-builds" || subcommand === "template-build-list") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    if (!teamId) {
      throw new Error("usage: sandbox template-builds --team-id <id>");
    }
    const builds = await client.listTemplateBuilds({ teamId });
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify({ builds }, null, 2));
      return;
    }
    if (builds.length === 0) {
      console.log("no sandbox template builds found");
      return;
    }
    for (const build of builds) {
      console.log(formatTemplateBuildLine(build));
    }
    return;
  }

  if (subcommand === "template-build-create" || subcommand === "create-template-build") {
    const build = await client.createTemplateBuild(buildTemplateBuildCreateInput(options));
    console.log(JSON.stringify({ build }, null, 2));
    return;
  }

  if (subcommand === "template-build-get" || subcommand === "get-template-build") {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-get <buildId>");
    }
    const build = await client.getTemplateBuild(buildId);
    console.log(JSON.stringify({ build }, null, 2));
    return;
  }

  if (subcommand === "template-build-logs" || subcommand === "template-build-log") {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-logs <buildId>");
    }
    const logs = await client.getTemplateBuildLogs(buildId);
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }
    for (const line of logs.logs) {
      console.log(line);
    }
    return;
  }

  if (subcommand === "template-build-cancel" || subcommand === "cancel-template-build") {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-cancel <buildId>");
    }
    const build = await client.cancelTemplateBuild(buildId);
    console.log(JSON.stringify({ build }, null, 2));
    return;
  }

  if (subcommand === "template-build-watch" || subcommand === "watch-template-build") {
    const buildId = rest[1];
    if (!buildId) {
      throw new Error("usage: sandbox template-build-watch <buildId>");
    }
    const intervalMs = parseIntegerOption(options.intervalMs, "interval-ms") ?? 5000;
    const timeoutMs = parseIntegerOption(options.timeoutMs, "timeout-ms") ?? 15 * 60 * 1000;
    const startedAt = Date.now();
    const seenLogs = new Set<string>();
    while (Date.now() - startedAt <= timeoutMs) {
      const [build, logs] = await Promise.all([
        client.getTemplateBuild(buildId),
        client.getTemplateBuildLogs(buildId),
      ]);
      for (const line of logs.logs) {
        if (!seenLogs.has(line)) {
          seenLogs.add(line);
          console.log(line);
        }
      }
      if (
        build.status === "succeeded" ||
        build.status === "failed" ||
        build.status === "cancelled"
      ) {
        console.log(formatTemplateBuildLine(build));
        if (build.status !== "succeeded") {
          throw new Error(`sandbox template build ${build.status}: ${build.error ?? "no error"}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`sandbox template build did not finish within ${timeoutMs}ms`);
  }

  if (subcommand === "replays" || subcommand === "replay-list") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const result = await client.listReplays({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    if (parseBooleanOption(options.json)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.replays.length === 0) {
      console.log("no sandbox replays found");
      return;
    }
    for (const replay of result.replays) {
      console.log(formatReplayLine(replay));
    }
    return;
  }

  if (subcommand === "replay-start" || subcommand === "start-replay") {
    const result = await client.startReplay(buildSandboxReplayInput(options));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "replay-get" || subcommand === "get-replay") {
    const replayId = rest[1];
    if (!replayId) {
      throw new Error("usage: sandbox replay-get <replayId> [--team-id <id>]");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const result = await client.getReplay(replayId, {
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "replay-logs" || subcommand === "logs-replay") {
    const replayId = rest[1];
    if (!replayId) {
      throw new Error("usage: sandbox replay-logs <replayId> [--team-id <id>]");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const result = await client.getReplayLogs(replayId, {
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    for (const line of result.logs) {
      console.log(line);
    }
    return;
  }

  if (subcommand === "replay-artifacts" || subcommand === "artifacts-replay") {
    const replayId = rest[1];
    if (!replayId) {
      throw new Error("usage: sandbox replay-artifacts <replayId> [--team-id <id>]");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const result = await client.getReplayArtifacts(replayId, {
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    console.log(
      JSON.stringify(
        {
          replayId: result.replayId,
          artifacts: result.artifacts.map(summarizeReplayArtifact),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "replay-cancel" || subcommand === "cancel-replay") {
    const replayId = rest[1];
    if (!replayId) {
      throw new Error("usage: sandbox replay-cancel <replayId> [--team-id <id>]");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const result = await client.cancelReplay(replayId, {
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "replay-watch" || subcommand === "watch-replay") {
    const replayId = rest[1];
    if (!replayId) {
      throw new Error("usage: sandbox replay-watch <replayId> [--team-id <id>]");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const intervalMs = parseIntegerOption(options.intervalMs, "interval-ms") ?? 5000;
    const timeoutMs = parseIntegerOption(options.timeoutMs, "timeout-ms") ?? 15 * 60 * 1000;
    const startedAt = Date.now();
    const seenLogs = new Set<string>();
    while (Date.now() - startedAt <= timeoutMs) {
      const result = await client.getReplay(replayId, {
        ...(teamId ? { teamId } : {}),
        ...(appId ? { appId } : {}),
      });
      for (const line of result.replay.logs) {
        if (!seenLogs.has(line)) {
          seenLogs.add(line);
          console.log(line);
        }
      }
      if (
        result.replay.state === "succeeded" ||
        result.replay.state === "failed" ||
        result.replay.state === "canceled"
      ) {
        console.log(formatReplayLine(result.replay));
        if (result.replay.state !== "succeeded") {
          throw new Error(`sandbox replay ${result.replay.state}: ${result.replay.error ?? "no error"}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`sandbox replay did not finish within ${timeoutMs}ms`);
  }

  if (subcommand === "template-launch" || subcommand === "launch-template") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const snapshotId =
      typeof options.snapshotId === "string" && options.snapshotId.trim()
        ? options.snapshotId.trim()
        : typeof options.snapshot === "string" && options.snapshot.trim()
          ? options.snapshot.trim()
          : "";
    const templateName =
      typeof options.templateName === "string" && options.templateName.trim()
        ? options.templateName.trim()
        : typeof options.name === "string" && options.name.trim()
          ? options.name.trim()
          : typeof rest[1] === "string" && rest[1].trim()
            ? rest[1].trim()
            : "";
    const version = typeof options.version === "string" ? options.version.trim() : "";
    const useCase = typeof options.useCase === "string" ? options.useCase.trim() : "";
    if (!snapshotId && !templateName && !useCase) {
      throw new Error(
        "usage: sandbox template-launch [--snapshot-id <id>|--template-name <name>|--use-case <id>] [--version <v>]",
      );
    }
    const budgetUsd =
      typeof options.budgetUsd === "string" && options.budgetUsd.trim()
        ? options.budgetUsd.trim()
        : typeof options.budget === "string" && options.budget.trim()
          ? options.budget.trim()
          : "";
    const result = await client.launchTemplate({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
      ...(snapshotId ? { snapshotId } : {}),
      ...(templateName ? { templateName } : {}),
      ...(version ? { version } : {}),
      ...(useCase ? { useCase } : {}),
      ...(budgetUsd ? { budget: { maxUsd: budgetUsd } } : {}),
      metadata: {
        source: "openpond-code-template-launch",
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "snapshot-fork" || subcommand === "fork-snapshot") {
    const snapshotId = rest[1];
    if (!snapshotId) {
      throw new Error("snapshot-fork requires <snapshotId>");
    }
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const budgetUsd =
      typeof options.budgetUsd === "string" && options.budgetUsd.trim()
        ? options.budgetUsd.trim()
        : typeof options.budget === "string" && options.budget.trim()
          ? options.budget.trim()
          : "";
    const result = await client.forkSnapshot(snapshotId, {
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
      ...(budgetUsd ? { budget: { maxUsd: budgetUsd } } : {}),
      metadata: {
        source: "openpond-code-snapshot-fork",
        templateSnapshotId: snapshotId,
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "snapshot-create" || subcommand === "create-snapshot") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox snapshot-create <sandboxId> --name <name>");
    }
    const result = await client.createSnapshot(
      sandboxId,
      buildSnapshotCreateInput(options),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "snapshot-validate" || subcommand === "validate-snapshot") {
    const sandboxId = rest[1];
    const snapshotId = rest[2];
    if (!sandboxId || !snapshotId) {
      throw new Error("snapshot-validate requires <sandboxId> <snapshotId>");
    }
    const cleanup = normalizeSnapshotValidationCleanup(options.cleanup);
    const result = await client.validateSnapshot(sandboxId, snapshotId, {
      ...(cleanup ? { cleanup } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "snapshot-publish" || subcommand === "publish-snapshot") {
    const sandboxId = rest[1];
    const snapshotId = rest[2];
    if (!sandboxId || !snapshotId) {
      throw new Error("snapshot-publish requires <sandboxId> <snapshotId>");
    }
    const result = await client.publishSnapshot(sandboxId, snapshotId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "integration-connections") {
    const teamId = typeof options.teamId === "string" ? options.teamId.trim() : "";
    const appId = typeof options.appId === "string" ? options.appId.trim() : "";
    const status =
      options.status === "active" ||
      options.status === "revoked" ||
      options.status === "error" ||
      options.status === "all"
        ? options.status
        : undefined;
    const result = await client.integrationConnections({
      ...(teamId ? { teamId } : {}),
      ...(appId ? { appId } : {}),
      ...(status ? { status } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === "create") {
    const sandbox = await client.create(buildSandboxCreateInput(options));
    console.log(JSON.stringify({ sandbox: summarizeSandbox(sandbox) }, null, 2));
    return;
  }

  if (subcommand === "exec") {
    const sandboxId = rest[1];
    const command =
      (typeof options.command === "string" ? options.command : null) || rest.slice(2).join(" ");
    if (!sandboxId || !command.trim()) {
      throw new Error("usage: sandbox exec <sandboxId> --command <command>");
    }
    const timeoutSeconds = parseIntegerOption(options.timeoutSeconds, "timeout-seconds");
    const result = await client.exec(sandboxId, {
      command: command.trim(),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          command: result.command,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "port" || subcommand === "preview") {
    const sandboxId = rest[1];
    const port = parseIntegerOption(options.port, "port");
    if (!sandboxId || port === undefined) {
      throw new Error("usage: sandbox port <sandboxId> --port <port>");
    }
    const label = typeof options.label === "string" ? options.label : undefined;
    const rawAccess = typeof options.access === "string" ? options.access.trim() : "";
    if (rawAccess && rawAccess !== "private" && rawAccess !== "public") {
      throw new Error("sandbox port --access must be private or public");
    }
    const access = rawAccess === "public" ? "public" : "private";
    const customDomain =
      typeof options.domain === "string" ? options.domain.trim() : "";
    const authToken = typeof options.authToken === "string" ? options.authToken : "";
    const authHeader = typeof options.authHeader === "string" ? options.authHeader.trim() : "";
    const authHeaderValue =
      typeof options.authHeaderValue === "string" ? options.authHeaderValue : "";
    if (authToken && (authHeader || authHeaderValue)) {
      throw new Error("sandbox port auth options must use either --auth-token or --auth-header with --auth-header-value");
    }
    if ((authHeader && !authHeaderValue) || (!authHeader && authHeaderValue)) {
      throw new Error("sandbox port custom header auth requires both --auth-header and --auth-header-value");
    }
    const result = await client.openPort(sandboxId, {
      port,
      ...(label ? { label } : {}),
      access,
      ...(options["auto-start"] || options.autoStart ? { autoStart: true } : {}),
      ...(customDomain ? { customDomain } : {}),
      ...(authToken
        ? { authPolicy: { mode: "bearer", token: authToken } as const }
        : {}),
      ...(authHeader && authHeaderValue
        ? {
            authPolicy: {
              mode: "header",
              headerName: authHeader,
              headerValue: authHeaderValue,
            } as const,
          }
        : {}),
    });
    console.log(JSON.stringify(result.preview, null, 2));
    return;
  }

  if (subcommand === "stop") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox stop <sandboxId>");
    }
    const result = await client.stop(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          receipt: result.receipt,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "delete") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox delete <sandboxId>");
    }
    const sandbox = await client.delete(sandboxId);
    console.log(JSON.stringify({ sandbox: summarizeSandbox(sandbox) }, null, 2));
    return;
  }

  if (subcommand === "receipts") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox receipts <sandboxId>");
    }
    const receipts = await client.receipts(sandboxId);
    console.log(JSON.stringify({ receipts }, null, 2));
    return;
  }

  if (subcommand === "logs") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox logs <sandboxId>");
    }
    const logs = await client.logs(sandboxId);
    for (const line of logs) {
      console.log(line);
    }
    return;
  }

  if (subcommand === "process-start") {
    const sandboxId = rest[1];
    const command =
      (typeof options.command === "string" ? options.command : null) || rest.slice(2).join(" ");
    if (!sandboxId || !command.trim()) {
      throw new Error("usage: sandbox process-start <sandboxId> --command <command>");
    }
    const timeoutSeconds = parseIntegerOption(options.timeoutSeconds, "timeout-seconds");
    const result = await client.startProcess(sandboxId, {
      command: command.trim(),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          process: result.process,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "process-list") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox process-list <sandboxId>");
    }
    const result = await client.listProcesses(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          processes: result.processes,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "process-get") {
    const sandboxId = rest[1];
    const processId = rest[2];
    if (!sandboxId || !processId) {
      throw new Error("usage: sandbox process-get <sandboxId> <processId> [--since <cursor>]");
    }
    const since = parseIntegerOption(options.since, "since");
    const result = await client.getProcess(sandboxId, processId, {
      ...(since !== undefined ? { since } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          process: result.process,
          output: result.output,
          cursor: result.cursor,
          completed: result.completed,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "process-stop") {
    const sandboxId = rest[1];
    const processId = rest[2];
    if (!sandboxId || !processId) {
      throw new Error("usage: sandbox process-stop <sandboxId> <processId>");
    }
    const result = await client.stopProcess(sandboxId, processId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          process: result.process,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "process-stream") {
    const sandboxId = rest[1];
    const processId = rest[2];
    if (!sandboxId || !processId) {
      throw new Error("usage: sandbox process-stream <sandboxId> <processId> [--since <cursor>]");
    }
    const since = parseIntegerOption(options.since, "since");
    await client.streamProcessOutput(sandboxId, processId, {
      ...(since !== undefined ? { since } : {}),
    });
    return;
  }

  if (subcommand === "pty-start") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox pty-start <sandboxId> [--command <command>]");
    }
    const command =
      (typeof options.command === "string" ? options.command : null) || rest.slice(2).join(" ");
    const timeoutSeconds = parseIntegerOption(options.timeoutSeconds, "timeout-seconds");
    const rows = parseIntegerOption(options.rows, "rows");
    const cols = parseIntegerOption(options.cols, "cols");
    const result = await client.startPty(sandboxId, {
      ...(command.trim() ? { command: command.trim() } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(rows !== undefined ? { rows } : {}),
      ...(cols !== undefined ? { cols } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          pty: result.pty,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "pty-list") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox pty-list <sandboxId>");
    }
    const result = await client.listPtys(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          ptys: result.ptys,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "pty-get") {
    const sandboxId = rest[1];
    const ptyId = rest[2];
    if (!sandboxId || !ptyId) {
      throw new Error("usage: sandbox pty-get <sandboxId> <ptyId> [--since <cursor>]");
    }
    const since = parseIntegerOption(options.since, "since");
    const result = await client.getPty(sandboxId, ptyId, {
      ...(since !== undefined ? { since } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          pty: result.pty,
          output: result.output,
          cursor: result.cursor,
          completed: result.completed,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "pty-write") {
    const sandboxId = rest[1];
    const ptyId = rest[2];
    const inputBase64 =
      typeof options.inputBase64 === "string" ? options.inputBase64.trim() : "";
    const inputText =
      (typeof options.input === "string" ? options.input : null) || rest.slice(3).join(" ");
    if (!sandboxId || !ptyId || (!inputBase64 && !inputText)) {
      throw new Error("usage: sandbox pty-write <sandboxId> <ptyId> --input <text>");
    }
    const result = await client.writePtyInput(
      sandboxId,
      ptyId,
      inputBase64 ? { dataBase64: inputBase64 } : inputText,
    );
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          pty: result.pty,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "pty-stop") {
    const sandboxId = rest[1];
    const ptyId = rest[2];
    if (!sandboxId || !ptyId) {
      throw new Error("usage: sandbox pty-stop <sandboxId> <ptyId>");
    }
    const result = await client.stopPty(sandboxId, ptyId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          pty: result.pty,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "pty-stream") {
    const sandboxId = rest[1];
    const ptyId = rest[2];
    if (!sandboxId || !ptyId) {
      throw new Error("usage: sandbox pty-stream <sandboxId> <ptyId> [--since <cursor>]");
    }
    const since = parseIntegerOption(options.since, "since");
    await client.streamPtyOutput(sandboxId, ptyId, {
      ...(since !== undefined ? { since } : {}),
    });
    return;
  }

  if (subcommand === "list-files") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox list-files <sandboxId> [--path <path>]");
    }
    const path = typeof options.path === "string" ? options.path.trim() : undefined;
    const maxEntries = parseNumberOption(options.maxEntries, "max-entries");
    const recursive =
      options.recursive !== undefined ? parseBooleanOption(options.recursive) : undefined;
    const result = await client.listFiles(sandboxId, {
      ...(path ? { path } : {}),
      ...(recursive !== undefined ? { recursive } : {}),
      ...(maxEntries !== undefined ? { maxEntries } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          files: result.files,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "upload-file") {
    const sandboxId = rest[1];
    const path = typeof options.path === "string" ? options.path.trim() : "";
    const contents =
      typeof options.contents === "string"
        ? options.contents
        : typeof options.content === "string"
          ? options.content
          : "";
    const contentsBase64 =
      typeof options.contentsBase64 === "string"
        ? options.contentsBase64.trim()
        : typeof options.contentBase64 === "string"
          ? options.contentBase64.trim()
          : "";
    if (!sandboxId || !path) {
      throw new Error('usage: sandbox upload-file <sandboxId> --path <path> --contents "text"');
    }
    if (!contents && !contentsBase64) {
      throw new Error('usage: sandbox upload-file <sandboxId> --path <path> --contents "text"');
    }
    const result = contentsBase64
      ? await client.uploadFileBase64(sandboxId, path, contentsBase64)
      : await client.uploadFile(sandboxId, path, contents);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          file: result.file,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "download-file") {
    const sandboxId = rest[1];
    const path = typeof options.path === "string" ? options.path.trim() : "";
    const offsetBytes = Number(options["offset-bytes"]);
    const maxBytes = Number(options["max-bytes"]);
    if (!sandboxId || !path) {
      throw new Error("usage: sandbox download-file <sandboxId> --path <path>");
    }
    const result = await client.downloadFileResponse(sandboxId, {
      path,
      ...(Number.isFinite(offsetBytes) ? { offsetBytes } : {}),
      ...(Number.isFinite(maxBytes) ? { maxBytes } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          file: result.file,
          contents: Buffer.from(result.file.contentsBase64, "base64").toString("utf-8"),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "search-files") {
    const sandboxId = rest[1];
    const query = typeof options.query === "string" ? options.query.trim() : "";
    if (!sandboxId || !query) {
      throw new Error("usage: sandbox search-files <sandboxId> --query <text> [--path <path>]");
    }
    const path = typeof options.path === "string" ? options.path.trim() : undefined;
    const maxResults = parseNumberOption(options.maxResults, "max-results");
    const result = await client.searchFiles(sandboxId, {
      query,
      ...(path ? { path } : {}),
      ...(maxResults !== undefined ? { maxResults } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          matches: result.matches,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "delete-file") {
    const sandboxId = rest[1];
    const path = typeof options.path === "string" ? options.path.trim() : "";
    if (!sandboxId || !path) {
      throw new Error("usage: sandbox delete-file <sandboxId> --path <path> [--recursive]");
    }
    const result = await client.deleteFile(sandboxId, path, {
      recursive: parseBooleanOption(options.recursive),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          deleted: result.deleted,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "stat-file") {
    const sandboxId = rest[1];
    const path = typeof options.path === "string" ? options.path.trim() : "";
    if (!sandboxId || !path) {
      throw new Error("usage: sandbox stat-file <sandboxId> --path <path>");
    }
    const result = await client.statFile(sandboxId, path);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          file: result.file,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "mkdir") {
    const sandboxId = rest[1];
    const path = typeof options.path === "string" ? options.path.trim() : "";
    if (!sandboxId || !path) {
      throw new Error("usage: sandbox mkdir <sandboxId> --path <path> [--recursive false]");
    }
    const result = await client.mkdir(sandboxId, {
      path,
      recursive:
        options.recursive !== undefined ? parseBooleanOption(options.recursive) : undefined,
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          directory: result.directory,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "move-file") {
    const sandboxId = rest[1];
    const fromPath = typeof options.fromPath === "string" ? options.fromPath.trim() : "";
    const toPath = typeof options.toPath === "string" ? options.toPath.trim() : "";
    if (!sandboxId || !fromPath || !toPath) {
      throw new Error(
        "usage: sandbox move-file <sandboxId> --from-path <path> --to-path <path> [--overwrite]",
      );
    }
    const result = await client.moveFile(sandboxId, {
      fromPath,
      toPath,
      overwrite: parseBooleanOption(options.overwrite),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          moved: result.moved,
          file: result.file,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-status") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox git-status <sandboxId>");
    }
    const result = await client.gitStatus(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          status: result.status,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "billing") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox billing <sandboxId>");
    }
    const result = await client.billing(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          billing: result.billing,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "integration-leases") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox integration-leases <sandboxId>");
    }
    const result = await client.integrationLeases(sandboxId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          integrationLeases: result.integrationLeases,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "integration-attach") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error(
        "usage: sandbox integration-attach <sandboxId> --integration-connection <id> --integration-capabilities <csv>",
      );
    }
    const result = await client.attachIntegrationConnection(
      sandboxId,
      buildSandboxIntegrationAttachInput(options),
    );
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          integrationLeases: result.integrationLeases,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "integration-remove") {
    const sandboxId = rest[1];
    const leaseId = typeof options.leaseId === "string" ? options.leaseId.trim() : "";
    if (!sandboxId || !leaseId) {
      throw new Error("usage: sandbox integration-remove <sandboxId> --lease-id <id>");
    }
    const result = await client.removeIntegrationLease(sandboxId, leaseId);
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          integrationLeases: result.integrationLeases,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-diff") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error("usage: sandbox git-diff <sandboxId> [--base-ref <ref>]");
    }
    const baseRef =
      typeof options.baseRef === "string" && options.baseRef.trim()
        ? options.baseRef.trim()
        : undefined;
    const result = await client.gitDiff(sandboxId, {
      ...(baseRef ? { baseRef } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          diff: result.diff,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-branch") {
    const sandboxId = rest[1];
    const branch = typeof options.branch === "string" ? options.branch.trim() : "";
    const startPoint =
      typeof options.startPoint === "string" && options.startPoint.trim()
        ? options.startPoint.trim()
        : undefined;
    if (!sandboxId || !branch) {
      throw new Error(
        "usage: sandbox git-branch <sandboxId> --branch <name> [--create] [--start-point <ref>]",
      );
    }
    const result = await client.gitBranch(sandboxId, {
      branch,
      create: parseBooleanOption(options.create),
      ...(startPoint ? { startPoint } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          branch: result.branch,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-commit") {
    const sandboxId = rest[1];
    const message = typeof options.message === "string" ? options.message.trim() : "";
    const all = parseBooleanOption(options.all);
    const rawPaths =
      typeof options.paths === "string"
        ? options.paths
        : typeof options.path === "string"
          ? options.path
          : "";
    const paths = rawPaths
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    if (!sandboxId || !message || (!all && paths.length === 0)) {
      throw new Error(
        'usage: sandbox git-commit <sandboxId> --message "..." [--all|--paths <csv>]',
      );
    }
    const result = await client.gitCommit(sandboxId, {
      message,
      ...(all ? { all: true } : { paths }),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          commit: result.commit,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-pull") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error(
        "usage: sandbox git-pull <sandboxId> [--remote origin] [--branch main] [--rebase|--ff-only false]",
      );
    }
    const remote =
      typeof options.remote === "string" && options.remote.trim()
        ? options.remote.trim()
        : undefined;
    const branch =
      typeof options.branch === "string" && options.branch.trim()
        ? options.branch.trim()
        : undefined;
    const result = await client.gitPull(sandboxId, {
      ...(remote ? { remote } : {}),
      ...(branch ? { branch } : {}),
      ...(options.rebase !== undefined ? { rebase: parseBooleanOption(options.rebase) } : {}),
      ...(options.ffOnly !== undefined ? { ffOnly: parseBooleanOption(options.ffOnly) } : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          pull: result.pull,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "git-push") {
    const sandboxId = rest[1];
    if (!sandboxId) {
      throw new Error(
        "usage: sandbox git-push <sandboxId> [--remote origin] [--branch main] [--set-upstream] [--force-with-lease]",
      );
    }
    const remote =
      typeof options.remote === "string" && options.remote.trim()
        ? options.remote.trim()
        : undefined;
    const branch =
      typeof options.branch === "string" && options.branch.trim()
        ? options.branch.trim()
        : undefined;
    const result = await client.gitPush(sandboxId, {
      ...(remote ? { remote } : {}),
      ...(branch ? { branch } : {}),
      ...(options.setUpstream !== undefined
        ? { setUpstream: parseBooleanOption(options.setUpstream) }
        : {}),
      ...(options.forceWithLease !== undefined
        ? { forceWithLease: parseBooleanOption(options.forceWithLease) }
        : {}),
    });
    console.log(
      JSON.stringify(
        {
          sandbox: summarizeSandbox(result.sandbox),
          push: result.push,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "smoke") {
    const repo = typeof options.repo === "string" ? options.repo.trim() : undefined;
    const budgetUsd =
      typeof options.budgetUsd === "string"
        ? options.budgetUsd.trim()
        : typeof options.budget === "string"
          ? options.budget.trim()
          : undefined;
    const keep = parseBooleanOption(options.keep);
    const preview =
      options.preview !== undefined
        ? parseBooleanOption(options.preview)
        : !parseBooleanOption(options.noPreview);
    const smokeOptions: SandboxSmokeOptions = {
      ...(repo ? { repo } : {}),
      ...(budgetUsd ? { budgetUsd } : {}),
      keep,
      preview,
    };
    const cpu = parseNumberOption(options.cpu, "cpu");
    const memoryGb = parseNumberOption(options.memoryGb, "memory-gb");
    const diskGb = parseNumberOption(options.diskGb, "disk-gb");
    if (cpu !== undefined) smokeOptions.cpu = cpu;
    if (memoryGb !== undefined) smokeOptions.memoryGb = memoryGb;
    if (diskGb !== undefined) smokeOptions.diskGb = diskGb;
    const summary = await client.smoke(smokeOptions);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  throw new Error(
    "usage: sandbox <list|mcp-config|secrets|secret-create|secret-rotate|secret-attach|secret-revoke|secret-delete|snapshots|templates|template-launch|snapshot-fork|snapshot-validate|snapshot-publish|create|exec|port|preview|stop|delete|receipts|logs|billing|process-start|process-list|process-get|process-stop|process-stream|pty-start|pty-list|pty-get|pty-write|pty-stop|pty-stream|upload-file|download-file|list-files|search-files|delete-file|stat-file|mkdir|move-file|git-status|git-diff|git-branch|git-commit|git-pull|git-push|smoke> [args]",
  );
}

async function main() {
  const { command, options, rest } = parseArgs(process.argv.slice(2));
  const selectedAccount = resolveAccountOption(options);
  const selectedBaseUrl = resolveBaseUrlOption(options);
  if (selectedAccount) {
    process.env.OPENPOND_ACCOUNT = selectedAccount;
  }
  if (!selectedAccount && typeof options.handle === "string" && options.handle.trim().length > 0) {
    process.env.OPENPOND_ACCOUNT = options.handle.trim();
  }
  if (selectedBaseUrl) {
    process.env.OPENPOND_BASE_URL = selectedBaseUrl;
  }

  if (options.checkUpdate !== undefined || command === "check-update") {
    await runCheckUpdate();
    return;
  }

  if ((options.version !== undefined && !command) || command === "version") {
    console.log(getInstalledCliVersion());
    return;
  }

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "login") {
    await runLogin(options);
    return;
  }

  if (command === "profiles") {
    await runProfiles(options, rest);
    return;
  }

  if (command === "account") {
    await runAccount(options);
    return;
  }

  if (command === "health") {
    await runHealth(options);
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

  if (command === "backtest") {
    const subcommand = rest[0] || "run";
    if (subcommand === "run") {
      const target = rest[1];
      const toolName = rest[2];
      if (!target || !toolName) {
        throw new Error(
          "usage: backtest run <handle>/<repo> <tool> [--body <json>] [--branch <branch>] [--deployment-id <id>]",
        );
      }
      await runBacktestRun(options, target, toolName);
      return;
    }
    if (subcommand === "events") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: backtest events <handle>/<repo> [--run-id <id>] [--limit <n>]");
      }
      await runBacktestEvents(options, target);
      return;
    }
    if (subcommand === "get") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: backtest get <handle>/<repo> --run-id <id>");
      }
      await runBacktestGet(options, target);
      return;
    }
    throw new Error("usage: backtest <run|events|get> <handle>/<repo> [args]");
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
        "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]",
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
      "usage: template <status|branches|update> <handle>/<repo> [--env preview|production]",
    );
  }

  if (command === "sandbox-template") {
    await runSandboxTemplateCommand(options, rest);
    return;
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
    throw new Error("usage: repo <create|push> [--name <name>] [--path <dir>] [--branch <branch>]");
  }

  if (command === "organization" || command === "organizations") {
    await runOrganizationsCommand(options, rest);
    return;
  }

  if (command === "sandbox") {
    await runSandboxCommand(options, rest);
    return;
  }

  if (command === "apps") {
    const subcommand = rest[0];
    if (subcommand === "list") {
      await runAppsList(options);
      return;
    }
    if (subcommand === "code-visibility") {
      const target = rest[1];
      if (!target) {
        throw new Error("usage: apps code-visibility <handle>/<repo> --visibility public|private");
      }
      await runAppsCodeVisibility(options, target);
      return;
    }
    if (subcommand === "tools") {
      if (rest[1] === "execute") {
        const appId = rest[2];
        const deploymentId = rest[3];
        const toolName = rest[4];
        if (!appId || !deploymentId || !toolName) {
          throw new Error(
            "usage: apps tools execute <appId> <deploymentId> <tool> [--body <json>]",
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
        throw new Error("usage: apps deploy <handle>/<repo> [--env preview|production] [--watch]");
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
        throw new Error("usage: apps assistant <plan|performance> <handle>/<repo> --prompt <text>");
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
      "usage: apps <list|code-visibility|tools|deploy|env get|env set|performance|summary|assistant|store events|trade-facts|agent create|positions tx> [args]",
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
