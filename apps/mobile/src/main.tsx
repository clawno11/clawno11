import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.ts";
import "./index.css";
import { App } from "./App.tsx";

// Keep --app-height in sync with the actual visible area.
// On iOS WKWebView the virtual keyboard overlays the webview without
// resizing it, so CSS height:100% still includes the area behind the
// keyboard.  By binding the root height to visualViewport.height the
// flex layout naturally pushes the chat input above the keyboard.
function syncAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${h}px`);
}
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);
window.addEventListener("resize", syncAppHeight);
syncAppHeight();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
