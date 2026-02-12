import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

export type RunSummary = {
  id: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  suiteId?: string;
  mode?: "suite" | "training";
  reward?: number;
  results: Array<{
    id: string;
    ok: boolean;
    prompt: string;
    assistantText?: string;
    filesWritten: string[];
    errors: string[];
    toolCalls?: Array<{
      name: string;
      args?: Record<string, unknown>;
    }>;
    toolOutputs?: Array<{
      name?: string;
      ok: boolean;
      output?: unknown;
      error?: string;
    }>;
    checks?: Array<{
      kind: "store" | "onchain";
      label?: string;
      ok: boolean;
      details?: string;
      data?: unknown;
      reasons?: string[];
    }>;
    verification?: Array<{
      step: "validate" | "build" | "rules";
      ok: boolean;
      output: string;
      reasons?: string[];
    }>;
    reward?: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    promptHash?: string;
    diffs?: Array<{ path: string; diff: string }>;
  }>;
  meta?: {
    promptRulesHash?: string;
    templateHash?: string;
    templatePath?: string;
    gitHash?: string;
    suitePath?: string;
  };
};

const ARTIFACTS_DIRNAME = "artifacts";
const RUNS_DIRNAME = "tests";
const TRAINING_DIRNAME = "training";
const TRAINING_METADATA = "metadata.json";

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

export function getArtifactsDir(rootDir: string): string {
  const projectRoot = findProjectRoot(rootDir);
  return path.join(projectRoot, ARTIFACTS_DIRNAME);
}

export function getRunsDir(rootDir: string): string {
  return path.join(getArtifactsDir(rootDir), RUNS_DIRNAME);
}

export function getTrainingDir(rootDir: string): string {
  return path.join(getArtifactsDir(rootDir), TRAINING_DIRNAME);
}

async function nextRunId(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let maxId = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const base = entry.name.replace(/\.json$/, "");
    if (!/^\d{4}$/.test(base)) continue;
    const value = Number(base);
    if (Number.isFinite(value)) {
      maxId = Math.max(maxId, value);
    }
  }
  return String(maxId + 1).padStart(4, "0");
}

export async function saveRun(rootDir: string, run: RunSummary): Promise<string> {
  const baseDir = getRunsDir(rootDir);
  const gitHash = run.meta?.gitHash;
  const dir = gitHash ? path.join(baseDir, gitHash) : baseDir;
  await fs.mkdir(dir, { recursive: true });
  const runId = await nextRunId(dir);
  const fileName = `${runId}.json`;
  const filePath = path.join(dir, fileName);
  run.id = runId;
  await fs.writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf-8");
  return filePath;
}

export async function saveTrainingJsonl(
  rootDir: string,
  runId: string,
  jsonl: string
): Promise<string> {
  const dir = getTrainingDir(rootDir);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${runId}.jsonl`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, jsonl, "utf-8");
  return filePath;
}

export async function saveTrainingMetadata(
  rootDir: string,
  entry: {
    runId: string;
    createdAt: string;
    promptRulesHash?: string;
    templateHash?: string;
    templatePath?: string;
    gitHash?: string;
    jobName?: string;
    outputModel?: string;
    remoteUrl?: string;
    state?: string;
  }
): Promise<string> {
  const dir = getTrainingDir(rootDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, TRAINING_METADATA);
  let existing: any[] = [];
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    existing = JSON.parse(raw) as any[];
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  existing.push(entry);
  await fs.writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
  return filePath;
}

export async function loadTrainingMetadata(
  rootDir: string
): Promise<
  Array<{
    runId: string;
    createdAt: string;
    promptRulesHash?: string;
    templateHash?: string;
    templatePath?: string;
    gitHash?: string;
    jobName?: string;
    outputModel?: string;
    remoteUrl?: string;
    state?: string;
  }>
> {
  const dir = getTrainingDir(rootDir);
  const filePath = path.join(dir, TRAINING_METADATA);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listRuns(rootDir: string, limit = 10): Promise<RunSummary[]> {
  const dir = getRunsDir(rootDir);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path.join(dir, entry.name));
    }
    if (entry.isDirectory()) {
      const nested = await fs
        .readdir(path.join(dir, entry.name), { withFileTypes: true })
        .catch(() => []);
      for (const item of nested) {
        if (item.isFile() && item.name.endsWith(".json")) {
          files.push(path.join(dir, entry.name, item.name));
        }
      }
    }
  }

  const stats = await Promise.all(
    files.map(async (filePath) => {
      const stat = await fs.stat(filePath);
      return { filePath, time: stat.mtimeMs };
    })
  );
  const sorted = stats.sort((a, b) => b.time - a.time).slice(0, limit);
  const runs: RunSummary[] = [];
  for (const entry of sorted) {
    const raw = await fs.readFile(entry.filePath, "utf-8");
    runs.push(JSON.parse(raw) as RunSummary);
  }
  return runs;
}

export async function loadRun(
  rootDir: string,
  runId: string
): Promise<RunSummary | null> {
  const baseDir = getRunsDir(rootDir);
  const filePath = path.join(baseDir, `${runId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as RunSummary;
  } catch {
    const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nestedDir = path.join(baseDir, entry.name);
      const nestedPath = path.join(nestedDir, `${runId}.json`);
      try {
        const raw = await fs.readFile(nestedPath, "utf-8");
        return JSON.parse(raw) as RunSummary;
      } catch {
        const nestedEntries = await fs
          .readdir(nestedDir, { withFileTypes: true })
          .catch(() => []);
        for (const nestedEntry of nestedEntries) {
          if (!nestedEntry.isFile() || !nestedEntry.name.endsWith(".json")) continue;
          const raw = await fs.readFile(
            path.join(nestedDir, nestedEntry.name),
            "utf-8"
          );
          const parsed = JSON.parse(raw) as RunSummary;
          if (parsed.id === runId) {
            return parsed;
          }
        }
      }
    }
    return null;
  }
}
