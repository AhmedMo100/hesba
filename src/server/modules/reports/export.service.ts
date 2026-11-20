import "server-only";

/**
 * @file export.service.ts
 * @description The tables behind «تصدير» on التقارير and الجرد. They are built on the server from
 * the same services the screens read (`getHomeReport`, the expenses list, the received batches,
 * the stock list), for the same period — so the file shows the numbers the owner sees, never a
 * screen's partial copy. Money stays in integer piasters until the writer prints it exactly.
 */
import { prisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { ExpenseService } from "@/server/modules/expenses";
import { getHomeReport } from "./report.service";
import { toCairoDateString } from "@/domain/time";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import type { ReportPeriod } from "@/schemas/report";
import { WASTE_REASON_LABELS, type WasteReason } from "@/schemas/inventory";
import {
  gramsToKilosText,
  piastersText,
  type Cell,
  type SheetTable,
} from "@/server/platform/export/spreadsheet";
import { packWord, unitWord } from "@/client/shared/unit-labels";

const money = (piasters: number | null | undefined): Cell =>
  piasters === null || piasters === undefined ? "—" : { piasters };

const isWeighed = (unit: string | null | undefined) =>
  unit === "kg" || unit === "g" || unit === "weight";

/** A quantity as a number in the product's unit (kilos for weighed goods) and its unit word. */
function qtyCells(
  unit: string | null | undefined,
  base: number,
): [Cell, string] {
  return isWeighed(unit)
    ? [{ decimal: gramsToKilosText(base) }, "كيلو"]
    : [base, unitWord(unit ?? "piece")];
}

const cairoDay = (iso: string) => toCairoDateString(new Date(iso));

const PAY_LABEL: Record<string, string> = {
  cash: "كاش",
  wallet: "محفظة / ماكينة",
};

const PERIOD_LABEL: Record<string, string> = {
  today: "النهارده",
  yesterday: "امبارح",
  week: "الأسبوع",
  month: "الشهر",
  year: "السنة",
  custom: "فترة معينة",
  all: "كل الوقت",
};

export async function inventoryExportTables(
  storeId: string,
  userId: string,
): Promise<{ tables: SheetTable[]; summary: string }> {
  const inventory = await new InventoryService(prisma).getStoreInventory(
    storeId,
    userId,
  );
  const STATUS: Record<string, string> = {
    ok: "متوفر",
    low: "قرب يخلص",
    out: "خلصان",
  };
  const rows: Cell[][] = [
    [
      "المنتج",
      "القسم",
      "الكمية",
      "الوحدة",
      "بالعبوات",
      "سعر الشراء للوحدة",
      "سعر البيع للوحدة",
      "القيمة بسعر الشراء",
      "القيمة بسعر البيع",
      "أقرب صلاحية",
      "الحالة",
    ],
  ];
  let cost = 0;
  let sell = 0;
  const sorted = [...inventory].sort((a, b) =>
    a.productName.localeCompare(b.productName, "ar"),
  );
  for (const item of sorted) {
    const unit = item.unit || (item.unitMode === "weight" ? "kg" : "piece");
    const base = Math.max(0, item.currentStockBase);
    const c = stockValuePiasters(unit, base, item.buyPricePiasters);
    const s = stockValuePiasters(unit, base, item.sellPricePiasters);
    cost += c;
    sell += s;
    const [q, word] = qtyCells(unit, base);
    const packs =
      !isWeighed(unit) && item.packQty > 1 && base >= item.packQty
        ? `${Math.floor(base / item.packQty)} ${packWord(item.packName, item.packQty)}${base % item.packQty ? ` و ${base % item.packQty} ${word}` : ""}`
        : "";
    const nearest = item.batches
      .filter((b) => b.remainingQty > 0 && b.expiryDate)
      .map((b) => b.expiryDate!.slice(0, 10))
      .sort()[0];
    // The kilo price for weighed goods sold by the gram, like the screen.
    const per = (p: number | undefined) =>
      p ? (unit === "g" ? p * 1000 : p) : null;
    rows.push([
      item.flavor ? `${item.productName} (${item.flavor})` : item.productName,
      item.category || "متفرقات",
      q,
      word,
      packs,
      money(per(item.buyPricePiasters)),
      money(per(item.sellPricePiasters)),
      { piasters: c },
      { piasters: s },
      nearest ?? "",
      STATUS[item.status] ?? item.status,
    ]);
  }
  rows.push([
    "الإجمالي",
    "",
    "",
    "",
    "",
    "",
    "",
    { piasters: cost },
    { piasters: sell },
    "",
    `${inventory.length} صنف`,
  ]);
  return {
    tables: [
      {
        name: "الجرد",
        rows,
        widths: [28, 16, 10, 10, 20, 14, 14, 16, 16, 13, 11],
      },
    ],
    summary: `جرد ${toCairoDateString(new Date())}: ${inventory.length} صنف — قيمتها بسعر الشراء ${piastersText(cost)} ج وبسعر البيع ${piastersText(sell)} ج`,
  };
}

export async function reportExportTables(
  storeId: string,
  userId: string,
  period: ReportPeriod,
  custom: { customFrom?: string; customTo?: string },
): Promise<{ tables: SheetTable[]; summary: string; label: string }> {
  const report = await getHomeReport(storeId, userId, period, custom);
  const fromDay = report.from ? cairoDay(report.from) : null;
  const toDay = cairoDay(new Date(Date.parse(report.to) - 1).toISOString());
  const label = fromDay
    ? fromDay === toDay
      ? fromDay
      : `${fromDay} → ${toDay}`
    : `لحد ${toDay}`;

  const [expenses, additions] = await Promise.all([
    new ExpenseService(prisma).getStoreExpenses(
      storeId,
      userId,
      fromDay
        ? { period: "custom", from: fromDay, to: toDay }
        : { period: "all" },
    ),
    new InventoryService(prisma).getStockMovements(storeId, userId, {
      receivedOnly: true,
      from: report.from ? new Date(report.from) : null,
      to: new Date(report.to),
      limit: 5000,
    }),
  ]);

  const s = report.sales;
  const left =
    s.grossProfitPiasters === null
      ? null
      : s.grossProfitPiasters -
        report.expenses.totalPiasters -
        report.losses.costPiasters;
  const pay = report.byPaymentMethod ?? {
    cash: 0,
    wallet: 0,
    card: 0,
    debt: 0,
  };
  const summary: Cell[][] = [
    ["البند", "المبلغ"],
    ["الفترة", `${PERIOD_LABEL[period] ?? period} (${label})`],
    ["بعت بكام", money(s.revenuePiasters)],
    ["عدد البيعات", s.count],
    ["تمن البضاعة اللي اتباعت", money(s.cogsPiasters)],
    ["كسبت كام", money(s.grossProfitPiasters)],
    ["صرفت كام", money(report.expenses.totalPiasters)],
    ["في تالف قد إيه", money(report.losses.costPiasters)],
    ["اللي فاضل بعد المصروفات والتالف", money(left)],
    ["دخل عندك بضاعة بكام", money(report.purchases.totalPiasters)],
    ["بعت كاش", money(pay.cash)],
    ["بعت بمحافظ وماكينات", money(pay.wallet + pay.card)],
    ["بعت آجل", money(pay.debt)],
  ];
  if (s.unknownCostCount > 0) {
    summary.push([
      "ملاحظة",
      `${s.unknownCostCount} بيعة تكلفتها مش متسجلة، فالمكسب مش معروف بالظبط`,
    ]);
  }

  const expenseRows: Cell[][] = [
    ["اليوم", "البند", "المبلغ", "الدفع", "ملاحظة"],
    ...expenses.expenses.map((e) => [
      cairoDay(e.spent_at),
      e.category,
      { piasters: e.amount_piasters },
      e.machine ? e.machine.name : (PAY_LABEL[e.paid_from ?? ""] ?? ""),
      e.note ?? "",
    ]),
    ["الإجمالي", "", { piasters: expenses.totalPiasters }, "", ""],
  ];

  const additionRows: Cell[][] = [
    ["اليوم", "المنتج", "الكمية", "الوحدة", "التكلفة", "المورد", "الصلاحية"],
    ...additions.map((m) => {
      const [q, word] = qtyCells(
        m.unitMode === "weight" ? "kg" : "piece",
        m.quantityBase,
      );
      return [
        cairoDay(m.createdAt),
        m.flavor ? `${m.productName} (${m.flavor})` : m.productName,
        q,
        word,
        money(m.costTotalMinor),
        m.supplierName ?? "",
        m.expiryDate ? m.expiryDate.slice(0, 10) : "",
      ];
    }),
  ];

  const lossRows: Cell[][] = [
    ["اليوم", "المنتج", "الكمية", "الوحدة", "السبب", "التكلفة"],
    ...report.losses.recent.map((l) => {
      const [q, word] = qtyCells(l.unit, l.quantityBase);
      return [
        cairoDay(l.at),
        l.name,
        q,
        word,
        WASTE_REASON_LABELS[l.reason as WasteReason] ?? l.reason,
        money(l.costPiasters),
      ];
    }),
  ];

  const topRows: Cell[][] = [
    ["المنتج", "المبلغ", "المكسب"],
    ...report.topProducts.map((p) => [
      p.name,
      { piasters: p.revenuePiasters },
      money(p.grossProfitPiasters),
    ]),
    [],
    ["القسم", "المبلغ", "المكسب"],
    ...report.byCategory.map((c) => [
      c.category || "متفرقات",
      { piasters: c.revenuePiasters },
      money(c.grossProfitPiasters),
    ]),
  ];

  return {
    label,
    tables: [
      { name: "الملخص", rows: summary, widths: [34, 30] },
      { name: "المصروفات", rows: expenseRows, widths: [12, 18, 12, 18, 28] },
      {
        name: "البضاعة اللي دخلت",
        rows: additionRows,
        widths: [12, 26, 10, 10, 12, 18, 12],
      },
      { name: "التالف", rows: lossRows, widths: [12, 26, 10, 10, 16, 12] },
      { name: "أكتر حاجات اتباعت", rows: topRows, widths: [26, 14, 14] },
    ],
    summary: [
      `تقرير ${PERIOD_LABEL[period] ?? period} (${label})`,
      `بعت بـ ${piastersText(s.revenuePiasters)} ج`,
      s.grossProfitPiasters === null
        ? "المكسب: —"
        : `كسبت ${piastersText(s.grossProfitPiasters)} ج`,
      `صرفت ${piastersText(report.expenses.totalPiasters)} ج`,
    ].join(" · "),
  };
}
