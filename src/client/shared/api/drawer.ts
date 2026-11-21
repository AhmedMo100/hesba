"use client";

import { apiGet } from "./read-cache";
import type { DrawerView } from "@/schemas/drawer";

export type { DrawerView, DrawerFlow } from "@/schemas/drawer";

/** The drawer's last count and expected cash (ADR-0031). Online only. */
export async function fetchDrawer(): Promise<DrawerView> {
  const res = await apiGet("/api/drawer");
  if (!res.ok) throw new Error(`drawer ${res.status}`);
  const json = (await res.json()) as { drawer: DrawerView };
  return json.drawer;
}

/** Records a count of the drawer; the same `opId` is recorded once. */
export async function countDrawer(
  opId: string,
  countedPiasters: number,
): Promise<DrawerView> {
  const res = await fetch("/api/drawer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opId, countedPiasters }),
  });
  const json = (await res.json().catch(() => null)) as {
    drawer?: DrawerView;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.drawer) {
    throw new Error(json?.error?.message || "مقدرناش نسجّل العدّ");
  }
  return json.drawer;
}
