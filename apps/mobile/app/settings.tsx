import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  const [gatewayUrl, setGatewayUrl] = useState("http://localhost:18789");
  const [apiKey, setApiKey] = useState("");

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="text-lg font-bold mb-1 text-gray-800">设置</Text>
        <Text className="text-sm text-gray-500 mb-6">配置 OpenClaw 连接信息</Text>

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
            <Text className="text-xs text-gray-400 mt-1">OpenClaw Gateway 的访问地址</Text>
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

        <TouchableOpacity className="mt-6 bg-primary rounded-xl py-4 items-center">
          <Text className="text-white font-semibold">保存设置</Text>
        </TouchableOpacity>

        <View className="mt-8 p-4 bg-gray-50 rounded-xl">
          <Text className="text-sm font-semibold text-gray-700 mb-2">关于</Text>
          <Text className="text-xs text-gray-500">Clawno v0.1.0</Text>
          <Text className="text-xs text-gray-400 mt-1">
            OpenClaw 一键部署及 AI 聊天客户端
          </Text>
          <Text className="text-xs text-gray-400">github.com/clawno/clawno</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
