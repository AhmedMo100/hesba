# حسبة (Hesba) — Sync Protocol (the exact contract)

> This is the contract between mobile and server. **Any change here = bump `schema_v` and support the previous version** and update this file in the same PR.
> The actual types are defined in `src/schemas/sync.ts` (zod) and shared between client and server.

---

## 1. Principles
1. **Writes are local first** (Dexie), then Outbox, then the server.
2. **Every operation has an `op_id`** (uuid v7 from the device) → **idempotent**.
3. **The server is the final authority** on stock and numbers. Mobile shows an instant estimate.
4. **Ordering:** operations execute in local `seq` order within the same request.
5. **Every operation is an independent Transaction** on the server (one failing doesn't bring down the rest).
6. **No periodic polling.** It is triggered by events (section 7).
7. **The contract is versioned:** `schema_v` in every request. The server supports the current and the previous one.

## 2. The Endpoints

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/api/sync/push` | Send operations | session cookie + `Origin` + `X-Hesba-Client` |
| GET | `/api/sync/pull?cursor=&limit=` | Fetch changes | `204` if nothing new |
| GET | `/api/sync/catalog?cursor=&limit=` | The public catalog | public, ETag + long Cache |
| GET | `/api/sync/bootstrap` | First time on a new device | full snapshot + `cursor` |

### Request headers (Push/Pull)
```
Cookie: <session>                 # httpOnly (the SW sends it by itself, same origin)
X-Hesba-Client: web/<app_version>  # CSRF protection + diagnostics
X-Hesba-Schema: 1                  # the schema_v the client speaks
Content-Type: application/json
```

### Response codes
| Code | Meaning | Client behavior |
|---|---|---|
| 200 | Processed (check each operation's result) | Mark the results |
| 204 | No new changes (pull) | Done |
| 400 | Wrong request shape | Log an error, don't repeat the same request (bug) |
| 401 | Session expired | Show "سجّل دخولك" (Sign in), **the queue stays saved** and local selling continues |
| 403 | Subscription expired/forbidden | Read-only mode; the queue stays saved |
| 409 | Unsupported `schema_v` | "حدّث التطبيق" (Update the app) screen, queue saved |
| 413 | Request too large | Split the batch |
| 429 | Rate limit | Respect `Retry-After` + backoff |
| 503 | Maintenance | `Retry-After`; "السيرفر بيتحدّث، شغلك محفوظ" (The server is updating, your work is saved) |

---

## 3. Push

### The request
```json
POST /api/sync/push
{
  "device_id": "018f…",
  "schema_v": 1,
  "ops": [
    { "op_id": "018f…", "type": "sale.create", "client_ts": "2026-10-17T10:21:00+03:00", "payload": { … } }
  ]
}
```
- Max number of operations per request: **a fixed value in `constants.ts`** (starts with a small value and is tuned after measurement, ❓ depends on the Function timeout of the hosting).
- Max body size: a fixed value. Above it → `413`.

### The response
```json
200
{
  "results": [
    { "op_id": "018f…", "status": "applied",   "ref": { … } },
    { "op_id": "018f…", "status": "duplicate" },
    { "op_id": "018f…", "status": "rejected", "reason": "validation", "details": [ … ] }
  ],
  "server_time": "2026-10-17T07:21:02Z"
}
```
- `applied`: executed. `ref` holds what the server decided (e.g. the final `takes` of a sale operation).
- `duplicate`: the `op_id` was executed before. **Treat it as succeeded.**
- `rejected`: the server rejected it for a reason (section 6). **It is not sent again**; it appears in "محتاج مراجعة" (Needs review).

### Server algorithm (for each operation)
```
withTenant(storeId):
  1) if sync_ops has op_id            → duplicate
  2) zod-validate the payload by type & schema_v   → rejected(validation)
  3) check permissions + active subscription                → rejected(forbidden | subscription)
  4) handler(type) inside the same Transaction      → applied(result) or rejected(domain_reason)
  5) INSERT sync_ops (op_id, status, result)  +  INSERT change_log for each changed entity
```

---

## 4. Operation types (ops) and payloads

> All amounts are `*_minor` (piasters), all quantities are `*_base` (piece or gram). All IDs are uuid v7 from the device.

### 4.1 Products and the catalog
| type | payload | What the server does |
|---|---|---|
| `product.upsert` | `{ id, name, kind, pack_qty?, sell_price_minor, sell_pack_price_minor?, category_id?, barcode?, global_product_id?, custom, low_threshold_base? }` | upsert into `products` (LWW). If `custom` and sharing is enabled → the candidates path (06) |
| `product.delete` | `{ id }` | `deleted_at` (soft). If it has a balance: accepted and an alert is raised |
| `suggestion.accept` | `{ suggestion_id, product_id, sell_price_minor }` | creates `products` linked to the candidate, **price from the store**, `accepts_count++` |
| `suggestion.dismiss` | `{ suggestion_id }` | `dismissed` |
| `suggestion.report` | `{ suggestion_id, reason }` | report + `reports_count++` |

### 4.2 Stock
| type | payload | Effect |
|---|---|---|
| `stock.add` | `{ batch_id, product_id, qty_base, cost_total_minor, expiry_date?, supplier_id?, paid, received_at }` | creates `batches` + a `purchase` movement + updates `stock_levels`. If `paid=false` and `supplier_id` → `suppliers.owed_minor += cost` |
| `stock.waste` | `{ waste_id, product_id, batch_id?, qty_base, reason }` | `waste_records` + a `waste` movement + the batch's `remaining_base` |

### 4.3 Sales
| type | payload | Effect |
|---|---|---|
| `sale.create` | `{ sale_id, lines: [{ line_id, product_id, unit_mode, qty_base, unit_price_minor }] }` | creates `sales` + `sale_lines`, runs **FEFO on the server**, records `takes`/movements, computes the cost. If the balance is short → `negative=true` |
| `sale.void` | `{ sale_id }` | reverses according to the `takes` recorded on the server, `voided_at`. If already voided → `duplicate`-like (`applied` with no effect) |

**Important:** mobile computes estimated `takes` for display, but **the server recomputes them** from the real batch state. The response returns the final `ref.takes`, and the pull brings the updated batches.

### 4.4 Expenses and people
| type | payload |
|---|---|
| `expense.create` | `{ id, category, amount_minor, note?, spent_at }` |
| `expense.delete` | `{ id }` |
| `person.upsert` | `{ id, kind: 'owed_to_me'\|'i_owe', name, phone?, amount_minor, note? }` |
| `person.delete` | `{ id }` |
| `supplier.upsert` | `{ id, name, phone?, owed_minor, product_ids: [] }` |
| `supplier.delete` | `{ id }` |

### 4.5 Settings
| type | payload |
|---|---|
| `store.update` | `{ name?, shop_type?, governorate?, area?, opened_on?, workers_count?, share_custom_products?, receive_suggestions?, settings? }` |
| `alert.dismiss` | `{ kind, ref_id }` |

> **Online-only operations (not Sync):** signup/login/OTP, subscription and payment, the AI question, the admin panel. These are Server Actions.

---

## 5. Pull

### Request and response
```
GET /api/sync/pull?cursor=1042&limit=500
200 {
  "changes": [
    { "seq": 1043, "entity": "product", "id": "…", "op": "upsert", "data": { … } },
    { "seq": 1044, "entity": "expense", "id": "…", "op": "delete" }
  ],
  "next_cursor": 1044,
  "has_more": false
}
204   (nothing new)
```
- The client saves the `cursor`. First time on a device: `bootstrap` then `pull` from the cursor that came back.
- `limit` has a fixed maximum.

### Entities that are downloaded (`entity`)
`store` · `product` · `batch` (with the real `remaining_base`) · `sale` (+ `lines`) · `expense` · `waste` · `person` · `supplier` · `suggestion` · `subscription` (subscription state) · `alert_dismissal`.
**The balance on mobile = the sum of `batches.remaining_base`** (`stock_movements` is not synced).

### The **Rebase** rule (very important)
After the client applies the server's `changes` to Dexie, it must **re-apply the pending operations from the Outbox on top of them, in order**, using the same `src/domain` logic. Otherwise an operation that hasn't been sent yet will be counted twice (once locally and once from the server state) or disappear from the balance.
```
applyPull(changes):
  1) write changes to the local tables (server source)
  2) take all outbox operations with state pending|sending in order
  3) re-apply them locally on the result (domain.apply)
  4) update the screen
```
Mandatory test: a pending local sale + a pull containing a changed batch = the final balance is correct (section 9).

---

## 6. Rejection reasons (`reason`)
| reason | Meaning | Shown to the user |
|---|---|---|
| `validation` | wrong payload | "العملية دي فيها مشكلة" (This operation has a problem) + details |
| `unknown_type` | unsupported operation type | "حدّث التطبيق" (Update the app) |
| `forbidden` | no permission | "مش مسموح" (Not allowed) |
| `subscription` | subscription expired | "الاشتراك خلص" (The subscription ended) (read-only) |
| `not_found` | the entity doesn't exist (e.g. void of a non-existent sale) | "مش لاقي العملية" (Can't find the operation) |
| `conflict` | a conflict we can't resolve automatically | "راجعها" (Review it) |
| `limit` | exceeded a limit (e.g. custom products/day) | "وصلت الحد اليومي" (You reached the daily limit) |
**No silent rejection:** every `rejected` stays visible in "محتاج مراجعة" (Needs review) until the user deals with it (retry after editing, or ignore).

## 7. Operation states on the client
```
pending → sending → applied            (removed from the queue or marked)
                  → duplicate          (same as applied)
                  → rejected           (shown in "محتاج مراجعة")
sending → pending    on network failure/5xx (retry with backoff)
pending → quarantined  after X failed attempts for the same operation (don't block the rest)
```
### When sync runs (events only)
1. After the last local write with a **debounce** (a few seconds, fixed in `constants.ts`).
2. App open.
3. The network comes back (`online`).
4. The tab returns to the foreground (`visibilitychange`).
5. The "زامن دلوقتي" (Sync now) button.
**Forbidden:** periodic `setInterval`. On failure: **exponential backoff + random jitter** (to avoid a sync storm after a mass outage).

## 8. Versions (`schema_v`)
- The server supports the current `schema_v` **and the previous one**. Otherwise `409`.
- A non-breaking change (adding an optional field) doesn't bump the version.
- A breaking change: a new version + a translator (`src/server/modules/sync/versions.ts`) from old to new + a test.
- An old client stored offline after a new deployment **must keep working** (this is the reason we don't use Server Actions for sync).

## 9. Mandatory protocol tests
1. **idempotency:** the same `op_id` twice = one execution, the second response is `duplicate`.
2. **Cut in the middle of a push:** the operation stays pending and is sent again without repeating the effect.
3. **Ordering:** consecutive operations on the same product execute in order.
4. **Two devices:** a sale from both on the same batch → the final balance is correct, and the negative is flagged.
5. **rebase:** a pending sale + a pull with a batch change → the balance is correct.
6. **rejected:** an invalid operation doesn't block the ones after it, and appears in "محتاج مراجعة".
7. **void twice:** no second effect.
8. **401/503/409:** the queue stays saved and continues after recovery.
9. **old schema_v:** an operation in an old format is executed (or a clear 409).
10. **Leak prevention:** no response contains another store's data (cross-tenant).
11. **Storm:** 100 devices coming back at once (Load test) and the 429/Retry-After works.

## 10. Full examples

### Selling a carton + by weight
```json
{ "op_id":"018f-a", "type":"sale.create", "client_ts":"2026-10-17T10:21:00+03:00",
  "payload":{ "sale_id":"018f-s1",
    "lines":[ { "line_id":"018f-l1","product_id":"018f-p1","unit_mode":"pack","qty_base":12,"unit_price_minor":17000 },
              { "line_id":"018f-l2","product_id":"018f-p2","unit_mode":"weight","qty_base":350,"unit_price_minor":32000 } ] } }
```
(A carton = 12 pieces at the carton price of 170 EGP; 350 grams at the per-kilo price of 320 EGP, and the amount is computed as: `qty_base × price / 1000` for weight, with a specific rounding in `domain/money.ts`.)

### Adding goods on credit from a supplier
```json
{ "op_id":"018f-b", "type":"stock.add",
  "payload":{ "batch_id":"018f-b1","product_id":"018f-p5","qty_base":48,"cost_total_minor":120000,
              "expiry_date":"2026-11-02","supplier_id":"018f-v1","paid":false,"received_at":"2026-10-17T09:00:00+03:00" } }
```

### Rejection
```json
{ "op_id":"018f-c","status":"rejected","reason":"validation",
  "details":[ { "path":["payload","qty_base"],"message":"لازم يكون أكبر من صفر" } ] }
```
(The message "لازم يكون أكبر من صفر" means "Must be greater than zero".)
