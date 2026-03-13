import type { ReactNode, RefObject } from "react";
import {
  Send, GitBranch, Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PromptPicker } from "./PromptPicker";

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  compact?: boolean;
  routingEnabled: boolean;
  onToggleRouting: () => void;
  onPromptSelect: (content: string) => void;
  modelPicker?: ReactNode;
  voiceButton?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
}

export function ChatInput({
  input, onInputChange, onSend, onStop, isStreaming, compact,
  routingEnabled, onToggleRouting, onPromptSelect,
  modelPicker, voiceButton, textareaRef, placeholder,
}: ChatInputProps) {
  const { t } = useTranslation();

  const toggleCls = compact
    ? "touch-btn flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors"
    : "flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-colors";

  const iconSize = compact ? 10 : 11;

  const routeCls = routingEnabled
    ? compact
      ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/8"
      : "border-primary/50 text-primary bg-primary/8"
    : compact
      ? "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
      : "border-border text-muted-foreground";

  return (
    <div
      className={compact ? "chat-input-bar px-3 pt-2 flex-shrink-0" : "px-4 py-3 border-t flex-shrink-0"}
      style={compact
        ? { borderTop: "1px solid rgba(6,182,212,0.1)", background: "hsl(var(--card))" }
        : { borderColor: "rgba(6,182,212,0.12)" }}>
      <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"} mb-2 flex-wrap`}>
        <button onClick={onToggleRouting} className={`${toggleCls} ${routeCls}`}>
          <GitBranch size={iconSize} />{t("router.switch")}
        </button>
        {compact && modelPicker}
        <PromptPicker onSelect={onPromptSelect} {...(compact !== undefined && { compact })} />
      </div>

      <div className="flex gap-2 items-end">
        {!compact && modelPicker}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder ?? t("chat.placeholder")}
          disabled={isStreaming}
          rows={1}
          className={compact
            ? "flex-1 px-3.5 py-2.5 rounded-2xl text-sm disabled:opacity-50 resize-none"
            : "flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none disabled:opacity-50 resize-none overflow-y-auto"}
          style={compact
            ? { border: "1px solid rgba(6,182,212,0.25)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", lineHeight: "1.5", maxHeight: "120px", overflowY: "auto" }
            : { border: "1px solid rgba(6,182,212,0.25)", background: "white", lineHeight: "1.5", maxHeight: "8rem" }}
          onFocus={!compact ? (e) => { e.currentTarget.style.boxShadow = "0 0 0 2px rgba(6,182,212,0.2)"; } : undefined}
          onBlur={!compact ? (e) => { e.currentTarget.style.boxShadow = "none"; } : undefined}
        />
        {compact && voiceButton}
        {isStreaming ? (
          <button
            onClick={onStop}
            title={compact ? undefined : t("chat.stopStreaming")}
            className={compact
              ? "touch-btn w-11 h-11 flex items-center justify-center rounded-2xl text-white flex-shrink-0"
              : "w-10 h-10 flex items-center justify-center rounded-xl text-white transition-all flex-shrink-0"}
            style={compact
              ? { background: "#ef4444" }
              : { background: "#ef4444", boxShadow: "0 0 10px rgba(239,68,68,0.35)" }}>
            <Square size={compact ? 14 : 13} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim()}
            className={compact
              ? "touch-btn w-11 h-11 flex items-center justify-center rounded-2xl text-white flex-shrink-0 disabled:opacity-40"
              : "w-10 h-10 flex items-center justify-center rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"}
            style={compact
              ? { background: "hsl(var(--primary))" }
              : { background: "hsl(var(--primary))", boxShadow: input.trim() ? "0 0 12px rgba(6,182,212,0.4)" : "none" }}>
            <Send size={compact ? 16 : 15} />
          </button>
        )}
      </div>
    </div>
  );
}
