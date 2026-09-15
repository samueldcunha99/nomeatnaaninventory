# No Meat Naan — website audit
Date: 14 September 2026

**Assessment:** A substantial internal inventory and recipe-costing application, with sensible core architecture and meaningful arithmetic tests. Several correctness gaps remain around missing data, mutable units, concurrent recipe work, and database enforcement. This audit is not a full authenticated UI sign-off: PostgreSQL was unavailable in this environment.

## What the product is

The app helps the owner of a single-outlet vegetarian café/bakery understand what each recipe costs and what margin a selling price leaves. Its main workflow is:

1. Define an ingredient and its purchase unit.
2. Record a delivery and the total paid.
3. Derive stock and weighted-average ingredient cost from the movement ledger.
4. Build recipes from ingredients and other recipes, recording yield and wastage.
5. Add batch time and tenant-wide labour/kitchen rates.
6. Define menu portions and selling prices, then inspect their cost and margin.
7. Try hypothetical ingredient prices without changing purchase history.

This is **estimated recipe economics**, not actual sales profit reporting. No order records or sale-time cost snapshots exist yet. Imported opening quantities are documented as nominal until staff count the shelf; today's database contents could not be verified.

The implementation uses Next.js App Router, React, TypeScript, Tailwind v4, Drizzle and PostgreSQL. Session cookies use hashed tokens; passwords use Argon2. Money is integer paise, quantities milli-base units, and rates millipaise per base unit. BigInt handles the central arithmetic.

## What exists today

| Area | Implementation |
|---|---|
| Staff access | Login/logout, session expiry/revocation, four roles and server permission checks |
| Home | Ingredient count/value, today's deliveries, reorder alerts and uncosted recipes |
| Ingredients | Search, create/edit, brand, purchase conversion, threshold, deactivate/reactivate |
| Stock | Multi-line receipts, adjustments/wastage, movement history and low-stock list |
| Costing | Recipes/sub-recipes, yield/wastage, breakdown, what-if prices and margins |
| Editors | Recipe/line editor, menu-item portions/prices, hourly rates |
| User management | Database functions exist; no user-management page or actions in the current route tree |
| Suppliers | Schema and receipt selector exist; no supplier-management UI |
| Operations | Docker/CI configuration exists; deployment is deliberately deferred |
| Future scope | Orders, automatic sale depletion, kitchen board, tracking, online checkout, payments, sales analytics and AI assistant are absent |

There are 15 page.tsx files. README claims about user screens, never-exercised forms, route totals and the snapshotting blocker are partly stale. PROGRESS records later editor usage and completed stock snapshotting.

## Verification performed

- Read the specification, handover, project rules, current progress, route tree, mutation handlers, database modules, arithmetic, schema/migrations, tests, importer and deployment configuration.
- **TypeScript:** `npm run typecheck` passed.
- **Tests:** 165 discovered; **95 passed, 0 failed, 70 skipped** because PostgreSQL was unreachable. This does not revalidate the earlier claim of 165 passing against live Postgres.
- **Additional read-only probes:** five assertions of current edge-case behaviour passed; see [probes.mjs](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/files/audit-2026-09-14/probes.mjs>). These document defects; they are not fixes or permanent regression tests.
- **Browser:** localhost starts, login renders, empty submission displays its validation error, and unauthenticated /recipes redirects to login. At 390×844, the login layout fits the viewport. Its input fields, sign-in control and password toggle measure 44px high.
- **Build:** attempted; failed because Google Fonts could not be reached to download Poppins. This is an environment/build dependency limitation, not evidence of a TypeScript failure. Build also reports the middleware-to-proxy deprecation.
- **Unavailable:** authenticated screen walkthroughs, actual form saves, live database concurrency/constraint probes, production deployment/restore verification and a dependency vulnerability scan. Docker is not on PATH or in its standard Windows installation location; PostgreSQL is not in its standard Windows installation location. No software was installed.
- Application source and café data were not changed. Only this report, supporting probes and audit logs were added.

## Findings, ordered by impact

### 1. High — incomplete overhead can be labelled “all in”

[loadOverheadRates](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/recipes.ts:233>) returns null only when **both** rates are absent. With labour set and kitchen blank, it replaces the blank kitchen rate with zero. [The rates form](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/settings/costing/rates-form.tsx:91>) explicitly tells staff blank means unknown, while [the cost page](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/recipes/[id]/cost/page.tsx:345>) can label this partial total “Batch cost, all in”.

Example: labour ₹80/hour, kitchen blank, batch 60 minutes. The system adds ₹80 and prints kitchen ₹0.00, although the café has never asserted kitchen time is free. The resulting margin omits an unknown expense without a warning.

**Fix:** preserve each rate's missing state and propagate cost completeness through the calculation. Label partial totals explicitly. Test neither rate set, each rate set alone, both set, and explicit zero. **Evidence:** direct code path; live form save not reproduced.

### 2. High — simultaneous recipe edits can bypass graph validation

[saveRecipe](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/recipes.ts:343>) reads the graph and validates it **before** opening its write transaction. Two operators can independently save A→B and B→A against the same old graph. Both checks pass and both writes can commit, leaving a cycle. Unlike stock writes, recipe graph edits have no shared lock or serializable retry.

A resulting cycle throws outside the missing-cost handling, potentially breaking the recipe list and home page. The read-only probe proves both proposed graphs pass separately and their combined result fails.

**Fix:** serialize graph mutations per tenant before loading/validating and keep validation plus write in the same protected transaction. Add a forced-interleaving database test. **Evidence:** confirmed algorithmic counterexample; actual database interleaving not executed.

Related: [loadRecipeGraph](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/recipes.ts:56>) loads recipes and lines in independent queries. A save between snapshots can pair the old yield with new lines and temporarily produce a plausible wrong cost. Cost reads need a coherent database snapshot. PostgreSQL documents the relevant snapshot behaviour in its [transaction-isolation reference](https://www.postgresql.org/docs/18/transaction-iso.html).

### 3. High — stale receipt forms can silently change the quantity received

[Receipt conversion](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/stock/actions.ts:59>) fetches the current purchase conversion but does not compare it with the unit shown when the form opened. The receipt submits ingredient ID, quantity and price only.

Example: a form displays a 1kg bag. A manager changes that ingredient's purchase pack to 25kg. Submitting “2” from the old form records 50kg instead of the 2kg the operator intended. The unit-cost preview was based on the old definition, so stock and rate can both differ from the preview. Adjustments use the same vulnerable pattern.

**Fix:** submit the displayed unit definition or version, verify it against current data, and reject stale forms. Synchronize this validation with unit edits. **Evidence:** direct form/action comparison.

### 4. High — the append-only ledger is not enforced by the shipped database setup

[Schema comments](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/schema.ts:247>) and AGENTS describe a database-enforced append-only ledger, but the checked-in migrations contain no UPDATE/DELETE rejection trigger or privilege restriction. [Production Compose](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/deploy/docker-compose.prod.yml:27>) gives the app and migration process the same database credentials, using the PostgreSQL initialization user. Separating their containers does not separate their database privileges.

An accidental UPDATE of a movement can therefore rewrite history while leaving the stock watermark/cache unchanged. The normal application write path is append-only; this finding concerns the promised database safeguard.

**Fix:** separate migration and runtime roles, restrict ledger privileges, and add appropriate database protection with mutation-failure tests. **Evidence:** schema/configuration inspection; current database permissions could not be inspected.

### 5. Medium — new ingredients disappear from reorder alerts

[listLowStock](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/history.ts:289>) uses an inner join to ingredient_stock. A newly created ingredient has no cache row until its first movement, so it cannot appear even with a positive reorder threshold. The ingredient list separately treats its quantity as zero.

Example: create butter with a 5kg threshold and no receipt. Ingredients shows zero/low; the reorder page omits it, and the dashboard can say nothing needs attention.

**Fix:** left join and treat missing quantity as zero for stock comparisons. Preserve unknown cost separately. Also align zero-threshold treatment between the ingredient badge and low-stock list. **Evidence:** query inspection; not live-reproduced.

### 6. Medium — ingredient unit edits reinterpret existing stock and recipes

[updateIngredient](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/ingredients.ts:146>) accepts a changed unitType without checking movements or recipe references. Existing quantities and rates remain numerically unchanged but acquire a new meaning: grams can become millilitres or counts. This issue is acknowledged in AGENTS and remains unfixed.

The recipe yield-unit guard also checks parent recipes but not existing menu portions. A recipe with menu items and no parents can change its yield unit while those stored portion numbers remain unchanged.

**Fix:** lock unit type once quantities/history or dependent portions exist, or provide a deliberate, validated migration process. Continue allowing safe purchase-pack changes with stale-form protection. **Evidence:** write-path inspection.

### 7. Medium — overhead labels ignore sub-recipes

[The cost page](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/recipes/[id]/cost/page.tsx:387>) decides “Ingredients only” and “Food cost” from the root recipe's overhead.applied flag. But sub-recipe rates already contain their overhead.

The probe shows an untimed parent with a ₹120 total containing ₹110 of child overhead, while the root flag is false. The reverse also occurs: a timed parent is marked all-in even when a child is untimed. [Expandable child summaries](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/recipes/[id]/cost/page.tsx:120>) use batchPaise instead of totalBatchPaise, so their advertised batch cost excludes the child's own overhead.

**Fix:** propagate both “contains overhead” and “has incomplete overhead” through the graph; use totalBatchPaise where the UI promises a full batch total. **Evidence:** pure-function reproduction plus rendering conditions.

### 8. Medium — successful receipts remain ready to submit again

[ReceiptForm](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/app/stock/receipt/receipt-form.tsx:55>) keeps its controlled rows after success. It does not clear them or require an explicit new-receipt step. The submit button re-enables, while [recordReceipt](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/movements.ts:50>) generates a new reference on every request with no idempotency key.

A second click after a completed save, or retry after a lost response, can duplicate the delivery. React's reset of uncontrolled fields also risks clearing supplier/note while retaining those controlled receipt lines.

**Fix:** use a stable receipt submission key validated server-side and explicitly reset/start a fresh receipt after success. **Evidence:** state/write-path inspection; browser submission not exercised.

### 9. Medium — some untouched quantity fields cannot be saved again

[integerToDecimal](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/lib/units.ts:103>) truncates to nine decimal places and is not an exact inverse for all allowed pack sizes.

Confirmed example: 1 count stored as 1000 milli-base, bought in trays of 30, displays as 0.033333333 trays. Parsing it back throws “more precise than this field can store exactly”. This can arise after changing purchase pack size and opening the existing low-stock threshold for editing.

**Fix:** use an exact base-unit editing representation when purchase units produce repeating decimals, or retain the original integer for unchanged values. Add round-trip cases involving stored values not divisible by the pack factor. **Evidence:** reproduced by probe.

### 10. Medium — login has no throttling

[login](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/auth.ts:35>) performs password verification on every attempt. No attempt limiter appears in the action, database layer or reverse-proxy configuration. The generic error and dummy hash are good protections against simple account enumeration, but do not limit repeated guesses or expensive password checks.

**Fix:** add account-aware and source-aware throttling before public exposure, with suitable recovery and tests. This follows [OWASP's authentication guidance](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authentication_Cheat_Sheet.md). **Evidence:** code/configuration inspection; no load or password attack was run.

### 11. Medium — missing ingredient costs still appear as zero outside recipes

[Ingredient row conversion](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/ingredients.ts:79>) changes absent cached cost to zero. Ingredient screens print ₹0.00; the home inventory valuation also uses that value. An ingredient adjusted into stock without a purchase has the same ambiguity.

Recipe costing correctly rejects missing purchase history, but the ingredient master and shelf valuation do not preserve that distinction.

**Fix:** expose an explicit cost-basis flag and label unknown rates. Mark stock valuation incomplete when it includes positive stock without a cost basis. **Evidence:** query/display inspection.

### 12. Medium — recipe audit records omit inputs that change cost

[Recipe audit payload](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/recipes.ts:467>) omits batchMinutes and notes and does not retain the prior recipe header. [Hourly-rate audit](<C:/Users/samue/OneDrive/Desktop/Nomeatnaan full stack app/src/db/recipes.ts:263>) keeps only new rates. Soft-deleted line rows cannot reconstruct old recipe yield/time or the previous tenant rates.

Changing only a recipe's batch time changes cost but leaves no audit value explaining that change.

**Fix:** capture relevant before/after headers including batch time and previous overhead rates in the same transaction. **Evidence:** audit payload inspection.

## Additional hardening and operational gaps

- **Unchecked numeric range:** bigint values become JS Number before persistence in receipts, recipes and menu items, with no consistent safe-range limit. The probe demonstrates loss above 2^53−1. Routine café values are much smaller, but the stated exactness contract should reject oversized input.
- **Incomplete database checks:** the cost-column check allows a non-purchase with exactly one cost column set. The nonnegative check can also evaluate to SQL NULL. Positive wastage and whitespace-only “other” notes are not fully prevented in the schema. Ordinary receipt/correction functions add some of these checks, but the database is less strict than documented.
- **Owner protection:** user-management functions prevent self-demotion and manager promotion to owner, but a manager can still target another owner for deactivation or demotion. No current UI exposes this; resolve the policy before adding one.
- **Importer recovery:** ingredients commit one at a time before the opening receipt. If the receipt fails, rerunning skips those ingredients by name and does not automatically resume their prices. An all-collision or entirely unpriced import also reaches an empty receipt call. Add explicit resumable import identity/status.
- **Production readiness:** backups, a tested restore, runtime/migration privilege separation and production operation remain unverified or unimplemented. Deployment stays deferred and does not block local development.
- **Costing before orders:** incremental stock snapshots have landed. A historical as-at-sequence cost lookup and sale-time order snapshots have not.
- **UI coverage:** only login was visually verified today. Internal forms need authenticated desktop/tablet/phone checks, keyboard/combobox checks, validation-error retention and successful-save tests.
- **Documentation:** reconcile README's stale blocker/screen claims with the current route tree and dated PROGRESS entries. Do not erase historical entries.

## Recommended next work

First restore the local PostgreSQL environment and rerun the 70 skipped database tests. Then address missing-overhead semantics, recipe transaction consistency and unit-change protection with targeted behavioural tests. Add the ledger protections and receipt retry handling, then complete the authenticated UI walkthrough. This sequence improves the current inventory/costing product before orders make those numbers operationally load-bearing.

The core decisions worth preserving are the single stock fold, integer arithmetic, parameterized cost lookup, explicit missing-cost errors, composite tenant foreign keys, stock advisory locks and the shared recipe-line loader.

