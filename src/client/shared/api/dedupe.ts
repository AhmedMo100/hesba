/**
 * @file dedupe.ts
 * @description In-flight request deduplication for GETs (performance pass, ADR-0027).
 *
 * Two parts of the screen that ask for the same URL at the same moment (the shell's alerts
 * badge and the Alerts screen, two machine lists) share ONE network request; each caller gets
 * its own copy of the response. Nothing is kept once the response arrives: the next request
 * goes to the server again. So this never serves stale data — stock, money and balances are
 * always the server's latest answer — and it caches nothing across sessions or shops (the
 * browser holds one session cookie; a request in flight belongs to the session that sent it,
 * and {@link clearInflightRequests} is called when the session changes).
 *
 * Only for idempotent GETs. Writes always go straight to the server.
 */

const inflight = new Map<string, Promise<Response>>();

/** `fetch(url)` (GET), shared with any identical GET already in flight. */
export function dedupedGet(url: string): Promise<Response> {
  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(url).finally(() => {
      inflight.delete(url);
    });
    inflight.set(url, pending);
  }
  // Each caller reads its own copy of the body.
  return pending.then((res) => res.clone());
}

/** Forgets every request in flight (sign-in, sign-out, shop switch). */
export function clearInflightRequests(): void {
  inflight.clear();
}
