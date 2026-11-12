"use client";

/**
 * @file PurchasesSheet.tsx
 * @description A supplier's purchase invoices (QA-30): receive a new invoice into stock (it
 * raises «عليك» by the server's total, with an optional payment now), pay an invoice in part
 * or in full, or cancel it. Every figure is the server's answer; a retried tap reuses its
 * `opId`, so a lost answer never records an invoice or a payment twice.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import {
  createPurchase,
  listSupplierPurchases,
  payPurchase,
  voidPurchase,
  type PurchaseView,
} from "@/client/shared/api/invoices";
import styles from "../sales/CartSheet.module.css";

interface StockOption {
  variantId: string;
  name: string;
  unit: string;
}

interface DraftLine {
  key: string;
  variantId: string;
  qty: string;
  cost: string;
  expiry: string;
}

const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  variantId: "",
  qty: "",
  cost: "",
  expiry: "",
});
const isWeighed = (unit: string) => unit === "kg" || unit === "g";

export function PurchasesSheet({
  supplierId,
  supplierName,
  onClose,
  onChanged,
}: {
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  /** After any change: the supplier's balance and the stock are re-read from the server. */
  onChanged: (message: string) => void;
}) {
  const [purchases, setPurchases] = useState<PurchaseView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [options, setOptions] = useState<StockOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [paidNow, setPaidNow] = useState("");
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createOp = useRef(crypto.randomUUID());
  const payOps = useRef(new Map<string, string>());

  // An edited draft is a new invoice: a new opId (a retry of the same draft keeps it).
  const draftKey = JSON.stringify([
    lines.map((l) => [l.variantId, l.qty, l.cost, l.expiry]),
    paidNow,
  ]);
  useEffect(() => {
    createOp.current = crypto.randomUUID();
  }, [draftKey]);

  const load = useCallback(() => {
    listSupplierPurchases(supplierId)
      .then((list) => {
        setLoadError(false);
        setPurchases(list);
      })
      .catch(() => setLoadError(true));
  }, [supplierId]);
  useEffect(load, [load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            inventory?: Array<{
              variantId: string;
              productName: string;
              unit?: string;
              unitMode?: string;
            }>;
          } | null,
        ) => {
          if (!alive || !d?.inventory) return;
          setOptions(
            d.inventory.map((i) => ({
              variantId: i.variantId,
              name: i.productName,
              unit: i.unit ?? (i.unitMode === "weight" ? "kg" : "piece"),
            })),
          );
        },
      )
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const unitOf = (variantId: string) =>
    options.find((o) => o.variantId === variantId)?.unit ?? "piece";

  const draftTotal = lines.reduce(
    (s, l) => s + (parseEgpStrict(l.cost) ?? 0),
    0,
  );

  const submitPurchase = async () => {
    setError(null);
    const parsed = lines.map((l) => {
      const unit = unitOf(l.variantId);
      const qtyNum = Number(l.qty);
      const quantityBase = isWeighed(unit) ? Math.round(qtyNum * 1000) : qtyNum;
      return {
        storeVariantId: l.variantId,
        quantityBase,
        totalCostPiasters: parseEgpStrict(l.cost),
        expiryDate: l.expiry || null,
      };
    });
    const paid = paidNow.trim() === "" ? 0 : parseEgpStrict(paidNow);
    if (
      paid === null ||
      parsed.some(
        (l) =>
          !l.storeVariantId ||
          l.totalCostPiasters === null ||
          !Number.isInteger(l.quantityBase) ||
          l.quantityBase <= 0,
      )
    ) {
      setError(t("invoice.invalidAmount"));
      return;
    }
    setBusy("create");
    try {
      const p = await createPurchase({
        opId: createOp.current,
        supplierId,
        lines: parsed.map((l) => ({
          ...l,
          totalCostPiasters: l.totalCostPiasters!,
        })),
        paidNowPiasters: paid,
      });
      createOp.current = crypto.randomUUID();
      setCreating(false);
      setLines([newLine()]);
      setPaidNow("");
      load();
      onChanged(
        t("invoice.purchaseDone", { total: formatMoney(p.totalPiasters) }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(null);
    }
  };

  const pay = async (p: PurchaseView) => {
    const amount = parseEgpStrict(payAmount[p.id] ?? "");
    if (amount === null || amount <= 0) {
      setError(t("invoice.invalidAmount"));
      return;
    }
    const opId = payOps.current.get(p.id) ?? crypto.randomUUID();
    payOps.current.set(p.id, opId);
    setBusy(`pay:${p.id}`);
    setError(null);
    try {
      await payPurchase(p.id, opId, amount);
      payOps.current.delete(p.id);
      setPayAmount((m) => ({ ...m, [p.id]: "" }));
      load();
      onChanged(t("invoice.payDone"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (p: PurchaseView) => {
    if (!window.confirm(t("invoice.cancelConfirm"))) return;
    setBusy(`void:${p.id}`);
    setError(null);
    try {
      await voidPurchase(p.id, crypto.randomUUID());
      load();
      onChanged(t("invoice.purchaseCancelled"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("invoice.loadFailed"));
    } finally {
      setBusy(null);
    }
  };

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Modal
      title={`${t("invoice.purchasesTitle")} — ${supplierName}`}
      onClose={onClose}
    >
      <div
        className={styles.sheet}
        style={{ border: 0, padding: 0 }}
        data-testid="purchases-sheet"
      >
        {!creating ? (
          <Button
            icon="plus"
            data-testid="purchase-new"
            onClick={() => setCreating(true)}
          >
            {t("invoice.newPurchase")}
          </Button>
        ) : (
          <div className={styles.card} data-testid="purchase-form">
            {lines.map((l) => (
              <div key={l.key} className={styles.row}>
                <Field label={t("invoice.item")} grow>
                  <select
                    className={styles.select}
                    value={l.variantId}
                    data-testid="purchase-line-item"
                    onChange={(e) =>
                      setLine(l.key, { variantId: e.target.value })
                    }
                  >
                    <option value="">{t("invoice.chooseItem")}</option>
                    {options.map((o) => (
                      <option key={o.variantId} value={o.variantId}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={`${t("invoice.qty")}${isWeighed(unitOf(l.variantId)) ? " (كجم)" : ""}`}
                  grow
                >
                  <Input
                    inputMode="decimal"
                    value={l.qty}
                    data-testid="purchase-line-qty"
                    onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  />
                </Field>
                <Field label={t("invoice.lineCost")} grow>
                  <Input
                    inputMode="decimal"
                    value={l.cost}
                    data-testid="purchase-line-cost"
                    onChange={(e) => setLine(l.key, { cost: e.target.value })}
                  />
                </Field>
                <Field label={t("invoice.expiry")} grow>
                  <Input
                    type="date"
                    value={l.expiry}
                    onChange={(e) => setLine(l.key, { expiry: e.target.value })}
                  />
                </Field>
              </div>
            ))}
            <Button
              kind="ghost"
              size="sm"
              icon="plus"
              onClick={() => setLines((ls) => [...ls, newLine()])}
            >
              {t("invoice.addLine")}
            </Button>
            <Field label={t("invoice.paidNow")}>
              <Input
                inputMode="decimal"
                value={paidNow}
                data-testid="purchase-paid-now"
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0"
              />
            </Field>
            <div className={styles.totals}>
              <span>
                {t("invoice.purchaseTotal")}: <b>{formatMoney(draftTotal)}</b>
              </span>
            </div>
            <Button
              wide
              loading={busy === "create"}
              disabled={busy !== null}
              data-testid="purchase-save"
              onClick={() => void submitPurchase()}
            >
              {t("invoice.savePurchase")}
            </Button>
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert" data-testid="purchase-error">
            {error}
          </p>
        )}

        {loadError ? (
          <div className={styles.card}>
            <p className={styles.error}>{t("invoice.loadFailed")}</p>
            <Button kind="ghost" onClick={load}>
              {t("invoice.retry")}
            </Button>
          </div>
        ) : purchases === null ? (
          <>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </>
        ) : purchases.length === 0 ? (
          <p className={styles.empty}>{t("invoice.noPurchases")}</p>
        ) : (
          purchases.map((p) => (
            <div
              key={p.id}
              className={styles.card}
              data-testid="purchase-row"
              data-voided={p.voided}
            >
              <div className={styles.head}>
                <b>
                  {formatMoney(p.totalPiasters)}
                  {p.voided && (
                    <small className={styles.badge}>
                      {t("invoice.cancelled")}
                    </small>
                  )}
                </b>
                <span className={styles.muted}>
                  {new Date(p.createdAt).toLocaleDateString("ar-EG")}
                </span>
              </div>
              <span className={styles.muted}>
                {p.lines
                  .map((l) => l.productName)
                  .filter(Boolean)
                  .join(" + ")}
              </span>
              {!p.voided && (
                <span>
                  {t("invoice.paid")}: <b>{formatMoney(p.paidPiasters)}</b> ·{" "}
                  {t("invoice.remaining")}:{" "}
                  <b data-testid="purchase-outstanding">
                    {formatMoney(p.outstandingPiasters)}
                  </b>
                </span>
              )}
              {!p.voided && (
                <div className={styles.actions}>
                  {p.outstandingPiasters > 0 && (
                    <>
                      <Input
                        inputMode="decimal"
                        style={{ maxWidth: 140 }}
                        aria-label={t("invoice.pay")}
                        value={payAmount[p.id] ?? ""}
                        data-testid="purchase-pay-amount"
                        onChange={(e) =>
                          setPayAmount((m) => ({
                            ...m,
                            [p.id]: e.target.value,
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        loading={busy === `pay:${p.id}`}
                        disabled={busy !== null}
                        data-testid="purchase-pay"
                        onClick={() => void pay(p)}
                      >
                        {t("invoice.pay")}
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    kind="dangerghost"
                    loading={busy === `void:${p.id}`}
                    disabled={busy !== null}
                    data-testid="purchase-cancel"
                    onClick={() => void cancel(p)}
                  >
                    {t("invoice.cancelPurchase")}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
