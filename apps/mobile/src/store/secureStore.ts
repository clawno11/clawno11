/**
 * Encrypted secure storage bridge.
 * Wraps the Rust tauri-plugin-store backed commands so the frontend
 * never has to touch plain localStorage for sensitive values.
 *
 * All API keys, provider tokens, and sensitive config should go through
 * this module instead of Zustand's persist middleware.
 */

import { invoke } from "@tauri-apps/api/core";

export const secureStore = {
  async set(key: string, value: string): Promise<void> {
    await invoke("set_secure_value", { key, value });
  },

  async get(key: string): Promise<string | null> {
    return await invoke<string | null>("get_secure_value", { key });
  },

  async delete(key: string): Promise<void> {
    await invoke("delete_secure_value", { key });
  },

  async keys(): Promise<string[]> {
    return await invoke<string[]>("list_secure_keys");
  },

  /** Wipe everything — used by the Panic Button. */
  async wipeAll(): Promise<void> {
    await invoke("wipe_secure_store");
  },
};

// ── Typed helpers for known keys ──────────────────────────────────────────

/** Prefix for AI provider API keys */
const AI_APIKEY_PREFIX = "apikey:";

/** Prefix for AI provider "configured" flags */
const AI_KEY_PREFIX = "ai_key_configured:";

/** Store and retrieve actual API key values in the encrypted store. */
export const secureApiKeys = {
  async set(providerId: string, apiKey: string): Promise<void> {
    await secureStore.set(`${AI_APIKEY_PREFIX}${providerId}`, apiKey);
  },

  async get(providerId: string): Promise<string | null> {
    return secureStore.get(`${AI_APIKEY_PREFIX}${providerId}`);
  },

  async delete(providerId: string): Promise<void> {
    await secureStore.delete(`${AI_APIKEY_PREFIX}${providerId}`);
  },

  /** Return all provider IDs that have a stored API key. */
  async listConfigured(): Promise<string[]> {
    const keys = await secureStore.keys();
    return keys
      .filter((k) => k.startsWith(AI_APIKEY_PREFIX))
      .map((k) => k.slice(AI_APIKEY_PREFIX.length));
  },
};

export const secureAiConfig = {
  async markConfigured(providerId: string): Promise<void> {
    await secureStore.set(`${AI_KEY_PREFIX}${providerId}`, "1");
  },

  async unmark(providerId: string): Promise<void> {
    await secureStore.delete(`${AI_KEY_PREFIX}${providerId}`);
  },

  async isConfigured(providerId: string): Promise<boolean> {
    const val = await secureStore.get(`${AI_KEY_PREFIX}${providerId}`);
    return val === "1";
  },

  async getConfiguredIds(): Promise<string[]> {
    const keys = await secureStore.keys();
    return keys
      .filter((k) => k.startsWith(AI_KEY_PREFIX))
      .map((k) => k.slice(AI_KEY_PREFIX.length));
  },
};
