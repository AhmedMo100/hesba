import "server-only";

/**
 * @file grounded-answers.ts
 * @description The assistant's private mode (ADR-0030): when the configured model provider may
 * not receive shop data (e.g. an unpaid tier whose terms allow training / human review), the
 * question is NOT sent anywhere. The server recognizes the common business questions in
 * Egyptian Arabic, runs the same read-only tools inside the shop's tenant context, and writes
 * the answer from their results — every number comes from the database, none is generated.
 * A question it cannot place gets an honest "I can't answer that here" with the questions it
 * can answer (and no message credit is used for it).
 */
import { normalizeArabic } from "@/domain/normalize";
import type { ToolPeriod } from "./tools/business-tools";

export type GroundedIntent =
  | { tool: "compare_weeks" }
  | { tool: "getSalesSummary"; period: ToolPeriod }
  | { tool: "getFinancialOverview"; period: ToolPeriod }
  | { tool: "getExpensesSummary"; period: ToolPeriod }
  | { tool: "getPurchasesSummary"; period: ToolPeriod }
  | { tool: "getTopSellingProducts" }
  | { tool: "getInventoryStatus" }
  | { tool: "getCustomersDebtSummary" }
  | { tool: "getSuppliersPayablesSummary" };

/** Suggested questions: exactly the ones this mode (and the tools) can answer. */
export const SUGGESTED_QUESTIONS = [
  "بعت كام النهارده؟",
  "إيه أكتر المنتجات اللي بتتباع عندي؟",
  "عندي منتجات قربت تخلص؟",
  "مين أكتر عميل عليه فلوس؟",
  "عليّا كام للموردين؟",
  "مصروفاتي الشهر ده كام؟",
  "كسبت كام الشهر ده؟",
  "قارن مبيعات الأسبوع ده بالأسبوع اللي فات.",
] as const;

function periodOf(q: string): ToolPeriod {
  if (/امبارح|امس\b|إمبارح/.test(q)) return "yesterday";
  if (/(اسبوع|اسبوع)\s*(اللي|الي)\s*فات|الاسبوع الماضي|الاسبوع السابق/.test(q))
    return "last_week";
  if (/اسبوع|٧ ايام|7 ايام|سبع ايام/.test(q)) return "week";
  if (/شهر/.test(q)) return "this_month";
  return "today";
}

/** Which tool answers the question, or null when this mode cannot answer it. */
export function detectIntent(question: string): GroundedIntent | null {
  const q = normalizeArabic(question).replace(/[؟?!.،,]/g, " ");
  const period = periodOf(q);
  if (/قارن|مقارنه|مقارنة/.test(q) && /اسبوع/.test(q))
    return { tool: "compare_weeks" };
  if (/مورد|موردين|للتجار|عليا\s*كام|انا مديون/.test(q))
    return { tool: "getSuppliersPayablesSummary" };
  if (
    /(عميل|عملا|زبون|زباين|الناس).*(عليه|عليهم|فلوس|مديون|دين)|مين.*عليه|ليا\s*كام|ليا\s*فلوس|الديون|ديوني/.test(
      q,
    )
  ) {
    return { tool: "getCustomersDebtSummary" };
  }
  if (/مصروف|مصاريف|صرفت/.test(q))
    return { tool: "getExpensesSummary", period };
  if (/مشتريات|اشتريت|فواتير الشرا/.test(q))
    return { tool: "getPurchasesSummary", period };
  if (
    /قرب.*تخلص|قرب.*يخلص|قربت|نواقص|ناقص|خلصان|خلصت|محتاج\s*اشتري|محتاجه\s*اشتري|اشتري\s*ايه|اطلب\s*ايه|المخزون/.test(
      q,
    )
  ) {
    return { tool: "getInventoryStatus" };
  }
  if (/(اكتر|اكثر|احسن).*(بيتباع|بتتباع|مبيع|بيع|منتج|صنف|اصناف)/.test(q)) {
    return { tool: "getTopSellingProducts" };
  }
  if (/ربح|مكسب|كسبت|صافي|خسرت|خساره/.test(q))
    return { tool: "getFinancialOverview", period };
  if (/بعت|بيعت|مبيعات|المبيع|البيع|ايراد|دخل|فواتير/.test(q))
    return { tool: "getSalesSummary", period };
  return null;
}

const money = (piasters: number | null | undefined) =>
  `${((piasters ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ج.م`;

const PERIOD_LABEL: Record<ToolPeriod, string> = {
  today: "النهارده",
  yesterday: "امبارح",
  week: "آخر 7 أيام",
  last_week: "الأسبوع اللي قبله",
  this_month: "الشهر ده",
  month: "آخر 30 يوم",
};

function qty(base: number, unit: string): string {
  if (unit === "kg" || unit === "g") {
    return `${(base / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} كجم`;
  }
  return `${base.toLocaleString("en-US")}`;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** Writes the Arabic answer from the tool result(s). Only numbers present in them appear. */
export function formatGroundedAnswer(
  intent: GroundedIntent,
  results: Row[],
): string {
  const r = results[0] ?? {};
  switch (intent.tool) {
    case "getSalesSummary": {
      const label = PERIOD_LABEL[intent.period];
      if (n(r.sales_count) === 0) return `مفيش مبيعات متسجلة ${label}.`;
      const credit = n(r.credit_sales_piasters);
      return [
        `مبيعاتك ${label}: ${money(n(r.sales_total_piasters))} في ${n(r.sales_count)} فاتورة.`,
        `متوسط الفاتورة ${money(n(r.average_invoice_piasters))}.`,
        credit > 0
          ? `منهم ${money(credit)} آجل، والباقي اتدفع على طول.`
          : "كلها اتدفعت على طول (مفيش آجل).",
      ].join("\n");
    }
    case "compare_weeks": {
      const [cur, prev] = [results[0] ?? {}, results[1] ?? {}];
      const a = n(cur.sales_total_piasters);
      const b = n(prev.sales_total_piasters);
      const lines = [
        `آخر 7 أيام: ${money(a)} في ${n(cur.sales_count)} فاتورة.`,
        `الـ 7 أيام اللي قبلهم: ${money(b)} في ${n(prev.sales_count)} فاتورة.`,
      ];
      if (b === 0)
        lines.push(
          a === 0
            ? "مفيش مبيعات في الفترتين."
            : "مفيش مبيعات في الأسبوع اللي قبله عشان نقارن بنسبة.",
        );
      else {
        const pct = Math.round(((a - b) / b) * 100);
        lines.push(
          pct >= 0 ? `يعني زيادة ${pct}% 👍` : `يعني أقل بـ ${Math.abs(pct)}%.`,
        );
      }
      return lines.join("\n");
    }
    case "getTopSellingProducts": {
      const top = (r.top_products as Row[] | undefined) ?? [];
      if (top.length === 0) return "مفيش مبيعات أصناف متسجلة في آخر 30 يوم.";
      return [
        "أكتر الأصناف مبيعاً في آخر 30 يوم (حسب قيمة البيع):",
        ...top.map(
          (t, i) =>
            `${i + 1}. ${String(t.name)} — ${money(n(t.total_piasters))} (الكمية ${qty(n(t.quantity_sold_base), String(t.unit ?? "piece"))})`,
        ),
      ].join("\n");
    }
    case "getInventoryStatus": {
      const items = (r.low_or_out_items as Row[] | undefined) ?? [];
      if (items.length === 0)
        return "مفيش أصناف خلصانة أو قربت تخلص دلوقتي. 👍";
      const out = items.filter((i) => i.status === "out_of_stock");
      const low = items.filter((i) => i.status === "low_stock");
      const lines: string[] = [];
      if (out.length)
        lines.push(
          `خلصانين (${out.length}): ${out
            .slice(0, 10)
            .map((i) => String(i.name))
            .join("، ")}`,
        );
      if (low.length) {
        lines.push(
          `قربوا يخلصوا (${low.length}): ${low
            .slice(0, 10)
            .map(
              (i) =>
                `${String(i.name)} (${qty(n(i.remaining_qty), String(i.unit ?? "piece"))})`,
            )
            .join("، ")}`,
        );
      }
      lines.push("دول اللي محتاج تطلبهم من المورد.");
      return lines.join("\n");
    }
    case "getCustomersDebtSummary": {
      const top = (r.top_debtors as Row[] | undefined) ?? [];
      if (n(r.debtors_count) === 0) return "مفيش زباين عليهم فلوس دلوقتي.";
      return [
        `ليك عند الزباين ${money(n(r.total_owed_to_me_piasters))} (${n(r.debtors_count)} زبون).`,
        `أكتر واحد عليه: ${String(top[0]?.name ?? "")} — ${money(n(top[0]?.debt_piasters))}.`,
        ...top
          .slice(1)
          .map((d) => `• ${String(d.name)} — ${money(n(d.debt_piasters))}`),
      ].join("\n");
    }
    case "getSuppliersPayablesSummary": {
      const top = (r.top_suppliers as Row[] | undefined) ?? [];
      if (n(r.suppliers_owed_count) === 0)
        return "مفيش فلوس عليك للموردين دلوقتي.";
      return [
        `عليك للموردين ${money(n(r.total_i_owe_piasters))} (${n(r.suppliers_owed_count)} مورد).`,
        ...top.map(
          (s) => `• ${String(s.name)} — ${money(n(s.payable_piasters))}`,
        ),
      ].join("\n");
    }
    case "getExpensesSummary": {
      const label = PERIOD_LABEL[intent.period];
      if (n(r.expenses_count) === 0) return `مفيش مصروفات متسجلة ${label}.`;
      const cats = Object.entries(
        (r.by_category as Record<string, number> | undefined) ?? {},
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      return [
        `مصروفاتك ${label}: ${money(n(r.expenses_total_piasters))} (${n(r.expenses_count)} مصروف).`,
        ...cats.map(([c, v]) => `• ${c} — ${money(v)}`),
      ].join("\n");
    }
    case "getPurchasesSummary": {
      const label = PERIOD_LABEL[intent.period];
      if (n(r.purchases_count) === 0)
        return `مفيش فواتير شراء متسجلة ${label}.`;
      return `مشترياتك ${label}: ${money(n(r.purchases_total_piasters))} في ${n(r.purchases_count)} فاتورة.`;
    }
    case "getFinancialOverview": {
      const label = PERIOD_LABEL[intent.period];
      if (n(r.sales_count) === 0 && n(r.expenses_total_piasters) === 0) {
        return `مفيش مبيعات ولا مصروفات متسجلة ${label}.`;
      }
      const lines = [
        `${label}: مبيعات ${money(n(r.sales_total_piasters))}، مصروفات ${money(n(r.expenses_total_piasters))}.`,
      ];
      if (
        r.gross_profit_piasters === null ||
        r.gross_profit_piasters === undefined
      ) {
        lines.push(
          `مقدرش أحسب الربح بدقة: تكلفة شراء ${n(r.sales_without_recorded_cost)} بيعة مش متسجلة. سجّل سعر الشراء مع البضاعة عشان الربح يبان.`,
        );
      } else {
        lines.push(
          `مجمل الربح ${money(n(r.gross_profit_piasters))}، وصافي الربح بعد المصروفات ${money(n(r.net_profit_piasters))}.`,
        );
      }
      return lines.join("\n");
    }
  }
}

/** The answer for a question this mode cannot place (no credit is used for it). */
export const GROUNDED_UNSUPPORTED_ANSWER = [
  "السؤال ده مقدرش أجاوبه هنا بدقة من بيانات محلك.",
  "جرّب سؤال من دول:",
  ...SUGGESTED_QUESTIONS.map((s) => `• ${s}`),
].join("\n");
