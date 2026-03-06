import { NavLink } from "react-router-dom";
import { LayoutDashboard, Rocket, MessageSquare, Settings } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "实例" },
  { to: "/deploy", icon: Rocket, label: "部署" },
  { to: "/chat", icon: MessageSquare, label: "聊天" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function Sidebar() {
  return (
    <aside className="w-16 bg-card border-r border-border flex flex-col items-center py-4 gap-2">
      <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-4">
        <span className="text-primary-foreground font-bold text-sm">C</span>
      </div>
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors text-xs ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`
          }
        >
          <Icon size={18} />
          <span className="text-[10px]">{label}</span>
        </NavLink>
      ))}
    </aside>
  );
}
