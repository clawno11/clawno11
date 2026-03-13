import type { StateCreator } from "zustand";

export type InstanceKind = "local" | "remote";
export type InstanceHealth = "unknown" | "online" | "offline";

export interface ClawInstance {
  id: string;
  name: string;
  kind: InstanceKind;
  gatewayUrl: string;
  uiUrl: string;
  httpUrl: string;
  port: number;
  deployedAt: number;
  health: InstanceHealth;
  latencyMs?: number;
  chatProxyToken?: string;
}

export interface BaseInstanceSlice {
  instances: ClawInstance[];
  addOrUpdate: (inst: ClawInstance) => void;
  remove: (id: string) => void;
  setHealth: (id: string, health: InstanceHealth, latencyMs?: number) => void;
}

/**
 * Base state creator for instance store.
 * Both desktop and mobile wrap this with their own `persist` config.
 */
export const instanceSlice: StateCreator<BaseInstanceSlice> = (set) => ({
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
});

export const PERSIST_NAME = "clawno-instances";
export const PERSIST_VERSION = 2;

/** Strip runtime-only health/latency from persisted state. */
export function partializeInstances(instances: ClawInstance[]) {
  return instances.map(({ health: _h, latencyMs: _l, ...rest }) => ({
    ...rest,
    health: "unknown" as InstanceHealth,
  }));
}
