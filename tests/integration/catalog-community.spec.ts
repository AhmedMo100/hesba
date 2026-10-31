import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import {
  CatalogService,
  CommunitySuggestionsService,
  ONE_DAY_MS,
} from "@/server/modules/catalog";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Catalog Foundation, Custom Products & Community Suggestions (Phase 3.1 Integration)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let storeCId: string;
  let userAId: string;
  let userBId: string;
  let runId: string;

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: {
      name: string;
      shopType: string;
      governorate: string;
      shareCustomProducts?: boolean;
      receiveSuggestions?: boolean;
    },
  ) {
    return await withTenant(
      id,
      creatorId,
      async (tx) => {
        return await tx.store.create({
          data: {
            id,
            name: data.name,
            shopType: data.shopType,
            governorate: data.governorate,
            shareCustomProducts: data.shareCustomProducts ?? true,
            receiveSuggestions: data.receiveSuggestions ?? true,
            createdBy: creatorId,
          },
        });
      },
      migratorPrisma,
    );
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    appPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    runId = Math.random().toString(36).substring(2, 8);
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();
    storeCId = crypto.randomUUID();

    // Clean residual test candidates
    await migratorClient.unsafe(`
      DELETE FROM catalog_notifications;
      DELETE FROM catalog_suggestions;
      DELETE FROM candidate_adoptions;
      DELETE FROM catalog_reports;
      DELETE FROM catalog_candidates;
    `);

    // Create test users and stores
    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: "Owner A",
          phone: `+20108${runId}`,
          email: `owner-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: "Owner B",
          phone: `+20109${runId}`,
          email: `owner-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    await createStoreWithRLS(storeAId, userAId, {
      name: "سوبر ماركت الأمل A",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
      shareCustomProducts: true,
      receiveSuggestions: true,
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: "سوبر ماركت النور B",
      shopType: "سوبر ماركت",
      governorate: "الجيزة",
      shareCustomProducts: true,
      receiveSuggestions: true,
    });

    await createStoreWithRLS(storeCId, userAId, {
      name: "بقالة السلام C",
      shopType: "بقالة",
      governorate: "الإسكندرية",
      shareCustomProducts: false, // Opted out of sharing
      receiveSuggestions: true,
    });
  });

  afterAll(async () => {
    await migratorClient.unsafe(`
      DELETE FROM catalog_notifications WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM catalog_suggestions WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM candidate_adoptions WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM catalog_reports WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM store_variants WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM store_products WHERE store_id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM stores WHERE id IN ('${storeAId}', '${storeBId}', '${storeCId}');
      DELETE FROM users WHERE id IN ('${userAId}', '${userBId}');
    `);

    await migratorPrisma.$disconnect();
    await appPrisma.$disconnect();
    await migratorClient.end();
  });

  describe("1. Custom Product Addition & Tenant Isolation", () => {
    it("adds a custom product for Store A without exposing it to Store B", async () => {
      const catalogService = new CatalogService(migratorPrisma);

      const customProdName = `جبنة قريش فلاحي خاصة ${runId}`;
      const resultA = await catalogService.addStoreProduct({
        storeId: storeAId,
        userId: userAId,
        nameAr: customProdName,
        category: "الألبان والجبن والزبادي",
        unit: "kg",
        sellPricePiasters: BigInt(7500), // 75.00 EGP
        flavor: "سادة بدون ملح",
        sizeValue: 1,
        sizeUnit: "kg",
      });

      expect(resultA.isCustom).toBe(true);
      expect(resultA.globalProductId).toBeNull();
      expect(resultA.suggestedToCommunity).toBe(true);
      expect(resultA.candidateId).toBeDefined();

      // Store A reads its product under RLS
      const storeAProducts = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx.storeProduct.findMany({
            where: { id: resultA.storeProductId },
          });
        },
        appPrisma,
      );
      expect(storeAProducts).toHaveLength(1);
      expect(storeAProducts[0]!.nameAr).toBe(customProdName);

      // Store B under RLS CANNOT see Store A's private product
      const storeBProducts = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx.storeProduct.findMany({
            where: { id: resultA.storeProductId },
          });
        },
        appPrisma,
      );
      expect(storeBProducts).toHaveLength(0);

      // Store B CANNOT update Store A's product
      const updateAttempt = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx.storeProduct.updateMany({
            where: { id: resultA.storeProductId },
            data: { sellPricePiasters: BigInt(1000) },
          });
        },
        appPrisma,
      );
      expect(updateAttempt.count).toBe(0);
    });

    it("respects store opt-out preference: custom product is not suggested if shareCustomProducts is false", async () => {
      const catalogService = new CatalogService(migratorPrisma);

      const optOutProdName = `خلطة بهارات سرية خاصة ${runId}`;
      const resultC = await catalogService.addStoreProduct({
        storeId: storeCId,
        userId: userAId,
        nameAr: optOutProdName,
        category: "الصلصات والكاتشب والتوابل",
        unit: "piece",
        sellPricePiasters: BigInt(2500),
      });

      expect(resultC.isCustom).toBe(true);
      expect(resultC.suggestedToCommunity).toBe(false);
      expect(resultC.candidateId).toBeNull();
    });
  });

  describe("2. Community Candidate Deduplication & Single Vote Enforcement", () => {
    it("deduplicates identical submissions: Store B adding same product adopts candidate instead of creating duplicate", async () => {
      const communityService = new CommunitySuggestionsService(migratorPrisma);

      const uniqueProductName = `عسل سدر جبلي مصري ${runId}`;
      // Store A submits
      const subA = await communityService.submitCandidate({
        submittingStoreId: storeAId,
        nameAr: uniqueProductName,
        brandName: "نحل الوادي",
        category: "الدقيق والسكر والملح",
        sizeValue: 500,
        sizeUnit: "g",
      });

      expect(subA.isNewCandidate).toBe(true);
      expect(subA.acceptsCount).toBe(1);

      // Store B submits the exact same product (with different spelling / Arabic normalization)
      const subB = await communityService.submitCandidate({
        submittingStoreId: storeBId,
        nameAr: `عسل سدر جبلى مصرى ${runId}`,
        brandName: "نحل الوادي",
        category: "الدقيق والسكر والملح",
        sizeValue: 0.5,
        sizeUnit: "كجم", // 0.5 kg == 500 g
      });

      expect(subB.isNewCandidate).toBe(false);
      expect(subB.isDuplicateMerged).toBe(true);
      expect(subB.candidateId).toBe(subA.candidateId);
      expect(subB.acceptsCount).toBe(2);

      // Store B submits AGAIN (retry) -> Idempotency check: Vote must NOT increase!
      const subBRetry = await communityService.submitCandidate({
        submittingStoreId: storeBId,
        nameAr: uniqueProductName,
        brandName: "نحل الوادي",
        category: "الدقيق والسكر والملح",
        sizeValue: 500,
        sizeUnit: "g",
      });

      expect(subBRetry.isNewCandidate).toBe(false);
      expect(subBRetry.acceptsCount).toBe(2); // Still 2, not 3!

      // Total distinct candidates in DB for this name is strictly 1
      const countCandidates = await migratorPrisma.catalogCandidate.count({
        where: { id: subA.candidateId },
      });
      expect(countCandidates).toBe(1);
    });

    it("queues ambiguous potential match for review instead of auto-merging", async () => {
      const communityService = new CommunitySuggestionsService(migratorPrisma);

      const baseName = `بسكويت بالتمر والسمسم ${runId}`;
      const sub1 = await communityService.submitCandidate({
        submittingStoreId: storeAId,
        nameAr: baseName,
        category: "البسكويت والويفر والكيك والشوكولاتة",
      });
      expect(sub1.status).toBe("suggestable");

      // Second submission has high similarity but different packaging words
      const sub2 = await communityService.submitCandidate({
        submittingStoreId: storeBId,
        nameAr: `بسكويت بالتمر والسمسم الفاخر اللذيذ ${runId}`,
        category: "البسكويت والويفر والكيك والشوكولاتة",
      });

      expect(sub2.isNewCandidate).toBe(true);
      expect(sub2.requiresReview).toBe(true);
      expect(sub2.status).toBe("pending");
    });
  });

  describe("3. Auto-Promotion Rule: 7 Full Days AND 10 Distinct Shops", () => {
    it("strictly enforces BOTH conditions (fails with 10 shops at 5 days; fails with 9 shops at 8 days; succeeds with 10 shops at 8 days)", async () => {
      const communityService = new CommunitySuggestionsService(migratorPrisma);

      const baseTime = new Date("2026-10-01T10:00:00Z");
      const testCandidateName = `مشروب خروب مركز طبيعي ${runId}`;

      // 1. Initial submission at Day 0 by Store A
      const initial = await communityService.submitCandidate(
        {
          submittingStoreId: storeAId,
          nameAr: testCandidateName,
          category: "العصائر والمياه والمشروبات الغازية",
          sizeValue: 1,
          sizeUnit: "l",
        },
        { now: baseTime },
      );
      const candidateId = initial.candidateId;

      // Create 9 additional test shops to simulate community adoptions
      const additionalStoreIds: string[] = [];
      for (let i = 1; i <= 9; i++) {
        const id = crypto.randomUUID();
        additionalStoreIds.push(id);
        await createStoreWithRLS(id, userAId, {
          name: `محل فرعي داعم ${i} - ${runId}`,
          shopType: "سوبر ماركت",
          governorate: "القاهرة",
        });
      }

      // Adoptions by shops 1 through 8 (Total adopting shops = 1 + 8 = 9 shops)
      for (let i = 0; i < 8; i++) {
        await communityService.recordAdoption(
          candidateId,
          additionalStoreIds[i]!,
          {
            now: baseTime,
          },
        );
      }

      // TEST CASE A: 8 days elapsed (exceeds 7 days), BUT only 9 shops adopted (< 10)
      const day8Time = new Date(baseTime.getTime() + 8 * ONE_DAY_MS);
      const eval9Shops = await communityService.evaluatePromotion(candidateId, {
        now: day8Time,
      });
      expect(eval9Shops.promoted).toBe(false);
      expect(eval9Shops.metrics.uniqueAdoptions).toBe(9);
      expect(eval9Shops.reason).toContain(
        "Minimum of 10 distinct shops required",
      );

      // Shop 9 adopts -> Now we have 10 DISTINCT shops!
      await communityService.recordAdoption(
        candidateId,
        additionalStoreIds[8]!,
        {
          now: baseTime,
        },
      );

      // TEST CASE B: 10 shops adopted, BUT only 5 days have elapsed (< 7 full days)
      const day5Time = new Date(baseTime.getTime() + 5 * ONE_DAY_MS);
      const evalDay5 = await communityService.evaluatePromotion(candidateId, {
        now: day5Time,
      });
      expect(evalDay5.promoted).toBe(false);
      expect(evalDay5.metrics.ageDays).toBeLessThan(7);
      expect(evalDay5.reason).toContain(
        "Waiting period of 7 full days not completed",
      );

      // TEST CASE C: Exactly 7.5 days elapsed AND 10 distinct shops adopted -> MUST PROMOTE!
      const day7HalfTime = new Date(baseTime.getTime() + 7.5 * ONE_DAY_MS);
      const evalSuccess = await communityService.evaluatePromotion(
        candidateId,
        {
          now: day7HalfTime,
        },
      );

      expect(evalSuccess.promoted).toBe(true);
      expect(evalSuccess.globalProductId).toBeDefined();
      expect(evalSuccess.globalVariantId).toBeDefined();

      // Verify Candidate is marked approved and merged
      const promotedCandidate =
        await migratorPrisma.catalogCandidate.findUnique({
          where: { id: candidateId },
        });
      expect(promotedCandidate?.status).toBe("approved");
      expect(promotedCandidate?.mergedIntoId).toBe(evalSuccess.globalProductId);

      // Verify Global Product was created
      const globalProd = await migratorPrisma.globalProduct.findUnique({
        where: { id: evalSuccess.globalProductId },
        include: { globalVariants: true },
      });
      expect(globalProd).toBeDefined();
      expect(globalProd?.nameAr).toBe(testCandidateName);
      expect(globalProd?.globalVariants).toHaveLength(1);

      // Verify single in-app notification delivered to adopting store
      const notification = await migratorPrisma.catalogNotification.findFirst({
        where: { candidateId, storeId: storeAId },
      });
      expect(notification).toBeDefined();
      expect(notification?.title).toContain("تم اعتماد منتجك");

      // Clean up the 9 test shops
      await migratorClient.unsafe(`
        DELETE FROM catalog_notifications WHERE store_id IN (${additionalStoreIds.map((id) => `'${id}'`).join(",")});
        DELETE FROM candidate_adoptions WHERE store_id IN (${additionalStoreIds.map((id) => `'${id}'`).join(",")});
        DELETE FROM stores WHERE id IN (${additionalStoreIds.map((id) => `'${id}'`).join(",")});
        DELETE FROM global_variants WHERE id = '${evalSuccess.globalVariantId}';
        DELETE FROM global_products WHERE id = '${evalSuccess.globalProductId}';
      `);
    });
  });

  describe("4. Objectionable Content Reporting & Auto-Quarantine", () => {
    it("increments report counter and hides candidate when report threshold is reached", async () => {
      const communityService = new CommunitySuggestionsService(migratorPrisma);

      const badProduct = await communityService.submitCandidate({
        submittingStoreId: storeAId,
        nameAr: `منتج مشبوه تجريبي ${runId}`,
        category: "المنظفات ومساحيق الغسيل وسوائل الأطباق",
      });

      // Report 4 times from different stores -> candidate still suggestable
      for (let i = 1; i <= 4; i++) {
        const dummyStoreId = crypto.randomUUID();
        await createStoreWithRLS(dummyStoreId, userAId, {
          name: `مبلغ ${i}`,
          shopType: "بقالة",
          governorate: "القاهرة",
        });

        const res = await communityService.reportCandidate(
          badProduct.candidateId,
          dummyStoreId,
          "محتوى غير لائق",
        );
        expect(res.hidden).toBe(false);

        await migratorClient.unsafe(`
          DELETE FROM catalog_reports WHERE store_id = '${dummyStoreId}';
          DELETE FROM stores WHERE id = '${dummyStoreId}';
        `);
      }

      // 5th report reaches MAX_REPORTS_THRESHOLD (5) -> Candidate must be automatically hidden!
      const fifthStoreId = crypto.randomUUID();
      await createStoreWithRLS(fifthStoreId, userAId, {
        name: "مبلغ 5",
        shopType: "بقالة",
        governorate: "القاهرة",
      });

      const fifthRes = await communityService.reportCandidate(
        badProduct.candidateId,
        fifthStoreId,
        "محتوى مخالف",
      );
      expect(fifthRes.hidden).toBe(true);

      const candidateState = await migratorPrisma.catalogCandidate.findUnique({
        where: { id: badProduct.candidateId },
      });
      expect(candidateState?.status).toBe("hidden");

      await migratorClient.unsafe(`
        DELETE FROM catalog_reports WHERE store_id = '${fifthStoreId}';
        DELETE FROM stores WHERE id = '${fifthStoreId}';
      `);
    });
  });
});
