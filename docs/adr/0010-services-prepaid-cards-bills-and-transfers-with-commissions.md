# ADR-0010: Services: prepaid cards, bills and transfers with commissions

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Egyptian supermarkets and kiosk shops provide critical daily financial services alongside physical merchandise:
1. Physical scratch cards (recharge/prepaid cards for telecom/internet providers: Vodafone, Orange, Etisalat, WE).
2. Bill payments (landline, internet, mobile bills, utility bills).
3. Digital peer-to-peer cash transfers / wallet services (Vodafone Cash deposits/withdrawals, InstaPay transfers).

These transactions have distinct economic and operational properties compared to regular grocery goods:
- Prepaid cards carry serialized inventory where each physical item contains a sensitive voucher PIN that must be securely tracked, sold exactly once, and revealed safely.
- Bill payments and wallet transfers carry no physical inventory. Instead, they involve an transferred principal amount and a service commission fee earned by the merchant.
- Commission fees must be accurately calculated from predefined rules based on transfer amount ranges to avoid merchant calculation mistakes or cashier skimming, while permitting authorized overrides when necessary.

## Options
1. **Option A: Generic custom product sales with arbitrary notes**
   - **Pros:** No special schema required.
   - **Cons:** High risk of double-selling cards, leaking secret card PINs in plaintext logs, erroneous commission calculations, and lack of audit trails for manual fee modifications.
2. **Option B: Dedicated service domain model with serialized card tracking and rule-driven commissions**
   - **Pros:**
     - Prepaid cards are treated as stock items with unique serial numbers/PINs (`card_serials`). Each card is sold exactly once; a sold card cannot be sold again.
     - Card PINs are treated as secrets: encrypted at rest with `HESBA_CARD_KEY`, never logged in plain text or telemetry, and displayed to the cashier only once at the moment of sale.
     - Non-stock financial services (bills, wallet transfers) are modeled as service sales with an amount and an automated commission.
     - Commissions are governed by configuration rules with ranges (`provider`, `from_amount`, `to_amount`, `fee_type` fixed or percent, `fee_value`, `effective_from`).
     - The fee is computed deterministically from the applicable rule, never typed by hand except via an explicit override requiring a reason that is recorded in `audit_log`.
   - **Cons:** Requires dedicated schema tables (`service_items`, `card_serials`, `commission_rules`) and specialized UI flows.

## Decision
We chose **Option B: Dedicated service domain model with serialized card tracking and rule-driven commissions**.

Key rules accepted:
1. **Prepaid cards are stock items**: Each card has its own serial/PIN. A card is sold once. A sold card cannot be sold again.
2. **Bills and transfers have no stock**: Internet/mobile bills and Vodafone Cash / InstaPay transfers are recorded as service sales with an amount and a commission.
3. **Automated commission rules**: Commissions are stored as rules with ranges (`provider`, `from_amount`, `to_amount`, `fee_type` fixed or percent, `fee_value`, `effective_from`). The fee is computed from the rule, never typed by hand except by an explicit override with a reason that is logged.
4. **Card PIN secrecy**: Card PINs are secrets: encrypted at rest with `HESBA_CARD_KEY`, never logged, and shown to the cashier only once upon sale completion.

## Consequences
- **Positive:**
  - Prevents revenue loss from cashier math errors or miscalculated commission tiers.
  - Guarantees zero double-sale of scratch cards.
  - Protects customer/merchant secrets by encrypting card vouchers at rest and scrubbing them from logs.
- **Negative/risks:**
  - Need to manage cryptographic key `HESBA_CARD_KEY` in environment configuration.
  - Requires clear UI workflow for quick service selection and one-time PIN revealing.
- **What must change:**
  - `docs/09-DATABASE-SCHEMA.md`: Add `card_serials`, `service_items`, `commission_rules` to the table list.
  - `docs/08-TECH-STACK.md`: Add `HESBA_CARD_KEY` to environment variables list.
  - `docs/04-TASKS.md`: Add tasks `P3-B-12` (services and commissions), `P3-F-14` (services screen), and `P3-Q-04` (commission and card tests).
  - `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md`: Record ADR-0010 as accepted and list owner prerequisite data.
- **When to revisit:**
  - When direct API integrations with bill aggregator gateways (e.g. Fawry, Aman) are considered in future phases.
