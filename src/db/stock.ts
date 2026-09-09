/**
 * The database shell around the pure stock arithmetic in src/lib/stock.ts.
 *
 * This file contains no arithmetic of its own, on purpose. Both routes that maintain
 * ingredient_stock - the per-movement cache update and a full rebuild - call the same
 * replayLedger(), so they cannot disagree about a number. The only divergence left
 * possible is a write that did not happen, and that is what the tests here check.
 */
import { and, eq, asc, gt, sql as raw } from 'drizzle-orm';
import { db } from './client.ts';
import { stockMovements, ingredientStock, auditLog } from './schema.ts';
import { replayLedger, EMPTY_STOCK, type Movement, type StockState } from '../lib/stock.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialise everything that touches one ingredient's ledger.
 *
 * WHY THIS EXISTS. The cache is derived by reading the ledger and writing the result
 * back. Two transactions doing that concurrently on the same ingredient both read before
 * either commits, and the second write overwrites the first one's movement out of the
 * cache: stock and weighted-average cost both end up wrong, silently, and stay wrong
 * until somebody rebuilds. A row lock on ingredient_stock does NOT fix it - by the time
 * the second transaction blocks on the write, it has already read a stale ledger, and
 * the row may not exist yet on a first purchase.
 *
 * The lock is taken BEFORE the movement is inserted, not just before the read, which
 * additionally keeps `seq` assignment in the same order as commits. That matters for the
 * watermark below: if a transaction could commit a movement with a seq LOWER than one
 * already folded in, the next incremental fold would skip it forever.
 *
 * Transaction-scoped, so it is released on commit or rollback with no unlock path to
 * forget. Callers take these in a deterministic order (sorted by ingredient) so two
 * multi-line receipts naming the same ingredients cannot deadlock.
 */
async function lockIngredient(tx: Tx, tenantId: string, ingredientId: string) {
  await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${ingredientId}`}, 0))`);
}

/**
 * Bring one ingredient's cached stock up to date with the ledger, and write it back.
 * Must run inside the same transaction as whatever movement triggered it.
 *
 * Ordinarily this folds only the movements that arrived since the cached watermark,
 * starting from the cached state. `rebuild` throws the cache away and folds the whole
 * ledger from empty - the operation that proves the cache is still derivable from the
 * source of truth, and the one the tests use to check exactly that.
 *
 * Both paths call the same replayLedger(); only the starting state and the range of
 * movements differ.
 */
export async function recalculateStock(
  tx: Tx,
  tenantId: string,
  ingredientId: string,
  opts: { rebuild?: boolean } = {},
) {
  await lockIngredient(tx, tenantId, ingredientId);

  const cached = opts.rebuild
    ? []
    : await tx
        .select({
          qtyMilliBase: ingredientStock.qtyMilliBase,
          weightedAvgCostMillipaisePerBase: ingredientStock.weightedAvgCostMillipaisePerBase,
          snapshotSeq: ingredientStock.snapshotSeq,
        })
        .from(ingredientStock)
        .where(
          and(eq(ingredientStock.tenantId, tenantId), eq(ingredientStock.ingredientId, ingredientId)),
        );

  const from: StockState = cached.length
    ? {
        qtyMilliBase: BigInt(cached[0].qtyMilliBase),
        weightedAvgCostMillipaisePerBase: BigInt(cached[0].weightedAvgCostMillipaisePerBase),
      }
    : EMPTY_STOCK;
  const since = cached.length ? Number(cached[0].snapshotSeq) : 0;

  const rows = await tx
    .select({
      seq: stockMovements.seq,
      movementType: stockMovements.movementType,
      quantityMilliBase: stockMovements.quantityMilliBase,
      unitCostMillipaisePerBase: stockMovements.unitCostMillipaisePerBase,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.ingredientId, ingredientId),
        // Everything the cache has not seen. On a rebuild, `since` is 0, which is
        // everything - seq is a bigserial and starts at 1.
        gt(stockMovements.seq, since),
      ),
    )
    .orderBy(asc(stockMovements.seq)); // ledger order, never created_at

  const movements: Movement[] = rows.map((r) => ({
    movementType: r.movementType,
    quantityMilliBase: BigInt(r.quantityMilliBase),
    unitCostMillipaisePerBase:
      r.unitCostMillipaisePerBase == null ? null : BigInt(r.unitCostMillipaisePerBase),
  }));

  const next = replayLedger(movements, from);
  const values = {
    qtyMilliBase: Number(next.qtyMilliBase),
    weightedAvgCostMillipaisePerBase: Number(next.weightedAvgCostMillipaisePerBase),
    // Nothing new to fold leaves the watermark where it was.
    snapshotSeq: rows.length ? Number(rows[rows.length - 1].seq) : since,
    updatedAt: new Date(),
  };

  await tx
    .insert(ingredientStock)
    .values({ tenantId, ingredientId, ...values })
    .onConflictDoUpdate({
      target: [ingredientStock.tenantId, ingredientStock.ingredientId],
      set: values,
    });

  return next;
}

export type MovementInput = typeof stockMovements.$inferInsert;

const ACTION_BY_TYPE: Record<string, string> = {
  purchase: 'stock.receipt',
  wastage: 'stock.wastage',
  adjustment: 'stock.adjustment',
  consumption: 'stock.consumption',
  reversal: 'stock.reversal',
};

/**
 * What the group of movements was, for the audit log. Derived rather than passed in,
 * so no caller can forget it or label it wrongly.
 */
function auditAction(lines: MovementInput[]): string {
  const types = new Set(lines.map((l) => l.movementType));
  if (types.size !== 1) return 'stock.movement';
  const [only] = types;
  return ACTION_BY_TYPE[only] ?? 'stock.movement';
}

/**
 * Insert one or more movements and refresh the affected caches, all in one
 * transaction. A multi-line receipt is one call: if any line fails - a constraint,
 * a bad ingredient - the whole receipt rolls back and the ledger is untouched.
 */
export async function recordMovements(lines: MovementInput[], tx?: Tx) {
  if (lines.length === 0) throw new RangeError('no movements to record');
  const run = async (t: Tx) => {
    // Deduped by ingredient: a receipt may name the same ingredient twice.
    const affected = new Map(lines.map((l) => [l.ingredientId, l.tenantId]));

    // LOCK FIRST, INSERT SECOND. Taking these after the insert would still stop two
    // caches being written from stale reads, but it would let two transactions be
    // assigned `seq` in one order and commit in the other - and the watermark in
    // recalculateStock would then step past a movement that had not been folded in.
    // Sorted, so two receipts naming the same ingredients in different orders queue up
    // instead of deadlocking.
    for (const [ingredientId, tenantId] of [...affected].sort(([a], [b]) => (a < b ? -1 : 1))) {
      await lockIngredient(t, tenantId, ingredientId);
    }

    await t.insert(stockMovements).values(lines);
    // Deliberately NOT folding `lines` in array order here. The cache is defined as
    // "replay the ledger in seq order", full stop, so recalculateStock re-reads what
    // was just written and folds THAT. Whatever order Postgres assigned seq in is the
    // order we fold in, by construction - the incremental path and a rebuild cannot
    // drift apart on a multi-line receipt. Do not turn this into an in-memory
    // incremental update; the saving is a few rows and the cost is a class of bug
    // that only shows up on real receipts.
    //
    // Snapshotting landed 2026-09-09: recalculateStock folds only what arrived since the
    // cached watermark, so this is O(new movements) rather than O(whole ledger). A full
    // rebuild is still one call away and is what the tests check the cache against.

    for (const [ingredientId, tenantId] of affected) {
      await recalculateStock(t, tenantId, ingredientId);
    }

    // Audit lives here rather than in each caller, so a future movement path cannot
    // ship without one. ONE entry per operation, not per line: stock_movements already
    // records who and when for every row, so a per-line copy would add volume without
    // adding information. The lines are carried in afterJson.
    await t.insert(auditLog).values({
      tenantId: lines[0].tenantId,
      userId: lines[0].createdByUserId,
      action: auditAction(lines),
      entityType: 'stock_movement',
      entityId: lines[0].referenceId ?? null,
      afterJson: lines.map((l) => ({
        ingredientId: l.ingredientId,
        movementType: l.movementType,
        quantityMilliBase: l.quantityMilliBase,
        unitCostMillipaisePerBase: l.unitCostMillipaisePerBase ?? null,
        totalCostPaise: l.totalCostPaise ?? null,
        reason: l.reason ?? null,
        note: l.note ?? null,
      })),
    });
  };

  return tx ? run(tx) : db.transaction(run);
}

