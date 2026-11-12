import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type DatabaseInstance } from "./client";

/**
 * @file tenant.ts
 * @description The tenant-isolation entry point for every store-scoped database access.
 *
 * Every tenant table has `FORCE ROW LEVEL SECURITY` with a policy comparing `store_id` to the
 * `app.store_id` session setting, and neither runtime role bypasses RLS. A query that does not
 * run inside `withTenant` therefore sees and changes no tenant rows — it fails closed rather
 * than leaking another store's data (AGENTS.md rule 4).
 */

export type TenantTx = Prisma.TransactionClient;

/**
 * Runs `fn` in one transaction whose Postgres session is bound to `storeId` (and `userId`).
 *
 * `set_config(..., true)` is transaction-local, so the binding cannot leak to another request
 * through a pooled connection. Everything `fn` does is atomic: a thrown error rolls it all back.
 *
 * @param storeId - The store whose rows `fn` may read and write (from the verified session).
 * @param userId - Acting user, exposed to policies as `app.user_id`; `null` for system work.
 * @param fn - The work to run; use only the `tx` it receives, never the global client.
 * @param customDb - Client to run on (tests pass the migrator client); defaults to the app client.
 * @param options - Prisma interactive-transaction limits (defaults: 15 s wait, 20 s run).
 */
export async function withTenant<T>(
  storeId: string,
  userId: string | null,
  fn: (tx: TenantTx) => Promise<T>,
  customDb: DatabaseInstance = prisma,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return await customDb.$transaction(
    async (tx) => {
      // One statement for both settings: on Neon every round trip costs ~63 ms (QA-32).
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId}, true), set_config('app.user_id', ${userId}, true)`;
      } else {
        await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId}, true)`;
      }
      return await fn(tx);
    },
    {
      maxWait: options?.maxWait ?? 15000,
      timeout: options?.timeout ?? 20000,
    },
  );
}
