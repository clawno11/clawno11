"use client";

import { useI18n } from "@/i18n/context";

/** Inline stats strip — sits below Hero CTA area */
export function Stats() {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap justify-center gap-x-10 gap-y-3 py-6 border-y border-white/5">
      {t.stats.map((s, i) => (
        <div key={i} className="text-center">
          <span className="text-xl font-black text-white mr-1.5">{s.value}</span>
          <span className="text-sm text-slate-500">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
