import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.ts";
import "./index.css";
import { App } from "./App.tsx";

// Set --app-height for root element sizing.
// Keyboard handling uses CSS var(--keyboard-height) from edge-to-edge plugin.
function syncAppHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}
window.addEventListener("resize", syncAppHeight);
syncAppHeight();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
