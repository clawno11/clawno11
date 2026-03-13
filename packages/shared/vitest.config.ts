import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/__mocks__/tauri.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "src/__mocks__/tauri.ts"),
      "@tauri-apps/plugin-sql": path.resolve(__dirname, "src/__mocks__/tauri.ts"),
      "@tauri-apps/plugin-store": path.resolve(__dirname, "src/__mocks__/tauri.ts"),
    },
  },
});
