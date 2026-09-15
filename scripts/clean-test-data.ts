/**
 * Delete the tenants left behind by `npm test`.
 *
 *   npm run db:clean-tests            # dry run
 *   npm run db:clean-tests -- --commit
 *
 * The database tests each build their own tenant and deliberately do not clean up: a
 * failed run is much easier to diagnose when its rows are still there. The cost is that a
 * development database silently accumulates them - 151 tenants and 900 ingredients by the
 * time this was written - until every manual `select` has to be filtered and the price
 * list importer has to refuse to guess which tenant it is writing to.
 *
 * WHAT IT MATCHES, and why that is safe: every test tenant is named `<something> <uuid>`,
 * because the tests append crypto.randomUUID() to keep parallel runs apart. A real cafe is
 * not. So the rule is "the name ends in a UUID", which is precise, self-explanatory, and
 * cannot creep: nothing a person would type ends in a v4 UUID.
 *
 * It prints what it would remove and removes nothing unless told to.
 */
import { sql as raw } from 'drizzle-orm';
import { db, sql } from '../src/db/client.ts';

/** A name ending in a v4-shaped UUID. Anchored, so a real name cannot match by accident. */
const TEST_TENANT = raw`name ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;

/**
 * Children before parents. recipe_lines points at recipes AND ingredients, menu_items at
 * recipes, stock_movements at ingredients, users and suppliers, audit_log at users - so
 * this order is the foreign keys read backwards.
 */
const TABLES = [
  'recipe_lines',
  'menu_items',
  'recipes',
  'ingredient_stock',
  'stock_movements',
  'ingredients',
  'suppliers',
  'audit_log',
  'sessions',
  'users',
];

const commit = process.argv.includes('--commit');

const doomed = await db.execute(raw`select id, name from tenants where ${TEST_TENANT} order by name`);
const keeping = await db.execute(raw`select name from tenants where not (${TEST_TENANT}) order by name`);

console.log(`\n${doomed.length} test tenants matched.`);
console.log(`${keeping.length} kept: ${keeping.map((r) => `"${r.name}"`).join(', ') || '(none)'}\n`);

if (doomed.length === 0) {
  await sql.end();
  process.exit(0);
}

for (const table of TABLES) {
  const [{ n }] = await db.execute(
    raw`select count(*)::int as n from ${raw.identifier(table)}
        where tenant_id in (select id from tenants where ${TEST_TENANT})`,
  );
  console.log(`  ${String(n).padStart(6)}  ${table}`);
}

if (!commit) {
  console.log('\nNothing was deleted. Re-run with --commit to remove them.\n');
  await sql.end();
  process.exit(0);
}

// One transaction: a half-deleted tenant is worse than an untouched one.
await db.transaction(async (tx) => {
  // Dropping a tenant takes its ledger with it. Migration 0006 makes stock_movements
  // append-only, and this is the deliberate opt-out - transaction-local, so it lapses the
  // moment this block ends.
  await tx.execute(raw`set local app.ledger_maintenance = 'on'`);
  for (const table of TABLES) {
    await tx.execute(
      raw`delete from ${raw.identifier(table)}
          where tenant_id in (select id from tenants where ${TEST_TENANT})`,
    );
  }
  await tx.execute(raw`delete from tenants where ${TEST_TENANT}`);
});

const [{ n }] = await db.execute(raw`select count(*)::int as n from tenants`);
console.log(`\nremoved ${doomed.length} test tenants; ${n} remain\n`);
await sql.end();
process.exit(0);
