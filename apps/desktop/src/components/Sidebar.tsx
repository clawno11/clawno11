import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { LayoutDashboard, Rocket, MessageSquare, ShieldCheck, Activity, Plug, BookOpen, Puzzle, GitBranch, Cpu, Settings } from "lucide-react";
import { useTokenAnomalyStore } from "../store/tokenAnomalyStore";

function NavItem({
  to,
  icon: Icon,
  label,
  badge,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <NavLink
      to={to}
      end={to === "/"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl transition-all duration-150"
      style={({ isActive }) => ({
        background: isActive
          ? "hsl(var(--sidebar-active-bg))"
          : hovered
            ? "hsl(var(--sidebar-hover-bg))"
            : "transparent",
        color: isActive || hovered ? "white" : "hsl(var(--sidebar-text))",
        boxShadow: isActive ? "0 0 14px 2px hsl(var(--sidebar-logo-glow) / 0.3)" : "none",
      })}
    >
      {({ isActive }) => (
        <>
          <div className="relative">
            <Icon size={20} strokeWidth={1.7} />
            {badge && (
              <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500 shadow-sm ring-1 ring-background" />
            )}
          </div>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.03em" }}>{label}</span>
          {isActive && <span className="sidebar-active-indicator" />}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const tokenAnomaly = useTokenAnomalyStore((s) => s.anomaly);

  useEffect(() => {
    getVersion().then((v) => setVersion(`v${v}`)).catch(() => setVersion("v0.1"));
  }, []);

  const navItems = [
    { to: "/",           icon: LayoutDashboard, label: t("nav.instances")  },
    { to: "/deploy",     icon: Rocket,          label: t("nav.deploy")     },
    { to: "/chat",       icon: MessageSquare,   label: t("nav.chat")       },
    { to: "/security",   icon: ShieldCheck,     label: t("nav.security")   },
    { to: "/tokens",     icon: Activity,        label: t("nav.tokens"),  badge: tokenAnomaly },
    { to: "/connectors", icon: Plug,            label: t("nav.connectors") },
    { to: "/rag",        icon: BookOpen,        label: t("nav.rag")        },
    { to: "/mcp",        icon: Puzzle,          label: t("nav.mcp")        },
    { to: "/router",       icon: GitBranch, label: t("nav.router")      },
    { to: "/local-models", icon: Cpu,       label: t("nav.localModels") },
    { to: "/settings",     icon: Settings,  label: t("nav.settings")    },
  ];

  return (
    <aside
      className="w-[84px] flex flex-col items-center py-4 gap-1 flex-shrink-0"
      style={{
        background:  "hsl(var(--sidebar-bg))",
        borderRight: "1px solid hsl(var(--sidebar-border))",
      }}
    >
      {/* ── 品牌 Logo ── */}
      <div className="flex flex-col items-center mb-4 gap-1 select-none" title="You × AI = ∞">
        <div
          className="logo-glow w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: "hsl(var(--sidebar-active-bg))" }}
        >
          <span className="text-white" style={{ fontSize: 24, lineHeight: 1 }}>🦞</span>
        </div>
        <span
          className="font-mono font-bold"
          style={{
            fontSize: 9,
            color: "hsl(var(--sidebar-active-bg))",
            letterSpacing: "0.16em",
            opacity: 0.9,
          }}
        >
          NO.11
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 7.5,
            color: "hsl(var(--sidebar-text))",
            letterSpacing: "0.02em",
            opacity: 0.65,
            whiteSpace: "nowrap",
          }}
        >
          You × AI = ∞
        </span>
      </div>

      {/* ── 导航项 ── */}
      <nav className="flex flex-col items-center gap-0.5 w-full px-1.5 overflow-y-auto flex-1">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* ── 底部装饰 ── */}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        <div className="w-8 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }} />
        <span
          className="font-mono"
          style={{ fontSize: 9, color: "hsl(var(--sidebar-text))", opacity: 0.5, letterSpacing: "0.1em" }}
        >
          {version}
        </span>
      </div>
    </aside>
  );
}
