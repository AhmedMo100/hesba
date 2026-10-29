import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { normalizeArabic } from "../src/domain/normalize";

interface RowError {
  rowNumber: number;
  message: string;
}

interface DuplicateReport {
  type: string;
  identifier: string;
  rows: number[];
}

interface FileReport {
  fileName: string;
  totalRows: number;
  validRows: number;
  skippedRows: Array<{ rowNumber: number; reason: string }>;
  errors: RowError[];
  duplicates: DuplicateReport[];
}

const VALID_SIZE_UNITS = new Set(["g", "kg", "ml", "l", "piece"]);
const VALID_PRODUCT_TYPES = new Set(["stock", "prepaid", "service"]);
const VALID_COMMISSION_FEE_TYPES = new Set(["fixed", "percent"]);
const VALID_BILL_TYPES = new Set([
  "internet",
  "mobile",
  "landline",
  "electricity",
  "gas",
  "water",
  "other",
]);

const REQUIRED_HEADERS: Record<string, string[]> = {
  "brands.csv": ["name_ar", "name_en"],
  "products.csv": ["brand_name_ar", "product_name_ar", "category", "type"],
  "variants.csv": [
    "product_name_ar",
    "brand_name_ar",
    "flavor",
    "size_value",
    "size_unit",
    "pack_qty",
  ],
  "prepaid_cards.csv": [
    "network",
    "denomination_piasters",
    "sell_price_piasters",
    "cost_piasters",
  ],
  "bills.csv": ["provider", "bill_type", "label_ar"],
  "transfer_commissions.csv": [
    "provider",
    "from_amount_piasters",
    "to_amount_piasters",
    "fee_type",
    "fee_value",
  ],
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content: string): {
  headers: string[];
  rows: Array<{ rowNumber: number; data: Record<string, string> }>;
} {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const firstLine = lines[0] ?? "";
  const headers = parseCSVLine(firstLine);
  const rows: Array<{ rowNumber: number; data: Record<string, string> }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const values = parseCSVLine(line);
    const data: Record<string, string> = {};
    headers.forEach((h, idx) => {
      data[h] = values[idx]?.trim() ?? "";
    });
    rows.push({ rowNumber: i + 1, data });
  }
  return { headers, rows };
}

export function validateCatalogFile(
  fileName: string,
  content: string,
): { report: FileReport; validDataRows: Array<Record<string, string>> } {
  const { headers, rows } = parseCSV(content);
  const report: FileReport = {
    fileName,
    totalRows: rows.length,
    validRows: 0,
    skippedRows: [],
    errors: [],
    duplicates: [],
  };

  const expectedHeaders = REQUIRED_HEADERS[fileName];
  if (!expectedHeaders) {
    report.errors.push({
      rowNumber: 1,
      message: `Unknown catalog file type: ${fileName}`,
    });
    return { report, validDataRows: [] };
  }

  const missingHeaders = expectedHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    report.errors.push({
      rowNumber: 1,
      message: `Missing required header columns: ${missingHeaders.join(", ")}`,
    });
    return { report, validDataRows: [] };
  }

  const variantKeyMap = new Map<string, number[]>();
  const productKeyMap = new Map<string, number[]>();
  const brandNameMap = new Map<string, number[]>();
  const validDataRows: Array<Record<string, string>> = [];

  for (const { rowNumber, data } of rows) {
    const isAllEmpty = Object.values(data).every((val) => val === "");
    if (isAllEmpty) {
      report.skippedRows.push({
        rowNumber,
        reason: "Row is completely empty (no values)",
      });
      continue;
    }

    let hasRowError = false;

    if (fileName === "brands.csv") {
      const nameAr = data["name_ar"] ?? "";
      if (!nameAr) {
        report.skippedRows.push({
          rowNumber,
          reason: "Empty value in required field 'name_ar'",
        });
        continue;
      }
      const norm = normalizeArabic(nameAr);
      const existing = brandNameMap.get(norm) || [];
      existing.push(rowNumber);
      brandNameMap.set(norm, existing);
    } else if (fileName === "products.csv") {
      const required = ["product_name_ar", "category", "type"];
      const missing = required.filter((f) => !(data[f] ?? ""));
      if (missing.length > 0) {
        report.skippedRows.push({
          rowNumber,
          reason: `Empty value in required field(s): ${missing.join(", ")}`,
        });
        continue;
      }

      const productType = data["type"] ?? "";
      if (!VALID_PRODUCT_TYPES.has(productType)) {
        report.errors.push({
          rowNumber,
          message: `Invalid product type "${productType}". Must be one of: stock, prepaid, service.`,
        });
        hasRowError = true;
      }

      const prodName = data["product_name_ar"] ?? "";
      const brandName = data["brand_name_ar"] ?? "";
      const key = `${brandName}::${normalizeArabic(prodName)}`;
      const existing = productKeyMap.get(key) || [];
      existing.push(rowNumber);
      productKeyMap.set(key, existing);
    } else if (fileName === "variants.csv") {
      const prodName = data["product_name_ar"] ?? "";
      if (!prodName) {
        report.skippedRows.push({
          rowNumber,
          reason: "Empty value in required field 'product_name_ar'",
        });
        continue;
      }

      const sizeValStr = data["size_value"] ?? "";
      if (sizeValStr) {
        const val = Number(sizeValStr);
        if (isNaN(val) || val <= 0) {
          report.errors.push({
            rowNumber,
            message: `size_value must be a positive number, received: "${sizeValStr}"`,
          });
          hasRowError = true;
        }
      }

      const sizeUnitStr = data["size_unit"] ?? "";
      if (sizeUnitStr && !VALID_SIZE_UNITS.has(sizeUnitStr)) {
        report.errors.push({
          rowNumber,
          message: `Invalid size_unit "${sizeUnitStr}". Must be one of: ${Array.from(VALID_SIZE_UNITS).join(", ")}.`,
        });
        hasRowError = true;
      }

      const packQtyStr = data["pack_qty"] ?? "";
      if (packQtyStr) {
        const qty = Number(packQtyStr);
        if (!Number.isInteger(qty) || qty <= 0) {
          report.errors.push({
            rowNumber,
            message: `pack_qty must be a positive whole number, received: "${packQtyStr}"`,
          });
          hasRowError = true;
        }
      }

      const brandName = data["brand_name_ar"] ?? "";
      const flavorStr = data["flavor"] ?? "";
      const variantKey = `${brandName}::${prodName}::${flavorStr}::${sizeValStr}::${sizeUnitStr}::${packQtyStr || "1"}`;
      const existing = variantKeyMap.get(variantKey) || [];
      existing.push(rowNumber);
      variantKeyMap.set(variantKey, existing);
    } else if (fileName === "prepaid_cards.csv") {
      const required = [
        "network",
        "denomination_piasters",
        "sell_price_piasters",
        "cost_piasters",
      ];
      const missing = required.filter((f) => !(data[f] ?? ""));
      if (missing.length > 0) {
        report.skippedRows.push({
          rowNumber,
          reason: `Empty value in required field(s): ${missing.join(", ")}`,
        });
        continue;
      }

      const piastersFields = [
        "denomination_piasters",
        "sell_price_piasters",
        "cost_piasters",
      ];
      for (const f of piastersFields) {
        const fieldStr = data[f] ?? "";
        const val = Number(fieldStr);
        if (!Number.isInteger(val) || val <= 0) {
          report.errors.push({
            rowNumber,
            message: `${f} must be a positive integer in piasters, received: "${fieldStr}"`,
          });
          hasRowError = true;
        }
      }

      const validityDaysStr = data["validity_days"] ?? "";
      if (validityDaysStr) {
        const val = Number(validityDaysStr);
        if (!Number.isInteger(val) || val <= 0) {
          report.errors.push({
            rowNumber,
            message: `validity_days must be a positive integer, received: "${validityDaysStr}"`,
          });
          hasRowError = true;
        }
      }
    } else if (fileName === "bills.csv") {
      const required = ["provider", "bill_type", "label_ar"];
      const missing = required.filter((f) => !(data[f] ?? ""));
      if (missing.length > 0) {
        report.skippedRows.push({
          rowNumber,
          reason: `Empty value in required field(s): ${missing.join(", ")}`,
        });
        continue;
      }

      const billType = data["bill_type"] ?? "";
      if (!VALID_BILL_TYPES.has(billType)) {
        report.errors.push({
          rowNumber,
          message: `Invalid bill_type "${billType}". Must be one of: ${Array.from(VALID_BILL_TYPES).join(", ")}.`,
        });
        hasRowError = true;
      }
    } else if (fileName === "transfer_commissions.csv") {
      const required = [
        "provider",
        "from_amount_piasters",
        "to_amount_piasters",
        "fee_type",
        "fee_value",
      ];
      const missing = required.filter((f) => !(data[f] ?? ""));
      if (missing.length > 0) {
        report.skippedRows.push({
          rowNumber,
          reason: `Empty value in required field(s): ${missing.join(", ")}`,
        });
        continue;
      }

      const fromValStr = data["from_amount_piasters"] ?? "";
      const toValStr = data["to_amount_piasters"] ?? "";
      const fromVal = Number(fromValStr);
      const toVal = Number(toValStr);
      if (!Number.isInteger(fromVal) || fromVal < 0) {
        report.errors.push({
          rowNumber,
          message: `from_amount_piasters must be a non-negative integer, received: "${fromValStr}"`,
        });
        hasRowError = true;
      }
      if (!Number.isInteger(toVal) || toVal < fromVal) {
        report.errors.push({
          rowNumber,
          message: `to_amount_piasters must be an integer >= from_amount_piasters, received: "${toValStr}"`,
        });
        hasRowError = true;
      }
      const feeTypeStr = data["fee_type"] ?? "";
      if (!VALID_COMMISSION_FEE_TYPES.has(feeTypeStr)) {
        report.errors.push({
          rowNumber,
          message: `fee_type must be 'fixed' or 'percent', received: "${feeTypeStr}"`,
        });
        hasRowError = true;
      }
      const feeValStr = data["fee_value"] ?? "";
      const feeVal = Number(feeValStr);
      if (isNaN(feeVal) || feeVal < 0) {
        report.errors.push({
          rowNumber,
          message: `fee_value must be a non-negative number, received: "${feeValStr}"`,
        });
        hasRowError = true;
      }
    }

    if (!hasRowError) {
      report.validRows++;
      validDataRows.push(data);
    }
  }

  // Check duplicates and report them - NEVER MERGE!
  for (const [variantKey, rowNums] of variantKeyMap.entries()) {
    if (rowNums.length > 1) {
      report.duplicates.push({
        type: "variant",
        identifier: variantKey,
        rows: rowNums,
      });
      report.errors.push({
        rowNumber: rowNums[0] ?? 0,
        message: `Duplicate variant "${variantKey}" found on rows: ${rowNums.join(", ")}. Duplicates are NEVER merged.`,
      });
    }
  }

  for (const [productKey, rowNums] of productKeyMap.entries()) {
    if (rowNums.length > 1) {
      report.duplicates.push({
        type: "product",
        identifier: productKey,
        rows: rowNums,
      });
      report.errors.push({
        rowNumber: rowNums[0] ?? 0,
        message: `Duplicate product "${productKey}" found on rows: ${rowNums.join(", ")}. Duplicates are NEVER merged.`,
      });
    }
  }

  for (const [brandName, rowNums] of brandNameMap.entries()) {
    if (rowNums.length > 1) {
      report.duplicates.push({
        type: "brand",
        identifier: brandName,
        rows: rowNums,
      });
      report.errors.push({
        rowNumber: rowNums[0] ?? 0,
        message: `Duplicate brand "${brandName}" found on rows: ${rowNums.join(", ")}. Duplicates are NEVER merged.`,
      });
    }
  }

  return { report, validDataRows };
}

async function applyFileTransaction(
  sql: postgres.Sql,
  fileName: string,
  rows: Array<Record<string, string>>,
): Promise<number> {
  let insertedCount = 0;
  await sql.begin(async (tx) => {
    if (fileName === "brands.csv") {
      for (const row of rows) {
        const nameAr = row["name_ar"] ?? "";
        if (!nameAr) continue;
        const nameEn = row["name_en"] ? row["name_en"] : null;
        const res = await tx`
          INSERT INTO brands (name_ar, name_en)
          VALUES (${nameAr}, ${nameEn})
          ON CONFLICT (name_ar) DO NOTHING
          RETURNING id;
        `;
        if (res.length > 0) insertedCount++;
      }
    } else if (fileName === "products.csv") {
      for (const row of rows) {
        let brandId: string | null = null;
        const brandNameAr = row["brand_name_ar"] ?? "";
        if (brandNameAr) {
          const brandRes = await tx`
            SELECT id FROM brands WHERE name_ar = ${brandNameAr} LIMIT 1;
          `;
          if (brandRes.length > 0 && brandRes[0]) {
            brandId = brandRes[0].id;
          }
        }
        const name = row["product_name_ar"] ?? "";
        if (!name) continue;
        const nameNorm = normalizeArabic(name);
        const category = row["category"] ?? "";
        const type = row["type"] ?? "stock";

        const existing = await tx`
          SELECT id FROM global_products
          WHERE (brand_id = ${brandId} OR (brand_id IS NULL AND ${brandId} IS NULL))
            AND name_ar = ${name}
          LIMIT 1;
        `;
        if (existing.length === 0) {
          const res = await tx`
            INSERT INTO global_products (brand_id, name_ar, name_norm, category, type)
            VALUES (${brandId}, ${name}, ${nameNorm}, ${category}, ${type}::global_product_type)
            RETURNING id;
          `;
          if (res.length > 0) insertedCount++;
        }
      }
    } else if (fileName === "variants.csv") {
      for (const row of rows) {
        const prodName = row["product_name_ar"] ?? "";
        if (!prodName) continue;
        const prodRes = await tx`
          SELECT id FROM global_products WHERE name_ar = ${prodName} LIMIT 1;
        `;
        if (prodRes.length === 0 || !prodRes[0]) continue;
        const productId = prodRes[0].id;
        const flavor = row["flavor"] ? row["flavor"] : null;
        const sizeValue = row["size_value"] ? row["size_value"] : null;
        const sizeUnit = row["size_unit"] ? row["size_unit"] : null;
        const packQtyStr = row["pack_qty"] ?? "";
        const packQty = packQtyStr ? parseInt(packQtyStr, 10) : 1;
        const nameNorm = normalizeArabic(
          [prodName, flavor, sizeValue, sizeUnit].filter(Boolean).join(" "),
        );

        const existing = await tx`
          SELECT id FROM global_variants
          WHERE global_product_id = ${productId}
            AND (flavor = ${flavor} OR (flavor IS NULL AND ${flavor} IS NULL))
            AND (size_value = ${sizeValue}::numeric OR (size_value IS NULL AND ${sizeValue} IS NULL))
            AND (size_unit = ${sizeUnit} OR (size_unit IS NULL AND ${sizeUnit} IS NULL))
            AND pack_qty = ${packQty}
          LIMIT 1;
        `;
        if (existing.length === 0) {
          const res = await tx`
            INSERT INTO global_variants (global_product_id, flavor, size_value, size_unit, pack_qty, name_norm)
            VALUES (${productId}, ${flavor}, ${sizeValue}, ${sizeUnit}, ${packQty}, ${nameNorm})
            RETURNING id;
          `;
          if (res.length > 0) insertedCount++;
        }
      }
    } else if (fileName === "prepaid_cards.csv") {
      for (const row of rows) {
        const network = row["network"] ?? "";
        const denominationStr = row["denomination_piasters"] ?? "0";
        const costPiastersStr = row["cost_piasters"]
          ? row["cost_piasters"]
          : null;
        const dataPackage = row["data_package_ar"] || null;
        const validityDays = row["validity_days"]
          ? parseInt(row["validity_days"], 10)
          : null;

        const existing = await tx`
          SELECT id FROM prepaid_products
          WHERE network = ${network} AND denomination_piasters = ${denominationStr}::bigint
          LIMIT 1;
        `;
        if (existing.length === 0) {
          await tx`
            INSERT INTO prepaid_products (network, denomination_piasters, data_package_ar, validity_days, cost_piasters)
            VALUES (${network}, ${denominationStr}::bigint, ${dataPackage}, ${validityDays}, ${costPiastersStr ? `${costPiastersStr}::bigint` : null});
          `;
          insertedCount++;
        }
      }
    } else if (fileName === "bills.csv") {
      for (const row of rows) {
        const labelAr = row["label_ar"] ?? "";
        const billType = row["bill_type"] ?? "other";
        if (!labelAr) continue;

        const existing = await tx`
          SELECT id FROM bill_providers
          WHERE name_ar = ${labelAr} AND bill_type = ${billType}::bill_type
          LIMIT 1;
        `;
        if (existing.length === 0) {
          await tx`
            INSERT INTO bill_providers (name_ar, bill_type)
            VALUES (${labelAr}, ${billType}::bill_type);
          `;
          insertedCount++;
        }
      }
    } else if (fileName === "transfer_commissions.csv") {
      for (const row of rows) {
        const provider = row["provider"] ?? "";
        const fromAmtStr = row["from_amount_piasters"] ?? "0";
        const toAmtStr = row["to_amount_piasters"] ?? "0";
        const fromAmt = parseInt(fromAmtStr, 10);
        const toAmt = parseInt(toAmtStr, 10);
        const feeType = row["fee_type"] ?? "fixed";
        const feeVal = row["fee_value"] ?? "0";
        const existing = await tx`
          SELECT id FROM commission_rules
          WHERE provider = ${provider} AND kind = 'transfer'
            AND from_amount_piasters = ${fromAmt} AND to_amount_piasters = ${toAmt}
          LIMIT 1;
        `;
        if (existing.length === 0) {
          await tx`
            INSERT INTO commission_rules (provider, kind, from_amount_piasters, to_amount_piasters, fee_type, fee_value)
            VALUES (${provider}, 'transfer', ${fromAmt}, ${toAmt}, ${feeType}::commission_fee_type, ${feeVal});
          `;
          insertedCount++;
        }
      }
    }
  });
  return insertedCount;
}

export async function runCatalogImport(args: string[]): Promise<number> {
  const isApply = args.includes("--apply");
  const isDryRun = !isApply || args.includes("--dry-run");

  // Filter out flag args to find target directory or file
  const pathArgs = args.filter((arg) => !arg.startsWith("--"));
  const targetPath = pathArgs[0] || "data/catalog/";

  console.log("==================================================");
  console.log(`Hesba Catalog Seed Tooling`);
  console.log(
    `Mode: ${isDryRun ? "--dry-run (Validation Only)" : "--apply (Database Write)"}`,
  );
  console.log(`Target: ${targetPath}`);
  console.log("==================================================");

  let filesToProcess: string[] = [];
  if (fs.existsSync(targetPath)) {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const allFiles = fs.readdirSync(targetPath);
      filesToProcess = allFiles
        .filter((f) => f.endsWith(".csv"))
        .map((f) => path.join(targetPath, f));
    } else {
      filesToProcess = [targetPath];
    }
  } else {
    console.error(`Error: Path does not exist: ${targetPath}`);
    return 1;
  }

  if (filesToProcess.length === 0) {
    console.log("No CSV catalog files found to process.");
    return 0;
  }

  let totalErrors = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalValid = 0;

  let directSql: postgres.Sql | null = null;
  if (isApply) {
    if (!process.env["HESBA_DIRECT_URL"]) {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        try {
          process.loadEnvFile(".env");
        } catch {
          // ignore
        }
      }
    }
    const directUrl = process.env["HESBA_DIRECT_URL"];
    if (!directUrl) {
      console.error("Missing HESBA_DIRECT_URL for --apply mode.");
      return 1;
    }
    directSql = postgres(directUrl);
  }

  try {
    for (const filePath of filesToProcess) {
      const fileName = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const { report, validDataRows } = validateCatalogFile(fileName, content);

      console.log(`\n📄 [${fileName}]`);
      console.log(`   Total rows: ${report.totalRows}`);
      console.log(`   Valid rows: ${report.validRows}`);
      console.log(`   Skipped rows (empty): ${report.skippedRows.length}`);
      console.log(`   Errors: ${report.errors.length}`);
      console.log(`   Duplicates: ${report.duplicates.length}`);

      for (const skipped of report.skippedRows) {
        console.log(`   [Row ${skipped.rowNumber}] SKIPPED: ${skipped.reason}`);
      }

      for (const err of report.errors) {
        console.log(`   [Row ${err.rowNumber}] ERROR: ${err.message}`);
      }

      for (const dup of report.duplicates) {
        console.log(
          `   [Duplicate ${dup.type}] "${dup.identifier}" found on rows: ${dup.rows.join(", ")} (NEVER merged)`,
        );
      }

      totalErrors += report.errors.length;
      totalDuplicates += report.duplicates.length;
      totalSkipped += report.skippedRows.length;
      totalValid += report.validRows;

      if (isApply && directSql) {
        if (report.errors.length > 0) {
          console.error(
            `❌ File ${fileName} has errors. Aborting transaction for this file.`,
          );
        } else if (validDataRows.length === 0) {
          console.log(
            `ℹ️  No data rows to apply for ${fileName}. Skipping database write.`,
          );
        } else {
          console.log(
            `⏳ Applying ${validDataRows.length} rows to database...`,
          );
          const inserted = await applyFileTransaction(
            directSql,
            fileName,
            validDataRows,
          );
          console.log(`✅ Applied ${inserted} new rows for ${fileName}.`);
        }
      }
    }
  } finally {
    if (directSql) {
      await directSql.end();
    }
  }

  console.log("\n==================================================");
  console.log("Catalog Import Summary:");
  console.log(`Valid Rows Processed: ${totalValid}`);
  console.log(`Empty/Skipped Rows:   ${totalSkipped}`);
  console.log(`Validation Errors:    ${totalErrors}`);
  console.log(`Duplicates Found:     ${totalDuplicates}`);
  console.log("==================================================");

  if (totalErrors > 0) {
    return 1;
  }
  return 0;
}

if (process.argv[1]?.endsWith("import-catalog.ts")) {
  runCatalogImport(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
