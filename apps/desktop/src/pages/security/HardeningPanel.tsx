import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Lock, Unlock, Trash2 } from "lucide-react";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";
import { secureStore } from "../../store/secureStore";

interface HardeningPanelProps {
  port: number;
  firewallActive: boolean;
  onFirewallChange: (active: boolean) => void;
  onRescan: () => void;
  onEvent: () => void;
}

export function HardeningPanel({
  port, firewallActive, onFirewallChange, onRescan, onEvent,
}: HardeningPanelProps) {
  const { t } = useTranslation();
  const [firewallLoading, setFirewallLoading] = useState(false);
  const [firewallMsg, setFirewallMsg] = useState<string | null>(null);
  const [panicLoading, setPanicLoading] = useState(false);
  const [panicDone, setPanicDone] = useState(false);
  const [panicError, setPanicError] = useState<string | null>(null);

  const toggleFirewall = async () => {
    setFirewallLoading(true);
    setFirewallMsg(null);
    try {
      if (firewallActive) {
        const msg = await invoke<string>("remove_local_only_firewall", { port });
        onFirewallChange(false);
        setFirewallMsg(msg);
        await logSecurityEvent("firewall_off", `端口 ${port} 防火墙规则已移除`, "warn");
      } else {
        const msg = await invoke<string>("apply_local_only_firewall", { port });
        onFirewallChange(true);
        setFirewallMsg(msg);
        await logSecurityEvent("firewall_on", `端口 ${port} 防火墙规则已启用（仅允许本机访问）`, "info");
      }
      onRescan();
    } catch (e) {
      setFirewallMsg(String(e));
      await logSecurityEvent("firewall_error", String(e), "danger");
      onEvent();
    } finally {
      setFirewallLoading(false);
    }
  };

  const handlePanic = async () => {
    if (!window.confirm(t("security.panicConfirm"))) return;
    setPanicLoading(true);
    setPanicError(null);
    try {
      await secureStore.wipeAll();
      await logSecurityEvent("panic", "用户触发数据销毁：所有 API Key 和加密存储已清除", "danger");
      setPanicDone(true);
      onEvent();
    } catch (e) {
      setPanicError(String(e));
      await logSecurityEvent("panic_error", `数据销毁失败: ${String(e)}`, "danger");
      onEvent();
    } finally {
      setPanicLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">{t("security.harden")}</h2>

      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {firewallActive
            ? <Lock size={15} className="text-green-500 flex-shrink-0" />
            : <Unlock size={15} className="text-muted-foreground flex-shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("security.localOnly")}</p>
            <p className="text-xs text-muted-foreground">
              {t("security.localOnlyDesc", { port })}
            </p>
          </div>
        </div>
        <button
          onClick={toggleFirewall}
          disabled={firewallLoading}
          className={`flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            firewallActive
              ? "bg-green-600 text-white hover:bg-green-700"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          } disabled:opacity-50`}
        >
          {firewallLoading ? t("security.processing") : firewallActive ? t("security.enabled") : t("security.enable")}
        </button>
      </div>
      {firewallMsg && (
        <p className="text-xs text-muted-foreground px-1">{firewallMsg}</p>
      )}

      {panicError && (
        <p className="text-xs text-red-600 px-1">⚠ {t("security.panicFailed")}: {panicError}</p>
      )}
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <Trash2 size={15} className="text-red-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-600">{t("security.panic")}</p>
            <p className="text-xs text-muted-foreground">{t("security.panicDesc")}</p>
          </div>
        </div>
        <button
          onClick={handlePanic}
          disabled={panicLoading || panicDone}
          className="flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {panicDone ? t("security.destroyed") : panicLoading ? t("security.destroying") : t("security.destroy")}
        </button>
      </div>
    </div>
  );
}
