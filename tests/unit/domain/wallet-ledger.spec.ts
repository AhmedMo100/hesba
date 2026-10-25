import { describe, expect, it } from "vitest";
import {
  calculateWalletBalanceAfter,
  billTypeSchema,
  walletProviderSchema,
} from "../../../src/domain";
import { TEST_WALLET_LEDGER_FIXTURE } from "../../fixtures/wallet-ledger.fixture";

describe("Wallet Ledger & Business Enums Validation", () => {
  describe("1. Ledger balance_after calculation using 5-row fixture", () => {
    it("computes exact balance_after across all 5 fixture rows in sequence", () => {
      let currentBalance = 0;

      for (const row of TEST_WALLET_LEDGER_FIXTURE) {
        const nextBalance = calculateWalletBalanceAfter(currentBalance, {
          kind: row.kind,
          amountPiasters: row.amountPiasters,
          feePiasters: row.feePiasters,
        });

        expect(nextBalance).toBe(row.expectedBalanceAfter);
        currentBalance = nextBalance;
      }

      // Final balance matches the 5th row's expectedBalanceAfter
      expect(currentBalance).toBe(300000);
    });

    it("throws when transfer_out exceeds available wallet balance", () => {
      expect(() =>
        calculateWalletBalanceAfter(10000, {
          kind: "transfer_out",
          amountPiasters: 15000,
          feePiasters: 100,
        }),
      ).toThrowError(/Insufficient wallet balance/i);
    });

    it("throws when withdrawal exceeds available wallet balance", () => {
      expect(() =>
        calculateWalletBalanceAfter(5000, {
          kind: "withdrawal",
          amountPiasters: 5001,
          feePiasters: 0,
        }),
      ).toThrowError(/Insufficient wallet balance/i);
    });

    it("throws when transaction amount is zero or negative", () => {
      expect(() =>
        calculateWalletBalanceAfter(10000, {
          kind: "transfer_in",
          amountPiasters: 0,
          feePiasters: 0,
        }),
      ).toThrowError(/positive integer/i);

      expect(() =>
        calculateWalletBalanceAfter(10000, {
          kind: "transfer_in",
          amountPiasters: -500,
          feePiasters: 0,
        }),
      ).toThrowError(/positive integer/i);
    });

    it("throws when transaction amount is a floating point number", () => {
      expect(() =>
        calculateWalletBalanceAfter(10000, {
          kind: "owner_deposit",
          amountPiasters: 100.5,
          feePiasters: 0,
        }),
      ).toThrowError(/safe integer/i);
    });
  });

  describe("2. Enum validators reject unknown values", () => {
    it("billTypeSchema accepts valid bill types and rejects unknown strings", () => {
      const validTypes = [
        "internet",
        "mobile",
        "landline",
        "electricity",
        "gas",
        "water",
        "other",
      ];
      for (const t of validTypes) {
        expect(billTypeSchema.parse(t)).toBe(t);
      }

      expect(() => billTypeSchema.parse("crypto_bill")).toThrow();
      expect(() => billTypeSchema.parse("fawry_custom")).toThrow();
      expect(() => billTypeSchema.parse("")).toThrow();
    });

    it("walletProviderSchema accepts valid providers and rejects unknown strings", () => {
      const validProviders = ["vodafone_cash", "instapay", "other"];
      for (const p of validProviders) {
        expect(walletProviderSchema.parse(p)).toBe(p);
      }

      expect(() => walletProviderSchema.parse("bitcoin")).toThrow();
      expect(() => walletProviderSchema.parse("paypal")).toThrow();
      expect(() => walletProviderSchema.parse("we_pay_unsupported")).toThrow();
    });
  });
});
