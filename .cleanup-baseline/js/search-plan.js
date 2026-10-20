/**
 * Pure helpers for turning raw {desk, mob, min, max} input into a validated
 * search plan, and for picking non-repeating query templates. Extracted from
 * service.js so the numeric clamping and template rotation can be unit-tested.
 */

export const DEFAULT_SEARCH_DELAY_MIN = 6;
export const DEFAULT_SEARCH_DELAY_MAX = 10;
export const MINIMUM_SEARCH_DELAY = 5;

// Clamp/normalise a search plan: non-negative integer counts, min delay floored
// at MINIMUM_SEARCH_DELAY, max never below min. Unknown fields pass through.
export function normalizeSearchPlan(searches = {}, bounds = {}) {
  const {
    defaultMin = DEFAULT_SEARCH_DELAY_MIN,
    defaultMax = DEFAULT_SEARCH_DELAY_MAX,
    minimum = MINIMUM_SEARCH_DELAY,
  } = bounds;

  const rawDesk = Number(searches?.desk);
  const rawMob = Number(searches?.mob);
  const rawMin = Number(searches?.min);
  const rawMax = Number(searches?.max);

  const min = isNaN(rawMin) ? defaultMin : Math.max(minimum, rawMin);
  let max = isNaN(rawMax) ? defaultMax : rawMax;

  const plan = {
    ...searches,
    // Counts drive integer loop bounds, so floor them — a dirty 3.7 must not
    // become 4 iterations (or feed a fractional value downstream).
    desk: isNaN(rawDesk) ? 0 : Math.max(0, Math.floor(rawDesk)),
    mob: isNaN(rawMob) ? 0 : Math.max(0, Math.floor(rawMob)),
    min,
    max,
  };

  if (plan.max < plan.min) plan.max = plan.min;
  return plan;
}

export function hasSearchWork(searches = {}) {
  return (Number(searches?.desk) || 0) > 0 || (Number(searches?.mob) || 0) > 0;
}

export function queryTemplateKey(niche, template) {
  return `${niche}:${String(template || "").toLowerCase()}`;
}

/**
 * Pick a template for `niche` that has not been used yet this run. `usedSet` is
 * mutated: the chosen template's key is added. When every template in the niche
 * has been used, only that niche's keys are cleared (other niches keep their
 * history) and the full pool becomes available again.
 */
export function chooseSearchTemplate(niche, queries, usedSet) {
  const queryList = (queries && queries[niche]) || [];
  if (queryList.length === 0) return "";
  let available = queryList.filter(
    (template) => !usedSet.has(queryTemplateKey(niche, template)),
  );
  if (available.length === 0) {
    for (const key of Array.from(usedSet)) {
      if (key.startsWith(`${niche}:`)) {
        usedSet.delete(key);
      }
    }
    available = queryList;
  }
  const template = available[Math.floor(Math.random() * available.length)];
  usedSet.add(queryTemplateKey(niche, template));
  return template;
}
