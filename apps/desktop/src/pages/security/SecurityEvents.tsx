import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, ChevronDown, ChevronUp } from "lucide-react";
import { type SecurityEvent } from "@clawno/shared/securityEventStore";

interface SecurityEventsPanelProps {
  events: SecurityEvent[];
  onClear: () => Promise<void>;
}

export function SecurityEventsPanel({ events, onClear }: SecurityEventsPanelProps) {
  const { t } = useTranslation();
  const [showEvents, setShowEvents] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try { await onClear(); } finally { setClearing(false); }
  };

  return (
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
                  onClick={handleClear}
                  disabled={clearing}
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
  );
}
