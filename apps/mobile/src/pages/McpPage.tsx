import { useState, useCallback } from "react";
import { TopBar } from "../components/TopBar";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { McpPageContent } from "@clawno/shared/components/mcp/McpPageContent";

export function McpPage() {
  const { t } = useTranslation();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshTrigger((t) => t + 1);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("mcp.title")} subtitle={t("mcp.desc")} back />
      <div className="flex-1 scrollable p-4 space-y-4 pb-6">
        <McpPageContent
          showPlugins={false}
          showDescription
          scanAfterAdd
          showCallSummary
          overviewTabId="servers"
          infoTitleKey="mcp.whatIsMcp"
          infoDescKey="mcp.mcpDesc"
          emptyIcon="puzzle"
          showEmptyHint={false}
          refreshTrigger={refreshTrigger}
          onLoadingChange={setLoading}
          mobileHeader={
            <div className="flex justify-end">
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="touch-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[hsl(var(--border))] text-sm"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                {t("common.refresh")}
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
