import React from "react";
import type { Ref } from "react";
import { Bot, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMsgTime } from "../../chat/helpers";
import type { UIMessage } from "../../chat/types";

interface MessageListProps {
  messages: UIMessage[];
  isOnline?: boolean;
  gatewayUrl?: string;
  compact?: boolean;
  bottomRef?: Ref<HTMLDivElement>;
}

export function MessageList({ messages, isOnline, gatewayUrl, compact, bottomRef }: MessageListProps) {
  const { t } = useTranslation();

  const dateOptions: Intl.DateTimeFormatOptions = compact
    ? { month: "long", day: "numeric", weekday: "short" }
    : { year: "numeric", month: "long", day: "numeric", weekday: "short" };

  const assistantBubbleStyle: React.CSSProperties = compact
    ? { background: "hsl(var(--card))", color: "hsl(var(--foreground))", borderTopLeftRadius: 4, border: "1px solid rgba(6,182,212,0.12)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }
    : { background: "white", color: "hsl(var(--foreground))", borderTopLeftRadius: 4, border: "1px solid rgba(6,182,212,0.12)", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" };

  const userBubbleStyle: React.CSSProperties = compact
    ? { background: "hsl(var(--primary))", color: "white", borderTopRightRadius: 4 }
    : { background: "hsl(var(--primary))", color: "white", borderTopRightRadius: 4, boxShadow: "0 2px 10px rgba(6,182,212,0.3)" };

  return (
    <div className={`flex-1 overflow-y-auto ${compact ? "p-3 space-y-3" : "p-4 space-y-4"}`}>
      {messages.length === 0 && (
        <div className={`flex flex-col items-center justify-center h-full ${compact ? "text-[hsl(var(--muted-foreground))]" : "text-muted-foreground"}`}>
          <div className={`${compact ? "w-12 h-12" : "w-14 h-14"} rounded-2xl flex items-center justify-center mb-3`}
            style={{ background: "rgba(6,182,212,0.06)", border: "1px dashed rgba(6,182,212,0.2)" }}>
            <Bot size={compact ? 22 : 24} style={{ color: "rgba(6,182,212,0.45)" }} />
          </div>
          <p className="text-sm">{t("chat.emptyHint")}</p>
          {!compact && isOnline && gatewayUrl && (
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
              {t("chat.connectedTo", { url: gatewayUrl })}
            </p>
          )}
        </div>
      )}
      {messages.map((msg, idx) => {
        const prevTs = idx > 0 ? messages[idx - 1]?.createdAt : undefined;
        const showDateSep = msg.createdAt && (!prevTs || new Date(prevTs).toDateString() !== new Date(msg.createdAt).toDateString());
        return (
          <React.Fragment key={msg.id}>
            {showDateSep && msg.createdAt && (
              <div className={`flex justify-center ${compact ? "" : "my-2"}`}>
                <span className={`text-[10px] ${compact ? "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/40" : "text-muted-foreground/60 bg-muted/40"} px-3 py-0.5 rounded-full`}>
                  {new Date(msg.createdAt).toLocaleDateString(undefined, dateOptions)}
                </span>
              </div>
            )}
            <div className={`flex ${compact ? "gap-2 bubble-enter" : "gap-3"} ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${compact ? "mt-0.5" : ""}`}
                style={{
                  background: msg.role === "user" ? "hsl(var(--primary))" : "rgba(6,182,212,0.1)",
                  ...(msg.role === "user" && !compact ? { boxShadow: "0 0 8px rgba(6,182,212,0.35)" } : {}),
                }}>
                {msg.role === "user" ? <User size={14} className="text-white" /> : <Bot size={14} style={{ color: "hsl(var(--primary))" }} />}
              </div>
              <div className={`flex flex-col ${compact ? "max-w-[80%]" : "max-w-[72%]"} ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`rounded-2xl ${compact ? "px-3.5" : "px-4"} py-2.5 text-sm leading-relaxed`}
                  style={msg.role === "user" ? userBubbleStyle : assistantBubbleStyle}>
                  {msg.streaming && !msg.content ? (
                    <span className="flex items-center gap-1 py-0.5">
                      {[0, 150, 300].map((delay) => (
                        <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                          style={{ background: "hsl(var(--primary))", opacity: 0.6, animationDelay: `${delay}ms` }} />
                      ))}
                    </span>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.streaming && (
                        <span className={`inline-block ${compact ? "w-0.5" : "w-1"} h-4 ml-0.5 rounded-sm animate-pulse`}
                          style={{ background: "hsl(var(--primary))", opacity: 0.7 }} />
                      )}
                    </>
                  )}
                </div>
                {msg.createdAt && !msg.streaming && (
                  <span className={`text-[10px] ${compact ? "text-[hsl(var(--muted-foreground))]/60 mt-0.5" : "text-muted-foreground/50 mt-1"} px-1`}>
                    {formatMsgTime(msg.createdAt)}
                  </span>
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
