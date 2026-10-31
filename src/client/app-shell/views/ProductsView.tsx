"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Icon, Seg } from "../../shared/ui";
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
  is_custom: boolean;
  global_product_id?: string | null;
  variants: Array<{
    id?: string;
    flavor?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
    pack_qty?: number;
    sell_price_piasters: number;
    global_variant_id?: string | null;
    is_active?: boolean;
  }>;
}

export function ProductsView() {
  const [tab, setTab] = useState<"store" | "catalog">("store");
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogSearchResult[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<string>("all");
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
      setProducts(data.products || []);
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
          setProducts(data.products || []);
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
  }, []);

  const handleDelete = async (productId: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا المنتج من المحل؟")) return;
    setDeletingId(productId);
    try {
      const res = await fetch(`/api/products?id=${productId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("فشل حذف المنتج");
      setProducts((prev) => prev.filter((p) => p.id !== productId));
    } catch (err: unknown) {
      console.error("Delete failed:", err);
      alert("تعذر حذف المنتج، برجاء المحاولة لاحقاً");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredStoreProducts = useMemo(() => {
    const normQ = normalizeArabic(query.trim());
    if (!normQ) return products;
    return products.filter((p) => {
      const normName = normalizeArabic(p.name_ar || "");
      const normCat = normalizeArabic(p.category || "");
      return normName.includes(normQ) || normCat.includes(normQ);
    });
  }, [products, query]);

  // Catalog category list
  const catalogCategories = useMemo(() => {
    const cats = new Set<string>();
    catalogItems.forEach((item) => {
      if (item.product.category) cats.add(item.product.category);
    });
    return Array.from(cats);
  }, [catalogItems]);

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

  // Set of global product IDs already in store
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
    if (p.unit === "weight") return "بالوزن";
    const packQty = p.variants?.[0]?.pack_qty;
    if (packQty && packQty > 1) {
      return `كرتونة ${packQty} قطعة`;
    }
    return "بالقطعة";
  };

  return (
    <div className={styles.view} data-testid="page-products">
      {/* Header */}
      <div className={styles.phead}>
        <div>
          <h1>{t("pages.products.title")}</h1>
          <p>
            {tab === "store"
              ? `${filteredStoreProducts.length} منتج مسجل بمحلك`
              : `${filteredCatalogItems.length} صنف متاح بالكتالوج العام`}
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
            {t("pages.products.add")}
          </Button>
        </div>
      </div>

      {/* Offline sync banner if offline */}
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <span>الوضع غير متصل — تصفح المنتجات يعمل من الذاكرة المحلية</span>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.segWrap}>
        <Seg
          value={tab}
          onChange={(v) => {
            setTab(v as "store" | "catalog");
            setQuery("");
          }}
          options={[
            ["store", `منتجات المحل (${products.length})`],
            ["catalog", `الكتالوج العام (${catalogItems.length})`],
          ]}
        />
      </div>

      {/* Search box */}
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={
          tab === "store"
            ? t("pages.products.searchPlaceholder")
            : "دوّر في الكتالوج العام… شاي، جهينة، جبنة، مياه"
        }
      />

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
        /* Global Catalog Tab */
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
              جارٍ تحميل الكتالوج العام...
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
        /* Store Products Tab */
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
                  query ? "مفيش منتج بالاسم ده" : t("pages.products.empty")
                }
                sub={
                  query
                    ? "جرّب كلمة تانية أو ضيف منتج جديد"
                    : "محلك مفيش فيه منتجات لسه. اختار من الكتالوج العام أو ضيف منتجك"
                }
                action={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button kind="primary" onClick={() => setTab("catalog")}>
                      تصفح الكتالوج العام
                    </Button>
                    <Button
                      kind="ghost"
                      icon="plus"
                      onClick={() => {
                        setSelectedCatalogItem(null);
                        setIsAdding(true);
                      }}
                    >
                      {t("pages.products.add")}
                    </Button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredStoreProducts.map((p) => {
                const firstVariant = p.variants?.[0];
                const hasMultipleVariants = p.variants.length > 1;

                return (
                  <div
                    className={styles.pcard}
                    key={p.id}
                    data-testid={`product-card-${p.id}`}
                  >
                    <div className={styles.pch}>
                      <div className={styles.pcn}>
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

                    <div className={styles.pcp}>
                      <div className={styles.pr}>
                        <span className={styles.prl}>
                          {p.unit === "weight" ? "الكيلو" : "سعر البيع"}
                        </span>
                        <div className={styles.prv}>
                          <small>بيع</small>
                          <b>{formatMoney(p.sell_price_piasters)}</b>
                        </div>
                      </div>

                      {firstVariant?.pack_qty && firstVariant.pack_qty > 1 && (
                        <div className={styles.pr}>
                          <span className={styles.prl}>الكرتونة</span>
                          <div className={styles.prv}>
                            <small>{firstVariant.pack_qty} قطعة</small>
                            <b>
                              {formatMoney(
                                p.sell_price_piasters * firstVariant.pack_qty,
                              )}
                            </b>
                          </div>
                        </div>
                      )}

                      {hasMultipleVariants && (
                        <small style={{ color: "var(--ink2)", fontSize: 11 }}>
                          + {p.variants.length - 1} نكهات/أحجام أخرى
                        </small>
                      )}
                    </div>

                    <div className={styles.pcs}>
                      <i />
                      <span>متاح في المحل</span>
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
        />
      )}
    </div>
  );
}

export default ProductsView;
