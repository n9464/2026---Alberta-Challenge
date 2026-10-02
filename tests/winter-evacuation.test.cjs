const test = require('node:test');
const assert = require('node:assert/strict');
const winter = require('../winter-evacuation.js');

const run = (id, runner, distance, seconds, extra = {}) => ({
  id, runner, distance, date: '2026-10-02',
  timestamp: seconds === undefined ? null : { seconds, nanoseconds: 0 }, ...extra
});
const baseline = [run('n-start', 'Nicolas', 289.7, 1), run('s-start', 'Samuel', 879.8, 1)];
const state = winter.createStartState(baseline);
const byRunner = (records) => Object.fromEntries(['Nicolas', 'Samuel'].map((runner) => [runner, records.filter((entry) => entry.runner === runner)]));

test('freezes actual starting totals and record IDs without mutating history', () => {
  const original = structuredClone(baseline);
  assert.deepEqual(state.startingTotals, { Nicolas: 289.7, Samuel: 879.8 });
  assert.deepEqual(state.baselineRunIds, ['n-start', 's-start']);
  assert.deepEqual(baseline, original);
  assert.equal(winter.getProgress(byRunner(baseline), state).profiles.Nicolas.remaining, 289.7);
});

test('counts new record IDs on the activation day, including identical runs', () => {
  const records = [...baseline, run('new-n-1', 'Nicolas', 7, 2), run('new-n-2', 'Nicolas', 7, 3)];
  const { profiles } = winter.getProgress(byRunner(records), state);
  assert.equal(profiles.Nicolas.distance, 14);
  assert.ok(Math.abs(profiles.Nicolas.remaining - 275.7) < 1e-10);
  assert.equal(profiles.Samuel.remaining, 879.8);
});

test('historical edits do not move the frozen finish or count as return runs', () => {
  const edited = [{ ...baseline[0], distance: 500 }, baseline[1], run('return', 'Nicolas', 100, 2)];
  const { profiles } = winter.getProgress(byRunner(edited), state);
  assert.equal(profiles.Nicolas.target, 289.7);
  assert.ok(Math.abs(profiles.Nicolas.remaining - 189.7) < 1e-10);
});

test('deduplicates snapshot IDs and excludes the mode document and invalid records', () => {
  const starting = winter.createStartState([...baseline, baseline[0], run(winter.DOCUMENT_ID, 'Nicolas', 999, 2), run('bad', 'Samuel', Infinity, 2)]);
  assert.deepEqual(starting.startingTotals, state.startingTotals);
  assert.equal(starting.baselineRunIds.length, 2);
  const records = [...baseline, run('bad', 'Nicolas', NaN, 2), run('negative', 'Samuel', -5, 2), run('string', 'Nicolas', '10', 2)];
  assert.equal(winter.getReturnRuns(byRunner(records), state).length, 0);
});

test('restores only valid shared state and rejects a race with an empty route', () => {
  assert.deepEqual(winter.parseState({ ...state, timestamp: { seconds: 10 } }).startingTotals, state.startingTotals);
  for (const invalid of [null, {}, { ...state, schemaVersion: 2 }, { ...state, startingTotals: { Nicolas: 0, Samuel: 10 } }, { ...state, baselineRunIds: [123] }]) {
    assert.equal(winter.parseState(invalid), null);
  }
  assert.throws(() => winter.createStartState([baseline[0]]), /Both runners/);
});

test('clamps completed return routes at home and identifies first server-confirmed arrival', () => {
  const records = [...baseline, run('s-home', 'Samuel', 900, 3), run('n-home', 'Nicolas', 300, 2)];
  const { profiles, winners } = winter.getProgress(byRunner(records), state);
  assert.equal(profiles.Nicolas.remaining, 0);
  assert.equal(profiles.Samuel.percent, 100);
  assert.deepEqual(winners, ['Nicolas']);
});

test('pending and timestamp-less runs update progress without declaring a winner', () => {
  const records = [...baseline, run('pending', 'Nicolas', 300, 2, { pending: true }), run('unconfirmed', 'Samuel', 900)];
  const { profiles, winners } = winter.getProgress(byRunner(records), state);
  assert.equal(profiles.Nicolas.remaining, 0);
  assert.deepEqual(winners, []);
  records[2].pending = false;
  assert.deepEqual(winter.getProgress(byRunner(records), state).winners, ['Nicolas']);
});

test('uses server arrival order instead of backdated display dates', () => {
  const records = [...baseline, run('n-home', 'Nicolas', 300, 3, { date: '2026-09-01' }), run('s-home', 'Samuel', 900, 2)];
  assert.deepEqual(winter.getProgress(byRunner(records), state).winners, ['Samuel']);
});

test('recognizes ties and decimal-distance finishes', () => {
  const records = [...baseline, run('n-home', 'Nicolas', 289.7, 2), run('s-home', 'Samuel', 879.8, 2)];
  assert.deepEqual(winter.getProgress(byRunner(records), state).winners, ['Nicolas', 'Samuel']);
  const decimalStart = [run('n-start', 'Nicolas', 0.1, 1), run('n-start-2', 'Nicolas', 0.2, 1), run('s-start', 'Samuel', 1, 1)];
  const decimalState = winter.createStartState(decimalStart);
  const result = winter.getProgress(byRunner([...decimalStart, run('n-home', 'Nicolas', 0.3, 2)]), decimalState);
  assert.equal(result.profiles.Nicolas.remaining, 0);
  assert.deepEqual(result.winners, ['Nicolas']);
});
