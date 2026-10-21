/**
 * Pure helpers for the "what still needs doing today" decisions: the local-date
 * key used to detect a new Rewards day, and trimming a search plan when today's
 * PC/mobile search counters are already complete. Kept import-free so it can be
 * unit-tested directly.
 */

// Local-date key (YYYY-MM-DD). `now` is injectable for deterministic tests.
/**
 * @param {!Date=} now Local calendar date.
 * @return {string} Local YYYY-MM-DD key.
 */
export function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// True when the stored counters belong to today's Rewards day.
/**
 * @param {?{searchCounterDate: (string|undefined)}} runtime Stored counter
 *     date.
 * @param {string} todayStr Current local date key.
 * @return {boolean} Whether counters belong to this day.
 */
export function areCountersFresh(runtime, todayStr) {
  return runtime?.searchCounterDate === todayStr;
}

// Zero out desktop/mobile counts whose daily counter is already complete.
// Returns a new plan object; does not mutate the input.
/**
 * @template T
 * @param {T} plan Search-plan record copied with its extra fields.
 * @param {?{pcDone: (boolean|undefined), mobileDone: (boolean|undefined)}=}
 *     options Completion flags.
 * @return {T} Copied plan with completed search counts set to zero.
 */
export function limitPlanForCompletedCounters(plan, options = {}) {
  // Destructure defensively: `options` may be passed as an explicit null, which
  // a default parameter does not guard against.
  const {pcDone, mobileDone} = options || {};
  const limited = {...plan};
  if (pcDone) {
    limited.desk = 0;
  }
  if (mobileDone) {
    limited.mob = 0;
  }
  return limited;
}
