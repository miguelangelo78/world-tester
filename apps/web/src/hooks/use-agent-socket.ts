"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WSMessage,
  BrowserStatePayload,
  CostUpdatePayload,
  StepUpdatePayload,
  LogPayload,
  ErrorPayload,
  StreamChunkPayload,
  ConversationInfo,
  ConversationListPayload,
  ConversationSwitchedPayload,
  ConversationCurrentPayload,
  ConversationMessageDTO,
} from "@world-tester/shared";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface AgentSocket {
  status: ConnectionStatus;
  browserState: BrowserStatePayload | null;
  cost: CostUpdatePayload | null;
  conversations: ConversationInfo[];
  activeConversationId: string | null;
  activeConversation: ConversationInfo | null;
  sendCommand: (raw: string) => string;
  onMessage: (handler: MessageHandler) => () => void;
  switchConversation: (id: string) => void;
  createConversation: (title?: string) => void;
  renameConversation: (id: string, title: string) => void;
  archiveConversation: (id: string) => void;
  refreshConversations: () => void;
  requestConversationReplay: () => void;
}

export type MessageHandler = (msg: WSMessage) => void;

const AGENT_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_AGENT_WS_URL ?? `ws://${window.location.hostname}:3100`
    : "ws://localhost:3100";

export function useAgentSocket(): AgentSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [browserState, setBrowserState] = useState<BrowserStatePayload | null>(null);
  const [cost, setCost] = useState<CostUpdatePayload | null>(null);
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationInfo | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idCounter = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(AGENT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "browser_state") {
        setBrowserState(msg.payload as BrowserStatePayload);
      } else if (msg.type === "cost_update") {
        setCost(msg.payload as CostUpdatePayload);
      } else if (msg.type === "conversation_list") {
        const p = msg.payload as ConversationListPayload;
        setConversations(p.conversations);
        setActiveConversationId(p.activeId);
        const active = p.conversations.find((c) => c.id === p.activeId);
        if (active) setActiveConversation(active);
      } else if (msg.type === "conversation_switched") {
        const p = msg.payload as ConversationSwitchedPayload;
        setActiveConversationId(p.conversation.id);
        setActiveConversation(p.conversation);
      } else if (msg.type === "conversation_current") {
        const p = msg.payload as ConversationCurrentPayload;
        setActiveConversationId(p.conversation.id);
        setActiveConversation(p.conversation);
      }

      for (const handler of handlersRef.current) {
        handler(msg);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((raw: string) => {
    const id = `cmd-${++idCounter.current}-${Date.now()}`;
    const msg: WSMessage = { type: "command", id, payload: { raw } };
    wsRef.current?.send(JSON.stringify(msg));
    return id;
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const switchConversation = useCallback((id: string) => {
    sendCommand(`conversation:switch ${id}`);
  }, [sendCommand]);

  const createConversation = useCallback((title?: string) => {
    sendCommand(title ? `conversation:new ${title}` : "conversation:new");
  }, [sendCommand]);

  const renameConversation = useCallback((id: string, title: string) => {
    sendCommand(`conv:rename ${title}`);
  }, [sendCommand]);

  const archiveConversation = useCallback((_id: string) => {
    sendCommand("conv:archive");
  }, [sendCommand]);

  const refreshConversations = useCallback(() => {
    sendCommand("conversation:list");
  }, [sendCommand]);

  const requestConversationReplay = useCallback(() => {
    const msg: WSMessage = { type: "command", id: "__replay__", payload: { raw: "conversation:current" } };
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return {
    status, browserState, cost,
    conversations, activeConversationId, activeConversation,
    sendCommand, onMessage,
    switchConversation, createConversation, renameConversation, archiveConversation,
    refreshConversations, requestConversationReplay,
  };
}

// Re-export types for convenience
export type {
  WSMessage,
  BrowserStatePayload,
  CostUpdatePayload,
  StepUpdatePayload,
  LogPayload,
  ErrorPayload,
  StreamChunkPayload,
  ConversationInfo,
  ConversationMessageDTO,
};
