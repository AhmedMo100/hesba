# Activating and renewing subscriptions by hand (ADR-0033, ADR-0008)

Hesba has no payment gateway and no admin panel yet. When a shop pays (Vodafone Cash / InstaPay,
confirmed on WhatsApp), Hesba's admin activates it in the database with the functions below.
The app itself can never change a subscription: a database trigger refuses it.

## Who can run this

The functions are owned by the role that ran the migrations (`hesba_migrator`) and EXECUTE is
revoked from everyone else — the app's roles (`hesba_app`, `hesba_service`) can never call them.
Connect with the migrator's connection string (`HESBA_DIRECT_URL`), or grant your own admin role
once: `GRANT EXECUTE ON FUNCTION hesba_find_store(TEXT), hesba_renew_subscription(UUID, INTEGER, TEXT), hesba_set_subscription_status(UUID, TEXT) TO <your_admin_role>;`

`stores` has FORCE ROW LEVEL SECURITY: plain `SELECT … FROM stores` shows nothing unless the role
bypasses RLS. The functions bind the tenant themselves, so they work without that.

## 1. Find the shop

```sql
-- By the owner's phone (01xxxxxxxxx or +201xxxxxxxxx) or e-mail
SELECT * FROM hesba_find_store('01012345678');
-- store_id | store_name | owner_name | owner_phone | operating_mode | subscription_status
--          | subscription_plan | trial_ends_at | subscription_ends_at | created_at
```

Copy the `store_id` (a UUID). The shop menu's «الاشتراك» screen also shows the first 8 characters
of it in the WhatsApp message the owner sends.

## 2. Activate one month

```sql
SELECT * FROM hesba_renew_subscription('a8e93a8b-f5b0-4501-8ca4-f677ed793010', 1, 'monthly');
```

- The shop becomes `active` at once (the next request is allowed — no restart, no new account).
- The period is added **after the current paid end if it is still in the future** (no remaining
  day is lost, whatever the status), otherwise it starts now.
- `subscription_started_at` is kept while the shop is still paid, else set to now.

## 3. Renew three months

```sql
SELECT * FROM hesba_renew_subscription('a8e93a8b-f5b0-4501-8ca4-f677ed793010', 3, 'quarterly');
```

Example: paid until 2027-01-10 and renewed on 2026-12-28 → paid until 2027-04-10. Expired on
2026-12-01 and renewed on 2026-12-28 → paid until 2027-03-28 (from the renewal).

`p_months` is 1–36. The plan text is free (e.g. `monthly`, `quarterly`, `yearly`); leave it out
(`NULL`) to keep the current plan.

## 4. Suspend, or end now

```sql
SELECT * FROM hesba_set_subscription_status('a8e93a8b-…', 'suspended'); -- stops it at once
SELECT * FROM hesba_set_subscription_status('a8e93a8b-…', 'expired');   -- ends it now
```

Dates are kept, so a later `hesba_renew_subscription` still adds after any paid days left.

## 5. What happens by itself

- A trial (72 hours from the shop's creation, database clock) and a paid period end on their
  date: every protected request checks the end date on the server's clock. No cron is needed.
- An expired or suspended shop sees only «انتهت الفترة» (status, contact Hesba, re-check, logout).
  Its data is kept; its device keeps unsent sales and sends them (once each) after activation.
- Changing the operating mode, logging in again, another device or editing the shop's profile
  never restarts the trial.

## 6. The audit

Every change of a subscription field is logged with the database user who made it:

```sql
-- The table has FORCE ROW LEVEL SECURITY like every shop table: bind the shop first.
BEGIN;
SELECT set_config('app.store_id', 'a8e93a8b-f5b0-4501-8ca4-f677ed793010', true);
SELECT created_at, changed_by, old_status, new_status, old_ends_at, new_ends_at, new_plan
  FROM store_subscription_events
 WHERE store_id = 'a8e93a8b-f5b0-4501-8ca4-f677ed793010'
 ORDER BY created_at DESC;
COMMIT;
```

## 7. Never do this

- Never set `subscription_status = 'active'` without `subscription_ends_at` (the database refuses:
  `stores_active_has_end_check`). There is no "forever".
- Never edit `trial_started_at` / `trial_ends_at` to give a shop "a new trial" by mistake; extend
  it on purpose with `hesba_renew_subscription` instead.
- Never give the app's roles EXECUTE on these functions.
