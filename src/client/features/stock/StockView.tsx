"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Icon, Modal, useToast } from "@/client/shared/ui";
import { normalizeArabic } from "@/domain/normalize";
import { isServiceProduct as isServiceProductRule } from "@/domain/sale-pricing";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { useAuth } from "@/client/shared/auth";
import { OPEN_STOCK_SCAN_KEY } from "../home/HomeView";
import { ProductFormModal } from "../products/ProductFormModal";
import {
  optionFromInventory,
  optionFromProduct,
  type StockProductOption,
} from "./stock-entry.logic";
import { StockEntrySheet, formatOptionStock } from "./StockEntrySheet";
import { BarcodeScanSheet } from "@/client/shared/scanner/BarcodeScanSheet";
import styles from "./StockView.module.css";

type Overlay = null | "manual" | "scan" | "entry";

function physicalOnly(
  items: StockInventoryItem[] | undefined,
): StockInventoryItem[] {
  return (items ?? []).filter(
    (i) =>
      !isServiceProductRule({
        category: i.category ?? null,
        unit: i.unit ?? null,
      }),
  );
}

/** One stock movement as `/api/stock?view=all` returns it. */
interface StockEntryMove {
  id: string;
  batchId?: string | null;
  productName: string;
  flavor?: string | null;
  unitMode?: "piece" | "weight";
  type: string;
  quantityBase: number;
  costTotalMinor?: number | null;
  createdAt: string;
}

/** The last stock that came in (received batches only), newest first. */
function recentEntries(moves: StockEntryMove[] | undefined): StockEntryMove[] {
  return (moves ?? [])
    .filter(
      (m) =>
        (m.type === "purchase" || m.type === "initial_stock") &&
        m.quantityBase > 0 &&
        m.batchId,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
}

const whenText = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));

export function StockView() {
  const toast = useToast();
  useAuth();

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProductItem[]>([]);
  // The latest stock entries: the place to cancel one (reports only show them).
  const [entries, setEntries] = useState<StockEntryMove[]>([]);
  const [voiding, setVoiding] = useState<string | null>(null);

  // Manual selection
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOption, setSelectedOption] =
    useState<StockProductOption | null>(null);

  // New product modal
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [extraOptions, setExtraOptions] = useState<StockProductOption[]>([]);

  const [newProductBarcode, setNewProductBarcode] = useState("");

  // Physical scanner on the landing / manual screens (the scan sheet has its own).
  const physicalScanBuffer = useRef("");
  const physicalScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Data loading ───

  const loadData = useCallback(async () => {
    try {
      const [stockRes, prodRes] = await Promise.all([
        apiGet("/api/stock?view=all"),
        apiGet("/api/products?filter=all").catch(() => null),
      ]);
      if (!stockRes.ok) throw new Error("فشل تحميل بيانات المخزون");
      const data = await stockRes.json();
      setInventory(physicalOnly(data.inventory));
      setEntries(recentEntries(data.movements));
      if (prodRes && prodRes.ok) {
        const prodData = await prodRes.json();
        setStoreProducts(prodData.products || []);
      }
    } catch {
      // silently fail, user can still use manual flow
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchInitial = async () => {
      try {
        const [stockRes, prodRes] = await Promise.all([
          apiGet("/api/stock?view=all"),
          apiGet("/api/products?filter=all").catch(() => null),
        ]);
        if (ignore) return;
        if (!stockRes.ok) return;
        const data = await stockRes.json();
        setInventory(physicalOnly(data.inventory));
        setEntries(recentEntries(data.movements));
        if (prodRes && prodRes.ok) {
          const prodData = await prodRes.json();
          setStoreProducts(prodData.products || []);
        }
      } catch {
        // silently fail
      }
    };
    void fetchInitial();
    return () => {
      ignore = true;
    };
  }, []);

  // ─── Product options ───

  const productOptions: StockProductOption[] = useMemo(() => {
    const invMap = new Map<string, StockInventoryItem>();
    inventory.forEach((i) => {
      invMap.set(i.variantId, i);
      invMap.set(i.productId, i);
    });

    const options: StockProductOption[] = [];
    const seenIds = new Set<string>();

    storeProducts
      .filter((p) => !isServiceProduct(p))
      .forEach((p) => {
        const v = p.variants?.[0];
        const vId = v?.id || p.id;
        seenIds.add(vId);
        seenIds.add(p.id);
        options.push(optionFromProduct(p, invMap.get(vId) || invMap.get(p.id)));
      });

    inventory.forEach((i) => {
      if (!seenIds.has(i.variantId) && !seenIds.has(i.productId)) {
        options.push(optionFromInventory(i));
      }
    });

    extraOptions.forEach((opt) => {
      if (!seenIds.has(opt.variantId) && !seenIds.has(opt.productId)) {
        seenIds.add(opt.variantId);
        options.push(opt);
      }
    });

    return options;
  }, [inventory, storeProducts, extraOptions]);

  const filteredOptions = useMemo(() => {
    const q = normalizeArabic(searchQuery.trim());
    if (!q) return productOptions;
    return productOptions.filter(
      (opt) =>
        normalizeArabic(opt.productName).includes(q) ||
        (opt.flavor && normalizeArabic(opt.flavor).includes(q)),
    );
  }, [productOptions, searchQuery]);

  // ─── Select product and go to the quantity sheet ───

  const selectProduct = useCallback((opt: StockProductOption) => {
    setSelectedOption(opt);
    setOverlay("entry");
  }, []);

  // ─── Barcode lookup ───

  const lookupBarcode = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      const byInventory = inventory.find((i) => i.barcode?.trim() === trimmed);
      const found = storeProducts.find(
        (p) =>
          p.barcode?.trim() === trimmed ||
          p.variants?.some((v) => v.barcode?.trim() === trimmed) ||
          (byInventory && p.id === byInventory.productId),
      );

      if (found) {
        const v = found.variants?.[0];
        const opt = optionFromProduct(
          found,
          inventory.find(
            (i) =>
              i.variantId === (v?.id || found.id) || i.productId === found.id,
          ),
        );
        selectProduct(opt);
        toast.show({ msg: `✓ ${found.name_ar}`, kind: "ok" });
      } else {
        // A barcode no product has: straight to the new-product form with the code already
        // in it (no second scan, nothing typed again); saving it goes on to the quantity.
        setOverlay(null);
        setNewProductBarcode(trimmed);
        setShowNewProduct(true);
        toast.show({ msg: "الباركود ده مش موجود عندك: سجّل المنتج" });
      }
    },
    [storeProducts, inventory, toast, selectProduct],
  );

  const openScan = useCallback(() => setOverlay("scan"), []);
  const closeScan = useCallback(() => setOverlay(null), []);

  // Home's first-run «ابدأ بالباركود»: open the scanner straight away.
  useEffect(() => {
    let open = false;
    try {
      open = sessionStorage.getItem(OPEN_STOCK_SCAN_KEY) === "1";
      if (open) sessionStorage.removeItem(OPEN_STOCK_SCAN_KEY);
    } catch {
      open = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the camera on arrival
    if (open) openScan();
  }, [openScan]);

  // Physical barcode scanner: listen for rapid keystrokes ending with Enter
  useEffect(() => {
    if (overlay !== null && overlay !== "manual") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter") {
        const code = physicalScanBuffer.current.trim();
        if (code.length >= 4) {
          // The scanner's Enter must not also press the focused button.
          e.preventDefault();
          e.stopPropagation();
          lookupBarcode(code);
        }
        physicalScanBuffer.current = "";
        return;
      }

      if (e.key.length === 1) {
        physicalScanBuffer.current += e.key;
        if (physicalScanTimer.current) clearTimeout(physicalScanTimer.current);
        physicalScanTimer.current = setTimeout(() => {
          physicalScanBuffer.current = "";
        }, 100);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [overlay, lookupBarcode]);

  /** Cancels what is left of a stock entry (its quantity leaves the stock). */
  const voidEntry = async (batchId: string) => {
    if (
      !window.confirm("تلغي الدخلة دي؟ اللي فاضل من كميتها هيطلع من المخزون.")
    ) {
      return;
    }
    setVoiding(batchId);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "void",
          batchId,
          opId: crypto.randomUUID(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error?.message || "مقدرناش نلغي الدخلة");
      }
      toast.show({ msg: "اتلغت الدخلة", kind: "ok" });
      window.dispatchEvent(new CustomEvent("hesba_stock_updated"));
      void loadData();
    } catch (e: unknown) {
      toast.show({
        msg: e instanceof Error ? e.message : "مقدرناش نلغي الدخلة",
        kind: "err",
      });
    } finally {
      setVoiding(null);
    }
  };

  // ─── Render ───

  return (
    <div className={styles.view} data-testid="page-stock" dir="rtl">
      {/* Landing (V19) */}
      <h2 className={styles.landingTitle}>دخلت بضاعة جديدة؟</h2>

      <button
        type="button"
        className={styles.big}
        onClick={openScan}
        data-testid="stock-scan-btn"
      >
        <i aria-hidden="true">📷</i>
        امسح الباركود
      </button>

      <button
        type="button"
        className={styles.big}
        onClick={() => setOverlay("manual")}
        data-testid="stock-manual-btn"
      >
        <i aria-hidden="true">✍️</i>
        تسجيل يدوي
      </button>

      <p className={styles.note}>
        لو المنتج موجود، هتدخل الكمية والصلاحية بس. لو مش موجود، هتسجله بكل
        تفاصيله.
      </p>

      {entries.length > 0 && (
        <>
          <h3 className={styles.sech}>آخر بضاعة دخلت</h3>
          <div className={styles.sumbox} data-testid="stock-recent">
            {entries.map((m) => (
              <div key={m.id} className={styles.line}>
                <span>
                  {m.productName}
                  {m.flavor ? ` (${m.flavor})` : ""} ·{" "}
                  {m.unitMode === "weight"
                    ? `${m.quantityBase / 1000} كيلو`
                    : m.quantityBase}
                  <small className={styles.muted}>
                    {" "}
                    {whenText(m.createdAt)}
                  </small>
                </span>
                <button
                  type="button"
                  className={styles.voidBtn}
                  disabled={voiding === m.batchId}
                  onClick={() => void voidEntry(m.batchId!)}
                  data-testid="stock-void-entry"
                >
                  إلغاء
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Scanner (V19 #scanSheet): the camera opens at once, decoded on the device */}
      {overlay === "scan" && (
        <BarcodeScanSheet
          onCode={lookupBarcode}
          onClose={closeScan}
          fallbackAction={{
            label: "✍️ سجّل يدوي بدل الباركود",
            onClick: () => setOverlay("manual"),
            testId: "stock-scan-manual",
          }}
        />
      )}

      {/* Manual selection Bottom Sheet */}
      {overlay === "manual" && (
        <Modal title="تسجيل يدوي" onClose={() => setOverlay(null)}>
          <div className={styles.view}>
            <p className={styles.fieldLabel}>اختار المنتج</p>

            <button
              type="button"
              className={styles.selectBtn}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              <span className={styles.selectChevron}>
                <Icon n="down" s={16} />
              </span>
              <span>
                {selectedOption
                  ? `${selectedOption.productName}${selectedOption.flavor ? ` (${selectedOption.flavor})` : ""}`
                  : "اختار المنتج"}
              </span>
            </button>

            {dropdownOpen && (
              <div className={styles.dropdownList}>
                <div className={styles.dropdownSearch}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="دوّر على المنتج..."
                    autoFocus
                  />
                </div>
                {filteredOptions.length === 0 ? (
                  <div className={styles.dropdownEmpty}>
                    مفيش منتج بالاسم ده
                  </div>
                ) : (
                  filteredOptions.map((opt) => (
                    <button
                      key={opt.variantId}
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setSelectedOption(opt);
                        setDropdownOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className={styles.dropdownItemStock}>
                        {formatOptionStock(opt)}
                      </span>
                      <span>
                        {opt.productName}
                        {opt.flavor ? ` (${opt.flavor})` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            <p className={styles.hintText}>
              المنتجات اللي من غير باركود بتبان الأول
            </p>

            <button
              type="button"
              className={styles.continueBtn}
              disabled={!selectedOption}
              onClick={() => {
                if (selectedOption) selectProduct(selectedOption);
              }}
            >
              كمّل ← الكمية
            </button>

            <button
              type="button"
              className={styles.registerBtn}
              onClick={() => setShowNewProduct(true)}
            >
              المنتج مش موجود؟ سجّله
            </button>
          </div>
        </Modal>
      )}

      {/* Quantity sheet: the product's own units, its batch expiry, how it was paid */}
      {overlay === "entry" && selectedOption && (
        <StockEntrySheet
          option={selectedOption}
          batches={
            inventory.find((i) => i.variantId === selectedOption.variantId)
              ?.batches
          }
          onClose={() => setOverlay(null)}
          onSaved={() => {
            void loadData();
            setSelectedOption(null);
            setOverlay(null);
          }}
        />
      )}

      {/* New product modal */}
      {showNewProduct && (
        <ProductFormModal
          presetName={searchQuery}
          presetBarcode={newProductBarcode}
          existingProducts={storeProducts}
          onClose={() => {
            setShowNewProduct(false);
            setNewProductBarcode("");
          }}
          onSaved={(newProduct: unknown) => {
            setShowNewProduct(false);
            const p = newProduct as StoreProductItem;
            const newOpt: StockProductOption = {
              ...optionFromProduct({
                ...p,
                name_ar: p.name_ar || "منتج جديد",
                variants: p.variants ?? [],
              }),
              currentStockBase: 0,
            };
            setNewProductBarcode("");
            void loadData();
            setExtraOptions((prev) => [newOpt, ...prev]);
            selectProduct(newOpt);
          }}
        />
      )}
    </div>
  );
}

export default StockView;
