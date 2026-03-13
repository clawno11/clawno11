import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, Loader, Circle, Clock, Wrench } from "lucide-react";
import type { StepState } from "./types";
import { fmtSec } from "./types";
import { translateDetail, translateFix } from "./translations";

export function StepRow({ step, isActive }: { step: StepState; isActive: boolean }) {
  const { t } = useTranslation();
  const pct = isActive
    ? Math.min(99, (step.elapsedSec / step.estimatedSec) * 100)
    : step.status === "done" || step.status === "error"
    ? 100
    : 0;

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        {/* icon */}
        <div className="w-5 flex-shrink-0 mt-0.5">
          {step.status === "done"    && <CheckCircle size={18} className="text-green-500" />}
          {step.status === "error"   && <XCircle     size={18} className="text-red-500" />}
          {step.status === "running" && <Loader      size={18} className="text-primary animate-spin" />}
          {step.status === "pending" && <Circle      size={18} className="text-muted-foreground/30" />}
        </div>

        {/* label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-sm leading-tight ${
              step.status === "pending" ? "text-muted-foreground/50" :
              step.status === "error"   ? "text-red-600 font-medium" :
              step.status === "running" ? "text-foreground font-semibold" :
                                          "text-foreground"
            }`}>
              {step.label}
            </p>

            {/* time badge */}
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={11} />
              {step.status === "running" ? (
                <span className="tabular-nums">{fmtSec(step.elapsedSec)} / ~{fmtSec(step.estimatedSec)}</span>
              ) : step.status === "done" ? (
                <span className="text-green-600">{fmtSec(step.elapsedSec)}</span>
              ) : step.status === "error" ? (
                <span className="text-red-500">{fmtSec(step.elapsedSec)}</span>
              ) : (
                <span>~{fmtSec(step.estimatedSec)}</span>
              )}
            </span>
          </div>

          {/* hint when pending */}
          {step.status === "pending" && step.hint && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{step.hint}</p>
          )}

          {/* detail when done/error */}
          {step.detail && step.status !== "pending" && (
            <p className={`text-xs mt-0.5 ${step.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
              {translateDetail(step.detail)}
            </p>
          )}

          {/* auto-fixes badge */}
          {step.status === "done" && step.fixes_applied.length > 0 && (
            <div className="mt-1.5 flex items-start gap-1">
              <Wrench size={11} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-600">
                {t("deploy.autoFixed")}{step.fixes_applied.map(translateFix).join(", ")}
              </p>
            </div>
          )}

          {/* progress bar */}
          {(step.status === "running" || step.status === "done" || step.status === "error") && (
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                  step.status === "done"  ? "bg-green-500" :
                  step.status === "error" ? "bg-red-500"   : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
