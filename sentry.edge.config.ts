import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./src/domain/sentry-scrubber";

const dsn = process.env["HESBA_SENTRY_DSN"];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "staging",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });
}
