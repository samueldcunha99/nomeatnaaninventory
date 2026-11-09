# Cafe Management System — No Meat Naan

Internal management system for a single-outlet cafe and bakery in Chhatrapati
Sambhajinagar, Maharashtra. Ingredient-level cost visibility, self-maintaining inventory,
order management, and a customer-facing tracking page. Five-month build.

**Database migration preparation - 9 November 2026:** the user selected a USD 20/month
budget and DigitalOcean Managed PostgreSQL. The PostgreSQL 17 Standard creation form
is configured at USD 15.15/month before taxes in NYC3, near the verified Netlify IAD
Functions region. Creation awaits the user's billing step; Supabase remains live.
Verified-CA/restricted-runtime checks now support DigitalOcean, and native backup/restore
refuses pool aliases. All 397 isolated tests and production build/typecheck pass.
See [the migration runbook](deploy/DIGITALOCEAN.md) for current status and cutover steps.

**Stock file import - 9 November 2026:** owners/managers can use **Ingredients →
Import stock file** to download a CSV template, preview up to 100 ingredient rows and
confirm an ingredient list, opening valuation or delivery. New ingredients and stock
save atomically through the existing writers; the same file/mode/reference cannot
duplicate stock. Missing prices are never assumed free. No schema migration.
395 isolated PostgreSQL tests, 12 compiled upload/confirmation/access workflows and
production build passed. Browser upload, template download, duplicate protection and
English/Hindi/Marathi were verified. Published `8995aa3`: CI test/build/recovery and all
67 live language/page/preview checks pass, with zero live business writes. See
[stock import notes](files/STOCK-IMPORT-2026-11-09.md).

**Full-flow audit - 8 November 2026:** fixed stale measurement/pack handling in stock
forms (including concurrent ingredient edits), exact-number limits, invalid ingredient
threshold handling and lost form drafts after validation errors. Published `a608f0a`:
382 local/CI tests passed, zero skipped; 47 compiled form workflow groups, 63 live
page/language checks and populated deployment/recovery rehearsals passed. Current npm
audit reports zero vulnerabilities.
Production remains transaction-empty; all test business writes used isolated databases.
See [the full-flow QA report](files/FULL-FLOW-QA-2026-11-08.md) for scope and evidence.

**Page tutorials - 8 November 2026:** every rendered page now includes a short
explanation and an expandable step-by-step guide in English, Hindi and Marathi. Guides
cover inputs, stock/payment effects and the next action; manager-only steps are hidden
from counter staff. The production day shortcut uses its destination report's guide.
Published application `71c5746` is verified: all 373 CI tests passed, build/recovery checks
passed and 63 live tutorial page/language checks passed without business writes. See
[tutorial notes](files/PAGE-TUTORIALS-2026-11-08.md).

**Trial clean start - 8 November 2026:** at the user's request, the live catalogue was
archived after a fresh backup, successful local restore and cleanup rehearsal. The app
now shows zero ingredients, recipes, menu items, purchases, batches and orders. The owner
account, audit history, database structure and hosting configuration are retained; all
10 old sessions were revoked. Owner login and the live empty screens passed verification.
This supersedes the active-catalogue counts below. See
[the trial handover](files/TRIAL-HANDOVER-2026-11-08.md) before cafe setup or recovery.

**Current completion work - 6 November 2026:** the nine inventory/costing/retry defects
from the earlier audit are fixed. Opening-stock valuation, append-only batch correction,
safe stock-mode changes, password administration, internal orders/POS, manual payments,
printable bills, kitchen status, private customer tracking and sales reports are built.
All **370 tests pass against isolated native PostgreSQL, zero skipped**; production
build/typecheck, 17 compiled-app workflow groups and populated backup/restore passed.
The user approved schema stages A-C; the live Supabase upgrade through migration 0012
has been applied after a verified backup and restored-copy rehearsal. Application commit
`cfc77d4` is published: CI test/build and 39 live language/page checks passed, plus both
CSV exports and secure owner login/logout. See the [current verification report](files/completion-2026-11-06.md)
and [operator guide](files/OPERATOR-GUIDE.md).
The user selected **Netlify Free + Supabase without Docker on 10 October 2026**,
superseding the earlier Render choice. The app is live at
[nomeatnaaninventory.netlify.app](https://nomeatnaaninventory.netlify.app/), connected to
the dedicated Supabase database. GitHub CI passed its live database tests, production build
and disposable backup/restore rehearsal at application commit `a7cdabd`. Historical
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
| Live deployment | Netlify serves cfc77d4; Supabase upgrade applied. Exact revision, 39 language/page checks, two CSV exports, owner login/logout and unchanged client business counts verified. |
| Month 2 step 1 — recipe / menu schema | ✅ **done**, migration 0002 |
| Month 2 steps 2–4 — costing engine | ✅ **done**, paper cases P1–P22 |
| Month 2 step 5 — costing screens and editors | ✅ **done**, recipe list, cost breakdown, what-if, and the recipe / line / menu-item editors |
| Daily production and reports | Live at `/production` and `/reports`; date, recipe and metric controls verified |
| Orders and sales | Staff POS, explicit fulfillment/tax setup, saved prices/material costs, manual payment/refund records, printable bills, kitchen board, private tracking and date-range sales/CSV |
| Corrections and access | Conservative append-only production reversal, shelf disable/re-enable, opening valuation, own password change and owner/manager staff reset |
| Trunk | Published to `main` from `codex/inventory-hardening`; later documentation-only updates do not rebuild the tested application. |
| Tests | 6 November: 370 passed, 0 failed/skipped; 17 compiled-app workflow groups passed; browser language/draft/mobile checks passed. Earlier nine audit defects now have regressions. |
| Current database verification | 13 Drizzle migrations; 19 public application tables. Real client backup restored and upgrade rehearsed before live migrations; existing business records preserved. |

Patched runtime/development dependencies were clean-installed and audited: zero reported
vulnerabilities on 6 November. The [operator guide](files/OPERATOR-GUIDE.md) explains the
real cafe setup required before its first order.

## Verified against a live database vs merely built

This distinction matters more than it sounds. **Do not conflate them, and never report
one as the other.**

The sections below retain earlier dated evidence. For the current release, use
[completion-2026-11-06.md](files/completion-2026-11-06.md). Scheduled encrypted backups
are prepared but disabled pending client keys/storage. Real customer checkout/payment
gateway and an AI assistant remain unimplemented external integrations. The client still
needs verified stock values, menu prices/stock policies, batch times and tax settings;
225 workbook entries still await actual measurements. No cafe data was invented.

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

**Workflow acceptance is still separate from automated tests.** Selected recipe edits,
costing screens and metric controls have been exercised in the browser. On 4 November,
the compiled app's actual HTTP forms were tested with a populated isolated database,
including receipts, production, reports and role restrictions. Windows browser control
stopped at its URL safety check in that run, so it does not establish visual interaction
coverage or staff acceptance. The current QA report records passing paths and failures.

**Hosting verified on 10 October** — Netlify published `c633ad2` from
`samueldcunha99/nomeatnaaninventory`. HTTPS readiness returns 200 against Supabase;
owner login, all 11 checked pages, Secure/HttpOnly cookies and sign-out passed. The
platform POST limit was observed returning 429 on request 31. Runtime credentials are
stored in Netlify, outside Git. GitHub CI exercised its isolated DB restore rehearsal.
This is a fresh database: historical inventory/recipes were not transferred, and a live
Supabase restore, scheduled off-site backups and staff workflow acceptance remained open
at that time. On 4 November an actual Supabase snapshot was successfully restored into
an isolated local target and runtime permissions were verified. Nightly/off-site backup
arrangements and staff acceptance remain open.

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

## Website languages

Choose **English**, **हिन्दी** or **मराठी** on the sign-in screen or in the workspace
header. The selection applies to navigation, forms, reports, help text and operator
messages, and is saved in that browser for one year. Changing language preserves an
unfinished form. Dates use the selected language and the existing Asia/Kolkata time
zone. Recipe names, ingredient names, staff names and saved notes keep their original
wording; quantities, currency and submitted units retain their exact values.

Translations live in `src/lib/i18n/messages.ts`, shared by server rendering and the
client language provider. Add both Hindi and Marathi whenever interface copy changes.
The coverage test checks visible text, custom validation messages, metric labels and
the translation keys; a separate guard prevents translated labels from becoming
submitted values or identifiers. Unsupported language cookies fall back to English.
Poppins includes self-hosted Devanagari glyphs. This feature needs no database migration
and uses no external translation service.

The production build and all 278 tests passed locally. Compiled-app HTTP checks covered
all 17 protected screens in each language, identical form contracts and money values,
translated validation, request isolation and authentication guards. Browser checks
verified language switching, persistence, preservation of batch inputs and notes, and
mobile controls at 320 px. These checks do not resolve the nine existing QA defects.

Published at application commit `a7cdabd`; [GitHub CI run 41821049704](https://github.com/samueldcunha99/nomeatnaaninventory/actions/runs/41821049704)
passed its test and build jobs, including the disposable deployment/restore rehearsal.
Live checks covered five protected screens in all three languages and Secure/HttpOnly
preference cookies. The browser verified Hindi login/navigation, Marathi reports and
the saved choice after reload, with no console errors or test business writes.

## Daily production and reports

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

Deployment is operational and does not gate development. The 4 November QA report lists
the costing, unit, small-batch and receipt-retry fixes required before full handover.
The owner/staff must still exercise a real delivery and production day, with actual
opening stock and costs, and compare the results manually. Production undo/unstocking,
the unresolved workbook entries and nightly off-site backup scheduling remain open.

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
