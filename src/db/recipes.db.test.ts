/**
 * Module 3 against a live Postgres: costing a real recipe from real purchase history,
 * with no supplied lookup anywhere.
 *
 * The fixture is P3's dough and P7's cinnamon roll, built by recording actual receipts at
 * prices that produce the paper rates:
 *
 *   maida  Rs 45/kg -> 4500 millipaise/g      cinnamon Rs 880/kg -> 88000
 *   butter Rs 500/kg -> 50000                 brown sugar Rs 95/kg -> 9500
 *   castor Rs 58/kg -> 5800                   salt Rs 22/kg -> 2200
 *   milk   Rs 60/litre -> 6000/ml
 *
 * A single receipt each, so the weighted average IS the purchase price and the ledger
 * lands on the paper rates exactly. The last test then records a second butter delivery
 * at a different price, where the weighted average moves and the expected cost is
 * hand-computed from the ledger rather than taken from the paper cases.
 *
 * Skips loudly without a reachable DATABASE_URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { dbReachable, closeDb } from './test-db.ts';
import { tenants, users, ingredients, ingredientStock, recipes, recipeLines } from './schema.ts';
import {
  loadRecipeGraph,
  loadCostLookup,
  saveRecipe,
  saveMenuItem,
  getRecipeForEdit,
  listLineSources,
  listMenuItems,
  DuplicateRecipeError,
  DuplicateMenuItemError,
  type RecipeLineInput,
} from './recipes.ts';
import { recordMovements } from './stock.ts';
import {
  assertAcyclicWithinDepth,
  recipeRateMillipaisePerBase,
  portionCostPaise,
  menuItemMargin,
  MissingCostError,
  RecipeCycleError,
  RecipeDepthError,
  UnitMismatchError,
  MAX_RECIPE_DEPTH,
} from '../lib/costing.ts';
import { unitCostMillipaisePerBase, type UnitType } from '../lib/units.ts';
import { AuthzError, type Actor, type Role } from '../lib/auth.ts';

let reachable = false;
let tenantId: string;
let owner: Actor;
let kitchen: Actor;
let doughId: string;
let rollId: string;
const ing: Record<string, string> = {};

const g = (base: number) => BigInt(Math.round(base * 1000));

async function makeActor(role: Role): Promise<Actor> {
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      name: role,
      email: `${role}-${crypto.randomUUID()}@example.test`,
      passwordHash: 'x',
      role,
    })
    .returning();
  return { id: u.id, tenantId: u.tenantId, role };
}

async function makeIngredient(name: string, unitType: UnitType = 'weight'): Promise<string> {
  const [row] = await db
    .insert(ingredients)
    .values({
      tenantId,
      name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
      unitType,
      purchaseUnit: unitType === 'volume' ? 'litre' : 'kg',
      purchaseUnitInBase: 1000,
    })
    .returning();
  return row.id;
}

/** One receipt, priced in whole paise, exactly as the receipt form would record it. */
async function receive(ingredientId: string, qtyMilliBase: bigint, totalPaise: bigint) {
  await recordMovements([
    {
      tenantId,
      ingredientId,
      movementType: 'purchase',
      quantityMilliBase: Number(qtyMilliBase),
      unitCostMillipaisePerBase: Number(unitCostMillipaisePerBase(totalPaise, qtyMilliBase)),
      totalCostPaise: Number(totalPaise),
      createdByUserId: owner.id,
    },
  ]);
}

const line = (
  source: { ingredientId?: string; subRecipeId?: string },
  qtyBase: number,
  entryUnitType: UnitType = 'weight',
  wastageMillipercent = 0n,
): RecipeLineInput => ({ ...source, quantityMilliBase: g(qtyBase), wastageMillipercent, entryUnitType });

before(async () => {
  reachable = await dbReachable('database recipe tests');
  if (!reachable) return;

  const [t] = await db.insert(tenants).values({ name: `recipe test ${crypto.randomUUID()}` }).returning();
  tenantId = t.id;
  owner = await makeActor('owner');
  kitchen = await makeActor('kitchen');

  // One kilo (or litre) each. For a 1 kg receipt the millipaise-per-gram rate and the
  // paise paid are numerically equal, which is why these read as the paper rates.
  const catalogue: [string, UnitType, bigint][] = [
    ['Maida', 'weight', 4500n],
    ['Butter', 'weight', 50000n],
    ['Castor sugar', 'weight', 5800n],
    ['Milk', 'volume', 6000n],
    ['Salt', 'weight', 2200n],
    ['Cinnamon', 'weight', 88000n],
    ['Brown sugar', 'weight', 9500n],
  ];
  for (const [name, unitType, paisePerKilo] of catalogue) {
    const key = name.split(' ')[0].toLowerCase();
    ing[key] = await makeIngredient(name, unitType);
    await receive(ing[key], g(1000), paisePerKilo);
  }

  // Built through the real save path, so the fixture itself exercises the validators.
  doughId = await saveRecipe(owner, {
    name: 'Dough',
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(4200),
    lines: [
      line({ ingredientId: ing.maida }, 2500),
      line({ ingredientId: ing.butter }, 800),
      line({ ingredientId: ing.castor }, 400),
      line({ ingredientId: ing.milk }, 600, 'volume'),
      line({ ingredientId: ing.salt }, 20),
    ],
  });

  rollId = await saveRecipe(owner, {
    name: 'Cinnamon roll batch',
    yieldUnitType: 'count',
    yieldQtyMilliBase: g(12),
    lines: [
      line({ subRecipeId: doughId }, 2160),
      line({ ingredientId: ing.cinnamon }, 60),
      line({ ingredientId: ing.brown }, 240),
      line({ ingredientId: ing.butter }, 120),
    ],
  });
});

after(closeDb);

/* --------------------------------------------------------------------------
 * The lookup: what counts as having a cost basis
 * ------------------------------------------------------------------------ */

test('the lookup returns the ledger weighted average, as bigint', async (t) => {
  if (!reachable) return t.skip('no database');
  const lookup = await loadCostLookup(owner);
  assert.equal(lookup(ing.maida), 4500n);
  assert.equal(lookup(ing.butter), 50000n);
  assert.equal(lookup(ing.milk), 6000n);
  // Typed, not coincidentally numeric. numeric-as-string would sort and compare wrongly
  // long before it looked wrong - AGENTS.md, Aggregates come back as strings.
  assert.equal(typeof lookup(ing.salt), 'bigint');
});

test('an ingredient with no movements at all throws, naming it', async (t) => {
  if (!reachable) return t.skip('no database');
  const cardamom = await makeIngredient('Cardamom powder');
  const lookup = await loadCostLookup(owner);
  assert.throws(
    () => lookup(cardamom),
    (e: unknown) => e instanceof MissingCostError && /Cardamom powder/.test(e.message),
  );
});

test('an adjustment-only ingredient throws, even though it HAS a stock row', async (t) => {
  if (!reachable) return t.skip('no database');
  // This is the case that separates "has a cost basis" from "has an ingredient_stock
  // row". Reading the row would cost this at zero and say nothing.
  const found = await makeIngredient('Found in the back');
  await recordMovements([
    {
      tenantId,
      ingredientId: found,
      movementType: 'adjustment',
      quantityMilliBase: Number(g(5000)),
      reason: 'count_correction',
      createdByUserId: owner.id,
    },
  ]);

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, found)));
  assert.ok(cached, 'the adjustment should have created a stock row');
  assert.equal(cached.weightedAvgCostMillipaisePerBase, 0, 'and its average should be zero');

  const lookup = await loadCostLookup(owner);
  assert.throws(
    () => lookup(found),
    (e: unknown) => e instanceof MissingCostError && /Found in the back/.test(e.message),
  );
});

test('a purchase at nil value has a basis, and the basis is zero', async (t) => {
  if (!reachable) return t.skip('no database');
  const sample = await makeIngredient('Free sample');
  await receive(sample, g(1000), 0n);
  const lookup = await loadCostLookup(owner);
  assert.equal(lookup(sample), 0n);
});

test('stock counted down to zero keeps its basis', async (t) => {
  if (!reachable) return t.skip('no database');
  const used = await makeIngredient('Used up');
  await receive(used, g(1000), 7000n);
  await recordMovements([
    {
      tenantId,
      ingredientId: used,
      movementType: 'consumption',
      quantityMilliBase: -Number(g(1000)),
      createdByUserId: owner.id,
    },
  ]);

  const [cached] = await db
    .select()
    .from(ingredientStock)
    .where(and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, used)));
  assert.equal(cached.qtyMilliBase, 0, 'stock should be empty');

  const lookup = await loadCostLookup(owner);
  assert.equal(lookup(used), 7000n, 'empty is not unknown - the average survives');
});

/* --------------------------------------------------------------------------
 * End to end: the paper cases, from the ledger
 * ------------------------------------------------------------------------ */

test('P3 and P7 cost end to end from real purchase history', async (t) => {
  if (!reachable) return t.skip('no database');
  const [graph, lookup] = await Promise.all([loadRecipeGraph(owner), loadCostLookup(owner)]);

  assert.equal(recipeRateMillipaisePerBase(doughId, graph, lookup), 13622n);

  const perUnit = recipeRateMillipaisePerBase(rollId, graph, lookup);
  assert.equal(perUnit, 3581960n);
  assert.notEqual(perUnit, 3582029n, 'the exact-rational nesting - see AGENTS.md Nested rounding');

  const cost = portionCostPaise(perUnit, g(1));
  assert.equal(cost, 3582n);
  const margin = menuItemMargin(cost, 35000n);
  assert.equal(margin.marginPaise, 31418n);
  assert.equal(margin.foodCostPercent.toFixed(1), '10.2');
});

test('an uncosted ingredient inside a recipe throws, naming it and the recipe path', async (t) => {
  if (!reachable) return t.skip('no database');
  const vanilla = await makeIngredient('Vanilla essence');
  const flavoured = await saveRecipe(owner, {
    name: 'Flavoured dough',
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(4300),
    lines: [line({ subRecipeId: doughId }, 4200), line({ ingredientId: vanilla }, 10)],
  });

  const [graph, lookup] = await Promise.all([loadRecipeGraph(owner), loadCostLookup(owner)]);
  assert.throws(
    () => recipeRateMillipaisePerBase(flavoured, graph, lookup),
    (e: unknown) => {
      assert.ok(e instanceof MissingCostError);
      assert.match(e.message, /Vanilla essence/);
      assert.match(e.message, /Flavoured dough/);
      return true;
    },
  );
});

test('P14 the loader excludes soft-deleted lines, and the cost is unchanged by one', async (t) => {
  if (!reachable) return t.skip('no database');
  const lookup = await loadCostLookup(owner);

  // A sixth line that moves the cost a long way, then soft-deleted. If the filter is
  // ever dropped, this is the line that exposes it.
  const [extra] = await db
    .insert(recipeLines)
    .values({
      tenantId,
      recipeId: doughId,
      ingredientId: ing.butter,
      quantityMilliBase: Number(g(500)),
    })
    .returning();

  const withExtra = await loadRecipeGraph(owner);
  assert.equal(withExtra.get(doughId)!.lines.length, 6);
  assert.notEqual(
    recipeRateMillipaisePerBase(doughId, withExtra, lookup),
    13622n,
    'the extra line must actually change the cost, or this test proves nothing',
  );

  await db.update(recipeLines).set({ deletedAt: new Date() }).where(eq(recipeLines.id, extra.id));

  const after = await loadRecipeGraph(owner);
  assert.equal(after.get(doughId)!.lines.length, 5, 'a soft-deleted line reached the fold');
  assert.equal(recipeRateMillipaisePerBase(doughId, after, lookup), 13622n);

  // Soft, not hard. The row is still there.
  const rows = await db.select().from(recipeLines).where(eq(recipeLines.id, extra.id));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].deletedAt, null);
});

/* --------------------------------------------------------------------------
 * The validators, reachable through the save path
 * ------------------------------------------------------------------------ */

test('P19b saving a line whose entry unit disagrees with its source is rejected', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(
    saveRecipe(owner, {
      name: 'Wrongly measured',
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      // Dough yields weight; this line is entered by volume.
      lines: [line({ subRecipeId: doughId }, 200, 'volume')],
    }),
    UnitMismatchError,
  );
});

test('P17 saving an edit that closes a cycle is rejected, and nothing is written', async (t) => {
  if (!reachable) return t.skip('no database');
  const before = await loadRecipeGraph(owner);
  const beforeLines = before.get(doughId)!.lines.length;

  await assert.rejects(
    // The roll already uses the dough. Making the dough use the roll closes the loop.
    saveRecipe(owner, {
      id: doughId,
      name: 'Dough',
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(4200),
      lines: [line({ ingredientId: ing.maida }, 2500), line({ subRecipeId: rollId }, 1, 'count')],
    }),
    RecipeCycleError,
  );

  const after = await loadRecipeGraph(owner);
  assert.equal(after.get(doughId)!.lines.length, beforeLines, 'the rejected edit still wrote');
  const lookup = await loadCostLookup(owner);
  assert.equal(recipeRateMillipaisePerBase(doughId, after, lookup), 13622n);
});

test('P19a saving past the depth limit is rejected', async (t) => {
  if (!reachable) return t.skip('no database');
  // A chain of recipes, each using the previous one. The first MAX_RECIPE_DEPTH saves
  // are legal; the one that makes it deeper is not.
  let below = await saveRecipe(owner, {
    name: `chain 0 ${crypto.randomUUID().slice(0, 8)}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(1000),
    lines: [line({ ingredientId: ing.maida }, 100)],
  });

  for (let level = 1; level <= MAX_RECIPE_DEPTH; level++) {
    below = await saveRecipe(owner, {
      name: `chain ${level} ${crypto.randomUUID().slice(0, 8)}`,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ subRecipeId: below }, 100)],
    });
  }

  await assert.rejects(
    saveRecipe(owner, {
      name: `chain over ${crypto.randomUUID().slice(0, 8)}`,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ subRecipeId: below }, 100)],
    }),
    RecipeDepthError,
  );
});

test('kitchen staff can neither read costs nor save recipes', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(loadCostLookup(kitchen), AuthzError);
  await assert.rejects(loadRecipeGraph(kitchen), AuthzError);
  await assert.rejects(
    saveRecipe(kitchen, {
      name: 'Not allowed',
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ ingredientId: ing.maida }, 100)],
    }),
    AuthzError,
  );
});

/* --------------------------------------------------------------------------
 * What the editors can send, and what has to bounce
 * ------------------------------------------------------------------------ */

test('a line with no quantity is refused, and the message names the line', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(
    saveRecipe(owner, {
      name: `zero qty ${crypto.randomUUID().slice(0, 8)}`,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ ingredientId: ing.maida }, 0)],
    }),
    // A constraint violation would name a table and a column. This names the line.
    (e: unknown) => e instanceof RangeError && /Maida/.test(e.message) && /above zero/.test(e.message),
  );
});

test('wastage outside 0-100% is refused before the database has to catch it', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(
    saveRecipe(owner, {
      name: `bad wastage ${crypto.randomUUID().slice(0, 8)}`,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      // 150% - the shape of "30 typed for 3.0", which the range exists to catch.
      lines: [line({ ingredientId: ing.maida }, 100, 'weight', 150_000n)],
    }),
    (e: unknown) => e instanceof RangeError && /Maida/.test(e.message) && /100%/.test(e.message),
  );
});

test('a recipe name that is already taken is refused in words, not in SQL', async (t) => {
  if (!reachable) return t.skip('no database');
  const name = `Twice named ${crypto.randomUUID().slice(0, 8)}`;
  const body = {
    yieldUnitType: 'weight' as const,
    yieldQtyMilliBase: g(1000),
    lines: [line({ ingredientId: ing.maida }, 100)],
  };
  await saveRecipe(owner, { name, ...body });

  await assert.rejects(
    saveRecipe(owner, { name: name.toLowerCase(), ...body }),
    (e: unknown) =>
      e instanceof DuplicateRecipeError &&
      /already exists/.test(e.message) &&
      !/duplicate key/.test(e.message),
  );
});

test('changing what a recipe yields is refused while another recipe draws on it', async (t) => {
  if (!reachable) return t.skip('no database');
  // The roll enters the dough by weight. Nothing re-validates a stored line, so the
  // only safe moment to catch this is here.
  await assert.rejects(
    saveRecipe(owner, {
      id: doughId,
      name: 'Dough',
      yieldUnitType: 'volume',
      yieldQtyMilliBase: g(4200),
      lines: [
        line({ ingredientId: ing.maida }, 2500),
        line({ ingredientId: ing.butter }, 800),
        line({ ingredientId: ing.castor }, 400),
        line({ ingredientId: ing.milk }, 600, 'volume'),
        line({ ingredientId: ing.salt }, 20),
      ],
    }),
    (e: unknown) => e instanceof RangeError && /Cinnamon roll batch/.test(e.message),
  );

  const graph = await loadRecipeGraph(owner);
  assert.equal(graph.get(doughId)!.yieldUnitType, 'weight', 'the rejected edit still wrote');
});

test('getRecipeForEdit returns what was stored, exactly', async (t) => {
  if (!reachable) return t.skip('no database');
  const edit = await getRecipeForEdit(owner, rollId);
  assert.ok(edit);
  assert.equal(edit.name, 'Cinnamon roll batch');
  assert.equal(edit.yieldUnitType, 'count');
  assert.equal(edit.yieldQtyMilliBase, g(12));
  assert.equal(edit.lines.length, 4);

  const sub = edit.lines.find((l) => l.kind === 'sub-recipe');
  assert.ok(sub, 'the sub-recipe line came back as an ingredient');
  assert.equal(sub.sourceId, doughId);
  assert.equal(sub.quantityMilliBase, g(2160));

  // Line order is stable across loads, which is what stops the editor shuffling rows.
  const again = await getRecipeForEdit(owner, rollId);
  assert.deepEqual(
    again!.lines.map((l) => l.sourceId),
    edit.lines.map((l) => l.sourceId),
  );
});

test('getRecipeForEdit refuses kitchen staff and returns null for a stranger', async (t) => {
  if (!reachable) return t.skip('no database');
  await assert.rejects(getRecipeForEdit(kitchen, rollId), AuthzError);
  assert.equal(await getRecipeForEdit(owner, crypto.randomUUID()), null);
});

test('the line picker offers other recipes, never the one being edited', async (t) => {
  if (!reachable) return t.skip('no database');
  const sources = await listLineSources(owner, doughId);
  assert.equal(sources.some((s) => s.id === doughId), false, 'a recipe was offered itself');

  const roll = sources.find((s) => s.id === rollId);
  assert.ok(roll, 'another recipe was not offered as a sub-recipe');
  assert.equal(roll.kind, 'recipe');
  assert.equal(roll.unitType, 'count', 'the unit a line has to be entered in');

  const maida = sources.find((s) => s.id === ing.maida);
  assert.ok(maida);
  assert.equal(maida.kind, 'ingredient');
});

test('a deactivated ingredient stays available to the recipe already using it', async (t) => {
  if (!reachable) return t.skip('no database');
  const retired = await makeIngredient('Retired flour');
  const recipeId = await saveRecipe(owner, {
    name: `uses retired ${crypto.randomUUID().slice(0, 8)}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(1000),
    lines: [line({ ingredientId: retired }, 500)],
  });

  await db.update(ingredients).set({ isActive: false }).where(eq(ingredients.id, retired));

  // Off the shelf, so it is not offered for a new line...
  const fresh = await listLineSources(owner);
  assert.equal(fresh.some((s) => s.id === retired), false);

  // ...but dropping it from the recipe that uses it would leave a row pointing at a
  // blank name, and re-saving would quietly rewrite the recipe.
  const editing = await listLineSources(owner, recipeId);
  assert.equal(editing.some((s) => s.id === retired), true);
});

/* --------------------------------------------------------------------------
 * Menu items
 * ------------------------------------------------------------------------ */

test('a menu item is created, then edited, and comes back as bigint', async (t) => {
  if (!reachable) return t.skip('no database');
  const name = `Cinnamon roll ${crypto.randomUUID().slice(0, 8)}`;
  const itemId = await saveMenuItem(owner, {
    recipeId: rollId,
    name,
    portionQtyMilliBase: g(1),
    sellingPricePaise: 35000n,
    isActive: true,
  });

  const [created] = (await listMenuItems(owner, rollId)).filter((m) => m.id === itemId);
  assert.equal(created.name, name);
  assert.equal(created.sellingPricePaise, 35000n);
  assert.equal(typeof created.sellingPricePaise, 'bigint');
  assert.equal(created.portionQtyMilliBase, g(1));
  assert.equal(created.isActive, true);

  const sameId = await saveMenuItem(owner, {
    id: itemId,
    recipeId: rollId,
    name,
    portionQtyMilliBase: g(1),
    sellingPricePaise: 39000n,
    // Off the menu today is not gone forever.
    isActive: false,
  });
  assert.equal(sameId, itemId, 'an edit created a second item');

  const [edited] = (await listMenuItems(owner, rollId)).filter((m) => m.id === itemId);
  assert.equal(edited.sellingPricePaise, 39000n);
  assert.equal(edited.isActive, false);
});

test('a menu item priced at nothing is legal; the rest is not', async (t) => {
  if (!reachable) return t.skip('no database');
  // Zero is a staff meal or a sample, and it has to be recordable.
  const free = await saveMenuItem(owner, {
    recipeId: rollId,
    name: `Staff roll ${crypto.randomUUID().slice(0, 8)}`,
    portionQtyMilliBase: g(1),
    sellingPricePaise: 0n,
    isActive: true,
  });
  assert.ok(free);

  await assert.rejects(
    saveMenuItem(owner, {
      recipeId: rollId,
      name: `No portion ${crypto.randomUUID().slice(0, 8)}`,
      portionQtyMilliBase: 0n,
      sellingPricePaise: 100n,
      isActive: true,
    }),
    RangeError,
  );

  await assert.rejects(
    saveMenuItem(owner, {
      recipeId: rollId,
      name: `Negative ${crypto.randomUUID().slice(0, 8)}`,
      portionQtyMilliBase: g(1),
      sellingPricePaise: -1n,
      isActive: true,
    }),
    RangeError,
  );

  // A recipe id that is not this tenant's is not a 500, and writes nothing.
  await assert.rejects(
    saveMenuItem(owner, {
      recipeId: crypto.randomUUID(),
      name: `Orphan ${crypto.randomUUID().slice(0, 8)}`,
      portionQtyMilliBase: g(1),
      sellingPricePaise: 100n,
      isActive: true,
    }),
    RangeError,
  );

  await assert.rejects(
    saveMenuItem(kitchen, {
      recipeId: rollId,
      name: `Not allowed ${crypto.randomUUID().slice(0, 8)}`,
      portionQtyMilliBase: g(1),
      sellingPricePaise: 100n,
      isActive: true,
    }),
    AuthzError,
  );
});

test('a menu item name that is already taken is refused in words', async (t) => {
  if (!reachable) return t.skip('no database');
  const name = `Twice sold ${crypto.randomUUID().slice(0, 8)}`;
  const body = {
    recipeId: rollId,
    portionQtyMilliBase: g(1),
    sellingPricePaise: 100n,
    isActive: true,
  };
  await saveMenuItem(owner, { name, ...body });

  await assert.rejects(
    saveMenuItem(owner, { name: name.toUpperCase(), ...body }),
    (e: unknown) => e instanceof DuplicateMenuItemError && !/duplicate key/.test(e.message),
  );
});

/**
 * Two saves, at the same moment, neither of which is a cycle on its own.
 *
 * saveRecipe used to load the graph and prove the change acyclic BEFORE opening its
 * transaction. Two operators could each validate against the same pre-edit graph - A
 * gains a line for B, B gains a line for A - and both commit. The result is a cycle no
 * single save could have made, and assertAcyclicWithinDepth then throws on every read of
 * the catalogue, taking the recipe list and the home page with it.
 *
 * The fix puts the load, the validation and the write in one transaction behind one
 * per-tenant advisory lock, so the second save sees the first one's commit. One of the
 * two must lose. Which one is a race, and does not matter.
 */
test('two simultaneous saves cannot combine into a cycle', async (t) => {
  if (!reachable) return t.skip('no database');
  const flour = await makeIngredient('Cycle flour');

  const aId = await saveRecipe(owner, {
    name: `Cycle A ${crypto.randomUUID().slice(0, 8)}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(1000),
    lines: [line({ ingredientId: flour }, 500)],
  });
  const bId = await saveRecipe(owner, {
    name: `Cycle B ${crypto.randomUUID().slice(0, 8)}`,
    yieldUnitType: 'weight',
    yieldQtyMilliBase: g(1000),
    lines: [line({ ingredientId: flour }, 500)],
  });

  const nameOf = async (id: string) =>
    (await db.select({ name: recipes.name }).from(recipes).where(eq(recipes.id, id)))[0].name;
  // Resolved BEFORE the race: an await between the two saveRecipe calls would let the
  // first finish before the second starts, and the test would pass without a lock.
  const [aName, bName] = await Promise.all([nameOf(aId), nameOf(bId)]);

  // A takes a line on B, and B takes a line on A, launched together.
  const results = await Promise.allSettled([
    saveRecipe(owner, {
      id: aId,
      name: aName,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ ingredientId: flour }, 500), line({ subRecipeId: bId }, 100)],
    }),
    saveRecipe(owner, {
      id: bId,
      name: bName,
      yieldUnitType: 'weight',
      yieldQtyMilliBase: g(1000),
      lines: [line({ ingredientId: flour }, 500), line({ subRecipeId: aId }, 100)],
    }),
  ]);

  const kept = results.filter((r) => r.status === 'fulfilled');
  assert.equal(kept.length, 1, 'exactly one of the two saves is allowed through');

  // The real proof: the catalogue still loads and still costs. A cycle would throw here.
  const graph = await loadRecipeGraph(owner);
  for (const id of graph.keys()) assertAcyclicWithinDepth(id, graph);
});

/* --------------------------------------------------------------------------
 * The demo, for real. MUST BE LAST - it moves butter's weighted average.
 * ------------------------------------------------------------------------ */

test('a second butter delivery at a new price recosts the dough', async (t) => {
  if (!reachable) return t.skip('no database');
  // 1 kg at Rs 500 then 1 kg at Rs 600. Weighted average over the ledger:
  //   (1,000,000 x 50000 + 1,000,000 x 60000) / 2,000,000 = 55000 millipaise/g
  // Dough batch becomes 61,214,000 millipaise; / 4200 g = 14574.7619... -> 14575.
  // Hand-computed from the ledger, not from the paper cases - the paper rate no longer
  // applies once the average has moved.
  await receive(ing.butter, g(1000), 60000n);

  const lookup = await loadCostLookup(owner);
  assert.equal(lookup(ing.butter), 55000n);

  const graph = await loadRecipeGraph(owner);
  assert.equal(recipeRateMillipaisePerBase(doughId, graph, lookup), 14575n);
});
