import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { useAiConfigStore } from "./store/aiConfig.ts";
import { fixModelConfig } from "./ipc.ts";
import "./i18n.ts";
import "./index.css";

// Hydrate encrypted AI config from Tauri secure store before first render
useAiConfigStore.getState().load().catch(console.error);

// Auto-fix: if current default model has no auth, switch to one that does,
// and rebuild the fallback chain from all configured providers.
fixModelConfig().catch(() => { /* openclaw not yet installed — ignore */ });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
