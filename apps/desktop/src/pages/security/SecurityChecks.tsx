import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  ExternalLink,
  Loader,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { type SecurityCheck, type FixAction, type PortConnection, StatusIcon } from "./types";

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

export function CheckRow({
  check,
  port,
  onFixed,
}: {
  check: SecurityCheck;
  port: number;
  onFixed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen]       = useState(check.status === "danger");
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
      <button
        className="w-full text-left px-3 py-2.5 transition-all"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          <StatusIcon status={check.status} />
          <span className="text-sm font-medium flex-1">{label}</span>
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

      {open && (
        <div className="px-4 pb-3 space-y-3 border-t border-current/10">
          <p className="text-xs text-muted-foreground leading-relaxed pt-2">{check.detail}</p>

          {fixErr && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{fixErr}</span>
            </div>
          )}

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

export function ConnectionRow({ conn }: { conn: PortConnection }) {
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
