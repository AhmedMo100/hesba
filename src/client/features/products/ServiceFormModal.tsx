"use client";

/**
 * @file ServiceFormModal.tsx
 * @description V19 serviceForm — the same form to add and to edit a service: its name, its
 * category, the shop's commission, and the machines / wallets it is charged from. The
 * commission (ADR-0036) is «مبلغ ثابت» (e.g. 5 ج on every operation), «نسبة %» (e.g. 2% of the
 * operation), or — for a service that needs it — tiers by the operation's amount. It is ONE
 * rule, kept in the shop's sales settings and validated there too (no overlapping slabs, no
 * negative commission, a percentage up to 100%); the cashier and «سجّل عملية» read the same
 * rule, and every operation stores the commission it was charged, so editing the rule never
 * changes past operations. A saved service is offered in the sale at once.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { parseEgpStrict } from "@/domain/money";
import {
  commissionRuleErrors,
  describeSlab,
  slabFor,
  type CommissionType,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import { apiGet } from "@/client/shared/api/read-cache";
import {
  fetchStoreMachines,
  getServiceLinkedMachineIds,
  setServiceLinkedMachineIds,
  type PosMachine,
} from "@/client/shared/api/machines";
import { enableServiceForSale } from "@/client/shared/api/sale-services";
import { useAuth } from "@/client/shared/auth";
import f from "./ProductFormModal.module.css";

export interface ServiceFormModalProps {
  product?: {
    id: string;
    name_ar: string;
    category: string;
    unit: string;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    brand_name?: string | null;
    is_custom?: boolean;
    variants?: Array<{
      id?: string;
      sell_price_piasters?: number;
    }>;
  } | null;
  existingServices?: Array<{ id: string; name_ar: string }>;
  presetCategory?: string;
  onClose: () => void;
  onSaved: (savedProduct: unknown) => void;
  onDeleted?: (productId: string) => void;
}

const SERVICE_CATEGORIES = [
  { value: "تحويل أموال", label: "تحويل فلوس ومحافظ" },
  { value: "خدمات مرافق", label: "شحن مرافق (كهرباء / مياه / غاز)" },
  { value: "فواتير إنترنت", label: "فواتير إنترنت وتليفون" },
  { value: "شحن رصيد", label: "شحن رصيد" },
  { value: "كروت شحن", label: "كروت شحن" },
  { value: "خدمات رقمية", label: "خدمات تانية" },
] as const;

/** A tier as the form edits it (EGP text, percent text). */
interface TierRow {
  from: string;
  to: string;
  type: CommissionType;
  value: string;
}

const egp = (piasters: number) => String(Number((piasters / 100).toFixed(2)));

const emptySlab = (from = ""): TierRow => ({
  from,
  to: "",
  type: "fixed",
  value: "",
});

/** How the commission is set: one value for every operation, or tiers by amount. */
type CommissionKind = "fixed" | "percent" | "slabs";

/** The rule the form describes (amounts in piasters), or why it cannot be read. */
function ruleFromForm(
  kind: CommissionKind,
  flat: string,
  tiers: TierRow[],
): {
  rule: ServiceCommissionRule | null;
  errors: string[];
} {
  const errors: string[] = [];
  if (kind !== "slabs") {
    const v = flat.trim();
    if (v === "") return { rule: null, errors: ["اكتب العمولة"] };
    let value: number;
    if (kind === "percent") {
      value = Number(v);
      if (!Number.isFinite(value) || value < 0 || value > 100)
        return { rule: null, errors: ["النسبة لازم تكون من 0 لحد 100%"] };
    } else {
      const p = parseEgpStrict(v);
      if (p === null)
        return { rule: null, errors: ["العمولة لازم تكون مبلغ بالجنيه"] };
      value = p;
    }
    const rule: ServiceCommissionRule = { type: kind, value, tiers: [] };
    const ruleErrors = commissionRuleErrors(rule);
    return ruleErrors.length
      ? { rule: null, errors: ruleErrors }
      : { rule, errors: [] };
  }
  const readValue = (t: CommissionType, v: string, where: string) => {
    if (v.trim() === "") {
      errors.push(`${where}: اكتب العمولة`);
      return 0;
    }
    if (t === "percent") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100)
        errors.push(`${where}: النسبة لازم تكون من 0 لحد 100%`);
      return n;
    }
    const p = parseEgpStrict(v);
    if (p === null) {
      errors.push(`${where}: العمولة لازم تكون مبلغ بالجنيه`);
      return 0;
    }
    return p;
  };
  const parsed = tiers.map((t, i) => {
    const where = `الشريحة ${i + 1}`;
    const from = parseEgpStrict(t.from);
    const to = parseEgpStrict(t.to);
    if (from === null || to === null) {
      errors.push(`${where}: اكتب من كام لحد كام`);
    }
    return {
      fromPiasters: from ?? 0,
      toPiasters: to ?? 0,
      type: t.type,
      value: readValue(t.type, t.value, where),
    };
  });
  if (errors.length) return { rule: null, errors };
  // No commission outside the slabs: the sale asks for an amount inside one of them.
  const rule: ServiceCommissionRule = {
    type: "fixed",
    value: 0,
    tiers: parsed,
  };
  const ruleErrors = commissionRuleErrors(rule, { slabsRequired: true });
  return ruleErrors.length
    ? { rule: null, errors: ruleErrors }
    : { rule, errors: [] };
}

export function ServiceFormModal({
  product,
  existingServices,
  presetCategory = "تحويل أموال",
  onClose,
  onSaved,
  onDeleted,
}: ServiceFormModalProps) {
  const { session } = useAuth();
  const storeId = session?.store?.id;

  const [name, setName] = useState(product?.name_ar || "");
  const [category, setCategory] = useState(product?.category || presetCategory);
  // A category the owner types («تصنيف جديد»), when none of the list fits.
  const [newCategory, setNewCategory] = useState(false);
  // A new service starts with a fixed commission to fill; an older service (one fixed
  // commission, no rule saved) starts with that commission.
  const [kind, setKind] = useState<CommissionKind>("fixed");
  const [flat, setFlat] = useState(() =>
    product ? egp(Math.max(0, product.sell_price_piasters ?? 0)) : "",
  );
  const [tiers, setTiers] = useState<TierRow[]>(() => [emptySlab()]);
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [linked, setLinked] = useState<string[]>(() =>
    product ? getServiceLinkedMachineIds(product.id, storeId) : [],
  );
  const [touched, setTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The machines, and (when editing) the saved commission rule — the same form, prefilled.
  useEffect(() => {
    let alive = true;
    void fetchStoreMachines(storeId).then((list) => {
      if (alive) setMachines(list);
    });
    if (product) {
      apiGet("/api/sales/config")
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            d: {
              config?: {
                serviceCommissions?: Record<string, ServiceCommissionRule>;
              };
            } | null,
          ) => {
            const rule = d?.config?.serviceCommissions?.[product.id];
            if (!alive || !rule) return;
            if (rule.tiers.length > 0) {
              setKind("slabs");
              setTiers(
                rule.tiers.map((t) => ({
                  from: egp(t.fromPiasters),
                  to: egp(t.toPiasters),
                  type: t.type,
                  value: t.type === "fixed" ? egp(t.value) : String(t.value),
                })),
              );
            } else {
              setKind(rule.type);
              setFlat(
                rule.type === "fixed" ? egp(rule.value) : String(rule.value),
              );
            }
          },
        )
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [product, storeId]);

  const { rule, errors } = useMemo(
    () => ruleFromForm(kind, flat, tiers),
    [kind, flat, tiers],
  );
  // The example: a 100 ج operation, or one in the first slab's range.
  const example = rule?.tiers[0]
    ? Math.max(
        rule.tiers[0].fromPiasters,
        Math.min(50000, rule.tiers[0].toPiasters),
      )
    : 10000;
  const exampleSlab = rule ? slabFor(rule, example) : undefined;

  const setTier = (i: number, patch: Partial<TierRow>) =>
    setTiers((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const save = async () => {
    setTouched(true);
    setSubmitError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError("اكتب اسم الخدمة");
      return;
    }
    const norm = normalizeArabic(trimmed);
    const dup = !product
      ? existingServices?.find((s) => normalizeArabic(s.name_ar) === norm)
      : undefined;
    if (dup) {
      setNameError(`«${dup.name_ar}» متسجلة قبل كده`);
      return;
    }
    setNameError(null);
    const finalCategory = category.trim();
    if (!finalCategory) {
      setSubmitError("اكتب التصنيف");
      return;
    }
    if (!rule) {
      setSubmitError(errors[0] ?? "راجع العمولة");
      return;
    }
    setBusy(true);
    try {
      // The product's price: the fixed commission (older screens read it), else 0.
      const first = rule.tiers[0] ?? rule;
      const sellPricePiasters = first.type === "fixed" ? first.value : 0;
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: product?.id,
          nameAr: trimmed,
          category: finalCategory,
          unit: "service",
          sellPricePiasters,
          buyCostPiasters: null,
          isCustom: product ? (product.is_custom ?? true) : true,
          brandName: product?.brand_name ?? null,
          barcode: null,
          variants: [
            {
              id: product?.variants?.[0]?.id,
              flavor: null,
              sizeValue: 1,
              sizeUnit: "piece",
              packQty: 1,
              sellPricePiasters,
              costPricePiasters: null,
            },
          ],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error?.message || "مقدرناش نحفظ الخدمة");
      }
      const id: string = json.data?.id ?? product?.id;
      const cfg = await fetch("/api/sales/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceCommissions: { [id]: rule } }),
      });
      if (!cfg.ok) {
        const c = await cfg.json().catch(() => ({}));
        throw new Error(c.error?.message || "مقدرناش نحفظ العمولة");
      }
      setServiceLinkedMachineIds(id, linked, storeId);
      enableServiceForSale(id, storeId);
      onSaved(json.data);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "حصلت مشكلة");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products?id=${product.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("مقدرناش نمسح الخدمة");
      void fetch("/api/sales/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceCommissions: { [product.id]: null } }),
      }).catch(() => undefined);
      onDeleted?.(product.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "حصلت مشكلة");
    } finally {
      setBusy(false);
    }
  };

  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    id?: string,
  ) => (
    <button
      type="button"
      className={`${f.chip} ${on ? f.chipOn : ""}`}
      onClick={onClick}
      aria-pressed={on}
      data-testid={id}
    >
      {label}
    </button>
  );

  return (
    <Modal title={product ? "تعديل الخدمة" : "خدمة جديدة"} onClose={onClose}>
      <div className={f.form} data-testid="service-form" dir="rtl">
        {submitError && (
          <div className={f.errBox} role="alert">
            {submitError}
          </div>
        )}

        <label className={f.lbl} htmlFor="sv-name">
          اسم الخدمة
        </label>
        <input
          id="sv-name"
          className={`${f.input} ${nameError ? f.inputErr : ""}`}
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="مثلاً: تحويل فودافون كاش"
          autoFocus={!product}
          data-testid="service-name"
        />
        {nameError && <div className={f.err}>{nameError}</div>}

        <label className={f.lbl} htmlFor="sv-cat">
          التصنيف
        </label>
        {newCategory ? (
          <input
            id="sv-cat"
            className={f.input}
            dir="auto"
            maxLength={60}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="مثلاً: تذاكر"
            data-testid="service-category-new"
          />
        ) : (
          <select
            id="sv-cat"
            className={f.select}
            value={category}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setNewCategory(true);
                setCategory("");
              } else setCategory(e.target.value);
            }}
            data-testid="service-category"
          >
            {SERVICE_CATEGORIES.some((c) => c.value === category) ? null : (
              <option value={category}>{category}</option>
            )}
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value="__new__">➕ تصنيف جديد…</option>
          </select>
        )}

        {/* ─── عمولتك: مبلغ ثابت، نسبة، أو شرائح حسب قيمة العملية ─── */}
        <div className={f.lbl}>عمولتك</div>
        <div className={f.chips}>
          {chip(
            kind === "fixed",
            "مبلغ ثابت",
            () => setKind("fixed"),
            "service-kind-fixed",
          )}
          {chip(
            kind === "percent",
            "نسبة %",
            () => setKind("percent"),
            "service-kind-percent",
          )}
          {chip(
            kind === "slabs",
            "حسب المبلغ (شرائح)",
            () => setKind("slabs"),
            "service-kind-slabs",
          )}
        </div>
        {kind !== "slabs" ? (
          <>
            <input
              className={f.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={flat}
              onChange={(e) => setFlat(e.target.value)}
              placeholder={
                kind === "fixed"
                  ? "العمولة بالجنيه (مثلاً 5)"
                  : "النسبة % (مثلاً 2)"
              }
              aria-label={kind === "fixed" ? "العمولة بالجنيه" : "النسبة"}
              data-testid="service-commission-value"
            />
            <div className={f.note}>
              {kind === "fixed"
                ? "نفس المبلغ على كل عملية: شحن بـ 100 جنيه → عمولتك 5 جنيه."
                : "نسبة من قيمة العملية: 2% من عملية بـ 100 جنيه = 2 جنيه."}
            </div>
          </>
        ) : (
          <>
            <div className={f.note}>
              مثلاً: من 100 لحد 1000 → 5 جنيه، ومن 1000 لحد 10000 → 10 جنيه.
            </div>
            {tiers.map((t, i) => (
              <div key={i} className={f.packBox} data-testid="service-tier">
                <div className={f.two}>
                  <div>
                    <label className={f.lbl}>من (جنيه)</label>
                    <input
                      className={f.input}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={t.from}
                      onChange={(e) => setTier(i, { from: e.target.value })}
                      data-testid="service-tier-from"
                    />
                  </div>
                  <div>
                    <label className={f.lbl}>لحد أقل من (جنيه)</label>
                    <input
                      className={f.input}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={t.to}
                      onChange={(e) => setTier(i, { to: e.target.value })}
                      data-testid="service-tier-to"
                    />
                  </div>
                </div>
                <div className={f.chips}>
                  {chip(
                    t.type === "fixed",
                    "مبلغ ثابت",
                    () => setTier(i, { type: "fixed" }),
                    "service-tier-fixed",
                  )}
                  {chip(
                    t.type === "percent",
                    "نسبة %",
                    () => setTier(i, { type: "percent" }),
                    "service-tier-percent",
                  )}
                </div>
                <div className={f.barRow}>
                  <input
                    className={f.input}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={t.value}
                    onChange={(e) => setTier(i, { value: e.target.value })}
                    placeholder={
                      t.type === "fixed" ? "العمولة بالجنيه" : "النسبة %"
                    }
                    data-testid="service-tier-value"
                  />
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      className={f.scanBtn}
                      onClick={() =>
                        setTiers((prev) => prev.filter((_, k) => k !== i))
                      }
                      aria-label={`امسح الشريحة ${i + 1}`}
                      data-testid="service-tier-remove"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className={`${f.btn} ${f.ghost}`}
              onClick={() => {
                const last = tiers[tiers.length - 1];
                setTiers((prev) => [...prev, emptySlab(last?.to ?? "")]);
              }}
              data-testid="service-tier-add"
            >
              + شريحة
            </button>
          </>
        )}

        {(touched ||
          (kind === "slabs"
            ? tiers.some((t) => t.to.trim() && t.value.trim())
            : flat.trim() !== "")) &&
          errors.length > 0 && (
            <div className={f.errBox} role="alert" data-testid="service-errors">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        {rule && exampleSlab && (
          <div className={f.sumbox} data-testid="service-example">
            عملية بـ {formatMoney(example)} → عمولتك{" "}
            {formatMoney(exampleSlab.piasters)}
            {exampleSlab.tier ? ` (${describeSlab(exampleSlab.tier)})` : ""}
          </div>
        )}

        {/* ─── V19: بتتشحن من أنهي ماكينات / محافظ؟ ─── */}
        <div className={f.lbl}>بتتشحن من أنهي ماكينات / محافظ؟</div>
        {machines.length === 0 ? (
          <div className={f.note}>
            لسه مفيش ماكينات — ضيف ماكينة الأول من «+ ماكينة / محفظة».
          </div>
        ) : (
          <div className={f.chips}>
            {machines.map((m) => (
              <React.Fragment key={m.id}>
                {chip(
                  linked.includes(m.id),
                  `💳 ${m.name}`,
                  () =>
                    setLinked((prev) =>
                      prev.includes(m.id)
                        ? prev.filter((x) => x !== m.id)
                        : [...prev, m.id],
                    ),
                  "service-machine",
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        <button
          type="button"
          className={f.btn}
          disabled={busy}
          onClick={() => void save()}
          data-testid="service-save"
        >
          {busy ? "بيتحفظ…" : "حفظ الخدمة"}
        </button>
        {product &&
          (confirmDelete ? (
            <button
              type="button"
              className={`${f.btn} ${f.danger}`}
              disabled={busy}
              onClick={() => void remove()}
              data-testid="service-delete-confirm"
            >
              متأكد؟ امسحها
            </button>
          ) : (
            <button
              type="button"
              className={`${f.btn} ${f.danger}`}
              onClick={() => setConfirmDelete(true)}
              data-testid="service-delete"
            >
              🗑️ امسح الخدمة
            </button>
          ))}
      </div>
    </Modal>
  );
}

export default ServiceFormModal;
