# DigitalOcean migration - prepared 9 November 2026

The user selected a database budget of USD 20/month. The creation form is prepared for
`nomeatnaan-inventory-db`: PostgreSQL 17 Standard, Regular shared CPU, 1 vCPU / 1 GB RAM,
10 GiB SSD, New York NYC3, USD 15.15/month before applicable taxes. Storage autoscaling
is disabled. The current Netlify Functions region was verified in the dashboard as
IAD (Northern Virginia), so NYC3 keeps the database near the application runtime.

**Current status:** creation awaits the user's payment-method/billing step. Automatic
approval review rejected clicking **Add Payment Method and Create Database Cluster**
because the paid billing flow requires user handoff. No DigitalOcean database has yet
been created or charged by this work. Supabase remains the live database.

## Connection requirements

- Use the Standard cluster CA PEM in `DATABASE_SSL_CA`. TLS certificate verification
  remains enabled for the runtime, migrator and native PostgreSQL tools.
- Administrative `doadmin` direct connection: port **25060**. Keep it in a separate,
  ignored local environment file; it never belongs in Netlify.
- Web role: **cafe_app**, no elevated attributes or role memberships, no schema DDL.
  Existing `db:migrate` provisions this role and its application-only grants.
- Create an explicit **session** pool for `cafe_app`, not statement/transaction mode.
  Runtime pool connection uses port **25061** and the pool's displayed database name.
  Keep `DATABASE_MAX_CONNECTIONS=1` per Netlify instance; start the server pool at ten
  backends out of the displayed 22 usable connections, leaving admin/maintenance space.
- Backup/restore always uses direct **25060**, never a pool alias. Use native PostgreSQL
  17 client tools matching the existing Supabase PostgreSQL 17 source.
- TLS validation and restricted production role checks now recognize
  `*.db.ondigitalocean.com`, including custom ports. Existing Supabase checks remain.

## Restore rehearsal and cutover

1. Read/check source identity `oqvedplcgidrvbggimnr`. Take a fresh consistent app-only
   backup using `deploy/backup.ts`; retain its SHA-256/count manifest privately.
2. Restore into a separate empty local database and compare all counts, retained
   catalogue/owner data, migration history and append-only triggers. Do not bootstrap
   another owner or seed any sample data.
3. After DigitalOcean creation, download its CA, use its direct admin connection and
   create separate empty application and rehearsal logical databases. Test an initial
   restored copy, run the existing migrator for runtime grants, and prove `cafe_app`
   cannot perform DDL or bypass immutable history. Verify login and real workflows on
   disposable data, keeping fabricated transactions out of the final cafe database.
4. Schedule a brief write-free cutover. Stop old application business writes, take a
   final fresh backup and restore the empty final target. Compare saved records and
   business fingerprints. Keep Supabase and its backup intact for recovery.
5. Set only the verified `cafe_app` session-pool URL, DigitalOcean CA and connection
   limit in Netlify Functions. Keep all migration/bootstrap passwords out. Redeploy
   the verified application/configuration and check readiness, owner login, tenant
   isolation, three languages, tutorials, reports and import preview without demo writes.
6. Do not reopen the old database for writes during normal operation after the switch.
   If target business writes have begun, rollback must preserve those writes rather
   than simply reverting to an older source snapshot. Deletion of the old provider is
   a separate user decision after recovery validation.

The app's money/quantity arithmetic, ledger, authentication, tenant boundaries and
schema do not change. Off-site backup scheduling remains disabled pending the client's
storage/encryption configuration. DigitalOcean's included backup is not a replacement
for the existing off-site recovery requirements.

Provider references: [connections and TLS](https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/),
[connection pools](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/),
[database pricing](https://www.digitalocean.com/pricing/managed-databases).

## Preparation verification

397 isolated native PostgreSQL tests pass, zero failures/skips; production build and
typecheck pass. A fresh Supabase snapshot was restored into another local database:
all 20 public/drizzle table counts and all non-session row fingerprints match,
13 migrations are retained, the owner's existing password verifies against the copied
hash, and the restricted runtime can read application tables but cannot perform DDL.
Timestamp fingerprints were normalized to UTC on both connections before comparison.
Supabase received no business writes. Dumps, credentials and detailed evidence remain
private under ignored backup and `.netlify/digitalocean-2026-11-09/` paths.

Connection-support application `9f17a572a12431390160ee1e16c5f7a97a92200b` is deployed
and its readiness response matches. This adds target support; it does not switch the
runtime database. The paid database, target-specific checks and final cutover still
await the user completing the configured billing/creation form.

[CI 42584621401](https://github.com/samueldcunha99/nomeatnaaninventory/actions/runs/42584621401)
passed all 397 tests, zero skipped, build and populated migration/runtime/backup/restore
rehearsal. Thirteen focused live owner/page/language/preview checks passed after the
deployment, with zero business writes; owner login/logout still works on Supabase.
The temporary local PostgreSQL was stopped after verification.
