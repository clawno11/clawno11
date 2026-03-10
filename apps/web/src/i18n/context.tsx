"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { zh } from "./zh";
import { en } from "./en";
import type { I18nDict } from "./zh";

type Lang = "zh" | "en";

interface I18nCtx {
  t: I18nDict;
  lang: Lang;
  toggle: () => void;
}

const I18nContext = createContext<I18nCtx>({
  t: zh,
  lang: "zh",
  toggle: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("zh");

  useEffect(() => {
    const saved = localStorage.getItem("clawno-web-lang") as Lang | null;
    if (saved === "zh" || saved === "en") {
      setLang(saved);
    } else {
      setLang(navigator.language.startsWith("zh") ? "zh" : "en");
    }
  }, []);

  const toggle = () => {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("clawno-web-lang", next);
  };

  return (
    <I18nContext.Provider value={{ t: lang === "zh" ? zh : en, lang, toggle }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
