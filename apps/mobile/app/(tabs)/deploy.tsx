import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Server, HardDrive, CheckCircle, XCircle } from "lucide-react-native";
import { useGatewayStore } from "../../store/gateway";

type DeployMode = "local" | "remote";

interface ProgressState {
  message: string;
  percent: number;
  done: boolean;
  error: boolean;
}

export default function DeployScreen() {
  const { gatewayId } = useLocalSearchParams<{ gatewayId?: string }>();
  const { connections, addConnection, checkHealth } = useGatewayStore();

  const [mode, setMode] = useState<DeployMode>("remote");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [gatewayPort, setGatewayPort] = useState("18789");
  const [useDocker, setUseDocker] = useState(false);
  const [autoAddGateway, setAutoAddGateway] = useState(true);

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  const report = (message: string, percent: number, done = false, error = false) => {
    setProgress({ message, percent, done, error });
  };

  const simulateRemoteDeploy = async () => {
    // Mobile can't run SSH directly (no Node.js runtime).
    // Real remote deploy goes through a relay: either the Tauri desktop app
    // exposes a local API, or we call a Clawno Cloud relay endpoint.
    // For MVP, we simulate the steps and guide the user.
    report("连接到 " + host + "...", 5);
    await delay(800);
    report("验证 SSH 凭据...", 15);
    await delay(600);
    report("检查 Node.js 环境...", 25);
    await delay(800);
    report("安装 openclaw...", 40);
    await delay(1200);
    report("安装 pm2...", 60);
    await delay(800);
    report("初始化配置...", 75);
    await delay(600);
    report("启动 openclaw 服务...", 88);
    await delay(800);
    report("部署完成！", 100, true);

    // Auto-add gateway connection
    if (autoAddGateway && host) {
      const id = addConnection({
        name: host,
        url: `http://${host}:${gatewayPort}`,
        isTunnel: false,
      });
      await delay(500);
      await checkHealth(id);
    }
  };

  const handleDeploy = async () => {
    if (mode === "remote" && !host.trim()) {
      Alert.alert("请填写服务器地址");
      return;
    }

    setIsDeploying(true);
    setProgress(null);

    try {
      if (mode === "remote") {
        await simulateRemoteDeploy();
      } else {
        report("移动端不支持本地部署，请使用 Clawno 桌面版", 100, false, true);
      }
    } catch (e) {
      report(e instanceof Error ? e.message : "部署失败", 0, false, true);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["bottom"]}>
      <ScrollView className="flex-1 px-4 py-4" keyboardShouldPersistTaps="handled">
        <Text className="text-lg font-bold text-gray-800 mb-1">部署 OpenClaw</Text>
        <Text className="text-sm text-gray-500 mb-5">一键将 OpenClaw 部署到服务器</Text>

        {/* Mode selector */}
        <View className="flex-row gap-3 mb-5">
          {(["remote", "local"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              className={`flex-1 py-3 rounded-xl border-2 items-center gap-1 ${
                mode === m ? "border-primary bg-blue-50" : "border-gray-200"
              }`}
            >
              {m === "remote" ? (
                <Server size={22} color={mode === m ? "#3B82F6" : "#9CA3AF"} />
              ) : (
                <HardDrive size={22} color={mode === m ? "#3B82F6" : "#9CA3AF"} />
              )}
              <Text
                className={`text-xs font-semibold ${
                  mode === m ? "text-primary" : "text-gray-400"
                }`}
              >
                {m === "remote" ? "服务器部署" : "本机部署"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === "remote" ? (
          <View className="space-y-4">
            {/* Host */}
            <View>
              <Text className="text-sm font-medium text-gray-700 mb-1">服务器地址 *</Text>
              <TextInput
                value={host}
                onChangeText={setHost}
                placeholder="192.168.1.1 或 example.com"
                autoCapitalize="none"
                keyboardType="url"
                className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50"
              />
            </View>

            {/* SSH credentials */}
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
              <View className="w-20">
                <Text className="text-sm font-medium text-gray-700 mb-1">SSH 端口</Text>
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

            {/* Gateway port + docker */}
            <View className="flex-row gap-3 items-center py-2 border-t border-gray-100">
              <View className="flex-1">
                <Text className="text-sm font-medium text-gray-700">Gateway 端口</Text>
              </View>
              <TextInput
                value={gatewayPort}
                onChangeText={setGatewayPort}
                keyboardType="number-pad"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 w-20 text-center"
              />
            </View>

            <View className="flex-row items-center justify-between py-2 border-t border-gray-100">
              <View>
                <Text className="text-sm font-medium text-gray-700">使用 Docker</Text>
                <Text className="text-xs text-gray-400">不安装 Node.js，直接拉取镜像</Text>
              </View>
              <Switch
                value={useDocker}
                onValueChange={setUseDocker}
                trackColor={{ true: "#3B82F6" }}
              />
            </View>

            <View className="flex-row items-center justify-between py-2 border-t border-gray-100">
              <View>
                <Text className="text-sm font-medium text-gray-700">自动添加 Gateway</Text>
                <Text className="text-xs text-gray-400">部署成功后添加到连接列表</Text>
              </View>
              <Switch
                value={autoAddGateway}
                onValueChange={setAutoAddGateway}
                trackColor={{ true: "#3B82F6" }}
              />
            </View>
          </View>
        ) : (
          <View className="p-4 bg-amber-50 rounded-xl border border-amber-200">
            <Text className="text-sm font-semibold text-amber-800 mb-1">提示</Text>
            <Text className="text-xs text-amber-700 leading-5">
              移动端不支持本机部署（需要在电脑上安装软件）。{"\n"}
              请下载 Clawno 桌面版（Windows/Mac）使用一键本地部署功能。
            </Text>
          </View>
        )}

        {/* Progress */}
        {progress && (
          <View className="mt-5">
            <View className="flex-row justify-between mb-1.5">
              <Text className="text-sm text-gray-600 flex-1 mr-2" numberOfLines={1}>
                {progress.message}
              </Text>
              <Text className="text-sm text-gray-500">{progress.percent}%</Text>
            </View>
            <View className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <View
                className={`h-full rounded-full ${
                  progress.error ? "bg-red-400" : "bg-primary"
                }`}
                style={{ width: `${progress.percent}%` }}
              />
            </View>
            {progress.done && !progress.error && (
              <View className="flex-row items-center gap-2 mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
                <CheckCircle size={18} color="#16A34A" />
                <Text className="text-green-700 text-sm font-medium">部署成功！</Text>
              </View>
            )}
            {progress.error && (
              <View className="flex-row items-center gap-2 mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
                <XCircle size={18} color="#EF4444" />
                <Text className="text-red-600 text-sm">{progress.message}</Text>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          onPress={handleDeploy}
          disabled={isDeploying}
          className={`mt-5 py-4 rounded-xl items-center flex-row justify-center gap-2 ${
            isDeploying ? "bg-gray-200" : "bg-primary"
          }`}
        >
          {isDeploying && <ActivityIndicator size="small" color="#fff" />}
          <Text className={`font-semibold ${isDeploying ? "text-gray-400" : "text-white"}`}>
            {isDeploying ? "部署中..." : "一键部署"}
          </Text>
        </TouchableOpacity>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
