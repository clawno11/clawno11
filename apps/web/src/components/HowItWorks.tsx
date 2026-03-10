"use client";

import { useI18n } from "@/i18n/context";

export function HowItWorks() {
  const { t } = useI18n();

  return (
    <section id="how" className="py-24 bg-bg-card/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16 space-y-4">
          <div className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium">
            How it Works
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white">{t.howItWorks.title}</h2>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line (desktop) */}
          <div className="hidden lg:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {t.howItWorks.steps.map((step, i) => (
              <div key={i} className="relative text-center group">
                {/* Step number bubble */}
                <div className="relative inline-flex w-16 h-16 rounded-2xl items-center justify-center mb-6 bg-bg-card border border-border-dim group-hover:border-primary/40 transition-colors">
                  <span className="text-2xl font-black gradient-text">{step.num}</span>
                  {/* Outer ring on hover */}
                  <div className="absolute inset-0 rounded-2xl border border-primary/0 group-hover:border-primary/30 transition-colors scale-110" />
                </div>

                <h3 className="text-lg font-bold text-white mb-3">{step.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
