import { createServer, type Server, type Socket } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type IpcMessage = Record<string, unknown>;

export function getSocketPath(): string {
  const dir = path.join(os.homedir(), ".openpond");
  return path.join(dir, "openpond-code.sock");
}

export async function ensureSocketDir(socketPath: string): Promise<void> {
  const dir = path.dirname(socketPath);
  await fs.mkdir(dir, { recursive: true });
}

export function writeJsonLine(socket: Socket, payload: IpcMessage): void {
  socket.write(`${JSON.stringify(payload)}\n`);
}

export function attachJsonLineReader(
  socket: Socket,
  onMessage: (message: IpcMessage) => void
): void {
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString("utf8");
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as IpcMessage;
          onMessage(parsed);
        } catch {
          // ignore malformed json
        }
      }
      idx = buffer.indexOf("\n");
    }
  });
}

export async function createIpcServer(
  socketPath: string,
  onConnection: (socket: Socket) => void
): Promise<Server> {
  await ensureSocketDir(socketPath);
  try {
    await fs.unlink(socketPath);
  } catch {
    // ignore
  }
  const server = createServer((socket) => {
    onConnection(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}
