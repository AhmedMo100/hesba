/**
 * @file security-headers.ts
 * @description The app's HTTP security headers (audit QA-26), applied to EVERY response —
 * pages, API successes and errors, static files — from `next.config.ts` `headers()`.
 *
 * @remarks
 * Kept free of `server-only` because `next.config.ts` loads it outside the Next bundler.
 *
 * Content-Security-Policy, by what the app actually loads (2026-11-12):
 * - scripts: only this origin. `'unsafe-inline'` is needed for Next's inline bootstrap/RSC
 *   scripts and the theme script in `app/layout.tsx`: the pages are prerendered, so a
 *   per-request nonce is not available. `'unsafe-eval'` only in development (webpack HMR).
 * - styles: this origin + inline (React `style` attributes are used throughout).
 * - images: this origin, `data:` and `blob:` (inline SVG icons, generated previews).
 * - fonts: this origin only (Tajawal is self-hosted, `public/fonts`).
 * - connections: this origin only — AI, email and every other provider are called from the
 *   server, never from the browser. Development adds the HMR websocket.
 * - workers / manifest: this origin (the Serwist service worker).
 * - no plugins (`object-src 'none'`), no framing (`frame-ancestors 'none'`), `base-uri` and
 *   `form-action` pinned to this origin.
 *
 * HSTS is sent only in production builds (the app is served over HTTPS there; on plain-HTTP
 * development it would be ignored or harmful). `includeSubDomains` is opt-in
 * (`HESBA_HSTS_INCLUDE_SUBDOMAINS=1`) because whether every subdomain of the production domain
 * serves HTTPS is not confirmed; `preload` is not used.
 */

export interface SecurityHeaderOptions {
  production: boolean;
  hstsIncludeSubdomains: boolean;
}

export function contentSecurityPolicy(production: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(production ? [] : ["'unsafe-eval'"]),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(production ? [] : ["ws:", "wss:"])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (production) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Every header, once (no duplicates). */
export function securityHeaders(
  options: SecurityHeaderOptions,
): Array<{ key: string; value: string }> {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(options.production),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      // Voice search (Web Speech) needs the microphone; nothing else is used.
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
  if (options.production) {
    headers.push({
      key: "Strict-Transport-Security",
      value: options.hstsIncludeSubdomains
        ? "max-age=31536000; includeSubDomains"
        : "max-age=31536000",
    });
  }
  return headers;
}
