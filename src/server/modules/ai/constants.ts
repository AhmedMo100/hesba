import "server-only";

export const AI_DAILY_MESSAGE_LIMIT = 5;
export const AI_CONVERSATION_RETENTION_DAYS = 7;
export const CAIRO_TIMEZONE = "Africa/Cairo";

/**
 * The longest a shopkeeper waits for one assistant reply, all model calls included (QA-29).
 * Past it the request ends with a 503 "try again" and the message credit is given back. A
 * product assumption, logged as D34 in docs/01-product.md.
 */
export const AI_REPLY_TIMEOUT_MS = 20_000;
