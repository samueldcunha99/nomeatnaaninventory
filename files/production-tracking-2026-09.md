# Daily production tracking — schema proposal, 18 September 2026

**Status: proposed, not built.** Nothing in this document exists in the database yet.
AGENTS.md working rule 2 says the schema is proposed before code depends on it, and this
one touches `stock_movements`, so it is proposed here first.

## What the client asked for

> Track what is used every day, how much material is used, what the yield is, how many
> items were made and what items were made.

Four questions, and the system can answer none of them today. Stock only ever goes *down*
by hand — an adjustment or a wastage entry. Nothing records that a batch was made.

## Why this matters more than it looks

Question 1 of [client-questions-2026-09.md](client-questions-2026-09.md) worries that
aggregator orders never touch the system, so stock drifts away from the shelf. Production
logging is a better answer to that than order logging is. **A bakery depletes its store
when it bakes, not when it sells.** Log the baking and stock is right regardless of
whether the roll left via Swiggy, the counter or the bin.

That makes this the natural Month 3 opening rather than a detour.

## The decision that shapes everything: dough is stock

Confirmed with the client on 18 September 2026: the kitchen wants to log **every step**.
A dough batch is made on its own, its yield is recorded, and it sits in the fridge until
something draws on it. Tracking dough yield separately is the point, not a side effect —
it is the number a baker actually watches.

The alternative — log only finished items and expand dough away into flour and butter —
was rejected because it cannot answer "what was the dough yield today", and because a
kitchen that logs both a dough batch and the rolls made from it would deduct the flour
twice.

## How a produced item is held in stock

**A stocked sub-recipe is represented by a row in `ingredients`.**

```
recipes.stock_ingredient_id   uuid, nullable, FK -> ingredients
```

Set it and the recipe is stocked: its output is held in the store and can be drawn on
later. Leave it null and the recipe is made-to-order — the run still records its yield,
it just does not put anything on a shelf.

### Why not a polymorphic ledger

The obvious design is a nullable `recipe_id` on `stock_movements`, XOR with
`ingredient_id`. It was rejected. `stock_movements` is the most safety-critical table in
the system: an append-only trigger, a `bigserial` total order, a weighted-average cache
with a snapshot watermark, and a replay test that proves the cache equals the ledger.
A polymorphic key changes its composite FKs, the primary key of `ingredient_stock`,
`recalculateStock`, the history and low-stock screens, and the cross-tenant isolation
test on every query module. That is a lot of blast radius around the one table that must
never be wrong.

### Why the ingredient row is the right shape

In the store, a tub of dough is indistinguishable from a sack of flour. It has a
quantity, a unit, a value, and a level below which somebody should make more. It can be
dropped on the floor. Representing it as an ingredient means **low stock, movement
history, adjustments and wastage all work for dough on day one, with no new code.**

It also values dough correctly. The weighted average over its `production` movements is
what batches *actually* cost, not what the recipe says they should. That variance — the
recipe's theoretical rate against the store's realised one — is precisely the number the
client is asking to see.

### The two costs, and why both are right

| | Answers | Source | Changes |
|---|---|---|---|
| Recipe tree rate | "what *should* a roll cost" | `recipes` + `recipe_lines`, costed live | unchanged |
| Weighted average on the linked ingredient | "what did the dough we are holding *actually* cost" | the ledger | new |

These are two different questions, so two numbers is not the duplication AGENTS.md warns
about. Costing keeps taking its lookups as a parameter; that seam does not move.

## New table

```
production_runs
  id                            uuid pk
  tenant_id                     uuid
  recipe_id                     uuid          what was made
  produced_on                   date          the business day, Asia/Kolkata
  batches_milli                 bigint        thousandths of a batch; 1500 = one and a half
  expected_yield_milli_base     bigint        snapshot: recipe yield x batches
  actual_yield_milli_base       bigint        what actually came out of the oven
  yield_unit_type               unit_type     snapshot
  batch_cost_paise              bigint        snapshot of what the inputs cost, whole paise
  note                          text
  created_by_user_id            uuid
  created_at                    timestamptz
```

**Every yield figure is snapshotted, not derived.** A recipe edited in November must not
silently rewrite what October's batches are recorded as having produced. Same reasoning
as `order_lines.cost_snapshot_paise` in the spec.

`produced_on` is a `date` and not a timestamp because the question is "what did we make
on Tuesday", and a 6am bake and an 11pm bake belong to the same working day. The
timezone is the tenant's, resolved at the input boundary — `src/lib/time.ts` already does
this.

Checks: `batches_milli > 0`, `expected_yield_milli_base > 0`,
`actual_yield_milli_base >= 0`. Zero actual yield is legal and meaningful: the batch was
burnt. Negative is not.

Yield variance is `actual - expected`, computed on read. It is not stored — it is a
subtraction of two columns in the same row, and storing it is a third place for one
number to be wrong.

## What a run writes to the ledger

All movements carry `reference_type = 'production'` and `reference_id = run.id`, so a
run is one atomic group the way a multi-line receipt already is. One transaction, through
the existing `recordMovements()`.

| For each | Movement | Sign |
|---|---|---|
| ingredient line | `consumption` | negative |
| sub-recipe line | `consumption` on that sub-recipe's `stock_ingredient_id` | negative |
| the recipe made, if stocked | `production` on its own `stock_ingredient_id` | positive |

A sub-recipe line whose recipe has **no** `stock_ingredient_id` is an error at save time,
not a silent skip: it means the kitchen is trying to draw on something the system does
not hold. Better a refusal naming the recipe than a batch that quietly consumed nothing.

### Quantity issued, and the sign-safe rounder

```
issued = line_quantity_milli_base * batches_milli * (100000 + wastage_millipercent)
         / (1000 * 100000)
```

AGENTS.md § Nested rounding ends by saying costing never needs the sign-safe quantity
rounder but **Month 3 will, when it writes consumption movements**. This is that moment.
Postgres `round(numeric)` is half-away-from-zero, so rounding a signed quantity sends
-0.5 to -1 and depletes stock nobody used. **Round the magnitude half-up, then negate.**
Never the other order.

### The production movement's cost

```
unit_cost_millipaise_per_base = batch_cost_paise * 1000 / actual_yield_milli_base * 1000
```

Divided by **actual** yield, not expected. A batch that produced 3.8 kg instead of 4.2 kg
made dough that is genuinely dearer per gram, and that is the honest figure to carry
into the rolls. Rounded half-up once, at the division — the money is non-negative, so
half-away-from-zero is half-up.

If any input has no cost basis the run still records, but `batch_cost_paise` is null and
the screens say "cannot be costed", the same as everywhere else. **Never zero.**

## Constraint and enum changes this forces

Small, but they are changes to the ledger's own guarantees and should be read carefully:

1. `movement_type` enum gains `production`.
2. `stock_movements_cost_on_purchase_only` becomes cost-on-`purchase`-or-`production`.
   Stock that comes into existence has a value; buying is no longer the only way that
   happens.
3. `stock_movements_purchase_qty_positive` extends to `production` — both bring stock in,
   so both must be positive.
4. `loadCostLookup`'s basis test becomes `movement_type in ('purchase', 'production')`.
   Without this a stocked sub-recipe has stock and a weighted average but no *basis*, and
   anything drawing on it raises `MissingCostError`.
5. `stock_movements_manual_has_reason` already excludes anything that is not `adjustment`
   or `wastage`, so `production` needs no reason. No change.

## The linked ingredient's unit definition

A produced ingredient still needs `unit_type`, `purchase_unit` and
`purchase_unit_in_base`, all `NOT NULL`. For dough these are the recipe's
`yield_unit_type`, the literal `'batch'`, and the yield in whole base units.

`saveRecipe` maintains that row — one place, so the two cannot drift. Changing a stocked
recipe's yield updates its linked ingredient in the same transaction.

The ingredient list needs to tell bought from made. That is the reverse lookup
`exists (select 1 from recipes where stock_ingredient_id = ingredients.id)`, not a new
column — a catalogue is hundreds of rows and Postgres scans that in microseconds. Same
reasoning as the deliberately absent index on `recipe_lines.ingredient_id`.

## Screens, once the schema is in

Step boundaries, to be built and reviewed separately:

- **`/production`** — today's runs, and the form to log a batch: pick a recipe, say how
  many batches, say what actually came out.
- **`/production/[date]`** — the day sheet. What was made, and the material it took,
  summed per ingredient from that day's `consumption` movements. This is the client's
  "what is used every day" in one screen.
- **Yield variance** on both, expected against actual, as a percentage.

## Open questions for the client

1. **Which recipes are stocked?** Needs an answer per recipe. The default is none —
   he flags the dough-like ones. Nothing works until at least one is flagged.
2. **Does a finished item go into stock too?** A tray of rolls sitting in the counter
   display is stock by the same argument dough is. It only matters once orders deplete
   it, which is the next module, but the answer decides whether `stock_ingredient_id`
   is for sub-recipes only or for anything.
3. **What happens to yesterday's dough?** Nothing here expires anything. If dough has a
   two-day life, that is a wastage entry somebody has to remember to make.

## Rejected, and why, so it is not re-proposed

- **A second ledger table for produced goods.** Two ledgers is two replay
  implementations, two caches and two append-only triggers. The bug surface doubles and
  the two can disagree.
- **Storing yield variance.** A subtraction of two columns in the same row.
- **A `wastage_percent` on `production_runs`.** Batch loss is already expressible: the
  actual yield came out lower. AGENTS.md rejected the same column on `recipes` for the
  same reason — two places to record one loss are two places to double-count it.
