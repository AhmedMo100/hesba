-- QA-12 (ADR-0023): say what each person-ledger entry IS, so a balance the owner sets by hand
-- is never disguised as a debt or a payment.
--
--   opening      the balance a person started with (entered when the person was added)
--   transaction  a real debt or payment
--   adjustment   the owner set the balance by hand (editing the person)
--
-- Existing rows keep the meaning they always had: 'transaction'. No amount, direction or date
-- is changed, and no row is deleted. Balancing entries written by the old "edit balance" code
-- (QA-12) cannot be told apart reliably from real entries, so they are NOT relabelled here:
-- they need a review of each shop's data (ADR-0023).

ALTER TABLE "debt_entries"
  ADD COLUMN IF NOT EXISTS "entry_kind" TEXT NOT NULL DEFAULT 'transaction';

ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "chk_debt_entries_entry_kind";
ALTER TABLE "debt_entries"
  ADD CONSTRAINT "chk_debt_entries_entry_kind"
  CHECK ("entry_kind" IN ('opening', 'transaction', 'adjustment'));

-- An amount of zero or less is never a ledger entry.
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "chk_debt_entries_amount_positive";
ALTER TABLE "debt_entries"
  ADD CONSTRAINT "chk_debt_entries_amount_positive"
  CHECK ("amount_piasters" > 0) NOT VALID;
