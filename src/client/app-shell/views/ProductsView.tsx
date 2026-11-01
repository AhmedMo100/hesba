"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Icon } from "../../shared/ui";
import { t } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { ProductFormModal } from "./ProductFormModal";
import { AddStockModal } from "./AddStockModal";
import styles from "./ProductsView.module.css";

export interface StoreProductItem {
  id: string;
  name_ar: string;
  name_norm?: string;
  category: string;
  unit: string;
  sell_price_piasters: number;
  buy_cost_piasters?: number;
  stock_quantity?: number;
  brand_name?: string | null;
  is_custom: boolean;
  added_by_this_store?: boolean;
  is_hidden?: boolean;
  global_product_id?: string | null;
  variants: Array<{
    id?: string;
    flavor?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
    pack_qty?: number;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    stock_quantity?: number;
    global_variant_id?: string | null;
    is_active?: boolean;
  }>;
}

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
  return (
    <div className={styles.pr}>
      <span className={styles.prl}>{label}</span>
      <div className={styles.prvals}>
        <div className={styles.prv}>
          <small>{t("pages.products.buyPrice") || "شراء"}</small>
          <b>{fmtMoney(buy)}</b>
        </div>
        <div className={`${styles.prv} ${styles.prvSell}`}>
          <small>{t("pages.products.sellPrice") || "بيع"}</small>
          <b>{fmtMoney(sell)}</b>
        </div>
      </div>
    </div>
  );
}

const isWeightProduct = (p: StoreProductItem) =>
  p.unit === "weight" || p.unit === "kg" || p.unit === "g";

const packCount = (p: StoreProductItem) => {
  if (isWeightProduct(p)) return 0;
  const n = p.variants?.[0]?.pack_qty;
  return n && n > 1 ? n : 0;
};

function weightText(gramsOrKg: number, unit?: string) {
  const kg = unit === "g" ? gramsOrKg / 1000 : gramsOrKg;
  if (kg <= 0) return "0 كجم";
  if (kg < 1) return `${Math.round(kg * 1000)} جرام`;
  return `${String(Math.round(kg * 100) / 100).replace(/\.0+$/, "")} كجم`;
}

function qtyText(p: StoreProductItem, q: number) {
  if (isWeightProduct(p)) return weightText(q, p.unit);
  const n = packCount(p);
  const qty = Math.round(q);
  if (!n) return `${qty} قطعة`;
  const cartons = Math.floor(qty / n);
  const remainder = qty - cartons * n;
  const parts: string[] = [];
  if (cartons > 0) parts.push(`${cartons} كرتونة`);
  if (remainder > 0 || cartons === 0) parts.push(`${remainder} قطعة`);
  return parts.join(" و ");
}

function stockLevel(p: StoreProductItem, q: number): "out" | "low" | "ok" {
  if (q <= 0.0001) return "out";
  if (isWeightProduct(p)) return q < 3000 ? "low" : "ok";
  const n = packCount(p) || 1;
  return q <= n ? "low" : "ok";
}

export function ProductsView() {
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
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
  const [editingProduct, setEditingProduct] = useState<StoreProductItem | null>(
    null,
  );
  const [stockModalProduct, setStockModalProduct] =
    useState<StoreProductItem | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  });

  // Check online status listeners
  useEffect(() => {
    if (typeof window !== "undefined") {
      const onOn = () => setIsOnline(true);
      const onOff = () => setIsOnline(false);
      window.addEventListener("online", onOn);
      window.addEventListener("offline", onOff);
      return () => {
        window.removeEventListener("online", onOn);
        window.removeEventListener("offline", onOff);
      };
    }
  }, []);

  // Close card menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = () => setMenuOpenId(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [menuOpenId]);

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

  const handleHide = async (productId: string) => {
    try {
      const res = await fetch(`/api/products?id=${productId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("فشل إخفاء المنتج");
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, is_hidden: true } : p)),
      );
      setSummary((prev) => ({
        ...prev,
        hiddenCount: prev.hiddenCount + 1,
      }));
    } catch (err: unknown) {
      console.error("Hide failed:", err);
      alert("تعذر إخفاء المنتج، برجاء المحاولة لاحقاً");
    }
  };

  const handleUnhide = async (productId: string) => {
    try {
      const res = await fetch(`/api/products?id=${productId}&action=unhide`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("فشل إعادة إظهار المنتج");
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, is_hidden: false } : p)),
      );
      setSummary((prev) => ({
        ...prev,
        hiddenCount: Math.max(0, prev.hiddenCount - 1),
      }));
    } catch (err: unknown) {
      console.error("Unhide failed:", err);
      alert("تعذر إعادة إظهار المنتج");
    }
  };

  // Distinct category list
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats);
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    let list = products;

    // Filter mode
    if (filterMode === "hidden") {
      list = list.filter((p) => p.is_hidden);
    } else if (filterMode === "custom") {
      list = list.filter((p) => p.is_custom && !p.is_hidden);
    } else {
      // "all" shows active products by default
      list = list.filter((p) => !p.is_hidden);
    }

    // Category filter
    if (activeCategory !== "all") {
      list = list.filter((p) => p.category === activeCategory);
    }

    // Search query
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
  }, [products, filterMode, activeCategory, query]);

  const formatSubtitle = (p: StoreProductItem) => {
    if (p.unit === "weight" || p.unit === "kg") return "بالوزن (كيلو)";
    if (p.unit === "g") return "بالوزن (جرام)";
    const packQty = p.variants?.[0]?.pack_qty;
    if (packQty && packQty > 1) {
      return `كرتونة ${packQty} قطعة`;
    }
    return "بالقطعة";
  };

  return (
    <div className={styles.view} data-testid="page-products">
      {/* Header matching demo screenshot media_1793494094570_2888b04c.jpg */}
      <div className={styles.phead}>
        <div>
          <h1>{t("pages.products.title") || "المنتجات"}</h1>
          <p>{summary.total} منتج</p>
        </div>
        <div className={styles.pact}>
          {/* زر عرض المنتجات المخفية */}
          <button
            type="button"
            className={`${styles.hiddenToggleBtn} ${filterMode === "hidden" ? styles.active : ""}`}
            onClick={() =>
              setFilterMode((prev) => (prev === "hidden" ? "all" : "hidden"))
            }
            title={
              filterMode === "hidden"
                ? "العودة لكافة المنتجات"
                : "عرض المنتجات المخفية"
            }
          >
            <Icon n={filterMode === "hidden" ? "box" : "eyeoff"} s={16} />
            <span>
              {filterMode === "hidden"
                ? "عرض الكل"
                : `المخفية (${summary.hiddenCount})`}
            </span>
          </button>

          <Button
            kind="primary"
            icon="plus"
            onClick={() => setIsAdding(true)}
            data-testid="add-product-btn"
          >
            {t("pages.products.add") || "إضافة منتج"}
          </Button>
        </div>
      </div>

      {/* Hidden view notification banner */}
      {filterMode === "hidden" && (
        <div className={styles.hiddenActiveBanner}>
          <span>
            أنت تشاهد حالياً المنتجات المخفية من المحل (
            {filteredProducts.length} منتج)
          </span>
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={styles.unhideBtn}
          >
            عرض المنتجات المعروضة
          </button>
        </div>
      )}

      {/* Offline banner if offline */}
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <span>الوضع غير متصل — تصفح المنتجات يعمل من الذاكرة المحلية</span>
        </div>
      )}

      {/* Search Bar */}
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={
          t("pages.products.searchPlaceholder") ||
          "دوّر على منتج… اكتب أو اتكلم"
        }
      />

      {/* Filter Chips row */}
      <div className={styles.chips}>
        <button
          type="button"
          className={`${styles.chip} ${filterMode === "all" && activeCategory === "all" ? styles.active : ""}`}
          onClick={() => {
            setFilterMode("all");
            setActiveCategory("all");
          }}
        >
          الكل ({products.filter((p) => !p.is_hidden).length})
        </button>

        {summary.customCount > 0 && (
          <button
            type="button"
            className={`${styles.chip} ${filterMode === "custom" ? styles.active : ""}`}
            onClick={() => {
              setFilterMode((prev) => (prev === "custom" ? "all" : "custom"));
            }}
          >
            أضافه المحل ({summary.customCount})
          </button>
        )}

        <button
          type="button"
          className={`${styles.chip} ${styles.hiddenChip} ${filterMode === "hidden" ? styles.active : ""}`}
          onClick={() => {
            setFilterMode((prev) => (prev === "hidden" ? "all" : "hidden"));
          }}
        >
          المخفية ({summary.hiddenCount})
        </button>

        {categories.map((cat) => (
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

      {/* Products Grid */}
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
      ) : filteredProducts.length === 0 ? (
        <div className={styles.pcard}>
          <Empty
            icon={query ? "search" : "box"}
            title={query ? "مفيش منتج بالاسم ده" : "مفيش منتجات في هذا القسم"}
            sub={
              query
                ? "جرّب كلمة تانية أو ضيف منتج جديد"
                : "اضغط على إضافة منتج للبدء"
            }
            action={
              <Button
                kind="primary"
                icon="plus"
                onClick={() => setIsAdding(true)}
              >
                {t("pages.products.add") || "إضافة منتج"}
              </Button>
            }
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredProducts.map((p) => {
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

            const stockQty = p.stock_quantity ?? 0;
            const lv = stockLevel(p, stockQty);
            const isMenuOpen = menuOpenId === p.id;

            return (
              <div
                className={`${styles.pcard} ${p.is_hidden ? styles.cardHidden : ""}`}
                key={p.id}
                data-testid={`product-card-${p.id}`}
                onClick={() => setEditingProduct(p)}
              >
                {/* Card Top: 3-dots Menu + Title matching Demo Screenshot */}
                <div className={styles.pch}>
                  <div className={styles.pcn}>
                    <b>{p.name_ar}</b>
                    <small>{formatSubtitle(p)}</small>
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
                        setMenuOpenId((prev) => (prev === p.id ? null : p.id));
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
                            setEditingProduct(p);
                          }}
                        >
                          <Icon n="edit" s={14} />
                          <span>تعديل الأسعار</span>
                        </button>
                        <button
                          type="button"
                          className={styles.menuItem}
                          onClick={() => {
                            setMenuOpenId(null);
                            setStockModalProduct(p);
                          }}
                        >
                          <Icon n="plus" s={14} />
                          <span>إضافة إلى المخزون</span>
                        </button>
                        {p.is_hidden ? (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => {
                              setMenuOpenId(null);
                              void handleUnhide(p.id);
                            }}
                          >
                            <Icon n="check" s={14} />
                            <span>إعادة إظهار</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.menuItem} ${styles.danger}`}
                            onClick={() => {
                              setMenuOpenId(null);
                              void handleHide(p.id);
                            }}
                          >
                            <Icon n="trash" s={14} />
                            <span>إخفاء من المحل</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Price Boxes Section matching Demo Screenshot */}
                <div className={styles.pcp}>
                  {isWeight ? (
                    <PriceBox
                      label={p.unit === "g" ? "الجرام" : "الكيلو"}
                      buy={pieceBuy}
                      sell={pieceSell}
                    />
                  ) : (
                    <>
                      {hasPack && (
                        <PriceBox
                          label="الكرتونة"
                          buy={packBuy}
                          sell={packSell}
                        />
                      )}
                      <PriceBox
                        label="القطعة"
                        buy={pieceBuy}
                        sell={pieceSell}
                      />
                    </>
                  )}
                </div>

                {/* Stock Level line matching Demo media_1793494094570_2888b04c.jpg */}
                {!p.is_hidden && (
                  <div className={`${styles.pcs} ${styles[lv]}`}>
                    <i className={styles.dot} />
                    <span>
                      {lv === "out" ? "خلصان" : `متاح ${qtyText(p, stockQty)}`}
                    </span>
                  </div>
                )}

                {/* Hidden Notice if hidden */}
                {p.is_hidden && (
                  <div className={styles.hiddenNotice}>
                    <span>مخفي من المحل</span>
                    <button
                      type="button"
                      className={styles.unhideBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnhide(p.id);
                      }}
                    >
                      إظهار
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Stock Modal */}
      {stockModalProduct && (
        <AddStockModal
          targetProduct={stockModalProduct}
          options={[]}
          onClose={() => setStockModalProduct(null)}
          onAdded={() => {
            setStockModalProduct(null);
            void loadProducts();
          }}
        />
      )}

      {/* Add Product Modal */}
      {isAdding && (
        <ProductFormModal
          onClose={() => setIsAdding(false)}
          onSaved={() => {
            setIsAdding(false);
            void loadProducts();
          }}
        />
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            void loadProducts();
          }}
          onDeleted={(id) => {
            setEditingProduct(null);
            setProducts((prev) =>
              prev.map((p) => (p.id === id ? { ...p, is_hidden: true } : p)),
            );
            setSummary((prev) => ({
              ...prev,
              hiddenCount: prev.hiddenCount + 1,
            }));
          }}
        />
      )}
    </div>
  );
}

export default ProductsView;
