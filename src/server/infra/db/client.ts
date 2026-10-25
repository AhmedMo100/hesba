import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

if (!process.env["HESBA_DATABASE_URL"]) {
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

const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

export const queryClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export type DatabaseInstance = typeof db;

export function createDb(
  connectionUrl: string,
  options?: postgres.Options<Record<string, never>>,
) {
  const client = postgres(connectionUrl, options);
  return {
    client,
    db: drizzle(client, { schema }),
  };
}
