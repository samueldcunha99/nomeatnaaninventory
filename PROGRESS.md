# PROGRESS

Running record of what is built, what is verified, and what is still open.

**This file is append-only.** Never delete or rewrite a log entry. If something turns out
to be wrong, or a decision is reversed, append a new entry that supersedes the old one and
say which entry it supersedes. Status markers at the top are the one part that changes in
place; the log below them only ever grows.

Same rule as [AGENTS.md](AGENTS.md). AGENTS.md holds *conventions and reasoning*; this file
holds *state and history*.

---

## Status

Legend: ✅ done and verified · 🟡 in progress · ⬜ not started · 🚫 blocked

### Month 1 — Foundations and inventory

| Step | What | Status |
|---|---|---|
| 1 | Schema as Drizzle definitions | ✅ |
| 2 | Migrations, Docker Compose, seed script | ✅ |
| 3 | Unit conversion + weighted-average cost, paper tests T1–T12 | ✅ |
| 4 | Auth, sessions, role enforcement | ✅ |
| 5 | Ingredient CRUD | ✅ |
| 6 | Stock receipts, adjustments, wastage | ✅ |
| 7 | Movement history + low-stock views | ✅ |

### Month 2 — deploy pipeline, then the costing engine

| Step | What | Status |
|---|---|---|
| 0 | Dockerfile, app service in compose, CI image build, deploy to a real VPS | ⬜ |
| 1 | Recipes and recipe_lines schema (with tenant_id) | ⬜ |
| 2 | Cost lookup seam + missing-cost errors | ⬜ |
| 3 | Sub-recipes: yield, cycle and depth rejection, unit compatibility | ⬜ |
| 4 | Wastage multiplier + sign-safe quantity rounder | ⬜ |
| 5 | Cost breakdown and margin views | ⬜ |

**Gate: Month 2 does not start until the owner has exercised the multi-line receipt form
by hand, and the deploy target is provisioned.**

### Later months

| Module | What | Status |
|---|---|---|
| 3 | Recipes, sub-recipes, costing engine (Month 2) | ⬜ |
| 4 | Orders, atomic depletion, cost snapshots (Month 3) | ⬜ |
| 5 | Kitchen status board (Month 3) | ⬜ |
| 6 | Customer order tracking (Month 4) | ⬜ |
| 7 | Online ordering + Razorpay (Month 4) | ⬜ |
| 8 | Owner analytics dashboard (Month 5) | ⬜ |
| 9 | AI customer assistant (Month 5) | ⬜ |

---

## Open questions and blockers

### 🚫 BLOCKER on Module 4 — snapshotting must land before order confirmation goes live

Snapshotting must land before Month 3 order confirmation goes live. 87 ms fetch+fold at
50k movements; an order touching 5 high-frequency ingredients adds ~0.4 s to confirmation.

This is a blocker on Module 4, not a nice-to-have. `recalculateStock()` replays an
ingredient's entire ledger on every movement insert, inside the transaction. At 150
orders/day a high-frequency ingredient reaches 50k movements in roughly 11 months, and the
cost is linear beyond that (171 ms at 100k). Measured end-to-end against Postgres 16 with
`npm run bench:replay`; see AGENTS.md § Ledger replay cost.

Snapshotting does not introduce a second arithmetic path — it changes the fold's *starting
state*, so `applyMovement` stays the only implementation.

### ✅ RESOLVED — "change the butter purchase price": build the what-if (see log)

PROJECT-SPEC § 1 defines success as: *"Change the butter purchase price. Every item using
butter recosts."* There is no such operation, and by design there cannot be a simple one.

Cost comes from the **weighted average over the stock ledger**. It moves only when a
`purchase` movement is recorded. Nothing edits a price, because editing one would rewrite
history — which is the whole reason for the append-only ledger.

So the demo means one of three different things, and they need different builds:

1. **"Record a delivery at the new price"** — already works. The WAC moves, recipes recost.
   Honest, but it is not what the sentence says and the owner may not accept it.
2. **A what-if price** — the owner types a hypothetical butter price and sees margins move
   *without* writing anything. This is a genuinely useful tool and a different feature:
   costing has to accept an override map rather than always reading `ingredient_stock`.
3. **A "current buying price" field on the ingredient**, separate from the weighted average,
   used for forward-looking costing while WAC stays for historical reporting. Two cost
   numbers with two meanings, and every screen must say which it is showing.

**Resolve before designing the costing engine.** Getting this wrong means either rebuilding
the cost API in week three or shipping a demo that does not do what was promised. My
recommendation is (2): it keeps the ledger sacred, matches the demo's wording, and falls
out naturally if the costing function takes cost lookups as a parameter rather than reaching
for the cache itself.

### Month 2 schema and arithmetic risks — all decided, none built

Recorded before Month 2 starts, so none of these is discovered in week three. Every item
below has been reviewed and approved; the decisions are logged. **None is implemented.**

- ✅ **DECIDED, highest priority — an ingredient with no movements costs zero, silently.** There is no `ingredient_stock`
  row until the first movement, and the list query defaults the missing row to 0. A recipe
  costed against a never-received ingredient would produce a plausible, confidently wrong
  total. Month 2 must treat "no cost data" as an **error**, not as zero. This is exactly the
  failure mode PROJECT-SPEC § 6.1 warns about.
- ✅ **DECIDED — `recipe_lines` needs `tenant_id`,** (deviation 9 in AGENTS.md) even though the spec's data model in § 5 omits it.
  Our convention is every business table carries it with composite FKs; without that a
  recipe line can reference another tenant's ingredient, which is the one failure that
  cannot be cleaned up afterwards.
- ✅ **DECIDED, build now while the fold is pure — no historical cost lookup exists.** `replayLedger()` folds the whole ledger; there is no
  "as at seq N" variant. Month 3's cost snapshot needs one, and Month 2's re-runnable
  recalculation probably does too. Cheap to add now (the fold is already pure), invisible
  until it is urgently needed.
- ✅ **DECIDED, validate at save time — nothing enforces unit compatibility between a sub-recipe's yield and the line that
  consumes it.** A recipe yielding 4.2 kg (weight) consumed as millilitres would be accepted.
  A foreign key cannot express it; it needs save-time validation alongside the cycle and
  depth checks.
- ✅ **DECIDED, scoped as real work with its own tests — cycle and depth rejection.** Postgres cannot express "no
  cycles" declaratively. It needs a recursive CTE at save time, and it needs its own tests.
- ✅ **DECIDED, a separate sign-safe rounder — `divRoundHalfUp` refuses negative numerators by design and stays that way.** The wastage-percent multiplier
  is the first arithmetic that produces a fractional *quantity*, and quantities are signed.
  Month 2 needs a separate sign-safe rounder: round the magnitude, reapply the sign. Do not
  relax the existing guard — it is what keeps costs from being rounded wrongly.
- **Bulk recatalogue recosting meets the replay blocker.** "Recalculation must be re-runnable
  across the whole catalogue" multiplies by the per-ingredient replay cost already recorded
  above. Consider the two together rather than separately.

### Open — aggregator split, resolve before Month 3

Per PROJECT-SPEC § 10.1. If 60–70% of orders arrive via Swiggy/Zomato, those never touch
inventory, stock drifts and the costing becomes decorative. Not yet asked. Must be resolved
before Month 3 planning because it could reshape scope.

### Open — recipe data quality, needed for Month 2

Module 3 assumes accurate grams-per-item. The chef session to weigh the top 15 items by
volume (PROJECT-SPEC § 10.2) has not happened. Month 2 cannot produce the cinnamon-roll
demo without it.

### ✅ RESOLVED — the unexplained test failure (see log, 2026-08-19)

A single test-suite failure was observed in the run immediately after Postgres first became
reachable, and its message was not captured at the time. It recurred during step 7, was
captured in full, and turned out to be a bug in the test rather than in the code. See the
log entry that supersedes this. No security defect.

### Open — Razorpay KYC not started

PROJECT-SPEC § 10.5 says it takes 1–3 weeks and should start in Month 1. Not started.

### Open — `middleware` file convention deprecated in Next 16

Next 16 warns that `middleware` should become `proxy`. Works today; will need renaming
before a future major.

---

## Log

Newest last. Append only.

### 2026-08-19 — Step 1: schema

Eight tables proposed as Drizzle definitions and reviewed line by line before any other
code was written: `tenants`, `users`, `sessions`, `suppliers`, `ingredients`,
`stock_movements`, `ingredient_stock`, `audit_log`. No recipe, menu or order tables — out
of scope for Month 1.

Three deviations from PROJECT-SPEC § 5 were raised and approved, because all three are far
more expensive to retrofit than to decide up front:

- **Per-unit costs stored as millipaise-per-base**, not paise. In whole paise per gram,
  maida is ~4 and a cheap spice ~0.4, which rounds to 0 — the ingredient would contribute
  nothing to any recipe cost, silently, and the error compounds through Month 2
  sub-recipes.
- **`sessions` table added.** Not in the spec's entity list, but session-cookie auth needs
  somewhere to put sessions.
- **`ingredients.base_unit` dropped.** Fixed 1:1 by `unit_type`; a column that can never
  legitimately diverge is a column that can only ever be wrong.

### 2026-08-19 — Step 1 revision: tenant integrity, session hashing, overflow, quantity precision

Four defects found in review of the proposed schema, all fixed before migrations:

- **Composite tenant foreign keys.** Nothing at the database level stopped one tenant's
  `tenant_id` pairing with another tenant's `ingredient_id`. On a codebase built for
  resale, cross-tenant mixing cannot be cleaned up after the fact.
- **Session tokens hashed.** PK is now `sha256(token)`; the raw token exists only in the
  cookie.
- **`bigint` for costs and quantities.** The columns were fine; the intermediates were not.
- **Quantities in milli-base**, matching the cost decision on the other axis. One cinnamon
  roll uses ~0.4 g salt and ~1.5 g yeast; as whole grams those floor to 0 and 2.

Also: `adjustment_reason` renamed to `movement_reason` and split from the event.
`movement_type` says *what happened*, `movement_reason` says *why* — spoilage is one cause
of wastage, not a synonym for it, and the owner will want burnt / dropped / trim / expiry
separable in reporting. The pairing is enforced by check constraint, not by the UI.

### 2026-08-19 — Step 2: migrations, Docker Compose, seed

Migration `0000` generated and checked in, `docker-compose.yml` (Postgres 16 only — there
was no app to containerise yet), seed of 37 ingredients / 3 suppliers / 1 owner.

**A bug was found by reading the generated SQL**: drizzle-kit emits `CREATE UNIQUE INDEX`
*after* the `ADD CONSTRAINT … FOREIGN KEY` block, so every composite tenant FK pointed at
an index that did not exist yet and the migration would have failed on first run. Fixed at
the source by switching the three FK targets to `unique()` constraints, which are emitted
inline in `CREATE TABLE` — hand-patching the SQL would have been undone by the next
`db:generate`.

Seed prices are chosen so every one divides *exactly* into millipaise-per-base, and the
script throws if one ever does not: rounding belongs in one place and the seed is not it.

### 2026-08-19 — Step 3: unit conversion and weighted-average cost

Paper test cases T1–T12 supplied by hand, verified independently against a separate
implementation *before* writing any code — all twelve correct, none mis-derived. The
implementation matched all of them on the first run.

All arithmetic is `BigInt`; there is no float anywhere in the path. `divRoundHalfUp` throws
on a negative numerator rather than rounding it, which is what stops a signed quantity ever
being rounded.

**`stock_movements.seq` (bigserial) added** — not in the spec. The ledger needs a total
order and `created_at` does not provide one: a multi-line receipt inserts several rows with
an identical `now()`, and because the average is rounded at each step, replaying in a
different order can land a millipaise from the incrementally maintained cache. That would
make the T11 invariant *flake* rather than fail, which is worse.

T11 as originally specified was ambiguous — T1–T10 each state their own opening position
and do not chain. Implemented as the invariant it was really testing: one ledger, both
routes, same answer. Approved afterwards.

### 2026-08-19 — Step 4: auth and role enforcement

Sessions (`sha256` of the cookie token, 12-hour TTL, expiry enforced *and* the row deleted
on lookup), argon2 password hashing, and role enforcement.

**The enforcement point is `requirePermission()` at the top of each page and inside each
mutation — not middleware.** Middleware only checks that a cookie is present and redirects;
it does not validate it, it cannot see a server action invoked directly, and Next
middleware has been bypassable before. A hidden button and an edge redirect are the same
class of non-control.

Two guards added beyond the spec, both approved:

- **Only an owner may grant the `owner` role.** Otherwise a manager promotes a second
  account and inherits everything — `users.manage` becomes owner with one extra step.
- **Deactivating a user deletes their live sessions.** Without it, deactivation is advisory
  for up to 12 hours.

### 2026-08-19 — Step 5: ingredient CRUD

List with search / include-inactive / low-stock indicator, create, edit, deactivate. Audit
log on every mutation.

Everything numeric goes through the shared helpers; `costPerPurchaseUnitPaise()` and
`milliBaseToPurchaseUnits()` were added rather than doing the conversions inline in a
component, because an ad-hoc conversion in a component is a second rounding site and the
two will disagree.

**Deactivation keeps the name.** The unique index covers all non-deleted rows, active or
not. Freeing the name would let two ingredients called "Butter" exist with two separate
stock ledgers, which is a worse outcome than the inconvenience.

### 2026-08-19 — Step 6: stock receipts, adjustments, wastage (commit `a19e5d2`)

Multi-line receipts sharing one `reference_id` in a single transaction, adjustments, and
wastage — all writing through `recordMovements()`, which is the only path that inserts into
`stock_movements`.

Two judgment calls, both approved: **audit is one entry per operation, not per line** (the
ledger already records who and when per row, so per-line entries add volume without
information), and **sign comes from an explicit Remove/Add choice** rather than a typed
minus sign, which counter staff under pressure will forget half the time.

**Defect found by running the suite against live Postgres for the first time**: Drizzle
wraps driver failures in `DrizzleQueryError` and hangs the postgres.js error off `.cause`,
so the `23505` check never matched and a raw constraint violation reached a form field.
`src/db/errors.ts` now walks the cause chain and matches on constraint name as well as
code, so an unrelated future violation is not mislabelled. `users.ts` had the same exposure
on its email index and now translates too.

`SEED_OWNER_PASSWORD` is now required unless `NODE_ENV=development`; the seed refuses to
run rather than creating an all-permissions owner account with a password published in this
repository.

**Two process failures worth recording.** A scripted edit left two NUL bytes in
`src/db/stock.ts`; a later search-and-replace against that file then silently matched
nothing, so an audit-log insert was never added — while `tsc` passed, because the import and
helper had landed. The test caught it. A silent no-op that type-checks is the worst failure
mode this project has hit.

### 2026-08-19 — Replay cost measured end-to-end; snapshotting raised to a blocker

`npm run bench:replay` against live Postgres 16: 18 ms at 10k movements, **87 ms at 50k**,
171 ms at 100k — roughly 43× the in-memory fold alone, which was 2.0 ms at 50k. The
in-memory figure was a floor and a misleading one to plan against.

Recorded as a blocker on Module 4 above. See AGENTS.md § Ledger replay cost.

### 2026-08-19 — Guard added for the NUL-byte failure mode

`src/lib/source-integrity.test.ts` fails if any file under `src/`, `app/` or `scripts/`
contains a NUL byte. Proven by planting a corrupted file, confirming the test fails, then
removing it and confirming it passes — a guard nobody has seen fail is not yet a guard.

The file builds its own NUL at runtime with `String.fromCharCode(0)` rather than embedding
one, so it passes its own test. The first draft did embed one and failed on itself.

### 2026-08-19 — Step 7: movement history and low-stock views

Read-only history filterable by ingredient and date range, ordered by `seq`, paginated at
50 rows; low-stock view sorted by severity. `src/db/history.ts` contains no update or
delete and never should — a correction is a new movement.

Three defects found and fixed during the step, all in code I had just written:

- **The running balance restarted inside a date filter.** The obvious implementation
  computes the window over the rows surviving the `WHERE`, so filtering to last week
  produced a number that reads like a stock level but is a subtotal of the window. The
  window now runs over the ingredient's whole ledger with the date filter applied in the
  enclosing query. This is the load-bearing test in `history.db.test.ts`.
- **`sum()` over a bigint returns `numeric`, which postgres.js hands back as a string.**
  The field was typed `number`, so every comparison at every call site would have been
  lexicographic. Normalised once, in the query layer.
- **Duplicate `name` output columns** from three joined tables made the enclosing subquery
  ambiguous. The joined name columns are now aliased.

Design decisions: a running balance is computed **only** when one ingredient is selected,
because summing grams of salt with millilitres of milk is meaningless — the column is
hidden otherwise, and skipping the window there also avoids scanning the whole tenant
ledger. Low-stock severity is the shortfall as a *share* of the threshold, not the raw
gap: 2 kg short of a 3 kg threshold is more urgent than 2 kg short of a 50 kg one, and
sorting by absolute gap would bury the first behind the second. Ingredients with no
threshold set appear only once actually oversold, so the list stays worth reading.

### 2026-08-19 — Intermittent test failure explained and fixed (supersedes the open item above)

The failure recorded earlier as unexplained recurred, was captured in full, and turned out
to be **a bug in the test, not in the code**.

`a tampered token resolves to nobody` built one of its forged tokens as
`'A' + token.slice(1)`. When a token already starts with `A`, that reconstructs the token
exactly, so a *genuine* session correctly resolved and the assertion failed. Session tokens
are base64url, so the odds are 1 in 64 — measured at 1.53% over 100,000 samples, which
matches the observed rate.

The tamper now flips the first character to one it demonstrably is not. 30 consecutive
clean full-suite runs since. **No security defect: session lookup was behaving correctly
throughout.**

### 2026-08-19 — Numeric-as-string swept across the codebase

Every SQL aggregate and raw expression in non-test code was enumerated. There are exactly
two, both in `src/db/history.ts`:

- the running-balance `sum()` window — **selected**, so it crosses the driver boundary, and
  it is normalised with `Number()` in the query layer;
- the low-stock severity expression — used **only in `ORDER BY`**, never selected, so it
  never crosses the boundary and Postgres compares it in `numeric`, which is correct.

No other aggregate exists yet. Nothing else needed fixing.

Added a test asserting the runtime `typeof` of every numeric field the query layer returns,
verified by deleting the `Number()` conversion and confirming it fails with
`listMovements.balanceMilliBase is a string ("4800000")`. Recorded in AGENTS.md § Aggregates
come back as strings, because the costing engine is aggregation over recipe lines and is
precisely where this produces a margin figure nobody questions.

### 2026-08-19 — Month 1 closed

85 tests passing against live Postgres, none skipped. `next build` exits 0. Steps 1–7 done.

Month 2 risks recorded below under open questions. The largest is not a defect but a
design tension in the spec's own success demo — see "changing a purchase price".

### 2026-08-19 — Success-demo contradiction resolved: build the what-if (supersedes the Month 2 blocker above)

Decision taken. The sentence in PROJECT-SPEC § 1 — *"change the butter purchase price and
every item recosts"* — was written as a sales demo, not a specification. Weighted average
cost over an append-only ledger is correct and does not bend to it.

**Option 2 chosen: the what-if price.** The costing function takes its cost lookups as a
parameter and never reaches into `ingredient_stock` itself. The demo becomes a lookup with
butter overridden: margins move on screen, nothing is written, the ledger stays sacred.

The same seam serves two other things that would otherwise each need their own mechanism —
historical "as at seq N" costing for Month 3's order-line snapshots, and re-runnable
catalogue recalculation. Recorded in AGENTS.md § Costing takes its cost lookups as a
parameter, with an explicit warning against later "simplifying" it by having the costing
function fetch its own costs. That change would look like a tidy-up and would silently
remove all three capabilities.

### 2026-08-19 — Zero-cost ingredients: missing cost must throw

Raised to the highest-priority item of the Month 2 risk list and settled before any costing
code exists.

An ingredient with no purchase history has an **unknown** cost, not a zero one. A recipe
costed against it would otherwise produce a total that is confident, plausible and wrong,
which is the failure mode that destroys trust in every other figure the system shows.

The cost lookup throws rather than returning zero or null. It must be impossible to view or
save a recipe cost where any input lacks a cost basis, transitively through sub-recipes.
The failure is surfaced by name — "3 ingredients have no purchase history: cardamom powder,
vanilla essence, butter paper sheet" — because an operator can act on a list of names and
cannot act on a wrong total they have no reason to doubt.

A genuinely zero cost (a free sample, a write-off) is recorded as a `purchase` movement with
`total_cost_paise = 0`. That has a cost basis. Never having been received does not.

Recorded in AGENTS.md § Missing cost data is an error, never zero.

### 2026-08-19 — Deploy pipeline scheduled as Month 2 step 0

The deploy pipeline slipped out of Month 1 and was sitting unscheduled. It is now the
**first** task of Month 2, ahead of the costing engine: Dockerfile, app service in
`docker-compose.yml`, CI image build, and a deploy to a real VPS.

The reasoning is that the first deploy always surfaces something, and that surprise belongs
in Month 2 week one rather than week two of Month 5. The image must be built in CI and
shipped — `next build` on a 4 GB VPS will OOM (PROJECT-SPEC § 3).

### 2026-08-19 — Month 2 gated on two external confirmations

Month 2 does not start until the owner has exercised the multi-line receipt form by hand
and reported findings, and the deploy target is provisioned. The UI is the part nothing has
exercised and is where the undiscovered defects are.
