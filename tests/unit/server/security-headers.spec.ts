import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  securityHeaders,
} from "@/server/config/security-headers";
import nextConfig from "../../../next.config";

/** QA-26: the security headers every response gets (applied in next.config.ts). */
const byKey = (h: Array<{ key: string; value: string }>) =>
  Object.fromEntries(h.map((x) => [x.key, x.value]));

describe("security headers (QA-26)", () => {
  it("production: the required headers, HSTS without preload, a strict CSP", () => {
    const h = securityHeaders({
      production: true,
      hstsIncludeSubdomains: false,
    });
    const m = byKey(h);
    expect(m["X-Content-Type-Options"]).toBe("nosniff");
    expect(m["X-Frame-Options"]).toBe("DENY");
    expect(m["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(m["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(m["Strict-Transport-Security"]).not.toContain("preload");
    expect(m["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(m["Permissions-Policy"]).toContain("camera=()");
    expect(m["Permissions-Policy"]).toContain("microphone=(self)");
    const csp = m["Content-Security-Policy"]!;
    for (const d of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(d);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/); // no bare wildcard source
  });

  it("includeSubDomains only when opted in", () => {
    const m = byKey(
      securityHeaders({ production: true, hstsIncludeSubdomains: true }),
    );
    expect(m["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("development: no HSTS; eval and the HMR websocket allowed only here", () => {
    const m = byKey(
      securityHeaders({ production: false, hstsIncludeSubdomains: true }),
    );
    expect(m["Strict-Transport-Security"]).toBeUndefined();
    expect(contentSecurityPolicy(false)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).toContain("ws:");
    expect(contentSecurityPolicy(true)).not.toContain("ws:");
  });

  it("each header appears once, and next.config applies them to every path", async () => {
    const h = securityHeaders({
      production: true,
      hstsIncludeSubdomains: false,
    });
    const keys = h.map((x) => x.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    expect(rules[0]!.headers.map((x) => x.key)).toContain(
      "Content-Security-Policy",
    );
  });
});
