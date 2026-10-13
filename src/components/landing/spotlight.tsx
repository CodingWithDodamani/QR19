"use client";

import { useCallback } from "react";

/**
 * 21st-style spotlight: tracks the pointer per card and exposes it as
 * `--mx` / `--my` for the `.spotlight::after` radial glow (see globals.css).
 * Skips touch pointers and reduced-motion users; React 19 ref cleanup
 * removes the listener. One hook instance can feed many cards.
 */
export function useSpotlight<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    if (!node) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      node.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      node.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    node.addEventListener("pointermove", onMove);
    return () => {
      node.removeEventListener("pointermove", onMove);
    };
  }, []);
}
