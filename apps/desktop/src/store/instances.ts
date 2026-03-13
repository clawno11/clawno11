import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  instanceSlice, partializeInstances,
  PERSIST_NAME, PERSIST_VERSION,
  type ClawInstance, type InstanceHealth, type BaseInstanceSlice,
} from "@clawno/shared/stores/instanceStore";

export type { ClawInstance, InstanceHealth };
export type { InstanceKind } from "@clawno/shared/stores/instanceStore";

export const useInstanceStore = create<BaseInstanceSlice>()(
  persist(
    instanceSlice,
    {
      name: PERSIST_NAME,
      partialize: (state) => ({
        instances: partializeInstances(state.instances),
      }),
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
      version: PERSIST_VERSION,
    },
  ),
);
