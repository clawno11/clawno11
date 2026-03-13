import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateMode = "auto" | "prompt";

interface UpdaterState {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  newVersion: string | null;
  error: string | null;
  /** Pending update handle from the check() call */
  _update: Update | null;

  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  status: "idle",
  newVersion: null,
  error: null,
  _update: null,

  checkForUpdate: async () => {
    if (get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", newVersion: update.version, _update: update });
      } else {
        set({ status: "idle", newVersion: null });
      }
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  downloadAndInstall: async () => {
    const update = get()._update;
    if (!update) return;
    set({ status: "downloading" });
    try {
      await update.downloadAndInstall();
      set({ status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  restart: async () => {
    await relaunch();
  },
}));

// Read update mode preference from localStorage
export function getUpdateMode(): UpdateMode {
  return (localStorage.getItem("clawno-update-mode") as UpdateMode) || "prompt";
}

export function setUpdateMode(mode: UpdateMode): void {
  localStorage.setItem("clawno-update-mode", mode);
}

/** Call once on app startup to check + optionally auto-install */
export async function initAutoUpdater(): Promise<void> {
  const store = useUpdaterStore.getState();
  await store.checkForUpdate();

  const mode = getUpdateMode();
  const { status } = useUpdaterStore.getState();

  if (status === "available" && mode === "auto") {
    await useUpdaterStore.getState().downloadAndInstall();
  }
}
