import { createHash } from 'node:crypto';
import { and, eq, sql as raw } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client.ts';
import { auditLog } from './schema.ts';
import { createIngredient, listIngredients } from './ingredients.ts';
import { recordOpeningStock, recordReceipt, type ReceiptLine } from './movements.ts';
import { assertPermission, type Actor } from '../lib/auth.ts';
import { ingredientFormInput } from '../lib/ingredient-form.ts';
import { matchStockImport, parseStockImport, stockImportAmounts, StockImportMode, STOCK_IMPORT_BYTES } from '../lib/stock-import.ts';

export const StockImportSubmission = z.object({
  csv: z.string().max(STOCK_IMPORT_BYTES), mode: StockImportMode,
  reference: z.string().trim().max(120),
  expectedIds: z.array(z.uuid().nullable()).min(1).max(100),
});

/** Existing ingredient/ledger writers, one transaction, one immutable import manifest. No new cost arithmetic. */
export async function saveStockImport(actor: Actor, untrusted: z.infer<typeof StockImportSubmission>) {
  assertPermission(actor.role, 'ingredients.manage');
  const input = StockImportSubmission.parse(untrusted);
  const parsed = parseStockImport(input.csv);
  if (parsed.issues.length || input.expectedIds.length !== parsed.rows.length) throw new RangeError('Fix every file error and preview the file again before importing.');
  // Canonical data, mode and the operator's delivery reference identify an import.
  // A fresh preview, reordered headers or a repeated upload cannot duplicate the same stock.
  const digest = createHash('sha256').update(JSON.stringify({ mode: input.mode, reference: input.reference, rows: parsed.rows })).digest('hex');
  const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return db.transaction(async tx => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`stock-import:${actor.tenantId}:${requestId}`}, 0))`);
    const [previous] = await tx.select({ result: auditLog.afterJson }).from(auditLog).where(and(
      eq(auditLog.tenantId, actor.tenantId), eq(auditLog.action, 'stock.import'), eq(auditLog.entityId, requestId),
    )).limit(1);
    if (previous) {
      const saved = z.object({ created: z.number().int(), stockLines: z.number().int() }).parse(previous.result);
      return { ...saved, replayed: true };
    }
    const current = await listIngredients(actor, { activeOnly: false }, tx);
    const matches = matchStockImport(parsed.rows, current);
    if (matches.some((match, i) => match.error || match.ingredientId !== input.expectedIds[i])) {
      throw new RangeError('The ingredient list changed after your preview. Preview the file again. Nothing was saved.');
    }
    const lines: ReceiptLine[] = []; let created = 0;
    for (const [i, row] of parsed.rows.entries()) {
      let ingredientId = matches[i].ingredientId;
      if (!ingredientId) {
        const ingredient = await createIngredient(actor, ingredientFormInput(row), tx);
        ingredientId = ingredient.id; created++;
      }
      const amounts = stockImportAmounts(row);
      if (amounts) lines.push({ ingredientId, ...amounts, entryUnitType: row.unitType, entryPurchaseUnitInBase: row.purchaseUnitInBase });
    }
    if (lines.length) await (input.mode === 'opening' ? recordOpeningStock : recordReceipt)(actor, {
      requestId, note: input.reference || null, lines,
    }, tx);
    const result = { created, stockLines: lines.length };
    await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.id, action: 'stock.import',
      entityType: 'stock_import', entityId: requestId, afterJson: { ...result, mode: input.mode, digest, reference: input.reference } });
    return { ...result, replayed: false };
  });
}
