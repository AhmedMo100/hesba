# حسبة (Hesba) — Roadmap & Evolution

> **Rule:** this Roadmap is **directions, not commitments.** Every feature after V1 enters **by data** (real usage, repeated requests from shops, metrics), not by enthusiasm. Simplicity above everything.
> No invented dates or numbers here. Dates are set after Alpha, and numbers come from reality.

---

## 1. Admission rule for any new feature (Feature Admission)
A feature enters the Roadmap if **all** of these conditions are met:
1. **A real need:** ≥ X shops (X from Alpha/Beta) asked for it or use a manual workaround for it.
2. **It does not add a step** to the core path (sell/add goods), or it removes a step of equal size.
3. **It is done in few steps** and with a simple screen on mobile.
4. **Works offline** or there is a clear decision on why not.
5. **Its cost** (development + maintenance + plan/SMS/AI consumption) is known and acceptable.
6. **Conflicts with** a principle in `07` section 3? No.
**Removal rule:** a feature with low usage after a measurement period = gets simplified or removed.

## 2. Release overview

| Release | Goal | Enters when… |
|---|---|---|
| **V1 (launch)** | The eight pages + offline + shared catalog + subscription and payment + AI | Phases 0–7 in `04` are done |
| **V1.1** | Improvements from Alpha/Beta + the top requests | Beta data says what matters most |
| **V1.2** | Selling productivity and reducing manual entry | Selling or adding goods is the bottleneck |
| **V2** | Shop team + report depth | Large shops ask for workers/permissions |
| **V3** | Expansion (branches/integrations/native) | A stable customer base |

## 3. Candidate features (ordered by initial priority — changes with data)

### V1.1 — Initial improvements
| Feature | Why | Notes |
|---|---|---|
| **A cart with more than one item in an invoice** | Faster selling if the customer buys several things | Tables are ready (`sales` + `sale_lines`). Done without slowing the single-item sale |
| **Barcode scanner via camera** | Faster add/sell, matches the catalog | Web `BarcodeDetector` + a wasm fallback; test on weak devices |
| **Worker permissions (cashier)** | A worker who only sells and cannot see profits | The role exists in `member_role`; screens + server check |
| **Automatic WhatsApp reminder for "owed to you" debts** | Faster collection | A `wa.me` link with ready text (no API) |
| **Suggestion improvements** | Catalog quality | Tune the filters/cap/N from acceptance data |
| **Import products from CSV/Excel** | Faster first setup for the shop | Goes through the same catalog matching |
| **Export reports (CSV/simple PDF)** | For the accountant | From `daily_store_stats` |

### V1.2 — Reducing entry
| Feature | Why | Notes |
|---|---|---|
| **Voice input** (the microphone button in the demo) | Add/sell hands-free | Web Speech API if supported; dialect testing required; not essential |
| **Reorder suggestion** | "What should I order?" | From average daily sales + balance + lead time; **computed with SQL, not an LLM** |
| **Simple sales/stock forecasts** | Planning | Simple statistics (averages), with no accuracy claims |
| **Supplier orders** | A ready message with the order for the supplier | WhatsApp/copy text |
| **Scan the supplier invoice (OCR)** | Faster goods entry | **Experimental**, after measuring feasibility and accuracy |

### V2 — Team and depth
| Feature | Notes |
|---|---|
| **More than one user/device with detailed permissions** | A log of who did what (`audit_log` exists) |
| **Shift/day close** (cash in the drawer) | If shops ask for it |
| **Deeper reports** (profit by item/category, supplier activity) | New aggregate tables, not queries on raw data |
| **Supplier rating/purchase price comparison** | From batch history |
| **Suggested pricing** | From cost and margin, **a suggestion, not a decision** |
| **Broader admin dashboard** | Support, catalog, monitoring shop health |

### V3 — Expansion (needs strategic and legal review)
| Feature | Notes |
|---|---|
| **Multiple branches** | A change to the `store` model; a big ADR |
| **Native wrapper** (TWA/Capacitor) for the Play Store | Same PWA; real Push notifications |
| **Government electronic invoice/receipt** | ⚖️ Needs verification of current requirements and an approved authority; **we do not assume** |
| **Public API and integrations** | After the schema stabilizes |
| **Other languages** | i18n |
| **Invoice printing/thermal printers** | If there is real demand, via Bluetooth/an intermediary |
| **Marketplace/online ordering for the shop** | Far off; outside the current principle |

### Deferred ideas (until the need is proven)
Product images · loyalty points · automatic offers and discounts · full accounting · budgeting · human resources.

## 4. Product evolution after launch (a cycle)
```
Measure (actual usage, where does the user stop?)  →  Interviews (every week in Alpha/Beta)
   →  Priorities (Top 10 by data)  →  Implement a small phase (2 weeks)  →  Measure the impact  →  Repeat
```
**Metrics to track from day one (without personal data):** days of use/week, sales operations/shop/day, rejected-operations ratio, sync time, UI errors, usage of each page, suggestion acceptance, AI usage, retention rate.

## 5. Technical capability evolution (tied to `01` and `05`)
| Event (happens by measurement) | Action |
|---|---|
| First paying customer | Commercial hosting (`05` section 0) |
| Storage/CU-hours passed 70% | Upgrade Neon (a plan upgrade without migration) |
| p95 or connections passed the limits | Indexes/Pooling then bigger resources |
| The tick is not enough | A standalone Worker or a real Queue |
| Sync became the heaviest | Split it out as a standalone Deployment |
| Large table size | Monthly Partitioning + archiving (Stage 3) |
| Nearing the limit of one machine | A Scale-up or Sharding by `store_id` decision (Stage 5) |
| We need Push | Web Push (VAPID) + iOS testing |
Detailed stages and indicators are in `01` section 6, `05` section 7 and `04` (G0–G5).

## 6. Team evolution
| Stage | Minimum team | Notes |
|---|---|---|
| Phase 0–5 | You + AI Agent (Antigravity) + human review | Human review of Sync/FEFO/RLS/Auth/payment is mandatory |
| Alpha/Beta | + a part-time support/product person | Visits and calls to shops |
| 500+ shops | + a second developer | Support and on-call load |
| 2,000+ shops | + DevOps/SRE | Monitoring, Failover, cost |
| 5,000+ shops | + a support/sales team | Formal on-call |
No headcounts/salaries here; the budget comes from reality (`04` P0-B-03).

## 7. Subscription evolution (without invented prices)
- **V1:** one simple plan + a trial period. The price comes from the actual cost calculation ÷ active shops + margin (after Alpha).
- **Later (by data):** a higher plan for (workers/branches/reports), or annual with a discount. **We do not add plans before shops ask for a difference in usage.**
- **Fixed rule:** subscription expiry = read-only, **no data deletion**.
- Local payment methods (gateways/InstaPay/Fawry) are verified with the providers.

## 8. Roadmap risks
| Risk | Action |
|---|---|
| **Feature creep** (adding features that spoil simplicity) | The admission rule (section 1) + the removal rule |
| Building on one opinion | Data + 5+ shops |
| V2/V3 features increasing complexity prematurely | We do not start V2 before V1 achieves the target retention |
| The Agent drifting into unrequested features | `AGENTS.md`: one phase, `15` for decisions |
| Relying on unproven features (OCR/voice) | Experimental + measurement + quick disable (flags) |

## 9. Roadmap review
At every **phase end** (Alpha, Beta, every 500 shops): we review the priorities, update this file, and record the decisions in `15`.
