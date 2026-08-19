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
