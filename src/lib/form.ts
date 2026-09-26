/**
 * The pure parts of the form boundary, pulled out of the server actions so they can be
 * tested.
 *
 * WHY THEY LIVE HERE. A `'use server'` module may only export async functions, so a
 * helper defined inside one cannot be imported by a test - which is how the two most
 * intricate pieces of input handling in the app ended up as the only logic with no
 * coverage at all. The 177 tests all sit under src/; nothing exercised app/. Moving
 * these two here is what makes them reachable.
 *
 * Both were also duplicated: app/stock/actions.ts and app/recipes/actions.ts each had
 * their own copy of the row collector, with blank-row rules that had quietly diverged.
 */

/**
 * Turn `lines[0][quantity]`-style form keys into rows, in submitted index order.
 *
 * THE MAP IS THE POINT, and it is a security property rather than a style choice. The
 * obvious implementation assigns into an array at the submitted index, and the index
 * arrives from the browser: `lines[2000000000][quantity]` costs nothing to send and
 * makes the next iteration over that array walk two billion holes. A Map never turns a
 * key into a length, so a hostile index costs exactly one entry.
 *
 * Values are stringified the way FormData hands them over. Rows are returned sorted by
 * index so the operator's first line stays first; the index itself is then discarded,
 * because nothing downstream should care what number the browser chose.
 */
export function collectIndexedRows(
  entries: Iterable<readonly [string, unknown]>,
  field = 'lines',
): Array<Record<string, string>> {
  // Built from `field` so the two callers cannot drift, and escaped because it is
  // interpolated into a pattern.
  const key = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)]\\[(\\w+)]$`);
  const rows = new Map<number, Record<string, string>>();

  for (const [name, value] of entries) {
    const m = key.exec(name);
    if (!m) continue;
    const index = Number(m[1]);
    // A 20-digit index parses to a float and collides with its neighbours. Dropping it
    // is right: no real form has one, and a collision would silently merge two rows.
    if (!Number.isSafeInteger(index)) continue;
    const row = rows.get(index) ?? {};
    row[m[2]] = String(value);
    rows.set(index, row);
  }

  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

/**
 * True when every field an operator could have filled is blank.
 *
 * A row left entirely empty is an unused row, not an error - forms here render spare
 * lines. A row that is HALF filled is an error, and the callers' own validation names
 * which half, so this only ever drops the untouched ones.
 *
 * `named` lists the fields that count as "filled". Passing none means any field counts,
 * which is what the receipt form wants; the recipe form passes its two real inputs
 * because its rows also carry a wastage box that defaults to a value.
 */
export function isBlankRow(row: Record<string, string>, named: readonly string[] = []): boolean {
  const values = named.length ? named.map((f) => row[f]) : Object.values(row);
  // `?? ''` matters: an absent field is undefined, and `undefined !== ''` reads as
  // filled. The recipe form's collector had exactly that bug - a row submitting only a
  // wastage value survived as a half-filled line and failed validation with a message
  // about picking an ingredient.
  return values.every((v) => (v ?? '').trim() === '');
}

/**
 * The refusal shown when an ingredient's purchase pack changed while a form sat open.
 *
 * "2" against a 1 kg bag is two kilos; against a 25 kg sack it is fifty. The form states
 * the pack it priced against and this compares. The claim is NEVER used as a conversion
 * factor - a tampered value can only ever produce this refusal, never a wrong write.
 *
 * Returns null when there is nothing wrong, so a caller reads as `if (stale) return`.
 */
export function staleUnitMessage(
  claimed: number | undefined,
  actual: number,
  name: string,
): string | null {
  if (claimed === undefined || claimed === actual) return null;
  return (
    `"${name}" was bought in a different pack size when this page opened, and someone has ` +
    `changed it since. Nothing was saved. Reload the page and enter the delivery again so ` +
    `the quantity means what you intend.`
  );
}
