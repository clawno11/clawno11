import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useState, useRef, useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Mic, Send, Plus } from "lucide-react-native";
import Markdown from "react-native-markdown-display";
import { useChatStore } from "../../store/chat";
import type { UIMessage } from "../../store/chat";

export default function ChatScreen() {
  const {
    sessions,
    activeSessionId,
    gatewayUrl,
    apiKey,
    createSession,
    addMessage,
    updateMessage,
    getActiveSession,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Auto-create a session if none exists
  useEffect(() => {
    if (sessions.length === 0) createSession();
  }, []);

  const session = getActiveSession();

  const send = async () => {
    if (!input.trim() || isStreaming || !session) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: UIMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: Date.now(),
    };

    addMessage(session.id, userMsg);
    addMessage(session.id, assistantMsg);
    setInput("");
    setIsStreaming(true);

    try {
      const { OpenClawClient } = await import("@clawno/openclaw-client");
      const client = new OpenClawClient({
        baseUrl: gatewayUrl,
        apiKey: apiKey || undefined,
      });

      const history = [...session.messages, userMsg].map(({ role, content }) => ({
        role,
        content,
      }));

      await client.streamChat(
        { messages: history, stream: true },
        (chunk) => {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          updateMessage(session.id, assistantId, {
            content: (session.messages.find((m) => m.id === assistantId)?.content ?? "") + delta,
          });
          listRef.current?.scrollToEnd({ animated: false });
        },
        () => {
          updateMessage(session.id, assistantId, { streaming: false });
          setIsStreaming(false);
        },
        (err) => {
          updateMessage(session.id, assistantId, {
            content: `错误：${err.message}`,
            streaming: false,
          });
          setIsStreaming(false);
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      updateMessage(session.id, assistantId, {
        content: `错误：${msg}`,
        streaming: false,
      });
      setIsStreaming(false);
    }
  };

  const renderMessage = ({ item }: { item: UIMessage }) => {
    const isUser = item.role === "user";
    return (
      <View className={`px-4 mb-3 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && (
          <Text className="text-xs text-gray-400 mb-1 ml-1">🦞 Clawno</Text>
        )}
        <View
          style={{
            maxWidth: "85%",
            backgroundColor: isUser ? "#3B82F6" : "#F3F4F6",
            borderRadius: 16,
            borderTopRightRadius: isUser ? 4 : 16,
            borderTopLeftRadius: isUser ? 16 : 4,
            padding: 12,
          }}
        >
          {isUser ? (
            <Text style={{ color: "#fff", fontSize: 14, lineHeight: 20 }}>
              {item.content}
            </Text>
          ) : (
            <Markdown
              style={{
                body: { fontSize: 14, color: "#1F2937", lineHeight: 22 },
                code_inline: {
                  backgroundColor: "#E5E7EB",
                  borderRadius: 4,
                  paddingHorizontal: 4,
                  fontFamily: "monospace",
                },
                fence: {
                  backgroundColor: "#1F2937",
                  borderRadius: 8,
                  padding: 12,
                },
                code_block: {
                  color: "#F9FAFB",
                  fontFamily: "monospace",
                  fontSize: 12,
                },
              }}
            >
              {item.content || " "}
            </Markdown>
          )}
          {item.streaming && (
            <View style={{ marginTop: 4 }}>
              <ActivityIndicator size="small" color={isUser ? "#fff" : "#9CA3AF"} />
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Message list */}
        <FlatList
          ref={listRef}
          data={session?.messages ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View className="items-center justify-center py-24">
              <Text className="text-5xl mb-4">🦞</Text>
              <Text className="text-gray-500 text-lg font-semibold">ClawNo.11</Text>
              <Text className="text-gray-400 text-sm mt-1">你自己的 AI 助手</Text>
            </View>
          }
        />

        {/* Input bar */}
        <View className="flex-row items-end gap-2 px-3 py-3 border-t border-gray-100 bg-white">
          <TouchableOpacity
            onPress={createSession}
            className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
          >
            <Plus size={18} color="#6B7280" />
          </TouchableOpacity>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="发消息给 AI..."
            multiline
            maxLength={4000}
            style={{
              flex: 1,
              backgroundColor: "#F3F4F6",
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: 14,
              maxHeight: 120,
            }}
            editable={!isStreaming}
          />

          <TouchableOpacity className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center">
            <Mic size={18} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={send}
            disabled={!input.trim() || isStreaming}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: !input.trim() || isStreaming ? "#E5E7EB" : "#3B82F6",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Send size={16} color={!input.trim() || isStreaming ? "#9CA3AF" : "#fff"} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
