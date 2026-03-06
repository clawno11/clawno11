import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // deploy-engine uses native Node modules (ssh2/cpu-features) that
      // cannot be bundled for the browser renderer. The renderer communicates
      // with the deploy logic via Tauri IPC commands instead.
      "@clawno/deploy-engine": path.resolve(__dirname, "./src/tauri-shims/deploy-engine.ts"),
    },
  },
  // Tauri dev server settings
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Watch Rust changes
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri build settings
  build: {
    target: process.env["TAURI_ENV_PLATFORM"] === "windows" ? "chrome105" : "safari13",
    minify: !process.env["TAURI_ENV_DEBUG"] ? "esbuild" : false,
    sourcemap: !!process.env["TAURI_ENV_DEBUG"],
  },
});
