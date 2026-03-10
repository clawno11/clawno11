"use client";

import { Github } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Footer() {
  const { t } = useI18n();
  const f = t.footer;

  return (
    <footer className="border-t border-border-dim bg-bg-card/30 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo + desc */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-black text-sm">
              C
            </div>
            <div>
              <div className="font-bold text-white text-sm">
                Claw<span className="text-primary">No.11</span>
              </div>
              <div className="text-xs text-slate-600">{f.desc}</div>
            </div>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap justify-center gap-4">
            {f.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary transition-colors"
              >
                {link.label === "GitHub" && <Github size={12} />}
                {link.label}
              </a>
            ))}
          </nav>

          {/* Copyright */}
          <p className="text-xs text-slate-600">{f.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
