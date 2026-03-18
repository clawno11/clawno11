import { useState, useEffect, useRef } from "react";

const KEYBOARD_THRESHOLD = 150;

/**
 * Returns true when the virtual keyboard is likely visible.
 * Uses focusin-triggered polling because visualViewport events
 * are unreliable in iOS WKWebView.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function check() {
      const vv = window.visualViewport;
      const diff = window.innerHeight - (vv?.height ?? window.innerHeight);
      setVisible(diff > KEYBOARD_THRESHOLD);
    }

    function startPoll() {
      stopPoll();
      check();
      pollRef.current = setInterval(check, 100);
      setTimeout(stopPoll, 1500);
    }

    function stopPoll() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }

    function handleFocusIn(e: FocusEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        startPoll();
      }
    }

    function handleFocusOut(e: FocusEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        setTimeout(() => { stopPoll(); check(); }, 300);
      }
    }

    const vv = window.visualViewport;
    vv?.addEventListener("resize", check);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      stopPoll();
      vv?.removeEventListener("resize", check);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return visible;
}
