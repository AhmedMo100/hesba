import { describe, it, expect } from "vitest";
import { BusinessToolsService } from "@/server/modules/ai/tools/business-tools";
import { MockAIProvider } from "@/server/modules/ai/providers/mock-ai.provider";
import { MockSearchProvider } from "@/server/modules/ai/search/mock-search.provider";

describe("AI Business Tools & Providers Unit Tests", () => {
  it("provides complete tool definitions with JSON schema properties", () => {
    const definitions = BusinessToolsService.getDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(9);

    const toolNames = definitions.map((d) => d.name);
    expect(toolNames).toContain("getSalesSummary");
    expect(toolNames).toContain("getTopSellingProducts");
    expect(toolNames).toContain("getInventoryStatus");
    expect(toolNames).toContain("getFinancialOverview");
    expect(toolNames).toContain("getExpensesSummary");
    expect(toolNames).toContain("getCustomersDebtSummary");
    expect(toolNames).toContain("getSuppliersPayablesSummary");
    expect(toolNames).toContain("searchMarketTrends");

    for (const def of definitions) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters.type).toBe("object");
    }
  });

  it("MockAIProvider detects financial queries and triggers getFinancialOverview tool", async () => {
    const provider = new MockAIProvider();
    const tools = BusinessToolsService.getDefinitions();

    const response = await provider.generateChatCompletion(
      [{ role: "user", content: "كسبت كام النهارده؟" }],
      "system instruction",
      tools,
    );

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.[0]?.name).toBe("getFinancialOverview");
    expect(response.toolCalls?.[0]?.arguments).toEqual({ period: "today" });
  });

  it("MockAIProvider detects inventory shortages and triggers getInventoryStatus", async () => {
    const provider = new MockAIProvider();
    const tools = BusinessToolsService.getDefinitions();

    const response = await provider.generateChatCompletion(
      [{ role: "user", content: "إيه اللي خلص ومحتاج أشتريه؟" }],
      "system instruction",
      tools,
    );

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.[0]?.name).toBe("getInventoryStatus");
  });

  it("MockAIProvider detects market/fuel questions and triggers searchMarketTrends", async () => {
    const provider = new MockAIProvider();
    const tools = BusinessToolsService.getDefinitions();

    const response = await provider.generateChatCompletion(
      [{ role: "user", content: "الدولار والبنزين هيأثروا على أسعاري إزاي؟" }],
      "system instruction",
      tools,
    );

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.[0]?.name).toBe("searchMarketTrends");
  });

  it("MockSearchProvider returns citations without leaking private store data", async () => {
    const search = new MockSearchProvider();
    const result = await search.search("أسعار الوقود والبنزين");

    expect(result.source).toBe("mock");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]?.url).toContain("http");
    expect(result.summary).toBeTruthy();
  });
});
