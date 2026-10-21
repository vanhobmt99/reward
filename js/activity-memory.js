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

/**
 * @typedef {{confirmed: (!Object<string, (boolean|number|null|undefined)>|
 * undefined), attempts: (!Object<string, number>|undefined)}}
 *     ActivityMemoryInput
 */
/**
 * @typedef {{confirmed: !Object<string, boolean>,
 *     attempts: !Object<string, number>}} ActivityMemory
 */
/**
 * @typedef {{maxFailedAttempts: (number|undefined)}} ActivityBlockOptions
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

/**
 * Drops expand and see-more keys from the failure ledger.
 * @param {?Object<string, number>} attempts Stored failure counts, or null.
 * @return {!Object<string, number>} Counts whose keys are real activities.
 */
export function sanitizeActivityAttempts(attempts) {
  return Object.fromEntries(
      Object.entries(attempts || {})
          .filter(
              ([key]) => !EXPAND_ATTEMPT_PATTERN.test(key),
              ),
  );
}

/**
 * Drops expand keys and falsey entries, and stores each survivor as true.
 * @param {?Object<string, (boolean|number|null|undefined)>} confirmed Stored
 *     confirmation flags, or null.
 * @return {!Object<string, boolean>} Keys confirmed for the rest of the day.
 */
export function sanitizeActivityConfirmed(confirmed) {
  return Object.fromEntries(
      Object.entries(confirmed || {})
          .filter(
              ([key, value]) =>
                  Boolean(value) && !EXPAND_ATTEMPT_PATTERN.test(key),
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
 * @param {?ActivityMemoryInput} memory Stored ledger, a legacy attempts map, or
 *     null.
 * @return {!ActivityMemory} Two-ledger memory safe to keep for today.
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
    if (Number(count) >= 1) {
      confirmed[key] = true;
    }
  }
  return {confirmed, attempts: {}};
}

/**
 * Keys the engine must not click this pass: already handled this session,
 * already confirmed today, or failed too many times today.
 * @param {?ActivityMemoryInput} memory Today's ledger, or null.
 * @param {!Array<string>|!Set<string>|null|undefined} sessionVisited Keys
 *     already handled in this session.
 * @param {?ActivityBlockOptions=} options Failure budget. Defaults to
 *     MAX_FAILED_ACTIVITY_ATTEMPTS. Null is treated as omitted.
 * @return {!Set<string>} Keys the engine must not click this pass.
 */
export function getBlockedActivityKeys(memory, sessionVisited, options = {}) {
  const {maxFailedAttempts = MAX_FAILED_ACTIVITY_ATTEMPTS} = options || {};
  const blocked = new Set(sessionVisited || []);
  for (const [key, value] of Object.entries(memory?.confirmed || {})) {
    if (value) {
      blocked.add(key);
    }
  }
  for (const [key, count] of Object.entries(memory?.attempts || {})) {
    if (Number(count) >= maxFailedAttempts) {
      blocked.add(key);
    }
  }
  return blocked;
}

/**
 * Records a failed attempt against the day's ledger. A missing memory is
 * ignored.
 * @param {?ActivityMemoryInput} memory Mutable daily ledger.
 * @param {!Array<string>|null|undefined} keys Activity keys that failed.
 */
export function recordActivityFailures(memory, keys) {
  if (!memory) {
    return;
  }
  memory.attempts = memory.attempts || {};
  for (const key of keys || []) {
    memory.attempts[key] = (Number(memory.attempts[key]) || 0) + 1;
  }
}

/**
 * A card scored. Block it for the rest of the day and forget its earlier
 * failures — those were slow points or a raced tab, not a dead card.
 * @param {?ActivityMemoryInput} memory Mutable daily ledger. Null updates only
 *     the session sets.
 * @param {!Set<string>} sessionVisited Keys blocked for this session.
 * @param {!Set<string>} sessionMisses In-session miss counts, keyed by
 *     activity.
 * @param {!Array<string>|null|undefined} keys Cards that scored.
 */
export function confirmActivityKeys(
    memory,
    sessionVisited,
    sessionMisses,
    keys,
) {
  if (memory) {
    memory.confirmed = memory.confirmed || {};
  }
  for (const key of keys || []) {
    sessionVisited.add(key);
    sessionMisses.delete(key);
    if (memory) {
      memory.confirmed[key] = true;
      if (memory.attempts) {
        delete memory.attempts[key];
      }
    }
  }
}

/**
 * A clicked card that did not score is a "miss". After `maxMisses` misses we
 * give up on it for this session; otherwise it stays retryable.
 *
 * Passing `memory` also persists the failure for the day, so a card that never
 * scores is not re-attempted from scratch in every single run.
 * @param {!Array<string>|null|undefined} keys Clicked cards that did not score.
 * @param {!Set<string>} sessionVisited Keys blocked for this session.
 * @param {!Map<string, number>} sessionMisses In-session miss counts.
 * @param {number=} maxMisses Misses before the card is blocked for the
 *     session. Defaults to 3 so a slow-scoring card gets one extra chance.
 * @param {?ActivityMemoryInput=} memory Daily ledger updated only when a card
 *     is given up for the session. Defaults to null.
 * @return {{retryable: boolean, blocked: number}} Whether any card can be
 *     tried again, and how many were blocked.
 */
export function markUnconfirmedActivityKeys(
    keys,
    sessionVisited,
    sessionMisses,
    // 3 rather than 2: a slow-scoring card and a genuinely missed click look
    // the same to the caller, so give one extra chance before blocking for the
    // session.
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
  return {retryable, blocked};
}
