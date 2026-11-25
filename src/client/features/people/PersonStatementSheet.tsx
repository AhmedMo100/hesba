"use client";

/**
 * @file PersonStatementSheet.tsx
 * @description «كشف الحساب» (ADR-0036): everything on a person's account, newest first, from
 * `GET /api/people/:id/statement` — each entry with where it came from (a credit-sale invoice,
 * a supplier invoice, the daily total's credit, a manual debt, a payment), its products
 * (quantity × price = total), the running balance, and a button that opens the original
 * invoice. Read-only: nothing is recorded here, so nothing can be recorded twice.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import styles from "./PeopleView.module.css";

interface StatementLine {
  name: string;
  unit: string;
  quantityBase: number;
  unitPricePiasters: number;
  totalPiasters: number;
}
interface StatementEntry {
  id: string;
  type: "debt" | "payment" | "adjustment" | "reversal";
  source: string;
  sourceLabel: string;
  amount_piasters: number;
  balance_after_piasters: number;
  note: string | null;
  created_at: string;
  lines: StatementLine[];
  saleId: string | null;
  purchaseId: string | null;
}
interface Statement {
  person: { id: string; name: string; side: "receivable" | "payable" };
  balancePiasters: number;
  entries: StatementEntry[];
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const qtyText = (l: StatementLine) =>
  l.unit === "kg" || l.unit === "g"
    ? `${Number((l.quantityBase / 1000).toFixed(3))} كيلو`
    : `${l.quantityBase}`;

export function PersonStatementSheet({
  person,
  onClose,
  onOpenSale,
  onOpenPurchase,
}: {
  person: { id: string; name: string };
  onClose: () => void;
  /** Opens the customer's invoices (the original credit sale). */
  onOpenSale?: () => void;
  /** Opens the supplier's invoices (the original purchase). */
  onOpenPurchase?: () => void;
}) {
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/people/${person.id}/statement`, { credentials: "same-origin" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message || "مقدرناش نجيب الحساب");
        return j as Statement;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "مقدرناش نجيب الحساب"),
      );
  }, [person.id]);
  useEffect(load, [load]);

  const receivable = data?.person.side !== "payable";
  return (
    <Modal title={`كشف حساب ${person.name}`} onClose={onClose}>
      <div className={styles.stmt} data-testid="person-statement">
        {error && (
          <div role="alert" className={styles.v19Error}>
            {error}{" "}
            <button type="button" className={styles.ghostBtn} onClick={load}>
              جرّب تاني
            </button>
          </div>
        )}
        {!data && !error && <p className={styles.v19Note}>بنحمّل…</p>}
        {data && (
          <>
            <div className={styles.debtTotal} data-testid="statement-balance">
              <span>
                {data.balancePiasters >= 0
                  ? receivable
                    ? "عليه ليك"
                    : "ليه عندك"
                  : "رصيد زيادة"}
              </span>
              <b>{formatMoney(Math.abs(data.balancePiasters))}</b>
            </div>
            {data.entries.length === 0 && (
              <p className={styles.v19Note}>لسه مفيش حاجة على الحساب ده.</p>
            )}
            {data.entries.map((e) => {
              const up = e.type === "debt";
              return (
                <div
                  key={e.id}
                  className={styles.stmtEntry}
                  data-testid="statement-entry"
                  data-source={e.source}
                >
                  <div className={styles.stmtHead}>
                    <span>
                      <b>{e.sourceLabel}</b>
                      <small>{day(e.created_at)}</small>
                    </span>
                    <b className={up ? styles.stmtUp : styles.stmtDown}>
                      {up ? "+" : "−"}
                      {formatMoney(e.amount_piasters)}
                    </b>
                  </div>
                  {e.lines.length > 0 && (
                    <div
                      className={styles.stmtLines}
                      data-testid="statement-lines"
                    >
                      {e.lines.map((l, i) => (
                        <div key={i} className={styles.stmtLine}>
                          <span>
                            {l.name} · {qtyText(l)} ×{" "}
                            {formatMoney(l.unitPricePiasters)}
                          </span>
                          <b>{formatMoney(l.totalPiasters)}</b>
                        </div>
                      ))}
                    </div>
                  )}
                  {e.note && (
                    <small className={styles.stmtNote}>{e.note}</small>
                  )}
                  <div className={styles.stmtFoot}>
                    <small>
                      الرصيد بعدها: {formatMoney(e.balance_after_piasters)}
                    </small>
                    {e.source === "sale" && e.saleId && onOpenSale && (
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        onClick={onOpenSale}
                        data-testid="statement-open-sale"
                      >
                        🧾 افتح الفاتورة
                      </button>
                    )}
                    {e.source === "purchase" &&
                      e.purchaseId &&
                      onOpenPurchase && (
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={onOpenPurchase}
                          data-testid="statement-open-purchase"
                        >
                          🧾 افتح الفاتورة
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}

export default PersonStatementSheet;
