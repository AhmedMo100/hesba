import "server-only";
import type { EmailProvider } from "./provider";
import { mockEmailProvider } from "./mock-provider";

export * from "./provider";
export * from "./mock-provider";

export function getEmailProvider(): EmailProvider {
  // Always returns mock provider until production email provider is approved via ADR and env
  return mockEmailProvider;
}
