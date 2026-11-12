import "server-only";

/**
 * @file request-guard.ts
 * @description Server-side cross-site request (CSRF) guard for cookie-authenticated writes
 * (QA-39). `SameSite=Lax` already keeps the cookie off most cross-site requests; this does not
 * rely on it (same-site subdomains, old browsers, a future SameSite change).
 *
 * For a write (any method but GET / HEAD / OPTIONS):
 * - a browser that says the request is cross-site (`Sec-Fetch-Site: cross-site`) → 403;
 * - an `Origin` whose host is not this server's host → 403;
 * - a body that is not `application/json` → 415. A cross-site `text/plain` / form POST is a
 *   "simple request" that skips the CORS preflight; JSON-only bodies force it.
 *
 * Requests without `Origin` / `Sec-Fetch-Site` come from non-browser clients (scripts, server
 * code, tests). They carry no ambient browser cookie, so they are not a CSRF vector.
 */
import { AppError } from "@/server/platform/error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The host this request was sent to (behind a proxy: the forwarded host). */
function requestHost(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.toLowerCase();
  const host = req.headers.get("host");
  if (host) return host.toLowerCase();
  try {
    return new URL(req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** @throws AppError 403 (cross-site write) or 415 (non-JSON body). */
export function assertSameOriginWrite(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;

  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw AppError.forbidden("الطلب ده جاي من موقع تاني ومش مسموح");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost =
        origin === "null" ? null : new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== requestHost(req)) {
      throw AppError.forbidden("الطلب ده جاي من موقع تاني ومش مسموح");
    }
  }

  // A body is announced by its length (browsers always send it for a POST body) or chunked
  // encoding. A body-less DELETE may still carry an empty stream in Next: not a body.
  const hasBody =
    (req.headers.get("content-length") ?? "0") !== "0" ||
    req.headers.has("transfer-encoding");
  const type = req.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  // Cross-site "simple requests" always carry a non-JSON type (text/plain, a form type);
  // a body with no type at all is refused too. A body-less request with no type passes.
  if ((type && type !== "application/json") || (!type && hasBody)) {
    throw new AppError("BAD_REQUEST", "لازم البيانات تتبعت JSON", 415);
  }
}
