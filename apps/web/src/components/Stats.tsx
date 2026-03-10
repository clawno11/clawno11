"use client";

import { useI18n } from "@/i18n/context";

export function Stats() {
  const { t } = useI18n();

  return (
    <section className="relative py-12 border-y border-border-dim bg-bg-card/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 md:divide-x md:divide-border-dim">
          {t.stats.map((s, i) => (
            <div key={i} className="text-center px-6 py-2">
              <div className="text-3xl md:text-4xl font-black text-white">{s.value}</div>
              <div className="text-sm text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
