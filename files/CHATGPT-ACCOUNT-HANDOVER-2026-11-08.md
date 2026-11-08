# No Meat Naan inventory app — handover for another ChatGPT account

**Prepared:** 8 November 2026

**Purpose:** Give another ChatGPT account the current project status and enough context to continue safely. This file contains no passwords, API keys, database credentials, or session tokens.

## What the project is

A cafe inventory, recipe costing, production and order management system for No Meat Naan. It is built for a real cafe and uses an append-only inventory ledger so stock, ingredient usage and costs can be reconstructed for a selected date.

## Project links and deployment

- **Source repository:** [github.com/samueldcunha99/nomeatnaaninventory](https://github.com/samueldcunha99/nomeatnaaninventory)
- **Live app:** [nomeatnaaninventory.netlify.app](https://nomeatnaaninventory.netlify.app/)
- **Hosting and database:** Netlify Free + Supabase PostgreSQL, without Docker. The user selected Netlify after an earlier Render plan.
- **Current deployed application revision:** `71c5746ebccf5a405642daa163a8e1a82c953a70` (short hash `71c5746`), the 8 November page-tutorial release. GitHub CI passed all 373 tests with zero failures/skips, production build and backup/restore rehearsal. The public health revision matched, and 63 live tutorial/page/language checks passed. Earlier completion reports refer to the prior `cfc77d4` release; later documentation-only commits do not rebuild the verified app.
- The app has also been run locally at `http://localhost:3000` during prior work.

## Work completed

The app includes:

- Ingredient catalogue and recipe/sub-recipe/menu-item management.
- Metric quantity conversion, append-only stock movements, receipts, adjustments, wastage, movement history and low-stock views.
- Weighted-average ingredient costing, recipe cost breakdowns, what-if prices, and unknown-cost warnings. Missing cost is kept unknown instead of silently treated as zero.
- Opening-stock quantity and valuation entry, production batches, prepared-shelf stock, daily production reports, and conservative append-only batch corrections/reversals.
- Staff authentication and roles, server-side authorization, password changes/resets and session revocation.
- Cafe POS/orders, saved order-time price/cost snapshots, explicit tax configuration, manual recording of already-received payments/refunds, printable bills and kitchen status board.
- Opaque customer order-tracking links with an intentionally limited public view that excludes price, private contact details and notes.
- Date-range sales reports and CSV exports.
- English, Hindi and Marathi UI/messages.
- Page-specific tutorials on all 27 rendered pages: a description, expandable numbered
  steps and an explanation of what happens next. Guides cover sign-in, inventory,
  recipe editors/costing, production/reports, orders/kitchen, settings and customer
  tracking. They follow the chosen language and omit manager-only instructions for
  counter staff. No database/schema change was required.
- Netlify/Supabase deployment configuration, migrations, runtime grants/setup docs, readiness endpoint and CI workflow. No Docker is required.

## Verification recorded on 6 November 2026

The committed [completion report](completion-2026-11-06.md) records:

- 370 PostgreSQL tests passed; 0 failed or skipped.
- Typecheck and production build passed; dependency audit reported 0 vulnerabilities.
- 17 compiled-app workflow groups passed against isolated PostgreSQL, covering key stock, recipe, order, payment, tracking, role and recovery flows.
- All 13 migrations were exercised; the Supabase snapshot was restored locally and the upgrade rehearsed on a restored copy before upgrading the live database.
- GitHub CI test/build passed for the deployed application revision.
- Live health, secure owner sign-in/sign-out, protected pages in all three languages, CSV export and invalid tracking-token checks passed.
- No sample orders, purchases, batches or fake staff were written into the cafe database during verification.

These checks are not a substitute for the cafe team validating their measurements and workflows with physical stock.

## Current live data after the completed clean start

**Updated after the user's repeated clean-start request on 8 November 2026.** The
cleanup is complete and verified on the live Netlify app. Current visible data:

- 1 cafe tenant and 1 owner.
- 0 ingredients, recipes, recipe lines, menu items or suppliers in the working screens.
- No purchases, stock movements, production runs, orders, payments or reversal records.
- Owner access, hosting/database configuration and all 13 migration records retained.

The 60 ingredients, 20 recipes and 165 previously active recipe lines were **soft
deleted/archived**, in a single transaction. The full 184 historical recipe-line rows
remain archived/history. The 83 audit rows were retained and one clean-start audit row
added. All 10 old sessions were revoked; the owner's email/password were unchanged.

A fresh private backup was checksum-verified and successfully restored into a separate
local PostgreSQL database before the same archive was rehearsed and applied live.
Live sign-in, empty ingredients (including inactive), recipes, production, orders,
kitchen and reports, owner staff access and sign-out revocation passed. No sample
business data was inserted. Do not rerun cleanup or reimport the old catalogue without
the owner's request. See [the trial handover](TRIAL-HANDOVER-2026-11-08.md).

## What the cafe still needs to do before relying on it

See the [operator guide](OPERATOR-GUIDE.md). In particular:

1. Create the cafe's ingredients and recipes for the trial. The old 60-ingredient/20-recipe catalogue is archived. **225 entries in the earlier workbook still need actual measurements/yields**; missing units or quantities must not be guessed.
2. Count physical stock and enter verified opening quantities and values, then record new receipts with actual amounts paid.
3. Complete actual usable yields, recipe ingredient quantities and preparation times; set the cafe's real hourly labour/kitchen rates if known.
4. Configure each menu serving's size, selling price and whether it draws prepared shelf stock or is made to order.
5. Set the cafe's verified tax treatment/rate; the app intentionally does not assume a tax rate and blocks order confirmation before configuration.
6. Create/review staff accounts, rehearse owner/manager/counter/kitchen permissions, and reconcile the app against physical counts during the trial.
7. Configure off-site backup storage/key and complete a real backup-and-restore rehearsal. Backup automation is currently disabled until the cafe provides its own configuration.

## Known limitations

- Payment controls record payments/refunds that already happened elsewhere. There is no payment gateway, live charge/refund, or webhook integration.
- The AI assistant/integration is not built.
- Free hosting can have platform limits and variable/cold-start latency; do not promise a no-sleep service-level guarantee.
- Reports show recorded completed sales and saved costs with the exclusions described in the UI; they are not a complete accounting/profit statement.
- Staff acceptance and the cafe's physical-count/data validation remain outstanding.

## Rules to preserve when making changes

Read the repository's `AGENTS.md`, `README.md`, `files/PROJECT-SPEC.md`, operator guide and completion report before changing code or production data. Key rules:

- Keep money in integer paise and quantities in integer milli-base units; do not introduce floating-point arithmetic into stock/cost calculations.
- Every business table and query stays tenant-scoped; preserve composite tenant foreign keys and authorization checks in server actions/pages.
- Stock and business history are append-only. Never overwrite derived stock or erase immutable orders, payments, production, or movements.
- Unknown ingredient cost is `NULL`/unknown, not zero. A recorded free receipt is explicitly zero.
- Keep one implementation of weighted-average/cost arithmetic, use the shared recipe-graph loader, and preserve order-time financial/material snapshots.
- Validate every mutation server-side and enforce the relevant role in the action, not only in the UI.
- Translate new UI and domain messages into English, Hindi and Marathi.
- Keep migration credentials out of the web service and all credentials/backups out of Git. Do not turn on backup automation without client setup and a recovery rehearsal.
- Treat production database actions as separate from local tests. Back up and verify before any approved destructive change.

## Suggested prompt for the next ChatGPT account

> Continue the No Meat Naan cafe inventory project using `CHATGPT-ACCOUNT-HANDOVER-2026-11-08.md` as context. First inspect the current repository branch/status and the current operator/completion docs so you do not repeat completed work. The app is deployed on Netlify with Supabase. The requested clean start for the cafe's one-month trial was completed on 8 November: the previous catalogue is archived, all working business screens are empty, the owner login is retained and a restore-verified private backup exists. Do not clear the database again or restore the old catalogue unless I ask. Help the cafe enter its real ingredients, recipes, opening stock, menu prices and tax settings, then complete staff acceptance and address the documented setup gaps. Update this handover as work is completed. Never put secrets in chat or Git.

## Related project documents

- `AGENTS.md` — engineering and data-integrity rules.
- `README.md` — repository status and project handover.
- `files/PROJECT-SPEC.md` — product and domain requirements.
- `files/OPERATOR-GUIDE.md` — cafe setup and day-to-day operations.
- `files/completion-2026-11-06.md` — release, database, test and live-verification evidence.
- `files/completion-schema-proposal-2026-11-06.md` — approved stages A–C schema proposal.
- `files/TRIAL-HANDOVER-2026-11-08.md` — completed clean-start operation, backup and trial setup.
- `files/PAGE-TUTORIALS-2026-11-08.md` — multilingual page tutorial implementation and verification.
