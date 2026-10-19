# Hesba — Core Rules (always on)

Full source: `AGENTS.md` at the project root and `docs/00-START-HERE.md`. These rules are an inviolable summary:

1. One phase at a time from `docs/04-TASKS.md`, and report the result honestly after `lint + typecheck + test`.
2. One Next.js app. The UI writes to Dexie + Outbox and does not wait for the server. **No periodic polling.**
3. Server Actions for online-only work. Sync = versioned `/api/sync/*` Route Handlers (`schema_v`).
4. Every table: `store_id` + RLS. Every query runs inside `withTenant()`.
5. Money is integer piasters, quantities are integers in the base unit (piece/gram), dates are UTC.
6. Stock = batches + append-only movements, sales use FEFO, undo = `sale.void`.
7. Every operation is idempotent via `op_id`.
8. Prices, stock and shop identity are never shared in catalog suggestions.
9. No provider-locked features. The Docker build must keep working.
10. No invented numbers/prices/claims. If unsure: ask.
11. TypeScript strict, no `any`. zod in `src/schemas`.
12. No secrets or personal data in code or logs.
13. Don't create files outside `docs/03-FOLDER-STRUCTURE.md` without an ADR.
