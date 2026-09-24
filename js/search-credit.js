/**
 * Pure helpers for search phase bookkeeping.
 *
 * User counts cap the plan. A fresh per-device counter trims it to estimated
 * remaining work; delayed credit never causes unbounded make-up searches.
 */

export const DEFAULT_POINTS_PER_SEARCH = 3;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// The conversion is an estimate using the configured point unit; a fresh
// counter, never local navigation count, confirms that quota is full.
export function getRemainingSearches(snapshot, counterField, counterMaxField,
  pointsPerSearch = DEFAULT_POINTS_PER_SEARCH) {
  const progress = finiteNumber(snapshot?.[counterField]);
  const max = finiteNumber(snapshot?.[counterMaxField]);
  const unit = finiteNumber(pointsPerSearch);
  if (progress === null || progress < 0 || max === null || max <= 0 ||
      unit === null || unit <= 0) return null;
  return Math.ceil(Math.max(0, max - progress) / unit);
}

export function limitPlanForRemainingQuota(plan, snapshot) {
  const limited = { ...plan };
  for (const [key, progress, max] of [
    ["desk", "pcProgress", "pcMax"],
    ["mob", "mobProgress", "mobMax"],
  ]) {
    const remaining = getRemainingSearches(snapshot, progress, max);
    if (remaining !== null) {
      limited[key] = Math.min(Math.max(0, Math.floor(Number(plan?.[key]) || 0)), remaining);
    }
  }
  return limited;
}

export function getSearchCheckpointInterval(snapshot, counterField, counterMaxField) {
  const remaining = getRemainingSearches(snapshot, counterField, counterMaxField);
  return remaining !== null && remaining <= 4 ? 1 : 4;
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
  const attempted = Math.max(0, Math.floor(Number(attemptedIterations) || 0));
  const requested = Math.max(0, Math.floor(Number(requestedSearches) || 0));
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
