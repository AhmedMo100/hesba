"use client";

/**
 * @file SandwichFormModal.tsx
 * @description Create or edit a sandwich (ADR-0018): name, recipe rows (product, amount,
 * unit), the calculated cost, the selling price, and the resulting profit.
 *
 * @remarks
 * - The cost is read-only: it is previewed from each ingredient's purchase price
 *   (`sandwich-form.ts` → `@/domain/recipe`) and recalculated by the server on save.
 * - Saving needs the server. Offline, the form says so and does not pretend to save.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Field, Input, Icon, Alert } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import {
  fetchSandwichIngredientOptions,
  saveSandwich,
  SandwichApiError,
  type Sandwich,
  type SandwichIngredientOption,
} from "@/client/shared/api/sandwiches";
import { allowedRecipeUnits } from "@/domain/recipe";
import { IngredientPicker } from "./IngredientPicker";
import {
  buildSandwichInput,
  defaultUnitFor,
  emptyRow,
  isWholePackUnit,
  previewSandwich,
  recipeUnitLabel,
  rowsFromSandwich,
  type FormErrors,
  type IngredientRow,
} from "./sandwich-form";
import styles from "./SandwichFormModal.module.css";

interface SandwichFormModalProps {
  sandwich?: Sandwich | null;
  onClose: () => void;
  onSaved: (sandwich: Sandwich) => void;
}

const UNIT_LABEL: Record<IngredientRow["unit"], string> = {
  g: "sandwich.unitGram",
  kg: "sandwich.unitKilo",
  piece: "sandwich.unitPiece",
};

function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function SandwichFormModal({
  sandwich,
  onClose,
  onSaved,
}: SandwichFormModalProps) {
  const isEdit = Boolean(sandwich);
  const online = useOnline();
  const [name, setName] = useState(sandwich?.name ?? "");
  const [sellPrice, setSellPrice] = useState(
    sandwich ? String(sandwich.sellPricePiasters / 100) : "",
  );
  const [rows, setRows] = useState<IngredientRow[]>(() =>
    sandwich ? rowsFromSandwich(sandwich) : [emptyRow()],
  );
  const [fetched, setFetched] = useState<SandwichIngredientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The row just added with "ضيف مكوّن": its product list opens straight away.
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSandwichIngredientOptions()
      .then((opts) => {
        if (alive) setFetched(opts);
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoadError(
            err instanceof Error ? err.message : t("sandwich.loadFailed"),
          );
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // When editing, keep the sandwich's own ingredients selectable even if they are no longer
  // offered (e.g. hidden since): the server explains on save if one cannot be used.
  const options = useMemo(() => {
    const byId = new Map(fetched.map((o) => [o.variantId, o]));
    for (const ing of sandwich?.ingredients ?? []) {
      if (!byId.has(ing.variantId)) {
        byId.set(ing.variantId, {
          variantId: ing.variantId,
          productId: ing.productId,
          name: ing.name,
          unit: ing.unit,
          isWeight: ing.isWeight,
          buyPricePiasters: ing.buyPricePiasters,
          stockBase: ing.stockBase,
        });
      }
    }
    return [...byId.values()];
  }, [fetched, sandwich]);
  const optionById = useMemo(
    () => new Map(options.map((o) => [o.variantId, o])),
    [options],
  );

  const preview = useMemo(
    () => previewSandwich(rows, options, sellPrice),
    [rows, options, sellPrice],
  );

  const updateRow = (key: string, patch: Partial<IngredientRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  };

  const handleProductChange = (key: string, variantId: string) => {
    updateRow(key, {
      variantId,
      unit: defaultUnitFor(optionById.get(variantId)),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const built = buildSandwichInput(name, sellPrice, rows, options);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await saveSandwich(built.input, sandwich?.id);
      onSaved(saved);
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof SandwichApiError || err instanceof Error
          ? err.message
          : t("sandwich.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const profitClass =
    preview.profitPiasters < 0 ? styles.loss : styles.profitValue;

  // Enter in a text field must never submit the form by accident; only Save submits.
  const preventEnterSubmit = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
  };

  const addRow = () => {
    const row = emptyRow();
    setJustAddedKey(row.key);
    setRows((prev) => [...prev, row]);
  };

  return (
    <Modal
      title={isEdit ? t("sandwich.editTitle") : t("sandwich.addTitle")}
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <Button
            kind="ghost"
            onClick={onClose}
            disabled={saving}
            data-testid="sandwich-cancel"
          >
            {t("sandwich.cancel")}
          </Button>
          <Button
            kind="primary"
            type="submit"
            form="sandwich-form"
            busy={saving}
            disabled={!online || loading}
            className={styles.saveBtn}
            data-testid="sandwich-save"
          >
            {t("sandwich.save")}
          </Button>
        </div>
      }
    >
      <form
        id="sandwich-form"
        onSubmit={handleSubmit}
        onKeyDown={preventEnterSubmit}
        noValidate
        data-testid="sandwich-form"
        className={styles.form}
      >
        {!online && <Alert kind="warning">{t("sandwich.offline")}</Alert>}

        {/* 1. Name */}
        <section className={styles.card}>
          <Field
            label={t("sandwich.name")}
            err={errors.name ? t(`sandwich.${errors.name}`) : undefined}
            className={styles.fieldTight}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sandwich.namePlaceholder")}
              maxLength={80}
              data-testid="sandwich-name"
            />
          </Field>
        </section>

        {/* 2. Ingredients */}
        <section className={styles.card} aria-labelledby="sandwich-ing-title">
          <header className={styles.cardHead}>
            <b id="sandwich-ing-title">{t("sandwich.ingredients")}</b>
            <span className={styles.countBadge}>{rows.length}</span>
          </header>
          <small className={styles.cardHint}>
            {t("sandwich.ingredientsHint")}
          </small>

          {loading ? (
            <div className={styles.muted} role="status">
              {t("sandwich.loadingIngredients")}
            </div>
          ) : loadError ? (
            <Alert kind="error">{loadError}</Alert>
          ) : options.length === 0 ? (
            <Alert kind="info">{t("sandwich.noIngredientOptions")}</Alert>
          ) : null}

          <div className={styles.rows} data-testid="sandwich-ingredients">
            {rows.map((row, index) => {
              const option = optionById.get(row.variantId);
              const units = option
                ? allowedRecipeUnits(option.unit)
                : ["piece"];
              const rowPreview = preview.rows[index];
              const rowErr = errors.rows?.[row.key];
              const takenIds = new Set(
                rows
                  .filter((r) => r.key !== row.key && r.variantId)
                  .map((r) => r.variantId),
              );
              return (
                <div
                  className={`${styles.row} ${rowErr ? styles.rowBad : ""}`}
                  key={row.key}
                  data-testid={`sandwich-row-${index}`}
                >
                  <div className={styles.rowTop}>
                    <span className={styles.rowIndex} aria-hidden="true">
                      {index + 1}
                    </span>
                    <IngredientPicker
                      options={options}
                      value={row.variantId}
                      takenIds={takenIds}
                      onChange={(variantId) =>
                        handleProductChange(row.key, variantId)
                      }
                      testId={`sandwich-row-${index}`}
                      defaultOpen={row.key === justAddedKey && !row.variantId}
                    />
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() =>
                        setRows((prev) => prev.filter((r) => r.key !== row.key))
                      }
                      aria-label={t("sandwich.removeIngredient", {
                        name: option?.name ?? "",
                      })}
                      data-testid={`sandwich-row-${index}-remove`}
                    >
                      <Icon n="trash" s={18} />
                    </button>
                  </div>
                  <div className={styles.rowBottom}>
                    <label className={styles.qtyLabel}>
                      <span>{t("sandwich.quantity")}</span>
                      <input
                        className={styles.qty}
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(row.key, { quantity: e.target.value })
                        }
                        placeholder="0"
                        data-testid={`sandwich-row-${index}-qty`}
                      />
                    </label>
                    {units.length > 1 ? (
                      <select
                        className={styles.unit}
                        value={units.includes(row.unit) ? row.unit : units[0]}
                        onChange={(e) =>
                          updateRow(row.key, {
                            unit: e.target.value as IngredientRow["unit"],
                          })
                        }
                        aria-label={t("sandwich.unit")}
                        data-testid={`sandwich-row-${index}-unit`}
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {t(UNIT_LABEL[u as IngredientRow["unit"]])}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={styles.unitFixed}>
                        {recipeUnitLabel(option?.unit)}
                      </span>
                    )}
                    <span className={styles.rowCost}>
                      <small>{t("sandwich.cost")}</small>
                      <b data-testid={`sandwich-row-${index}-cost`}>
                        {rowPreview?.costPiasters != null
                          ? formatMoney(rowPreview.costPiasters)
                          : "—"}
                      </b>
                    </span>
                  </div>
                  {rowErr ? (
                    <span className={styles.rowErr} role="alert">
                      {t(`sandwich.${rowErr}`)}
                    </span>
                  ) : option && isWholePackUnit(option.unit) ? (
                    <span className={styles.rowWarn}>
                      {t("sandwich.wholeUnitHint", {
                        unit: recipeUnitLabel(option.unit),
                      })}
                    </span>
                  ) : rowPreview?.missingCost ? (
                    <span className={styles.rowWarn}>
                      {t("sandwich.missingCost")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {errors.ingredients && (
            <span className={styles.rowErr} role="alert">
              {t(`sandwich.${errors.ingredients}`)}
            </span>
          )}

          <button
            type="button"
            className={styles.addRowBtn}
            onClick={addRow}
            disabled={options.length === 0}
            data-testid="sandwich-add-ingredient"
          >
            <Icon n="plus" s={18} />
            <span>{t("sandwich.addIngredient")}</span>
          </button>
        </section>

        {/* 3. Money: cost → price → profit */}
        <section className={styles.moneyCard} aria-live="polite">
          <div className={styles.moneyRow}>
            <span className={styles.moneyLabel}>
              {t("sandwich.totalCost")}
              <small>{t("sandwich.costNote")}</small>
            </span>
            <b className={styles.moneyValue} data-testid="sandwich-total-cost">
              {formatMoney(preview.costPiasters)}
            </b>
          </div>

          <Field
            label={t("sandwich.sellPrice")}
            err={errors.price ? t(`sandwich.${errors.price}`) : undefined}
            className={styles.fieldTight}
          >
            <div className={styles.priceInput}>
              <Input
                inputMode="decimal"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="0"
                data-testid="sandwich-sell-price"
              />
              <span className={styles.priceSuffix} aria-hidden="true">
                ج
              </span>
            </div>
          </Field>

          <div className={`${styles.moneyRow} ${styles.profitRow}`}>
            <span className={styles.moneyLabel}>{t("sandwich.profit")}</span>
            <span className={styles.profitBox}>
              <b className={profitClass} data-testid="sandwich-profit">
                {preview.sellPricePiasters > 0
                  ? formatMoney(preview.profitPiasters)
                  : "—"}
              </b>
              {preview.marginPercent !== null && (
                <span
                  className={`${styles.marginChip} ${preview.profitPiasters < 0 ? styles.marginChipLoss : ""}`}
                  title={t("sandwich.margin")}
                >
                  {preview.marginPercent}%
                </span>
              )}
            </span>
          </div>
          {preview.sellPricePiasters > 0 && preview.profitPiasters < 0 && (
            <small className={styles.loss}>{t("sandwich.loss")}</small>
          )}
        </section>

        {submitError && <Alert kind="error">{submitError}</Alert>}
      </form>
    </Modal>
  );
}
