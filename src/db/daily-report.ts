import { and, asc, desc, eq, gte, lt, inArray, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { ingredients, productionRuns, recipes, stockMovements, suppliers, users } from './schema.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import { istDayStart, istDayAfter } from '../lib/time.ts';
import { summarizePurchases, summarizeRuns, type RecordedRun, type RecordedMovement } from '../lib/daily-report.ts';

type Connection = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

function checkDay(day: string) {
  if (!istDayStart(day)) throw new RangeError('Choose a valid calendar date.');
}

export async function listProductionRuns(actor: Actor, day: string, recipeId?: string, conn: Connection = db): Promise<RecordedRun[]> {
  assertPermission(actor.role, 'production.record');
  checkDay(day);
  const rows = await conn.select({
    id: productionRuns.id, recipeId: productionRuns.recipeId, recipeName: recipes.name,
    producedOn: productionRuns.producedOn, batchesMilli: productionRuns.batchesMilli,
    expectedYieldMilliBase: productionRuns.expectedYieldMilliBase,
    actualYieldMilliBase: productionRuns.actualYieldMilliBase, yieldUnitType: productionRuns.yieldUnitType,
    batchCostPaise: productionRuns.batchCostPaise, note: productionRuns.note,
    userName: users.name, createdAt: productionRuns.createdAt,
  }).from(productionRuns)
    .innerJoin(recipes, and(eq(recipes.tenantId, productionRuns.tenantId), eq(recipes.id, productionRuns.recipeId)))
    .innerJoin(users, and(eq(users.tenantId, productionRuns.tenantId), eq(users.id, productionRuns.createdByUserId)))
    .where(and(eq(productionRuns.tenantId, actor.tenantId), eq(productionRuns.producedOn, day),
      recipeId ? eq(productionRuns.recipeId, recipeId) : undefined))
    .orderBy(desc(productionRuns.createdAt), asc(productionRuns.id));
  return rows.map(r => ({ ...r, batchesMilli: BigInt(r.batchesMilli),
    expectedYieldMilliBase: BigInt(r.expectedYieldMilliBase), actualYieldMilliBase: BigInt(r.actualYieldMilliBase),
    batchCostPaise: r.batchCostPaise === null ? null : BigInt(r.batchCostPaise) }));
}

/** All panels share a repeatable-read snapshot, including a run and its ledger draws. */
export async function getDailyReport(actor: Actor, day: string, recipeId?: string) {
  assertPermission(actor.role, 'production.record');
  assertPermission(actor.role, 'recipes.view');
  checkDay(day);
  return db.transaction(async tx => {
    const [runs, movementRows, usageRows] = await Promise.all([
      listProductionRuns(actor, day, recipeId, tx),
      tx.select({ id: stockMovements.id, referenceId: stockMovements.referenceId,
        ingredientId: ingredients.id, ingredientName: ingredients.name, unitType: ingredients.unitType,
        movementType: stockMovements.movementType, quantityMilliBase: stockMovements.quantityMilliBase,
        totalCostPaise: stockMovements.totalCostPaise, supplierName: suppliers.name,
        userName: users.name, reason: stockMovements.reason, createdAt: stockMovements.createdAt,
      }).from(stockMovements)
        .innerJoin(ingredients, and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId)))
        .leftJoin(suppliers, and(eq(suppliers.tenantId, stockMovements.tenantId), eq(suppliers.id, stockMovements.supplierId)))
        .leftJoin(users, and(eq(users.tenantId, stockMovements.tenantId), eq(users.id, stockMovements.createdByUserId)))
        .where(and(eq(stockMovements.tenantId, actor.tenantId), inArray(stockMovements.movementType, ['purchase', 'wastage']),
          gte(stockMovements.createdAt, istDayStart(day)!), lt(stockMovements.createdAt, istDayAfter(day)!)))
        .orderBy(asc(stockMovements.seq)),
      tx.select({ ingredientId: ingredients.id, name: ingredients.name, unitType: ingredients.unitType,
        // sum(bigint) is returned as a string. Keep the aggregate exact in BigInt.
        quantity: raw<string>`sum(-${stockMovements.quantityMilliBase})`.as('quantity'),
        prepared: raw<boolean>`exists (select 1 from ${recipes} r where r.tenant_id = ${ingredients.tenantId} and r.stock_ingredient_id = ${ingredients.id})`.as('prepared'),
      }).from(stockMovements)
        .innerJoin(productionRuns, and(eq(productionRuns.tenantId, stockMovements.tenantId),
          eq(productionRuns.id, stockMovements.referenceId)))
        .innerJoin(ingredients, and(eq(ingredients.tenantId, stockMovements.tenantId), eq(ingredients.id, stockMovements.ingredientId)))
        .where(and(eq(stockMovements.tenantId, actor.tenantId), eq(productionRuns.tenantId, actor.tenantId),
          eq(stockMovements.movementType, 'consumption'), eq(stockMovements.referenceType, 'production'),
          // A backdated run's materials belong to its working day, not its entry timestamp.
          eq(productionRuns.producedOn, day), recipeId ? eq(productionRuns.recipeId, recipeId) : undefined))
        .groupBy(ingredients.tenantId, ingredients.id, ingredients.name, ingredients.unitType)
        .orderBy(asc(ingredients.name)),
    ]);
    const movements: RecordedMovement[] = movementRows.map(r => ({ ...r,
      movementType: r.movementType as 'purchase' | 'wastage', quantityMilliBase: BigInt(r.quantityMilliBase),
      totalCostPaise: r.totalCostPaise === null ? null : BigInt(r.totalCostPaise) }));
    const purchases = summarizePurchases(movements);
    return { day, runs, production: summarizeRuns(runs), purchases,
      purchaseDetails: movements.filter(r => r.movementType === 'purchase'),
      wastage: movements.filter(r => r.movementType === 'wastage'),
      usage: usageRows.map(r => ({ ...r, quantityMilliBase: BigInt(r.quantity) })),
      totalPaidPaise: purchases.reduce<bigint | null>((total, r) => total === null || r.paidPaise === null ? null : total + r.paidPaise, 0n),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
