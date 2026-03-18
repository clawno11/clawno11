import { useState, useEffect } from "react";

/**
 * Returns true when the virtual keyboard is visible.
 * Listens to the safeAreaChanged event from tauri-plugin-edge-to-edge
 * which provides native keyboard state on iOS/Android.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onSafeArea(e: Event) {
      const detail = (e as CustomEvent).detail;
      setVisible(!!detail?.keyboardVisible);
    }
    window.addEventListener("safeAreaChanged", onSafeArea);
    return () => window.removeEventListener("safeAreaChanged", onSafeArea);
  }, []);

  return visible;
}
