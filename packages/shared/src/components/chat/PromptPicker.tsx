import { useState } from "react";
import { Plus, X, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getAllPrompts, saveCustomPrompt, deleteCustomPrompt, type PromptTemplate,
} from "../../promptLibrary";

interface PromptPickerProps {
  onSelect: (content: string) => void;
  compact?: boolean;
}

export function PromptPicker({ onSelect, compact }: PromptPickerProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [prompts, setPrompts] = useState<PromptTemplate[]>(() => getAllPrompts());
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [content, setContent] = useState("");

  const handleAdd = () => {
    if (!label.trim() || !content.trim() || content.length > 4000) return;
    try {
      saveCustomPrompt({ emoji, label, content });
      setPrompts(getAllPrompts());
      setAdding(false);
      setLabel(""); setContent(""); setEmoji("✨");
    } catch { /* swallowed */ }
  };

  const handleDelete = (id: string) => {
    deleteCustomPrompt(id);
    setPrompts(getAllPrompts());
  };

  const iconSize = compact ? 10 : 11;
  const toggleSize = compact ? 9 : 10;
  const btnCls = compact
    ? "touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors"
    : "flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors";
  const activeCls = "border-primary/50 text-primary bg-primary/8";
  const inactiveCls = compact
    ? "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
    : "border-border text-muted-foreground";

  return (
    <>
      <button onClick={() => setShow((v) => !v)}
        className={`${btnCls} ${compact ? "ml-auto" : "ml-auto"} ${show ? activeCls : inactiveCls}`}>
        <Sparkles size={iconSize} />{t("prompts.toggle")}
        {show ? <ChevronUp size={toggleSize} /> : <ChevronDown size={toggleSize} />}
      </button>

      {show && (
        <div className={`mb-2 ${compact ? "rounded-2xl" : "rounded-xl"} border border-border bg-muted/20 p-2 space-y-2 col-span-full w-full`}>
          <div className="flex flex-wrap gap-1.5">
            {prompts.map((p) => (
              <div key={p.id} className="group relative">
                <button onClick={() => { onSelect(p.content); setShow(false); }}
                  className={`flex items-center gap-1 px-2.5 ${compact ? "py-1.5 rounded-xl" : "py-1 rounded-lg"} border border-border bg-card text-xs hover:bg-primary/8 hover:border-primary/40 hover:text-primary transition-colors`}>
                  <span>{p.emoji}</span><span>{p.label}</span>
                </button>
                {p.type === "custom" && (
                  <button onClick={() => handleDelete(p.id)}
                    className={`absolute -top-1.5 -right-1.5 ${compact ? "w-4 h-4" : "w-3.5 h-3.5"} rounded-full bg-red-500 text-white flex items-center justify-center ${compact ? "" : "hidden group-hover:flex"}`}>
                    <X size={8} />
                  </button>
                )}
              </div>
            ))}
            {compact ? (
              <button onClick={() => {
                const l = prompt(t("prompts.labelPlaceholder"));
                const c = prompt(t("prompts.contentPlaceholder"));
                if (l && c) { try { saveCustomPrompt({ emoji: "✨", label: l, content: c }); setPrompts(getAllPrompts()); } catch { /* ignore */ } }
              }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground`}>
                <Plus size={10} /> {t("prompts.add")}
              </button>
            ) : (
              <button onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                <Plus size={11} /> {t("prompts.add")}
              </button>
            )}
          </div>

          {!compact && adding && (
            <div className="p-2.5 rounded-lg border border-border bg-card space-y-2">
              <div className="flex gap-2">
                <input value={emoji} onChange={(e) => setEmoji(e.target.value)}
                  className="w-12 px-2 py-1 rounded border border-border text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary" maxLength={2} />
                <input value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("prompts.labelPlaceholder")}
                  className="flex-1 px-2 py-1 rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)}
                placeholder={t("prompts.contentPlaceholder")} rows={3}
                className="w-full px-2 py-1.5 rounded border border-border text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setAdding(false); setLabel(""); setContent(""); }}
                  className="px-2.5 py-1 rounded border border-border text-xs hover:bg-muted/50 transition-colors">
                  {t("common.cancel")}
                </button>
                <button disabled={!label.trim() || !content.trim() || content.length > 4000} onClick={handleAdd}
                  className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {t("common.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
