# Completion verification - 6 November 2026

## Implemented and verified locally

All nine defects in `qa-2026-11-04.md` are fixed: unknown opening cost/unknown displays,
nullable overhead rates, incomplete descendant timing, recipe/menu/shelf unit safety,
tiny production quantities, unchanged zero-rate saves and retry-safe receipts.
One integer stock fold and costing engine remain; unknown is distinct from recorded zero.

Approved stages A-C also deliver append-only batch reversals, reversible output stocking,
opening valuations excluded from purchases, own/staff password changes with session
revocation, staff POS/orders, explicit menu fulfillment/tax setup, printable bills,
manual payment/refund records, role-filtered kitchen board, opaque public tracking,
saved-cost sales reports and localized daily/sales CSVs. English/Hindi/Marathi covers
all new screens and actionable domain messages; stored business data is unchanged.
Encrypted off-site scheduling is prepared and remains disabled.

| Verification | Result |
|---|---|
| Full native PostgreSQL suite | **370 passed, 0 failed, 0 skipped** |
| Typecheck and production build | Passed |
| Compiled app against isolated PostgreSQL | **17 workflow groups passed**, including 33 language/page combinations |
| Fresh migration + restricted runtime + populated backup/restore | Passed; all 13 migrations and table counts matched |
| Actual client snapshot restored locally | Passed; all existing table counts matched |
| Upgrade applied to restored client copy first | Passed |
| Failed-guard proofs | Removed retry comparison, ingredient lock and tracking tenant filter each failed its regression; source restored and full suite green. Earlier repair proofs cover valuation, overhead, units, reversal, password concurrency and encryption guards. |
| Browser | Hindi order draft retained quantity/notes across switching; Marathi sales report and 320 px layouts had no page overflow. |

The compiled checks exercised actual rendered server actions: concurrent receipt retries,
quantity-neutral opening valuation, exact zero rates, explicit tax setup, counter order
and retry, printed-bill controls/cost hiding, public tracking/privacy/no-store/invalid token,
kitchen transitions without deductions, payment retry, saved sales margin, cancellation
restoration, later-row staff role changes, own-password revocation, batch reversal,
sub-resolution form error and owner/manager CSV access versus other roles.

Deployment rehearsal uses real writers under `cafe_app` to create valued stock, a run,
reversal, another run, an order, usage draws, status events and payment. DELETE attempts
with the maintenance flag still fail for every immutable table. It then dumps/restores
that populated state and checks all table counts and protection triggers. No Docker.

Private test helpers, credentials, DB files, screenshots/logs and client backups stay out
of the release commit. Regressions, migration DDL, the deployment rehearsal and operator
guide are checked in. Plaintext dumps and owner/runtime credentials must never be staged.

## Live database upgrade

User approval of stages A-C is recorded in `completion-schema-proposal-2026-11-06.md`.
The actual Supabase snapshot was restored to a separate local target and upgraded before
applying live migrations. The verified dump/manifest are preserved privately under
`backups/verified-2026-11-06/`, checksum checked. Live project `oqvedplcgidrvbggimnr` now
has **13 Drizzle migrations and 19 public application tables**. Existing 60 ingredients,
20 recipes, 184 recipe-line rows and the empty business ledger were retained. No sample
orders, purchases, batches or new staff accounts were inserted into the cafe database.
Runtime grants were refreshed using administrative credentials outside the web service.

## Published release verification

Netlify serves application commit **cfc77d4f324ab51083b8f6d8d60a55a5a9824b94**, confirmed
by its public readiness revision. GitHub CI
[42171961216](https://github.com/samueldcunha99/nomeatnaaninventory/actions/runs/42171961216)
passed **test and build**, including fresh PostgreSQL 16 migrations, zero skipped tests,
the restricted runtime workflow and populated recovery rehearsal.

Live checks passed **39 protected locale/page requests** (13 screens in each language),
Marathi daily/sales CSVs with private/no-store headers, invalid public tracking token
404, owner Secure/HttpOnly/SameSite sign-in and server-side sign-out revocation. The
browser showed the new navigation and readable status labels and confirmed explicit
tax/menu setup guidance on the published order screen. No business form was submitted.

Restricted-runtime reads confirm all prior business counts are unchanged: 60 ingredients,
20 recipes, 184 recipe-line rows, one tenant/owner, 83 prior audit rows and zero menu,
ledger, batch, order, payment or reversal rows. Test writes stayed in isolated PostgreSQL.
Owner authentication/preference actions were the only normal live session activity.
The normal patched app runs at localhost:3000 with the restricted Supabase connection;
the disposable app/database services were stopped after verification. The final
documentation-only commit skips redundant CI/Netlify builds; deployed application stays
at the tested revision above. Local evidence includes `completion-live-2026-11-06.json`,
`completion-http-2026-11-06.json`, restore logs and the private verification screenshots.

## Release compatibility and dependency fixes

The first CI candidate caught PostgreSQL 16's stricter uncommitted-enum rule in 0008's
backfill. Comparing `movement_type::text` fixes fresh installs without changing the
backfill result or re-running the already-applied live migration. A new test commits an
enum type first, then adds the valued-inflow label inside the backfill transaction; it
exposes the stricter rule even on PostgreSQL 17. Removing the cast was watched failing
with `unsafe use of new value`; restoring it passes. No historical 0000-0007 file changed.

Updated Next.js to 16.4.5, Drizzle ORM to 0.45.4, Zod to 4.6.7 and Drizzle Kit to
0.31.11. Refreshed source-map-js and pinned the obsolete development loader's esbuild
dependency to the patched compatible API with a scoped override. A clean `npm ci`,
`npm audit` (**zero reported vulnerabilities**), Drizzle schema generation (no changes),
370 tests and populated runtime/migration/restore rehearsal pass. Relevant published
advisories: [Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
and [Drizzle](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9).
The public health response includes the whitelisted build commit for exact Netlify
release verification; it exposes no runtime secrets or business data.

## Remaining setup and limitations

- The client must enter verified stock counts/values, purchase prices, menu serving sizes,
  selling prices/fulfillment policy, recipe timings/hourly rates and tax settings. No
  defaults were invented; orders refuse unconfigured tax/menu setup.
- 225 workbook entries still need actual measurements/yields before import.
- Staff acceptance against real physical stock is still required. Automated QA does not
  replace the kitchen/owner validating their own data and daily reconciliation.
- Corrections/cancellation restoration are conservative: later ingredient movements block
  undo. After-preparation cancellations retain material consumption and require explicit
  manual refund records. Sales show completed orders by creation date, excluding tax,
  before refunds/overheads; they are not an accounting profit statement.
- Off-site backup upload/decrypt/restore is not activated or demonstrated against a real
  bucket/key. Scheduling remains disabled until client setup and recovery verification.
- Public checkout/live gateway payments/webhooks and the AI assistant are not built.
  No live money movement or external message was sent during development/verification.
- Free hosting limits/cold starts remain. Unauthorized internal screens currently fail
  closed with a generic error; capability tests confirm costs/data are not returned.
