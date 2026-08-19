# Cafe Management System — No Meat Naan

Internal management system for a single-outlet cafe and bakery in Chhatrapati
Sambhajinagar, India. Ingredient-level cost visibility, self-maintaining inventory, order
management, and a customer-facing tracking page. Five-month build; **Month 1 is complete**.

---

## If you are picking this project up, read in this order

1. **`files/PROJECT-SPEC.md`** — scope, conventions, module list, build sequence, out-of-scope
   list. The client-facing source of truth. It is a *working document*: where it conflicts
   with AGENTS.md, AGENTS.md records the decision and why.
2. **`PROGRESS.md`** — what is built, what is decided-but-not-built, open blockers, and a
   dated log of every step with the reasoning behind it. **Append-only.**
3. **`AGENTS.md`** — the conventions you must not break. Read the numeric-scales section and
   the "Aggregates come back as strings" section before writing any query or arithmetic.
4. This file — setup and commands.

**Do not skip AGENTS.md.** Most of the expensive mistakes on this project were caught in
review, and the reasoning is written down there specifically so they are not repeated.

---

## Where the project stands

| | |
|---|---|
| Month 1 (foundations + inventory) | ✅ complete, steps 1–7 |
| Month 2 (deploy pipeline, then costing engine) | ⬜ not started, **gated** |
| Current branch | `month1-step6-stock-movements` |
| Tests | 86 total — 46 run without a database, 40 need Postgres |
| `next build` | exits 0 |

**In flight and incomplete: a UI styling pass.** Two screens of nine are done. It is
**blocked on an unresolved decision** — see PROGRESS.md § "Open — styling pass". There is
uncommitted work in the tree.

**Month 2 is gated** on two things outside the codebase: the owner exercising the
multi-line receipt form by hand, and a deploy target being provisioned.

---

## Local setup

Requires **Node 24+** (runs TypeScript natively, no build step) and **Docker**.

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

`SEED_OWNER_PASSWORD` is required unless `NODE_ENV=development`; the seed refuses to run
without it rather than creating an all-permissions owner account with a password published
in this repository. `.env.example` sets `NODE_ENV=development` for local use — **do not copy
that line to a server.**

`npm run db:reset` does the whole lot from scratch, destroying the volume first.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm test` | Test suite (`node --test`, no framework) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `next build` |
| `npm run db:up` | Start Postgres 16 via Docker Compose |
| `npm run db:generate` | Regenerate migration SQL from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed tenant, owner, suppliers, ingredients + opening stock |
| `npm run db:reset` | Destroy volume, recreate, migrate, seed |
| `npm run bench:replay` | Ledger replay cost against the live database |

### Tests skip rather than fail without a database

40 of the 86 tests need Postgres. Without it they **skip loudly**, printing
`SKIPPING …: no reachable DATABASE_URL`. A green suite showing skips is not a full pass —
start Docker and re-run before trusting it.

## Layout

```
files/PROJECT-SPEC.md   client-facing spec. Read first.
PROGRESS.md             state, blockers, dated log. Append-only.
AGENTS.md               conventions and the reasoning behind them.

drizzle/                generated migration SQL, checked in
src/db/schema.ts        the schema. Read its header before touching a number.
src/db/client.ts        drizzle + postgres.js connection
src/db/stock.ts         recordMovements / recalculateStock — the ONLY insert path
src/db/movements.ts     receipts, adjustments, wastage
src/db/history.ts       movement history + low stock. Read-only, always.
src/db/ingredients.ts   ingredient master
src/db/users.ts         user administration
src/db/auth.ts          session store, password verification
src/db/errors.ts        driver-error translation (constraint name → operator message)
src/db/seed-data.ts     seed data, no DB dependency, unit-tested

src/lib/units.ts        input and display boundary: parsing, conversion, formatting
src/lib/stock.ts        weighted average cost. Pure. The only copy of this arithmetic.
src/lib/auth.ts         roles, permissions, token hashing. Pure.

src/auth/server.ts      requireSession / requirePermission — the enforcement point
middleware.ts           redirect only. NOT access control.

app/globals.css         design tokens. Every colour in the app comes from here.
app/                    login, home, ingredient and stock screens
scripts/bench-replay.ts ledger replay benchmark
docker-compose.yml      Postgres 16 (no app service yet — see Month 2 step 0)
```

## Deploying

**Not set up.** It is scheduled as **Month 2 step 0**, ahead of the costing engine:
Dockerfile, app service in compose, CI image build, deploy to a real VPS.

Two things already decided: build the image **in CI and ship it** — `next build` will OOM a
4 GB VPS — and Caddy terminates TLS in front of the app.

## Regenerating migrations

`npm run db:generate` after any change to `src/db/schema.ts`. **Read the generated SQL
before committing it.** drizzle-kit emits `CREATE UNIQUE INDEX` *after* the
`ADD CONSTRAINT … FOREIGN KEY` block, so an FK pointing at a unique **index** produces SQL
that fails on execution. Composite tenant keys therefore use `unique()` constraints, which
are emitted inline in `CREATE TABLE`. Keep it that way.
