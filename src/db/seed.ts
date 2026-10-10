/**
 * Seeds one tenant, one owner, three suppliers and ~30 ingredients, each with an
 * opening stock purchase.
 *
 * There is deliberately NO rounding in this file. Every seeded price divides exactly
 * into millipaise-per-base, and the script throws if one ever doesn't. Rounding
 * belongs in the shared helpers (step 3) and nowhere else - a second rounding
 * implementation here is exactly how the two drift apart.
 *
 * Opening stock uses the first-purchase rule only (spec: when old_qty <= 0 the new
 * weighted average IS the incoming unit price), so it needs no WAC formula. Every
 * subsequent purchase must go through recordPurchase().
 */
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db, sql } from './client.ts';
import {
  tenants,
  users,
  suppliers,
  ingredients,
  stockMovements,
  ingredientStock,
  recipes,
  recipeLines,
  menuItems,
} from './schema.ts';
import { SEED_INGREDIENTS, SEED_SUPPLIERS, unitCostMillipaisePerBase } from './seed-data.ts';

const TENANT_NAME = 'Nomeatnaan Cafe & Bakery';

const ownerEmail = process.env.SEED_OWNER_EMAIL || 'owner@cafe.local';

/**
 * A default password is a development convenience and nothing else. Outside
 * development the seed refuses to run rather than creating an owner account whose
 * password is published in this repository - that account has every permission there
 * is, and "we'll change it after go-live" is how it stays "changeme-dev-only".
 *
 * NODE_ENV unset counts as not-development: the safe reading, since the server is the
 * place least likely to have it set deliberately.
 */
const ownerPassword = (() => {
  const supplied = process.env.SEED_OWNER_PASSWORD;
  if (supplied) return supplied;
  if (process.env.NODE_ENV === 'development') return 'changeme-dev-only';
  throw new Error(
    'SEED_OWNER_PASSWORD is required when NODE_ENV is not "development". ' +
      'The seeded owner account has every permission in the system; it must not be ' +
      'created with a password that is written down in the repository. ' +
      'Set SEED_OWNER_PASSWORD in the environment and run the seed again.',
  );
})();

await db.transaction(async (tx) => {
  const [existing] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, TENANT_NAME));
  if (existing) throw new Error(`Tenant "${TENANT_NAME}" already exists. Seed only an empty development database; never reset a database containing cafe data.`);

  const [tenant] = await tx.insert(tenants).values({ name: TENANT_NAME }).returning();

  const [owner] = await tx
    .insert(users)
    .values({
      tenantId: tenant.id,
      name: 'Cafe Owner',
      email: ownerEmail,
      passwordHash: await hash(ownerPassword),
      role: 'owner',
    })
    .returning();

  const supplierIds: Record<string, string> = {};
  for (const [key, s] of Object.entries(SEED_SUPPLIERS)) {
    const [row] = await tx.insert(suppliers).values({ tenantId: tenant.id, ...s }).returning();
    supplierIds[key] = row.id;
  }

  // Names are unique per tenant, so they are a safe key for the demo recipe below.
  const ingredientIds: Record<string, string> = {};

  for (const i of SEED_INGREDIENTS) {
    const unitCost = unitCostMillipaisePerBase(i);
    const qtyMilliBase = i.openingQty * i.purchaseUnitInBase * 1000;

    const [ing] = await tx
      .insert(ingredients)
      .values({
        tenantId: tenant.id,
        name: i.name,
        unitType: i.unitType,
        purchaseUnit: i.purchaseUnit,
        purchaseUnitInBase: i.purchaseUnitInBase,
        lowStockThresholdMilliBase: i.lowStockQty * i.purchaseUnitInBase * 1000,
      })
      .returning();

    await tx.insert(stockMovements).values({
      tenantId: tenant.id,
      ingredientId: ing.id,
      movementType: 'purchase',
      quantityMilliBase: qtyMilliBase,
      unitCostMillipaisePerBase: unitCost,
      totalCostPaise: i.pricePaise * i.openingQty,
      supplierId: supplierIds[i.supplier],
      referenceType: 'seed_opening',
      createdByUserId: owner.id,
    });

    // First purchase: the weighted average IS the incoming unit price.
    await tx.insert(ingredientStock).values({
      tenantId: tenant.id,
      ingredientId: ing.id,
      qtyMilliBase,
      weightedAvgCostMillipaisePerBase: unitCost,
    });

    ingredientIds[i.name] = ing.id;
  }

  /* -------------------------------------------------------------------------
   * The demo recipe, so the costing screens have something real to show.
   *
   * P3's dough and P7's cinnamon roll from the paper cases, at the SEEDED prices rather
   * than the paper ones. Every figure below is reproducible by hand from this file:
   *
   *   dough batch  2500x4200 + 800x52000 + 400x5800 + 600x6200 + 20x2200
   *                = 58,184,000 millipaise (Rs 581.84) / 4200 g = 13853 millipaise/g
   *   roll batch   2160x13853 + 60x88000 + 240x9500 + 120x52000
   *                = 43,722,480 millipaise (Rs 437.22) / 12 = 3,643,540 per roll
   *   one roll     Rs 36.44 against Rs 350.00 -> margin Rs 313.56, food cost 10.4%
   *
   * Note the roll uses the ROUNDED dough rate, 13853, which is why the breakdown adds up.
   * ----------------------------------------------------------------------- */
  const line = (
    source: { ingredientId: string } | { subRecipeId: string },
    quantityMilliBase: number,
  ) => ({ tenantId: tenant.id, quantityMilliBase, ...source });

  const [dough] = await tx
    .insert(recipes)
    .values({
      tenantId: tenant.id,
      name: 'Cinnamon roll dough',
      yieldUnitType: 'weight',
      yieldQtyMilliBase: 4_200_000,
      notes: 'One batch. Proof, knock back, roll out.',
    })
    .returning();

  await tx.insert(recipeLines).values([
    { recipeId: dough.id, ...line({ ingredientId: ingredientIds['Maida (refined flour)'] }, 2_500_000) },
    { recipeId: dough.id, ...line({ ingredientId: ingredientIds['Butter (unsalted)'] }, 800_000) },
    { recipeId: dough.id, ...line({ ingredientId: ingredientIds['Castor sugar'] }, 400_000) },
    { recipeId: dough.id, ...line({ ingredientId: ingredientIds['Milk (full cream)'] }, 600_000) },
    { recipeId: dough.id, ...line({ ingredientId: ingredientIds['Salt'] }, 20_000) },
  ]);

  const [roll] = await tx
    .insert(recipes)
    .values({
      tenantId: tenant.id,
      name: 'Cinnamon roll batch',
      yieldUnitType: 'count',
      yieldQtyMilliBase: 12_000,
      notes: 'Twelve rolls from one tray.',
    })
    .returning();

  await tx.insert(recipeLines).values([
    { recipeId: roll.id, ...line({ subRecipeId: dough.id }, 2_160_000) },
    { recipeId: roll.id, ...line({ ingredientId: ingredientIds['Cinnamon powder'] }, 60_000) },
    { recipeId: roll.id, ...line({ ingredientId: ingredientIds['Brown sugar'] }, 240_000) },
    { recipeId: roll.id, ...line({ ingredientId: ingredientIds['Butter (unsalted)'] }, 120_000) },
  ]);

  await tx.insert(menuItems).values({
    tenantId: tenant.id,
    name: 'Cinnamon roll',
    recipeId: roll.id,
    portionQtyMilliBase: 1_000, // one roll out of the batch of twelve
    sellingPricePaise: 35_000, // Rs 350.00
  });
});


await sql.end();
console.log(`seeded ${SEED_INGREDIENTS.length} ingredients, 3 suppliers, owner ${ownerEmail}`);
if (!process.env.SEED_OWNER_PASSWORD) {
  console.warn('WARNING: development seed - the owner password is "changeme-dev-only".');
}
