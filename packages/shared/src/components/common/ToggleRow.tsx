import { useState } from "react";

export interface ToggleRowProps {
  label: string;
  desc: string;
  storageKey: string;
  defaultOn?: boolean;
  className?: string;
}

export function ToggleRow({ label, desc, storageKey, defaultOn = false, className }: ToggleRowProps) {
  const [on, setOn] = useState(() => {
    const v = localStorage.getItem(storageKey);
    if (v === null) return defaultOn;
    return v === "1" || v === "true";
  });

  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem(storageKey, next ? "1" : "0");
  };

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 ${className ?? ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <button
        onClick={toggle}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-card shadow transition-all ${on ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}
