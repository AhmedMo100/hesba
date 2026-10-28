import "server-only";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<void>;
  sendVerificationEmail(to: string, verificationUrl: string): Promise<void>;
  sendMagicLinkEmail(to: string, magicLinkUrl: string): Promise<void>;
  sendRecoveryEmail(to: string, recoveryUrl: string): Promise<void>;
  sendPasswordResetCode(to: string, code: string): Promise<void>;
}
