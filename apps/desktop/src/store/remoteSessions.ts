import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listen } from "@tauri-apps/api/event";

const MAX_PERSISTED_EXCHANGES = 500;

interface RemoteChatEvent {
  session_key: string;
  user_text: string;
  model: string;
  assistant_text: string;
  timestamp: number;
  error: string | null;
}

export interface RemoteExchange {
  id: string;
  session_key: string;
  user_text: string;
  model: string;
  assistant_text: string;
  error: string | null;
  timestamp: number;
  done: boolean;
}

interface RemoteSessionsState {
  exchanges: RemoteExchange[];
  addExchange: (e: RemoteChatEvent) => void;
  completeExchange: (e: RemoteChatEvent) => void;
  clear: () => void;
}

export const useRemoteSessionsStore = create<RemoteSessionsState>()(
  persist(
    (set) => ({
      exchanges: [],

      addExchange: (e) =>
        set((state) => {
          const id = `${e.session_key}-${e.timestamp}`;
          if (state.exchanges.some((ex) => ex.id === id)) return state;
          const updated = [
            {
              id,
              session_key: e.session_key,
              user_text: e.user_text,
              model: e.model,
              assistant_text: "",
              error: null,
              timestamp: e.timestamp,
              done: false,
            },
            ...state.exchanges,
          ];
          if (updated.length > MAX_PERSISTED_EXCHANGES) {
            updated.length = MAX_PERSISTED_EXCHANGES;
          }
          return { exchanges: updated };
        }),

      completeExchange: (e) =>
        set((state) => {
          const id = `${e.session_key}-${e.timestamp}`;
          return {
            exchanges: state.exchanges.map((ex) =>
              ex.id === id
                ? { ...ex, assistant_text: e.assistant_text, error: e.error, done: true }
                : ex,
            ),
          };
        }),

      clear: () => set({ exchanges: [] }),
    }),
    {
      name: "clawno-remote-sessions",
      version: 2,
      partialize: (state) => ({ exchanges: state.exchanges }),
      migrate: (_persisted: unknown, version: number) => {
        const state = _persisted as { exchanges?: RemoteExchange[]; liveCount?: number };
        if (version < 2 && state?.exchanges) {
          state.exchanges = state.exchanges.map((ex: RemoteExchange) =>
            ex.done ? ex : { ...ex, done: true, error: "app-restart: response lost" },
          );
          delete state.liveCount;
        }
        return state;
      },
    },
  ),
);

// Global Tauri event listeners — active for the entire app lifetime
let listenersInitialized = false;

export function initRemoteSessionListeners(): void {
  if (listenersInitialized) return;
  listenersInitialized = true;

  const store = useRemoteSessionsStore.getState;

  // Mark any zombie exchanges (done: false) from a previous session as lost
  const { exchanges } = store();
  if (exchanges.some((ex) => !ex.done)) {
    useRemoteSessionsStore.setState({
      exchanges: exchanges.map((ex) =>
        ex.done ? ex : { ...ex, done: true, error: "app-restart: response lost" },
      ),
    });
  }

  listen<RemoteChatEvent>("remote-chat-request", (ev) => {
    store().addExchange(ev.payload);
  }).catch((e) => console.warn("[remote-sessions] listen request failed:", e));

  listen<RemoteChatEvent>("remote-chat-done", (ev) => {
    store().completeExchange(ev.payload);
  }).catch((e) => console.warn("[remote-sessions] listen done failed:", e));
}
