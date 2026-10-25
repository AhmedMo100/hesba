# Ready-to-Paste Prompts for Antigravity

> Paste the prompt **as is**. After each reply: **review**, correct, then move to the next step. **One phase at a time.**
> You can talk to the Agent in Arabic. Technical terms in English work better.
> Before starting: make sure `AGENTS.md` and `.agents/rules/` have been read (ask it: "Summarize the project rules from AGENTS.md").

---

## 0) Understanding the project (once, before any code)
```
Read AGENTS.md, then docs/00-START-HERE.md, then all the files in docs/ in the order given in 00-START-HERE.
Do not write any code now.
Summarize for me in short bullet points:
1) What the product is, who the user is, and its principles.
2) The architecture: a single Next.js app, offline, sync, and why Route Handlers rather than Server Actions.
3) The top 10 rules that must never be broken.
4) The map of phases 0–7 and the done-when condition for each.
5) Any conflict, ambiguity, or missing information you found between files (name both files).
6) The open questions in docs/15 that I must decide before Phase 1.
No guessing. If you are not sure, say so.
```
**Review the summary.** If anything is wrong, correct it before continuing.

---

## 1) Phase 1 — Technical foundation
```
Implement Phase 1 only from docs/04-TASKS.md (the technical foundation).
Before code: write a short plan (the files you will create, in order, any decision that needs an ADR, and any verification point from docs/08 section 8).
Stop after the plan and wait for my approval.
After approval: implement task by task in order, and after each group of tasks run pnpm lint && pnpm typecheck && pnpm test.
Follow the structure in docs/03-FOLDER-STRUCTURE.md literally. If you need something outside the structure, write an ADR and ask.
Quote me the actual results of the checks, and do not say "done" without running them.
At the end: compare against the Done-when condition point by point, and tell me what was met and what was not.
```

## 2) Phase 2 — Identity and sync (the riskiest)
```
Implement Phase 2 only (identity, store, and sync) from docs/04-TASKS.md.
Re-read: docs/10-SYNC-PROTOCOL.md, docs/09-DATABASE-SCHEMA.md, docs/12-SECURITY-AND-PRIVACY.md, and docs/02 sections 2 and 4.
First: write a plan + a proposed ADR-0003 (change_log) and ADR-0005 (Service Worker). Wait for my approval.
No periodic polling. Sync is event-driven only. Follow the contract in docs/10 exactly (op types, rejected reasons, 204/401/503/409).
Write the protocol tests (docs/10 section 9) and cross-tenant tests before you say you are done, and work against a real Postgres (Testcontainers), not mocks.
At the end, list anything in the contract you had to change and propose an update to the file.
```

## 3) Phase 3 — Pages (one at a time)
```
Implement from Phase 3 in docs/04-TASKS.md this part: [write here: 3.0 Catalog / 3.1 Products+Inventory / 3.2 Selling / 3.3 Expenses+People / 3.4 Alerts+Home].
Visual reference: docs/demo/hesba-demo.html, whose source is docs/demo/src/. Port the look and behavior unchanged. The specs are in docs/11-UI-UX-SPEC.md.
Rules: text in ar.json, RTL, mobile-first (320/360/390), mandatory states (Empty/Loading/Error/Offline/Pending).
Writes are local in Dexie + Outbox. Shared logic (FEFO/money/units) goes in src/domain with property tests (docs/13 section 2).
Before you finish: a Playwright test of the main flow at 360px + offline, and a light/dark screenshot.
```

## 4) Phase 4 — Reports, AI, subscriptions, and suggestions
```
Implement Phase 4 only. Split it into groups: (a) reports and daily_store_stats (b) subscriptions and payment (c) AI (d) catalog suggestions from docs/06.
Start with (a) and wait for my review before (b), and so on.
Rules: AI numbers come from SQL tools only, and the 5/day limit is enforced on the server with an atomic check. Payment: signed + idempotent Webhooks. Suggestions: never reveal the store's identity or price, and write an identity-leak test.
Any value you guess (limits, caps) must be recorded in docs/15 section 5 and the code marked with // ASSUMPTION.
```

## 5) Phase 5 — Hardening and security
```
Implement Phase 5 only. Reference: docs/12-SECURITY-AND-PRIVACY.md, docs/13-TESTING-STRATEGY.md, and docs/05.
Start with: (1) a full security review of every Endpoint/Action, and submit a report of potential vulnerabilities before making changes. (2) A backup restore test. (3) A load test (k6) for a sync storm.
Write runbooks in docs/runbooks (moving the app, moving the database, maintenance mode).
Do not claim that something was tested when it was not.
```

## 6) Phases 6–7 (Alpha/Beta/Launch)
```
Prepare an executable checklist for Phase [6/7] from docs/04-TASKS.md: what must be done in code, what is done by humans (visits, support), and the internal support tools required.
Write code for the technical tasks only, and leave the human tasks to me as a list.
```

---

## Ready-made templates for recurring situations

### Code review — after any PR
```
Review the latest changes as a strict reviewer, against AGENTS.md and docs/02, 09, and 10.
Look for: broken RLS or withTenant, polling, Float money, inventory without movements, a non-idempotent Sync operation, data leaks in logs, forbidden imports between client and server, text outside ar.json, a new library without an ADR.
Write the result as: critical issues / important issues / notes, with file and line. Do not change anything until I approve.
```

### Fixing a bug
```
There is a bug: [description + steps + expected and actual].
1) First write a failing test that reproduces the problem. 2) Fix it with the smallest change. 3) Run lint+typecheck+test (+test:int if DB/Sync). 4) Tell me the root cause and what else might follow the same pattern. Do not refactor outside the bug.
```

### Add a small feature (after V1)
```
I want to add: [the feature]. Before any code:
1) Evaluate it against the acceptance rule in docs/14 section 1 (a real need? does it add a step? offline? cost?).
2) If accepted: propose a design with the fewest steps, any changes needed in docs/09/10, and a test plan.
3) Wait for my approval.
```

### If the Agent drifts
```
Stop. You have gone off task/structure. Go back to AGENTS.md and docs/03. What you should be doing is: [the task]. Revert the out-of-scope changes (list them) and continue with the task only.
```

### If there is a conflict between files
```
I found a conflict between [file A] and [file B] on [the point]. Give me: the text from each file, the options, your recommendation, and the impact of each option. Do not implement before I decide. After the decision, update both files and record it in docs/15 section 7.
```

### End-of-phase handover
```
Write an end-of-Phase [N] report: what was done, the done-when condition point by point (✅/❌ with evidence), the actual check results, the new tests, the guessed values added to docs/15, new decisions/ADRs, risks you noticed, and anything deferred and why.
```

---

## Tips for working with Antigravity
1. **Do not give the Agent all the files in one prompt**: it reads them from the project. Point it to the reference by name.
2. **A plan before code**, always, for the risky phases (2, 3.2, 4, 5).
3. **Review the tests themselves**: do they fail if the code is broken? (docs/13 section 11).
4. When the same mistake keeps recurring: **make it a rule** in `.agents/rules/` (after making sure it does not exceed 12,000 characters per file).
5. **Keep it small:** one or two tasks per session is better than a whole phase.
6. **Update `docs/`** after every decision. The documents are the Agent's memory between sessions.
7. If the session gets long and the Agent starts forgetting the rules: start a new session and give it a shortened prompt 0 + the task.
