# حسبة (Hesba)

A very simple system for managing supermarkets and small shops in Egypt: products, stock with batches and expiry dates, sales (piece/carton/weight), expenses, people (credit customers and suppliers), alerts, an AI assistant, and reports. It works from a mobile phone and without internet.

**Status:** planning and preparation stage (Phase 0). Code has not started yet.

## Stack

Next.js (App Router) + TypeScript · PostgreSQL + Drizzle · Dexie (IndexedDB) · PWA (Serwist) · zod · Vitest/Playwright.

## Start here

- For the developer/Agent: [`AGENTS.md`](./AGENTS.md) then [`docs/00-index.md`](./docs/00-index.md)
- Tasks: [`docs/04-tasks.md`](./docs/04-tasks.md)
- Demo: open [`docs/demo/hesba-demo.html`](./docs/demo/hesba-demo.html) in a browser (better on a phone)

## Commands (enabled after phase 1)

```
pnpm install && pnpm dev
pnpm lint && pnpm typecheck && pnpm test
```

## License

To be decided later.
