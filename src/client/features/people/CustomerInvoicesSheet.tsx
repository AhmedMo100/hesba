"use client";

/**
 * @file CustomerInvoicesSheet.tsx
 * @description «فواتير الزبون» (Prompt 2): why a customer owes what they owe — every credit
 * invoice with its number, date, products (in their units), total, what was paid, what is left
 * and its status, the payments on it, and payments that were not tied to one invoice (they
 * settle the oldest first). The owner can collect part or all of one invoice here; the server
 * caps it at what that invoice still owes and records it once (`opId`).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Field, Modal, Skeleton } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import { unitWord } from "@/client/shared/unit-labels";
import { parseEgpStrict } from "@/domain/money";
import { formatCairoDate } from "@/domain/time";
import {
  listCustomerInvoices,
  paySaleInvoice,
  type CustomerInvoicesView,
} from "@/client/shared/api/invoices";
import styles from "./CustomerInvoicesSheet.module.css";

type Invoice = CustomerInvoicesView["invoices"][number];

const STATUS: Record<Invoice["status"], string> = {
  paid: "مدفوعة",
  partial: "مدفوع جزء",
  unpaid: "مش مدفوعة",
  voided: "ملغية",
};

function qty(base: number, unit: string): string {
  if (unit === "kg" || unit === "g") {
    return `${(base / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} كجم`;
  }
  return `${base} ${unitWord(unit)}`;
}

function InvoiceCard({
  inv,
  onPaid,
}: {
  inv: Invoice;
  onPaid: (msg: string) => void;
}) {
  const [open, setOpen] = useState(
    inv.status !== "paid" && inv.status !== "voided",
  );
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const op = useRetryOpId();

  const pay = async (piasters: number) => {
    setError(null);
    if (piasters <= 0) {
      setError("اكتب مبلغ صحيح");
      return;
    }
    if (piasters > inv.remainingPiasters) {
      setError(`المبلغ أكبر من الباقي (${formatMoney(inv.remainingPiasters)})`);
      return;
    }
    setBusy(true);
    try {
      const body = { saleId: inv.id, amountPiasters: piasters };
      await paySaleInvoice(inv.id, op.opIdFor(body), piasters);
      op.reset();
      setAmount("");
      onPaid(`اتحصّل ${formatMoney(piasters)} من فاتورة ${inv.number}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "حصل خطأ، جرّب تاني");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.card} data-testid={`customer-invoice-${inv.id}`}>
      <button
        type="button"
        className={styles.cardHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.num}>فاتورة {inv.number}</span>
        <span className={`${styles.status} ${styles[inv.status]}`}>
          {STATUS[inv.status]}
        </span>
        <span className={styles.date}>{formatCairoDate(inv.createdAt)}</span>
      </button>
      <dl className={styles.sums}>
        <div>
          <dt>الإجمالي</dt>
          <dd>{formatMoney(inv.totalPiasters)}</dd>
        </div>
        <div>
          <dt>اتدفع</dt>
          <dd>
            {formatMoney(inv.paidPiasters + inv.settledByGeneralPiasters)}
          </dd>
        </div>
        <div>
          <dt>الباقي</dt>
          <dd className={styles.left} data-testid="invoice-remaining">
            {formatMoney(inv.remainingPiasters)}
          </dd>
        </div>
      </dl>
      {open && (
        <div className={styles.body}>
          <table className={styles.lines}>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>السعر</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.name}
                    {l.returnedQuantityBase > 0 && (
                      <small className={styles.returned}>
                        {" "}
                        (رجع {qty(l.returnedQuantityBase, l.unit)})
                      </small>
                    )}
                  </td>
                  <td>{qty(l.quantityBase, l.unit)}</td>
                  <td>{formatMoney(l.unitPricePiasters)}</td>
                  <td>{formatMoney(l.totalPiasters)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.returnedPiasters > 0 && (
            <p className={styles.note}>
              مرتجع: {formatMoney(inv.returnedPiasters)}
            </p>
          )}
          {inv.settledByGeneralPiasters > 0 && (
            <p className={styles.note}>
              {formatMoney(inv.settledByGeneralPiasters)} اتغطوا من دفعات عامة
              (الأقدم الأول)
            </p>
          )}
          {inv.payments.length > 0 && (
            <ul className={styles.history}>
              {inv.payments.map((p, i) => (
                <li key={i}>
                  {p.kind === "return" ? "مرتجع / إلغاء" : "دفع"}{" "}
                  {formatMoney(p.amountPiasters)} ·{" "}
                  {formatCairoDate(p.createdAt)}
                </li>
              ))}
            </ul>
          )}
          {inv.remainingPiasters > 0 && (
            <div className={styles.pay}>
              <Field label="تحصيل من الفاتورة دي (ج.م)">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={(inv.remainingPiasters / 100).toString()}
                  data-testid="invoice-pay-amount"
                />
              </Field>
              <div className={styles.payBtns}>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={busy}
                  onClick={() => void pay(parseEgpStrict(amount) ?? 0)}
                  data-testid="invoice-pay"
                >
                  حصّل
                </Button>
                <Button
                  kind="ghost"
                  disabled={busy}
                  onClick={() => void pay(inv.remainingPiasters)}
                  data-testid="invoice-pay-all"
                >
                  الباقي كله
                </Button>
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function CustomerInvoicesSheet({
  customer,
  onClose,
  onChanged,
}: {
  customer: { id: string; name: string };
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [data, setData] = useState<CustomerInvoicesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  const fetchInvoices = useCallback(
    () =>
      listCustomerInvoices(customer.id).then(
        (d) => {
          setError(null);
          setData(d);
        },
        (e: unknown) =>
          setError(e instanceof Error ? e.message : "مقدرناش نجيب الفواتير"),
      ),
    [customer.id],
  );
  const load = () => void fetchInvoices();

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  const visible =
    data?.invoices.filter((i) => showPaid || i.remainingPiasters > 0) ?? [];
  const hiddenCount = (data?.invoices.length ?? 0) - visible.length;

  return (
    <Modal title={`فواتير ${customer.name}`} onClose={onClose}>
      <div className={styles.wrap} data-testid="customer-invoices">
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!data && !error && <Skeleton height={120} radius={16} />}
        {data && (
          <>
            <div className={styles.totals}>
              <div>
                <span>عليه</span>
                <b data-testid="customer-outstanding">
                  {formatMoney(data.outstandingPiasters)}
                </b>
              </div>
              {data.otherDebtPiasters > 0 && (
                <div>
                  <span>ديون من غير فاتورة</span>
                  <b>{formatMoney(data.otherDebtPiasters)}</b>
                </div>
              )}
              {data.creditPiasters > 0 && (
                <div>
                  <span>رصيد ليه عندك</span>
                  <b>{formatMoney(data.creditPiasters)}</b>
                </div>
              )}
            </div>
            {data.invoices.length === 0 ? (
              <p className={styles.note}>مفيش فواتير آجل للزبون ده.</p>
            ) : (
              <ul className={styles.list}>
                {visible.map((inv) => (
                  <InvoiceCard
                    key={inv.id}
                    inv={inv}
                    onPaid={(msg) => {
                      onChanged(msg);
                      load();
                    }}
                  />
                ))}
              </ul>
            )}
            {hiddenCount > 0 && (
              <Button
                kind="ghost"
                onClick={() => setShowPaid(true)}
                data-testid="show-paid-invoices"
              >
                اعرض الفواتير المدفوعة ({hiddenCount})
              </Button>
            )}
            {data.generalPayments.length > 0 && (
              <section>
                <h3 className={styles.h3}>دفعات عامة</h3>
                <ul className={styles.history}>
                  {data.generalPayments.map((g, i) => (
                    <li key={i}>
                      {formatMoney(g.amountPiasters)} ·{" "}
                      {formatCairoDate(g.createdAt)}
                      {g.note ? ` · ${g.note}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
