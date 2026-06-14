"use client";

import { useEffect, useState } from "react";

/**
 * True on coarse-pointer (touch) devices. Used to gate touch-only affordances
 * (pinch hint, larger zoom buttons) without affecting the desktop layout.
 * SSR-safe: starts `false`, resolves after mount via `matchMedia`.
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouch(mq.matches);
    update();
    // Safari <14 uses addListener/removeListener.
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  return isTouch;
}
