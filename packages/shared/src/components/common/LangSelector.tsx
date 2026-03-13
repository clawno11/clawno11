import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

const STORAGE_KEY = "clawno-lang";

export interface LangOption {
  code: string;
  label: string;
}

export interface LangSelectorProps {
  langs?: LangOption[];
  /** When true, language changes apply on click. When false, a save button is shown. */
  immediate?: boolean;
  className?: string;
}

const DEFAULT_LANGS: LangOption[] = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
];

export function LangSelector({
  langs = DEFAULT_LANGS,
  immediate = true,
  className,
}: LangSelectorProps) {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? i18n.language,
  );
  const [saved, setSaved] = useState(false);

  const apply = (code: string) => {
    localStorage.setItem(STORAGE_KEY, code);
    i18n.changeLanguage(code);
  };

  const handleSelect = (code: string) => {
    setLang(code);
    if (immediate) apply(code);
  };

  const handleSave = () => {
    apply(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={className}>
      <div className="flex gap-2">
        {langs.map((l) => (
          <button
            key={l.code}
            onClick={() => handleSelect(l.code)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm border transition-colors ${
              lang === l.code
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border hover:bg-muted/60"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {!immediate && (
        <button
          onClick={handleSave}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
        >
          {saved ? (
            <>
              <Check size={13} /> {t("common.saved")}
            </>
          ) : (
            t("common.save")
          )}
        </button>
      )}
    </div>
  );
}
