---
name: release-gates
description: Sequential execution order for verification gates before completing any task, opening a PR, or triggering a release.
---

# Release Gates & CI Verification Skill

## When to Use

- Before marking any phase or task as completed.
- Prior to pushing commits or opening a pull request.
- When configuring or troubleshooting GitHub Actions CI workflows.
- During release readiness checks and definition-of-done audits.

## Core Rules & Principles

1. **Strict Sequential Order**: Verification commands MUST be run in the exact documented order. Never reorder or skip gates.
2. **Zero Tolerance for Failures**: A failure at any gate halts the release pipeline immediately. Never proceed past a red check.
3. **Never Bypass Checks**: Do not use flags like `--no-verify`, `--skip-tests`, or ignore TypeScript diagnostics.
4. **Honest Reporting**: Always report actual command output, exit codes, and test counts. Never declare a task "done" without executing the checks.

## The Exact Release Sequence

```
1. install    → Ensure lockfile and dependencies are clean and deterministic
2. lint       → Check code formatting, style, and architectural import boundaries
3. typecheck  → Verify strict TypeScript types (zero any, strictNullChecks)
4. test       → Run unit tests and property-based fast-check tests
5. test:int   → Run integration tests against real Postgres via Testcontainers
6. test:e2e   → Run Playwright browser tests for offline, sync, and PWA flows
7. build      → Run Next.js production standalone build
```

## Step-by-Step Execution Guide

### Gate 1: Install Dependencies

```bash
pnpm install --frozen-lockfile
```

- Ensures `node_modules` matches `pnpm-lock.yaml` exactly.
- Must exit with code 0.

### Gate 2: Static Linting & Boundaries

```bash
pnpm lint
```

- Runs ESLint with boundary rules (`src/client` ❌ `src/server`).
- Must report 0 errors and 0 warnings.

### Gate 3: TypeScript Type Checking

```bash
pnpm typecheck
```

- Runs `tsc --noEmit` in strict mode.
- Single source of types: Zod schemas. Zero unjustified `any`.

### Gate 4: Unit & Property Tests

```bash
pnpm test
```

- Runs Vitest on pure domain logic, fast-check property tests, and utilities.
- All tests must pass.

### Gate 5: Database & RLS Integration Tests

```bash
pnpm test:int
```

- Spins up real PostgreSQL container using Testcontainers.
- Tests RLS isolation, cross-tenant isolation, migrations, and sync endpoints.

### Gate 6: End-to-End Browser Tests

```bash
pnpm test:e2e
```

- Runs Playwright tests on desktop and mobile viewports (360px).
- Tests offline sales recording, network drop, and sync reconnect.

### Gate 7: Production Build

```bash
pnpm build
```

- Builds Next.js standalone application.
- Verifies webpack configuration, Serwist service worker generation, and bundle size budgets.

## Mandatory Checks

- [ ] Were the 7 gates executed in exact order (install → lint → typecheck → test → test:int → test:e2e → build)?
- [ ] Did all commands exit with code 0?
- [ ] Were real terminal results reported without assuming success?
- [ ] Are any new test cases included for newly introduced behavior?

## Documentation Links

- [AGENTS.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/AGENTS.md) — Section 6: Fixed command definitions; Section 9: Definition of Done.
- [docs/06-quality.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/06-quality.md) — Part 2: Testing Strategy and quality gates.
- [docs/07-ops.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/07-ops.md) — Section 10: CI/CD configuration and pipeline definitions.
