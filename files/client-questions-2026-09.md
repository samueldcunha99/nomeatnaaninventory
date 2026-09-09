# Questions for the cafe — September 2026

Draft to send. Everything here is blocked on an answer from the client, not on code.
Question 1 reshapes Month 3 and PROJECT-SPEC § 10.1 says it must be settled **before Month
3 planning**, which is now.

---

## 1. How do orders actually arrive? (blocks Month 3)

Roughly what share of orders comes through **Swiggy and Zomato**, versus walk-in and phone?

Why it matters: an aggregator order never touches our system, so the ingredients it uses
are never deducted from stock. If most orders arrive that way, the stock counts drift
further from the shelf every day and the costing becomes decorative — accurate about a
minority of what the kitchen actually cooked.

If the share is large, we have options, and we should choose one deliberately rather than
discover the problem in month four:

- record aggregator orders in a lump at the end of each day, so stock at least reconciles
- accept the drift and lean on a weekly physical count to correct it
- treat stock as advisory and use the system for costing and pricing only

**What we need:** a rough percentage. "About 60% Swiggy and Zomato" is a good enough answer.

---

## 2. Do you sell anything you do not make? (blocks the order tables)

Bottled water, canned drinks, packaged snacks, cigarettes — anything bought in and resold
without a recipe.

Why it matters: every menu item currently must point at a recipe, because that is how it
gets a cost. A resale item has a cost too (the purchase price) but no recipe, and the
tables for orders are being designed this week. Adding it later means a migration; adding
it now is one nullable column.

**What we need:** yes or no, and a rough count if yes.

---

## 3. Are you registered for GST? (shapes the bill)

If yes, please send the **GSTIN**, and tell us whether bills need to show HSN/SAC codes.

Why it matters: a GST-registered business needs the number, the codes and sequential
invoice numbering on every printed bill, and the tax has to be a separate stored figure
rather than something folded into the price. That changes the order tables and the bill
layout. If you are not registered, the bill is much simpler and we will not build any of it.

**What we need:** registered or not, and the GSTIN if so.

---

## 4. Five prices in the costing sheet do not add up

These five are in the system but **deliberately carry no price**, because the sheet gives
two different answers and guessing would quietly make everything they touch look cheaper or
dearer than it is. The system will keep flagging them as "cannot be costed" until you
confirm which figure is right.

| Item | The sheet's per-kg column says | But the pack size and price paid say |
|---|---|---|
| **Mascarpone Cheese** | ₹750 per kg | ₹1008 for 1 kg — and the older sheet also says ₹1008 |
| **White Compound Chocolate** (Morde) | ₹420 per kg | ₹220 for 1 kg — the older sheet says ₹236 |
| **Dry Yeast** (Angel) | ₹400 per kg | ₹400 for a pack marked 500 g, which is ₹800 per kg |
| **Tomato Ketchup Sachet** | ₹60 | ₹65 paid |
| **White Vinegar (Can)** | ₹30 per litre | ₹30 for 750 ml, which is ₹40 per litre |

**What we need, for each:** what size does the pack actually come in, and what did you last
pay for it? Not the per-kg figure — the pack and the money. The system works the rate out
itself, which is exactly why these five got caught.

While we are here: four more were slightly rounded in the sheet and are now exact — Milk
Maid is ₹1850 for 7.5 kg, which is **₹246.67/kg**, not the ₹250 written down. That
difference is in your favour and needs nothing from you.

---

## 5. Two things with lead times, worth starting now

- **Razorpay KYC.** Online payments are Month 4, but verification takes one to three weeks
  and cannot be rushed at the end. Starting it now costs nothing if plans change.
- **The server account.** It needs to be created **in the cafe's name, on the cafe's payment
  method** — E2E Networks, Mumbai region, about ₹1,500/month. We get access; you stay the
  owner, so the system remains yours if we ever part ways. Nothing else is waiting on this,
  but it is the last thing standing between a working system and a working system you can
  actually reach from the counter.

---

## 6. One favour: break the delivery form

The stock receipt screen is the one part of this that nothing but us has ever used. Please
enter a real delivery on it — several ingredients, a real invoice — and tell us anything
that felt wrong, slow, or confusing. Defects in that form are the ones we cannot find by
testing, because we already know how it is meant to be used.
