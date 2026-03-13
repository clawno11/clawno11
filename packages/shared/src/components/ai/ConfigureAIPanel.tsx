import { useState } from "react";
import { Sparkles, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FeaturedCard } from "./FeaturedCard";
import { ProviderRow } from "./ProviderRow";
import { FEATURED_AI, AI_PROVIDERS, FEATURED_IDS } from "./types";

export interface ConfigureAIPanelProps {
  onClose: () => void;
  onConfigure: (provider: string, key: string) => Promise<{ ok: boolean; detail: string }>;
  onOpenUrl?: (url: string) => void;
  configured: string[];
  isConfigured: (id: string) => boolean;
  markConfigured: (id: string) => Promise<void>;
  compact?: boolean;
}

export function ConfigureAIPanel({
  onClose, onConfigure, onOpenUrl,
  configured, isConfigured, markConfigured,
  compact,
}: ConfigureAIPanelProps) {
  const { t } = useTranslation();
  const [showMore, setShowMore] = useState(false);

  // Default handler for opening URLs
  const handleOpenUrl = (url: string) => {
    if (onOpenUrl) {
      onOpenUrl(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div className="mx-4 mb-3 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">

      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
        <Sparkles size={13} className="text-primary" />
        <span className="text-xs font-semibold text-primary">{t("instances.ai.title")}</span>
        {configured.length > 0 && (
          <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5 font-medium">
            {t("instances.configuredCount", { count: configured.length })}
          </span>
        )}
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      </div>

      <div className="px-3 mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {t("instances.ai.quickSetup")}
        </p>
        <div className={compact ? "flex flex-col gap-2" : "grid grid-cols-3 gap-2"}>
          {FEATURED_AI.map((p) => (
            <FeaturedCard
              key={p.id}
              p={p}
              isConfigured={isConfigured(p.id)}
              onConfigure={onConfigure}
              onMarkConfigured={markConfigured}
              onOpenUrl={handleOpenUrl}
            />
          ))}
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
        >
          <ChevronDown size={11} className={`transition-transform ${showMore ? "rotate-180" : ""}`} />
          {showMore ? "收起其他平台" : "更多 AI 平台（Anthropic · OpenAI · DeepSeek · Kimi 等）"}
        </button>

        {showMore && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t("instances.ai.directGroup")}
              </p>
              <div className="space-y-1">
                {AI_PROVIDERS
                  .filter((p) => p.direct && !FEATURED_IDS.includes(p.id))
                  .map((p) => (
                    <ProviderRow
                      key={p.id}
                      p={p}
                      isConfigured={isConfigured(p.id)}
                      onConfigure={onConfigure}
                      onMarkConfigured={markConfigured}
                      onOpenUrl={handleOpenUrl}
                    />
                  ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t("instances.ai.relayGroup")}
              </p>
              <div className="space-y-1">
                {AI_PROVIDERS
                  .filter((p) => !p.direct && !FEATURED_IDS.includes(p.id))
                  .map((p) => (
                    <ProviderRow
                      key={p.id}
                      p={p}
                      isConfigured={isConfigured(p.id)}
                      onConfigure={onConfigure}
                      onMarkConfigured={markConfigured}
                      onOpenUrl={handleOpenUrl}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
