# No Meat Naan - operator guide

The app opens at [nomeatnaaninventory.netlify.app](https://nomeatnaaninventory.netlify.app/).
Use the existing staff sign-in. The first owner is `support@nomeatnaan.com`; its password
is stored privately, never in this repository. Use **My password** to change your own
password. Owners/managers can reset other permitted accounts under **Staff**. Resets
revoke that account's sessions. Only an owner can grant or reset another owner.

**Clean trial start, 8 November 2026:** the previous ingredients and recipes were
archived at the owner's request. They no longer appear, including when inactive items
are shown. The owner login is unchanged; sign in again because old sessions were revoked.
A fresh backup was restored and verified before the archive. See
[the trial handover](TRIAL-HANDOVER-2026-11-08.md) for the starting state and recovery notes.

Each page has a **How this page works** explanation. Open **Step-by-step guide** to
see the page's instructions and **What happens next** to understand its effect on stock,
records or payments. Open it again whenever needed. Sign-in help is below the sign-in
form; the customer tracking page also has its own guide. The guides follow the website
language and staff role, and do not submit forms or change stock. They are omitted from
printed order bills.

If an ingredient's measurement or purchase pack changes while a stock form is open,
the form refuses the save; reload and check the quantity in its new unit. Ordinary
business form details are kept after validation errors so you can correct the entry.
Password fields still clear after submission, and successful receipts reset for the
next delivery. Negative thresholds and values too large to store exactly are refused.

## Prepare the real cafe before relying on the figures

1. Create the cafe's ingredients and recipes for the trial. The previous 60 ingredients
   and 20 imported recipes are archived and can be recovered if the owner requests it.
   The earlier workbook also had 225 entries requiring real measurements/yields;
   missing values must not be guessed when entering or importing them.
2. Count stock physically. Under **Ingredients → Opening stock / valuation**, record
   verified quantities and their total inventory value. For existing positive stock
   with unknown value, enter exactly the current quantity; valuation keeps that quantity
   unchanged. Correct physical counts separately. This is not a new delivery/payment.
3. Enter new deliveries under **Stock receipts** with quantities, actual amounts paid
   and supplier where available. A free sample is an explicit zero paid amount.
   Unknown cost stays unknown until a valid basis is established. Negative stock is
   flagged rather than blocking cafe operations; correct its cause promptly.
4. Add actual usable yields, ingredient quantities and preparation minutes to recipes.
   Choose g/kg, ml/L or pieces in the metric controls. Sub-recipes carry their own
   overhead upward. Set both hourly rates under **Hourly rates**. Blank means unknown;
   zero means explicitly free. A provisional cost/margin is labelled **Known costs only**.
5. In a recipe's menu editor, enter each serving's size, selling price and stock policy.
   **Prepared item** sells existing finished stock; **Made when ordered** deducts recipe
   inputs when the order is confirmed. Leave an incomplete item unconfigured/inactive.
6. Set **Sales settings** to the verified tax treatment and rate for this business.
   The software supplies no assumed tax rate. It will not confirm orders until the
   setting is explicit. Confirm this setting with the person responsible for the cafe.
7. Create actual staff accounts and have each role rehearse its work. Keep the old
   record alongside the app during initial staff acceptance and reconcile physical stock.

## Import an ingredient or stock file

Owners/managers open **Ingredients → Import stock file**. The same option appears on
opening stock and receipts; entering from receipts selects **New purchase / delivery**.

1. Download the blank CSV template. Fill it in Excel and **Save As → CSV UTF-8**.
   Keep all eight English column headings. Each file supports 100 ingredient rows and
   256 KB. Ordinary `.xlsx` workbooks need saving as CSV first.
2. Use `weight` (g), `volume` (ml) or `count` in `unit_type`. A kg pack has
   `purchase_unit=kg` and `purchase_unit_in_base=1000`; a litre has 1000; a 30-piece
   tray uses count and 30. `quantity` and `low_stock_threshold` use those purchase units.
3. `total_cost` is the full rupee value of the row, without a currency sign or thousands
   separator. For example, quantity `1.25` kg and cost `125` means 1.25 kg worth INR 125.
   Leave quantity and cost BOTH blank to add an ingredient without stock/cost history.
   Enter zero cost only for stock that is genuinely free. Brand and threshold are optional.
4. Select **Opening stock / valuation** for the stock already present at trial start.
   Opening entries do not count as new purchases. Use **New purchase / delivery** only
   for newly received stock; it adds to the balance and counts as a purchase today.
5. Add an import/delivery reference, upload and select **Preview import**. Correct every
   listed error, then check all quantities, values and new/existing ingredient matches.
   Select **Confirm import** to save. A failed row rolls back the entire file, including
   newly created ingredients. Preview never writes business data.

Existing ingredient settings are preserved. Names match case-insensitively within this
cafe; inactive ingredients need reactivation and different units/pack sizes need correction
before import. Opening valuation retains its ordinary safeguards: it cannot replace known
costs, and existing unknown stock needs its exact current positive quantity.

Repeated submission or a fresh upload of the same file, type and reference does not add
stock twice. If a separate, genuinely identical delivery arrives later, give it a different
delivery reference. Import does not group multiple supplier invoices or backdate purchases.
Supplier-specific deliveries can still use the ordinary receipt form.

## Record preparation correctly

Use **Daily production** for batches actually made. Select the production date, recipe,
batch count and measured usable output. Output may be zero for a lost/burnt batch.
The expected output, actual output, material draws and material cost are saved together.
Production can be entered late for a past date; it cannot be future-dated.

For prepared products/components, first enable **Hold in stock**, then record batches.
Materials leave raw stock; usable output arrives on its prepared shelf valued at the
actual batch yield. A parent recipe using that component draws the shelf, without taking
its raw ingredients again. Stocking output requires known material values unless the
actual output is zero. Labour/kitchen overhead is shown in recipe costing, not shelf value.

A made-to-order menu item is recorded through **Orders**. Do not also log those servings
as manual production: the system blocks active made-to-order recipes from that flow.
Changing an established method can need a separate recipe to keep prior manual output
from being deducted again.

**Correct this batch** reverses an entry that was recorded incorrectly. Enter a reason.
The original entry remains; linked inverse movements restore it, and reports exclude
it from effective totals. A reversal is refused if a later stock movement touches any
affected ingredient. A batch that was genuinely made and then lost is wastage, not a
clerical reversal. Do not change history to make physical stock agree.

Disable future shelf output only when its balance is exactly zero and no active parents
or stocked menu items depend on it. Re-enabling uses the same historical shelf.

## Take an order and record payment

Open **Orders → New order**, select dine-in/takeaway/delivery, add menu items and counts,
and review the subtotal, tax and total. Delivery needs contact and address. Confirming
records one order and deducts its materials/shelf stock once. A repeated submission of
the same form is returned as the original order; reusing it with changed details refuses.

Choose **unpaid** unless the money has already arrived. Cash and external payment
options record money received; an external transaction needs its reference. Additional
partial payments can be recorded on the order. Owners/managers can record refunds
already completed outside the app. **These controls do not charge, transfer or refund
real money.** No payment gateway is connected.

The bill keeps the serving size, name, price, tax and material cost as recorded at sale.
Later purchases/menu edits do not change it. Counter staff see the bill without material
costs. Use **Print bill** for the browser print dialog or **Copy tracking link** for the
customer. A link is private to whoever has it; it exposes item/status progress only.

## Run the kitchen and handle cancellations

Kitchen staff sign in directly to **Kitchen board**. Active orders appear oldest first.
Move through received, kitchen, baking, out of oven, ready, then completed, with an
out-for-delivery step where relevant. Ready-made drinks/items can move to ready without
the baking steps. Backwards changes require reasons and every change stays in history.
Status changes never deduct ingredients again. The visible page refreshes every 15 seconds.

Owner/manager/counter may cancel with a reason. Before preparation ever starts, stock is
restored only when no later movement touches its ingredients. After preparation has
started, used materials remain used and are reported as cancellation material loss,
even if someone previously moved the status back. Payments are not automatically refunded.
The conservative later-activity refusal needs an owner review, not deletion of history.

## Check a date, sales and exports

**Daily reports** shows purchases/amounts paid, suppliers, batches/actual yields,
production material use, extra waste and individual batch history. Choose the business
date in Asia/Kolkata and optionally a recipe. Recipe filters apply to production and its
usage; purchases/waste show the whole day. Reversed batches remain visible but do not
contribute to effective totals. Prepared components and finished outputs stay separate
so their material costs are not counted twice.

**Sales reports** accepts a date range, today, seven days or this month. It groups completed
orders by their creation date in India, sums revenue excluding tax, and uses the saved
material costs. It ranks sold servings and known material margins. Unknown sale costs
keep margins unknown permanently; later purchases do not retrospectively price them.
This is material contribution before refunds, labour, rent and other overhead, **not net
business profit**. Products with no completed sales are not part of sold-item rankings.

Payments/refunds use their own recording date, including payments for older orders.
Their separate section is cash/payment activity, not another sale total. Order creation
and completion dates can differ; the report explicitly uses creation date for completed
sales. Use the order list to inspect open orders or filter a status/customer/number.

Owners/managers can download daily and sales CSVs with the current filters and language.
Names/notes remain saved text, exact decimals remain numbers, and formula-like text is
escaped for spreadsheets. Current **Movement history** shows all inventory movement,
including orders and opening valuations; daily production usage describes production only.

## Languages, backup and operational limits

Choose English, हिन्दी or मराठी in the header/sign-in screen. It applies to all screens
and messages and is saved per browser; switching preserves in-progress forms. Saved
ingredient/recipe/customer/staff names and notes are not automatically translated.

The live service uses Netlify + Supabase without Docker. Free-tier usage/cold-start
limits still apply; no permanent-awake guarantee is made. Keep client account access and
runtime credentials private. Never put migration/bootstrap credentials in Netlify.

Backup and restore tools are available. Encrypted nightly off-site automation is
**prepared, not enabled**. The client must provide a public encryption key and private
storage destination/credentials and verify an actual decrypt/restore before enabling it.
See [the backup runbook](../deploy/ENCRYPTED-BACKUPS.md). Keep private recovery keys out
of GitHub and Netlify. The current verified local snapshot is not a scheduled backup.

Public customer checkout, live online payments, payment-provider webhooks and an AI
assistant still need implementation and client configuration/approved cafe facts.
Internal staff-entered delivery orders and customer tracking already work without them.
