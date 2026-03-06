import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Plus, Wifi, Trash2, ChevronRight, RefreshCw } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { useGatewayStore } from "../../../store/gateway";
import { StatusBadge } from "../../../components/StatusBadge";
import type { GatewayConnection } from "../../../store/gateway";

export default function GatewayListScreen() {
  const { connections, activeId, setActive, removeConnection, checkAll } = useGatewayStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    checkAll();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await checkAll();
    setRefreshing(false);
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert("删除连接", `确认删除「${name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => removeConnection(id) },
    ]);
  };

  const renderItem = ({ item }: { item: GatewayConnection }) => {
    const isActive = item.id === activeId;
    return (
      <TouchableOpacity
        onPress={() => router.push(`/(tabs)/gateway/${item.id}`)}
        className={`mx-4 mb-3 p-4 rounded-2xl border ${
          isActive ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
        }`}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center gap-3 flex-1">
            <View
              className={`w-10 h-10 rounded-xl items-center justify-center ${
                isActive ? "bg-primary" : "bg-gray-100"
              }`}
            >
              <Wifi size={18} color={isActive ? "#fff" : "#6B7280"} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="font-semibold text-gray-800" numberOfLines={1}>
                  {item.name}
                </Text>
                {isActive && (
                  <View className="px-1.5 py-0.5 bg-primary rounded">
                    <Text className="text-[10px] text-white font-medium">当前</Text>
                  </View>
                )}
              </View>
              <Text className="text-xs text-gray-400 mt-0.5" numberOfLines={1}>
                {item.url}
              </Text>
              {item.latencyMs !== undefined && item.status === "online" && (
                <Text className="text-xs text-green-600 mt-0.5">{item.latencyMs}ms</Text>
              )}
            </View>
          </View>
          <View className="items-end gap-2">
            <StatusBadge status={item.status} />
            <ChevronRight size={14} color="#D1D5DB" />
          </View>
        </View>

        {/* Actions */}
        <View className="flex-row mt-3 gap-2 pt-3 border-t border-gray-100">
          <TouchableOpacity
            onPress={() => setActive(item.id)}
            disabled={isActive}
            className={`flex-1 py-1.5 rounded-lg items-center ${
              isActive ? "bg-gray-100" : "bg-primary"
            }`}
          >
            <Text
              className={`text-xs font-medium ${isActive ? "text-gray-400" : "text-white"}`}
            >
              {isActive ? "已选中" : "设为当前"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(item.id, item.name)}
            className="px-3 py-1.5 rounded-lg bg-red-50 items-center"
          >
            <Trash2 size={14} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["bottom"]}>
      <FlatList
        data={connections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View className="items-center py-24">
            <Wifi size={48} color="#D1D5DB" />
            <Text className="text-gray-400 mt-3">还没有 Gateway 连接</Text>
          </View>
        }
      />

      {/* Fab */}
      <TouchableOpacity
        onPress={() => router.push("/(tabs)/gateway/add")}
        className="absolute bottom-8 right-6 w-14 h-14 bg-primary rounded-full items-center justify-center shadow-lg"
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}
