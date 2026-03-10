import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lock,
  Unlock,
  Trash2,
  Activity,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Power,
  PowerOff,
  Terminal,
  Plus,
  X,
  Zap,
  Home,
  Globe,
  Network,
  Loader,
  ExternalLink,
} from "lucide-react";
import { useInstanceStore } from "../store/instances";
import { secureStore } from "../store/secureStore";
import {
  logSecurityEvent,
  getRecentSecurityEvents,
  clearSecurityEvents,
  type SecurityEvent,
} from "../store/securityEventStore";

// ── Types (mirrors Rust structs) ──────────────────────────────────────────

interface SecurityCheck {
  id: string;
  label: string;
  status: "ok" | "notice" | "warn" | "danger" | "unknown";
  detail: string;
}

interface SecurityReport {
  score: number;
  checks: SecurityCheck[];
}

interface PortConnection {
  local_addr: string;
  remote_addr: string;
  state: string;
  pid: string;
  is_local: boolean;
  is_listening: boolean;
}

interface ToolPermissions {
  exec_mode: "deny" | "ask" | "allow";
  allowlist: string[];
}

interface AllowedIpEntry {
  ip: string;
  label: string;
  port: number;
  active: boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────

// Weights mirror the Rust `calculate_score` weight table (must sum to 100).
const CHECK_WEIGHTS: Record<string, number> = {
  network_access: 40,
  im_connector:   20,
  port_exposure:  15,
  node_version:   10,
  pm2_status:     10,
  offline_mode:    5,
};

/** Points a check contributes to the 0-100 score — mirrors Rust logic exactly. */
function checkContrib(check: SecurityCheck): number {
  const w = CHECK_WEIGHTS[check.id] ?? 0;
  switch (check.status) {
    case "ok":      return w;
    case "notice":  return Math.round(w * 0.85); // home LAN subnet — local devices only
    case "warn":    return check.id === "network_access" ? Math.round(w * 0.75) : Math.round(w * 0.6);
    case "unknown": return Math.round(w * 0.5);
    default:        return 0;
  }
}

/** Human-readable grade label for a score. */
function scoreGrade(score: number, t: (k: string) => string): string {
  if (score >= 90) return t("security.gradeExcellent");
  if (score >= 75) return t("security.gradeGood");
  if (score >= 60) return t("security.gradeFair");
  return t("security.gradeNeedsWork");
}

function ScoreRing({ score, onClick }: { score: number; onClick?: () => void }) {
  const { t } = useTranslation();
  // Aligned with new weighted ranges: 85+ = green, 65+ = amber, else red.
  const color =
    score >= 85 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${onClick ? "cursor-pointer group" : ""}`}
      onClick={onClick}
      title={onClick ? t("security.scoreBreakdownHint") : undefined}
    >
      <svg width={112} height={112} viewBox="0 0 112 112"
        className={onClick ? "transition-transform group-hover:scale-105" : ""}
      >
        <circle cx={56} cy={56} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={10} />
        <circle
          cx={56} cy={56} r={r} fill="none"
          stroke={color} strokeWidth={10}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 56 56)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x={56} y={60} textAnchor="middle" fontSize={24} fontWeight={700} fill={color}>
          {score}
        </text>
      </svg>
      <div className="text-center">
        <p className="text-xs text-muted-foreground">
          {t("security.score")}
          {onClick && <span className="ml-1 opacity-60">↗</span>}
        </p>
        <p className="text-[11px] font-semibold mt-0.5" style={{ color }}>
          {scoreGrade(score, t)}
        </p>
      </div>
    </div>
  );
}

// ── Score Breakdown Panel ─────────────────────────────────────────────────

function ScoreBreakdownPanel({
  report,
  onClose,
}: {
  report: SecurityReport;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  const contribColor = (status: string) =>
    status === "ok"     ? "text-green-600"  :
    status === "notice" ? "text-blue-500"   :
    status === "warn"   ? "text-amber-600"  :
    status === "danger" ? "text-red-600"    : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-primary" />
          {t("security.scoreBreakdownTitle")}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {t("security.scoreBreakdownClose")} ✕
        </button>
      </div>

      {/* Scoring legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{t("security.gradeLegendOk")}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{t("security.gradeLegendWarn")}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{t("security.gradeLegendDanger")}</span>
        <span className="ml-auto font-semibold text-foreground">{t("security.gradeTotal")}：{report.score} / 100</span>
      </div>

      <div className="space-y-1.5">
        {report.checks.map((c) => {
          const pts    = checkContrib(c);
          const maxPts = CHECK_WEIGHTS[c.id] ?? 0;
          const labelKey = `security.checkLabels.${c.id}`;
          const label = i18n.exists(labelKey) ? t(labelKey) : c.label;
          const pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
          return (
            <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
              c.status === "ok"     ? "border-green-500/20 bg-green-500/5"  :
              c.status === "notice" ? "border-blue-400/25 bg-blue-400/5"   :
              c.status === "warn"   ? "border-amber-500/20 bg-amber-500/5"  :
              c.status === "danger" ? "border-red-500/20 bg-red-500/5"      :
              "border-border bg-muted/20"
            }`}>
              <StatusIcon status={c.status} />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{label}</span>
                {/* Mini progress bar showing fill ratio */}
                <div className="mt-1 h-1 w-full rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background:
                        c.status === "ok"     ? "#22c55e" :
                        c.status === "notice" ? "#60a5fa" :
                        c.status === "warn"   ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
              </div>
              <span className={`font-bold tabular-nums flex-shrink-0 ${contribColor(c.status)}`}>
                +{pts}<span className="text-muted-foreground font-normal">/{maxPts}</span>
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                c.status === "ok"     ? "text-green-700 bg-green-100"  :
                c.status === "notice" ? "text-blue-700  bg-blue-100"   :
                c.status === "warn"   ? "text-amber-700 bg-amber-100"  :
                c.status === "danger" ? "text-red-700   bg-red-100"    :
                "text-muted-foreground bg-muted"
              }`}>
                {t(`security.checkStatus.${c.status}`)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Grade summary */}
      <div className="flex items-center justify-between px-1 pt-1 border-t border-border">
        <p className="text-[11px] text-muted-foreground">{t("security.scoreBreakdownHint")}</p>
        <span className="text-xs font-bold" style={{
          color: report.score >= 85 ? "#22c55e" : report.score >= 65 ? "#f59e0b" : "#ef4444"
        }}>
          {scoreGrade(report.score, t)}
        </span>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SecurityCheck["status"] }) {
  if (status === "ok")      return <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />;
  if (status === "notice")  return <CheckCircle2 size={16} className="text-blue-400 flex-shrink-0" />;
  if (status === "warn")    return <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />;
  if (status === "danger")  return <ShieldX size={16} className="text-red-500 flex-shrink-0" />;
  return <HelpCircle size={16} className="text-muted-foreground flex-shrink-0" />;
}

// ── Per-check fix actions ────────────────────────────────────────────────────

interface FixAction {
  label: string;
  /** async fn to invoke; returning normally means success */
  run?: () => Promise<void>;
  /** external URL to open instead of invoking a command */
  href?: string;
  /** secondary "upgrade" option shown as a less-prominent link */
  secondary?: { label: string; run: () => Promise<void> };
}

function useFixAction(
  check: SecurityCheck,
  port: number,
  onFixed: () => void,
): FixAction | null {
  const { t } = useTranslation();
  if (check.status === "ok") return null;

  switch (check.id) {
    case "network_access":
      if (check.status === "danger") {
        return {
          label: t("security.fix.networkLocalOnly"),
          run: async () => {
            await invoke("set_network_access_mode", { port, mode: "local" });
            onFixed();
          },
          secondary: {
            label: t("security.fix.networkSubnet"),
            run: async () => {
              await invoke("set_network_access_mode", { port, mode: "subnet" });
              onFixed();
            },
          },
        };
      }
      if (check.status === "warn" || check.status === "notice") {
        return {
          label: t("security.fix.networkUpgrade"),
          run: async () => {
            await invoke("set_network_access_mode", { port, mode: "local" });
            onFixed();
          },
        };
      }
      return null;

    case "pm2_status":
      return {
        label: t("security.fix.pm2Restart"),
        run: async () => {
          await invoke("restart_local_service");
          // Give pm2 a moment to start before re-scanning.
          await new Promise((r) => setTimeout(r, 1500));
          onFixed();
        },
      };

    case "node_version":
      if (check.status === "danger") {
        return {
          label: t("security.fix.nodeDownload"),
          href: "https://nodejs.org/en/download",
        };
      }
      return null;

    default:
      return null;
  }
}

// ── Check row with inline fix button ────────────────────────────────────────

function CheckRow({
  check,
  port,
  onFixed,
}: {
  check: SecurityCheck;
  port: number;
  onFixed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen]       = useState(check.status === "danger"); // auto-expand danger items
  const [fixing, setFixing]   = useState(false);
  const [fixErr, setFixErr]   = useState<string | null>(null);
  const [fixDone, setFixDone] = useState(false);

  const fixAction = useFixAction(check, port, onFixed);

  const bg =
    check.status === "ok"     ? "border-green-500/20 bg-green-500/5"   :
    check.status === "notice" ? "border-blue-400/25 bg-blue-400/5"     :
    check.status === "warn"   ? "border-amber-500/20 bg-amber-500/5"   :
    check.status === "danger" ? "border-red-500/20 bg-red-500/5"       :
    "border-border bg-muted/20";

  const labelKey = `security.checkLabels.${check.id}`;
  const label = i18n.exists(labelKey) ? t(labelKey) : check.label;

  const handleFix = async (run: () => Promise<void>, e: React.MouseEvent) => {
    e.stopPropagation();
    setFixing(true);
    setFixErr(null);
    try {
      await run();
      setFixDone(true);
    } catch (err) {
      setFixErr(String(err));
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className={`rounded-lg border ${bg} overflow-hidden`}>
      {/* ── Header row (click to expand) ── */}
      <button
        className="w-full text-left px-3 py-2.5 transition-all"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          <StatusIcon status={check.status} />
          <span className="text-sm font-medium flex-1">{label}</span>
          {/* Inline fix button — visible immediately for danger items */}
          {fixAction && !fixDone && check.status === "danger" && fixAction.run && (
            <button
              onClick={(e) => handleFix(fixAction.run!, e)}
              disabled={fixing}
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {fixing ? <Loader size={10} className="animate-spin" /> : <Zap size={10} />}
              {t("security.fixNow")}
            </button>
          )}
          {fixDone && (
            <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-green-600">
              <CheckCircle2 size={11} /> {t("security.fixDone")}
            </span>
          )}
          <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            check.status === "ok"     ? "text-green-700 bg-green-100"   :
            check.status === "notice" ? "text-blue-700  bg-blue-100"    :
            check.status === "warn"   ? "text-amber-700 bg-amber-100"   :
            check.status === "danger" ? "text-red-700   bg-red-100"     :
            "text-muted-foreground bg-muted"
          }`}>
            {t(`security.checkStatus.${check.status}`)}
          </span>
        </div>
      </button>

      {/* ── Expanded detail + fix options ── */}
      {open && (
        <div className="px-4 pb-3 space-y-3 border-t border-current/10">
          <p className="text-xs text-muted-foreground leading-relaxed pt-2">{check.detail}</p>

          {/* Fix error */}
          {fixErr && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{fixErr}</span>
            </div>
          )}

          {/* Fix actions */}
          {fixAction && !fixDone && (
            <div className="flex flex-wrap gap-2">
              {fixAction.run && (
                <button
                  onClick={(e) => handleFix(fixAction.run!, e)}
                  disabled={fixing}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    check.status === "danger"
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-amber-500 text-white hover:bg-amber-600"
                  }`}
                >
                  {fixing ? <Loader size={11} className="animate-spin" /> : <Zap size={11} />}
                  {fixAction.label}
                </button>
              )}
              {fixAction.href && (
                <a
                  href={fixAction.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={11} />
                  {fixAction.label}
                </a>
              )}
              {fixAction.secondary && (
                <button
                  onClick={(e) => handleFix(fixAction.secondary!.run, e)}
                  disabled={fixing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-muted/60 hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {fixAction.secondary.label}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Close chevron at bottom when expanded — subtle */}
      {open && check.status !== "ok" && (
        <button
          className="w-full flex justify-center py-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          onClick={() => setOpen(false)}
        >
          <ChevronUp size={12} />
        </button>
      )}
    </div>
  );
}

function ConnectionRow({ conn }: { conn: PortConnection }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs border ${
      conn.is_local ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"
    }`}>
      {conn.is_local
        ? <Wifi size={13} className="text-green-500 flex-shrink-0" />
        : <WifiOff size={13} className="text-amber-500 flex-shrink-0" />}
      <span className="font-mono text-[11px] flex-1 truncate">{conn.remote_addr}</span>
      <span className={`font-semibold ${conn.is_local ? "text-green-600" : "text-amber-600"}`}>
        {conn.is_local ? t("security.localConn") : t("security.externalConn")}
      </span>
      <span className="text-muted-foreground">{conn.state}</span>
    </div>
  );
}

// ── Kill Switch Banner ────────────────────────────────────────────────────

interface KillSwitchBannerProps {
  port: number;
  firewallActive: boolean;
  onFirewallChange: (active: boolean) => void;
  onEvent: () => void;
}

function KillSwitchBanner({ port, firewallActive, onFirewallChange, onEvent }: KillSwitchBannerProps) {
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

// ── Tool Permission Panel ─────────────────────────────────────────────────

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

function ToolPermissionPanel({ onEvent }: ToolPermissionPanelProps) {
  const { t } = useTranslation();
  const [perms, setPerms] = useState<ToolPermissions | null>(null);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPerms = useCallback(async () => {
    try {
      const p = await invoke<ToolPermissions>("get_tool_permissions");
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

      {/* Exec mode selector */}
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

        {/* Mode toggle buttons */}
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

        {/* Mode hint */}
        <p className={`text-[11px] leading-relaxed rounded px-2 py-1 ${
          currentMode === "deny"  ? "text-green-700 bg-green-50" :
          currentMode === "ask"   ? "text-amber-700 bg-amber-50" :
                                    "text-red-700   bg-red-50"
        }`}>
          {t(`security.execModeHint.${currentMode}`)}
        </p>

        {modeMsg && <p className="text-xs text-red-600">{modeMsg}</p>}
      </div>

      {/* Permission radar table */}
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

      {/* Allowlist */}
      <div className="space-y-2">
        <div>
          <p className="text-xs font-semibold">{t("security.allowlist")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("security.allowlistDesc")}</p>
        </div>

        {/* Add new entry */}
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

        {/* Existing entries */}
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

// ── Network Access Panel ──────────────────────────────────────────────────

interface LanInfo {
  ip: string;
  subnet: string;
  prefix: number;
}

type NetworkMode = "off" | "local" | "subnet" | "tailscale";

interface NetworkModeCardProps {
  mode: NetworkMode;
  current: NetworkMode;
  icon: React.ReactNode;
  label: string;
  desc: string;
  warning?: string;
  badge?: string;
  onClick: () => void;
  applying: boolean;
}

function NetworkModeCard({
  mode, current, icon, label, desc, warning, badge, onClick, applying,
}: NetworkModeCardProps) {
  const active = current === mode;
  return (
    <button
      onClick={onClick}
      disabled={applying || active}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
        active
          ? mode === "off"
            ? "border-primary/50 bg-primary/5"
            : "border-green-500/60 bg-green-500/5"
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/30 disabled:opacity-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          active
            ? mode === "off" ? "bg-primary/15 text-primary" : "bg-green-500/15 text-green-600"
            : "bg-muted/60 text-muted-foreground"
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${active ? (mode === "off" ? "text-primary" : "text-green-700") : ""}`}>
              {label}
            </span>
            {active && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                mode === "off"
                  ? "text-primary bg-primary/10"
                  : "text-green-700 bg-green-100"
              }`}>
                ✓ {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
          {warning && active && (
            <p className="text-[11px] text-amber-600 mt-1 font-medium">{warning}</p>
          )}
        </div>
      </div>
    </button>
  );
}

interface NetworkAccessPanelProps {
  port: number;
  onEvent: () => void;
}

function NetworkAccessPanel({ port, onEvent }: NetworkAccessPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode]       = useState<NetworkMode>("off");
  const [lanInfo, setLanInfo] = useState<LanInfo | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    Promise.all([
      invoke<string>("get_network_access_mode", { port }),
      invoke<LanInfo | null>("get_local_lan_info"),
    ]).then(([m, info]) => {
      setMode((m as NetworkMode) || "off");
      setLanInfo(info);
    }).catch(console.error)
      .finally(() => setLoaded(true));
  }, [port]);

  const applyMode = async (newMode: NetworkMode) => {
    if (newMode === mode) return;
    setApplying(true);
    setError(null);
    try {
      await invoke("set_network_access_mode", { port, mode: newMode });
      setMode(newMode);
      await logSecurityEvent(
        "firewall_on",
        `设备访问模式已切换为「${t(`security.netAccessMode.${newMode}`)}」· 端口 ${port}`,
        newMode === "off" ? "warn" : "info",
      );
      onEvent();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground animate-pulse">
        {t("security.netAccessLoading")}
      </div>
    );
  }

  const subnetDesc = lanInfo
    ? t("security.netAccessModeDesc.subnet", { subnet: lanInfo.subnet })
    : t("security.netAccessNoLan");

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Network size={14} className="text-primary" />
        <h2 className="text-sm font-semibold">{t("security.netAccess")}</h2>
        <span className="text-xs text-muted-foreground font-normal ml-1">
          · {t("security.netAccessDesc")}
        </span>
      </div>

      {/* LAN info badge */}
      {lanInfo && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border">
          <Wifi size={12} className="text-muted-foreground flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t("security.netAccessCurrentIp")}</span>
          <span className="font-mono text-[11px] font-semibold text-foreground">{lanInfo.ip}</span>
          <span className="text-[10px] text-muted-foreground ml-1">({lanInfo.subnet})</span>
        </div>
      )}

      {/* Local-only info — managed by Kill Switch toggle below */}
      {mode === "local" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-[11px] text-green-700">
          <Lock size={12} className="flex-shrink-0" />
          {t("security.netAccessLocalActive")}
        </div>
      )}

      {/* Mode cards */}
      <div className="space-y-2">
        <NetworkModeCard
          mode="off"
          current={mode}
          icon={<Globe size={16} />}
          label={t("security.netAccessMode.off")}
          desc={t("security.netAccessModeDesc.off")}
          badge={t("security.netAccessActive")}
          onClick={() => applyMode("off")}
          applying={applying}
        />
        <NetworkModeCard
          mode="subnet"
          current={mode}
          icon={<Home size={16} />}
          label={t("security.netAccessMode.subnet")}
          desc={subnetDesc}
          badge={t("security.netAccessActive")}
          warning={!lanInfo ? t("security.netAccessNoLan") : undefined}
          onClick={() => applyMode("subnet")}
          applying={applying || !lanInfo}
        />
        <NetworkModeCard
          mode="tailscale"
          current={mode}
          icon={<Lock size={16} />}
          label={t("security.netAccessMode.tailscale")}
          desc={t("security.netAccessModeDesc.tailscale")}
          badge={t("security.netAccessActive")}
          onClick={() => applyMode("tailscale")}
          applying={applying}
        />
      </div>

      {/* Tailscale install tip */}
      {mode !== "tailscale" && (
        <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
          💡 {t("security.netAccessTailscaleTip")}{" "}
          <button
            onClick={() => navigate("/connectors")}
            className="text-primary hover:underline font-medium"
          >
            {t("security.netAccessTailscalePage")}
          </button>
          {" "}{t("security.netAccessTailscaleTipSuffix")}
        </p>
      )}

      {/* Applying indicator */}
      {applying && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw size={12} className="animate-spin" />
          {t("security.netAccessApplying")}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-600 px-1">
          ⚠ {t("security.netAccessApplyFailed")}: {error}
        </p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export function SecurityPage() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();

  const activeInstance = instances.find((i) => i.health === "online");
  const activePort = activeInstance?.port ?? 18789;
  const hasActiveInstance = !!activeInstance;

  const [report, setReport] = useState<SecurityReport | null>(null);
  const [connections, setConnections] = useState<PortConnection[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [firewallActive, setFirewallActive] = useState(false);
  const [firewallLoading, setFirewallLoading] = useState(false);
  const [firewallMsg, setFirewallMsg] = useState<string | null>(null);
  const [panicLoading, setPanicLoading] = useState(false);
  const [panicDone, setPanicDone] = useState(false);
  const [panicError, setPanicError] = useState<string | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const [clearingEvents, setClearingEvents] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const evts = await getRecentSecurityEvents(30);
      setEvents(evts);
    } catch { /* non-blocking */ }
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const [rep, conns, fwActive] = await Promise.all([
        invoke<SecurityReport>("scan_security_status", { port: activePort }),
        invoke<PortConnection[]>("get_port_connections", { port: activePort }),
        // Always re-read the OS firewall state so the Kill Switch banner stays in sync.
        invoke<boolean>("check_firewall_active", { port: activePort }).catch(() => false),
      ]);
      setReport(rep);
      setConnections(conns);
      setFirewallActive(fwActive as boolean);
      await logSecurityEvent(
        "scan",
        `安全扫描完成，评分：${rep.score} 分，活跃连接：${conns.length}`,
        rep.score < 60 ? "danger" : rep.score < 80 ? "warn" : "info",
      );
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
      await loadEvents();
    }
  }, [activePort, loadEvents]);

  useEffect(() => {
    invoke<boolean>("check_firewall_active", { port: activePort })
      .then(setFirewallActive)
      .catch(() => { /* non-blocking */ });
  }, [activePort]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  const toggleFirewall = async () => {
    setFirewallLoading(true);
    setFirewallMsg(null);
    try {
      if (firewallActive) {
        const msg = await invoke<string>("remove_local_only_firewall", { port: activePort });
        setFirewallActive(false);
        setFirewallMsg(msg);
        await logSecurityEvent("firewall_off", `端口 ${activePort} 防火墙规则已移除`, "warn");
      } else {
        const msg = await invoke<string>("apply_local_only_firewall", { port: activePort });
        setFirewallActive(true);
        setFirewallMsg(msg);
        await logSecurityEvent("firewall_on", `端口 ${activePort} 防火墙规则已启用（仅允许本机访问）`, "info");
      }
      // runScan already calls loadEvents() internally.
      runScan();
    } catch (e) {
      setFirewallMsg(String(e));
      await logSecurityEvent("firewall_error", String(e), "danger");
      await loadEvents();
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
      await loadEvents();
    } catch (e) {
      setPanicError(String(e));
      await logSecurityEvent("panic_error", `数据销毁失败: ${String(e)}`, "danger");
      await loadEvents();
    } finally {
      setPanicLoading(false);
    }
  };

  const handleClearEvents = async () => {
    setClearingEvents(true);
    try {
      await clearSecurityEvents();
      setEvents([]);
    } catch {
      // Non-blocking.
    } finally {
      setClearingEvents(false);
    }
  };

  const externalConns = connections.filter((c) => !c.is_local && !c.is_listening);

  return (
    <div className="page-enter p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck size={22} className="text-primary" />
            {t("security.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("security.desc", { port: activePort })}
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
          {scanning ? t("security.scanning") : t("security.rescan")}
        </button>
      </div>

      {/* ── No instance warning ── */}
      {!hasActiveInstance && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700 flex items-center gap-2">
          <AlertTriangle size={13} className="flex-shrink-0" />
          {t("security.noInstanceWarning", { port: activePort })}
        </div>
      )}

      {/* ── Scan error ── */}
      {scanError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs text-red-700 flex items-center gap-2">
          <ShieldX size={13} className="flex-shrink-0" />
          {t("security.scanError")}: {scanError}
        </div>
      )}

      {/* ── KILL SWITCH — most prominent, top of actions ── */}
      <KillSwitchBanner
        port={activePort}
        firewallActive={firewallActive}
        onFirewallChange={setFirewallActive}
        onEvent={runScan}
      />

      {/* ── Top row: score + external alert ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className={`rounded-xl border bg-card p-5 flex items-center justify-center transition-colors ${
            report ? "border-border hover:border-primary/40 cursor-pointer" : "border-border"
          }`}
          onClick={report ? () => setShowBreakdown((v) => !v) : undefined}
        >
          {report
            ? <ScoreRing score={report.score} onClick={() => setShowBreakdown((v) => !v)} />
            : <div className="text-sm text-muted-foreground animate-pulse">{t("security.scanning")}</div>
          }
        </div>

        <div className={`md:col-span-2 rounded-xl border p-5 flex flex-col justify-between ${
          externalConns.length > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-green-500/30 bg-green-500/5"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {externalConns.length > 0
              ? <ShieldAlert size={18} className="text-amber-500" />
              : <ShieldCheck size={18} className="text-green-500" />}
            <span className="font-semibold text-sm">
              {externalConns.length > 0
                ? t("security.externalAlert", { count: externalConns.length })
                : t("security.noExternal")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {externalConns.length > 0
              ? t("security.externalDesc")
              : t("security.noExternalDesc")}
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {t("security.activeConns")}<span className="font-semibold text-foreground">{connections.length}</span>
          </div>
        </div>
      </div>

      {/* ── Score Breakdown Panel ── */}
      {showBreakdown && report && (
        <ScoreBreakdownPanel
          report={report}
          onClose={() => setShowBreakdown(false)}
        />
      )}

      {/* ── Tool Permission Radar ── */}
      <ToolPermissionPanel onEvent={loadEvents} />

      {/* ── Network Access Control ── */}
      <NetworkAccessPanel port={activePort} onEvent={runScan} />

      {/* ── Security checks ── */}
      {report && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} />
            {t("security.checks")}
            <span className="ml-auto text-xs text-muted-foreground font-normal">{t("security.checksHint")}</span>
          </h2>
          {report.checks.map((c) => (
            <CheckRow key={c.id} check={c} port={activePort} onFixed={runScan} />
          ))}
        </div>
      )}

      {/* ── Network connections ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Wifi size={14} />
          {t("security.wall")}
          <span className="text-xs font-normal text-muted-foreground ml-1">· {t("security.wallSub", { port: activePort })}</span>
        </h2>
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{t("security.noConnections")}</p>
        ) : (
          <div className="space-y-1.5">
            {connections.map((c, i) => (
              <ConnectionRow
                key={`${c.local_addr}-${c.remote_addr}-${c.pid}-${i}`}
                conn={c}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Hardening actions ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">{t("security.harden")}</h2>

        {/* Firewall toggle */}
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            {firewallActive
              ? <Lock size={15} className="text-green-500 flex-shrink-0" />
              : <Unlock size={15} className="text-muted-foreground flex-shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("security.localOnly")}</p>
              <p className="text-xs text-muted-foreground">
                {t("security.localOnlyDesc", { port: activePort })}
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

        {/* Panic button */}
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

      {/* ── Security Event Log ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowEvents((v) => !v)}
          className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-muted/30 transition-colors"
        >
          <ClipboardList size={14} className="text-primary flex-shrink-0" />
          <span className="text-sm font-semibold flex-1">{t("security.eventsTitle")}</span>
          {events.length > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground mr-1">
              {events.length}
            </span>
          )}
          {showEvents ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>

        {showEvents && (
          <div className="border-t border-border px-5 pb-4 pt-3 space-y-2">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{t("security.eventsEmpty")}</p>
            ) : (
              <>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-xs border ${
                        ev.severity === "danger" ? "border-red-500/20 bg-red-500/5" :
                        ev.severity === "warn"   ? "border-amber-500/20 bg-amber-500/5" :
                        "border-border bg-muted/20"
                      }`}
                    >
                      <span className={`font-semibold flex-shrink-0 pt-px ${
                        ev.severity === "danger" ? "text-red-500" :
                        ev.severity === "warn"   ? "text-amber-500" :
                        "text-primary"
                      }`}>
                        {t(`security.eventTypes.${ev.eventType}`, { defaultValue: ev.eventType })}
                      </span>
                      <span className="text-muted-foreground flex-1">{ev.detail}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 font-mono">
                        {new Date(ev.createdAt).toLocaleString(undefined, {
                          month: "2-digit",
                          day:   "2-digit",
                          hour:  "2-digit",
                          minute:"2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleClearEvents}
                    disabled={clearingEvents}
                    className="text-[11px] px-3 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {t("security.clearEvents")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
