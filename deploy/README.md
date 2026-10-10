# Netlify Free + Supabase handover

**Selected by the user on 10 October 2026.** This supersedes the Render and E2E/Docker
deployment decisions. Netlify runs the Next.js app through its managed OpenNext adapter;
Supabase hosts PostgreSQL. Drizzle migrations, cookie authentication, tenant filtering,
integer costing and the stock ledger stay in place. No Supabase browser client is needed.

**Deployed and checked on 10 October 2026.** The app is available at
[nomeatnaaninventory.netlify.app](https://nomeatnaaninventory.netlify.app/). Netlify deploy
`6aca38cc947b9f0008b322a7` published application commit `c633ad2` in 39 seconds. HTTPS
readiness returned 200, owner sign-in issued a Secure/HttpOnly/SameSite=Lax cookie,
all 11 checked owner pages returned 200, and sign-out revoked the session. The platform
POST rule was accepted in post-processing and returned 429 on request 31; the preceding
30 unsupported POSTs returned 405 and did not modify business data.

On 10 October 2026, the user
created the separate `Nomeatnaan Inventory` project in `samueldcunha99`, Singapore,
reference `oqvedplcgidrvbggimnr`. All eight migrations applied to PostgreSQL 17.11;
the twelve application tables and four append-only triggers were verified. The Data
API is disabled. The `cafe_app` connection can read application tables, has no elevated
role flags and was observed failing schema creation with PostgreSQL error 42501.
The initial `NoMeatNaan` tenant and owner `support@nomeatnaan.com` were created with
a generated password held locally in the ignored `.env.owner.local`. No demo inventory
or recipes were inserted. The older local database is unreachable; historical inventory
and recipes were not transferred. GitHub CI run 38054582472 passed its isolated native
PostgreSQL test, build and backup/restore rehearsal at commit c633ad2. This is not a
restore demonstration of production Supabase data.

Both accounts must belong to the client, who controls
billing and grants the developer access (PROJECT-SPEC § 13). Deployment is not a gate for
other development. Netlify project `nomeatnaaninventory` is connected to the inventory
repository. Its first build failed on missing DATABASE_URL; the build placeholder and
eight runtime variables resolved it. The team reports a scheduled downgrade to Free in
13 days; no billing setting
was changed as part of this switch.

## 1. Create the database

Use a dedicated Supabase project in the client's organisation. Choose Singapore if
available. Use a separate project for
development and restore rehearsals.

**Disable the Data API before adding application tables.** This app checks permissions
and tenants on the server; its tables have no policies for public Supabase API access.
No anon, publishable or service-role key belongs in the app. Supabase documents
[disabling the Data API for direct connections](https://supabase.com/docs/guides/database/secure-data).

In Connect, copy the **direct connection on 5432**, or the **session pooler on 5432** when
the caller needs IPv4. Use the exact dashboard host. The runtime, migration and native
backup scripts reject transaction poolers on 6543. Direct and session connections support
the app's prepared statements and transactions. Keep the per-function pool small on
Netlify (DATABASE_MAX_CONNECTIONS=1), because multiple instances each have a pool. See
[Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).

Download the database CA certificate from Database Settings. Store its PEM as
`DATABASE_SSL_CA`; quoted multiline text or literal `\n` separators work. Certificate
verification stays enabled. Never work around a certificate failure with
`rejectUnauthorized: false`.

In the SQL editor for this dedicated project, run once:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

This removes inherited schema creation permission. The migrator refuses to provision
`cafe_app` if it can still create objects in public. Do not grant `postgres` **to**
`cafe_app`; the migrator instead grants `cafe_app` **to** its administrative caller so
that Supabase's non-superuser `postgres` can manage it. The app owns no tables and has no
elevated role memberships. See [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles).

## 2. Bring across data, or create the first owner

For existing cafe data, pause writes during cutover. Take a backup with the native script
below, restore it into the empty Supabase project using the restore checker, and inspect
the results. That brings across the tenant, owner/password hashes, ingredient ledger,
recipes, stock snapshots and Drizzle migration history together. Keep the old database
until this copy has passed login, receipt, costing and history checks. Do not merge two
populated databases or reseed real data.

For a brand-new database, set these in a **secure local shell**, not in Netlify:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_MIGRATION_URL` | Administrative direct/session URL from Connect |
| `DATABASE_SSL_CA` | Database CA PEM |
| `APP_DB_PASSWORD` | Generated password for the fixed `cafe_app` role |

Run `npm run db:migrate`. It applies pending migrations and grants the runtime role access
only to application tables and the ledger sequence. It refreshes those grants on every
deployment. No schema change was needed for this hosting switch.

For an empty project only, set `BOOTSTRAP_TENANT_NAME`, `BOOTSTRAP_OWNER_NAME`,
`BOOTSTRAP_OWNER_EMAIL`, and a generated `BOOTSTRAP_OWNER_PASSWORD` of 12–128 characters.
Run `npm run db:bootstrap-owner`, then remove these four variables. This creates one
tenant and one owner atomically, with no demo ingredients, recipes or stock. It refuses
if any tenant exists. Existing owners create staff accounts through `/settings/users`.
`db:seed` is sample data for development, not production setup.

## 3. Connect Netlify to GitHub

Import `samueldcunha99/nomeatnaaninventory` as a separate Netlify project; do not replace
the existing cafe marketing site. Select main and the detected Next.js framework.
Netlify installs dependencies and automatically supplies its maintained Next.js adapter.
Do not use a static export or pin an old adapter.

| Setting | Value |
|---|---|
| Build/runtime | Node.js 24; set AWS_LAMBDA_JS_RUNTIME=nodejs24.x in the UI |
| Build | `netlify.toml` sets the build-only placeholder and `npm run build` |
| Publish directory | `.next` |
| Start command | Managed by the adapter; no `next start` service |
| Readiness check | HTTPS `/api/health` |
| Git deployment | Netlify builds main when it changes; this is not gated on GitHub CI |

The build-only placeholder does not become the runtime connection. The health route
returns 200 only when the runtime role can query a migrated table; a failure returns 503
without connection details or business data. See
[Netlify's Next.js guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

Set these variables in the Netlify project UI, available to Functions (all scopes on
Free). Variables declared only in netlify.toml do not reach the serverless runtime:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `HOSTING_PROVIDER` | `netlify` (forces Secure cookies; avoids trusting forwarding headers) |
| `AWS_LAMBDA_JS_RUNTIME` | `nodejs24.x` |
| `NETLIFY_NEXT_SKEW_PROTECTION` | `true` |
| `DATABASE_URL` | `cafe_app` direct URL, or `cafe_app.<project-ref>` session-pooler URL |
| `DATABASE_SSL_CA` | Database CA PEM |
| `DATABASE_MAX_CONNECTIONS` | `1` per function instance; allow capacity for concurrency too |

Use the generated `APP_DB_PASSWORD` in that runtime URL, percent-encoded. Keep
`DATABASE_MIGRATION_URL`, `APP_DB_PASSWORD`, bootstrap and seed passwords out of Netlify.
After restoring existing data, run the migrator to create/regrant the runtime role
**before** code that depends on new tables deploys. Do not prefix secrets NEXT_PUBLIC_.
The ignored `.env.netlify.local` contains only this runtime payload, not administrative
or owner passwords. Never upload `.env.supabase.local`.

`netlify/edge-functions/login-limit.js` applies Netlify's shared source-IP/domain limit
to POSTs on all paths, including alternate Server Action invocation paths: 30 requests
per 180 seconds. It leaves request bodies intact. Netlify documents up to ten seconds
of enforcement delay; verify the rule appears in post-processing logs. The account
failure counters in the app remain per warm instance and reset on cold starts. Shared
per-account lockout requires a separate approved storage/schema change.
See [Netlify rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).

Netlify Free has usage limits and can pause projects when exhausted. Serverless functions
can cold start. Supabase Free still pauses after a week of inactivity; this setup does
not guarantee an always-warm database or uninterrupted operation for free.

## 4. CI and future releases

CI installs native PostgreSQL 16 on Ubuntu, migrates an isolated test database, fails on
skipped DB tests, and builds Next.js. It uses no Docker service or registry.
It also rehearses the real migration, first-owner, backup and restore scripts in two
disposable databases, using a non-superuser migrator and checking that runtime DDL fails.
Run [38054582472](https://github.com/samueldcunha99/nomeatnaaninventory/actions/runs/38054582472)
passed all these jobs. Local PostgreSQL remains unavailable. Netlify's Git integration
deploys independently from CI, so review CI results before considering a release verified.
For future schema changes, run compatible migrations with the separate administrative
connection from a secure local shell before pushing the dependent application code.
The old Render deployment job/hook were removed. No migration credentials belong in
Netlify, and no migration or demo seed runs as part of its build.

Check the Netlify deploy log and HTTPS `/api/health` to establish a completed deployment.
For a documentation-only handover commit, `[skip netlify]` in the commit message avoids
another identical deployment; it does not skip GitHub CI. See
[Netlify deploy controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/).
For a failed app release, select the previous successful deployment in Netlify. A code
rollback does not reverse migrations. Take a backup first and use a separate migration
for database corrections; never delete the production database to roll back code.

## 5. Native backups and a demonstrated restore

Install native PostgreSQL **client tools matching or newer than the source server**;
`pg_dump` and `pg_restore` must be on PATH. Node 24 runs the commands on Windows/Linux.
Use direct or session connections, never transaction pooling. For Supabase supply the CA.

Set `BACKUP_DATABASE_URL` to the source admin connection and `DATABASE_SSL_CA` to its CA
(empty for an ordinary local database). Set `BACKUP_DIR` if needed. Run:

```text
npm run db:backup
```

It writes a custom-format `.dump` and a `.dump.json` manifest. Table counts come from the
same exported repeatable-read snapshot used by `pg_dump`; the manifest also records a
SHA-256 checksum. It includes public and drizzle only, avoiding Supabase's managed
auth/storage schemas. Passwords are passed to client tools through their environment,
never command arguments. Files are ignored by Git. Copy **both files** to client-owned
off-site storage; this script neither schedules backups nor uploads/prunes them.

For a rehearsal, create a separate empty local database or Supabase project. Disable its
Data API too. Set `RESTORE_DATABASE_URL` and `RESTORE_DATABASE_SSL_CA` for that target:

```text
npm run db:restore-check -- backups/cafe-<timestamp>.dump
```

It rejects a target identifying the source (including Supabase direct/pooler aliases),
rejects nonempty app schemas, verifies the checksum, restores with `--exit-on-error`,
compares every table to its exact snapshot count and checks both append-only triggers.
The target stays available for inspection and is not deleted automatically. Use an
isolated target with no active applications; the empty-target check is not a lock against
someone else writing to it during restoration. Do not retry into a partially restored
target; create another empty test target instead.

Before real use, arrange nightly backups/off-site copies and provider recovery in the
client's accounts; rehearse a restore at least monthly and keep its output. Account/plan
configuration and the first live restore remain deployment work, not verified by the
presence of these scripts. See [Supabase migration guidance](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres).

## Handover acceptance

Keep the deployed commit, service URL, database region/version, billing owners,
credential locations, recovery contact and backup/restore evidence in the client's
handover record. Verify owner login, role restrictions, a real delivery, recipe costing,
movement history, restart persistence and restore results before live use. The
[8 October audit](../files/audit-2026-10-08.md) still contains correctness issues to resolve;
changing hosting does not resolve them. Production logging has a backend but no daily
production UI yet. Do not describe this deployment work as completing that feature.
