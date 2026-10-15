# Cafe Management System — No Meat Naan

Internal management system for a single-outlet cafe and bakery in Chhatrapati
Sambhajinagar, Maharashtra. Ingredient-level cost visibility, self-maintaining inventory,
order management, and a customer-facing tracking page. Five-month build.

**Month 1 and Month 2 complete; daily production and reporting screens are built.**
The user selected **Netlify Free + Supabase without Docker on 10 October 2026**,
superseding the earlier Render choice. The app is live at
[nomeatnaaninventory.netlify.app](https://nomeatnaaninventory.netlify.app/), connected to
the dedicated Supabase database. GitHub CI passed its live database tests, production build
and disposable backup/restore rehearsal at deployed commit `c3cae6c`. Historical
241-test DB verification and current results are distinguished below.

---

# HANDOVER — read this first

You are picking up a project you have no memory of. Everything you need is in this
repository. Nothing important lives in a chat log.

## Where the project stands

| | |
|---|---|
| Month 1 — foundations & inventory | ✅ **complete**, steps 1–7, verified against live Postgres |
| UI styling pass | ✅ complete, all 9 internal screens, Tailwind v4 |
| Deployment configuration | Netlify Next.js adapter + Supabase PostgreSQL; CI uses native PostgreSQL |
| Live deployment | Netlify serves c3cae6c; metric recipe input and online saves verified |
| Month 2 step 1 — recipe / menu schema | ✅ **done**, migration 0002 |
| Month 2 steps 2–4 — costing engine | ✅ **done**, paper cases P1–P22 |
| Month 2 step 5 — costing screens and editors | ✅ **done**, recipe list, cost breakdown, what-if, and the recipe / line / menu-item editors |
| Daily production and reports | Built at `/production` and `/reports`; deployment verification in progress |
| Trunk | `main`. Everything is merged; `month-2-costing` is merged and safe to delete. |
| Tests | Historical: 241 passing against live PG. Last full local run: 249 tests, 148 pass, 101 DB skips; latest isolated PostgreSQL CI passed |
| Current deployment verification | GitHub CI run 38449970338 passed; see the dated 14 October entries in PROGRESS.md |

## Verified against a live database vs merely built

This distinction matters more than it sounds. **Do not conflate them, and never report
one as the other.**

**Verified against live Postgres** — schema and all three migrations, the weighted-average
cost engine against hand-computed paper cases T1–T12, ledger replay equalling the
incrementally maintained cache, multi-line receipt atomicity, session expiry and
revocation, role enforcement at the database layer, cross-tenant isolation on every query
module, ingredient CRUD, receipts, adjustments, wastage, movement history, low stock.

Added in Month 2: the recipe costing engine against paper cases P1–P22, every value
re-derived independently *before* implementation; the ten recipe/menu constraint
violations the database must refuse; the four cost-basis cases; a nested recipe costed end
to end from real purchase history; and the butter-price demo — a second delivery moving the
weighted average and the item recosting.

**Built and type-checked but never exercised by a human** — most of the UI. Every page
compiles and every server action is tested at the function layer. The recipe list and the
cost breakdown *were* driven in a real browser against seeded data, including the what-if
and all three failure states, but **no form has been filled in by hand end to end.** That
is still where undiscovered defects are.

**Hosting verified on 10 October** — Netlify published `c633ad2` from
`samueldcunha99/nomeatnaaninventory`. HTTPS readiness returns 200 against Supabase;
owner login, all 11 checked pages, Secure/HttpOnly cookies and sign-out passed. The
platform POST limit was observed returning 429 on request 31. Runtime credentials are
stored in Netlify, outside Git. GitHub CI exercised its isolated DB restore rehearsal.
This is a fresh database: historical inventory/recipes were not transferred, and a live
Supabase restore, scheduled off-site backups and staff workflow acceptance remain open.

The navigation update at `97d34f2` reduces recipe database reads and shows immediate
sidebar pending feedback. Three online rounds with the empty catalogue measured median
responses of 3.02 seconds for Overview and 1.25 seconds for recipes, previously 4.30
and 2.93 seconds. Function/network delay still varies; session and costing reads remain
fresh. Its isolated PostgreSQL tests and production build passed in GitHub CI.

On 14 October, metric input was added to recipe batch yields and ingredient lines:
g, kg, ml, L and pieces, with compatible units for each ingredient. Unit changes preserve
exact quantities. Kilogram and litre saves were exercised in the browser, and a read-only
comparison confirmed that all imported quantities stayed unchanged. CI passed at
`c3cae6c`. The workbook import now contains 20 recipes and 60 ingredients; 225 entries
still need explicit measurements or preparation choices. Purchase prices remain unset.

## What is gated, and on what

### Daily production and reports

Owners and managers use **Daily production** to select a working date, recipe, batch
count and measured output (g/kg, ml/L or pieces). The preview calls the same pure planner
as the stock writer. Recording atomically saves the run and deducts its materials;
repeating the same form cannot deduct them twice. Recipe changes while a form is open
require a refresh. Runs cannot yet be edited or undone.

**Daily reports** accepts a date and optional recipe filter. It shows purchases and
money paid, batch counts, expected/measured output, yield variance, saved material costs,
ingredient/component usage, and separately entered wastage. Purchases and separate losses
use their entry date in Asia/Kolkata. Production and its material deductions use the day
the batch was made, including late entries. Usage reads the ledger and costs read saved
snapshots; neither is recalculated from the current recipe. Unknown costs stay unknown.

The recipe filter applies to production and its materials; purchases and wastage cover
the whole day. A stocked preparation consumes its ingredients when made, and a parent
uses that preparation's shelf quantity. Reports keep those rows separate, without
counting the raw ingredients twice. Marking a recipe **Hold in stock** affects future
runs only and cannot currently be reversed. The purchase price of every input must be
recorded before a stocked batch can be valued. `/production/YYYY-MM-DD` opens that day's
report. No schema migration is needed for these screens.

## Remaining handover items

**Provisioning is no longer a gate** (changed 2026-08-21). Blocking a month of schema and
costing work on an account that is a week or two out was the wrong trade. The deploy step
stays stubbed; everything else runs locally against our own Postgres. **Do not
re-introduce the gate.**

**Still outstanding:** the owner exercising the multi-line receipt form by hand.

The production accounts must be created by the client, in
the client's name, on the client's payment method. This is contractual, not a preference,
and it is unchanged. The managed deployment and handover steps are in
[deploy/README.md](deploy/README.md). Use a separate database project for demos and tests.

## Working rules

These were agreed with the client and are not optional.

1. **Stop at step boundaries.** Do not run three steps together because they seem small.
   The client reviews between steps, and that review is what has caught most defects.
2. **Propose the schema before writing code that depends on it.** Every schema mistake
   costs ten times more later. Wait for approval.
3. **Never invent verification results.** If you cannot run something, say so plainly.
   "I could not verify this because X" is always acceptable; a confident claim that turns
   out to be untested is not.
4. **Delete your own out-of-scope code.** If you write something that is not needed yet,
   remove it rather than leaving it "for later".
5. **Prove a guard fails before trusting it.** Plant the defect, watch the test go red,
   remove it, watch it go green. A guard nobody has watched fail is not yet a guard.
6. **Check the premise.** If an instruction does not match what you observe in the repo,
   say so before acting. Remote `main` was once described as up to date when it was nine
   commits behind; checking rather than accepting is what caught it.
7. **Read `AGENTS.md` before writing anything.** It exists so defects are not repeated.

## The failure mode to fear

**Not a crash. A confident, plausible, wrong number.**

Three have already occurred, and none of them threw:

- a recipe costed against an ingredient with no purchase history, silently reading zero;
- a running balance that restarted inside a date filter, reading like a stock level while
  actually being a subtotal;
- a stock figure compared lexicographically because a SQL aggregate came back as a string,
  where `'900' > '4850000'` is `true`.

Tests that assert behaviour catch these. Type-checking does not.

## Month 2 decisions already made — do not relitigate

All approved by the client. Reasoning is in AGENTS.md; do not re-derive it. Six of the
eight are now built — the status on each says which, and a built decision is still not
open for relitigation.

1. ✅ **BUILT — Costing takes its cost lookups as a parameter.** The costing function must never
   reach into `ingredient_stock` itself. This one seam serves the what-if price demo,
   historical "as at seq N" costing for Month 3 snapshots, and re-runnable catalogue
   recalculation. Do not "simplify" it into a self-fetching function.
2. ✅ **BUILT — Missing cost data throws.** An ingredient with no purchase history has an *unknown*
   cost, never zero. Viewing or saving a recipe cost must be impossible where any input
   lacks a cost basis, and the failure names the ingredients.
3. ✅ **BUILT — `recipe_lines` carries `tenant_id`**, even though PROJECT-SPEC § 5 omits it. The
   spec's own § 2.3 rule is the stronger statement.
4. ⬜ **STILL OPEN — Build the historical cost lookup now, while the fold is pure.** `replayLedger()` has
   no "as at seq N" variant yet; Month 3's cost snapshot needs one.
5. ✅ **BUILT — Unit compatibility is validated at save time.** Nothing currently stops a sub-recipe
   yielding 4.2 kg from being consumed as millilitres. No FK can express it.
6. ✅ **BUILT — Cycle and depth detection is real scoped work**, with its own tests — a recursive CTE
   at save time. Not a footnote on another ticket.
7. ♻️ **SUPERSEDED for Month 2 — a separate sign-safe rounder for the wastage multiplier.**
   Costing keeps the wastage factor inside the numerator, so it never materialises a
   wastage-adjusted quantity and there is nothing to round. Month 3 still needs the rounder
   for signed ledger quantities, and `divRoundHalfUp` still refuses negative numerators by
   design — do not relax it.
8. 🚫 **STILL A BLOCKER — Ledger snapshotting, on Month 3 order confirmation.** 87 ms fetch+fold at
   50k movements; an order touching 5 high-frequency ingredients adds ~0.4 s to
   confirmation. Must land before order confirmation goes live.

## Reading order

1. **`files/PROJECT-SPEC.md`** — scope, modules, build sequence, out-of-scope list. The
   client-facing source of truth. It is a *working document*: where it conflicts with
   AGENTS.md, AGENTS.md records the decision and why.
2. **`PROGRESS.md`** — state, open blockers, and a dated append-only log of every step
   with its reasoning. **Never rewrite an entry**; supersede it with a new one.
3. **`AGENTS.md`** — the conventions you must not break. Non-negotiable.
4. This file — setup and traps.

---

## Getting running on a new machine

Requires **Node 24** (runs TypeScript natively) and a PostgreSQL connection. Use native
PostgreSQL 16 locally or a separate Supabase development project. No Docker is required.
For native local PostgreSQL, create a development role/database matching `.env.example`:

```text
psql -U postgres -c "CREATE ROLE cafe LOGIN PASSWORD 'cafe';"
createdb -U postgres -O cafe cafe
```

These are development credentials only. Then copy `.env.example` to `.env`, set the
connection (and Supabase CA if applicable), and run:

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Then sign in with the seeded owner account. `SEED_OWNER_PASSWORD` is required unless
`NODE_ENV=development`; the seed refuses to run without it rather than creating an
all-permissions owner with a password published in this repository.

Run the tests against an isolated development database, never production:

```bash
npm test
```

**249 tests should pass with 0 skipped when PostgreSQL is reachable.** If you see skips, Postgres is not reachable —
the database tests skip loudly rather than passing quietly, and a green run full of skips
is not a pass.

## Deploying without Docker

Use [deploy/README.md](deploy/README.md) for Netlify configuration, Supabase connection,
data cutover, first owner, releases, backups and handover. The existing
server-side authentication and Drizzle queries stay in place; Supabase hosts PostgreSQL.
The Data API must be disabled for this server-only integration.

Startup checks name missing variables, enforce the production Supabase runtime role and
reject transaction-pooler connections. The web service needs no seed or admin password.
Migrations use separate administrative credentials before dependent code is pushed.
Netlify's Git integration deploys main independently of the GitHub CI result.

For a native local production-build check, run `npm run build`, then `npm run start`.
Native local production may use localhost; Netlify must use the remote database.
## Traps

- **Restart the dev server after a PostCSS or `.env` config change.** A running Next
  server does not pick up a newly added `postcss.config.mjs`; it will serve unstyled
  Times New Roman until restarted. This wastes twenty minutes if you do not know it.
- **The build stage passes a placeholder `DATABASE_URL`.** `next build` imports every page
  to collect its data and would otherwise fail with no database configured. The
  placeholder is scoped to the build command, and
  `instrumentation.ts` checks the real value when the server starts.
- **Keep admin credentials out of Netlify.** Store them in a secure local migration
  shell; the app uses `cafe_app`.
- **Read generated migration SQL before committing it.** drizzle-kit emits
  `CREATE UNIQUE INDEX` *after* the `ADD CONSTRAINT … FOREIGN KEY` block, so an FK
  pointing at a unique **index** produces SQL that fails on first run. Composite tenant
  keys therefore use `unique()` constraints, emitted inline in `CREATE TABLE`. Keep it
  that way.
- **Never cache a number computed over missing data.** The costing cache once stored a
  rate calculated with a zero placeholder for an uncosted ingredient. A parent recipe
  reading that cache found nothing missing in its own walk and would have returned a
  confident, plausible, wrong total *instead of* the error. Guarded now, and pinned by P22
  — but the shape of the mistake generalises: a fallback value that escapes into a cache
  stops being a fallback and becomes a fact.
- **Do not "correct" the nested rounding.** A sub-recipe's rate is rounded before its
  parent uses it, deliberately, so the displayed breakdown adds up. It looks like a
  violation of "round once at the end" and is not. AGENTS.md § *Nested rounding* explains
  why; P7 fails loudly if someone changes it.
- **Prefer the editing tools over scripted string surgery on source files.** A scripted
  edit once wrote NUL bytes into `src/db/stock.ts`; a later replace against that file then
  matched nothing, changed nothing, and left `tsc` passing while a feature shipped absent.
  If a script really is the right tool, make it assert that its replacement matched.
- **`src/lib/source-integrity.test.ts` fails the build on NULs, BOMs, zero-width
  characters and CRLF.** If it goes red, an invisible character has been introduced —
  fix the file, do not weaken the guard.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm test` | Test suite (`node --test`, no framework) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `next build` |
| `npm run db:generate` | Regenerate migration SQL from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed tenant, owner, suppliers, ingredients + opening stock |
| `npm run db:bootstrap-owner` | Create first tenant/owner in an empty DB, no sample data |
| `npm run db:backup` | Native PostgreSQL snapshot dump with checksum/count manifest |
| `npm run db:restore-check -- <dump>` | Restore into a separate empty target and verify |
| `npm run bench:replay` | Ledger replay cost against the live database |

## Layout

```
files/PROJECT-SPEC.md   client-facing spec. Read first.
PROGRESS.md             state, blockers, dated log. Append-only.
AGENTS.md               conventions and the reasoning behind them.

drizzle/                generated migration SQL, checked in
src/db/schema.ts        the schema. Read its header before touching a number.
src/db/stock.ts         recordMovements / recalculateStock — the ONLY insert path
src/db/movements.ts     receipts, adjustments, wastage
src/db/history.ts       movement history + low stock. Read-only, always.
src/db/ingredients.ts   ingredient master
src/db/users.ts         user administration
src/db/auth.ts          session store, password verification
src/db/errors.ts        driver-error translation (constraint name → operator message)
src/db/recipes.ts       THE ONLY loader of recipe_lines + cost lookup + saveRecipe
src/db/seed-data.ts     seed data, no DB dependency, unit-tested

src/lib/units.ts        input and display boundary: parsing, conversion, formatting
src/lib/stock.ts        weighted average cost. Pure. The only copy of this arithmetic.
src/lib/costing.ts      recipe costing. Pure, no DB import at all. Paper cases P1-P22.
src/lib/auth.ts         roles, permissions, token hashing. Pure.

src/auth/server.ts      requireSession / requirePermission — the enforcement point
middleware.ts           redirect only. NOT access control.

app/globals.css         design tokens in @theme. Every colour in the app comes from here.
app/ui/                 shared presentational components
app/                    login, home, ingredient and stock screens
app/recipes/            recipe list and the cost breakdown (no editors yet)
scripts/bench-replay.ts ledger replay benchmark
netlify.toml            Next.js build and native addon packaging
netlify/edge-functions/ shared source-IP limit for POST requests
deploy/                 deployment, first owner, native backup/restore and handover
```
