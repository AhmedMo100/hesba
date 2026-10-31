import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth/session.service";
import { POST as postChatRoute } from "@/app/api/ai/chat/route";
import { GET as getQuotaRoute } from "@/app/api/ai/quota/route";
import { GET as getConversationsRoute } from "@/app/api/ai/conversations/route";
import { GET as getConversationDetailsRoute } from "@/app/api/ai/conversations/[id]/route";
import { POST as postCronCleanupRoute } from "@/app/api/cron/ai-cleanup/route";
import { AIQuotaService } from "@/server/modules/ai/quota.service";
import { getCairoMidnightDate } from "@/server/modules/ai/cairo-date";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("AI Assistant Backend Integration Tests (Quota, Tenancy, Retention, API)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: { name: string; shopType: string; governorate: string },
  ) {
    return await withTenant(
      id,
      creatorId,
      async (tx) => {
        const store = await tx.store.create({
          data: {
            id,
            name: data.name,
            shopType: data.shopType,
            governorate: data.governorate,
            createdBy: creatorId,
          },
        });

        await tx.storeMember.create({
          data: {
            storeId: id,
            userId: creatorId,
            role: "owner",
          },
        });

        return store;
      },
      migratorPrisma,
    );
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    appPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    await migratorPrisma.$connect();
    await appPrisma.$connect();

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();

    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `مالك أ للمساعد ${runId}`,
          phone: `+20101${runId}`,
          email: `owner-ai-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `مالك ب للمساعد ${runId}`,
          phone: `+20102${runId}`,
          email: `owner-ai-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    await createStoreWithRLS(storeAId, userAId, {
      name: `محل أ للمساعد ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل ب للمساعد ${runId}`,
      shopType: "supermarket",
      governorate: "Giza",
    });
  });

  afterAll(async () => {
    try {
      await migratorClient`DELETE FROM "ai_messages" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "ai_conversations" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "ai_usage" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "sessions" WHERE user_id IN (${userAId}, ${userBId})`;
      await migratorClient`DELETE FROM "store_members" WHERE store_id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "stores" WHERE id IN (${storeAId}, ${storeBId})`;
      await migratorClient`DELETE FROM "users" WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await migratorClient.end();
      await migratorPrisma.$disconnect();
      await appPrisma.$disconnect();
    }
  });

  let storeAConvId: string;

  it("GET /api/ai/quota returns 5 remaining messages for a new store", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const req = new Request("http://localhost:3000/api/ai/quota", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });

    const res = await getQuotaRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.used).toBe(0);
    expect(json.remaining).toBe(5);
    expect(json.limit).toBe(5);
    expect(json.resets_at).toBeDefined();
    expect(json.day_key).toBeDefined();
  });

  it("POST /api/ai/chat decrements quota on message 1, creates conversation, and supports idempotency", async () => {
    const sessionA = await createSession(userAId, storeAId);
    const clientMsgId = crypto.randomUUID();

    const chatReq = new Request("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        body_text: "كسبت كام النهارده؟",
        client_message_id: clientMsgId,
      }),
    });

    const res = await postChatRoute(chatReq);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.conversation_id).toBeDefined();
    expect(json.message_id).toBeDefined();
    expect(json.body_text).toContain("تقرير النهارده");
    expect(json.quota.used).toBe(1);
    expect(json.quota.remaining).toBe(4);

    storeAConvId = json.conversation_id;

    // Idempotency: Retrying with the same client_message_id should NOT consume extra quota
    const retryReq = new Request("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        body_text: "كسبت كام النهارده؟",
        client_message_id: clientMsgId,
      }),
    });

    const retryRes = await postChatRoute(retryReq);
    expect(retryRes.status).toBe(200);
    const retryJson = await retryRes.json();
    expect(retryJson.body_text).toBe(json.body_text);
    expect(retryJson.quota.used).toBe(1); // Quota still 1, not 2
    expect(retryJson.quota.remaining).toBe(4);
  });

  it("Enforces strict limit: messages 2-5 succeed, 6th message is rejected with 429", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // Send messages 2, 3, 4, 5
    for (let i = 2; i <= 5; i++) {
      const req = new Request("http://localhost:3000/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${sessionA.rawToken}`,
        },
        body: JSON.stringify({
          body_text: `سؤال رقم ${i} بخصوص المخزون`,
        }),
      });

      const res = await postChatRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.quota.used).toBe(i);
      expect(json.quota.remaining).toBe(5 - i);
    }

    // 6th message MUST be rejected before invoking the AI
    const sixthReq = new Request("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        body_text: "سؤال سادس يجب أن يُرفض",
      }),
    });

    const sixthRes = await postChatRoute(sixthReq);
    expect(sixthRes.status).toBe(429);

    const sixthJson = await sixthRes.json();
    expect(sixthJson.error.code).toBe("RATE_LIMITED");
    expect(sixthJson.error.message).toContain("استخدمت 5 من 5 رسائل اليوم");
  });

  it("Multi-Tenant Isolation: Store B has its own independent 5 message quota", async () => {
    const sessionB = await createSession(userBId, storeBId);

    const req = new Request("http://localhost:3000/api/ai/quota", {
      headers: { cookie: `hesba_session=${sessionB.rawToken}` },
    });

    const res = await getQuotaRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    // Store A is exhausted (5/5), but Store B must still have 5 remaining!
    expect(json.used).toBe(0);
    expect(json.remaining).toBe(5);
  });

  it("Cross-Tenant Security: Store B cannot access Store A's conversation", async () => {
    const sessionB = await createSession(userBId, storeBId);

    const req = new Request(
      `http://localhost:3000/api/ai/conversations/${storeAConvId}`,
      {
        headers: { cookie: `hesba_session=${sessionB.rawToken}` },
      },
    );

    const res = await getConversationDetailsRoute(req, {
      params: Promise.resolve({ id: storeAConvId }),
    });

    // Must return 404 Not Found to prevent leaking existence or data across tenants
    expect(res.status).toBe(404);
  });

  it("GET /api/ai/conversations lists only conversations owned by the caller's store", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const req = new Request("http://localhost:3000/api/ai/conversations", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });

    const res = await getConversationsRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.conversations.length).toBeGreaterThanOrEqual(1);
    expect(json.conversations[0].id).toBe(storeAConvId);
  });

  it("Quota Rollback: Restores message credit when provider fails", async () => {
    const quotaService = new AIQuotaService(appPrisma);
    const dayDate = getCairoMidnightDate();

    // Query current usage for Store B (currently 0)
    const beforeStatus = await quotaService.getQuotaStatus(storeBId, dayDate);
    expect(beforeStatus.used).toBe(0);

    // Reserve 1
    const reserved = await quotaService.reserveQuota(storeBId, dayDate);
    expect(reserved.success).toBe(true);

    const midStatus = await quotaService.getQuotaStatus(storeBId, dayDate);
    expect(midStatus.used).toBe(1);

    // Simulate provider failure rollback
    await quotaService.rollbackQuota(storeBId, dayDate);

    const afterStatus = await quotaService.getQuotaStatus(storeBId, dayDate);
    expect(afterStatus.used).toBe(0);
    expect(afterStatus.remaining).toBe(5);
  });

  it("Concurrency: Atomic quota reservation allows exactly 5 successes across parallel requests", async () => {
    const quotaService = new AIQuotaService(appPrisma);
    const concurrentStoreId = crypto.randomUUID();
    const concurrentUserId = crypto.randomUUID();

    await migratorPrisma.user.create({
      data: {
        id: concurrentUserId,
        name: `مالك توازي ${runId}`,
        phone: `+20109${runId}`,
        email: `concurrent-${runId}@hesba.test`,
        passwordHash: "mockhash",
      },
    });

    await createStoreWithRLS(concurrentStoreId, concurrentUserId, {
      name: `محل توازي ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    // Fire 10 concurrent reservation attempts
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        quotaService.reserveQuota(concurrentStoreId, getCairoMidnightDate()),
      ),
    );

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes.length).toBe(5);
    expect(failures.length).toBe(5);

    // Verify usage row in database is exactly 5
    const finalUsage = await quotaService.getQuotaStatus(concurrentStoreId);
    expect(finalUsage.used).toBe(5);
    expect(finalUsage.remaining).toBe(0);

    // Clean up
    await migratorClient`DELETE FROM "ai_usage" WHERE store_id = ${concurrentStoreId}`;
    await migratorClient`DELETE FROM "store_members" WHERE store_id = ${concurrentStoreId}`;
    await migratorClient`DELETE FROM "stores" WHERE id = ${concurrentStoreId}`;
    await migratorClient`DELETE FROM "users" WHERE id = ${concurrentUserId}`;
  });

  it("Retention Cron /api/cron/ai-cleanup deletes conversations older than 7 days, preserves today and ai_usage", async () => {
    const oldDate = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000); // 12 days ago

    // Insert old conversation directly via migrator
    const oldConv = await migratorPrisma.aiConversation.create({
      data: {
        storeId: storeAId,
        day: oldDate,
        title: "محادثة قديمة منتهية الصلاحية",
      },
    });

    await migratorPrisma.aiMessage.create({
      data: {
        storeId: storeAId,
        conversationId: oldConv.id,
        role: "user",
        bodyText: "رسالة قديمة قبل 12 يوم",
      },
    });

    // 1. Without valid cron secret: 401
    const unauthReq = new Request("http://localhost:3000/api/cron/ai-cleanup", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });
    const unauthRes = await postCronCleanupRoute(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. With valid cron secret: 200
    const cronSecret =
      process.env.HESBA_CRON_SECRET || "hesba-test-cron-secret";
    const authReq = new Request("http://localhost:3000/api/cron/ai-cleanup", {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const authRes = await postCronCleanupRoute(authReq);
    expect(authRes.status).toBe(200);

    const cronJson = await authRes.json();
    expect(cronJson.ok).toBe(true);
    expect(cronJson.deleted_count).toBeGreaterThanOrEqual(1);

    // Verify old conversation and its messages are gone
    const checkOld = await migratorPrisma.aiConversation.findUnique({
      where: { id: oldConv.id },
    });
    expect(checkOld).toBeNull();

    // Verify today's conversation is still intact
    const checkToday = await migratorPrisma.aiConversation.findUnique({
      where: { id: storeAConvId },
    });
    expect(checkToday).not.toBeNull();

    // Verify ai_usage is still intact (never deleted by retention cleanup)
    const checkUsage = await migratorPrisma.aiUsage.findUnique({
      where: {
        storeId_day: {
          storeId: storeAId,
          day: getCairoMidnightDate(),
        },
      },
    });
    expect(checkUsage).not.toBeNull();
    expect(checkUsage?.count).toBe(5);
  });
});
