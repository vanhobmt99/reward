/**
 * Pure helpers for the daily "activity memory" — which Rewards cards have been
 * confirmed/failed today, so the engine avoids re-clicking a card that already
 * paid out and stops hammering one that never will. Extracted from service.js
 * for real unit testing. All functions operate on plain objects / Sets / Maps
 * passed by the caller; storage I/O stays in service.js.
 *
 * Two separate ledgers, because "done" and "broken" need opposite treatment:
 *   memory.confirmed — card scored today. Blocked for the rest of the day; a
 *                      second click earns nothing and only costs a tab load.
 *   memory.attempts  — consecutive FAILED attempts. Blocked once it hits
 *                      MAX_FAILED_ACTIVITY_ATTEMPTS, so a card that is broken
 *                      or ineligible is not retried in every run forever.
 * A later success clears the failure count: the earlier misses were noise
 * (slow-scoring points, a raced tab), not evidence the card is dead.
 */

// Failures tolerated across the whole day before a card is left alone. Higher
// than the per-session miss limit on purpose: a card can legitimately miss a
// whole run (points registering late, a transient network error) and still be
// worth one more try tomorrow-morning's run.
export const MAX_FAILED_ACTIVITY_ATTEMPTS = 4;

// Cards whose visible label IS an "expand/see more" control must never be
// remembered as attempts (they are navigation, not point-earning activities).
// Anchored to the whole key on purpose: a key is either a URL or "type|label",
// and a substring match also ate real cards whose description merely mentions
// one of these phrases ("Earn more points when your friends search on Bing"),
// so their daily confirmation was dropped on every load and the card was then
// clicked again in the next run.
const EXPAND_ATTEMPT_PATTERN =
  /^(?:[a-z-]+\|)?\s*(earn more|show more|see more|view all|load more|more activities|expand|kiếm thêm|xem thêm|hiển thị thêm|mở rộng)\s*$/i;

export function sanitizeActivityAttempts(attempts) {
  return Object.fromEntries(
    Object.entries(attempts || {}).filter(
      ([key]) => !EXPAND_ATTEMPT_PATTERN.test(key),
    ),
  );
}

export function sanitizeActivityConfirmed(confirmed) {
  return Object.fromEntries(
    Object.entries(confirmed || {})
      .filter(
        ([key, value]) => Boolean(value) && !EXPAND_ATTEMPT_PATTERN.test(key),
      )
      .map(([key]) => [key, true]),
  );
}

/**
 * Bring a stored memory object up to the two-ledger shape.
 *
 * Memory written before the split used `attempts` as a count of *confirmations*
 * (it was only ever incremented on success), so an entry there means the card
 * scored — migrate it into `confirmed` rather than reading it as failures,
 * which would otherwise hand every completed card a free retry.
 */
export function migrateActivityMemory(memory) {
  const source = memory || {};
  if (source.confirmed !== undefined) {
    return {
      confirmed: sanitizeActivityConfirmed(source.confirmed),
      attempts: sanitizeActivityAttempts(source.attempts),
    };
  }
  const legacy = sanitizeActivityAttempts(source.attempts);
  const confirmed = {};
  for (const [key, count] of Object.entries(legacy)) {
    if (Number(count) >= 1) confirmed[key] = true;
  }
  return { confirmed, attempts: {} };
}

/**
 * Keys the engine must not click this pass: already handled this session,
 * already confirmed today, or failed too many times today.
 */
export function getBlockedActivityKeys(memory, sessionVisited, options = {}) {
  const { maxFailedAttempts = MAX_FAILED_ACTIVITY_ATTEMPTS } = options || {};
  const blocked = new Set(sessionVisited || []);
  for (const [key, value] of Object.entries(memory?.confirmed || {})) {
    if (value) blocked.add(key);
  }
  for (const [key, count] of Object.entries(memory?.attempts || {})) {
    if (Number(count) >= maxFailedAttempts) {
      blocked.add(key);
    }
  }
  return blocked;
}

// Record a FAILED attempt against the day's ledger.
export function recordActivityFailures(memory, keys) {
  if (!memory) return;
  memory.attempts = memory.attempts || {};
  for (const key of keys || []) {
    memory.attempts[key] = (Number(memory.attempts[key]) || 0) + 1;
  }
}

/**
 * A card scored. Block it for the rest of the day and forget its earlier
 * failures — those were slow points or a raced tab, not a dead card.
 */
export function confirmActivityKeys(
  memory,
  sessionVisited,
  sessionMisses,
  keys,
) {
  if (memory) memory.confirmed = memory.confirmed || {};
  for (const key of keys || []) {
    sessionVisited.add(key);
    sessionMisses.delete(key);
    if (memory) {
      memory.confirmed[key] = true;
      if (memory.attempts) delete memory.attempts[key];
    }
  }
}

/**
 * A clicked card that did not score is a "miss". After `maxMisses` misses we
 * give up on it for this session; otherwise it stays retryable.
 *
 * Passing `memory` also persists the failure for the day, so a card that never
 * scores is not re-attempted from scratch in every single run.
 */
export function markUnconfirmedActivityKeys(
  keys,
  sessionVisited,
  sessionMisses,
  // 3 rather than 2: a slow-scoring card and a genuinely missed click look the
  // same to the caller, so give one extra chance before blocking for the session.
  maxMisses = 3,
  memory = null,
) {
  let retryable = false;
  let blocked = 0;
  for (const key of keys || []) {
    const misses = (Number(sessionMisses.get(key)) || 0) + 1;
    sessionMisses.set(key, misses);
    if (misses >= maxMisses) {
      sessionVisited.add(key);
      blocked++;
      // Only a session-level give-up counts against the daily budget; the
      // in-session retries are the same attempt being given another chance.
      recordActivityFailures(memory, [key]);
    } else {
      retryable = true;
    }
  }
  return { retryable, blocked };
}
