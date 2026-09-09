/**
 * Load the client's price list into a tenant.
 *
 *   node --env-file-if-exists=.env scripts/import-price-list.ts            # dry run
 *   node --env-file-if-exists=.env scripts/import-price-list.ts --commit   # writes
 *
 * Two things this deliberately does NOT do.
 *
 * It does not write SQL. Every ingredient goes through createIngredient() and every price
 * through recordReceipt(), so the same validation, the same rounding and the same audit
 * log apply as when someone types it into the form. A bulk import that takes a shortcut
 * around the write path is a second write path, and the two will disagree eventually.
 *
 * It does not invent a cost. A row whose pack size, price paid and per-kg rate contradict
 * each other is imported WITHOUT a price, and the app then reports it as uncosted, by
 * name, on the home screen. That is the whole rule in AGENTS.md - missing cost data is an
 * error, never a zero and never a guess.
 *
 * The opening prices land as ONE receipt, because that is what they are: a single event
 * that says "this is what everything costs as of today". Quantities are nominal until
 * someone counts the shelf; an adjustment moves a quantity and never moves the average,
 * so counting later cannot damage the prices imported here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { tenants, users, ingredients } from '../src/db/schema.ts';
import { createIngredient, DuplicateIngredientError } from '../src/db/ingredients.ts';
import { recordReceipt } from '../src/db/movements.ts';
import { purchaseUnitsToMilliBase, rupeesToPaise, formatINR, type UnitType } from '../src/lib/units.ts';
import type { Actor } from '../src/lib/auth.ts';

const DEFAULT_CSV = fileURLToPath(new URL('./data/price-list-2026-09.csv', import.meta.url));
const NOTE = 'Opening balance from the September 2026 price list';

type Row = {
  name: string;
  brand: string;
  unit_type: UnitType;
  purchase_unit: string;
  purchase_unit_in_base: string;
  opening_qty: string;
  opening_cost_rupees: string;
  source_row: string;
  note: string;
};

/** RFC 4180 enough for this file: quoted fields, doubled quotes inside them. */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      rows.push(record);
      record = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || record.length) {
    record.push(field);
    rows.push(record);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Row);
}

async function resolveTenant(wanted: string | undefined) {
  const all = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);

  if (wanted) {
    const hit = all.find((t) => t.id === wanted || t.name.toLowerCase() === wanted.toLowerCase());
    if (!hit) throw new Error(`No tenant matches "${wanted}"`);
    return hit;
  }

  // This writes to the ledger, so it never guesses which cafe it is writing to. A
  // development database fills up with test tenants, and picking the wrong one would be
  // both silent and tedious to unpick.
  const sizes = await db
    .select({ tenantId: ingredients.tenantId, n: count() })
    .from(ingredients)
    .groupBy(ingredients.tenantId);
  const byTenant = new Map(sizes.map((s) => [s.tenantId, s.n]));

  throw new Error(
    'Pass --tenant "<name>". The largest tenants are:\n' +
      [...all]
        .sort((a, b) => (byTenant.get(b.id) ?? 0) - (byTenant.get(a.id) ?? 0))
        .slice(0, 6)
        .map((t) => `  ${String(byTenant.get(t.id) ?? 0).padStart(4)} ingredients   ${t.name}`)
        .join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const commit = args.includes('--commit');
  const csvPath = flag('--file') ?? DEFAULT_CSV;

  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const tenant = await resolveTenant(flag('--tenant'));

  const [owner] = await db
    .select({ id: users.id, tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'owner'), isNull(users.deletedAt)));
  if (!owner) throw new Error(`Tenant ${tenant.name} has no owner to attribute the import to`);
  const actor: Actor = { id: owner.id, tenantId: owner.tenantId, role: 'owner' };

  const existing = await db
    .select({ name: ingredients.name })
    .from(ingredients)
    .where(and(eq(ingredients.tenantId, tenant.id), isNull(ingredients.deletedAt)));
  const taken = new Set(existing.map((e) => e.name.trim().toLowerCase()));

  const fresh = rows.filter((r) => !taken.has(r.name.trim().toLowerCase()));
  const collisions = rows.filter((r) => taken.has(r.name.trim().toLowerCase()));
  const priced = fresh.filter((r) => r.opening_qty && r.opening_cost_rupees);
  const uncosted = fresh.filter((r) => !r.opening_qty || !r.opening_cost_rupees);

  console.log(`\nPrice list : ${csvPath}`);
  console.log(`Tenant     : ${tenant.name}`);
  console.log(`Attributed : ${owner.id} (owner)`);
  console.log(`Mode       : ${commit ? 'COMMIT - this writes' : 'dry run - nothing is written'}\n`);
  console.log(`  ${rows.length} rows in the list`);
  console.log(`  ${fresh.length} new ingredients`);
  console.log(`     ${priced.length} with an opening price, as one receipt`);
  console.log(`     ${uncosted.length} left uncosted, because the sheet contradicts itself`);
  console.log(`  ${collisions.length} skipped, already in this tenant\n`);

  if (uncosted.length) {
    console.log('UNCOSTED - these will show on the home screen until a real delivery prices them:');
    for (const r of uncosted) console.log(`  ${r.name.padEnd(34)} ${r.note}`);
    console.log('');
  }
  if (collisions.length) {
    console.log('ALREADY PRESENT - left exactly as they are, price and history untouched:');
    for (const r of collisions) console.log(`  ${r.name}`);
    console.log('');
  }

  // What the ledger will derive, computed the same way the receipt form previews it.
  const lines = priced.map((r) => {
    const inBase = Number(r.purchase_unit_in_base);
    return {
      row: r,
      ingredientId: '',
      quantityMilliBase: purchaseUnitsToMilliBase(r.opening_qty, inBase),
      totalCostPaise: rupeesToPaise(r.opening_cost_rupees),
    };
  });

  console.log('OPENING PRICES (first 12):');
  for (const l of lines.slice(0, 12)) {
    const perUnit = (Number(l.totalCostPaise) / Number(l.row.opening_qty)).toFixed(0);
    console.log(
      `  ${l.row.name.slice(0, 30).padEnd(30)} ${l.row.opening_qty.padStart(6)} ${l.row.purchase_unit.padEnd(6)}` +
        ` ${formatINR(l.totalCostPaise).padStart(11)}  ->  ${formatINR(BigInt(perUnit))}/${l.row.purchase_unit}`,
    );
  }
  console.log(`  ... and ${Math.max(0, lines.length - 12)} more\n`);

  if (!commit) {
    console.log('Nothing was written. Re-run with --commit to apply.\n');
    return;
  }

  let created = 0;
  for (const l of lines.concat(uncosted.map((r) => ({ row: r, ingredientId: '', quantityMilliBase: 0n, totalCostPaise: 0n })))) {
    const r = l.row;
    try {
      const made = await createIngredient(actor, {
        name: r.name,
        brand: r.brand || null,
        unitType: r.unit_type,
        purchaseUnit: r.purchase_unit,
        purchaseUnitInBase: Number(r.purchase_unit_in_base),
        lowStockThresholdMilliBase: 0,
      });
      l.ingredientId = made.id;
      created++;
    } catch (err) {
      if (err instanceof DuplicateIngredientError) {
        console.log(`  skipped (raced): ${r.name}`);
        continue;
      }
      throw err;
    }
  }

  const receiptLines = lines
    .filter((l) => l.ingredientId)
    .map((l) => ({
      ingredientId: l.ingredientId,
      quantityMilliBase: l.quantityMilliBase,
      totalCostPaise: l.totalCostPaise,
    }));

  const receipt = await recordReceipt(actor, { note: NOTE, lines: receiptLines });

  console.log(`\ncreated ${created} ingredients`);
  console.log(`recorded one receipt of ${receipt.lineCount} lines (${receipt.referenceId})`);
  console.log(`${uncosted.length} ingredients carry no cost basis yet, by design\n`);
}

await main();
process.exit(0);
