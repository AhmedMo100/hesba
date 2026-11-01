"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Icon, Seg, Modal } from "../../shared/ui";
import { t, formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { db } from "../../shared/db";
import type {
  LocalGlobalBrand,
  LocalGlobalProduct,
  LocalGlobalVariant,
} from "../../shared/db/types";
import { syncCatalog, type CatalogSearchResult } from "../../shared/catalog";
import { ProductFormModal } from "./ProductFormModal";
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

interface PriceRowProps {
  label: string;
  buy: number;
  sell: number;
}

function PriceRow({ label, buy, sell }: PriceRowProps) {
  return (
    <div className={styles.pr}>
      <span className={styles.prl}>{label}</span>
      <div className={styles.prvals}>
        <span className={styles.prv}>
          <small>{t("pages.products.buyPrice") || "شراء"}</small>
          <b>{buy > 0 ? formatMoney(buy) : "—"}</b>
        </span>
        <span className={`${styles.prv} ${styles.prvSell}`}>
          <small>{t("pages.products.sellPrice") || "بيع"}</small>
          <b>{formatMoney(sell)}</b>
        </span>
      </div>
    </div>
  );
}

export function ProductsView() {
  const [tab, setTab] = useState<"store" | "catalog">("store");
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogSearchResult[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<string>("all");
  const [storeCategory, setStoreCategory] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [summary, setSummary] = useState({
    total: 0,
    lowStock: 0,
    outOfStock: 0,
  });

  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCatalogItem, setSelectedCatalogItem] =
    useState<CatalogSearchResult | null>(null);
  const [editingProduct, setEditingProduct] = useState<StoreProductItem | null>(
    null,
  );
  const [detailsProduct, setDetailsProduct] = useState<StoreProductItem | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products");
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
          lowStock: loadedProducts.filter(
            (p) =>
              (p.stock_quantity ?? 0) > 0 &&
              (p.stock_quantity ?? 0) <= (p.unit === "kg" ? 2000 : 5),
          ).length,
          outOfStock: loadedProducts.filter((p) => (p.stock_quantity ?? 0) <= 0)
            .length,
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

    fetch("/api/products")
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
              lowStock: loadedProducts.filter(
                (p) =>
                  (p.stock_quantity ?? 0) > 0 &&
                  (p.stock_quantity ?? 0) <= (p.unit === "kg" ? 2000 : 5),
              ).length,
              outOfStock: loadedProducts.filter(
                (p) => (p.stock_quantity ?? 0) <= 0,
              ).length,
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

    // Load catalog items in effect
    db.global_products
      .count()
      .then(async (count: number) => {
        if (
          count === 0 &&
          (typeof navigator === "undefined" || navigator.onLine)
        ) {
          await syncCatalog(db).catch(() => {});
        }
        const [prods, brands, variants]: [
          LocalGlobalProduct[],
          LocalGlobalBrand[],
          LocalGlobalVariant[],
        ] = await Promise.all([
          db.global_products.toArray(),
          db.global_brands.toArray(),
          db.global_variants.toArray(),
        ]);
        if (ignore) return;
        const brandMap = new Map<string, LocalGlobalBrand>(
          brands.map((b: LocalGlobalBrand) => [b.id, b]),
        );
        const variantMap = new Map<string, LocalGlobalVariant[]>();

        for (const v of variants) {
          const list = variantMap.get(v.global_product_id) || [];
          list.push(v);
          variantMap.set(v.global_product_id, list);
        }

        const results: CatalogSearchResult[] = prods.map(
          (p: LocalGlobalProduct) => {
            const b = p.brand_id ? brandMap.get(p.brand_id) : undefined;
            const vars = (variantMap.get(p.id) || []).map(
              (v: LocalGlobalVariant) => ({
                id: v.id,
                globalProductId: v.global_product_id,
                flavor: v.flavor ?? null,
                sizeValue: v.size_value ?? null,
                sizeUnit: v.size_unit ?? null,
                packQty: v.pack_qty,
                nameNorm: v.name_norm,
              }),
            );

            return {
              product: {
                id: p.id,
                nameAr: p.name_ar,
                nameEn: null,
                category: p.category,
                type: p.type,
              },
              brand: b ? { id: b.id, nameAr: b.name_ar } : null,
              variants: vars,
              matchType: "contains" as const,
            };
          },
        );

        setCatalogItems(results);
        setCatalogLoading(false);
      })
      .catch(() => {
        if (!ignore) setCatalogLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [loadProducts]);

  const handleDelete = async (productId: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا المنتج من المحل؟")) return;
    setDeletingId(productId);
    try {
      const res = await fetch(`/api/products?id=${productId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("فشل حذف المنتج");
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      setSummary((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    } catch (err: unknown) {
      console.error("Delete failed:", err);
      alert("تعذر حذف المنتج، برجاء المحاولة لاحقاً");
    } finally {
      setDeletingId(null);
    }
  };

  // Categories list for store products
  const storeCategories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats);
  }, [products]);

  // Categories list for catalog products
  const catalogCategories = useMemo(() => {
    const cats = new Set<string>();
    catalogItems.forEach((item) => {
      if (item.product.category) cats.add(item.product.category);
    });
    return Array.from(cats);
  }, [catalogItems]);

  // Filtered store products
  const filteredStoreProducts = useMemo(() => {
    let list = products;
    if (storeCategory !== "all") {
      list = list.filter((p) => p.category === storeCategory);
    }
    if (stockFilter === "low") {
      list = list.filter((p) => {
        const qty = p.stock_quantity ?? 0;
        const threshold = p.unit === "kg" ? 2000 : 5;
        return qty > 0 && qty <= threshold;
      });
    } else if (stockFilter === "out") {
      list = list.filter((p) => (p.stock_quantity ?? 0) <= 0);
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
  }, [products, storeCategory, stockFilter, query]);

  // Filtered catalog items
  const filteredCatalogItems = useMemo(() => {
    let items = catalogItems;
    if (catalogCategory !== "all") {
      items = items.filter((i) => i.product.category === catalogCategory);
    }
    const normQ = normalizeArabic(query.trim());
    if (!normQ) return items;
    return items.filter((i) => {
      const normName = normalizeArabic(i.product.nameAr || "");
      const normBrand = normalizeArabic(i.brand?.nameAr || "");
      const normCat = normalizeArabic(i.product.category || "");
      return (
        normName.includes(normQ) ||
        normBrand.includes(normQ) ||
        normCat.includes(normQ)
      );
    });
  }, [catalogItems, catalogCategory, query]);

  // Map of global product IDs already in store
  const storeAdoptedMap = useMemo(() => {
    const map = new Map<string, StoreProductItem>();
    for (const p of products) {
      if (p.global_product_id) {
        map.set(p.global_product_id, p);
      }
    }
    return map;
  }, [products]);

  const formatUnitLabel = (p: StoreProductItem) => {
    if (p.unit === "weight" || p.unit === "kg") return "بالوزن";
    const packQty = p.variants?.[0]?.pack_qty;
    if (packQty && packQty > 1) {
      return `كرتونة ${packQty} قطعة`;
    }
    return "بالقطعة";
  };

  const getStockStatus = (p: StoreProductItem) => {
    const qty = p.stock_quantity ?? 0;
    const threshold = p.unit === "kg" ? 2000 : 5;
    if (qty <= 0) return { lv: "out", text: "خلصان" };
    if (qty <= threshold) {
      const label =
        p.unit === "kg" ? `${(qty / 1000).toFixed(1)} كجم` : `${qty} قطعة`;
      return { lv: "low", text: `قرب يخلص (${label})` };
    }
    const label =
      p.unit === "kg" ? `${(qty / 1000).toFixed(1)} كجم` : `${qty} قطعة`;
    return { lv: "ok", text: `متاح ${label}` };
  };

  return (
    <div className={styles.view} data-testid="page-products">
      {/* Header */}
      <div className={styles.phead}>
        <div>
          <h1>{t("pages.products.title") || "المنتجات"}</h1>
          <p>
            {tab === "store"
              ? `${summary.total} منتج مسجل بمحلك`
              : `${catalogItems.length} صنف متاح بالكتالوج المصري`}
          </p>
        </div>
        <div className={styles.pact}>
          <Button
            kind="primary"
            icon="plus"
            onClick={() => {
              setSelectedCatalogItem(null);
              setIsAdding(true);
            }}
            data-testid="add-product-btn"
          >
            {t("pages.products.add") || "إضافة منتج"}
          </Button>
        </div>
      </div>

      {/* Offline sync banner if offline */}
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <span>الوضع غير متصل — تصفح المنتجات يعمل من الذاكرة المحلية</span>
        </div>
      )}

      {/* Segmented Tabs: Store vs Egyptian Catalog */}
      <div className={styles.segWrap}>
        <Seg
          value={tab}
          onChange={(v) => {
            setTab(v as "store" | "catalog");
            setQuery("");
          }}
          options={[
            ["store", `منتجات المحل (${products.length})`],
            ["catalog", `الكتالوج المصري (${catalogItems.length})`],
          ]}
        />
      </div>

      {/* Summary counters bar for Store tab */}
      {tab === "store" && (
        <div className={styles.sumBar}>
          <div className={styles.sumCard}>
            <small>إجمالي الأصناف</small>
            <b>{summary.total}</b>
          </div>
          <div className={`${styles.sumCard} ${styles.low}`}>
            <small>قرب يخلص</small>
            <b>{summary.lowStock}</b>
          </div>
          <div className={`${styles.sumCard} ${styles.out}`}>
            <small>خلصان</small>
            <b>{summary.outOfStock}</b>
          </div>
        </div>
      )}

      {/* Search box */}
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={
          tab === "store"
            ? t("pages.products.searchPlaceholder") ||
              "دوّر على منتج… اكتب أو اتكلم"
            : "دوّر في الكتالوج المصري… شاي، جبنة، مياه، شيبسي"
        }
      />

      {/* Stock status filter chips (Store tab only) */}
      {tab === "store" && (
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${stockFilter === "all" ? styles.active : ""}`}
            onClick={() => setStockFilter("all")}
          >
            الكل ({products.length})
          </button>
          <button
            type="button"
            className={`${styles.chip} ${stockFilter === "low" ? styles.active : ""}`}
            onClick={() => setStockFilter("low")}
          >
            قرب يخلص ({summary.lowStock})
          </button>
          <button
            type="button"
            className={`${styles.chip} ${stockFilter === "out" ? styles.active : ""}`}
            onClick={() => setStockFilter("out")}
          >
            خلصان ({summary.outOfStock})
          </button>
          {storeCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`${styles.chip} ${storeCategory === cat ? styles.active : ""}`}
              onClick={() =>
                setStoreCategory((prev) => (prev === cat ? "all" : cat))
              }
            >
              {cat}
            </button>
          ))}
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

      {tab === "catalog" ? (
        /* ================= Egyptian Global Catalog Tab ================= */
        <>
          {/* Category Filter Chips */}
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${catalogCategory === "all" ? styles.active : ""}`}
              onClick={() => setCatalogCategory("all")}
            >
              الكل ({catalogItems.length})
            </button>
            {catalogCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.chip} ${catalogCategory === cat ? styles.active : ""}`}
                onClick={() => setCatalogCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {catalogLoading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--ink2)",
              }}
            >
              جارٍ تحميل الكتالوج المصري...
            </div>
          ) : filteredCatalogItems.length === 0 ? (
            <div className={styles.pcard}>
              <Empty
                icon="search"
                title={query ? "مفيش صنف يطابق البحث" : "الكتالوج فارغ حالياً"}
                sub="تقدر تضيف أي صنف خاص بمحلك في أي وقت"
                action={
                  <Button
                    kind="primary"
                    icon="plus"
                    onClick={() => {
                      setSelectedCatalogItem(null);
                      setIsAdding(true);
                    }}
                  >
                    إضافة منتج خاص
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredCatalogItems.map((item) => {
                const adopted = storeAdoptedMap.get(item.product.id);

                return (
                  <div className={styles.pcard} key={item.product.id}>
                    <div className={styles.pch}>
                      <div className={styles.pcn}>
                        {item.brand && (
                          <span className={styles.brandBadge}>
                            {item.brand.nameAr}
                          </span>
                        )}
                        <b>{item.product.nameAr}</b>
                        <small>{item.product.category}</small>
                      </div>
                    </div>

                    {/* Variants list summary */}
                    {item.variants.length > 0 && (
                      <div className={styles.catVariants}>
                        {item.variants.slice(0, 3).map((v) => (
                          <span className={styles.variantTag} key={v.id}>
                            {[
                              v.flavor,
                              v.sizeValue
                                ? `${v.sizeValue} ${v.sizeUnit || ""}`
                                : null,
                              v.packQty > 1 ? `كرتونة ${v.packQty}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ))}
                        {item.variants.length > 3 && (
                          <span className={styles.variantTag}>
                            +{item.variants.length - 3} المزيد
                          </span>
                        )}
                      </div>
                    )}

                    {/* Store status or Add button */}
                    {adopted ? (
                      <div className={styles.badgeAdded}>
                        <span>✓ مضاف للمحل</span>
                        <b>({formatMoney(adopted.sell_price_piasters)})</b>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.addBtnSmall}
                        onClick={() => {
                          setSelectedCatalogItem(item);
                          setIsAdding(true);
                        }}
                      >
                        <Icon n="plus" s={14} />
                        <span>إضافة لمحلّي</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ================= Store Products Tab ================= */
        <>
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
          ) : filteredStoreProducts.length === 0 ? (
            <div className={styles.pcard}>
              <Empty
                icon={query ? "search" : "box"}
                title={
                  query
                    ? "مفيش منتج بالاسم ده"
                    : t("pages.products.empty") || "مفيش منتجات متسجلة"
                }
                sub={
                  query
                    ? "جرّب كلمة تانية أو ضيف منتج جديد"
                    : "محلك مفيش فيه منتجات لسه. اختار من الكتالوج المصري أو ضيف منتجك"
                }
                action={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button kind="primary" onClick={() => setTab("catalog")}>
                      تصفح الكتالوج المصري
                    </Button>
                    <Button
                      kind="ghost"
                      icon="plus"
                      onClick={() => {
                        setSelectedCatalogItem(null);
                        setIsAdding(true);
                      }}
                    >
                      {t("pages.products.add") || "إضافة منتج"}
                    </Button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredStoreProducts.map((p) => {
                const firstVariant = p.variants?.[0];
                const hasPack = Boolean(
                  firstVariant?.pack_qty && firstVariant.pack_qty > 1,
                );
                const isWeight = p.unit === "weight" || p.unit === "kg";
                const status = getStockStatus(p);

                return (
                  <div
                    className={styles.pcard}
                    key={p.id}
                    data-testid={`product-card-${p.id}`}
                  >
                    <div className={styles.pch}>
                      <div
                        className={styles.pcn}
                        style={{ cursor: "pointer" }}
                        onClick={() => setDetailsProduct(p)}
                      >
                        {p.brand_name && (
                          <span className={styles.brandBadge}>
                            {p.brand_name}
                          </span>
                        )}
                        <b>{p.name_ar}</b>
                        <small>{formatUnitLabel(p)}</small>
                      </div>
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label={`تعديل ${p.name_ar}`}
                          onClick={() => setEditingProduct(p)}
                          title="تعديل المنتج"
                          data-testid={`edit-product-${p.id}`}
                        >
                          <Icon n="edit" s={18} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.deleteBtn}`}
                          aria-label={`حذف ${p.name_ar}`}
                          onClick={() => void handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          title="حذف المنتج"
                          data-testid={`delete-product-${p.id}`}
                        >
                          <Icon n="trash" s={18} />
                        </button>
                      </div>
                    </div>

                    <div
                      className={styles.pcp}
                      style={{ cursor: "pointer" }}
                      onClick={() => setDetailsProduct(p)}
                    >
                      {isWeight ? (
                        <PriceRow
                          label="الكيلو"
                          buy={p.buy_cost_piasters || 0}
                          sell={p.sell_price_piasters}
                        />
                      ) : (
                        <>
                          {hasPack && firstVariant?.pack_qty && (
                            <PriceRow
                              label={`الكرتونة (${firstVariant.pack_qty})`}
                              buy={
                                p.buy_cost_piasters
                                  ? p.buy_cost_piasters * firstVariant.pack_qty
                                  : 0
                              }
                              sell={
                                p.sell_price_piasters * firstVariant.pack_qty
                              }
                            />
                          )}
                          <PriceRow
                            label="القطعة"
                            buy={p.buy_cost_piasters || 0}
                            sell={p.sell_price_piasters}
                          />
                        </>
                      )}
                    </div>

                    <div className={`${styles.pcs} ${styles[status.lv] || ""}`}>
                      <i />
                      <span>{status.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add Product Modal (supports prefilled catalog item or fresh custom product) */}
      {isAdding && (
        <ProductFormModal
          initialCatalogProduct={selectedCatalogItem}
          onClose={() => {
            setIsAdding(false);
            setSelectedCatalogItem(null);
          }}
          onSaved={() => {
            setIsAdding(false);
            setSelectedCatalogItem(null);
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
            setProducts((prev) => prev.filter((p) => p.id !== id));
            setSummary((prev) => ({
              ...prev,
              total: Math.max(0, prev.total - 1),
            }));
          }}
        />
      )}

      {/* Product Details Drawer / Modal */}
      {detailsProduct && (
        <Modal
          title={detailsProduct.name_ar}
          onClose={() => setDetailsProduct(null)}
          footer={
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
              }}
            >
              <Button
                kind="dangerghost"
                icon="trash"
                onClick={() => {
                  const id = detailsProduct.id;
                  setDetailsProduct(null);
                  void handleDelete(id);
                }}
              >
                حذف المنتج
              </Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button kind="ghost" onClick={() => setDetailsProduct(null)}>
                  إغلاق
                </Button>
                <Button
                  kind="primary"
                  icon="edit"
                  onClick={() => {
                    const p = detailsProduct;
                    setDetailsProduct(null);
                    setEditingProduct(p);
                  }}
                >
                  تعديل
                </Button>
              </div>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                background: "var(--sf2, #fbf7ef)",
                padding: 12,
                borderRadius: 12,
              }}
            >
              <div>
                <small style={{ color: "var(--ink2)", fontSize: 11 }}>
                  التصنيف
                </small>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {detailsProduct.category}
                </div>
              </div>
              <div>
                <small style={{ color: "var(--ink2)", fontSize: 11 }}>
                  طريقة البيع
                </small>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {formatUnitLabel(detailsProduct)}
                </div>
              </div>
              {detailsProduct.brand_name && (
                <div>
                  <small style={{ color: "var(--ink2)", fontSize: 11 }}>
                    العلامة التجارية
                  </small>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {detailsProduct.brand_name}
                  </div>
                </div>
              )}
              <div>
                <small style={{ color: "var(--ink2)", fontSize: 11 }}>
                  المخزون الحالي
                </small>
                <div
                  style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}
                >
                  {getStockStatus(detailsProduct).text}
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid var(--line)",
                padding: 12,
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                الأسعار والأرباح
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span>سعر البيع:</span>
                <b>{formatMoney(detailsProduct.sell_price_piasters)}</b>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span>سعر الشراء:</span>
                <b>
                  {detailsProduct.buy_cost_piasters
                    ? formatMoney(detailsProduct.buy_cost_piasters)
                    : "غير محدد"}
                </b>
              </div>
              {detailsProduct.buy_cost_piasters &&
                detailsProduct.buy_cost_piasters > 0 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: "var(--ok, #108e5c)",
                      fontWeight: 800,
                    }}
                  >
                    <span>مجمل الربح:</span>
                    <span>
                      {formatMoney(
                        detailsProduct.sell_price_piasters -
                          detailsProduct.buy_cost_piasters,
                      )}
                    </span>
                  </div>
                )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ProductsView;
