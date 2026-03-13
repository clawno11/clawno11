import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  instanceSlice, partializeInstances,
  PERSIST_NAME, PERSIST_VERSION,
  type ClawInstance, type InstanceHealth, type BaseInstanceSlice,
} from "@clawno/shared/stores/instanceStore";

export type { ClawInstance, InstanceHealth };
export type { InstanceKind } from "@clawno/shared/stores/instanceStore";

interface MobileInstanceStore extends BaseInstanceSlice {
  lastChatProxyToken: string | null;
  updateTokenByHost: (host: string, token: string) => boolean;
  setGlobalChatProxyToken: (token: string) => void;
}

export const useInstanceStore = create<MobileInstanceStore>()(
  persist(
    (set, get, api) => ({
      ...instanceSlice(set, get, api),
      lastChatProxyToken: null,

      setGlobalChatProxyToken: (token) => set({ lastChatProxyToken: token }),

      updateTokenByHost: (host, token) => {
        let matched = false;
        set((s) => {
          const updated = s.instances.map((i) => {
            if (i.httpUrl.includes(host)) {
              matched = true;
              return { ...i, chatProxyToken: token };
            }
            return i;
          });
          return matched ? { instances: updated } : s;
        });
        return matched;
      },
    }),
    {
      name: PERSIST_NAME,
      partialize: (state) => ({
        instances: partializeInstances(state.instances),
        lastChatProxyToken: state.lastChatProxyToken,
      }),
      migrate: (persisted: unknown) => persisted,
      version: PERSIST_VERSION,
    },
  ),
);
