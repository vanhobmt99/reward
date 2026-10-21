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

/**
 * @typedef {!Object<string, (number|string|null|undefined)>}
 *     SearchCounterSnapshot
 */
/**
 * @typedef {{start: number, max: number, target: number,
 *     pointsPerSearch: number}} SearchCreditGoal
 */
/**
 * @typedef {{attemptedIterations: (number|undefined),
 *     requestedSearches: (number|undefined)}} SearchContinueState
 */
/**
 * @typedef {{before: (SearchCounterSnapshot|null|undefined),
 *     after: (SearchCounterSnapshot|null|undefined), counterField: string,
 *     counterMaxField: string, successfulSinceCheckpoint: (number|undefined),
 *     pointsPerSearch: (number|undefined)}} SearchCheckpointInput
 */
/**
 * @typedef {{progressed: number, expected: number, missingPoints: number,
 *     quotaFull: boolean}} SearchCheckpoint
 */

export const DEFAULT_POINTS_PER_SEARCH = 3;

/**
 * @param {number|string|null|undefined} value Counter or points field.
 * @return {?number} Finite number, or null when the field is missing.
 */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Builds the point target for one desktop or mobile phase.
 * @param {SearchCounterSnapshot|null|undefined} snapshot Rewards counters
 *     before the phase.
 * @param {string} counterField Progress field, such as "pcProgress".
 * @param {string} counterMaxField Maximum field, such as "pcMax".
 * @param {number} requestedSearches Planned iterations. Non-positive yields no
 *     goal.
 * @param {number=} pointsPerSearch Points assumed per search. Defaults to
 *     DEFAULT_POINTS_PER_SEARCH.
 * @return {?SearchCreditGoal} Target clamped to the daily maximum, or null
 *     when the counter cannot be read.
 */
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

/**
 * @param {?SearchCreditGoal} goal Goal from createSearchCreditGoal.
 * @param {SearchCounterSnapshot|null|undefined} snapshot Latest counters.
 * @param {string} counterField Progress field compared with goal.target.
 * @return {boolean} Whether the live counter has reached the target.
 */
export function isSearchCreditGoalReached(goal, snapshot, counterField) {
  if (!goal) {
    return false;
  }
  const current = finiteNumber(snapshot?.[counterField]);
  return current !== null && current >= goal.target;
}

/**
 * Continue only while fewer than `requestedSearches` iterations have been
 * attempted. Point shortfalls never extend the plan, so the counter/goal state
 * deliberately plays no part in this decision.
 * @param {!SearchContinueState} progress Attempted and requested iteration
 *     counts. Other fields are ignored.
 * @return {boolean} Whether another iteration is still inside the plan.
 */
export function shouldContinueSearch({
  attemptedIterations,
  requestedSearches,
}) {
  const attempted = Math.max(0, Number(attemptedIterations) || 0);
  const requested = Math.max(0, Number(requestedSearches) || 0);
  return attempted < requested;
}

/**
 * Compares local navigations since the last checkpoint with the Rewards
 * counter. A full quota is reported; a lagging counter does not stop the plan.
 * @param {!SearchCheckpointInput} checkpoint Before and after snapshots.
 *     pointsPerSearch defaults to DEFAULT_POINTS_PER_SEARCH.
 * @return {!SearchCheckpoint} Gained points, expected points and quota state.
 */
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
