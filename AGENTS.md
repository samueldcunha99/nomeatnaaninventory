# AGENTS.md

Conventions for the cafe management system. Read `files/PROJECT-SPEC.md` first — this
file records what we decided that the spec does not say, and why.

Current state: **Month 1 complete (steps 1–7).** Schema, migrations, seed, unit conversion,
weighted-average cost, auth, role enforcement, ingredient CRUD, stock receipts /
adjustments / wastage, movement history and low-stock views are in and tested against live
Postgres (86 tests). The **UI styling pass is complete** — all 9 internal screens, Tailwind v4.
Month 2 — deploy pipeline, then the costing engine — has not started and is gated.

See [PROGRESS.md](PROGRESS.md) for state, history and open blockers, and
[README.md](README.md) for setup.

---

## Read these five before writing anything

This file is long because the reasoning is the valuable part. If you read nothing else,
read these, because each one records a bug that shipped or was caught late:

1. **§ Numeric scales** — three integer scales, no floats anywhere. Getting this wrong
   makes a margin figure quietly wrong rather than throwing.
2. **§ Aggregates come back as strings** — `sum()` over a `bigint` arrives as a JS string.
   `'900' > '4850000'` is `true`. This already happened once.
3. **§ Costing takes its cost lookups as a parameter** — the seam Month 2 is built on. Do
   not "simplify" it.
4. **§ Missing cost data is an error, never zero** — the highest-priority rule for Month 2.
5. **§ One implementation of the cost arithmetic** — there is exactly one fold. Do not add
   a second path.

### Three habits that caught most of the defects on this project

- **Write the test that proves the fix, after finding the bug in your own code.** Every
  significant defect here was found by testing behaviour, not by reading types.
- **Prove a guard fails.** A guard nobody has watched fail is not yet a guard. The NUL-byte
  and numeric-as-string tests were both verified by deliberately breaking the code.
- **Read generated output.** The migration DDL-ordering bug was invisible to `tsc` and
  would have failed on first run.

### The failure mode to fear

Not a crash. A confident, plausible, wrong number. A recipe costed against an ingredient
with no purchase history; a running balance that restarts inside a date filter; a stock
level compared lexicographically. All three occurred. None threw.

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

### 9. `recipe_lines` carries `tenant_id` (Month 2)

**Spec:** PROJECT-SPEC § 5 lists `recipe_lines` as
`id, recipe_id, ingredient_id, sub_recipe_id, quantity_base, wastage_percent` — no
`tenant_id`.
**Decision:** it carries `tenant_id`, with composite foreign keys to `recipes` and
`ingredients`, like every other business table.

The spec is a working document and its § 2.3 rule ("every business table carries
`tenant_id`, every table, no exceptions") is the stronger statement. Without it a recipe
line can reference another tenant's ingredient, and cross-tenant mixing is the one failure
that cannot be cleaned up after the fact.

Approved before Month 2 began.

---

## Costing takes its cost lookups as a parameter

**The costing function must never reach into `ingredient_stock` itself.** It receives a
cost lookup — a function or map from ingredient to cost — and asks that. This seam is
deliberate. Do not "simplify" it later by having the costing function fetch its own costs;
that change looks like a tidy-up and silently removes three capabilities at once:

1. **The what-if price.** PROJECT-SPEC § 1 defines success as *"change the butter purchase
   price and every item recosts"*. That sentence was written as a sales demo, not a
   specification: cost is the weighted average over an append-only ledger, and nothing
   edits a price, because editing one would rewrite history. With this seam the demo is a
   lookup with butter overridden — margins move on screen, **nothing is written**, and the
   ledger stays sacred.
2. **Historical costing, "as at seq N".** Month 3 must snapshot the cost onto every order
   line at the moment of sale, and historical reports read the snapshot rather than
   recomputing. Replaying the ledger to a cutoff produces a lookup for any point in time.
3. **Re-runnable catalogue recalculation.** PROJECT-SPEC § 3 requires recosting to be
   re-runnable across the whole catalogue, so an early arithmetic bug can be fixed and
   reprocessed. That is the same function with a different lookup.

All three are the same shape. One parameter buys all of them; hard-wiring the fetch costs
all three and the loss is not obvious at the call site.

## Missing cost data is an error, never zero

**If an ingredient has no purchase history, its cost is unknown — not zero.**

There is no `ingredient_stock` row until an ingredient's first movement, and a naive join
defaults the absent row to `0`. A recipe costed against a never-received ingredient would
then produce a total that is confident, plausible, and wrong — precisely the failure mode
PROJECT-SPEC § 6.1 warns about, and the one that destroys trust in every other number the
system shows.

So:

- The cost lookup **throws** on an ingredient with no cost basis. It does not return zero,
  it does not return null for the caller to coalesce.
- It must be **impossible to view or save a recipe cost** where any input lacks a cost
  basis, transitively through sub-recipes.
- The failure is surfaced **by name**: "3 ingredients have no purchase history: cardamom
  powder, vanilla essence, butter paper sheet" — not a silent zero, and not an opaque error.
  The operator can act on a list of names; they cannot act on a wrong total they have no
  reason to doubt.

A zero cost that is genuinely correct — a free sample, something written off — is recorded
the same way as anything else: a `purchase` movement with `total_cost_paise = 0`. That has
a cost basis. Never having been received does not.

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

## Aggregates come back as strings

**Postgres returns `sum()`, `count()` and `avg()` over a `bigint` as `numeric`, and
postgres.js hands `numeric` back as a JavaScript string.** Drizzle converts columns whose
type it declares; it cannot convert a raw SQL expression. So a field typed `number` in the
select shape is simply a lie unless you convert it yourself.

Nothing throws. What happens instead is that every comparison becomes lexicographic:

```js
'900' > '4850000'   // true
 900  >  4850000    // false
```

A stock level, a running balance, a food-cost percentage or a margin built on that is
**quietly wrong**, and it looks plausible. This has already happened once, on the movement
history's running balance.

**The rule.** Every aggregate that is *selected* must be normalised in the query layer,
once, at the point it crosses the boundary:

```ts
rows = rows.map((r) => ({ ...r, balanceMilliBase: Number(r.balanceMilliBase) }));
```

An aggregate used only in `ORDER BY` or `WHERE` never crosses the boundary and needs no
conversion — Postgres compares it in `numeric`, which is correct. `listLowStock`'s severity
expression is that case.

Milli-base and millipaise values are far inside `Number`'s exact range, so `Number()` is
safe here. If a future aggregate could exceed 2⁵³ — a lifetime total across a whole
catalogue, say — use `BigInt` instead and keep it out of `number` entirely.

**This matters most in Month 2.** The costing engine is aggregation over recipe lines:
`sum()` of ingredient contributions, counts of sub-recipe depth, food-cost percentages. It
is exactly the place where a string-typed number produces a margin figure nobody questions.

`src/db/history.db.test.ts` has a test that asserts the runtime `typeof` of every numeric
field the query layer returns. Copy that pattern for every new query module rather than
trusting the declared types — it was verified by removing the conversion and confirming the
test fails.

## Reading the ledger

`src/db/history.ts` is read-only and must stay that way. There is no update and no delete
in it; a correction is a new movement (PROJECT-SPEC § 2.5). If a screen ever appears to
need to "fix" a movement, it wants `recordCorrection()` instead.

**The running balance is computed over the whole ledger, with the date filter applied
outside the window.** Putting the filter alongside the window restarts the balance at the
beginning of the filtered range — the number then reads like a stock level while actually
being a subtotal, which is worse than showing nothing. This is the load-bearing test in
`history.db.test.ts`.

**A balance is only shown when one ingredient is selected.** Across a mixed list it would
be adding grams of salt to millilitres of milk. Skipping the window in that case also
avoids scanning the whole tenant ledger for a column nobody can use.

**`sum()` over a `bigint` returns `numeric`, which postgres.js hands back as a string.**
Any raw aggregate has to be normalised in the query layer, or it will be typed `number`,
be a string at runtime, and get compared lexicographically at every call site. Watch for
this on every new aggregate — Drizzle only converts columns it knows the type of.

Aggregate output columns need an explicit `.as()` alias, and so do joined columns that
collide: three tables here each expose `name`, which makes an enclosing subquery ambiguous.

**Low-stock severity is proportional, not absolute.** The shortfall as a share of the
threshold, so 2 kg short of a 3 kg threshold outranks 2 kg short of a 50 kg one. Sorting by
the raw gap would bury the urgent one. Ingredients with no threshold set appear only once
actually oversold — otherwise every ingredient nobody has configured sits in the list
permanently and the list stops being read.

Dates typed into a filter form are Asia/Kolkata calendar days, converted to UTC instants at
the page boundary. Timestamps are stored UTC and formatted for display with an explicit
`timeZone: 'Asia/Kolkata'`.

## Brand: two tiers, and the Copperplate licence

**Internal screens are brand-adjacent, not brand-faithful.** Ingredients, receipts,
adjustments, movement history, low stock, login and users are used by counter and kitchen
staff during a rush, on cheap tablets, under glare. Legibility and tap-target size beat
aesthetics every time. Customer-facing screens (Month 4) get the full brand treatment and
must not inherit these compromises.

All tokens live in `app/globals.css`, in `:root`, and nowhere else. **No hardcoded hex in a
component.** A second source of colour is how a palette stops being one.

### ⚠️ Copperplate is not cleared for web use

The brand book names **Copperplate** as the primary typeface. It is **not used anywhere in
this codebase** and must not be until its licence is verified.

Two separate problems:

1. **Licensing.** Copperplate ships with macOS and with Adobe software, but desktop bundling
   does **not** grant webfont embedding rights. That is a separate licence and it has not
   been checked. **Verify before Month 4**, when customer-facing screens are built and the
   face would actually be wanted.
2. **Legibility.** It is an all-caps display face with no lowercase. It is unreadable at
   body size and has no place on an internal screen regardless of licensing.

Internal screens use **Poppins** (400 / 600 / 700), self-hosted via `next/font`. Note that
Poppins is *not* in the brand book — it is a deliberate substitution for legibility, made
with the client's agreement.

`next/font` downloads at build time and serves from our own origin. Do not switch to a
`<link>` tag pointing at fonts.googleapis.com: this runs on a VPS in India and text must not
depend on an external CDN being reachable at page load.

### State colours, and why the brand palette cannot supply them

The book is entirely cool blues and greens. Nothing in it can say "LOW STOCK" or "receipt
refused" — `--fern` reads as success and every other colour reads as decoration. Two were
added:

| Token | Value | Contrast on bone | Reasoning |
|---|---|---|---|
| `--danger` | `#8c2f39` claret | 7.28:1 | Hue 354° leans blue-red rather than orange-red, keeping it in the palette's cool temperature. Lightness 37% sits between navy (27%) and fern (44%), so it reads as grave rather than as an alarm bell from another design system. A browser-default red at hue 0° and 100% saturation would be the only saturated thing on screen. |
| `--warn` | `#96591a` burnt amber | 5.02:1 | The only amber tested that clears 4.5:1 as text on bone — ochre `#a8641b` gives 4.17:1 and fails. Dark and muted enough not to be confused with `--sage`, which is a light yellow-green. |

### Contrast findings that constrain use

These are **palette constraints, not preferences.** They are measured, they are accepted,
and they must not be "fixed" later by using the colour directly.

#### `--color-fern` and `--color-sage` are FILLS. Neither may ever be text.

| Token | On bone | Verdict |
|---|---|---|
| `--color-fern` `#59886f` | 3.63:1 | **Below the 4.5:1 floor. Fill only.** |
| `--color-sage` `#becd9f` | 1.51:1 | **Nowhere near. Fill only.** |
| `--color-sky` `#8bb7c7` | 1.94:1 | **Fill only.** |

Use them as a background, a border, or a dot **with dark text beside or over them**. For
green text use `--color-fern-ink` (`#3f6a53`, 5.53:1). The "in stock" badge is the pattern:
`--color-ok-surface` fill, `--color-fern` hairline border, `--color-fern-ink` text — 5.50:1.

If a future screen needs green status text, it uses `fern-ink`. It does not use `fern`.

#### The focus ring is two-tone, and has to be

Bone and navy are **8.98:1 apart**. A ring 3:1 from bone needs luminance ≤ 0.24; a ring 3:1
from navy needs ≥ 0.28. No single colour satisfies both — it is arithmetically impossible,
not a matter of picking harder.

**What was chosen:** a 3px `--color-focus` (`#b3541e`, burnt orange) outline at 2px offset,
with a 2px white `box-shadow` filling that offset gap. The orange reads against bone
(4.47:1) and against the white band (5.00:1); the white band reads against navy (10.04:1).
So the ring is visible on any surface in the palette.

Burnt orange rather than a brand colour on purpose: focus must not be mistakable for a
status or a brand accent, and it is the one place in the UI where standing out beats
fitting in.

### Styling pass: complete

**All 9 internal screens are styled** — login, home, ingredients list, new ingredient,
edit ingredient, stock receipt, adjustment/wastage, movement history, low stock. No inline
`style={{…}}` remains anywhere in `app/`.

The table vocabulary was designed against the **ingredients list first**, deliberately: it
is the hardest of the six table screens, carrying search, an include-inactive filter, a
status column, a badge and a row action. The other five followed as a mechanical pass.

Customer-facing screens (Month 4) are a separate tier and must not inherit these
compromises — see the tier note above.

**Tailwind v4 is installed and is the styling system.** Resolved after the reference
screens: the spec named it, the rest of the client's work uses it, and Month 4's
customer-facing screens have real design work where hand-rolled CSS starts costing.

**There is no `tailwind.config.js`.** v4 is CSS-first: the theme *is* the `@theme` block in
`app/globals.css`. Every token there is a real custom property **and** generates utilities —
`--color-navy` gives `bg-navy`, `text-navy`, `border-navy` for free. So there is one
definition, not a hex in a config plus a variable in a stylesheet drifting apart.

Add a colour to `@theme` and nowhere else. `postcss.config.mjs` wires the plugin; that is
the whole setup. No Tailwind plugins, no component library, no icon pack — icons are inline
SVG, because two shapes do not justify a dependency.

### The class vocabulary

Defined in `app/globals.css`, used by the two styled screens. Extend this rather than
inventing per-screen classes:

`.page` / `.page--narrow` · `.brandbar` / `.brandbar__inner` / `.brandbar__name` /
`.brandbar__spacer` · `.field` / `.label` / `.input` / `.select` ·
`.btn` / `.btn--secondary` / `.btn--on-navy` / `.btn--block` ·
`.msg` / `.msg--error` / `.msg--warn` / `.msg--ok` / `.msg__icon` / `.msg__title` ·
`.navgrid` / `.navcard` / `.navcard--write` / `.navcard__hint` ·
`.section-title` / `.muted` / `.small`

**The table pattern** (designed against the ingredients list, the hardest screen — search,
filter, status column, badge, row action):

`.table-wrap` / `.table` / `.table .num` / `.col-secondary` ·
`.badge` / `.badge--ok` / `.badge--low` / `.badge--out` / `.badge--muted` ·
`.toolbar` / `.checkfield` / `.prose-note`

Four rules it encodes, each measured at 700px and 810px viewports:

- **Rows are 56px** (`--spacing-row`), sized for a fingertip rather than a mouse pointer.
  Row actions stay at the 44px floor inside them.
- **Numeric columns are right-aligned AND `tabular-nums`.** Right alignment alone is not
  enough: proportional digits still jitter column-wise and are harder to scan down a column.
- **Badges never rely on colour alone.** Each is a glyph plus a word — "⚠ Low", "✓ In
  stock" — so it survives greyscale, colour-blindness and a sun-washed tablet. Measured
  contrast runs 4.84:1 to 7.12:1, all clearing the floor.
- **Secondary columns fold below `md` rather than forcing a horizontal scroll.** Mark a
  column `.col-secondary` when it is reference detail rather than decision data.
  `.table-wrap` is the escape hatch, not the plan — at 700px the ingredients table
  drops to five columns and still does not scroll sideways.
### Badge only the exceptions

`StatusBadge` in `app/ui/status-badge.tsx` renders **nothing** for `kind: null`, and that
is the point. A badge on every row is wallpaper — if everything is badged, nothing stands
out, and standing out is the entire job of a status column.

So in the **ingredients list**, only Low, Oversold and Inactive are badged; a normal row
leaves the cell blank. The exceptions are then visible at a glance down the whole list.

The **low stock screen** badges every row, correctly: there, every row *is* an exception.

Two other rules the same component keeps: never colour alone (each badge is a glyph plus a
word, so it survives greyscale and a sun-washed screen), and caps belong on headers and
badges **only** — ingredient names are sentence case as stored, because caps measurably
slow reading and that is the column staff scan most.
### Requested UI fixes — all three done

1. ✅ **Ingredients list unit mismatch.** It showed quantity in base units (`20000 g`) while
   showing cost per purchase unit (`₹515.00 / kg`). Quantity now leads in purchase units
   (`20 kg`) via `milliBaseToPurchaseUnits()`, with the base-unit figure kept as a
   subordinate line because recipes are written in it. Both come from the shared helpers —
   no conversion happens in the component.
2. ✅ **Stock receipt instruction text overflowed the viewport.** The `<main>` had no width
   constraint. It now uses `.page` (`width: min(100% - 2rem, 72rem)`) and the note uses
   `.prose-note`, which caps the measure at 60ch rather than running edge to edge.
3. ✅ **Tables survive a narrow tablet.** Verified at 700px and 810px: secondary columns fold,
   five columns remain, and nothing scrolls sideways.
### Styling-pass rules

- **No logic changes.** `src/db` and `src/lib` are off-limits during a styling pass. If a
  screen seems to need a logic change to style, stop and ask.
- Every test must still pass and `next build` must still exit 0.
- No component libraries, icon packs, or animation libraries. Icons are inline SVG.

### Accessibility floor — operational, not box-ticking

This runs in a kitchen. Minimum **44px** tap targets on every button and form control
(`--tap`), 4.5:1 on all text, visible focus on everything interactive, and **error messages
that never rely on colour alone** — every message carries an icon and a bold lead word, so
it still reads in greyscale and on a washed-out screen.

## Source integrity

`src/lib/source-integrity.test.ts` fails if any file under `src/`, `app/` or `scripts/`
contains a NUL byte.

This exists because a scripted edit once wrote NUL bytes into `src/db/stock.ts`, and a
later search-and-replace against that file then matched nothing, changed nothing, reported
nothing, and left `tsc` passing — an audit-log insert shipped as absent rather than as
broken. A NUL also makes git treat the file as binary, so the diff stops being readable
exactly when you need it.

Prefer the editing tools over scripted string surgery on source files. When a script is
genuinely the right tool, have it assert that its replacement actually matched.

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
