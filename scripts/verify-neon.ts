import postgres from "postgres";

async function main() {
  const directUrl = process.env["HESBA_DIRECT_URL"];
  if (!directUrl) {
    console.error("Missing HESBA_DIRECT_URL");
    process.exit(1);
  }

  const sql = postgres(directUrl, { max: 1 });

  try {
    const roles = await sql<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>
    >`
      SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
      FROM pg_roles
      WHERE rolname IN ('hesba_migrator', 'hesba_app')
      ORDER BY rolname
    `;

    console.log("=== Role Privilege Verification on Neon ===");
    for (const r of roles) {
      console.log(`Role: ${r.rolname}`);
      console.log(`  LOGIN: ${r.rolcanlogin}`);
      console.log(`  SUPERUSER: ${r.rolsuper}`);
      console.log(`  CREATEDB: ${r.rolcreatedb}`);
      console.log(`  CREATEROLE: ${r.rolcreaterole}`);
      console.log(`  BYPASSRLS: ${r.rolbypassrls}`);
    }

    const migrator = roles.find((r) => r.rolname === "hesba_migrator");
    if (migrator) {
      console.log(
        `hesba_migrator has CREATEDB: ${migrator.rolcreatedb ? "yes" : "no"}`,
      );
    }

    // Verify current database and region/version
    const [dbInfo] = await sql<
      Array<{ current_database: string; version: string }>
    >`
      SELECT current_database(), version()
    `;
    console.log(`Connected to database: ${dbInfo?.current_database}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
