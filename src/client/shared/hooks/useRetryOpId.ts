/**
 * @file useRetryOpId.ts
 * @description The idempotency key of one form submission (QA-27). Retrying the SAME
 * submission (same payload, e.g. after a lost response) reuses its `opId`, so the server
 * records it once; a changed payload gets a new `opId`; `reset()` after success.
 */
import { useCallback, useRef } from "react";

function newOpId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function useRetryOpId() {
  const last = useRef<{ fingerprint: string; opId: string } | null>(null);
  const opIdFor = useCallback((payload: unknown): string => {
    const fingerprint = JSON.stringify(payload);
    if (last.current?.fingerprint !== fingerprint) {
      last.current = { fingerprint, opId: newOpId() };
    }
    return last.current.opId;
  }, []);
  const reset = useCallback(() => {
    last.current = null;
  }, []);
  return { opIdFor, reset };
}
