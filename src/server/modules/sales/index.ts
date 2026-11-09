import "server-only";

export {
  listRecentSales,
  recordSale,
  deleteSale,
  type SaleListItem,
  type SalesOverview,
} from "./sales.service";
export {
  getSalesViewConfig,
  saveSalesViewConfig,
  type SalesViewConfig,
} from "./sales-config.service";
