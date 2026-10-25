# حسبة (Hesba) — Product Brief (Vision and Scope)

> Read this file first. It defines "what we are building and what we are not building." Any feature not listed here is not in V1.

---

## 1. The Idea
**Hesba (حسبة)** is a very simple mobile app for the owner of a supermarket or small shop in Egypt. The owner records sales, inventory, expenses, and the money owed to them and by them, and can see their profit, what is running low, and what is close to expiry, with no complexity and no training.

**The promise:** "Open, sell, know your numbers." In as few steps as possible.

## 2. Users
| User | What they do | Core need |
|---|---|---|
| **Shop owner** (primary user) | Sells, buys stock, reviews the books | To see profit and inventory quickly, without a computer |
| **Worker/cashier** (permissions in V1.1) | Sells only | A fast sales screen with no room for mistakes |
| **You/Admin** (platform admin) | Reviews the catalog and reports | Simple control tools |

**Context:** Fully mobile use, intermittent internet, varying technical skill, a wide range of Android devices (some of them weak).

## 3. Product Principles (in priority order)
1. **Simplicity above everything.** Any feature that adds a step or clutter is postponed or removed.
2. **Selling never stops.** No internet, no server, no valid session: selling continues.
3. **The numbers must be right.** Wrong stock or money means lost trust. Correct matters more than fast.
4. **Simple Egyptian Arabic.** Short sentences, no accounting jargon.
5. **Mobile first.** No screen is designed for a desktop computer.
6. **Nothing crowded.** Enough whitespace, smooth motion, one thing per screen.
7. **Shop privacy.** The shop's data (prices, inventory, sales) belongs to it and is never shared.

## 4. V1 Scope (the eight pages)
| Page | Function | Notes from the demo |
|---|---|---|
| **Home (الرئيسية)** | Period summary: sales, profit, expenses, chart (hourly if a single day) | Periods: today/week/month/custom |
| **Products (المنتجات)** | List + search + add/edit a product (piece/weight, carton, prices) | + custom products + suggestions (06) |
| **Inventory (المخزون)** | Add stock (batches, expiry, supplier, paid/on credit) + additions log + waste | FEFO |
| **Sell (البيع)** | Fast screen: tiles, weight, carton, Undo | The most used |
| **Expenses (المصروفات)** | Record an expense by category (electricity/internet/rent/salaries/transport/maintenance/other) | Buying stock is recorded in Inventory, not here |
| **People (الناس)** | Owed to you (someone owes you money) / You owe (you are in debt) / Suppliers | No complex account statement in V1 |
| **Alerts (التنبيهات)** | Out of stock / running low / near expiry (≤ 7 days) + suggestions | Counter badge on the nav icon |
| **AI** | Assistant that answers questions about the shop (5 messages/day) | Numbers from SQL only |

**Alongside:** Sign-up (two steps) + login + shop profile + theme (light/dark/auto) + subscription and payment + sync and offline.

### Intentionally removed from the demo
- **Floating (+) button:** Removed because it adds clutter and duplication (every page already has its own add action). It will not come back without usage data proving the need.

## 5. Out of Scope in V1 (V2 and later — `14`)
Online store · multiple branches · invoice printing/printers · barcode scanner (candidate for V1.1) · multi-item cart in one invoice (candidate for V1.1) · detailed worker permissions (V1.1) · product images · integration with the government e-invoice system (needs legal review) · native app.

## 6. The Shared Catalog (our differentiating feature)
- A public catalog of common products (we prepare it manually because there is no API).
- A shop adds a custom product, and suitable shops get a prompt: "There is a product X, add it? [Add]". Details and privacy are in `06`.

## 7. Glossary
| Term | Meaning |
|---|---|
| **Batch (دفعة)** | A quantity purchased at one time with a specific expiry date and cost |
| **FEFO** | First-Expired, First-Out: sell from the nearest expiry first |
| **Base unit (وحدة أساسية)** | Piece for regular products, gram for weighed products |
| **Carton (كرتونة) (Pack)** | A fixed number of pieces (for example 12) at a carton price |
| **On credit (آجل)** | Money not yet paid (owed to you or by you) |
| **Outbox** | The queue of local operations not yet sent to the server |
| **op_id** | A unique identifier for each operation that guarantees it executes exactly once |
| **Sync** | Synchronizing operations between the phone and the server |
| **RLS** | Isolating each shop's data at the database level |
| **Custom product (منتج مخصص)** | A product the shop added itself (not from the public catalog) |
| **Candidate (مرشّح)** | A custom product that has been turned into a suggestion for other shops |

## 8. Tone of Voice (Copy)
- Simple, short Egyptian colloquial Arabic: "اتسجل" (Saved), "مفيش منتجات" (No products), "تضيفه عندك؟" (Add it to your shop?).
- Errors in a calm tone that states the fix: "اكتب المبلغ" (Enter the amount), "النت واقع، شغلك محفوظ" (The internet is down, your work is saved).
- No jargon: instead of "Reconciliation" → "راجع الحساب" (Review the account).
- Numbers: currency "ج.م" (EGP), Latin digits (or Arabic-Indic via a setting), consistent across the whole app.
- **No unproven marketing claims** (like "free" or "the fastest") in any text.

## 9. Visual Identity (from the demo)
Beige background `#EFE8D6` · green `#4F6B46` · **Tajawal** font (local, not from Google) · light/dark/auto theme · rounded corners · smooth motion. Details are in `11-UI-UX-SPEC.md`. The logo is at `docs/demo/logo.png`.

## 10. Success Metrics (numbers are set in Phase 0)
| Phase | Metric | Target |
|---|---|---|
| Alpha | Days of use per week per shop | (from P0-PR-03) |
| Alpha | Sales operations per shop per day | (from P0-PR-03) |
| Alpha | Data loss | **Zero** |
| Beta | Weekly retention | (set after Alpha) |
| Suggestions | Suggestion acceptance rate | (set after the first wave) |
**The numbers are intentionally blank.** We do not write a target before we see reality.

## 11. Assumptions That Must Be Verified (recorded in `15`)
- That the shop owner will use the phone for actual selling (not just for review).
- That "one-tap sale per item" is enough in V1 (without a cart).
- That the shared catalog will noticeably reduce the time it takes to add products.
- That shops will accept sharing product definitions anonymously.
