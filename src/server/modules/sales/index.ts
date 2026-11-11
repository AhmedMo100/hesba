import "server-only";

export {
  listRecentSales,
  recordSale,
  voidSale,
  type SaleListItem,
  type SalesOverview,
} from "./sales.service";
export {
  getSalesViewConfig,
  saveSalesViewConfig,
  type SalesViewConfig,
} from "./sales-config.service";
