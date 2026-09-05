const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data');
const entry = (id, amount = 1000) => ({ id, name: '테스트', amount, date: '2026-09-05', cat: 'freelance', createdAt: 1 });
const doc = (...entries) => D.clean({ entries, goal: 0 });
test('independent offline additions from two devices both survive', () => {
  const result = D.merge(doc(), doc(entry('a')), doc(entry('b')));
  assert.equal(result.data.entries.length, 2); assert.deepEqual(result.conflicts, []);
});
test('concurrent changes to different records are merged', () => {
  const base = doc(entry('a'), entry('b'));
  const result = D.merge(base, doc(entry('a', 2000), entry('b')), doc(entry('a'), entry('b', 3000)));
  assert.deepEqual(result.data.entries.map(e => e.amount), [2000, 3000]); assert.deepEqual(result.conflicts, []);
});
test('a deletion propagates without resurrecting the record', () => {
  const result = D.merge(doc(entry('a')), doc(), doc(entry('a'), entry('b')));
  assert.deepEqual(result.data.entries.map(e => e.id), ['b']); assert.deepEqual(result.conflicts, []);
});
test('edit/edit and edit/delete conflicts are surfaced', () => {
  assert.deepEqual(D.merge(doc(entry('a')), doc(entry('a', 2)), doc(entry('a', 3))).conflicts, ['a']);
  assert.deepEqual(D.merge(doc(entry('a')), doc(), doc(entry('a', 3))).conflicts, ['a']);
});
test('identical concurrent edits are not conflicts', () => {
  assert.deepEqual(D.merge(doc(entry('a')), doc(entry('a', 2)), doc(entry('a', 2))).conflicts, []);
});
test('simultaneous goal edits conflict', () => {
  assert.deepEqual(D.merge(doc(), { ...doc(), goal: 10 }, { ...doc(), goal: 20 }).conflicts, ['goal']);
});
test('invalid imports and duplicate IDs fail without partial import', () => {
  for (const patch of [{ amount: Infinity }, { amount: -1 }, { amount: 0.5 }, { amount: 10000000000 }, { date: '2026-02-30' }, { name: '' }]) assert.throws(() => doc({ ...entry('a'), ...patch }));
  assert.throws(() => doc(entry('a'), entry('a')));
  assert.throws(() => D.clean({ entries: [], goal: Infinity }));
});
test('legacy entries gain safe defaults and invalid IDs are replaced', () => {
  const [e] = doc({ ...entry('x" onclick="bad'), cat: 'bad', skin: '<script>' }).entries;
  assert.match(e.id, /^[\w-]+$/); assert.equal(e.skin, 'soft'); assert.equal(e.cat, 'other'); assert.equal(e.paid, false);
});
test('config never exposes an admin key', () => {
  const handler = require('../api/config');
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_never_expose';
    let result; handler({}, { setHeader() {}, status() { return this; }, json(d) { result = d; } });
    assert.deepEqual(result, { configured: false });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
