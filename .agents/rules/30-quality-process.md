# Quality and Process Rules (always on)

- **Before writing code:** read the Phase task and its Done-when condition, and write a 5–10 line plan. If there is an open question, ask.
- **While working:** small PR (≈400 lines), Conventional Commits (`feat(sales): add void`). A test with every change.
- **Before saying "done":** run `pnpm lint && pnpm typecheck && pnpm test` (+ `pnpm test:int` if you touched DB/Sync/RLS). Report the actual result.
- **Tests:** FEFO and stock are property-based (fast-check). Sync: duplicate, rejected, cut mid-push, two devices. RLS: cross-tenant on every endpoint. No mock that hides RLS or the DB.
- **Documentation:** if behavior, a table or an operation's shape changed → update `docs/09`, `docs/10` or `docs/06` in the same PR.
- **ADR:** any big technical choice or deviation from the structure → `docs/adr/NNNN-title.md`.
- **Honesty:** don't claim something was tested when it wasn't. If the files conflict, say so and ask. If you guessed a value, log it in `docs/15`.
- **Task boundaries:** no "improvements" outside the task, and two phases together is forbidden.
- **Security:** any feature that touches auth, OTP, subscriptions or the shared catalog = read `docs/12-SECURITY-AND-PRIVACY.md` before you start.
- **Performance:** don't add a heavy library to the initial bundle. Heavy pages and libraries are lazy.
