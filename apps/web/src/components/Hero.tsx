"use client";

import { Apple, Monitor, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/context";

/** Styled claw icon — mirrors openclaw's centered mascot placement */
function ClawIcon() {
  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto mb-6">
      {/* Ambient glow */}
      <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl scale-150" />
      {/* Outer ring */}
      <div className="absolute inset-0 rounded-[28px] border border-primary/20" />
      {/* Icon body */}
      <div
        className="relative w-24 h-24 rounded-[24px] bg-gradient-to-br from-primary via-primary to-cyan-300 flex items-center justify-center"
        style={{ boxShadow: "0 0 48px rgba(6,182,212,0.5), 0 0 12px rgba(6,182,212,0.3)" }}
      >
        {/* Claw SVG mark */}
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12">
          <path d="M24 8C24 8 14 14 14 24C14 30.627 18.373 36 24 36C29.627 36 34 30.627 34 24C34 14 24 8 24 8Z" fill="white" fillOpacity="0.9"/>
          <path d="M18 26C18 26 16 32 20 36" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M30 26C30 26 32 32 28 36" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          <circle cx="24" cy="22" r="3" fill="rgba(6,182,212,0.8)"/>
        </svg>
      </div>
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

        {/* Main title — matches openclaw's giant logo text */}
        <h1 className="text-[80px] sm:text-[100px] lg:text-[120px] font-black leading-none tracking-tight text-white mb-3">
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
