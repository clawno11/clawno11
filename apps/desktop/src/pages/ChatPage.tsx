import { useState, useRef, useEffect } from "react";
import { Send, Bot, User } from "lucide-react";
import type { ChatMessage } from "@clawno/openclaw-client";

interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
}

export function ChatPage() {
  const [gatewayUrl, setGatewayUrl] = useState("http://localhost:18789");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: UIMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);

    try {
      const { OpenClawClient } = await import("@clawno/openclaw-client");
      const client = new OpenClawClient({ baseUrl: gatewayUrl });
      await client.streamChat(
        { messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })), stream: true },
        (chunk) => {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          );
        },
        () => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
          );
          setIsStreaming(false);
        },
        (err) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `错误：${err.message}`, streaming: false }
                : m,
            ),
          );
          setIsStreaming(false);
        },
      );
    } catch (err) {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Bot size={20} className="text-primary" />
        <span className="font-semibold">AI 对话</span>
        <input
          value={gatewayUrl}
          onChange={(e) => setGatewayUrl(e.target.value)}
          className="ml-auto text-xs px-2 py-1 rounded border border-border bg-muted text-muted-foreground w-52 focus:outline-none"
          placeholder="Gateway URL"
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot size={48} className="mb-3 opacity-30" />
            <p>发送消息开始对话</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === "user" ? "bg-primary" : "bg-secondary"
              }`}
            >
              {msg.role === "user" ? (
                <User size={16} className="text-primary-foreground" />
              ) : (
                <Bot size={16} className="text-secondary-foreground" />
              )}
            </div>
            <div
              className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-secondary text-secondary-foreground rounded-tl-sm"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="输入消息，Enter 发送..."
            disabled={isStreaming}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || isStreaming}
            className="w-10 h-10 flex items-center justify-center bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
