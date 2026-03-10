/**
 * AI provider configuration store.
 *
 * Runtime state is held in Zustand (for reactive UI updates).
 * The source of truth for "which providers are configured" is the
 * encrypted Tauri store (via secureStore.ts), NOT localStorage.
 *
 * Call `loadAiConfig()` once at app startup to hydrate from the
 * encrypted backend into the in-memory Zustand store.
 */

import { create } from "zustand";
import { secureAiConfig } from "./secureStore";
import { listConfiguredProviders } from "../ipc";

interface AiConfigStore {
  /** Provider IDs that have a configured key (in-memory cache only). */
  configured: string[];
  /** Hydrate from encrypted backend — call once on app mount. */
  load: () => Promise<void>;
  markConfigured: (providerId: string) => Promise<void>;
  unmark: (providerId: string) => Promise<void>;
  isConfigured: (providerId: string) => boolean;
}

export const useAiConfigStore = create<AiConfigStore>()((set, get) => ({
  configured: [],

  load: async () => {
    // 1. Load what our secureStore already knows
    const storedIds = await secureAiConfig.getConfiguredIds();

    // 2. Also ask OpenClaw directly which providers have keys configured
    //    (covers cases where the key was written via DeployPage or directly)
    let openclawIds: string[] = [];
    try {
      openclawIds = await listConfiguredProviders();
    } catch {
      // openclaw not installed yet — ignore
    }

    // 3. Merge: mark any newly-discovered IDs into secureStore so they persist
    const merged = Array.from(new Set([...storedIds, ...openclawIds]));
    for (const id of openclawIds) {
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
