# ADR-0010: Manual renewal via Vodafone Cash and InstaPay, no payment gateway

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba provides a subscription SaaS for small grocery stores and supermarkets in Egypt (`docs/07-PRODUCT-BRIEF.md`, `docs/14-ROADMAP-AND-EVOLUTION.md`). The original roadmap envisioned integrating an automated Egyptian payment gateway (such as Paymob, Fawry, or Kashier) with webhooks and recurring card/wallet billing. 

However, integrating an automated payment gateway brings significant transaction fees, contract overhead, tax registration prerequisites, webhook failure modes, and PCI-DSS compliance surface. Furthermore, small grocery owners in Egypt are accustomed to peer-to-peer instant digital transfers via mobile wallets (Vodafone Cash) and national instant banking (InstaPay), and often avoid entering payment cards into software applications.

## Options

1. **Option A: Automated Payment Gateway (Paymob, Fawry, Kashier)**
   - **Pros:** Automated renewal upon webhook arrival, no manual operator intervention needed.
   - **Cons:** Commercial setup fees, transaction cuts (2.5% to 3.5% + fixed fee), merchant commercial register requirements, webhook reconciliation logic, and card data compliance concerns.
   - **Cost:** Ongoing percentage fee per subscription + integration engineering time.

2. **Option B: Manual Renewal via Vodafone Cash and InstaPay (WhatsApp Confirmation)**
   - **Pros:** 100% familiar and trusted by Egyptian shopkeepers; zero payment gateway integration complexity; zero payment processing fees; zero card data stored; zero webhook vulnerability surface.
   - **Cons:** Requires manual administrative action by the Hesba operations team to verify transfers and update store subscription status.
   - **Cost:** 0 EGP in transaction gateway fees.

## Decision
We chose **Option B: Manual renewal via Vodafone Cash and InstaPay, no payment gateway**.

**Reason:** The owner decided that subscription payments are made by manual transfer (Vodafone Cash and InstaPay) and confirmed by WhatsApp message. The app does not process online payments, executes no financial transactions, and stores no payment card data. When a renewal is confirmed via WhatsApp, an admin extends the store's subscription end date through internal admin operations.

## Consequences
- **Positive:**
  - Greatly reduces Phase 4 development complexity; eliminates the need for external payment gateway webhooks, signature validation, and reconciliation jobs.
  - Zero PCI-DSS or card data storage liability (`docs/12-SECURITY-AND-PRIVACY.md`).
  - Perfect alignment with Egyptian merchant expectations and habits.
- **Negative/risks:**
  - Administrative overhead for manually verifying incoming transfers and updating store subscriptions as customer volume grows.
- **What must change:**
  - Settles open decision O3 in `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` and records decision D24.
  - Simplifies Phase 4 subscription tasks in `docs/04-TASKS.md` (P4-B-02, P4-F-02) to focus on subscription display, expiration warnings, and renewal instructions rather than automated gateway integration.
- **When to revisit:**
  - When the volume of active paying shops exceeds the operational capacity for manual transfer verification (e.g., > 100–200 active stores).
