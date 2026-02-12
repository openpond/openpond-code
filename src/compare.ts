import type { RunSummary } from "./runs";

export type CompareResult = {
  ok: boolean;
  differences: string[];
};

function summarizeCalls(run: RunSummary, index: number): string[] {
  const result = run.results[index];
  if (!result) return [];
  return (result.toolCalls || []).map((call) => call.name);
}

export function compareRuns(a: RunSummary, b: RunSummary): CompareResult {
  const differences: string[] = [];
  const max = Math.max(a.results.length, b.results.length);
  for (let i = 0; i < max; i += 1) {
    const callsA = summarizeCalls(a, i);
    const callsB = summarizeCalls(b, i);
    if (callsA.join(",") !== callsB.join(",")) {
      differences.push(
        `prompt ${i + 1}: ${callsA.join("|") || "<none>"} vs ${callsB.join("|") || "<none>"}`
      );
    }
  }
  return { ok: differences.length === 0, differences };
}
