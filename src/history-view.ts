import { listHistory } from "./history";

export async function buildHistorySummary(rootDir: string): Promise<string[]> {
  const records = await listHistory(rootDir, 50);
  const headers = ["#", "ID", "CONVO", "APP", "MESSAGES", "UPDATED", "GIT"];
  const rows = records.map((record, index) => [
    String(index + 1),
    record.id,
    record.conversationId ?? "—",
    record.appId ?? "—",
    String(record.messages.length),
    record.updatedAt.replace("T", " ").slice(0, 19),
    record.gitHash ? record.gitHash.slice(0, 8) : "—",
  ]);

  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => (row[index] ?? "").length)
    )
  );
  const pad = (value: string, length: number) => value.padEnd(length, " ");
  const line = (cols: string[]) =>
    cols.map((col, i) => pad(col, widths[i])).join("  ");

  return [
    line(headers),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ];
}
