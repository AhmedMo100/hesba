"use client";

/**
 * @file access.ts
 * @description What the screens read about the shop's access (ADR-0033): the operating mode and
 * the subscription as the server last reported them. The server enforces both on every request;
 * these only decide what is shown. The last known mode is remembered per shop on the device so
 * the navigation stays right offline.
 */
import type { SessionState } from "@/client/shared/api/auth";
import { isOperatingMode, type OperatingMode } from "@/domain/operating-mode";

const MODE_KEY = (storeId: string) => `hesba_mode_${storeId}`;

export function rememberMode(storeId: string, mode: string | undefined): void {
  try {
    if (isOperatingMode(mode)) localStorage.setItem(MODE_KEY(storeId), mode);
  } catch {
    /* storage blocked */
  }
}

export function lastKnownMode(storeId: string | null): OperatingMode | null {
  if (!storeId) return null;
  try {
    const v = localStorage.getItem(MODE_KEY(storeId));
    return isOperatingMode(v) ? v : null;
  } catch {
    return null;
  }
}

/** The shop's mode: the session's, else the one last seen on this device, else the cashier. */
export function modeOf(
  session: SessionState | null,
  storeId: string | null,
): OperatingMode {
  const m = session?.store?.operatingMode;
  if (isOperatingMode(m)) return m;
  return lastKnownMode(storeId) ?? "pos";
}

/** True when the server said the trial / subscription is over (never guessed offline). */
export function isAccessBlocked(session: SessionState | null): boolean {
  const sub = session?.store?.subscription;
  return Boolean(sub && !sub.allowed);
}

const cairo = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Africa/Cairo",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A UTC instant shown in Cairo time. */
export function cairoDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : cairo.format(d);
}

/** «2 يوم و 5 ساعات» left, from the server's own clock at `checkedAt`. */
export function timeLeft(
  endsAt: string | null,
  checkedAt: string,
): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - new Date(checkedAt).getTime();
  if (!(ms > 0)) return null;
  const hours = Math.floor(ms / 3600_000);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days > 0) return rest > 0 ? `${days} يوم و ${rest} ساعة` : `${days} يوم`;
  return hours > 0 ? `${hours} ساعة` : "أقل من ساعة";
}
