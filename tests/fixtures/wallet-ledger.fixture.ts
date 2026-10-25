/**
 * TEST ONLY, NOT REAL MONEY
 * Fixture representing a sequence of 5 wallet ledger transactions.
 * Opening balance begins at 0 and is initialized by an owner_deposit.
 */

import { type WalletTransactionInput } from "../../src/domain/wallet";

export interface FixtureLedgerRow extends WalletTransactionInput {
  description: string;
  expectedBalanceAfter: number;
}

export const TEST_WALLET_LEDGER_FIXTURE: FixtureLedgerRow[] = [
  {
    description: "1. Owner initial deposit to fund the wallet",
    kind: "owner_deposit",
    amountPiasters: 500000, // 5,000 EGP
    feePiasters: 0,
    expectedBalanceAfter: 500000,
  },
  {
    description: "2. Customer transfer in (cash in)",
    kind: "transfer_in",
    amountPiasters: 100000, // 1,000 EGP
    feePiasters: 1000, // 10 EGP fee
    expectedBalanceAfter: 600000,
  },
  {
    description: "3. Outgoing transfer to recipient (cash out)",
    kind: "transfer_out",
    amountPiasters: 250000, // 2,500 EGP
    feePiasters: 2500, // 25 EGP fee
    expectedBalanceAfter: 350000,
  },
  {
    description: "4. Agent cash withdrawal",
    kind: "withdrawal",
    amountPiasters: 100000, // 1,000 EGP
    feePiasters: 1000,
    expectedBalanceAfter: 250000,
  },
  {
    description: "5. Reversal of an erroneous outgoing transfer",
    kind: "reversal",
    amountPiasters: 50000, // 500 EGP reversed back into wallet
    feePiasters: 0,
    expectedBalanceAfter: 300000,
  },
];
