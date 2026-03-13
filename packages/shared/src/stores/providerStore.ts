import { create } from "zustand";
import { secureAiConfig } from "./secureStore";

interface AiConfigStore {
  configured: string[];
  load: () => Promise<void>;
  markConfigured: (providerId: string) => Promise<void>;
  unmark: (providerId: string) => Promise<void>;
  isConfigured: (providerId: string) => boolean;
}

export type { AiConfigStore };

/**
 * Factory: create an AI config store with optional external provider discovery.
 *
 * Desktop passes `listConfiguredProviders` (openclaw CLI);
 * mobile passes nothing (no CLI on device).
 */
export function createAiConfigStore(
  loadExternal?: () => Promise<string[]>,
) {
  return create<AiConfigStore>()((set, get) => ({
    configured: [],

    load: async () => {
      let storedIds: string[] = [];
      try {
        storedIds = await secureAiConfig.getConfiguredIds();
      } catch {
        set({ configured: [] });
        return;
      }

      let externalIds: string[] = [];
      if (loadExternal) {
        try {
          externalIds = await loadExternal();
        } catch {
          // external source unavailable — proceed with stored only
        }
      }

      const merged = Array.from(new Set([...storedIds, ...externalIds]));
      for (const id of externalIds) {
        if (!storedIds.includes(id)) {
          await secureAiConfig.markConfigured(id).catch(() => {});
        }
      }
      set({ configured: merged });
    },

    markConfigured: async (id: string) => {
      await secureAiConfig.markConfigured(id);
      set((s) => ({
        configured: s.configured.includes(id)
          ? s.configured
          : [...s.configured, id],
      }));
    },

    unmark: async (id: string) => {
      await secureAiConfig.unmark(id);
      set((s) => ({ configured: s.configured.filter((x) => x !== id) }));
    },

    isConfigured: (id: string) => get().configured.includes(id),
  }));
}
