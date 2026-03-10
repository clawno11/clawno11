"use client";

import {
  Rocket, Shield, Smartphone, Brain, GitBranch, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/context";

const ICON_MAP: Record<string, LucideIcon> = {
  Rocket, Shield, Smartphone, Brain, GitBranch, MessageSquare,
};

export function Features() {
  const { t } = useI18n();

  return (
    <section id="features" className="py-20 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Section header — ") What People Say" style from openclaw */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="text-primary font-bold text-xl">{")"}</span>
            {t.features.title}
          </h2>
          <a
            href="https://github.com/clawno11/clawno11"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            GitHub →
          </a>
        </div>

        {/* 3-column card grid — styled like openclaw testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.items.map((item, i) => {
            const Icon = ICON_MAP[item.icon] ?? Rocket;
            return (
              <FeatureCard key={i} item={item} Icon={Icon} />
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface CardItem {
  icon: string;
  title: string;
  desc: string;
  badge: string;
}

function FeatureCard({ item, Icon }: { item: CardItem; Icon: LucideIcon }) {
  return (
    <div className="group flex flex-col justify-between p-5 rounded-2xl border border-white/8 bg-white/[0.03] hover:border-primary/25 hover:bg-primary/[0.03] transition-all duration-200 min-h-[160px]">
      {/* Quote-style body text — mirrors openclaw's testimonial text */}
      <p className="text-sm text-slate-300 leading-relaxed flex-1">
        "{item.desc}"
      </p>

      {/* Divider */}
      <div className="my-4 border-t border-white/6" />

      {/* Author row — icon + name + badge, mirrors openclaw's @username row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Icon size={14} className="text-primary" />
          </div>
          <span className="text-sm font-semibold text-white">{item.title}</span>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15 font-medium">
          {item.badge}
        </span>
      </div>
    </div>
  );
}
