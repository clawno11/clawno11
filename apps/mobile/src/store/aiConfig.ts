/**
 * AI provider configuration store — mobile version.
 *
 * Source of truth is the encrypted Tauri store (secureStore.ts).
 * Unlike desktop, we do NOT call listConfiguredProviders() since
 * the openclaw CLI is not available on mobile.
 */

import { create } from "zustand";
import { secureAiConfig } from "./secureStore";

interface AiConfigStore {
  configured: string[];
  load: () => Promise<void>;
  markConfigured: (providerId: string) => Promise<void>;
  unmark: (providerId: string) => Promise<void>;
  isConfigured: (providerId: string) => boolean;
}

export const useAiConfigStore = create<AiConfigStore>()((set, get) => ({
  configured: [],

  load: async () => {
    try {
      const storedIds = await secureAiConfig.getConfiguredIds();
      set({ configured: storedIds });
    } catch {
      // Secure store may not be initialized yet — start empty
      set({ configured: [] });
    }
  },

  markConfigured: async (id: string) => {
    await secureAiConfig.markConfigured(id);
    set((s) => ({
      configured: s.configured.includes(id) ? s.configured : [...s.configured, id],
    }));
  },

  unmark: async (id: string) => {
    await secureAiConfig.unmark(id);
    set((s) => ({ configured: s.configured.filter((x) => x !== id) }));
  },

  isConfigured: (id: string) => get().configured.includes(id),
}));
