# Page tutorials — 8 November 2026

The cafe requested instructions on every page for its month of testing. All 27 rendered
pages now show a short **How this page works** description and an expandable
**Step-by-step guide**, followed by **What happens next**. The production date shortcut
redirects to the daily report, which has its own guide.

Coverage includes sign-in, overview, ingredient list/create/edit, recipe list/create/
edit/cost/menu, production, daily and sales reports, receipts, adjustments/waste,
opening valuation, movement history, low stock, order list/create/detail, kitchen,
staff, password, hourly rates, tax settings and public tracking.

Each guide explains the actual workflow and its consequences: creating an ingredient
does not add stock; a receipt records quantity and actual paid cost; opening valuation
is not a purchase; production uses materials; order confirmation uses stock once;
status changes do not repeat stock consumption; payment/refund entries record money
already exchanged elsewhere; what-if prices are previews; saved sales retain their
original snapshots. Guidance does not invent taxes, yields, costs or conversions.

All tutorial sentences have Hindi and Marathi translations, registered with the existing
translator. Manager-only setup/refund instructions are omitted from counter guides.
The public tracking guide contains no internal staff controls or private order data.
Existing server-side authorization remains the enforcement point.

The shared component uses native `details`/`summary`, so opening the guide works without
JavaScript, supports keyboard activation, and does not submit or reset a form. The
summary has a 44-pixel minimum tap height. Print styling excludes the guide from bills.
No database query, migration or business-data change was added.

Verification before publication:

- Typecheck and optimized production build passed.
- 17 relevant tutorial, language and source-integrity checks passed with zero skips.
- 63 compiled-app page checks passed: 20 authenticated pages and sign-in in all three
  languages. Each checked its exact translated description, steps, result and disclosure.
- Browser checks confirmed expansion/collapse, keyboard activation, three languages and
  the guide staying open across language changes. A 320-pixel viewport had no horizontal
  page overflow. No cafe purchase, batch, recipe or order was created for verification.

Implementation: `src/lib/page-tutorials.ts`, `app/ui/page-tutorial.tsx`, shared styles
and explicit tutorial mounts in each page. Coverage tests require a specific guide for
each rendered page and validate all translated sentences and role-specific steps.

Local private verification evidence is under the ignored `.netlify/` directory.

## Published verification

Netlify health confirms application commit `71c5746ebccf5a405642daa163a8e1a82c953a70`.
[GitHub CI run 42505448494](https://github.com/samueldcunha99/nomeatnaaninventory/actions/runs/42505448494)
passed test and build: **373 tests passed, 0 failed, 0 skipped**, fresh PostgreSQL
migrations and the populated restricted-runtime backup/restore rehearsal.

The 63 tutorial/page/language checks also passed against the published Netlify app,
including secure owner login/logout, with no business-data writes. The live browser
confirmed owner access, the empty trial workspace and the expanded Overview guide.
Its normal viewport was restored and the live guide left open for the user. Local
proof screenshot: `files/tutorial-live-2026-11-08.png` (not committed).
