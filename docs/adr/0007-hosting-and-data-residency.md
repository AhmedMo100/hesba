# ADR-0007: Hosting and data residency

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba is an offline-first PWA for small supermarkets and grocery stores in Egypt, structured as a single Next.js application with a PostgreSQL database enforcing Row-Level Security (RLS). The system architecture requires hosting for the web application and its API Route Handlers, as well as a database hosting provider. The team is small, requires low operational overhead, and operates under strict data residency and Egyptian Law 151/2020 privacy requirements (`docs/12-SECURITY-AND-PRIVACY.md`). The solution must avoid provider lock-in (`docs/05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md`).

## Options

1. **Option A: Vercel Pro + Neon Free**
   - **Pros:** Native Next.js App Router support, automatic preview deployments per PR, managed global edge routing, zero infrastructure management.
   - **Cons:** Commercial licensing requires Vercel Pro ($20/seat/month) from the first paying customer; Serverless Function execution limits.
   - **Cost:** ~$20/user/month fixed baseline plus pay-as-you-go Neon usage after free tier exhaustion.

2. **Option B: Vercel Hobby + Neon Free**
   - **Pros:** Zero financial cost during early development.
   - **Cons:** Strictly violates Vercel Terms of Service for commercial applications or paying users; cannot be used once real shops onboard.
   - **Cost:** $0 (non-commercial only).

3. **Option C: Cloudflare (Workers/Pages via OpenNext) + Neon Free**
   - **Pros:** Global CDN edge network, generous free tier request quotas.
   - **Cons:** Free tier 10 ms CPU execution limit is too restrictive for full Next.js App Router SSR/API handling; compatibility with all Node.js native libraries requires OpenNext shims; commercial terms unverified.
   - **Cost:** $0 (high technical friction).

4. **Option D: Always-free VM / Low-cost VPS (e.g. Hetzner) + Docker (`next start` standalone) + Neon Free**
   - **Pros:** Full runtime control, no serverless timeouts or CPU caps, directly utilizes existing multi-stage `Dockerfile` (standalone), portable anywhere.
   - **Cons:** Requires manual maintenance, Linux security patching, reverse proxy (Caddy/Nginx) configuration, and monitoring without automated cloud scaling.
   - **Cost:** $0 on always-free tiers or ~$5/month on entry-level VPS.

## Decision
The decision remains **Proposed** while evaluating commercial-use terms and side task S-07. The initial development phase operates under Option B for internal pre-alpha work, with the intention to transition to Option A (for zero-maintenance simplicity) or Option D (for cost efficiency and full control via Docker) before real commercial shops are onboarded in Alpha/Beta.

## Consequences
- **Positive:** Application remains completely portable via standard Next.js standalone output and Docker; no platform lock-in.
- **Negative/risks:** The production hosting target must be finalized and funded before launching Alpha with live stores.
- **What must change:** Documented in `docs/05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md` and tracked in `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` under item O1.
- **When to revisit:** Prior to Phase 2 end / Phase 3 beginning, upon completion of side task S-07.
