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

  async wipeAll(): Promise<void> {
    await invoke("wipe_secure_store");
  },
};

const AI_KEY_PREFIX = "ai_key_configured:";

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
