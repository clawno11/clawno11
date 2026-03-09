import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface TopBarProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}

export function TopBar({ title, subtitle, back, right }: TopBarProps) {
  const navigate = useNavigate();

  return (
    <div
      className="top-bar flex items-center gap-2 py-3 flex-shrink-0"
      style={{
        borderBottom: "1px solid rgba(6,182,212,0.1)",
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        paddingLeft: "max(env(safe-area-inset-left, 0px), 1rem)",
        paddingRight: "max(env(safe-area-inset-right, 0px), 1rem)",
      }}
    >
      {back && (
        <button
          onClick={() => navigate(-1)}
          className="touch-btn p-1.5 -ml-1.5 rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <ChevronLeft size={22} />
        </button>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="font-semibold text-base truncate leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate leading-tight mt-0.5">
            {subtitle}
          </p>
        )}
      </div>

      {right && <div className="flex-shrink-0 flex items-center gap-1">{right}</div>}
    </div>
  );
}
