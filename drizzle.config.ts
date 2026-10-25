import { defineConfig } from "drizzle-kit";

if (!process.env["HESBA_DIRECT_URL"]) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    try {
      process.loadEnvFile(".env");
    } catch {}
  }
}

export default defineConfig({
  schema: "./src/server/infra/db/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["HESBA_DIRECT_URL"] ?? "",
  },
});
