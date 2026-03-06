import { View, Text, ScrollView, TouchableOpacity, Switch } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Wifi, ChevronRight } from "lucide-react-native";
import { useGatewayStore } from "../../store/gateway";
import { useChatStore } from "../../store/chat";
import { StatusBadge } from "../../components/StatusBadge";
import { useEffect } from "react";

export default function SettingsScreen() {
  const router = useRouter();
  const { connections, activeId, getActive, checkAll } = useGatewayStore();
  const { setGatewayUrl, setApiKey } = useChatStore();

  const active = getActive();

  // Sync active gateway to chat store
  useEffect(() => {
    if (active) {
      setGatewayUrl(active.url);
      setApiKey(active.apiKey ?? "");
    }
  }, [activeId]);

  useEffect(() => {
    checkAll();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4">

        {/* Current Gateway */}
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
          当前 Gateway
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/gateway")}
          className="bg-white rounded-2xl border border-gray-200 p-4 mb-5"
        >
          {active ? (
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-xl bg-primary items-center justify-center">
                <Wifi size={18} color="#fff" />
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-gray-800">{active.name}</Text>
                <Text className="text-xs text-gray-400" numberOfLines={1}>{active.url}</Text>
              </View>
              <View className="items-end gap-1.5">
                <StatusBadge status={active.status} />
                <ChevronRight size={14} color="#D1D5DB" />
              </View>
            </View>
          ) : (
            <View className="flex-row items-center gap-2">
              <Wifi size={18} color="#9CA3AF" />
              <Text className="text-gray-400 text-sm">未选择连接，点击配置</Text>
              <ChevronRight size={14} color="#D1D5DB" style={{ marginLeft: "auto" }} />
            </View>
          )}
        </TouchableOpacity>

        {/* All connections quick view */}
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
          所有连接（{connections.length}）
        </Text>
        <View className="bg-white rounded-2xl border border-gray-200 mb-5 overflow-hidden">
          {connections.map((conn, i) => (
            <TouchableOpacity
              key={conn.id}
              onPress={() => router.push(`/(tabs)/gateway/${conn.id}`)}
              className={`flex-row items-center px-4 py-3 ${
                i < connections.length - 1 ? "border-b border-gray-100" : ""
              }`}
            >
              <Text className="flex-1 text-sm text-gray-700" numberOfLines={1}>
                {conn.name}
              </Text>
              <View className="flex-row items-center gap-2">
                <StatusBadge status={conn.status} />
                <ChevronRight size={12} color="#D1D5DB" />
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/gateway/add")}
            className="px-4 py-3 border-t border-gray-100"
          >
            <Text className="text-primary text-sm text-center font-medium">+ 添加新连接</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4">
          <Text className="text-sm font-semibold text-gray-700 mb-3">关于 ClawNo.11</Text>
          <View className="space-y-1">
            <Text className="text-xs text-gray-500">版本：0.1.0 (build 1)</Text>
            <Text className="text-xs text-gray-400">OpenClaw 一键部署 & AI 聊天客户端</Text>
            <Text className="text-xs text-gray-400">clawno11.com</Text>
            <Text className="text-xs text-gray-400">github.com/clawno11/clawno11</Text>
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
