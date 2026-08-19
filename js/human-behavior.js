/**
 * Pure helpers that shape automation into human-looking behaviour: typing with
 * real typo-then-backspace correction, topic-coherent query bursts, post-SERP
 * scroll patterns, and a log-normal read-delay distribution.
 *
 * Everything here is deterministic given an injected `rng`, so the *shape* of
 * the behaviour (and not just "it returned a number") can be unit-tested. No
 * chrome/debugger I/O lives in this file — service.js executes the plans.
 */

// QWERTY adjacency used to pick a plausible mistyped key. A typo must land on a
// physically neighbouring key; a random letter reads as corruption, not as a
// human slip.
export const KEYBOARD_NEIGHBOURS = {
  a: ["s", "q", "w", "z"],
  b: ["v", "g", "h", "n"],
  c: ["x", "d", "f", "v"],
  d: ["s", "e", "r", "f", "c", "x"],
  e: ["w", "s", "d", "r"],
  f: ["d", "r", "t", "g", "v", "c"],
  g: ["f", "t", "y", "h", "b", "v"],
  h: ["g", "y", "u", "j", "n", "b"],
  i: ["u", "j", "k", "o"],
  j: ["h", "u", "i", "k", "m", "n"],
  k: ["j", "i", "o", "l", "m"],
  l: ["k", "o", "p"],
  m: ["n", "j", "k"],
  n: ["b", "h", "j", "m"],
  o: ["i", "k", "l", "p"],
  p: ["o", "l"],
  q: ["a", "w"],
  r: ["e", "d", "f", "t"],
  s: ["a", "w", "e", "d", "x", "z"],
  t: ["r", "f", "g", "y"],
  u: ["y", "h", "j", "i"],
  v: ["c", "f", "g", "b"],
  w: ["q", "a", "s", "e"],
  x: ["z", "s", "d", "c"],
  y: ["t", "g", "h", "u"],
  z: ["a", "s", "x"],
};

export function nearbyKey(char, rng = Math.random) {
  const lower = String(char).toLowerCase();
  const neighbours = KEYBOARD_NEIGHBOURS[lower];
  if (!neighbours || neighbours.length === 0) return null;
  const pick = neighbours[Math.floor(rng() * neighbours.length)];
  return char === lower ? pick : pick.toUpperCase();
}

/**
 * Turn `query` into a list of typing steps. Steps are:
 *   {type:"insert", text}            — insert literal text
 *   {type:"backspace", count}        — press Backspace `count` times
 *   {type:"pause", ms}               — the "wait, that's wrong" beat
 *
 * INVARIANT: applying the steps in order to an empty buffer always reproduces
 * `query` exactly. A typo is always corrected — an *uncorrected* typo is more
 * suspicious than a clean query, because real users notice and fix them.
 */
export function planTypingSteps(query, options = {}) {
  const {
    rng = Math.random,
    typoChance = 0.18,
    maxTypos = 2,
    noticeDelayMin = 220,
    noticeDelayMax = 600,
  } = options;

  const text = String(query ?? "");
  const steps = [];
  if (text.length === 0) return steps;

  // Type word-by-word: real typing bursts at word granularity with a longer
  // gap at the space, rather than a uniform per-character stream.
  const words = text.split(" ");
  let typos = 0;

  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    const prefix = wi > 0 ? " " : "";

    // A typo needs at least 2 letters of runway; the first character of a word
    // is rarely fumbled and mistyping it looks synthetic.
    const canTypo = typos < maxTypos && word.length >= 3 && rng() < typoChance;

    if (!canTypo) {
      if (prefix + word) steps.push({ type: "insert", text: prefix + word });
      continue;
    }

    const at = 1 + Math.floor(rng() * (word.length - 1));
    const wrong = nearbyKey(word[at], rng);
    if (wrong === null || wrong === word[at]) {
      steps.push({ type: "insert", text: prefix + word });
      continue;
    }

    typos++;
    // Overshoot slightly past the bad character sometimes — people usually
    // catch a typo a keystroke or two late, not instantly.
    const overshoot = rng() < 0.5 && at + 1 < word.length ? 1 : 0;
    const typed =
      prefix +
      word.slice(0, at) +
      wrong +
      word.slice(at + 1, at + 1 + overshoot);
    steps.push({ type: "insert", text: typed, typo: true });
    steps.push({
      type: "pause",
      ms: Math.round(
        noticeDelayMin + rng() * (noticeDelayMax - noticeDelayMin),
      ),
    });
    steps.push({ type: "backspace", count: 1 + overshoot });
    steps.push({ type: "insert", text: word.slice(at), corrected: true });
  }

  return steps;
}

// Test/debug helper: replay steps to confirm they reproduce the query.
export function applyTypingSteps(steps) {
  let buffer = "";
  for (const step of steps || []) {
    if (step.type === "insert") buffer += step.text;
    else if (step.type === "backspace")
      buffer = buffer.slice(0, Math.max(0, buffer.length - step.count));
  }
  return buffer;
}

/**
 * Topic-coherent niche picker. A real session searches within a subject for a
 * few queries before moving on; re-rolling the category on every single query
 * produces a subject sequence no human generates.
 *
 * Returns {next()} — the same niche for `minBurst..maxBurst` consecutive calls,
 * then a *different* one (never the same niche twice in a row when more than
 * one category exists).
 */
export function createNicheSession(categories, options = {}) {
  const { rng = Math.random, minBurst = 3, maxBurst = 6 } = options;
  const pool = Array.isArray(categories) ? categories.filter(Boolean) : [];

  let current = null;
  let remaining = 0;

  const rollBurst = () =>
    minBurst + Math.floor(rng() * Math.max(1, maxBurst - minBurst + 1));

  const pickDifferent = () => {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const others = pool.filter((niche) => niche !== current);
    return others[Math.floor(rng() * others.length)];
  };

  return {
    next() {
      if (pool.length === 0) return null;
      if (remaining <= 0) {
        current = pickDifferent();
        remaining = rollBurst();
      }
      remaining--;
      return current;
    },
    // Exposed for logging: how many queries are left in the current topic run.
    get remaining() {
      return remaining;
    },
    get niche() {
      return current;
    },
  };
}

// Standard normal via Box-Muller. Two rng draws, clamped away from 0 so the
// log never blows up.
function gaussian(rng) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// One-to-two-and-a-half minutes, not the four this used to allow. Measured
// against a 31+21 run, the old 90-240s over one pause per 12 searches cost ~8
// minutes of wall clock — by far the largest single cost of the humanisation
// work, for a benefit that is pure conjecture. The break is kept (a session
// with no interruption at all is itself unusual) but sized so it is no longer
// the dominant term.
export const LONG_PAUSE_MIN_MS = 30000;
export const LONG_PAUSE_MAX_MS = 60000;
export const DEFAULT_SEARCHES_PER_LONG_PAUSE = 30;
export const READ_DELAY_CAP_MS = 90000;

/**
 * Read-delay sampled from a log-normal distribution rather than uniform.
 *
 * Uniform-random delays are individually plausible but collectively obvious:
 * over ~30 samples a flat distribution is trivially separable from human
 * inter-query timing, which is right-skewed — mostly short, with a long tail.
 *
 * `minSec`/`maxSec` are the user's configured bounds: the median lands inside
 * them, and the tail is allowed to run past `maxSec` (up to 3x) because real
 * long gaps are exactly what a hard ceiling removes.
 */
export function humanReadDelayMs(minSec, maxSec, options = {}) {
  const { rng = Math.random, boost = 1, cap = READ_DELAY_CAP_MS } = options;
  const min = Math.max(1, Number(minSec) || 1) * 1000;
  const max = Math.max(min, (Number(maxSec) || 0) * 1000);

  // Median sits at ~45% into the configured band: most reads are quick.
  const median = min + (max - min) * 0.45;
  const sigma = 0.42;
  const sample = Math.exp(Math.log(median) + sigma * gaussian(rng));

  const floor = min;
  // Tail trimmed from 3x to 2x max: keeps the right-skewed human shape
  // (occasional genuinely long reads) without the old worst-case cost.
  const ceiling = Math.min(Math.max(max * 2, min), cap);
  const clamped = Math.min(Math.max(sample, floor), ceiling);
  return Math.round(Math.min(clamped * (Number(boost) || 1), cap));
}

/**
 * Choose which search indices get a "stepped away from the keyboard" pause.
 * Returns a Set of 0-based indices; roughly one per `per` searches, never the
 * first or the last (a pause there just delays the run without looking like
 * anything).
 */
export function planLongPauseIndices(total, options = {}) {
  const { rng = Math.random, per = DEFAULT_SEARCHES_PER_LONG_PAUSE } = options;
  const count = Math.floor((Number(total) || 0) / per);
  const indices = new Set();
  if (count <= 0 || total < 4) return indices;

  for (let i = 0; i < count; i++) {
    // Candidate range excludes index 0 and the final search.
    const span = total - 2;
    if (span <= 0) break;
    indices.add(1 + Math.floor(rng() * span));
  }
  return indices;
}

export function longPauseMs(rng = Math.random) {
  return Math.round(
    LONG_PAUSE_MIN_MS + rng() * (LONG_PAUSE_MAX_MS - LONG_PAUSE_MIN_MS),
  );
}
