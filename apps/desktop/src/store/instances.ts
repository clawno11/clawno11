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
}

interface InstanceStore {
  instances: ClawInstance[];
  addOrUpdate: (inst: ClawInstance) => void;
  remove: (id: string) => void;
  setHealth: (id: string, health: InstanceHealth, latencyMs?: number) => void;
}

export const useInstanceStore = create<InstanceStore>()(
  persist(
    (set) => ({
      instances: [],

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
    }),
    {
      name: "clawno-instances",
      // Exclude runtime-only fields so stale health/latency never survive a restart.
      partialize: (state) => ({
        instances: state.instances.map(({ health: _h, latencyMs: _l, ...rest }) => ({
          ...rest,
          health: "unknown" as InstanceHealth,
        })),
      }),
      // 迁移旧数据：将 localhost:18791 之类的 URL 统一修正为 127.0.0.1:<port>
      migrate: (persisted: unknown) => {
        const state = persisted as { instances?: ClawInstance[] };
        if (!state?.instances) return state;
        state.instances = state.instances.map((inst) => ({
          ...inst,
          gatewayUrl: `ws://127.0.0.1:${inst.port}`,
          uiUrl: `http://127.0.0.1:${inst.port}`,
          httpUrl: `http://127.0.0.1:${inst.port}`,
        }));
        return state;
      },
      version: 2,
    },
  ),
);
