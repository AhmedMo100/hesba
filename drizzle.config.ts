import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/infra/db/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["HESBA_DIRECT_URL"] ?? "",
  },
});
