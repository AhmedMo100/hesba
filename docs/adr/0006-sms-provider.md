# ADR-0006: SMS provider

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
User identity, store registration, and account recovery in Hesba rely on Egyptian mobile phone numbers and One-Time Passwords (OTP). Quick and reliable SMS delivery to all four Egyptian telecommunications networks (Vodafone, Orange, e&/Etisalat, WE) is critical to ensure users are not blocked during signup or login. The solution must feature a simple HTTP API, high deliverability within Egypt, sensible rate limits to prevent budget exhaustion, and an interface architecture that supports fallbacks (`docs/12-SECURITY-AND-PRIVACY.md`, `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` item O2).

## Options

1. **Option A: Local Egyptian SMS Gateway (e.g., SMSMisr, VictoryLink, Misr SMS)**
   - **Pros:** Native routing across Egyptian carriers; local sender ID registration; billed directly in Egyptian Pounds (EGP).
   - **Cons:** Commercial onboarding and API documentation quality varies; dashboard automation may be less mature than international platforms.
   - **Cost:** Domestic SMS rates typically ~0.25 to 0.40 EGP per OTP.

2. **Option B: Global SMS Platform (e.g., Twilio, Infobip, Sinch)**
   - **Pros:** Excellent documentation, high availability, reliable webhooks, instant automated onboarding.
   - **Cons:** Significantly higher cost per message terminating on Egyptian networks; messages may face international route filtering unless expensive local sender IDs are pre-registered; billed in USD/EUR.
   - **Cost:** ~$0.04 to $0.08 USD per message.

3. **Option C: Direct Local Gateway with WhatsApp Business OTP Fallback**
   - **Pros:** WhatsApp has ubiquitous adoption among Egyptian retailers; high delivery success when cellular SMS is delayed.
   - **Cons:** Requires Meta Business Account verification, pre-approved OTP message templates, and maintenance of two separate communication channels.
   - **Cost:** Per-conversation Meta authentication fees + base SMS costs.

## Decision
The decision remains **Proposed** (Open decision O2). No specific vendor has been selected pending comparative quotes, deliverability benchmarking, and sender ID paperwork in side track S-05. 

To keep the system decoupled, all SMS interactions will be encapsulated behind an abstract `SmsProvider` interface in `src/server`, with a `MockSmsProvider` used for local development, automated testing, and CI environments.

## Consequences
- **Positive:** Switching providers or adding a secondary fallback requires updating only the adapter implementation without touching authentication domain logic.
- **Negative/risks:** Procurement and registration of Egyptian sender IDs can take several weeks; must be initiated in parallel with Phase 1.
- **What must change:** Documented in `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` under item O2; environment variables defined in `.env.example` (`HESBA_SMS_PROVIDER`, `HESBA_SMS_KEY`).
- **When to revisit:** Prior to Phase 2 task P2-B-01 (SMS client implementation).
