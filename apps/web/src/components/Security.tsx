"use client";

import { CheckCircle } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Security() {
  const { t } = useI18n();

  return (
    <section id="security" className="py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="space-y-4 mb-10">
          <div className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
            <span className="text-primary font-bold text-xl">{")"}</span>
            <span className="text-sm font-medium text-slate-400">{t.security.badge}</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
            {t.security.title}
            <br />
            <span className="gradient-text">{t.security.title2}</span>
          </h2>
          <p className="text-slate-400">{t.security.subtitle}</p>
        </div>

        <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-left max-w-2xl mx-auto mb-10">
          {t.security.items.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <CheckCircle size={18} className="text-primary mt-0.5 flex-shrink-0" />
              <span className="text-slate-300 text-sm leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>

        <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-border-dim text-sm text-slate-400">
          <span className="text-primary">⟨/⟩</span>
          {t.security.openSourceCta} ·
          <a
            href="https://github.com/clawno11/clawno11"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}
