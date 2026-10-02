(function (root) {
  'use strict';

  const RUNNERS = ['Nicolas', 'Samuel'];
  const DOCUMENT_ID = 'winter-evacuation';
  const reachedHome = (distance, target) => distance >= target || Math.abs(distance - target) < 1e-7;
  const validDistance = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const isRun = (run) => run && typeof run.id === 'string' && run.id !== DOCUMENT_ID && RUNNERS.includes(run.runner) && validDistance(run.distance);

  function createStartState(records) {
    const startingTotals = { Nicolas: 0, Samuel: 0 };
    const baselineRunIds = [];
    const seen = new Set();
    records.filter(isRun).forEach((run) => {
      if (seen.has(run.id)) return;
      seen.add(run.id);
      startingTotals[run.runner] += run.distance;
      baselineRunIds.push(run.id);
    });
    if (RUNNERS.some((runner) => startingTotals[runner] <= 0 || !Number.isFinite(startingTotals[runner]))) {
      throw new Error('Both runners need a logged run before winter starts.');
    }
    return { type: 'winter-evacuation', schemaVersion: 1, startingTotals, baselineRunIds };
  }

  function parseState(data) {
    if (!data || data.type !== 'winter-evacuation' || data.schemaVersion !== 1 ||
        !Array.isArray(data.baselineRunIds) || !data.baselineRunIds.every((id) => typeof id === 'string') ||
        !RUNNERS.every((runner) => validDistance(data.startingTotals?.[runner]) && data.startingTotals[runner] > 0)) return null;
    return {
      type: data.type,
      schemaVersion: data.schemaVersion,
      startingTotals: { Nicolas: data.startingTotals.Nicolas, Samuel: data.startingTotals.Samuel },
      baselineRunIds: [...new Set(data.baselineRunIds)],
      timestamp: data.timestamp || null
    };
  }

  function getReturnRuns(runsByRunner, state) {
    const baseline = new Set(state.baselineRunIds);
    return RUNNERS.flatMap((runner) => runsByRunner[runner] || []).filter((run) => isRun(run) && !baseline.has(run.id));
  }

  function timestampValue(run) {
    if (run.pending || !run.timestamp) return null;
    const value = typeof run.timestamp.toMillis === 'function'
      ? run.timestamp.toMillis()
      : run.timestamp.seconds * 1000 + (run.timestamp.nanoseconds || 0) / 1e6;
    return Number.isFinite(value) ? value : null;
  }

  function getProgress(runsByRunner, state) {
    const returnRuns = getReturnRuns(runsByRunner, state);
    const profiles = {};
    RUNNERS.forEach((runner) => {
      const target = state.startingTotals[runner];
      const distance = returnRuns.filter((run) => run.runner === runner).reduce((sum, run) => sum + run.distance, 0);
      profiles[runner] = {
        target,
        distance,
        remaining: reachedHome(distance, target) ? 0 : target - distance,
        percent: reachedHome(distance, target) ? 100 : distance / target * 100,
        finishedAt: null
      };
    });

    // Arrival order follows confirmed server timestamps, regardless of display dates.
    const confirmed = returnRuns.map((run) => ({ ...run, time: timestampValue(run) }))
      .filter((run) => run.time !== null).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    const cumulative = { Nicolas: 0, Samuel: 0 };
    confirmed.forEach((run) => {
      cumulative[run.runner] += run.distance;
      const profile = profiles[run.runner];
      if (profile.finishedAt === null && reachedHome(cumulative[run.runner], profile.target)) profile.finishedAt = run.time;
    });
    const arrivals = RUNNERS.filter((runner) => profiles[runner].finishedAt !== null);
    const firstArrival = arrivals.length ? Math.min(...arrivals.map((runner) => profiles[runner].finishedAt)) : null;
    return { profiles, winners: arrivals.filter((runner) => profiles[runner].finishedAt === firstArrival) };
  }

  const api = Object.freeze({ DOCUMENT_ID, createStartState, parseState, getReturnRuns, getProgress });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WinterEvacuation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
