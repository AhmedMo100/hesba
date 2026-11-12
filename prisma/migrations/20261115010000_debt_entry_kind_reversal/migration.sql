-- QA-30 / QA-31 (ADR-0027): a `reversal` ledger entry takes back an invoice's debt when the
-- supplier purchase is cancelled or the credit sale is returned / voided. It is not a payment.
-- Widens the CHECK from 20261112010000; existing rows are unchanged (they all still match).
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "chk_debt_entries_entry_kind";
ALTER TABLE "debt_entries"
  ADD CONSTRAINT "chk_debt_entries_entry_kind"
  CHECK ("entry_kind" IN ('opening', 'transaction', 'adjustment', 'reversal'));
