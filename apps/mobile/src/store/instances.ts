import { create } from "zustand";
import { persist } from "zustand/middleware";

export type InstanceKind = "local" | "remote";
export type InstanceHealth = "unknown" | "online" | "offline";

export interface ClawInstance {
  id: string;
  name: string;
  kind: InstanceKind;
  /** WebSocket gateway URL  e.g. ws://127.0.0.1:18789 */
  gatewayUrl: string;
  /** HTTP browser UI URL   e.g. http://127.0.0.1:18789 */
  uiUrl: string;
  /** Gateway HTTP base for REST health checks e.g. http://127.0.0.1:18789 */
  httpUrl: string;
  port: number;
  deployedAt: number;
  health: InstanceHealth;
  latencyMs?: number;
  /** Bearer token for authenticating to the desktop chat proxy (port 18800). */
  chatProxyToken?: string;
}

interface InstanceStore {
  instances: ClawInstance[];
  /** Most recent chat proxy token obtained from QR pairing.
   *  Used as fallback when the selected instance has no per-instance token
   *  (e.g. when the instance was added manually with a different IP). */
  lastChatProxyToken: string | null;
  addOrUpdate: (inst: ClawInstance) => void;
  remove: (id: string) => void;
  setHealth: (id: string, health: InstanceHealth, latencyMs?: number) => void;
  /** Update chatProxyToken for all instances whose httpUrl contains the given host.
   *  Returns true if at least one instance was updated. */
  updateTokenByHost: (host: string, token: string) => boolean;
  /** Save a global chat proxy token (from QR pairing). */
  setGlobalChatProxyToken: (token: string) => void;
}

export const useInstanceStore = create<InstanceStore>()(
  persist(
    (set) => ({
      instances: [],
      lastChatProxyToken: null,

      setGlobalChatProxyToken: (token) => set({ lastChatProxyToken: token }),

      addOrUpdate: (inst) =>
        set((s) => {
          const idx = s.instances.findIndex((i) => i.id === inst.id);
          if (idx >= 0) {
            const next = [...s.instances];
            next[idx] = inst;
            return { instances: next };
          }
          return { instances: [inst, ...s.instances] };
        }),

      remove: (id) =>
        set((s) => ({ instances: s.instances.filter((i) => i.id !== id) })),

      setHealth: (id, health, latencyMs) =>
        set((s) => ({
          instances: s.instances.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, health };
            if (latencyMs !== undefined) updated.latencyMs = latencyMs;
            return updated;
          }),
        })),

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
      name: "clawno-instances",
      // Exclude runtime-only fields so stale health/latency never survive a restart.
      partialize: (state) => ({
        instances: state.instances.map(({ health: _h, latencyMs: _l, ...rest }) => ({
          ...rest,
          health: "unknown" as InstanceHealth,
        })),
        lastChatProxyToken: state.lastChatProxyToken,
      }),
      // Mobile 端所有实例都是远程连接，gatewayUrl 由用户在 ConnectPage 填写，
      // 不可重写为 127.0.0.1。此迁移仅保留原始数据不做任何修改。
      migrate: (persisted: unknown) => persisted,
      version: 2,
    },
  ),
);
