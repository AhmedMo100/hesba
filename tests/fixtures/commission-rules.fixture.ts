/**
 * ============================================================================
 * TEST ONLY, NOT REAL PRICES
 * ============================================================================
 * The values below are mock fixtures created solely for unit and integration
 * testing of boundary conditions, fee calculations, gap detection, and overlap
 * detection. None of these numbers represent real commercial tariffs or fees.
 * ============================================================================
 */

import type { CommissionRule } from "@/domain/commission";

export const MOCK_COMMISSION_RULES: CommissionRule[] = [
  // Provider: Vodafone, Kind: transfer
  // Tier 1: 1 EGP to 500 EGP (100 to 50,000 piasters) -> fixed 100 piasters (1 EGP)
  {
    id: "rule-vf-transfer-t1",
    provider: "vodafone",
    kind: "transfer",
    fromAmountPiasters: 100,
    toAmountPiasters: 50000,
    feeType: "fixed",
    feeValue: 100,
  },
  // Tier 2: 500.01 EGP to 2,000 EGP (50,001 to 200,000 piasters) -> 1.0% percent
  {
    id: "rule-vf-transfer-t2",
    provider: "vodafone",
    kind: "transfer",
    fromAmountPiasters: 50001,
    toAmountPiasters: 200000,
    feeType: "percent",
    feeValue: 1.0,
  },
  // Tier 3: 2,000.01 EGP to 10,000 EGP (200,001 to 1,000,000 piasters) -> fixed 3,000 piasters (30 EGP)
  {
    id: "rule-vf-transfer-t3",
    provider: "vodafone",
    kind: "transfer",
    fromAmountPiasters: 200001,
    toAmountPiasters: 1000000,
    feeType: "fixed",
    feeValue: 3000,
  },

  // Provider: InstaPay, Kind: transfer
  // Tier 1: 1 EGP to 1,000 EGP (100 to 100,000 piasters) -> fixed 0 piasters
  {
    id: "rule-instapay-transfer-t1",
    provider: "instapay",
    kind: "transfer",
    fromAmountPiasters: 100,
    toAmountPiasters: 100000,
    feeType: "fixed",
    feeValue: 0,
  },
  // Tier 2: 1,000.01 EGP to 5,000 EGP (100,001 to 500,000 piasters) -> 0.5% percent
  {
    id: "rule-instapay-transfer-t2",
    provider: "instapay",
    kind: "transfer",
    fromAmountPiasters: 100001,
    toAmountPiasters: 500000,
    feeType: "percent",
    feeValue: 0.5,
  },

  // Provider: WE, Kind: bill
  // Flat fixed fee: 100 to 50,000 piasters -> 200 piasters
  {
    id: "rule-we-bill-flat",
    provider: "we",
    kind: "bill",
    fromAmountPiasters: 100,
    toAmountPiasters: 50000,
    feeType: "fixed",
    feeValue: 200,
  },
];

/**
 * Faulty fixture with an intentional range overlap for testing overlap detection.
 * TEST ONLY, NOT REAL PRICES.
 */
export const OVERLAPPING_COMMISSION_RULES: CommissionRule[] = [
  {
    id: "rule-overlap-a",
    provider: "test-provider",
    kind: "transfer",
    fromAmountPiasters: 100,
    toAmountPiasters: 5000,
    feeType: "fixed",
    feeValue: 50,
  },
  {
    id: "rule-overlap-b",
    provider: "test-provider",
    kind: "transfer",
    fromAmountPiasters: 3000, // Overlaps with rule-overlap-a [100, 5000]
    toAmountPiasters: 10000,
    feeType: "fixed",
    feeValue: 100,
  },
];
