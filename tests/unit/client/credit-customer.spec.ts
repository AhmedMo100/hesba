/** The credit-sale customer form matches a phone however it is typed (no duplicate customer). */
import { describe, expect, it } from "vitest";
import { phoneKey } from "@/client/features/sales/CreditCustomerForm";

describe("phoneKey", () => {
  it("treats the same Egyptian mobile typed differently as one phone", () => {
    const k = phoneKey("01011112222");
    for (const v of [
      "+201011112222",
      "00201011112222",
      "٠١٠ ١١١١ ٢٢٢٢",
      "010-1111-2222",
    ]) {
      expect(phoneKey(v)).toBe(k);
    }
    expect(phoneKey("01011112223")).not.toBe(k);
    expect(phoneKey(null)).toBe("");
  });
});
