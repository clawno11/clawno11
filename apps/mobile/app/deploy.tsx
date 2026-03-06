import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DeployScreen() {
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [progress, setProgress] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [done, setDone] = useState(false);

  const handleDeploy = async () => {
    if (!host) {
      Alert.alert("错误", "请输入服务器地址");
      return;
    }
    setDone(false);
    setProgress("准备连接...");
    setPercent(0);

    try {
      // NOTE: SSH deployment from mobile requires a backend relay or Tauri shell plugin
      // This is a placeholder - actual SSH will be implemented via a relay server
      setProgress("移动端 SSH 部署需要通过中继服务...");
      setPercent(30);
      await new Promise((r) => setTimeout(r, 1500));
      setProgress("功能开发中，请使用桌面端进行服务器部署");
      setPercent(100);
      setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("部署失败", msg);
      setProgress(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4">
        <Text className="text-lg font-bold mb-1 text-gray-800">远程部署 OpenClaw</Text>
        <Text className="text-sm text-gray-500 mb-6">通过 SSH 一键部署到服务器</Text>

        <View className="space-y-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">服务器地址</Text>
            <TextInput
              value={host}
              onChangeText={setHost}
              placeholder="192.168.1.1 或 example.com"
              autoCapitalize="none"
              keyboardType="url"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-700 mb-1">用户名</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
              />
            </View>
            <View className="w-24">
              <Text className="text-sm font-medium text-gray-700 mb-1">端口</Text>
              <TextInput
                value={sshPort}
                onChangeText={setSshPort}
                keyboardType="number-pad"
                className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
              />
            </View>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1">SSH 密码</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="留空则使用密钥认证"
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
            />
          </View>
        </View>

        {progress && (
          <View className="mt-6">
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm text-gray-500">{progress}</Text>
              <Text className="text-sm text-gray-500">{percent}%</Text>
            </View>
            <View className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <View
                className="h-full bg-primary rounded-full"
                style={{ width: `${percent}%` }}
              />
            </View>
          </View>
        )}

        {done && (
          <View className="mt-4 p-4 bg-green-50 rounded-xl border border-green-200">
            <Text className="text-green-700 text-sm">操作完成</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleDeploy}
          className="mt-6 bg-primary rounded-xl py-4 items-center"
        >
          <Text className="text-white font-semibold">一键部署</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
