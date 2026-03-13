/**
 * useChatEngine — shared chat state management hook.
 *
 * Manages messages, streaming, and session persistence.
 * Messages are passed through to the backend (and on to OpenClaw)
 * without any client-side processing — no RAG injection, no PII
 * filtering, no injection detection.  OpenClaw manages its own
 * context, memory, and security on the server side.
 */

import { useReducer, useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UIMessage } from "./types";
import {
  createSession, addMessage, loadMessages,
  type StoredMessage,
} from "../chatHistory";
import { humaniseError } from "./helpers";

// ── Reducer ───────────────────────────────────────────────────────────────

export interface ChatState {
  messages: UIMessage[];
  isStreaming: boolean;
}

export type ChatAction =
  | { type: "LOAD"; messages: UIMessage[] }
  | { type: "CLEAR" }
  | { type: "ADD_PAIR"; userMsg: UIMessage; assistantMsg: UIMessage }
  | { type: "CHUNK"; id: string; text: string }
  | { type: "DONE"; id: string }
  | { type: "ERROR"; id: string; content: string }
  | { type: "STOP_STREAMING" };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD":
      return { messages: action.messages, isStreaming: false };
    case "CLEAR":
      return { messages: [], isStreaming: false };
    case "ADD_PAIR":
      return {
        messages: [...state.messages, action.userMsg, action.assistantMsg],
        isStreaming: true,
      };
    case "CHUNK":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: action.text } : m,
        ),
      };
    case "DONE":
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, streaming: false } : m,
        ),
      };
    case "ERROR":
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, content: action.content, streaming: false }
            : m,
        ),
      };
    case "STOP_STREAMING":
      return { ...state, isStreaming: false };
  }
}

// ── Send options ──────────────────────────────────────────────────────────

export interface AudioPayload {
  base64: string;
  format: string; // "webm" | "mp4" | "ogg" | "wav"
}

export interface SendOptions {
  rawContent: string;
  gatewayUrl: string;
  model: string | null;
  instanceId: string | null;
  authToken?: string | null;
  audioData?: AudioPayload | null;
  t: (key: string) => string;
}

// ── Hook ──────────────────────────────────────────────────────────────────

const INITIAL_STATE: ChatState = { messages: [], isStreaming: false };

export function useChatEngine() {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem("clawno-last-session"),
  );

  const mountedRef = useRef(true);
  const isSendingRef = useRef(false);
  const cancelRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sessionRef = useRef(currentSessionId);
  useEffect(() => { sessionRef.current = currentSessionId; }, [currentSessionId]);

  // ── Lifecycle ──────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const lastId = localStorage.getItem("clawno-last-session");
    if (lastId) {
      loadMessages(lastId)
        .then((stored: StoredMessage[]) => {
          if (!mountedRef.current) return;
          const msgs: UIMessage[] = stored.map((m) => ({
            id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
          }));
          dispatch({ type: "LOAD", messages: msgs });
          setCurrentSessionId(lastId);
        })
        .catch(() => persistSession(null));
    }
    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session helpers ────────────────────────────────────────────────────

  const persistSession = useCallback((id: string | null) => {
    if (id) localStorage.setItem("clawno-last-session", id);
    else localStorage.removeItem("clawno-last-session");
    setCurrentSessionId(id);
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (mountedRef.current) dispatch({ type: "STOP_STREAMING" });

    try {
      const stored: StoredMessage[] = await loadMessages(sessionId);
      if (!mountedRef.current) return;
      const msgs: UIMessage[] = stored.map((m) => ({
        id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
      }));
      dispatch({ type: "LOAD", messages: msgs });
      persistSession(sessionId);
    } catch (e) {
      console.error("Failed to load session messages:", e);
    }
  }, [persistSession]);

  const clear = useCallback(() => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    dispatch({ type: "CLEAR" });
    persistSession(null);
  }, [persistSession]);

  const stop = useCallback(() => {
    cancelRef.current = true;
    abortControllerRef.current?.abort();
    if (mountedRef.current) dispatch({ type: "STOP_STREAMING" });
  }, []);

  // ── Send ───────────────────────────────────────────────────────────────

  const send = useCallback(async (opts: SendOptions): Promise<boolean> => {
    if ((!opts.rawContent.trim() && !opts.audioData) || isSendingRef.current) return false;
    isSendingRef.current = true;
    cancelRef.current = false;
    const ac = new AbortController();
    abortControllerRef.current = ac;
    let invokeStarted = false;

    try {
      const {
        rawContent, gatewayUrl, model: effectiveModel,
        instanceId: effectiveInstanceId,
        authToken, audioData, t,
      } = opts;

      // Session
      let sessionId = sessionRef.current;
      try {
        if (!sessionId) {
          const title = rawContent.slice(0, 40) + (rawContent.length > 40 ? "…" : "");
          sessionId = await createSession(title, effectiveInstanceId ?? "");
          if (mountedRef.current) persistSession(sessionId);
        }
      } catch { /* proceed without persistence */ }

      if (!mountedRef.current) return false;

      // Build messages
      const now = Date.now();
      const displayContent = audioData
        ? (rawContent || `🎤 ${t("voice.message")}`)
        : rawContent;
      const userMsg: UIMessage = {
        id: crypto.randomUUID(), role: "user", content: displayContent, createdAt: now,
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: UIMessage = {
        id: assistantId, role: "assistant", content: "", streaming: true, createdAt: now,
      };

      dispatch({ type: "ADD_PAIR", userMsg, assistantMsg });

      if (sessionId) addMessage(sessionId, "user", displayContent).catch(console.error);

      // Build content for backend — pass through without processing
      const userContent: string | Record<string, unknown>[] = audioData
        ? [
            ...(rawContent ? [{ type: "text", text: rawContent }] : []),
            { type: "input_audio", input_audio: { data: audioData.base64, format: audioData.format } },
          ]
        : rawContent;

      const contextMsgs = [{ role: "user", content: userContent as string }];

      let accumulatedText = "";
      const reqId = assistantId;

      // Event listeners
      const unlistenChunk = await listen<{ req_id: string; delta: string }>(
        "chat-chunk",
        (event) => {
          if (event.payload.req_id !== reqId || cancelRef.current) return;
          accumulatedText += event.payload.delta;
          if (!mountedRef.current) return;
          dispatch({ type: "CHUNK", id: assistantId, text: accumulatedText });
        },
      );

      const unlistenDone = await listen<{
        req_id: string;
        error: string | null;
        model?: string | null;
        bug_signature?: string | null;
      }>(
        "chat-done",
        async (event) => {
          if (event.payload.req_id !== reqId) return;
          unlistenChunk();
          unlistenDone();

          // Persist assistant reply
          if (!cancelRef.current && sessionId && accumulatedText) {
            try { await addMessage(sessionId, "assistant", accumulatedText); }
            catch (e) { console.error("Failed to save assistant message:", e); }
          }

          if (!cancelRef.current && sessionId && !accumulatedText && event.payload.error) {
            const errText = event.payload.error;
            const looksLikeContent = errText.length > 100
              || errText.includes("payloads")
              || errText.includes("text");
            if (looksLikeContent) {
              try { await addMessage(sessionId, "assistant", `${t("chat.error")}${errText}`); }
              catch { /* non-fatal */ }
            }
          }

          if (!mountedRef.current) { isSendingRef.current = false; return; }

          if (event.payload.error && !cancelRef.current) {
            const friendly = humaniseError(event.payload.error);
            dispatch({ type: "ERROR", id: assistantId, content: `${t("chat.error")}${friendly}` });
          } else {
            dispatch({ type: "DONE", id: assistantId });
          }
          isSendingRef.current = false;
        },
      );

      // Abort handler
      ac.signal.addEventListener("abort", () => {
        unlistenChunk();
        unlistenDone();
        if (sessionId && accumulatedText) {
          addMessage(sessionId, "assistant", accumulatedText).catch(console.error);
        }
        if (mountedRef.current) {
          dispatch({ type: "DONE", id: assistantId });
        }
        isSendingRef.current = false;
      }, { once: true });

      // Fire the Tauri command
      invokeStarted = true;
      invoke("stream_chat", {
        gatewayUrl,
        messages: contextMsgs,
        reqId,
        model: effectiveModel,
        ...(authToken != null ? { authToken } : {}),
        sessionKey: sessionId ?? undefined,
      }).catch((e: unknown) => {
        if (cancelRef.current || !mountedRef.current) return;
        unlistenChunk();
        unlistenDone();
        dispatch({ type: "ERROR", id: assistantId, content: t("chat.error") + String(e) });
        isSendingRef.current = false;
      });

      return true;
    } catch {
      if (mountedRef.current) dispatch({ type: "STOP_STREAMING" });
      return false;
    } finally {
      if (!invokeStarted) isSendingRef.current = false;
    }
  }, [persistSession]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    currentSessionId,
    send,
    stop,
    clear,
    loadSession,
    persistSession,
  };
}
