import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useInstanceStore } from "../store/instances";
import { logSecurityEvent } from "@clawno/shared/securityEventStore";
import { TokenPageContent } from "@clawno/shared/components/token/TokenPageContent";

export function TokenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { instances } = useInstanceStore();

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [killLoading, setKillLoading] = useState(false);
  const [killDone, setKillDone] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);

  const activePort = instances.find((i) => i.health === "online")?.port ?? 18789;

  useEffect(() => {
    setKillDone(false);
    setKillError(null);
  }, [selectedInstanceId]);

  const handleAnomalyKill = useCallback(async (ratio?: string) => {
    if (!window.confirm(t("tokens.anomalyKillConfirm", { ratio: ratio ?? "3.0" }))) return;
    setKillLoading(true);
    setKillError(null);
    try {
      await invoke("kill_switch_offline", { port: activePort });
      setKillDone(true);
      await logSecurityEvent(
        "token_anomaly_kill",
        `Token 异常消耗触发紧急断网 · 端口 ${activePort}`,
        "danger",
      );
    } catch (e) {
      setKillError(t("tokens.anomalyKillFailed"));
      console.error("anomaly kill switch failed:", e);
    } finally {
      setKillLoading(false);
    }
  }, [activePort, t]);

  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null;

  const instanceOptions = instances.map((i) => ({
    id: i.id,
    name: i.name,
    health: i.health,
    kind: i.kind,
  }));

  return (
    <div className="page-enter p-6 max-w-4xl mx-auto space-y-6">
      <TokenPageContent
        instances={instanceOptions}
        selectedInstanceId={selectedInstanceId}
        onSelectInstance={(id) => {
          setSelectedInstanceId(id);
        }}
        showInstanceSelector={instances.length > 0}
        showCostAnalysis
        onKillSwitch={handleAnomalyKill}
        onGoSettings={() => navigate("/settings", { state: { tab: "storage" } })}
        killLoading={killLoading}
        killDone={killDone}
        killError={killError}
        instanceName={selectedInstance?.name}
      />
    </div>
  );
}
