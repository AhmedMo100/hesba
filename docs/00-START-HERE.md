# Start Here — the Hesba documentation package

> This package is **everything the AI Agent (Antigravity) and the team need** from day one up to 10,000 shops.
> Put it in the project as is: `AGENTS.md` and `.agents/rules/` at the root, and the rest in `docs/`.

---

## 1. File map (in reading order)

| # | File | Answers | Read by |
|---|---|---|---|
| 1 | `AGENTS.md` (root) | The inviolable rules + commands | The Agent, always |
| 2 | `.agents/rules/*.md` | Short rules by type of work | The Agent, always |
| 3 | `docs/07-PRODUCT-BRIEF.md` | What are we building, for whom and why? Scope | Everyone |
| 4 | `docs/08-TECH-STACK.md` | The stack, the dependencies and why | Everyone |
| 5 | `docs/01-SYSTEM-DESIGN.md` | Load, growth stages up to 10,000 shops, failure scenarios | Everyone |
| 6 | `docs/02-SOFTWARE-ARCHITECTURE.md` | Layers, modules, Sync, RLS, FEFO, sessions | The Agent + developers |
| 7 | `docs/03-FOLDER-STRUCTURE.md` | The full project structure | The Agent |
| 8 | `docs/09-DATABASE-SCHEMA.md` | All tables, RLS and indexes | The Agent |
| 9 | `docs/10-SYNC-PROTOCOL.md` | Sync operations and their exact shape | The Agent |
| 10 | `docs/06-CATALOG-AND-SUGGESTIONS.md` | The shared catalog + shop suggestions | The Agent |
| 11 | `docs/11-UI-UX-SPEC.md` | Screens, colors, motion and rules | The Agent + the designer |
| 12 | `docs/12-SECURITY-AND-PRIVACY.md` | Security, privacy and legal | Everyone |
| 13 | `docs/13-TESTING-STRATEGY.md` | Tests and merge conditions | The Agent |
| 14 | `docs/05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md` | Free hosting and upgrading with no downtime | You + DevOps |
| 15 | `docs/04-TASKS.md` | **Tasks phase by phase** (the Agent works from this) | The Agent |
| 16 | `docs/14-ROADMAP-AND-EVOLUTION.md` | The evolution plan after V1 | You |
| 17 (new) | `docs/17-PROJECT-SETUP.md` | **Repo setup from zero** (run once, before Phase 1) | You, then the Agent |
| 17 | `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` | Decisions, open items and verification | You + the Agent |
| 18 | `docs/16-AGENT-PROMPTS.md` | Ready-made prompts to paste into Antigravity | You |
| — | `docs/demo/` | The demo (`hesba-demo.html`) + its source `src/` + the logo | The visual reference |
| — | `docs/adr/` | Architecture decisions (the template + the first ones) | Everyone |

> The numbers in the file names are **not** the reading order (files 01–06 were written first). The reading order is in the table above.

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
5) Confirm the "Done-when" in 04-TASKS.md
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
