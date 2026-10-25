import { assertIntegerPiasters } from "./money";

export type WalletTransactionKind =
  "transfer_in" | "transfer_out" | "withdrawal" | "owner_deposit" | "reversal";

export interface WalletTransactionInput {
  kind: WalletTransactionKind;
  amountPiasters: number;
  feePiasters: number;
}

/**
 * Calculates the balance_after for a wallet transaction in integer piasters.
 * - `owner_deposit`: Merchant deposits opening or replenishment funds into wallet -> balance increases.
 * - `transfer_in`: Inflow into wallet from customer -> balance increases.
 * - `transfer_out`: Outflow from wallet to recipient -> balance decreases.
 * - `withdrawal`: Cash out from wallet -> balance decreases.
 * - `reversal`: Reversal restoring wallet funds -> balance increases.
 *
 * Throws if amounts are non-integers, <= 0, or if balance would become negative.
 */
export function calculateWalletBalanceAfter(
  currentBalancePiasters: number,
  tx: WalletTransactionInput,
): number {
  assertIntegerPiasters(currentBalancePiasters, "Current balance");
  assertIntegerPiasters(tx.amountPiasters, "Transaction amount");
  assertIntegerPiasters(tx.feePiasters, "Transaction fee");

  if (tx.amountPiasters <= 0) {
    throw new Error(
      `Transaction amount must be a positive integer in piasters, received: ${tx.amountPiasters}`,
    );
  }

  switch (tx.kind) {
    case "owner_deposit":
    case "transfer_in":
    case "reversal":
      return currentBalancePiasters + tx.amountPiasters;

    case "transfer_out":
    case "withdrawal":
      if (currentBalancePiasters < tx.amountPiasters) {
        throw new Error(
          `Insufficient wallet balance: current ${currentBalancePiasters} piasters, required ${tx.amountPiasters} piasters`,
        );
      }
      return currentBalancePiasters - tx.amountPiasters;

    default:
      throw new Error(
        `Unsupported transaction kind: ${(tx as { kind: string }).kind}`,
      );
  }
}
