import { buildHistorySummary } from "./history-view";
import { listHistory, loadHistory } from "./history";

export type HistoryWorkerEvents = {
  onLine: (text: string) => void;
  onRows: (rows: string[]) => void;
  onState: (state: {
    modeLabel: string;
    loginStatus: string;
    lspLabel: string;
    conversationId: string | null;
    footerHint: string;
  }) => void;
};

export class HistoryWorker {
  private events: HistoryWorkerEvents;
  private lastRecords: Awaited<ReturnType<typeof listHistory>> = [];

  constructor(events: HistoryWorkerEvents) {
    this.events = events;
    this.events.onState({
      modeLabel: "history",
      loginStatus: "idle",
      lspLabel: "lsp:off",
      conversationId: null,
      footerHint: "type: show <id> | refresh",
    });
    void this.refresh();
  }

  async handleInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === "refresh") {
      await this.refresh();
      return;
    }
    if (trimmed.startsWith("show ")) {
      const value = trimmed.slice(5).trim();
      if (!value) {
        this.events.onLine("usage: show <id>");
        return;
      }
      let record = this.lastRecords.find((item) => item.id === value) ?? null;
      if (!record) {
        const index = Number(value);
        if (!Number.isNaN(index) && index > 0) {
          record = this.lastRecords[index - 1] ?? null;
        }
      }
      if (!record) {
        const fallback = await loadHistory(process.cwd(), value);
        if (!fallback) {
          this.events.onLine(`not found: ${value}`);
          return;
        }
        record = fallback;
      }
      this.events.onLine(`history ${record.id} (${record.messages.length} messages)`);
      record.messages.slice(-20).forEach((msg) => {
        this.events.onLine(`${msg.role}: ${msg.text}`);
      });
      return;
    }
    this.events.onLine("unknown command (try: show <id> | refresh)");
  }

  private async refresh(): Promise<void> {
    this.lastRecords = await listHistory(process.cwd(), 50);
    const rows = await buildHistorySummary(process.cwd());
    this.events.onRows(rows);
  }
}
