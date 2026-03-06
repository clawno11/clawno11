import { create } from "zustand";

export type GatewayStatus = "unknown" | "checking" | "online" | "offline" | "error";

export interface GatewayConnection {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  status: GatewayStatus;
  latencyMs?: number;
  version?: string;
  lastChecked?: number;
  /** true = via Cloudflare Tunnel, false = direct */
  isTunnel: boolean;
}

interface GatewayStore {
  connections: GatewayConnection[];
  activeId: string | null;

  addConnection: (conn: Omit<GatewayConnection, "id" | "status">) => string;
  removeConnection: (id: string) => void;
  updateConnection: (id: string, patch: Partial<GatewayConnection>) => void;
  setActive: (id: string) => void;
  getActive: () => GatewayConnection | undefined;
  checkHealth: (id: string) => Promise<void>;
  checkAll: () => Promise<void>;
}

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  connections: [
    {
      id: "local-default",
      name: "本机 (localhost)",
      url: "http://localhost:18789",
      status: "unknown",
      isTunnel: false,
    },
  ],
  activeId: "local-default",

  addConnection: (conn) => {
    const id = crypto.randomUUID();
    set((s) => ({
      connections: [
        ...s.connections,
        { ...conn, id, status: "unknown" as GatewayStatus },
      ],
    }));
    return id;
  },

  removeConnection: (id) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      activeId: s.activeId === id ? (s.connections[0]?.id ?? null) : s.activeId,
    }));
  },

  updateConnection: (id, patch) => {
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  },

  setActive: (id) => set({ activeId: id }),

  getActive: () => {
    const { connections, activeId } = get();
    return connections.find((c) => c.id === activeId);
  },

  checkHealth: async (id) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;

    get().updateConnection(id, { status: "checking" });
    const t0 = Date.now();

    try {
      const res = await fetch(`${conn.url}/health`, {
        signal: AbortSignal.timeout(5000),
        headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
      });

      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        get().updateConnection(id, {
          status: "online",
          latencyMs: Date.now() - t0,
          version: data.version,
          lastChecked: Date.now(),
        });
      } else {
        get().updateConnection(id, { status: "error", lastChecked: Date.now() });
      }
    } catch {
      get().updateConnection(id, { status: "offline", lastChecked: Date.now() });
    }
  },

  checkAll: async () => {
    const { connections, checkHealth } = get();
    await Promise.all(connections.map((c) => checkHealth(c.id)));
  },
}));
