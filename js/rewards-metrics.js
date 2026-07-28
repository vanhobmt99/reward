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

export function getCounterValue(arr, key) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const item = arr[0];
  if (item == null) return 0; // guard a literal null first element
  const attr = item.attributes || item;
  const value = Number(attr[key] ?? item[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
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
