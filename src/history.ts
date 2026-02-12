import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HISTORY_DIRNAME = "history";
const GLOBAL_DIRNAME = ".openpond-code";

export type HistoryEntry = {
  id: string;
  conversationId?: string | null;
  appId?: string | null;
  gitHash?: string | null;
  startedAt: string;
  updatedAt: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    type: string;
    text: string;
    createdAt: string;
  }>;
};

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const hasPackage = existsSync(path.join(dir, "package.json"));
    const hasCli = existsSync(path.join(dir, "src", "cli-package.ts"));
    if (hasPackage && hasCli) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export function getHistoryDir(rootDir: string): string {
  return path.join(os.homedir(), GLOBAL_DIRNAME, HISTORY_DIRNAME);
}

export async function saveHistory(rootDir: string, record: HistoryEntry): Promise<void> {
  const dir = getHistoryDir(rootDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${record.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

export async function listHistory(rootDir: string, limit = 50): Promise<HistoryEntry[]> {
  const dir = getHistoryDir(rootDir);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
  const stats = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      return { file, time: stat.mtimeMs };
    })
  );
  const sorted = stats.sort((a, b) => b.time - a.time).slice(0, limit);
  const records: HistoryEntry[] = [];
  for (const entry of sorted) {
    const filePath = path.join(dir, entry.file);
    const raw = await fs.readFile(filePath, "utf-8");
    records.push(JSON.parse(raw) as HistoryEntry);
  }
  return records;
}

export async function loadHistory(
  rootDir: string,
  id: string
): Promise<HistoryEntry | null> {
  const filePath = path.join(getHistoryDir(rootDir), `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as HistoryEntry;
  } catch {
    return null;
  }
}
