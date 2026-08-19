# Cafe Management System — Master Specification

**Status:** Pre-build / Month 1 starting
**Audience:** Any developer or AI agent picking up this project
**Read this file first.** It is the single source of truth for scope, conventions and sequencing. If something here conflicts with a chat instruction, ask before deviating.

---

## 1. What this is

A custom internal management system for a single-outlet cafe and bakery in Chhatrapati Sambhajinagar (Aurangabad), Maharashtra, India. It replaces spreadsheets and guesswork with four things:

1. **Ingredient-level cost visibility.** For any menu item, the owner sees exactly what each ingredient contributes to its cost, and therefore its real margin.
2. **Inventory that maintains itself.** Stock depletes automatically as items sell.
3. **Order management** for both walk-in and online orders, with a live kitchen status pipeline.
4. **A customer-facing tracking page and AI assistant**, embedded on the cafe's existing website.

It is an internal business system. It will **not** be published to the App Store or Play Store. Everything is web-based, running on a single VPS.

### The demo that defines success

Open the cinnamon roll. It sells for ₹350. The system shows ₹96 of ingredients broken out line by line — maida, butter, sugar, cinnamon, cream cheese, packaging. Change the butter purchase price. Every item using butter recosts, and their margins move. That moment is the entire value proposition. Everything else supports it.

---

## 2. Non-negotiable conventions

These are the most expensive things to retrofit. Apply them everywhere, without exception.

### 2.1 Money is integer paise

Never a float. Never a JS `number` holding rupees. Columns are named `*_paise`. Convert and round exactly once, at the display boundary, via a single shared helper:

```ts
formatINR(paise: number): string  // 34999 -> "₹349.99"
```

Rounding is half-up, applied only at the final step of a calculation chain — never on intermediate values.

### 2.2 Quantities are stored in a canonical base unit

| unit_type | base unit |
|---|---|
| `weight` | grams |
| `volume` | millilitres |
| `count` | units (integer) |

Never store "2 kg". Store `2000` with `unit_type = 'weight'`. Conversion happens only at the input and display boundary. An ingredient records its `purchase_unit` (e.g. "kg") and `purchase_unit_in_base` (e.g. `1000`) so receipts can be entered in the units the cafe actually buys in.

### 2.3 Every business table carries `tenant_id`

There is one client today. This codebase is intended for resale to other cafes. Every table, every query, every index. No exceptions, no "we'll add it later".

### 2.4 Nothing is hard deleted

`deleted_at timestamptz` soft deletes. Stock and cost history must remain reconstructable indefinitely.

### 2.5 Stock is an append-only ledger

Current stock is **derived**, never overwritten. Application code must never issue `UPDATE ingredients SET qty = ...`. All change flows through `stock_movements` inserts. A derived cache table exists for read performance and is recomputed inside the same transaction as every movement.

### 2.6 Cost is snapshotted at sale time

Every order line stores the ingredient cost as it was **at the moment of sale**. Historical reports read the snapshot and never recompute. Without this, updating a butter price silently rewrites last month's profit figures.

### 2.7 Other rules

- All timestamps `timestamptz`, stored UTC, displayed Asia/Kolkata.
- Zod validation on every mutation, server-side. Never trust the client, including for role checks.
- Order status transitions are validated against an explicit server-side map. The UI restricting buttons is not sufficient.
- Every payment webhook handler is idempotent on the gateway's event ID.
- Stock decrements are atomic single statements, never read-then-write.

---

## 3. Tech stack

**Frontend** — Next.js (App Router) + TypeScript, Tailwind CSS, PWA manifest so the counter PC and kitchen tablet run fullscreen.

**Backend** — Next.js server actions and route handlers. No separate API service. Zod validation. Session-based auth with httpOnly cookies, argon2 password hashing.

**Data** — PostgreSQL 16, Drizzle ORM with checked-in migrations. Postgres `LISTEN/NOTIFY` for live status propagation.

**Infrastructure** — Single VPS in an Indian region (E2E Networks or DigitalOcean Bangalore, 2 vCPU / 4 GB). Docker Compose: app + Postgres + Caddy. Caddy handles reverse proxy and automatic TLS. Nightly `pg_dump` to Cloudflare R2.

**Integrations** — Razorpay (payments), Claude API (assistant: Haiku for lookups, Sonnet for complex queries).

**Tooling** — Vitest, GitHub Actions for image build and push. **Never run `next build` on the VPS** — 4 GB will OOM. Build in CI, ship the image.

### Why not Supabase or a managed platform

No per-service fees, and once several cafes are hosted they share one box. The trade-off is that managed backups and point-in-time recovery are given up, which is why a tested restore runbook is a contractual deliverable rather than an optional extra.

---

## 4. Modules and features

### Module 1 — Foundations and access control

- Login, logout, session management
- Four roles: `owner`, `manager`, `counter`, `kitchen`. Role governs both route access and visible UI.
- User creation, role assignment, deactivation. A user cannot deactivate themselves or change their own role.
- Audit log of significant actions (before/after JSON)
- Responsive layout usable on desktop, tablet and phone browsers

### Module 2 — Inventory management

- Ingredient master: name, unit type, base unit, purchase unit, conversion factor, low-stock threshold, active flag
- Current stock and weighted average cost per ingredient
- **Stock receipt** — multi-line, one transaction, entered in purchase units with total cost paid; unit cost computed and shown before saving; optional supplier reference
- **Stock adjustment** — signed correction with mandatory reason (`count_correction`, `wastage`, `spoilage`, `theft`, `other`); free-text note required for `other`
- **Automatic depletion** on confirmed sale (written by Module 4)
- Movement history, filterable by ingredient and date, showing running balance. Read-only — corrections are new movements, never edits.
- Low stock view sorted by severity
- Minimal supplier records (name, phone, notes). Full supplier management is out of scope.

### Module 3 — Recipes and cost breakdown

**The core module. Highest risk. Read section 6 before implementing.**

- Recipe (bill of materials) per menu item: ingredient, quantity consumed in base units
- **Sub-recipes** — a recipe that is itself an input to other recipes (dough → cinnamon roll). Costed once per unit of yield, then flows upward.
- Yield: a dough batch produces 4.2 kg; a roll consumes 180 g of it
- Wastage percentage, applied at the level where the loss occurs, as a multiplier on quantity consumed — not on cost
- Per-item cost breakdown view: every ingredient, its quantity, its rupee contribution, the total
- Gross margin and food-cost percentage against selling price
- Updating an ingredient purchase price recosts every recipe that uses it, transitively through sub-recipes
- Recalculation must be re-runnable across the whole catalogue

### Module 4 — Order management (walk-in and online)

- Order creation: item selection, quantity, modifiers
- Order type: `dine_in`, `takeaway`, `delivery`
- Auto-generated order number / token
- Tax and total calculation; browser-printable bill
- Order history with search
- Cancellation with reason, triggering a compensating stock movement (`reversal`) — never a silent edit
- Atomic stock depletion on confirmation
- Cost snapshot written onto every order line

### Module 5 — Kitchen status board

- Live list of active orders on a browser-based screen (tablet)
- Staff tap to advance status through the pipeline:
  `ordered → in_kitchen → baking → out_of_oven → ready → out_for_delivery → completed`
  plus `cancelled` from most states. Pipeline configured at build time.
- Elapsed time per order so nothing sits forgotten
- Backward transitions permitted but flagged in the audit log
- **Design for two taps, not five.** If staff find it slow during a rush they will stop using it, and the entire customer-facing half of the product dies with it.

### Module 6 — Customer order tracking

- Public page reachable by order number, **no login**: `cafename.com/track/A47`
- Live status updates without page refresh
- Short, readable URLs — staff read these aloud over the phone
- Embedded in or linked from the cafe's existing website

### Module 7 — Online ordering

- Customer-facing menu with categories and per-item availability
- Cart and checkout
- Delivery or pickup selection; customer name and contact capture
- Razorpay integration
- Order confirmation with tracking link

### Module 8 — Owner analytics dashboard

- Sales summary by day, week, month
- Revenue by item and by category
- Best and worst performers ranked by **volume and by margin separately** — they are rarely the same list
- Overall food cost percentage and gross margin
- Low stock and reorder view
- Date-range filtering
- CSV export

### Module 9 — AI customer assistant

- Chat widget on the cafe's existing website
- Answers from a client-supplied knowledge base: hours, location, menu, delivery area, allergens
- Order status lookup by order number (tool call against the order table)
- Hands off to staff contact details when a query falls outside configured scope
- **Allergen answers must be verbatim client-supplied text only.** A fabricated allergen answer is a genuine safety and liability issue. If the knowledge base does not cover it, the assistant must decline and direct the customer to call.

---

## 5. Data model

Required entities and the fields that matter. Design the exact Drizzle definitions, but do not omit anything here.

**tenants** — id, name, timezone, currency, created_at

**users** — id, tenant_id, name, email, password_hash, role, is_active, created_at, deleted_at

**suppliers** — id, tenant_id, name, phone, notes, deleted_at

**ingredients** — id, tenant_id, name, unit_type, base_unit, purchase_unit, purchase_unit_in_base, low_stock_threshold_base, is_active, deleted_at

**stock_movements** (append-only) — id, tenant_id, ingredient_id, movement_type (`purchase` | `adjustment` | `wastage` | `consumption` | `reversal`), quantity_base (signed), unit_cost_paise (nullable, purchases only), total_cost_paise, reference_type, reference_id, reason, note, created_by_user_id, created_at

**ingredient_stock** (derived cache, not source of truth) — tenant_id, ingredient_id, qty_base, weighted_avg_cost_paise, updated_at
Recomputed inside the same transaction as every movement insert. Provide `recalculateStock(ingredientId)` rebuilding from the ledger, plus a script to rebuild all.

**recipes** — id, tenant_id, name, is_sub_recipe, yield_quantity_base, yield_unit_type, wastage_percent, deleted_at

**recipe_lines** — id, recipe_id, ingredient_id (nullable), sub_recipe_id (nullable), quantity_base, wastage_percent
Exactly one of `ingredient_id` / `sub_recipe_id` is set. Enforce a depth limit and reject cycles at save time.

**menu_items** — id, tenant_id, name, category, recipe_id, selling_price_paise, is_available, deleted_at

**orders** — id, tenant_id, order_number, order_type, status, customer_name, customer_phone, subtotal_paise, tax_paise, total_paise, payment_status, payment_reference, created_by_user_id, created_at

**order_lines** — id, order_id, menu_item_id, quantity, unit_price_paise, line_total_paise, **cost_snapshot_paise**

**order_status_events** — id, order_id, from_status, to_status, user_id, created_at

**payment_events** — id, tenant_id, gateway, **gateway_event_id (unique)**, order_id, payload_json, processed_at

**audit_log** — id, tenant_id, user_id, action, entity_type, entity_id, before_json, after_json, created_at

### Weighted average cost

Recalculated on every `purchase` movement:

```
new_avg = (old_qty * old_avg + in_qty * in_price) / (old_qty + in_qty)
```

- Compute in integer paise; round half-up at the final step only
- If `old_qty <= 0`, the new average is simply the incoming unit price
- Adjustments, wastage and consumption reduce quantity but **never** change the average cost

---

## 6. The hard parts, and how to handle them

Ranked by likelihood of causing real damage.

### 6.1 Costing arithmetic

The failure mode is not a crash. It is confident, clean-looking code that is wrong by a plausible margin somewhere inside a nested sub-recipe, which nobody notices until the owner's numbers look absurd.

Fixes:
- Cost flows **upward only**. Ingredient → sub-recipe cost per unit of yield → parent. Never sideways, never circular. Enforce depth limit, reject cycles at save.
- Wastage applies at the level where the loss happens, as a multiplier on quantity, not cost.
- Weighted average cost, per section 5.
- Snapshot cost onto every order line at sale time. Historical reports read the snapshot.
- **Write known-answer test cases on paper before implementing.** Minimum ten, including a nested sub-recipe with wastage at both levels. If the code disagrees with the paper, the paper is right.

### 6.2 Stock depletion under concurrency

Two counters ring up the last croissant simultaneously; both read `qty = 1`, both decrement, stock is 0 having sold 2.

```sql
UPDATE ingredient_stock SET qty_base = qty_base - $1
WHERE ingredient_id = $2 AND qty_base >= $1
RETURNING qty_base;
```

Zero rows returned means insufficient stock. Wrap the whole order confirmation — every line plus the order row — in one transaction.

**But make negative stock a configurable allowance.** A cafe will sell the last croissant regardless of what the system thinks. Hard-blocking the sale is the fastest way to get staff to abandon the system. Flag it, don't block it.

### 6.3 Real-time that survives reality

WebSockets drop — cafe wifi, tablet sleeping, tab backgrounded.

- On reconnect, **refetch full state** rather than replaying missed events. Simpler and always correct.
- Polling fallback every 10 s when the socket is down.
- `visibilitychange` listener to refetch when the tablet wakes.
- Optimistic UI on the kitchen tap, reconciled against the server response.
- Test by pulling the router mid-service before go-live.

### 6.4 Payment webhooks

- Unique index on `gateway_event_id`. Insert first; on conflict, return 200 immediately.
- Verify the signature before touching anything.
- The **webhook is the source of truth**, never the browser redirect. The redirect only navigates the customer.
- Orders start `pending_payment`; the webhook promotes them. A sweep job resolves anything stuck beyond 15 minutes.

### 6.5 Order state machine

Explicit transition map, validated server-side:

```ts
{ ordered: ['in_kitchen', 'cancelled'], baking: ['out_of_oven', 'cancelled'], ... }
```

Every transition writes to `order_status_events`. Cancellation after depletion triggers a `reversal` stock movement.

### 6.6 Where perfection is not required

Correctness is non-negotiable for: cost arithmetic and the cost snapshot, stock atomicity, webhook idempotency, auth and role checks. Those four.

Everything else — kitchen board polish, chart aesthetics, the assistant covering every possible question, mobile layouts on screens nobody uses, performance tuning at 150 orders a day — is "good enough, improve later". Three extra weeks of polish before the owner has touched it is a worse outcome than shipping and learning that the kitchen tap flow doesn't fit a real rush.

Build for imperfection instead: every adjustment logged with a reason rather than silently overwritten, managers able to correct orders with an audit trail, cost recalculation re-runnable so an early arithmetic bug can be fixed and reprocessed.

---

## 7. Website integration

The cafe's existing site is deployed on **Netlify**. Three integration points, three mechanisms.

**Chat widget — script tag.** One line on the existing site, loading a small bundle from the VPS. Render inside a **Shadow DOM** so the cafe's CSS cannot leak in and break it. Works regardless of what the site is built in, and survives a future redesign.

```html
<script src="https://order.cafename.com/widget.js" defer></script>
```

**Ordering and tracking — subdomain (recommended).** `order.cafename.com` via an A record to the VPS. No Netlify bandwidth consumption, no CSP debugging, and unaffected if the client ever moves off Netlify. The main site gets an "Order Online" button.

**Same-domain paths — Netlify proxy rewrite (optional, later).** If the owner insists on `cafename.com/order` in the URL bar:

```toml
[[redirects]]
  from = "/order/*"
  to = "https://order.cafename.com/:splat"
  status = 200
  force = true
```

`status = 200` is a proxy rewrite; `301` would bounce the user to the subdomain. Note that rewrites consume Netlify bandwidth/credits.

**Also required:** CORS on the API restricted to the cafe's domain only, never `*`. If the site sends a Content-Security-Policy header, the subdomain must be added to `script-src` and `connect-src` or the widget silently fails. If the marketing site also displays the menu, expose a read-only JSON endpoint rather than maintaining it in two places. Do not put the AI chat endpoint in a Netlify Function — the 10 s timeout is routinely exceeded by LLM responses.

---

## 8. Build sequence

Five months, roughly two days a week. Each phase ends with something the owner can see and use. Deploy to production from Month 1 — no big-bang launch.

### Month 1 — Foundations and inventory
Week 1 is not code: confirm the aggregator split (see 9.1), start Razorpay KYC, provision VPS and domain **in the client's name**, and sit with the chef to weigh the top 15 items by volume.
Then: schema, auth, roles, deploy pipeline, ingredient master, stock movements, receipt and adjustment flows, history and low-stock views.
**Ends with:** the owner logs in and enters his ingredient list.

### Month 2 — Costing engine
The hard month. Recipes, sub-recipes, unit conversion, yield, wastage, weighted average cost, cost breakdown and margin views. Paper test cases first.
**Ends with:** the cinnamon roll demo from section 1.

### Month 3 — Orders and kitchen
Order entry, tax and totals, printable bill, state machine, atomic depletion, kitchen board with live status, cost snapshots.
**Ends with:** staff take real orders on it in parallel with the existing till for a week. Run this parallel period deliberately — staff must learn it before it is load-bearing.

### Month 4 — Customer-facing
Online menu, cart, checkout, Razorpay webhooks with idempotency, tracking page, subdomain live, widget embedded on the Netlify site.
**Ends with:** the owner places an order from his phone and watches the kitchen advance it.

### Month 5 — Dashboard, assistant, hardening
Analytics, CSV export, chat assistant, backup restore test, staff training, on-site trip, go-live. Then 30 days of warranty.

### Working method for agents

1. Propose the schema first as Drizzle definitions. **Stop for human review before writing anything else.** Every schema mistake costs ten times more in Month 2.
2. Migrations, seed script (~30 realistic Indian bakery ingredients: maida, butter, castor sugar, cinnamon powder, milk, cream cheese, active dry yeast, eggs), Docker setup.
3. Pure functions with tests first — unit conversion, weighted average.
4. Auth and role middleware.
5. Feature CRUD.
6. Stop and check in every ~150 lines. Ask when a decision is ambiguous rather than assuming.

Keep UI plain and functional — clean tables and forms. Prioritise data-layer correctness over appearance.

If two people are working with two agents in parallel, split by vertical slice with hard file ownership (data layer and costing on one side; customer-facing and dashboard on the other), and write the schema and route signatures by hand, together, first. Never let an agent land unreviewed changes to money rounding, tax, auth, stock concurrency or webhook handling.

---

## 9. Out of scope

Not to be built, scaffolded, or stubbed. If a task appears to require one of these, **stop and ask.** Agents habitually "helpfully" scaffold these and the work gets deleted.

- Native iOS / Android apps; any app store publication
- Offline mode for billing (the system requires an active connection)
- WhatsApp, SMS, email or push notification delivery of order status
- Purchase orders, goods receipt notes, full supplier management, supplier payments, expiry and batch tracking
- Multi-outlet operation, central kitchen / commissary
- Table management, floor plans, seating, reservations
- Loyalty programmes, coupons, discount engines, gift cards, promotional campaigns
- Payroll, attendance, shift scheduling
- Accounting integration, GST return filing, e-invoicing, e-way bills
- Swiggy / Zomato / any aggregator or delivery platform integration
- Rider assignment, tracking, route optimisation
- Direct thermal printer driver integration beyond browser printing
- Barcode / QR inventory scanning, weighing scale integration
- Recipe digitisation or measurement (client's responsibility)
- Data migration from any existing system
- Content creation, photography, menu copywriting, branding
- Redesign of the client's existing website beyond the embed points
- SEO and marketing analytics
- Server monitoring, security patching, penetration testing, formal security audit
- Any UI language other than English

Multi-tenancy is **in** scope at the schema level (`tenant_id`) but multi-outlet features are **out** — one tenant, one outlet, for now.

---

## 10. Known project risks

### 10.1 Aggregator split — resolve before Month 3

If 60–70% of the cafe's orders arrive via Swiggy and Zomato, which is normal, then online ordering serves a minority of revenue and **aggregator orders never touch inventory**. Stock counts drift badly and the costing becomes decorative. This must be asked before Month 3 planning, because it could reshape the scope entirely.

### 10.2 Recipe data quality

Everything in Module 3 assumes accurate grams-per-item. Most cafes have never measured anything. Do not ask for a spreadsheet — sit with the chef for one session, weigh the top 15 items by volume together, enter them together. That covers ~80% of revenue and teaches the format. The long tail follows correctly because they have seen it done once.

### 10.3 Staff adoption

Cash orders rung up informally, or "we'll enter it later", and inventory accuracy collapses within a month. Related: if only the owner knows how to add an ingredient, add a recipe and update a price, the data goes stale the first week he travels. Train a manager on those three operations specifically.

### 10.4 Price maintenance

Ingredient purchase prices must be refreshed roughly monthly — fifteen minutes of work. Stale prices mean the margins driving decisions are fiction. This is the single most likely reason the system quietly stops being useful.

### 10.5 Operational

- Razorpay KYC takes 1–3 weeks. Start in Month 1.
- Single server is a single point of failure. Nightly dumps plus provider snapshots, and **test the restore, not the backup** — run a real `pg_restore` into a scratch database monthly.
- The client's broadband is a weaker link than the server. A manual order pad remains the fallback and should stay usable.
- If the client's website is redesigned by someone else, the widget and tracking embed will break.

### 10.6 Compliance

- If the client is GST-registered, printed bills need correct GSTIN, HSN/SAC codes and sequential invoice numbering.
- Customer phone numbers are personal data under the DPDP Act 2023. The client is the Data Fiduciary; the developer is a processor during build and warranty only.
- Allergen answers: see Module 9.

---

## 11. Client-side operating requirements

Worth stating in the handover documentation, because it will not be asked about until something breaks.

**Daily** — staff take orders and tap status through the kitchen board; stock entered as deliveries arrive. Skipping stock entry causes drift within a week, after which nobody trusts the numbers.

**Weekly (~20 min)** — physical count on high-value items, adjust variances, check the low-stock list, glance at top/bottom performers.

**Monthly (~30 min)** — update ingredient purchase prices, review margins, adjust menu pricing if food cost has crept up, confirm vendor payments went through (an expiring card is the classic way people lose a server).

**On menu change** — new items need a recipe entered before they can be sold, or they sell at zero cost and skew everything.

**Ongoing, without a retainer** — keeping VPS, domain, API and backup accounts paid; verifying backups restore quarterly; server patching or accepting the risk; hardware replacement; keeping a manual fallback for outages.

---

## 12. Handover deliverables

- Complete source code in a repository
- Drizzle migrations, checked in
- Seed script
- `docker-compose.yml` bringing up app + Postgres locally in one command
- `AGENTS.md` — conventions, schema, and the reasoning behind the paise and base-unit decisions
- `README.md` — local setup and deploy steps
- Backup and restore runbook, with one demonstrated successful test restore before go-live
- Administrator and staff user guide
- Recorded video walkthrough of the principal staff workflows
- Technical handover document: architecture, environment variables, scheduled jobs — sufficient for a competent third-party developer to assume maintenance
- All Third-Party Service credentials, in accounts held in the client's name
- Passing test suite

---

## 13. Commercial context

Relevant only because it constrains engineering decisions.

Fixed fee **₹1,50,000**, four milestones of 25% (signing; inventory + costing demo; orders + tracking demo; go-live). No ongoing support retainer — 30-day warranty from go-live, then time-and-materials. The developer retains full IP with the right to reuse and resell; the client gets a perpetual non-exclusive licence for its own outlets. This is why `tenant_id` exists from day one and why the build must stay generic enough to resell.

All third-party accounts are in the client's name, on the client's card. Recurring cost is an indicative range of **₹5,000–8,000/month**, explicitly not a cap. Hardware (~₹41,000–64,500) is procured by the client directly.

The engineering consequence: **build multi-tenant-ready from the schema up.** If this codebase serves one cafe and is never reused, the economics do not work. Client two must be a configuration change, not a fork.
