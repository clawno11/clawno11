"use client";

import { useState, useEffect } from "react";
import { Github, Menu, X } from "lucide-react";
import { useI18n } from "@/i18n/context";

export function Nav() {
  const { t, toggle } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: t.nav.features, href: "#features" },
    { label: t.nav.howItWorks, href: "#how" },
    { label: t.nav.security, href: "#security" },
    { label: t.nav.download, href: "#download" },
  ];

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-bg-base/90 backdrop-blur-xl border-b border-border-dim shadow-lg shadow-black/20"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2 group">
            <img
              src={`${process.env.NEXT_PUBLIC_BASE ?? ""}/icon.png`}
              alt="ClawNo.11"
              width={32}
              height={32}
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-bold text-white text-lg tracking-tight">
              Claw<span className="text-primary">No.11</span>
            </span>
          </a>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={toggle}
              className="hidden md:block text-xs px-2.5 py-1.5 rounded-md border border-border-dim text-slate-400 hover:text-white hover:border-primary/40 transition-all"
            >
              {t.nav.langSwitch}
            </button>

            {/* GitHub */}
            <a
              href="https://github.com/clawno11/clawno11"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-border-dim text-slate-300 hover:text-white hover:border-primary/40 transition-all"
            >
              <Github size={14} />
              {t.nav.github}
            </a>

            {/* Download CTA */}
            <a
              href="#download"
              className="text-sm px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-white font-semibold transition-colors glow-cyan-sm"
            >
              {t.nav.download}
            </a>

            {/* Mobile hamburger */}
            <button
              className="md:hidden text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden py-4 border-t border-border-dim space-y-3">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm text-slate-400 hover:text-white transition-colors py-1"
              >
                {l.label}
              </a>
            ))}
            <button
              onClick={() => { toggle(); setMobileOpen(false); }}
              className="block text-sm text-slate-400 hover:text-white transition-colors py-1"
            >
              {t.nav.langSwitch}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
