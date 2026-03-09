/**
 * Tiny cross-component store that tracks whether a token anomaly is active.
 * TokenPage writes to it after each summary fetch; Sidebar reads it to render
 * the red-dot badge on the Token nav item.
 */
import { create } from "zustand";

interface TokenAnomalyState {
  anomaly: boolean;
  setAnomaly: (v: boolean) => void;
}

export const useTokenAnomalyStore = create<TokenAnomalyState>()((set) => ({
  anomaly: false,
  setAnomaly: (anomaly) => set({ anomaly }),
}));
