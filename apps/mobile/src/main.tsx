import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.ts";
import "./index.css";
import { App } from "./App.tsx";

// Keep --app-height in sync with the visible area so flex layout
// pushes the chat input above the virtual keyboard on iOS.
// interactive-widget=resizes-content handles the layout viewport,
// but we still sync --app-height as a belt-and-suspenders fallback
// because WKWebView behaviour varies across iOS versions.
let rafId = 0;
function syncAppHeight() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${h}px`);
  });
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
