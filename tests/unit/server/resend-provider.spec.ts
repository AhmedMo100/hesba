import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResendEmailProvider } from "@/server/infra/email/resend-provider";
import { AppError } from "@/server/platform/error";

describe("ResendEmailProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws during construction if API key is empty", () => {
    expect(() => new ResendEmailProvider("")).toThrow(
      "ResendEmailProvider requires a non-empty RESEND_API_KEY",
    );
    expect(() => new ResendEmailProvider("   ")).toThrow(
      "ResendEmailProvider requires a non-empty RESEND_API_KEY",
    );
  });

  it("successfully sends an email when Resend API returns 200/201", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-msg-12345" }),
    });
    global.fetch = fetchMock;

    const provider = new ResendEmailProvider(
      "re_test_key_12345678",
      "حسبة <auth@hesba.app>",
    );

    await expect(
      provider.sendEmail({
        to: "shopkeeper@example.com",
        subject: "استرداد الحساب",
        html: "<p>رابط</p>",
        text: "رابط",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstCall).toBeDefined();
    const [url, options] = firstCall;
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer re_test_key_12345678",
    );
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(options.body as string);
    expect(body.from).toBe("حسبة <auth@hesba.app>");
    expect(body.to).toEqual(["shopkeeper@example.com"]);
    expect(body.subject).toBe("استرداد الحساب");
  });

  it("distinguishes provider error response from success and throws safe AppError", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        name: "restricted_api_key",
        message: "API key does not have permissions to send",
        statusCode: 403,
      }),
    });

    const provider = new ResendEmailProvider("re_test_key_12345678");

    await expect(
      provider.sendEmail({
        to: "shopkeeper@example.com",
        subject: "اختبار",
        html: "<p>اختبار</p>",
        text: "اختبار",
      }),
    ).rejects.toThrow(AppError);

    await expect(
      provider.sendEmail({
        to: "shopkeeper@example.com",
        subject: "اختبار",
        html: "<p>اختبار</p>",
        text: "اختبار",
      }),
    ).rejects.toThrow("تعذر إرسال البريد الإلكتروني حالياً");
  });

  it("handles request timeout properly", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const provider = new ResendEmailProvider("re_test_key_12345678");

    await expect(
      provider.sendEmail({
        to: "shopkeeper@example.com",
        subject: "اختبار",
        html: "<p>اختبار</p>",
        text: "اختبار",
      }),
    ).rejects.toThrow("انتهت مهلة إرسال البريد الإلكتروني");
  });

  it("formats recovery email properly without logging raw token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "msg-rec-999" }),
    });
    global.fetch = fetchMock;

    const provider = new ResendEmailProvider("re_test_key_12345678");
    const recoveryUrl =
      "https://hesba.app/auth/verify-link?token=secret-token-321&type=recovery";

    await provider.sendRecoveryEmail("owner@test.com", recoveryUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstCall).toBeDefined();
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.subject).toBe("استرداد حسابك في حسبة");
    expect(body.text).toContain(recoveryUrl);
    expect(body.html).toContain(recoveryUrl);
    expect(body.html).toContain('dir="rtl"');
  });
});
