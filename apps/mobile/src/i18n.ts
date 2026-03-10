import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const savedLang = localStorage.getItem("clawno-lang");
const browserLang = navigator.language.startsWith("zh") ? "zh" : "en";
const defaultLang = savedLang ?? browserLang;

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: defaultLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
