"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Empty, SearchBox, Button, Icon } from "../../shared/ui";
import { t, formatMoney } from "../../shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
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
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingProduct, setEditingProduct] = useState<StoreProductItem | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const filteredProducts = useMemo(() => {
    const normQ = normalizeArabic(query.trim());
    if (!normQ) return products;
    return products.filter((p) => {
      const normName = normalizeArabic(p.name_ar || "");
      const normCat = normalizeArabic(p.category || "");
      return normName.includes(normQ) || normCat.includes(normQ);
    });
  }, [products, query]);

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
          <p>{filteredProducts.length} منتج مسجل</p>
        </div>
        <div className={styles.pact}>
          <Button
            kind="primary"
            icon="plus"
            onClick={() => setIsAdding(true)}
            data-testid="add-product-btn"
          >
            {t("pages.products.add")}
          </Button>
        </div>
      </div>

      {/* Search box */}
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("pages.products.searchPlaceholder")}
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

      {/* Content */}
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
            title={query ? "مفيش منتج بالاسم ده" : t("pages.products.empty")}
            sub={
              query
                ? "جرّب كلمة تانية أو ضيف منتج جديد"
                : "ابدأ بإضافة أول منتج لمحلّك"
            }
            action={
              <Button icon="plus" onClick={() => setIsAdding(true)}>
                {t("pages.products.add")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredProducts.map((p) => {
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
        />
      )}
    </div>
  );
}

export default ProductsView;
