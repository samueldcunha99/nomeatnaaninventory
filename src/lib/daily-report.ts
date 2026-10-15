import { divRoundHalfUp, integerToDecimal, type UnitType } from './units.ts';

export type RecordedRun = {
  id: string; recipeId: string; recipeName: string; producedOn: string;
  batchesMilli: bigint; expectedYieldMilliBase: bigint; actualYieldMilliBase: bigint;
  yieldUnitType: UnitType; batchCostPaise: bigint | null;
  note: string | null; userName: string | null; createdAt: Date;
};

export type RecordedMovement = {
  id: string; referenceId: string | null; ingredientId: string; ingredientName: string;
  unitType: UnitType; movementType: 'purchase' | 'wastage'; quantityMilliBase: bigint;
  totalCostPaise: bigint | null; supplierName: string | null; userName: string | null;
  reason: string | null; createdAt: Date;
};

/** Summation of recorded snapshots, never a recalculation from today's recipes. */
export function summarizeRuns(runs: readonly RecordedRun[]) {
  const groups = new Map<string, {
    recipeId: string; name: string; unitType: UnitType; runs: number;
    batchesMilli: bigint; expectedMilliBase: bigint; actualMilliBase: bigint;
    costPaise: bigint | null; uncostedRuns: number;
  }>();
  for (const run of runs) {
    // A recipe can change yield type when unused. Historical grams must not be
    // added to its later millilitres just because the recipe ID stayed the same.
    const key = `${run.recipeId}:${run.yieldUnitType}`;
    const group = groups.get(key) ?? { recipeId: run.recipeId, name: run.recipeName,
      unitType: run.yieldUnitType, runs: 0, batchesMilli: 0n, expectedMilliBase: 0n,
      actualMilliBase: 0n, costPaise: 0n, uncostedRuns: 0 };
    group.runs++;
    group.batchesMilli += run.batchesMilli;
    group.expectedMilliBase += run.expectedYieldMilliBase;
    group.actualMilliBase += run.actualYieldMilliBase;
    if (run.batchCostPaise === null) { group.uncostedRuns++; group.costPaise = null; }
    else if (group.costPaise !== null) group.costPaise += run.batchCostPaise;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.unitType.localeCompare(b.unitType));
}

export function summarizePurchases(movements: readonly RecordedMovement[]) {
  const groups = new Map<string, { ingredientId: string; name: string; unitType: UnitType;
    quantityMilliBase: bigint; paidPaise: bigint | null }>();
  for (const row of movements.filter(m => m.movementType === 'purchase')) {
    const key = `${row.ingredientId}:${row.unitType}`;
    const group = groups.get(key) ?? { ingredientId: row.ingredientId, name: row.ingredientName,
      unitType: row.unitType, quantityMilliBase: 0n, paidPaise: 0n };
    group.quantityMilliBase += row.quantityMilliBase;
    group.paidPaise = group.paidPaise === null || row.totalCostPaise === null
      ? null : group.paidPaise + row.totalCostPaise;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Display-only percentage; round the magnitude and restore its sign. */
export function formatYieldVariance(actual: bigint, expected: bigint): string {
  if (expected <= 0n) return 'Not available';
  const difference = actual - expected;
  const magnitude = difference < 0n ? -difference : difference;
  const decimal = integerToDecimal(divRoundHalfUp(magnitude * 1000n, expected), 10n);
  return `${difference < 0n ? '-' : difference > 0n ? '+' : ''}${decimal}%`;
}
