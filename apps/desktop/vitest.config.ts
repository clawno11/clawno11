import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub out Tauri IPC so pure-logic unit tests run in Node without native plugins
      "@tauri-apps/api/core": path.resolve(__dirname, "src/__tests__/__mocks__/tauri.ts"),
      "@tauri-apps/plugin-store": path.resolve(__dirname, "src/__tests__/__mocks__/tauri.ts"),
      "@tauri-apps/plugin-sql": path.resolve(__dirname, "src/__tests__/__mocks__/tauri.ts"),
      "@tauri-apps/plugin-shell": path.resolve(__dirname, "src/__tests__/__mocks__/tauri.ts"),
    },
  },
});
