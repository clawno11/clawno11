import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.ts";
import "./index.css";
import { App } from "./App.tsx";

// Set --app-height to window height on init and resize.
// Keyboard handling for the chat page is done via transform in ChatPage.
function syncAppHeight() {
  const h = window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${h}px`);
}
window.addEventListener("resize", syncAppHeight);
syncAppHeight();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
