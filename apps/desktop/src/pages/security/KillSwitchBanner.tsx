import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { RefreshCw, Power, PowerOff, Zap } from "lucide-react";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";

interface KillSwitchBannerProps {
  port: number;
  firewallActive: boolean;
  onFirewallChange: (active: boolean) => void;
  onEvent: () => void;
}

export function KillSwitchBanner({ port, firewallActive, onFirewallChange, onEvent }: KillSwitchBannerProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleKill = async () => {
    if (!window.confirm(t("security.killSwitchBtn") + "?\n\n" + t("security.killSwitchDesc"))) return;
    setLoading(true);
    setMsg(null);
    try {
      const result = await invoke<string>("kill_switch_offline", { port });
      onFirewallChange(true);
      setMsg(result);
      await logSecurityEvent("kill_switch", `紧急断网已激活 · 端口 ${port}`, "danger");
      onEvent();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const result = await invoke<string>("kill_switch_restore", { port });
      onFirewallChange(false);
      setMsg(result);
      await logSecurityEvent("kill_restore", `紧急断网已解除 · 端口 ${port}`, "info");
      onEvent();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`rounded-xl border-2 p-4 transition-all ${
      firewallActive
        ? "border-amber-500/60 bg-amber-500/10"
        : "border-red-500/30 bg-red-500/5"
    }`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${firewallActive ? "bg-amber-500/20" : "bg-red-500/10"}`}>
          {firewallActive
            ? <PowerOff size={20} className="text-amber-500" />
            : <Zap size={20} className="text-red-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${firewallActive ? "text-amber-700" : "text-red-600"}`}>
            {firewallActive ? "🔴 " + t("security.killSwitchDone") : t("security.killSwitch")}
          </p>
          {!firewallActive && (
            <p className="text-xs text-muted-foreground mt-0.5">{t("security.killSwitchDesc")}</p>
          )}
          {msg && (
            <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate">{msg}</p>
          )}
        </div>
        <button
          onClick={firewallActive ? handleRestore : handleKill}
          disabled={loading}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
            firewallActive
              ? "bg-amber-500 text-white hover:bg-amber-600"
              : "bg-red-600 text-white hover:bg-red-700"
          }`}
        >
          {loading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : firewallActive ? (
            <Power size={14} />
          ) : (
            <PowerOff size={14} />
          )}
          {loading
            ? t("security.killSwitchWorking")
            : firewallActive
            ? t("security.killSwitchRestore")
            : t("security.killSwitchBtn")}
        </button>
      </div>
    </div>
  );
}
