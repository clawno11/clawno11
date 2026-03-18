import { useState, useEffect } from "react";

const KEYBOARD_THRESHOLD = 150;

/**
 * Returns true when the virtual keyboard is likely visible.
 * Uses visualViewport height delta vs window.innerHeight.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function check() {
      const diff = window.innerHeight - (vv?.height ?? window.innerHeight);
      setVisible(diff > KEYBOARD_THRESHOLD);
    }

    vv.addEventListener("resize", check);
    vv.addEventListener("scroll", check);
    return () => {
      vv.removeEventListener("resize", check);
      vv.removeEventListener("scroll", check);
    };
  }, []);

  return visible;
}
