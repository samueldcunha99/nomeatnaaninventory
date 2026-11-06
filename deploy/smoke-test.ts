/** CI-only rehearsal on disposable databases; exercises the actual deployment scripts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import type { Actor } from '../src/lib/auth.ts';
import { databaseConfig } from '../src/lib/database-config.ts';

if (process.env.CI !== 'true') throw new Error('Deployment rehearsal is CI-only. Use disposable databases.');
const directory = await mkdtemp(join(tmpdir(), 'cafe-deploy-check-'));
const environment = { ...process.env, BACKUP_DIR: directory,
  BOOTSTRAP_TENANT_NAME: 'Deployment rehearsal', BOOTSTRAP_OWNER_NAME: 'CI owner',
  BOOTSTRAP_OWNER_EMAIL: 'ci-owner@example.test', BOOTSTRAP_OWNER_PASSWORD: 'ci-owner-only-password' };
function run(file: string, args: string[] = [], expectedFailure?: RegExp) {
  const result = spawnSync(process.execPath, [file, ...args], { env: environment, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (!expectedFailure) {
    process.stdout.write(result.stdout);
    if (result.status !== 0) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, `${file} failed`);
  } else {
    assert.notEqual(result.status, 0, `${file} unexpectedly succeeded`);
    assert.match(result.stderr, expectedFailure, `${file} failed for a different reason`);
  }
}

run('src/db/migrate.ts');
run('src/db/migrate.ts'); // Role provisioning and migration history must be idempotent.
run('deploy/bootstrap-owner.ts');
run('deploy/bootstrap-owner.ts', [], /a tenant already exists/); // Prove first-owner refuses an existing tenant.

const config = databaseConfig();
const sql = postgres(config.url, config.options);
try {
  const [owner] = await sql`select count(*)::text as count from public.users where role = 'owner'`;
  assert.equal(owner.count, '1');
  await assert.rejects(sql.begin(async (tx) => { await tx`create table public.runtime_probe (id integer)`; }), { code: '42501' });
  await assert.rejects(sql.begin(async (tx) => { await tx`alter table public.tenants add column runtime_probe integer`; }), { code: '42501' });
  await sql.begin(async (tx) => {
    await tx`update public.tenants set name = 'Runtime write verified'`;
    const [row] = await tx`select name from public.tenants`;
    assert.equal(row.name, 'Runtime write verified');
  });
  console.log('Runtime role reads/writes app data and cannot create or alter tables.');
  // Exercise every new business table using the restricted role and the real writers.
  // These are explicitly disposable CI databases, never the client database.
  const [{ createIngredient }, { recordOpeningStock }, { saveRecipe, saveMenuItem }, production, sales, client] = await Promise.all([
    import('../src/db/ingredients.ts'), import('../src/db/movements.ts'), import('../src/db/recipes.ts'),
    import('../src/db/production.ts'), import('../src/db/orders.ts'), import('../src/db/client.ts'),
  ]);
  try {
    const [ownerRow] = await sql`select id, tenant_id from public.users where role = 'owner'`;
    const actor: Actor = { id: ownerRow.id, tenantId: ownerRow.tenant_id, role: 'owner' };
    const flour = await createIngredient(actor, { name: 'Rehearsal flour', unitType: 'weight', purchaseUnit: 'kg', purchaseUnitInBase: 1000, lowStockThresholdMilliBase: 0 });
    await recordOpeningStock(actor, { requestId: crypto.randomUUID(), lines: [{ ingredientId: flour.id, quantityMilliBase: 1000000n, totalCostPaise: 10000n }] });
    const recipeId = await saveRecipe(actor, { name: 'Rehearsal brownies', yieldUnitType: 'count', yieldQtyMilliBase: 10000n,
      lines: [{ ingredientId: flour.id, quantityMilliBase: 100000n, entryUnitType: 'weight' }] });
    await production.stockRecipe(actor, recipeId);
    const runInput = { recipeId, producedOn: '2020-01-01', batchesMilli: 1000n, actualYieldMilliBase: 10000n };
    const first = await production.recordProductionRun(actor, { ...runInput, requestId: crypto.randomUUID() });
    await production.reverseProductionRun(actor, { requestId: crypto.randomUUID(), productionRunId: first.runId, reason: 'Disposable correction rehearsal' });
    await production.recordProductionRun(actor, { ...runInput, requestId: crypto.randomUUID() });
    const menuItemId = await saveMenuItem(actor, { recipeId, entryUnitType: 'count', name: 'Rehearsal brownie', portionQtyMilliBase: 1000n,
      sellingPricePaise: 1000n, isActive: true, fulfillmentMode: 'stocked' });
    await sales.saveSalesSettings(actor, { taxMode: 'none', taxRateMillipercent: 0n });
    const made = await sales.createOrder(actor, { requestId: crypto.randomUUID(), orderType: 'takeaway', paymentMethod: 'cash', lines: [{ menuItemId, quantity: 2 }] });
    await sales.changeOrderStatus(actor, { orderId: made.orderId, toStatus: 'ready' });
    await sales.changeOrderStatus(actor, { orderId: made.orderId, toStatus: 'completed' });
    const order = await sales.getOrder(actor, made.orderId); assert.ok(order);
    assert.equal(order.paidPaise, 2000n); assert.equal(order.lines[0].costSnapshotPaise, 200n);
    for (const table of ['stock_movements', 'production_runs', 'production_reversals', 'order_lines', 'order_line_draws', 'order_status_events', 'payment_events', 'orders']) {
      await assert.rejects(sql.begin(async tx => {
        await tx`set local app.ledger_maintenance = 'on'`;
        await tx`delete from ${sql(`public.${table}`)}`;
      }), { code: '23001' }, `Runtime maintenance bypass allowed deletion from ${table}`);
    }
    console.log('Restricted runtime wrote valued stock, production/correction, order, usage, status and payments. Every append-only guard rejected a runtime maintenance bypass.');
  } finally { await client.sql.end({ timeout: 5 }); }
} finally {
  await sql.end({ timeout: 5 });
}

run('deploy/backup.ts');
const dumps = (await readdir(directory)).filter((name) => name.endsWith('.dump'));
assert.equal(dumps.length, 1);
const dump = join(directory, dumps[0]);
run('deploy/restore-check.ts', [dump]);
run('deploy/restore-check.ts', [dump], /schemas are not empty/); // Prove the nonempty-target guard.
console.log('Deployment scripts rehearsed against native PostgreSQL.');
