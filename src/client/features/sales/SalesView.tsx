"use client";

/**
 * @file SalesView.tsx
 * @description The sales screen (البيع): quick-sell tiles for products and services, weighed
 * and carton sales, POS-machine services, published promotions, and today's sales list.
 *
 * @responsibility
 * Every sale is ONE `POST /api/sales` request (ADR-0019): the server records the sale and
 * deducts the stock (or a sandwich's ingredients, or every item of an offer) in one
 * transaction, priced from the shop's registered prices. The screen waits for it: the sales
 * list, the stock figures and the success toast change only after the server accepted the
 * sale. A rejection (not enough stock, offline, server error) is shown as an error toast and
 * nothing changes. The screen never deducts stock with a separate request.
 *
 * Undo (تراجع, in the success toast) is a server-side void (`POST /api/sales/void`, ADR-0022):
 * the sale stays recorded and is shown as voided, and its stock comes back only after the
 * server confirmed the void.
 *
 * @remarks
 * - Recorded sales — the list, today's total and count — come ONLY from the server
 *   (`GET /api/sales`), re-read after every recorded sale or void (QA-09). Sales the server
 *   has not recorded yet are the outbox's, shown apart as waiting and never counted. While
 *   the list is loading or unreachable the total is "—", never a stale or local figure.
 * - Services: the POS-machine balance is deducted before the sale request; if the sale is
 *   rejected, the deduction is refunded (audit QA-03 covers making this server-side).
 * - Money is integer piasters; quantities are base units (pieces or grams).
 */

import { apiGet } from "@/client/shared/api/read-cache";
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "./SalesView.module.css";
import {
  Button,
  Empty,
  SearchBox,
  Icon,
  Modal,
  Skeleton,
} from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { calculateLineTotal } from "@/domain/money";
import { normalizeArabic } from "@/domain/normalize";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import { stockLevel } from "@/domain/alerts";
import { useAuth } from "@/client/shared/auth";
import {
  type StockInventoryItem,
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import type { PublishedPromotion } from "@/schemas/promotion";
import type { SuggestedPromotion } from "@/domain/alerts";
import { EditPromoModal } from "../alerts/EditPromoModal";
import {
  getStoredMachines,
  fetchStoreMachines,
  getServiceLinkedMachineIds,
  type PosMachine,
} from "@/client/shared/api/machines";
import {
  clearStagedSandwich,
  fetchSandwiches,
  readStagedSandwich,
  type Sandwich,
} from "@/client/shared/api/sandwiches";
import {
  fetchSalesOverview,
  voidSale,
  type ListedSale,
  type RecordedSale,
  type SaleRequest,
  type SalesOverview,
  type VoidedSale,
} from "@/client/shared/api/sales";
import {
  dismissSaleOp,
  enqueueSale,
  lastOutboxStore,
  listSaleOps,
  retrySaleOp,
  scheduleSaleSync,
  sendSaleOp,
  SALE_SYNCED_EVENT,
  type SaleOpSummary,
  type SaleOutboxOp,
  type SaleSyncedDetail,
} from "@/client/offline/outbox";
import { useLiveQuery } from "dexie-react-hooks";
import { SandwichQuantitySheet } from "./SandwichQuantitySheet";
import {
  CartSheet,
  EMPTY_CART_DRAFT,
  type CartDraft,
  type CartLine,
  type CartOpId,
  type CreditCustomer,
} from "./CartSheet";
import { CreditCustomerForm } from "./CreditCustomerForm";
import { SaleInvoiceModal } from "./SaleInvoiceModal";

interface DisplaySaleItem {
  id: string;
  variantId?: string;
  productId: string;
  name: string;
  sellPricePiasters: number;
  unitMode: "piece" | "weight" | "service";
  packQty: number;
  currentStockBase: number;
  status: "ok" | "low" | "out";
  isService?: boolean;
  category?: string;
  brandName?: string | null;
  unit?: string;
  packName?: string | null;
  /** A sandwich: `currentStockBase` is how many its ingredients can make. */
  isSandwich?: boolean;
}

/**
 * Older versions kept a copy of the sales list in `localStorage` under this prefix and showed
 * it as recorded sales — including sales the server had rejected (QA-09). The server's list is
 * now the only source, so the old copy is removed instead of read.
 */
const LEGACY_SALES_KEY_PREFIX = "hesba_sales_records";
const STAGED_KEY = "hesba_staged_sale_item";

function removeLegacySalesCopy(storeId?: string): void {
  try {
    localStorage.removeItem(
      `${LEGACY_SALES_KEY_PREFIX}_${storeId || "default"}`,
    );
    localStorage.removeItem(`${LEGACY_SALES_KEY_PREFIX}_default`);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

function getServicesStorageKey(storeId?: string): string {
  return `hesba_sales_enabled_services_${storeId || "default"}`;
}

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatCairoTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ar-EG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Cairo",
    });
  } catch {
    const d = new Date(ts);
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "م" : "ص";
    return `${h}:${m} ${ampm}`;
  }
}

function getPackLabel(packName?: string | null, packQty?: number): string {
  if (packName) {
    const p = packName.toLowerCase();
    if (p === "dozen" || p === "دستة" || packQty === 12) return "دستة";
    if (p === "carton" || p === "كرتونة") return "كرتونة";
    if (p === "bag" || p === "كيس") return "كيس";
    if (p === "box" || p === "علبة") return "علبة";
    return packName;
  }
  if (packQty === 12) return "دستة";
  return "كرتونة";
}

function getUnitWord(u?: string): string {
  const val = (u || "").toLowerCase();
  if (val === "can" || val === "علبة") return "علبة";
  if (val === "jar" || val === "برطمان") return "برطمان";
  if (val === "bag" || val === "كيس") return "كيس";
  if (val === "carton" || val === "كرتونة") return "كرتونة";
  if (val && !["piece", "unit", "قطعة"].includes(val)) return val;
  return "قطعة";
}

function formatStockText(item: DisplaySaleItem): string {
  if (item.isSandwich) {
    return item.currentStockBase > 0
      ? t("sandwich.canMake", { count: item.currentStockBase })
      : t("sandwich.notEnough");
  }
  if (item.isService) {
    return item.brandName ? `ماكينة ${item.brandName}` : "خدمة دفع فورية";
  }

  if (item.currentStockBase <= 0) {
    return "خلصان";
  }

  if (item.unitMode === "weight") {
    if (item.currentStockBase >= 1000) {
      const kg = Math.round((item.currentStockBase / 1000) * 10) / 10;
      return `${kg} كجم`;
    }
    return `${item.currentStockBase} جرام`;
  }

  const unitWord = getUnitWord(item.unit);
  const packQty = item.packQty || 1;
  const packLabel = getPackLabel(item.packName, item.packQty);
  if (packQty > 1) {
    const cartons = Math.floor(item.currentStockBase / packQty);
    const pieces = item.currentStockBase % packQty;
    if (cartons > 0 && pieces > 0) {
      return `${cartons} ${packLabel} و ${pieces} ${unitWord}`;
    }
    if (cartons > 0) {
      return `${cartons} ${packLabel}`;
    }
    return `${pieces} ${unitWord}`;
  }

  return `${item.currentStockBase} ${unitWord}`;
}

function loadInitialData(storeId?: string): {
  initialEnabledServices: string[];
  stagedSaleItem: DisplaySaleItem | null;
} {
  let initialEnabledServices: string[] = [];
  let stagedSaleItem: DisplaySaleItem | null = null;

  if (typeof window !== "undefined" || typeof localStorage !== "undefined") {
    removeLegacySalesCopy(storeId);

    try {
      const rawServices = localStorage.getItem(getServicesStorageKey(storeId));
      if (rawServices) {
        initialEnabledServices = JSON.parse(rawServices);
      }
    } catch {
      // Ignore
    }

    try {
      const rawStaged = sessionStorage?.getItem(STAGED_KEY);
      if (rawStaged) {
        const staged = JSON.parse(rawStaged);
        if (staged && staged.name) {
          // Staging only puts the service's tile on the screen. It records nothing: a sale
          // exists only once the server has recorded it (ADR-0019).
          if (staged.id && !initialEnabledServices.includes(staged.id)) {
            initialEnabledServices.push(staged.id);
            try {
              localStorage.setItem(
                getServicesStorageKey(storeId),
                JSON.stringify(initialEnabledServices),
              );
            } catch {
              // Ignore
            }
          }

          stagedSaleItem = {
            id: staged.id || "staged",
            productId: staged.id || "staged",
            name: staged.name,
            sellPricePiasters: Number(staged.sellPricePiasters) || 0,
            unitMode: "service",
            packQty: 1,
            currentStockBase: 999,
            status: "ok",
            isService: true,
            category: staged.category,
          };

          sessionStorage.removeItem(STAGED_KEY);
        }
      }
    } catch {
      // Ignore
    }
  }

  return { initialEnabledServices, stagedSaleItem };
}

export function SalesView({
  onNavigate,
}: {
  /** After a credit sale the owner lands on People → «ليك» (the customer's balance). */
  onNavigate?: (route: "people") => void;
} = {}) {
  const { session } = useAuth();
  const storeId = session?.store?.id;
  // The shop that owns the sales queue: the signed-in shop, or — while the session is not
  // loaded (offline, or just back online) — the shop last signed in on this device (ADR-0020).
  const queueStoreId = storeId ?? lastOutboxStore();

  const initial = useMemo(() => loadInitialData(storeId), [storeId]);
  // The server's recorded sales (QA-09). null = not loaded yet.
  const [salesOverview, setSalesOverview] = useState<SalesOverview | null>(
    null,
  );
  const [salesLoadFailed, setSalesLoadFailed] = useState(false);
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  // QA-31: the cart (several items, one invoice) and the invoice details (returns, credit).
  // The first load of the tiles is still on its way: show placeholders, never "no products".
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [cartMode, setCartMode] = useState(false);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  // A credit sale (آجل): the customer is chosen once, then every item goes on one invoice.
  const [creditCustomer, setCreditCustomer] = useState<CreditCustomer | null>(
    null,
  );
  const [creditFormOpen, setCreditFormOpen] = useState(false);
  // The card whose «آجل» opened the customer form: added once the customer is chosen.
  const [pendingCreditItem, setPendingCreditItem] =
    useState<DisplaySaleItem | null>(null);
  // The invoice and the offers open in sheets, not as big blocks on the screen.
  const [cartOpen, setCartOpen] = useState(false);
  const [promosOpen, setPromosOpen] = useState(false);
  // The invoice draft (discount, payment, customer) and its opId outlive the sheet.
  const [cartDraft, setCartDraft] = useState<CartDraft>(EMPTY_CART_DRAFT);
  const cartOpIdRef = useRef<CartOpId | null>(null);
  const [detailsSaleId, setDetailsSaleId] = useState<string | null>(null);
  const [services, setServices] = useState<StoreProductItem[]>([]);
  const [enabledServiceIds, setEnabledServiceIds] = useState<string[]>(
    initial.initialEnabledServices,
  );
  const [stagedItem] = useState<DisplaySaleItem | null>(initial.stagedSaleItem);

  const [query, setQuery] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  // POS Machines & Selection state
  const [machines, setMachines] = useState<PosMachine[]>(() =>
    getStoredMachines(storeId),
  );
  const [userSelectedMachineId, setUserSelectedMachineId] =
    useState<string>("");

  const reloadMachines = useCallback(async () => {
    const remote = await fetchStoreMachines(storeId);
    setMachines(remote);
  }, [storeId]);

  useEffect(() => {
    let isMounted = true;
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (storeId) {
      fetchStoreMachines(storeId).then((remote) => {
        if (isMounted) setMachines(remote);
      });
    }
    // The event means the local machines cache was just updated (fetchStoreMachines saves
    // and dispatches it), so read the cache. Fetching again here re-dispatched the event and
    // looped forever (UE-20), starving the screen's other requests.
    const onMachinesUpdated = () => {
      if (isMounted) setMachines(getStoredMachines(storeId));
    };
    window.addEventListener("hesba_machines_updated", onMachinesUpdated);
    window.addEventListener(
      "hesba_service_machines_updated",
      onMachinesUpdated,
    );
    return () => {
      isMounted = false;
      window.removeEventListener("hesba_machines_updated", onMachinesUpdated);
      window.removeEventListener(
        "hesba_service_machines_updated",
        onMachinesUpdated,
      );
    };
  }, [storeId]);

  // Modals state
  const [weightModalItem, setWeightModalItem] =
    useState<DisplaySaleItem | null>(null);
  const [serviceModalItem, setServiceModalItem] =
    useState<DisplaySaleItem | null>(null);

  // Weight Modal inputs
  const [weightValue, setWeightValue] = useState("");
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");

  // Service Modal inputs
  const [serviceAmountEgp, setServiceAmountEgp] = useState("");

  // Linked machines for active service modal
  const linkedServiceMachineIds = useMemo(() => {
    if (!serviceModalItem) return [];
    return getServiceLinkedMachineIds(serviceModalItem.productId, storeId);
  }, [serviceModalItem, storeId]);

  const linkedServiceMachines = useMemo(() => {
    return machines.filter((m) => linkedServiceMachineIds.includes(m.id));
  }, [machines, linkedServiceMachineIds]);

  const selectedMachineId =
    userSelectedMachineId &&
    linkedServiceMachines.some((m) => m.id === userSelectedMachineId)
      ? userSelectedMachineId
      : linkedServiceMachines[0]?.id || "";

  // Bottom toast. A sale the server recorded gets "تراجع" (undo): a server-side void
  // (ADR-0022) — nothing changes on screen until the server confirmed it.
  const [activeToast, setActiveToast] = useState<{
    msg: string;
    type?: "success" | "error" | "pending";
    undoSale?: { id: string; name: string };
  } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [voidingSaleId, setVoidingSaleId] = useState<string | null>(null);

  const showToast = useCallback(
    (
      msg: string,
      type: "success" | "error" | "pending",
      undoSale?: { id: string; name: string },
    ) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({ msg, type, undoSale });
      toastTimerRef.current = setTimeout(
        () => setActiveToast(null),
        undoSale ? 6000 : 4500,
      );
    },
    [],
  );

  // Active Promotional clearance offers
  const [activePromotions, setActivePromotions] = useState<
    PublishedPromotion[]
  >([]);
  const [editingPromo, setEditingPromo] = useState<PublishedPromotion | null>(
    null,
  );
  const [allProducts, setAllProducts] = useState<StoreProductItem[]>([]);
  const [sandwiches, setSandwiches] = useState<Sandwich[]>([]);
  const [sandwichesLoaded, setSandwichesLoaded] = useState(false);
  // "إضافة إلى البيع" from Products: the sandwich to open the quantity step for. Read once;
  // the hand-off is cleared below so a reload does not reopen it.
  const [stagedSandwichId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStagedSandwich(),
  );
  const [stagedHandled, setStagedHandled] = useState(false);
  const [qtyBusy, setQtyBusy] = useState(false);
  const [qtyError, setQtyError] = useState<string | null>(null);
  const sellingSandwichRef = useRef(false);
  // The sandwich tile being sold right now (shown busy until the server answers).
  const [sellingSandwichId, setSellingSandwichId] = useState<string | null>(
    null,
  );

  // Load Inventory, Products, and Sales from server asynchronously
  useEffect(() => {
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (!storeId) return;
    let isMounted = true;
    void Promise.all([
      apiGet("/api/stock")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiGet("/api/products?filter=all&scope=sale")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchSandwiches().catch((err: unknown) =>
        err instanceof Error ? err : new Error(t("sandwich.loadFailed")),
      ),
    ]).then(([stockData, prodData, sandwichList]) => {
      if (!isMounted) return;
      if (sandwichList instanceof Error) {
        // Shown, not hidden: without this list the sandwich tiles are missing.
        setActiveToast({
          msg: `${t("sandwich.listFailed")} — ${sandwichList.message}`,
          type: "error",
        });
      } else {
        setSandwiches(sandwichList);
      }
      setSandwichesLoaded(true);
      if (stockData?.inventory) {
        setInventory(stockData.inventory);
      }
      setTilesLoaded(true);
      if (prodData?.products) {
        const allProds: StoreProductItem[] = prodData.products;
        setAllProducts(allProds);
        setServices(allProds.filter((p) => isServiceProduct(p)));
      }
    });

    const syncRemoteSalesConfig = () => {
      apiGet("/api/sales/config")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted) return;
          if (
            data?.config?.enabledServiceIds &&
            Array.isArray(data.config.enabledServiceIds)
          ) {
            const remoteIds: string[] = data.config.enabledServiceIds;
            setEnabledServiceIds((prev) => {
              const combined = Array.from(new Set([...prev, ...remoteIds]));
              try {
                localStorage.setItem(
                  getServicesStorageKey(storeId),
                  JSON.stringify(combined),
                );
              } catch {}
              return combined;
            });
          }
        })
        .catch(() => {});
    };

    const loadPromotions = () => {
      apiGet("/api/promotions")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!isMounted) return;
          if (data?.promotions && Array.isArray(data.promotions)) {
            setActivePromotions(data.promotions);
          }
        })
        .catch(() => {});
    };

    void syncRemoteSalesConfig();
    void loadPromotions();
    window.addEventListener(
      "hesba_sales_config_updated",
      syncRemoteSalesConfig,
    );
    window.addEventListener("hesba_promotions_updated", loadPromotions);

    return () => {
      isMounted = false;
      window.removeEventListener(
        "hesba_sales_config_updated",
        syncRemoteSalesConfig,
      );
      window.removeEventListener("hesba_promotions_updated", loadPromotions);
    };
  }, [storeId]);

  /**
   * Reads the recorded sales from the server — the only source of what was sold (QA-09). An
   * empty list is shown as empty; a failed read keeps the last server answer and says so.
   */
  const reloadSales = useCallback(async () => {
    try {
      const overview = await fetchSalesOverview();
      setSalesOverview(overview);
      setSalesLoadFailed(false);
    } catch {
      setSalesLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (!storeId) return;
    let alive = true;
    const load = () => {
      fetchSalesOverview()
        .then((overview) => {
          if (!alive) return;
          setSalesOverview(overview);
          setSalesLoadFailed(false);
        })
        .catch(() => {
          if (alive) setSalesLoadFailed(true);
        });
    };
    load();
    window.addEventListener("online", load);
    return () => {
      alive = false;
      window.removeEventListener("online", load);
    };
  }, [storeId]);

  // Today's sales (Cairo day) and the total of those not voided, both as the server computed.
  const todaySales: ListedSale[] = salesOverview?.todaySales ?? [];
  const todayActiveCount = salesOverview?.todayCount ?? 0;
  const todayTotalPiasters: number | null =
    salesOverview?.todayTotalPiasters ?? null;

  // Prepare combined items for the Sales Grid
  const displayItems = useMemo<DisplaySaleItem[]>(() => {
    const list: DisplaySaleItem[] = [];

    // 1. Regular physical products present in inventory
    inventory.forEach((inv) => {
      list.push({
        id: inv.productId,
        variantId: inv.variantId,
        productId: inv.productId,
        name: inv.productName,
        sellPricePiasters: inv.sellPricePiasters,
        unitMode: inv.unitMode,
        unit: inv.unit,
        packQty: inv.packQty || 1,
        packName: inv.packName,
        currentStockBase: inv.currentStockBase,
        status: inv.currentStockBase <= 0 ? "out" : inv.status || "ok",
        isService: false,
        category: inv.category,
      });
    });

    // 2. Services & Bills that have been added to sales
    services.forEach((srv) => {
      if (enabledServiceIds.includes(srv.id)) {
        list.push({
          id: srv.id,
          productId: srv.id,
          name: srv.name_ar,
          sellPricePiasters: srv.sell_price_piasters,
          unitMode: "service",
          packQty: 1,
          currentStockBase: 999, // Always available
          status: "ok",
          isService: true,
          category: srv.category,
          brandName: srv.brand_name,
        });
      }
    });

    // 3. Sandwiches: sold from their ingredients' stock (server-checked on every sale)
    sandwiches.forEach((sw) => {
      list.push({
        id: sw.id,
        productId: sw.id,
        name: sw.name,
        sellPricePiasters: sw.sellPricePiasters,
        unitMode: "piece",
        packQty: 1,
        currentStockBase: sw.availableCount,
        status: sw.availableCount > 0 ? "ok" : "out",
        category: sw.category,
        unit: "piece",
        isSandwich: true,
      });
    });

    if (stagedItem && !list.some((it) => it.id === stagedItem.id)) {
      list.push(stagedItem);
    }

    return list;
  }, [inventory, services, enabledServiceIds, stagedItem, sandwiches]);

  // Filtered by Search query
  const filteredItems = useMemo(() => {
    const q = normalizeArabic(query.trim());
    if (!q) return displayItems;
    return displayItems.filter((item) => {
      const name = normalizeArabic(item.name || "");
      const cat = normalizeArabic(item.category || "");
      return name.includes(q) || cat.includes(q);
    });
  }, [displayItems, query]);

  /** Shows the server's stock balance after a sale on the tiles (matched by variant). */
  const applyRecordedStock = useCallback((recorded: RecordedSale) => {
    const after = new Map<string, number>();
    for (const line of recorded.lines) {
      if (line.variantId && line.stockAfterBase !== null) {
        after.set(line.variantId, line.stockAfterBase);
      }
    }
    if (after.size === 0) return;
    setInventory((prev) =>
      prev.map((inv) => {
        const stock = after.get(inv.variantId);
        if (stock === undefined) return inv;
        return {
          ...inv,
          currentStockBase: stock,
          status: stockLevel(inv.unitMode, inv.packQty, stock),
        };
      }),
    );
  }, []);

  /** The shop's sales waiting for the server (the outbox), live from IndexedDB and all tabs. */
  const queuedSales = useLiveQuery(
    () =>
      queueStoreId
        ? listSaleOps(queueStoreId)
        : Promise.resolve([] as SaleOutboxOp[]),
    [queueStoreId],
    [] as SaleOutboxOp[],
  );

  // A queued sale the server has now recorded — right after the tap, or later by a background
  // sync: show the server's stock, and re-read the recorded sales from the server.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const d = (e as CustomEvent<SaleSyncedDetail>).detail;
      if (!d || d.storeId !== queueStoreId) return;
      applyRecordedStock(d.recorded);
      void reloadSales();
      if (d.recorded.machine) void reloadMachines();
    };
    window.addEventListener(SALE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SALE_SYNCED_EVENT, onSynced);
  }, [queueStoreId, applyRecordedStock, reloadSales, reloadMachines]);

  /**
   * The one way a sale is submitted (ADR-0020). The sale is first written to the outbox
   * (IndexedDB) with a new `opId`, then sent to the server's sale transaction:
   * - recorded → "applied" (the list is updated by the synced event);
   * - rejected now (e.g. not enough stock) → removed from the queue and shown as an error;
   * - offline or no answer → "queued": it stays in the outbox, is shown as waiting, and is
   *   sent automatically later with the SAME `opId`, so it can never be recorded twice.
   * `needsServer` (services charged to a POS machine) refuses to start while offline.
   */
  const submitSale = useCallback(
    async (
      request: Omit<SaleRequest, "opId" | "id">,
      summary: SaleOpSummary,
      options: { needsServer?: boolean } = {},
    ): Promise<
      | { kind: "applied"; recorded: RecordedSale }
      | { kind: "queued" }
      | { kind: "failed"; message: string }
    > => {
      if (!queueStoreId) return { kind: "failed", message: t("sale.failed") };
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline && options.needsServer) {
        return { kind: "failed", message: t("sale.serviceOnlineOnly") };
      }
      const full: SaleRequest = {
        ...request,
        opId: generateUuid(),
        id: generateUuid(),
      };
      try {
        await enqueueSale({
          storeId: queueStoreId,
          userId: session?.user?.id,
          request: full,
          summary,
        });
      } catch {
        return { kind: "failed", message: t("sale.storageFailed") };
      }
      if (offline) return { kind: "queued" };

      const outcome = await sendSaleOp(full.opId, queueStoreId);
      switch (outcome.kind) {
        case "applied":
          return { kind: "applied", recorded: outcome.recorded };
        case "rejected":
          // The cashier sees the rejection now: nothing to keep for later review.
          await dismissSaleOp(full.opId, queueStoreId);
          return {
            kind: "failed",
            message: outcome.message || t("sale.failed"),
          };
        case "missing":
          return { kind: "failed", message: t("sale.failed") };
        default:
          scheduleSaleSync(queueStoreId);
          return { kind: "queued" };
      }
    },
    [queueStoreId, session],
  );

  /**
   * Sells one tile (product, carton, weighed item or service). Success is shown only after the
   * server recorded the sale; a queued sale is shown as waiting, never as done.
   *
   * @returns true when the server recorded the sale.
   */
  const recordSale = useCallback(
    async (params: {
      item: DisplaySaleItem;
      quantityBase: number;
      /** What the screen shows; the server uses it only for services (it prices goods). */
      amountPiasters?: number;
      label: string;
      isCarton?: boolean;
      commissionPiasters?: number;
      machineId?: string;
      machineDeductPiasters?: number;
      machineName?: string;
    }): Promise<boolean> => {
      const { item, quantityBase, label } = params;
      const outcome = await submitSale(
        {
          variantId: item.isService ? undefined : item.variantId,
          productId: item.productId,
          name: item.name,
          quantityBase,
          // Used by the server for services only; goods are priced by the server.
          amountPiasters: params.amountPiasters,
          label,
          isCarton: params.isCarton,
          commissionPiasters: params.commissionPiasters,
          machineId: params.machineId,
          machineDeductPiasters: params.machineDeductPiasters,
          machineName: params.machineName,
        },
        {
          name: item.name,
          label,
          amountPiasters: params.amountPiasters ?? 0,
          quantity: quantityBase,
          category: item.category || "عام",
          unit: item.unitMode,
        },
        { needsServer: Boolean(item.isService) },
      );

      if (outcome.kind === "failed") {
        showToast(outcome.message, "error");
        return false;
      }
      if (outcome.kind === "queued") {
        showToast(t("sale.queued", { name: item.name, label }), "pending");
        return false;
      }
      setFlashId(item.id);
      setTimeout(() => setFlashId(null), 450);
      showToast(
        t("sale.sold", {
          name: item.name,
          label,
          amount: formatMoney(outcome.recorded.totalPiasters),
        }),
        "success",
        { id: outcome.recorded.id, name: item.name },
      );
      return true;
    },
    [submitSale, showToast],
  );

  /**
   * Undo (تراجع): asks the server to void the sale (ADR-0022). The server keeps the sale,
   * marks it void and puts its stock back in one transaction; only then does the screen show
   * the server's stock and re-read the sales list. Offline or refused → an error, nothing
   * changes. The same `opId` is used if the cashier taps again while it is being sent.
   */
  const voidOpRef = useRef<{ saleId: string; opId: string } | null>(null);
  const handleUndoSale = useCallback(
    async (target: { id: string; name: string }) => {
      if (voidingSaleId) return;
      if (voidOpRef.current?.saleId !== target.id) {
        voidOpRef.current = { saleId: target.id, opId: generateUuid() };
      }
      setVoidingSaleId(target.id);
      let voided: VoidedSale;
      try {
        voided = await voidSale(target.id, voidOpRef.current.opId);
      } catch (err) {
        setVoidingSaleId(null);
        showToast(
          err instanceof Error ? err.message : t("sale.voidFailed"),
          "error",
        );
        return;
      }
      setVoidingSaleId(null);
      voidOpRef.current = null;
      const after = new Map(
        voided.stock.map((s) => [s.variantId, s.stockAfterBase]),
      );
      setInventory((prev) =>
        prev.map((inv) => {
          const stock = after.get(inv.variantId);
          if (stock === undefined) return inv;
          return {
            ...inv,
            currentStockBase: stock,
            status: stockLevel(inv.unitMode, inv.packQty, stock),
          };
        }),
      );
      showToast(t("sale.voided", { name: target.name }), "success");
      void reloadSales();
      if (voided.machine) void reloadMachines();
      // Sandwich tiles show how many their ingredients can make: read them again.
      void fetchSandwiches()
        .then(setSandwiches)
        .catch(() => undefined);
    },
    [voidingSaleId, showToast, reloadSales, reloadMachines],
  );

  // Sell a published offer (bundle or single clearance offer). The server reads the offer's
  // items and price, checks and deducts every item's stock, and records one sale (ADR-0019).
  const handleSellPromotion = useCallback(
    async (promo: PublishedPromotion) => {
      // Quick local check for a clear message; the server checks again under lock.
      for (const bItem of promo.items) {
        const inv = inventory.find((i) => i.productId === bItem.productId);
        const available = inv ? inv.currentStockBase : 999999;
        if (available < bItem.quantityBase) {
          showToast(
            `الكمية غير كافية بالمخزون لإتمام العرض: «${bItem.productName}»`,
            "error",
          );
          return;
        }
      }

      const outcome = await submitSale(
        { promotionId: promo.id },
        {
          name: promo.title,
          label: "عرض",
          amountPiasters: promo.promoPricePiasters,
          quantity: 1,
          category: "عروض ترويجية",
          unit: "عرض",
        },
      );
      if (outcome.kind === "failed") {
        showToast(outcome.message, "error");
      } else if (outcome.kind === "queued") {
        showToast(
          t("sale.queued", { name: promo.title, label: "عرض" }),
          "pending",
        );
      } else {
        showToast(
          t("sale.promoSold", {
            title: promo.title,
            amount: formatMoney(outcome.recorded.totalPiasters),
          }),
          "success",
          { id: outcome.recorded.id, name: promo.title },
        );
      }
    },
    [inventory, showToast, submitSale],
  );

  // Delete promotional offer from sales page
  const handleDeletePromotion = useCallback(async (promoId: string) => {
    try {
      const res = await fetch(
        `/api/promotions?id=${encodeURIComponent(promoId)}`,
        {
          method: "DELETE",
        },
      );
      // 404: the offer is already gone (QA-35) — remove it from the list all the same.
      if (res.ok || res.status === 404) {
        setActivePromotions((prev) => prev.filter((p) => p.id !== promoId));
        window.dispatchEvent(new CustomEvent("hesba_promotions_updated"));
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: "تم حذف العرض من شاشة البيع بنجاح ✓",
          type: "success",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      } else {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: "تعذر حذف العرض، حاول مرة أخرى",
          type: "error",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      }
    } catch {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: "حدث خطأ أثناء حذف العرض",
        type: "error",
      });
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
    }
  }, []);

  // Save edited promotional offer
  const handleSaveEditedPromotion = useCallback(
    async (promo: SuggestedPromotion) => {
      try {
        const res = await fetch("/api/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(promo),
        });
        const json = (await res.json().catch(() => null)) as {
          promotion?: PublishedPromotion;
          error?: { message?: string };
        } | null;
        if (res.ok && json?.promotion) {
          // Keep the offer as the server priced it, not the client's copy (QA-20).
          const saved = json.promotion;
          setEditingPromo(null);
          setActivePromotions((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = saved;
              return updated;
            }
            return [...prev, saved];
          });
          window.dispatchEvent(new CustomEvent("hesba_promotions_updated"));
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setActiveToast({
            msg: `تم حفظ وتحديث العرض "${promo.title}" بنجاح ✓`,
            type: "success",
          });
          toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
        } else {
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setActiveToast({
            // The server's reason (e.g. the price is not below the original), QA-20.
            msg: json?.error?.message || "تعذر حفظ التعديلات، حاول مرة أخرى",
            type: "error",
          });
          toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
        }
      } catch {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: "حدث خطأ أثناء حفظ العرض",
          type: "error",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      }
    },
    [],
  );

  /**
   * Sells `count` sandwiches as ONE sale through the same outbox path as every sale
   * (ADR-0020). Success is shown only after the server recorded the sale and deducted the
   * ingredients; offline or without an answer the sale is queued (and shown as waiting).
   * Returns the server's error message when the sale was rejected.
   */
  const handleSellSandwich = useCallback(
    async (
      item: DisplaySaleItem,
      count = 1,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (sellingSandwichRef.current) {
        return { ok: false, message: t("sandwich.sellBusy") };
      }
      sellingSandwichRef.current = true;
      setSellingSandwichId(item.id);
      try {
        const estimate = calculateLineTotal(item.sellPricePiasters, count);
        const outcome = await submitSale(
          { productId: item.productId, name: item.name, quantityBase: count },
          {
            name: item.name,
            label: `${count}`,
            amountPiasters: estimate,
            quantity: count,
            category: item.category || "",
            unit: "piece",
          },
        );
        if (outcome.kind === "failed") {
          return { ok: false, message: outcome.message };
        }
        if (outcome.kind === "queued") {
          showToast(
            t("sale.queued", { name: item.name, label: `${count}` }),
            "pending",
          );
          return { ok: true };
        }
        const amountPiasters = outcome.recorded.totalPiasters;
        setFlashId(item.id);
        setTimeout(() => setFlashId(null), 450);
        showToast(
          count > 1
            ? t("sandwich.soldMany", {
                count,
                name: item.name,
                amount: formatMoney(amountPiasters),
              })
            : t("sandwich.sold", {
                name: item.name,
                amount: formatMoney(amountPiasters),
              }),
          "success",
          { id: outcome.recorded.id, name: item.name },
        );
        // Refresh ingredient stock and "can make N" counts from the server in the background:
        // the sale is already recorded, so the caller (e.g. the quantity step) can close now.
        void Promise.all([
          apiGet("/api/stock")
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetchSandwiches().catch(() => null),
        ]).then(([stockData, sandwichList]) => {
          if (stockData?.inventory) setInventory(stockData.inventory);
          if (sandwichList) setSandwiches(sandwichList);
        });
        return { ok: true };
      } finally {
        sellingSandwichRef.current = false;
        setSellingSandwichId(null);
      }
    },
    [submitSale, showToast],
  );

  useEffect(() => {
    if (stagedSandwichId) clearStagedSandwich();
  }, [stagedSandwichId]);

  // The quantity step is open while a staged sandwich is waiting and has been found.
  const stagedOpen = Boolean(stagedSandwichId) && !stagedHandled;
  const qtyItem = stagedOpen
    ? displayItems.find((i) => i.isSandwich && i.id === stagedSandwichId)
    : undefined;
  const stagedMissing = stagedOpen && sandwichesLoaded && !qtyItem;

  const closeQuantitySheet = () => {
    setStagedHandled(true);
    setQtyError(null);
  };

  const confirmQuantity = async (quantity: number) => {
    if (!qtyItem) return;
    setQtyBusy(true);
    setQtyError(null);
    const outcome = await handleSellSandwich(qtyItem, quantity);
    setQtyBusy(false);
    if (outcome.ok) {
      closeQuantitySheet();
    } else {
      setQtyError(outcome.message);
    }
  };

  /**
   * Adds one unit (1 kg for a weighed product) of a stocked product to the invoice draft.
   * Services and sandwiches are sold on their own. The server prices and checks the stock at
   * checkout; here the quantity is only capped at the shown stock.
   */
  const addToCart = (item: DisplaySaleItem, units?: number): boolean => {
    if (item.isService || item.isSandwich || !item.variantId) {
      showToast(
        t("invoice.cartServiceNotAllowed", { name: item.name }),
        "error",
      );
      return false;
    }
    const variantId = item.variantId;
    const weighed = item.unit === "kg" || item.unit === "g";
    const step = units ?? (weighed ? Math.min(1000, item.currentStockBase) : 1);
    if (step <= 0) {
      showToast(`«${item.name}» خلصان`, "error");
      return false;
    }
    if (creditCustomer) {
      showToast(
        t("credit.added", { customer: creditCustomer.name, name: item.name }),
        "success",
      );
    }
    setCartLines((prev) => {
      const found = prev.find((l) => l.variantId === variantId);
      if (found) {
        return prev.map((l) =>
          l.variantId === variantId
            ? {
                ...l,
                quantityBase: Math.min(
                  l.quantityBase + step,
                  item.currentStockBase,
                ),
              }
            : l,
        );
      }
      return [
        ...prev,
        {
          variantId,
          name: item.name,
          unit: item.unit ?? "piece",
          quantityBase: step,
          sellPricePiasters: item.sellPricePiasters,
          stockBase: item.currentStockBase,
        },
      ];
    });
    return true;
  };

  /**
   * A card's «آجل»: within a credit sale the item joins its invoice; otherwise the customer
   * form opens first and the item is added once the customer is chosen. It is the existing
   * invoice-level credit flow; nothing is recorded until «تسجيل الآجل».
   */
  const handleSellOnCredit = (e: React.MouseEvent, item: DisplaySaleItem) => {
    e.stopPropagation();
    if (creditCustomer) {
      addToCart(item);
      return;
    }
    setPendingCreditItem(item);
    setCreditFormOpen(true);
  };

  /** The customer is chosen: a credit sale starts (items already in a draft are kept). */
  const startCreditSale = (customer: CreditCustomer) => {
    setCreditCustomer(customer);
    setCreditFormOpen(false);
    setCartMode(true);
    setCartDraft({ ...EMPTY_CART_DRAFT, method: "debt" });
    showToast(t("credit.started", { name: customer.name }), "success");
    if (pendingCreditItem) {
      const item = pendingCreditItem;
      setPendingCreditItem(null);
      // added after the session state is set, so the toast names the customer
      setTimeout(() => addToCartRef.current?.(item), 0);
    }
  };

  /** Leaves the credit sale; its draft items are dropped (nothing was recorded). */
  const cancelCreditSale = () => {
    setCreditCustomer(null);
    setCartLines([]);
    setCartMode(false);
    setCartOpen(false);
    setCartDraft(EMPTY_CART_DRAFT);
  };

  const addToCartRef = useRef(addToCart);
  useEffect(() => {
    addToCartRef.current = addToCart;
  });

  // Tap handler for a Card
  const handleCardClick = async (item: DisplaySaleItem) => {
    // QA-31: in cart mode a stocked product goes into the cart; the server prices it at checkout.
    if (cartMode) {
      addToCart(item);
      return;
    }
    // 0. Sandwich: the server checks and deducts the ingredients
    if (item.isSandwich) {
      const outcome = await handleSellSandwich(item);
      if (!outcome.ok) showToast(outcome.message, "error");
      return;
    }

    // 1. Service product
    if (item.isService) {
      const linkedIds = getServiceLinkedMachineIds(item.productId, storeId);
      const linkedMachs = machines.filter((m) => linkedIds.includes(m.id));

      if (linkedMachs.length === 0) {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: `الخدمة «${item.name}» مش مربوطة بأي ماكينة دفع — اربطها من قسم المنتجات أولاً`,
          type: "error",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 4000);
        return;
      }

      // If service is variable (utility charging, topup, transfer)
      const name = item.name.toLowerCase();
      const cat = (item.category || "").toLowerCase();
      const isVariable =
        name.includes("كهرباء") ||
        name.includes("مياه") ||
        name.includes("غاز") ||
        name.includes("تحويل") ||
        name.includes("شحن رصيد") ||
        cat.includes("مرافق") ||
        cat.includes("تحويل");

      if (isVariable) {
        setServiceModalItem(item);
        setServiceAmountEgp("");
        setUserSelectedMachineId(linkedMachs[0]?.id || "");
        return;
      }

      // Fixed card (e.g. كارت 10 ج)
      const cardAmountPiasters = item.sellPricePiasters || 1000;
      const targetMachine =
        linkedMachs.find(
          (m) => (m.currentBalancePiasters || 0) >= cardAmountPiasters,
        ) || linkedMachs[0];

      if (!targetMachine) {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: `لا توجد ماكينة دفع صالحة لهذه الخدمة`,
          type: "error",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 4000);
        return;
      }

      if ((targetMachine.currentBalancePiasters || 0) < cardAmountPiasters) {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setActiveToast({
          msg: `رصيد ماكينة «${targetMachine.name}» (${((targetMachine.currentBalancePiasters || 0) / 100).toFixed(2)} ج.م) لا يكفي لبيع كارت بقيمة ${(cardAmountPiasters / 100).toFixed(2)} ج.م`,
          type: "error",
        });
        toastTimerRef.current = setTimeout(() => setActiveToast(null), 4000);
        return;
      }

      // The machine is charged by the server inside the sale transaction (ADR-0020).
      void recordSale({
        item,
        quantityBase: 1,
        amountPiasters: cardAmountPiasters,
        label: `1 كارت (${targetMachine.name})`,
        machineId: targetMachine.id,
        machineDeductPiasters: cardAmountPiasters,
        machineName: targetMachine.name,
      });
      return;
    }

    // 2. Physical product out of stock
    if (item.currentStockBase <= 0) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `المنتج «${item.name}» خلصان من المخزون! ضيفه من صفحة المخزون الأول`,
        type: "error",
      });
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      return;
    }

    // 3. Weighed product
    if (item.unitMode === "weight") {
      setWeightModalItem(item);
      setWeightValue("");
      setWeightUnit("g");
      return;
    }

    // 4. Single piece sale
    void recordSale({
      item,
      quantityBase: 1,
      amountPiasters: item.sellPricePiasters,
      label: "1 قطعة",
    });
  };

  // Sell full carton / pack
  const handleSellCarton = (e: React.MouseEvent, item: DisplaySaleItem) => {
    e.stopPropagation();
    const packQty = item.packQty || 1;
    const packLabel = getPackLabel(item.packName, item.packQty);
    // In an invoice (credit or not) a whole pack joins the draft as its pieces.
    if (cartMode) {
      if (item.currentStockBase < packQty) {
        showToast(
          `مفيش ${packLabel} كاملة من «${item.name}» — المتاح ${item.currentStockBase} فقط`,
          "error",
        );
        return;
      }
      addToCart(item, packQty);
      return;
    }

    if (item.currentStockBase < packQty) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `مفيش ${packLabel} كاملة من «${item.name}» — المتاح ${item.currentStockBase} فقط`,
        type: "error",
      });
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 3500);
      return;
    }

    const cartonPricePiasters = item.sellPricePiasters * packQty;
    void recordSale({
      item,
      quantityBase: packQty,
      amountPiasters: cartonPricePiasters,
      label: `1 ${packLabel}`,
      isCarton: true,
    });
  };

  // Submit Weight Sale
  const handleWeightSubmit = () => {
    if (!weightModalItem) return;
    const num = parseFloat(weightValue) || 0;
    if (num <= 0) return;

    const grams =
      weightUnit === "kg" ? Math.round(num * 1000) : Math.round(num);
    const kg = grams / 1000;

    if (grams > weightModalItem.currentStockBase) return;

    const amountPiasters = Math.round(kg * weightModalItem.sellPricePiasters);
    const label = grams >= 1000 ? `${kg} كجم` : `${grams} جرام`;

    void recordSale({
      item: weightModalItem,
      quantityBase: grams,
      amountPiasters,
      label,
    });

    setWeightModalItem(null);
  };

  // Submit Service Sale
  const handleServiceSubmit = async () => {
    if (!serviceModalItem) return;
    const amountEgp = parseFloat(serviceAmountEgp) || 0;
    if (amountEgp <= 0) return;

    const principalPiasters = Math.round(amountEgp * 100);
    const chosenMachine =
      linkedServiceMachines.find((m) => m.id === selectedMachineId) ||
      linkedServiceMachines[0];

    if (!chosenMachine) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: "لا توجد ماكينة دفع صالحة مربوطة بهذه الخدمة",
        type: "error",
      });
      return;
    }

    if ((chosenMachine.currentBalancePiasters || 0) < principalPiasters) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActiveToast({
        msg: `رصيد ماكينة «${chosenMachine.name}» (${((chosenMachine.currentBalancePiasters || 0) / 100).toFixed(2)} ج.م) لا يكفي لشحن ${amountEgp} ج.م`,
        type: "error",
      });
      return;
    }

    const commissionPiasters =
      serviceModalItem.sellPricePiasters > 0
        ? serviceModalItem.sellPricePiasters
        : 500; // 5 EGP default

    const totalCustomerPiasters = principalPiasters + commissionPiasters;

    // The machine is charged by the server inside the sale transaction (ADR-0020).
    void recordSale({
      item: serviceModalItem,
      quantityBase: 1,
      amountPiasters: totalCustomerPiasters,
      label: `شحن ${amountEgp} ج.م (${chosenMachine.name})`,
      commissionPiasters,
      machineId: chosenMachine.id,
      machineDeductPiasters: principalPiasters,
      machineName: chosenMachine.name,
    });

    setServiceModalItem(null);
    setServiceAmountEgp("");
  };

  // Weight modal calculations
  const weightNum = parseFloat(weightValue) || 0;
  const weightGrams =
    weightUnit === "kg" ? Math.round(weightNum * 1000) : Math.round(weightNum);
  const weightKg = weightGrams / 1000;
  const weightAmountEgp =
    weightModalItem && weightKg > 0
      ? Math.round(weightKg * (weightModalItem.sellPricePiasters / 100) * 100) /
        100
      : 0;
  const weightExceedsStock =
    weightModalItem && weightGrams > weightModalItem.currentStockBase;

  // Service modal calculations
  const serviceAmountNum = parseFloat(serviceAmountEgp) || 0;
  const chosenServiceMachine =
    linkedServiceMachines.find((m) => m.id === selectedMachineId) ||
    linkedServiceMachines[0];

  const principalRequiredPiasters = Math.round(serviceAmountNum * 100);
  const isBalanceInsufficient =
    Boolean(chosenServiceMachine) &&
    serviceAmountNum > 0 &&
    (chosenServiceMachine?.currentBalancePiasters || 0) <
      principalRequiredPiasters;

  const serviceCommissionEgp =
    serviceModalItem && serviceModalItem.sellPricePiasters > 0
      ? serviceModalItem.sellPricePiasters / 100
      : 5;
  const serviceTotalEgp =
    serviceAmountNum > 0 ? serviceAmountNum + serviceCommissionEgp : 0;

  return (
    <div className={viewStyles.view} data-testid="page-sales" dir="rtl">
      <div className={styles.salesContainer}>
        {/* Search Box matching Image 1 */}
        <div className={styles.searchWrapper}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="دوّر على صنف..."
            voice={true}
          />
        </div>

        {/* Today's Sales Pill & Legend matching Image 1 */}
        <div className={styles.sBar}>
          <div className={styles.sTotal} data-testid="today-sales-pill">
            <span className={styles.sTotalLabel}>مبيعات النهارده</span>
            <b className={styles.sTotalAmount} data-testid="today-sales-total">
              {todayTotalPiasters === null
                ? "—"
                : formatMoney(todayTotalPiasters)}
            </b>
          </div>

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <i className={`${styles.legendBox} ${styles.out}`} />
              <span>خلصان</span>
            </span>
            <span className={styles.legendItem}>
              <i className={`${styles.legendBox} ${styles.low}`} />
              <span>قرب يخلص</span>
            </span>
          </div>
        </div>

        {/* Offers and the multi-item invoice: two small controls, opened in sheets */}
        <div className={styles.salesTools}>
          {activePromotions.length > 0 && (
            <Button
              kind="ghost"
              size="sm"
              icon="sparkle"
              data-testid="promos-toggle"
              onClick={() => setPromosOpen(true)}
            >
              {t("invoice.promos")} ({activePromotions.length})
            </Button>
          )}
          {!creditCustomer && (
            <Button
              kind={cartMode ? "primary" : "ghost"}
              size="sm"
              icon="plus"
              data-testid="cart-toggle"
              aria-pressed={cartMode}
              onClick={() => setCartMode((v) => !v)}
            >
              {t("invoice.cartToggle")}
              {cartLines.length > 0 ? ` (${cartLines.length})` : ""}
            </Button>
          )}
          {/* The credit-sale entry point: the customer first, then the items */}
          <Button
            kind={creditCustomer ? "primary" : "ghost"}
            size="sm"
            icon="users"
            data-testid="credit-start"
            aria-pressed={!!creditCustomer}
            onClick={() =>
              creditCustomer ? setCartOpen(true) : setCreditFormOpen(true)
            }
          >
            {creditCustomer
              ? t("credit.sessionLabel", { name: creditCustomer.name })
              : t("credit.start")}
          </Button>
        </div>

        {/* Product & Services Tiles Grid matching Image 1 */}
        {!tilesLoaded && displayItems.length === 0 ? (
          <div
            className={styles.tgrid}
            role="status"
            aria-label={t("common.loading")}
            data-testid="sales-tiles-loading"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={96} radius={16} />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className={viewStyles.card}>
            <Empty
              icon="search"
              title={
                query
                  ? "مفيش صنف بالاسم ده"
                  : "لسه مفيش منتجات أو خدمات في البيع"
              }
              sub={
                query
                  ? "تأكد من كتابة اسم المنتج بشكل صحيح"
                  : "ضيف بضاعة في المخزون أو اضغط «إضافة إلى البيع» على أي خدمة من قسم المنتجات"
              }
            />
          </div>
        ) : (
          <div className={styles.tgrid}>
            {filteredItems.map((item) => {
              const isLow = item.status === "low";
              const isOut = item.status === "out";
              const isPop = flashId === item.id;
              const hasCartonBtn =
                !item.isService &&
                item.unitMode === "piece" &&
                item.packQty > 1 &&
                !isOut;
              // «آجل»: stocked products only (services and sandwiches are sold on their own).
              const hasCreditBtn =
                !item.isService &&
                !item.isSandwich &&
                !!item.variantId &&
                !isOut;

              return (
                <div
                  key={item.id}
                  className={`${styles.tile} ${isLow ? styles.low : ""} ${isOut ? styles.out : ""} ${isPop ? styles.pop : ""}`}
                >
                  <button
                    type="button"
                    className={styles.tMain}
                    onClick={() => handleCardClick(item)}
                    aria-label={`بيع ${item.name}`}
                    disabled={item.isSandwich && sellingSandwichId === item.id}
                    aria-busy={
                      item.isSandwich && sellingSandwichId === item.id
                        ? true
                        : undefined
                    }
                  >
                    <span className={styles.tN}>{item.name}</span>

                    <span className={styles.tP}>
                      {item.unitMode === "weight" ? (
                        <>
                          <Icon n="scale" s={14} />
                          <span>{item.sellPricePiasters / 100} ج / كجم</span>
                        </>
                      ) : item.isService ? (
                        <span>
                          {item.sellPricePiasters > 0
                            ? `عمولة ${item.sellPricePiasters / 100} ج`
                            : "شحن فوري"}
                        </span>
                      ) : (
                        <span>{item.sellPricePiasters / 100} ج</span>
                      )}
                    </span>

                    <span className={styles.tS}>{formatStockText(item)}</span>
                  </button>

                  {(hasCartonBtn || hasCreditBtn) && (
                    <div className={styles.tActions}>
                      {/* Secondary Packaging Button (كرتونة / دستة / كيس / باكت) */}
                      {hasCartonBtn && (
                        <button
                          type="button"
                          className={styles.tPack}
                          onClick={(e) => handleSellCarton(e, item)}
                          title={`بيع ${getPackLabel(item.packName, item.packQty)} (${item.packQty} قطعة)`}
                          aria-label={`بيع ${getPackLabel(item.packName, item.packQty)} ${item.name}`}
                        >
                          <Icon n="box" s={16} />
                          <span>
                            {getPackLabel(item.packName, item.packQty)}
                          </span>
                        </button>
                      )}
                      {hasCreditBtn && (
                        <button
                          type="button"
                          className={`${styles.tPack} ${styles.tCredit}`}
                          data-testid="tile-credit"
                          onClick={(e) => handleSellOnCredit(e, item)}
                          title={t("invoice.creditActionLabel", {
                            name: item.name,
                          })}
                          aria-label={t("invoice.creditActionLabel", {
                            name: item.name,
                          })}
                        >
                          <Icon n="users" s={15} />
                          <span>{t("invoice.creditAction")}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* QA-31 invoice: a small summary that opens the invoice sheet */}
        {(cartMode || cartLines.length > 0) && (
          <button
            type="button"
            className={styles.cartSummary}
            data-testid="cart-summary"
            aria-label={t("invoice.cartOpen")}
            onClick={() => setCartOpen(true)}
          >
            <Icon n="list" s={16} />
            <span>
              {creditCustomer ? `${t("credit.start")} · ` : ""}
              {t("invoice.cartSummary", {
                count: cartLines.length,
                total: formatMoney(
                  cartLines.reduce(
                    (sum, l) =>
                      sum +
                      saleLineTotalPiasters(
                        l.unit,
                        l.sellPricePiasters,
                        l.quantityBase,
                      ),
                    0,
                  ),
                ),
              })}
            </span>
          </button>
        )}

        {/* Recent Sales List matching Image 3 */}
        {queuedSales.length > 0 && (
          <section
            className={styles.queueSection}
            data-testid="sale-queue"
            aria-label={t("outbox.title")}
          >
            <div className={styles.queueHead}>
              <div>
                <b>{t("outbox.title")}</b>
                <small>{t("outbox.hint")}</small>
              </div>
              <button
                type="button"
                className={styles.queueSyncBtn}
                onClick={() => scheduleSaleSync(queueStoreId, { now: true })}
                data-testid="sale-queue-sync"
              >
                <Icon n="refresh" s={14} />
                <span>{t("outbox.syncNow")}</span>
              </button>
            </div>
            <ul className={styles.queueList}>
              {queuedSales.map((op) => {
                const review =
                  op.status === "rejected" || op.status === "quarantined";
                return (
                  <li
                    key={op.op_id}
                    className={`${styles.queueRow} ${review ? styles.queueRowBad : ""}`}
                    data-testid="sale-queue-row"
                    data-status={op.status}
                  >
                    <div className={styles.queueInfo}>
                      <span className={styles.rcName}>
                        {op.summary.name}
                        <small> · {op.summary.label}</small>
                      </span>
                      <span className={styles.queueStatus}>
                        {t(`outbox.status.${op.status}`)}
                        {review && op.last_error ? ` — ${op.last_error}` : ""}
                      </span>
                    </div>
                    {review && (
                      <div className={styles.queueActions}>
                        <button
                          type="button"
                          className={styles.queueBtn}
                          onClick={() => {
                            if (queueStoreId)
                              void retrySaleOp(op.op_id, queueStoreId);
                          }}
                        >
                          {t("outbox.retry")}
                        </button>
                        <button
                          type="button"
                          className={styles.queueBtnGhost}
                          onClick={() => {
                            if (queueStoreId)
                              void dismissSaleOp(op.op_id, queueStoreId);
                          }}
                        >
                          {t("outbox.dismiss")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className={styles.recentSection}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: "1.5px solid var(--line)",
            }}
          >
            <div>
              <h3 className={styles.recentTitle} style={{ margin: 0 }}>
                آخر البيعات
              </h3>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                {todayActiveCount === 0
                  ? "مفيش بيعات اتسجلت لسه"
                  : `${todayActiveCount} ${todayActiveCount === 1 ? "عملية بيع اليوم" : "عمليات بيع اليوم"}`}
              </span>
            </div>
            {todayTotalPiasters !== null && todayActiveCount > 0 && (
              <div style={{ textAlign: "left" }}>
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink2)",
                    display: "block",
                  }}
                >
                  إجمالي مبيعات اليوم
                </span>
                <b
                  style={{
                    fontSize: 16,
                    color: "var(--ok, #108e5c)",
                    fontWeight: 800,
                  }}
                >
                  {formatMoney(todayTotalPiasters)}
                </b>
              </div>
            )}
          </div>

          {salesLoadFailed && (
            <div className={styles.salesLoadError} role="alert">
              <span>{t("sale.listFailed")}</span>
              <button
                type="button"
                className={styles.queueBtn}
                onClick={() => void reloadSales()}
              >
                {t("sale.listRetry")}
              </button>
            </div>
          )}
          {salesOverview === null ? (
            !salesLoadFailed && (
              <div
                style={{
                  color: "var(--ink2)",
                  fontSize: 13.5,
                  padding: "10px 2px",
                }}
              >
                {t("common.loading")}
              </div>
            )
          ) : todaySales.length === 0 ? (
            <div
              style={{
                color: "var(--ink2)",
                fontSize: 13.5,
                padding: "10px 2px",
              }}
            >
              لسه مفيش مبيعات اتسجلت النهارده
            </div>
          ) : (
            <div
              className={styles.recentList}
              style={{ maxHeight: 380, overflowY: "auto" }}
              data-testid="recent-sales"
            >
              {todaySales.map((sale) => (
                <div
                  key={sale.id}
                  className={`${styles.rcRow} ${sale.voided ? styles.rcVoided : ""}`}
                  data-testid="recent-sale-row"
                  data-voided={sale.voided ? "true" : "false"}
                >
                  <span className={styles.rcName}>
                    {sale.name}
                    {sale.voided && (
                      <small className={styles.rcVoidBadge}>
                        {t("sale.voidedBadge")}
                      </small>
                    )}
                  </span>
                  <div className={styles.rcMeta}>
                    <span className={styles.rcTime}>
                      {formatCairoTime(sale.timestamp)}
                    </span>
                    <b className={styles.rcAmount}>
                      {formatMoney(sale.amountPiasters)}
                    </b>
                    {!sale.voided && (
                      <button
                        type="button"
                        className={styles.rcDetails}
                        data-testid="sale-details"
                        aria-label={`${t("invoice.details")} ${sale.name}`}
                        onClick={() => setDetailsSaleId(sale.id)}
                      >
                        {t("invoice.details")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailsSaleId && (
        <SaleInvoiceModal
          saleId={detailsSaleId}
          onClose={() => setDetailsSaleId(null)}
          onChanged={(message) => {
            showToast(message, "success");
            void reloadSales();
            void apiGet("/api/stock")
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => d?.inventory && setInventory(d.inventory))
              .catch(() => undefined);
          }}
        />
      )}

      {/* Weight Modal Popup matching Image 2 */}
      {weightModalItem && (
        <>
          <div
            className={styles.wpShield}
            onClick={() => setWeightModalItem(null)}
          />
          <div className={styles.wpop} role="dialog" aria-modal="true">
            <div className={styles.wpHeader}>
              <span className={styles.wpTitle}>{weightModalItem.name}</span>
              <span className={styles.wpSubtitle}>
                {weightModalItem.sellPricePiasters / 100} ج / كجم
              </span>
            </div>

            <div className={styles.wpRow}>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                className={styles.wpInput}
                placeholder="الوزن"
                value={weightValue}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0.0-9.]/g, "");
                  setWeightValue(cleaned);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    weightNum > 0 &&
                    !weightExceedsStock
                  ) {
                    handleWeightSubmit();
                  }
                }}
              />

              <div className={styles.wpSeg}>
                <button
                  type="button"
                  className={`${styles.wpSegBtn} ${weightUnit === "g" ? styles.active : ""}`}
                  onClick={() => {
                    setWeightUnit("g");
                    setWeightValue("");
                  }}
                >
                  جرام
                </button>
                <button
                  type="button"
                  className={`${styles.wpSegBtn} ${weightUnit === "kg" ? styles.active : ""}`}
                  onClick={() => {
                    setWeightUnit("kg");
                    setWeightValue("");
                  }}
                >
                  كيلو
                </button>
              </div>
            </div>

            {/* Quick Chips matching Image 2 */}
            <div className={styles.wpChips}>
              {weightUnit === "g" ? (
                <>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("100")}
                  >
                    100
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("250")}
                  >
                    250
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("500")}
                  >
                    500
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("1000")}
                  >
                    1000
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("0.25")}
                  >
                    0.25
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("0.5")}
                  >
                    0.5
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("1")}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    className={styles.wpChip}
                    onClick={() => setWeightValue("2")}
                  >
                    2
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              className={styles.wpActionBtn}
              disabled={!(weightNum > 0) || !!weightExceedsStock}
              onClick={handleWeightSubmit}
            >
              {weightExceedsStock
                ? `المتاح ${formatStockText(weightModalItem)}`
                : weightNum > 0
                  ? `بيع — ${weightAmountEgp} ج.م`
                  : "اكتب الوزن"}
            </button>
          </div>
        </>
      )}

      {/* Service Sale Modal Popup */}
      {serviceModalItem && (
        <>
          <div
            className={styles.wpShield}
            onClick={() => setServiceModalItem(null)}
          />
          <div className={styles.wpop} role="dialog" aria-modal="true">
            <div className={styles.wpHeader}>
              <span className={styles.wpTitle}>{serviceModalItem.name}</span>
              <span className={styles.wpSubtitle}>
                {serviceModalItem.brandName || "دفع إلكتروني"}
              </span>
            </div>

            {/* Machine selection or indicator */}
            {linkedServiceMachines.length > 1 ? (
              <div className={styles.machineSelector}>
                <span className={styles.machineSelectorLabel}>
                  اختر ماكينة الخصم:
                </span>
                <div className={styles.machinePills}>
                  {linkedServiceMachines.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`${styles.machinePill} ${
                        (chosenServiceMachine?.id || "") === m.id
                          ? styles.active
                          : ""
                      }`}
                      onClick={() => setUserSelectedMachineId(m.id)}
                    >
                      <span>{m.name}</span>
                      <span className={styles.machinePillBal}>
                        {((m.currentBalancePiasters || 0) / 100).toFixed(0)} ج
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : linkedServiceMachines.length === 1 &&
              linkedServiceMachines[0] ? (
              <div className={styles.singleMachineBadge}>
                <Icon n="check" s={14} />
                <span>
                  ماكينة: <b>{linkedServiceMachines[0].name}</b>
                </span>
                <span className={styles.machineBalanceTag}>
                  (الرصيد المتاح:{" "}
                  {(
                    (linkedServiceMachines[0].currentBalancePiasters || 0) / 100
                  ).toFixed(2)}{" "}
                  ج.م)
                </span>
              </div>
            ) : (
              <div className={styles.balanceAlert}>
                <Icon n="alert" s={16} />
                <span>تحذير: لا توجد ماكينة دفع مربوطة بهذه الخدمة!</span>
              </div>
            )}

            {/* Insufficient balance alert */}
            {isBalanceInsufficient && chosenServiceMachine && (
              <div className={styles.balanceAlert}>
                <Icon n="alert" s={16} />
                <span>
                  رصيد ماكينة {chosenServiceMachine.name} غير كافٍ! المتاح{" "}
                  {(
                    (chosenServiceMachine.currentBalancePiasters || 0) / 100
                  ).toFixed(2)}{" "}
                  ج.م فقط
                </span>
              </div>
            )}

            <div className={styles.wpRow}>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                className={styles.wpInput}
                placeholder="المبلغ المطلوب (ج.م)"
                value={serviceAmountEgp}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                  setServiceAmountEgp(cleaned);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && serviceAmountNum > 0) {
                    handleServiceSubmit();
                  }
                }}
              />
            </div>

            {/* Quick Chips for Services */}
            <div className={styles.wpChips}>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("50")}
              >
                50
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("100")}
              >
                100
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("200")}
              >
                200
              </button>
              <button
                type="button"
                className={styles.wpChip}
                onClick={() => setServiceAmountEgp("500")}
              >
                500
              </button>
            </div>

            {/* Live Commission Breakdown */}
            {serviceAmountNum > 0 && (
              <div className={styles.serviceBreakdown}>
                <div className={styles.serviceBreakdownRow}>
                  <span>مبلغ الشحن (يُخصم من رصيد الماكينة):</span>
                  <b>{serviceAmountNum} ج.م</b>
                </div>
                <div className={styles.serviceBreakdownRow}>
                  <span>عمولة المحل (تُحصّل كاش في الدرج):</span>
                  <b style={{ color: "var(--br, #8db68a)" }}>
                    + {serviceCommissionEgp} ج.م
                  </b>
                </div>
                <div
                  className={`${styles.serviceBreakdownRow} ${styles.total}`}
                >
                  <span>المطلوب من الزبون كاش:</span>
                  <b>{serviceTotalEgp} ج.م</b>
                </div>
              </div>
            )}

            <button
              type="button"
              className={styles.wpActionBtn}
              disabled={
                !(serviceAmountNum > 0) ||
                Boolean(isBalanceInsufficient) ||
                !chosenServiceMachine
              }
              onClick={handleServiceSubmit}
            >
              {isBalanceInsufficient && chosenServiceMachine
                ? `رصيد غير كافٍ (المتاح ${((chosenServiceMachine.currentBalancePiasters || 0) / 100).toFixed(2)} ج.م)`
                : serviceAmountNum > 0
                  ? `تأكيد وتسجيل العملية — ${serviceTotalEgp} ج.م`
                  : "اكتب المبلغ المطلوب"}
            </button>
          </div>
        </>
      )}

      {/* Credit sale: who is the customer? */}
      {creditFormOpen && (
        <CreditCustomerForm
          onClose={() => {
            setCreditFormOpen(false);
            setPendingCreditItem(null);
          }}
          onChosen={startCreditSale}
        />
      )}

      {/* The invoice (cart) sheet */}
      {cartOpen && (
        <Modal
          title={t("invoice.cartTitle")}
          onClose={() => setCartOpen(false)}
        >
          <CartSheet
            lines={cartLines}
            onChange={setCartLines}
            draft={cartDraft}
            onDraftChange={setCartDraft}
            opIdRef={cartOpIdRef}
            creditCustomer={creditCustomer}
            onCancelCredit={cancelCreditSale}
            onDone={(invoice) => {
              const credited = creditCustomer;
              setCartLines([]);
              setCartMode(false);
              setCartOpen(false);
              setCartDraft(EMPTY_CART_DRAFT);
              setCreditCustomer(null);
              showToast(
                credited
                  ? t("credit.done", {
                      name: credited.name,
                      total: formatMoney(invoice.totalPiasters),
                    })
                  : t("invoice.checkoutDone", {
                      total: formatMoney(invoice.totalPiasters),
                    }),
                "success",
              );
              // A credit sale: straight to People → «ليك», where the new balance shows.
              if (credited && onNavigate) {
                onNavigate("people");
                return;
              }
              void reloadSales();
              void apiGet("/api/stock")
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => d?.inventory && setInventory(d.inventory))
                .catch(() => undefined);
            }}
          />
        </Modal>
      )}

      {/* Offers sheet: sell, edit or remove an offer */}
      {promosOpen && activePromotions.length > 0 && (
        <Modal
          title={t("invoice.promosTitle")}
          onClose={() => setPromosOpen(false)}
        >
          <p className={styles.promoBadgeNotice}>{t("invoice.promosHint")}</p>
          <div className={styles.promoGrid} data-testid="promos-sheet">
            {activePromotions.map((promo) => (
              <div
                key={promo.id}
                className={styles.promoCard}
                onClick={() => {
                  setPromosOpen(false);
                  void handleSellPromotion(promo);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setPromosOpen(false);
                    void handleSellPromotion(promo);
                  }
                }}
              >
                <div className={styles.promoCardTopRow}>
                  <div className={styles.promoTag}>
                    {promo.type === "bundle" ? "كومبو مجمّع" : "تخفيض سريع"}
                  </div>
                  <div className={styles.promoCardActions}>
                    <button
                      type="button"
                      className={styles.promoActionBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPromosOpen(false);
                        setEditingPromo(promo);
                      }}
                      title="تعديل تفاصيل العرض"
                      aria-label={`تعديل العرض ${promo.title}`}
                    >
                      <Icon n="edit" s={13} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.promoActionBtn} ${styles.promoActionDeleteBtn}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeletePromotion(promo.id);
                      }}
                      title="حذف العرض من البيع"
                      aria-label={`حذف العرض ${promo.title}`}
                    >
                      <Icon n="trash" s={13} />
                    </button>
                  </div>
                </div>
                <span className={styles.promoCardTitle}>{promo.title}</span>
                <span className={styles.promoCardDesc}>
                  {promo.description}
                </span>
                <div className={styles.promoCardPricing}>
                  <span className={styles.promoPrice}>
                    {formatMoney(promo.promoPricePiasters)}
                  </span>
                  <span className={styles.promoOriginalPrice}>
                    {formatMoney(promo.originalPricePiasters)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Edit Promotion Modal in SalesView */}
      {editingPromo && (
        <EditPromoModal
          initialPromo={editingPromo as SuggestedPromotion}
          allProducts={allProducts}
          onClose={() => setEditingPromo(null)}
          onSaveAndPublish={handleSaveEditedPromotion}
          onDelete={handleDeletePromotion}
        />
      )}

      {/* "إضافة إلى البيع": how many sandwiches (nothing is saved until confirmed) */}
      {qtyItem && (
        <SandwichQuantitySheet
          sandwich={{
            id: qtyItem.id,
            name: qtyItem.name,
            sellPricePiasters: qtyItem.sellPricePiasters,
            availableCount: qtyItem.currentStockBase,
          }}
          busy={qtyBusy}
          error={qtyError}
          onCancel={closeQuantitySheet}
          onConfirm={(q) => void confirmQuantity(q)}
        />
      )}
      {stagedMissing && (
        <div
          className={`${styles.toastBar} ${styles.toastError}`}
          role="alert"
          data-testid="staged-sandwich-missing"
        >
          <div className={styles.toastMsg}>
            <Icon n="alert" s={18} />
            <span>{t("sandwichSale.missing")}</span>
          </div>
          <button
            type="button"
            className={styles.toastUndoBtn}
            onClick={closeQuantitySheet}
            aria-label={t("common.close")}
          >
            <Icon n="x" s={14} />
          </button>
        </div>
      )}

      {/* Floating Bottom Toast with Undo matching Image 1 */}
      {activeToast && (
        <div
          className={`${styles.toastBar} ${activeToast.type === "error" ? styles.toastError : ""} ${activeToast.type === "pending" ? styles.toastPending : ""}`}
          data-testid="sale-toast"
          data-kind={activeToast.type ?? "success"}
        >
          <div className={styles.toastMsg}>
            <Icon
              n={
                activeToast.type === "error"
                  ? "alert"
                  : activeToast.type === "pending"
                    ? "refresh"
                    : "check"
              }
              s={18}
            />
            <span>{activeToast.msg}</span>
          </div>
          {activeToast.undoSale && (
            <button
              type="button"
              className={styles.toastUndoBtn}
              data-testid="sale-undo"
              disabled={voidingSaleId !== null}
              onClick={() => {
                const target = activeToast.undoSale;
                if (target) void handleUndoSale(target);
              }}
            >
              <Icon n="undo" s={14} />
              <span>
                {voidingSaleId === activeToast.undoSale.id
                  ? t("sale.voiding")
                  : t("sale.undo")}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default SalesView;
