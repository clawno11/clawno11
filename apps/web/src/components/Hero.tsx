"use client";

import { Apple, Monitor, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Hero() {
  const { t } = useI18n();
  const releases = "https://github.com/clawno11/clawno11/releases";

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Radial glow behind content */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full bg-indigo-500/5 blur-[100px]" />

        {/* Grid lines */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: text */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {t.hero.badge}
            </div>

            {/* Headline */}
            <div>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-none tracking-tight text-white">
                {t.hero.title1}
                <br />
                <span className="gradient-text">{t.hero.title2}</span>
              </h1>
            </div>

            {/* Subtitle */}
            <p className="text-lg text-slate-400 leading-relaxed max-w-lg">
              {t.hero.subtitle}
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <a
                href={releases}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-primary hover:bg-primary-dark text-white font-semibold text-sm transition-all glow-cyan-sm hover:glow-cyan"
              >
                <Apple size={16} />
                {t.hero.ctaMac}
              </a>
              <a
                href={releases}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-border-dim hover:border-primary/40 text-white font-semibold text-sm transition-all"
              >
                <Monitor size={16} />
                {t.hero.ctaWindows}
              </a>
              <a
                href="https://github.com/clawno11/clawno11"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-5 py-3 rounded-xl text-slate-400 hover:text-white text-sm font-semibold transition-colors"
              >
                {t.hero.ctaGithub}
                <ArrowRight size={14} />
              </a>
            </div>

            {/* Trust line */}
            <p className="text-xs text-slate-600">
              Zero telemetry · No account required · Data stays local
            </p>
          </div>

          {/* Right: screenshot mockup */}
          <div className="relative">
            {/* Glow behind mockup */}
            <div className="absolute inset-0 bg-primary/10 blur-[60px] rounded-3xl" />

            {/* Desktop mockup */}
            <div className="relative rounded-2xl overflow-hidden border border-border-dim bg-bg-card shadow-2xl shadow-black/50 animate-float">
              {/* Fake window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border-dim bg-bg-card2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                <div className="flex-1 mx-4">
                  <div className="w-48 h-4 rounded bg-white/5 mx-auto" />
                </div>
              </div>

              {/* Screenshot area */}
              <div className="screenshot-placeholder aspect-[16/10] w-full text-center flex-col gap-2">
                <div className="text-primary/50 text-3xl mb-2">🖥️</div>
                <div>{t.hero.screenshotHint}</div>
                <div className="text-[11px] opacity-60 mt-1">推荐尺寸: 1280×800px</div>
              </div>
            </div>

            {/* Mobile mockup badge */}
            <div className="absolute -bottom-4 -right-4 w-32 h-56 rounded-3xl border-2 border-border-dim bg-bg-card shadow-xl overflow-hidden">
              <div className="flex items-center justify-center h-full screenshot-placeholder rounded-3xl">
                <div className="text-center">
                  <div className="text-2xl mb-1">📱</div>
                  <div className="text-[10px]">Mobile App</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
