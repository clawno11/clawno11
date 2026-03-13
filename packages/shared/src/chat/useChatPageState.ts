import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChatEngine } from "./useChatEngine";
import { pickDefault } from "./helpers";
import type { ClawInstance } from "../stores/instanceStore";
import type { ChatSession } from "../chatHistory";

export interface ChatPageConfig {
  defaultGatewayUrl: string;
}

const DEFAULT_CONFIG: ChatPageConfig = {
  defaultGatewayUrl: "http://127.0.0.1:18789",
};

export function useChatPageState(
  instances: ClawInstance[],
  config: ChatPageConfig = DEFAULT_CONFIG,
) {
  const engine = useChatEngine();
  const { messages, isStreaming, currentSessionId } = engine;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const [routingEnabled, setRoutingEnabled] = useState(() => localStorage.getItem("clawno-routing") !== "false");
  const [routedTo, setRoutedTo] = useState<string | null>(null);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [activeModelInfo, setActiveModelInfo] = useState<{ provider: string; model: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollBehaviorRef = useRef<ScrollBehavior>("instant");
  const routedToTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
  }, []);

  const defaultInstance = useMemo(() => pickDefault(instances), [instances]);

  useEffect(() => {
    if (selectedId && instances.find((i) => i.id === selectedId)) return;
    setSelectedId(defaultInstance?.id ?? null);
  }, [instances, defaultInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollBehaviorRef.current = "instant"; }, [currentSessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: scrollBehaviorRef.current });
    scrollBehaviorRef.current = "smooth";
  }, [messages]);

  const selectedInst = instances.find((i) => i.id === selectedId) ?? null;
  const gatewayUrl = selectedInst?.httpUrl ?? config.defaultGatewayUrl;
  const isOnline = selectedInst?.health === "online";

  const setRoutedWithTimer = useCallback((label: string) => {
    setRoutedTo(label);
    if (routedToTimerRef.current) clearTimeout(routedToTimerRef.current);
    routedToTimerRef.current = setTimeout(() => {
      routedToTimerRef.current = null;
      setRoutedTo(null);
    }, 4000);
  }, []);

  const handleNewChat = useCallback(() => {
    if (routedToTimerRef.current) {
      clearTimeout(routedToTimerRef.current);
      routedToTimerRef.current = null;
    }
    engine.clear();
    setInput("");
    setRoutedTo(null);
    setShowHistory(false);
  }, [engine]);

  const handleSelectSession = useCallback(async (session: ChatSession) => {
    await engine.loadSession(session.id);
    setShowHistory(false);
  }, [engine]);

  const toggleRouting = useCallback(() => {
    setRoutingEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("clawno-routing", String(next));
      return next;
    });
  }, []);

  return {
    engine,
    messages, isStreaming, currentSessionId,
    selectedId, setSelectedId,
    showPicker, setShowPicker,
    input, setInput,
    showHistory, setShowHistory,
    routingEnabled, toggleRouting,
    routedTo,
    selectedModel, setSelectedModel,
    showModelPicker, setShowModelPicker,
    activeModelInfo, setActiveModelInfo,
    selectedInst, gatewayUrl, isOnline,
    bottomRef,
    handleNewChat, handleSelectSession, setRoutedWithTimer,
  };
}

export type ChatPageState = ReturnType<typeof useChatPageState>;
