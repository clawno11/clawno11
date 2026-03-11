"use client";

import { Apple, Monitor, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { AppIcon } from "@/components/AppIcon";

/** App icon — background removed via Canvas, only lobster figure with glow */
function ClawIcon() {
  return (
    <div className="relative flex items-center justify-center w-56 h-56 mx-auto mb-4">
      {/* Soft ambient glow underneath */}
      <div className="absolute inset-0 rounded-full bg-primary/15 blur-3xl scale-125 pointer-events-none" />
      <AppIcon size={216} />
    </div>
  );
}

export function Hero() {
  const { t } = useI18n();
  const releases = "https://github.com/clawno11/clawno11/releases";

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-4 pt-20 pb-24">
      {/* Radial gradient behind content */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-primary/4 blur-[140px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <ClawIcon />

        {/* Main title — cyan gradient, mirrors openclaw's colored logo text */}
        <h1
          className="text-[80px] sm:text-[100px] lg:text-[120px] font-black leading-none tracking-tight mb-3"
          style={{
            background: "linear-gradient(135deg, #06b6d4 0%, #38bdf8 40%, #818cf8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {t.hero.title}
        </h1>

        {/* Uppercase tagline — exact openclaw style */}
        <p className="text-xs sm:text-sm font-semibold uppercase tracking-[0.22em] text-primary mb-6">
          {t.hero.tagline}
        </p>

        {/* Description */}
        <p className="text-base sm:text-lg text-slate-400 leading-relaxed max-w-lg mb-8 whitespace-pre-line">
          {t.hero.subtitle}
        </p>

        {/* CTA buttons — centered row */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          <a
            href={releases}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary hover:bg-primary-dark text-white font-semibold text-sm transition-all"
            style={{ boxShadow: "0 0 20px rgba(6,182,212,0.35)" }}
          >
            <Apple size={15} />
            {t.hero.ctaMac}
          </a>
          <a
            href={releases}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/6 hover:bg-white/10 border border-white/10 hover:border-primary/30 text-white font-semibold text-sm transition-all"
          >
            <Monitor size={15} />
            {t.hero.ctaWindows}
          </a>
          <a
            href="https://github.com/clawno11/clawno11"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-3 text-slate-400 hover:text-white font-semibold text-sm transition-colors"
          >
            {t.hero.ctaGithub}
            <ArrowRight size={13} />
          </a>
        </div>

        {/* Announcement pill — matches openclaw's news badge */}
        <a
          href={releases}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/4 hover:border-primary/30 hover:bg-primary/5 text-slate-400 hover:text-white text-xs transition-all"
        >
          <span className="px-1.5 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold tracking-wide">
            NEW
          </span>
          {t.hero.announcement}
        </a>
      </div>
    </section>
  );
}
