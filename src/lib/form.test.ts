/**
 * The form boundary. Until these existed, nothing under app/ was tested at all - the
 * 177 tests covered the functions the actions CALL, not the parsing that decides what
 * those functions are called with. That parsing is where a hostile submission lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectIndexedRows, isBlankRow, staleUnitMessage } from './form.ts';

const entries = (o: Record<string, string>) => Object.entries(o);

test('indexed keys become rows, in the order the operator sees them', () => {
  const rows = collectIndexedRows(
    entries({
      'lines[1][quantity]': '2',
      'lines[0][quantity]': '5',
      'lines[0][ingredientId]': 'abc',
      note: 'ignored',
    }),
  );
  assert.deepEqual(rows, [{ quantity: '5', ingredientId: 'abc' }, { quantity: '2' }]);
});

test('a row index is never used as a length', () => {
  // The defence this collector exists for. Assigning into an array at this index
  // allocates two billion holes; a Map holds one entry. If someone "simplifies" this
  // back to an array, the assertion below still passes but the test takes minutes -
  // so the time budget is part of the check.
  const started = Date.now();
  const rows = collectIndexedRows(entries({ 'lines[2000000000][quantity]': '1' }));
  assert.equal(rows.length, 1);
  assert.ok(Date.now() - started < 1000, 'collecting a hostile index must not walk the range');
});

test('an index too large to be exact is dropped rather than merged', () => {
  // 2^53 and 2^53+1 are the same float. Keeping them would silently fold two submitted
  // rows into one, which is worse than ignoring a row no real form can produce.
  const rows = collectIndexedRows(
    entries({ 'lines[9007199254740993][quantity]': '1', 'lines[0][quantity]': '2' }),
  );
  assert.deepEqual(rows, [{ quantity: '2' }]);
});

test('keys that are not this field are left alone', () => {
  const rows = collectIndexedRows(
    entries({ 'other[0][quantity]': '1', 'lines[0][quantity]': '2' }),
    'lines',
  );
  assert.deepEqual(rows, [{ quantity: '2' }]);
});

test('a blank row is unused; a half-filled one is not', () => {
  assert.equal(isBlankRow({ quantity: '', totalCost: '  ' }), true);
  assert.equal(isBlankRow({ quantity: '2', totalCost: '' }), false);
});

test('an absent field counts as blank, not as filled', () => {
  // The bug this pins: `row.sourceId?.trim() !== ''` is TRUE when the key is absent,
  // because undefined !== ''. A recipe row carrying only a defaulted wastage value
  // survived as a half-filled line and failed with a message about picking an
  // ingredient the operator had never been shown.
  assert.equal(isBlankRow({ wastage: '0' }, ['sourceId', 'quantity']), true);
  assert.equal(isBlankRow({ wastage: '0', sourceId: 'abc' }, ['sourceId', 'quantity']), false);
});

test('a pack size that has not moved raises nothing', () => {
  assert.equal(staleUnitMessage(1000, 1000, 'Butter'), null);
  assert.equal(staleUnitMessage(undefined, 1000, 'Butter'), null);
});

test('a pack size changed under an open form is refused by name', () => {
  const msg = staleUnitMessage(1000, 25000, 'Maida');
  assert.ok(msg?.includes('Maida'));
  assert.ok(msg?.includes('Nothing was saved'));
});
