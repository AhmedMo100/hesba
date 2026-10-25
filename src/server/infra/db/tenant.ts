import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type DatabaseInstance } from "./client";

export type TenantTx = Prisma.TransactionClient;

export async function withTenant<T>(
  storeId: string,
  userId: string | null,
  fn: (tx: TenantTx) => Promise<T>,
  customDb: DatabaseInstance = prisma,
): Promise<T> {
  return await customDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId}, true)`;
    if (userId) {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    }
    return await fn(tx);
  });
}
