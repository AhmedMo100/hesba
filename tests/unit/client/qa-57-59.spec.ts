/**
 * QA-57 (the shop name offline), QA-58 (owner name length) and QA-59 (unknown People section).
 */
import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { HesbaDatabase } from "@/client/offline/db";
import {
  forgetShopIdentities,
  loadShopIdentity,
  saveShopIdentity,
} from "@/client/offline/shop";
import { signupInputSchema, storeProfileUpdateSchema } from "@/schemas/auth";
import { peopleListQuerySchema } from "@/schemas/people";
import { MAX_PERSON_NAME_LENGTH } from "@/domain/limits";

const session = (storeId: string, storeName: string, owner: string) => ({
  user: { name: owner },
  store: {
    id: storeId,
    name: storeName,
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
    openedOn: "2024-01-01",
    workersCount: 1,
  },
});

describe("QA-57 — the shop identity is kept on the device", () => {
  const NAME = "hesba_test_shop_identity";
  let db: HesbaDatabase;
  beforeEach(async () => {
    await Dexie.delete(NAME);
    db = new HesbaDatabase(NAME);
    await db.open();
  });

  it("saved once online, read back offline for that shop only", async () => {
    await saveShopIdentity(db, session("s-a", "سوبر ماركت الأحمد", "أحمد"));
    await saveShopIdentity(db, session("s-b", "بقالة النور", "منى"));
    expect(await loadShopIdentity(db, "s-a")).toEqual({
      storeId: "s-a",
      storeName: "سوبر ماركت الأحمد",
      ownerName: "أحمد",
    });
    expect((await loadShopIdentity(db, "s-b"))?.storeName).toBe("بقالة النور");
    expect(await loadShopIdentity(db, "s-unknown")).toBeNull();
  });

  it("a renamed shop is updated; saving the same data twice keeps one row", async () => {
    await saveShopIdentity(db, session("s-a", "قديم", "أحمد"));
    await saveShopIdentity(db, session("s-a", "جديد", "أحمد علي"));
    await saveShopIdentity(db, session("s-a", "جديد", "أحمد علي"));
    expect(await db.stores.count()).toBe(1);
    expect(await loadShopIdentity(db, "s-a")).toMatchObject({
      storeName: "جديد",
      ownerName: "أحمد علي",
    });
  });

  it("signed out: every saved identity is forgotten (other meta kept)", async () => {
    await db.sync_meta.put({ key: "catalog_cursor", value: "c1" });
    await saveShopIdentity(db, session("s-a", "محل", "أحمد"));
    await forgetShopIdentities(db);
    expect(await loadShopIdentity(db, "s-a")).toBeNull();
    expect(await db.sync_meta.get("shop_owner:s-a")).toBeUndefined();
    expect((await db.sync_meta.get("catalog_cursor"))?.value).toBe("c1");
  });
});

describe("QA-58 — owner name length", () => {
  const base = {
    phone: "01012345678",
    email: "a@b.co",
    password: "Strong-pass-2026",
    storeName: "محل",
    shopType: "سوبر ماركت",
    governorate: "القاهرة",
  };
  it("refuses a 10,000-character name with a message, accepts the limit exactly, never trims content", () => {
    const huge = signupInputSchema.safeParse({
      ...base,
      ownerName: "ا".repeat(10_000),
    });
    expect(huge.success).toBe(false);
    expect(huge.error?.issues[0]?.path).toEqual(["ownerName"]);
    expect(huge.error?.issues[0]?.message).toContain(
      String(MAX_PERSON_NAME_LENGTH),
    );

    const over = signupInputSchema.safeParse({
      ...base,
      ownerName: "ا".repeat(MAX_PERSON_NAME_LENGTH + 1),
    });
    expect(over.success).toBe(false);

    const exact = signupInputSchema.parse({
      ...base,
      ownerName: "ا".repeat(MAX_PERSON_NAME_LENGTH),
    });
    expect(exact.ownerName).toHaveLength(MAX_PERSON_NAME_LENGTH);
  });

  it("the profile update has the same limit", () => {
    const r = storeProfileUpdateSchema.safeParse({
      ...base,
      ownerName: "ب".repeat(MAX_PERSON_NAME_LENGTH + 1),
      workersCount: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("QA-59 — People section", () => {
  it("known sections pass; none means «ليك»; anything else is refused", () => {
    for (const s of ["owedToMe", "iOwe", "suppliers"] as const) {
      expect(peopleListQuerySchema.parse({ section: s }).section).toBe(s);
    }
    expect(peopleListQuerySchema.parse({}).section).toBe("owedToMe");
    for (const bad of ["customers", "OWEDTOME", "", "owedToMe "]) {
      expect(peopleListQuerySchema.safeParse({ section: bad }).success).toBe(
        false,
      );
    }
  });
});
