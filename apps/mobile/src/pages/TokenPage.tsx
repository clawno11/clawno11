import { useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";
import { useKillSwitch } from "@clawno/shared/hooks/useKillSwitch";
import { TopBar } from "../components/TopBar";
import {
  TokenPageContent,
  type TokenPageContentRef,
} from "@clawno/shared/components/token/TokenPageContent";
import { useInstanceStore } from "../store/instances";

export function TokenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const contentRef = useRef<TokenPageContentRef>(null);
  const instances = useInstanceStore((s) => s.instances);

  const [killDone, setKillDone] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { running: killLoading, trigger: triggerKill } = useKillSwitch({
    platform: "mobile",
    instances,
  });

  const handleAnomalyKill = useCallback(async (ratio?: string) => {
    setKillError(null);
    const res = await triggerKill();

    if (res.detail === "no_remote_instance") {
      await logSecurityEvent(
        "token_anomaly_detected_mobile",
        `token anomaly ${ratio ?? "3.0"}x avg — no remote instance to stop`,
        "danger",
      );
      setKillError(t("manage.sshCredsRequired"));
      setTimeout(() => setKillError(null), 5000);
      return;
    }

    if (res.detail === "no_credentials") {
      await logSecurityEvent("kill_switch_no_creds", "SSH credentials not found for remote instance", "warn");
      setKillError(t("manage.sshCredsRequired"));
      setTimeout(() => setKillError(null), 5000);
      return;
    }

    if (res.ok) {
      await logSecurityEvent("kill_switch_activated", `token anomaly ${ratio ?? "3.0"}x avg — remote service stopped via SSH`, "danger");
      setKillDone(true);
      setTimeout(() => setKillDone(false), 5000);
    } else {
      await logSecurityEvent("kill_switch_failed", `kill switch failed: ${res.detail}`, "danger");
      setKillError(t("tokens.anomalyKillFailed"));
      setTimeout(() => setKillError(null), 5000);
    }
  }, [t, triggerKill]);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={t("tokens.title")}
        subtitle={t("tokens.desc")}
        back
        right={
          <button
            onClick={() => contentRef.current?.refresh()}
            className="touch-btn p-2 rounded-full"
          >
            <RefreshCw
              size={18}
              className={`text-[hsl(var(--muted-foreground))] ${loading ? "animate-spin" : ""}`}
            />
          </button>
        }
      />
      <div className="flex-1 scrollable p-4 space-y-4 pb-6">
        <TokenPageContent
          ref={contentRef}
          onLoadingChange={setLoading}
          showInstanceSelector
          showCostAnalysis
          onKillSwitch={handleAnomalyKill}
          onGoSettings={() => navigate("/settings")}
          killLoading={killLoading}
          killDone={killDone}
          killError={killError}
        />
      </div>
    </div>
  );
}
