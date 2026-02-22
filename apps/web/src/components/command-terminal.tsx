"use client";

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { Send, Loader2, Square } from "lucide-react";
import { useAgent } from "./agent-provider";
import { MarkdownRenderer } from "./markdown-renderer";
import type {
  WSMessage, LogPayload, StreamChunkPayload, StepUpdatePayload,
  ConversationSwitchedPayload, ConversationCurrentPayload, ConversationMessageDTO,
} from "@world-tester/shared";

interface LogEntry {
  id: string;
  type: "input" | "info" | "success" | "warn" | "error" | "stream" | "result" | "step" | "agent";
  text: string;
  timestamp: number;
}

export function CommandTerminal() {
  const { status, sendCommand, abortCommand, onMessage, requestConversationReplay } = useAgent();
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const activeCommandId = useRef<string | null>(null);
  const streamBuf = useRef("");

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const addLog = useCallback((type: LogEntry["type"], text: string) => {
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, type, text, timestamp: Date.now() },
    ]);
  }, []);

  const replayMessages = useCallback((messages: ConversationMessageDTO[]) => {
    const typeMap: Record<string, LogEntry["type"]> = {
      input: "input",
      info: "info",
      success: "success",
      warn: "warn",
      error: "error",
      stream: "stream",
      result: "result",
      step: "step",
      agent: "agent",
    };
    const entries: LogEntry[] = messages.map((m) => ({
      id: m.id,
      type: typeMap[m.type] ?? "info",
      text: m.type === "input" ? `> ${m.content}` : m.content,
      timestamp: new Date(m.timestamp).getTime(),
    }));
    setLogs(entries);
  }, []);

  const shownWelcome = useRef(false);
  const requestedReplay = useRef(false);
  useEffect(() => {
    if (status === "connected" && !shownWelcome.current) {
      shownWelcome.current = true;
      addLog("info", [
        "  World Tester  —  AI-powered QA Tester",
        "",
        "  Quick start:",
        "    t: <task>        Run a complex task (e.g. t: go to account settings)",
        "    test: <ticket>   Run a QA test and get a pass/fail report",
        "    c: <message>     Chat with the agent",
        "    l:               Learn the current website",
        "    help             Show all available commands",
        "",
        "  Tip: just type naturally — the agent will figure out the best approach.",
        "",
      ].join("\n"));
    }
  }, [status, addLog]);

  useEffect(() => {
    if (status === "connected" && !requestedReplay.current) {
      requestedReplay.current = true;
      requestConversationReplay();
    }
  }, [status, requestConversationReplay]);

  // Listen for messages from the agent
  useEffect(() => {
    return onMessage((msg: WSMessage) => {
      // Conversation switch: full replacement (user explicitly changed conversation)
      if (msg.type === "conversation_switched") {
        const p = msg.payload as ConversationSwitchedPayload;
        replayMessages(p.messages);
        setBusy(false);
        activeCommandId.current = null;
        streamBuf.current = "";
        return;
      }
      // Conversation current: replace logs with DB state, but skip if a command is running
      if (msg.type === "conversation_current") {
        if (activeCommandId.current) return;
        const p = msg.payload as ConversationCurrentPayload;
        if (p.messages.length > 0) {
          replayMessages(p.messages);
        }
        return;
      }

      // Filter out messages from other commands (e.g. replay requests)
      if (msg.id && msg.id === "__replay__") return;
      if (msg.id && msg.id !== activeCommandId.current) return;

      switch (msg.type) {
        case "log": {
          const p = msg.payload as LogPayload;
          addLog(p.level as LogEntry["type"], p.message);
          break;
        }
        case "stream_chunk": {
          const p = msg.payload as StreamChunkPayload;
          streamBuf.current += p.text;
          setLogs((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "stream") {
              return [
                ...prev.slice(0, -1),
                { ...last, text: streamBuf.current },
              ];
            }
            return [
              ...prev,
              {
                id: `stream-${Date.now()}`,
                type: "stream" as const,
                text: streamBuf.current,
                timestamp: Date.now(),
              },
            ];
          });
          break;
        }
        case "stream_end": {
          streamBuf.current = "";
          break;
        }
        case "step_update": {
          const p = msg.payload as StepUpdatePayload;
          const statusIcon =
            p.status === "pass" ? "PASS" :
            p.status === "fail" ? "FAIL" :
            p.status === "skip" ? "SKIP" : "...";
          addLog("step", `  [${p.index}/${p.total}] ${statusIcon} ${p.action}`);
          break;
        }
        case "command_result": {
          setBusy(false);
          activeCommandId.current = null;
          break;
        }
        case "error": {
          const p = msg.payload as { message: string };
          addLog("error", p.message);
          setBusy(false);
          activeCommandId.current = null;
          break;
        }
      }
    });
  }, [onMessage, addLog, replayMessages]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    if (status !== "connected") {
      addLog("error", "Not connected to agent. Start the agent server first: npm run agent:server");
      return;
    }

    addLog("input", `> ${trimmed}`);
    setCmdHistory((prev) => [trimmed, ...prev]);
    setHistoryIdx(-1);
    setInput("");
    setBusy(true);
    streamBuf.current = "";

    const id = sendCommand(trimmed);
    activeCommandId.current = id;
  }, [input, busy, status, addLog, sendCommand]);

  const handleAbort = useCallback(() => {
    if (activeCommandId.current) {
      abortCommand(activeCommandId.current);
      addLog("warn", "Aborting...");
    }
  }, [abortCommand, addLog]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
        setHistoryIdx(next);
        setInput(cmdHistory[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setInput(cmdHistory[next]);
      } else {
        setHistoryIdx(-1);
        setInput("");
      }
    }
  };

  const typeColor: Record<LogEntry["type"], string> = {
    input: "text-primary",
    info: "text-muted-foreground",
    success: "text-success",
    warn: "text-warning",
    error: "text-destructive",
    stream: "text-foreground",
    result: "text-foreground",
    step: "text-muted-foreground",
    agent: "text-foreground",
  };

  const renderColoredText = useCallback((text: string, baseType: LogEntry["type"]) => {
    const segments: { text: string; className: string }[] = [];

    // Full-line rules: if the entire text matches, color the whole thing
    if (/\[thinking\]/.test(text)) {
      return <span className="text-violet-400/80 italic">{text}</span>;
    }
    if (/\[step\s/.test(text)) {
      return <span className="text-cyan-400/80">{text}</span>;
    }

    const rules: { pattern: RegExp; className: string }[] = [
      { pattern: /\bPASS\b/g, className: "text-success font-semibold" },
      { pattern: /\bFAIL\b/g, className: "text-destructive font-semibold" },
      { pattern: /\bSKIP\b/g, className: "text-warning font-semibold" },
      { pattern: /\[info\]/g, className: "text-blue-400" },
      { pattern: /\[ok\]/g, className: "text-success" },
      { pattern: /\[warn\]/g, className: "text-warning" },
      { pattern: /\[error\]/g, className: "text-destructive" },
      { pattern: /\[assert\]/g, className: "text-violet-400 font-medium" },
      { pattern: /\[setup\]/g, className: "text-sky-400" },
      { pattern: /\[critical\]/g, className: "text-orange-400 font-medium" },
      { pattern: /\[optional\]/g, className: "text-muted-foreground" },
      { pattern: /\bchat -> \w+\b/g, className: "text-violet-400 italic" },
      { pattern: /\$\d+\.\d+/g, className: "text-emerald-400" },
      { pattern: /Expected:/g, className: "text-sky-400 font-medium" },
      { pattern: /Actual:/g, className: "text-orange-400 font-medium" },
      { pattern: /Evidence:/g, className: "text-amber-400 font-medium" },
      { pattern: /VERDICT:\s*\w+/g, className: "font-bold" },
      { pattern: /https?:\/\/\S+/g, className: "text-blue-400 underline" },
      { pattern: /Completed in \S+/g, className: "text-muted-foreground italic" },
    ];

    const allMatches: { start: number; end: number; className: string }[] = [];
    for (const rule of rules) {
      let m: RegExpExecArray | null;
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      while ((m = re.exec(text)) !== null) {
        allMatches.push({ start: m.index, end: m.index + m[0].length, className: rule.className });
      }
    }

    allMatches.sort((a, b) => a.start - b.start);

    const filtered: typeof allMatches = [];
    let lastEnd = 0;
    for (const m of allMatches) {
      if (m.start >= lastEnd) {
        filtered.push(m);
        lastEnd = m.end;
      }
    }

    if (filtered.length === 0) return <span>{text}</span>;

    let cursor = 0;
    for (const m of filtered) {
      if (cursor < m.start) {
        segments.push({ text: text.slice(cursor, m.start), className: "" });
      }
      let cls = m.className;
      const matched = text.slice(m.start, m.end);
      if (matched.startsWith("VERDICT:")) {
        if (matched.includes("PASS")) cls = "text-success font-bold";
        else if (matched.includes("FAIL")) cls = "text-destructive font-bold";
        else if (matched.includes("PARTIAL")) cls = "text-warning font-bold";
        else cls = "text-foreground font-bold";
      }
      segments.push({ text: text.slice(m.start, m.end), className: cls });
      cursor = m.end;
    }
    if (cursor < text.length) {
      segments.push({ text: text.slice(cursor), className: "" });
    }

    return (
      <>
        {segments.map((seg, i) =>
          seg.className ? (
            <span key={i} className={seg.className}>{seg.text}</span>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </>
    );
  }, []);

  const hasMarkdown = useCallback((text: string): boolean => {
    if (text.length < 10) return false;
    return /(\*\*\S|\#{1,4}\s|`{1,3}[^`]|\n[-*]\s|\n\d+\.\s|\[.+\]\(.+\)|\|.+\|.+\|)/.test(text);
  }, []);

  const markdownTypes = new Set<LogEntry["type"]>(["stream", "result", "agent"]);

  const statusDot =
    status === "connected"
      ? "bg-success"
      : status === "connecting"
      ? "bg-warning animate-pulse"
      : "bg-destructive";

  return (
    <div className="flex h-full flex-col bg-background font-mono text-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1">
        <div className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
        <span className="text-[10px] text-muted-foreground">
          {status === "connected" ? "Agent connected" : status === "connecting" ? "Connecting..." : "Disconnected"}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {logs.map((entry) => {
          if (entry.type === "input") {
            return (
              <div key={entry.id} className={`${typeColor[entry.type]} whitespace-pre-wrap`}>
                <span className="font-bold">{entry.text}</span>
              </div>
            );
          }
          if (markdownTypes.has(entry.type) && hasMarkdown(entry.text)) {
            return (
              <MarkdownRenderer
                key={entry.id}
                content={entry.text}
                className={typeColor[entry.type]}
              />
            );
          }
          return (
            <div key={entry.id} className={`${typeColor[entry.type]} whitespace-pre-wrap`}>
              {renderColoredText(entry.text, entry.type)}
            </div>
          );
        })}
        {busy && (
          <button
            onClick={handleAbort}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors cursor-pointer group"
          >
            <Loader2 className="h-3 w-3 animate-spin group-hover:hidden" />
            <Square className="h-3 w-3 hidden group-hover:block" />
            <span className="group-hover:hidden">Thinking...</span>
            <span className="hidden group-hover:inline">Stop</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 sm:py-2 py-3">
        <span className="text-primary">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            status === "connected"
              ? "Enter command (e.g. t: test login)"
              : "Waiting for agent..."
          }
          className="flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
          disabled={busy}
        />
        <button
          onClick={handleSubmit}
          disabled={busy || !input.trim()}
          className="rounded p-1.5 sm:p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <Send className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </button>
      </div>
    </div>
  );
}
