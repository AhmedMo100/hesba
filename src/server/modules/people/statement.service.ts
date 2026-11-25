import "server-only";

/**
 * @file statement.service.ts
 * @description A person's account statement («كشف الحساب», ADR-0036): every entry of the
 * person's ledger, newest first, with the running balance, WHERE it came from and WHAT it was
 * for — read-only, from the existing ledger:
 * - a credit-sale invoice (`debt_entries.sale_id`) → its products from `sale_lines`;
 * - a supplier invoice (`debt_entries.purchase_id`) → its products from `purchase_lines`;
 * - a daily total's credit part (إدارة المحل, `daily_sales_entry_id`);
 * - a manual debt → its products from `debt_entry_items` (written on the account only: no
 *   stock, no revenue);
 * - a payment / collection, an owner adjustment, an opening balance.
 * One invoice is ONE debt here (its payments settle it), so nothing is listed twice.
 */

import { prisma as defaultPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { invoiceNumberOf } from "@/schemas/sale";
import { historyOf, type LedgerLabels, type LedgerOwner } from "./ledger";
import type { DebtTransactionItem } from "./types";

export type StatementSource =
  | "sale"
  | "purchase"
  | "daily_sales"
  | "manual"
  | "payment"
  | "adjustment"
  | "opening"
  | "reversal";

export interface StatementLine {
  name: string;
  unit: string;
  quantityBase: number;
  unitPricePiasters: number;
  totalPiasters: number;
}

export interface StatementEntry extends DebtTransactionItem {
  source: StatementSource;
  /** «فاتورة بيع #A1B2C3» / «فاتورة شراء» / «إجمالي يوم» / «دين يدوي» / … */
  sourceLabel: string;
  /** The products behind the entry (an invoice's lines or a manual debt's items). */
  lines: StatementLine[];
  /** The original invoice, to open it: a sale (customers) or a purchase (suppliers). */
  saleId: string | null;
  purchaseId: string | null;
  dailySalesEntryId: string | null;
}

export interface PersonStatement {
  person: {
    id: string;
    name: string;
    phone: string | null;
    side: "receivable" | "payable";
    table: LedgerOwner["table"];
  };
  /** Signed balance (> 0: the customer owes the shop / the shop owes the supplier). */
  balancePiasters: number;
  entries: StatementEntry[];
}

const LABELS: Record<LedgerOwner["table"], LedgerLabels> = {
  customers: { debt: "مستحق ليك", payment: "تحصيل" },
  payables: { debt: "مستحق عليك", payment: "سداد" },
  suppliers: { debt: "مستحق له", payment: "سداد له" },
};

const SOURCE_LABEL: Record<StatementSource, string> = {
  sale: "فاتورة بيع آجل",
  purchase: "فاتورة بضاعة",
  daily_sales: "آجل من إجمالي اليوم",
  manual: "دين يدوي",
  payment: "دفعة",
  adjustment: "تعديل رصيد",
  opening: "رصيد البداية",
  reversal: "إلغاء فاتورة / مرتجع",
};

export async function getPersonStatement(
  storeId: string,
  userId: string,
  personId: string,
  customPrisma = defaultPrisma,
): Promise<PersonStatement> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const where = { id: personId, storeId, deletedAt: null };
      const select = { id: true, nameAr: true, phone: true };
      let owner: LedgerOwner | null = null;
      let found: { id: string; nameAr: string; phone: string | null } | null =
        await tx.customer.findFirst({ where, select });
      if (found) owner = { table: "customers", customerId: found.id };
      if (!found) {
        found = await tx.payable.findFirst({ where, select });
        if (found) owner = { table: "payables", payableId: found.id };
      }
      if (!found) {
        found = await tx.supplier.findFirst({ where, select });
        if (found) owner = { table: "suppliers", supplierId: found.id };
      }
      if (!found || !owner) throw AppError.notFound("الشخص ده مش موجود");
      const side = owner.table === "customers" ? "receivable" : "payable";

      const entries = await tx.debtEntry.findMany({
        where: {
          storeId,
          ...(owner.table === "customers"
            ? { customerId: found.id }
            : owner.table === "payables"
              ? { payableId: found.id }
              : { supplierId: found.id }),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const history = historyOf(side, entries, LABELS[owner.table]);
      const byId = new Map(entries.map((e) => [e.id, e]));

      const entryIds = entries.map((e) => e.id);
      const saleIds = [
        ...new Set(entries.map((e) => e.saleId).filter(Boolean)),
      ] as string[];
      const purchaseIds = [
        ...new Set(entries.map((e) => e.purchaseId).filter(Boolean)),
      ] as string[];

      const [items, saleLines, purchaseLines] = await Promise.all([
        entryIds.length
          ? tx.debtEntryItem.findMany({
              where: { storeId, debtEntryId: { in: entryIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            })
          : [],
        saleIds.length
          ? tx.saleLine.findMany({
              where: { storeId, saleId: { in: saleIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                saleId: true,
                quantityBaseUnits: true,
                unitPricePiasters: true,
                totalPiasters: true,
                storeProduct: { select: { nameAr: true, unit: true } },
                storeVariant: {
                  select: {
                    flavor: true,
                    storeProduct: { select: { nameAr: true, unit: true } },
                  },
                },
              },
            })
          : [],
        purchaseIds.length
          ? tx.purchaseLine.findMany({
              where: { storeId, purchaseId: { in: purchaseIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                purchaseId: true,
                quantityBaseUnits: true,
                unitCostPiasters: true,
                totalCostPiasters: true,
                storeProduct: { select: { nameAr: true, unit: true } },
                storeVariant: {
                  select: {
                    flavor: true,
                    storeProduct: { select: { nameAr: true, unit: true } },
                  },
                },
              },
            })
          : [],
      ]);

      const group = <T>(rows: T[], key: (r: T) => string | null) => {
        const m = new Map<string, T[]>();
        for (const r of rows) {
          const k = key(r);
          if (!k) continue;
          m.set(k, [...(m.get(k) ?? []), r]);
        }
        return m;
      };
      const itemsByEntry = group(items, (i) => i.debtEntryId);
      const linesBySale = group(saleLines, (l) => l.saleId);
      const linesByPurchase = group(purchaseLines, (l) => l.purchaseId);
      const productOf = (l: {
        storeProduct: { nameAr: string | null; unit: string } | null;
        storeVariant: {
          flavor: string | null;
          storeProduct: { nameAr: string | null; unit: string } | null;
        } | null;
      }) => {
        const p = l.storeVariant?.storeProduct ?? l.storeProduct;
        return {
          name:
            [p?.nameAr, l.storeVariant?.flavor].filter(Boolean).join(" ") ||
            "منتج",
          unit: p?.unit ?? "piece",
        };
      };

      const out: StatementEntry[] = history.map((h) => {
        const e = byId.get(h.id)!;
        const isDebt = h.type === "debt";
        let source: StatementSource;
        if (h.kind === "adjustment") source = "adjustment";
        else if (h.kind === "opening") source = "opening";
        else if (h.kind === "reversal") source = "reversal";
        else if (!isDebt) source = "payment";
        else if (e.saleId) source = "sale";
        else if (e.purchaseId) source = "purchase";
        else if (e.dailySalesEntryId) source = "daily_sales";
        else source = "manual";

        let lines: StatementLine[] = [];
        // An invoice's products are shown once: on its debt, not on each payment.
        if (source === "sale" && e.saleId) {
          lines = (linesBySale.get(e.saleId) ?? []).map((l) => ({
            ...productOf(l),
            quantityBase: l.quantityBaseUnits,
            unitPricePiasters: Number(l.unitPricePiasters),
            totalPiasters: Number(l.totalPiasters),
          }));
        } else if (source === "purchase" && e.purchaseId) {
          lines = (linesByPurchase.get(e.purchaseId) ?? []).map((l) => ({
            ...productOf(l),
            quantityBase: l.quantityBaseUnits,
            unitPricePiasters: Number(l.unitCostPiasters),
            totalPiasters: Number(
              l.totalCostPiasters ??
                l.unitCostPiasters * BigInt(l.quantityBaseUnits),
            ),
          }));
        } else if (source === "manual") {
          lines = (itemsByEntry.get(e.id) ?? []).map((i) => ({
            name: i.name,
            unit: i.unit,
            quantityBase: Number(i.quantityBase),
            unitPricePiasters: Number(i.unitPriceMinor),
            totalPiasters: Number(i.totalMinor),
          }));
        }
        const sourceLabel =
          source === "sale" && e.saleId
            ? `${SOURCE_LABEL.sale} #${invoiceNumberOf(e.saleId)}`
            : source === "payment" && e.saleId
              ? `دفعة من فاتورة #${invoiceNumberOf(e.saleId)}`
              : source === "payment" && e.purchaseId
                ? "دفعة من فاتورة بضاعة"
                : SOURCE_LABEL[source];
        return {
          ...h,
          source,
          sourceLabel,
          lines,
          saleId: e.saleId,
          purchaseId: e.purchaseId,
          dailySalesEntryId: e.dailySalesEntryId,
        };
      });

      return {
        person: {
          id: found.id,
          name: found.nameAr,
          phone: found.phone,
          side,
          table: owner.table,
        },
        balancePiasters: history[0]?.balance_after_piasters ?? 0,
        entries: out,
      };
    },
    customPrisma,
  );
}
