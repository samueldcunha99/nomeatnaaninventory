# Proposed staged completion - 6 November 2026

**Approved by the user on 6 November 2026: stages A-C.**
The approval covers the database changes and staged implementation below.
Existing no-schema repairs, tests, report exports and documentation continue meanwhile.
Each stage is independently tested on disposable PostgreSQL before any live migration.
No opening quantities, purchase prices, tax rates, recipe measurements or credentials
will be invented. Netlify + Supabase and English/Hindi/Marathi remain in place.

## A. Preserve unknown ingredient values

- Make `ingredient_stock.weighted_avg_cost_millipaise_per_base` nullable; remove its
  default zero. NULL means unknown; a recorded free purchase remains a genuine zero.
- Keep one stock fold for incremental updates and full rebuilds. Unknown opening stock
  plus a valued receipt stays unknown, rather than diluting the unknown stock at zero.
  A valued inflow arriving when the previous quantity is zero/negative starts a known
  cost basis. Unvalued corrections retain the existing cost-basis state.
- Backfill existing caches from ordered ledger history. SQL may sum exact quantities
  to locate a valid valuation starting point; all weighted-average arithmetic remains
  in the shared BigInt fold. Verify every cache/watermark against a full rebuild.
- Ingredient lists, recipe lookup and stock-value totals must distinguish unknown from
  zero. No original stock movement is edited or deleted.

## B. Safe production corrections and stock-mode changes

- Add `recipes.stock_output_enabled boolean NOT NULL DEFAULT false`; backfill true
  where `stock_ingredient_id` is set. Keep that link as the permanent historical shelf
  association, even while future output stocking is disabled.
- Add append-only `production_reversals` with UUID request ID, `tenant_id`,
  `production_run_id`, mandatory reason, `created_by_user_id`, `created_at timestamptz`.
  Unique `(tenant_id, production_run_id)` permits one reversal per run. Run/user foreign
  keys are composite on tenant. The original run stays immutable.
- Add nullable `stock_movements.reverses_movement_id` with a composite tenant/self
  foreign key and unique partial `(tenant_id, reverses_movement_id)` index. It is only
  valid on a reversal, for the same ingredient, with the exact opposite quantity.
- Reversal permission belongs to owner/manager. The initial policy refuses a reversal
  when a later movement touches any affected ingredient. This prevents downstream stock
  or cost history from being silently revalued. The UI explains which later activity
  prevents correction; dependent/cascading undo is not part of this first policy.
- Append linked compensating movements and the reversal event atomically. Replay uses
  the same fold and omits each cancelled original/reversal pair from valuation, so a
  cancelled valued output cannot leave the wrong weighted average. Display history still
  retains both. Rebuild caches in the same locked transaction.
- Reports identify reversed runs and exclude them from effective production/usage totals.
- Maintenance bypass of immutable history requires a privileged database role as well
  as the transaction-local maintenance flag; the web role cannot enable it for itself.
- Disabling future output stocking requires zero shelf balance and no active parent
  references. Re-enabling reuses the historical shelf; it never creates duplicate stock.

## C. Orders, billing, kitchen board and sales reporting

Proposed business tables/fields (all business rows carry tenant scope, all foreign keys
between business tables are composite, all timestamps use timestamptz, all money is
integer paise, and all measured quantities are milli-base):

- `order_counters`: tenant key and positive next order number, incremented atomically.
- `orders`: UUID, tenant, unique request UUID/hash, tenant-unique order number, dine-in/
  takeaway/delivery type, status, optional customer/contact/address, opaque random
  tracking token, subtotal/tax/total paise, tax mode/rate snapshot, payment status,
  creator/timestamps/soft-delete marker.
- `order_lines`: UUID, tenant/order/line number, menu item and recipe references, item
  name snapshot, positive item count, portion quantity/yield-unit snapshot, unit price,
  line total and nullable material-cost snapshot. Unique line number within each order.
- `order_line_draws`: immutable tenant/order-line/ingredient/movement references, positive
  issued quantity and nullable rate/material-cost snapshots. These retain the exact stock
  movement and value used for each sale.
- `order_status_events`: immutable tenant/order, from/to status, actor, timestamp and
  reason. Allowed transitions are enforced server-side.
- `payment_events`: immutable tenant/order, method, payment/refund type, amount paise,
  reference, actor/time, unique request UUID; nullable tenant/provider/event ID unique
  key for future payment-webhook retries. Recording cash/payment references does not
  require gateway credentials.
- `tenants`: nullable default order-tax mode/rate. Unconfigured tax blocks order
  confirmation until the owner explicitly supplies the appropriate setting; zero is
  an explicit permitted choice. No GST/tax treatment is guessed.
- `menu_items`: explicit fulfillment policy for stocked finished goods versus made to
  order. It must be set before sale and is snapshotted on each order line.

Stock policy: a stocked finished item consumes its shelf quantity once; its raw materials
were already consumed during production. A made-to-order item consumes its recipe inputs
once using an exact-rational portion planner, without rounding through batch counts.
The UI must prevent separately logging the same made-to-order sale as production and
then deducting those ingredients a second time. Configuration explains this distinction.
Negative stock remains visible, following the existing project rule.

Proposed cancellation policy: before preparation starts, cancellation reverses reserved
stock atomically where history permits. Once preparation starts, cancellation retains
used ingredients and records the loss; it never pretends cooked ingredients returned to
stock. Payment refunds are separate explicit events, not automatic gateway transfers.

The kitchen board uses polling compatible with Netlify's request-based runtime. Public
tracking uses an opaque token and exposes item/status information only, excluding private
contact/address data, costs and margins. Orders will support printable browser bills,
history, day/week/month sales summaries and CSV exports built from saved sale snapshots.

## External setup and operational limits

- Real payment collection remains disabled until client-owned gateway setup and keys
  are supplied. Test mode must pass before a live payment switch. No real charge or
  refund is made just to verify a feature.
- A customer assistant needs approved cafe/menu/allergen facts and client-owned API
  access. It cannot invent allergen or medical assurances.
- Prepare scheduled encrypted backup automation and failure reporting. Activation needs
  an approved off-site destination and secrets configured directly in its settings.
  Unencrypted database snapshots must never be public CI artifacts or committed to Git.
- This proposal authorizes no fees, paid plans or new third-party accounts. Unresolved
  recipe measurements still require the kitchen's actual values.

## Verification and live rollout

Every stage requires regression tests, failed-guard proof, full no-skipped DB checks,
production build and representative browser workflows. Test writes stay isolated from
the cafe database. Take and verify a backup before a live migration. Apply compatible
migrations with administrative credentials outside the web service, then deploy the
matching app and verify restricted runtime access. Record completed work and remaining
integration/setup requirements in README/PROGRESS.
