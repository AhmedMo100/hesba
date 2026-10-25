# حسبة (Hesba) — Tech Stack (The Approved Stack and Why)

> The decision: **Full-stack TypeScript, a single Next.js app, Postgres, offline-first with Dexie.**
> The best choice is not "the newest thing"; it is the **fewest moving parts** for a small team + an AI Agent writing the code + a product that must work offline.
> **Versions:** We do not write version numbers here (they change). The Agent pins the latest stable version at creation time in `package.json` + the lockfile, and any major upgrade requires an ADR.

---

## 1. The Main Table

| Layer | Choice | Why | Rejected alternative (and why) |
|---|---|---|---|
| **Language** | TypeScript (strict) | One language for the UI and the server, shared types, the Agent is good at it | Plain JS (more errors) |
| **Framework** | **Next.js (App Router)** | One app (front end + server), Server Actions, Route Handlers, easy deployment | Vite + NestJS (two parts and more maintenance) |
| **UI** | React | Standard, the demo is written in it | Vue/Svelte (no reason to switch) |
| **Database** | **PostgreSQL** (Neon at first) | RLS to isolate shops, strong transactions for inventory, `pg_trgm` for search | MongoDB/Firebase (weak transactions, harder isolation), SQLite (multi-device sync is harder) |
| **ORM/Migrations** | **Prisma** (schema.prisma + migrations) | Declarative schema, type-safe client, RLS via raw SQL migrations and interactive transactions (ADR-0012) | Micro-ORMs without schema generators |
| **Local database** | **Dexie** (IndexedDB) | Source of truth on the phone, `useLiveQuery` | localStorage (small), SQLite-WASM (heavier, less mature) |
| **PWA / Service Worker** | **Serwist** (Workbox for Next) | Precache + Background Sync for App Router | next-pwa (unmaintained) |
| **Validation** | **zod** | A single source of types between client and server | Yup/Joi |
| **Sessions/Auth** | Simple custom: OTP + Argon2id (`@node-rs/argon2`) + httpOnly session cookie in the DB | Full control, same origin, no dependence on a provider | Auth0/Clerk (cost and vendor lock-in), Auth.js (complexity with OTP and devices) |
| **Styling (CSS)** | **CSS variables + CSS Modules**, ported from the demo | The demo is tested and polished; porting preserves quality instead of a rewrite | Tailwind (more familiar to the AI, but a rewrite loses design details) |
| **Components** | Our own components from the demo (Modal, Seg, Combobox...) | Tuned for RTL and mobile | Off-the-shelf libraries (mostly LTR and do not match the demo) |
| **State** | Dexie + `useState`; a small Zustand if needed | Domain data lives in Dexie only | Redux (overkill) |
| **Charts** | Custom SVG (like the demo's `BarChart`) | No library, smaller bundle | Chart.js/Recharts (heavy) |
| **i18n** | Simple JSON (`ar.json`) + a `t()` function | Arabic only in V1 | next-intl/i18next (overkill until we add a language) |
| **Dates** | `Intl` + small functions (like the demo) | No library | moment/dayjs |
| **Jobs** | A `jobs` table in Postgres + `/api/cron/tick` | No permanent Workers on free tiers/serverless | BullMQ/Redis (we move to it when measurements justify it) |
| **AI** | An LLM provider behind an interface + SQL tools | Numbers come from SQL, the LLM only phrases them; we can swap the provider | Relying on the LLM for calculation (hallucination) |
| **SMS** | A provider behind an interface (to be decided — ADR-0006) | OTP for sign-up only | — |
| **Subscriptions** | Manual renewal (Vodafone Cash & InstaPay) + WhatsApp confirmation (ADR-0008) | Activated manually by owner; no card data stored | Automated third-party billing (rejected in V1) |
| **Monitoring** | Sentry + structured logs (pino) | UI and server errors | — |
| **Testing** | Vitest + fast-check + Testcontainers + Playwright | Unit + property + real Postgres + offline | Jest (slower with ESM) |
| **Quality** | ESLint (+ boundaries) + Prettier + `tsc` | Import boundaries are enforced automatically | — |
| **Packages** | pnpm + Node LTS | Fast, strict lockfile | npm/yarn |
| **CI/CD** | GitHub Actions | Lint + Types + Tests + Docker build + backups | — |
| **Hosting** | Per `05` (Vercel Pro / Docker on a VM) + Neon | **Hobby is non-commercial** | — |
| **Domain/DNS/CDN** | Cloudflare | WAF + DNS + SSL | — |
| **Containers** | Docker (`output: 'standalone'`) | Portability + testing an exit from any provider | — |

## 2. Why Is This "The Best" for Hesba Specifically?
1. **Fewest moving parts:** One app + one Postgres. No Redis, no Workers, no separate API in V1. Every extra part is a maintenance burden for a small team.
2. **Offline is the foundation:** Dexie + Outbox + Service Worker are the heart of the product, not an add-on. The rest of the stack is chosen to serve that.
3. **Shop isolation in the database:** Postgres RLS protects even if the code has a bug.
4. **The AI Agent works better:** A single TypeScript + a fixed structure + zod as the source of types = fewer errors and easier review.
5. **No provider lock-in:** Everything external sits behind an interface, and Postgres/Docker/S3 are standard.
6. **Light on weak phones:** No heavy libraries, lazy chunks, SVG instead of Charts.

## 3. Explicit Constraints and Warnings
- **Vercel Hobby (the free tier) is non-commercial only** — `05` section 0. The stack itself is not locked to Vercel.
- **Next.js + offline:** App Router relies on RSC payloads; that is why the app after login is **Client-only** under `/app` (`02` section 3.1). Only the landing page is Server-rendered.
- **Server Actions are not suitable for sync** (their identifiers change with every Build, and they cannot be called from the Service Worker) → `/api/sync/*` (`02` section 2).
- **Serwist:** Confirm at creation time that it is maintained and compatible with the Next version you will pin (a verification task in Phase 1). If it is not compatible: an ADR and an alternative (a Service Worker written directly with Workbox).
- **Argon2 on serverless:** It consumes CPU. Measure the time and tune the parameters (`12`).
- **Neon free tier:** 1 GB storage, sleeps after idle, and only 6 hours of history → a dedicated backup (`05`).
- **Dexie on old devices:** Test on a weak Android. Browser storage limits vary (show them in Settings if we get close).
- **iOS:** Push notifications and PWA installation need different steps (test Safari). Push is not required in V1.

## 4. What We Will Not Use in V1 (a decision)
A separate NestJS/Express · Redis/BullMQ · Prisma · Tailwind · Redux · a Charts library · Firebase/Supabase Auth/Realtime · Vercel KV/Blob/Edge Config · GraphQL · tRPC · Microservices · WebSockets (sync is event-driven plus `pull`) · React Native/Flutter.
**Any exception = ADR.**

## 5. Dependency Policy
1. Every new dependency requires a written reason (in the PR or an ADR): What does it solve? Why don't we write it ourselves? Its size? Its maintenance?
2. The app's initial bundle is governed by a size budget in CI. A heavy dependency = dynamic `import()` or rejected.
3. `pnpm audit` + Dependabot in CI. A small weekly upgrade is better than a big jump.
4. No dependency locked to a provider (`05` section 6).
5. The lockfile is always committed. No `latest` in versions.

## 6. Environment Variables (names only)
```
HESBA_DATABASE_URL      # pooled (for the app)
HESBA_DIRECT_URL        # direct (for migrations)
HESBA_SESSION_SECRET
HESBA_CRON_SECRET       # protects /api/cron/tick
HESBA_SMS_PROVIDER / HESBA_SMS_KEY
HESBA_LLM_PROVIDER / HESBA_LLM_KEY
HESBA_CARD_KEY
HESBA_SENTRY_DSN
HESBA_STORAGE_*         # S3-compatible (if needed)
HESBA_APP_ORIGIN        # for Origin check
HESBA_RENEWAL_VODAFONE_CASH  # public: Vodafone Cash number shown to customers
HESBA_RENEWAL_INSTAPAY       # public: InstaPay address/number shown to customers
HESBA_RENEWAL_WHATSAPP       # public: WhatsApp contact number/link for renewal confirmation
```
Real values live in the Secret store (except public renewal details), and `.env.example` contains dummy values only. All of them are defined in `src/server/config/env.ts` with zod, and the app fails at startup if anything is missing.

## 7. When Do We Change the Stack? (by measurement)
| Symptom | Possible change |
|---|---|
| The cron tick is not enough | A standalone Worker or a real Queue (BullMQ+Redis or an alternative) |
| Sync becomes the heaviest part | Split it out as an independent Deployment (same code) |
| The single database reached its limit | Replicas, then Sharding by `store_id` (`01` Stage 5) |
| We need real Push | Web Push (VAPID) + iOS testing |
| We need the Play Store | A TWA/Capacitor wrapper around the same PWA |
| We need another language | `next-intl` or an alternative |

## 8. Verification Checkpoints at the Start of Phase 1 (the Agent records the result in `15`)
- [ ] The latest stable version of Next/React/Prisma/Dexie/Serwist and their compatibility.
- [ ] Serwist works with the current App Router (precache + offline navigation inside `/app`).
- [ ] `set_config(..., true)` works correctly on the pooled URL.
- [ ] Docker `standalone` builds and runs.
- [ ] Argon2 time on the chosen hosting is acceptable.
