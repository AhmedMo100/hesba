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

function ensureConnectionTimeouts(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "30");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const rawDatabaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

const databaseUrl = ensureConnectionTimeouts(rawDatabaseUrl);

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

const rawDirectUrl = process.env["HESBA_DIRECT_URL"];
export const systemPrisma = rawDirectUrl
  ? new PrismaClient({
      datasources: {
        db: {
          url: ensureConnectionTimeouts(rawDirectUrl),
        },
      },
    })
  : prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type DatabaseInstance = PrismaClient;

export function createDb(connectionUrl: string) {
  const finalUrl = ensureConnectionTimeouts(connectionUrl);
  const client = new PrismaClient({
    datasources: {
      db: {
        url: finalUrl,
      },
    },
  });
  return {
    client,
    db: client,
  };
}
