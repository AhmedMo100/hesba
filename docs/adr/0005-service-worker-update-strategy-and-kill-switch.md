# ADR-0005: Service Worker update strategy and kill switch

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
As a Progressive Web App (PWA), Hesba relies on `@serwist/next` to precache application assets for offline use (`docs/02-arch.md`). However, aggressive caching in service workers can trap users on stale versions if updates are not handled smoothly, or prevent recovery if a faulty release is deployed to production.

## Options
1. **Option A: Silent Background Update with SkipWaiting and Auto-Reload**
   - *Pros:* Users always run the latest version quickly.
   - *Cons:* Auto-reloading while a cashier is in the middle of ringing up a sale can disrupt transactions and cause panic.
2. **Option B: Staged Update Notification with User Consent & Remote Kill Switch**
   - *Pros:* Unobtrusive banner ("تحديث جديد متاح — اضغط لتحديث التطبيق"); only activates after current open operations settle; remote kill-switch endpoint (`/api/sw/kill`) that unregisters broken service workers and clears caches if a disaster release occurs.
   - *Cons:* Slightly delayed adoption of non-critical UI updates.

## Decision
The decision remains **Proposed** (Open decision for Phase 1-2). The recommended direction is Option B with a gentle update indicator in `SyncBar` and a server-controlled emergency kill-switch.

## Consequences
- **Positive:**
  - Protects cashiers from abrupt UI reloads during active sales.
  - Fail-safe recovery mechanism for bad service worker deployments.
- **When to revisit:**
  - Scheduled for Phase 2 PWA lifecycle hardening.
