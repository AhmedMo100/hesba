"use client";

/**
 * @file Skeleton.tsx
 * @description The one placeholder for content that is loading (performance pass, ADR-0027).
 * It appears only after {@link SKELETON_DELAY_MS}, so a fast answer never flashes a
 * placeholder; it is decorative (`aria-hidden`) — wrap a loading area in an element with
 * `role="status"` and a text for screen readers. Motion respects `prefers-reduced-motion`.
 */
import React, { useEffect, useState } from "react";
import styles from "./Skeleton.module.css";

/** A request answered faster than this shows no placeholder at all (no flicker). */
export const SKELETON_DELAY_MS = 150;

export function Skeleton({
  width,
  height = 16,
  radius = 8,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), SKELETON_DELAY_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <span
      aria-hidden="true"
      data-testid="skeleton"
      className={`${styles.sk} ${visible ? styles.on : ""} ${className}`}
      style={{ width: width ?? "100%", height, borderRadius: radius }}
    />
  );
}
