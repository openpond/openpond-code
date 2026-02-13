import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  chatRequest,
  createLocalProject,
  pollDeviceLogin,
  startDeviceLogin,
} from "./api";
import { saveConfig, saveGlobalConfig, type LocalConfig } from "./config";
import { loadHistory, saveHistory, type HistoryEntry } from "./history";
import { getGitHash } from "./hash";
import { consumeStream } from "./stream";
import type {
  ChatRequestBody,
  ResponseItem,
  ToolCallItem,
  ToolOutputItem,
} from "./types";
import { executeLocalTool } from "./tools";

type LoginState =
  | { status: "idle" }
  | { status: "ready"; token: string }
  | { status: "pending"; userCode: string; verificationUrl: string; deviceCode: string }
  | { status: "error"; message: string };

export type ChatWorkerEvents = {
  onLine: (text: string) => void;
  onStream: (text: string) => void;
  onState: (state: {
    modeLabel: string;
    loginStatus: string;
    lspLabel: string;
    conversationId: string | null;
    footerHint: string;
  }) => void;
};

export class ChatWorker {
  private baseUrl: string;
  private config: LocalConfig;
  private events: ChatWorkerEvents;

  private items: ResponseItem[] = [];
  private readSet = new Set<string>();
  private conversationId: string | null = null;
  private appId: string | null = null;
  private chatMode: "general" | "builder" = "builder";
  private loginState: LoginState = { status: "idle" };
  private streamingText = "";
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private historyId = `chat-${Date.now()}`;
  private historyStartedAt = new Date().toISOString();
  private gitHash: string | null = null;

  constructor(baseUrl: string, initialConfig: LocalConfig, events: ChatWorkerEvents) {
    this.baseUrl = baseUrl;
    this.config = initialConfig;
    this.events = events;
    this.conversationId = initialConfig.conversationId ?? null;
    this.appId = initialConfig.appId ?? null;
    this.chatMode = initialConfig.mode ?? "builder";
    if (initialConfig.token) {
      this.loginState = { status: "ready", token: initialConfig.token };
    }
  }

  start(): void {
    this.emitState();
  }

  stop(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async handleInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) {
      await this.handleCommand(trimmed);
      return;
    }
    await this.sendMessage(trimmed);
  }

  private token(): string | null {
    return this.loginState.status === "ready" ? this.loginState.token : null;
  }

  private modeLabel(): string {
    if (this.chatMode === "builder") {
      return this.appId ? `builder:${this.appId}` : "builder";
    }
    return "chat";
  }

  private lspLabel(): string {
    return "lsp:off";
  }

  private footerHint(): string {
    if (this.loginState.status === "pending") {
      return "login pending · /login check";
    }
    return "enter send · /help";
  }

  private emitState(): void {
    this.events.onState({
      modeLabel: this.modeLabel(),
      loginStatus: this.loginState.status,
      lspLabel: this.lspLabel(),
      conversationId: this.conversationId,
      footerHint: this.footerHint(),
    });
  }

  private async persistConfig(overrides: Partial<LocalConfig> = {}): Promise<void> {
    this.config = { ...this.config, ...overrides };
    await saveConfig(this.config);
    if (overrides.token || overrides.baseUrl || overrides.deviceCode) {
      await saveGlobalConfig(this.config);
    }
  }

  private appendLine(text: string): void {
    this.events.onLine(text);
  }

  private updateStreaming(text: string): void {
    this.streamingText = text;
    this.events.onStream(text);
  }

  private clearStreaming(): void {
    this.streamingText = "";
    this.events.onStream("");
  }


  private async startLogin(): Promise<void> {
    this.loginState = { status: "pending", userCode: "", verificationUrl: "", deviceCode: "" };
    this.emitState();
    await this.persistConfig({ token: undefined, deviceCode: undefined });
    try {
      const response = await startDeviceLogin(this.baseUrl);
      this.loginState = {
        status: "pending",
        userCode: response.userCode,
        verificationUrl: response.verificationUrl,
        deviceCode: response.deviceCode,
      };
      await this.persistConfig({ deviceCode: response.deviceCode });
      this.appendLine(`login: code ${response.userCode}`);
      this.appendLine(`login: url ${response.verificationUrl}`);
      this.emitState();
      this.scheduleLoginPoll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      this.loginState = { status: "error", message };
      this.appendLine(`login error: ${message}`);
      this.emitState();
    }
  }

  private scheduleLoginPoll(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
    this.pollingTimer = setTimeout(() => {
      void this.pollLogin(false);
    }, 2000);
  }

  private async pollLogin(manual: boolean): Promise<void> {
    if (this.loginState.status !== "pending") return;
    if (!this.loginState.deviceCode) return;
    try {
      const result = await pollDeviceLogin(this.baseUrl, this.loginState.deviceCode);
      if (result.accessToken) {
        this.loginState = { status: "ready", token: result.accessToken };
        await this.persistConfig({ token: result.accessToken, deviceCode: null });
        this.appendLine("login: approved");
        this.emitState();
        return;
      }
      if (manual) {
        this.appendLine("login: still pending");
      }
      this.emitState();
      this.scheduleLoginPoll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login check failed";
      if (manual) {
        this.appendLine(`login error: ${message}`);
      }
    }
  }

  private runOpentoolInit(name?: string): void {
    const localPath = process.env.OPENTOOL_PATH;
    const resolved = localPath
      ? { command: "node", args: [path.join(localPath, "dist", "cli", "index.js")] }
      : { command: "npx", args: ["opentool"] };
    const args = [...resolved.args, "init"];
    if (name) args.push("--name", name);
    const result = spawnSync(resolved.command, args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    if (result.status !== 0) {
      throw new Error("opentool init failed");
    }
  }

  private async handleCommand(text: string): Promise<void> {
    const [command, ...rest] = text.slice(1).trim().split(/\s+/);
    if (!command) return;

    if (command === "app") {
      const sub = rest[0];
      if (sub === "clear") {
        this.appId = null;
        this.conversationId = null;
        this.items = [];
        this.appendLine("app cleared");
        await this.persistConfig({ appId: null, conversationId: null });
        this.emitState();
        return;
      }
      if (sub === "set") {
        const nextId = rest[1];
        if (!nextId) {
          this.appendLine("usage: /app set <appId>");
          return;
        }
        this.appId = nextId;
        this.conversationId = null;
        this.items = [];
        this.appendLine(`app set: ${nextId}`);
        await this.persistConfig({ appId: nextId, conversationId: null });
        this.emitState();
        return;
      }
      if (sub === "create") {
        const name = rest.slice(1).join(" ").trim();
        if (!name) {
          this.appendLine("usage: /app create <name>");
          return;
        }
        const token = this.token();
        if (!token) {
          this.appendLine("login required to create app");
          return;
        }
        const result = await createLocalProject(this.baseUrl, token, name);
        this.appId = result.appId;
        this.conversationId = null;
        this.items = [];
        this.appendLine(`app created: ${result.appId}`);
        await this.persistConfig({ appId: result.appId, conversationId: null });
        this.emitState();
        return;
      }
    }

    if (command === "mode") {
      const next = rest[0];
      if (next !== "builder" && next !== "chat") {
        this.appendLine("usage: /mode builder | /mode chat");
        return;
      }
      const nextMode = next === "chat" ? "general" : "builder";
      if (this.chatMode === nextMode) {
        this.appendLine(`mode already ${next}`);
        return;
      }
      this.chatMode = nextMode;
      this.conversationId = null;
      this.items = [];
      await this.persistConfig({ mode: nextMode, conversationId: null });
      this.appendLine(`mode set: ${next}`);
      this.emitState();
      return;
    }

    if (command === "login") {
      const action = rest[0];
      if (action === "check") {
        await this.pollLogin(true);
        return;
      }
      await this.startLogin();
      return;
    }

    if (command === "init") {
      const name = rest.join(" ").trim();
      try {
        this.runOpentoolInit(name || undefined);
        this.appendLine("init complete");
      } catch (error) {
        const message = error instanceof Error ? error.message : "init failed";
        this.appendLine(`init error: ${message}`);
      }
      return;
    }

    if (command === "update") {
      if (this.chatMode !== "general") {
        this.appendLine("update is only available in chat mode. Use /mode chat.");
        return;
      }
      const appId = rest[0];
      if (!appId) {
        this.appendLine("usage: /update <appId> <request>");
        return;
      }
      const request = rest.slice(1).join(" ").trim();
      const outbound = request ? `/update ${appId} ${request}` : `/update ${appId}`;
      await this.sendMessage(outbound);
      return;
    }

    if (command === "link") {
      const token = this.token();
      if (!token) {
        this.appendLine("login required to link app");
        return;
      }
      const sub = rest[0];
      if (sub === "create") {
        const name = rest.slice(1).join(" ").trim();
        if (!name) {
          this.appendLine("usage: /link create <name>");
          return;
        }
        const result = await createLocalProject(this.baseUrl, token, name);
        this.appId = result.appId;
        this.conversationId = null;
        this.items = [];
        this.appendLine(`app linked: ${result.appId}`);
        await this.persistConfig({ appId: result.appId, conversationId: null });
        this.emitState();
        return;
      }
      const nextId = rest[0];
      if (!nextId) {
        this.appendLine("usage: /link <appId> or /link create <name>");
        return;
      }
      this.appId = nextId;
      this.conversationId = null;
      this.items = [];
      this.appendLine(`app linked: ${nextId}`);
      await this.persistConfig({ appId: nextId, conversationId: null });
      this.emitState();
      return;
    }

    if (command === "help") {
      this.appendLine("Commands:");
      this.appendLine("/app set <appId>");
      this.appendLine("/app clear");
      this.appendLine("/app create <name>");
      this.appendLine("/update <appId> <request>");
      this.appendLine("/mode builder | /mode chat");
      this.appendLine("/init [name]");
      this.appendLine("/link <appId>");
      this.appendLine("/link create <name>");
      this.appendLine("/login");
      this.appendLine("/login check");
      this.appendLine("/help");
      return;
    }

    this.appendLine(`Unknown command: ${command}`);
  }

  private async sendMessage(text: string): Promise<void> {
    const token = this.token();
    if (!token) {
      this.appendLine("login required");
      return;
    }
    const isBuilder = this.chatMode === "builder";
    const executionMode = isBuilder ? this.config.executionMode ?? "local" : undefined;
    const userItem: ResponseItem = {
      type: "message",
      role: "user",
      content: [{ type: "markdown", text }],
      createdAt: new Date().toISOString(),
    };
    this.items.push(userItem);
    this.appendLine(`user: ${text}`);
    await this.recordHistory("user", "message", text);

    const body: ChatRequestBody = {
      input: this.items,
      mode: this.chatMode,
      executionMode,
      conversationId: this.conversationId,
      appId: isBuilder ? this.appId : null,
    };

    const response = await chatRequest(this.baseUrl, token, body);
    if (!response.ok) {
      const respText = await response.text().catch(() => "");
      this.appendLine(`request error: ${response.status} ${respText}`);
      return;
    }

    this.clearStreaming();
    try {
      await consumeStream(response, {
        onConversationId: (id) => {
          if (!this.conversationId) {
            this.conversationId = id;
            void this.persistConfig({ conversationId: id });
            this.emitState();
          }
        },
        onTextDelta: (delta) => {
          const next = (this.streamingText ?? "") + delta;
          this.updateStreaming(next);
        },
        onItems: async (items) => {
          this.maybeCaptureAppId(items);
          for (const item of items) {
            this.items.push(item);
            if (item.type === "message" && (item as any).role === "assistant") {
              const formatted = this.formatItem(item);
              if (formatted) {
                this.updateStreaming(formatted.replace("assistant: ", ""));
                continue;
              }
            }
            const formatted = this.formatItem(item);
            if (formatted) this.appendLine(formatted);
            if (item.type === "tool_call") {
              await this.handleToolCall(item as ToolCallItem);
            }
            await this.recordHistoryFromItem(item);
          }
        },
      });
      if (this.streamingText.trim().length > 0) {
        this.appendLine(`assistant: ${this.streamingText}`);
        await this.recordHistory("assistant", "message", this.streamingText);
      }
      this.clearStreaming();
    } catch (error) {
      const message = error instanceof Error ? error.message : "stream failed";
      this.appendLine(`stream error: ${message}`);
      this.clearStreaming();
    }
  }

  private async sendToolResult(toolOutput: ToolOutputItem): Promise<void> {
    const token = this.token();
    if (!token) return;
    if (this.chatMode !== "builder") return;
    if (!this.conversationId) {
      this.appendLine("tool_result error: missing conversation id");
      return;
    }
    const nextItems = [...this.items, toolOutput];
    this.items = nextItems;
    const executionMode = this.config.executionMode ?? "local";
    if (executionMode !== "local") {
      return;
    }
    const body: ChatRequestBody = {
      action: "tool_result",
      input: nextItems,
      mode: this.chatMode,
      executionMode,
      conversationId: this.conversationId,
      appId: this.appId,
      toolResult: {
        toolName: toolOutput.name || "tool",
        callId: toolOutput.callId,
        output: toolOutput.output,
        ok: toolOutput.ok,
        error: toolOutput.error,
      },
    };

    const response = await chatRequest(this.baseUrl, token, body);
    if (!response.ok) {
      const respText = await response.text().catch(() => "");
      this.appendLine(`request error: ${response.status} ${respText}`);
      return;
    }

    try {
      await consumeStream(response, {
        onTextDelta: (delta) => {
          const next = (this.streamingText ?? "") + delta;
          this.updateStreaming(next);
        },
        onItems: async (items) => {
          this.maybeCaptureAppId(items);
          for (const item of items) {
            this.items.push(item);
            const formatted = this.formatItem(item);
            if (formatted) this.appendLine(formatted);
            if (item.type === "tool_call") {
              await this.handleToolCall(item as ToolCallItem);
            }
            await this.recordHistoryFromItem(item);
          }
        },
      });
      if (this.streamingText.trim().length > 0) {
        this.appendLine(`assistant: ${this.streamingText}`);
        await this.recordHistory("assistant", "message", this.streamingText);
      }
      this.clearStreaming();
    } catch (error) {
      const message = error instanceof Error ? error.message : "stream failed";
      this.appendLine(`stream error: ${message}`);
      this.clearStreaming();
    }
  }

  private async handleToolCall(toolCall: ToolCallItem): Promise<void> {
    const token = this.token();
    if (!token) return;
    if (this.chatMode !== "builder") return;
    const executionMode = this.config.executionMode ?? "local";
    if (executionMode !== "local") {
      return;
    }
    if (!this.appId) {
      this.appendLine("tool_call rejected: missing app id");
      return;
    }
    const output = await executeLocalTool(
      {
        name: toolCall.name,
        args: toolCall.args || {},
      },
      {
        rootDir: process.cwd(),
        readSet: this.readSet,
        baseUrl: this.baseUrl,
        token,
        appId: this.appId,
      }
    );

    const toolOutput: ToolOutputItem = {
      type: "tool_output",
      callId: toolCall.callId,
      name: toolCall.name,
      ok: output.ok,
      output: output.output,
      error: output.error,
      createdAt: new Date().toISOString(),
    };

    const outputText = this.formatCompact(output.output);
    const errorText = this.formatCompact(output.error);
    const parts = [`tool_output: ${toolCall.name} (${output.ok ? "ok" : "error"})`];
    if (errorText) parts.push(`error=${errorText}`);
    if (!errorText && outputText) parts.push(`output=${outputText}`);
    this.appendLine(parts.join(" "));
    await this.recordHistory("tool", "tool_output", String(output.output ?? ""));
    await this.sendToolResult(toolOutput);
  }

  private formatItem(item: ResponseItem): string | null {
    if (item.type === "message") {
      const role = (item as any).role ?? "assistant";
      const rawContent = (item as any).content;
      if (typeof rawContent === "string") {
        return `${role}: ${this.formatMarkdown(rawContent)}`;
      }
      const blocks = Array.isArray(rawContent)
        ? (rawContent as Array<{ text?: string; content?: string; value?: string }>)
        : [];
      const text = blocks
        .map((block) => {
          if (typeof block.text === "string") return block.text;
          if (typeof block.content === "string") return block.content;
          if (typeof block.value === "string") return block.value;
          return "";
        })
        .filter((val) => val.length > 0)
        .join("\n");
      if (text.length > 0) {
        return `${role}: ${this.formatMarkdown(text)}`;
      }
      if (typeof (item as any).text === "string") {
        return `${role}: ${this.formatMarkdown((item as any).text as string)}`;
      }
      return `${role}: [message]`;
    }
    if (item.type === "reasoning") {
      const segments = Array.isArray((item as any).segments)
        ? ((item as any).segments as string[])
        : [];
      return `reasoning: ${segments.join(" ")}`;
    }
    if (item.type === "tool_call") {
      const name = (item as any).name || "tool";
      const args = this.formatCompact((item as any).args);
      return args ? `tool_call: ${name} args=${args}` : `tool_call: ${name}`;
    }
    if (item.type === "tool_output") {
      const name = (item as any).name || "tool";
      const ok = (item as any).ok !== false;
      if (name === "create_tool" || name === "update_tool") {
        const payload =
          typeof (item as any).output === "object" && (item as any).output !== null
            ? ((item as any).output as Record<string, unknown>)
            : {};
        const appId = typeof payload.appId === "string" ? payload.appId : null;
        const appName = typeof payload.appName === "string" ? payload.appName : null;
        const conversationId =
          typeof payload.conversationId === "string" ? payload.conversationId : null;
        const builderLink =
          typeof payload.builderLink === "string"
            ? payload.builderLink
            : conversationId
              ? `/builder/${conversationId}`
              : null;
        const status = typeof payload.status === "string" ? payload.status : null;
        const requestRaw =
          typeof payload.request === "string" ? payload.request : null;
        const requestPreview = requestRaw
          ? this.formatCompact(requestRaw, 120)
          : null;
        const action =
          typeof payload.action === "string"
            ? payload.action
            : name === "create_tool"
              ? "create"
              : "update";
        const label = appName || appId || "Builder session";
        const parts = [`builder ${action}: ${label}`];
        if (status) parts.push(`status=${status}`);
        if (builderLink) parts.push(`link=${builderLink}`);
        if (requestPreview) {
          const safeRequest = requestPreview.replace(/"/g, "'");
          parts.push(`request="${safeRequest}"`);
        }
        return parts.join(" ");
      }
      const output = this.formatCompact((item as any).output);
      const error = this.formatCompact((item as any).error);
      const parts = [`tool_output: ${name} (${ok ? "ok" : "error"})`];
      if (error) parts.push(`error=${error}`);
      if (!error && output) parts.push(`output=${output}`);
      return parts.join(" ");
    }
    if (item.type === "app_creation_started") {
      const name =
        (item as any).appName ||
        (item as any).name ||
        (item as any).appId ||
        "app";
      const templateRepoUrl =
        typeof (item as any).templateRepoUrl === "string"
          ? (item as any).templateRepoUrl
          : null;
      const suffix = templateRepoUrl ? ` template=${templateRepoUrl}` : "";
      return `app_creation_started: ${name}${suffix}`;
    }
    if (item.type === "app_created") {
      const appId =
        typeof (item as any).appId === "string" ? (item as any).appId : "unknown";
      const name =
        typeof (item as any).appName === "string" ? (item as any).appName : null;
      return name ? `app_created: ${name} (${appId})` : `app_created: ${appId}`;
    }
    if (item.type.startsWith("tool_creation_")) {
      const message = (item as any).message || (item as any).content || "";
      return `${item.type}: ${message}`;
    }
    return null;
  }

  private formatCompact(value: unknown, limit = 240): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
    }
    try {
      const raw = JSON.stringify(value);
      if (!raw) return null;
      const compact = raw.replace(/\s+/g, " ");
      return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
    } catch {
      const raw = String(value);
      if (!raw) return null;
      return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
    }
  }

  private formatMarkdown(input: string): string {
    const lines = input.split("\n");
    let inCode = false;
    const out: string[] = [];
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        out.push(inCode ? "[code]" : "[/code]");
        continue;
      }
      if (inCode) {
        out.push(`  ${line}`);
        continue;
      }
      let next = line;
      if (/^#{1,6}\s+/.test(next)) {
        next = next.replace(/^#{1,6}\s+/, "");
      }
      if (/^\s*[-*]\s+/.test(next)) {
        next = next.replace(/^\s*[-*]\s+/, "• ");
      }
      next = next.replace(/\*\*(.+?)\*\*/g, "$1");
      next = next.replace(/\*(.+?)\*/g, "$1");
      next = next.replace(/__(.+?)__/g, "$1");
      next = next.replace(/`(.+?)`/g, "$1");
      out.push(next);
    }
    return out.join("\n");
  }

  private maybeCaptureAppId(items: ResponseItem[]): void {
    if (this.appId) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const direct = (item as any).appId;
      if (typeof direct === "string" && direct.length > 0) {
        this.appId = direct;
        void this.persistConfig({ appId: direct });
        this.appendLine(`app linked: ${direct}`);
        return;
      }
      const output = (item as any).output;
      if (output && typeof output === "object") {
        const outAppId = (output as any).appId;
        if (typeof outAppId === "string" && outAppId.length > 0) {
          this.appId = outAppId;
          void this.persistConfig({ appId: outAppId });
          this.appendLine(`app linked: ${outAppId}`);
          return;
        }
      }
    }
  }

  private async recordHistory(
    role: "user" | "assistant" | "tool",
    type: string,
    text: string
  ): Promise<void> {
    if (!this.gitHash) {
      this.gitHash = await getGitHash(process.cwd());
    }
    const record: HistoryEntry = {
      id: this.historyId,
      conversationId: this.conversationId,
      appId: this.appId,
      gitHash: this.gitHash ?? undefined,
      startedAt: this.historyStartedAt,
      updatedAt: new Date().toISOString(),
      messages: [
        {
          role,
          type,
          text,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const existing = await loadHistory(process.cwd(), this.historyId);
    if (existing) {
      record.messages = [...existing.messages, ...record.messages];
      record.startedAt = existing.startedAt;
      record.gitHash = existing.gitHash ?? record.gitHash;
    }
    await saveHistory(process.cwd(), record);
  }

  private async recordHistoryFromItem(item: ResponseItem): Promise<void> {
    if (item.type === "message") {
      const role = ((item as any).role ?? "assistant") as "user" | "assistant";
      const rawContent = (item as any).content;
      const text =
        typeof rawContent === "string"
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((block: any) => block.text || block.content || block.value || "")
                .filter((val: string) => val.length > 0)
                .join("\n")
            : "";
      if (text) {
        await this.recordHistory(role, "message", text);
      }
      return;
    }
    if (item.type === "tool_call") {
      const name = (item as any).name || "tool";
      await this.recordHistory("tool", "tool_call", name);
      return;
    }
    if (item.type === "tool_output") {
      await this.recordHistory("tool", "tool_output", "ok");
    }
  }

}
