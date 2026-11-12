import "server-only";
import { PrismaClient, Prisma } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { getCairoMidnightDate } from "../cairo-date";
import { ToolDefinition } from "../types";

export interface BusinessToolsContext {
  prisma: PrismaClient;
  storeId: string;
  userId: string;
}

export class BusinessToolsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Tool definitions exported for AI Model function calling.
   */
  static getDefinitions(): ToolDefinition[] {
    return [
      {
        name: "getSalesSummary",
        description:
          "يجلب ملخص المبيعات (إجمالي المبيعات، عدد الفواتير، متوسط الفاتورة) لمحلك في فترة محددة.",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description:
                "الفترة الزمنية: 'today' لليوم، 'week' لآخر 7 أيام، 'month' لآخر 30 يوم.",
            },
          },
        },
      },
      {
        name: "getTopSellingProducts",
        description:
          "يجلب أكثر المنتجات مبيعاً في محلك مرتبة حسب إجمالي قيمة المبيعات والكميات المباعة.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "عدد الأصناف المطلوبة (افتراضياً 5 أصناف).",
            },
          },
        },
      },
      {
        name: "getInventoryStatus",
        description:
          "يفحص حالة المخزون ويكشف النواقص (الأصناف المنتهية أو القريبة من النفاد) والأصناف التي تحتاج إعادة شراء.",
        parameters: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description:
                "نوع التصفية: 'low_or_out' للنواقص والمنتهي، 'all' لجميع الأصناف.",
            },
          },
        },
      },
      {
        name: "searchProductDetails",
        description:
          "يبحث عن منتج معين في المحل بالاسم لمعرفة سعره والكمية المتوفرة وهامش ربحه التقريبي.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "اسم المنتج أو جزء منه للبحث عنه.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "getPurchasesSummary",
        description:
          "يجلب ملخص مشتريات البضاعة وفواتير الموردين المسجلة في المحل.",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description: "الفترة: 'today' أو 'week' أو 'month'.",
            },
          },
        },
      },
      {
        name: "getExpensesSummary",
        description:
          "يجلب إجمالي المصروفات التشغيلية (كهرباء، إيجار، مرتبات، صيانة، نقل، أخرى) وتوزيعها حسب البنود.",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description: "الفترة: 'today' أو 'week' أو 'month'.",
            },
          },
        },
      },
      {
        name: "getCustomersDebtSummary",
        description:
          "يجلب إجمالي الديون المستحقة لك عند الزبائن والعملاء (اللي ليك)، وقائمة بأكثر العملاء مديونية.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "getSuppliersPayablesSummary",
        description:
          "يجلب إجمالي المبالغ المستحقة عليك للموردين والتجار (اللي عليك)، والتزامات الفواتير.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "getFinancialOverview",
        description:
          "يقدم تحليلاً مالياً دقيقاً (المبيعات، تكلفة البضاعة المباعة COGS، مجمل الربح، المصروفات، وصافي الربح المحقق).",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              description: "الفترة: 'today' أو 'week' أو 'month'.",
            },
          },
        },
      },
      {
        name: "searchMarketTrends",
        description:
          "يبحث في أسعار السلع الغذائية بسوق الجملة في مصر، وتأثيرات الوقود والدولار وأخبار التموين.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "موضوع البحث العام في السوق (بدون إرسال بيانات المحل الخاصة).",
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  /**
   * Dispatches and executes a tool call securely inside withTenant.
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: BusinessToolsContext,
    searchFn?: (q: string) => Promise<unknown>,
  ): Promise<unknown> {
    const { storeId, userId } = ctx;

    return await withTenant(storeId, userId, async (tx) => {
      switch (name) {
        case "getSalesSummary":
          return await this.getSalesSummary(
            tx,
            storeId,
            (args.period as string) || "today",
          );

        case "getTopSellingProducts":
          return await this.getTopSellingProducts(
            tx,
            storeId,
            typeof args.limit === "number" ? args.limit : 5,
          );

        case "getInventoryStatus":
          return await this.getInventoryStatus(
            tx,
            storeId,
            (args.filter as string) || "low_or_out",
          );

        case "searchProductDetails":
          return await this.searchProductDetails(
            tx,
            storeId,
            String(args.query || ""),
          );

        case "getPurchasesSummary":
          return await this.getPurchasesSummary(
            tx,
            storeId,
            (args.period as string) || "month",
          );

        case "getExpensesSummary":
          return await this.getExpensesSummary(
            tx,
            storeId,
            (args.period as string) || "today",
          );

        case "getCustomersDebtSummary":
          return await this.getCustomersDebtSummary(tx, storeId);

        case "getSuppliersPayablesSummary":
          return await this.getSuppliersPayablesSummary(tx, storeId);

        case "getFinancialOverview":
          return await this.getFinancialOverview(
            tx,
            storeId,
            (args.period as string) || "today",
          );

        case "searchMarketTrends":
          if (searchFn) {
            return await searchFn(String(args.query || ""));
          }
          return { error: "External search not available" };

        default:
          return { error: `Tool ${name} is not recognized` };
      }
    });
  }

  private getDateRange(period: string): { start: Date; end: Date } {
    const now = new Date();
    const todayMidnight = getCairoMidnightDate(now);

    if (period === "today") {
      return { start: todayMidnight, end: now };
    }
    if (period === "week") {
      const start = new Date(todayMidnight.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    // month (last 30 days)
    const start = new Date(todayMidnight.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  private async getSalesSummary(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: string,
  ) {
    const { start, end } = this.getDateRange(period);

    const sales = await tx.sale.findMany({
      where: {
        storeId,
        createdAt: { gte: start, lte: end },
      },
      select: {
        totalPiasters: true,
        paymentMethod: true,
      },
    });

    const count = sales.length;
    let totalPiasters = BigInt(0);
    let cashPiasters = BigInt(0);
    let creditPiasters = BigInt(0);

    for (const s of sales) {
      totalPiasters += s.totalPiasters;
      if (s.paymentMethod === "cash") {
        cashPiasters += s.totalPiasters;
      } else {
        creditPiasters += s.totalPiasters;
      }
    }

    const avgPiasters = count > 0 ? Number(totalPiasters / BigInt(count)) : 0;

    return {
      period,
      sales_count: count,
      sales_total_piasters: Number(totalPiasters),
      cash_sales_piasters: Number(cashPiasters),
      credit_sales_piasters: Number(creditPiasters),
      average_invoice_piasters: avgPiasters,
    };
  }

  private async getTopSellingProducts(
    tx: Prisma.TransactionClient,
    storeId: string,
    limit: number,
  ) {
    const { start, end } = this.getDateRange("month");

    const lines = await tx.saleLine.findMany({
      where: {
        storeId,
        createdAt: { gte: start, lte: end },
      },
      include: {
        storeProduct: { select: { nameAr: true } },
      },
    });

    const aggregates = new Map<
      string,
      { name: string; totalPiasters: bigint; qty: number }
    >();

    for (const l of lines) {
      const key = l.storeProductId || l.id;
      const name = l.storeProduct?.nameAr || "صنف بدون اسم";
      const existing = aggregates.get(key) || {
        name,
        totalPiasters: BigInt(0),
        qty: 0,
      };
      existing.totalPiasters += l.totalPiasters;
      existing.qty += l.quantityBaseUnits;
      aggregates.set(key, existing);
    }

    const sorted = Array.from(aggregates.values())
      .sort((a, b) => Number(b.totalPiasters - a.totalPiasters))
      .slice(0, limit)
      .map((it) => ({
        name: it.name,
        total_piasters: Number(it.totalPiasters),
        quantity_sold: it.qty,
      }));

    return {
      top_products: sorted,
    };
  }

  private async getInventoryStatus(
    tx: Prisma.TransactionClient,
    storeId: string,
    filter: string,
  ) {
    const products = await tx.storeProduct.findMany({
      where: { storeId, isActive: true },
      include: {
        storeVariants: true,
      },
      take: 100,
    });

    const variantIds = products.flatMap((p) =>
      p.storeVariants.map((v) => v.id),
    );

    // Get stock levels
    const levels = await tx.stockLevel.findMany({
      where: {
        storeId,
        storeVariantId: { in: variantIds },
      },
    });

    const levelMap = new Map(
      levels.map((l) => [l.storeVariantId, Number(l.quantityBase)]),
    );

    const results: Array<{
      name: string;
      remaining_qty: number;
      status: "out_of_stock" | "low_stock" | "available";
    }> = [];

    for (const p of products) {
      const name = p.nameAr || "صنف بدون اسم";
      let totalQty = 0;
      for (const v of p.storeVariants) {
        totalQty += levelMap.get(v.id) || 0;
      }

      const status =
        totalQty <= 0
          ? "out_of_stock"
          : totalQty <= 5
            ? "low_stock"
            : "available";

      if (filter === "low_or_out") {
        if (status === "out_of_stock" || status === "low_stock") {
          results.push({ name, remaining_qty: totalQty, status });
        }
      } else {
        results.push({ name, remaining_qty: totalQty, status });
      }
    }

    return {
      low_or_out_items: results,
      total_checked_products: products.length,
    };
  }

  private async searchProductDetails(
    tx: Prisma.TransactionClient,
    storeId: string,
    query: string,
  ) {
    const trimmed = query.trim();
    if (!trimmed) {
      return { products: [] };
    }

    const products = await tx.storeProduct.findMany({
      where: {
        storeId,
        isActive: true,
        OR: [
          { nameAr: { contains: trimmed, mode: "insensitive" } },
          { nameNorm: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      include: {
        storeVariants: true,
      },
      take: 5,
    });

    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.nameAr,
        category: p.category,
        unit: p.unit,
        sell_price_piasters: Number(p.sellPricePiasters),
      })),
    };
  }

  private async getPurchasesSummary(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: string,
  ) {
    const { start, end } = this.getDateRange(period);

    const purchases = await tx.purchase.findMany({
      where: {
        storeId,
        createdAt: { gte: start, lte: end },
      },
      include: {
        supplier: { select: { nameAr: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    let totalPiasters = BigInt(0);
    for (const p of purchases) {
      totalPiasters += p.totalPiasters;
    }

    return {
      period,
      purchases_count: purchases.length,
      purchases_total_piasters: Number(totalPiasters),
      recent_purchases: purchases.map((p) => ({
        id: p.id,
        supplier: p.supplier?.nameAr || "مورد عام",
        total_piasters: Number(p.totalPiasters),
        date: p.createdAt.toISOString(),
      })),
    };
  }

  private async getExpensesSummary(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: string,
  ) {
    const { start, end } = this.getDateRange(period);

    const expenses = await tx.expense.findMany({
      where: {
        storeId,
        deletedAt: null,
        spentAt: { gte: start, lte: end },
      },
    });

    let totalPiasters = BigInt(0);
    const byCategory: Record<string, number> = {};

    for (const e of expenses) {
      totalPiasters += e.amountPiasters;
      byCategory[e.category] =
        (byCategory[e.category] || 0) + Number(e.amountPiasters);
    }

    return {
      period,
      expenses_count: expenses.length,
      expenses_total_piasters: Number(totalPiasters),
      by_category: byCategory,
    };
  }

  private async getCustomersDebtSummary(
    tx: Prisma.TransactionClient,
    storeId: string,
  ) {
    const customers = await tx.customer.findMany({
      where: { storeId, deletedAt: null },
      include: {
        debtEntries: true,
      },
      take: 50,
    });

    let totalDebtPiasters = 0;
    const debtorList: Array<{ name: string; debt_piasters: number }> = [];

    for (const c of customers) {
      let balance = 0;
      for (const d of c.debtEntries) {
        if (d.direction === "owed_to_me") {
          balance += Number(d.amountPiasters);
        } else {
          balance -= Number(d.amountPiasters);
        }
      }
      if (balance > 0) {
        totalDebtPiasters += balance;
        debtorList.push({ name: c.nameAr, debt_piasters: balance });
      }
    }

    debtorList.sort((a, b) => b.debt_piasters - a.debt_piasters);

    return {
      total_owed_to_me_piasters: totalDebtPiasters,
      debtors_count: debtorList.length,
      top_debtors: debtorList.slice(0, 5),
    };
  }

  private async getSuppliersPayablesSummary(
    tx: Prisma.TransactionClient,
    storeId: string,
  ) {
    const suppliers = await tx.supplier.findMany({
      where: { storeId, deletedAt: null },
      include: {
        debtEntries: true,
      },
      take: 50,
    });

    let totalPayablesPiasters = 0;
    const supplierList: Array<{ name: string; payable_piasters: number }> = [];

    for (const s of suppliers) {
      let balance = 0;
      for (const d of s.debtEntries) {
        if (d.direction === "i_owe") {
          balance += Number(d.amountPiasters);
        } else {
          balance -= Number(d.amountPiasters);
        }
      }
      if (balance > 0) {
        totalPayablesPiasters += balance;
        supplierList.push({ name: s.nameAr, payable_piasters: balance });
      }
    }

    supplierList.sort((a, b) => b.payable_piasters - a.payable_piasters);

    return {
      total_i_owe_piasters: totalPayablesPiasters,
      suppliers_owed_count: supplierList.length,
      top_suppliers: supplierList.slice(0, 5),
    };
  }

  private async getFinancialOverview(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: string,
  ) {
    const { start, end } = this.getDateRange(period);

    // 1. Sales
    const sales = await tx.sale.findMany({
      where: { storeId, createdAt: { gte: start, lte: end } },
      select: { totalPiasters: true },
    });

    let salesTotalPiasters = BigInt(0);
    for (const s of sales) {
      salesTotalPiasters += s.totalPiasters;
    }

    // 2. Cost of goods sold (COGS) from stock movements or purchase line costs
    const movements = await tx.stockMovement.findMany({
      where: {
        storeId,
        type: "sale",
        createdAt: { gte: start, lte: end },
      },
      select: {
        quantityBase: true,
        costPriceMinor: true,
      },
    });

    let cogsPiasters = BigInt(0);
    for (const m of movements) {
      if (m.costPriceMinor && m.quantityBase) {
        cogsPiasters += m.quantityBase * m.costPriceMinor;
      }
    }

    // 3. Expenses
    const expenses = await tx.expense.findMany({
      where: { storeId, deletedAt: null, spentAt: { gte: start, lte: end } },
      select: { amountPiasters: true },
    });

    let expensesTotalPiasters = BigInt(0);
    for (const e of expenses) {
      expensesTotalPiasters += e.amountPiasters;
    }

    const grossProfitPiasters = salesTotalPiasters - cogsPiasters;
    const netProfitPiasters = grossProfitPiasters - expensesTotalPiasters;

    return {
      period,
      sales_count: sales.length,
      sales_total_piasters: Number(salesTotalPiasters),
      cogs_piasters: Number(cogsPiasters),
      gross_profit_piasters: Number(grossProfitPiasters),
      expenses_total_piasters: Number(expensesTotalPiasters),
      net_profit_piasters: Number(netProfitPiasters),
      note: "صافي الربح = مجمل الربح (المبيعات - تكلفة البضاعة) ناقص المصروفات التشغيلية.",
    };
  }
}
