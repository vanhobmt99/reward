/**
 * Pure helpers for reading Rewards points/counters out of the getuserinfo
 * payload. Extracted from service.js so they can be unit-tested by actually
 * executing them (not string-matching the source).
 */

// Breadth-first search for the SHALLOWEST numeric value under any of `names`.
// BFS (queue) rather than a DFS stack so "first" means nearest the root — a
// top-level `balance` wins over a deeper/stale nested one deterministically.
export function findFirstNumberByKey(source, names) {
  const targets = new Set(names.map((name) => name.toLowerCase()));
  const queue = [source];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (targets.has(key.toLowerCase())) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return null;
}

// Bing has shipped several names for the same two numbers, and an entry that
// carries only the newer ones used to read as a flat 0/0. That silently disabled
// quota detection (`max` 0 means "no goal") and pinned `progress` at 0, which the
// search loop then interprets as "Bing has stopped crediting" and abandons the
// rest of the plan. Try the aliases before giving up.
const COUNTER_FIELD_ALIASES = {
  progress: ["progress", "pointProgress", "currentProgress", "current"],
  max: ["max", "pointProgressMax", "maxProgress", "total"],
};

// Returns null when the field is genuinely absent, so callers can tell "this
// counter reports zero" apart from "this counter has no such field".
function readCounterFieldRaw(item, key) {
  if (item == null) return null;
  const attr = item.attributes || item;
  for (const name of COUNTER_FIELD_ALIASES[key] || [key]) {
    const value = Number(attr?.[name] ?? item[name]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function readCounterField(item, key) {
  return readCounterFieldRaw(item, key) ?? 0;
}

/**
 * Pick the counter entry that describes today's earning state.
 *
 * Bing returns `counters.pcSearch` / `counters.mobileSearch` as an array with
 * one entry per point tier, and the entry order is not guaranteed to put the
 * live tier first. Reading `arr[0]` blindly could report a completed tier's
 * `progress`/`max` — which reads as "quota full" and stops the search phase
 * while points are still available. Prefer the first tier that still has room;
 * when every tier is complete, the last entry is the one that describes the day.
 *
 * Exported so `progress` and `max` are always read off the SAME entry.
 */
export function pickActiveCounter(arr) {
  if (!Array.isArray(arr)) return null;
  const items = arr.filter((item) => item != null);
  if (items.length === 0) return null;
  const active = items.find(
    (item) =>
      readCounterField(item, "max") > readCounterField(item, "progress"),
  );
  if (active) return active;
  // Nothing has room left. Prefer the last entry that actually reports a max:
  // an entry with no readable max describes nothing, and returning it would
  // leave `pcMax`/`mobMax` at 0 — which disables quota detection and pins
  // `progress` at 0 for the rest of the phase.
  const described = items.filter(
    (item) => readCounterFieldRaw(item, "max") !== null,
  );
  const pool = described.length > 0 ? described : items;
  return pool[pool.length - 1];
}

export function getCounterValue(arr, key) {
  return readCounterField(pickActiveCounter(arr), key);
}

export function sumCounterProgress(counters) {
  if (!counters || typeof counters !== "object") return 0;
  let total = 0;
  for (const value of Object.values(counters)) {
    if (Array.isArray(value)) {
      total += getCounterValue(value, "progress");
    }
  }
  return total;
}

// Build the score snapshot used to detect whether an activity click actually
// earned points. Pure: takes the parsed userStatus object.
export function buildRewardsSnapshot(userStatus) {
  const status = userStatus || {};
  const counters = status?.counters || {};
  const availablePoints = findFirstNumberByKey(status, [
    "availablePoints",
    "redeemablePoints",
    "balance",
    "pointsBalance",
    "pointBalance",
    "availablePoint",
  ]);
  const lifetimePoints = findFirstNumberByKey(status, [
    "lifetimePoints",
    "lifetimePoint",
    "totalPoints",
    "totalPoint",
  ]);
  const counterProgress = sumCounterProgress(counters);
  const score =
    availablePoints ??
    lifetimePoints ??
    (Number.isFinite(counterProgress) ? counterProgress : null);
  return {
    score,
    availablePoints,
    lifetimePoints,
    counterProgress,
    pcProgress: getCounterValue(counters.pcSearch, "progress"),
    mobProgress: getCounterValue(counters.mobileSearch, "progress"),
    pcMax: getCounterValue(counters.pcSearch, "max"),
    mobMax: getCounterValue(counters.mobileSearch, "max"),
  };
}

// Compare the two snapshots on a field that is finite in BOTH, preferring the
// most authoritative metric. Diffing the pre-collapsed `score` can subtract two
// different metrics when the fallback chain picked differently per snapshot
// (e.g. availablePoints in one, counterProgress in the other) — a meaningless
// delta. Falls back to `score` so callers passing bare {score} still work.
export function getScoreDelta(before, after) {
  if (!before || !after) return null;
  for (const field of [
    "availablePoints",
    "lifetimePoints",
    "counterProgress",
    "score",
  ]) {
    if (Number.isFinite(before[field]) && Number.isFinite(after[field])) {
      return after[field] - before[field];
    }
  }
  return null;
}
