# Frontend and Offline Rules (when working on `src/client` or `src/app`)

- Reference: `docs/11-UI-UX-SPEC.md` + `docs/demo/hesba-demo.html` + `docs/demo/src/` (port it, don't invent).
- Always RTL. Mobile-first: 320 / 360 / 390px. Touch targets ≥ 44px. No hover-only interactions. `prefers-reduced-motion`.
- Colors come from the demo's CSS variables (`--bg --sf --ink --br ...`). Light/dark/auto theme (`data-theme`).
- After login the app lives under `/app/[[...slug]]` as **Client-only** (`dynamic ssr:false`) + an internal Router + lazy pages. The landing page and signup are Server-rendered.
- Domain data is read from Dexie with `useLiveQuery`. Never put domain data in global state.
- A write operation = one Dexie Transaction (data + movements + op in the outbox), then update the screen immediately.
- `shared/sync/engine.ts` is event-driven: after the last write (debounce), on app open, when the network returns, when the tab returns, and on the "زامن" ("Sync") button. **No setInterval.**
- After any pull: re-apply the pending operations in the outbox on top of the server state (rebase) — `docs/10-SYNC-PROTOCOL.md`.
- 401 or an expired session while offline: **local selling continues**, and authentication happens at sync time. 503: show "السيرفر بيتحدّث، شغلك محفوظ" ("The server is updating, your work is saved").
- Heavy libraries (export, AI chat) via dynamic `import()`. The bundle size budget is enforced in CI.
- Text lives in `ar.json` only. No text hard-coded in components.
- Every Modal/Popover/Select/Combobox must work with the keyboard and have correct focus.
- Mandatory states for every screen: Empty / Loading / Error / Offline / Pending sync.
