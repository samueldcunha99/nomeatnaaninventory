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

**Month 1 is COMPLETE and VERIFIED — 92 tests passing against live Postgres, 0 skipped.**
| — | UI styling pass (post-Month-1) | ✅ all 9 screens, Tailwind v4 |

### Month 2 — deploy pipeline, then the costing engine

| Step | What | Status |
|---|---|---|
| 0 | Render native Node.js + Supabase config (supersedes Docker) | 🟡 Prepared locally; live service not verified |
| 0b | Live managed deployment | ⏸️ Pending client-owned Render/Supabase setup, does not block development |
| 1 | Recipes, recipe_lines and menu_items schema (with tenant_id) | ✅ |
| 2 | Cost lookup seam + missing-cost errors | ✅ |
| 3 | Sub-recipes: yield, cycle and depth rejection, unit compatibility | ✅ reachable through `saveRecipe` |
| 4 | Wastage multiplier + sign-safe quantity rounder | ✅ multiplier done; the rounder is Month 3's, see the superseded risk item |
| 5 | Cost breakdown and margin views, and the three editors | ✅ |

**Gate (revised 2026-08-21): the owner exercises the multi-line receipt form by hand.
Provisioning is no longer a gate.** Steps 1-5 run locally against our own Postgres exactly
as Month 1 did. See the log entry for 2026-08-21.

### Later months

| Module | What | Status |
|---|---|---|
| 3 | Recipes, sub-recipes, costing engine (Month 2) | ✅ |
| 4 | Orders, atomic depletion, cost snapshots (Month 3) | ⬜ |
| 4a | **Production logging** — what the kitchen made and used, dough held as stock | 🟡 steps 1–2 of 4 — schema and the data layer; no screen yet |
| 5 | Kitchen status board (Month 3) | ⬜ |
| 6 | Customer order tracking (Month 4) | ⬜ |
| 7 | Online ordering + Razorpay (Month 4) | ⬜ |
| 8 | Owner analytics dashboard (Month 5) | ⬜ |
| 9 | AI customer assistant (Month 5) | ⬜ |

---

## Open questions and blockers

### ✅ DONE — UI styling pass, all 9 internal screens (see log)

Tailwind v4 adopted (CSS-first, theme in `@theme` in `app/globals.css`). All nine internal
screens styled: login, home, ingredients list, new ingredient, edit ingredient, stock receipt,
adjustment/wastage, movement history, low stock.

Zero inline styles remain anywhere in `app/`. Design system conventions: 56px table rows,
44px tap targets, two-tone focus ring, tabular numbers on all numeric data, exception-only
status badges, and responsive folding for tablet viewports. All six polish fixes applied and
verified. 87 tests passing, `next build` exits 0.

### Open — awaiting the client, not the code

One confirmation is outstanding. It no longer holds up the schema work:

1. The owner exercises the **multi-line receipt form by hand** and reports findings. The UI
   is the part nothing has exercised and is where undiscovered defects are.

~~2. The deploy target is provisioned.~~ **Dropped as a gate on 2026-08-21** — the client
account is a week or two out, and blocking a month of work on it is the wrong trade.

### 📌 DECIDED — deployment target (blocks nothing, but read before Month 2 step 0)

**VPS: E2E Networks, Mumbai region.** Not DigitalOcean Bangalore, not AWS Lightsail.

- E2E bills in **INR with a GST invoice**, which the client needs. Foreign providers
  billing in USD without GST create an accounting problem for the client, not for us.
- **Mumbai is closer to Aurangabad than Bangalore** — lower latency for the counter PC
  and kitchen tablet, which are on the cafe’s broadband all day.

**The account is created by the client, in the client’s name, on the client’s payment
method.** The developer receives access; the developer is **not** the account holder.

This is a **contractual requirement, not a preference** — PROJECT-SPEC § 13 puts all
third-party accounts in the client’s name on the client’s card. **No future agent should
propose provisioning under the developer’s own account**, however convenient it looks at
the time. A server the client cannot pay for or log into directly is a server they cannot
keep when the warranty ends.

| Setting | Value |
|---|---|
| Provider / region | E2E Networks, Mumbai |
| OS | Ubuntu 24.04 LTS |
| Size | 2 vCPU, 4 GB RAM |
| Auth | **SSH key only — root password login disabled** |
| Account holder | The client |

4 GB is why the image is built in CI and shipped: `next build` on the VPS will OOM
(PROJECT-SPEC § 3).

**Nothing is provisioned.** The deploy step stays stubbed until the client creates the
account; as of 2026-08-21 that is a deferred step, not a gate on the rest of Month 2. A
production compose file now exists (`deploy/docker-compose.prod.yml`) and has never been
run against a server.
### ✅ CLEARED 2026-09-09 — snapshotting landed; this blocker is discharged

Kept below for the reasoning, which is still the reasoning. `ingredient_stock.snapshot_seq`
now records how far the cached row has been folded, so a movement folds only what arrived
since: **flat ~7 ms whatever the ledger size**, against 95 ms at 50k rows and 161 ms at
100k for a full rebuild. An order touching five ingredients adds ~35 ms, not ~0.4 s. See
the log entry for 2026-09-09.

### 🚫 (superseded) BLOCKER on Module 4 — snapshotting must land before order confirmation goes live

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
- ✅ **SUPERSEDED 2026-08-21 — costing needs no sign-safe rounder, because it never
  materialises a wastage-adjusted quantity.** The original entry read: Month 2 needs a
  separate sign-safe rounder, round the magnitude and reapply the sign, because the
  wastage multiplier is the first arithmetic producing a fractional quantity.

  What was built is stronger. The wastage factor stays inside the numerator as
  `(100000 + w)`, so the adjusted quantity is never a number in the code — P8's 2224.8 g
  does not exist as a value anywhere. **There is nothing to round, which beats rounding it
  carefully.**

  **The Month 3 half of the entry still stands.** Consumption movements put real signed
  quantities in the ledger, and `divRoundHalfUp` refuses negative numerators by design and
  stays that way. Month 3 needs the sign-safe rounder — round the magnitude, reapply the
  sign — and must not relax the existing guard, which is what keeps costs from being
  rounded wrongly.
- **Bulk recatalogue recosting meets the replay blocker.** "Recalculation must be re-runnable
  across the whole catalogue" multiplies by the per-ingredient replay cost already recorded
  above. Consider the two together rather than separately.

### Open — aggregator split, resolve before Month 3

Per PROJECT-SPEC § 10.1. If 60–70% of orders arrive via Swiggy/Zomato, those never touch
inventory, stock drifts and the costing becomes decorative. Not yet asked. Must be resolved
before Month 3 planning because it could reshape scope.

### Open — resale items with no recipe, ASKED 2026-08-21, needed before step 2

`menu_items.recipe_id` is `NOT NULL`. A cafe almost certainly sells bottled water, canned
drinks and packaged snacks that have no recipe at all — they are bought and resold.

**The answer decides whether costing needs a second branch.** With every menu item backed
by a recipe, cost is one path: recipe -> lines -> ingredients. Allow recipe-less items and
their cost has to come from somewhere else (the ingredient weighted average directly, most
likely), which is a second code path through every margin view and every Month 3 order
snapshot.

**Nothing is built for it speculatively.** The column stays `NOT NULL` until the client
answers. Note that `menu_items` deliberately keeps its direct FK to `tenants` — which
deviation 6 drops elsewhere — precisely because a composite FK is MATCH SIMPLE and stops
being enforced the moment `recipe_id` is allowed to be null.

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

### 2026-08-19 — UI styling pass started; tokens and two reference screens

Brand book supplied. Internal screens are **brand-adjacent, not brand-faithful**: counter and
kitchen staff, cheap tablets, glare, a rush. Legibility and tap-target size beat aesthetics.

Design tokens live in `app/globals.css` and nowhere else — every hex literal in the codebase
is inside that one `:root` block. Poppins self-hosted via `next/font` (9 local `.woff2`,
zero runtime references to fonts.gstatic.com), because this runs on a VPS in India and text
must not wait on an external CDN.

**Two state colours added, because the brand palette cannot supply them.** The book is
entirely cool blues and greens; nothing in it can say "LOW STOCK" or "receipt refused".
Chosen with measured contrast rather than by eye:

- `--danger: #8c2f39` claret, 7.28:1 on bone. Hue 354° leans blue-red rather than
  orange-red, keeping the palette's cool temperature; lightness 37% sits between navy (27%)
  and fern (44%), so it reads grave rather than borrowed from another design system.
- `--warn: #96591a` burnt amber, 5.02:1. The only amber tested that clears 4.5:1 as text —
  ochre `#a8641b` gives 4.17:1 and fails.

**Two findings that constrain the palette:**

- **`--fern` cannot carry text.** 3.63:1 on bone, below the floor. It is a fill; text needs
  `--fern-ink` (5.53:1). Same for `--sky` and `--sage`.
- **The focus ring cannot be one colour.** Bone and navy are 8.98:1 apart, so nothing is
  simultaneously 3:1 from both. It is two-tone — coloured outline with a white band filling
  the outline offset — so it reads on a navy button and on the bone page alike.

Verified by measuring the live DOM rather than by eye (the browser pane would not
composite, so no screenshot): no horizontal overflow at 768px, and every real control
exactly 44px. The four 0px inputs an audit finds are React's `$ACTION_REF` hidden fields,
not controls.

Copperplate is **used nowhere** and flagged in AGENTS.md: it ships with macOS and Adobe but
web embedding is a separate licence, unverified, and it is an all-caps display face with no
lowercase. Poppins is not in the brand book either — a deliberate legibility substitution,
recorded so it is not mistaken for an oversight.

Home page was restyled after feedback that it was still raw: brandbar with sign-out, and nav
**cards** at 80px minimum rather than a row of text links 12px apart, because during a rush
it is tapped by someone holding a tray.

Not visually confirmed: the home page needs a session, and entering a password into a form
was declined. The client has a live session and can eyeball it.

### 2026-08-19 — Handover: documentation brought up to date for another agent

README rewritten as the entry point — reading order, current state, setup, and the fact that
40 of 86 tests skip loudly without Postgres. AGENTS.md gained a "read these five first"
header naming the sections that each record a real defect, plus the styling-pass status and
class vocabulary. This file gained the styling blocker and the client-side gates.

No code changed in this update.

### 2026-08-19 — Tailwind v4 adopted; table vocabulary designed

**Tailwind question resolved: install it.** Now was the cheap moment — two screens
converted rather than nine reworked later. It is also in the spec, matches the rest of the
client's work, and Month 4's customer-facing screens have real design work where
hand-rolled CSS starts costing.

**Tailwind v4, CSS-first.** There is no `tailwind.config.js`: the theme *is* the `@theme`
block in `app/globals.css`. Every token is a real custom property **and** generates
utilities, so `--color-navy` gives `bg-navy` / `text-navy` / `border-navy` from one
definition — rather than a hex in a config drifting apart from a variable in a stylesheet.
No plugins, no component library, no icon pack.

**The table vocabulary was designed against the ingredients list**, deliberately — it is the
hardest of the six table screens, carrying search, an include-inactive filter, a status
column, a LOW badge and a row action. Everything else follows from it. Four rules, each
measured at 700px and 810px rather than eyeballed:

- 56px rows, sized for a fingertip; row actions hold the 44px floor inside them.
- Numeric columns right-aligned **and** `tabular-nums` — right alignment alone still lets
  proportional digits jitter, which makes a column harder to scan down.
- Badges carry a glyph and a word, never colour alone. Contrast 4.84:1 to 7.12:1.
- Secondary columns fold below `md` instead of forcing a horizontal scroll. At 700px the
  ingredients table drops to five columns and still does not scroll sideways.

**Palette constraints recorded** so nobody "fixes" them later: `--color-fern` (3.63:1),
`--color-sage` (1.51:1) and `--color-sky` (1.94:1) are **fills only and may never be text**.
Green text uses `--color-fern-ink` (5.53:1). The "in stock" badge is the pattern — fern as a
hairline border and fill, fern-ink as the text.

**Focus ring:** 3px `--color-focus` (#b3541e burnt orange) at 2px offset, with a 2px white
band filling the gap. Bone and navy are 8.98:1 apart, so a single-colour ring 3:1 from both
is arithmetically impossible — the two-tone ring reads on any surface in the palette.
Burnt orange deliberately sits outside the brand palette: focus must not be mistakable for
a status or an accent.

All three requested UI fixes done: ingredients unit mismatch, receipt text overflow, and
table behaviour on a narrow tablet.

Six screens remain: ingredients new/edit/form, receipt form, adjust, history, low stock.
They are now a mechanical pass against the vocabulary above.

No logic changed. `src/db` and `src/lib` untouched. 86 tests, `next build` exits 0.

### 2026-08-19 — Styling pass complete: all 9 internal screens

Four cosmetic corrections to the ingredients list first, then the vocabulary applied
across the remaining six screens.

**One was a real bug I had introduced.** `.table th` styled *both* the header row and
`<th scope="row">` in the body, so every ingredient name rendered in caps, small, and in
muted grey. Header styling is now scoped to `.table thead th`, and row headers get their
own rule: sentence case, full size, ink. Caps belong on headers and badges only — they
measurably slow reading, and that is the column staff scan most.

The other three: the Deactivate button became a quiet navy text link (it was the rarest
action on the screen and visually the heaviest thing in every row), the `Bought by` column
moved to the edit page where it is actually set, and badges now show **exceptions only** —
`StatusBadge` renders nothing for a normal row, so Low and Oversold are visible at a glance
down the list rather than lost among "In stock" on every line.

**The whole row is now the click target for edit**, via a stretched-link pseudo-element,
with the row action lifted above it on `z-index`. Verified by hit-testing: a point at 55%
across the row resolves to the name link, and a point on the action button resolves to the
button. The accessible name stays on the real anchor, so a screen reader announces the
ingredient rather than "row".

Measured, not eyeballed — at 700px, 810px and 1024px: 56px rows throughout, every control
at or above the 44px floor (9 controls on the receipt form, none below), secondary columns
folding below `md`, and no horizontal scroll on any screen at any width tested.

**Tailwind v4 adopted** (CSS-first, no `tailwind.config.js` — the theme is the `@theme`
block). One trap worth knowing: a running Next dev server does **not** pick up a newly
added `postcss.config.mjs`. It served unstyled Times New Roman until restarted, which will
happen to anyone pulling this mid-branch.

No logic changed. `src/db` and `src/lib` untouched. 86 tests, `next build` exits 0.

### 2026-08-19 — Styling polish: table widths, unit consistency, entry ordering, and filter UX

Six final polish fixes applied across the styled screens:

- **Ingredients list STATUS column tightened & Deactivate link repositioned**: Added `w-28` to
  the status column and action column so the Deactivate text link sits close to data rather than
  floating far right.
- **"Include inactive" checkbox auto-applies on change**: Created `app/ui/auto-submit-checkbox.tsx`
  (`'use client'`) so toggling immediately triggers form submission via `requestSubmit()`,
  removing the need to click "Apply" just for the checkbox.
- **Movement history quantity & balance units**: Updated `app/stock/history/page.tsx` so
  quantity and running balance lead with purchase units (`+25 kg`) and keep base units
  subordinate (`+25000 g`), using `milliBaseToPurchaseUnits()`, matching the ingredients table.
  `purchaseUnit` added to `MOVEMENT_COLUMNS` and `MovementRow`.
- **Receipt group line entry order**: Newest-first (`desc(seq)`) is preserved for the ledger
  overall, but lines within a single multi-line receipt (`shared referenceId`) are sorted in
  ascending entry order (`seq ASC`) via `orderGroupLines()`.
- **Receipt form column tightness**: Added `max-w-3xl` container constraint to the receipt table
  so the "Works out at" unit cost preview sits directly adjacent to the line inputs rather than
  nearly a full screen width away.
- **Receipt form quantity unit label**: Added explicit purchase unit label next to the quantity
  input once an ingredient is selected (`kg`, `pack of 50`, `tray`), preventing operator entry errors.
- **Data check verified**: Confirmed that identical figures for Dark chocolate (54%) and
  Active dry yeast (₹185.17 / kg from 12 kg @ ₹2,222.00) in history were manual test entries,
  verifying that `recordReceiptAction` and `recordMovements` process each line independently with
  no cross-line value duplication.

87 tests passing against live Postgres, none skipped. `next build` exits 0.

### 2026-08-19 — Deployment target decided; git binary-diff fixed; styling fixes verified

**Deployment target: E2E Networks, Mumbai, Ubuntu 24.04 LTS, 2 vCPU / 4 GB, SSH keys only,
account in the client’s name.** Recorded in full under open questions above. Nothing
provisioned; Month 2 step 0 remains gated on the client creating the account.

**Git was treating `src/db/stock.ts` as binary.** Residue from the NUL-byte incident: the
initial-commit blob genuinely contains 2 NUL bytes, and git calls a path binary if *any*
blob in the comparison does — so the file holding the weighted-average arithmetic showed
"Bin 3728 -> 5294 bytes" instead of a reviewable diff. Added `.gitattributes`.

Worth knowing for next time: `text eol=lf` alone did **not** fix it. `text` governs
checkin/checkout normalisation; the attribute that forces a *text diff* is bare `diff`.
The file now renders 51 insertions / 7 deletions, and no path anywhere in history is
treated as binary.

**Independent verification of the six styling fixes** rather than accepting the report.
Four claims held exactly: no inline styles anywhere in `app/`, all 19 hex literals inside
the `@theme` block and none in a component, movement-history quantities going through
`milliBaseToPurchaseUnits()` and `formatQty()` with no ad-hoc conversion, and
`AutoSubmitCheckbox` being a genuine client component whose no-JS path still works (the
checkbox is a real form control and the Apply button remains).

Two defects found that the report did not mention:

1. **The receipt-group ordering broke pagination.** `orderGroupLines()` was applied to the
   fetched rows *before* slicing to the page. Because the query fetches `PAGE + 1` rows,
   reordering permuted across the page boundary: with a receipt straddling it, one line
   appeared on **both** pages and another **disappeared from the ledger view entirely**.
   Proved with a worked example before changing anything, then fixed by slicing first and
   reordering only what is on the page — page membership stays decided by the query’s seq
   order, which is what `OFFSET` agrees with. On an append-only audit trail a movement
   you cannot see is the worst class of wrong. Guarded by 5 pure tests in
   `src/db/history.test.ts`, verified by reverting the fix and watching them fail.

2. **A UTF-8 BOM at the start of `app/ui/auto-submit-checkbox.tsx`**, immediately before
   the `'use client'` directive. Removed. The existing source-integrity guard only checks
   for NUL bytes, so it did not catch this.

**PROGRESS.md append-only integrity confirmed.** All 22 dated log entries present, none
dropped, none rewritten — checked by extracting every entry from every historical version
and comparing bodies. A first pass appeared to show 22 rewritten entries; that was my
check counting CRLF conversion as a change, not a real edit.

92 tests, 0 failures. `next build` exits 0.

### 2026-08-19 — Handover session: origin/main reconciled, pagination bug fixed, guards extended

#### origin/main was nine commits stale

Reported to me as "trunk at 22775cd with full history". It was not. PR #1 had merged only
up to `a19e5d2` (Month 1 step 6), and the PR merge commit's tree was byte-identical to it.
Remote main was missing step 7, the numeric-as-string sweep, the Month 2 decisions, the
handover docs, Tailwind adoption and the entire styling pass — 4,206 lines.

Anyone branching from `main` for Month 2 would have started from step 6.

Reconciled by merging `origin/main` into local main, which changed **no files** because the
PR merge introduced no content — it only joined the histories. Nothing rewritten, nothing
force-pushed. `main` is now the only branch; `month1-step6-stock-movements` was verified
fully merged and deleted.

**The lesson, not the incident:** when an instruction does not match what the repository
shows, check before acting. This was found by running `git merge-base --is-ancestor` rather
than accepting the description.

#### `src/db/stock.ts` was diffing as binary

Residue from the NUL-byte incident: the initial-commit blob genuinely contains 2 NUL bytes,
and git calls a path binary if **any** blob in the comparison does. So the file holding the
weighted-average arithmetic rendered as `Bin 3728 -> 5294 bytes` — no reviewable diff on the
costing code, which is a review problem rather than a cosmetic one.

**`text eol=lf` alone does NOT fix this, and that cost a round trip.** `text` governs
checkin/checkout normalisation only. The attribute that forces a *text diff* is bare `diff`.
A first attempt also used `diff=typescript`, which is not a driver git has.

`.gitattributes` now sets `text eol=lf diff` on source. The file renders 51 insertions / 7
deletions, and no path anywhere in history is treated as binary. The working tree was
renormalised to LF at the same time (34 files), which is what the new CRLF guard demands.

#### ⚠️ Receipt-group ordering broke pagination — DO NOT REVERT THIS

**A future agent will be tempted to reorder before slicing again. It is wrong, and here is
why.**

`listMovements()` fetches `HISTORY_PAGE_SIZE + 1` rows — the extra row exists only to detect
`hasNextPage`. `orderGroupLines()` was being applied to that fetched set **before** slicing to
the page. Because reordering permutes rows across the page boundary, a receipt group
straddling the boundary caused one line to appear on **both** pages and another to
**disappear from the ledger view entirely**:

```
buggy   page1=[10,9,8,6]  page2=[5,6,4,3]   -> 6 duplicated, 7 never shown
fixed   page1=[10,9,8,7]  page2=[5,6,4,3]   -> every row exactly once
```

**The fix is to slice to the page first, then reorder only what is on it.** Page membership
must stay decided by the query's `seq` ordering, because that is what `OFFSET` agrees with.
Reordering is a *display* concern and must not influence which rows a page contains.

On an append-only audit trail, a movement you cannot see is the worst class of wrong — the
ledger is the thing the whole system is trusted for.

Guarded by 5 pure tests in `src/db/history.test.ts`, including the straddling case. Verified
by reverting the fix and confirming they fail. The pre-existing database test could not have
caught this: it paginates a single ingredient with no multi-line groups.

Method worth repeating: the defect was **proved with a worked example before any code was
changed**. A first attempt at that example put the group inside one page and showed no
problem — the boundary case had to be constructed deliberately.

#### A UTF-8 BOM, and the guard extended

A BOM sat immediately before `'use client'` in `app/ui/auto-submit-checkbox.tsx`. A BOM ahead
of a directive prologue can stop the directive being recognised, silently turning a client
component into a server one. `tsc` said nothing.

`src/lib/source-integrity.test.ts` now fails on **NULs, BOMs, zero-width and non-breaking
characters, and CRLF** where LF is required — the whole invisible-but-breaking class. All
four checks were verified by planting each defect in turn and watching the guard go red.

#### Independent verification of the previous session

The six styling fixes were checked against the repository rather than accepted on report.
Four claims held exactly: no inline styles anywhere in `app/`, all 19 hex literals inside
the `@theme` block, movement-history quantities going through the shared helpers with no
ad-hoc conversion, and `AutoSubmitCheckbox` being a genuine client component whose no-JS
path still works. The pagination bug and the BOM above were the two that did not.

**PROGRESS.md append-only integrity confirmed** — all 22 prior entries present, none dropped
or rewritten, checked by extracting every entry from every historical version and comparing
bodies. A first pass appeared to show 22 rewritten entries; that was my check counting CRLF
conversion as a change, not a real edit. Nothing needed restoring.

#### Handover documentation

README.md now opens with a HANDOVER section for a successor with no memory of this work:
where the project stands, what is verified against a live database versus merely built, what
is gated and on what, the working rules, the failure mode to fear, and the eight Month 2
decisions already made. AGENTS.md gained the seven non-negotiables as an explicit list.

92 tests, 0 failures, 0 skipped against live Postgres. `next build` exits 0.

### 2026-08-19 — Month 2 step 0: containerisation and CI (deploy stubbed)

Everything except the deploy itself, which needs a server that does not exist yet.

**`Dockerfile` — two targets, one source tree.** `runtime` is the app: multi-stage,
standalone output, non-root (`node`, uid 1000), no dev dependencies, no source. `migrate`
is a one-shot that applies migrations and exits. Separate on purpose — **the app container
cannot alter the schema**, and the runtime image does not carry a migration runner it never
invokes. `libc6-compat` is installed because @node-rs/argon2 ships a prebuilt binary
expecting glibc symbols.

**Compose** now runs Postgres, migrations, the app and Caddy. Migrations gate the app via
`service_completed_successfully`, so a container can never serve traffic against a schema
older than its own code. From a clean checkout with no volumes: **one command, ~16 seconds,
all services healthy.** Verified end to end — 8 tables created, both migrations recorded,
seed applied, CSS and self-hosted fonts served through Caddy with no CDN reference, and the
full suite of 103 tests passing against that database.

**CI** (`.github/workflows/ci.yml`) runs typecheck, migrations and tests against a real
Postgres service container, then builds, then pushes both images to GHCR on merge to main.
It includes a check that **fails the run if any database test skipped** — the suite skips
loudly rather than failing when Postgres is absent, so without that check CI could silently
degrade to unit-tests-only and still look green.

#### Two problems found by building rather than assuming

1. **The env check broke `next build`.** Asserting configuration at module load in
   `src/db/client.ts` meant page-data collection failed on a build machine with no
   database credentials — which it should not need. Resolved by giving the build stage a
   clearly-labelled placeholder DATABASE_URL (it never reaches the runtime stage, a
   separate `FROM`) and moving the real check to `instrumentation.ts`, which runs once at
   server start.

2. **The app container hung instead of exiting when misconfigured.** Throwing from
   `instrumentation.ts` surfaces as an unhandledRejection, which Next 16 logs but does not
   die on: the container stayed alive, never served a request, and never restarted — the
   exact half-configured boot the check exists to prevent. Found by running the image with
   `DATABASE_URL` unset and watching it hang for two minutes. Now `process.exit(1)` after
   printing the report; verified it exits 1 with a clean message.

**The env check** (`src/lib/env.ts`) names every missing variable at once rather than one
per restart, and rejects a `localhost` database URL in production because inside a
container that is the container itself. 7 unit tests, and both failure modes demonstrated
against the real images.

**Deploy is written and stubbed.** The job in `ci.yml` is commented out with the four
secrets it needs named; `deploy/README.md` carries the target, the hardening steps, and the
two ways the production compose file differs (pulls a published image; SITE_ADDRESS is a
real hostname so Caddy provisions TLS). **Nothing is provisioned.** The E2E Networks account
must be created by the client, in the client's name — contractual, not a preference.

103 tests, 0 failures, 0 skipped. `next build` exits 0. Stack verified from clean.

### 2026-08-21 — Provisioning dropped as a Month 2 gate; demo box built but unprovisioned

**The gate is gone, the requirement is not.** Month 2 steps 1–5 no longer wait on a server.
The client's E2E Networks account is a week or two out and blocking a month of schema and
costing work on it is the wrong trade. Everything runs locally against our own Postgres,
exactly as Month 1 did. The deploy job in `ci.yml` stays commented out with its four
secrets named, and PROJECT-SPEC § 13 is untouched: the production account is still created
by the client, in the client's name, on the client's card.

**Demo box: built, not provisioned.** `deploy/docker-compose.prod.yml` now exists — it
pulls published images rather than building, publishes no Postgres port, and refuses to
start unless every secret is set and `IMAGE_TAG` is a pinned `sha-` tag. CI publishes both
images for `linux/amd64` and `linux/arm64` so a free ARM host is an option later.
`deploy/README.md` carries a free-tier path (Oracle Always Free, Mumbai/Hyderabad).

**None of it has ever run against a server, and no free-tier account was created.** For
demos we use a Cloudflare Tunnel against localhost: no account, nothing persistent, and no
implication that a demo URL is a deployment.

**The rule that outlives this entry: real cafe data never goes on the demo box.** It has no
backups and no tested restore, so PROJECT-SPEC § 10.5 is deliberately unmet there. A host
whose restore has never been exercised holds nothing anyone would miss.

**One styling regression fixed.** The login page's "Staff access only." note carried a
`-mt-2` from the styling pass — an 8px negative margin that pulled it into the descenders
of the "Sign in" heading. `h1` has no bottom margin under Tailwind's preflight, so there
was nothing to pull back. Removed; the note now sits flush like the other eight screens
that never had the override. Measured before and after in the browser: gap −8px → 0px.

### 2026-08-21 — Month 2 step 1: recipes, recipe_lines, menu_items (schema only)

Reviewed line by line before anything was written, and written exactly as reviewed bar the
two rulings below. **No costing arithmetic exists** — the paper test cases for sub-recipe
costing come first.

**Three tables.** `recipes` carries the yield (quantity + unit type), so a dough batch
yielding 4.2 kg can be drawn on 180 g at a time. `recipe_lines` references **exactly one**
of an ingredient or a sub-recipe, enforced as an XOR check constraint rather than in
application code. `menu_items` carries `selling_price_paise` in whole paise and
`portion_qty_milli_base` — how much of the recipe's yield one sold portion takes, which is
what lets a batch recipe (12 rolls) price a single item without being rewritten per-portion.

**Two rulings changed the proposal.** The duplicate-line unique indexes were dropped: butter
in the dough and butter in the topping is a normal recipe, and blocking a legitimate entry
is a worse failure than permitting a duplicate that costs the same either way — accidental
double entry is a UI concern. And batch-level wastage was rejected as a column on `recipes`,
because a smaller yield says the same thing with one fewer place to double-count it.

**Wastage direction is recorded in AGENTS.md, with the rejected alternative.** `1 + w`, so
180 g at 3% issues 185.4 g. The "yield shrinks, divide by `1 - w`" reading gives ×1.0309 for
the same input and a division by zero at 100%. Written down because a later "correction"
between the two would move every cost in the catalogue by a fraction of a percent, which is
the size of error nobody notices and nobody can explain afterwards.

**The soft-delete hole on `recipe_lines` is closed structurally, not by discipline.** A
costing query that forgets `deleted_at is null` returns a removed line and reports a higher,
plausible, wrong cost — worse than a missing-cost error, because there is nothing to
surface. AGENTS.md § One loader for recipe lines now requires exactly one loader function
with the filter inside it, no direct queries from any costing path, and a test proving a
soft-deleted line never reaches the fold. **The loader is not written yet** — the test it
must carry is a test about the fold, and the fold does not exist.

#### Read the generated SQL before running it, and it earned its keep again

Migration `0002_faithful_hydra.sql`. DDL ordering is correct: all three `CREATE TABLE`s
precede the `ALTER TABLE ... ADD FOREIGN KEY` block, and `recipes_tenant_id_uq` is emitted
inline as a UNIQUE **constraint**, so the composite FKs that target it have something to
point at — the same trap as migration 0000.

Two things the read turned up, neither of them a change to the migration:

1. **The composite FKs are `MATCH SIMPLE`, and that is load-bearing.** A sub-recipe line has
   a null `ingredient_id`, so its ingredient FK is simply not enforced — which is exactly
   what the XOR design needs. The same rule is why `menu_items` keeps its direct FK to
   `tenants` where deviation 6 drops it elsewhere: that redundancy becomes the only tenant
   guarantee the day `recipe_id` is allowed to be null for resale items.
2. **No index on `recipe_lines.ingredient_id`,** deliberately. The butter-price demo scans
   by ingredient, but a catalogue is hundreds of lines and Postgres seq-scans that in
   microseconds. Recorded as a decision rather than left as an oversight for someone to
   "fix" without a measurement.

#### Verified against the real database

`db:reset` from clean, all three migrations applied, seed applied. **103 tests, 0 failures,
0 skipped.**

A throwaway probe (in a rolled-back transaction, nothing persisted) confirmed the database
refuses all ten of: zero yield, a line with both an ingredient and a sub-recipe, a line with
neither, a one-step self reference, zero quantity, wastage above 100%, a cross-tenant
ingredient, a cross-tenant sub-recipe, a negative selling price, and a zero portion. It also
confirmed the accepted cases, including **the same ingredient twice in one recipe** — the
case the dropped unique index would have blocked.

Those ten are proven by probe, not by a committed test. Turning them into a
`recipes.db.test.ts` belongs with the loader, when there is something to load.

### 2026-08-21 — The costing engine, pure functions only (paper cases P1-P19)

**The paper cases were verified independently before anything was implemented**, the same
method as the WAC cases T1-T12: every value re-derived from the stated rules in a throwaway
script, then compared. All eighteen numeric answers agreed, including the discriminators —
P4's 6254.5 tie (6255 half-up, 6254 under banker's) and P7's 3,581,960 against the
3,582,029 an exact-rational implementation would produce. **No stated value was adjusted.**

**Nested rounding is now written down in AGENTS.md, with the reasoning**, because it looks
like a violation of "round once at the end" to anyone reading only that rule. Inside one
recipe nothing rounds early: contributions accumulate as an exact rational
(`Σ qty_milli × rate × (100000 + w)` over `100000 × yield_milli`) and there is one half-up
division where the batch cost meets the yield. A parent then consumes its child's
already-rounded rate. The justification is not arithmetic — **it is that the displayed
breakdown has to add up.** An owner who multiplies ₹13.622/g by 180 g on the screen in
front of them must get the total the screen shows, and exact rationals mean the rows do not
sum to the total. P7 exists to fail loudly if someone "corrects" this.

#### What is built

`src/lib/costing.ts` — pure, **no database access anywhere in the file**, which is what
makes P15's "assert nothing was written" structural rather than a promise. It takes its
cost lookup as a parameter (the seam AGENTS.md requires), so the what-if price is the same
function with a different lookup, and catalogue recalculation is the same function with a
shared cache. P16 asserts the catalogue and the individual answers agree.

`src/db/recipes.ts` — **the one loader**, with `deleted_at is null` inside it. Nothing else
queries `recipe_lines`.

Missing cost data throws `MissingCostError` naming **every** uncosted ingredient in one
pass, each with the recipe path that reached it ("vanilla (in top > middle > bottom)"),
rather than one name per attempt. An ingredient whose only purchase cost nothing is a
different case and correctly costs through as 0 — it has a basis, and the basis is zero.

#### Two findings worth keeping

1. **The sign-safe quantity rounder is not needed for costing, and that is not a shortcut.**
   The wastage factor stays inside the numerator as `(100000 + w)`, so costing never
   materialises a wastage-adjusted quantity to round. P8's 2224.8 g never exists as a
   number in the code. Month 3 still needs the rounder, when consumption movements put real
   signed quantities in the ledger — the risk list entry stands, it just belongs to a
   different month than expected.
2. **`MAX_RECIPE_DEPTH` is 5, and I chose it.** Nothing specified a limit. Dough → filled
   dough → roll is three levels; five leaves room without letting a mis-entered graph become
   a thousand-deep walk. Not derived from anything, and cheap to raise if a real recipe
   needs it.

#### Verified

124 tests, 0 failures, 0 skipped against live Postgres — 103 before, plus P1-P13 and
P15-P19 pure, and P14 against a real database. P14 inserts a sixth line that moves the cost,
asserts it moved, soft-deletes it, and asserts the cost returns to exactly 13622 with the
row still present. A test where the deleted line would not have changed the answer would
prove nothing.

#### Deliberately not built

The **DB-backed cost lookup** that reads `ingredient_stock` and throws by ingredient name.
Every test supplies its own lookup, which is what the seam is for, but nothing yet costs a
real recipe against real purchase history. That is the next thing, and it is the piece that
makes the missing-cost error reach an operator rather than a test.

The validators are **not wired to any save path**, because there is no save path — no
recipe screens, no server actions. `assertAcyclicWithinDepth` and
`assertLineUnitCompatible` are tested and unused, waiting for the code that will call them.

### 2026-08-21 — The ledger-backed cost lookup, and the validators wired to a save path

**A real recipe now costs from real purchase history.** Until this, every test supplied its
own lookup and nothing had ever costed against the ledger.

#### Having a cost basis is "a purchase movement exists"

Not "an `ingredient_stock` row exists", and not "stock is above zero". Those three come
apart, and the differences are the whole point:

- **Stock counted down to zero still has a basis.** The weighted average survives an empty
  shelf. Refusing to cost it would be wrong.
- **An adjustment-only ingredient has a row and no basis.** Someone finds 5 kg in the back
  and records a count correction; `ingredient_stock` now holds a row whose average is 0.
  Reading that row costs the ingredient at zero, silently — the exact failure AGENTS.md
  § Missing cost data is an error, never zero exists to prevent, and the one a
  row-existence check would have walked straight into.
- **A purchase at nil value has a basis, and it is genuinely 0.** A free sample or a
  write-off is a real fact about cost, not the absence of one.

So the predicate is `exists (select 1 from stock_movements ... movement_type = 'purchase')`,
and all four cases are asserted against a live database.

`loadCostLookup` batch-loads the whole tenant in **one query** and returns a synchronous
lookup — catalogue recalculation costs every recipe, and a per-ingredient fetch would be
N+1 against the ledger. Synchronous is also what keeps `src/lib/costing.ts` free of `await`
and therefore pure. Values are normalised to `bigint` at the boundary, once: the `exists`
is a raw expression whose runtime type is the driver's business rather than the select
shape's, and the rate arrives through a left join that can be null.

Soft-deleted ingredients are included on purpose. A line may still reference one and its
purchase history is just as real; reporting "deleted" as "never received" would send
somebody looking for a delivery to record that does not exist.

#### The demo, working

`P3 and P7 cost end to end from real purchase history` records seven receipts at prices
that produce the paper rates (maida ₹45/kg → 4500 millipaise/g, butter ₹500/kg → 50000, and
so on), builds the dough and the cinnamon roll **through the real save path**, and asserts
13622 and 3,581,960 — with the 3,582,029 exact-rational variant asserted against, in the
database test as well as the pure one.

The last test is PROJECT-SPEC § 1's sentence, working: a second butter delivery at ₹600
moves the weighted average to 55000, and the dough recosts to **14575**. That number is
hand-computed from the ledger, not from the paper cases — once the average moves the paper
rate no longer applies, and forcing the ledger to match it would have been backwards.

#### The validators are reachable now

`saveRecipe` runs all three before it writes anything: unit compatibility per line, then
cycles and depth against the graph **as it would be**. Cycle rejection needs an edit rather
than a create — a new recipe cannot be referenced by anything yet — so the save path
supports both, and the test asserts the rejected edit left the dough at 13622 with its five
lines intact.

Depth is checked **from every recipe in the prospective graph, not just the edited one**.
Walking downward from the edited recipe alone would never notice that deepening a leaf
pushed a parent over the limit.

Editing replaces the line set wholesale: old lines soft-deleted, new ones inserted, one
transaction. Diffing would be more code for an identical result, and the soft-deleted rows
are the edit history.

Two permissions added, `recipes.view` and `recipes.manage`, both owner and manager. **A
recipe cost is the owner's margin working backwards**, so counter and kitchen see neither.
Month 3's kitchen board shows what to make, not what it cost.

`MAX_RECIPE_DEPTH` of 5 approved, and the reasoning now sits next to the constant so it is
not raised later as an arbitrary number.

#### Verified

136 tests, 0 failures, 0 skipped against live Postgres — 124 before, plus 13 database tests
covering the four cost-basis cases, the end-to-end costing, P14, and every validator firing
through the save path.

#### Still not built

Recipe screens, deliberately. Nothing in `app/` touches any of this yet — no list, no
editor, no cost breakdown. Step 5 of Month 2 is where those land, and the what-if price is
already a parameter away: `recipeRateMillipaisePerBase` with a lookup that overrides one
ingredient, writing nothing.

### 2026-08-21 — The recipe list and the cost breakdown (screens, no editors yet)

Two screens, stopped deliberately before the editors so the breakdown's vocabulary can be
looked at before anything else is built on it.

#### A bug the list found before the list existed

Costing a whole list means catching `MissingCostError` per recipe and carrying on — and
that is the first thing that ever shared a cost cache across separate calls. It exposed a
real defect: `rateOf` cached a rate it had computed with a `0n` placeholder for a missing
ingredient. A parent reading that cached value found nothing missing in its own walk and
would have returned **a confident, plausible, wrong total instead of an error** — the exact
failure this module exists to prevent, arrived at from a direction nobody was watching.

Fixed at the root: a rate computed while anything was missing is never cached. Two lines,
and P22 now pins it.

#### What the screens do

**`/recipes`** — name, line count, yield, cost, last updated, with search. A sub-recipe is
labelled where the fact lives, beside the count of what uses it ("Sub-recipe · used by 1"),
rather than in a separate type column that would say the same thing twice. A recipe that
cannot be costed shows a badge reading **No cost yet**, never a zero and never a dash.

**`/recipes/[id]/cost`** — the screen the project was sold on. Batch cost and unit cost as
headline figures, then every line with quantity, rate, rupee contribution and share of the
batch, biggest first, with a bar behind the percentage. Sub-recipes expand in place to show
their own composition, and the expansion is a `<details>` element — no client component, no
hydration, works with JavaScript off, and the browser owns the keyboard behaviour.

**The cost column adds up to the batch total exactly**, which is the whole reason
sub-recipe rates are rounded. The seeded demo:

```
Cinnamon roll dough   2160 g   Rs 138.53/kg   Rs 299.22   68.4%
Butter (unsalted)      120 g   Rs 520.00/kg   Rs  62.40   14.3%
Cinnamon powder         60 g   Rs 880.00/kg   Rs  52.80   12.1%
Brown sugar            240 g   Rs  95.00/kg   Rs  22.80    5.2%
Batch total                                   Rs 437.22  100.0%
```

Expanding the dough gives its five lines summing to Rs 581.84. One portion costs Rs 36.44
against Rs 350.00 — margin Rs 313.56, food cost 10.4%.

**The what-if works.** Butter at Rs 620/kg instead of Rs 520 moves the dough to
Rs 157.58/kg, the roll to Rs 40.86, the margin to Rs 309.14 and food cost to 11.7%, under a
banner saying nothing is saved, with a link back to actual costs. It is a GET form and an
override map wrapped around the real lookup — **the page has no write path at all**, which
is a stronger guarantee than a promise not to write.

#### Verified against the running app, not just compiled

Every figure above was hand-computed from the seed prices first and then read off the
rendered page. All three failure states were exercised against temporary fixtures, since
none of them can be produced by the happy path:

- **Missing cost** renders "1 ingredient has no purchase history … **Saffron strands** (in
  ZZ uncostable test). Record a delivery for each" with a link to the receipt form. Never a
  stack trace, never a zero.
- **A recipe with no lines** says an empty recipe costs nothing because it contains
  nothing, not because it is free.
- **A menu item priced below cost** flips the margin tile to "Loss per portion Rs 16.44 —
  sold below what it costs to make", with a food cost of 182.2%.

The fixtures were removed afterwards.

#### The seed now carries the demo recipe

Without it these screens have nothing to show, because the recipe editor does not exist
yet. P3's dough and P7's cinnamon roll at the **seeded** prices, plus one menu item at
Rs 350. Every figure is reproducible by hand from `seed.ts`, and the arithmetic is written
out in a comment there.

#### Three new CSS patterns, flagged

Month 1's vocabulary covered everything else. These three did not exist:

- **`.stat` / `.statgrid`** — headline figures. Same card shape as `.navcard` (border,
  radius, 6px left rule) so they read as one family; only the type scale differs.
- **`.costbar`** — the share bar. Decoration on top of the percentage beside it, never
  instead of it, so greyscale and a screen reader both still get the figure. Sky and navy
  as fills, which is all the palette constraint allows them to be.
- **`.subdetails` / `.subrow` / `.table--nested`** — the expandable sub-recipe. It sits in
  a full-width row beneath its parent because a `<tr>` cannot be wrapped in `<details>` and
  stay valid HTML. Nested rows drop the 56px fingertip floor: they are read, not tapped.

#### Verified

139 tests, 0 failures, 0 skipped. `next build` exits 0, 12 routes.

#### Not built

The recipe editor, the menu item editor, and the line editor whose control has to make the
unit follow the ingredient. `saveRecipe` and all three validators are already behind them,
so those screens are forms over a function that already refuses everything it should.

### 2026-08-22 — The three editors: recipe, line, menu item (Month 2 step 5 closes)

The screens that were deliberately not built on 2026-08-21. `saveRecipe` and its validators
were already behind them, so most of this is a form over a function that refuses everything
it should — but building the forms found two things the read-only screens could not.

#### The unit is the whole problem, and it is solved by not asking twice

A recipe line's quantity is in the unit of whatever the line draws on, and `recipe_lines`
has no unit column because the unit belongs to the source. So the editor derives it: pick
"Butter (unsalted)" and the box beside the quantity reads **g**, pick the dough and it reads
**g** with "Sub-recipe, measured by weight" under the name, pick a volume ingredient and it
reads **ml**. The operator never types a unit and never chooses one.

**That label is then submitted, as a hidden field, and the server checks it.** It would have
been easy to derive the unit server-side too and let the check pass vacuously. Submitting it
makes the label an assertion: if an ingredient's unit type changed while the page sat open,
the save is refused by `assertLineUnitCompatible` instead of silently reinterpreting 800 g as
800 ml. The same field is what makes P19b reachable from the UI at all.

The kind of source (`ingredient` or `recipe`) is submitted the same way and is **not
trusted**: `saveRecipe` looks the id up in this tenant's ingredients or this tenant's
recipes accordingly, so a wrong claim can only produce a refusal, never a wrong write. It
was tested by claiming a recipe id was an ingredient — "ingredient … is not in this tenant".

#### A defect the editor opened, and the guard that closes it

Nothing before this could change a recipe's **yield unit type**. The editor can, and that
would have been silent corruption: the cinnamon roll enters the dough as "2160 g", a stored
line carries no unit of its own, and nothing re-validates stored lines. Flipping the dough
to volume would have turned every parent line into 2160 ml without a word.

`saveRecipe` now refuses the change while any parent still draws on the recipe, naming them:
*"Cinnamon roll dough" is measured by weight and is used by "Cinnamon roll batch". Remove it
from that recipe before changing what it yields.* Verified through the form and in the test
suite; the rejected edit writes nothing.

The same hole exists one level down — an ingredient's unit type is editable and recipe lines
referencing it carry no unit. It is **not** the same severity (costing never reads a unit
type, so no total moves; the display would lie about what "800" means) and it is **not
fixed**. Noted here rather than built: the fix is the same shape, in `updateIngredient`.

#### Two checks moved off the database, for the message

`recipe_lines` already has check constraints for a positive quantity and 0-100% wastage. A
constraint violation names a table and a column, which is no use to whoever typed it. Both
now run in `saveRecipe` first and name the line: *"Butter (unsalted)" needs a quantity above
zero.* and *Wastage on "Butter (unsalted)" must be between 0% and 100%.* The constraints stay
where they are — they are the thing that is actually true.

Duplicate recipe and menu item names are translated the same way ingredients already were,
through `translating()` on the unique index, so a taken name reads as a sentence instead of
`duplicate key value violates unique constraint`.

#### Line order is now deterministic, and still not meaningful

Every line of one save is inserted in a single statement and shares a `created_at` to the
microsecond, so ordering by `created_at` alone left the row order to the planner — an editor
that shuffles its rows between loads. The loader now orders by `(created_at, id)`.

Stable, not meaningful. **No `position` column was added**: recipes carry no stored line
order, the breakdown sorts by contribution on purpose, and a column exists to be maintained.

#### What a line may draw on

`listLineSources` offers every active ingredient plus every other recipe. Two rules in it:

- A deactivated or soft-deleted ingredient is excluded, **except** where a line of the recipe
  being edited already uses one. Dropping it would leave a row pointing at a blank name, and
  re-saving would quietly rewrite the recipe.
- A recipe that would close a cycle **is still offered**. `saveRecipe` refuses it with the
  loop spelled out, which tells the operator more than an option that is silently absent.

#### One inverse for every scale

The editors put stored integers back into boxes, which needed the other direction of
`parseDecimalToInteger` at three scales. Rather than three near-copies: `integerToDecimal`
is the one implementation, with `milliBaseToPurchaseUnits`, `milliBaseToBaseUnits`,
`paiseToRupees` and `millipercentToPercent` named on top of it. Each round trip is exact and
pinned by a test — a value that survives an edit form must come back unchanged.

`millipercentToPercent` also replaced the one float divide left on the cost breakdown
(`Number(w) / 1000`), so no display path converts a stored scale by hand any more.

`listMenuItems` was extracted from `getRecipeCostBreakdown` so the breakdown and the menu
editor read the same rows through the same function.

#### The screens

- **`/recipes/new`** and **`/recipes/[id]/edit`** — the same form. Name, what one batch
  yields (quantity plus weight/volume/count, with the unit label following the choice), the
  line table, and method notes. Rows are added and removed; a row left blank is an unused
  row, not an error; a row half-filled is an error and the message names the half.
- **`/recipes/[id]/menu`** — every menu item for one recipe, each its own form, plus a blank
  one to add another. One screen rather than a new-and-edit pair: a recipe has one or two
  menu items and seeing them together is how someone notices the half portion priced above
  half. Off the menu is a checkbox, not a delete.
- Entry points: **+ New recipe** and a per-row **Edit** on `/recipes`, **Edit recipe** and
  **Menu items** on the breakdown, and **Put it on the menu** where the breakdown says
  nothing sells this yet. All behind `recipes.manage`, which is rendering only — every
  mutation re-checks.

The line picker is the receipt form's combobox, generalised: `options` instead of
`ingredients`, an optional muted `hint` per option (a recipe is tagged "recipe"), and the
noun in its two messages is a prop. One picker, two screens, no second implementation.

#### A hang the new action would have copied, fixed in both places

Both line-collecting actions turned the submitted row index into an **array index**:
`raw[Number(index)] ??= {}`. The index comes from the form, so `lines[2000000000][quantity]`
- a request that costs nothing to send - made an array of length two billion, and the
`.filter()` on the next line walked every slot. An authenticated operator could stop the
counter PC serving the whole cafe with one request.

Both now collect into a `Map` and sort by index, so the number is never a length. Fixed in
`app/recipes/actions.ts` **and** in `app/stock/actions.ts`, which had the original copy of
the pattern - the new code did not introduce it, it inherited it, and patching only the new
one would have left the receipt form still holding the bug.

#### Verified against the running app, not just compiled

151 tests, 0 failures, 0 skipped. `next build` exits 0, 15 routes.

Then 45 checks driven over HTTP against `next dev`, submitting the real forms the way a
browser with JavaScript off does — Next renders server-action forms with hidden `$ACTION_*`
fields, so a plain multipart POST reaches the real action, the real Zod parse and the real
database. Every figure was hand-computed from the seeded ledger first and then read off the
rendered page.

A recipe created through the form — maida 500 g at Rs 42/kg, butter 60 g plus 5% wastage at
Rs 520/kg, yielding 900 g:

```
Maida (refined flour)   500 g               Rs 21.00   39.1%
Butter (unsalted)        63 g (60 g + 5%)   Rs 32.76   60.9%
Batch total                                 Rs 53.76  100.0%
Unit cost                                   Rs 59.73 per kg
```

Edited to swap the butter for 200 ml of milk: Rs 33.40 the batch, Rs 12.40 the milk line,
butter gone from the breakdown and from the what-if list. A menu item at 300 g and Rs 120:
portion cost Rs 11.13, margin Rs 108.87. Repriced to Rs 150 and taken off the menu: the
badge appears and the margin follows.

Nine refusals were exercised through the form, each one landing as a sentence in the error
banner and writing nothing: a quantity with nothing to attach it to, an ingredient with no
quantity, a quantity of zero, 150% wastage, a unit that disagrees with its ingredient, a
recipe claimed to be an ingredient, a name already taken, a batch that yields nothing, and
"half a bag" typed into a quantity. Plus the two that need an existing graph: closing a cycle
("This recipe would contain itself: Cinnamon roll dough > Cinnamon roll batch > Cinnamon roll
dough") and changing the yield unit of a recipe in use. After all of them the seeded dough
and roll still had their 5 and 4 lines and their original yields.

Five more checks covered the receipt form, which the index fix touched: blank rows dropped,
a half-filled row still an error, the two-billion index answering instantly instead of
hanging, and a receipt with a blank row above two real ones recording both, in order.

The recipe and menu fixtures were removed from the dev database afterwards and the seeded
demo left as it was - maida still 4200, butter still 52000. The **stock movements from the
receipt check were not removed**: the ledger is append-only, and a real delivery of walnuts
and cashews (neither is in a demo recipe, so no costed figure moves) is a smaller wrong than
deleting ledger rows by hand.

#### Not built

- **Deleting or deactivating a recipe.** Nothing asked for it and nothing is hard deleted.
  A recipe that is not on the menu costs nothing to leave alone.
- **A menu list across all recipes.** Menu items live under the recipe that makes them; a
  cross-recipe view with margins is Month 5's analytics screen, not a fourth editor.
- **A live rupee preview per line while typing.** It would need the contribution arithmetic
  in a client component, and AGENTS.md § One implementation of the cost arithmetic says no
  second copy in a component or an action. The breakdown is one save away and is the same
  numbers by construction.

#### One incidental change

`next dev` on Next 16.3 appends a `<!-- BEGIN:nextjs-agent-rules -->` block to `AGENTS.md`
and re-adds it on every run. It is committed rather than fought; `agentRules: false` in
`next.config.ts` turns it off if it is unwanted.

### 2026-08-22 — The home screen stops being a launcher

Four UI directions were put up; the one chosen was **"Today, for real"**. The home page
was called Today and said nothing about today: six identical cards, one of which was a menu
item you clicked to find out whether anything was wrong.

#### The rule the page now keeps

**When nothing is wrong, the page goes quiet.** Three zeros and one sentence — *"Nothing
needs you. All 37 ingredients are above their reorder threshold, and every recipe can be
costed."* — with no empty widgets and no zero-state cards.

That is the whole design bet. A dashboard that looks the same busy and idle teaches people
to stop reading it, and this one is read at the start of every shift. It was verified both
ways: the three seeded low ingredients had their thresholds temporarily zeroed, the quiet
state was read off the rendered page, and the thresholds were put back to 1000000 exactly.

#### What is on it

- **Three figures**, each a link, each from a function that already existed: *need
  reordering* (`listLowStock`, the same worst-first ordering the low stock screen uses),
  *deliveries today*, and *cannot be costed* (`listRecipes`, the same `MissingCostError`
  the breakdown reports). Nothing here recomputes anything, and the tile turns claret when
  its count is not zero — never colour alone, the label says what it counts.
- **Needs you** — the exceptions themselves, worst first, four at a time, each naming the
  figure that makes it an exception. An uncostable recipe names the ingredient with no
  purchase history, because "1 recipe has no cost" sends someone hunting and "Saffron
  strands has no purchase history" does not.
- **Record** — the two write actions, unchanged and still cards. They are why counter staff
  open the app.
- **Everything else** — the read screens, demoted from cards to 44px chips. Quieter, not
  smaller: the thing pressing one may still be a thumb with a tray in the other hand.

The signed-in identity moved into the brandbar, which had an empty band across the middle
of it and was crowding the first heading on the page.

#### Two layout bugs, fixed in the class rather than in the screens

- **`.section-title` had no top margin.** Every screen was writing `section-title mt-8` by
  hand; the home page forgot, which is why "Signed in as Cafe Owner" sat welded to "STOCK".
  The margin now belongs to the class, and a utility still overrides it where a screen
  wants a tighter gap.
- **`.navgrid` used `auto-fill`.** An auto-fill track that no card lands in still takes its
  share of the row, so three cards in a four-track row left a quarter of the page blank and
  the row read as unfinished. `auto-fit` collapses the empty track.

#### One new query, and one new pure function

`countDeliveriesSince` counts **receipts, not rows**: every line of a delivery shares a
`reference_id`, and counting rows would report a three-line delivery as three, which is not
what anyone at the counter means by "deliveries today". A purchase written without a
reference counts as its own delivery rather than collapsing into a null group.

`startOfDayIST` in the new `src/lib/time.ts` is the day boundary, and it is the reason the
figure is not quietly wrong: timestamps are stored UTC and the day being asked about is a
Kolkata day. Cutting the day in UTC files every evening delivery under the next date — an
error nobody reports, because the number still looks plausible. India keeps a fixed +05:30
with no daylight saving, so the offset is a constant and the file stays pure.

#### Verified

156 tests, 0 failures, 0 skipped (five new: four on the day boundary, one on the delivery
count across two fresh tenants). `next build` exits 0. The page was read off the running
app in both states, with the figures checked against the database: 3 low of 37 ingredients,
1 delivery today, 0 uncostable of 2 recipes.

#### Not done

The other three directions are still on the table and are not blocked by this one:
**Docket** (paper vernacular, tear-off write screens), **Counter mode** (thumb-zone actions
and a tab rail for the 10-inch tablet), and the rest of **Weight and rhythm** (a full type
scale across the six table screens). This entry changed the home page and two shared
classes; every other screen is untouched.

### 2026-09-09 — The client's real price list is in

`NEW PRODUT COSTING PER KG PER GM.xlsx` arrived: 113 rows, 8 sections, brands, pack sizes
and a per-kg rate. 96 of them are now ingredients in the system. Housekeeping (Vim, Wheel,
foil, garbage bags) was left out by decision — a monthly overhead is not a per-order cost,
and it would only add noise to the low stock screen. Packaging was kept in, so a menu item
can carry the ₹18 pizza box it leaves in.

#### The sheet disagrees with itself in 11 places, and that is the point

Pack size × price paid should equal the per-kg rate they cost with. It does not, for 11
rows. Most are **stale pack labels rather than wrong prices**, and the arithmetic says
which: ₹2100 at ₹42/kg is a 50 kg sack, not the "1 kg" the label claims; the tea formula is
literally `=838/2`, so that pack is 2 kg; olives at ₹240/kg means ₹720 bought a 3 kg tin.
Four rows were reconciled that way and imported.

Five could not be explained and were **imported with no price at all**:

| Item | Sheet says | Paid |
|---|---|---|
| Dry Yeast | ₹400/kg | ₹400 for a pack labelled 500 g |
| White Compound Chocolate | ₹420/kg | ₹220 for 1 kg (Sheet2 says ₹236) |
| Mascarpone Cheese | ₹750/kg | ₹1008 for 1 kg (Sheet2 also says ₹1008) |
| Tomato Ketchup Sachet | ₹60/pkt | ₹65 |
| White Vinegar (Can) | ₹30/litre | ₹30 for 750 ml |

They exist as ingredients with no cost basis, so the app reports them by name as uncosted
the moment a recipe uses one. **Guessing which of the two numbers was right would have been
the worst available option** — a mascarpone at ₹750 instead of ₹1008 costs every tiramisu
26% light, and nothing on screen would look wrong.

Four more rows are ones where the ledger is simply more accurate than the sheet: Milk Maid
is ₹1850 for 7.5 kg, which is ₹246.67/kg, not the ₹250 the sheet rounds to. The import
records what was paid and lets the rate be derived, so the rounding disappears.

This is the argument for the whole design, arriving on its own: a sheet with a typed per-kg
column can contradict itself and nothing notices. A ledger that stores what arrived and
what was paid cannot.

#### `ingredients.brand`, migration 0003

The sheet tracks brand deliberately — Aashirvaad, Amul, Van Houten 10/12 — and there was
nowhere to put it. Nullable, because most of the bulk masala is bought loose.

Its own column rather than part of the name: the two answer different questions. Recipes and
cost breakdowns are read by ingredient ("butter"), reordering is done by brand ("the Amul
1 kg, not the D'lecta"). Folding it into the name would also make a change of supplier a
rename of something recipe lines point at. It shows as a muted second line under the name
on the ingredients list, and it is a field on the ingredient form.

#### The importer refuses two things

`scripts/import-price-list.ts`, `npm run import:prices`. Dry run by default; `--commit`
writes; `--tenant` is required and never guessed, because a development database fills up
with test tenants and writing an opening balance to the wrong one is silent.

- **It writes no SQL.** Every ingredient goes through `createIngredient()` and every price
  through `recordReceipt()`, so the same validation, the same rounding and the same audit
  log apply as when someone types it into the form. A bulk import that shortcuts the write
  path is a second write path, and the two disagree eventually.
- **It invents no cost.** See the five above.

Its input is `scripts/data/price-list-2026-09.csv`, generated from the workbook and checked
in, so the reconciliation decisions are reviewable in a diff and re-importing after the
owner settles the five conflicts is an edit to a CSV.

#### What landed

88 new ingredients, one receipt of 83 lines noted "Opening balance from the September 2026
price list", 5 ingredients with no cost basis by design. Verified against the database
afterwards: atta ₹42/kg, maida ₹42/kg, butter ₹560/kg, matcha ₹12,790/kg, oil
₹185.33/litre, pizza box ₹18 each, sticker ₹0.60 each, Milk Maid ₹246.67/kg.

Quantities are nominal — one pack of each — until someone counts the shelf. That is safe by
construction: an adjustment moves a quantity and never moves the average (test T9), so
counting later cannot damage the prices imported here.

#### Open — 8 ingredients still carry demo prices

Eight names in the list already existed in the tenant from the development seed, so the
import skipped them and left their seeded prices untouched: **Castor Sugar, Brown Sugar,
Honey, Cocoa Powder, Baking Powder, Baking Soda, Paneer, Cream Cheese.**

The tenant now holds 125 ingredients: 88 real, 37 from the demo seed, of which those 8 are
duplicates in all but spelling ("Maida (refined flour)" and "Maida (Refined Wheat Flour)"
are the same flour). **This needs a decision before the system is used in the cafe**, and
there are only two sensible answers: retire the demo ingredients and rebuild the demo
recipe on the real ones, or start the real cafe in its own tenant and keep the seeded one
as a sandbox. Nothing is broken meanwhile; the figures on the demo recipe are still its own.

### 2026-09-09 — The open problems, closed

A pass over everything on the problem list. Five of the seven are fixed; the two that are
not are not ours to fix, and are now drafted as questions instead.

#### 1. Concurrent stock writes could silently corrupt the cache — FIXED

**This was a real defect, verified in the code and then reproduced in a test before being
fixed.** `recalculateStock` read the ledger, folded it in memory and wrote the result back,
with no lock taken before the read, on default READ COMMITTED. Two transactions touching
one ingredient both read before either committed, and the second write overwrote the
first's movement out of the cache. Stock on hand and weighted-average cost both wrong,
silently, until someone rebuilt.

A row lock on `ingredient_stock` would not have fixed it: by the time the second
transaction blocks on the write it has already read a stale ledger, and on a first purchase
the row does not exist to lock. So it is a transaction-scoped **advisory lock keyed on the
ingredient**, taken **before the movement is inserted** — not merely before the read,
because that also keeps `seq` assignment in the same order as commits, which the watermark
below depends on. Locks are taken in sorted order so two receipts naming the same
ingredients cannot deadlock.

The test forces the interleaving rather than hoping for it: the first transaction is held
open after writing, the second is started and given 150 ms to reach the ledger read, and
only then is the first allowed to commit. **Verified to have teeth** — with the lock
removed it fails every run with "a movement was lost from the cache", and with it restored
all four concurrency tests pass.

#### 2. Ledger replay was O(whole history) per movement — FIXED

The Month 4 blocker, closed early because #1 made it safe to reason about. `ingredient_stock`
gains `snapshot_seq`, the seq of the last movement folded into the row. The ordinary path
folds only what arrived since, starting from the cached state; a full rebuild is still one
call away and is what the tests check the cache against.

No second implementation of the arithmetic: `replayLedger(movements, from = EMPTY_STOCK)`
gained one optional parameter, so the incremental path and the rebuild are the same reduce
over the same `applyMovement`. AGENTS.md predicted this would be safe for exactly that
reason, and it was.

**The migration backfills the watermark**, which is the part that would have been a
disaster to forget: every existing cached row was folded from the whole ledger, so a
watermark of 0 would have told the next recalculation that none of those movements had been
counted, and it would have folded them all in a second time. Stock and cost would have
silently doubled.

Measured with `npm run bench:replay`, which now reports both paths:

```
size        rebuild      incremental      speedup
1000             7 ms          8.0 ms          1x
10000           22 ms         10.4 ms          2x
50000           95 ms          6.5 ms         15x
100000         161 ms          6.8 ms         24x
```

The rebuild column reproduces the old numbers (87 ms and 171 ms were measured in August).
The incremental column is **flat**: about 7 ms whatever the ledger size, because it is one
insert, one lock and one row folded. An order touching five high-frequency ingredients now
adds ~35 ms to confirmation instead of ~0.4 s, and it stays there. **The snapshotting
blocker on Module 4 is discharged.**

#### 3. The Docker image could not build — FIXED

`output: 'standalone'` had been commented out in `next.config.ts` (commit `395da8e`,
"output standalone conflict") while the Dockerfile still copied `.next/standalone`. Any CI
image build would have failed. Re-enabled, and verified properly: `next build` produces
`.next/standalone/server.js`, and `docker build --target runtime` completes.

The build also warns `SecretsUsedInArgOrEnv` on `SEED_OWNER_PASSWORD`. It is a false
positive — the value is the literal string `build-time-placeholder`, in a build stage that
never becomes the runtime image, and it is there because `src/lib/env.ts` refuses to start
without the variable set. Left alone.

#### 4. Fake demo prices sitting in the real catalogue — FIXED

The import had skipped eight names because the development seed already owned them, so
Baking Powder, Paneer, Cream Cheese and five others still carried demo prices.

The demo ingredients are now **retired rather than deleted**: the eight colliding names got
a " (demo)" suffix to free the name, all 37 were deactivated, and the import was re-run to
create the real versions. Baking Powder is now Weikfield at ₹80/kg with the demo row
inactive at ₹33.70 beside it. Nothing was destroyed, so the demo recipes still cost, and
the catalogue is 96 active real ingredients against 37 inactive demo ones.

**A database reset was considered and rejected.** Checking what was actually in the tenant
first turned up a recipe named "pizza", created 2026-08-22 at 01:43 IST — after that
session ended, so it is the owner's own, made through the new editor. Wiping would have
destroyed it. It is untouched, and it still costs, because deactivating an ingredient
leaves its cost basis alone.

That the recipe exists at all is the first evidence the editor works in somebody else's
hands.

#### 5. Test residue made the database unreadable — FIXED

The database tests each build their own tenant and deliberately do not clean up, which is
right: a failed run is far easier to diagnose with its rows still there. The cost had
reached **151 tenants, 928 ingredients and 2037 movements**, enough that the price list
importer had to refuse to guess which tenant it was writing to.

`npm run db:clean-tests` (dry run by default, `--commit` to delete) removes them in one
transaction, children before parents. It matches **tenants whose name ends in a UUID**,
which every test tenant has and no real cafe does — precise, self-explanatory, and it
cannot creep. 151 removed, 1 remaining, and the cafe verified untouched afterwards.

#### 6 and 7 — not ours, now drafted

The aggregator split (§ 10.1, which the spec says must be resolved before Month 3
planning), resale items, GST registration, the five contradictory prices, Razorpay KYC, the
server account, and the request that the owner finally break the receipt form: all of it is
written up in `files/client-questions-2026-09.md`, in plain language and ready to send.

Question 1 is the one that matters. If most orders arrive through Swiggy and Zomato, they
never touch inventory, stock counts drift and the costing describes a minority of what the
kitchen actually cooked. That reshapes Month 3 and it is worth knowing before the tables
are designed rather than after.

#### Verified

160 tests, 0 failures, 0 skipped — four new, all four of them proven to fail when the fix
is removed. `next build` exits 0, 15 routes. `docker build --target runtime` completes.

### 2026-09-09 — Overhead: what a batch costs in time

The recipe builder costed ingredients. It now costs the kitchen as well, which is what the
owner meant by "everything that makes up the total cost". **Not in PROJECT-SPEC** — the
spec tracks food cost and gross margin only — so this is scope added deliberately, on
request.

#### The model, and why not a percentage

Chosen from three: a flat percentage on food cost, free-text cost lines per recipe, or
**time in the kitchen**. Time won because it is the only one that can tell a three-hour
dough batch from a two-minute chai. A percentage charges overhead in proportion to
groceries, which says the chai and the rolls carry it in the same ratio as their flour —
the opposite of the truth. Free-text lines mean retyping wages onto every recipe, and
re-editing all of them when wages change.

So: two tenant-wide rates in rupees per hour (labour, and kitchen for gas, power and rent),
and one number per recipe — how long a batch takes.

#### Overhead goes inside the rate, not on the end

`batchOverheadPaise(minutes, rates)` rounds labour and kitchen to whole paise once each, at
the end of their own chain, and `rateOf` adds them to the batch numerator **before** the
division by yield:

```
numerator += (labourPaise + kitchenPaise) * CONTRIBUTION_PER_PAISE
```

`CONTRIBUTION_PER_PAISE` is exactly the factor that turns one paise into the numerator's
units, so it is an exact addition rather than a second scale to keep straight.

Doing it there is the whole design. It is what makes **a sub-recipe carry its own labour
upward**: a roll using 2160 g of a 4200 g dough batch carries 2160/4200 of the time that
dough took, without anyone entering it twice. Adding overhead after the division would
strand the dough's two hours at the bottom of the tree and cost the roll as though the
dough had made itself. P26 pins it to the paise.

The seam is the one the cost lookup already uses: rates are a PARAMETER to the pure
functions, defaulting to null. Every paper case P1–P22 passes untouched, because they pass
no rates.

#### Null is not zero, in three places

A recipe with no batch time, a tenant with no rates, and a rate of zero are three different
statements, and the screens keep them apart:

- **No rates set** — "Ingredients only. Labour and kitchen overhead are not in these
  figures because no hourly rates are set", with a link to set them.
- **Rates set, recipe untimed** — "This recipe has no batch time, so there is nothing to
  charge labour or kitchen overhead against", with a link to the editor.
- **Zero entered** — an assertion that an hour costs nothing, honoured as one.

Costing labour at zero because nobody filled in a box is the same class of error as costing
an ingredient nobody has bought at zero, which AGENTS.md has forbidden since Month 1.

#### What it looks like

The breakdown's footer became the build-up: ingredients, then Labour with the minutes
beside it, then Kitchen, then the batch total. The headline tile says "Batch cost, all in"
only when the time is actually in it. A menu item's tile stops saying "Food cost" and says
"Total cost", because once the baker is in the figure it is not a food cost any more.

`/settings/costing` holds the two rates, with the arithmetic for working them out in the
hint text — a baker on ₹16,000 a month over 26 days of 8 hours is about ₹77 an hour.

#### Verified end to end, through the real forms

Rates set to ₹80/hr labour and ₹30/hr kitchen through the settings form, then the demo
dough timed at 120 minutes through the recipe editor:

```
                      before          after
  Dough batch        ₹581.84        ₹801.84      +160 labour, +60 kitchen
  Dough rate         ₹138.53/kg     ₹190.91/kg
  Cinnamon roll      ₹437.22        ₹550.37      +113.15, inherited
```

₹113.15 is 2160/4200 of the dough's ₹220. **Nobody entered labour on the roll.** The
owner's own "pizza" recipe went from ₹934.82 to ₹1,099.82 at 90 minutes, which is ₹120 of
labour and ₹45 of kitchen, exactly.

Both silences were exercised too: before any rates the breakdown said ingredients only and
linked to the settings; with rates but no batch time it said the recipe was untimed.

#### Verified

165 tests, 0 failures, 0 skipped — five new paper cases P23–P27, hand-computed from the
rules before the code ran. One of them disagreed with the implementation, and **the
expectation was wrong**: ₹36.44 came from the seeded demo, where butter is ₹520/kg, while
the paper fixture prices it at ₹500. P7 already pinned that rate at 3581960 millipaise, so
the expectation was corrected to ₹35.82 rather than the code being bent to meet it.

`next build` exits 0, 16 routes.

---

## 2026-09-26 — Full-codebase audit, and every defect in it closed

Third audit, after [14 September](files/audit-2026-09-14/REPORT.md) and
[16 September](files/audit-2026-09-16.md). Full report:
[files/audit-2026-09-26.md](files/audit-2026-09-26.md). Unlike the first two, the fixes
landed in the same pass.

**177 tests → 194, 0 skipped. Typecheck clean, `next build` 0 at 17 routes.**

### The one that would have bitten first

The session cookie was marked `Secure` from `NODE_ENV === 'production'`. The demo box runs
`NODE_ENV=production` behind Caddy on plain HTTP, and **a browser refuses a `Secure`
cookie from an `http://` origin** — localhost being the sole exemption, which is why every
test of it passed. The owner in Aurangabad would have signed in and bounced back to the
login page forever, with nothing to read. It now follows `x-forwarded-proto`.

Handing the demo box over was the next thing planned. This would have been the first thing
he saw.

### Closed

| # | Finding | Shape of the fix |
|---|---|---|
| 1 | `Secure` cookie on an HTTP demo box locked everyone out | read the scheme, not `NODE_ENV` |
| 2 | Per-source login throttle bypassable — Caddy appends to `X-Forwarded-For`, so the leftmost entry was the attacker's | `header_up X-Forwarded-For {remote_host}` |
| 3 | The throttle's own key map never evicted | sweep above 10k keys, 2 tests |
| 4 | A soft-deleted sub-recipe would blank the recipe list and home page | named error, and a structural refusal carried as a value |
| 5 | `saveRecipe` — the only writer omitting `tenant_id` from its `WHERE` | added to both statements |
| 6 | `consumption` labelled "Sale" | reads "Used" |
| 7 | Changing `unit_type` silently reinterpreted all stock and every recipe line | refused once anything references it, 3 tests |
| 8 | `HistoryFilter.to` documented exclusive, implemented `lte` | half-open, matching its own contract |
| 9 | Day boundary in 2 places, timezone hardcoded in 4 | `TIMEZONE` / `istDayStart` / `istDayAfter` in `time.ts`, 4 tests |
| 10 | **Nothing under `app/` was tested at all** | pure parts extracted to `src/lib/form.ts`, 9 tests |
| 11 | Numeric fields unbounded where every text field had `.max()` | bounded at 24 — measured first: 1 MB costs 141 ms, so a nit, not a DoS |
| 12 | `recordMovements` assumed one tenant per batch | asserted where it is relied on |

Each new guard was checked the way AGENTS.md asks: disabled, watched go red, restored.

### What finding 10 turned up on its way in

The two copies of the indexed-FormData row collector had diverged. The recipe one dropped
blank rows with `r.sourceId?.trim() !== ''`, which is **true when the key is absent**
(`undefined !== ''`), so a row carrying only its defaulted wastage value survived as
half-filled and failed with a message about picking an ingredient the operator had never
been shown. One collector now, and a test for precisely that.

This is the argument for the extraction rather than a side note: the untested code was the
input boundary, and it had a bug in it.

### Verified unreachable rather than fixed

`integerToDecimal` truncates a value whose pack size carries a factor other than 2 or 5 —
ten eggs is a third of a tray of 30 — and the truncation will not parse back. Carried over
from 14 September. **Checked rather than assumed:** every route into a stored quantity
converts against the pack size submitted with it, and a query over the cafe's live 133
ingredients found no value this cannot render exactly. Only a script writing one directly
opens the gap. The ceiling is documented on the function with both escape routes, and a
test pins the behaviour.

### Documentation that had drifted

README and AGENTS.md both said 165 tests. AGENTS.md's permission table listed three of the
six that exist and never said that **`kitchen` appears in none of them** — a kitchen
account signs in and reaches nothing until Module 5. Worth knowing before handing someone
that role to test with.

### Still open, and not a defect

**Nothing writes a `consumption` movement.** Stock only ever goes down by hand. The system
logs what was *ordered* and not what was *used*, which is half of what it is for. That is
[files/production-tracking-2026-09.md](files/production-tracking-2026-09.md) — a schema
proposal, reviewed but not built, and several steps rather than one because it changes
`stock_movements`.

---

## 2026-09-26 — Production logging, step 1: the database and the fold learn to make things

Branch `month-3-production`. Design: [files/production-tracking-2026-09.md](files/production-tracking-2026-09.md),
with the client's choice of **dough held as stock** confirmed on 18 September.

**194 tests → 213, 0 skipped. Typecheck clean, `next build` 0.**

This step makes production *possible* and nothing more. The database can hold a batch
and a stocked recipe, and every existing reader of the ledger handles both correctly.
Nothing writes a production run yet; that is step 2.

### What landed

- **Migration 0007.** `production` joins `movement_type`; `recipes.stock_ingredient_id`
  links a recipe to the ingredient row that holds its output; `production_runs` records
  each batch with every yield snapshotted. Two ledger checks widened from
  purchase-only to purchase-or-production, and renamed so the names stop lying.
- **`production_runs` is append-only**, by the 0006 trigger pattern and the same
  maintenance hatch. Added to `scripts/clean-test-data.ts` and to both the row counts
  and the trigger check in `deploy/restore-check.sh` - three places a new table has to
  be registered, not one.
- **`applyMovement` folds production through the purchase branch, unchanged.**
- **`loadCostLookup` counts a batch as a cost basis.** Without it, dough that was made
  and never bought has stock and a weighted average and still raises `MissingCostError`
  in every recipe that draws on it. Verified by reverting it and watching the test fail.

### The fold had to move in the same step as the schema

The plan put the arithmetic in step 2. It could not wait: `applyMovement` threw on any
non-purchase movement carrying a cost, so the moment the database admitted a costed
production row, `recalculateStock` would have thrown on it. A schema-only step 1 would
have been a database that accepts rows its own cache cannot fold.

Paper cases **T13-T18** were written and hand-computed *before* the fold changed, and five
failed first, as they should. T15 pins that a batch's cost divides by **actual** yield: a
short batch makes dearer dough, and dividing by the recipe's promise would price the
missing 400 g as free. T18 is the whole argument in one assertion - a batch and a
delivery of the same size and price fold identically, so production cannot grow a second
arithmetic without this test noticing.

### The enum trap

Postgres refuses to use an enum value inside the transaction that added it. The
generated migration adds `production` and builds a check naming it in one go - and the
drizzle migrator runs **every pending migration in one transaction**, so splitting the
files would not help. Read from `node_modules`, not assumed.

The replaced checks compare `movement_type::text`. Proven both ways rather than argued:
with the enum form restored, the real migration run against an empty database failed with
`unsafe use of new value`; with `::text`, all eight migrations applied in a single
transaction. It is in AGENTS.md now, because the same trap waits for anyone adding a role
or a unit type.

*A correction to what I said at the time:* I first told the user this would have passed
locally and broken only the first fresh deploy. Probing showed it fails on **every**
database, fresh or existing, so it would have been caught on the first `db:migrate`. The
workaround is still required; the severity was overstated.

### Checked against the real data

0007 ran against the café's own tenant - 215 movements, 139 recipes. `ADD CONSTRAINT`
validates every existing row, and a direct query confirmed zero rows violate either new
check. No recipe is stocked yet, as expected: the client still has to say which ones are.

### Next, and what it needs

Step 2 is `recordProductionRun()` and the sign-safe quantity rounder AGENTS.md has been
deferring to "when Month 3 writes consumption movements". Paper cases first again.

Before step 3 is *useful*, the client needs to say **which recipes are stocked**. The
mechanism works with none flagged; it just has nothing to do.

---

## 2026-09-26 — Production logging, step 2: the data layer can make things

Branch `month-3-production`. **213 tests → 241, 0 skipped**, stable across three full runs.
Typecheck clean, `next build` clean, `drizzle-kit generate` reports no schema drift - this
step needed no migration.

A recipe can now be given a shelf (`stockRecipe`) and a batch logged end to end
(`recordProductionRun`): its inputs drawn out of the store, its cost worked out, its yield
put on the shelf. There is no screen; that is step 3.

### Paper cases first, again

**M1-M10** were written and hand-computed before `src/lib/production.ts` existed, and
failed first. Then they were reproduced through the real write path - `recordReceipt`,
`saveRecipe`, `stockRecipe`, `recordProductionRun` - and came out to the same paise: a
dough batch costs **Rs 389.18** and shelves 4.1 kg at **9492 millipaise/g**; rolls drawing
2.16 kg of it cost **Rs 264.48** and touch no flour.

Each guard was then broken on purpose and watched fail, by exactly the case written for it:

| Sabotage | Caught by |
|---|---|
| Round an issued quantity twice instead of once | M9 |
| Check "unpriced" before "burnt" | M4b |
| Read prices BEFORE taking the locks | the forced interleaving: `38918n !== 41493n` |
| Shelve the batch before its draws | M1: "shelved last, in ledger order" |

### The sign-safe quantity rounder has landed

AGENTS.md has deferred it since Month 1 to "when Month 3 writes consumption movements".
`issuedMilliBase` rounds the POSITIVE amount issued, once, and the ledger gets its exact
negative. Rounding the signed value has no single answer - `Math.round(-23062.5)` is
`-23062` in JavaScript and `-23063` in Postgres - so a consumption and its reversal could
fail to cancel depending on which function somebody called.

### Prices are read under the locks

The run plans its structure without reading a price, locks every row it touches, and only
then reads prices through its own transaction. Read first, and a delivery committing in
between leaves the batch costed at the old price while the ledger records the draw after
the new one. The forced-interleaving test holds a dearer butter delivery open on its lock,
starts a run, and releases the delivery: the batch is costed at the new average, and the
ledger agrees the draw came after the delivery.

### Found on the way

- **`istDayStart` accepted dates that do not exist.** `new Date('2026-02-30...')` rolls
  over to 2 March, so 30 February passed validation - a silently wrong range on the history
  filter, and a raw database error for a run. It now requires the date to round-trip. This
  was mine, from the 26 September audit sweep; its test claimed it "drops the filter
  instead of guessing", and for impossible dates it guessed.
- **A test of mine passed by luck, one run in six.** M3 compared a run's draws in the
  order they were typed, but lines saved together tie on `created_at` and fall back to
  random ids - the loader's own comment says so. It failed as soon as it ran beside the
  other tests. Compared as a set now; the one ordering that does matter (draws before the
  shelving) is pinned separately.
- **Two schema comments had been wrong since before this step**: ledger cost columns
  "purchases only" (stale since 0007), and `reference_type`'s list of values, which named
  one nothing writes and omitted three that are written. Both checked against live rows.
- **A promise in step 1's comments was undeliverable.** The `production_runs` comment said
  a mistake "is corrected by a reversing run" - which the table's own check forbids. The
  comment now says reversal is not built, and why.

### Decided here, and recorded in the proposal

A shelf row is in kilograms, litres or units, not "one batch" - it depends only on the
unit type, never the yield, so nothing needs re-syncing. A batch is costed at materials
only. `production.record` exists now for owner and manager; step 4 adds `kitchen`.

### Open, and it will matter

**There is no way to undo a mis-logged run.** A "negative run" breaks the table's own
check, so it needs a small schema decision (likely `reverses_run_id`). Until then a
mistake is corrected per ingredient with adjustments. Worth deciding before the client
starts logging, because the first wrong entry will happen in the first week.

---

## 2026-10-10 — User selected Render + Supabase, without Docker

This supersedes the earlier E2E VPS/container deployment decision and its GHCR release
pipeline. The user selected Render's native Node.js service and confirmed that the
Supabase project has **not yet been created**. Client-owned accounts/billing still apply;
deployment remains separate from the development gates. No service was provisioned and
no live database was migrated.

Prepared `render.yaml`, Node 24 engine selection, native `next start`, a public DB
readiness route, separate migration credentials and a production `cafe_app` role. Runtime
Supabase connections verify certificates, require the CA and reject transaction pooling.
Render sessions are always Secure. The old Docker/Caddy configurations and scripts were
removed; the inventory, recipe arithmetic, tenant schema and append-only ledger were not
changed. No migration/schema proposal was needed.

CI now uses native PostgreSQL 16. Releases remain disabled unless the repository variable
`DEPLOY_PRODUCTION=true` is set; production secrets run migrations before requesting the
exact tested SHA through Render's deploy hook. Hook acceptance is explicitly distinct
from service readiness. CI also contains a disposable DB rehearsal for the non-superuser
migrator, runtime DDL refusal, first owner and native backup/restore scripts. That CI
rehearsal has not yet run.

Native backup scripts write a dump plus checksum and counts from the same exported
snapshot. Restores require an empty separate target, compare exact counts and check
append-only triggers. The first-owner script creates no sample inventory and refuses an
existing tenant. Deployment scripts are included in TypeScript and source-integrity
checks. `deploy/README.md` covers account ownership, Data API disabling, credentials,
cutover, releases, backup scheduling/off-site copies and handover.

Verification in this workspace:

- Typecheck passed, including deployment scripts.
- Production build passed (18 routes); the existing middleware deprecation warning remains.
- Full suite: **249 discovered, 148 passed, 101 DB tests skipped, 0 failed**. This does
  not replace the September live-DB verification with a claim of a new DB pass.
- Temporarily disabling the pooler and same-database restore guards caused three
  regression failures; restoring them returned all 15 targeted tests to green.
- Native production server smoke: login HTTP 200; unreachable DB health HTTP 503 with
  no auth redirect or connection details. Missing DATABASE_URL caused startup exit 1.
- The sandbox blocked Turbopack path resolution and separate localhost HTTP probes;
  the build and combined server/probe check succeeded outside it.

Still required: create the client's Supabase project/Render service, populate secrets,
run migrations and the CI rehearsal, demonstrate a live restore, arrange nightly
off-site backups and verify the staff workflows. The 8 October audit findings remain
open, and the daily production/yield UI remains unbuilt. This step prepares hosting; it
does not close those feature/correctness gaps.

## 2026-10-10 — Separate Supabase project created and migrated

The user requested another project, leaving existing Supabase projects alone, then
created `Nomeatnaan Inventory` in the `samueldcunha99` organisation. Reference:
`oqvedplcgidrvbggimnr`, Singapore, PostgreSQL 17.11. The Data API was observed disabled
before adding application tables. The session pooler host was read from Connect;
the certificate was downloaded from the dashboard's exact link, and TLS verification
remained enabled. Credentials are held in the Git-ignored `.env.supabase.local`.

The empty-project check passed. Public schema CREATE was revoked from PUBLIC, all
eight existing migrations applied, and `cafe_app` was provisioned. Live verification
found twelve application tables and all four stock/production append-only triggers.
The runtime connection can read tables and has no superuser, create-role, create-db,
replication or bypass-RLS flags. An attempted CREATE TABLE failed with 42501 inside
a transaction. No tenant or business data was inserted; no previous project changed.

The user also requested a push to their new `samueldcunha99/nomeatnaaninventory`
repository and a hosting connection. First-owner email, old-data cutover, Render service,
CI and a backup/restore demonstration remain deployment work. Account ownership for
the client's eventual handover still needs to be recorded.

The user subsequently provided `support@nomeatnaan.com`. The first-owner script
created the `NoMeatNaan` tenant and owner atomically; no demo inventory was seeded.
The generated password is in the ignored `.env.owner.local`, with BOOTSTRAP variables
removed after use. The older local database remains unreachable, so this creates a
fresh app database and does not transfer its historical inventory/recipes.


## 2026-10-10 — Netlify selected after GitHub CI passed

The user selected Netlify Free instead of Render to avoid Render idle suspension, then
created nomeatnaaninventory and connected the inventory GitHub repository. The initial
Netlify build at b6730a8 failed during page collection because DATABASE_URL was absent.
Prepared netlify.toml with a build-only placeholder, Node 24 and native Argon2 packaging;
private runtime configuration stays outside Git. The runtime pool is one connection
per instance. Secure cookies and startup loopback refusal now support Netlify.
A platform source-IP/domain POST limit supplements ephemeral in-memory account counters;
shared per-account lockout still needs an approved storage decision. The Render
configuration and deployment hook/job were removed. No business schema changed.

GitHub CI run 38050087973 at b6730a8 completed successfully: native PostgreSQL tests with
a skipped-test guard, the production build and disposable migration/privilege/first-owner/
backup/restore rehearsal. This is separate from a live Supabase restore. The Netlify
changes passed typecheck, 29 targeted tests and the production build locally.
Netlify runtime configuration, final deployment and live HTTPS checks are still pending.

## 2026-10-10 — Netlify deployment and HTTPS owner checks passed

Saved all eight runtime variables through the Netlify project UI, with the restricted
cafe_app session-pooler connection and verified TLS CA. Administrative, bootstrap and
owner passwords were not uploaded or committed. Pushed application commit
`c633ad2aa2464c1748d00f46008055bbebb54d76` to inventory/main. Netlify published deploy
`6aca38cc947b9f0008b322a7` in 39 seconds at
https://nomeatnaaninventory.netlify.app/. Its post-processing log accepted the shared
IP/domain rule for all POST paths, with a 30-request/180-second window.

Live verification: `/api/health` returned 200 with status ok; login returned 200;
anonymous ingredients access redirected to login. Owner login using the locally held
password returned 303 and a Secure, HttpOnly, SameSite=Lax session cookie. Dashboard,
ingredients/list/new, receipt, adjustment, movement history, low stock, recipes/list/new,
user settings and costing settings all returned 200 for the owner. Sign-out returned 303
and the revoked token redirected to login. No demo business data was created. An initial
smoke assertion used the wrong cookie name; reading the app's session-cookie constant
corrected the probe, with no application change required.

Thirty unsupported POSTs to the health route returned 405; request 31 returned 429,
proving the platform guard blocks without mutating inventory. Temporarily removing the
Netlify startup loopback guard caused its regression test to fail; restoring it returned
all 13 environment tests to green. GitHub CI run 38054582472 completed both test and build
jobs successfully, including native PostgreSQL, the skipped-test guard and the isolated
migration/privilege/first-owner/backup/restore rehearsal.

This verifies hosting and owner access, not historical-data migration or a live Supabase
restore. The older database remains unreachable. Nightly off-site backups, client account
ownership/recovery details, staff workflow acceptance, audit fixes and the daily
production/yield screen remain outstanding. Netlify function cold starts and provider
Free-tier usage/inactivity limits still apply. A documentation-only follow-up commit uses
`[skip netlify]` to retain the already verified application deployment.

## 2026-10-10 — Online navigation performance update prepared

The owner reported slow page changes on Netlify. Three authenticated HTTPS rounds
against the deployed app measured dashboard responses at 4.75/4.30/4.22 seconds and
recipes at 3.02/2.92/2.93 seconds; response bodies added approximately one millisecond.
This is server response delay, not evidence of a large asset download. No browser
Core Web Vitals measurement was available. Netlify's default Ohio function region is
far from the Singapore database; changing function region requires a paid plan, so
the requested Free setup remains unchanged.

The single recipe graph loader now joins live recipes to their live lines in one
statement, retaining empty recipes and tenant isolation. Recipe update timestamps
travel in that read rather than another query. An empty catalogue needs no cost lookup
or overhead read; a populated catalogue uses three reads instead of five. Dashboard
reads start together after authentication. Sidebar links show pending feedback through
Next.js useLinkStatus, with an accessible status and reduced-motion support. Session
validation, cost freshness, missing-cost errors and the pure costing fold are unchanged.

Added a database regression for a recipe whose only line is deleted, its update stamp,
deleted recipes and another tenant. Local typecheck, the production build and all 34
targeted costing/source-integrity tests passed. The database regression must run in
GitHub CI's isolated PostgreSQL, not the client database. Deployment, exact-commit CI
verification and before/after online measurements are pending at this entry.

## 2026-10-10 — Navigation update deployed and measured

Pushed application commit `97d34f274c394b6ef00ee8bd797584a664cb1ca0` to inventory/main.
GitHub CI run `38057547950` completed test and build jobs successfully, including the
new joined-graph regression, the skipped-database-test guard and the isolated deployment
rehearsal. Netlify serves the new workspace bundle containing navigation feedback.

Repeated the same authenticated HTTPS measurement, three rounds per page, then signed
out. Median response-body completion changed from 4.30 to 3.02 seconds for the dashboard
and from 2.93 to 1.25 seconds for recipes. New dashboard rounds were 3.02/2.42/4.23
seconds, so response variation remains material. Ingredients stayed about 1.3-1.4 seconds,
staff about 1.2-1.3 seconds, and movement history had one 3.73-second outlier. These are
small-sample server response timings for the current empty catalogue, not browser paint
metrics or a promise for populated catalogues.

The online browser showed an immediate "Opening Overview" status while retaining the
current page, then opened Overview and cleared the status. Movement history behaved the
same way, with the visible spinner captured in the local verification screenshot.
No inventory, recipe, account, schema or hosting-plan changes were made by these probes.
Remaining network and function-start delay is not hidden by cached session or cost data.

## 2026-10-10 - Recipe workbook imported with explicit yields

The owner requested the No Meat Naan shop Product Recipe workbook import and clarified
that only recipes with explicit yield units should be added. They also corrected
"browni" to "brownies". Read both sheets without changing the workbook and preserved
source titles, rows and yield wording in recipe notes. Clear spelling errors were
corrected; duplicate recipes keep separate version names.

Imported 19 complete recipes with 154 lines and 57 ingredient records into the
NoMeatNaan tenant through createIngredient and saveRecipe, using Zod validation,
the active owner and restricted runtime credentials. No schema, authentication,
ledger, purchase price, selling price or hosting changes were made. Untimed batches
remain null; all recipe costs correctly report missing purchase history.

There are 226 pending entries because of absent/unclear yield units, missing/unclear
quantities or unresolved preparation versions. No ice-cup, pinch, teaspoon or drop
weights were guessed. The detailed source-cell review, extraction and recovery
manifest are local files under files/recipe-import-*. No client workbook data or
credentials were pushed to GitHub.

Nine planning tests passed. A temporary copy restoring the unit-name mutation bug
failed the intended regression, proving the guard. Saved names, yields, source IDs,
quantities and wastage values were checked through the one recipe graph loader.
The live app shows 19 recipes, 57 ingredients and the corrected Brownies versions;
stock movements and menu items remain zero. Browser verification screenshot is local.

## 2026-10-14 - Continued workbook reconciliation

Resolved the focaccia yeast entries from an explicit equivalent written in the same
recipe, scoped to that ingredient and exact spoon amount. Imported one recipe and
three ingredients through the existing validated app writers. Totals are now 20
recipes, 60 ingredients and 165 recipe lines. There are 225 pending workbook entries.
The owner confirmed the Graham cracker flour quantity; its yield unit remains
unconfirmed. Conflicting namelaka yields remain pending. Corrections and manifests
stay local. Thirteen planning tests passed, and removing ingredient identity in a
temporary copy made the scope regression fail. Stock movements and menu items remain
zero; no purchase prices were invented.

## 2026-10-14 - Metric entry controls prepared

The owner requested metric options they can enter themselves in the app. Recipe batch
yields now offer g, kg, ml, L and pieces; ingredient lines offer compatible units.
Switching g/kg or ml/L preserves the exact amount, while changing measurement type
clears the field for a fresh entry. Units are submitted and checked server-side before
conversion through the existing integer input boundary. Stored quantities remain
canonical milli-base, with the existing permission, tenant, graph and costing guards.
No schema change was needed.

All 25 targeted quantity, unit and source-integrity tests passed, as did typecheck and
the production build. Removing the dimension guard in a temporary copy failed the
intended regression. Browser testing converted a focaccia ingredient from grams to
kilograms and saved it. A read-only reload through the graph loader verified every
quantity, source ID, yield and wastage value matched the imported recipe exactly,
with no stock or menu changes. The browser also exposed repeated React keys in the
existing missing-cost list, now distinguished per occurrence. Online deployment and
exact-commit CI verification remain pending at this entry.

## 2026-10-14 - Metric controls deployed and verified

Published application commit c3cae6c8ec5a5af53ac4f5b3b2ef9cd12c8eb632 to inventory/main.
GitHub CI run 38449970338 completed its test and build jobs successfully, including
isolated PostgreSQL tests, the no-skipped-tests guard and deployment rehearsal.
Netlify now exposes the new metric controls on new and existing recipes.

Verified kilogram ingredient entry and litre batch/ingredient entry in browser forms.
The online app saved 0.8 L as the original 800 ml yield. A final read-only comparison
of all 20 imported recipes and 60 ingredients through the graph loader matched their
source IDs, exact quantities, yields and wastage values. Stock and menu counts stayed
zero. Local build/typecheck and 25 targeted tests passed. No workbook/import data or
credentials were published. The unresolved source measurements remain in the local
review, ready for the owner to enter using the metric fields.

## 2026-10-15 - Daily production and date reports built

The owner requested date-based purchases, batch counts and material usage. Added
/production with recipe/batch selection, metric measured output, expected-yield and
material previews, notes, and an explicit option to hold preparations in stock.
/reports combines receipts, saved batch/output/cost snapshots, ledger material usage,
yield variance and separate wastage; an optional recipe filter applies to production
and its materials. Backdated production usage follows produced_on, while purchases
and separate waste use Kolkata entry-day boundaries. Reports use one read-only
repeatable-read snapshot and tenant-scoped joins. No schema change or alternate
stock/cost arithmetic was introduced.

Production forms carry a request ID to prevent duplicate consumption on retries,
including concurrent submissions, plus the displayed recipe version and yield type.
Number-storage bounds reject quantities that cannot remain exact. Existing sorted
ingredient locks and the lock-before-cost-read order are preserved. Owner/manager
checks apply to pages and actions; the cost report also checks recipes.view.

The production build and typecheck passed, as did 27 targeted tests. Deliberately
merging historical grams and millilitres made the new unit-grouping regression fail;
restoring the guard made it pass. Nine new isolated-DB tests cover late entries,
historical snapshots, Kolkata day edges, tenant/role scope, prepared-stock usage,
concurrent retries, stale recipe forms, unit changes and exact storage bounds.
CI database verification and online deployment remain pending at this entry.
No test purchases or production runs were added to the client database.

## 2026-10-15 - Daily production and reports deployed and verified

Published application commit 80aaa49de3e854c845f754141f6895d2d02b4976 to
inventory/main. GitHub CI run 38716783091 completed both test and build jobs
successfully, including the isolated PostgreSQL suite, no-skipped-tests guard and
disposable deployment/backup/restore rehearsal. No schema migration was needed.

Netlify now serves both screens and their sidebar links. Owner sign-in passed,
as did the online 1.5-batch material preview and exact 1100 ml to 1.1 L conversion.
The report loaded successfully and applied a previous-day date plus recipe filter.
The live readiness endpoint returned 200 with status ok, and the report browser
recorded no console errors. Screenshots remain local under files/daily-*-live-*.jpg.

No production, receipt, waste or stock-setting mutation was submitted against the
client database. Populated reporting, stock writes, concurrency, historical totals
and denied roles were exercised in isolated PostgreSQL CI. Reports therefore start
empty until real receipts and production are entered. Purchase prices still need
real receipts; unpriced made-to-order runs retain an unknown cost. Run undo and
unstocking remain separate schema/design work, explicitly disclosed in the UI.
