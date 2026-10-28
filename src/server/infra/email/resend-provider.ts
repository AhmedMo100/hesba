import "server-only";
import type { EmailProvider, SendEmailOptions } from "./provider";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "حسبة <auth@hesba.app>";
const REQUEST_TIMEOUT_MS = 10000;

export interface ResendResponse {
  id?: string;
  name?: string;
  message?: string;
  statusCode?: number;
}

export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(apiKey: string, fromEmail?: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        "ResendEmailProvider requires a non-empty RESEND_API_KEY",
      );
    }
    this.apiKey = apiKey.trim();
    this.fromEmail = fromEmail?.trim() || DEFAULT_FROM_EMAIL;
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data: ResendResponse = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Log safe diagnostics without exposing keys or personal message content
        const recipientDomain = options.to.includes("@")
          ? options.to.split("@")[1]
          : "unknown";
        logger.error(
          {
            statusCode: response.status,
            errorName: data.name,
            recipientDomain,
          },
          "Resend API rejected email dispatch request",
        );
        throw AppError.internal(
          "تعذر إرسال البريد الإلكتروني حالياً. يُرجى المحاولة لاحقاً.",
        );
      }

      const recipientDomain = options.to.includes("@")
        ? options.to.split("@")[1]
        : "unknown";
      logger.info(
        {
          resendId: data.id,
          recipientDomain,
        },
        "Transactional email successfully accepted by Resend provider",
      );
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof AppError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        logger.error("Resend API request timed out after 10s");
        throw AppError.internal(
          "انتهت مهلة إرسال البريد الإلكتروني. يُرجى المحاولة لاحقاً.",
        );
      }
      logger.error(
        { err },
        "Unexpected error while sending email via Resend API",
      );
      throw AppError.internal("فشل غير متوقع في خدمة البريد الإلكتروني.");
    }
  }

  async sendRecoveryEmail(to: string, recoveryUrl: string): Promise<void> {
    const subject = "استرداد حسابك في حسبة";
    const text = [
      "مرحباً بك في حسبة،",
      "",
      "تلقينا طلباً لاسترداد حسابك وإعادة تسجيل مفتاح المرور على جهازك.",
      "لإتمام الاسترداد، يرجى فتح الرابط التالي:",
      recoveryUrl,
      "",
      "ملاحظات أمان هامة:",
      "- صلاحية هذا الرابط ساعة واحدة فقط.",
      "- هذا الرابط صالح للاستخدام مرة واحدة فقط.",
      "- إذا لم تقم بطلب هذا الاسترداد، يمكنك تجاهل هذه الرسالة وسيبقى حسابك آمناً.",
      "",
      "فريق حسبة",
    ].join("\n");

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif;
      background-color: #f7f9fc;
      margin: 0;
      padding: 24px;
      direction: rtl;
      text-align: right;
      color: #1a202c;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      padding: 32px 24px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 8px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin: 0;
    }
    .body-text {
      font-size: 15px;
      line-height: 1.7;
      color: #334155;
      margin-bottom: 24px;
    }
    .btn-container {
      text-align: center;
      margin: 28px 0;
    }
    .btn {
      display: inline-block;
      background-color: #0f766e;
      color: #ffffff !important;
      padding: 14px 28px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
    }
    .alt-link {
      background-color: #f1f5f9;
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      color: #475569;
      word-break: break-all;
      direction: ltr;
      text-align: left;
      margin-top: 16px;
    }
    .footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 20px;
      margin-top: 24px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">استرداد حسابك في حسبة</h1>
      <p class="subtitle">إعادة تسجيل مفتاح المرور الآمن</p>
    </div>
    <div class="body-text">
      <p>أهلاً بك،</p>
      <p>تلقينا طلباً لاسترداد حسابك في <strong>حسبة</strong> وتسجيل مفتاح مرور جديد للوصول إلى محلك.</p>
      <p>اضغط على الزر أدناه لمتابعة الاسترداد:</p>
      <div class="btn-container">
        <a href="${recoveryUrl}" class="btn" target="_blank" rel="noopener noreferrer">استرداد الحساب وتسجيل مفتاح المرور</a>
      </div>
      <p>أو انسخ الرابط المباشر التالي وافتحه في متصفحك:</p>
      <div class="alt-link">${recoveryUrl}</div>
    </div>
    <div class="footer">
      <p>صلاحية هذا الرابط <strong>ساعة واحدة فقط</strong> ويُستخدم مرة واحدة.</p>
      <p>إذا لم تكن قد طلبت استرداد حسابك، يمكنك تجاهل هذه الرسالة بأمان دون أي قلق.</p>
    </div>
  </div>
</body>
</html>`;

    await this.sendEmail({
      to,
      subject,
      html,
      text,
    });
  }

  async sendVerificationEmail(
    to: string,
    verificationUrl: string,
  ): Promise<void> {
    const subject = "تأكيد بريدك الإلكتروني في حسبة";
    const text = [
      "مرحباً بك في حسبة،",
      "",
      "لتأكيد بريدك الإلكتروني، يرجى فتح الرابط التالي:",
      verificationUrl,
      "",
      "صلاحية هذا الرابط 24 ساعة.",
      "فريق حسبة",
    ].join("\n");

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: sans-serif; direction: rtl; text-align: right; padding: 20px;">
  <h2>تأكيد بريدك الإلكتروني في حسبة</h2>
  <p>أهلاً بك، لتأكيد بريدك الإلكتروني يرجى الضغط على الرابط التالي:</p>
  <p><a href="${verificationUrl}">${verificationUrl}</a></p>
</body>
</html>`;

    await this.sendEmail({
      to,
      subject,
      html,
      text,
    });
  }

  async sendMagicLinkEmail(to: string, magicLinkUrl: string): Promise<void> {
    const subject = "رابط الدخول الآمن إلى حسبة";
    const text = `رابط الدخول إلى حسبة:\n${magicLinkUrl}\nصلاحية الرابط 15 دقيقة.`;
    const html = `<p>رابط الدخول: <a href="${magicLinkUrl}">${magicLinkUrl}</a></p>`;
    await this.sendEmail({ to, subject, html, text });
  }

  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    const subject = "كود إعادة تعيين كلمة السر في حسبة";
    const text = [
      "مرحباً بك في حسبة،",
      "",
      `كود إعادة تعيين كلمة السر الخاص بك هو: ${code}`,
      "",
      "ملاحظات أمان هامة:",
      "- هذا الكود صالح لمدة 10 دقائق فقط.",
      "- هذا الكود مخصص لك ولا تشاركه مع أي شخص.",
      "- إذا لم تطلب إعادة تعيين كلمة السر، يمكنك تجاهل هذه الرسالة.",
      "",
      "فريق حسبة",
    ].join("\n");

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Tahoma, sans-serif; direction: rtl; text-align: right; background-color: #f7f9fc; padding: 24px; color: #1a202c;">
  <div style="max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
    <h2 style="color: #2b2a22; margin-top: 0;">إعادة تعيين كلمة السر</h2>
    <p>تلقينا طلباً لإعادة تعيين كلمة السر لحسابك في <b>حسبة</b>. استخدم الكود التالي لإتمام العملية:</p>
    <div style="background: #f4f0e8; border: 2px dashed #4f6b46; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f6b46;">${code}</span>
    </div>
    <p style="font-size: 13px; color: #6e6a58;">- صلاحية الكود 10 دقائق فقط للاستخدام لمرة واحدة.<br>- إذا لم تطلب هذا الكود، يمكنك تجاهل هذه الرسالة وسيبقى حسابك آمناً.</p>
    <hr style="border: none; border-top: 1px solid #e5dfd5; margin: 24px 0;">
    <p style="font-size: 12px; color: #9a958b; margin-bottom: 0;">فريق حسبة</p>
  </div>
</body>
</html>`;

    await this.sendEmail({ to, subject, html, text });
  }
}
