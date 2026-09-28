/**
 * Pure helpers for search phase bookkeeping.
 *
 * The loop runs exactly the plan the user set (desk/mob counts). It does not
 * add make-up searches when the Rewards counter lags — shortfalls are left for
 * a later re-run.
 *
 * Checkpoint helpers still compare local navigations to the real counter, but
 * only a FULL counter stops a phase — a merely frozen one is indistinguishable
 * from a Rewards API publishing in a slow batch, so the plan runs to the end.
 */

export const DEFAULT_POINTS_PER_SEARCH = 3;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createSearchCreditGoal(
  snapshot,
  counterField,
  counterMaxField,
  requestedSearches,
  pointsPerSearch = DEFAULT_POINTS_PER_SEARCH,
) {
  const start = finiteNumber(snapshot?.[counterField]);
  const max = finiteNumber(snapshot?.[counterMaxField]);
  const requested = Math.max(0, Math.floor(Number(requestedSearches) || 0));
  const unit = Math.max(1, finiteNumber(pointsPerSearch) || 1);

  if (start === null || max === null || max <= 0 || requested <= 0) {
    return null;
  }

  return {
    start,
    max,
    target: Math.min(max, start + requested * unit),
    pointsPerSearch: unit,
  };
}

export function isSearchCreditGoalReached(goal, snapshot, counterField) {
  if (!goal) return false;
  const current = finiteNumber(snapshot?.[counterField]);
  return current !== null && current >= goal.target;
}

/**
 * Continue only while fewer than `requestedSearches` iterations have been
 * attempted. Point shortfalls never extend the plan, so the counter/goal state
 * deliberately plays no part in this decision.
 */
export function shouldContinueSearch({
  attemptedIterations,
  requestedSearches,
}) {
  const attempted = Math.max(0, Number(attemptedIterations) || 0);
  const requested = Math.max(0, Number(requestedSearches) || 0);
  return attempted < requested;
}

export function assessSearchCheckpoint({
  before,
  after,
  counterField,
  counterMaxField,
  successfulSinceCheckpoint,
  pointsPerSearch = DEFAULT_POINTS_PER_SEARCH,
}) {
  const previous = finiteNumber(before?.[counterField]) ?? 0;
  const current = finiteNumber(after?.[counterField]) ?? previous;
  const max = finiteNumber(after?.[counterMaxField]) ?? 0;
  const successful = Math.max(
    0,
    Math.floor(Number(successfulSinceCheckpoint) || 0),
  );
  const unit = Math.max(1, finiteNumber(pointsPerSearch) || 1);
  const progressed = Math.max(0, current - previous);
  const expected = successful * unit;

  return {
    progressed,
    expected,
    missingPoints: Math.max(0, expected - progressed),
    quotaFull: max > 0 && current >= max,
  };
}
