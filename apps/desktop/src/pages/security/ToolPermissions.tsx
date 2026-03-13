import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Terminal, RefreshCw, Plus, X } from "lucide-react";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";
import { type ToolPermissions as ToolPermissionsType } from "./types";

const EXEC_MODES = ["deny", "ask", "allow"] as const;
type ExecMode = typeof EXEC_MODES[number];

const MODE_COLOR: Record<ExecMode, string> = {
  deny:  "text-green-700 bg-green-100 border-green-200",
  ask:   "text-amber-700 bg-amber-100 border-amber-200",
  allow: "text-red-700   bg-red-100   border-red-200",
};

const MODE_DOT: Record<ExecMode, string> = {
  deny:  "bg-green-500",
  ask:   "bg-amber-500",
  allow: "bg-red-500",
};

interface ToolPermissionPanelProps {
  onEvent: () => void;
}

export function ToolPermissionPanel({ onEvent }: ToolPermissionPanelProps) {
  const { t } = useTranslation();
  const [perms, setPerms] = useState<ToolPermissionsType | null>(null);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPerms = useCallback(async () => {
    try {
      const p = await invoke<ToolPermissionsType>("get_tool_permissions");
      setPerms(p);
    } catch { /* non-blocking */ }
  }, []);

  useEffect(() => { loadPerms(); }, [loadPerms]);

  const handleSetMode = async (mode: ExecMode) => {
    if (!perms || perms.exec_mode === mode) return;
    setModeLoading(true);
    setModeMsg(null);
    try {
      await invoke("set_exec_mode", { mode });
      setPerms((p) => p ? { ...p, exec_mode: mode } : p);
      await logSecurityEvent(
        "exec_mode_change",
        `Shell 执行模式变更为「${t(`security.execMode.${mode}`)}」`,
        mode === "allow" ? "danger" : mode === "deny" ? "info" : "warn",
      );
      onEvent();
    } catch (e) {
      setModeMsg(String(e));
    } finally {
      setModeLoading(false);
    }
  };

  const handleAddPattern = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    setAddLoading(true);
    setListError(null);
    try {
      await invoke("add_exec_allowlist_entry", { pattern });
      setPerms((p) => p ? { ...p, allowlist: [...p.allowlist.filter((x) => x !== pattern), pattern] } : p);
      setNewPattern("");
      inputRef.current?.focus();
      await logSecurityEvent("allowlist_add", `白名单新增: ${pattern}`, "info");
      onEvent();
    } catch (e) {
      setListError(String(e));
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemovePattern = async (pattern: string) => {
    setListError(null);
    try {
      await invoke("remove_exec_allowlist_entry", { pattern });
      setPerms((p) => p ? { ...p, allowlist: p.allowlist.filter((x) => x !== pattern) } : p);
      await logSecurityEvent("allowlist_remove", `白名单移除: ${pattern}`, "info");
      onEvent();
    } catch (e) {
      setListError(String(e));
    }
  };

  if (!perms) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground animate-pulse">
        {t("security.toolPermsLoading")}
      </div>
    );
  }

  const currentMode = perms.exec_mode as ExecMode;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Terminal size={14} className="text-primary" />
        <h2 className="text-sm font-semibold">{t("security.toolPerms")}</h2>
        <span className="text-xs text-muted-foreground font-normal ml-1">· {t("security.toolPermsDesc")}</span>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{t("security.execTool")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("security.execToolDesc")}</p>
          </div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${MODE_COLOR[currentMode]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${MODE_DOT[currentMode]}`} />
            {t(`security.execModeBadge.${currentMode}`)}
          </span>
        </div>

        <div className="flex gap-2">
          {EXEC_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => handleSetMode(mode)}
              disabled={modeLoading}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${
                currentMode === mode
                  ? mode === "deny"  ? "bg-green-600 text-white border-green-600" :
                    mode === "ask"   ? "bg-amber-500 text-white border-amber-500" :
                                       "bg-red-600   text-white border-red-600"
                  : mode === "allow"
                    ? "border-orange-400 text-orange-600 hover:bg-orange-50"
                    : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {t(`security.execMode.${mode}`)}
            </button>
          ))}
        </div>

        <p className={`text-[11px] leading-relaxed rounded px-2 py-1 ${
          currentMode === "deny"  ? "text-green-700 bg-green-50" :
          currentMode === "ask"   ? "text-amber-700 bg-amber-50" :
                                    "text-red-700   bg-red-50"
        }`}>
          {t(`security.execModeHint.${currentMode}`)}
        </p>

        {modeMsg && <p className="text-xs text-red-600">{modeMsg}</p>}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-3 text-[11px] font-semibold text-muted-foreground bg-muted/30 px-3 py-2 border-b border-border">
          <span>权限维度</span>
          <span className="text-center">状态</span>
          <span className="text-right">说明</span>
        </div>
        {[
          {
            label: "Shell 执行",
            badge: t(`security.execModeBadge.${currentMode}`),
            color: currentMode === "deny" ? "text-green-600" : currentMode === "ask" ? "text-amber-600" : "text-red-600",
            dot: MODE_DOT[currentMode],
            note: "exec / process 工具",
          },
          {
            label: "文件写入",
            badge: "write / edit 工具",
            color: "text-muted-foreground",
            dot: "bg-blue-400",
            note: "受 OpenClaw 沙箱管控",
          },
          {
            label: "外部网络",
            badge: "web_fetch / browser",
            color: "text-muted-foreground",
            dot: "bg-blue-400",
            note: "由防火墙规则控制",
          },
        ].map((row) => (
          <div key={row.label} className="grid grid-cols-3 items-center px-3 py-2.5 text-xs border-b border-border/50 last:border-0">
            <span className="font-medium">{row.label}</span>
            <span className={`flex items-center justify-center gap-1.5 font-semibold ${row.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.dot}`} />
              {row.badge}
            </span>
            <span className="text-right text-muted-foreground text-[10px]">{row.note}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs font-semibold">{t("security.allowlist")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("security.allowlistDesc")}</p>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddPattern(); }}
            placeholder={t("security.allowlistPlaceholder")}
            className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleAddPattern}
            disabled={addLoading || !newPattern.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {addLoading ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
            {addLoading ? t("security.allowlistAdding") : t("security.allowlistAdd")}
          </button>
        </div>

        {listError && <p className="text-[11px] text-red-600">{t("security.allowlistError")}: {listError}</p>}

        {perms.allowlist.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-1">{t("security.allowlistEmpty")}</p>
        ) : (
          <div className="space-y-1">
            {perms.allowlist.map((pattern) => (
              <div key={pattern} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border">
                <Terminal size={11} className="text-muted-foreground flex-shrink-0" />
                <span className="font-mono text-[11px] flex-1 truncate">{pattern}</span>
                <button
                  onClick={() => handleRemovePattern(pattern)}
                  className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                  title={t("security.allowlistRemove")}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
