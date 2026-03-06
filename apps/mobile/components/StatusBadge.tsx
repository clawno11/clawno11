import { View, Text } from "react-native";
import type { GatewayStatus } from "../store/gateway";

const config: Record<GatewayStatus, { label: string; bg: string; text: string; dot: string }> = {
  unknown:  { label: "未知",   bg: "bg-gray-100",   text: "text-gray-500",  dot: "bg-gray-400" },
  checking: { label: "检测中", bg: "bg-blue-50",    text: "text-blue-600",  dot: "bg-blue-400" },
  online:   { label: "在线",   bg: "bg-green-50",   text: "text-green-700", dot: "bg-green-500" },
  offline:  { label: "离线",   bg: "bg-red-50",     text: "text-red-600",   dot: "bg-red-500" },
  error:    { label: "错误",   bg: "bg-orange-50",  text: "text-orange-600",dot: "bg-orange-500" },
};

export function StatusBadge({ status }: { status: GatewayStatus }) {
  const c = config[status];
  return (
    <View className={`flex-row items-center gap-1.5 px-2 py-0.5 rounded-full ${c.bg}`}>
      <View className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <Text className={`text-xs font-medium ${c.text}`}>{c.label}</Text>
    </View>
  );
}
