/**
 * @file operating-mode.ts
 * @description How a shop uses Hesba (ADR-0033) — one place that says what each mode can do,
 * read by the server (every route that belongs to one mode checks it) and by the screens (what
 * the navigation shows). Changing the mode changes no data: only this answer.
 *
 * - simple (إدارة المحل): products and stock, purchases, expenses, people and debts, the drawer
 *   and wallets, the daily sales total, the stocktake, reports. No cashier, no sale invoices.
 * - pos (الكاشير الذكي): all of the above but the daily total, plus the cashier — every sale
 *   recorded with its products, credit sales and returns, per-product sales reports.
 */

export const OPERATING_MODES = ["simple", "pos"] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];

export const MODE_LABELS: Record<OperatingMode, string> = {
  simple: "إدارة المحل",
  pos: "الكاشير الذكي",
};

/** Features that belong to one mode only (everything else is in both). */
export type ModeCapability =
  /** The cashier: recording sales one by one, credit sales, voids and returns. */
  | "posSales"
  /** The daily sales total (إدارة المحل records the day's sales as one amount). */
  | "dailySalesTotals";

const CAPABILITIES: Record<ModeCapability, readonly OperatingMode[]> = {
  posSales: ["pos"],
  dailySalesTotals: ["simple"],
};

export function isOperatingMode(v: unknown): v is OperatingMode {
  return (
    typeof v === "string" && (OPERATING_MODES as readonly string[]).includes(v)
  );
}

/** Whether a shop in `mode` may use `capability`. An unknown mode may use neither. */
export function modeAllows(
  mode: string | null | undefined,
  capability: ModeCapability,
): boolean {
  return isOperatingMode(mode) && CAPABILITIES[capability].includes(mode);
}

/** The Arabic refusal for a feature of the other mode. */
export function modeRefusal(capability: ModeCapability): string {
  return capability === "posSales"
    ? "البيع بالفاتورة متاح في «الكاشير الذكي» بس. تقدر تغيّر طريقة التشغيل من إعدادات المحل."
    : "إجمالي المبيعات اليومي متاح في «إدارة المحل» بس، لأن الكاشير بيسجل كل بيعة لوحدها.";
}
