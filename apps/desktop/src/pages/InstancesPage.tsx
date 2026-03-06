import { useEffect, useState } from "react";
import { Server, Wifi, WifiOff, RefreshCw } from "lucide-react";
import type { ServiceInfo } from "@clawno/deploy-engine";

interface Instance {
  id: string;
  name: string;
  gatewayUrl: string;
  service?: ServiceInfo;
}

export function InstancesPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    // TODO: load from persistent store
    setTimeout(() => setLoading(false), 500);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">OpenClaw 实例</h1>
          <p className="text-muted-foreground text-sm mt-1">管理已部署的 OpenClaw 服务</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent transition-colors text-sm"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <Server size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium">尚未部署任何实例</p>
          <p className="text-sm mt-1">前往「部署」页面一键部署 OpenClaw</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {instances.map((inst) => (
            <div key={inst.id} className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Server size={20} className="text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{inst.name}</p>
                    <p className="text-sm text-muted-foreground">{inst.gatewayUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {inst.service?.status === "running" ? (
                    <span className="flex items-center gap-1.5 text-green-600 text-sm">
                      <Wifi size={14} /> 运行中
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      <WifiOff size={14} /> 已停止
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
