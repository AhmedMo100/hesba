# Hesba — Decisions and Open Questions

> This file is the **source of truth** for decisions: what has been decided, what is open (and who decides it), what must be verified, and which assumptions are to be measured.
> **The Agent:** before deciding anything that is open, ask. And any value you guessed (a limit/constant) must be recorded in section 5.

---

## 1. Decisions made
| # | Decision | File | Status |
|---|---|---|---|
| D1 | **Single Next.js app** (no separate API/NestJS) | 02, 08 | ✅ |
| D2 | Offline-first PWA: Dexie + Outbox + Service Worker | 02, 10 | ✅ |
| D3 | Postgres + RLS (`store_id` on every table) + Drizzle | 08, 09 | ✅ |
| D4 | Sync = `/api/sync/*` Route Handlers (not Server Actions) | 02 section 2 | ✅ |
| D5 | Sync is **event-driven, no polling** | 02, 10 | ✅ |
| D6 | Inventory = batches + append-only movements, FEFO selling, reversing void | 02, 09 | ✅ |
| D7 | Money as integer piastres, quantities as integer (piece/gram) | 09 | ✅ |
| D8 | Rotating httpOnly cookie session (not a JWT in IndexedDB) | 02, 12 | ✅ |
| D9 | Jobs in a Postgres table + cron tick (no Redis in V1) | 02, 08 | ✅ |
| D10 | CSS variables + CSS Modules ported from the demo (not Tailwind) | 08, 11 | ✅ (revisable) |
| D11 | Post-login app is Client-only under `/app` | 02 section 3.1 | ✅ |
| D12 | AI: numbers from SQL only, 5/day limit enforced on the server | 02, 09 | ✅ |
| D13 | Negative balance is **allowed** and flagged (the real-world sale actually happened) | 01, 10, 11 | ✅ (revisable) |
| D14 | Subscription expiry = read-only, **no data deletion** | 12, 14 | ✅ |
| D15 | Catalog: store identity hidden, price/stock are not shared | 06 | ✅ (⚖️ lawyer) |
| D16 | Paid domain from day one | 05 section 4 | ✅ |
| D17 | Vercel Hobby for development only; any customers = commercial hosting | 05 section 0 | ✅ |
| D18 | Remove the floating (+) button from the demo | 07 | ✅ |
| D19 | Alert: near-expiry ≤ 7 days, "running low" thresholds from `09` section 8 | 09, 11 | ✅ (customizable) |
| D20 | **Use Webpack for build and dev** (`--webpack`) because Serwist requires Webpack plugins | ADR-0002 | ✅ (ADR proposed) |
| D21 | **Local Postgres host port 5434** (`HESBA_POSTGRES_PORT=5434`) to avoid port collision with host PostgreSQL | 17, docker-compose | ✅ |
| D22 | **Node >=22 and pnpm 10.20.0 pinned** for deterministic builds and LTS runtime support | package.json | ✅ |
| D23 | **`agentRules: false` in `next.config.ts`** to prevent Next.js CLI from mutating `AGENTS.md` | next.config.ts | ✅ |
| D24 | **Manual subscription renewal**: subscriptions are renewed by manual transfer (Vodafone Cash or InstaPay), confirmed on WhatsApp, and activated by the owner | ADR-0008 | ✅ Accepted |
| D25 | **Product variants**: every sellable item is a product; variants carry flavor, size, unit, pack quantity, barcode, price, stock | ADR-0009 | ✅ Accepted |
| D26 | **Services and commissions**: serialized cards sold once (PIN encrypted with HESBA_CARD_KEY); bills/transfers non-stock with rule-based fee | ADR-0010 | ✅ Accepted |

## 2. Open decisions (need your input)
| # | Decision | Options | My recommendation | Needed before |
|---|---|---|---|---|
| O1 | **Hosting** | A: Vercel Pro · D: VM + Docker · C: Cloudflare | After verifying the ❓ points in `05`: A for simplicity, or D if you are sure of the terms | Phase 1 |
| O2 | **SMS provider (OTP)** | (to be decided from actual quotes) | One that reliably delivers to Egyptian numbers + simple API + a fallback | Phase 2 |
| O3 | **Subscription renewal** | Settled (D24 / ADR-0008: Manual renewal via Vodafone Cash & InstaPay) | Manual transfer + WhatsApp confirmation; activated by owner | Settled ✅ |
| O4 | **LLM provider** | (compare cost and quality in Arabic) | Behind an interface; start with the cheapest that is good enough | Phase 4 |
| O5 | **Hesba name/brand** | Check domain and trademark availability ⚖️ | Before any marketing spend | Phase 0 |
| O6 | **Catalog values:** daily suggestion cap, size of the first wave, N for promotion, K for reports | (06 section 1) | Start with small, conservative values and adjust by measurement | Phase 4 |
| O7 | **Default sharing:** enabled (opt-out) or disabled (opt-in)? | opt-out / opt-in | opt-out with full transparency, **after lawyer approval ⚖️** | Phase 2 (sign-up) |
| O8 | **Demo data at sign-up** | Mixed-in fake data / ready to delete with one button / remove it | Ready to delete with one button, flagged `demo=true` | Phase 2 |
| O9 | **Selling an "out of stock" product** | Block / allow and flag negative | Allow and flag negative (D13) | Phase 3 |
| O10 | **2FA for the admin account** | Mandatory / optional | Mandatory | Phase 4 |
| O11 | **Retention policy** (sync_ops, audit, account deletion) | Durations | After the lawyer ⚖️ | Phase 5 |
| O12 | **On-device catalog search library** | Search on `name_norm` only / lightweight library | Start simple and measure | Phase 3 |
| O13 | **Router inside `/app`** | React Router / TanStack Router | The simplest and smallest after a quick comparison | Phase 1 |
| O14 | **Plan and pricing** | (from the cost calculation) | After Alpha | Phase 4 |
| O15 | **Team size/Freelancers** | — | Depends on budget | Phase 0 |
| O16 | **User reporting system** (support): WhatsApp/Telegram/in-app | — | One simple channel | Phase 6 |

## 3. ❓ Verify before relying on it
| # | Topic | Verify from | Task |
|---|---|---|---|
| V1 | Current Vercel Pro price and what is included | Official provider page | P0-D-05 |
| V2 | Commercial-use terms for Cloudflare (Workers/Pages) and Next compatibility | Their docs + a test | P0-D-05 |
| V3 | Free hosting alternatives that allow commercial use | Providers | P0-D-05 |
| V4 | Cron limits on the chosen hosting | Their docs | P0-D-05 |
| V5 | Minimum CU on Neon Free | Their docs | P0-D-05 |
| V6 | S3-compatible storage (free/paid) | Providers | When needed |
| V7 | **Antigravity:** reading of `AGENTS.md` and `.agents/rules/` and the 12,000-character limit | Official Google docs + a trial | Before Phase 1 |
| V8 | **Serwist** compatible with the pinned Next version | Its docs + a trial | P1-F-01 |
| V9 | `set_config` on the pooled URL in Neon | Actual test | P1-B-03 |
| V10 | Argon2 timing on the chosen hosting | Measurement | P2-B-01 |
| V11 | Function timeout and request size limit (determines the Sync batch size) | Hosting docs | P2-B-04 |
| V12 | Government e-invoice/e-receipt requirements | ⚖️ Lawyer/official source | Before V3 |
| V13 | iOS behavior (PWA install, IndexedDB, Push) | Device test | Phase 5 |

## 4. ⚖️ Legal (lawyer before production)
1. Personal Data Protection Law 151/2020: consent, purpose, retention, user rights, reporting, registration/licensing.
2. **Where data is stored** (transfer outside Egypt) → determines hosting.
3. Terms and privacy (including third-party data: the store's customers/suppliers).
4. **Sharing product definitions** between stores + anonymization + opt-out option.
5. Advertising and marketing claims.
6. Trademark and name.
7. Recurring subscriptions and the cancellation and refund policy.

## 5. Assumptions and values that must be measured/determined (log of guessed values)
| Value | Current assumption | Measured from | Updated in |
|---|---|---|---|
| Sales/store/day `S` | 150 (calculation assumption) | Alpha | `01` section 2 |
| Items/invoice `L` | 3 | Alpha | `01` |
| Devices/store `D`, working hours `H`, peak `K` | 2 / 10 / 3 | Alpha | `01` |
| Row size `B` | 250 bytes | DB measurement | `01` |
| Storage growth/store/day | ≈ 0.3 MB | Alpha | `05` section 3 |
| Maximum operations per push request | (small value, to be tuned) | Hosting timeout + measurement | `constants.ts` |
| Sync debounce | (a few seconds) | Usage experience | `constants.ts` |
| OTP limits (attempts, sends/day, validity) | (determined with the SMS provider) | Provider | `constants.ts` |
| Daily suggestion cap, N, K | (small values) | Acceptance rate | `constants.ts` |
| Bundle size budget | (after the first Build) | Build | CI |
| Argon2 parameters | (after measurement) | Measurement | `config` |
| Alert thresholds (3 kg, 2× carton, 10, 7 days) | From the demo | Store feedback | `09` section 8 |
| Performance targets (p95…) | `01` section 1 (preliminary) | Load test | `01` |
**The Agent:** any new value you guess is added here and flagged in the code with a comment `// ASSUMPTION: see docs/15`.

### 5.1 Data to be provided by owner before Phase 3
The owner must provide the following data before Phase 3:
- Products master list: TBD by owner (owner to provide)
- Prepaid card denominations and prices per network: TBD by owner (owner to provide)
- Bill providers: TBD by owner (owner to provide)
- Transfer commission tiers: TBD by owner (owner to provide)

## 6. ADRs (required architecture decisions)
| # | Title | Status | Written in |
|---|---|---|---|
| 0001 | Project structure (single package, import boundaries) | Proposed (from 03) | Phase 1 |
| 0002 | Use Webpack for build and dev because Serwist needs it | Proposed | Setup |
| 0003 | `change_log`: Trigger or Repository | **Open** | Phase 2 |
| 0004 | Session storage (rotating cookie) | Settled (D8) — to be documented | Phase 2 |
| 0005 | Service Worker update strategy + Kill switch | **Open** | Phase 1–2 |
| 0006 | SMS provider | Proposed | Phase 0 |
| 0007 | Hosting and data residency | Proposed | Phase 0 |
| 0008 | Manual renewal via Vodafone Cash and InstaPay | Accepted | Phase 0 |
| 0009 | Product variants | Accepted | Phase 0 |
| 0010 | Services: prepaid cards, bills and transfers with commissions | Accepted | Phase 0 |
| 0011 | Local catalog search library | **Open** (O12) | Phase 3 |
| 0012 | Router inside `/app` | **Open** (O13) | Phase 1 |
| 0013 | LLM provider | **Open** (O4) | Phase 4 |
The template is in `docs/adr/template.md`. The Agent writes the draft, and you approve.

## 7. Decision change log
| Date | Change | Reason |
|---|---|---|
| 2026-10-15 | From NestJS+Vite to a single Next.js app | Simpler deployment and maintenance |
| 2026-10-15 | From BullMQ/Redis to a jobs table + cron | Free/serverless hosting |
| 2026-10-15 | From JWT in IndexedDB to an httpOnly cookie | Higher security, same origin |
| 2026-10-17 | Added the full package (07–16) + AGENTS.md | Preparing for Antigravity |
| 2026-10-20 | Use Webpack for Serwist, host Postgres port 5434, Node >=22, pnpm 10.20.0, agentRules false | Repository setup and local environment requirements |
| 2026-10-24 | ADR-0006 (SMS, proposed), ADR-0007 (Hosting, proposed), ADR-0008 (Manual renewal via Vodafone Cash/InstaPay, accepted) | Phase 0 decisions |
| 2026-10-24 | Switched Phase 4 billing to manual renewal (ADR-0008). Task IDs repurposed: P4-B-05 (manual admin activation and audit logging), P4-F-03 (renewal info and WhatsApp link), P4-Q-03 (manual renewal and expiry tests), S-20 (receiving accounts setup) | Owner decision (simplicity, familiar Egyptian transfer methods, zero card data stored) |
| 2026-10-24 | ADR-0009 (Product variants, accepted), ADR-0010 (Services: prepaid cards, bills and transfers with commissions, accepted) | Phase 0 decisions (P0-D-06) |
