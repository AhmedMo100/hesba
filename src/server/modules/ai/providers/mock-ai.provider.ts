import "server-only";
import { AIProvider } from "./ai-provider.interface";
import {
  ChatMessage,
  ToolDefinition,
  ProviderResponse,
  ToolCall,
} from "../types";

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateChatCompletion(
    messages: ChatMessage[],
    _systemInstruction: string,
    tools?: ToolDefinition[],
  ): Promise<ProviderResponse> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const query = lastUserMessage?.content.trim() || "";

    // Check if the previous message was a tool result
    const lastToolResult = [...messages]
      .reverse()
      .find((m) => m.role === "tool");
    if (lastToolResult) {
      try {
        const parsed = JSON.parse(lastToolResult.content);
        return {
          text: this.formatToolResultToResponse(lastToolResult.name, parsed),
        };
      } catch {
        return {
          text: "البيانات المسجلة في محلك تمام ومحدثة.",
        };
      }
    }

    // Step 1: Detect if a tool should be called
    if (tools && tools.length > 0) {
      const toolCall = this.detectToolCall(query, tools);
      if (toolCall) {
        return {
          text: "",
          toolCalls: [toolCall],
        };
      }
    }

    // Step 2: Direct response fallback
    return {
      text: this.getDirectResponse(query),
    };
  }

  private detectToolCall(
    query: string,
    tools: ToolDefinition[],
  ): ToolCall | null {
    const q = query.toLowerCase();

    // Financial / profit / sales today
    if (
      q.includes("كسبت") ||
      q.includes("مكسب") ||
      q.includes("ربح") ||
      q.includes("مبيعات") ||
      q.includes("ايراد") ||
      q.includes("النهارده")
    ) {
      if (tools.some((t) => t.name === "getFinancialOverview")) {
        return {
          id: `call_${Date.now()}_fin`,
          name: "getFinancialOverview",
          arguments: { period: "today" },
        };
      }
      if (tools.some((t) => t.name === "getSalesSummary")) {
        return {
          id: `call_${Date.now()}_sales`,
          name: "getSalesSummary",
          arguments: { period: "today" },
        };
      }
    }

    // Inventory / low stock / what to buy
    if (
      q.includes("خلص") ||
      q.includes("ناقص") ||
      q.includes("اشتري") ||
      q.includes("نواقص") ||
      q.includes("مخزون")
    ) {
      if (tools.some((t) => t.name === "getInventoryStatus")) {
        return {
          id: `call_${Date.now()}_inv`,
          name: "getInventoryStatus",
          arguments: { filter: "low_or_out" },
        };
      }
    }

    // Top selling product
    if (
      q.includes("أكتر") ||
      q.includes("اكتر") ||
      q.includes("أكثر") ||
      q.includes("بيتباع") ||
      q.includes("رائج")
    ) {
      if (tools.some((t) => t.name === "getTopSellingProducts")) {
        return {
          id: `call_${Date.now()}_top`,
          name: "getTopSellingProducts",
          arguments: { limit: 5 },
        };
      }
    }

    // Market / inflation / dollar / fuel
    if (
      q.includes("دولار") ||
      q.includes("بنزين") ||
      q.includes("سولار") ||
      q.includes("وقود") ||
      q.includes("غلاء") ||
      q.includes("تضخم") ||
      q.includes("أسعار السوق")
    ) {
      if (tools.some((t) => t.name === "searchMarketTrends")) {
        return {
          id: `call_${Date.now()}_search`,
          name: "searchMarketTrends",
          arguments: {
            query: "تأثير أسعار الوقود والدولار على السلع والسلع الغذائية بمصر",
          },
        };
      }
    }

    // Receivables / Customers debt
    if (
      q.includes("دين") ||
      q.includes("ديون") ||
      q.includes("عملاء") ||
      q.includes("ليك")
    ) {
      if (tools.some((t) => t.name === "getCustomersDebtSummary")) {
        return {
          id: `call_${Date.now()}_cust`,
          name: "getCustomersDebtSummary",
          arguments: {},
        };
      }
    }

    // Payables / Suppliers
    if (q.includes("مورد") || q.includes("موردين") || q.includes("عليك")) {
      if (tools.some((t) => t.name === "getSuppliersPayablesSummary")) {
        return {
          id: `call_${Date.now()}_supp`,
          name: "getSuppliersPayablesSummary",
          arguments: {},
        };
      }
    }

    return null;
  }

  private formatToolResultToResponse(
    toolName: string | undefined,
    data: Record<string, unknown>,
  ): string {
    if (toolName === "getFinancialOverview") {
      const sales = (Number(data.sales_total_piasters) || 0) / 100;
      const cogs = (Number(data.cogs_piasters) || 0) / 100;
      const gross = (Number(data.gross_profit_piasters) || 0) / 100;
      const expenses = (Number(data.expenses_total_piasters) || 0) / 100;
      const net = (Number(data.net_profit_piasters) || 0) / 100;
      const count = Number(data.sales_count) || 0;

      return `تقرير النهارده:\n• المبيعات: ${sales.toLocaleString("en-US")} ج.م (${count} بيعة)\n• تكلفة البضاعة: ${cogs.toLocaleString("en-US")} ج.م\n• مجمل الربح: ${gross.toLocaleString("en-US")} ج.م\n• المصروفات: ${expenses.toLocaleString("en-US")} ج.م\n• صافي الربح: ${net.toLocaleString("en-US")} ج.م`;
    }

    if (toolName === "getInventoryStatus") {
      const items =
        (data.low_or_out_items as Array<{
          name: string;
          remaining_qty: number;
          status: string;
        }>) || [];
      if (items.length === 0) {
        return "المخزون عندك تمام، مفيش أصناف ناقصة أو خلصانة حالياً.";
      }
      const lines = items
        .slice(0, 5)
        .map(
          (it) =>
            `• ${it.name}: ${it.status === "out_of_stock" ? "خلصان تماماً" : `فاضل ${it.remaining_qty} قطعة`}`,
        );
      return `الأصناف اللي محتاجة تشتريها:\n${lines.join("\n")}\n\nنصيحة: راجع فواتير الموردين عشان تجيب كميات تناسب سحب الأسبوع.`;
    }

    if (toolName === "getTopSellingProducts") {
      const items =
        (data.top_products as Array<{
          name: string;
          total_piasters: number;
          quantity_sold: number;
        }>) || [];
      if (items.length === 0) {
        return "لسه مفيش مبيعات مسجلة في الفترة دي لتحديد أكتر صنف بيتباع.";
      }
      const lines = items.map(
        (it, idx: number) =>
          `${idx + 1}. ${it.name} — إجمالي ${((it.total_piasters || 0) / 100).toLocaleString("en-US")} ج.م (${it.quantity_sold} قطعة)`,
      );
      return `أكتر 5 أصناف مبيعاً:\n${lines.join("\n")}`;
    }

    if (toolName === "searchMarketTrends") {
      const citations =
        (data.sources as Array<{
          title: string;
          url: string;
        }>) || [];
      const sourcesText =
        citations.length > 0
          ? `\n\nالمصادر:\n` +
            citations.map((c) => `• [${c.title}](${c.url})`).join("\n")
          : "";

      return (
        `تأثير تغيرات السوق والوقود على السوبر ماركت:\n` +
        `• زيادة أسعار الوقود بتأثر بشكل مباشر على تكلفة النقل وسلاسل الإمداد، وده بيظهر في أسعار الجملة للبضائع سريعة الاستهلاك زي الألبان والخضار.\n` +
        `• تغيرات سعر الصرف بتنعكس على السلع المستوردة والزيوت والمعلبات بعد دورة التوريد.\n` +
        `• الصح إنك تراجع أسعار الشراء في كل فاتورة مورد، وتعدل سعر البيع أول بأول للأصناف اللي هامشها قليل.` +
        sourcesText
      );
    }

    return "دي بيانات محلك المسجلة حالياً على حسبة، وكل العمليات محدثة أول بأول.";
  }

  private getDirectResponse(query: string): string {
    const q = query.toLowerCase();
    if (q.includes("شكرا") || q.includes("شكراً")) {
      return "العفو يا غالي، أنا في خدمتك دايماً. اسألني عن أي حاجة تخص محلك.";
    }
    return (
      "أهلاً بيك في مساعد حِسبة! أقدر أساعدك في:\n" +
      "• معرفة أرباح ومبيعات ومصروفات محلك اليوم أو خلال فترة.\n" +
      "• كشف النواقص والمنتجات اللي قربت تخلص.\n" +
      "• متابعة اللي ليك عند الزباين واللي عليك للموردين.\n" +
      "• أخبار السوق وتأثير الأسعار على تجارتك."
    );
  }
}
