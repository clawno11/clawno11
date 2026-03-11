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
      // Point to TS source so Vite bundles it as ESM (avoids "exports is not
      // defined" that occurs when the CJS dist is loaded in a browser context).
      "@clawno/openclaw-client": path.resolve(__dirname, "../../packages/openclaw-client/src/index.ts"),
      // Shared store/utils package — resolve to TS source for Vite transpilation.
      "@clawno/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  optimizeDeps: {
    // Ensure eventsource-parser (ESM-only dep of openclaw-client) is
    // pre-bundled so the dev server can handle it without CJS/ESM conflicts.
    include: ["eventsource-parser"],
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
