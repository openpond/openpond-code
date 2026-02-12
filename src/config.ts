import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LocalConfig = {
  baseUrl?: string;
  apiKey?: string;
  token?: string;
  deviceCode?: string | null;
  appId?: string | null;
  conversationId?: string | null;
  lspEnabled?: boolean;
  executionMode?: "local" | "hosted";
  mode?: "general" | "builder";
};

const GLOBAL_DIRNAME = ".openpond";
const GLOBAL_CONFIG_FILENAME = "config.json";

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

export async function loadGlobalConfig(): Promise<LocalConfig> {
  return loadConfigFile(getGlobalConfigPath());
}

export async function loadConfig(): Promise<LocalConfig> {
  return loadGlobalConfig();
}

export async function saveConfig(next: LocalConfig): Promise<void> {
  const filePath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined && value !== null)
    ),
    null,
    2
  );
  await fs.writeFile(filePath, payload, "utf-8");
}

export async function saveGlobalConfig(next: LocalConfig): Promise<void> {
  const filePath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const current = await loadGlobalConfig();
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  const payload = JSON.stringify(merged, null, 2);
  await fs.writeFile(filePath, payload, "utf-8");
}
