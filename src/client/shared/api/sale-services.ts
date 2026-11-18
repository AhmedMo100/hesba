"use client";

/**
 * @file sale-services.ts
 * @description Which services the sale screen offers (the shop's sales config, kept on the
 * server with a copy on this device). A service saved on «المحافظ والماكينات» is offered at
 * once — no extra step.
 */

export const enabledServicesKey = (storeId?: string) =>
  `hesba_sales_enabled_services_${storeId || "default"}`;

/** Adds a service to the sale screen (idempotent). Returns false when it was already there. */
export function enableServiceForSale(
  serviceId: string,
  storeId?: string,
): boolean {
  if (typeof window === "undefined") return false;
  let list: string[] = [];
  try {
    const raw = localStorage.getItem(enabledServicesKey(storeId));
    list = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    list = [];
  }
  if (list.includes(serviceId)) return false;
  list = [...list, serviceId];
  try {
    localStorage.setItem(enabledServicesKey(storeId), JSON.stringify(list));
  } catch {
    // Storage unavailable: the server copy below still records it.
  }
  void fetch("/api/sales/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabledServiceIds: list }),
  }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent("hesba_sales_config_updated"));
  return true;
}
