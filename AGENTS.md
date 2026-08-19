# AGENTS.md

Conventions for the cafe management system. Read `files/PROJECT-SPEC.md` first — this
file records what we decided that the spec does not say, and why.

Current state: **Month 1, step 6 complete.** Schema, migrations, seed, unit conversion,
weighted-average cost, auth, role enforcement, ingredient CRUD, and stock receipts /
adjustments / wastage are in and tested against live Postgres (74 tests, none skipped).
Movement history and low-stock views are not started.

---

## Numeric scales

Three integer scales. Nothing else. No floats, no decimals, anywhere.

| Suffix | Meaning | Example |
|---|---|---|
| `*_milli_base` | thousandths of a base unit (g / ml / unit) | 0.4 g salt → `400` |
| `*_millipaise_per_base` | thousandths of a paise, per one base unit | butter ₹500/kg → `50000` |
| `*_paise` | whole paise. Money that changed hands | ₹349.99 → `34999` |

**The boundary between rates and money is hard.** `*_millipaise_per_base` is a rate and
is never money. `*_paise` is money and is never a rate. `stock_movements.total_cost_paise`
is whole paise. `order_lines.cost_snapshot_paise` in Month 3 is whole paise. A per-unit
cost never gets stored in a `*_paise` column, and a paid amount never gets stored in a
`*_millipaise_per_base` column.

`ingredients.purchase_unit_in_base` is the odd one out on purpose: it holds whole **base**
units (kg → `1000`, tray of 30 eggs → `30`) because it is a unit definition, not a
measurement.

### Which layer converts

Exactly two places convert, and nothing between them ever does:

- **Input boundary** — the Zod schema on a mutation. Takes the operator's decimal
  (`"2.5"` kg, `"₹450.00"`), multiplies up to integer `milli_base` / `millipaise` /
  `paise`, and hands integers to everything downstream.
- **Display boundary** — `formatINR()` / `formatQty()`. Divides back down and rounds.

Server actions, query functions, and the costing engine see integers only.

### Rounding

Half-up, **once**, on the final value of a chain. Never on an intermediate, never inside a
costing chain, never "just to tidy up" a middle result.

The weighted-average is computed in TypeScript, in `BigInt`, not in SQL and not in
`number`. The `old_qty * old_avg` intermediate reaches ~5×10¹² for 100 kg of butter and
grows with catalogue size; `BigInt` is exact at any magnitude, so nothing is lost
mid-chain and there is no float anywhere in the path:

```
new_avg = divRoundHalfUp(old_qty * old_avg + in_qty * in_price, old_qty + in_qty)
```

`divRoundHalfUp` **throws** on a negative numerator rather than rounding it — see below.

If `old_qty <= 0`, the new average is the incoming unit price outright. Adjustment,
wastage and consumption movements change quantity and never touch the average.

### Rounding never touches a quantity

Costs get rounded. Quantities never do.

Quantities are **signed** — negative on consumption, wastage and downward adjustments —
and half-up and half-away-from-zero disagree below zero, so rounding a signed quantity
would send `-0.5` to `-1` and quietly deplete stock that was never used. Quantities are stored
as exact integers in `milli_base` with no rounding step anywhere: the input boundary
**rejects** an operator entry finer than `milli_base` (0.001 g) rather than rounding it
away. Zod raises a validation error; it does not silently truncate.

Rounding is applied to exactly one thing: the final cost quotient. Costs are non-negative
(check constraint on both cost columns), so half-away-from-zero *is* half-up there.

**Month 2 will introduce the first quantity arithmetic that can produce a fraction** — the
wastage-percent multiplier, e.g. `180 g × 1.03`. When it lands, round the magnitude and
reapply the sign; never call `round()` on a signed quantity directly.

---

## Deviations from spec

Approved deviations, with the reasoning, so Month 2 does not rediscover them.

### 1. Per-unit costs are millipaise-per-base, not paise

**Spec:** `unit_cost_paise`, `weighted_avg_cost_paise`.
**Built:** `unit_cost_millipaise_per_base`, `weighted_avg_cost_millipaise_per_base`.

These columns hold cost per *base unit*, not per purchase unit. In whole paise per gram,
maida is ~4 and a cheap spice is ~0.4 → rounds to `0`. The ingredient then contributes
nothing to any recipe cost, silently, forever, and the error compounds upward through
Month 2 sub-recipes. Three extra digits removes the problem at no cost. Money that
actually changed hands stays whole paise (see the boundary rule above).

### 2. Quantities are milli-base, not base

**Spec:** `quantity_base`, `qty_base` as integer grams.
**Built:** `quantity_milli_base`, `qty_milli_base`.

Same failure on the other axis. Whole grams are fine for purchases (nobody buys 0.4 g of
salt) but wrong for `consumption`: one cinnamon roll uses ~0.4 g salt and ~1.5 g yeast,
which floor to `0` and `2` — the salt never depletes and the yeast is 33% out. Month 2's
`recipe_lines` quantity follows the same convention.

### 3. `ingredients.base_unit` dropped

**Spec:** stores a `base_unit` label column.
**Built:** derived from `unit_type` in code (`weight`→`g`, `volume`→`ml`, `count`→`unit`).

The mapping is fixed and 1:1. A column that can never legitimately diverge is a column
that can only ever be wrong.

### 4. `sessions` table added

Not in the spec's entity list. Session-cookie auth needs somewhere to put sessions.

The primary key is `token_hash` = `sha256(cookie token)`, hex. The raw token exists only
in the cookie. Same reasoning as `password_hash`: a database dump, an injection, or
read-only access to that table must not let anyone impersonate every logged-in user.

### 5. `adjustment_reason` renamed to `movement_reason`, and split from the event

The spec lists `wastage` in both the `movement_type` enum and the `adjustment_reason`
enum. The two enums now answer different questions:

- **`movement_type` — what happened.** `wastage` is the concept: stock lost rather than
  sold. Month 3 writes it directly.
- **`movement_reason` — why.** Spoilage is one *cause* of wastage, not a synonym for it.
  Burnt batches, dropped trays, proofing trim and expiry are all wastage with different
  causes, and the owner will want them separable in reporting.

```
adjustment -> count_correction | theft | other
wastage    -> spoilage | expiry | burnt | dropped | trim | other
```

Renamed from `adjustment_reason` because it now serves both movement types. The
type/reason pairing above is enforced by check constraint, not left to the UI.

### 6. Composite tenant foreign keys

Every FK between two tenant-scoped tables is composite on `(tenant_id, <id>)`, not a bare
FK on the id. Referenced tables carry a `uniqueIndex(tenant_id, id)` to support it.

Without this, nothing at the database level stops one tenant's `tenant_id` being paired
with another tenant's `ingredient_id`. On a codebase built for resale, cross-tenant
mixing is the one failure that cannot be cleaned up after the fact — application-level
tenant filtering is not sufficient, because a single missed `where` clause is enough.

Where a composite FK already guarantees the tenant exists, the redundant direct FK to
`tenants` was dropped (`sessions`, `stock_movements`, `ingredient_stock`).

### 7. Cost columns and quantities are `bigint`

The columns were never the problem; the intermediates are. `old_qty * old_avg` for 100 kg
of butter exceeds `int4`. Stored as `bigint` (`mode: 'number'`, safe to 2⁵³), and the
weighted-average computation itself runs in `BigInt`.

### 8. `stock_movements.seq` added (bigserial)

Not in the spec. The ledger needs a **total order** and `created_at` does not provide
one: a multi-line receipt inserts several rows with an identical `now()`, and because
the average is rounded at each step, replaying three or more purchases in a different
order can land a millipaise away from the incrementally maintained cache. That would
make the T11 invariant flake rather than fail, which is worse.

Always `ORDER BY seq` when replaying. Never `created_at`.

---

## One implementation of the cost arithmetic

`src/lib/stock.ts` is pure - no database, no I/O - and holds the only implementation of
the weighted average. Both routes that maintain `ingredient_stock` call it:

- the per-movement cache update, via `recordMovements()`
- a full rebuild, via `recalculateStock()`

They cannot disagree about a number, because they run the same fold. The only divergence
still possible is a write that never happened, which is what the database-level T11
checks. Keep it that way: no second copy of this arithmetic in a query, a server action,
or a report.

The paper test cases T1-T12 live in `src/lib/stock.test.ts` and `src/db/stock.db.test.ts`.
**They are the specification.** If the code disagrees with them, the code is wrong.

---

## Authorisation

**The enforcement point is `requireSession()` / `requirePermission()` in
`src/auth/server.ts`, called as the first statement of every protected page and server
action.** Not middleware, and certainly not the UI.

`middleware.ts` checks only whether a session cookie is *present* and redirects to
/login if not. It does not validate the cookie, it cannot see a server action invoked
directly, and Next middleware has been bypassable before now. It is a convenience for
the browser, nothing more. The functions in `src/db/users.ts` each re-check the actor's
permission themselves for the same reason - a server action is reachable without ever
loading the page that would have hidden the button.

Two guards that are not obvious, both approved additions beyond the spec:

- **A user cannot deactivate themselves or change their own role.** Otherwise the last
  owner can lock everyone out, by accident or in a huff, with no route back in.
- **Only an owner may grant the `owner` role.** Without it a manager promotes a second
  account to owner and inherits everything - `users.manage` quietly becomes owner with
  one extra step.

Sessions store `sha256(token)`; the raw token exists only in the cookie. Expired
sessions are rejected *and deleted* on lookup, and deactivating a user deletes their
live sessions immediately rather than waiting for them to lapse.

`PERMISSIONS` lists only capabilities that exist today. Add a line when a feature lands,
not before. Current set:

| permission | roles |
|---|---|
| `users.manage` | owner, manager |
| `ingredients.view` | owner, manager, counter |
| `ingredients.manage` | owner, manager |

Kitchen staff cannot view the ingredient master: it carries cost figures, and the
owner's margins are not counter-and-kitchen information.

---

## Deactivation vs deletion, for ingredients

`is_active = false` is the deactivation the UI offers. `deleted_at` stays null and is
reserved for a removal this system does not provide, because stock and cost history must
stay reconstructable indefinitely.

**A deactivated ingredient keeps its name.** The unique index covers every non-deleted
row, active or not, so creating a second "Butter" is refused with a message telling the
operator to reactivate the existing one. Freeing the name would let two ingredients of
the same name exist with two separate stock ledgers, which is a data-quality trap worth
more than the convenience.

Editing an ingredient never touches stock or cost - those move only through the ledger.
`purchase_unit_in_base` is editable because a supplier really does switch from 1 kg bags
to 25 kg sacks; it rescales how receipts are *entered*, never what is on hand.

---

## Ledger replay cost

`recalculateStock()` replays an ingredient's **entire** ledger on every movement insert.
At 150 orders/day writing a consumption movement per ingredient per order, a
high-frequency ingredient reaches five figures of movements inside a year, and every
sale pays for the whole replay. So the ceiling is measured, not assumed.

Measured on the dev machine (Node 24, `src/lib/stock.bench.test.ts`):

| ledger size | median |
|---|---|
| 10,000 | 0.7 ms |
| 50,000 | 2.0 ms (6.0 ms including row mapping) |
| 100,000 | 3.2 ms |
| 50,000, every movement a purchase (worst case for the fold) | 2.1 ms |

**The fold is not the bottleneck** - roughly 0.1 µs per movement, linear. The test budget
is 150 ms at 50,000 movements, deliberately generous: it exists to catch an algorithmic
regression (an accidental O(n²), a per-movement allocation), not to police a slow CI box.
A second test asserts the growth stays linear, because a quadratic rewrite would pass a
wall-clock budget long after it became the wrong shape.

### End-to-end, against live Postgres

The fold was never the cost. Fetching the rows is. Measured with `npm run bench:replay`
(Postgres 16 in Docker, same machine, median of 5):

| ledger size | fetch + fold | per movement | in-memory fold alone |
|---|---|---|---|
| 1,000 | 7 ms | 6.6 µs | — |
| 10,000 | 18 ms | 1.8 µs | 0.7 ms |
| 50,000 | **87 ms** | 1.7 µs | 2.0 ms |
| 100,000 | 171 ms | 1.7 µs | 3.2 ms |

Still linear, but **~43x the in-memory figure at 50,000**. The 2 ms number was a floor,
and a misleading one to plan against.

### This changes the snapshotting decision

87 ms is paid *per movement insert*, inside the transaction, holding locks. It does not
matter yet - Month 1 ledgers are empty. It matters in Month 3, when confirming an order
writes a consumption movement per ingredient:

- A high-frequency ingredient (maida, butter, sugar) takes a movement on most orders. At
  150 orders/day that is ~50,000 movements in roughly **11 months**.
- An order touching 5 such ingredients then costs 5 x 87 ms = **~0.4 s of replay** added
  to confirmation, and ~0.9 s a year later at 100,000.

That is a counter staff member waiting on a till during a rush, which is the exact
failure mode section 6.5 of the spec warns about.

**Conclusion: snapshotting needs to land before Month 3 order confirmation goes live**,
not "if it ever gets slow". It is not needed now and is deliberately not built.

It does not reintroduce a second arithmetic path: a snapshot changes the *starting
state* of the same fold, so the invariant becomes "cache = snapshot + replay of
movements after it" and `applyMovement` stays the only implementation.

---

## Recording stock movements

Every write goes through `recordMovements()` in `src/db/stock.ts`. It is the only place
that inserts into `stock_movements`, and it does three things in one transaction: insert
the rows, refresh the cache for each affected ingredient, and write the audit entry.
`src/db/movements.ts` builds and validates the lines; it contains no arithmetic beyond
deriving a purchase's unit cost with the shared helper.

**A receipt is one transaction.** All lines share one `reference_id`, so the delivery can
be read back as a single event, and a bad line rolls the whole receipt back. The form
says so explicitly when it fails — "nothing was saved" — because a half-recorded delivery
the operator believes succeeded is worse than an outright error.

**Audit is one entry per operation, not per line.** `stock_movements` already records who
and when for every row, so a per-line audit copy would add volume without adding
information; the lines are carried in `afterJson`. The action is *derived* from the
movement types present (`stock.receipt`, `stock.wastage`, `stock.adjustment`, …) rather
than passed in, so no caller can forget it or label it wrongly.

**Sign is applied from an explicit direction choice**, never by asking an operator to
type a minus sign — they will forget it half the time, and an adjustment with the wrong
sign doubles the error it was meant to fix. Wastage has no direction control at all: it
only ever removes stock, so offering the choice would be a trap.

The unit-cost preview shown before saving calls the same helpers the server uses to store
it, so what the operator checks against the delivery note is what gets written.

## Translating driver errors

`src/db/errors.ts`. Drizzle wraps the driver failure in a `DrizzleQueryError` and hangs
the postgres.js error off `.cause`, so a naive `err.code === '23505'` never matches —
which is exactly how a raw "duplicate key value violates unique constraint
ingredients_tenant_name_uq" once reached a form field. Walk the cause chain instead.

**Always match on the constraint name as well as the code.** A bare code check would
mislabel some future unrelated unique violation as "that name is taken", which is worse
than the raw error because it is confidently wrong. Anything unrecognised is rethrown
untouched: a surprise must stay a surprise.

Translated today: `ingredients_tenant_name_uq` and `users_tenant_email_uq` — the two
unique constraints reachable from a form. Add a translation whenever a new one becomes
reachable from user input.

## Seeding outside development

`SEED_OWNER_PASSWORD` is **required** whenever `NODE_ENV` is not `development`; the seed
refuses to run without it rather than defaulting. That account holds every permission in
the system, and "we'll change it after go-live" is how it stays `changeme-dev-only`.
`NODE_ENV` unset counts as not-development — the server is the place least likely to have
it set deliberately.

## Invariants enforced in the database, not just in code

Application code is expected to uphold these too — the constraints are there for the day
it doesn't.

- `stock_movements` is **append-only**. No UPDATE, no DELETE, ever. A correction is a new
  row.
- Cost columns are set on `purchase` movements and only on `purchase` movements.
- `purchase` quantities are positive; no movement has zero quantity.
- `adjustment` and `wastage` movements require a reason; reason `other` requires a note.
- Ingredient names are unique per tenant, case-insensitively, among non-deleted rows.
- User emails are unique per tenant, case-insensitively.
- `ingredient_stock.qty_milli_base` **may go negative** (spec 6.2). The cafe sells the
  last croissant regardless of what the system thinks. Flag it in the UI; never block the
  sale.

## Other conventions

- Every business table carries `tenant_id`. Every query filters by it. Every composite
  index leads with it.
- Nothing is hard deleted: `deleted_at timestamptz`.
- All timestamps are `timestamptz`, stored UTC, displayed Asia/Kolkata.
- `ingredient_stock` is a derived cache, not the source of truth. It is recomputed inside
  the same transaction as every movement insert. `recalculateStock(ingredientId)` rebuilds
  it from the ledger.
- Zod validation on every mutation, server-side, including role checks.
