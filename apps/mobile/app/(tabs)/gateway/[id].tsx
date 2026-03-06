import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshCw, ExternalLink, Trash2, Wifi, Clock, Tag } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { useGatewayStore } from "../../../store/gateway";
import { StatusBadge } from "../../../components/StatusBadge";

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3 py-3 border-b border-gray-100">
      <View className="w-8 items-center">{icon}</View>
      <Text className="text-sm text-gray-500 w-20">{label}</Text>
      <Text className="text-sm text-gray-800 flex-1" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function GatewayDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { connections, removeConnection, setActive, checkHealth, activeId } = useGatewayStore();
  const conn = connections.find((c) => c.id === id);
  const [checking, setChecking] = useState(false);

  if (!conn) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-400">连接不存在</Text>
      </View>
    );
  }

  const isActive = activeId === id;

  const handleCheck = async () => {
    setChecking(true);
    await checkHealth(id);
    setChecking(false);
  };

  const handleDelete = () => {
    Alert.alert("删除连接", `确认删除「${conn.name}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          removeConnection(id);
          router.back();
        },
      },
    ]);
  };

  const formatTime = (ts?: number) => {
    if (!ts) return "从未";
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.round(diff / 60)}分钟前`;
    return new Date(ts).toLocaleTimeString("zh-CN");
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <ScrollView className="flex-1">
        {/* Header card */}
        <View className="mx-4 mt-4 p-4 bg-white rounded-2xl border border-gray-200">
          <View className="flex-row items-center gap-3">
            <View
              className={`w-12 h-12 rounded-xl items-center justify-center ${
                isActive ? "bg-primary" : "bg-gray-100"
              }`}
            >
              <Wifi size={22} color={isActive ? "#fff" : "#6B7280"} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-gray-800">{conn.name}</Text>
              <Text className="text-xs text-gray-400" numberOfLines={1}>
                {conn.url}
              </Text>
            </View>
            <StatusBadge status={conn.status} />
          </View>

          {conn.status === "online" && conn.latencyMs !== undefined && (
            <View className="mt-3 flex-row gap-4">
              <View className="items-center flex-1 py-2 bg-green-50 rounded-xl">
                <Text className="text-xl font-bold text-green-600">{conn.latencyMs}</Text>
                <Text className="text-xs text-green-500">ms 延迟</Text>
              </View>
              {conn.version && (
                <View className="items-center flex-1 py-2 bg-blue-50 rounded-xl">
                  <Text className="text-sm font-bold text-blue-600">{conn.version}</Text>
                  <Text className="text-xs text-blue-500">版本</Text>
                </View>
              )}
              <View className="items-center flex-1 py-2 bg-gray-50 rounded-xl">
                <Text className="text-sm font-bold text-gray-600">
                  {conn.isTunnel ? "隧道" : "直连"}
                </Text>
                <Text className="text-xs text-gray-400">连接类型</Text>
              </View>
            </View>
          )}
        </View>

        {/* Info */}
        <View className="mx-4 mt-4 p-4 bg-white rounded-2xl border border-gray-200">
          <Text className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
            连接信息
          </Text>
          <InfoRow
            icon={<Wifi size={16} color="#6B7280" />}
            label="地址"
            value={conn.url}
          />
          <InfoRow
            icon={<Tag size={16} color="#6B7280" />}
            label="API Key"
            value={conn.apiKey ? "已设置 ****" : "未设置"}
          />
          <InfoRow
            icon={<Clock size={16} color="#6B7280" />}
            label="最后检测"
            value={formatTime(conn.lastChecked)}
          />
        </View>

        {/* Actions */}
        <View className="mx-4 mt-4 gap-3">
          <TouchableOpacity
            onPress={handleCheck}
            disabled={checking}
            className="flex-row items-center justify-center gap-2 py-3 bg-white rounded-xl border border-gray-200"
          >
            {checking ? (
              <ActivityIndicator size="small" color="#3B82F6" />
            ) : (
              <RefreshCw size={16} color="#3B82F6" />
            )}
            <Text className="text-primary font-semibold text-sm">
              {checking ? "检测中..." : "重新检测连接"}
            </Text>
          </TouchableOpacity>

          {!isActive && (
            <TouchableOpacity
              onPress={() => setActive(id)}
              className="py-3 bg-primary rounded-xl items-center"
            >
              <Text className="text-white font-semibold text-sm">设为当前连接</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/deploy?gatewayId=${id}`)}
            className="flex-row items-center justify-center gap-2 py-3 bg-white rounded-xl border border-gray-200"
          >
            <ExternalLink size={16} color="#6B7280" />
            <Text className="text-gray-600 font-semibold text-sm">部署 OpenClaw 到此服务器</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            className="py-3 bg-red-50 rounded-xl items-center border border-red-100"
          >
            <Text className="text-red-500 font-semibold text-sm">删除连接</Text>
          </TouchableOpacity>
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
