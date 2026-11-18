"use client";

/**
 * @file ServiceFormModal.tsx
 * @description V19 serviceForm — the same form to add and to edit a service: its name, the
 * shop's commission (a fixed amount or a percentage, optionally by tiers of the operation's
 * amount), and the machines / wallets it is charged from. The commission rule is kept in the
 * shop's sales settings and validated there (no overlapping tiers, no negative commission,
 * a top above the bottom). A saved service is offered in the sale at once.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import { parseEgpStrict } from "@/domain/money";
import {
  commissionRuleErrors,
  legacyCommissionRule,
  serviceCommission,
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

/** The rule the form describes (amounts in piasters), or why it cannot be read. */
function ruleFromForm(
  type: CommissionType,
  value: string,
  tiers: TierRow[],
): { rule: ServiceCommissionRule | null; errors: string[] } {
  const errors: string[] = [];
  const readValue = (t: CommissionType, v: string, where: string) => {
    if (v.trim() === "") {
      errors.push(`${where}: اكتب العمولة`);
      return 0;
    }
    if (t === "percent") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors.push(`${where}: النسبة لازم تكون رقم`);
      return n;
    }
    const p = parseEgpStrict(v);
    if (p === null) {
      errors.push(`${where}: العمولة لازم تكون مبلغ بالجنيه`);
      return 0;
    }
    return p;
  };
  const base = readValue(type, value, "العمولة");
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
  const rule: ServiceCommissionRule = { type, value: base, tiers: parsed };
  const ruleErrors = commissionRuleErrors(rule);
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
  const legacy = legacyCommissionRule(product?.sell_price_piasters ?? 500);
  const [type, setType] = useState<CommissionType>(legacy.type);
  const [value, setValue] = useState(product ? egp(legacy.value) : "5");
  const [tiers, setTiers] = useState<TierRow[]>([]);
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
            setType(rule.type);
            setValue(
              rule.type === "fixed" ? egp(rule.value) : String(rule.value),
            );
            setTiers(
              rule.tiers.map((t) => ({
                from: egp(t.fromPiasters),
                to: egp(t.toPiasters),
                type: t.type,
                value: t.type === "fixed" ? egp(t.value) : String(t.value),
              })),
            );
          },
        )
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [product, storeId]);

  const { rule, errors } = useMemo(
    () => ruleFromForm(type, value, tiers),
    [type, value, tiers],
  );
  const example = 50000; // 500 ج
  const exampleTier = rule?.tiers.find(
    (t) => t.fromPiasters <= example && example < t.toPiasters,
  );

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
    if (!rule) return;
    setBusy(true);
    try {
      // The product keeps the fixed commission as its price (older screens read it).
      const sellPricePiasters = rule.type === "fixed" ? rule.value : 0;
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: product?.id,
          nameAr: trimmed,
          category,
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
          نوعها
        </label>
        <select
          id="sv-cat"
          className={f.select}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {SERVICE_CATEGORIES.some((c) => c.value === category) ? null : (
            <option value={category}>{category}</option>
          )}
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        {/* ─── العمولة: مبلغ ثابت أو نسبة ─── */}
        <div className={f.lbl}>عمولتك</div>
        <div className={f.chips}>
          {chip(
            type === "fixed",
            "مبلغ ثابت",
            () => setType("fixed"),
            "service-fee-fixed",
          )}
          {chip(
            type === "percent",
            "نسبة مئوية",
            () => setType("percent"),
            "service-fee-percent",
          )}
        </div>
        <label className={f.lbl} htmlFor="sv-fee">
          {type === "fixed"
            ? "العمولة (جنيه لكل عملية)"
            : "النسبة (%) من قيمة العملية"}
        </label>
        <input
          id="sv-fee"
          className={f.input}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === "fixed" ? "5" : "1.5"}
          data-testid="service-fee"
        />

        {/* ─── شرائح حسب قيمة العملية ─── */}
        <div className={f.lbl}>شرائح حسب قيمة العملية (اختياري)</div>
        <div className={f.note}>
          مثلاً: من 100 لحد 1000 → 5 جنيه. أي مبلغ برّه الشرائح بياخد العمولة
          اللي فوق.
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
              {chip(t.type === "fixed", "مبلغ ثابت", () =>
                setTier(i, { type: "fixed" }),
              )}
              {chip(t.type === "percent", "نسبة", () =>
                setTier(i, { type: "percent" }),
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
              <button
                type="button"
                className={f.scanBtn}
                onClick={() =>
                  setTiers((prev) => prev.filter((_, k) => k !== i))
                }
                aria-label={`امسح الشريحة ${i + 1}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={`${f.btn} ${f.ghost}`}
          onClick={() => {
            const last = tiers[tiers.length - 1];
            setTiers((prev) => [
              ...prev,
              { from: last?.to ?? "", to: "", type: "fixed", value: "" },
            ]);
          }}
          data-testid="service-tier-add"
        >
          + شريحة
        </button>

        {(touched || tiers.length > 0) && errors.length > 0 && (
          <div className={f.errBox} role="alert" data-testid="service-errors">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        {rule && (
          <div className={f.sumbox} data-testid="service-example">
            عملية بـ {formatMoney(example)} → عمولتك{" "}
            {formatMoney(serviceCommission(rule, example))}
            {exampleTier ? " (من الشرائح)" : ""}
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
