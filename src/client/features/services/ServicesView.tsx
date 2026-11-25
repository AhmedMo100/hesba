"use client";

/**
 * @file ServicesView.tsx
 * @description «الخدمات» (ADR-0036, 2026-11-25) — defining and managing the shop's services only:
 * add, edit, delete, and filter them by category. Each service is a small card with its name,
 * category and commission (a fixed amount, a percentage, or tiers by amount). Nothing is sold or
 * recorded here: a service is sold from «بيع حاجة» (the cashier in الكاشير الذكي, the «📲 خدمة»
 * tab in إدارة المحل), and machine / wallet money lives in «فلوس حِسبة».
 *
 * - One commission rule per service, saved by the service form in the shop's sales settings:
 *   the cashier («بيع حاجة») and «سجّل عملية خدمة» both read it. Every operation stores the
 *   commission it was charged, so editing a service never changes past operations.
 * - Deleting a service hides it from new operations; its past operations stay as they were.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isServiceProduct } from "@/domain/sale-pricing";
import type { ServiceCommissionRule } from "@/domain/service-commission";
import { apiGet } from "@/client/shared/api/read-cache";
import type { StoreProductItem } from "@/client/shared/store-items";
import { failureMessage } from "@/client/shared/quantity";
import { PageTitle, useToast } from "@/client/shared/ui";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import { ServiceFormModal } from "../products/ServiceFormModal";
import styles from "./ServicesView.module.css";

interface ShopService {
  id: string;
  name: string;
  category: string;
  rule: ServiceCommissionRule;
  ruleText: string;
}

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

/** «عمولة 5 ج» / «عمولة 2%» / «عمولة حسب المبلغ». */
function commissionText(s: ShopService): string {
  if (s.rule.tiers.length > 0) return `حسب المبلغ: ${s.ruleText}`;
  return s.rule.type === "percent"
    ? `${Number(s.rule.value.toFixed(2))}% من العملية`
    : `${Number((s.rule.value / 100).toFixed(2))} ج على العملية`;
}

export function ServicesView() {
  const toast = useToast();
  const [services, setServices] = useState<ShopService[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<StoreProductItem[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [form, setForm] = useState<{ product: StoreProductItem | null } | null>(
    null,
  );

  const load = useCallback(() => {
    fetch("/api/services", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(await errorText(r, "حصلت مشكلة. جرّب تاني."));
        return (await r.json()) as { services: ShopService[] };
      })
      .then((d) => {
        setServices(d.services);
        setLoadError(null);
      })
      .catch((e: unknown) =>
        setLoadError(failureMessage(e, "حصلت مشكلة. جرّب تاني.")),
      );
    apiGet("/api/products?filter=all&scope=store")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.products))
          setProducts(
            (d.products as StoreProductItem[]).filter((p) =>
              isServiceProduct(p),
            ),
          );
      })
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const categories = useMemo(
    () => [...new Set((services ?? []).map((s) => s.category).filter(Boolean))],
    [services],
  );
  // A filter whose category is gone (its last service was deleted) falls back to «الكل».
  const activeCategory =
    category !== "all" && !categories.includes(category) ? "all" : category;
  const shown = (services ?? []).filter(
    (s) => activeCategory === "all" || s.category === activeCategory,
  );

  const remove = async (s: ShopService) => {
    if (
      !window.confirm(
        `تمسح خدمة «${s.name}»؟ العمليات اللي اتسجلت قبل كده هتفضل زي ما هي.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(s.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نمسح الخدمة"));
      // The rule goes with the service (a hidden service is not sold anymore).
      await fetch("/api/sales/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceCommissions: { [s.id]: null } }),
      }).catch(() => undefined);
      toast.show({ msg: "اتمسحت الخدمة", kind: "ok" });
      load();
    } catch (e: unknown) {
      toast.show({
        msg: failureMessage(e, "مقدرناش نمسح الخدمة"),
        kind: "err",
      });
    }
  };

  return (
    <div className={viewStyles.view} data-testid="page-services">
      <div className={styles.page}>
        <PageTitle>بتقدّم خدمات إيه وعمولتك كام؟</PageTitle>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setForm({ product: null })}
          data-testid="services-add"
        >
          + أضف خدمة
        </button>

        {categories.length > 1 && (
          <div
            className={styles.chips}
            role="tablist"
            aria-label="التصنيف"
            data-testid="services-filter"
          >
            {["all", ...categories].map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={activeCategory === c}
                className={`${styles.chip} ${activeCategory === c ? styles.chipOn : ""}`}
                onClick={() => setCategory(c)}
                data-testid="services-filter-chip"
              >
                {c === "all" ? "الكل" : c}
              </button>
            ))}
          </div>
        )}

        {loadError && (
          <div className={styles.error} role="alert">
            {loadError}{" "}
            <button type="button" className={styles.linkBtn} onClick={load}>
              جرّب تاني
            </button>
          </div>
        )}
        {!services && !loadError && <p className={styles.note}>بنحمّل…</p>}
        {services && services.length === 0 && (
          <p className={styles.note} data-testid="services-empty">
            لسه مفيش خدمات. ضيف أول خدمة (فوري، شحن رصيد، فودافون كاش…)
            وعمولتها.
          </p>
        )}

        <div className={styles.grid}>
          {shown.map((s) => (
            <div key={s.id} className={styles.card} data-testid="services-card">
              <div className={styles.cardHead}>
                <b className={styles.name}>⚡ {s.name}</b>
                <span className={styles.cat}>{s.category}</span>
              </div>
              <div className={styles.rule} data-testid="services-card-rule">
                عمولتك: {commissionText(s)}
              </div>
              <div className={styles.cardBtns}>
                <button
                  type="button"
                  className={styles.cardBtn}
                  onClick={() =>
                    setForm({
                      product: products.find((p) => p.id === s.id) ?? null,
                    })
                  }
                  disabled={!products.some((p) => p.id === s.id)}
                  data-testid="services-edit"
                  aria-label={`عدّل ${s.name}`}
                >
                  ✏️ تعديل
                </button>
                <button
                  type="button"
                  className={`${styles.cardBtn} ${styles.cardBtnDanger}`}
                  onClick={() => void remove(s)}
                  data-testid="services-delete"
                  aria-label={`امسح ${s.name}`}
                >
                  🗑️ حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {form && (
        <ServiceFormModal
          product={form.product}
          existingServices={products}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
          onDeleted={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export default ServicesView;
