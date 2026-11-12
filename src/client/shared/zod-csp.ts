/**
 * @file zod-csp.ts
 * @description Imported first by the browser entry points. zod v4 probes `new Function("")`
 * to decide whether it may compile fast parsers; under the app's Content-Security-Policy
 * (no `'unsafe-eval'` in production, QA-26 / ADR-0024) that probe is blocked and reported as a
 * CSP violation, then zod falls back anyway. Choosing the eval-free mode up front skips the
 * probe: same results, no violation.
 */
import { config } from "zod";

config({ jitless: true });
