import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  getDeploymentLogs,
  getDeploymentStatus,
  listApps,
  listUserTools,
  type AppListItem,
} from "../api";
import {
  DEFAULT_CACHE_TTL_MS,
  getCachedApps,
  getCachedTools,
  setCachedApps,
  setCachedTools,
} from "../cache";
import { loadConfig, saveGlobalConfig, type LocalConfig } from "../config";
import type { OpenPondSandboxClient } from "../sandbox/client";
import type {
  SandboxCreateInput,
  SandboxEnvVarInput,
  SandboxRecord,
  SandboxRuntime,
  SandboxRuntimeCreateInput,
  SandboxRuntimeMode,
  SandboxRuntimePromotionPolicy,
  SandboxSecretMetadata,
} from "../sandbox/types/index";
import { createOpenPondSandboxClient } from "../sandbox/client";
import type { SandboxTemplateManifest } from "../sandbox-template/manifest";
import {
  DEFAULT_OPENPOND_API_BASE_URL,
  DEFAULT_OPENPOND_WEB_BASE_URL,
} from "../urls";

export const DEFAULT_OPENPOND_API_HOST = new URL(DEFAULT_OPENPOND_API_BASE_URL)
  .hostname;
export const DEFAULT_OPENPOND_WEB_HOST = new URL(DEFAULT_OPENPOND_WEB_BASE_URL)
  .hostname;
export const SANDBOX_RUNTIME_MODES: SandboxRuntimeMode[] = [
  "readonly",
  "attempt",
  "feature",
  "rollout",
  "replay",
  "template_build",
  "scheduled_run",
  "patch_only",
  "hotfix",
  "multi_feature_batch",
];
export const SANDBOX_RUNTIME_PROMOTION_POLICIES: SandboxRuntimePromotionPolicy[] =
  ["none", "manual", "auto_after_checks"];

export type Command =
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
  | "project"
  | "agent"
  | "sandbox-template"
  | "organization"
  | "organizations"
  | "template"
  | "opentool"
  | "check-update"
  | "version"
  | "help";

export type SandboxCreatePlan = {
  sandbox: SandboxCreateInput;
  sandboxRuntime?: SandboxRuntimeCreateInput;
  runtimeId?: string;
};

export type SandboxCreatePlanResult = {
  sandbox: SandboxRecord;
  runtime?: SandboxRuntime;
};

export function getInstalledCliVersion(): string {
  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const raw = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function parseSemver(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }
  return [major, minor, patch];
}

export function compareSemver(left: string, right: string): number | null {
  const l = parseSemver(left);
  const r = parseSemver(right);
  if (!l || !r) return null;
  for (let i = 0; i < 3; i += 1) {
    if (l[i]! < r[i]!) return -1;
    if (l[i]! > r[i]!) return 1;
  }
  return 0;
}

export async function fetchLatestNpmVersion(
  packageName: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `npm registry request failed: ${response.status} ${text}`.trim()
      );
    }
    const payload = (await response.json().catch(() => ({}))) as {
      version?: unknown;
    };
    if (
      typeof payload.version !== "string" ||
      payload.version.trim().length === 0
    ) {
      throw new Error("npm registry payload missing version");
    }
    return payload.version.trim();
  } finally {
    clearTimeout(timer);
  }
}

export type RepoTarget = { handle: string; repo: string };

export function parseArgs(argv: string[]) {
  const args = [...argv];
  let command = "" as Command;
  const options: Record<string, string | boolean> = {};
  const rest: string[] = [];

  while (args.length > 0) {
    const next = args.shift()!;
    if (next.startsWith("--")) {
      const rawKey = next.slice(2);
      const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value =
        args[0] && !args[0].startsWith("--") ? args.shift()! : "true";
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

export function resolveAccountOption(
  options: Record<string, string | boolean>
): string | null {
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

export function resolveBaseUrlOption(
  options: Record<string, string | boolean>
): string | null {
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

export function resolveApiBaseUrlOption(
  options: Record<string, string | boolean>
): string | null {
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

export function resolveChatApiBaseUrlOption(
  options: Record<string, string | boolean>
): string | null {
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

export function resolveSandboxApiUrlOption(
  options: Record<string, string | boolean>
): string | null {
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

export function resolveSandboxBaseUrl(
  config: LocalConfig,
  options: Record<string, string | boolean>
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

export async function resolveSandboxClient(
  options: Record<string, string | boolean>
): Promise<OpenPondSandboxClient> {
  const config = await loadConfig();
  const uiBase = resolveBaseUrl(config);
  const apiKey = await ensureApiKey(config, uiBase);
  const sandboxApiUrl =
    resolveSandboxApiUrlOption(options) ||
    process.env.OPENPOND_SANDBOX_API_URL?.trim() ||
    null;
  return createOpenPondSandboxClient(
    sandboxApiUrl
      ? { apiKey, sandboxApiUrl }
      : { apiKey, baseUrl: resolveSandboxBaseUrl(config, options) }
  );
}

export function resolveBaseUrl(config: LocalConfig): string {
  const envBase = process.env.OPENPOND_BASE_URL;
  const base = envBase || config.baseUrl || DEFAULT_OPENPOND_WEB_BASE_URL;
  return base.replace(/\/$/, "");
}

export function mapUiBaseToApiBase(baseUrl: string | undefined): string | null {
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

export function resolvePublicApiBaseUrl(config?: LocalConfig): string {
  const envBase = process.env.OPENPOND_API_URL;
  const configuredApiBase = config?.apiBaseUrl?.trim();
  const mapped = mapUiBaseToApiBase(
    process.env.OPENPOND_BASE_URL || config?.baseUrl
  );
  const base =
    envBase || configuredApiBase || mapped || DEFAULT_OPENPOND_API_BASE_URL;
  return base.replace(/\/$/, "");
}

export function normalizeTemplateRepoUrl(
  input: string,
  baseUrl: string
): string {
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

export function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

export function parseJsonObjectOption(
  value: string,
  label: string
): Record<string, unknown> {
  const parsed = parseJsonOption(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function optionString(
  options: Record<string, string | boolean>,
  key: string
): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

export function requiredTeamId(
  options: Record<string, string | boolean>,
  usage: string
): string {
  const teamId = optionString(options, "teamId");
  if (!teamId) {
    throw new Error(`${usage} --team-id <id>`);
  }
  return teamId;
}

export function optionalJsonObject(
  options: Record<string, string | boolean>,
  key: string,
  label: string
): Record<string, unknown> | undefined {
  const value = optionString(options, key);
  return value ? parseJsonObjectOption(value, label) : undefined;
}

export function parseBooleanOption(
  value: string | boolean | undefined
): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

export function parseNumberOption(
  value: string | boolean | undefined,
  label: string
): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

export function parseIntegerOption(
  value: string | boolean | undefined,
  label: string
): number | undefined {
  const parsed = parseNumberOption(value, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

export function parseCsvOption(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseSandboxRuntimeModeOption(
  value: string | boolean | undefined
): SandboxRuntimeMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("runtime-mode must be a non-empty value");
  }
  const mode = value.trim() as SandboxRuntimeMode;
  if (!SANDBOX_RUNTIME_MODES.includes(mode)) {
    throw new Error(
      `runtime-mode must be one of ${SANDBOX_RUNTIME_MODES.join(", ")}`
    );
  }
  return mode;
}

export function parseSandboxRuntimePromotionPolicyOption(
  value: string | boolean | undefined
): SandboxRuntimePromotionPolicy | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("runtime-promotion-policy must be a non-empty value");
  }
  const policy = value.trim() as SandboxRuntimePromotionPolicy;
  if (!SANDBOX_RUNTIME_PROMOTION_POLICIES.includes(policy)) {
    throw new Error(
      `runtime-promotion-policy must be one of ${SANDBOX_RUNTIME_PROMOTION_POLICIES.join(
        ", "
      )}`
    );
  }
  return policy;
}

export function parseSandboxEnvOptions(
  options: Record<string, string | boolean>
): SandboxEnvVarInput[] {
  const refs = parseSandboxEnvAssignments(options.envRef, "env-ref").map(
    ({ name, value }) => ({ name, secretRef: value })
  );
  const literals = parseSandboxEnvAssignments(
    options.envLiteral,
    "env-literal"
  ).map(({ name, value }) => {
    if (
      isSecretLikeEnvName(name) &&
      !parseBooleanOption(options.allowPlainSecretEnv)
    ) {
      throw new Error(
        `refusing plaintext value for secret-like env ${name}; create a sandbox secret and pass --env-ref ${name}=openpond://secret/...`
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

export function parseSandboxTemplateEnvOptions(
  manifest: SandboxTemplateManifest,
  options: Record<string, string | boolean>
): SandboxEnvVarInput[] {
  const env = parseSandboxEnvOptions(options);
  const provided = new Set(env.map((item) => item.name));
  const providedByName = new Map(env.map((item) => [item.name, item]));
  for (const requirement of manifest.inputs.env) {
    const value = providedByName.get(requirement.name);
    if (value?.value !== undefined && requirement.secret !== false) {
      throw new Error(
        `sandbox template env ${requirement.name} requires a secret ref. Pass --env-ref ${requirement.name}=openpond://secret/...`
      );
    }
  }
  const missing = manifest.inputs.env
    .filter((item) => item.required && !provided.has(item.name))
    .map((item) => item.name);
  if (missing.length > 0) {
    throw new Error(
      `missing required sandbox template env refs: ${missing.join(
        ", "
      )}. Pass --env-ref NAME=openpond://secret/...`
    );
  }
  return env;
}

export function parseSandboxEnvAssignments(
  value: string | boolean | undefined,
  label: string
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

export function isSecretLikeEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|DATABASE_URL|DSN)/i.test(
    name
  );
}

export async function readSandboxSecretValue(
  options: Record<string, string | boolean>,
  label: string
): Promise<string> {
  if (
    typeof options.value === "string" ||
    typeof options.secretValue === "string"
  ) {
    throw new Error(
      "sandbox secret values must be provided with --stdin or the masked prompt"
    );
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

export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

export function readMaskedLine(prompt: string): Promise<string> {
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

export function summarizeSandboxSecret(
  secret: SandboxSecretMetadata
): Record<string, unknown> {
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

export function parseTimeOption(
  value: string | boolean | undefined,
  label: string
): string | undefined {
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

export function resolveApiKey(config: LocalConfig): string | null {
  const envKey = process.env.OPENPOND_API_KEY?.trim();
  if (envKey) return envKey;
  const stored = config.apiKey?.trim();
  if (stored) return stored;
  const legacy = config.token?.trim();
  if (legacy && legacy.startsWith("opk_")) return legacy;
  return null;
}

export function resolveTemplateEnvironment(
  value: string | undefined
): "preview" | "production" {
  if (!value) return "production";
  const normalized = value.toLowerCase();
  if (normalized === "preview" || normalized === "production") {
    return normalized;
  }
  throw new Error("env must be preview or production");
}

export const UI_API_KEY_URL = `${DEFAULT_OPENPOND_WEB_BASE_URL}/settings/api-keys`;

export async function promptForApiKey(): Promise<string> {
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

export async function ensureApiKey(
  config: LocalConfig,
  baseUrl: string
): Promise<string> {
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

export async function promptConfirm(
  question: string,
  defaultValue = false
): Promise<boolean> {
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

export async function promptForPath(defaultPath: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = (
      await rl.question(`Local path (default: ${defaultPath}): `)
    ).trim();
    return answer || defaultPath;
  } finally {
    rl.close();
  }
}

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export async function runCommand(
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

export async function runShellCommand(
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutSeconds?: number;
    inherit?: boolean;
  } = {}
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

export async function getGitRemoteUrl(
  cwd: string,
  remoteName: string
): Promise<string | null> {
  const result = await runCommand("git", ["remote", "get-url", remoteName], {
    cwd,
  });
  if (result.code !== 0) return null;
  const url = result.stdout.trim();
  return url.length > 0 ? url : null;
}

export function resolveRepoUrl(response: {
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

export function formatTokenizedRepoUrl(repoUrl: string, token: string): string {
  const url = new URL(repoUrl);
  const encodedToken = encodeURIComponent(token);
  return `${url.protocol}//x-access-token:${encodedToken}@${url.host}${url.pathname}`;
}

export function formatTokenizedRepoUrlForPrint(repoUrl: string): string {
  const url = new URL(repoUrl);
  return `${url.protocol}//x-access-token:$OPENPOND_API_KEY@${url.host}${url.pathname}`;
}

export function redactToken(value: string): string {
  return value.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

export function warnOnRepoHostMismatch(repoUrl: string): void {
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

export function parseHandleRepo(value: string): RepoTarget {
  const parts = value.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("expected <handle>/<repo>");
  }
  return { handle: parts[0]!, repo: parts[1]! };
}

export function normalizeRepoName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export async function fetchAppsWithCache(params: {
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

export async function fetchToolsWithCache(params: {
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

export async function resolveAppTarget(
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
    const candidates = [app.repo, app.gitRepo, app.id].map(normalizeRepoName);
    return candidates.includes(normalizedRepo);
  });
  if (!match) {
    throw new Error(`app not found for ${handle}/${repo}`);
  }
  return { app: match, handle, repo };
}

export async function pollDeploymentLogs(params: {
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
