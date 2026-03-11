/**
 * MorePage — hub for secondary features accessible from the "More" tab.
 */
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart3, Database, Puzzle, GitBranch,
  ShieldCheck, ChevronRight,
} from "lucide-react";
import { useTokenAnomalyStore } from "../store/tokenAnomalyStore";
import { TopBar } from "../components/TopBar";

export function MorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { anomaly } = useTokenAnomalyStore();

  const items = [
    {
      path: "/tokens",
      icon: BarChart3,
      label: t("nav.tokens"),
      desc: t("more.tokensDesc"),
      badge: anomaly,
      color: "#8b5cf6",
      bg: "rgba(139,92,246,0.1)",
    },
    {
      path: "/rag",
      icon: Database,
      label: t("nav.rag"),
      desc: t("more.ragDesc"),
      badge: false,
      color: "#06b6d4",
      bg: "rgba(6,182,212,0.1)",
    },
    {
      path: "/mcp",
      icon: Puzzle,
      label: t("nav.mcp"),
      desc: t("more.mcpDesc"),
      badge: false,
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.1)",
    },
    {
      path: "/router",
      icon: GitBranch,
      label: t("nav.router"),
      desc: t("more.routerDesc"),
      badge: false,
      color: "#10b981",
      bg: "rgba(16,185,129,0.1)",
    },
    {
      path: "/security",
      icon: ShieldCheck,
      label: t("nav.security"),
      desc: t("more.securityDesc"),
      badge: false,
      color: "#ef4444",
      bg: "rgba(239,68,68,0.1)",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("nav.more")} subtitle={t("more.subtitle")} />

      <div className="flex-1 scrollable p-4 pb-8">
        {/* ── 功能列表 ── */}
        <div className="space-y-2 mb-5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="touch-btn w-full flex items-center gap-3.5 p-4 rounded-2xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-left active:scale-[0.98] transition-transform"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: item.bg, border: `1px solid ${item.color}22` }}
                >
                  <Icon size={20} style={{ color: item.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{item.label}</p>
                    {item.badge && (
                      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{item.desc}</p>
                </div>
                <ChevronRight size={18} className="flex-shrink-0 text-[hsl(var(--muted-foreground))]/50" />
              </button>
            );
          })}
        </div>

      </div>
    </div>
  );
}
