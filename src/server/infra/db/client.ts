import "server-only";

/**
 * @file client.ts
 * @description Prisma clients for the server runtime.
 *
 * @responsibility
 * - `prisma`: the application client on `HESBA_DATABASE_URL` (role `hesba_app`, no RLS
 *   bypass). Use it only through `withTenant` for store data, or directly for identity tables
 *   (`users`, `sessions`, ...).
 * - `servicePrisma`: the catalog-promotion cron's client on `HESBA_SERVICE_DATABASE_URL`
 *   (role `hesba_service`, narrow cross-store grants, ADR-0024); null when not configured.
 *   The migration role (`HESBA_DIRECT_URL`) is never used at runtime.
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

/**
 * The ONLY cross-store runtime connection: the catalog-promotion cron, as the least-privilege
 * `hesba_service` role (ADR-0024, QA-34). It is never the migrator (`HESBA_DIRECT_URL` is for
 * migrations only) and never used for a user's request. Null when not configured: the cron
 * then refuses to run instead of falling back to a privileged connection.
 */
const rawServiceUrl = process.env["HESBA_SERVICE_DATABASE_URL"];
export const servicePrisma: PrismaClient | null = rawServiceUrl
  ? new PrismaClient({
      datasources: { db: { url: ensureConnectionTimeouts(rawServiceUrl) } },
    })
  : null;

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
