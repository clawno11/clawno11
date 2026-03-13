import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import baseEn from "./locales/en.json";
import baseZh from "./locales/zh.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

function deepMerge(base: AnyObj, extra: AnyObj): AnyObj {
  const result: AnyObj = { ...base };
  for (const key of Object.keys(extra)) {
    const bv = result[key];
    const ev = extra[key];
    if (bv && typeof bv === "object" && !Array.isArray(bv) && ev && typeof ev === "object" && !Array.isArray(ev)) {
      result[key] = deepMerge(bv, ev);
    } else {
      result[key] = ev;
    }
  }
  return result;
}

export function createI18n(extra?: {
  en?: Record<string, unknown>;
  zh?: Record<string, unknown>;
}) {
  const savedLang = localStorage.getItem("clawno-lang");
  const browserLang = navigator.language.startsWith("zh") ? "zh" : "en";
  const defaultLang = savedLang ?? browserLang;

  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: deepMerge(baseEn, (extra?.en ?? {}) as AnyObj) },
      zh: { translation: deepMerge(baseZh, (extra?.zh ?? {}) as AnyObj) },
    },
    lng: defaultLang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

  return i18n;
}

export default i18n;
