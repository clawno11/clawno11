import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Plus, Trash2, MessageSquare } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "../../store/chat";
import type { Session } from "../../store/chat";

export default function SessionsScreen() {
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession } =
    useChatStore();
  const router = useRouter();

  const handleNew = () => {
    createSession();
    router.push("/(tabs)/");
  };

  const handleSelect = (id: string) => {
    setActiveSession(id);
    router.push("/(tabs)/");
  };

  const handleDelete = (id: string) => {
    Alert.alert("删除会话", "确认删除此对话记录？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteSession(id) },
    ]);
  };

  const renderItem = ({ item }: { item: Session }) => {
    const isActive = item.id === activeSessionId;
    const lastMsg = item.messages.at(-1);
    return (
      <TouchableOpacity
        onPress={() => handleSelect(item.id)}
        className={`flex-row items-center px-4 py-3 border-b border-gray-100 ${
          isActive ? "bg-blue-50" : "bg-white"
        }`}
      >
        <View
          className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
            isActive ? "bg-primary" : "bg-gray-100"
          }`}
        >
          <MessageSquare size={18} color={isActive ? "#fff" : "#6B7280"} />
        </View>
        <View className="flex-1">
          <Text
            className={`font-semibold text-sm ${isActive ? "text-primary" : "text-gray-800"}`}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="text-xs text-gray-400 mt-0.5" numberOfLines={1}>
            {lastMsg ? lastMsg.content.slice(0, 40) : "暂无消息"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => handleDelete(item.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Trash2 size={16} color="#D1D5DB" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-4xl mb-3">🦞</Text>
            <Text className="text-gray-400">还没有会话，点击右上角新建</Text>
          </View>
        }
      />
      <TouchableOpacity
        onPress={handleNew}
        className="absolute bottom-8 right-6 w-14 h-14 bg-primary rounded-full items-center justify-center shadow-lg"
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}
