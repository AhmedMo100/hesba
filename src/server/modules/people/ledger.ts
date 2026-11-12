import "server-only";

/**
 * @file ledger.ts
 * @description The one implementation of a person's money ledger used by customers, payables
 * and suppliers (ADR-0023, audit QA-12): signed balances (never floored), overpayment kept as
 * a visible credit, owner adjustments recorded as `adjustment` entries, and every write done
 * under a lock on the person's row so the balance it reports is exact.
 *
 * @usedBy customer.service.ts, payable.service.ts, supplier.service.ts
 */

import type { DebtEntry } from "@prisma/client";
import type { TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  adjustmentEntry,
  debtDirection,
  paymentDirection,
  splitBalance,
  summarizeLedger,
  type LedgerEntryKind,
  type LedgerSide,
} from "@/domain/ledger";
import type { RecordDebtTransactionInput } from "@/schemas/people";
import type { DebtTransactionItem, FormattedPerson } from "./types";

/** Which person a ledger belongs to: the table and the `debt_entries` column that links it. */
export type LedgerOwner =
  | { table: "customers"; customerId: string }
  | { table: "payables"; payableId: string }
  | { table: "suppliers"; supplierId: string };

/** Labels shown for each kind of entry, per section. */
export interface LedgerLabels {
  debt: string;
  payment: string;
}

export const ADJUSTMENT_LABEL = "تعديل رصيد (صاحب المحل)";
export const OPENING_LABEL = "رصيد البداية";
export const REVERSAL_LABEL = "إلغاء فاتورة / مرتجع";

export function sideOf(owner: LedgerOwner): LedgerSide {
  return owner.table === "customers" ? "receivable" : "payable";
}

function ownerId(owner: LedgerOwner): string {
  return owner.table === "customers"
    ? owner.customerId
    : owner.table === "payables"
      ? owner.payableId
      : owner.supplierId;
}

function ownerColumns(owner: LedgerOwner) {
  return owner.table === "customers"
    ? { customerId: owner.customerId }
    : owner.table === "payables"
      ? { payableId: owner.payableId }
      : { supplierId: owner.supplierId };
}

const asKind = (k: string): LedgerEntryKind =>
  k === "opening" || k === "adjustment" || k === "reversal" ? k : "transaction";

/**
 * Locks the person's row for the rest of the transaction, so two writes to the same ledger run
 * one after the other and each reports the balance after its own entry. Returns false when
 * the person does not exist in this store (RLS hides other stores) or was deleted.
 */
export async function lockLedgerOwnerInTx(
  tx: TenantTx,
  storeId: string,
  owner: LedgerOwner,
): Promise<boolean> {
  const id = ownerId(owner);
  // Table names come from the closed `LedgerOwner` union, never from input.
  const rows =
    owner.table === "customers"
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM customers
           WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid AND deleted_at IS NULL
             FOR UPDATE`
      : owner.table === "payables"
        ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM payables
           WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid AND deleted_at IS NULL
             FOR UPDATE`
        : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM suppliers
           WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid AND deleted_at IS NULL
             FOR UPDATE`;
  return rows.length > 0;
}

async function entriesOf(
  tx: TenantTx,
  storeId: string,
  owner: LedgerOwner,
): Promise<DebtEntry[]> {
  return tx.debtEntry.findMany({
    where: { storeId, ...ownerColumns(owner) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** The balance figures a person card shows. Signed, never floored (ADR-0023). */
export function balanceFields(
  side: LedgerSide,
  entries: readonly DebtEntry[],
): Pick<
  FormattedPerson,
  | "amount_piasters"
  | "credit_piasters"
  | "total_original_piasters"
  | "total_paid_piasters"
  | "total_adjustments_piasters"
  | "is_settled"
> {
  const sorted = [...entries].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const s = summarizeLedger(
    side,
    sorted.map((e) => ({
      direction: e.direction,
      amountPiasters: e.amountPiasters,
      kind: asKind(e.entryKind),
    })),
  );
  return {
    amount_piasters: Number(s.balance),
    credit_piasters: Number(splitBalance(s.balance).credit),
    total_original_piasters: Number(s.totalDebt),
    total_paid_piasters: Number(s.totalPaid),
    total_adjustments_piasters: Number(s.totalAdjustments),
    is_settled: s.balance === BigInt(0) && entries.length > 0,
  };
}

/** The person's note: the latest note written on a debt or payment, else the person's own. */
export function latestNoteOf(
  personNote: string | null,
  entries: readonly DebtEntry[],
): string | null {
  let note = personNote || null;
  for (const e of entries) {
    if (e.noteAr && e.entryKind !== "adjustment") note = e.noteAr;
  }
  return note;
}

function toItem(
  side: LedgerSide,
  entry: DebtEntry,
  balanceAfter: bigint,
  labels: LedgerLabels,
): DebtTransactionItem {
  const kind = asKind(entry.entryKind);
  const isDebt = entry.direction === debtDirection(side);
  return {
    id: entry.id,
    direction: entry.direction,
    type:
      kind === "adjustment" || kind === "reversal"
        ? kind
        : isDebt
          ? "debt"
          : "payment",
    kind,
    action_label:
      kind === "adjustment"
        ? ADJUSTMENT_LABEL
        : kind === "reversal"
          ? REVERSAL_LABEL
          : kind === "opening"
            ? OPENING_LABEL
            : isDebt
              ? labels.debt
              : labels.payment,
    amount_piasters: Number(entry.amountPiasters),
    balance_after_piasters: Number(balanceAfter),
    note: entry.noteAr,
    op_id: entry.opId,
    purchase_id: entry.purchaseId,
    sale_id: entry.saleId,
    created_at: entry.createdAt.toISOString(),
  };
}

/** The person's history, newest first, each entry with the signed balance after it. */
export function historyOf(
  side: LedgerSide,
  entries: readonly DebtEntry[],
  labels: LedgerLabels,
): DebtTransactionItem[] {
  const sorted = [...entries].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const s = summarizeLedger(
    side,
    sorted.map((e) => ({
      direction: e.direction,
      amountPiasters: e.amountPiasters,
      kind: asKind(e.entryKind),
    })),
  );
  return sorted
    .map((e, i) => toItem(side, e, s.running[i] ?? BigInt(0), labels))
    .reverse();
}

/**
 * Records a debt or a payment (ADR-0023). Atomic and idempotent:
 * - the person's row is locked first, so concurrent writes to one ledger are serialized;
 * - an `opId` already recorded in this store returns that entry and writes nothing;
 * - a payment larger than what is owed is accepted and leaves a visible CREDIT (a negative
 *   balance) — never a hidden one; a later debt is set against that credit in the open.
 *
 * @throws AppError 404 when the person is not in this store (or was deleted).
 */
export async function recordLedgerEntryInTx(
  tx: TenantTx,
  storeId: string,
  owner: LedgerOwner,
  input: RecordDebtTransactionInput,
  labels: LedgerLabels,
): Promise<DebtTransactionItem> {
  const side = sideOf(owner);
  if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
    throw AppError.notFound("الشخص ده مش موجود أو اتحذف");
  }
  const opId = input.opId || crypto.randomUUID();
  const direction =
    input.type === "debt"
      ? debtDirection(side)
      : side === "receivable"
        ? "i_owe"
        : "owed_to_me";
  const existing = await tx.debtEntry.findFirst({ where: { storeId, opId } });
  if (existing) {
    if (ownerId(owner) !== ownerIdOfEntry(existing)) {
      throw AppError.conflict("العملية دي اتسجلت قبل كده لشخص تاني");
    }
    // A retry must be the same entry (QA-27): another amount or direction is a 409.
    if (
      existing.direction !== direction ||
      existing.amountPiasters !== BigInt(input.amountPiasters)
    ) {
      throw AppError.conflict(
        "رقم العملية ده اتسجل قبل كده بمبلغ أو نوع مختلف",
      );
    }
    const history = historyOf(
      side,
      await entriesOf(tx, storeId, owner),
      labels,
    );
    const item = history.find((h) => h.id === existing.id);
    if (!item) throw AppError.conflict("العملية دي اتسجلت قبل كده");
    return item;
  }

  const created = await tx.debtEntry.create({
    data: {
      storeId,
      ...ownerColumns(owner),
      direction,
      amountPiasters: BigInt(input.amountPiasters),
      noteAr: input.note?.trim() || null,
      opId,
      entryKind: "transaction",
      createdAt: input.date ?? new Date(),
    },
  });
  const history = historyOf(side, await entriesOf(tx, storeId, owner), labels);
  const item = history.find((h) => h.id === created.id);
  if (!item) throw AppError.internal();
  return item;
}

function ownerIdOfEntry(e: DebtEntry): string | null {
  return e.customerId ?? e.payableId ?? e.supplierId;
}

/**
 * The owner edits a person's balance to `targetPiasters` (ADR-0023). Under the person's lock,
 * the difference from the TRUE signed balance (a credit included) is written as ONE
 * `adjustment` entry, labelled as the owner's — never as a debt or a payment, and nothing when
 * the balance already is the target. History is never changed.
 */
export async function setLedgerBalanceInTx(
  tx: TenantTx,
  storeId: string,
  owner: LedgerOwner,
  targetPiasters: number,
): Promise<void> {
  const side = sideOf(owner);
  if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
    throw AppError.notFound("الشخص ده مش موجود أو اتحذف");
  }
  const entries = await entriesOf(tx, storeId, owner);
  const current = BigInt(balanceFields(side, entries).amount_piasters);
  const entry = adjustmentEntry(side, current, BigInt(targetPiasters));
  if (!entry) return;
  await tx.debtEntry.create({
    data: {
      storeId,
      ...ownerColumns(owner),
      direction: entry.direction,
      amountPiasters: entry.amountPiasters,
      noteAr: null,
      opId: crypto.randomUUID(),
      entryKind: "adjustment",
    },
  });
}

/** Section totals: what is owed (positive balances) and the credits, kept apart. */
export function sectionTotals(people: readonly FormattedPerson[]) {
  let totalOriginal = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  let totalCredit = 0;
  let active = 0;
  let settled = 0;
  let credits = 0;
  for (const p of people) {
    totalOriginal += p.total_original_piasters ?? 0;
    totalPaid += p.total_paid_piasters ?? 0;
    if (p.amount_piasters > 0) {
      totalRemaining += p.amount_piasters;
      active++;
    }
    if ((p.credit_piasters ?? 0) > 0) {
      totalCredit += p.credit_piasters ?? 0;
      credits++;
    }
    if (p.is_settled) settled++;
  }
  return {
    total_piasters: totalRemaining,
    summary: {
      total_original_piasters: totalOriginal,
      total_paid_piasters: totalPaid,
      total_remaining_piasters: totalRemaining,
      total_credit_piasters: totalCredit,
      total_count: people.length,
      active_count: active,
      settled_count: settled,
      credit_count: credits,
    },
  };
}

/**
 * Writes one entry of an INVOICE on a person's ledger (ADR-0027): the debt a supplier purchase
 * or a credit sale creates, a payment against it, or its reversal when the invoice is
 * cancelled or returned. The caller holds the person's lock ({@link lockLedgerOwnerInTx}) and
 * owns the idempotency of the invoice operation; `opId` is that operation's (unique per store).
 *
 * - `debt`: increases what is owed on this side (supplier: «عليك»; customer: «ليك»).
 * - `payment`: money paid against the invoice (`settlesEntryId` = the invoice's debt entry).
 * - `reversal`: takes (part of) the invoice's debt back; never counted as a payment.
 */
export async function writeInvoiceEntryInTx(
  tx: TenantTx,
  storeId: string,
  owner: LedgerOwner,
  entry: {
    type: "debt" | "payment" | "reversal";
    amountPiasters: bigint;
    opId: string;
    note?: string | null;
    purchaseId?: string | null;
    saleId?: string | null;
    settlesEntryId?: string | null;
    now: Date;
  },
): Promise<DebtEntry> {
  const side = sideOf(owner);
  if (entry.amountPiasters <= BigInt(0)) {
    throw AppError.badRequest("المبلغ لازم يكون أكبر من صفر");
  }
  return tx.debtEntry.create({
    data: {
      storeId,
      ...ownerColumns(owner),
      direction:
        entry.type === "debt" ? debtDirection(side) : paymentDirection(side),
      amountPiasters: entry.amountPiasters,
      noteAr: entry.note?.trim() || null,
      opId: entry.opId,
      entryKind: entry.type === "reversal" ? "reversal" : "transaction",
      purchaseId: entry.purchaseId ?? null,
      saleId: entry.saleId ?? null,
      settlesEntryId: entry.settlesEntryId ?? null,
      createdAt: entry.now,
    },
  });
}

/** What is still owed on one invoice: Σ its signed entries on that side (may be < 0). */
export function invoiceOutstanding(
  side: LedgerSide,
  entries: ReadonlyArray<Pick<DebtEntry, "direction" | "amountPiasters">>,
): bigint {
  let balance = BigInt(0);
  for (const e of entries) {
    balance +=
      e.direction === debtDirection(side)
        ? e.amountPiasters
        : -e.amountPiasters;
  }
  return balance;
}
