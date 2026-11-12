import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { CommunitySuggestionsService } from "@/server/modules/catalog/community-suggestions.service";
import { withTenant } from "@/server/infra/db/tenant";

const directUrl =
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Catalog Community Generalization Lifecycle (ADR-0010)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  const testStoreIds: string[] = [];
  const testUserIds: string[] = [];
  const runId = Math.random().toString(36).slice(2, 8);

  async function createTestStore(
    name: string,
    opts?: { share?: boolean; receive?: boolean },
  ) {
    const userId = crypto.randomUUID();
    const storeId = crypto.randomUUID();
    testUserIds.push(userId);
    testStoreIds.push(storeId);

    await migratorPrisma.user.create({
      data: {
        id: userId,
        name: `User ${name}`,
        phone: `+2011${Math.random().toString().slice(2, 10)}`,
        email: `test-user-${userId.slice(0, 8)}@hesba.test`,
        passwordHash: "test_hash",
      },
    });

    await withTenant(
      storeId,
      userId,
      async (tx) => {
        await tx.store.create({
          data: {
            id: storeId,
            name,
            shopType: "supermarket",
            governorate: "Cairo",
            shareCustomProducts: opts?.share ?? true,
            receiveSuggestions: opts?.receive ?? true,
            createdBy: userId,
          },
        });
        await tx.storeMember.create({
          data: { storeId, userId, role: "owner" },
        });
      },
      migratorPrisma,
    );

    return { userId, storeId };
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    appPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    await migratorPrisma.$connect();
    await appPrisma.$connect();
  });

  afterAll(async () => {
    if (testStoreIds.length > 0) {
      const idsStr = testStoreIds.map((id) => `'${id}'`).join(",");
      await migratorClient.unsafe(`
        ALTER TABLE catalog_notifications DISABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_suggestions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE candidate_adoptions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_reports DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stores DISABLE ROW LEVEL SECURITY;

        DELETE FROM catalog_notifications WHERE store_id IN (${idsStr});
        DELETE FROM catalog_suggestions WHERE store_id IN (${idsStr});
        DELETE FROM candidate_adoptions WHERE store_id IN (${idsStr});
        DELETE FROM catalog_reports WHERE store_id IN (${idsStr});
        DELETE FROM store_variants WHERE store_id IN (${idsStr});
        DELETE FROM store_products WHERE store_id IN (${idsStr});
        DELETE FROM store_members WHERE store_id IN (${idsStr});
        DELETE FROM stores WHERE id IN (${idsStr});

        ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_reports ENABLE ROW LEVEL SECURITY;
        ALTER TABLE candidate_adoptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_suggestions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_notifications ENABLE ROW LEVEL SECURITY;
      `);

      for (const uId of testUserIds) {
        await migratorClient`DELETE FROM users WHERE id = ${uId}`;
      }
    }

    await migratorPrisma.$disconnect();
    await appPrisma.$disconnect();
    await migratorClient.end();
  });

  it("captures eligibleStoresSnapshot and enforces Threshold 1 (>50%) and Threshold 2 (>70% + 7 days)", async () => {
    // Create 4 stores: 3 eligible (share=true, receive=true), 1 ineligible (receive=false)
    const s1 = await createTestStore(`Store 1 ${runId}`, {
      share: true,
      receive: true,
    });
    const s2 = await createTestStore(`Store 2 ${runId}`, {
      share: true,
      receive: true,
    });
    const s3 = await createTestStore(`Store 3 ${runId}`, {
      share: true,
      receive: true,
    });
    await createTestStore(`Store Ineligible ${runId}`, {
      share: true,
      receive: false,
    });

    const communityService = new CommunitySuggestionsService(migratorPrisma);

    // 1. Submit candidate from Store 1 inside tenant context
    const submissionResult = await withTenant(
      s1.storeId,
      s1.userId,
      async (tx) => {
        return communityService.submitCandidate(
          {
            submittingStoreId: s1.storeId,
            nameAr: `عصير مانجو فريش ${runId}`,
            category: "عصائر",
            flavor: "مانجو",
            sizeValue: 1,
            sizeUnit: "l",
            packQty: 1,
          },
          { tx },
        );
      },
      appPrisma,
    );

    const candidateId = submissionResult.candidateId;
    expect(candidateId).toBeDefined();

    // Verify eligibleStoresSnapshot was captured
    const candidate = await migratorPrisma.catalogCandidate.findUnique({
      where: { id: candidateId },
    });
    expect(candidate).not.toBeNull();
    expect(candidate?.eligibleStoresSnapshot).toBeGreaterThanOrEqual(1);

    // Set eligibleStoresSnapshot explicitly to 4 for exact percentage testing
    // and ensure candidate is in published / suggestable state
    const now = new Date();
    await migratorPrisma.catalogCandidate.update({
      where: { id: candidateId },
      data: {
        eligibleStoresSnapshot: 4,
        status: "suggestable",
        publishedAt: now,
      },
    });

    // Currently 1 adoption (submitting store). 1 / 4 = 25% (<= 50%) -> No notification
    let res = await communityService.evaluatePromotion(candidateId);
    expect(res.discoveryNotificationsSent).toBe(false);
    expect(res.promoted).toBe(false);

    // 2. Add second adoption: 2 / 4 = 50% -> Still <= 50% (strictly > 50% required!)
    await withTenant(
      s2.storeId,
      s2.userId,
      async (tx) => {
        return communityService.recordAdoption(candidateId, s2.storeId, { tx });
      },
      appPrisma,
    );
    res = await communityService.evaluatePromotion(candidateId);
    expect(res.discoveryNotificationsSent).toBe(false);
    expect(res.promoted).toBe(false);

    // 3. Add third adoption: 3 / 4 = 75% (> 50% threshold crossed!) -> Must queue discovery notification
    await withTenant(
      s3.storeId,
      s3.userId,
      async (tx) => {
        return communityService.recordAdoption(candidateId, s3.storeId, { tx });
      },
      appPrisma,
    );
    res = await communityService.evaluatePromotion(candidateId);
    expect(res.discoveryNotificationsSent).toBe(true);
    expect(res.promoted).toBe(false); // But not promoted yet because < 7 days!

    // Verify candidate is still suggestable (needs >= 7 days)
    const afterNotice = await migratorPrisma.catalogCandidate.findUnique({
      where: { id: candidateId },
    });
    expect(afterNotice?.status).toBe("suggestable");

    const notifications = await migratorPrisma.catalogNotification.findMany({
      where: { candidateId },
    });
    expect(notifications.length).toBeGreaterThan(0);

    // 4. Fast forward firstSubmittedAt and publishedAt to 8 days ago (>= 7 full days)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await migratorPrisma.catalogCandidate.update({
      where: { id: candidateId },
      data: { firstSubmittedAt: eightDaysAgo, publishedAt: eightDaysAgo },
    });

    // 5. Evaluate promotion again: 3 / 4 = 75% (> 70%) and age >= 7 days -> PROMOTED!
    res = await communityService.evaluatePromotion(candidateId);
    expect(res.promoted).toBe(true);

    const promotedCandidate = await migratorPrisma.catalogCandidate.findUnique({
      where: { id: candidateId },
    });
    expect(promotedCandidate?.status).toBe("approved");
    expect(promotedCandidate?.promotedAt).not.toBeNull();

    // Verify product was inserted into global_products as approved
    const globalProd = await migratorPrisma.globalProduct.findFirst({
      where: { nameAr: `عصير مانجو فريش ${runId}` },
      include: { globalVariants: true },
    });
    expect(globalProd).not.toBeNull();
    expect(globalProd?.status).toBe("approved");
    expect(globalProd?.globalVariants).toHaveLength(1);
    expect(globalProd?.globalVariants[0]?.flavor).toBe("مانجو");

    // Clean up created global product
    if (globalProd) {
      await migratorPrisma.globalVariant.deleteMany({
        where: { globalProductId: globalProd.id },
      });
      await migratorPrisma.globalProduct.delete({
        where: { id: globalProd.id },
      });
    }
    await migratorPrisma.catalogCandidate.delete({
      where: { id: candidateId },
    });
  });
});
