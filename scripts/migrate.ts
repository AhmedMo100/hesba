import { execSync } from "node:child_process";

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
const databaseUrl = process.env["HESBA_DATABASE_URL"] ?? directUrl;

if (!directUrl) {
  throw new Error("Missing HESBA_DIRECT_URL environment variable.");
}

async function runMigrations() {
  console.log("Connecting with migrator role...");
  try {
    console.log("Running Prisma migrations from ./prisma/migrations...");
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: {
        ...process.env,
        HESBA_DIRECT_URL: directUrl,
        HESBA_DATABASE_URL: databaseUrl,
        DATABASE_URL: directUrl,
      },
    });
    console.log("Migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();
