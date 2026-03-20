"use client";

import { Apple, Monitor, Smartphone, Github, Star } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { downloads } from "@/lib/downloads";

export function Download() {
  const { t } = useI18n();
  const d = t.download;

  return (
    <section id="download" className="py-24 relative overflow-hidden">
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

        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
          {/* Mac Apple Silicon */}
          <a
            href={downloads.mac}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Apple size={22} className="text-primary" />
            </div>
            <div className="font-semibold text-white text-sm">{d.mac}</div>
          </a>

          {/* Mac Intel */}
          <a
            href={downloads.macIntel}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Apple size={22} className="text-primary" />
            </div>
            <div className="font-semibold text-white text-sm">{d.macIntel}</div>
          </a>

          {/* Windows */}
          <a
            href={downloads.windows}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Monitor size={22} className="text-primary" />
            </div>
            <div className="font-semibold text-white text-sm">{d.windows}</div>
          </a>

          {/* iOS */}
          <a
            href={downloads.ios}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Apple size={22} className="text-primary" />
            </div>
            <div className="font-semibold text-white text-sm">{d.ios}</div>
          </a>

          {/* Android */}
          <a
            href={downloads.android}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover hover:glow-cyan-sm transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Smartphone size={22} className="text-primary" />
            </div>
            <div className="font-semibold text-white text-sm">{d.android}</div>
          </a>

          {/* GitHub */}
          <a
            href={downloads.github}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border-dim bg-bg-card card-hover transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-border-dim flex items-center justify-center group-hover:bg-white/10 transition-colors">
              <Github size={22} className="text-slate-300 group-hover:text-white transition-colors" />
            </div>
            <div className="font-semibold text-white text-sm flex items-center gap-1 justify-center">
              <Star size={12} className="text-yellow-400" />
              {d.github}
            </div>
            <div className="text-xs text-slate-500">{d.githubSub}</div>
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={downloads.mac}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-primary hover:bg-primary-dark text-white font-bold text-lg transition-all glow-cyan hover:scale-105"
          >
            {d.mac}
          </a>
          <a
            href={downloads.macIntel}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white/6 hover:bg-white/10 border border-white/10 hover:border-primary/30 text-white font-bold text-lg transition-all hover:scale-105"
          >
            {d.macIntel}
          </a>
          <a
            href={downloads.windows}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white/6 hover:bg-white/10 border border-white/10 hover:border-primary/30 text-white font-bold text-lg transition-all hover:scale-105"
          >
            {d.windows}
          </a>
        </div>
      </div>
    </section>
  );
}
