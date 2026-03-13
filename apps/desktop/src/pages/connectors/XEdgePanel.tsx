import { useState } from "react";
import {
  CheckCircle2, ExternalLink, Info,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstanceStore } from "../../store/instances";
import { DEFAULT_PORT, GuideSteps } from "./helpers";

export function XEdgePanel() {
  const { t } = useTranslation();
  const { instances } = useInstanceStore();
  const [open, setOpen] = useState(false);

  const activePort = instances.find((i) => i.health === "online")?.port ?? DEFAULT_PORT;

  return (
    <div className="rounded-xl border-2 border-cyan-500/30 bg-card overflow-hidden"
      style={{ boxShadow: "0 0 0 1px rgba(6,182,212,0.1), 0 2px 12px rgba(6,182,212,0.06)" }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border relative">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center flex-shrink-0">
          <span className="text-base font-black" style={{ color: "#06b6d4", fontFamily: "monospace" }}>X</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">{t("connectors.xedge.title")}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t("connectors.xedge.subtitle")}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted/60 transition-colors"
        >
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
      </div>

      {open && (
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{t("connectors.xedge.desc")}</p>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-cyan-700 bg-cyan-500/8 border border-cyan-500/20">
            <CheckCircle2 size={12} />
            {t("connectors.xedge.free")}
          </div>

          <GuideSteps steps={[
            t("connectors.xedge.step1"),
            t("connectors.xedge.step2"),
            t("connectors.xedge.step3"),
            t("connectors.xedge.step4", { port: activePort }),
          ]} />

          <div className="flex items-start gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-xs text-cyan-800">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>{t("connectors.xedge.tip")}</span>
          </div>

          <a
            href="https://xedge.cc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}
          >
            <ExternalLink size={13} /> {t("connectors.xedge.download")}
          </a>
        </div>
      )}
    </div>
  );
}
