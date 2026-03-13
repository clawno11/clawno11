import {
  CheckCircle2,
  AlertTriangle,
  ShieldX,
  HelpCircle,
} from "lucide-react";

export interface SecurityCheck {
  id: string;
  label: string;
  status: "ok" | "notice" | "warn" | "danger" | "unknown";
  detail: string;
}

export interface SecurityReport {
  score: number;
  checks: SecurityCheck[];
}

export interface PortConnection {
  local_addr: string;
  remote_addr: string;
  state: string;
  pid: string;
  is_local: boolean;
  is_listening: boolean;
}

export interface ToolPermissions {
  exec_mode: "deny" | "ask" | "allow";
  allowlist: string[];
}

export interface AllowedIpEntry {
  ip: string;
  label: string;
  port: number;
  active: boolean;
}

export interface FixAction {
  label: string;
  run?: () => Promise<void>;
  href?: string;
  secondary?: { label: string; run: () => Promise<void> };
}

// Weights mirror the Rust `calculate_score` weight table (must sum to 100).
export const CHECK_WEIGHTS: Record<string, number> = {
  network_access: 40,
  im_connector:   20,
  port_exposure:  15,
  node_version:   10,
  pm2_status:     10,
  offline_mode:    5,
};

/** Points a check contributes to the 0-100 score — mirrors Rust logic exactly. */
export function checkContrib(check: SecurityCheck): number {
  const w = CHECK_WEIGHTS[check.id] ?? 0;
  switch (check.status) {
    case "ok":      return w;
    case "notice":  return Math.round(w * 0.85); // home LAN subnet — local devices only
    case "warn":    return check.id === "network_access" ? Math.round(w * 0.75) : Math.round(w * 0.6);
    case "unknown": return Math.round(w * 0.5);
    default:        return 0;
  }
}

/** Human-readable grade label for a score. */
export function scoreGrade(score: number, t: (k: string) => string): string {
  if (score >= 90) return t("security.gradeExcellent");
  if (score >= 75) return t("security.gradeGood");
  if (score >= 60) return t("security.gradeFair");
  return t("security.gradeNeedsWork");
}

export function StatusIcon({ status }: { status: SecurityCheck["status"] }) {
  if (status === "ok")      return <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />;
  if (status === "notice")  return <CheckCircle2 size={16} className="text-blue-400 flex-shrink-0" />;
  if (status === "warn")    return <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />;
  if (status === "danger")  return <ShieldX size={16} className="text-red-500 flex-shrink-0" />;
  return <HelpCircle size={16} className="text-muted-foreground flex-shrink-0" />;
}
