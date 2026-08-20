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
| 0 | Dockerfile, app service in compose, CI image build | ✅ **done** |
| 0b | Deploy to a real VPS | ⏸️ **deferred, does not block** — written and stubbed, awaiting the E2E account |
| 1 | Recipes, recipe_lines and menu_items schema (with tenant_id) | ✅ |
| 2 | Cost lookup seam + missing-cost errors | ✅ |
| 3 | Sub-recipes: yield, cycle and depth rejection, unit compatibility | ✅ reachable through `saveRecipe` |
| 4 | Wastage multiplier + sign-safe quantity rounder | ✅ multiplier done; the rounder is Month 3's, see the superseded risk item |
| 5 | Cost breakdown and margin views | 🟡 list + breakdown + what-if done; editors not built |

**Gate (revised 2026-08-21): the owner exercises the multi-line receipt form by hand.
Provisioning is no longer a gate.** Steps 1-5 run locally against our own Postgres exactly
as Month 1 did. See the log entry for 2026-08-21.

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
