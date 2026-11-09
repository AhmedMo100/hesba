import "server-only";

/**
 * @file client.ts
 * @description Prisma clients for the server runtime.
 *
 * @responsibility
 * - `prisma`: the application client on `HESBA_DATABASE_URL` (role `hesba_app`, no RLS
 *   bypass). Use it only through `withTenant` for store data, or directly for identity tables
 *   (`users`, `sessions`, ...).
 * - `systemPrisma`: a client on `HESBA_DIRECT_URL` (the migration role) for cross-tenant work
 *   such as the community catalog and cron jobs. When `HESBA_DIRECT_URL` is not set it is the
 *   same object as `prisma`.
 * - `createDb`: builds a standalone client for scripts.
 *
 * @remarks
 * - When `HESBA_DATABASE_URL` is not in the process environment, the module tries to load
 *   `.env.local` then `.env`, and finally falls back to the local docker-compose URL.
 * - `connect_timeout` and `pool_timeout` default to 30 seconds unless the URL sets them.
 * - Outside production the `prisma` instance is cached on `globalThis` so hot reload does not
 *   open a new pool on every edit.
 */

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
