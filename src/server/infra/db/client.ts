import "server-only";
import { PrismaClient } from "@prisma/client";

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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type DatabaseInstance = PrismaClient;

export function createDb(connectionUrl: string) {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: connectionUrl,
      },
    },
  });
  return {
    client,
    db: client,
  };
}
