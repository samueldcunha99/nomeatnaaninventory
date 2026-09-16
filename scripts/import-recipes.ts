/**
 * Load the café's recipe book — transcribed from "No Meat Naan shop Product Recipe.pdf" —
 * into a tenant.
 *
 *   node --env-file-if-exists=.env scripts/import-recipes.ts --tenant "Nomeatnaan"          # dry run
 *   node --env-file-if-exists=.env scripts/import-recipes.ts --tenant "Nomeatnaan" --commit
 *
 * Same two rules as the price-list importer, for the same reasons.
 *
 * It does not write SQL. Every ingredient goes through createIngredient(), every price
 * through recordReceipt() and every recipe through saveRecipe(), so unit compatibility,
 * cycle and depth checks, rounding and the audit log all apply exactly as they would if
 * someone typed it into the form.
 *
 * It does not invent a number in silence. Everything this script derives rather than
 * reads — a yield, a quantity the PDF wrote in words, a price — is derived by a rule
 * written down below, and lands in the recipe's notes field so the café can see what was
 * assumed and correct it.
 *
 * What the PDF could not supply, and what this does about it:
 *
 *   YIELD. The database requires one: it is the divisor for every cost, so a recipe
 *   without it cannot exist. The PDF states a yield for 22 batch preparations and for
 *   nothing else, because for everything else the answer is obvious — a cappuccino recipe
 *   makes one cappuccino. Servings therefore yield 1 unit, which is a reading of the
 *   document rather than a guess about it.
 *
 *   QUANTITIES IN WORDS. "3/4 cup" of ice, "1 pinch" of chat masala, "half cup". WORDS
 *   below converts them, using the café's own figures wherever the same document writes
 *   the same thing as a number — their ice is "3/4 cup" in one recipe and "120 gm" in the
 *   next, so 3/4 cup is 120 g here.
 *
 *   RECIPES THE PDF NAMES BUT NEVER DEFINES. Eight rolls list "Cinnemon roll — 1 pcs" and
 *   the document contains no cinnamon roll recipe; likewise paneer tikka bhaji, strawberry
 *   compote and three others. Each becomes an ingredient with NO purchase history, so those
 *   recipes report "cannot be costed" naming the thing that is missing, instead of quietly
 *   costing £23 short. Replace each with a real recipe as the café writes it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { tenants, users, ingredients, recipes, stockMovements } from '../src/db/schema.ts';
import { createIngredient } from '../src/db/ingredients.ts';
import { recordReceipt } from '../src/db/movements.ts';
import { saveRecipe } from '../src/db/recipes.ts';
import { formatINR, type UnitType } from '../src/lib/units.ts';
import type { Actor } from '../src/lib/auth.ts';

const dataFile = (name: string) => fileURLToPath(new URL(`./data/${name}`, import.meta.url));
const PRICE_NOTE = 'Opening price derived from the recipe PDF, September 2026';

/**
 * Quantities the PDF writes in words, in base units.
 *
 * Ice is the café's own number: the same document writes "3/4 cup" in one recipe and
 * "120 gm" in the next for the same scoop, and "1 cold cup" against a 130 gm entry
 * elsewhere. The rest are ordinary kitchen measures. Every line converted this way says
 * so in the recipe's notes.
 */
const WORDS: Record<string, number> = {
  '3/4 cup': 120,
  '3/4 th': 120,
  '3/4': 120,
  'half cup': 80,
  half: 80,
  '1/2 cup': 80,
  '1/4 cup': 40,
  '1 cup': 160,
  '1 cold cup': 160,
  '1 pinch': 1,
  pinch: 1,
  '1 tsp': 5,
  tsp: 5,
};

/**
 * Herbs, salt and the like are costed in the PDF but written with no quantity at all —
 * "all harbs   -   2". The seasoning is real and so is its cost, so the line is kept at
 * the smallest quantity the document ever gives for that thing elsewhere.
 */
const SEASONING_DEFAULT_G: Record<string, number> = {
  'Mixed Herbs': 7,
  Salt: 5,
  'Chat Masala': 1,
  'Black Pepper': 4,
  'Vanilla Essence': 5,
  'Lemon Powder': 2,
  'Irish Flavour Syrup': 30,
  'Milk (full cream)': 50,
  'Lime Zest': 0, // The PDF writes "Lime zest 0 0". Zero means the line is dropped.
};

/** The PDF states these differently, or not at all. Each is explained in the report. */
const YIELD_OVERRIDES: Record<string, { qty: number; unit: UnitType; why: string }> = {
  'Clasic cold coffee': {
    qty: 82,
    unit: 'count',
    why: 'the PDF says "25 per glass, 82 glasses" rather than a weight',
  },
  'Coconut vietnamese syrup': {
    qty: 340,
    unit: 'weight',
    why: 'no yield stated; blended cold with nothing driven off, so the inputs (80+160+100 g) are the output',
  },
  'Masala sandwich masala': {
    qty: 30,
    unit: 'weight',
    why: 'no yield stated; mixed, not cooked, so the inputs (20 g butter + 10 g spice) are the output',
  },
};

/** References the PDF resolves elsewhere under another spelling. */
const ALIASES: Record<string, string> = {
  'Makhni sauce': 'Makhani sauce',
  'Paneer makhni sauce': 'Makhani sauce',
  'Onion/green capcicum': 'Mixed Vegetables',
};

/**
 * Named, never defined. Each becomes an uncosted ingredient, not a fabricated recipe.
 * The unit is the one the PDF measures it in — "Cinnemon roll 1 pcs" is a count, a bhaji
 * used 100 gm at a time is a weight — because a line cannot be saved against a source
 * that measures in something else.
 */
const PLACEHOLDERS: Record<string, { as: string; unitType: UnitType; unit: string; inBase: number }> = {
  'Cinnemon roll': { as: 'Cinnamon roll (plain)', unitType: 'count', unit: 'piece', inBase: 1 },
  'Paneer tikka bhaji': { as: 'Paneer tikka bhaji', unitType: 'weight', unit: 'kg', inBase: 1000 },
  'Spinach & paneer bhaji': { as: 'Spinach & paneer bhaji', unitType: 'weight', unit: 'kg', inBase: 1000 },
  'Strawberry compote': { as: 'Strawberry compote', unitType: 'weight', unit: 'kg', inBase: 1000 },
  'Cho+icing': { as: 'Chocolate icing (cho+icing)', unitType: 'weight', unit: 'kg', inBase: 1000 },
};

const PLACEHOLDER_NOTE =
  'The recipe PDF uses this but never gives a recipe for it. It has no purchase history, ' +
  'so anything using it reports as uncosted until the café either prices it or writes the recipe.';

type Csv = Record<string, string>;

/** RFC 4180 enough for these files: quoted fields, doubled quotes inside them. */
function parseCsv(text: string): Csv[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || record.length) { record.push(field); rows.push(record); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Median. Even counts take the lower of the two middles — a price, not an average. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

async function resolveTenant(wanted: string | undefined) {
  const rows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const matches = wanted
    ? rows.filter((t) => t.name.toLowerCase().includes(wanted.toLowerCase()))
    : [];
  if (matches.length === 1) return matches[0];
  throw new Error(
    `Pass --tenant "<name>" matching exactly one of:\n` +
      rows.map((t) => `  ${t.name}`).join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const commit = args.includes('--commit');

  const tenant = await resolveTenant(flag('--tenant'));
  const [owner] = await db
    .select({ id: users.id, tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'owner'), isNull(users.deletedAt)));
  if (!owner) throw new Error(`${tenant.name} has no owner account to attribute this import to.`);
  const actor: Actor = { id: owner.id, tenantId: owner.tenantId, role: 'owner' };

  const recipeRows = parseCsv(readFileSync(dataFile('recipes-2026-09.csv'), 'utf8'));
  const lineRows = parseCsv(readFileSync(dataFile('recipe-lines-2026-09.csv'), 'utf8'));
  const neededRows = parseCsv(readFileSync(dataFile('ingredients-needed-2026-09.csv'), 'utf8'));
  const priceRows = parseCsv(readFileSync(dataFile('pdf-price-observations-2026-09.csv'), 'utf8'));

  console.log(`\n${tenant.name}`);
  console.log(`${recipeRows.length} recipes, ${lineRows.length} lines from the recipe PDF\n`);

  /* ---- 1. the ingredients the menu needs -------------------------------- */

  const existing = new Map(
    (
      await db
        .select({ id: ingredients.id, name: ingredients.name, unitType: ingredients.unitType })
        .from(ingredients)
        .where(and(eq(ingredients.tenantId, tenant.id), isNull(ingredients.deletedAt)))
    ).map((r) => [r.name.toLowerCase(), r]),
  );

  // Every source the lines draw on that is not a recipe, plus the placeholders.
  const wanted = new Map<string, { unitType: UnitType; unit: string; inBase: number; placeholder: boolean }>();
  for (const r of neededRows) {
    wanted.set(r.name, {
      unitType: r.unit_type as UnitType,
      unit: r.purchase_unit,
      inBase: Number(r.purchase_unit_in_base),
      placeholder: false,
    });
  }
  for (const l of lineRows) {
    if (l.source_kind !== 'unknown') continue;
    if (ALIASES[l.source]) continue; // resolved to a real recipe or ingredient below
    const p = PLACEHOLDERS[l.source];
    if (!p) continue;
    if (!wanted.has(p.as)) {
      wanted.set(p.as, { unitType: p.unitType, unit: p.unit, inBase: p.inBase, placeholder: true });
    }
  }

  const toCreate = [...wanted].filter(([name]) => !existing.has(name.toLowerCase()));
  console.log(`ingredients: ${existing.size} already here, ${toCreate.length} to create`);
  for (const [name, spec] of toCreate.filter(([, s]) => s.placeholder)) {
    console.log(`  placeholder  ${name}  (${spec.unit})`);
  }

  /* ---- 2. prices, from the PDF's own RS column --------------------------- */

  const obs = new Map<string, { seen: Array<{ qty: number; rate: number }>; inBase: number; unit: string }>();
  for (const p of priceRows) {
    const qty = Number(p.observed_qty_base);
    const rs = Number(p.observed_rupees);
    if (!(qty > 0) || !(rs > 0)) continue;
    const e = obs.get(p.name) ?? { seen: [], inBase: Number(p.purchase_unit_in_base), unit: p.purchase_unit };
    e.seen.push({ qty, rate: rs / qty }); // rupees per base unit
    obs.set(p.name, e);
  }

  /*
   * The largest quantity the PDF gives for a thing is its price. The small ones are not.
   *
   * The sheet rounds to whole rupees, so "ice, 3/4 cup, Rs 6" works out at Rs 50/kg while
   * the same document's bulk line - 3.2 kg for Rs 58 - says Rs 18/kg. Ice does not cost
   * Rs 50 a kilo. The per-drink figure is a serving charge rounded up to the rupee; the
   * bulk figure is what a delivery cost. Same story for coriander (870 g for Rs 20 against
   * 30 g of garnish for Rs 10), and for milk, ice cream and tomato.
   *
   * A median would have taken the serving charge here, because five of ice's six entries
   * are servings. So: the observation with the largest quantity, and a printed warning
   * wherever the rest disagree with it badly enough that somebody should look.
   */
  const derived = new Map<
    string,
    { rupeesPerPurchaseUnit: number; from: number; unit: string; inBase: number; spread: number }
  >();
  for (const [name, e] of obs) {
    const biggest = e.seen.reduce((a, b) => (b.qty > a.qty ? b : a));
    const rates = e.seen.map((o) => o.rate);
    derived.set(name, {
      rupeesPerPurchaseUnit: biggest.rate * e.inBase,
      from: e.seen.length,
      unit: e.unit,
      inBase: e.inBase,
      spread: Math.max(...rates) / Math.min(...rates),
    });
  }


  // Anything the PDF prices that this tenant cannot cost yet - the ingredients created
  // just now, and any already in the catalogue that the September price list left without
  // a price, because a row whose pack size and rate contradicted each other was imported
  // deliberately unpriced. Dry yeast, white vinegar and mascarpone came in that way, and
  // between them they blocked 24 recipes.
  const priceLines = [...derived].filter(
    ([name]) => wanted.has(name) || existing.has(name.toLowerCase()),
  );
  console.log(`prices:      ${priceLines.length} derived from the PDF's own rupee column\n`);

  const argued = priceLines.filter(([, d]) => d.spread >= 3 && d.from > 1);
  if (argued.length) {
    console.log(`WORTH A LOOK - the PDF prices these inconsistently across recipes (${argued.length}):`);
    for (const [name, d] of argued) {
      console.log(
        `  ${name.padEnd(26)} ${formatINR(BigInt(Math.round(d.rupeesPerPurchaseUnit * 100))).padStart(10)} / ${d.unit}` +
          `   its ${d.from} entries disagree by ${d.spread.toFixed(1)}x`,
      );
    }
    console.log('');
  }

  if (!commit) {
    for (const [name, d] of priceLines.slice(0, 10)) {
      console.log(`  ${name.padEnd(28)} ${formatINR(BigInt(Math.round(d.rupeesPerPurchaseUnit * 100)))} / ${d.unit}  (largest of ${d.from} entries)`);
    }
    console.log(`  ... and ${Math.max(0, priceLines.length - 10)} more`);
    console.log('Nothing was written. Re-run with --commit to apply.');
    return;
  }

  for (const [name, spec] of toCreate) {
    const made = await createIngredient(actor, {
      name,
      unitType: spec.unitType,
      purchaseUnit: spec.unit,
      purchaseUnitInBase: spec.inBase,
      lowStockThresholdMilliBase: 0,
      notes: spec.placeholder ? PLACEHOLDER_NOTE : 'Added from the recipe PDF, September 2026',
    } as Parameters<typeof createIngredient>[1]);
    existing.set(name.toLowerCase(), { id: made.id, name: made.name, unitType: made.unitType });
  }
  console.log(`created ${toCreate.length} ingredients`);

  // One receipt: a single event saying "this is what these cost as of today". A nominal
  // one purchase unit each — the quantity is corrected by counting the shelf, and an
  // adjustment never moves the average, so counting later cannot damage these prices.
  // Only ingredients with NO purchase history. Re-running this must not price anything
  // twice: a second identical purchase leaves the weighted average alone but doubles the
  // quantity, and the ledger is append-only, so the tidy-up is worse than the guard.
  const alreadyPriced = new Set(
    (
      await db
        .selectDistinct({ id: stockMovements.ingredientId })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenant.id), eq(stockMovements.movementType, 'purchase')))
    ).map((r) => r.id),
  );

  const receiptLines = priceLines
    .map(([name, d]) => {
      const ing = existing.get(name.toLowerCase());
      const paise = BigInt(Math.round(d.rupeesPerPurchaseUnit * 100));
      if (!ing || paise <= 0n || alreadyPriced.has(ing.id)) return null;
      return {
        ingredientId: ing.id,
        quantityMilliBase: BigInt(d.inBase) * 1000n,
        totalCostPaise: paise,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (receiptLines.length) {
    await recordReceipt(actor, { note: PRICE_NOTE, lines: receiptLines });
    console.log(`priced ${receiptLines.length} ingredients through one opening receipt`);
  } else {
    console.log('priced 0 ingredients - everything that needed a price already has one');
  }

  /* ---- 3. the recipes ---------------------------------------------------- */

  const linesByRecipe = new Map<string, Csv[]>();
  for (const l of lineRows) {
    const list = linesByRecipe.get(l.recipe) ?? [];
    list.push(l);
    linesByRecipe.set(l.recipe, list);
  }

  const madeRecipes = new Map<string, { id: string; unitType: UnitType }>();
  for (const r of await db
    .select({ id: recipes.id, name: recipes.name, yieldUnitType: recipes.yieldUnitType })
    .from(recipes)
    .where(and(eq(recipes.tenantId, tenant.id), isNull(recipes.deletedAt)))
    .orderBy(asc(recipes.name))) {
    madeRecipes.set(r.name.toLowerCase(), { id: r.id, unitType: r.yieldUnitType });
  }

  const notes: string[] = [];
  let pending = [...recipeRows];
  let created = 0;
  const skipped: Array<{ name: string; why: string }> = [];

  // Preparations before the things that draw on them. Repeated passes rather than a
  // topological sort: 139 recipes, at most four levels deep, and a pass that creates
  // nothing means the rest genuinely cannot be resolved.
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const stuck: typeof pending = [];
    for (const r of pending) {
      // Re-runnable: a recipe already in the catalogue is left exactly as it is, so a
      // second run after fixing one row in the CSV imports that row and nothing else.
      // Editing an imported recipe is a job for the app, not for re-running this.
      if (madeRecipes.has(r.name.toLowerCase())) continue;
      const src = linesByRecipe.get(r.name) ?? [];
      const deps = src.filter((l) => l.source_kind === 'recipe').map((l) => ALIASES[l.source] ?? l.source);
      if (deps.some((d) => !madeRecipes.has(d.toLowerCase()))) {
        stuck.push(r);
        continue;
      }

      const assumed: string[] = [];
      const lines = [];
      for (const l of src) {
        const name = ALIASES[l.source] ?? PLACEHOLDERS[l.source]?.as ?? l.source;

        // Quantity: a number, a word this script converts, or a seasoning default.
        let qtyBase: number | undefined = l.quantity ? Number(l.quantity) : undefined;
        if (qtyBase === undefined) {
          const key = (l.as_written || '').toLowerCase().trim();
          const word = Object.keys(WORDS).find((w) => key.includes(w));
          if (word) {
            qtyBase = WORDS[word];
            assumed.push(`"${l.as_written}" of ${name} taken as ${qtyBase} ${name.includes('Milk') ? 'ml' : 'g'}`);
          } else if (name in SEASONING_DEFAULT_G) {
            qtyBase = SEASONING_DEFAULT_G[name];
            if (qtyBase > 0) assumed.push(`${name} has no quantity in the PDF, taken as ${qtyBase} g`);
          }
        }
        if (!qtyBase || qtyBase <= 0) {
          if (l.source) assumed.push(`${name} dropped — the PDF gives no usable quantity`);
          continue;
        }

        if (l.source_kind === 'recipe') {
          const sub = madeRecipes.get(name.toLowerCase())!;
          lines.push({
            subRecipeId: sub.id,
            quantityMilliBase: BigInt(Math.round(qtyBase * 1000)),
            entryUnitType: sub.unitType,
          });
        } else {
          const ing = existing.get(name.toLowerCase());
          if (!ing) { assumed.push(`${name} is not in the catalogue — line dropped`); continue; }
          lines.push({
            ingredientId: ing.id,
            quantityMilliBase: BigInt(Math.round(qtyBase * 1000)),
            entryUnitType: ing.unitType,
          });
        }
      }

      if (!lines.length) { skipped.push({ name: r.name, why: 'no usable lines' }); continue; }

      // Yield.
      const override = YIELD_OVERRIDES[r.name];
      let yieldQty: number;
      let yieldUnit: UnitType;
      if (override) {
        yieldQty = override.qty;
        yieldUnit = override.unit;
        assumed.push(`Yield ${override.qty}: ${override.why}`);
      } else if (r.yield_qty) {
        yieldQty = Number(r.yield_qty);
        yieldUnit = r.yield_unit === 'ml' ? 'volume' : r.yield_unit === 'g' ? 'weight' : 'count';
      } else {
        yieldQty = 1;
        yieldUnit = 'count';
        assumed.push('Yield 1 serving — the PDF costs this per serving and states no batch yield');
      }

      const note = [r.note, ...assumed].filter(Boolean).join('. ');
      try {
        const id = await saveRecipe(actor, {
          name: r.name,
          yieldUnitType: yieldUnit,
          yieldQtyMilliBase: BigInt(Math.round(yieldQty * 1000)),
          batchMinutes: r.batch_minutes ? Number(r.batch_minutes) : null,
          notes: note || null,
          lines,
        });
        madeRecipes.set(r.name.toLowerCase(), { id, unitType: yieldUnit });
        created++;
        if (assumed.length) notes.push(`${r.name}: ${assumed.join('; ')}`);
      } catch (err) {
        skipped.push({ name: r.name, why: err instanceof Error ? err.message : String(err) });
      }
    }
    if (stuck.length === pending.length) break; // nothing moved; the rest cannot resolve
    pending = stuck;
  }

  console.log(`\ncreated ${created} recipes`);
  for (const p of pending) skipped.push({ name: p.name, why: 'a sub-recipe it needs was never created' });
  if (skipped.length) {
    console.log(`\nNOT IMPORTED (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s.name.padEnd(34)} ${s.why.slice(0, 90)}`);
  }
  console.log(`\n${notes.length} recipes carry a note saying what was assumed. Read them in the app.\n`);
}

await main();
process.exit(0);
