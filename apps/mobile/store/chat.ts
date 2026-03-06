import { create } from "zustand";
import type { ChatMessage } from "@clawno/openclaw-client";

export interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
  agentId?: string;
}

interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;
  gatewayUrl: string;
  apiKey: string;

  // Actions
  setGatewayUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  createSession: () => string;
  deleteSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: UIMessage) => void;
  updateMessage: (sessionId: string, msgId: string, patch: Partial<UIMessage>) => void;
  getActiveSession: () => Session | undefined;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  gatewayUrl: "http://localhost:18789",
  apiKey: "",

  setGatewayUrl: (url) => set({ gatewayUrl: url }),
  setApiKey: (key) => set({ apiKey: key }),

  createSession: () => {
    const id = crypto.randomUUID();
    const session: Session = {
      id,
      title: "新对话",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: id }));
    return id;
  },

  deleteSession: (id) => {
    set((s) => {
      const sessions = s.sessions.filter((s) => s.id !== id);
      const activeSessionId =
        s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId;
      return { sessions, activeSessionId };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, msg) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: [...sess.messages, msg],
              updatedAt: Date.now(),
              title:
                sess.messages.length === 0 && msg.role === "user"
                  ? msg.content.slice(0, 20)
                  : sess.title,
            }
          : sess,
      ),
    }));
  },

  updateMessage: (sessionId, msgId, patch) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: sess.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
            }
          : sess,
      ),
    }));
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId);
  },
}));
