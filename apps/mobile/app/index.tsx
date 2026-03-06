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
import { useState, useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ChatMessage } from "@clawno/openclaw-client";

interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [gatewayUrl] = useState("http://localhost:18789");
  const listRef = useRef<FlatList>(null);

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

    const history = [...messages, userMsg];
    setMessages([...history, assistantMsg]);
    setInput("");
    setIsStreaming(true);

    try {
      const { OpenClawClient } = await import("@clawno/openclaw-client");
      const client = new OpenClawClient({ baseUrl: gatewayUrl });
      await client.streamChat(
        { messages: history.map(({ role, content }) => ({ role, content })), stream: true },
        (chunk) => {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          );
          listRef.current?.scrollToEnd({ animated: true });
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
    } catch {
      setIsStreaming(false);
    }
  };

  const renderMessage = ({ item }: { item: UIMessage }) => {
    const isUser = item.role === "user";
    return (
      <View className={`flex-row mb-3 px-4 ${isUser ? "justify-end" : "justify-start"}`}>
        <View
          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
            isUser ? "bg-primary rounded-tr-sm" : "bg-gray-100 rounded-tl-sm"
          }`}
        >
          <Text className={`text-sm leading-5 ${isUser ? "text-white" : "text-gray-800"}`}>
            {item.content}
            {item.streaming && <Text className="opacity-50"> ▋</Text>}
          </Text>
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
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-24">
              <Text className="text-4xl mb-3">🦞</Text>
              <Text className="text-gray-400 text-base">发送消息开始对话</Text>
            </View>
          }
        />

        {/* Input bar */}
        <View className="flex-row items-end gap-2 px-4 py-3 border-t border-gray-100">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入消息..."
            multiline
            maxLength={4000}
            className="flex-1 bg-gray-100 rounded-2xl px-4 py-3 text-sm max-h-28"
            editable={!isStreaming}
          />
          <TouchableOpacity
            onPress={send}
            disabled={!input.trim() || isStreaming}
            className={`w-11 h-11 rounded-full items-center justify-center ${
              !input.trim() || isStreaming ? "bg-gray-200" : "bg-primary"
            }`}
          >
            {isStreaming ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white text-lg">↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
