import "server-only";
import { sql } from "drizzle-orm";
import { db, type DatabaseInstance } from "./client";

export type TenantTx = Parameters<
  Parameters<DatabaseInstance["transaction"]>[0]
>[0];

export async function withTenant<T>(
  storeId: string,
  userId: string | null,
  fn: (tx: TenantTx) => Promise<T>,
  customDb: DatabaseInstance = db,
): Promise<T> {
  return await customDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.store_id', ${storeId}, true)`);
    if (userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return await fn(tx);
  });
}
