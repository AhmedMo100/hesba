/**
 * Pure domain logic for PII scrubbing before sending telemetry to Sentry.
 * Strips phone numbers, names, emails, and card numbers from error messages,
 * breadcrumbs, user context, request headers, and extra payloads.
 */

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Standard 16-digit cards (with spaces or dashes) or 15-16 continuous digits
const CARD_REGEX = /\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{15,16}\b/g;

// Egyptian mobile numbers: +201..., 010..., 011..., 012..., 015... with optional spaces/dashes
const PHONE_REGEX = /(?:\+?20[\s-]?)?0?1[0125](?:[\s-]?\d){8}\b/g;

// Named personal identifiers in formatted strings (e.g. name: "Ahmed", username=John)
const NAME_PATTERN_REGEX =
  /((?:user_?name|customer_?name|supplier_?name|full_?name|\bname)\s*[:=]\s*["']?)([^"',;\n\r]+)(["']?)/gi;

const SENSITIVE_KEY_REGEX =
  /^(name|user_?name|full_?name|customer_?name|supplier_?name|first_?name|last_?name)$/i;

const SENSITIVE_PHONE_KEY_REGEX =
  /^(phone|mobile|telephone|phone_?number|msisdn)$/i;

const SENSITIVE_EMAIL_KEY_REGEX = /^(email|email_?address)$/i;

const SENSITIVE_CARD_KEY_REGEX =
  /^(card|card_?number|pan|credit_?card|debit_?card|cvv|cvc)$/i;

/**
 * Scrubs PII from a freeform text string.
 */
export function scrubText(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }

  let result = text;

  // 1. Emails
  result = result.replace(EMAIL_REGEX, "[EMAIL_REDACTED]");

  // 2. Card numbers
  result = result.replace(CARD_REGEX, "[CARD_REDACTED]");

  // 3. Phone numbers
  result = result.replace(PHONE_REGEX, "[PHONE_REDACTED]");

  // 4. Name patterns
  result = result.replace(NAME_PATTERN_REGEX, "$1[NAME_REDACTED]$3");

  return result;
}

/**
 * Recursively scrubs objects and arrays, checking both keys and string values.
 */
export function scrubData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return scrubText(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrubData(item));
  }

  if (typeof data === "object") {
    const scrubbedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_PHONE_KEY_REGEX.test(key)) {
        scrubbedObj[key] = "[PHONE_REDACTED]";
      } else if (SENSITIVE_EMAIL_KEY_REGEX.test(key)) {
        scrubbedObj[key] = "[EMAIL_REDACTED]";
      } else if (SENSITIVE_CARD_KEY_REGEX.test(key)) {
        scrubbedObj[key] = "[CARD_REDACTED]";
      } else if (SENSITIVE_KEY_REGEX.test(key)) {
        scrubbedObj[key] = "[NAME_REDACTED]";
      } else {
        scrubbedObj[key] = scrubData(val);
      }
    }
    return scrubbedObj;
  }

  return data;
}

/**
 * Scrubs a Sentry event object before dispatch.
 */
export function scrubSentryEvent<T extends object>(event: T): T {
  if (!event || typeof event !== "object") {
    return event;
  }

  const sanitized = { ...event } as Record<string, unknown>;

  // 1. Scrub User context (never send personal details or client IP)
  const user = sanitized["user"] as Record<string, unknown> | undefined;
  if (user && typeof user === "object") {
    const copy = { ...user };
    delete copy["email"];
    delete copy["name"];
    delete copy["username"];
    delete copy["ip_address"];
    sanitized["user"] = copy;
  }

  // 2. Scrub Exception messages & values
  const exception = sanitized["exception"] as
    { values?: Array<{ value?: string }> } | undefined;
  if (exception?.values && Array.isArray(exception.values)) {
    sanitized["exception"] = {
      ...exception,
      values: exception.values.map((val) => ({
        ...val,
        value: typeof val.value === "string" ? scrubText(val.value) : val.value,
      })),
    };
  }

  // 3. Scrub Root Event Message
  if (typeof sanitized["message"] === "string") {
    sanitized["message"] = scrubText(sanitized["message"]);
  }

  // 4. Scrub Breadcrumbs
  const breadcrumbs = sanitized["breadcrumbs"] as
    Array<{ message?: string; data?: unknown }> | undefined;
  if (Array.isArray(breadcrumbs)) {
    sanitized["breadcrumbs"] = breadcrumbs.map((b) => ({
      ...b,
      message: typeof b.message === "string" ? scrubText(b.message) : b.message,
      data: b.data ? scrubData(b.data) : b.data,
    }));
  }

  // 5. Scrub Request Headers and Body
  const req = sanitized["request"] as Record<string, unknown> | undefined;
  if (req && typeof req === "object") {
    const copy = { ...req };
    if (copy["headers"] && typeof copy["headers"] === "object") {
      const headers = { ...(copy["headers"] as Record<string, unknown>) };
      delete headers["authorization"];
      delete headers["cookie"];
      delete headers["x-forwarded-for"];
      delete headers["x-real-ip"];
      copy["headers"] = headers;
    }
    if (copy["data"]) {
      copy["data"] = scrubData(copy["data"]);
    }
    sanitized["request"] = copy;
  }

  // 6. Scrub Extra and Contexts
  if (sanitized["extra"] && typeof sanitized["extra"] === "object") {
    sanitized["extra"] = scrubData(sanitized["extra"]) as Record<
      string,
      unknown
    >;
  }

  return sanitized as unknown as T;
}
