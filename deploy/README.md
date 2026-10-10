# Render + Supabase handover

**Selected by the user on 10 October 2026.** This supersedes the E2E/Docker deployment
decision. Render runs the existing Next.js server on its native Node.js runtime;
Supabase hosts PostgreSQL. Drizzle migrations, cookie authentication, tenant filtering,
integer costing and the stock ledger stay in place. No Supabase browser client is needed.

**Database provisioned; web service not yet deployed.** On 10 October 2026, the user
created the separate `Nomeatnaan Inventory` project in `samueldcunha99`, Singapore,
reference `oqvedplcgidrvbggimnr`. All eight migrations applied to PostgreSQL 17.11;
the twelve application tables and four append-only triggers were verified. The Data
API is disabled. The `cafe_app` connection can read application tables, has no elevated
role flags and was observed failing schema creation with PostgreSQL error 42501.
The initial `NoMeatNaan` tenant and owner `support@nomeatnaan.com` were created with
a generated password held locally in the ignored `.env.owner.local`. No demo inventory
or recipes were inserted. Existing-data cutover, Render hosting and a restore rehearsal
remain outstanding.

Both accounts must belong to the client, who controls
billing and grants the developer access (PROJECT-SPEC § 13). Deployment is not a gate for
other development. `render.yaml` is a service template, not evidence of a live service.

## 1. Create the database

Use a dedicated Supabase project in the client's organisation. Choose Singapore if
available to keep it close to the Render server. Use a separate project for
development and restore rehearsals.

**Disable the Data API before adding application tables.** This app checks permissions
and tenants on the server; its tables have no policies for public Supabase API access.
No anon, publishable or service-role key belongs in the app. Supabase documents
[disabling the Data API for direct connections](https://supabase.com/docs/guides/database/secure-data).

In Connect, copy the **direct connection on 5432**, or the **session pooler on 5432** when
the caller needs IPv4. Use the exact dashboard host. The runtime, migration and native
backup scripts reject transaction poolers on 6543. Direct and session connections support
this persistent server's prepared statements and transactions. See
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

For a brand-new database, set these in a **secure local shell**, not in Render:

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

## 3. Create the Render service

Connect this repository to the client's Render workspace and use the Blueprint from
`render.yaml`. Review the paid compute plan before creating it; the template specifies
one instance with 1 CPU / 2 GB RAM. Keep one instance while login throttling is held in
process memory. The client can change the plan without changing application code.
Render supplies the client address through its ingress; the per-account login counter
also applies. See [Render's ingress headers](https://render.com/articles/how-render-handles-ddos-attacks).

| Setting | Value |
|---|---|
| Runtime | Node.js 24 (`package.json` pins the major) |
| Build | `npm ci --include=dev && DATABASE_URL=postgres://build:build@build-time-placeholder:5432/build npm run build` |
| Start | `npm run start -- --hostname 0.0.0.0` |
| Health check | `/api/health` |
| Automatic deploys | Off; GitHub requests a tested commit after migrations |

Render supplies `PORT`; Next.js uses it. Render handles HTTPS for the service/domain.
The build-only placeholder does not become the runtime connection. The health route
returns 200 only when the runtime role can query a migrated table; a failure returns 503
without connection details or business data. See
[Render's Next.js guide](https://render.com/docs/deploy-nextjs-app) and
[Blueprint reference](https://render.com/docs/blueprint-spec).

Set only these application variables in Render:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `DATABASE_URL` | `cafe_app` direct URL, or `cafe_app.<project-ref>` session-pooler URL |
| `DATABASE_SSL_CA` | Database CA PEM |
| `DATABASE_MAX_CONNECTIONS` | `5` to start; allow capacity for overlapping deploys too |

Use the generated `APP_DB_PASSWORD` in that runtime URL, percent-encoded. Keep
`DATABASE_MIGRATION_URL`, `APP_DB_PASSWORD`, bootstrap and seed passwords out of Render.
After restoring existing data, run the migrator to create/regrant the runtime role
**before** the first Render service deployment. Blueprint creation can initiate a first
deployment even with later automatic deploys disabled.

## 4. Enable the release workflow

CI installs native PostgreSQL 16 on Ubuntu, migrates an isolated test database, fails on
skipped DB tests, and builds Next.js. It uses no Docker service or registry.
It also rehearses the real migration, first-owner, backup and restore scripts in two
disposable databases, using a non-superuser migrator and checking that runtime DDL fails.
This rehearsal has been configured but has not run here; local PostgreSQL is unavailable.

Create a GitHub environment named `production`. Store its secrets:

- `DATABASE_MIGRATION_URL` — administrative direct/session connection
- `DATABASE_SSL_CA` — database CA PEM
- `APP_DB_PASSWORD` — same runtime password as Render's URL
- `RENDER_DEPLOY_HOOK_URL` — from Render service Settings, kept secret

Set the **repository variable** `DEPLOY_PRODUCTION=true` only after the database and
service are ready. Leaving it unset disables releases while CI remains active. Configure
the environment's reviewers/branch restriction as the client prefers. Pushes to `main`
and manual CI runs on `main` then migrate before requesting the exact tested commit SHA
through the [Render deploy hook](https://render.com/docs/deploy-hooks).

The workflow reports that Render **accepted** the request. Check Render Events and the
HTTPS `/api/health` response to establish that it finished. A hook response alone is not
a completed deployment. Keep future migrations compatible with the previous running
version: CI applies them while that version is still serving traffic.

For a failed app release, select the previous successful deployment in Render. A code
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
