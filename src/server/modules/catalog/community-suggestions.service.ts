import "server-only";

/**
 * @file community-suggestions.service.ts
 * @description The community catalog pipeline: stores' custom products become candidates,
 * other stores adopt or report them, and well-adopted candidates are promoted into the global
 * catalog.
 *
 * @responsibility
 * Submit candidates, record one adoption per store, report candidates (auto-hide at the
 * report threshold), and evaluate promotion.
 *
 * @usedBy
 * `catalog.service.ts`, `src/app/api/cron/catalog-promotion/route.ts`.
 *
 * @remarks
 * - The pool is cross-tenant by design, so this service works on the client it is given
 *   (the cron route passes `servicePrisma`, role `hesba_service`, ADR-0024) rather than inside one store's `withTenant`.
 * - Only product identity is shared (name, brand, category, size) — never prices, stock or
 *   the submitting store's identity (AGENTS.md rule 8).
 * - Thresholds (minimum adopting stores, minimum age, report limit) are in `./constants.ts`.
 */

import { type PrismaClient } from "@prisma/client";
import { normalizeArabic } from "@/domain/normalize";
import { matchProducts } from "@/domain/product-matcher";
import {
  MIN_ADOPTING_STORES_FOR_PROMOTION,
  MIN_PROMOTION_AGE_DAYS,
  ONE_DAY_MS,
  MAX_REPORTS_THRESHOLD,
} from "./constants";

export interface CandidateSubmissionInput {
  submittingStoreId: string;
  nameAr: string;
  brandName?: string | null;
  category: string;
  flavor?: string | null;
  sizeValue?: number | null;
  sizeUnit?: string | null;
  packQty?: number | null;
}

export interface CandidateSubmissionResult {
  candidateId: string;
  isNewCandidate: boolean;
  isDuplicateMerged: boolean;
  requiresReview: boolean;
  status: string;
  acceptsCount: number;
}

export interface PromotionEvaluationResult {
  promoted: boolean;
  globalProductId?: string;
  globalVariantId?: string;
  reason: string;
  discoveryNotificationsSent?: boolean;
  metrics: {
    ageDays: number;
    requiredAgeDays: number;
    uniqueAdoptions: number;
    requiredAdoptions: number;
  };
}

/**
 * Handles incoming store candidate submissions, deduplication against existing candidates,
 * unique store adoption tracking, in-app notifications, and the 7-day + 10-shops promotion lifecycle.
 */
export class CommunitySuggestionsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Submits a custom product definition to the community suggestions pool.
   * - Performs deduplication against existing active candidates using multi-field matching.
   * - If an exact match exists, links the submitting shop as an adopter without creating duplicates.
   * - If candidate is potential match (ambiguous), queues for review without broadcasting.
   * - If new, creates candidate, registers first adoption, and schedules suggestion cards.
   */
  async submitCandidate(
    input: CandidateSubmissionInput,
    options?: { now?: Date; tx?: unknown },
  ): Promise<CandidateSubmissionResult> {
    const db = (options?.tx ? options.tx : this.prisma) as PrismaClient;
    const now = options?.now ?? new Date();
    const nameNorm = normalizeArabic(input.nameAr);

    // 1. Search for existing active or pending candidates in the same category
    const existingCandidates = await db.catalogCandidate.findMany({
      where: {
        category: input.category,
        status: { in: ["suggestable", "pending"] },
      },
      select: {
        id: true,
        nameAr: true,
        nameNorm: true,
        brandName: true,
        flavor: true,
        sizeValue: true,
        sizeUnit: true,
        packQty: true,
        category: true,
        status: true,
        acceptsCount: true,
      },
    });

    let exactCandidateMatchId: string | null = null;
    let potentialMatchFound = false;

    for (const existing of existingCandidates) {
      const match = matchProducts(
        {
          name: input.nameAr,
          brand: input.brandName,
          flavor: input.flavor,
          sizeValue: input.sizeValue,
          sizeUnit: input.sizeUnit,
          packQty: input.packQty,
          category: input.category,
        },
        {
          name: existing.nameAr,
          brand: existing.brandName,
          flavor: existing.flavor,
          sizeValue: existing.sizeValue ? Number(existing.sizeValue) : null,
          sizeUnit: existing.sizeUnit,
          packQty: existing.packQty,
          category: existing.category,
        },
      );

      if (match.matchType === "exact_match") {
        exactCandidateMatchId = existing.id;
        break;
      } else if (match.matchType === "potential_match") {
        potentialMatchFound = true;
      }
    }

    // 2. If an exact matching candidate already exists, link this store as an adopter (Idempotent)
    if (exactCandidateMatchId) {
      await this.recordAdoption(
        exactCandidateMatchId,
        input.submittingStoreId,
        {
          now,
          tx: options?.tx,
        },
      );

      const updated = await db.catalogCandidate.findUnique({
        where: { id: exactCandidateMatchId },
        select: { status: true, acceptsCount: true },
      });

      return {
        candidateId: exactCandidateMatchId,
        isNewCandidate: false,
        isDuplicateMerged: true,
        requiresReview: false,
        status: updated?.status ?? "suggestable",
        acceptsCount: updated?.acceptsCount ?? 1,
      };
    }

    // 3. If there is an ambiguous potential match, flag for internal review (status='pending')
    const initialStatus = potentialMatchFound ? "pending" : "suggestable";

    const eligibleStoresCount = await this.prisma.store.count({
      where: { shareCustomProducts: true },
    });

    const candidate = await db.catalogCandidate.create({
      data: {
        submittedByStoreId: input.submittingStoreId,
        nameAr: input.nameAr,
        nameNorm,
        brandName: input.brandName ?? null,
        category: input.category,
        flavor: input.flavor ?? null,
        sizeValue: input.sizeValue ?? null,
        sizeUnit: input.sizeUnit ?? null,
        packQty: input.packQty ?? 1,
        status: initialStatus,
        acceptsCount: 1,
        reportsCount: 0,
        eligibleStoresSnapshot: Math.max(1, eligibleStoresCount),
        firstSubmittedAt: now,
        lastUpdatedAt: now,
        publishedAt: initialStatus === "suggestable" ? now : null,
      },
    });

    // Record initial submitting shop adoption
    await db.candidateAdoption.create({
      data: {
        candidateId: candidate.id,
        storeId: input.submittingStoreId,
        createdAt: now,
      },
    });

    return {
      candidateId: candidate.id,
      isNewCandidate: true,
      isDuplicateMerged: false,
      requiresReview: initialStatus === "pending",
      status: initialStatus,
      acceptsCount: 1,
    };
  }

  /**
   * Registers a shop adoption / confirmation for a candidate.
   * Guarantees each shop is counted at most once via database unique constraint.
   */
  async recordAdoption(
    candidateId: string,
    storeId: string,
    options?: { now?: Date; tx?: unknown },
  ): Promise<{ added: boolean; totalUniqueAdoptions: number }> {
    const db = (options?.tx ? options.tx : this.prisma) as PrismaClient;
    const now = options?.now ?? new Date();

    // Idempotent upsert on candidate_adoptions
    try {
      await db.candidateAdoption.create({
        data: {
          candidateId,
          storeId,
          createdAt: now,
        },
      });
    } catch (err: unknown) {
      // If unique constraint violation, this store already adopted - safe to ignore
      const isUniqueViolation =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002";

      if (!isUniqueViolation) {
        throw err;
      }

      const existingCandidate = await this.prisma.catalogCandidate.findUnique({
        where: { id: candidateId },
        select: { acceptsCount: true },
      });
      return {
        added: false,
        totalUniqueAdoptions: existingCandidate?.acceptsCount ?? 1,
      };
    }

    // Increment acceptsCount reliably on the global catalog_candidates table
    const updated = await this.prisma.catalogCandidate.update({
      where: { id: candidateId },
      data: {
        acceptsCount: { increment: 1 },
        lastUpdatedAt: now,
      },
      select: { acceptsCount: true },
    });

    return { added: true, totalUniqueAdoptions: updated.acceptsCount };
  }

  /**
   * Evaluates whether a candidate has met the strict criteria to be promoted into the global catalog:
   * Rule: Must have passed AT LEAST 7 full days from publication AND at least 10 distinct shops.
   */
  async evaluatePromotion(
    candidateId: string,
    options?: { now?: Date },
  ): Promise<PromotionEvaluationResult> {
    const now = options?.now ?? new Date();

    const candidate = await this.prisma.catalogCandidate.findUnique({
      where: { id: candidateId },
      include: {
        adoptions: true,
      },
    });

    if (!candidate) {
      return {
        promoted: false,
        reason: "Candidate not found",
        metrics: {
          ageDays: 0,
          requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
          uniqueAdoptions: 0,
          requiredAdoptions: MIN_ADOPTING_STORES_FOR_PROMOTION,
        },
      };
    }

    if (candidate.status === "approved" && candidate.mergedIntoId) {
      return {
        promoted: true,
        globalProductId: candidate.mergedIntoId,
        reason: "Candidate was already previously promoted",
        metrics: {
          ageDays: MIN_PROMOTION_AGE_DAYS,
          requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
          uniqueAdoptions: candidate.acceptsCount,
          requiredAdoptions: MIN_ADOPTING_STORES_FOR_PROMOTION,
        },
      };
    }

    if (candidate.status === "hidden" || candidate.status === "rejected") {
      return {
        promoted: false,
        reason: `Candidate is ${candidate.status}`,
        metrics: {
          ageDays: 0,
          requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
          uniqueAdoptions: candidate.acceptsCount,
          requiredAdoptions: MIN_ADOPTING_STORES_FOR_PROMOTION,
        },
      };
    }

    if (!candidate.publishedAt) {
      return {
        promoted: false,
        reason: "Candidate has not been published yet (pending review)",
        metrics: {
          ageDays: 0,
          requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
          uniqueAdoptions: candidate.acceptsCount,
          requiredAdoptions: MIN_ADOPTING_STORES_FOR_PROMOTION,
        },
      };
    }

    const elapsedMs = now.getTime() - candidate.publishedAt.getTime();
    const ageDays = elapsedMs / ONE_DAY_MS;
    const uniqueAdoptions = candidate.acceptsCount;
    const eligibleStores = Math.max(1, candidate.eligibleStoresSnapshot ?? 1);
    const adoptionRatio = uniqueAdoptions / eligibleStores;

    // Trigger Discovery Notifications if strictly > 50%
    const discoveryNotificationsSent = adoptionRatio > 0.5;
    if (discoveryNotificationsSent) {
      const unnotifiedStores = await this.prisma.store.findMany({
        where: {
          shareCustomProducts: true,
          catalogNotifications: { none: { candidateId: candidate.id } },
          candidateAdoptions: { none: { candidateId: candidate.id } },
        },
        select: { id: true },
      });

      for (const st of unnotifiedStores) {
        await this.prisma.catalogNotification.upsert({
          where: {
            storeId_candidateId: {
              storeId: st.id,
              candidateId: candidate.id,
            },
          },
          update: {},
          create: {
            storeId: st.id,
            candidateId: candidate.id,
            title: "اكتشاف صنف جديد متداول",
            body: `أكثر من 50% من المحلات أضافت المنتج «${candidate.nameAr}» لمخزونها.`,
            createdAt: now,
          },
        });
      }
    }

    // Strict inequality criteria:
    // 1. Exactly 1 full week (>= 7 days)
    // 2. Strictly > 70% of eligible stores (not >=)
    const meetsAgeRequirement = ageDays >= MIN_PROMOTION_AGE_DAYS;
    const meetsStoreRequirement = adoptionRatio > 0.7;

    // Both conditions must be met: Time alone is not enough; count alone before 7 days is not enough.
    if (!meetsAgeRequirement || !meetsStoreRequirement) {
      let unmetReason = "";
      if (!meetsAgeRequirement && !meetsStoreRequirement) {
        unmetReason = `Both 7 full days (currently ${ageDays.toFixed(1)} days) and > 70% of stores (currently ${(adoptionRatio * 100).toFixed(1)}%) are required.`;
      } else if (!meetsAgeRequirement) {
        unmetReason = `Waiting period of 7 full days not completed (currently ${ageDays.toFixed(1)} days elapsed).`;
      } else {
        unmetReason = `More than 70% of eligible shops required (currently ${(adoptionRatio * 100).toFixed(1)}% adopted).`;
      }

      return {
        promoted: false,
        reason: unmetReason,
        discoveryNotificationsSent,
        metrics: {
          ageDays: Number(ageDays.toFixed(2)),
          requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
          uniqueAdoptions,
          requiredAdoptions: Math.floor(eligibleStores * 0.7) + 1,
        },
      };
    }

    // Both conditions met -> Promote to Global Catalog
    // 1. Resolve Brand
    let brandId: string | null = null;
    if (candidate.brandName) {
      const existingBrand = await this.prisma.brand.findFirst({
        where: { nameAr: candidate.brandName },
      });
      if (existingBrand) {
        brandId = existingBrand.id;
      } else {
        const newBrand = await this.prisma.brand.create({
          data: { nameAr: candidate.brandName },
        });
        brandId = newBrand.id;
      }
    }

    // 2. Create GlobalProduct
    const globalProduct = await this.prisma.globalProduct.create({
      data: {
        brandId,
        nameAr: candidate.nameAr,
        nameNorm: candidate.nameNorm,
        category: candidate.category,
        type: "stock",
        status: "approved",
      },
    });

    // 3. Create GlobalVariant
    const variantNameNorm = normalizeArabic(
      [
        candidate.nameAr,
        candidate.flavor,
        candidate.sizeValue?.toString(),
        candidate.sizeUnit,
      ]
        .filter(Boolean)
        .join(" "),
    );

    const globalVariant = await this.prisma.globalVariant.create({
      data: {
        globalProductId: globalProduct.id,
        flavor: candidate.flavor,
        sizeValue: candidate.sizeValue,
        sizeUnit: candidate.sizeUnit,
        packQty: candidate.packQty,
        nameNorm: variantNameNorm,
      },
    });

    // 4. Mark candidate approved and merged
    await this.prisma.catalogCandidate.update({
      where: { id: candidateId },
      data: {
        status: "approved",
        mergedIntoId: globalProduct.id,
        promotedAt: now,
        lastUpdatedAt: now,
      },
    });

    // 5. Link adopting stores' custom products and variants to globalProduct without altering prices
    for (const adoption of candidate.adoptions) {
      await this.prisma.storeProduct.updateMany({
        where: {
          storeId: adoption.storeId,
          nameAr: candidate.nameAr,
          globalProductId: null,
        },
        data: {
          globalProductId: globalProduct.id,
        },
      });

      await this.prisma.storeVariant.updateMany({
        where: {
          storeId: adoption.storeId,
          productId: globalProduct.id,
          globalVariantId: null,
        },
        data: {
          globalVariantId: globalVariant.id,
        },
      });

      // Dispatch single promotion notification to each adopting store
      await this.prisma.catalogNotification.upsert({
        where: {
          storeId_candidateId: {
            storeId: adoption.storeId,
            candidateId: candidate.id,
          },
        },
        update: {
          title: "تم اعتماد منتجك في الكتالوج العام",
          body: `أصبح المنتج «${candidate.nameAr}» معتمدًا الآن في الكتالوج العام لجميع المحلات.`,
          isRead: false,
        },
        create: {
          storeId: adoption.storeId,
          candidateId: candidate.id,
          title: "تم اعتماد منتجك في الكتالوج العام",
          body: `أصبح المنتج «${candidate.nameAr}» معتمدًا الآن في الكتالوج العام لجميع المحلات.`,
          isRead: false,
          createdAt: now,
        },
      });
    }

    return {
      promoted: true,
      globalProductId: globalProduct.id,
      globalVariantId: globalVariant.id,
      reason:
        "Successfully promoted: 7 full days and > 70% of eligible shops confirmed.",
      discoveryNotificationsSent,
      metrics: {
        ageDays: Number(ageDays.toFixed(2)),
        requiredAgeDays: MIN_PROMOTION_AGE_DAYS,
        uniqueAdoptions,
        requiredAdoptions: Math.floor(eligibleStores * 0.7) + 1,
      },
    };
  }

  /**
   * Reports an objectionable candidate. If threshold reached, hides the candidate automatically.
   */
  async reportCandidate(
    candidateId: string,
    storeId: string,
    reason: string,
  ): Promise<{ hidden: boolean; reportsCount: number }> {
    await this.prisma.catalogReport.create({
      data: {
        candidateId,
        storeId,
        reason,
      },
    });

    const candidate = await this.prisma.catalogCandidate.update({
      where: { id: candidateId },
      data: {
        reportsCount: { increment: 1 },
      },
      select: { reportsCount: true },
    });

    if (candidate.reportsCount >= MAX_REPORTS_THRESHOLD) {
      await this.prisma.catalogCandidate.update({
        where: { id: candidateId },
        data: { status: "hidden" },
      });
      return { hidden: true, reportsCount: candidate.reportsCount };
    }

    return { hidden: false, reportsCount: candidate.reportsCount };
  }
}
