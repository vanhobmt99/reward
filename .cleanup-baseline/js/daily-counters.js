/**
 * Pure helpers for the "what still needs doing today" decisions: the local-date
 * key used to detect a new Rewards day, and trimming a search plan when today's
 * PC/mobile search counters are already complete. Kept import-free so it can be
 * unit-tested directly.
 */

// Local-date key (YYYY-MM-DD). `now` is injectable for deterministic tests.
export function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// True when the stored counters belong to today's Rewards day.
export function areCountersFresh(runtime, todayStr) {
  return runtime?.searchCounterDate === todayStr;
}

// Zero out desktop/mobile counts whose daily counter is already complete.
// Returns a new plan object; does not mutate the input.
export function limitPlanForCompletedCounters(plan, options = {}) {
  // Destructure defensively: `options` may be passed as an explicit null, which
  // a default parameter does not guard against.
  const { pcDone, mobileDone } = options || {};
  const limited = { ...plan };
  if (pcDone) limited.desk = 0;
  if (mobileDone) limited.mob = 0;
  return limited;
}
