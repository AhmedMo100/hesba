---
name: market-data
description: Product catalog ingestion, CSV templates, dry-run validation, duplicate reporting without silent merging, and zero invented prices.
---

# Market Data & Catalog Import Skill

## When to Use

- Managing, formatting, or creating CSV files under `data/catalog/*.csv`.
- Running or modifying the catalog import script `pnpm catalog:import` (`scripts/catalog-import.ts`).
- Designing or modifying `global_products` or catalog suggestion queries.
- Auditing barcode and product metadata accuracy.

## Core Rules & Principles

1. **Never Invent Data or Prices**:
   - The global product catalog NEVER contains prices, stock levels, or store identifiers.
   - Prices and inventory belong exclusively to individual stores and are never shared.
   - If an attribute (e.g. weight, brand, category) is unknown, do not fabricate numbers or descriptions. Leave it null or use an empty string as specified in the schema.
2. **CSV Template Compliance**:
   - Catalog files live under `data/catalog/` as UTF-8 encoded CSV.
   - Required columns: `barcode`, `name_ar`, `category`, `unit`, `size_value`, `size_unit`, `pack_quantity`.
3. **Dry-Run First**:
   - Any catalog ingestion must execute with `--dry-run` before applying database changes.
   - The dry-run validates row syntax, types, barcode formats (EAN-13, EAN-8, UPC), and reports discrepancies.
4. **Duplicates Are Reported, Not Merged**:
   - If duplicate barcodes appear within the CSV file or clash with existing records, the script MUST report the duplicate with row numbers and details.
   - Silently merging, overwriting, or averaging values across duplicate barcodes is strictly forbidden.

## Implementation Steps

### 1. CSV Structure Template

`data/catalog/products.csv`:

```csv
barcode,name_ar,category,unit,size_value,size_unit,pack_quantity
6221000000001,شاي العروسة ناعم 250 جم,مشروبات,piece,250,g,1
6221000000002,شيبسي بالملح 50 جم,سناكس,piece,50,g,1
```

### 2. Validation with Zod Schema

```ts
import { z } from "zod";

export const catalogRowSchema = z.object({
  barcode: z.string().regex(/^\d{8,14}$/, "Barcode must be 8-14 digits"),
  name_ar: z.string().min(2, "Arabic name required"),
  category: z.string().min(2),
  unit: z.enum(["piece", "weight"]),
  size_value: z.coerce.number().positive().nullable(),
  size_unit: z.enum(["g", "kg", "ml", "l", "piece"]).nullable(),
  pack_quantity: z.coerce.number().int().positive().default(1),
});
```

### 3. Dry-Run Import Execution Pattern

In `scripts/catalog-import.ts`:

```ts
interface ImportReport {
  totalRows: number;
  validRows: number;
  invalidRows: Array<{ row: number; reason: string }>;
  duplicateBarcodes: Array<{ barcode: string; rows: number[] }>;
}

export async function importCatalog(
  csvPath: string,
  isDryRun: boolean,
): Promise<ImportReport> {
  const report: ImportReport = {
    totalRows: 0,
    validRows: 0,
    invalidRows: [],
    duplicateBarcodes: [],
  };
  const barcodeMap = new Map<string, number[]>();

  // 1. Parse and validate rows
  // 2. Track duplicate barcodes
  // 3. If duplicate found: report.duplicateBarcodes.push(...)
  // 4. If isDryRun: log report and exit with 0 (or 1 if errors)
  // 5. If !isDryRun and report has errors: abort transaction!
  return report;
}
```

### 4. Running the Import Command

```bash
# 1. Always run dry-run first
pnpm catalog:import --dry-run data/catalog/egypt-supermarket.csv

# 2. Inspect output report: 0 duplicates, 0 validation errors
# 3. Execute write only if dry-run passed completely
pnpm catalog:import data/catalog/egypt-supermarket.csv
```

## Mandatory Checks

- [ ] Does the CSV include all required columns with UTF-8 encoding?
- [ ] Are prices and shop identifiers completely absent from the catalog data?
- [ ] Did the dry-run execute first and produce a detailed diagnostic report?
- [ ] Were all duplicate barcodes logged explicitly with row numbers, and NOT merged silently?
- [ ] Is `pnpm catalog:import` idempotent and safe to re-run?

## Documentation Links

- [docs/03-data.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/03-data.md) — Part 3: Catalog and suggestions schema, barcode lookup rules.
- [docs/07-ops.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/07-ops.md) — Section 11: Global catalog import script command and runbook.
- [docs/06-quality.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/06-quality.md) — Security and privacy rules regarding catalog isolation.
