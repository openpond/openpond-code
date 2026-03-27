import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LocalSessionConfig = {
  token?: string;
  appId?: string | null;
  conversationId?: string | null;
};

export type LocalAccountConfig = {
  handle: string;
  apiKey?: string;
  baseUrl?: string;
  environment?: string;
  session?: LocalSessionConfig;
};

export type LocalConfig = {
  accounts?: LocalAccountConfig[];
  activeHandle?: string;
  baseUrl?: string;
  apiKey?: string;
  token?: string;
  appId?: string | null;
  conversationId?: string | null;
  lspEnabled?: boolean;
  executionMode?: "local" | "hosted";
  mode?: "general" | "builder";
};

export type LoadConfigOptions = {
  account?: string;
  baseUrl?: string;
};

const GLOBAL_DIRNAME = ".openpond";
const GLOBAL_CONFIG_FILENAME = "config.json";
const DEFAULT_ACCOUNT_HANDLE = "default";
const ACCOUNT_SCOPED_KEYS = [
  "apiKey",
  "baseUrl",
  "token",
  "appId",
  "conversationId",
] as const;

export function getConfigPath(): string {
  return getGlobalConfigPath();
}

function getGlobalConfigPath(): string {
  return path.join(os.homedir(), GLOBAL_DIRNAME, GLOBAL_CONFIG_FILENAME);
}

async function loadConfigFile(filePath: string): Promise<LocalConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as LocalConfig;
  } catch {
    return {};
  }
}

function hasOwn<T extends object>(value: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeHandle(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function handleEquals(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findAccountIndex(
  accounts: LocalAccountConfig[],
  handle: string,
  baseUrl?: string | null
): number {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return accounts.findIndex((candidate) => {
    if (!handleEquals(candidate.handle, handle)) return false;
    if (!normalizedBaseUrl) return true;
    return normalizeBaseUrl(candidate.baseUrl) === normalizedBaseUrl;
  });
}

function sanitizeSession(value: unknown): LocalSessionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const out: LocalSessionConfig = {};
  if (typeof input.token === "string") out.token = input.token;
  if (typeof input.appId === "string" || input.appId === null) {
    out.appId = input.appId;
  }
  if (typeof input.conversationId === "string" || input.conversationId === null) {
    out.conversationId = input.conversationId;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeAccount(value: unknown): LocalAccountConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const handle = normalizeHandle(
    typeof input.handle === "string" ? input.handle : undefined
  );
  if (!handle) return null;

  const out: LocalAccountConfig = { handle };
  if (typeof input.apiKey === "string") out.apiKey = input.apiKey;
  if (typeof input.baseUrl === "string") out.baseUrl = input.baseUrl;
  if (typeof input.environment === "string") out.environment = input.environment;
  const session = sanitizeSession(input.session);
  if (session) out.session = session;
  return out;
}

function extractLegacySession(raw: LocalConfig): LocalSessionConfig | undefined {
  const session: LocalSessionConfig = {};
  if (typeof raw.token === "string") session.token = raw.token;
  if (typeof raw.appId === "string" || raw.appId === null) {
    session.appId = raw.appId;
  }
  if (typeof raw.conversationId === "string" || raw.conversationId === null) {
    session.conversationId = raw.conversationId;
  }
  return Object.keys(session).length > 0 ? session : undefined;
}

function extractLegacyAccount(raw: LocalConfig, handle: string): LocalAccountConfig {
  const out: LocalAccountConfig = { handle };
  if (typeof raw.apiKey === "string") out.apiKey = raw.apiKey;
  if (typeof raw.baseUrl === "string") out.baseUrl = raw.baseUrl;
  const session = extractLegacySession(raw);
  if (session) out.session = session;
  return out;
}

function normalizeGlobalConfig(raw: LocalConfig): LocalConfig {
  const normalized: LocalConfig = {};

  if (typeof raw.lspEnabled === "boolean") normalized.lspEnabled = raw.lspEnabled;
  if (raw.executionMode === "local" || raw.executionMode === "hosted") {
    normalized.executionMode = raw.executionMode;
  }
  if (raw.mode === "general" || raw.mode === "builder") {
    normalized.mode = raw.mode;
  }

  const accounts: LocalAccountConfig[] = [];
  const sourceAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  for (const candidate of sourceAccounts) {
    const account = sanitizeAccount(candidate);
    if (!account) continue;
    if (findAccountIndex(accounts, account.handle, account.baseUrl) !== -1) continue;
    accounts.push(account);
  }

  if (accounts.length === 0) {
    const legacyHandle =
      normalizeHandle(raw.activeHandle) || DEFAULT_ACCOUNT_HANDLE;
    accounts.push(extractLegacyAccount(raw, legacyHandle));
  }

  const requested = normalizeHandle(raw.activeHandle);
  const resolvedHandle =
    requested && findAccountIndex(accounts, requested) !== -1
      ? accounts[findAccountIndex(accounts, requested)]!.handle
      : accounts[0]!.handle;

  normalized.accounts = accounts;
  normalized.activeHandle = resolvedHandle;
  return normalized;
}

function resolveRequestedHandle(
  global: LocalConfig,
  explicitAccount?: string
): string {
  const accounts = global.accounts ?? [];
  const requested =
    normalizeHandle(explicitAccount) ||
    normalizeHandle(process.env.OPENPOND_ACCOUNT) ||
    normalizeHandle(global.activeHandle) ||
    accounts[0]?.handle ||
    DEFAULT_ACCOUNT_HANDLE;

  const idx = findAccountIndex(accounts, requested);
  return idx === -1 ? requested : accounts[idx]!.handle;
}

function ensureAccount(
  accounts: LocalAccountConfig[],
  handle: string,
  baseUrl?: string | null
): LocalAccountConfig {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const idx = findAccountIndex(accounts, handle, normalizedBaseUrl);
  if (idx !== -1) {
    return accounts[idx]!;
  }
  if (!normalizedBaseUrl) {
    const firstByHandle = findAccountIndex(accounts, handle);
    if (firstByHandle !== -1) {
      return accounts[firstByHandle]!;
    }
  }
  const next: LocalAccountConfig = { handle };
  if (normalizedBaseUrl) {
    next.baseUrl = normalizedBaseUrl;
  }
  accounts.push(next);
  return next;
}

function cleanupAccount(account: LocalAccountConfig): void {
  if (account.session && Object.keys(account.session).length === 0) {
    delete account.session;
  }
}

function applyScopedKey(
  account: LocalAccountConfig,
  key: (typeof ACCOUNT_SCOPED_KEYS)[number],
  value: unknown,
  options: { undefinedDeletes: boolean }
): void {
  const shouldDelete = value === null || (value === undefined && options.undefinedDeletes);
  switch (key) {
    case "apiKey": {
      if (shouldDelete) {
        delete account.apiKey;
        return;
      }
      if (typeof value === "string") {
        account.apiKey = value;
      }
      return;
    }
    case "baseUrl": {
      if (shouldDelete) {
        delete account.baseUrl;
        return;
      }
      if (typeof value === "string") {
        account.baseUrl = value;
      }
      return;
    }
    case "token":
    case "appId":
    case "conversationId": {
      if (!account.session) account.session = {};
      if (shouldDelete) {
        delete account.session[key];
        cleanupAccount(account);
        return;
      }
      if (typeof value === "string" || value === null) {
        account.session[key] = value;
      }
      cleanupAccount(account);
      return;
    }
  }
}

function applyAccountPatch(
  global: LocalConfig,
  source: LocalConfig,
  options: { undefinedDeletes: boolean }
): boolean {
  const hasScopedPatch = ACCOUNT_SCOPED_KEYS.some((key) => hasOwn(source, key));
  if (!hasScopedPatch) return false;

  const accounts = global.accounts ?? [];
  const handle = resolveRequestedHandle(global, source.activeHandle);
  const requestedBaseUrl = normalizeBaseUrl(
    hasOwn(source, "baseUrl")
      ? (source.baseUrl ?? null)
      : process.env.OPENPOND_BASE_URL
  );
  const account = ensureAccount(accounts, handle, requestedBaseUrl);
  for (const key of ACCOUNT_SCOPED_KEYS) {
    if (!hasOwn(source, key)) continue;
    applyScopedKey(account, key, (source as Record<string, unknown>)[key], options);
  }
  global.accounts = accounts;
  global.activeHandle = handle;
  return true;
}

function applyTopLevelPatch(global: LocalConfig, source: LocalConfig): void {
  if (hasOwn(source, "lspEnabled")) {
    if (typeof source.lspEnabled === "boolean") {
      global.lspEnabled = source.lspEnabled;
    } else if (source.lspEnabled === null) {
      delete global.lspEnabled;
    }
  }
  if (hasOwn(source, "executionMode")) {
    if (source.executionMode === "local" || source.executionMode === "hosted") {
      global.executionMode = source.executionMode;
    } else if (source.executionMode === null) {
      delete global.executionMode;
    }
  }
  if (hasOwn(source, "mode")) {
    if (source.mode === "general" || source.mode === "builder") {
      global.mode = source.mode;
    } else if (source.mode === null) {
      delete global.mode;
    }
  }
  if (typeof source.activeHandle === "string" && source.activeHandle.trim().length > 0) {
    const requested = resolveRequestedHandle(global, source.activeHandle);
    global.activeHandle = requested;
  }
}

async function writeGlobalConfig(next: LocalConfig): Promise<void> {
  const filePath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(next, null, 2);
  await fs.writeFile(filePath, payload, "utf-8");
}

export async function loadGlobalConfig(): Promise<LocalConfig> {
  const raw = await loadConfigFile(getGlobalConfigPath());
  return normalizeGlobalConfig(raw);
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LocalConfig> {
  const global = await loadGlobalConfig();
  const accounts = global.accounts ?? [];
  const requested = resolveRequestedHandle(global, options.account);
  const requestedBaseUrl = normalizeBaseUrl(
    options.baseUrl ?? process.env.OPENPOND_BASE_URL
  );
  const idxWithBase = findAccountIndex(accounts, requested, requestedBaseUrl);
  const idx = idxWithBase !== -1 ? idxWithBase : findAccountIndex(accounts, requested);
  const account = idx === -1 ? null : accounts[idx]!;
  const session = account?.session;
  return {
    ...global,
    activeHandle: requested,
    apiKey: account?.apiKey,
    baseUrl: account?.baseUrl,
    token: session?.token,
    appId: session?.appId,
    conversationId: session?.conversationId,
  };
}

export async function saveConfig(next: LocalConfig): Promise<void> {
  const global = normalizeGlobalConfig(next);
  applyTopLevelPatch(global, next);
  applyAccountPatch(global, next, { undefinedDeletes: true });
  await writeGlobalConfig(global);
}

export async function saveGlobalConfig(next: LocalConfig): Promise<void> {
  const current = await loadGlobalConfig();
  applyTopLevelPatch(current, next);
  applyAccountPatch(current, next, { undefinedDeletes: false });
  await writeGlobalConfig(current);
}
