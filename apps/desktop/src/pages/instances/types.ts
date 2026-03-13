import { probeInstanceHealth } from "../../ipc";
import type { ClawInstance, InstanceHealth } from "../../store/instances";

export type CardAction = "idle" | "starting" | "restarting" | "stopping";

export { FEATURED_AI, AI_PROVIDERS, PROVIDER_PRICING, FEATURED_IDS } from "@clawno/shared/components/ai/types";
export type { ProviderPricing } from "@clawno/shared/components/ai/types";

export function translateDetail(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith("gateway-ready:")) return "服务已启动，正在运行";
  if (raw.startsWith("pm2-start-failed:")) return `pm2 启动失败：${raw.slice(17)}`;
  if (raw.startsWith("gateway-timeout:")) return `启动超时：${raw.slice(16)}`;
  if (raw.startsWith("gateway-crash:")) return `服务崩溃：${raw.slice(14)}`;
  if (raw.startsWith("openclaw-mjs-not-found:")) return "找不到 openclaw 安装文件，请重新部署";
  if (raw.startsWith("npm-root-not-found:")) return "找不到 npm，请重启应用后重试";
  if (raw.startsWith("wrapper-write-failed:")) return "无法写入启动脚本（磁盘权限问题）";
  return raw;
}

export async function probeHealth(inst: ClawInstance): Promise<{ health: InstanceHealth; latencyMs: number }> {
  try {
    const result = await probeInstanceHealth(inst.port);
    return { health: result.online ? "online" : "offline", latencyMs: result.latency_ms };
  } catch {
    return { health: "offline", latencyMs: 0 };
  }
}
