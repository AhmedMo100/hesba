-- QA-03 (ADR-0020): POS-machine money safety. Additive only; no existing row is changed.

-- 1. Idempotency: a balance operation may carry the client's op_id. The same op_id is applied
--    at most once per store (NULLs — operations without an op_id — are not constrained).
ALTER TABLE "pos_machine_topups" ADD COLUMN IF NOT EXISTS "op_id" UUID NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pos_machine_topups_store_op"
  ON "pos_machine_topups" ("store_id", "op_id");

-- 2. Defense in depth for the existing rule "a machine balance cannot be negative" (the
--    service already rejects overdrafts). NOT VALID: enforced for every new write without
--    re-checking historical rows.
ALTER TABLE "pos_machines"
  DROP CONSTRAINT IF EXISTS "chk_pos_machines_balance_non_negative";
ALTER TABLE "pos_machines"
  ADD CONSTRAINT "chk_pos_machines_balance_non_negative"
  CHECK ("current_balance_piasters" >= 0) NOT VALID;
