/** @typedef {(number|string|null|undefined)} SearchInputNumber */
/**
 * @typedef {{desk: SearchInputNumber, mob: SearchInputNumber,
 *     min: SearchInputNumber, max: SearchInputNumber}} SearchPlanInput
 */
/**
 * @typedef {{desk: number, mob: number, min: number, max: number}} SearchPlan
 */
/**
 * @typedef {{defaultMin: (number|undefined), defaultMax: (number|undefined),
 *     minimum: (number|undefined)}} SearchBounds
 */

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
/**
 * @param {?SearchPlanInput=} searches Raw counts/delays; extra fields are
 *     retained.
 * @param {?SearchBounds=} bounds Optional finite defaults and minimum delay.
 * @return {!SearchPlan} Normalized finite counts and delay bounds.
 */
export function normalizeSearchPlan(searches = {}, bounds = {}) {
  const {
    defaultMin: suppliedMin,
    defaultMax: suppliedMax,
    minimum: suppliedMinimum,
  } = bounds || {};
  const minimum = Number.isFinite(suppliedMinimum) && suppliedMinimum >= 0 ?
      suppliedMinimum :
      MINIMUM_SEARCH_DELAY;
  const defaultMin = Math.max(
      minimum,
      Number.isFinite(suppliedMin) ? suppliedMin : DEFAULT_SEARCH_DELAY_MIN);
  const defaultMax =
      Number.isFinite(suppliedMax) ? suppliedMax : DEFAULT_SEARCH_DELAY_MAX;

  const rawDesk = Number(searches?.desk);
  const rawMob = Number(searches?.mob);
  const rawMin = Number(searches?.min);
  const rawMax = Number(searches?.max);

  const min = Number.isFinite(rawMin) ? Math.max(minimum, rawMin) : defaultMin;
  const max = Number.isFinite(rawMax) ? rawMax : defaultMax;

  const plan = {
    ...searches,
    // Counts drive integer loop bounds, so floor them — a dirty 3.7 must not
    // become 4 iterations (or feed a fractional value downstream).
    desk: Number.isFinite(rawDesk) ? Math.max(0, Math.floor(rawDesk)) : 0,
    mob: Number.isFinite(rawMob) ? Math.max(0, Math.floor(rawMob)) : 0,
    min,
    max,
  };

  if (plan.max < plan.min) {
    plan.max = plan.min;
  }
  return plan;
}

/**
 * Reports whether either finite requested count is positive.
 * @param {?SearchPlanInput=} searches Raw or normalized plan.
 * @return {boolean} Whether there is search work.
 */
export function hasSearchWork(searches = {}) {
  const desk = Number(searches?.desk);
  const mob = Number(searches?.mob);
  return (Number.isFinite(desk) && desk > 0) ||
      (Number.isFinite(mob) && mob > 0);
}

/**
 * Builds a case-insensitive key within a query category.
 * @param {string} niche Category name.
 * @param {?string} template Query template.
 * @return {string} Category-scoped key.
 */
export function queryTemplateKey(niche, template) {
  return `${niche}:${String(template || '').toLowerCase()}`;
}

/**
 * Pick a template for `niche` that has not been used yet this run. `usedSet` is
 * mutated: the chosen template's key is added. When every template in the niche
 * has been used, only that niche's keys are cleared (other niches keep their
 * history) and the full pool becomes available again.
 * @param {string} niche Category to choose from.
 * @param {?Object<string, !Array<string>>} queries Templates by category.
 * @param {!Set<string>} usedSet Mutable per-run template keys.
 * @return {string} Selected template, or empty when the category has no
 *     entries.
 */
export function chooseSearchTemplate(niche, queries, usedSet) {
  const queryList = (queries && queries[niche]) || [];
  if (queryList.length === 0) {
    return '';
  }
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
