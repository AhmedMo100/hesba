"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Empty,
  Button,
  Modal,
  ListSkeleton,
  PageTitle,
} from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { stockLevel } from "@/domain/alerts";
import { unitWord } from "@/client/shared/unit-labels";
import { ProductFormModal } from "./ProductFormModal";
import { OfferSheet } from "./OfferSheet";
import { AddProductChoiceModal } from "./AddProductChoiceModal";
import { SandwichFormModal } from "./SandwichFormModal";
import sandwichStyles from "./SandwichFormModal.module.css";
import { StockEntrySheet } from "../stock/StockEntrySheet";
import { optionFromProduct } from "../stock/stock-entry.logic";
import { RecordLossModal } from "../stock/RecordLossModal";
import type { StockInventoryItem } from "@/client/shared/store-items";
import type { PublishedPromotion } from "@/schemas/promotion";
import type { SuggestedPromotion } from "@/domain/alerts";
import {
  fetchSandwiches,
  stageSandwichForSale,
  type Sandwich,
} from "@/client/shared/api/sandwiches";
import {
  type StoreProductItem,
  isServiceProduct,
} from "@/client/shared/store-items";
import { productEmoji } from "@/client/shared/product-emoji";
import styles from "./ProductsView.module.css";

import {
  fmtMoney,
  sandwichSubtitle as sandwichSubtitlePure,
  isWeightProduct,
} from "./products.logic";

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
  return sandwichSubtitlePure(sandwich, t);
}

export function ProductsView() {
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [filterMode, setFilterMode] = useState<"all" | "custom" | "hidden">(
    "all",
  );
  const [, setSummary] = useState({
    total: 0,
    hiddenCount: 0,
    customCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // V19 has no search on this screen (the sale screen has one).
  const query = "";
  // V19 chips: the shop's products, its offers, its sandwiches.
  const [v19Chip, setV19Chip] = useState<"items" | "offers" | "sands">("items");
  const [promotions, setPromotions] = useState<PublishedPromotion[]>([]);
  // V19 offerSheet: a new offer (offer: null) or one to edit.
  const [offerSheet, setOfferSheet] = useState<{
    offer: PublishedPromotion | null;
  } | null>(null);
  const loadPromotions = useCallback(() => {
    apiGet("/api/promotions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.promotions && Array.isArray(d.promotions)) {
          setPromotions(d.promotions);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadPromotions();
    window.addEventListener("hesba_promotions_updated", loadPromotions);
    return () =>
      window.removeEventListener("hesba_promotions_updated", loadPromotions);
  }, [loadPromotions]);
  const saveOffer = async (promo: SuggestedPromotion | PublishedPromotion) => {
    const res = await fetch("/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promo),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      // The sheet shows the server's reason and stays open.
      throw new Error(json?.error?.message || "مقدرناش نحفظ العرض");
    }
    setOfferSheet(null);
    window.dispatchEvent(new Event("hesba_promotions_updated"));
  };
  const deleteOffer = async (id: string) => {
    await fetch(`/api/promotions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    setOfferSheet(null);
    window.dispatchEvent(new Event("hesba_promotions_updated"));
  };
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

  // Stock actions on one product (V19 product sheet): record a loss, archive.
  const [stockLevels, setStockLevels] = useState<StockInventoryItem[]>([]);
  const [lossTarget, setLossTarget] = useState<{
    item: StockInventoryItem;
    reason?: "expired" | "damaged" | "missing" | "other";
  } | null>(null);
  const loadStockLevels = useCallback(() => {
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.inventory && Array.isArray(d.inventory)) {
          setStockLevels(d.inventory);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadStockLevels();
    window.addEventListener("hesba_stock_updated", loadStockLevels);
    return () =>
      window.removeEventListener("hesba_stock_updated", loadStockLevels);
  }, [loadStockLevels]);
  const stockOf = (p: StoreProductItem) =>
    stockLevels.find(
      (i) => i.productId === p.id || i.variantId === p.variants?.[0]?.id,
    );
  const [stockModalProduct, setStockModalProduct] =
    useState<StoreProductItem | null>(null);
  // V19 prodSheet: one product's details and every action on it.
  const [sheetProduct, setSheetProduct] = useState<StoreProductItem | null>(
    null,
  );
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  });

  // Online / offline banner
  useEffect(() => {
    const onOn = () => setIsOnline(true);
    const onOff = () => setIsOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const res = await apiGet("/api/products?filter=all");
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
    apiGet("/api/products?filter=all")
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

  // Split into Physical Products vs Digital Services / Cards
  const physicalProducts = useMemo(() => {
    return products.filter((p) => !isServiceProduct(p));
  }, [products]);

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
    // V19: the shop's own products; a search also finds catalog products to add.
    if (filterMode !== "hidden") {
      list =
        v19Chip === "sands"
          ? list.filter((p) => p.kind === "sandwich")
          : list.filter(
              (p) =>
                p.kind !== "sandwich" &&
                (normQ ||
                  (p.stock_quantity ?? 0) > 0 ||
                  p.is_custom ||
                  p.added_by_this_store),
            );
    }
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
  }, [physicalProducts, filterMode, activeCategory, query, v19Chip]);

  // V19 rows: out of stock first, then running low, then the rest (the list's order kept).
  const sortedProducts = useMemo(() => {
    const rank = { out: 0, low: 1, ok: 2 } as const;
    return filteredPhysicalProducts
      .map((p, i) => {
        const isWeight = isWeightProduct(p);
        const packQty = p.variants?.[0]?.pack_qty ?? 1;
        const stock = p.stock_quantity ?? 0;
        const inShop =
          stock > 0 || Boolean(p.is_custom || p.added_by_this_store);
        const level: "out" | "low" | "ok" =
          inShop && p.kind !== "sandwich"
            ? stockLevel(isWeight ? "weight" : "piece", packQty, stock)
            : "ok";
        const stockTxt =
          p.kind === "sandwich"
            ? sandwichSubtitle(sandwichById.get(p.id))
            : !inShop
              ? "مش في محلك لسه"
              : isWeight
                ? `${Math.round(stock / 10) / 100} كيلو`
                : `${stock} ${unitWord(p.unit)}`;
        return { p, level, stockTxt, i };
      })
      .sort((a, b) => rank[a.level] - rank[b.level] || a.i - b.i);
  }, [filteredPhysicalProducts, sandwichById]);

  return (
    <div className={styles.view} data-testid="page-products">
      <PageTitle>إيه اللي عندك في المحل؟</PageTitle>
      {/* V19: «+ جديد» (offer / sandwich / product) */}
      <button
        type="button"
        className={styles.v19Btn}
        onClick={() => setIsChoosingType(true)}
        data-testid="add-product-btn"
      >
        + جديد
      </button>

      {/* V19 chips: المنتجات · العروض · السندوتشات */}
      <div className={styles.v19Chips} role="tablist">
        {(
          [
            ["items", "المنتجات"],
            ["offers", "العروض"],
            ["sands", "السندوتشات"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={v19Chip === k && filterMode !== "hidden"}
            className={`${styles.v19Chip} ${v19Chip === k && filterMode !== "hidden" ? styles.v19ChipOn : ""}`}
            onClick={() => {
              setV19Chip(k);
              setFilterMode("all");
              setActiveCategory("all");
            }}
            data-testid={`products-chip-${k}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Offline banner if offline */}
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <span>
            الوضع غير متصل — تصفح المنتجات والخدمات يعمل محلياً من الذاكرة
          </span>
        </div>
      )}

      {
        /* ================= المنتجات · العروض · السندوتشات ================= */
        <>
          {v19Chip === "offers" && filterMode !== "hidden" && (
            <div className={styles.rowsList} data-testid="products-offers">
              {promotions.length === 0 ? (
                <div className={styles.v19Note}>
                  مفيش عروض لسه — اعمل عرض من «+ جديد»
                </div>
              ) : (
                promotions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={styles.prow}
                    onClick={() => setOfferSheet({ offer: o })}
                  >
                    <div className={styles.pch}>
                      <span className={styles.prowEm} aria-hidden="true">
                        🎁
                      </span>
                      <div className={styles.pcn}>
                        <b>{o.title}</b>
                        <small>
                          {o.promoPricePiasters / 100} ج · بدل{" "}
                          {o.originalPricePiasters / 100} ج
                        </small>
                      </div>
                      <span aria-hidden="true">›</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

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
            <ListSkeleton label="بيحمّل المنتجات…" />
          ) : v19Chip === "offers" &&
            filterMode !== "hidden" ? null : filteredPhysicalProducts.length ===
            0 ? (
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
            <div className={styles.rowsList}>
              {sortedProducts.map(({ p, level, stockTxt }) => (
                <button
                  type="button"
                  className={`${styles.prow} ${level === "out" ? styles.prowRed : level === "low" ? styles.prowYel : ""} ${p.is_hidden ? styles.cardHidden : ""}`}
                  key={p.id}
                  data-testid={`product-card-${p.id}`}
                  onClick={() => setSheetProduct(p)}
                >
                  <div className={styles.pch}>
                    <span className={styles.prowEm} aria-hidden="true">
                      {isSandwich(p) ? "🥪" : isWeightProduct(p) ? "⚖️" : "📦"}
                    </span>
                    <div className={styles.pcn}>
                      <b>{p.name_ar}</b>
                      <small>
                        {stockTxt}
                        {p.sell_price_piasters > 0
                          ? ` · ${p.sell_price_piasters / 100} ج`
                          : ""}
                      </small>
                    </div>
                    <span aria-hidden="true">›</span>
                  </div>
                  {isSandwich(p) && (
                    <SandwichPriceBox
                      sandwich={sandwichById.get(p.id)}
                      sellPricePiasters={p.sell_price_piasters}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      }

      {/* V19 prodSheet: المتاح, the prices, the batches, then the actions */}
      {sheetProduct &&
        (() => {
          const p = sheetProduct;
          const stock = stockOf(p);
          const sandwich = isSandwich(p);
          const isWeight = isWeightProduct(p);
          const v = p.variants?.[0];
          const packQty = v?.pack_qty ?? 1;
          const close = () => setSheetProduct(null);
          const live = (stock?.batches ?? [])
            .filter((b) => b.remainingQty > 0)
            .sort((a, b) =>
              (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"),
            );
          const expired = live.some(
            (b) =>
              b.expiryDate &&
              b.expiryDate.slice(0, 10) < new Date().toISOString().slice(0, 10),
          );
          return (
            <Modal
              title={`${sandwich ? "🥪" : productEmoji({ name: p.name_ar, category: p.category, unit: p.unit, weighed: isWeight })} ${p.name_ar}`}
              onClose={close}
            >
              <div className={styles.sheet19} data-testid="product-sheet">
                <div className={styles.line19}>
                  <span>المتاح</span>
                  <b>
                    {sandwich
                      ? sandwichSubtitle(sandwichById.get(p.id))
                      : isWeight
                        ? `${Math.round((p.stock_quantity ?? 0) / 10) / 100} كيلو`
                        : `${p.stock_quantity ?? 0} ${unitWord(p.unit)}`}
                  </b>
                </div>
                <div className={styles.line19}>
                  <span>سعر {isWeight ? "الكيلو" : unitWord(p.unit)}</span>
                  <b>{p.sell_price_piasters / 100} ج</b>
                </div>
                {packQty > 1 && !isWeight && (
                  <div className={styles.line19}>
                    <span>سعر العبوة ({packQty})</span>
                    <b>{(p.sell_price_piasters * packQty) / 100} ج</b>
                  </div>
                )}
                {!sandwich && (
                  <>
                    <div className={styles.lbl19}>الدفعات</div>
                    {live.length === 0 ? (
                      <div className={styles.v19Note}>مفيش كمية</div>
                    ) : (
                      live.map((b) => (
                        <div key={b.id} className={styles.line19}>
                          <span>
                            {b.expiryDate
                              ? `تنتهي ${b.expiryDate.slice(0, 10)}`
                              : "من غير صلاحية"}
                          </span>
                          <b>
                            {isWeight
                              ? `${b.remainingQty / 1000} كيلو`
                              : `${b.remainingQty} ${unitWord(p.unit)}`}
                          </b>
                        </div>
                      ))
                    )}
                  </>
                )}
                {(p.barcode || v?.barcode) && (
                  <div className={styles.v19Note}>
                    الباركود: <span dir="ltr">{p.barcode || v?.barcode}</span>
                  </div>
                )}

                {sandwich ? (
                  <>
                    {!p.is_hidden && (
                      <button
                        type="button"
                        className={styles.v19Btn}
                        data-testid={`add-to-sale-${p.id}`}
                        onClick={() => {
                          close();
                          // Opens the Sales screen with a quantity step; nothing is
                          // sold until the user confirms there.
                          stageSandwichForSale(p.id);
                          window.history.pushState(null, "", "/app/sales");
                          window.dispatchEvent(new PopStateEvent("popstate"));
                        }}
                      >
                        🛒 {t("sandwich.addToSale")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.v19Btn} ${styles.v19Ghost}`}
                      onClick={() => {
                        close();
                        openProduct(p);
                      }}
                    >
                      ✏️ عدّل
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.v19Btn}
                      data-testid={`stock-in-${p.id}`}
                      onClick={() => {
                        close();
                        setStockModalProduct(p);
                      }}
                    >
                      📦 دخلت كمية
                    </button>
                    <button
                      type="button"
                      className={`${styles.v19Btn} ${styles.v19Ghost}`}
                      data-testid={`edit-product-${p.id}`}
                      onClick={() => {
                        close();
                        openProduct(p);
                      }}
                    >
                      ✏️ عدّل السعر والتفاصيل
                    </button>
                    {stock && (
                      <>
                        {expired && (
                          <button
                            type="button"
                            className={`${styles.v19Btn} ${styles.v19Red}`}
                            onClick={() => {
                              close();
                              setLossTarget({ item: stock, reason: "expired" });
                            }}
                          >
                            🗑️ سجّل المنتهي كتالف
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${styles.v19Btn} ${styles.v19Ghost}`}
                          data-testid={`record-loss-${p.id}`}
                          onClick={() => {
                            close();
                            setLossTarget({ item: stock });
                          }}
                        >
                          🗑️ سجّل تالف
                        </button>
                      </>
                    )}
                  </>
                )}
                {/* V19: an offer / a sandwich has «🗑️ امسح» here; a product is deleted
                    from its edit form. */}
                {sandwich && isShopCreated(p) && (
                  <button
                    type="button"
                    className={`${styles.v19Btn} ${styles.v19Red}`}
                    data-testid={`delete-product-${p.id}`}
                    onClick={() => {
                      close();
                      setDeleteError(null);
                      setDeleteTarget(p);
                    }}
                  >
                    🗑️ امسح
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.v19Btn} ${styles.v19Ghost}`}
                  onClick={close}
                >
                  إغلاق
                </button>
              </div>
            </Modal>
          );
        })()}

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
          onChooseOffer={() => {
            setIsChoosingType(false);
            setOfferSheet({ offer: null });
          }}
        />
      )}

      {lossTarget && (
        <RecordLossModal
          item={lossTarget.item}
          source="products"
          presetReason={lossTarget.reason}
          onClose={() => setLossTarget(null)}
          onSaved={(message) => {
            setLossTarget(null);
            setNotice(message);
            loadStockLevels();
            void loadProducts();
          }}
        />
      )}

      {offerSheet && (
        <OfferSheet
          offer={offerSheet.offer}
          products={physicalProducts}
          onClose={() => setOfferSheet(null)}
          onSave={saveOffer}
          onDelete={deleteOffer}
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
          onRequestDelete={
            editingProduct && isShopCreated(editingProduct)
              ? () => {
                  const target = editingProduct;
                  setIsAdding(false);
                  setEditingProduct(null);
                  setDeleteError(null);
                  setDeleteTarget(target);
                }
              : undefined
          }
        />
      )}

      {/* Add Stock Modal */}
      {stockModalProduct && (
        <StockEntrySheet
          option={optionFromProduct(stockModalProduct)}
          onClose={() => setStockModalProduct(null)}
          onSaved={() => {
            setStockModalProduct(null);
            void loadProducts();
          }}
        />
      )}
    </div>
  );
}

export default ProductsView;
