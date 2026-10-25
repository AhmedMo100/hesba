---
name: money-units
description: Precision math rules for money in integer piasters, inventory quantities in integer base units, and FEFO batch depletion.
---

# Money, Units & FEFO Inventory Skill

## When to Use

- Designing or modifying schemas for products, variants, prices, sales, discounts, batches, or expenses.
- Writing financial calculation logic (cart totals, customer debt, profit, commissions).
- Handling inventory depletion, batch allocation, and sales voids or returns.
- Writing property-based tests for stock conservation.

## Core Rules & Principles

1. **Money is Always Integer Piasters**:
   - Currency is stored and calculated in integer piasters (1 EGP = 100 piasters).
   - Floating-point arithmetic (`0.1 + 0.2`) for money is strictly prohibited.
   - Database column type is `integer` or `bigint`. Zod schema is `z.number().int()`.
2. **Quantities in Integer Base Units**:
   - Pieces: integer piece count (1, 2, 10).
   - Weighed items (cheese, produce, meat): integer grams (e.g. 1.5 kg is stored as `1500` grams).
   - Variant conversions (cartons/packs): variant defines integer `pack_quantity` in base units (e.g., pack of 24 pieces).
3. **Batches + Append-Only Movements**:
   - Inventory is never modified via in-place row updates.
   - Stock enters via batch creation and `stock_movement` records with positive quantity.
   - Current stock is the sum of movements for each batch.
4. **FEFO (First Expired, First Out)**:
   - Depletion selects the available batch with the earliest `expiry_date`.
   - If expiry dates match or are null, fall back to FIFO (`created_at` ascending).
   - Each sale movement stores a `takes` breakdown mapping depleted batch IDs to exact quantities deducted.
5. **Void Reverses Takes (Never Delete)**:
   - Canceling a sale (`sale.void`) does not delete history.
   - It creates reversing positive movements restoring items to the exact batches recorded in the original sale's `takes`.

## Implementation Steps

### 1. Integer Piaster Arithmetic

```ts
// Calculate line item total in piasters
export function calculateLineTotal(
  unitPricePiasters: number,
  quantity: number,
): number {
  if (!Number.isInteger(unitPricePiasters) || !Number.isInteger(quantity)) {
    throw new Error("Prices and quantities must be integers");
  }
  return unitPricePiasters * quantity;
}

// Calculate discount in piasters
export function applyDiscount(
  subtotalPiasters: number,
  discountPercent: number,
): number {
  const discountPiasters = Math.round(
    (subtotalPiasters * discountPercent) / 100,
  );
  return Math.max(0, subtotalPiasters - discountPiasters);
}
```

### 2. FEFO Batch Depletion Algorithm

```ts
interface Batch {
  id: string;
  availableQty: number; // in base units (pieces or grams)
  expiryDate: string | null;
  createdAt: string;
}

export function allocateFefo(batches: Batch[], requiredQty: number) {
  // Sort by expiry_date asc (nulls last), then createdAt asc
  const sorted = [...batches].sort((a, b) => {
    if (a.expiryDate && b.expiryDate)
      return a.expiryDate.localeCompare(b.expiryDate);
    if (a.expiryDate) return -1;
    if (b.expiryDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  let remaining = requiredQty;
  const takes: Array<{ batchId: string; quantity: number }> = [];

  for (const batch of sorted) {
    if (remaining <= 0) break;
    const deduct = Math.min(batch.availableQty, remaining);
    if (deduct > 0) {
      takes.push({ batchId: batch.id, quantity: deduct });
      remaining -= deduct;
    }
  }

  if (remaining > 0) {
    throw new Error("Insufficient stock across available batches");
  }

  return takes;
}
```

### 3. Property-Based Testing with `fast-check`

In `tests/unit/inventory/fefo.test.ts`:

- Verify: Total deducted across `takes` equals `requiredQty`.
- Verify: Earliest expiring batches are always exhausted before later expiring batches.
- Verify: Sale void followed by reallocation returns identical batch states.

## Mandatory Checks

- [ ] Are all prices, costs, and fees typed as integer piasters?
- [ ] Are weighed goods stored as integer grams, not fractional kilograms?
- [ ] Are stock movements append-only with no in-place column updates?
- [ ] Does sale depletion follow FEFO ordering?
- [ ] Does `sale.void` use the recorded `takes` to restore inventory accurately?
- [ ] Do `fast-check` property tests pass for FEFO calculations?

## Documentation Links

- [docs/03-data.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/03-data.md) — Database schema for batches, movements, and takes JSON.
- [docs/01-product.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/01-product.md) — Core business rules, pricing model, and stock principles.
- [docs/06-quality.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/06-quality.md) — Property-based testing strategy with fast-check.
