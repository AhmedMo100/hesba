/**
 * @file BottomNav.tsx
 * @description The app's routes. There is NO bottom bar and NO sidebar (owner's decision,
 * 2026-11-23): Home is the hub and every inner screen has «→ رجوع». The file keeps its name
 * because the route type is imported from here across the app.
 */

export type NavRoute =
  | "home"
  | "products"
  | "sales"
  | "daily-sales"
  | "stock"
  | "expenses"
  | "people"
  | "alerts"
  | "ai"
  | "inventory"
  | "reports"
  | "drawer"
  | "notifications"
  | "money"
  | "services"
  | "stocktake";
