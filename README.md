# Cafe Management System

Internal management system for a single-outlet cafe and bakery. See
`files/PROJECT-SPEC.md` for scope and [AGENTS.md](AGENTS.md) for conventions.

**Status: Month 1, step 6 complete.** Schema, migrations, Docker Compose, seed, unit
conversion, weighted-average cost, auth, role enforcement, ingredient CRUD, and stock
receipts / adjustments / wastage are in. Movement history and low-stock views are not
started.

`npm test` runs 74 tests. They need Postgres (`npm run db:up`); without it the database
tests **skip loudly** rather than passing quietly.

## Local setup

Requires Node 24+ (runs TypeScript natively, no build step) and Docker.

```bash
cp .env.example .env   # then set SEED_OWNER_PASSWORD
npm install
npm run db:up          # Postgres 16 in Docker, waits for healthy
npm run db:migrate
npm run db:seed
```

`npm run db:reset` does the whole lot from scratch, destroying the volume first.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server on :3000 |
| `npm test` | Unit tests (`node --test`, no framework) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` | Start Postgres via Docker Compose |
| `npm run db:generate` | Regenerate migration SQL from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed tenant, owner, suppliers, ingredients + opening stock |
| `npm run db:reset` | Destroy volume, recreate, migrate, seed |
| `npm run bench:replay` | Ledger replay cost against the live database |

## Layout

```
drizzle/            generated migration SQL, checked in
src/db/schema.ts    the schema. Read the header comment before touching a number.
src/lib/units.ts    input and display boundary: parsing, conversion, formatting
src/lib/stock.ts    weighted average cost. Pure. The only copy of this arithmetic.
src/db/stock.ts     database shell: recalculateStock, recordMovements
src/lib/auth.ts     auth policy: roles, permissions, token hashing. Pure.
src/auth/server.ts  requireSession / requirePermission - the enforcement point
src/db/auth.ts      session store, password verification
src/db/users.ts     user administration, guards enforced server-side
middleware.ts       redirect only. NOT access control - see src/auth/server.ts
src/db/ingredients.ts  ingredient master, guards enforced server-side
src/db/movements.ts  receipts, adjustments, wastage - all via recordMovements()
src/db/errors.ts     driver-error translation (constraint name -> operator message)
app/                login, home, ingredient and stock screens
src/db/seed-data.ts seed data, no DB dependency, unit-tested
src/db/seed.ts      the seeding script
src/db/migrate.ts   migration runner
docker-compose.yml  Postgres 16
```

## Deploying: required environment

`SEED_OWNER_PASSWORD` **must be set** whenever `NODE_ENV` is not `development`. The seed
refuses to run without it rather than creating the owner account - which holds every
permission in the system - with a password published in this repository.

`NODE_ENV=development` appears in `.env.example` because that file is the local template.
**Do not copy that line to the server.**

## Deploy

Not set up yet — Month 1 deliverable, lands with the app itself.

Two things already decided and worth not rediscovering: build the Docker image in CI and
ship it, because `next build` will OOM the 4 GB VPS; and Caddy terminates TLS in front of
the app.

## Regenerating migrations

`npm run db:generate` after any change to `src/db/schema.ts`. Read the generated SQL before
committing it — drizzle-kit emits `CREATE UNIQUE INDEX` *after* the `ADD CONSTRAINT ...
FOREIGN KEY` block, so an FK pointing at a unique **index** produces SQL that fails on
execution. Composite tenant keys therefore use `unique()` constraints, which are emitted
inline in `CREATE TABLE`. Keep it that way.
