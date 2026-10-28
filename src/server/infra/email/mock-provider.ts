import "server-only";
import type { EmailProvider, SendEmailOptions } from "./provider";

export interface SentEmailRecord {
  to: string;
  subject: string;
  sentAt: Date;
  type: "verification" | "recovery" | "magic-link" | "generic";
  url?: string;
}

export class MockEmailProvider implements EmailProvider {
  private sentEmails: SentEmailRecord[] = [];

  async sendEmail(options: SendEmailOptions): Promise<void> {
    this.sentEmails.push({
      to: options.to,
      subject: options.subject,
      sentAt: new Date(),
      type: "generic",
    });
  }

  async sendVerificationEmail(
    to: string,
    verificationUrl: string,
  ): Promise<void> {
    this.sentEmails.push({
      to,
      subject: "تأكيد بريدك الإلكتروني في حسبة",
      sentAt: new Date(),
      type: "verification",
      url: verificationUrl,
    });
  }

  async sendMagicLinkEmail(to: string, magicLinkUrl: string): Promise<void> {
    this.sentEmails.push({
      to,
      subject: "رابط الدخول الآمن إلى حسبة",
      sentAt: new Date(),
      type: "magic-link",
      url: magicLinkUrl,
    });
  }

  async sendRecoveryEmail(to: string, recoveryUrl: string): Promise<void> {
    this.sentEmails.push({
      to,
      subject: "استرداد حسابك في حسبة",
      sentAt: new Date(),
      type: "recovery",
      url: recoveryUrl,
    });
  }

  getSentEmails(): readonly SentEmailRecord[] {
    return [...this.sentEmails];
  }

  getLastEmailFor(to: string): SentEmailRecord | undefined {
    return [...this.sentEmails].reverse().find((email) => email.to === to);
  }

  clear(): void {
    this.sentEmails = [];
  }
}

export const mockEmailProvider = new MockEmailProvider();
