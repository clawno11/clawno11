import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useGatewayStore } from "../../../store/gateway";

export default function AddGatewayScreen() {
  const router = useRouter();
  const { addConnection, checkHealth } = useGatewayStore();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("http://");
  const [apiKey, setApiKey] = useState("");
  const [isTunnel, setIsTunnel] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!url.startsWith("http")) {
      Alert.alert("地址格式错误", "请输入完整地址，如 http://192.168.1.1:18789");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(5000),
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (res.ok) {
        Alert.alert("连接成功", "Gateway 在线，可以添加");
      } else {
        Alert.alert("连接失败", `HTTP ${res.status}`);
      }
    } catch (e) {
      Alert.alert("连接失败", e instanceof Error ? e.message : "无法连接");
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = () => {
    if (!name.trim()) {
      Alert.alert("请填写名称");
      return;
    }
    if (!url.startsWith("http")) {
      Alert.alert("地址格式错误", "请输入完整的 http/https 地址");
      return;
    }
    const id = addConnection({
      name: name.trim(),
      url: url.trim().replace(/\/$/, ""),
      apiKey: apiKey.trim() || undefined,
      isTunnel,
      latencyMs: undefined,
      version: undefined,
      lastChecked: undefined,
    });
    checkHealth(id);
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="text-lg font-bold text-gray-800 mb-1">添加 Gateway 连接</Text>
        <Text className="text-sm text-gray-500 mb-6">
          连接到 OpenClaw Gateway，支持本地和远程地址
        </Text>

        <View className="space-y-4">
          {/* Name */}
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">名称</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="我的服务器"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
          </View>

          {/* URL */}
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">Gateway 地址</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="http://192.168.1.1:18789"
              autoCapitalize="none"
              keyboardType="url"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
            <Text className="text-xs text-gray-400 mt-1">
              本地：http://localhost:18789 | Cloudflare Tunnel：https://xxx.clawno11.com
            </Text>
          </View>

          {/* API Key */}
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">API Key（可选）</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              secureTextEntry
              placeholder="留空则不需要认证"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
          </View>

          {/* Tunnel toggle */}
          <View className="flex-row items-center justify-between py-3 border-t border-gray-100">
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-700">Cloudflare Tunnel</Text>
              <Text className="text-xs text-gray-400 mt-0.5">
                通过 Cloudflare 隧道访问（无需公网 IP）
              </Text>
            </View>
            <Switch
              value={isTunnel}
              onValueChange={setIsTunnel}
              trackColor={{ true: "#3B82F6" }}
            />
          </View>
        </View>

        {/* Cloudflare tip */}
        {isTunnel && (
          <View className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
            <Text className="text-xs font-semibold text-blue-800 mb-1">
              如何获取 Cloudflare Tunnel 地址
            </Text>
            <Text className="text-xs text-blue-700 leading-5">
              1. 在服务器上安装并运行 cloudflared{"\n"}
              2. 执行：cloudflared tunnel --url http://localhost:18789{"\n"}
              3. 复制生成的 https://xxx.trycloudflare.com 地址
            </Text>
          </View>
        )}

        {/* Buttons */}
        <View className="mt-6 gap-3">
          <TouchableOpacity
            onPress={handleTest}
            disabled={testing}
            className="border border-primary rounded-xl py-3 items-center"
          >
            <Text className="text-primary font-semibold text-sm">
              {testing ? "测试中..." : "测试连接"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleAdd}
            className="bg-primary rounded-xl py-3 items-center"
          >
            <Text className="text-white font-semibold text-sm">添加连接</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
