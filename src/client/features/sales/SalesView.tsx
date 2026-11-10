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
 * There is no Undo: a recorded sale can only be reversed by a server-side void, which is not
 * built yet (audit QA-10).
 *
 * @remarks
 * - The sales list is kept in `localStorage` per store; on load it is replaced by the
 *   server's list when the server returns at least one sale (audit QA-09, not changed here).
 * - Services: the POS-machine balance is deducted before the sale request; if the sale is
 *   rejected, the deduction is refunded (audit QA-03 covers making this server-side).
 * - Money is integer piasters; quantities are base units (pieces or grams).
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "./SalesView.module.css";
import { Empty, SearchBox, Icon } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { calculateLineTotal } from "@/domain/money";
import { normalizeArabic } from "@/domain/normalize";
import { useAuth } from "@/client/shared/auth";
import { db } from "@/client/offline/db";
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
  deductRemoteMachineBalance,
  addRemoteMachineTopup,
  type PosMachine,
} from "@/client/shared/api/machines";
import {
  clearStagedSandwich,
  fetchSandwiches,
  readStagedSandwich,
  sellSandwich,
  type Sandwich,
} from "@/client/shared/api/sandwiches";
import {
  postSale,
  SaleApiError,
  type RecordedSale,
} from "@/client/shared/api/sales";
import { SandwichQuantitySheet } from "./SandwichQuantitySheet";

export interface SaleRecord {
  id: string;
  productId: string;
  name: string;
  amountPiasters: number;
  quantity: number;
  category: string;
  unit: string;
  isCarton?: boolean;
  commissionPiasters?: number;
  timestamp: number;
  machineId?: string;
  machineDeductPiasters?: number;
  machineName?: string;
}

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

const STORAGE_KEY_PREFIX = "hesba_sales_records";
const STAGED_KEY = "hesba_staged_sale_item";

function getSalesStorageKey(storeId?: string): string {
  return `${STORAGE_KEY_PREFIX}_${storeId || "default"}`;
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
  initialSales: SaleRecord[];
  initialEnabledServices: string[];
  stagedSaleItem: DisplaySaleItem | null;
} {
  let initialSales: SaleRecord[] = [];
  let initialEnabledServices: string[] = [];
  let stagedSaleItem: DisplaySaleItem | null = null;

  if (typeof window !== "undefined" || typeof localStorage !== "undefined") {
    try {
      const rawSales = localStorage.getItem(getSalesStorageKey(storeId));
      if (rawSales) {
        initialSales = JSON.parse(rawSales);
      }
    } catch {
      // Ignore
    }

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

  return { initialSales, initialEnabledServices, stagedSaleItem };
}

export function SalesView() {
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const initial = useMemo(() => loadInitialData(storeId), [storeId]);
  const [sales, setSales] = useState<SaleRecord[]>(initial.initialSales);
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
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
    fetchStoreMachines(storeId).then((remote) => {
      if (isMounted) setMachines(remote);
    });
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

  // Bottom toast. There is no Undo: a recorded sale can only be reversed by a server-side
  // void, which does not exist yet (audit QA-10, ADR-0019).
  const [activeToast, setActiveToast] = useState<{
    msg: string;
    type?: "success" | "error";
  } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setActiveToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setActiveToast(null), 4500);
  }, []);

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
    let isMounted = true;
    void Promise.all([
      fetch("/api/stock?view=all")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/products?filter=all")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/sales")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchSandwiches().catch((err: unknown) =>
        err instanceof Error ? err : new Error(t("sandwich.loadFailed")),
      ),
    ]).then(([stockData, prodData, salesData, sandwichList]) => {
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
      if (prodData?.products) {
        const allProds: StoreProductItem[] = prodData.products;
        setAllProducts(allProds);
        setServices(allProds.filter((p) => isServiceProduct(p)));
      }
      if (salesData?.sales && Array.isArray(salesData.sales)) {
        if (salesData.sales.length > 0) {
          setSales(salesData.sales);
          try {
            localStorage.setItem(
              getSalesStorageKey(storeId),
              JSON.stringify(salesData.sales),
            );
          } catch {}
        }
      }
    });

    const syncRemoteSalesConfig = () => {
      fetch("/api/sales/config")
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
      fetch("/api/promotions")
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

  // Calculate today's sales and total
  const todaySales = useMemo(() => {
    const today = new Date().toDateString();
    return sales.filter((s) => new Date(s.timestamp).toDateString() === today);
  }, [sales]);

  const todayTotalPiasters = useMemo(() => {
    return todaySales.reduce((sum, s) => sum + s.amountPiasters, 0);
  }, [todaySales]);

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

  /** Adds a recorded sale to today's list (and its local copy). */
  const addSaleRecord = useCallback(
    (record: SaleRecord) => {
      setSales((prev) => {
        const updated = [record, ...prev];
        try {
          localStorage.setItem(
            getSalesStorageKey(storeId),
            JSON.stringify(updated),
          );
        } catch {
          // Ignore quota error
        }
        return updated;
      });
    },
    [storeId],
  );

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
          status: stock <= 0 ? "out" : stock <= 5 ? "low" : "ok",
        };
      }),
    );
  }, []);

  /**
   * Records a sale on the server and waits for it (ADR-0019). The server writes the sale and
   * deducts the stock in one transaction; the screen changes only after it accepted the sale
   * (list, stock figures, success toast). A rejection — not enough stock, offline, server
   * error — is shown as an error and nothing is added or deducted on screen.
   *
   * Services: the POS-machine balance is deducted by the caller before this runs. If the sale
   * is then rejected, the deduction is refunded so the machine and the sales stay in step.
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
      restoreMachine?: {
        machineId: string;
        amountPiasters: number;
        machineName: string;
      };
      machineId?: string;
      machineDeductPiasters?: number;
      machineName?: string;
    }): Promise<boolean> => {
      const { item, quantityBase, label, restoreMachine } = params;

      let recorded: RecordedSale;
      try {
        recorded = await postSale({
          opId: generateUuid(),
          id: generateUuid(),
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
        });
      } catch (err: unknown) {
        const message =
          err instanceof SaleApiError ? err.message : t("sale.failed");
        if (restoreMachine && restoreMachine.amountPiasters > 0) {
          const amount = formatMoney(restoreMachine.amountPiasters);
          try {
            await addRemoteMachineTopup(
              restoreMachine.machineId,
              restoreMachine.amountPiasters,
              {
                source: "بيعة لم تُسجل",
                notes: `استرداد ${amount} لأن البيعة لم تُسجل`,
              },
              storeId,
            );
            await reloadMachines();
            showToast(
              `${message} — ${t("sale.machineRefunded", { amount, machine: restoreMachine.machineName })}`,
              "error",
            );
          } catch {
            showToast(
              t("sale.machineRefundFailed", {
                amount,
                machine: restoreMachine.machineName,
              }),
              "error",
            );
          }
        } else {
          showToast(message, "error");
        }
        return false;
      }

      applyRecordedStock(recorded);
      const now = Date.now();
      addSaleRecord({
        id: recorded.id,
        productId: item.productId,
        name: item.name,
        amountPiasters: recorded.totalPiasters,
        quantity: quantityBase,
        category: item.category || "عام",
        unit: item.unitMode,
        isCarton: params.isCarton,
        commissionPiasters: params.commissionPiasters,
        timestamp: now,
        machineId: params.machineId,
        machineDeductPiasters: params.machineDeductPiasters,
        machineName: params.machineName,
      });

      setFlashId(item.id);
      setTimeout(() => setFlashId(null), 450);
      showToast(
        t("sale.sold", {
          name: item.name,
          label,
          amount: formatMoney(recorded.totalPiasters),
        }),
        "success",
      );

      // Local copy for the offline database (not read anywhere yet; see ADR-0019)
      try {
        if (db?.sales && db?.sale_lines && !recorded.duplicate) {
          const isoNow = new Date(now).toISOString();
          void db.sales
            .add({
              id: recorded.id,
              store_id: storeId || "default",
              device_id: "local-device",
              cashier_id: null,
              total_minor: recorded.totalPiasters,
              discount_minor: 0,
              paid_minor: recorded.totalPiasters,
              payment_method: "cash",
              is_voided: false,
              voided_at: null,
              created_at: isoNow,
              updated_at: isoNow,
            })
            .catch(() => {});
          void db.sale_lines
            .add({
              id: `line-${now}`,
              sale_id: recorded.id,
              store_variant_id: item.variantId || item.productId,
              unit_mode: item.unitMode === "weight" ? "weight" : "piece",
              quantity_base: quantityBase,
              unit_price_minor: recorded.totalPiasters,
              total_minor: recorded.totalPiasters,
              created_at: isoNow,
            })
            .catch(() => {});
        }
      } catch {
        // Ignore
      }
      return true;
    },
    [storeId, showToast, addSaleRecord, applyRecordedStock, reloadMachines],
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

      let recorded: RecordedSale;
      try {
        recorded = await postSale({
          opId: generateUuid(),
          id: generateUuid(),
          promotionId: promo.id,
        });
      } catch (err: unknown) {
        showToast(
          err instanceof SaleApiError ? err.message : t("sale.failed"),
          "error",
        );
        return;
      }

      applyRecordedStock(recorded);
      addSaleRecord({
        id: recorded.id,
        productId: promo.items[0]?.productId || "promo",
        name: promo.title,
        amountPiasters: recorded.totalPiasters,
        quantity: 1,
        category: "عروض ترويجية",
        unit: "عرض",
        timestamp: Date.now(),
      });
      showToast(
        t("sale.promoSold", {
          title: promo.title,
          amount: formatMoney(recorded.totalPiasters),
        }),
        "success",
      );
    },
    [inventory, showToast, applyRecordedStock, addSaleRecord],
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
      if (res.ok) {
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
        if (res.ok) {
          setEditingPromo(null);
          setActivePromotions((prev) => {
            const idx = prev.findIndex((p) => p.id === promo.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = promo as PublishedPromotion;
              return updated;
            }
            return [...prev, promo as PublishedPromotion];
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
            msg: "تعذر حفظ التعديلات، حاول مرة أخرى",
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
   * Sells `count` sandwiches as ONE sale and waits for the server. Nothing changes on screen
   * until the server has recorded the sale and deducted the ingredients; then the list, the
   * ingredient stock and the sandwich counts are reloaded from the server. Returns the
   * server's error message when the sale was rejected (the caller decides how to show it).
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
      const saleId = generateUuid();
      let sold = false;
      try {
        await sellSandwich({
          saleId,
          opId: generateUuid(),
          sandwich: {
            id: item.productId,
            name: item.name,
            sellPricePiasters: item.sellPricePiasters,
          },
          count,
        });
        const amountPiasters = calculateLineTotal(
          item.sellPricePiasters,
          count,
        );
        const record: SaleRecord = {
          id: saleId,
          productId: item.productId,
          name: item.name,
          amountPiasters,
          quantity: count,
          category: item.category || "",
          unit: "piece",
          timestamp: Date.now(),
        };
        setSales((prev) => {
          const updated = [record, ...prev];
          try {
            localStorage.setItem(
              getSalesStorageKey(storeId),
              JSON.stringify(updated),
            );
          } catch {
            // Ignore quota error
          }
          return updated;
        });
        sold = true;
        // The sale is recorded: the next tap may sell again while the screen refreshes.
        sellingSandwichRef.current = false;
        setSellingSandwichId(null);
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
        );
        // Refresh ingredient stock and "can make N" counts from the server in the background:
        // the sale is already recorded, so the caller (e.g. the quantity step) can close now.
        void Promise.all([
          fetch("/api/stock?view=all")
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetchSandwiches().catch(() => null),
        ]).then(([stockData, sandwichList]) => {
          if (stockData?.inventory) setInventory(stockData.inventory);
          if (sandwichList) setSandwiches(sandwichList);
        });
        return { ok: true };
      } catch (err: unknown) {
        if (sold) return { ok: true }; // only the refresh failed; the sale is recorded
        return {
          ok: false,
          message:
            err instanceof Error ? err.message : t("sandwich.sellFailed"),
        };
      } finally {
        if (!sold) {
          sellingSandwichRef.current = false;
          setSellingSandwichId(null);
        }
      }
    },
    [storeId, showToast],
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

  // Tap handler for a Card
  const handleCardClick = async (item: DisplaySaleItem) => {
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

      try {
        await deductRemoteMachineBalance(
          targetMachine.id,
          cardAmountPiasters,
          {
            source: `بيع كارت شحن: ${item.name}`,
            reference: item.productId,
          },
          storeId,
        );
        await reloadMachines();
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error ? err.message : "فشل خصم رصيد الماكينة";
        setActiveToast({ msg: errorMsg, type: "error" });
        return;
      }

      void recordSale({
        item,
        quantityBase: 1,
        amountPiasters: cardAmountPiasters,
        label: `1 كارت (${targetMachine.name})`,
        restoreMachine: {
          machineId: targetMachine.id,
          amountPiasters: cardAmountPiasters,
          machineName: targetMachine.name,
        },
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

    try {
      await deductRemoteMachineBalance(
        chosenMachine.id,
        principalPiasters,
        {
          source: `تنفيذ معاملة: ${serviceModalItem.name}`,
          reference: serviceModalItem.productId,
        },
        storeId,
      );
      await reloadMachines();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "فشل خصم رصيد الماكينة";
      setActiveToast({ msg: errorMsg, type: "error" });
      return;
    }

    void recordSale({
      item: serviceModalItem,
      quantityBase: 1,
      amountPiasters: totalCustomerPiasters,
      label: `شحن ${amountEgp} ج.م (${chosenMachine.name})`,
      commissionPiasters,
      restoreMachine: {
        machineId: chosenMachine.id,
        amountPiasters: principalPiasters,
        machineName: chosenMachine.name,
      },
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
            <b className={styles.sTotalAmount}>
              {formatMoney(todayTotalPiasters)}
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

        {/* Promotional Offers from Expiry Alerts */}
        {activePromotions.length > 0 && (
          <div className={styles.promoSection}>
            <div className={styles.promoHeader}>
              <div className={styles.promoTitle}>
                <Icon n="sparkle" s={16} />
                <span>
                  عروض التوفير وتصفية الصلاحية ({activePromotions.length})
                </span>
              </div>
              <span className={styles.promoBadgeNotice}>اضغط لبيع العرض</span>
            </div>
            <div className={styles.promoGrid}>
              {activePromotions.map((promo) => (
                <div
                  key={promo.id}
                  className={styles.promoCard}
                  onClick={() => void handleSellPromotion(promo)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
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
                          setEditingPromo(promo);
                        }}
                        title="تعديل تفاصيل العرض"
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
          </div>
        )}

        {/* Product & Services Tiles Grid matching Image 1 */}
        {filteredItems.length === 0 ? (
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
                      <span>{getPackLabel(item.packName, item.packQty)}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Recent Sales List matching Image 3 */}
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
                {todaySales.length === 0
                  ? "مفيش بيعات اتسجلت لسه"
                  : `${todaySales.length} ${todaySales.length === 1 ? "عملية بيع اليوم" : "عمليات بيع اليوم"}`}
              </span>
            </div>
            {todaySales.length > 0 && (
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

          {todaySales.length === 0 ? (
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
            >
              {todaySales.map((sale) => (
                <div key={sale.id} className={styles.rcRow}>
                  <span className={styles.rcName}>{sale.name}</span>
                  <div className={styles.rcMeta}>
                    <span className={styles.rcTime}>
                      {formatCairoTime(sale.timestamp)}
                    </span>
                    <b className={styles.rcAmount}>
                      {formatMoney(sale.amountPiasters)}
                    </b>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
          className={`${styles.toastBar} ${activeToast.type === "error" ? styles.toastError : ""}`}
        >
          <div className={styles.toastMsg}>
            <Icon n={activeToast.type === "error" ? "alert" : "check"} s={18} />
            <span>{activeToast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default SalesView;
