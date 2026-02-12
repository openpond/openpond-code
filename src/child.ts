import { connect } from "node:net";
import { argv } from "node:process";

import { loadConfig } from "./config";
import { attachJsonLineReader, getSocketPath, writeJsonLine } from "./ipc";
import { ChatWorker } from "./chat-worker";
import { HistoryWorker } from "./history-worker";

type Mode = "chat" | "history";

function parseArg(flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

async function main() {
  const mode = (parseArg("--mode") ?? "chat") as Mode;
  const tabId = parseArg("--tab") ?? `tab-${Date.now()}`;
  const socketPath = process.env.OPENPOND_IPC_SOCKET || getSocketPath();

  const config = await loadConfig();
  const baseUrl =
    config.baseUrl || process.env.OPENPOND_BASE_URL || "http://localhost:3000";

  const socket = connect(socketPath);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

  writeJsonLine(socket, { type: "register", tabId, mode });

  let handler: { handleInput: (text: string) => Promise<void> } | null = null;

  if (mode === "history") {
    const worker = new HistoryWorker({
      onLine: (text) => writeJsonLine(socket, { type: "line", tabId, text }),
      onRows: (rows) => writeJsonLine(socket, { type: "history", tabId, rows }),
      onState: (state) => writeJsonLine(socket, { type: "state", tabId, state }),
    });
    handler = worker;
  } else {
    const worker = new ChatWorker(baseUrl, config, {
      onLine: (text) => writeJsonLine(socket, { type: "line", tabId, text }),
      onStream: (text) => writeJsonLine(socket, { type: "stream", tabId, text }),
      onState: (state) => writeJsonLine(socket, { type: "state", tabId, state }),
    });
    worker.start();
    handler = worker;
  }

  attachJsonLineReader(socket, (message) => {
    if (message.type === "input" && typeof message.text === "string") {
      void handler?.handleInput(message.text);
    }
    if (message.type === "shutdown") {
      socket.end();
      process.exit(0);
    }
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "child failed";
  console.error(message);
  process.exit(1);
});
