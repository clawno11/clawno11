import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { TrustLevel } from "./types";

const config: Record<TrustLevel, { icon: typeof ShieldCheck; color: string; label: string; labelEn: string }> = {
  official:        { icon: ShieldCheck, color: "text-green-600",  label: "官方（官网）", labelEn: "Official Site" },
  "official-mirror": { icon: Shield,   color: "text-blue-500",   label: "官方镜像",     labelEn: "Official Mirror" },
  community:       { icon: ShieldAlert, color: "text-amber-500", label: "社区",         labelEn: "Community" },
};

interface TrustBadgeProps {
  level: TrustLevel;
  compact?: boolean;
}

export function TrustBadge({ level, compact }: TrustBadgeProps) {
  const c = config[level];
  const Icon = c.icon;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-0.5 ${c.color}`} title={c.label}>
        <Icon size={12} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${c.color}`}>
      <Icon size={12} />
      <span>{c.label}</span>
    </span>
  );
}
