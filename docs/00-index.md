# حسبة (Hesba) — Documentation Index & Reading Order

> **Legacy prompt resolver:** Old file names in older prompts resolve through the mapping table below.
> Consolidated repository documentation package for the AI Agent (Antigravity) and development team.

---

## 1. The Hesba Project at a Glance
- **Hesba**: a very simple SaaS for managing supermarkets and small shops in Egypt (products, stock with batches and expiry dates, sales, expenses, people, alerts, AI assistant, home screen).
- Used **entirely from a mobile phone**, and works **offline-first** (PWA).
- The UI is **Arabic RTL** (simple Egyptian colloquial). **Simplicity above everything**: any feature that adds a step or clutter is rejected.
- **One Next.js app** (frontend + server). No separate API and no NestJS.
- Visual and behavioral reference: `docs/demo/hesba-demo.html` + its source in `docs/demo/src/`.

---

## 2. Reading Order (The 8 Consolidated Documents)

| Order | Document | Purpose & Scope | Read By |
|---|---|---|---|
| **1** | [docs/00-index.md](docs/00-index.md) | Reading order, index, legacy file resolution map, golden rules | Everyone, always |
| **2** | [docs/01-product.md](docs/01-product.md) | Product vision, scope, system design, scaling (0→5), roadmap, decisions (D1–D26) | Everyone |
| **3** | [docs/02-arch.md](docs/02-arch.md) | Software architecture, boundaries (Actions vs Handlers), folder structure, tech stack | Agent + Developers |
| **4** | [docs/03-data.md](docs/03-data.md) | Database schema, RLS policies, sync protocol (Push/Pull/rebase), catalog & suggestions | Agent + Developers |
| **5** | [docs/04-tasks.md](docs/04-tasks.md) | **Executable tasks phase by phase** (Phase 0→7) + Side Track (S) | Agent |
| **6** | [docs/05-ui.md](docs/05-ui.md) | UI/UX specifications, CSS tokens, screen states, colloquial copy, accessibility | Agent + Designer |
| **7** | [docs/06-quality.md](docs/06-quality.md) | Threat model, tenant isolation, Law 151/2020 privacy, test pyramid, fast-check | Agent + Reviewers |
| **8** | [docs/07-ops.md](docs/07-ops.md) | Project setup from zero, commercial hosting, upgrade runbooks, agent prompt sequence | You + Agent + DevOps |
| **—** | `docs/adr/` | Architectural Decision Records (ADR-0001 through ADR-0010) | Everyone |
| **—** | `docs/demo/` | Interactive demo (`hesba-demo.html`) + source `src/` (visual reference) | Visual reference |
| **—** | `docs/_old/` | Unchanged archive of original pre-consolidation documentation | Archival reference |

---

## 3. Old File to New Location Mapping Table

Every section of the original 18 documentation files is preserved in the consolidated files as mapped below:

| Old File Name | New Consolidated File | Target Sections & Contents |
|---|---|---|
| `docs/00-START-HERE.md` | [docs/00-index.md](docs/00-index.md) | §1 Project Overview, §2 Reading Order, §3 Directory Index, §4 Old→New Mapping Table, §5 Setup & Pre-start Checklist, §6 Antigravity Workflow & Golden Rules, §7 Package Release. |
| `docs/07-PRODUCT-BRIEF.md` | [docs/01-product.md](docs/01-product.md) | **Part 1**: §1 Idea, §2 Users, §3 Principles, §4 V1 Scope, §5 Out of Scope, §6 Shared Catalog, §7 Glossary, §8 Copy Tone, §9 Visual Identity, §10 Success Metrics, §11 Assumptions. |
| `docs/01-SYSTEM-DESIGN.md` | [docs/01-product.md](docs/01-product.md) | **Part 2**: §0 System Design in 10 Lines, §1 Numbers & Capacity, §2 Scaling Stages (0→5), §3 Main Components, §4 Offline-First & Sync, §5 Database, Inventory & Money, §6 Multi-Tenancy & Isolation, §7 Shared Catalog, §8 External Services, §9 System Risks & Mitigations, §10 Trade-offs & Alternatives. |
| `docs/14-ROADMAP-AND-EVOLUTION.md` | [docs/01-product.md](docs/01-product.md) | **Part 3**: §1 Feature Admission Rules, §2 Release Overview (V1→V3), §3 Candidate Backlog, §4 Product Evolution Cycles, §5 Technical Evolution, §6 Team Evolution, §7 Subscription Evolution, §8 Roadmap Risks, §9 Review Rhythm. |
| `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` | [docs/01-product.md](docs/01-product.md) | **Part 4**: §1 Decisions Made (D1–D26), §2 Open Decisions (O1–O16), §3 Verification Items (V1–V13), §4 Legal Checklist, §5 Assumptions & Guess Log, §5.1 Owner Prerequisite Data, §6 ADR Index Table, §7 Decision Change Log. |
| `docs/02-SOFTWARE-ARCHITECTURE.md` | [docs/02-arch.md](docs/02-arch.md) | **Part 1**: §1 Principles (Single App), §2 Actions vs Route Handlers, §3 Domain Isolation (`src/domain`), §4 Multi-Tenancy & Serverless Pooling, §5 PWA & Service Worker Lifecycle, §6 Jobs & Cron Tick, §7 External Resiliency. |
| `docs/03-FOLDER-STRUCTURE.md` | [docs/02-arch.md](docs/02-arch.md) | **Part 2**: §1 Full Directory Tree, §2 Import Boundaries Rules, §3 Component Placement, §4 Phase-by-Phase File Placement Guide. |
| `docs/08-TECH-STACK.md` | [docs/02-arch.md](docs/02-arch.md) | **Part 3**: §1 Main Stack Table, §2 Rationale for Hesba, §3 Constraints & Warnings, §4 Non-V1 Stack, §5 Dependency Policy, §6 Environment Variables (`HESBA_CARD_KEY`, public renewal vars), §7 Change Triggers, §8 Checkpoints. |
| `docs/09-DATABASE-SCHEMA.md` | [docs/03-data.md](docs/03-data.md) | **Part 1**: §1 General Rules & Enums, Variants/Services Table List (ADR-0009/10), §2 Identity & Store, §3 Catalog & Products, §4 Inventory (Batches + Movements), §5 Sales, §6 Expenses & People, §7 Sync & Jobs, §8 Subscriptions & Reports, §9 Global Tables List, §10 Migration Order, §11 SQL Queries. |
| `docs/10-SYNC-PROTOCOL.md` | [docs/03-data.md](docs/03-data.md) | **Part 2**: §1 Principles, §2 Endpoints & Headers, §3 Push Protocol & Server Algorithm, §4 Operations Payloads (4.1–4.5), §5 Pull Protocol & Rebase Rules, §6 Rejection Reasons, §7 Client States, §8 Schema Versions, §9 Mandatory Tests, §10 Scenarios. |
| `docs/06-CATALOG-AND-SUGGESTIONS.md` | [docs/03-data.md](docs/03-data.md) | **Part 3**: §0 Idea in 6 Lines, §1 Catalog Decisions, §2 Data Model & Normalization (`name_norm`), §3 Market Seed CSV (`data/catalog/`) & Mobile Sync, §4 Flows (4.1–4.6), §5 Abuse Protection, §6 Performance, §7 Tests, §8 Risks, §9 Notes. |
| `docs/04-tasks.md` | [docs/04-tasks.md](docs/04-tasks.md) | **Phases 0–7 + Side Track (S)**: Task IDs (`P0-PR-01`..`P7-D-04`, `S-01`..`S-53`, `P0-D-06`, `P3-B-10..12`, `P3-F-14`, `P3-Q-04`) preserved unchanged; internal doc links updated. |
| `docs/11-UI-UX-SPEC.md` | [docs/05-ui.md](docs/05-ui.md) | **§1–§11**: §1 Tokens & Typography, §2 Responsive Breakpoints (320/360/390), §3 Motion, §4 Components, §5 Screens (5.0–5.9), §6 Offline UI, §7 Mandatory States, §8 Egyptian Arabic Copy, §9 Performance, §10 A11y, §11 Acceptance Checklist. |
| `docs/12-SECURITY-AND-PRIVACY.md` | [docs/06-quality.md](docs/06-quality.md) | **Part 1**: §1 Threat Model, §2 Identity & Sessions, §3 Store Isolation & RLS, §4 Web Security, §5 Secrets, §6 Personal Data (Law 151/2020), §7 Backups, §8 Incident Response, §9 Manual Renewal Rules, §10 Security Tests, §11 Pre-Launch. |
| `docs/13-TESTING-STRATEGY.md` | [docs/06-quality.md](docs/06-quality.md) | **Part 2**: §1 Test Pyramid, §2 Inventory & Money Property Tests (fast-check), §3 Sync Chaos Tests, §4 Security Tests, §5 Catalog Tests, §6 Playwright E2E Offline, §7 Load (k6), §8 CI Quality Gates, §9 Seeds, §10 Matrix, §11 Definition of Tested. |
| `docs/17-PROJECT-SETUP.md` | [docs/07-ops.md](docs/07-ops.md) | **Part 1**: §0 Prerequisites, §1–§4 Repo Scaffolding & Dependencies, §5–§7 Folder Skeleton & Configs, §8 Local Postgres, §9 Scripts, §10 Git Hooks, §11 Verification, §12 Main Protection, §13 Agent Start, §14 Exclusions. |
| `docs/05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md` | [docs/07-ops.md](docs/07-ops.md) | **Part 2**: §0 Principles, §1 Free Stack Limits, §2 Hosting Options (Vercel, Cloudflare, VM/Docker), §3 DB & Cron Limits, §4 Domain/Email, §5 Upgrade Runbooks (R1–R4), §6 Portability Rules, §7 Upgrade Triggers, §8 Phase Map, §9 Costs. |
| `docs/16-AGENT-PROMPTS.md` | [docs/07-ops.md](docs/07-ops.md) | **Part 3**: §0–§6 Phase Prompt Sequence (Phases 0→7), Code Review Template, Bug Fix Template, Feature Template, Drift Recovery, Handover Template, Collaboration Tips. |

---

## 2. How to set up the project (once)

1. **Create an empty repo** (GitHub) named `hesba`.
2. **Copy the package** as is into the repo: `AGENTS.md` + `.agents/` + `docs/` + `README.md`.
3. **Don't write any code by hand.** The Agent will create the structure in phase 1.
4. **Open the project in Antigravity** and make sure `AGENTS.md` is being read (ask it: "Summarize the project rules").
   - Antigravity reads `AGENTS.md` from the project root and `.agents/rules/` (note: this information comes from an unofficial verification source, and each rules file is limited to about 12,000 characters. Check your version's settings). If it doesn't read them: paste the contents of `AGENTS.md` into Rules in the settings.
5. **Before the first line of code**, finish the "pre-start checklist" below.

## 3. Pre-start checklist (Phase 0)
- [ ] You met 5–10 shop owners, showed them the demo, and adjusted what was needed.
- [ ] Hosting decision (see `05` section 2) and you verified the ❓ points.
- [ ] You bought the domain (from day one — `05` section 4).
- [ ] You consulted a lawyer: Personal Data Protection Law 151/2020 + sharing product definitions between shops + the terms.
- [ ] You prepared the first batch of the public catalog (`06` section 3).
- [ ] Catalog decisions (shop identity, suggestion cap, N) — `06` section 1.
- [ ] You reviewed `15-DECISIONS-AND-OPEN-QUESTIONS.md` and decided the items that are yours.

## 4. How to work with Antigravity (the cycle)
```
1) Paste the "understand the project" prompt (16-AGENT-PROMPTS.md no. 0)  ← review its summary and correct it
2) Paste the "implement Phase N" prompt ← the Agent writes a plan ← approve or adjust
3) The Agent implements and runs lint+typecheck+test and reports the result
4) Review the PR/code (especially: Sync, FEFO, RLS, Auth)
5) Confirm the "Done-when" in 04-tasks.md
6) Start the next Phase  ← not before
```
**The parts you must review yourself with extra care:** sync (Phase 2), FEFO and stock (Phase 3), RLS and isolation, security and sessions, payments and subscriptions.

## 5. Golden rules for working with the Agent
1. **One phase at a time.** The Agent breaks things when you give it everything at once.
2. **The demo is the reference** for look and behavior. If the Agent invents a design, send it back to the demo.
3. **Read what it wrote** before you approve. Green tests aren't enough if the test itself is weak.
4. **Anything unclear** = it asks. No guessing about stock or money.
5. **Update `docs/`** with every behavior change. The documents are the Agent's memory between sessions.
6. **No invented numbers or prices.** Prices come from providers' offers, and load numbers are assumptions that get adjusted after Alpha.

## 6. Package release
- Version: **v1.0** (2026-10-17).
- Any substantial change to a decision = ADR + update the affected file + a line in `15-DECISIONS-AND-OPEN-QUESTIONS.md`.
- Files 01–06 were written in earlier sessions. If you find a conflict between them and newer files, see the "On conflict" section in `AGENTS.md`.

