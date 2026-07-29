/**
 * Pure helpers for deciding when a search phase needs make-up searches.
 *
 * Bing Rewards counters are point counters, while the automation loop counts
 * result-page navigations. A confirmed navigation is therefore not enough to
 * prove that a search was credited.
 */

export const DEFAULT_POINTS_PER_SEARCH = 3;
export const MAX_MAKEUP_SEARCHES = 12;

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

export function getSearchIterationLimit(requestedSearches) {
  const requested = Math.max(0, Math.floor(Number(requestedSearches) || 0));
  if (requested <= 0) return 0;
  const allowance = Math.min(
    MAX_MAKEUP_SEARCHES,
    Math.max(4, Math.ceil(requested * 0.4)),
  );
  return requested + allowance;
}

export function shouldContinueSearch({
  attemptedIterations,
  requestedSearches,
  successfulSearches,
  iterationLimit,
  creditGoal,
  snapshot,
  counterField,
}) {
  const attempted = Math.max(0, Number(attemptedIterations) || 0);
  const requested = Math.max(0, Number(requestedSearches) || 0);
  const successful = Math.max(0, Number(successfulSearches) || 0);
  const limit = Math.max(requested, Number(iterationLimit) || 0);

  if (attempted >= limit) return false;
  if (attempted < requested) return true;
  if (creditGoal) {
    return !isSearchCreditGoalReached(creditGoal, snapshot, counterField);
  }
  return successful < requested;
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
