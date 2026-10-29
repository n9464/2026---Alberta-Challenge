const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the actual page script without network requests or database writes.
function loadChallenge() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', style: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
    });
    return elements.get(selector);
  };
  let snapshotListener;
  const frames = [];
  let now = 0;
  const collection = {
    orderBy() { return this; },
    onSnapshot(listener) { snapshotListener = listener; }
  };
  const context = vm.createContext({
    console, Intl, Date,
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    window: {},
    firebase: { initializeApp() {}, firestore: () => ({ collection: () => collection }), auth() {} },
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {}
  });
  const html = readFileSync(`${__dirname}/../index.html`, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(script, context);
  const evaluate = (code) => vm.runInContext(code, context);
  const json = (code) => JSON.parse(evaluate(`JSON.stringify(${code})`));
  return {
    evaluate, json, element,
    snapshot(data) {
      snapshotListener({
        forEach(callback) { data.forEach((run, index) => callback({ id: String(index), data: () => run })); },
        docChanges: () => []
      });
    },
    frame() { now += 900; frames.shift()(now); },
    pendingFrames: () => frames.length
  };
}

const history = [
  { runner: 'Nicolas', distance: 306.7, date: '2026-10-28' },
  { runner: 'Samuel', distance: 1091.2, date: '2026-10-28' }
];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('past runs retain the original northbound positions, with Samuel near the top', () => {
  const app = loadChallenge();
  app.snapshot(history);
  const sam = app.json("getRunnerJourney('Samuel', getRouteTotals())");
  const nicolas = app.json("getRunnerJourney('Nicolas', getRouteTotals())");
  close(sam.position.x, 420);
  close(sam.position.y, 660 - 1091.2 / 1200 * 620);
  assert.ok(sam.position.y < 100);
  close(nicolas.position.x, 385);
  close(nicolas.position.y, 660 - 306.7 / 1200 * 620);
  assert.equal(sam.progress, 0);
});

test('October 29 and later runs move both runners toward Cold Lake from opposite directions', () => {
  const app = loadChallenge();
  app.snapshot(history);
  const beforeSam = app.json("getRunnerJourney('Samuel', getRouteTotals())");
  const beforeNicolas = app.json("getRunnerJourney('Nicolas', getRouteTotals())");
  const laterRuns = [
    ...history,
    { runner: 'Nicolas', distance: 6, date: '2026-10-29' },
    { runner: 'Samuel', distance: 10, date: '2026-10-30' }
  ];
  app.snapshot(laterRuns);
  const sam = app.json("getRunnerJourney('Samuel', getRouteTotals())");
  const nicolas = app.json("getRunnerJourney('Nicolas', getRouteTotals())");
  assert.ok(sam.position.y > beforeSam.position.y);
  assert.ok(nicolas.position.y < beforeNicolas.position.y);
  assert.ok(sam.position.x > beforeSam.position.x);
  assert.ok(nicolas.position.x > beforeNicolas.position.x);
  close(sam.remaining, beforeSam.remaining - 10);
  close(nicolas.remaining, beforeNicolas.remaining - 6);
  assert.deepEqual(app.json('getRouteTotals().northbound'), { Nicolas: 306.7, Samuel: 1091.2 });
  assert.match(app.element('#runnerCards').innerHTML, /315\.6 km left/);
  assert.match(app.element('#runnerCards').innerHTML, /Total run: 312\.7 km/);
  assert.match(app.element('#runHistory').innerHTML, /2026-10-29/);
  // Repeated snapshots recompute from history instead of double-counting new runs.
  app.snapshot(laterRuns);
  close(app.json("getRunnerJourney('Samuel', getRouteTotals()).remaining"), sam.remaining);
});

test('arrival stops at the Cold Lake dot, even after exceeding the route distance', () => {
  const app = loadChallenge();
  app.snapshot([...history, ...['Nicolas', 'Samuel'].map((runner) => ({ runner, distance: 2000, date: '2026-11-01' }))]);
  for (const runner of ['Nicolas', 'Samuel']) {
    const journey = app.json(`getRunnerJourney('${runner}', getRouteTotals())`);
    assert.deepEqual(journey.position, { x: 446, y: 347 });
    assert.equal(journey.remaining, 0);
    assert.equal(journey.progress, 1);
  }
  assert.match(app.element('#runnerCards').innerHTML, /Arrived at Cold Lake!/);
});

test('timeline preserves both legs and restores the live position when playback finishes', () => {
  const app = loadChallenge();
  app.snapshot([
    { runner: 'Samuel', distance: 10, date: '2026-11-01' },
    ...history,
    { runner: 'Nicolas', distance: 6, date: '2026-10-29' }
  ]);
  const liveMarkers = app.element('#runnerMarkers').innerHTML;
  const timeline = app.json('buildDailyTimeline()');
  assert.deepEqual(timeline.map((day) => day.date), ['2026-10-28', '2026-10-29', '2026-11-01']);
  assert.equal(timeline[0].totals.coldLake.Nicolas, 0);
  assert.equal(timeline[1].totals.coldLake.Nicolas, 6);
  assert.equal(timeline[2].totals.coldLake.Samuel, 10);
  app.evaluate('playTimelineAnimation()');
  app.frame();
  assert.match(app.element('#animationStatus').textContent, /Northbound/);
  app.frame();
  assert.match(app.element('#animationStatus').textContent, /Toward Cold Lake/);
  while (app.pendingFrames()) app.frame();
  assert.equal(app.element('#animationStatus').textContent, 'Live view');
  assert.equal(app.element('#runnerMarkers').innerHTML, liveMarkers);
  assert.equal(app.element('#playTimelineBtn').disabled, false);
});

test('Edmonton midnight and daylight saving boundaries choose the correct date', () => {
  const app = loadChallenge();
  for (const [instant, expected] of [
    ['2026-10-29T05:59:59Z', '2026-10-28'],
    ['2026-10-29T06:00:00Z', '2026-10-29'],
    ['2026-11-02T06:59:59Z', '2026-11-01'],
    ['2026-11-02T07:00:00Z', '2026-11-02']
  ]) assert.equal(app.evaluate(`formatEdmontonDate(new Date('${instant}'))`), expected);
});

test('empty history and historical totals beyond 1200 km stay within the map', () => {
  const app = loadChallenge();
  assert.equal(app.element('#playTimelineBtn').disabled, true);
  assert.equal(app.element('#runnerMarkers').innerHTML, '');
  assert.ok(Number.isFinite(app.json("getRunnerJourney('Samuel', getRouteTotals()).remaining")));
  app.snapshot([{ runner: 'Samuel', distance: 1400, date: '2026-10-28' }]);
  assert.equal(app.json("getRunnerJourney('Samuel', getRouteTotals()).position.y"), 40);
});
