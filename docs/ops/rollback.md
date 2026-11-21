# Rollback

## Application (code) rollback

The app is stateless (sessions, data and limits live in Postgres or in each process's
memory), so rolling the code back is redeploying the previous build:

- **Vercel:** Deployments → the previous production deployment → «Promote to Production».
- **Docker / VM (`output: "standalone"`):** run the previous image tag.

Before rolling back, check that the older code still runs on the **current** schema. Hesba's
migrations are additive: they add columns, tables and constraints and never rename or drop a
column the previous release reads. So the previous release normally works on the newer
database. If a release ever breaks that rule, its PR must say so, and that release cannot be
rolled back this way.

## Database (migration) rollback

Prisma has no automatic "down" migrations, and **`prisma migrate reset` is forbidden on any
database with real data** (it drops everything). Roll forward instead:

1. If a migration failed half-way, `prisma migrate status` shows it as failed. Fix the cause, then
   either finish it by hand and run `prisma migrate resolve --applied <name>`, or undo its
   partial effect and run `prisma migrate resolve --rolled-back <name>`.
2. If an applied migration is wrong, write a NEW migration that corrects it (e.g. drop the bad
   constraint) and deploy it like any other.
3. If data was damaged, restore (backup-restore.md). Neon's point-in-time restore is the first
   choice inside its history window.

Always take a backup right before `prisma migrate deploy` on production
(production-deployment.md, step 5). It is what makes every option above safe.

## Feature-level switches that need no deploy

| Problem | Switch |
| --- | --- |
| AI provider failing or costing too much | `/admin` → AI settings (limits, budget, provider off) |
| Catalog-promotion cron misbehaving | Stop calling `/api/cron/catalog-promotion` (external scheduler) |
| A shop must be stopped | `hesba_set_subscription_status(store_id, 'suspended')` (docs/ops/subscriptions.md) |
