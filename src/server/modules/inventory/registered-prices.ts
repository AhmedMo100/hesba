import "server-only";

/**
 * @file registered-prices.ts
 * @description The «دخلت بضاعة» form shows the product's registered buy and sell prices and
 * lets the owner change them while recording the stock. Saved in the stock-in's transaction:
 * the batch and the new prices are recorded together or not at all.
 *
 * Prices are per selling unit, as the product stores them (per kilo for `kg`, per gram for
 * `g`, per piece / jar / bag … otherwise). The product row mirrors its variant when it has one.
 */
import type { TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

export interface RegisteredPriceChange {
  sellPricePiasters?: number | null;
  buyPricePiasters?: number | null;
}

const valid = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_AMOUNT_PIASTERS) {
    throw AppError.badRequest(`${what} غير صحيح`);
  }
  return BigInt(n);
};

/** Sets the variant's (and its single-variant product's) prices when they changed. */
export async function applyRegisteredPricesInTx(
  tx: TenantTx,
  storeId: string,
  variantId: string,
  change: RegisteredPriceChange,
): Promise<void> {
  const sell =
    change.sellPricePiasters == null
      ? null
      : valid(change.sellPricePiasters, "سعر البيع");
  const buy =
    change.buyPricePiasters == null
      ? null
      : valid(change.buyPricePiasters, "سعر الشراء");
  if (sell === null && buy === null) return;
  if (sell !== null && sell <= BigInt(0)) {
    throw AppError.badRequest("سعر البيع لازم يكون أكبر من صفر");
  }

  const variant = await tx.storeVariant.findFirst({
    where: { id: variantId, storeId },
    select: {
      id: true,
      storeProductId: true,
      sellPricePiasters: true,
      buyPricePiasters: true,
    },
  });
  if (!variant) throw AppError.notFound("المنتج غير موجود");

  const data: { sellPricePiasters?: bigint; buyPricePiasters?: bigint } = {};
  if (sell !== null && sell !== variant.sellPricePiasters) {
    data.sellPricePiasters = sell;
  }
  if (buy !== null && buy !== (variant.buyPricePiasters ?? BigInt(0))) {
    data.buyPricePiasters = buy;
  }
  if (Object.keys(data).length === 0) return;

  await tx.storeVariant.update({ where: { id: variant.id }, data });
  if (variant.storeProductId) {
    const variants = await tx.storeVariant.count({
      where: { storeId, storeProductId: variant.storeProductId },
    });
    if (variants === 1) {
      await tx.storeProduct.updateMany({
        where: { id: variant.storeProductId, storeId },
        data,
      });
    }
  }
}
