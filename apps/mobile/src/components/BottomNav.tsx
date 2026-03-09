import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, Server, Network, MoreHorizontal, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTokenAnomalyStore } from "../store/tokenAnomalyStore";

interface NavItem {
  path: string;
  icon: React.FC<{ size?: number; className?: string }>;
  label: string;
  badge?: boolean;
}

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { anomaly } = useTokenAnomalyStore();

  const items: NavItem[] = [
    { path: "/chat",      icon: MessageSquare,  label: t("nav.chat") },
    { path: "/",          icon: Server,         label: t("nav.instances") },
    { path: "/connect",   icon: Network,        label: t("nav.connect") },
    { path: "/more",      icon: MoreHorizontal, label: t("nav.more"), badge: anomaly },
    { path: "/settings",  icon: Settings,       label: t("nav.settings") },
  ];

  const currentPath = location.pathname;

  return (
    <nav className="bottom-nav flex items-stretch">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.path ||
          (item.path === "/more" && ["/tokens", "/rag", "/mcp", "/router", "/security"].includes(currentPath));

        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 touch-btn transition-colors relative ${
              isActive
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--muted-foreground))]"
            }`}
          >
            <div className="relative">
              <Icon
                size={22}
                className={isActive ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}
              />
              {item.badge && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
              )}
            </div>
            <span
              className="text-[10px] font-medium leading-none"
              style={{ color: isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
            >
              {item.label}
            </span>
            {isActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full"
                style={{ background: "hsl(var(--primary))" }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
