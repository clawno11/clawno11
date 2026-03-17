"use client";

import { CheckCircle } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Security() {
  const { t } = useI18n();

  return (
    <section id="security" className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: screenshot */}
          <div className="relative order-2 lg:order-1">
            <div className="absolute inset-0 bg-primary/10 blur-[60px] rounded-3xl" />
            <div className="relative rounded-2xl border border-border-dim bg-bg-card overflow-hidden shadow-2xl shadow-black/50">
              {/* Fake window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border-dim bg-bg-card2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                <div className="flex-1 mx-4">
                  <div className="w-36 h-4 rounded bg-white/5 mx-auto" />
                </div>
              </div>
              <div className="screenshot-placeholder aspect-[4/3] w-full flex-col gap-2">
                <div className="text-3xl mb-2">🛡️</div>
                <div>{t.security.screenshotHint}</div>
                <div className="text-[11px] opacity-60 mt-1">推荐尺寸: 800×600px</div>
              </div>
            </div>

            {/* Floating badge: security score */}
            <div className="absolute -top-4 -right-4 rounded-2xl border border-border-dim bg-bg-card px-5 py-3 shadow-xl">
              <div className="text-xs text-slate-500 mb-0.5">Security Score</div>
              <div className="text-2xl font-black text-primary">98<span className="text-sm text-slate-400">/100</span></div>
            </div>
          </div>

          {/* Right: text */}
          <div className="order-1 lg:order-2 space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-lg font-semibold text-white">
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

            {/* Security items */}
            <ul className="space-y-4">
              {t.security.items.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle size={18} className="text-primary mt-0.5 flex-shrink-0" />
                  <span className="text-slate-300 text-sm leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>

            {/* Open source trust */}
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
        </div>
      </div>
    </section>
  );
}
