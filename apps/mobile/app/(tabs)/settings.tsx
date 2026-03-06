import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "../../store/chat";

export default function SettingsScreen() {
  const { gatewayUrl, apiKey, setGatewayUrl, setApiKey } = useChatStore();

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="text-lg font-bold mb-1 text-gray-800">连接设置</Text>
        <Text className="text-sm text-gray-500 mb-6">配置 OpenClaw Gateway 连接信息</Text>

        <View className="space-y-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">Gateway 地址</Text>
            <TextInput
              value={gatewayUrl}
              onChangeText={setGatewayUrl}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="http://localhost:18789"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
            <Text className="text-xs text-gray-400 mt-1">
              本地：http://localhost:18789 | 远程：https://your-server.com
            </Text>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">API Key（可选）</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              secureTextEntry
              placeholder="sk-..."
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
          </View>
        </View>

        <View className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100">
          <Text className="text-sm font-semibold text-blue-800 mb-1">💡 快速连接</Text>
          <Text className="text-xs text-blue-600">
            如果 OpenClaw 部署在本机，保持默认地址即可。{"\n"}
            如果部署在服务器，使用 Cloudflare Tunnel 可获得 HTTPS 域名访问，无需公网 IP。
          </Text>
        </View>

        <View className="mt-6 p-4 bg-gray-50 rounded-xl">
          <Text className="text-sm font-semibold text-gray-700 mb-2">关于 ClawNo.11</Text>
          <Text className="text-xs text-gray-500">版本 0.1.0</Text>
          <Text className="text-xs text-gray-400 mt-1">OpenClaw 一键部署 & AI 聊天客户端</Text>
          <Text className="text-xs text-gray-400">clawno11.com · github.com/clawno11/clawno11</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
