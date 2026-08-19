/**
 * Ingredient CRUD against a live Postgres: the permission checks firing on the real
 * functions, the audit trail actually being written, and the unique-name constraint
 * surfacing as something an operator can act on.
 *
 * Skips loudly without a reachable DATABASE_URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, auditLog } from './schema.ts';
import {
  listIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  setIngredientActive,
  DuplicateIngredientError,
  type IngredientInput,
} from './ingredients.ts';
import { recordMovements } from './stock.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';
import { isLowStock } from '../lib/units.ts';

let reachable = false;
let owner: Actor;
let counter: Actor;
let kitchen: Actor;

async function makeActor(role: Role, tenantId: string): Promise<Actor> {
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      name: `${role}`,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      passwordHash: 'x',
      role,
    })
    .returning();
  return { id: u.id, tenantId: u.tenantId, role };
}

before(async () => {
  reachable = await dbReachable('database ingredient tests');
  if (!reachable) return;
  const [t] = await db.insert(tenants).values({ name: `ing test ${crypto.randomUUID()}` }).returning();
  owner = await makeActor('owner', t.id);
  counter = await makeActor('counter', t.id);
  kitchen = await makeActor('kitchen', t.id);
});

after(closeDb);

const input = (over: Partial<IngredientInput> = {}): IngredientInput => ({
  name: `Ingredient ${crypto.randomUUID().slice(0, 8)}`,
  unitType: 'weight',
  purchaseUnit: 'kg',
  purchaseUnitInBase: 1000,
  lowStockThresholdMilliBase: 10_000_000, // 10 kg
  ...over,
});

async function lastAudit(entityId: string) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, owner.tenantId), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row;
}

test('create writes the ingredient and an audit entry', async (t) => {
  if (!reachable) return t.skip('no database');
  const row = await createIngredient(owner, input({ name: 'Maida test' }));
  assert.equal(row.name, 'Maida test');
  assert.equal(row.isActive, true);

  const audit = await lastAudit(row.id);
  assert.equal(audit.action, 'ingredient.create');
  assert.equal(audit.userId, owner.id);
  assert.ok(audit.afterJson, 'the created state is recorded');
});

test('update writes before and after to the audit log', async (t) => {
  if (!reachable) return t.skip('no database');
  const row = await createIngredient(owner, input({ purchaseUnit: 'kg', purchaseUnitInBase: 1000 }));
  // A supplier switching from 1 kg bags to 25 kg sacks.
  await updateIngredient(owner, row.id, input({ name: row.name, purchaseUnit: 'sack', purchaseUnitInBase: 25_000 }));

  const audit = await lastAudit(row.id);
  assert.equal(audit.action, 'ingredient.update');
  assert.equal((audit.beforeJson as { purchaseUnit: string }).purchaseUnit, 'kg');
  assert.equal((audit.afterJson as { purchaseUnit: string }).purchaseUnit, 'sack');
});

test('deactivating hides an ingredient from the default list but keeps it fetchable', async (t) => {
  if (!reachable) return t.skip('no database');
  const row = await createIngredient(owner, input());

  await setIngredientActive(owner, row.id, false);
  const audit = await lastAudit(row.id);
  assert.equal(audit.action, 'ingredient.deactivate');

  const active = await listIngredients(owner, {});
  assert.ok(!active.some((r) => r.id === row.id), 'inactive rows are out of the way by default');

  const all = await listIngredients(owner, { activeOnly: false });
  assert.ok(all.some((r) => r.id === row.id), 'and visible when asked for');

  const fetched = await getIngredient(owner, row.id);
  assert.equal(fetched?.isActive, false, 'nothing is hard deleted');

  await setIngredientActive(owner, row.id, true);
  assert.equal((await lastAudit(row.id)).action, 'ingredient.reactivate');
});

test('a duplicate name is refused with something an operator can act on', async (t) => {
  if (!reachable) return t.skip('no database');
  const name = `Butter ${crypto.randomUUID().slice(0, 8)}`;
  await createIngredient(owner, input({ name }));

  await assert.rejects(() => createIngredient(owner, input({ name })), DuplicateIngredientError);
  // Case-insensitively, so "butter" and "Butter" cannot both exist.
  await assert.rejects(() => createIngredient(owner, input({ name: name.toUpperCase() })), DuplicateIngredientError);

  // And the name stays taken while deactivated - a second row would split the ledger.
  const [existing] = (await listIngredients(owner, { activeOnly: false })).filter((r) => r.name === name);
  await setIngredientActive(owner, existing.id, false);
  await assert.rejects(() => createIngredient(owner, input({ name })), DuplicateIngredientError);
});

test('search and the low-stock indicator read off real stock', async (t) => {
  if (!reachable) return t.skip('no database');
  const tag = crypto.randomUUID().slice(0, 8);
  const low = await createIngredient(owner, input({ name: `Salt ${tag}`, lowStockThresholdMilliBase: 10_000_000 }));
  const fine = await createIngredient(owner, input({ name: `Sugar ${tag}`, lowStockThresholdMilliBase: 1_000_000 }));

  await recordMovements([
    { tenantId: owner.tenantId, ingredientId: low.id, movementType: 'purchase', quantityMilliBase: 5_000_000, unitCostMillipaisePerBase: 2200, totalCostPaise: 11000, createdByUserId: owner.id },
    { tenantId: owner.tenantId, ingredientId: fine.id, movementType: 'purchase', quantityMilliBase: 40_000_000, unitCostMillipaisePerBase: 4600, totalCostPaise: 184000, createdByUserId: owner.id },
  ]);

  const found = await listIngredients(owner, { search: tag });
  assert.equal(found.length, 2, 'search matches on name substring');

  const lowRow = found.find((r) => r.id === low.id)!;
  const fineRow = found.find((r) => r.id === fine.id)!;
  assert.equal(lowRow.qtyMilliBase, 5_000_000);
  assert.equal(lowRow.weightedAvgCostMillipaisePerBase, 2200, 'the salt canary survives the join');
  assert.ok(isLowStock(lowRow.qtyMilliBase, lowRow.lowStockThresholdMilliBase), '5 kg against a 10 kg threshold');
  assert.ok(!isLowStock(fineRow.qtyMilliBase, fineRow.lowStockThresholdMilliBase));
});

test('an ingredient with no movements yet lists at zero rather than vanishing', async (t) => {
  if (!reachable) return t.skip('no database');
  const row = await createIngredient(owner, input({ name: `Never received ${crypto.randomUUID().slice(0, 8)}` }));
  const found = (await listIngredients(owner, {})).find((r) => r.id === row.id);
  assert.ok(found, 'the left join must not drop it');
  assert.equal(found.qtyMilliBase, 0);
  assert.equal(found.weightedAvgCostMillipaisePerBase, 0);
});

test('counter may view but not mutate; kitchen may not even view', async (t) => {
  if (!reachable) return t.skip('no database');
  const row = await createIngredient(owner, input());

  await assert.doesNotReject(() => listIngredients(counter, {}), 'counter needs the list to ring up stock');
  await assert.rejects(() => createIngredient(counter, input()), AuthzError);
  await assert.rejects(() => updateIngredient(counter, row.id, input()), AuthzError);
  await assert.rejects(() => setIngredientActive(counter, row.id, false), AuthzError);

  await assert.rejects(() => listIngredients(kitchen, {}), AuthzError, 'costs are not kitchen information');
  await assert.rejects(() => getIngredient(kitchen, row.id), AuthzError);

  const unchanged = await getIngredient(owner, row.id);
  assert.equal(unchanged?.isActive, true, 'nothing may have changed');
});

test('one tenant cannot see or edit another tenant\'s ingredients', async (t) => {
  if (!reachable) return t.skip('no database');
  const [other] = await db.insert(tenants).values({ name: `other ${crypto.randomUUID()}` }).returning();
  const otherOwner = await makeActor('owner', other.id);
  const mine = await createIngredient(owner, input());

  assert.equal(await getIngredient(otherOwner, mine.id), null, 'not visible across the tenant boundary');
  await assert.rejects(() => updateIngredient(otherOwner, mine.id, input()), /not found/);
  await assert.rejects(() => setIngredientActive(otherOwner, mine.id, false), /not found/);
});
