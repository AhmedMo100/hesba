# Backup and restore

Neon Free keeps only a 6-hour history, and Neon paid plans up to 7 days
(docs/07-ops.md, R4). Hesba holds shops' money and stock: **independent daily backups are
mandatory before the first real shop.**

## The trap: row level security

Every shop table has `FORCE ROW LEVEL SECURITY`, and none of Hesba's roles bypasses it, the
migrator included. A plain `pg_dump` run as `hesba_migrator` therefore **fails**
("query would be affected by row-security policy"), or with `--enable-row-security` it silently
**skips every shop's rows**. Use one of these two methods.

### Method A (recommended): dump as the database owner

On Neon, `neondb_owner` has `BYPASSRLS`. Run the dump with **its** connection string (direct
host, not the pooler), using a `pg_dump` whose major version is at least the server's (Neon runs
Postgres 18):

```bash
# pg_dump 18 without installing it locally:
docker run --rm -e U="$NEON_OWNER_DIRECT_URL" -v "$PWD:/out" postgres:18-alpine \
  sh -c 'pg_dump "$U" --format=custom --no-owner --no-privileges -f /out/hesba-$(date -u +%F).dump'
```

Encrypt the file before it leaves the machine (age or GPG). Upload it to storage separate from
the database provider. Keep the encryption key outside this repository.

### Method B (no owner access): snapshot copy as the migrator

`hesba_migrator` owns the tables, so inside ONE transaction it may lift `FORCE` for itself,
copy every table, and roll back: no schema change is ever committed. This is how the Neon dev
database was backed up on 2026-11-21 (scripts kept with the backup under `~/hesba-backups/`):

1. `pg_dump --section=pre-data` and `--section=post-data` (schema only, these work as the
   migrator).
2. One `psql` session: `BEGIN ISOLATION LEVEL REPEATABLE READ;`, then
   `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` for every forced table, then `\copy` each table to
   a file, then `ROLLBACK;`.

## Schedule and retention

| What | When |
| --- | --- |
| Full backup (method A) | Daily, e.g. GitHub Actions `schedule` with the owner URL as a secret |
| Before every production migration | Always (see production-deployment.md) |
| Retention | 14 daily + 8 weekly |
| Restore test | Monthly during Alpha, and after any change to the backup job |

## Restore, and prove it works

Never restore over production to "test". Restore into a fresh database and compare:

```bash
# 1. A fresh Postgres 18 with Hesba's roles
docker run -d --name hesba_restore -e POSTGRES_PASSWORD=x postgres:18-alpine
docker exec -i hesba_restore psql -U postgres -c "CREATE ROLE hesba_app; CREATE ROLE hesba_migrator; CREATE ROLE hesba_service;"
docker exec -i hesba_restore psql -U postgres -c "CREATE DATABASE restore_check"
# 2. Restore (custom format)
docker cp hesba-YYYY-MM-DD.dump hesba_restore:/tmp/b.dump
docker exec hesba_restore pg_restore -U postgres -d restore_check --no-owner /tmp/b.dump
# 3. Compare row counts with the source, table by table, and the migrations table
docker exec hesba_restore psql -U postgres -d restore_check -c "SELECT count(*) FROM _prisma_migrations"
```

A backup counts only when its restore was checked: row counts equal to the source for every
table, the same `_prisma_migrations` rows, and 60+ tables with `FORCE ROW LEVEL SECURITY` after
the restore.

## Restoring production for real (incident)

1. Stop writes: put the app in maintenance (or scale it to zero) so no new sales land.
2. Neon first: if the incident is within the history window, use Neon's own restore or branch
   from a point in time. It is faster, and nothing is lost after the backup.
3. Otherwise restore the latest verified dump into a NEW Neon branch or database. Point
   `HESBA_DATABASE_URL` / `HESBA_DIRECT_URL` at it, then run `prisma migrate status` (it must
   say up to date).
4. Tell the shops that operations after the backup time must be re-entered. Offline outboxes on
   devices will re-send their queued sales by themselves (idempotent `opId`).
