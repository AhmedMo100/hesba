import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/server/infra/db/schema";
import { withTenant } from "@/server/infra/db/tenant";

if (!process.env["HESBA_DATABASE_URL"] || !process.env["HESBA_DIRECT_URL"]) {
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

const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";
const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";

describe("Cross-Tenant Isolation & RLS on Real Postgres", () => {
  // Migrator client for setting up test data
  let migratorClient: postgres.Sql;
  let migratorDb: ReturnType<typeof drizzle<typeof schema>>;

  // App client (hesba_app: non-superuser, NOBYPASSRLS) with connection pool
  let appPoolClient: postgres.Sql;
  let appPoolDb: ReturnType<typeof drizzle<typeof schema>>;

  // Test entities
  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  let deviceAId: string;
  let deviceBId: string;

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorDb = drizzle(migratorClient, { schema });

    // App pool with multiple connections (max: 5)
    appPoolClient = postgres(databaseUrl, { max: 5, idle_timeout: 10 });
    appPoolDb = drizzle(appPoolClient, { schema });

    // Verify app role privileges and non-superuser status
    const [roleInfo] = await appPoolClient<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;
    expect(roleInfo).toBeDefined();
    expect(roleInfo?.current_user).toBe("hesba_app");
    expect(roleInfo?.rolsuper).toBe(false);
    expect(roleInfo?.rolbypassrls).toBe(false);

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();
    deviceAId = crypto.randomUUID();
    deviceBId = crypto.randomUUID();

    const runId = Math.random().toString(36).substring(2, 8);
    const phoneA = `+20101${runId}`;
    const phoneB = `+20102${runId}`;

    // Create test users via migrator (users table has no RLS)
    await migratorDb.insert(schema.users).values([
      {
        id: userAId,
        name: "Shop Owner A",
        phone: phoneA,
        passwordHash: "argon2id$mockhashA",
      },
      {
        id: userBId,
        name: "Shop Owner B",
        phone: phoneB,
        passwordHash: "argon2id$mockhashB",
      },
    ]);

    // Create Store A, membership, and device under Store A tenant context
    await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        await tx.insert(schema.stores).values({
          id: storeAId,
          name: "Supermarket Al-Amal",
          shopType: "سوبرماركت",
          governorate: "Cairo",
          area: "Nasr City",
          createdBy: userAId,
        });

        await tx.insert(schema.storeMembers).values({
          storeId: storeAId,
          userId: userAId,
          role: "owner",
        });

        await tx.insert(schema.devices).values({
          id: deviceAId,
          storeId: storeAId,
          userId: userAId,
          label: "Cashier Phone A",
          appVersion: "1.0.0",
        });
      },
      migratorDb,
    );

    // Create Store B, membership, and device under Store B tenant context
    await withTenant(
      storeBId,
      userBId,
      async (tx) => {
        await tx.insert(schema.stores).values({
          id: storeBId,
          name: "Grocery Al-Nour",
          shopType: "بقالة",
          governorate: "Giza",
          area: "Dokki",
          createdBy: userBId,
        });

        await tx.insert(schema.storeMembers).values({
          storeId: storeBId,
          userId: userBId,
          role: "owner",
        });

        await tx.insert(schema.devices).values({
          id: deviceBId,
          storeId: storeBId,
          userId: userBId,
          label: "Cashier Phone B",
          appVersion: "1.0.0",
        });
      },
      migratorDb,
    );
  });

  afterAll(async () => {
    // Clean up test fixtures using migrator with temporary RLS bypass for teardown
    if (storeAId && storeBId) {
      await migratorClient.unsafe(`
        ALTER TABLE devices DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stores DISABLE ROW LEVEL SECURITY;
        DELETE FROM devices WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_members WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stores WHERE id IN ('${storeAId}', '${storeBId}');
        ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
        ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
      `);
    }
    if (userAId && userBId) {
      await migratorClient`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    }

    await appPoolClient.end();
    await migratorClient.end();
  });

  /**
   * Main tenant isolation assertions:
   * 1. The result set must contain ONLY the current tenant's row (length 1).
   * 2. The returned row must belong to expectedStoreId.
   * 3. No rows from hiddenStoreId may be present.
   */
  function assertStoreIsolation(
    rows: Array<{ storeId?: string; store_id?: string; id?: string }>,
    expectedStoreId: string,
    hiddenStoreId: string,
  ) {
    expect(rows).toHaveLength(1);
    const rowStoreId = rows[0]?.storeId ?? rows[0]?.store_id;
    expect(rowStoreId).toBe(expectedStoreId);
    expect(rows.some((r) => (r.storeId ?? r.store_id) === hiddenStoreId)).toBe(
      false,
    );
  }

  describe("1. With RLS Enabled: Store A cannot access Store B's data", () => {
    it("Store A query on devices returns only device A and hides device B", async () => {
      const result = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx.select().from(schema.devices);
        },
        appPoolDb,
      );

      // Main isolation assertions pass when RLS is enabled
      assertStoreIsolation(result, storeAId, storeBId);
      expect(result[0]!.id).toBe(deviceAId);
    });

    it("Store A cannot select Store B's device by explicit ID", async () => {
      const result = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.id, deviceBId));
        },
        appPoolDb,
      );

      expect(result).toHaveLength(0);
    });

    it("Store A query on stores returns only Store A", async () => {
      const result = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx.select().from(schema.stores);
        },
        appPoolDb,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(storeAId);
      expect(result[0]!.name).toBe("Supermarket Al-Amal");
    });

    it("Store A query on store_members returns only Store A members", async () => {
      const result = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx.select().from(schema.storeMembers);
        },
        appPoolDb,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.storeId).toBe(storeAId);
      expect(result[0]!.userId).toBe(userAId);
    });

    it("Store A cannot update Store B's device (affects 0 rows)", async () => {
      const updated = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .update(schema.devices)
            .set({ label: "Tampered Label" })
            .where(eq(schema.devices.id, deviceBId))
            .returning();
        },
        appPoolDb,
      );

      expect(updated).toHaveLength(0);

      // Verify device B remains unchanged under Store B's context
      const [actualDeviceB] = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.id, deviceBId));
        },
        appPoolDb,
      );
      expect(actualDeviceB).toBeDefined();
      expect(actualDeviceB?.label).toBe("Cashier Phone B");
    });

    it("Store A cannot delete Store B's device (affects 0 rows)", async () => {
      const deleted = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .delete(schema.devices)
            .where(eq(schema.devices.id, deviceBId))
            .returning();
        },
        appPoolDb,
      );

      expect(deleted).toHaveLength(0);

      // Verify device B still exists under Store B's context
      const [actualDeviceB] = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.id, deviceBId));
        },
        appPoolDb,
      );
      expect(actualDeviceB).toBeDefined();
    });

    it("Store A cannot insert a device with Store B's ID (RLS check violation)", async () => {
      let thrownError: unknown;
      try {
        await withTenant(
          storeAId,
          userAId,
          async (tx) => {
            return await tx.insert(schema.devices).values({
              storeId: storeBId, // Attempting to insert under Store B while in Store A context
              userId: userAId,
              label: "Malicious Device",
            });
          },
          appPoolDb,
        );
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      const errorObj = thrownError as {
        message?: string;
        cause?: { message?: string };
      };
      const combinedMessage = `${errorObj.message ?? ""} ${errorObj.cause?.message ?? ""}`;
      expect(combinedMessage).toMatch(/row-level security/i);
    });
  });

  describe("2. With RLS Enabled: Store B cannot access Store A's data", () => {
    it("Store B query on devices returns only device B and hides device A", async () => {
      const result = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx.select().from(schema.devices);
        },
        appPoolDb,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(deviceBId);
      expect(result[0]!.storeId).toBe(storeBId);
    });

    it("Store B cannot select Store A's device by explicit ID", async () => {
      const result = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.id, deviceAId));
        },
        appPoolDb,
      );

      expect(result).toHaveLength(0);
    });

    it("Store B query on stores returns only Store B", async () => {
      const result = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx.select().from(schema.stores);
        },
        appPoolDb,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(storeBId);
      expect(result[0]!.name).toBe("Grocery Al-Nour");
    });
  });

  describe("3. Connection Pooling: withTenant through a pooled connection string", () => {
    it("concurrent interleaved queries across pool connections never leak tenant context", async () => {
      // Run 20 concurrent queries alternating between Store A and Store B
      const tasks = Array.from({ length: 20 }, (_, idx) => {
        const isStoreA = idx % 2 === 0;
        const targetStoreId = isStoreA ? storeAId : storeBId;
        const targetUserId = isStoreA ? userAId : userBId;
        const expectedDeviceId = isStoreA ? deviceAId : deviceBId;

        return withTenant(
          targetStoreId,
          targetUserId,
          async (tx) => {
            // Slight artificial jitter to interleave pool connection checkout
            await tx.execute(sql`SELECT pg_sleep(0.005)`);
            const rows = await tx.select().from(schema.devices);
            return { isStoreA, rows, expectedDeviceId };
          },
          appPoolDb,
        );
      });

      const results = await Promise.all(tasks);

      for (const res of results) {
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]!.id).toBe(res.expectedDeviceId);
      }
    });

    it("connection pool reuse outside withTenant has no residual tenant context", async () => {
      // 1. Run a query with withTenant for Store A
      await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          const [device] = await tx.select().from(schema.devices);
          expect(device).toBeDefined();
          expect(device?.id).toBe(deviceAId);
        },
        appPoolDb,
      );

      // 2. Query connection directly on pool outside of withTenant:
      // app.store_id MUST NOT persist because set_config was local (is_local = true)
      const [setting] = await appPoolClient<Array<{ current_store: string }>>`
        SELECT current_setting('app.store_id', true) AS current_store
      `;
      expect(setting).toBeDefined();
      expect(setting?.current_store).toBe("");

      // 3. Direct select without tenant context returns 0 rows (RLS blocks all)
      const directRows = await appPoolDb.select().from(schema.devices);
      expect(directRows).toHaveLength(0);
    });
  });

  describe("4. Negative Proof: Verification that without RLS, isolation fails", () => {
    const unprotectedTable = "devices_unprotected_test";

    beforeAll(async () => {
      // Create a test copy table without RLS
      await migratorClient.unsafe(`
        CREATE TABLE IF NOT EXISTS ${unprotectedTable} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          store_id uuid NOT NULL,
          label text NOT NULL
        );
        GRANT ALL ON ${unprotectedTable} TO hesba_app;
      `);

      // Insert rows for Store A and Store B
      await migratorClient.unsafe(`
        INSERT INTO ${unprotectedTable} (id, store_id, label) VALUES
          ('${deviceAId}', '${storeAId}', 'Unprotected Device A'),
          ('${deviceBId}', '${storeBId}', 'Unprotected Device B')
        ON CONFLICT (id) DO NOTHING;
      `);
    });

    afterAll(async () => {
      await migratorClient.unsafe(`DROP TABLE IF EXISTS ${unprotectedTable};`);
    });

    it("runs the exact isolation assertions on the unprotected copy and shows they fail in the same run", async () => {
      const unprotectedRows = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          const result = await tx.execute(
            sql.raw(`SELECT * FROM ${unprotectedTable}`),
          );
          return result as unknown as Array<{
            id: string;
            store_id: string;
            label: string;
          }>;
        },
        appPoolDb,
      );

      // Execute the exact same main isolation assertions (NOT inverted):
      // On the copy with RLS disabled, this fails with AssertionError because rows has length 2 and contains Store B data:
      let isolationAssertionError: unknown;
      try {
        assertStoreIsolation(unprotectedRows, storeAId, storeBId);
      } catch (err) {
        isolationAssertionError = err;
      }

      // Proves that the exact main isolation assertion FAILS on the unprotected copy in the same run:
      expect(isolationAssertionError).toBeDefined();
      expect((isolationAssertionError as Error).message).toMatch(
        /to have a length of 1 but got 2/i,
      );
    });
  });

  describe("5. Market Data & Services RLS Isolation and Global Read-Only Policies", () => {
    let globalProductId: string;
    let globalVariantId: string;
    let brandId: string;

    let runId: string;

    beforeAll(async () => {
      runId = Math.random().toString(36).substring(2, 8);
      // Clean up any residual test records
      await migratorClient.unsafe(`
        DELETE FROM commission_rules WHERE provider LIKE 'vodafone_test%';
        DELETE FROM brands WHERE name_ar LIKE 'جهينة تست%';
      `);

      // Seed global brand, product, and variant using migrator
      const [brand] = await migratorDb
        .insert(schema.brands)
        .values({
          nameAr: `جهينة تست ${runId}`,
          nameEn: `Juhayna Test ${runId}`,
        })
        .returning();
      brandId = brand!.id;

      const [product] = await migratorDb
        .insert(schema.globalProducts)
        .values({
          brandId,
          name: `حليب جهينة 1 لتر ${runId}`,
          nameNorm: `حليب جهينه 1 لتر ${runId}`,
          category: "ألبان",
          type: "stock",
        })
        .returning();
      globalProductId = product!.id;

      const [variant] = await migratorDb
        .insert(schema.globalVariants)
        .values({
          productId: globalProductId,
          flavor: "كامل الدسم",
          sizeValue: "1",
          sizeUnit: "l",
          packQty: 12,
          barcode: `622100${Date.now().toString().slice(-6)}`,
          nameNorm: `حليب جهينه كامل الدسم 1 لتر ${runId}`,
        })
        .returning();
      globalVariantId = variant!.id;

      // Seed a commission rule using migrator
      await migratorDb.insert(schema.commissionRules).values({
        provider: `vodafone_test_${runId}`,
        kind: "transfer",
        fromAmountPiasters: 100,
        toAmountPiasters: 50000,
        feeType: "fixed",
        feeValue: "100",
      });
    });

    afterAll(async () => {
      if (globalVariantId && globalProductId && brandId) {
        await migratorClient.unsafe(`
          DELETE FROM commission_rules WHERE provider LIKE 'vodafone_test%';
          DELETE FROM global_variants WHERE id = '${globalVariantId}';
          DELETE FROM global_products WHERE id = '${globalProductId}';
          DELETE FROM brands WHERE id = '${brandId}';
        `);
      }
    });

    it("Store A and Store B can read global catalog tables", async () => {
      const readAsStoreA = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.globalProducts)
            .where(eq(schema.globalProducts.id, globalProductId));
        },
        appPoolDb,
      );
      expect(readAsStoreA).toHaveLength(1);
      expect(readAsStoreA[0]!.name).toBe(`حليب جهينة 1 لتر ${runId}`);

      const readAsStoreB = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.globalVariants)
            .where(eq(schema.globalVariants.id, globalVariantId));
        },
        appPoolDb,
      );
      expect(readAsStoreB).toHaveLength(1);
      expect(readAsStoreB[0]!.id).toBe(globalVariantId);
    });

    it("App role (hesba_app) cannot insert into global catalog tables (read-only RLS)", async () => {
      let insertError: unknown;
      try {
        await withTenant(
          storeAId,
          userAId,
          async (tx) => {
            return await tx.insert(schema.brands).values({
              nameAr: "ماركة غير مصرح بها",
            });
          },
          appPoolDb,
        );
      } catch (err) {
        insertError = err;
      }
      expect(insertError).toBeDefined();
    });

    it("App role cannot insert into commission_rules (read-only RLS)", async () => {
      let insertError: unknown;
      try {
        await withTenant(
          storeAId,
          userAId,
          async (tx) => {
            return await tx.insert(schema.commissionRules).values({
              provider: "hacker_provider",
              kind: "transfer",
              fromAmountPiasters: 100,
              toAmountPiasters: 500,
              feeType: "fixed",
              feeValue: "0",
            });
          },
          appPoolDb,
        );
      } catch (err) {
        insertError = err;
      }
      expect(insertError).toBeDefined();
    });

    it("store_variants: Store A variant is completely hidden from Store B", async () => {
      const variantBarcode = "622998877001";
      const [storeAVariant] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.storeVariants)
            .values({
              storeId: storeAId,
              productId: globalProductId,
              globalVariantId: globalVariantId,
              barcode: variantBarcode,
              sellPricePiasters: 4500,
              isActive: true,
            })
            .returning();
        },
        appPoolDb,
      );
      expect(storeAVariant).toBeDefined();

      // Store A sees its variant
      const storeAList = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.storeVariants)
            .where(eq(schema.storeVariants.id, storeAVariant!.id));
        },
        appPoolDb,
      );
      expect(storeAList).toHaveLength(1);
      expect(storeAList[0]!.storeId).toBe(storeAId);

      // Store B query by ID returns empty
      const storeBList = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.storeVariants)
            .where(eq(schema.storeVariants.id, storeAVariant!.id));
        },
        appPoolDb,
      );
      expect(storeBList).toHaveLength(0);

      // Barcode uniqueness is per store: Store B CAN use the same barcode for its own store
      const [storeBVariant] = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .insert(schema.storeVariants)
            .values({
              storeId: storeBId,
              productId: globalProductId,
              globalVariantId: globalVariantId,
              barcode: variantBarcode,
              sellPricePiasters: 4800,
              isActive: true,
            })
            .returning();
        },
        appPoolDb,
      );
      expect(storeBVariant).toBeDefined();
      expect(storeBVariant!.storeId).toBe(storeBId);

      // But Store A inserting duplicate barcode fails unique constraint
      let dupBarcodeError: unknown;
      try {
        await withTenant(
          storeAId,
          userAId,
          async (tx) => {
            return await tx.insert(schema.storeVariants).values({
              storeId: storeAId,
              productId: globalProductId,
              barcode: variantBarcode,
              sellPricePiasters: 5000,
            });
          },
          appPoolDb,
        );
      } catch (err) {
        dupBarcodeError = err;
      }
      expect(dupBarcodeError).toBeDefined();
    });

    it("service_items & card_serials: Store A items are completely hidden from Store B", async () => {
      const [serviceItem] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.serviceItems)
            .values({
              storeId: storeAId,
              name: "كارت فودافون 10",
              provider: "vodafone",
              type: "prepaid_card",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(serviceItem).toBeDefined();

      const [serial] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.cardSerials)
            .values({
              storeId: storeAId,
              serviceItemId: serviceItem!.id,
              cardNumberEncrypted: "enc_num_test",
              pinEncrypted: "enc_pin_test",
              status: "available",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(serial).toBeDefined();

      // Store B cannot see Store A's service item or card serial
      const storeBService = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.serviceItems)
            .where(eq(schema.serviceItems.id, serviceItem!.id));
        },
        appPoolDb,
      );
      expect(storeBService).toHaveLength(0);

      const storeBSerial = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.cardSerials)
            .where(eq(schema.cardSerials.id, serial!.id));
        },
        appPoolDb,
      );
      expect(storeBSerial).toHaveLength(0);
    });
  });

  describe("6. Real Business Model RLS Isolation & Append-Only Permissions", () => {
    let testStoreProductId: string;
    let testPrepaidProductId: string;
    let testBillProviderId: string;
    let testWalletId: string;
    let testWalletTxId: string;
    let testContactId: string;
    let testDebtEntryId: string;
    let testPurchaseId: string;
    let testSaleId: string;

    beforeAll(async () => {
      // Seed global prepaid product and bill provider via migrator
      const [prepaid] = await migratorDb
        .insert(schema.prepaidProducts)
        .values({
          network: "vodafone",
          denominationPiasters: 2500,
          dataPackageAr: "باقة 25 جنيه",
          validityDays: 14,
          costPiasters: 2400,
        })
        .returning();
      testPrepaidProductId = prepaid!.id;

      const [provider] = await migratorDb
        .insert(schema.billProviders)
        .values({
          nameAr: "شركة كهرباء مصر",
          billType: "electricity",
        })
        .returning();
      testBillProviderId = provider!.id;
    });

    afterAll(async () => {
      if (testPrepaidProductId) {
        await migratorClient`DELETE FROM prepaid_products WHERE id = ${testPrepaidProductId}`;
      }
      if (testBillProviderId) {
        await migratorClient`DELETE FROM bill_providers WHERE id = ${testBillProviderId}`;
      }
    });

    it("store_products: Store A product is completely isolated from Store B", async () => {
      const [storeProduct] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.storeProducts)
            .values({
              storeId: storeAId,
              nameAr: "جبنة بيضاء دومتي 500 جم",
              category: "جبن",
              unit: "piece",
              sellPricePiasters: 3500,
            })
            .returning();
        },
        appPoolDb,
      );
      expect(storeProduct).toBeDefined();
      testStoreProductId = storeProduct!.id;

      const storeBList = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.storeProducts)
            .where(eq(schema.storeProducts.id, testStoreProductId));
        },
        appPoolDb,
      );
      expect(storeBList).toHaveLength(0);
    });

    it("store_prepaid_prices & store_bill_payments: Store A cannot be read by Store B", async () => {
      const opId = crypto.randomUUID();
      await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          await tx.insert(schema.storePrepaidPrices).values({
            storeId: storeAId,
            prepaidProductId: testPrepaidProductId,
            sellPricePiasters: 2600,
          });

          await tx.insert(schema.storeBillPayments).values({
            storeId: storeAId,
            billProviderId: testBillProviderId,
            customerReference: "CUST-REC-01",
            amountPiasters: 15000,
            feePiasters: 300,
            opId,
          });
        },
        appPoolDb,
      );

      const storeBPrepaid = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.storePrepaidPrices)
            .where(
              eq(
                schema.storePrepaidPrices.prepaidProductId,
                testPrepaidProductId,
              ),
            );
        },
        appPoolDb,
      );
      expect(storeBPrepaid).toHaveLength(0);

      const storeBBills = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.storeBillPayments)
            .where(eq(schema.storeBillPayments.opId, opId));
        },
        appPoolDb,
      );
      expect(storeBBills).toHaveLength(0);
    });

    it("wallets & wallet_transactions: Store A ledger is isolated from Store B", async () => {
      const txOpId = crypto.randomUUID();
      const [wallet] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.wallets)
            .values({
              storeId: storeAId,
              provider: "vodafone_cash",
              labelAr: "محفظة فودافون الكاش الرئيسية",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(wallet).toBeDefined();
      testWalletId = wallet!.id;

      const [walletTx] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.walletTransactions)
            .values({
              storeId: storeAId,
              walletId: testWalletId,
              kind: "owner_deposit",
              amountPiasters: 500000,
              feePiasters: 0,
              balanceAfterPiasters: 500000,
              opId: txOpId,
            })
            .returning();
        },
        appPoolDb,
      );
      expect(walletTx).toBeDefined();
      testWalletTxId = walletTx!.id;

      // Store B cannot read Store A's wallet or transaction
      const storeBWallet = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.wallets)
            .where(eq(schema.wallets.id, testWalletId));
        },
        appPoolDb,
      );
      expect(storeBWallet).toHaveLength(0);

      const storeBWalletTx = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.walletTransactions)
            .where(eq(schema.walletTransactions.id, testWalletTxId));
        },
        appPoolDb,
      );
      expect(storeBWalletTx).toHaveLength(0);
    });

    it("contacts & debt_entries: Store A debts are isolated from Store B", async () => {
      const debtOpId = crypto.randomUUID();
      const [contact] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.contacts)
            .values({
              storeId: storeAId,
              kind: "customer",
              nameAr: "عميل شكك أحمد",
              phone: "+201009998877",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(contact).toBeDefined();
      testContactId = contact!.id;

      const [debt] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.debtEntries)
            .values({
              storeId: storeAId,
              contactId: testContactId,
              direction: "owed_to_me",
              amountPiasters: 12500,
              noteAr: "باقي حساب طلبات بقالة",
              opId: debtOpId,
            })
            .returning();
        },
        appPoolDb,
      );
      expect(debt).toBeDefined();
      testDebtEntryId = debt!.id;

      const storeBContact = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.contacts)
            .where(eq(schema.contacts.id, testContactId));
        },
        appPoolDb,
      );
      expect(storeBContact).toHaveLength(0);

      const storeBDebt = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.debtEntries)
            .where(eq(schema.debtEntries.id, testDebtEntryId));
        },
        appPoolDb,
      );
      expect(storeBDebt).toHaveLength(0);
    });

    it("purchases & sales: Store A headers and lines are isolated from Store B", async () => {
      const purchaseOpId = crypto.randomUUID();
      const saleOpId = crypto.randomUUID();

      const [purchase] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          const [p] = await tx
            .insert(schema.purchases)
            .values({
              storeId: storeAId,
              totalPiasters: 100000,
              opId: purchaseOpId,
            })
            .returning();

          await tx.insert(schema.purchaseLines).values({
            storeId: storeAId,
            purchaseId: p!.id,
            storeProductId: testStoreProductId,
            quantityBaseUnits: 50,
            unitCostPiasters: 2000,
          });
          return [p];
        },
        appPoolDb,
      );
      expect(purchase).toBeDefined();
      testPurchaseId = purchase!.id;

      const [sale] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          const [s] = await tx
            .insert(schema.sales)
            .values({
              storeId: storeAId,
              totalPiasters: 3500,
              paymentMethod: "cash",
              opId: saleOpId,
            })
            .returning();

          await tx.insert(schema.saleLines).values({
            storeId: storeAId,
            saleId: s!.id,
            storeProductId: testStoreProductId,
            amountPiasters: 3500,
            feePiasters: 0,
          });
          return [s];
        },
        appPoolDb,
      );
      expect(sale).toBeDefined();
      testSaleId = sale!.id;

      const storeBPurchase = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.purchases)
            .where(eq(schema.purchases.id, testPurchaseId));
        },
        appPoolDb,
      );
      expect(storeBPurchase).toHaveLength(0);

      const storeBSale = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.sales)
            .where(eq(schema.sales.id, testSaleId));
        },
        appPoolDb,
      );
      expect(storeBSale).toHaveLength(0);
    });

    it("alerts & ai_messages: Store A alerts and AI messages are isolated from Store B", async () => {
      const [alert] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.alerts)
            .values({
              storeId: storeAId,
              kind: "low_stock",
              severity: "warning",
              messageAr: "كمية الجبنة البيضاء أوشكت على النفاد",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(alert).toBeDefined();

      const [aiMsg] = await withTenant(
        storeAId,
        userAId,
        async (tx) => {
          return await tx
            .insert(schema.aiMessages)
            .values({
              storeId: storeAId,
              role: "user",
              bodyText: "إيه أكتر صنف مبيعا الأسبوع ده؟",
            })
            .returning();
        },
        appPoolDb,
      );
      expect(aiMsg).toBeDefined();

      const storeBAlerts = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.alerts)
            .where(eq(schema.alerts.id, alert!.id));
        },
        appPoolDb,
      );
      expect(storeBAlerts).toHaveLength(0);

      const storeBAiMsgs = await withTenant(
        storeBId,
        userBId,
        async (tx) => {
          return await tx
            .select()
            .from(schema.aiMessages)
            .where(eq(schema.aiMessages.id, aiMsg!.id));
        },
        appPoolDb,
      );
      expect(storeBAiMsgs).toHaveLength(0);
    });

    describe("Grants: hesba_app has NO UPDATE and NO DELETE on append-only tables", () => {
      function assertPermissionDenied(err: unknown) {
        expect(err).toBeDefined();
        const errorObj = err as {
          message?: string;
          cause?: { message?: string };
        };
        const combined = `${errorObj.message ?? ""} ${errorObj.cause?.message ?? ""}`;
        expect(combined).toMatch(/permission denied for table/i);
      }

      it("hesba_app cannot UPDATE or DELETE wallet_transactions", async () => {
        let updateErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .update(schema.walletTransactions)
                .set({ amountPiasters: 999999 })
                .where(eq(schema.walletTransactions.id, testWalletTxId));
            },
            appPoolDb,
          );
        } catch (err) {
          updateErr = err;
        }
        assertPermissionDenied(updateErr);

        let deleteErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .delete(schema.walletTransactions)
                .where(eq(schema.walletTransactions.id, testWalletTxId));
            },
            appPoolDb,
          );
        } catch (err) {
          deleteErr = err;
        }
        assertPermissionDenied(deleteErr);
      });

      it("hesba_app cannot UPDATE or DELETE debt_entries", async () => {
        let updateErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .update(schema.debtEntries)
                .set({ amountPiasters: 999999 })
                .where(eq(schema.debtEntries.id, testDebtEntryId));
            },
            appPoolDb,
          );
        } catch (err) {
          updateErr = err;
        }
        assertPermissionDenied(updateErr);

        let deleteErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .delete(schema.debtEntries)
                .where(eq(schema.debtEntries.id, testDebtEntryId));
            },
            appPoolDb,
          );
        } catch (err) {
          deleteErr = err;
        }
        assertPermissionDenied(deleteErr);
      });

      it("hesba_app cannot UPDATE or DELETE purchases", async () => {
        let updateErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .update(schema.purchases)
                .set({ totalPiasters: 999999 })
                .where(eq(schema.purchases.id, testPurchaseId));
            },
            appPoolDb,
          );
        } catch (err) {
          updateErr = err;
        }
        assertPermissionDenied(updateErr);

        let deleteErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .delete(schema.purchases)
                .where(eq(schema.purchases.id, testPurchaseId));
            },
            appPoolDb,
          );
        } catch (err) {
          deleteErr = err;
        }
        assertPermissionDenied(deleteErr);
      });

      it("hesba_app cannot UPDATE or DELETE sales", async () => {
        let updateErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .update(schema.sales)
                .set({ totalPiasters: 999999 })
                .where(eq(schema.sales.id, testSaleId));
            },
            appPoolDb,
          );
        } catch (err) {
          updateErr = err;
        }
        assertPermissionDenied(updateErr);

        let deleteErr: unknown;
        try {
          await withTenant(
            storeAId,
            userAId,
            async (tx) => {
              await tx
                .delete(schema.sales)
                .where(eq(schema.sales.id, testSaleId));
            },
            appPoolDb,
          );
        } catch (err) {
          deleteErr = err;
        }
        assertPermissionDenied(deleteErr);
      });
    });
  });
});
