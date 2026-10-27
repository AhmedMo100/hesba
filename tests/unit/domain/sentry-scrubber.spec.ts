import { describe, expect, it } from "vitest";
import {
  scrubData,
  scrubSentryEvent,
  scrubText,
} from "@/domain/sentry-scrubber";

describe("Sentry PII Scrubber (Domain)", () => {
  describe("scrubText", () => {
    it("proves a phone number in an error message is removed", () => {
      const errorMsg =
        "Failed to send SMS to customer phone: +201012345678 at checkout";
      const scrubbed = scrubText(errorMsg);

      expect(scrubbed).not.toContain("+201012345678");
      expect(scrubbed).toBe(
        "Failed to send SMS to customer phone: [PHONE_REDACTED] at checkout",
      );
    });

    it("redacts local Egyptian mobile phone formats (010, 011, 012, 015)", () => {
      const inputs = [
        "Customer 01012345678 failed login",
        "Alert sent to 01198765432",
        "Verification for 01234567890",
        "Pending on 01511223344",
      ];

      for (const input of inputs) {
        const scrubbed = scrubText(input);
        expect(scrubbed).toContain("[PHONE_REDACTED]");
        expect(scrubbed).not.toMatch(/01[0125]\d{8}/);
      }
    });

    it("redacts email addresses from messages", () => {
      const errorMsg =
        "Failed to authenticate user admin@hesba.app with backend";
      const scrubbed = scrubText(errorMsg);

      expect(scrubbed).not.toContain("admin@hesba.app");
      expect(scrubbed).toBe(
        "Failed to authenticate user [EMAIL_REDACTED] with backend",
      );
    });

    it("redacts credit/debit card numbers from messages", () => {
      const errorMsg =
        "Transaction declined for card: 4111-2222-3333-4444 (code: ERR_DECLINED)";
      const scrubbed = scrubText(errorMsg);

      expect(scrubbed).not.toContain("4111-2222-3333-4444");
      expect(scrubbed).toContain("[CARD_REDACTED]");
    });

    it("redacts names in formatted error messages", () => {
      const errorMsg = 'Invalid session for customer_name: "Ahmed Tarek"';
      const scrubbed = scrubText(errorMsg);

      expect(scrubbed).not.toContain("Ahmed Tarek");
      expect(scrubbed).toBe(
        'Invalid session for customer_name: "[NAME_REDACTED]"',
      );
    });
  });

  describe("scrubData", () => {
    it("recursively scrubs sensitive object keys", () => {
      const payload = {
        storeId: "0194821a-3a1b-7123-8abc-0123456789ab",
        name: "Mahmoud Hassan",
        email: "customer@gmail.com",
        phone: "+201099887766",
        cardNumber: "1234567812345678",
        metadata: {
          customerName: "Mahmoud Hassan",
          notes: "Call back on 01099887766",
        },
      };

      const sanitized = scrubData(payload) as typeof payload;

      expect(sanitized.storeId).toBe("0194821a-3a1b-7123-8abc-0123456789ab");
      expect(sanitized.name).toBe("[NAME_REDACTED]");
      expect(sanitized.email).toBe("[EMAIL_REDACTED]");
      expect(sanitized.phone).toBe("[PHONE_REDACTED]");
      expect(sanitized.cardNumber).toBe("[CARD_REDACTED]");
      expect(sanitized.metadata.customerName).toBe("[NAME_REDACTED]");
      expect(sanitized.metadata.notes).toBe("Call back on [PHONE_REDACTED]");
    });
  });

  describe("scrubSentryEvent", () => {
    it("strips user PII, exception values, breadcrumbs, and sensitive headers from Sentry event", () => {
      const rawEvent = {
        user: {
          id: "usr_123",
          email: "owner@shop.eg",
          name: "Shop Owner",
          username: "shopowner",
          ip_address: "197.34.12.99",
        },
        message: "Unhandled error for user with phone +201012345678",
        exception: {
          values: [
            {
              value: "Database error updating customer 01012345678 (name: Ali)",
            },
          ],
        },
        breadcrumbs: [
          {
            message: "Clicked button for customer 01155554444",
            data: {
              email: "ali@test.com",
              other: "safe value",
            },
          },
        ],
        request: {
          headers: {
            authorization: "Bearer secret-token",
            cookie: "session=secret-cookie",
            "content-type": "application/json",
          },
          data: {
            phone: "+201098765432",
          },
        },
        extra: {
          customer_name: "Tarek",
          info: "Reached out to 01200001111",
        },
      };

      const result = scrubSentryEvent(rawEvent);

      // User object stripped
      expect(result.user).toEqual({ id: "usr_123" });
      expect(result.user.email).toBeUndefined();
      expect(result.user.name).toBeUndefined();
      expect(result.user.ip_address).toBeUndefined();

      // Root message stripped
      expect(result.message).not.toContain("+201012345678");
      expect(result.message).toContain("[PHONE_REDACTED]");

      // Exception value stripped
      expect(result.exception.values[0]?.value).not.toContain("01012345678");
      expect(result.exception.values[0]?.value).not.toContain("Ali");
      expect(result.exception.values[0]?.value).toContain("[PHONE_REDACTED]");
      expect(result.exception.values[0]?.value).toContain("[NAME_REDACTED]");

      // Breadcrumb stripped
      expect(result.breadcrumbs[0]?.message).toContain("[PHONE_REDACTED]");
      expect(result.breadcrumbs[0]?.data.email).toBe("[EMAIL_REDACTED]");
      expect(result.breadcrumbs[0]?.data.other).toBe("safe value");

      // Request headers stripped
      expect(result.request.headers.authorization).toBeUndefined();
      expect(result.request.headers.cookie).toBeUndefined();
      expect(result.request.headers["content-type"]).toBe("application/json");
      expect(result.request.data.phone).toBe("[PHONE_REDACTED]");

      // Extra stripped
      expect(result.extra.customer_name).toBe("[NAME_REDACTED]");
      expect(result.extra.info).toContain("[PHONE_REDACTED]");
    });
  });
});
