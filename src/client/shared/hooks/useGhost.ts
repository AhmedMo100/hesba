"use client";

import { useLayoutEffect, useEffect, type RefObject } from "react";

// SSR-safe layout effect
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Creates and appends an animated ghost clone of a DOM element to document.body,
 * then cleans it up after durationMs.
 * Respects prefers-reduced-motion.
 */
export function createGhostExit(
  node: HTMLElement | null,
  cls = "out",
  durationMs = 300,
): HTMLElement | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  if (!node || !node.parentNode) {
    return null;
  }

  try {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return null;
    }
  } catch {
    // Ignore media query error
  }

  const rect = node.getBoundingClientRect();
  const ghost = node.cloneNode(true) as HTMLElement;

  ghost.removeAttribute("id");
  ghost.classList.add(cls);
  ghost.setAttribute("aria-hidden", "true");

  const computedZIndex = window.getComputedStyle(node).zIndex;

  Object.assign(ghost.style, {
    inset: "auto",
    position: "fixed",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: computedZIndex,
  });

  ghost.querySelectorAll("input,button,select,textarea,a").forEach((el) => {
    (el as HTMLElement).tabIndex = -1;
  });

  document.body.appendChild(ghost);
  setTimeout(() => {
    if (ghost.parentNode) {
      ghost.parentNode.removeChild(ghost);
    }
  }, durationMs);

  return ghost;
}

/**
 * useGhost: clones the unmounting element into document.body with an exit animation class,
 * playing the exit animation after the React component unmounts.
 * Respects prefers-reduced-motion.
 */
export function useGhost<T extends HTMLElement>(
  ref: RefObject<T | null>,
  cls = "out",
  durationMs = 300,
): void {
  useIsomorphicLayoutEffect(() => {
    return () => {
      createGhostExit(ref.current, cls, durationMs);
    };
  }, [ref, cls, durationMs]);
}
