"use client";

import { Rocket, Shield, Smartphone, Brain, GitBranch, MessageSquare, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/context";

const ICON_MAP: Record<string, LucideIcon> = {
  Rocket, Shield, Smartphone, Brain, GitBranch, MessageSquare,
};

export function Features() {
  const { t } = useI18n();

  return (
    <section id="features" className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16 space-y-4">
          <div className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium">
            Core Features
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white">{t.features.title}</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">{t.features.subtitle}</p>
        </div>

        {/* Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {t.features.items.map((item, i) => {
            const Icon = ICON_MAP[item.icon] ?? Rocket;
            return (
              <div
                key={i}
                className="relative group rounded-2xl border border-border-dim bg-bg-card p-6 card-hover"
              >
                {/* Top: icon + badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Icon size={18} className="text-primary" />
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                    {item.badge}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>

                {/* Desc */}
                <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>

                {/* Hover glow */}
                <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-gradient-to-br from-primary/5 to-transparent" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
