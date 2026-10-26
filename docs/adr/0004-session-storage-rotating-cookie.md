# ADR-0004: Session storage (rotating encrypted cookie)

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba requires stateless, secure authentication for store owners and cashiers (`docs/01-product.md` decision D8). Since retail mobile shops frequently operate with poor connectivity, session verification must be lightweight, secure against theft or tampering, and free of external session-store dependencies (such as Redis or provider-locked databases).

## Options
1. **Option A: Server-side Redis / DB Session Store**
   - *Pros:* Instant revocation from server dashboard.
   - *Cons:* Adds an infrastructure component (Redis/KV); requires a network call on every server action or sync route; breaks zero-provider-lock portability.
2. **Option B: Signed and Encrypted Rotating Cookie (`__Host-` cookie with HMAC-SHA256)**
   - *Pros:* Completely portable; verified via `HESBA_SESSION_SECRET`; stateless; automatic rolling expiry on activity; protected with `HttpOnly`, `Secure`, `SameSite=Lax`, and `__Host-` prefix.
   - *Cons:* Immediate server-side single-session revocation requires maintaining a revocation blocklist or incrementing a `token_version` on the `users` table.

## Decision
The decision remains **Proposed** (Aligned with Decision D8). We propose Option B: an encrypted, signed HTTP-only cookie verified with `HESBA_SESSION_SECRET` and rotating on each authenticated request.

## Consequences
- **Positive:**
  - Zero external cache dependency; runs cleanly in any Docker container or hosting provider.
  - Resistant to XSS (inaccessible via JavaScript) and CSRF.
- **Negative/risks:**
  - Session invalidation on password change requires a `token_version` check against the database when online.
- **When to revisit:**
  - Finalized in Phase 2 during auth implementation (P2-B-01).
