/**
 * QA-34 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0024) — database roles, checked on the REAL roles
 * of the test database (no mocks):
 * - the runtime app role cannot bypass RLS, has no privileged membership, owns nothing;
 * - the migrator no longer sees shops' rows by policy: only with a shop's context, like the app;
 * - the catalog cron's service role has only its narrow grants;
 * - tenant A cannot read, change or delete tenant B's rows; no / invalid context exposes nothing;
 * - the runtime clients connect as the intended roles, and the cron runs as the service role.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { prisma, servicePrisma } from "@/server/infra/db/client";
import { POST as cronRoute } from "@/app/api/cron/catalog-promotion/route";

const adminUrl =
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
const appUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";
const migratorUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const serviceUrl =
  process.env["HESBA_SERVICE_DATABASE_URL"] ??
  "postgres://hesba_service:change-me-local@localhost:5434/hesba";

const admin = postgres(adminUrl, { max: 1 });
const app = postgres(appUrl, { max: 1 });
const migrator = postgres(migratorUrl, { max: 1 });
const service = postgres(serviceUrl, { max: 1 });

const runId = Math.random().toString(36).slice(2, 8);
const A = { store: crypto.randomUUID(), user: crypto.randomUUID() };
const B = { store: crypto.randomUUID(), user: crypto.randomUUID() };

/** Runs `fn` in one transaction of `sql` with `app.store_id` set (or not). */
function inContext<T>(
  sql: postgres.Sql,
  storeId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    if (storeId !== null) {
      await tx`SELECT set_config('app.store_id', ${storeId}, true)`;
    }
    return fn(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  for (const [shop, n] of [
    [A, 1],
    [B, 2],
  ] as const) {
    await admin`INSERT INTO users (id, name, phone, email, password_hash)
      VALUES (${shop.user}, ${"مالك " + n}, ${`+2012${n}${runId}`}, ${`roles-${n}-${runId}@hesba.test`}, 'x')`;
    await admin`INSERT INTO stores (id, name, shop_type, governorate, created_by)
      VALUES (${shop.store}, ${`محل أدوار ${n} ${runId}`}, 'supermarket', 'Cairo', ${shop.user})`;
    await admin`INSERT INTO expenses (store_id, category, amount_piasters)
      VALUES (${shop.store}, 'كهرباء', ${n * 1000})`;
  }
});

afterAll(async () => {
  try {
    await admin`DELETE FROM stores WHERE id IN ${admin([A.store, B.store])}`;
    await admin`DELETE FROM users WHERE id IN ${admin([A.user, B.user])}`;
  } finally {
    await Promise.all([admin.end(), app.end(), migrator.end(), service.end()]);
  }
});

describe("QA-34 — role attributes and memberships", () => {
  it("no runtime or migration role is superuser or bypasses RLS", async () => {
    const roles = await admin<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
       WHERE rolname IN ('hesba_app', 'hesba_migrator', 'hesba_service')
       ORDER BY rolname`;
    expect(roles.map((r) => r.rolname)).toEqual([
      "hesba_app",
      "hesba_migrator",
      "hesba_service",
    ]);
    for (const r of roles) {
      expect(r.rolsuper).toBe(false);
      expect(r.rolbypassrls).toBe(false);
    }
  });

  it("the app and service roles belong to no other role and own no table", async () => {
    const memberships = await admin`
      SELECT r.rolname AS role, m.rolname AS member
        FROM pg_auth_members am
        JOIN pg_roles r ON r.oid = am.roleid
        JOIN pg_roles m ON m.oid = am.member
       WHERE m.rolname IN ('hesba_app', 'hesba_service')`;
    expect(memberships).toHaveLength(0);
    const owned = await admin`
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tableowner IN ('hesba_app', 'hesba_service')`;
    expect(owned).toHaveLength(0);
    await expect(app`SET ROLE hesba_migrator`).rejects.toThrow();
    await expect(service`SET ROLE hesba_migrator`).rejects.toThrow();
  });

  it("every tenant table has FORCE RLS, and no tenant table has a migrator bypass policy", async () => {
    const tenantTables = await admin<
      Array<{ table: string; force: boolean; rls: boolean }>
    >`SELECT c.relname AS table, c.relforcerowsecurity AS force, c.relrowsecurity AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname
                        AND col.column_name = 'store_id')
         -- Identity, not shop data: a session row is looked up by its token hash before any
         -- shop is known (docs/03-data.md). It is never read through a tenant query.
         AND c.relname <> 'sessions'`;
    expect(tenantTables.length).toBeGreaterThan(30);
    for (const t of tenantTables) {
      expect({ table: t.table, rls: t.rls, force: t.force }).toEqual({
        table: t.table,
        rls: true,
        force: true,
      });
    }
    const bypass = await admin<Array<{ tablename: string }>>`
      SELECT p.tablename FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND 'hesba_migrator' = ANY (p.roles)
         AND (p.tablename = 'stores' OR EXISTS (
               SELECT 1 FROM information_schema.columns col
                WHERE col.table_schema = 'public' AND col.table_name = p.tablename
                  AND col.column_name = 'store_id'))`;
    expect(bypass.map((b) => b.tablename)).toEqual([]);
  });
});

describe("QA-34 — tenant isolation enforced by the database for every role", () => {
  it("the app role sees only its own shop; no context or an invalid one exposes nothing", async () => {
    const own = await inContext(
      app,
      A.store,
      (tx) =>
        tx`SELECT store_id::text FROM expenses WHERE store_id IN ${tx([A.store, B.store])}`,
    );
    expect(own.map((r) => r["store_id"])).toEqual([A.store]);
    const none = await inContext(
      app,
      null,
      (tx) =>
        tx`SELECT 1 FROM expenses WHERE store_id IN ${tx([A.store, B.store])}`,
    );
    expect(none).toHaveLength(0);
    await expect(
      inContext(app, "not-a-uuid", (tx) => tx`SELECT 1 FROM expenses LIMIT 1`),
    ).rejects.toThrow();
  });

  it("tenant A cannot change or delete tenant B's rows, or write a row for B", async () => {
    const updated = await inContext(
      app,
      A.store,
      (tx) =>
        tx`UPDATE expenses SET amount_piasters = 1 WHERE store_id = ${B.store}::uuid RETURNING id`,
    );
    expect(updated).toHaveLength(0);
    const deleted = await inContext(
      app,
      A.store,
      (tx) => tx`DELETE FROM stores WHERE id = ${B.store}::uuid RETURNING id`,
    );
    expect(deleted).toHaveLength(0);
    await expect(
      inContext(
        app,
        A.store,
        (tx) =>
          tx`INSERT INTO expenses (store_id, category, amount_piasters)
             VALUES (${B.store}, 'x', 100)`,
      ),
    ).rejects.toThrow(/row-level security/);
    const [b] =
      await admin`SELECT amount_piasters FROM expenses WHERE store_id = ${B.store}::uuid`;
    expect(Number(b!["amount_piasters"])).toBe(2000);
  });

  it("the migrator sees no shop's rows without that shop's context (no bypass policy)", async () => {
    const without =
      await migrator`SELECT 1 FROM stores WHERE id IN ${migrator([A.store, B.store])}`;
    expect(without).toHaveLength(0);
    const scoped = await inContext(
      migrator,
      A.store,
      (tx) =>
        tx`SELECT id::text FROM stores WHERE id IN ${tx([A.store, B.store])}`,
    );
    expect(scoped.map((r) => r["id"])).toEqual([A.store]);
  });

  it("the migrator can still run schema migrations (DDL in a transaction)", async () => {
    await migrator.begin(async (tx) => {
      await tx`CREATE TABLE qa34_ddl_probe (id int)`;
      await tx`DROP TABLE qa34_ddl_probe`;
    });
  });

  it("the service role has only the catalog cron's grants", async () => {
    const can = async (table: string, priv: string) =>
      (
        await admin<Array<{ ok: boolean }>>`
          SELECT has_table_privilege('hesba_service', ${table}, ${priv}) AS ok`
      )[0]!.ok;
    expect(await can("stores", "SELECT")).toBe(true);
    expect(await can("catalog_notifications", "INSERT")).toBe(true);
    for (const table of [
      "sales",
      "sale_lines",
      "debt_entries",
      "expenses",
      "stock_movements",
      "store_stock_batches",
      "pos_machines",
      "customers",
      "sessions",
      "users",
    ]) {
      expect(await can(table, "SELECT")).toBe(false);
    }
    expect(await can("stores", "DELETE")).toBe(false);
    expect(await can("stores", "UPDATE")).toBe(false);
    await expect(service`SELECT 1 FROM expenses LIMIT 1`).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("QA-34 — runtime connections use the intended roles", () => {
  it("the request client is hesba_app and the cron client is hesba_service", async () => {
    const [a] = await prisma.$queryRaw<
      Array<{ role: string }>
    >`SELECT current_user::text AS role`;
    expect(a!.role).toBe("hesba_app");
    expect(servicePrisma).not.toBeNull();
    const [s] = await servicePrisma!.$queryRaw<
      Array<{ role: string }>
    >`SELECT current_user::text AS role`;
    expect(s!.role).toBe("hesba_service");
  });

  it("the catalog-promotion cron runs as the service role (and rejects a wrong secret)", async () => {
    const secret = process.env["HESBA_CRON_SECRET"] ?? "hesba-test-cron-secret";
    const ok = await cronRoute(
      new Request("http://localhost:3000/api/cron/catalog-promotion", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    const bad = await cronRoute(
      new Request("http://localhost:3000/api/cron/catalog-promotion", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(bad.status).toBe(401);
  });
});
