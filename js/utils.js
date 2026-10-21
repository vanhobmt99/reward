import {isConfigRecord} from '/js/config-defaults.js';
import {isRewardsSearchCounterComplete} from '/js/rewards-metrics.js';

/**
 * Prints a timestamped console line. Unknown types use the default color.
 * @param {string} message Text to print.
 * @param {string=} type Level: default, success, warning, error, or update.
 */
function log(message, type = 'default') {
  const colorMap = {
    default: '#555555',
    success: '#48d17e',
    warning: '#f0a500',
    error: '#ff0000',
    update: '#00aaff',
  };
  const color = colorMap[type] || colorMap.default;
  const time = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.log(
      `%c[${time}] - [${type.toUpperCase()}] - ${message}`,
      `color: ${color}; font-weight: bold;`,
  );
}

/**
 * @param {!Object<string, *>} data Storage entries to replace.
 * @return {!Promise<void>} Resolves after the storage callback succeeds.
 */
function chromeSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

/**
 * @param {string|!Array<string>} keys Storage entries to read.
 * @return {!Promise<!Object<string, *>>} Unvalidated stored values.
 */
function chromeGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(items);
    });
  });
}

const WRITE_LOCK_KEY = '_configWriteLock';
const WRITE_LOCK_TIMEOUT_MS = 30000;

/**
 * Serializes cooperating writers in every extension page and worker.
 * Only acquisition has a deadline: releasing a lock before an in-flight storage
 * write finishes would allow that late write to overwrite the next operation.
 * @template T
 * @param {function(): !Promise<T>} write Operation to run under the lock.
 * @return {!Promise<T>} Operation result, or an acquisition/storage error.
 */
async function withConfigWriteLock(write) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== 'function') {
    throw new Error('Config writes require Web Locks');
  }
  const controller = new AbortController();
  const timer = setTimeout(
      () => controller.abort(new Error(
          `Could not acquire config write lock after ${
              WRITE_LOCK_TIMEOUT_MS}ms`,
          )),
      WRITE_LOCK_TIMEOUT_MS);
  try {
    return await locks.request(
        WRITE_LOCK_KEY, {mode: 'exclusive', signal: controller.signal}, () => {
          clearTimeout(timer);
          return write();
        });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Replaces only the supplied top-level sections, preserving all other sections
 * from the latest stored config. Each supplied section is a complete snapshot;
 * use atomicUpdate for an edit to an individual field within a section.
 * @param {!Object<string, *>} sections Sections owned by this writer.
 * @return {!Promise<!Object<string, *>>} The combined persisted config.
 */
async function updateConfigSections(sections) {
  if (!isConfigRecord(sections)) {
    throw new TypeError('Config sections must be an object');
  }
  const snapshot = structuredClone(sections);
  return atomicUpdate((current) => ({...current, ...snapshot}));
}

/**
 * @return {!Promise<?Object<string, *>>} Stored config, or null if absent.
 */
async function get() {
  try {
    const {config} = await chromeGet('config');
    const logs = config?.control?.log;
    if (logs) {
      log('[GET] Config data successfully retrieved.', 'success');
    }
    return isConfigRecord(config) ? config : null;
  } catch (err) {
    log(`[GET] Error retrieving config data: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Applies an edit to the latest config while holding the shared write lock.
 * The updater may be asynchronous, but must not call a config write helper:
 * acquiring the same exclusive lock recursively would deadlock.
 * @template T
 * @param {function(!Object<string, *>): (T|!Promise<T>)} updateFn Config edit.
 * @return {!Promise<T>} The persisted result. Failed edits do not write.
 */
async function atomicUpdate(updateFn) {
  return withConfigWriteLock(async () => {
    const {config} = await chromeGet('config');
    // Config is persisted as JSON. Capture before calling an updater that may
    // mutate its input, so equal edits avoid storage writes and change events.
    const previous = JSON.stringify(config);
    const updated = await updateFn(isConfigRecord(config) ? config : {});
    if (!isConfigRecord(updated)) {
      throw new TypeError('Config updater must return an object');
    }
    if (JSON.stringify(updated) !== previous) {
      await chromeSet({config: updated});
    }
    if (updated.control?.log) {
      log('[ATOMIC_UPDATE] Config updated atomically.', 'success');
    }
    return updated;
  });
}

/**
 * @typedef {{complete: (number|string|boolean|null|undefined),
 *     progress: (number|string|null|undefined),
 *     pointProgress: (number|string|null|undefined),
 *     currentProgress: (number|string|null|undefined),
 *     current: (number|string|null|undefined),
 *     max: (number|string|null|undefined),
 *     pointProgressMax: (number|string|null|undefined),
 *     maxProgress: (number|string|null|undefined),
 *     total: (number|string|null|undefined),
 *     attributes: (undefined|{complete: (number|string|boolean|null|undefined),
 *         progress: (number|string|null|undefined),
 *         max: (number|string|null|undefined)})}} RewardsCounterTier
 */

/**
 * Maps one Rewards search category to the stored daily-done flag.
 * @param {?Object<string, !Array<!RewardsCounterTier>>} counters Category map
 *     from getuserinfo. Only the named category is read.
 * @param {string} name Category key, such as "pcSearch" or "mobileSearch".
 * @return {number} 1 when that category's selected tier is complete, else 0.
 */
function getRewardsSearchCounterDone(counters, name) {
  return isRewardsSearchCounterComplete(counters?.[name]) ? 1 : 0;
}

/**
 * @param {number|string|null|undefined} value Stored 0/1 daily-search flag.
 * @return {boolean} Whether the flag is at least 1.
 */
function isDailySearchCounterDone(value) {
  return Number(value) >= 1;
}

/**
 * Clears done, total, failed, mobile and act, then persists the runtime
 * section.
 * @param {{control: ({log: number}|null|undefined),
 *     runtime: {done: number, total: number, failed: number, mobile: number,
 *         act: number}}} config Live config whose runtime section is replaced.
 * @return {!Promise<boolean>} False when the storage write throws.
 */
async function resetRuntime(config) {
  const logs = config?.control?.log;
  try {
    config.runtime.done = 0;
    config.runtime.total = 0;
    config.runtime.failed = 0;
    config.runtime.mobile = 0;
    config.runtime.act = 0;

    await updateConfigSections({runtime: config.runtime});
    if (logs) {
      log('[RESET RUNTIME] - Runtime counters reset successfully.', 'success');
    }
    return true;
  } catch (error) {
    log(
        `[RESET RUNTIME] - Error resetting runtime: ${error?.message}`,
        'error',
    );
    return false;
  }
}

export {
  log,
  updateConfigSections,
  get,
  atomicUpdate,
  resetRuntime,
  isRewardsSearchCounterComplete,
  getRewardsSearchCounterDone,
  isDailySearchCounterDone,
};
