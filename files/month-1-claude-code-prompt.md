# Month 1 — Foundations & Inventory
### Prompt for Claude Code

> Paste the block below into Claude Code at the root of an empty repo.
> Sections marked `[FILL]` need your values before you send it.

---

## The prompt

We are building an internal cafe management system. This is Month 1 of a 5-month build. Your job this month is **foundations and inventory only** — do not build costing, orders, or any customer-facing feature. Those come later and building them now will create rework.

### Project context

A single-outlet cafe and bakery in Chhatrapati Sambhajinagar, India. Staff use this internally on a counter PC and a kitchen tablet. Later phases add recipe costing, order management, a customer tracking page, and an AI assistant. Build the schema so those phases drop in without migration pain.

### Stack

- Next.js (App Router) + TypeScript, deployed as a standalone Node server
- PostgreSQL 16, accessed via Drizzle ORM
- Tailwind CSS
- Docker Compose for local dev and for the production VPS
- Session-based auth (no third-party auth provider — this runs on our own VPS)
- Deployment target: single VPS, Indian region, behind Caddy with automatic TLS

### Non-negotiable conventions

Apply these everywhere. They are the most expensive things to retrofit later.

1. **Money is stored as integer paise.** Never a float, never a decimal for currency. A column named `*_paise`. Convert and round exactly once, at the display boundary. Write a `formatINR(paise: number): string` helper and use it exclusively.
2. **Quantities are stored in a canonical base unit per measurement type** — grams for weight, millilitres for volume, and a unit count for countable items. Never store "2 kg". Store `2000` with `unit_type = 'weight'`. All conversion happens at the input and display boundary.
3. **Every business table carries `tenant_id`.** We have one client today and intend to resell this. Every query filters by tenant. Add it now.
4. **Nothing is hard deleted.** Use `deleted_at` timestamps. Stock and cost history must remain reconstructable.
5. **Stock is never overwritten.** Current stock is derived from an append-only ledger of movements. Never `UPDATE ingredients SET qty = ...` from application logic.
6. All timestamps are `timestamptz` stored in UTC. Display in Asia/Kolkata.
7. Server-side validation with Zod on every mutation. Never trust the client, including for role checks.

### Schema to build

Design the tables; these are the required entities and the fields that matter.

**tenants** — id, name, timezone, currency, created_at

**users** — id, tenant_id, name, email, password_hash, role, is_active, created_at, deleted_at
Roles: `owner`, `manager`, `counter`, `kitchen`. Role determines both route access and visible UI.

**suppliers** — id, tenant_id, name, phone, notes, deleted_at
(Minimal. Full supplier management is explicitly out of scope — this exists only so a stock receipt can reference where it came from.)

**ingredients** — id, tenant_id, name, unit_type (`weight` | `volume` | `count`), base_unit, purchase_unit, purchase_unit_in_base (e.g. buying in kg with base grams gives 1000), low_stock_threshold_base, is_active, deleted_at

**stock_movements** (append-only ledger) — id, tenant_id, ingredient_id, movement_type (`purchase` | `adjustment` | `wastage` | `consumption` | `reversal`), quantity_base (signed: positive in, negative out), unit_cost_paise (nullable — only set on purchases), total_cost_paise, reference_type, reference_id, reason, note, created_by_user_id, created_at

`consumption` and `reversal` are written by later phases. Define them now; leave the code paths unimplemented.

**ingredient_stock** (derived cache) — tenant_id, ingredient_id, qty_base, weighted_avg_cost_paise, updated_at

This is a materialised convenience, not the source of truth. Recompute it inside the same transaction as every movement insert. Provide a `recalculateStock(ingredientId)` function that rebuilds it from the ledger, and a script that rebuilds all of them — we will need this when the costing engine lands.

**audit_log** — id, tenant_id, user_id, action, entity_type, entity_id, before_json, after_json, created_at

### Weighted average cost

Recalculate on every `purchase` movement:

```
new_avg = (old_qty * old_avg + in_qty * in_price) / (old_qty + in_qty)
```

Rules:
- Compute in integer paise; round half-up at the final step only.
- If `old_qty <= 0`, the new average is simply the incoming unit price.
- Adjustments, wastage and consumption reduce quantity but never change the average cost.
- This must be correct. Write unit tests before the implementation, including: first ever purchase, purchase at a different price, purchase when stock is zero, purchase when stock is negative, and a wastage movement between two purchases.

### Features to build

**Auth**
- Login, logout, session cookie (httpOnly, secure, sameSite lax)
- Password hashing with argon2 or bcrypt
- Middleware enforcing role-based route access
- Seed script creating one owner account

**User management** (owner and manager only)
- List, create, deactivate users; assign role
- A user cannot deactivate themselves or change their own role

**Ingredient management**
- List with search, filter by active, and a low-stock indicator
- Create and edit: name, unit type, base unit, purchase unit, conversion factor, low-stock threshold
- Show current stock and weighted average cost per ingredient
- Deactivate (soft delete)

**Stock receipt (stock in)**
- Form: ingredient, quantity in purchase units, total cost paid, optional supplier, optional note
- Compute and display unit cost in base units before saving
- Support multiple line items in one receipt, saved in a single transaction

**Stock adjustment**
- Positive or negative correction with a mandatory reason (`count_correction`, `wastage`, `spoilage`, `theft`, `other`)
- Free-text note required when reason is `other`

**Stock movement history**
- Filterable by ingredient and date range
- Shows running balance
- Read-only, no editing — corrections are new movements

**Low stock view**
- Ingredients at or below threshold, sorted by severity

### Explicitly out of scope this month

Do not build, scaffold, or stub UI for: recipes, sub-recipes, menu items, costing, margin, orders, order status, kitchen display, customer-facing pages, payments, analytics dashboards, the AI assistant, notifications, or reporting exports. If a task seems to need one of these, stop and ask.

### Testing

- Vitest for unit tests. The weighted-average and unit-conversion functions need thorough coverage — these are the foundation of the entire costing engine in Month 2.
- Test that stock movements are transactional: a failed line item in a multi-line receipt must roll back the whole receipt.
- A seed script with ~30 realistic Indian bakery ingredients (maida, butter, castor sugar, cinnamon powder, milk, cream cheese, active dry yeast, eggs, etc.) with plausible purchase units and prices.

### Deliverables at end of month

- `docker-compose.yml` running app + Postgres locally with one command
- Drizzle migrations, checked in
- Seed script
- `AGENTS.md` documenting the conventions above, the schema, and the reasoning behind the paise/base-unit decisions
- `README.md` with local setup and deploy steps
- Passing test suite

### How to work

Work in this order and stop for review after each step:

1. Propose the full schema as Drizzle definitions. **Wait for my approval before writing any other code.**
2. Migrations, seed script, Docker setup.
3. Unit conversion and weighted-average functions, with tests first.
4. Auth and role middleware.
5. Ingredient CRUD.
6. Stock movements, receipt and adjustment flows.
7. History and low-stock views.

Keep UI plain and functional — a clean table-and-form admin interface. Visual design comes later. Prioritise correctness of the data layer over everything else.

Ask me when a decision is ambiguous rather than assuming. If you find yourself writing more than ~150 lines without a checkpoint, stop and show me what you have.

---

## Notes for you (not part of the prompt)

**Before you send it, fill in:** the client's actual ingredient list if you have it from the chef session, and swap the seed data if their menu is different.

**Step 1 matters most.** Do not let it move past the schema until you have read it yourself, line by line. Every mistake in the schema costs ten times more in Month 2.

**Write the paper test cases yourself** before step 3 — five weighted-average scenarios with the arithmetic worked out by hand. Give them to Claude Code as the expected values. If the code disagrees with your paper, the code is wrong.

**Keep AGENTS.md current** as you go. Month 2 through 5 depend on it, and so does your partner's agent if you split the work.
