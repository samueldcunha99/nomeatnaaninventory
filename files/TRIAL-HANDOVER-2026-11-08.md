# No Meat Naan — clean trial start, 8 November 2026

The user requested an empty workspace before handing the software to the cafe for a
month of testing. The live app now has no visible business data. This is a catalogue
archive, preserving recoverability and the project's history rules.

## Starting state

| Item | Before cleanup | Now visible/active |
|---|---:|---:|
| Ingredients | 60 | 0 |
| Recipes | 20 | 0 |
| Recipe lines | 165 active, 184 historical total | 0 |
| Menu items and suppliers | 0 | 0 |
| Stock movements, purchases, batches, orders, payments | 0 | 0 |
| Cafe tenant and owner | 1 each | 1 each |

The catalogue was soft deleted in one transaction, using `deleted_at` and deactivating
the ingredients. No stock/order/payment history existed to discard. All catalogue rows
remain available for authorized recovery, and the 83 prior audit rows remain with one
new clean-start audit event. The app's structure, database migrations, grants, hosting,
owner password, language support and configuration were preserved.

All 10 old sessions were revoked so a stale edit screen cannot silently continue under
an old session. Sign in again with the existing owner account. The existing sign-in
was verified successfully after cleanup; no password appears in this document.

## Backup and operation verification

Before the live change, a fresh native PostgreSQL custom-format backup and matching
SHA-256/table-count manifest were created. The backup was successfully restored into
a separate local PostgreSQL database, where all public table counts, all 13 migration
records and immutable-history triggers passed the existing recovery checker. The
catalogue archive was then rehearsed on that restored database.

The live transaction checked the database/project/tenant/owner and compared the
catalogue/configuration/account fingerprints to that verified backup in UTC. Table
locks prevented concurrent writes during the change. It refused any nonempty business
ledger/order/batch tables and verified zero active catalogue rows, unchanged owner/
tenant data, preserved history counts and unchanged migration count before commit.
An initial comparison refused a timestamp-format mismatch and rolled back; after
normalizing both comparisons to UTC, the live dataset matched and the operation passed.

Fresh recovery files are private and ignored by Git:

- `backups/trial-start-2026-11-08/cafe-2026-11-08T17-02-48-892Z.dump`
- The adjacent `.dump.json` checksum/count manifest.

Operation, recovery and verification evidence stays under the ignored
`.netlify/trial-2026-11-08/` directory. It includes the verified backup marker,
rehearsal result, live result, live screen-check result and backup/restore log. Never
upload database backups, credential files or private helper data into a public repo.

Live checks after cleanup passed: health, secure owner sign-in, overview, ingredients
including inactive, recipes, daily production, orders, kitchen, daily reports, staff
access and sign-out/session revocation. No fabricated cafe business record was entered.
No application source or schema change was needed; this was a live data operation.

## Begin the cafe trial

Use [the live app](https://nomeatnaaninventory.netlify.app/) and the
[operator guide](OPERATOR-GUIDE.md).

1. Sign in with the existing owner and create actual staff accounts as needed.
2. Enter real ingredients, recipe quantities and measured yields, then actual opening
   stock counts/values. Record new deliveries with the amounts actually paid.
3. Configure menu serving sizes, selling prices and prepared-stock/made-to-order policy.
4. Confirm and enter the business's tax treatment before taking orders. Hourly rates
   and preparation times must be real values if full overhead costing is required.
5. Run the cafe's daily workflow and reconcile physical stock, purchases, production,
   usage and recorded payments while the staff evaluate the software.

The code verification in [the 6 November report](completion-2026-11-06.md) still
applies, but the cafe's staff acceptance and data setup are not yet complete. No trial
start/end date, automatic expiry, billing subscription or automatic post-trial cleanup
has been imposed. Manual payment entries do not charge or refund money. Off-site backup
automation remains disabled pending the client's storage/key setup and recovery rehearsal.

## Recovery

If the owner requests the previous catalogue, inspect the archived rows and restore
only the agreed records with an audited maintenance operation, checking for duplicate
names and any new trial data. The fresh dump also permits restoration to a separate
empty database using the documented recovery tool. A blanket restore over live trial
data would overwrite subsequent work and must not be used as routine recovery.
