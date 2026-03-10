"use client";

import { Apple, Monitor, Smartphone, Github, Star } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Download() {
  const { t } = useI18n();
  const d = t.download;

  return (
    <section id="download" className="py-24 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="space-y-4 mb-12">
          <div className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
            <span className="text-primary font-bold text-xl">{")"}</span>
            <h2 className="text-4xl md:text-5xl font-black text-white">{d.title}</h2>
          </div>
          <p className="text-slate-400">{d.subtitle}</p>
        </div>

        {/* Download cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Mac */}
          <a
            href={d.releasesLink}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Apple size={22} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-white text-sm">{d.mac}</div>
            </div>
          </a>

          {/* Windows */}
          <a
            href={d.releasesLink}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Monitor size={22} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-white text-sm">{d.windows}</div>
            </div>
          </a>

          {/* Mobile — coming soon */}
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card/50 opacity-60 cursor-not-allowed">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-border-dim flex items-center justify-center">
              <Smartphone size={22} className="text-slate-500" />
            </div>
            <div>
              <div className="font-semibold text-slate-400 text-sm">{d.mobile}</div>
              <div className="text-xs text-slate-600 mt-0.5">{d.mobileSub}</div>
            </div>
          </div>

          {/* GitHub */}
          <a
            href={d.githubLink}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-border-dim flex items-center justify-center group-hover:bg-white/10 transition-colors">
              <Github size={22} className="text-slate-300 group-hover:text-white transition-colors" />
            </div>
            <div>
              <div className="font-semibold text-white text-sm flex items-center gap-1 justify-center">
                <Star size={12} className="text-yellow-400" />
                {d.github}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{d.githubSub}</div>
            </div>
          </a>
        </div>

        {/* Big CTA button */}
        <a
          href={d.releasesLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-primary hover:bg-primary-dark text-white font-bold text-lg transition-all glow-cyan hover:scale-105"
        >
          <Apple size={20} />
          {d.mac}
        </a>
      </div>
    </section>
  );
}
