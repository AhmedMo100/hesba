import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

if (!process.env["HESBA_DIRECT_URL"]) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Ignore if env file does not exist
    }
  }
}

const directUrl = process.env["HESBA_DIRECT_URL"];

if (!directUrl) {
  throw new Error("Missing HESBA_DIRECT_URL environment variable.");
}

async function runMigrations(url: string) {
  console.log("Connecting with migrator role...");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  try {
    console.log("Running Drizzle migrations from ./drizzle...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations(directUrl);
