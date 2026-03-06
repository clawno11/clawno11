import { Stack } from "expo-router";

export default function GatewayLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Gateway 管理" }} />
      <Stack.Screen name="add" options={{ title: "添加连接", presentation: "modal" }} />
      <Stack.Screen name="[id]" options={{ title: "连接详情" }} />
    </Stack>
  );
}
