/**
 * ADR-0039 — the card pages, the barcode stocktake, its charts and «اسأل حسبة»'s chart.
 *
 * - The counting rules: a repeated scan adds to the same line (a total is saved, never a second
 *   record); cartons × pack + pieces; weighed goods in grams; the difference.
 * - The charts' data: مظبوط / زيادة / ناقص, the biggest differences, the reasons.
 * - «اسأل حسبة»: «وريني نتيجة الجرد» is its own read-only intent; its chart is kept with the
 *   answer and split back from the citations.
 * - The money effect of a count: only the server's numbers; «اتباع ومتسجلش» is no sale in إدارة
 *   المحل; damage is a loss at cost.
 * - A service is never «خلصان» in the alerts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  cleanBarcode,
  differenceOf,
  modeForScan,
  nextTotal,
  typedBase,
} from "@/client/features/stocktake/stocktake-count.logic";
import { stocktakeChartData } from "@/domain/stocktake-charts";
import {
  detectIntent,
  formatStocktakeResult,
} from "@/server/modules/ai/grounded-answers";
import {
  packSources,
  unpackSources,
  visualFromTool,
} from "@/server/modules/ai/visuals";
import {
  countMoneyEffects,
  type ReportCount,
} from "@/client/features/stocktake/stocktake-report";
import { buildStoreAlerts } from "@/domain/alerts";

const read = (p: string) => readFileSync(p, "utf8");

describe("Counting one product", () => {
  it("a repeated scan adds to what was counted, and saves the total", () => {
    expect(modeForScan(null)).toBe("replace");
    expect(modeForScan(17)).toBe("add");
    expect(nextTotal(17, 3, "add")).toBe(20);
    expect(nextTotal(17, 3, "replace")).toBe(3);
    expect(nextTotal(null, 17, "add")).toBe(17);
    expect(nextTotal(17, null, "add")).toBeNull();
  });
  it("cartons × pack + pieces; weighed goods in grams; Arabic digits", () => {
    expect(typedBase("piece", 12, "5", "2")).toBe(29);
    expect(typedBase("piece", 12, "", "3")).toBe(36);
    expect(typedBase("piece", 1, "١٧", "")).toBe(17);
    expect(typedBase("kg", 1, "2.25", "")).toBe(2250);
    expect(typedBase("piece", 1, "2.5", "")).toBeNull();
    expect(typedBase("piece", 1, "", "")).toBeNull();
  });
  it("the difference is counted − expected", () => {
    expect(differenceOf(17, 20)).toBe(-3);
    expect(differenceOf(22, 20)).toBe(2);
    expect(differenceOf(null, 20)).toBeNull();
    expect(cleanBarcode(" 6221 031490012\n")).toBe("6221031490012");
  });
});

describe("The stocktake's charts", () => {
  const lines = [
    {
      productName: "بيبسي",
      unit: "piece",
      expectedBase: 20,
      countedBase: 17,
      differenceBase: -3,
      reason: "unrecorded_sale" as const,
    },
    {
      productName: "مياه",
      unit: "piece",
      expectedBase: 3,
      countedBase: 2,
      differenceBase: -1,
      reason: "damaged" as const,
    },
    {
      productName: "عصير",
      unit: "piece",
      expectedBase: 0,
      countedBase: 2,
      differenceBase: 2,
      reason: "surplus" as const,
    },
    {
      productName: "سكر",
      unit: "piece",
      expectedBase: 10,
      countedBase: 10,
      differenceBase: 0,
      reason: null,
    },
    {
      productName: "رز",
      unit: "piece",
      expectedBase: 5,
      countedBase: null,
      differenceBase: null,
      reason: null,
    },
  ];
  it("status, biggest differences and reasons — from counted lines only", () => {
    const d = stocktakeChartData(lines);
    expect(d.status).toEqual({ ok: 1, over: 1, short: 2 });
    expect(d.pairs.map((p) => p.name)).toEqual(["عصير", "مياه", "بيبسي"]);
    expect(d.reasons).toEqual([
      { reason: "unrecorded_sale", label: "اتباع ومتسجلش", products: 1 },
      { reason: "damaged", label: "تالف", products: 1 },
    ]);
  });
});

describe("«اسأل حسبة» and the stocktake", () => {
  it("«وريني نتيجة الجرد» is the result (read only); «عايز أعمل جرد» stays the how-to", () => {
    for (const q of ["وريني نتيجة آخر جرد", "ارسملي فروق الجرد", "حلل الجرد"])
      expect(detectIntent(q)).toEqual({ tool: "stocktake_result" });
    expect(detectIntent("عايز أعمل جرد")).toEqual({ tool: "stocktake_help" });
  });
  it("answers only from the tool's numbers; no count → says so", () => {
    expect(formatStocktakeResult({ found: false })).toContain("لسه ما اتأكدش");
    const t = formatStocktakeResult({
      found: true,
      scope: "قسم «مشروبات»",
      counted_products: 3,
      matched_products: 1,
      shortage_products: 1,
      surplus_products: 1,
      top_shortages: [{ name: "مياه", difference: "−1", reason: "تالف" }],
      loss_value_piasters: 450,
      unrecorded_sales_value_piasters: 0,
    });
    expect(t).toContain("اتعدّ 3 صنف");
    expect(t).toContain("مياه: −1 (تالف)");
    expect(t).toContain("4.5");
    expect(t).toContain("مبغيرش الجرد ولا المخزون");
  });
  it("the chart comes from the tool, is kept with the answer and split back", () => {
    const chart = stocktakeChartData([]);
    expect(
      visualFromTool("getSalesSummary", { found: true, chart }),
    ).toBeNull();
    expect(visualFromTool("getStocktakeResult", { found: false })).toBeNull();
    const v = visualFromTool("getStocktakeResult", {
      found: true,
      scope: "كل المحل",
      chart,
    });
    expect(v?.kind).toBe("stocktake");
    const cite = { title: "خبر", url: "https://example.com" };
    const back = unpackSources(packSources([cite], v));
    expect(back.sources).toEqual([cite]);
    expect(back.visual).toEqual(v);
    expect(packSources([], null)).toBeNull();
    expect(unpackSources(null)).toEqual({ sources: undefined, visual: null });
  });
});

describe("A count's money effect", () => {
  const base: ReportCount = {
    id: "c",
    scope: "full",
    category: null,
    status: "confirmed",
    startedAt: "2026-11-26T10:00:00Z",
    confirmedAt: "2026-11-26T11:00:00Z",
    salesMode: "pos",
    totals: {
      lines: 3,
      counted: 3,
      matched: 0,
      discrepancies: 3,
      shortageCostPiasters: 0,
      surplusCostPiasters: 0,
      damagedBase: 1,
      lostBase: 0,
      unrecordedSaleBase: 3,
      unknownBase: 0,
      unrecordedSaleSellPiasters: 4500,
    },
    lines: [
      {
        productName: "أ",
        category: "",
        unit: "piece",
        expectedBase: 3,
        countedBase: 2,
        differenceBase: -1,
        reason: "damaged",
        differenceCostPiasters: 450,
        appliedCostPiasters: 450,
      },
      {
        productName: "ب",
        category: "",
        unit: "piece",
        expectedBase: 3,
        countedBase: 2,
        differenceBase: -1,
        reason: "lost",
        differenceCostPiasters: null,
      },
      {
        productName: "ج",
        category: "",
        unit: "piece",
        expectedBase: 20,
        countedBase: 17,
        differenceBase: -3,
        reason: "unrecorded_sale",
        differenceCostPiasters: 3300,
      },
    ],
  };
  it("pos: the unrecorded sale at the selling price; damage at cost; unknown cost left out", () => {
    expect(countMoneyEffects(base)).toEqual({
      unrecordedSalePiasters: 4500,
      lossPiasters: 450,
      lossUnknownLines: 1,
    });
  });
  it("إدارة المحل: «اتباع ومتسجلش» adds no sale (its money is in the day's totals)", () => {
    expect(
      countMoneyEffects({ ...base, salesMode: "simple" })
        .unrecordedSalePiasters,
    ).toBe(0);
  });
});

describe("Alerts never list a service", () => {
  it("a service with no stock is neither out nor low", () => {
    const row = (unit: string, category: string) => ({
      variantId: `${unit}-${category}`,
      productId: null,
      productName: unit,
      category,
      unitMode: "piece",
      unit,
      packQty: 1,
      sellPricePiasters: 0,
      currentStockBase: 0,
      status: "out",
      batches: [],
    });
    const a = buildStoreAlerts([
      row("service", "خدمات مرافق"),
      row("piece", "بقالة"),
    ]);
    expect(a.outOfStock.map((x) => x.name)).toEqual(["piece"]);
  });
});

describe("The card pages (sources)", () => {
  it("«فلوس حِسبة»: three actions in one row under the title; no «عدّ الدرج», no «حط رصيد»", () => {
    const src = read("src/client/features/money/MoneyView.tsx");
    const row = src.slice(
      src.indexOf('data-testid="money-actions"'),
      src.indexOf("{error && ("),
    );
    for (const label of ["ماكينة / محفظة", "تحويل", "سحبت لنفسي"])
      expect(row).toContain(`<span>${label}</span>`);
    const css = read("src/client/features/money/MoneyView.module.css");
    expect(css).toMatch(/\.actionRow \{[^}]*display: flex;/);
    expect(src).not.toContain("money-drawer-count");
    expect(src).not.toContain("money-topup");
    expect(src).not.toMatch(/>\s*(🧮 )?عدّ الدرج\s*</);
    expect(src).not.toMatch(/>\s*➕ حط رصيد\s*</);
  });
  it("the cards are Home's cards: the same radius, background, no border, shadow, padding, type", () => {
    const home = read("src/client/features/home/HomeView.module.css");
    const cards = read("src/client/shared/styles/Cards.module.css");
    const block = (css: string, sel: string) =>
      css.slice(
        css.indexOf(`${sel} {`),
        css.indexOf("}", css.indexOf(`${sel} {`)),
      );
    const numCard = block(home, ".numCard");
    const card = block(cards, ".card");
    for (const decl of [
      "background: var(--card);",
      "border: 0;",
      "border-radius: 18px;",
      "padding: 14px;",
      "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);",
    ]) {
      expect(numCard).toContain(decl);
      expect(card).toContain(decl);
    }
    expect(block(cards, ".label")).toContain("font-size: 15px;");
    expect(block(cards, ".big")).toContain("font-size: 24px;");
    expect(block(cards, ".big")).toContain("font-weight: 900;");
    // No colour from outside Hesba's palette / Home's accents.
    const hexes = [...cards.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) =>
      m[0].toLowerCase(),
    );
    const allowed = [
      "#1f3326",
      "#e7eee5",
      "#c7d8c4",
      "#4a6548",
      "#f7f4ec",
      "#263b2d",
      "#eee6d2",
      "#3c5a44",
      "#2e4a36",
    ];
    expect(hexes.filter((h) => !allowed.includes(h))).toEqual([]);
    expect(cards).not.toContain("border-inline-start");
  });
  it("every page keeps its original title", () => {
    for (const [file, title] of <Array<[string, string]>>[
      ["src/client/features/money/MoneyView.tsx", "فلوسي فين؟"],
      ["src/client/features/home/ReportsView.tsx", "محلك ماشي إزاي؟"],
      [
        "src/client/features/alerts/AlertsView.tsx",
        "إيه اللي محتاج تاخد بالك منه؟",
      ],
      [
        "src/client/features/products/ProductsView.tsx",
        "إيه اللي عندك في المحل؟",
      ],
      [
        "src/client/features/services/ServicesView.tsx",
        "بتقدّم خدمات إيه وعمولتك كام؟",
      ],
      ["src/client/features/people/PeopleView.tsx", "مين ليك ومين عليك؟"],
      [
        "src/client/features/stocktake/StocktakeView.tsx",
        "عدّ بضاعتك واعرف الناقص",
      ],
      ["src/client/features/stocktake/StocktakeView.tsx", "اختار القسم"],
      ["src/client/features/stocktake/StocktakeView.tsx", "ملخص الجرد"],
      ["src/client/features/stocktake/StocktakeView.tsx", "تقرير الجرد"],
    ])
      expect(read(file)).toContain(title);
  });
  it("every page has its own identity class", () => {
    for (const [file, cls] of <Array<[string, string]>>[
      ["src/client/features/sales/SalesView.tsx", "pageSell"],
      ["src/client/features/home/ReportsView.tsx", "pageReports"],
      ["src/client/features/alerts/AlertsView.tsx", "pageAlerts"],
      ["src/client/features/products/ProductsView.tsx", "pageProducts"],
      ["src/client/features/services/ServicesView.tsx", "pageServices"],
      ["src/client/features/people/PeopleView.tsx", "pagePeople"],
      ["src/client/features/money/MoneyView.tsx", "pageMoney"],
      ["src/client/features/stocktake/StocktakeView.tsx", "pageStocktake"],
    ])
      expect(read(file)).toContain(`c$.${cls}`);
  });
  it("the stocktake's reasons are the four plain ones", () => {
    const src = read("src/client/features/stocktake/StocktakeCounter.tsx");
    const block = src.slice(
      src.indexOf("const SHORTAGE_CHOICES"),
      src.indexOf("const EXPIRED_CHOICE"),
    );
    expect(
      [...block.matchAll(/\["(\w+)", "([^"]+)"\]/g)].map((m) => m[2]),
    ).toEqual(["اتباع ومتسجلش", "تالف", "مفقود", "سبب آخر"]);
    for (const s of [
      "الموجود في حِسبة:",
      "إنت عدّيت",
      "فرق: ",
      "السبب؟",
      "اتعدّ قبل كده",
      "الإجمالي:",
    ])
      expect(src).toContain(s);
  });
});
