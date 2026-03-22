"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Rocket, MessageSquare, Shield, GitBranch, MessageCircle, Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/context";

const TAB_ICONS: LucideIcon[] = [
  Rocket, MessageSquare, Shield, GitBranch, MessageCircle, Smartphone,
];

const INTERVAL_MS = 5000;

export function ProductShowcase() {
  const { t } = useI18n();
  const items = t.showcase.items;
  const [active, setActive] = useState(0);
  const [imgError, setImgError] = useState<Record<number, boolean>>({});
  const paused = useRef(false);

  const next = useCallback(
    () => setActive((i) => (i + 1) % items.length),
    [items.length],
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (!paused.current) next();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [next]);

  return (
    <section
      className="relative py-16 px-4"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="max-w-5xl mx-auto flex flex-col items-center">
        {/* Tab bar */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-8 max-w-full scrollbar-hide">
          {items.map((item, i) => {
            const Icon = TAB_ICONS[i] ?? Rocket;
            const isActive = i === active;
            return (
              <button
                key={i}
                onClick={() => { setActive(i); setImgError((e) => ({ ...e, [i]: false })); }}
                className={`
                  flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium
                  whitespace-nowrap transition-all duration-200 border
                  ${isActive
                    ? "bg-primary/15 text-primary border-primary/30 shadow-lg shadow-primary/5"
                    : "bg-white/[0.03] text-slate-400 border-white/8 hover:text-white hover:border-white/15"
                  }
                `}
              >
                <Icon size={14} />
                {item.tab}
              </button>
            );
          })}
        </div>

        {/* Screenshot window */}
        <div className="relative w-full">
          <div className="absolute inset-0 bg-primary/8 blur-[80px] rounded-3xl pointer-events-none" />
          <div className="relative rounded-2xl border border-border-dim bg-bg-card overflow-hidden shadow-2xl shadow-black/50">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border-dim bg-bg-card2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              <div className="flex-1 mx-4">
                <div className="text-xs text-center text-slate-500 font-medium">
                  ClawNo.11 — {items[active].tab}
                </div>
              </div>
            </div>

            {/* Screenshot area */}
            <div className="relative aspect-[16/10] w-full bg-bg-base">
              {items.map((item, i) => (
                <div
                  key={i}
                  className={`
                    absolute inset-0 transition-all duration-300
                    ${i === active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}
                  `}
                >
                  {imgError[i] ? (
                    <Placeholder icon={TAB_ICONS[i]} label={item.tab} />
                  ) : (
                    <img
                      src={item.screenshot}
                      alt={item.tab}
                      className="w-full h-full object-cover object-top"
                      onError={() => setImgError((e) => ({ ...e, [i]: true }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <p
          key={active}
          className="mt-6 text-sm text-slate-400 animate-fade-in"
        >
          {items[active].desc}
        </p>

        {/* Progress dots */}
        <div className="flex gap-2 mt-4">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`
                h-1.5 rounded-full transition-all duration-300
                ${i === active ? "w-6 bg-primary" : "w-1.5 bg-white/15 hover:bg-white/25"}
              `}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Placeholder({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="screenshot-placeholder w-full h-full flex-col gap-3">
      <Icon size={40} className="text-primary/30" />
      <span className="text-primary/40 text-sm font-medium">{label}</span>
      <span className="text-[11px] text-slate-600">截图待上传 · 1920×1080 WebP</span>
    </div>
  );
}
