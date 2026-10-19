# Server and Data Rules (when working on `src/server`, `drizzle/` or `/api`)

- Reference: `docs/09-DATABASE-SCHEMA.md` (tables), `docs/10-SYNC-PROTOCOL.md` (operations) and `docs/02` (layers).
- Every file in `src/server` starts with `import 'server-only'`. `src/client` must not import from it.
- Module layers: `actions.ts|handlers.ts` (thin) → `app/` (use-cases, one Transaction) → `domain/` (pure) → `infra/` (SQL via Drizzle).
- A module imports from another module only via `index.ts`. No querying another module's tables.
- **RLS:** `withTenant(storeId, userId, fn)` = `set_config('app.store_id', …, true)` inside a Transaction. The app user is not a superuser and has no BYPASSRLS. Migrations run with a different user (`DIRECT_URL`).
- Migrations: Expand/Contract. Never drop a column in the same release that stops using it. `CREATE INDEX CONCURRENTLY` on large tables.
- No `SELECT *`, no N+1. A hot query = a reviewed `EXPLAIN`.
- `/api/sync/push`: each operation is an independent Transaction; check `sync_ops.op_id` first (`duplicate`), then zod, then the handler, then `sync_ops` + `change_log` in the same tx.
- Pull: `change_log.seq > cursor`. Nothing new = `204`.
- Auth: Argon2id (measure the CPU time) + a rotating httpOnly cookie session stored in the DB. OTP with limits per number/IP/device.
- Jobs: a `jobs` table + `/api/cron/tick` (protected by a secret, `FOR UPDATE SKIP LOCKED`). Every job is idempotent.
- AI: numbers come from read-only SQL tools only. The LLM phrases, it does not calculate. Limit of 5/day with an atomic check on the server.
- Any new endpoint = a cross-tenant test + a test that shop identity does not leak (if it touches the catalog).
- Env variables come from `src/server/config/env.ts` (zod). No direct `process.env` outside it.
