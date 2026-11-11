"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Icon, Modal } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { SANDWICH_CATEGORY } from "@/domain/recipe";
import { ProductFormModal } from "./ProductFormModal";
import { AddProductChoiceModal } from "./AddProductChoiceModal";
import { SandwichFormModal } from "./SandwichFormModal";
import sandwichStyles from "./SandwichFormModal.module.css";
import { ServiceFormModal } from "./ServiceFormModal";
import { AddStockModal } from "../stock/AddStockModal";
import { MachinesModal, type PosMachine } from "./MachinesModal";
import {
  getStoredMachines,
  fetchStoreMachines,
  setServiceLinkedMachineIds,
} from "@/client/shared/api/machines";
import {
  fetchSandwiches,
  stageSandwichForSale,
  type Sandwich,
} from "@/client/shared/api/sandwiches";
import { useAuth } from "@/client/shared/auth";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import styles from "./ProductsView.module.css";

interface PriceBoxProps {
  label: string;
  buy: number;
  sell: number;
}

function fmtMoney(piasters: number) {
  if (!piasters || piasters <= 0) return "—";
  const val = piasters / 100;
  return (Math.round(val * 100) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function PriceBox({ label, buy, sell }: PriceBoxProps) {
  const buyFormatted = fmtMoney(buy);
  const sellFormatted = fmtMoney(sell);
  return (
    <div className={styles.pr}>
      <span className={styles.prl}>{label}</span>
      <div className={styles.prvals}>
        <div className={styles.prv}>
          <small>{t("pages.products.buyPrice") || "شراء"}</small>
          <b title={buyFormatted}>{buyFormatted}</b>
        </div>
        <div className={`${styles.prv} ${styles.prvSell}`}>
          <small>{t("pages.products.sellPrice") || "بيع"}</small>
          <b title={sellFormatted}>{sellFormatted}</b>
        </div>
      </div>
    </div>
  );
}

/** Cost / sell / profit of a sandwich card. Cost is the live recipe cost from the server. */
function SandwichPriceBox({
  sandwich,
  sellPricePiasters,
}: {
  sandwich: Sandwich | undefined;
  sellPricePiasters: number;
}) {
  // Same compact number format as the ordinary product cards (pounds, no currency).
  const cost = sandwich ? fmtMoney(sandwich.costPiasters) : "—";
  const sell = fmtMoney(sandwich?.sellPricePiasters ?? sellPricePiasters);
  const profit = sandwich
    ? sandwich.profitPiasters < 0
      ? `-${fmtMoney(-sandwich.profitPiasters)}`
      : fmtMoney(sandwich.profitPiasters)
    : "—";
  return (
    <div className={styles.pr} data-testid="sandwich-card-prices">
      <div className={styles.prvals}>
        <div className={styles.prv}>
          <small>{t("sandwich.cardCost")}</small>
          <b title={cost}>{cost}</b>
        </div>
        <div className={`${styles.prv} ${styles.prvSell}`}>
          <small>{t("sandwich.cardSell")}</small>
          <b title={sell}>{sell}</b>
        </div>
        <div className={styles.prv}>
          <small>{t("sandwich.cardProfit")}</small>
          <b
            title={profit}
            className={
              sandwich && sandwich.profitPiasters < 0
                ? sandwichStyles.loss
                : sandwichStyles.profitValue
            }
          >
            {profit}
          </b>
        </div>
      </div>
    </div>
  );
}

function sandwichSubtitle(sandwich: Sandwich | undefined): string {
  if (!sandwich) return t("sandwich.category");
  return `${t("sandwich.ingredientsCount", {
    count: sandwich.ingredients.length,
  })} · ${t("sandwich.canMake", { count: sandwich.availableCount })}`;
}

const isWeightProduct = (p: StoreProductItem) =>
  p.unit === "weight" || p.unit === "kg" || p.unit === "g";

const packCount = (p: StoreProductItem) => {
  if (isWeightProduct(p)) return 0;
  const n = p.variants?.[0]?.pack_qty;
  return n && n > 1 ? n : 0;
};

function getBrandBadge(p: StoreProductItem) {
  const text = (p.brand_name || p.name_ar).toLowerCase();
  if (text.includes("فودافون") || text.includes("vodafone")) {
    return { name: "فودافون", className: styles.brandVodafone };
  }
  if (
    text.includes("وي") ||
    text.includes("we") ||
    text.includes("المصرية للاتصالات") ||
    text.includes("الأرضي")
  ) {
    return { name: "وي (WE)", className: styles.brandWe };
  }
  if (
    text.includes("أورانج") ||
    text.includes("اورانج") ||
    text.includes("orange")
  ) {
    return { name: "أورانج", className: styles.brandOrange };
  }
  if (
    text.includes("اتصالات") ||
    text.includes("etisalat") ||
    text.includes("e&")
  ) {
    return { name: "اتصالات (e&)", className: styles.brandEtisalat };
  }
  if (
    text.includes("كهرباء") ||
    text.includes("مياه") ||
    text.includes("غاز") ||
    text.includes("مرافق")
  ) {
    return { name: "مرافق عامة", className: styles.brandUtility };
  }
  if (text.includes("فوري") || text.includes("fawry")) {
    return { name: "فوري", className: styles.brandFawry };
  }
  if (
    text.includes("إنستاباي") ||
    text.includes("انستاباي") ||
    text.includes("instapay")
  ) {
    return { name: "إنستاباي", className: styles.brandInstapay };
  }
  return { name: p.brand_name || "خدمة عامة", className: styles.brandUtility };
}

function getServiceNature(p: StoreProductItem) {
  if (p.category === "كروت شحن" || p.category === "كروت مرافق") {
    return { label: "كارت فيزيائي (مخزون)", isStock: true };
  }
  if (p.category === "فواتير إنترنت") {
    return { label: "دفع فاتورة رسمية", isStock: false };
  }
  if (p.category === "خدمات مرافق") {
    return { label: "شحن كارت ذكي (NFC)", isStock: false };
  }
  if (p.category === "تحويل أموال") {
    return { label: "تحويل ومحافظ نقدية", isStock: false };
  }
  if (p.category === "شحن رصيد") {
    return { label: "شحن رصيد مباشر", isStock: false };
  }
  return { label: "خدمة رقمية", isStock: false };
}

export function ProductsView() {
  const [tab, setTab] = useState<"products" | "services">("products");
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [serviceCategory, setServiceCategory] = useState<string>("utilities");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [filterMode, setFilterMode] = useState<"all" | "custom" | "hidden">(
    "all",
  );
  const [summary, setSummary] = useState({
    total: 0,
    hiddenCount: 0,
    customCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addingSection, setAddingSection] = useState<"products" | "services">(
    "products",
  );
  const [editingProduct, setEditingProduct] = useState<StoreProductItem | null>(
    null,
  );
  // "إضافة منتج" first asks: normal product or sandwich (ADR-0018).
  const [isChoosingType, setIsChoosingType] = useState(false);
  const [sandwichForm, setSandwichForm] = useState<{
    sandwich: Sandwich | null;
  } | null>(null);
  const [sandwiches, setSandwiches] = useState<Sandwich[]>([]);
  const [sandwichError, setSandwichError] = useState<string | null>(null);
  const sandwichById = useMemo(
    () => new Map(sandwiches.map((sw) => [sw.id, sw])),
    [sandwiches],
  );
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const [stockModalProduct, setStockModalProduct] =
    useState<StoreProductItem | null>(null);
  const [isMachinesModalOpen, setIsMachinesModalOpen] = useState(false);
  const [machineAssignProduct, setMachineAssignProduct] =
    useState<StoreProductItem | null>(null);
  const [posMachines, setPosMachines] = useState<PosMachine[]>(() => {
    return getStoredMachines(storeId);
  });
  const [assignedMachines, setAssignedMachines] = useState<
    Record<string, string[]>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const storageKey = `hesba_service_machines_${storeId || "default"}`;
      const savedAssigned = localStorage.getItem(storageKey);
      if (!savedAssigned) return {};
      const parsed = JSON.parse(savedAssigned);
      const normalized: Record<string, string[]> = {};
      Object.keys(parsed).forEach((k) => {
        const v = parsed[k];
        normalized[k] = Array.isArray(v) ? v : v ? [v] : [];
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  });

  // Re-sync assigned machines when active store changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `hesba_service_machines_${storeId || "default"}`;
    const reload = () => {
      try {
        const savedAssigned = localStorage.getItem(storageKey);
        if (!savedAssigned) {
          setAssignedMachines({});
          return;
        }
        const parsed = JSON.parse(savedAssigned);
        const normalized: Record<string, string[]> = {};
        Object.keys(parsed).forEach((k) => {
          const v = parsed[k];
          normalized[k] = Array.isArray(v) ? v : v ? [v] : [];
        });
        setAssignedMachines(normalized);
      } catch {
        setAssignedMachines({});
      }
    };
    reload();
    window.addEventListener("hesba_service_machines_updated", reload);
    return () => {
      window.removeEventListener("hesba_service_machines_updated", reload);
    };
  }, [storeId]);

  // Check online status listeners & fetch POS machines from DB
  useEffect(() => {
    let isMounted = true;
    // Wait for the signed-in shop: running first without it and again with it loaded
    // everything twice (QA-32 request audit), and the local caches are keyed by shop.
    if (storeId) {
      void fetchStoreMachines(storeId).then((remote) => {
        if (isMounted && remote) {
          setPosMachines(remote);
        }
      });
    }

    if (typeof window !== "undefined") {
      const onOn = () => setIsOnline(true);
      const onOff = () => setIsOnline(false);
      window.addEventListener("online", onOn);
      window.addEventListener("offline", onOff);

      const handleMachinesUpdated = () => {
        setPosMachines(getStoredMachines(storeId));
      };
      window.addEventListener("hesba_machines_updated", handleMachinesUpdated);

      return () => {
        isMounted = false;
        window.removeEventListener("online", onOn);
        window.removeEventListener("offline", onOff);
        window.removeEventListener(
          "hesba_machines_updated",
          handleMachinesUpdated,
        );
      };
    }
  }, [storeId]);

  // Close card menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [menuOpenId]);

  const handleToggleMachineAssignment = (
    productId: string,
    machineId: string,
  ) => {
    const current = assignedMachines[productId] || [];
    const next = current.includes(machineId)
      ? current.filter((id) => id !== machineId)
      : [...current, machineId];

    const updated = { ...assignedMachines, [productId]: next };
    setAssignedMachines(updated);
    setServiceLinkedMachineIds(productId, next, storeId);
  };

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products?filter=all");
      if (!res.ok) {
        throw new Error("فشل تحميل قائمة المنتجات");
      }
      const data = await res.json();
      const loadedProducts: StoreProductItem[] = data.products || [];
      setProducts(loadedProducts);
      if (data.summary) {
        setSummary(data.summary);
      } else {
        setSummary({
          total: loadedProducts.length,
          hiddenCount: loadedProducts.filter((p) => p.is_hidden).length,
          customCount: loadedProducts.filter((p) => p.is_custom).length,
        });
      }
    } catch (err: unknown) {
      console.error("Failed to load products from API:", err);
      setError("تعذر تحميل المنتجات، برجاء التحقق من الاتصال");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/products?filter=all")
      .then((res) => {
        if (!res.ok) throw new Error("فشل تحميل قائمة المنتجات");
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          const loadedProducts: StoreProductItem[] = data.products || [];
          setProducts(loadedProducts);
          if (data.summary) {
            setSummary(data.summary);
          } else {
            setSummary({
              total: loadedProducts.length,
              hiddenCount: loadedProducts.filter((p) => p.is_hidden).length,
              customCount: loadedProducts.filter((p) => p.is_custom).length,
            });
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Failed to load products from API:", err);
          setError("تعذر تحميل المنتجات، برجاء التحقق من الاتصال");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Sandwich recipes and live costs come from /api/sandwiches (no cached or invented
  // numbers). A failed load is shown to the user, not turned into an empty list.
  const loadSandwiches = useCallback(async () => {
    try {
      setSandwiches(await fetchSandwiches({ includeHidden: true }));
      setSandwichError(null);
    } catch (err: unknown) {
      setSandwichError(
        err instanceof Error ? err.message : t("sandwich.loadFailed"),
      );
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetchSandwiches({ includeHidden: true })
      .then((list) => {
        if (!ignore) {
          setSandwiches(list);
          setSandwichError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setSandwichError(
            err instanceof Error ? err.message : t("sandwich.loadFailed"),
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const isSandwich = (p: StoreProductItem) => p.kind === "sandwich";

  /** Opens the right editor: the sandwich form for sandwiches, the product form otherwise. */
  const openProduct = (p: StoreProductItem) => {
    if (isSandwich(p)) {
      setSandwichForm({ sandwich: sandwichById.get(p.id) ?? null });
      return;
    }
    setEditingProduct(p);
  };

  // Deleting a product the shop created (never a catalog product; server-enforced too).
  const [deleteTarget, setDeleteTarget] = useState<StoreProductItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isShopCreated = (p: StoreProductItem) =>
    p.is_custom && !p.global_product_id;

  const handleDeleteShopProduct = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/products?id=${encodeURIComponent(target.id)}&action=delete`,
        { method: "DELETE" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        result?: "deleted" | "archived";
        error?: { message?: string };
      };
      if (!res.ok || !body.result) {
        throw new Error(body.error?.message || t("productDelete.failed"));
      }
      if (body.result === "deleted") {
        setProducts((prev) => prev.filter((x) => x.id !== target.id));
        setSummary((prev) => ({
          ...prev,
          total: Math.max(0, prev.total - 1),
          customCount: Math.max(0, prev.customCount - 1),
        }));
      } else {
        setProducts((prev) =>
          prev.map((x) => (x.id === target.id ? { ...x, is_hidden: true } : x)),
        );
        setSummary((prev) => ({
          ...prev,
          hiddenCount: target.is_hidden
            ? prev.hiddenCount
            : prev.hiddenCount + 1,
        }));
      }
      if (target.kind === "sandwich") {
        setSandwiches((prev) => prev.filter((sw) => sw.id !== target.id));
      }
      setNotice(t(`productDelete.${body.result}`, { name: target.name_ar }));
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : t("productDelete.failed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleToggleHide = async (product: StoreProductItem) => {
    const isNowHidden = !product.is_hidden;
    try {
      const res = await fetch(
        `/api/products?id=${product.id}&toggleHide=true`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("فشل تغيير حالة إظهار المنتج");

      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, is_hidden: isNowHidden } : p,
        ),
      );
      setSummary((prev) => ({
        ...prev,
        hiddenCount: isNowHidden
          ? prev.hiddenCount + 1
          : Math.max(0, prev.hiddenCount - 1),
      }));
    } catch (err: unknown) {
      console.error("Unhide failed:", err);
      alert("تعذر تحديث حالة ظهور المنتج");
    }
  };

  const handleAddToSale = (product: StoreProductItem) => {
    // Must be linked to at least one payment machine first
    const linkedIds = assignedMachines[product.id] || [];
    if (linkedIds.length === 0) {
      alert(
        "⚠️ لا يمكن إضافة هذه الخدمة إلى شاشة البيع قبل ربطها بماكينة دفع واحدة على الأقل.\nيرجى تحديد ماكينة الدفع المسؤولة عنها أولاً.",
      );
      setMachineAssignProduct(product);
      return;
    }

    if (typeof window !== "undefined") {
      try {
        const storageKey = `hesba_sales_enabled_services_${storeId || "default"}`;
        const raw = localStorage.getItem(storageKey);
        const currentList: string[] = raw ? JSON.parse(raw) : [];
        if (currentList.includes(product.id)) {
          alert(
            `⚠️ هذه الخدمة «${product.name_ar}» مضافة بالفعل إلى صفحة البيع ومتاحة للبيع الآن!`,
          );
          return;
        }

        currentList.push(product.id);
        localStorage.setItem(storageKey, JSON.stringify(currentList));

        // Persist to supermarket database configuration
        void fetch("/api/sales/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledServiceIds: currentList }),
        }).catch(() => {});

        window.dispatchEvent(new CustomEvent("hesba_sales_config_updated"));

        const stagedItem = {
          id: product.id,
          name: product.name_ar,
          sellPricePiasters: product.sell_price_piasters,
          category: product.category,
          unit: product.unit,
        };
        sessionStorage.setItem(
          "hesba_staged_sale_item",
          JSON.stringify(stagedItem),
        );
      } catch {
        // Ignore storage error
      }
      window.history.pushState(null, "", "/app/sales");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  // Split into Physical Products vs Digital Services / Cards
  const physicalProducts = useMemo(() => {
    return products.filter((p) => !isServiceProduct(p));
  }, [products]);

  const serviceProducts = useMemo(() => {
    return products.filter((p) => isServiceProduct(p));
  }, [products]);

  // Distinct physical categories
  const physicalCategories = useMemo(() => {
    const cats = new Set<string>([SANDWICH_CATEGORY]);
    physicalProducts.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats);
  }, [physicalProducts]);

  // Filtered physical products (Tab 1)
  const filteredPhysicalProducts = useMemo(() => {
    let list = physicalProducts;

    if (filterMode === "hidden") {
      list = list.filter((p) => p.is_hidden);
    } else if (filterMode === "custom") {
      list = list.filter((p) => p.is_custom && !p.is_hidden);
    } else {
      list = list.filter((p) => !p.is_hidden);
    }

    if (activeCategory !== "all") {
      list = list.filter((p) => p.category === activeCategory);
    }

    const normQ = normalizeArabic(query.trim());
    if (!normQ) return list;

    return list.filter((p) => {
      const normName = normalizeArabic(p.name_ar || "");
      const normCat = normalizeArabic(p.category || "");
      const normBrand = normalizeArabic(p.brand_name || "");
      const normBarcode = normalizeArabic(p.barcode || "");
      // English catalog names (QA-48): "pepsi" finds بيبسي.
      const normEn = normalizeArabic(
        `${p.name_en || ""} ${p.brand_name_en || ""}`,
      );
      return (
        normName.includes(normQ) ||
        normCat.includes(normQ) ||
        normBrand.includes(normQ) ||
        normBarcode.includes(normQ) ||
        normEn.includes(normQ)
      );
    });
  }, [physicalProducts, filterMode, activeCategory, query]);

  // Filtered services products (Tab 2)
  const filteredServiceProducts = useMemo(() => {
    let list = serviceProducts;

    if (filterMode === "hidden") {
      list = list.filter((p) => p.is_hidden);
    } else {
      list = list.filter((p) => !p.is_hidden);
    }

    // Category filter
    if (serviceCategory === "utilities") {
      list = list.filter(
        (p) =>
          p.category === "خدمات مرافق" ||
          p.category === "كروت مرافق" ||
          p.name_ar.includes("كهرباء") ||
          p.name_ar.includes("مياه") ||
          p.name_ar.includes("غاز"),
      );
      if (companyFilter === "electricity") {
        list = list.filter(
          (p) => p.name_ar.includes("كهرباء") || p.name_ar.includes("كهربا"),
        );
      } else if (companyFilter === "water") {
        list = list.filter(
          (p) => p.name_ar.includes("مياه") || p.name_ar.includes("ميه"),
        );
      } else if (companyFilter === "gas") {
        list = list.filter((p) => p.name_ar.includes("غاز"));
      }
    } else if (serviceCategory === "internet") {
      list = list.filter((p) => p.category === "فواتير إنترنت");
    } else if (serviceCategory === "cards") {
      list = list.filter(
        (p) => p.category === "كروت شحن" || p.name_ar.includes("كارت شحن"),
      );
    } else if (serviceCategory === "transfer") {
      list = list.filter((p) => p.category === "تحويل أموال");
    } else if (serviceCategory === "airtime") {
      list = list.filter((p) => p.category === "شحن رصيد");
    }

    // Company filter (when not utilities, since utilities has its own electricity/water/gas filters above)
    if (companyFilter !== "all" && serviceCategory !== "utilities") {
      const target = companyFilter.toLowerCase();
      list = list.filter((p) => {
        const text = `${p.brand_name || ""} ${p.name_ar}`.toLowerCase();
        if (target === "vodafone")
          return text.includes("فودافون") || text.includes("vodafone");
        if (target === "we")
          return (
            text.includes("وي") ||
            text.includes("we") ||
            text.includes("الأرضي")
          );
        if (target === "orange")
          return (
            text.includes("أورانج") ||
            text.includes("اورانج") ||
            text.includes("orange")
          );
        if (target === "etisalat")
          return (
            text.includes("اتصالات") ||
            text.includes("etisalat") ||
            text.includes("e&")
          );
        if (target === "fawry")
          return text.includes("فوري") || text.includes("fawry");
        if (target === "instapay")
          return (
            text.includes("إنستاباي") ||
            text.includes("انستاباي") ||
            text.includes("instapay")
          );
        return true;
      });
    }

    const normQ = normalizeArabic(query.trim());
    if (!normQ) return list;

    return list.filter((p) => {
      const normName = normalizeArabic(p.name_ar || "");
      const normCat = normalizeArabic(p.category || "");
      const normBrand = normalizeArabic(p.brand_name || "");
      return (
        normName.includes(normQ) ||
        normCat.includes(normQ) ||
        normBrand.includes(normQ)
      );
    });
  }, [serviceProducts, filterMode, serviceCategory, companyFilter, query]);

  const formatSubtitle = (p: StoreProductItem) => {
    if (p.unit === "bag") {
      const packQty = packCount(p);
      return packQty > 1 ? `كرتونة (${packQty} كيس)` : "بالكيس";
    }
    if (p.unit === "weight" || p.unit === "kg") return "بالوزن (كيلو)";
    if (p.unit === "g") return "بالوزن (جرام)";
    const packQty = packCount(p);
    if (packQty > 1) {
      return `كرتونة ${packQty} قطعة`;
    }
    return "بالقطعة";
  };

  return (
    <div className={styles.view} data-testid="page-products">
      {/* Header */}
      <div className={styles.phead}>
        <div className={styles.pheadTitle}>
          <h1>{t("pages.products.title") || "المنتجات"}</h1>
          <p>
            {tab === "products"
              ? `${physicalProducts.length} منتج مادي`
              : `${serviceProducts.length} خدمات وفواتير وشحن`}
          </p>
        </div>
        <div className={styles.pact}>
          {tab === "products" ? (
            <>
              {/* زر أيقونة صغير جانبي لعرض المنتجات المخفية */}
              <button
                type="button"
                className={`${styles.hiddenIconBtn} ${filterMode === "hidden" ? styles.active : ""}`}
                onClick={() =>
                  setFilterMode((prev) =>
                    prev === "hidden" ? "all" : "hidden",
                  )
                }
                title={
                  filterMode === "hidden"
                    ? "العودة لكافة المنتجات"
                    : `المخفية (${summary.hiddenCount})`
                }
                aria-label={`المخفية (${summary.hiddenCount})`}
              >
                <Icon n={filterMode === "hidden" ? "eye" : "eyeoff"} s={18} />
              </button>

              <Button
                kind="primary"
                icon="plus"
                style={{ flex: 1 }}
                className={styles.addBtnFull}
                onClick={() => setIsChoosingType(true)}
                data-testid="add-product-btn"
              >
                {t("pages.products.add") || "إضافة منتج"}
              </Button>
            </>
          ) : (
            <>
              {/* زر أيقونة صغير جانبي لعرض الخدمات المخفية */}
              <button
                type="button"
                className={`${styles.hiddenIconBtn} ${filterMode === "hidden" ? styles.active : ""}`}
                onClick={() =>
                  setFilterMode((prev) =>
                    prev === "hidden" ? "all" : "hidden",
                  )
                }
                title={filterMode === "hidden" ? "العودة للخدمات" : "المخفية"}
                aria-label="المخفية"
              >
                <Icon n={filterMode === "hidden" ? "eye" : "eyeoff"} s={18} />
              </button>

              <button
                type="button"
                className={styles.manageMachinesBtn}
                onClick={() => setIsMachinesModalOpen(true)}
                title="إدارة ماكينات الدفع والشبكات"
              >
                <Icon n="store" s={16} />
                <span className={styles.manageMachinesTextDesktop}>
                  ماكينات الدفع
                </span>
                <span className={styles.manageMachinesTextMobile}>
                  الماكينات
                </span>
              </button>

              <Button
                kind="primary"
                style={{ flex: 1, minWidth: 0 }}
                className={styles.addBtnFull}
                onClick={() => {
                  setAddingSection("services");
                  setIsAdding(true);
                }}
              >
                <span className={styles.addBtnTextDesktop}>
                  + إضافة خدمة أو كارت
                </span>
                <span className={styles.addBtnTextMobile}>+ إضافة خدمة</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Top Segmented Tabs: المنتجات vs الفواتير والشحن */}
      <div className={styles.tabsBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "products" ? styles.active : ""}`}
          onClick={() => {
            setTab("products");
            setQuery("");
          }}
        >
          <Icon n="box" s={16} />
          <span>المنتجات</span>
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${tab === "services" ? styles.active : ""}`}
          onClick={() => {
            setTab("services");
            setQuery("");
          }}
        >
          <Icon n="wifi" s={16} />
          <span>الفواتير والشحن</span>
        </button>
      </div>

      {/* Hidden view notification banner */}
      {filterMode === "hidden" && (
        <div className={styles.hiddenActiveBanner}>
          <span>
            أنت تشاهد حالياً الأصناف المخفية من المحل (
            {tab === "products"
              ? filteredPhysicalProducts.length
              : filteredServiceProducts.length}{" "}
            عنصر)
          </span>
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={styles.unhideBtn}
          >
            العودة للعناصر المعروضة
          </button>
        </div>
      )}

      {/* Offline banner if offline */}
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <span>
            الوضع غير متصل — تصفح المنتجات والخدمات يعمل محلياً من الذاكرة
          </span>
        </div>
      )}

      {/* Search Bar */}
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={
          tab === "products"
            ? t("pages.products.searchPlaceholder") ||
              "دوّر على منتج… اكتب أو اتكلم"
            : "دوّر في الفواتير أو كروت الشحن أو الشركات..."
        }
      />

      {tab === "products" ? (
        /* ================= TAB 1: المنتجات الفيزيائية ================= */
        <>
          {/* Physical Filter Chips */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${filterMode === "all" && activeCategory === "all" ? styles.active : ""}`}
              onClick={() => {
                setFilterMode("all");
                setActiveCategory("all");
              }}
            >
              الكل ({physicalProducts.filter((p) => !p.is_hidden).length})
            </button>

            {summary.customCount > 0 && (
              <button
                type="button"
                className={`${styles.chip} ${filterMode === "custom" ? styles.active : ""}`}
                onClick={() => {
                  setFilterMode((prev) =>
                    prev === "custom" ? "all" : "custom",
                  );
                }}
              >
                أضافه المحل ({summary.customCount})
              </button>
            )}

            {physicalCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.chip} ${activeCategory === cat && filterMode === "all" ? styles.active : ""}`}
                onClick={() => {
                  setFilterMode("all");
                  setActiveCategory((prev) => (prev === cat ? "all" : cat));
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {notice && (
            <div
              role="status"
              data-testid="product-notice"
              style={{ color: "var(--ok)", fontSize: 13, fontWeight: 700 }}
            >
              {notice}
            </div>
          )}

          {/* Sandwich load failure (cost/profit cannot be shown without the server) */}
          {sandwichError && (
            <div
              role="alert"
              data-testid="sandwich-load-error"
              style={{
                color: "var(--red, #cf3c3c)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {t("sandwich.listFailed")} — {sandwichError}
            </div>
          )}

          {/* Error notification if any */}
          {error && (
            <div
              style={{
                color: "var(--red, #cf3c3c)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}

          {/* Physical Products Grid */}
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--ink2)",
              }}
            >
              جارٍ تحميل المنتجات...
            </div>
          ) : filteredPhysicalProducts.length === 0 ? (
            <div className={styles.pcard}>
              <Empty
                icon={query ? "search" : "box"}
                title={
                  query ? "مفيش منتج بالاسم ده" : "مفيش منتجات في هذا القسم"
                }
                sub={
                  query
                    ? "جرّب كلمة تانية أو ضيف منتج جديد"
                    : "اضغط على إضافة منتج للبدء"
                }
                action={
                  <Button
                    kind="primary"
                    icon="plus"
                    onClick={() => setIsChoosingType(true)}
                  >
                    {t("pages.products.add") || "إضافة منتج"}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredPhysicalProducts.map((p) => {
                const firstVariant = p.variants?.[0];
                const hasPack = Boolean(
                  firstVariant?.pack_qty && firstVariant.pack_qty > 1,
                );
                const isWeight = isWeightProduct(p);
                const packQty = firstVariant?.pack_qty ?? 1;

                // Calculations for prices
                const pieceSell = p.sell_price_piasters;
                const pieceBuy = p.buy_cost_piasters ?? 0;
                const packSell = pieceSell * packQty;
                const packBuy = pieceBuy > 0 ? pieceBuy * packQty : 0;

                const isMenuOpen = menuOpenId === p.id;

                return (
                  <div
                    className={`${styles.pcard} ${p.is_hidden ? styles.cardHidden : ""} ${isMenuOpen ? styles.activeMenuCard : ""}`}
                    key={p.id}
                    data-testid={`product-card-${p.id}`}
                    onClick={() => openProduct(p)}
                  >
                    {/* Card Top: 3-dots Menu + Title */}
                    <div className={styles.pch}>
                      <div className={styles.pcn}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <b>{p.name_ar}</b>
                          {(p.is_custom || p.added_by_this_store) && (
                            <span
                              className={styles.customStoreBadge}
                              title="منتج تم إنشاؤه بواسطة هذا المحل"
                            >
                              <Icon n="store" s={11} />
                              <span>من محلك</span>
                            </span>
                          )}
                        </div>
                        <small>
                          {isSandwich(p)
                            ? sandwichSubtitle(sandwichById.get(p.id))
                            : formatSubtitle(p)}
                        </small>
                      </div>

                      {/* 3-dots menu button */}
                      <div
                        style={{ position: "relative" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={styles.menuBtn}
                          aria-label={`خيارات ${p.name_ar}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId((prev) =>
                              prev === p.id ? null : p.id,
                            );
                          }}
                          title="خيارات المنتج"
                        >
                          <Icon n="more" s={20} />
                        </button>

                        {isMenuOpen && (
                          <div
                            className={styles.menuDropdown}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className={styles.menuItem}
                              onClick={() => {
                                setMenuOpenId(null);
                                openProduct(p);
                              }}
                            >
                              <Icon n="edit" s={14} />
                              <span>تعديل الأسعار</span>
                            </button>
                            {isSandwich(p) && !p.is_hidden && (
                              <button
                                type="button"
                                className={styles.menuItem}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  // Opens the Sales screen with a quantity step; nothing is
                                  // sold until the user confirms there.
                                  stageSandwichForSale(p.id);
                                  window.history.pushState(
                                    null,
                                    "",
                                    "/app/sales",
                                  );
                                  window.dispatchEvent(
                                    new PopStateEvent("popstate"),
                                  );
                                }}
                                data-testid={`add-to-sale-${p.id}`}
                              >
                                <Icon n="cart" s={14} />
                                <span>{t("sandwich.addToSale")}</span>
                              </button>
                            )}
                            {!isSandwich(p) && (
                              <button
                                type="button"
                                className={styles.menuItem}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  if ((p.stock_quantity ?? 0) > 0) {
                                    alert(
                                      `⚠️ هذا المنتج «${p.name_ar}» مضاف بالفعل في المخزون (الرصيد المتاح: ${p.stock_quantity}). يمكنك إضافة دفعة توريد جديدة أو تعديل رصيده.`,
                                    );
                                  }
                                  setStockModalProduct(p);
                                }}
                              >
                                <Icon n="plus" s={14} />
                                <span>إضافة إلى المخزون</span>
                              </button>
                            )}
                            {p.is_hidden ? (
                              <button
                                type="button"
                                className={styles.menuItem}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  handleToggleHide(p);
                                }}
                              >
                                <Icon n="eye" s={14} />
                                <span>إعادة إظهار</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`${styles.menuItem} ${styles.danger}`}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  handleToggleHide(p);
                                }}
                              >
                                <Icon n="eyeoff" s={14} />
                                <span>إخفاء من المحل</span>
                              </button>
                            )}
                            {isShopCreated(p) && (
                              <button
                                type="button"
                                className={`${styles.menuItem} ${styles.danger}`}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setDeleteError(null);
                                  setDeleteTarget(p);
                                }}
                                data-testid={`delete-product-${p.id}`}
                              >
                                <Icon n="trash" s={14} />
                                <span>{t("productDelete.menu")}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Price boxes */}
                    <div className={styles.prs}>
                      {isSandwich(p) ? (
                        <SandwichPriceBox
                          sandwich={sandwichById.get(p.id)}
                          sellPricePiasters={p.sell_price_piasters}
                        />
                      ) : isWeight ? (
                        <PriceBox
                          label={p.unit === "g" ? "بالجرام" : "بالكيلو"}
                          buy={pieceBuy}
                          sell={pieceSell}
                        />
                      ) : (
                        <>
                          <PriceBox
                            label={p.unit === "bag" ? "الكيس" : "القطعة"}
                            buy={pieceBuy}
                            sell={pieceSell}
                          />
                          {hasPack && (
                            <PriceBox
                              label="الكرتونة"
                              buy={packBuy}
                              sell={packSell}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ================= TAB 2: الفواتير والشحن والخدمات ================= */
        <>
          {/* Exactly 5 Main Service Category Chips in a single scrollable row */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${serviceCategory === "utilities" ? styles.active : ""}`}
              onClick={() => {
                setServiceCategory("utilities");
                setCompanyFilter("all");
              }}
            >
              شحن المرافق
            </button>
            <button
              type="button"
              className={`${styles.chip} ${serviceCategory === "internet" ? styles.active : ""}`}
              onClick={() => {
                setServiceCategory("internet");
                setCompanyFilter("all");
              }}
            >
              فواتير الإنترنت
            </button>
            <button
              type="button"
              className={`${styles.chip} ${serviceCategory === "cards" ? styles.active : ""}`}
              onClick={() => {
                setServiceCategory("cards");
                setCompanyFilter("all");
              }}
            >
              كروت الشحن
            </button>
            <button
              type="button"
              className={`${styles.chip} ${serviceCategory === "transfer" ? styles.active : ""}`}
              onClick={() => {
                setServiceCategory("transfer");
                setCompanyFilter("all");
              }}
            >
              تحويل الأموال
            </button>
            <button
              type="button"
              className={`${styles.chip} ${serviceCategory === "airtime" ? styles.active : ""}`}
              onClick={() => {
                setServiceCategory("airtime");
                setCompanyFilter("all");
              }}
            >
              شحن الرصيد
            </button>
          </div>

          {/* Contextual Subcategory / Company Chips based on active service category */}
          <div className={styles.chips} style={{ marginTop: -4 }}>
            <button
              type="button"
              className={`${styles.chip} ${companyFilter === "all" ? styles.active : ""}`}
              style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
              onClick={() => setCompanyFilter("all")}
            >
              الكل
            </button>

            {serviceCategory === "utilities" && (
              <>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "electricity" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("electricity")}
                >
                  الكهرباء
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "water" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("water")}
                >
                  المياه
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "gas" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("gas")}
                >
                  الغاز الطبيعي
                </button>
              </>
            )}

            {serviceCategory === "internet" && (
              <>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "we" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("we")}
                >
                  وي (WE)
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "vodafone" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("vodafone")}
                >
                  فودافون
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "orange" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("orange")}
                >
                  أورانج
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "etisalat" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("etisalat")}
                >
                  اتصالات (e&)
                </button>
              </>
            )}

            {serviceCategory === "cards" && (
              <>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "vodafone" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("vodafone")}
                >
                  فودافون
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "orange" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("orange")}
                >
                  أورانج
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "etisalat" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("etisalat")}
                >
                  اتصالات (e&)
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "we" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("we")}
                >
                  وي (WE)
                </button>
              </>
            )}

            {serviceCategory === "transfer" && (
              <>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "instapay" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("instapay")}
                >
                  إنستاباي (InstaPay)
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "vodafone" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("vodafone")}
                >
                  فودافون كاش
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "fawry" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("fawry")}
                >
                  فوري (Fawry)
                </button>
              </>
            )}

            {serviceCategory === "airtime" && (
              <>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "vodafone" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("vodafone")}
                >
                  فودافون
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "orange" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("orange")}
                >
                  أورانج
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "etisalat" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("etisalat")}
                >
                  اتصالات (e&)
                </button>
                <button
                  type="button"
                  className={`${styles.chip} ${companyFilter === "we" ? styles.active : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px", minHeight: 32 }}
                  onClick={() => setCompanyFilter("we")}
                >
                  وي (WE)
                </button>
              </>
            )}
          </div>

          {/* Services Grid */}
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--ink2)",
              }}
            >
              جارٍ تحميل الخدمات وكروت الشحن...
            </div>
          ) : filteredServiceProducts.length === 0 ? (
            <div className={styles.pcard}>
              <Empty
                icon="wifi"
                title={query ? "مفيش خدمة تطابق البحث" : "مفيش خدمات مسجلة"}
                sub="اضغط على زر إضافة خدمة / كارت لتفعيل خدمات الدفع والشحن في محلك"
                action={
                  <Button
                    kind="primary"
                    icon="plus"
                    onClick={() => {
                      setAddingSection("services");
                      setIsAdding(true);
                    }}
                  >
                    + إضافة خدمة أو كارت
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={styles.serviceGrid}>
              {filteredServiceProducts.map((p) => {
                const brand = getBrandBadge(p);
                const nature = getServiceNature(p);
                const linkedMachineIds = assignedMachines[p.id] || [];
                const linkedMachines = posMachines.filter((m) =>
                  linkedMachineIds.includes(m.id),
                );
                const isMenuOpen = menuOpenId === p.id;

                const pieceSell = p.sell_price_piasters;
                const pieceBuy = p.buy_cost_piasters ?? 0;
                const profitPiasters = Math.max(0, pieceSell - pieceBuy);

                return (
                  <div
                    className={`${styles.serviceCard} ${p.is_hidden ? styles.cardHidden : ""} ${isMenuOpen ? styles.activeMenuCard : ""}`}
                    key={p.id}
                    onClick={() => setEditingProduct(p)}
                  >
                    <div className={styles.serviceCardHeader}>
                      <div className={styles.serviceCardInfo}>
                        <b>{p.name_ar}</b>
                        <div className={styles.serviceCardBadges}>
                          <span
                            className={`${styles.brandBadge} ${brand.className}`}
                          >
                            {brand.name}
                          </span>
                          <span
                            className={`${styles.natureBadge} ${nature.isStock ? styles.natureBadgeStock : ""}`}
                          >
                            {nature.label}
                          </span>
                        </div>
                      </div>

                      {/* 3-dots Menu */}
                      <div
                        style={{ position: "relative" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={styles.menuBtn}
                          aria-label={`خيارات ${p.name_ar}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId((prev) =>
                              prev === p.id ? null : p.id,
                            );
                          }}
                          title="خيارات الخدمة"
                        >
                          <Icon n="more" s={20} />
                        </button>

                        {isMenuOpen && (
                          <div
                            className={styles.menuDropdown}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className={styles.menuItem}
                              onClick={() => {
                                setMenuOpenId(null);
                                setEditingProduct(p);
                              }}
                            >
                              <Icon n="edit" s={14} />
                              <span>تعديل العمولة</span>
                            </button>

                            <button
                              type="button"
                              className={styles.menuItem}
                              onClick={() => {
                                setMenuOpenId(null);
                                setMachineAssignProduct(p);
                              }}
                            >
                              <Icon n="store" s={14} />
                              <span>ربط بماكينة</span>
                            </button>

                            <button
                              type="button"
                              className={styles.menuItem}
                              onClick={() => {
                                setMenuOpenId(null);
                                handleAddToSale(p);
                              }}
                            >
                              <Icon n="cart" s={14} />
                              <span>إضافة إلى البيع</span>
                            </button>

                            <button
                              type="button"
                              className={`${styles.menuItem} ${styles.danger}`}
                              onClick={() => {
                                setMenuOpenId(null);
                                handleToggleHide(p);
                              }}
                            >
                              <Icon n={p.is_hidden ? "eye" : "eyeoff"} s={14} />
                              <span>
                                {p.is_hidden ? "إعادة إظهار" : "إخفاء الخدمة"}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Economics & Details Row */}
                    <div className={styles.serviceDetailsRow}>
                      {nature.isStock ? (
                        <div className={styles.serviceEconomics}>
                          <span>
                            سعر البيع: <b>{fmtMoney(pieceSell)} ج.م</b>
                          </span>
                          <span>
                            التكلفة: <b>{fmtMoney(pieceBuy)} ج.م</b>
                          </span>
                          <span className={styles.serviceProfitPill}>
                            ربحك: {fmtMoney(profitPiasters)} ج.م
                          </span>
                        </div>
                      ) : (
                        <div className={styles.serviceEconomics}>
                          <span>
                            عمولة المحل: <b>{fmtMoney(pieceSell)} ج.م</b>
                          </span>
                          {pieceBuy > 0 && (
                            <span
                              style={{ color: "var(--ink2)", fontSize: 11.5 }}
                            >
                              رسوم المزود: {fmtMoney(pieceBuy)} ج.م
                            </span>
                          )}
                          <span className={styles.serviceProfitPill}>
                            صافي ربحك: {fmtMoney(profitPiasters)} ج.م
                          </span>
                        </div>
                      )}

                      {linkedMachines.length > 0 ? (
                        <div className={styles.serviceMachineTag}>
                          <span>
                            📱 ماكينات الدفع ({linkedMachines.length}):
                          </span>
                          <b>{linkedMachines.map((m) => m.name).join("، ")}</b>
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--red, #cf3c3c)",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>⚠️</span>
                          <span>غير مربوط بماكينة (مطلوب للبيع)</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Delete a shop-created product: confirmation */}
      {deleteTarget && (
        <Modal
          title={t("productDelete.title")}
          onClose={() => !deleting && setDeleteTarget(null)}
          footer={
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <Button
                kind="ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                {t("productDelete.cancel")}
              </Button>
              <Button
                kind="danger"
                icon="trash"
                style={{ flex: 1 }}
                busy={deleting}
                onClick={() => void handleDeleteShopProduct()}
                data-testid="confirm-delete-product"
              >
                {t("productDelete.confirmBtn")}
              </Button>
            </div>
          }
        >
          <div
            style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink)" }}
            data-testid="delete-product-dialog"
          >
            <b>{t("productDelete.confirm", { name: deleteTarget.name_ar })}</b>
            <p
              style={{ margin: "8px 0 0", color: "var(--ink2)", fontSize: 13 }}
            >
              {t("productDelete.note")}
            </p>
            <p
              style={{ margin: "6px 0 0", color: "var(--ink2)", fontSize: 13 }}
            >
              {t("productDelete.historyNote")}
            </p>
            {deleteError && (
              <p
                role="alert"
                style={{
                  margin: "10px 0 0",
                  color: "var(--red)",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {deleteError}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* "إضافة منتج": normal product or sandwich */}
      {isChoosingType && (
        <AddProductChoiceModal
          onClose={() => setIsChoosingType(false)}
          onChooseNormal={() => {
            setIsChoosingType(false);
            setAddingSection("products");
            setIsAdding(true);
          }}
          onChooseSandwich={() => {
            setIsChoosingType(false);
            setSandwichForm({ sandwich: null });
          }}
        />
      )}

      {/* Sandwich Form Modal (Add / Edit) */}
      {sandwichForm && (
        <SandwichFormModal
          sandwich={sandwichForm.sandwich}
          onClose={() => setSandwichForm(null)}
          onSaved={() => {
            void loadProducts();
            void loadSandwiches();
          }}
        />
      )}

      {/* Physical Product Form Modal (Add / Edit) */}
      {((isAdding && addingSection === "products") ||
        (editingProduct && !isServiceProduct(editingProduct))) && (
        <ProductFormModal
          product={editingProduct}
          existingProducts={products}
          defaultCategory={
            activeCategory !== "all" ? activeCategory : "السلع الاستهلاكية"
          }
          onClose={() => {
            setIsAdding(false);
            setEditingProduct(null);
          }}
          onSaved={() => {
            setIsAdding(false);
            setEditingProduct(null);
            void loadProducts();
          }}
          onDeleted={() => {
            setIsAdding(false);
            setEditingProduct(null);
            void loadProducts();
          }}
        />
      )}

      {/* Digital Services & Bills / Recharge Form Modal (Add / Edit) */}
      {((isAdding && addingSection === "services") ||
        (editingProduct && isServiceProduct(editingProduct))) && (
        <ServiceFormModal
          product={editingProduct}
          existingServices={serviceProducts}
          presetCategory={
            editingProduct?.category ||
            (serviceCategory === "utilities"
              ? "خدمات مرافق"
              : serviceCategory === "cards"
                ? "كروت شحن"
                : serviceCategory === "transfer"
                  ? "تحويل أموال"
                  : serviceCategory === "airtime"
                    ? "شحن رصيد"
                    : "فواتير إنترنت")
          }
          onClose={() => {
            setIsAdding(false);
            setEditingProduct(null);
          }}
          onSaved={() => {
            setIsAdding(false);
            setEditingProduct(null);
            void loadProducts();
          }}
          onDeleted={() => {
            setIsAdding(false);
            setEditingProduct(null);
            void loadProducts();
          }}
        />
      )}

      {/* Add Stock Modal */}
      {stockModalProduct && (
        <AddStockModal
          targetProduct={stockModalProduct}
          onClose={() => setStockModalProduct(null)}
          onAdded={() => {
            setStockModalProduct(null);
            void loadProducts();
          }}
        />
      )}

      {/* POS Machines & Providers Management Modal */}
      {isMachinesModalOpen && (
        <MachinesModal
          storeId={storeId}
          onClose={() => setIsMachinesModalOpen(false)}
          onMachinesUpdated={(updated) => setPosMachines(updated)}
        />
      )}

      {/* Machine Assignment Modal */}
      {machineAssignProduct && (
        <Modal
          title={`ربط بماكينات الدفع: ${machineAssignProduct.name_ar}`}
          onClose={() => setMachineAssignProduct(null)}
          footer={
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <Button
                kind="primary"
                size="lg"
                type="button"
                onClick={() => setMachineAssignProduct(null)}
                style={{ flex: 1 }}
              >
                تأكيد وحفظ الماكينات
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--ink2)",
                lineHeight: 1.5,
              }}
            >
              حدد ماكينات الدفع المسؤولة عن تقديم خدمة{" "}
              <b>{machineAssignProduct.name_ar}</b> داخل المحل (يمكنك اختيار
              أكثر من ماكينة):
            </p>

            {posMachines.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  textAlign: "center",
                  background: "var(--sf2)",
                  borderRadius: 12,
                  fontSize: 13,
                  color: "var(--ink2)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span>لا توجد ماكينات دفع مسجلة لهذا المتجر بعد</span>
                <Button
                  kind="primary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setMachineAssignProduct(null);
                    setIsMachinesModalOpen(true);
                  }}
                >
                  + إضافة ماكينة دفع الآن
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {posMachines.map((m) => {
                  const currentLinked =
                    assignedMachines[machineAssignProduct.id] || [];
                  const isChecked = currentLinked.includes(m.id);

                  return (
                    <div
                      key={m.id}
                      onClick={() =>
                        handleToggleMachineAssignment(
                          machineAssignProduct.id,
                          m.id,
                        )
                      }
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: isChecked
                          ? "1.5px solid var(--br, #5a7d5a)"
                          : "1px solid var(--line)",
                        background: isChecked ? "var(--sf2)" : "var(--sf)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: `2px solid ${isChecked ? "var(--br, #5a7d5a)" : "var(--line)"}`,
                            background: isChecked
                              ? "var(--br, #5a7d5a)"
                              : "transparent",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            fontWeight: 800,
                          }}
                        >
                          {isChecked && "✓"}
                        </div>
                        <div>
                          <b
                            style={{
                              fontSize: 14,
                              color: "var(--ink)",
                              display: "block",
                            }}
                          >
                            {m.name} ({m.provider})
                          </b>
                          <small style={{ color: "var(--ink2)", fontSize: 12 }}>
                            الرصيد المتاح:{" "}
                            {(m.currentBalancePiasters / 100).toLocaleString(
                              "ar-EG",
                            )}{" "}
                            ج.م
                          </small>
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isChecked
                            ? "var(--br, #5a7d5a)"
                            : "var(--ink2)",
                        }}
                      >
                        {isChecked ? "مربوطة بالخدمة" : "اضغط للربط"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ProductsView;
