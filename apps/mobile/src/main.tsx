import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.ts";
import "./index.css";
import { App } from "./App.tsx";

// iOS WKWebView keyboard handling.
// visualViewport events are unreliable in WKWebView, so we use
// focusin-triggered polling as the primary detection mechanism.
let pollTimer: ReturnType<typeof setInterval> | null = null;

function applyHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const hPx = `${h}px`;
  document.documentElement.style.setProperty("--app-height", hPx);
  const root = document.getElementById("root");
  if (root) root.style.height = hPx;
}

function startKeyboardPoll() {
  stopKeyboardPoll();
  applyHeight();
  pollTimer = setInterval(applyHeight, 60);
  setTimeout(stopKeyboardPoll, 1200);
}

function stopKeyboardPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

document.addEventListener("focusin", (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
    startKeyboardPoll();
  }
});

document.addEventListener("focusout", (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
    setTimeout(() => { stopKeyboardPoll(); applyHeight(); }, 300);
  }
});

window.visualViewport?.addEventListener("resize", applyHeight);
window.visualViewport?.addEventListener("scroll", applyHeight);
window.addEventListener("resize", applyHeight);
applyHeight();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
