/**
 * Ask Hesba — Prompt 2 behaviour on real Postgres (app role, RLS): private mode never calls an
 * external model and answers from the shop's real data; duplicate / retried messages are stored
 * and counted once; the platform gate refuses before any provider call and gives the credit
 * back; usage events hold no question or answer text; shops stay isolated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import {
  AIService,
  AI_GLOBAL_UNAVAILABLE_MESSAGE,
  invalidateAiSettingsCache,
} from "@/server/modules/ai";
import {
  MockAIProvider,
  providerBusy,
  type AIProvider,
} from "@/server/infra/ai";
import { AppError } from "@/server/platform/error";
import { SaleFixtures } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;

/** An external provider that must never be reached in private mode. */
class TrapProvider implements AIProvider {
  readonly name = "gemini";
  calls = 0;
  async generateChatCompletion(): Promise<never> {
    this.calls += 1;
    throw new Error("shop data must not be sent to this provider");
  }
}

class CountingMock extends MockAIProvider {
  calls = 0;
  override async generateChatCompletion(
    ...args: Parameters<MockAIProvider["generateChatCompletion"]>
  ) {
    this.calls += 1;
    return super.generateChatCompletion(...args);
  }
}

const usedToday = async (shop: typeof A) =>
  (await new AIService(appPrisma).getQuota(shop.storeId)).used;
const userMessages = (shop: typeof A, clientMessageId: string) =>
  f.sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM ai_messages
    WHERE store_id = ${shop.storeId}::uuid AND client_message_id = ${clientMessageId} AND role = 'user'`;

beforeAll(async () => {
  await f.setup();
  const milk = await f.product(A, { name: "لبن", sell: 2500 });
  await f.addStock(A, milk.variantId, 3); // low stock
  await f.request(A, "POST", {
    variantId: milk.variantId,
    quantityBase: 1,
    opId: crypto.randomUUID(),
  });
  await f.product(B, { name: "منتج محل تاني", sell: 9900 });
});

beforeEach(async () => {
  await f.sql`DELETE FROM ai_usage WHERE store_id IN ${f.sql([A.storeId, B.storeId])}`;
  await f.sql`DELETE FROM ai_provider_health`;
  await f.sql`DELETE FROM ai_inflight`;
  await f.sql`DELETE FROM ai_capacity_minutes`;
  await f.sql`UPDATE ai_platform_settings SET assistant_rpm = 10000, assistant_max_concurrent = 100, assistant_enabled = true WHERE id = 1`;
  invalidateAiSettingsCache();
});

afterAll(async () => {
  await f.sql`UPDATE ai_platform_settings SET assistant_rpm = 10, assistant_max_concurrent = 4, assistant_enabled = true WHERE id = 1`;
  invalidateAiSettingsCache();
  await f.teardown();
});

describe("private mode (provider not approved for shop data)", () => {
  it("answers business questions from the shop's own data without calling the provider", async () => {
    const trap = new TrapProvider();
    const ai = new AIService(appPrisma, trap, undefined, {
      dataSharing: "none",
    });
    const sales = await ai.processUserMessage({
      storeId: A.storeId,
      userId: A.userId,
      bodyText: "بعت كام النهارده؟",
    });
    expect(sales.bodyText).toContain("25 ج.م");
    expect(sales.bodyText).toContain("1 فاتورة");
    const low = await ai.processUserMessage({
      storeId: A.storeId,
      userId: A.userId,
      bodyText: "عندي منتجات قربت تخلص؟",
    });
    expect(low.bodyText).toContain(`لبن ${f.runId}`);
    // Shop B's data never appears in shop A's answers.
    expect(low.bodyText).not.toContain("منتج محل تاني");
    expect(trap.calls).toBe(0);
    expect(sales.quota.used).toBe(1);
    expect(low.quota.used).toBe(2);
  });

  it("an empty shop gets an honest 'no data' answer; an unsupported question costs no credit", async () => {
    const ai = new AIService(appPrisma, new TrapProvider(), undefined, {
      dataSharing: "none",
    });
    const empty = await ai.processUserMessage({
      storeId: B.storeId,
      userId: B.userId,
      bodyText: "مصروفاتي الشهر ده كام؟",
    });
    expect(empty.bodyText).toBe("مفيش مصروفات متسجلة الشهر ده.");
    const other = await ai.processUserMessage({
      storeId: B.storeId,
      userId: B.userId,
      bodyText: "اكتبلي قصيدة عن المحل",
    });
    expect(other.bodyText).toContain("مقدرش أجاوبه هنا");
    expect(other.quota.used).toBe(1); // only the expenses question counted
  });
});

describe("duplicates and retries", () => {
  it("the same message sent twice at once is stored and counted once", async () => {
    const ai = new AIService(appPrisma, new CountingMock());
    const id = crypto.randomUUID();
    const results = await Promise.allSettled([
      ai.processUserMessage({
        storeId: A.storeId,
        userId: A.userId,
        bodyText: "كسبت كام النهارده؟",
        clientMessageId: id,
      }),
      ai.processUserMessage({
        storeId: A.storeId,
        userId: A.userId,
        bodyText: "كسبت كام النهارده؟",
        clientMessageId: id,
      }),
    ]);
    // One answers; the other is told it is still being answered (or replays the answer).
    expect(
      results.filter((r) => r.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    expect((await userMessages(A, id))[0]!.n).toBe(1);
    expect(await usedToday(A)).toBe(1);
    const again = await ai.processUserMessage({
      storeId: A.storeId,
      userId: A.userId,
      bodyText: "كسبت كام النهارده؟",
      clientMessageId: id,
    });
    expect(await usedToday(A)).toBe(1);
    expect(again.bodyText.length).toBeGreaterThan(0);
  });

  it("a retry after a provider failure reuses the stored question: one copy, one credit", async () => {
    const id = crypto.randomUUID();
    const failing: AIProvider = {
      name: "mock",
      async generateChatCompletion() {
        throw providerBusy();
      },
    };
    await expect(
      new AIService(appPrisma, failing).processUserMessage({
        storeId: A.storeId,
        userId: A.userId,
        bodyText: "بعت كام؟",
        clientMessageId: id,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await usedToday(A)).toBe(0); // credit given back
    // The question is "in progress" for a short while; age it like a real retry later.
    await f.sql`UPDATE ai_messages SET created_at = now() - interval '2 minutes' WHERE client_message_id = ${id}`;
    const ok = await new AIService(
      appPrisma,
      new CountingMock(),
    ).processUserMessage({
      storeId: A.storeId,
      userId: A.userId,
      bodyText: "بعت كام؟",
      clientMessageId: id,
    });
    expect(ok.quota.used).toBe(1);
    expect((await userMessages(A, id))[0]!.n).toBe(1);
  });
});

describe("platform gate for the assistant", () => {
  it("platform capacity exhausted: the global message, the provider is not called, the credit comes back", async () => {
    await f.sql`UPDATE ai_platform_settings SET assistant_rpm = 0 WHERE id = 1`;
    invalidateAiSettingsCache();
    const mock = new CountingMock();
    const err = await new AIService(appPrisma, mock)
      .processUserMessage({
        storeId: A.storeId,
        userId: A.userId,
        bodyText: "كسبت كام النهارده؟",
      })
      .catch((e: unknown) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
    expect((err as AppError).message).toBe(AI_GLOBAL_UNAVAILABLE_MESSAGE);
    expect(mock.calls).toBe(0);
    expect(await usedToday(A)).toBe(0);
  });

  it("assistant switched off by the admin: refused before the provider, credit back", async () => {
    await f.sql`UPDATE ai_platform_settings SET assistant_enabled = false WHERE id = 1`;
    invalidateAiSettingsCache();
    const mock = new CountingMock();
    await expect(
      new AIService(appPrisma, mock).processUserMessage({
        storeId: A.storeId,
        userId: A.userId,
        bodyText: "كسبت كام؟",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mock.calls).toBe(0);
    expect(await usedToday(A)).toBe(0);
  });

  it("each model round is a usage event with no question or answer text", async () => {
    await new AIService(appPrisma, new CountingMock()).processUserMessage({
      storeId: A.storeId,
      userId: A.userId,
      bodyText: "كسبت كام النهارده يا حسبة؟",
    });
    const rows =
      await f.sql`SELECT * FROM ai_usage_events WHERE store_id = ${A.storeId}::uuid AND feature = 'assistant' ORDER BY created_at DESC LIMIT 3`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ status: "succeeded", provider: "mock" });
    expect(JSON.stringify(rows)).not.toContain("كسبت");
  });
});
