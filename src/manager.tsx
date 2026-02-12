import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { useEffect, useMemo, useRef, useState } from "react";

import { attachJsonLineReader, createIpcServer, getSocketPath, writeJsonLine } from "./ipc";

type TabMode = "chat" | "history";

type TabState = {
  id: string;
  mode: TabMode;
  title: string;
  lines: string[];
  streaming: string;
  historyRows: string[];
  statusLine?: string;
  footer: {
    modeLabel: string;
    loginStatus: string;
    lspLabel: string;
    conversationId: string | null;
    footerHint: string;
  };
};

type ChildInfo = {
  proc: ChildProcess;
};

function createTab(id: string, mode: TabMode): TabState {
  return {
    id,
    mode,
    title: mode,
    lines: [],
    streaming: "",
    historyRows: [],
    statusLine: "",
    footer: {
      modeLabel: mode === "chat" ? "chat" : mode,
      loginStatus: "idle",
      lspLabel: "lsp:off",
      conversationId: null,
      footerHint: "enter send · /help",
    },
  };
}

export function Manager() {
  const renderer = useRenderer();
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const inputRef = useRef("");
  const socketPathRef = useRef<string>(getSocketPath());
  const serverRef = useRef<Awaited<ReturnType<typeof createIpcServer>> | null>(null);
  const childrenRef = useRef<Map<string, ChildInfo>>(new Map());
  const childSocketsRef = useRef<Map<string, import("node:net").Socket>>(new Map());
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const appendLine = (tabId: string, text: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        if (tab.mode === "history") {
          return { ...tab, statusLine: text };
        }
        return { ...tab, lines: [...tab.lines, text] };
      })
    );
  };

  const copyToClipboard = (text: string) => {
    setCopyNotice("copied");
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopyNotice(null);
    }, 1200);
    try {
      const payload = Buffer.from(text, "utf-8").toString("base64");
      process.stdout.write(`\u001b]52;c;${payload}\u0007`);
    } catch {
      // ignore clipboard errors
    }
    try {
      if (process.env.WAYLAND_DISPLAY) {
        spawnSync("wl-copy", [], { input: text });
        return;
      }
      spawnSync("xclip", ["-selection", "clipboard"], { input: text });
    } catch {
      // ignore clipboard errors
    }
  };

  const updateStreaming = (tabId: string, text: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, streaming: text } : tab
      )
    );
  };

  const updateHistoryRows = (tabId: string, rows: string[]) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, historyRows: rows } : tab
      )
    );
  };

  const updateFooter = (tabId: string, state: TabState["footer"]) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, footer: state } : tab
      )
    );
  };

  const spawnTab = (mode: TabMode) => {
    const id = `${mode}-${Date.now()}`;
    const child = spawn("bun", ["run", "src/child.ts", "--mode", mode, "--tab", id], {
      cwd: process.cwd(),
      env: { ...process.env, OPENPOND_IPC_SOCKET: socketPathRef.current },
      stdio: "ignore",
    });
    childrenRef.current.set(id, { proc: child });
    const tab = createTab(id, mode);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(id);
  };

  useEffect(() => {
    let active = true;
    const start = async () => {
      const server = await createIpcServer(socketPathRef.current, (socket) => {
        attachJsonLineReader(socket, (message) => {
          if (!message || typeof message !== "object") return;
          if (message.type === "register" && typeof message.tabId === "string") {
            childSocketsRef.current.set(message.tabId, socket);
            if (!activeTabId) {
              setActiveTabId(message.tabId);
            }
            return;
          }
          if (message.type === "line" && typeof message.tabId === "string") {
            appendLine(message.tabId, String(message.text ?? ""));
          }
          if (message.type === "stream" && typeof message.tabId === "string") {
            updateStreaming(message.tabId, String(message.text ?? ""));
          }
          if (message.type === "history" && typeof message.tabId === "string") {
            updateHistoryRows(
              message.tabId,
              Array.isArray(message.rows) ? (message.rows as string[]) : []
            );
          }
          if (message.type === "state" && typeof message.tabId === "string") {
            updateFooter(message.tabId, message.state as TabState["footer"]);
          }
        });
      });
      serverRef.current = server;
      if (active) {
        spawnTab("history");
        spawnTab("chat");
      }
    };
    start();
    return () => {
      active = false;
    };
  }, []);

  useKeyboard((key) => {
    if (key.name === "q" && key.ctrl) {
      try {
        renderer.destroy();
      } catch {
        // ignore
      }
      process.exit(0);
    }
    if ((key.ctrl || key.meta || key.option) && ["1", "2", "3", "4", "5"].includes(key.name)) {
      const index = Number(key.name) - 1;
      const tab = tabs[index];
      if (tab) setActiveTabId(tab.id);
      setInputValue(inputRef.current);
    }
    if ((key.meta || key.option) && key.name === "h") {
      const historyTab = tabs.find((tab) => tab.mode === "history");
      if (historyTab) setActiveTabId(historyTab.id);
    }
  });

  const handleManagerCommand = (text: string): boolean => {
    if (!text.startsWith("/")) return false;
    const [command, ...rest] = text.slice(1).trim().split(/\s+/);
    if (command === "new") {
      spawnTab("chat");
      return true;
    }
    if (command === "history") {
      const existing = tabs.find((tab) => tab.mode === "history");
      if (existing) {
        setActiveTabId(existing.id);
      } else {
        spawnTab("history");
      }
      return true;
    }
    if (command === "tabs") {
      if (!activeTab) return true;
      appendLine(activeTab.id, "tabs:");
      tabs.forEach((tab, index) => {
        const child = childrenRef.current.get(tab.id);
        const pid = child?.proc.pid ?? "—";
        appendLine(
          activeTab.id,
          `${index + 1}. ${tab.title} (${tab.mode}) pid:${pid} id:${tab.id}`
        );
      });
      return true;
    }
    if (command === "tab") {
      const value = rest[0];
      if (!value) return true;
      const index = Number(value);
      if (!Number.isNaN(index)) {
        const tab = tabs[index - 1];
        if (tab) setActiveTabId(tab.id);
        return true;
      }
      const match = tabs.find((tab) => tab.id === value || tab.title === value);
      if (match) setActiveTabId(match.id);
      return true;
    }
    return false;
  };

  const tabBar = useMemo(() => {
    return tabs.map((tab, index) => {
      const label = `${index + 1}:${tab.title}`;
      const active = tab.id === activeTabId;
      return { label, active };
    });
  }, [tabs, activeTabId]);

  const footer = activeTab?.footer ?? {
    modeLabel: "general",
    loginStatus: "idle",
    lspLabel: "lsp:off",
    conversationId: null,
    footerHint: "enter send · /help",
  };

  useEffect(() => {
    if (!activeTab || activeTab.mode !== "history") return;
    const socket = childSocketsRef.current.get(activeTab.id);
    if (socket) {
      writeJsonLine(socket, { type: "input", text: "refresh" });
    }
  }, [activeTabId]);

  return (
    <box
      style={{
        flexDirection: "column",
        height: "100%",
        width: "100%",
        padding: 2,
        gap: 1,
        backgroundColor: "#0B1220",
      }}
    >
      <box
        style={{
          flexDirection: "row",
          gap: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: "#0F172A",
        }}
      >
        {tabBar.map((tab) => (
          <box
            key={tab.label}
            style={{
              paddingLeft: 2,
              paddingRight: 2,
              height: 3,
              alignItems: "center",
              backgroundColor: tab.active ? "#1E293B" : "#0F172A",
              border: true,
              borderColor: tab.active ? "#38BDF8" : "#1E293B",
            }}
          >
            <text style={{ fg: tab.active ? "#E2E8F0" : "#94A3B8" }}>
              {tab.label}
            </text>
          </box>
        ))}
      </box>

      <scrollbox
        style={{
          height: "100%",
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
          backgroundColor: "#0B1220",
          stickyScroll: true,
          stickyStart: "bottom",
        }}
      >
        <box style={{ flexDirection: "column", rowGap: 1, padding: 1 }}>
          {activeTab?.mode === "history" ? (
            <box style={{ flexDirection: "column", rowGap: 0, padding: 0, width: "100%" }}>
              <text style={{ fg: "#F8FAFC" }}>
                {activeTab.statusLine?.length
                  ? `History · ${activeTab.statusLine}`
                  : "History · type: show <id> | refresh"}
              </text>
              <box style={{ flexDirection: "column", rowGap: 0, width: "100%" }}>
                {activeTab.historyRows.map((line, idx) => (
                  <box
                    key={`${line}-${idx}`}
                    onMouseDown={() => copyToClipboard(line)}
                  >
                    <text style={{ fg: "#E2E8F0" }}>{line}</text>
                  </box>
                ))}
              </box>
            </box>
          ) : (
            <>
              {activeTab?.lines.map((line, idx) => (
                <box
                  key={`${activeTab.id}-${idx}`}
                  style={{
                    backgroundColor: "#111827",
                    paddingLeft: 2,
                    paddingRight: 2,
                    paddingTop: 1,
                    paddingBottom: 1,
                  }}
                  onMouseDown={() => copyToClipboard(line)}
                >
                  <text style={{ fg: "#E2E8F0" }}>{line}</text>
                </box>
              ))}
              {activeTab && activeTab.streaming && (
                <box
                  style={{
                    backgroundColor: "#1E293B",
                    paddingLeft: 2,
                    paddingRight: 2,
                    paddingTop: 1,
                    paddingBottom: 1,
                  }}
                >
                  <text style={{ fg: "#E2E8F0" }}>
                    {`assistant: ${activeTab.streaming}`}
                  </text>
                </box>
              )}
            </>
          )}
        </box>
      </scrollbox>

      <box
        style={{
          border: true,
          borderColor: "#334155",
          focusedBorderColor: "#38BDF8",
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 0,
          paddingBottom: 0,
          height: 3,
          backgroundColor: "#0F172A",
          flexDirection: "row",
          gap: 1,
          alignItems: "center",
        }}
      >
        <text style={{ fg: "#38BDF8", height: 1 }}>{">"}</text>
        <input
          placeholder="Type a message or /new chat · /history"
          focused
          onInput={(val) => {
            inputRef.current = val;
            setInputValue(val);
          }}
          onSubmit={(value) => {
            setInputValue("");
            inputRef.current = "";
            if (!activeTab) return;
            if (handleManagerCommand(value.trim())) return;
            const socket = childSocketsRef.current.get(activeTab.id);
            if (socket) {
              writeJsonLine(socket, { type: "input", text: value });
            }
          }}
          value={inputValue}
          height={1}
          textColor="#E2E8F0"
          backgroundColor="#0F172A"
          focusedBackgroundColor="#0F172A"
          focusedTextColor="#E2E8F0"
          cursorColor="#38BDF8"
          placeholderColor="#64748B"
          style={{ flexGrow: 1, width: "100%" }}
        />
      </box>

      <box
        style={{
          border: true,
          borderColor: "#334155",
          paddingLeft: 3,
          paddingRight: 3,
          paddingTop: 1,
          paddingBottom: 1,
          height: 3,
          backgroundColor: "#0B1220",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <text style={{ fg: "#94A3B8" }}>
          {`OpenPond Code · ${footer.modeLabel} · ${footer.loginStatus} · ${footer.lspLabel}`}
        </text>
        <text style={{ fg: "#38BDF8" }}>
          {footer.conversationId ? `convo:${footer.conversationId}` : "convo:—"}
        </text>
        <text style={{ fg: "#64748B" }}>
          {footer.footerHint}
          {copyNotice ? ` · ${copyNotice}` : ""}
        </text>
      </box>
    </box>
  );
}

export async function startManager(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  root.render(<Manager />);
}
