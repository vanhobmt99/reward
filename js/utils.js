function log(message, type = "default") {
  const colorMap = {
    default: "#555555",
    success: "#48d17e",
    warning: "#f0a500",
    error: "#ff0000",
    update: "#00aaff",
  };
  const color = colorMap[type] || colorMap.default;
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(
    `%c[${time}] - [${type.toUpperCase()}] - ${message}`,
    `color: ${color}; font-weight: bold;`,
  );
}

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

// ── Write-lock: serialize all config writes to prevent race conditions ──
let _writeQueue = Promise.resolve();
const WRITE_LOCK_KEY = "_configWriteLock";
const WRITE_LOCK_TIMEOUT_MS = 30000;

function _serializeWrite(writeFn) {
  const task = _writeQueue
    .then(() => writeFn())
    .catch((err) => {
      log(`[WRITE_LOCK] - Write failed: ${err.message}`, "error");
      throw err;
    });
  _writeQueue = task.catch(() => {});
  return task;
}

/**
 * Acquire a cross-context write lock via chrome.storage.local.
 * Uses a simple spin-lock with exponential backoff (max ~5s).
 */
async function _acquireCrossContextLock(logs) {
  const start = Date.now();
  const ownerId = `${Math.random().toString(36).slice(2)}_${Date.now()}`;
  let attempt = 0;
  while (Date.now() - start < WRITE_LOCK_TIMEOUT_MS) {
    const { [WRITE_LOCK_KEY]: lock } = await chromeGet(WRITE_LOCK_KEY);
    if (!lock || Date.now() - (lock.ts || 0) > WRITE_LOCK_TIMEOUT_MS) {
      await chromeSet({ [WRITE_LOCK_KEY]: { id: ownerId, ts: Date.now() } });
      await new Promise((r) => setTimeout(r, 5));
      const { [WRITE_LOCK_KEY]: confirm } = await chromeGet(WRITE_LOCK_KEY);
      if (confirm?.id === ownerId) return ownerId;
    }
    attempt++;
    await new Promise((r) =>
      setTimeout(r, Math.min(50 * Math.pow(2, attempt), 500)),
    );
  }
  const message = `[WRITE_LOCK] - Could not acquire lock after ${WRITE_LOCK_TIMEOUT_MS}ms`;
  logs && log(message, "error");
  throw new Error(message);
}

async function _releaseCrossContextLock(ownerId) {
  if (!ownerId) return;
  try {
    const { [WRITE_LOCK_KEY]: lock } = await chromeGet(WRITE_LOCK_KEY);
    if (lock?.id === ownerId) {
      await chrome.storage.local.remove(WRITE_LOCK_KEY);
    }
  } catch (error) {
    log(`[WRITE_LOCK] - Could not release lock: ${error.message}`, "warning");
  }
}

async function set(value) {
  const logs = value?.control?.log;
  return _serializeWrite(async () => {
    if (globalThis.navigator?.locks?.request) {
      return globalThis.navigator.locks.request(
        WRITE_LOCK_KEY,
        { mode: "exclusive" },
        async () => {
          await chromeSet({ config: value });
          if (logs) {
            log("[SET] Config data successfully set.", "success");
          }
        },
      );
    }
    let lockOwner = null;
    try {
      lockOwner = await _acquireCrossContextLock(logs);
      await chromeSet({ config: value });
      if (logs) {
        log("[SET] Config data successfully set.", "success");
      }
    } catch (err) {
      log(`[SET] Failed to set config data: ${err.message}`, "error");
      throw err;
    } finally {
      await _releaseCrossContextLock(lockOwner);
    }
  });
}

async function get() {
  try {
    const { config } = await chromeGet("config");
    const logs = config?.control?.log;
    if (logs) {
      log("[GET] Config data successfully retrieved.", "success");
    }
    return config || null;
  } catch (err) {
    log(`[GET] Error retrieving config data: ${err.message}`, "error");
    throw err;
  }
}

/**
 * Atomically read-modify-write config.
 * Prevents lost updates when popup and service worker both modify config.
 *
 * @param {Function} updateFn - Receives current config, returns modified config.
 * @returns {Promise<Object>} The new config after update.
 */
async function atomicUpdate(updateFn) {
  return _serializeWrite(async () => {
    if (globalThis.navigator?.locks?.request) {
      return globalThis.navigator.locks.request(
        WRITE_LOCK_KEY,
        { mode: "exclusive" },
        async () => {
          const { config } = await chromeGet("config");
          const updated = updateFn(config || {});
          const logs = updated?.control?.log;
          await chromeSet({ config: updated });
          if (logs) {
            log("[ATOMIC_UPDATE] Config updated atomically.", "success");
          }
          return updated;
        },
      );
    }
    let lockOwner = null;
    try {
      lockOwner = await _acquireCrossContextLock();
      const { config } = await chromeGet("config");
      const updated = updateFn(config || {});
      const logs = updated?.control?.log;
      await chromeSet({ config: updated });
      if (logs) {
        log("[ATOMIC_UPDATE] Config updated atomically.", "success");
      }
      return updated;
    } catch (err) {
      log(`[ATOMIC_UPDATE] Failed: ${err.message}`, "error");
      throw err;
    } finally {
      await _releaseCrossContextLock(lockOwner);
    }
  });
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStoredConfig(stored) {
  if (!isPlainObject(stored)) {
    return stored;
  }
  const sanitized = { ...stored };
  delete sanitized.pro;
  if (isPlainObject(sanitized.control)) {
    sanitized.control = { ...sanitized.control };
    delete sanitized.control.consent;
  }
  return sanitized;
}

function deepMergePlainObjects(base, patch) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = deepMergePlainObjects(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function applyConfigDefaults(target, stored) {
  const storedPatchDefaultApplied =
    stored?.control?.enhancedPatchDefaultApplied === 1;
  const storedHumanPacingDefaultApplied =
    stored?.control?.humanPacingDefaultApplied === 1;
  const sanitizedStored = sanitizeStoredConfig(stored);
  if (sanitizedStored) {
    for (const [key, value] of Object.entries(sanitizedStored)) {
      if (isPlainObject(target[key]) && isPlainObject(value)) {
        target[key] = deepMergePlainObjects(target[key], value);
      } else {
        target[key] = value;
      }
    }
  }

  target.control = target.control || {};
  delete target.control.consent;
  delete target.pro;
  if (!storedPatchDefaultApplied) {
    target.control.clear = 1;
    target.control.enhancedPatchDefaultApplied = 1;
    target.control.preserveRewards = 1;
  } else if (
    target.control.clear === undefined ||
    target.control.clear === null
  ) {
    target.control.clear = 1;
  }
  if (
    target.control.preserveRewards === undefined ||
    target.control.preserveRewards === null
  ) {
    target.control.preserveRewards = 1;
  }
  if (!storedHumanPacingDefaultApplied) {
    if (target.search?.min === 10 && target.search?.max === 20) {
      target.search = { ...target.search, min: 7, max: 14 };
    }
    if (target.schedule?.min === 10 && target.schedule?.max === 20) {
      target.schedule = { ...target.schedule, min: 7, max: 14 };
    }
    target.control.humanPacingDefaultApplied = 1;
  } else if (
    target.control.humanPacingDefaultApplied === undefined ||
    target.control.humanPacingDefaultApplied === null
  ) {
    target.control.humanPacingDefaultApplied = 1;
  }
  // One-time migration to the faster pacing defaults (6-10s). Only rewrites
  // configs still on a previous default band (7/14 or the short-lived 5/8);
  // custom pacing is preserved. Versioned flag: bumping the number re-runs
  // the migration once for configs already stamped with an older version.
  if ((Number(target.control.fastPacingDefaultApplied) || 0) < 2) {
    const isOldDefault = (band) =>
      (band?.min === 7 && band?.max === 14) ||
      (band?.min === 5 && band?.max === 8);
    if (isOldDefault(target.search)) {
      target.search = { ...target.search, min: 6, max: 10 };
    }
    if (isOldDefault(target.schedule)) {
      target.schedule = { ...target.schedule, min: 6, max: 10 };
    }
    target.control.fastPacingDefaultApplied = 2;
  }

  return target;
}

function readRewardsCounterAttr(item, key) {
  if (item == null) return 0;
  const attr = item.attributes || item;
  const value = Number(attr[key] ?? item[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Pick the counter entry that describes today's earning state.
 *
 * Bing returns `counters.pcSearch` / `counters.mobileSearch` as an array with
 * one entry per point tier, in no guaranteed order. Reading `counterArray[0]`
 * blindly can land on a tier that is already complete while the live tier still
 * has room — which marks the whole daily counter "done" and makes the run skip
 * searching entirely.
 *
 * Same rule as `pickActiveCounter` in js/rewards-metrics.js. Duplicated rather
 * than imported because js/utils.js is evaluated by the test sandbox, which
 * does not resolve `import` statements.
 */
function pickActiveRewardsCounter(counterArray) {
  if (!Array.isArray(counterArray)) return null;
  const items = counterArray.filter((item) => item != null);
  if (items.length === 0) return null;
  const active = items.find(
    (item) =>
      readRewardsCounterAttr(item, "max") >
      readRewardsCounterAttr(item, "progress"),
  );
  return active || items[items.length - 1];
}

function getRewardsCounterField(counterArray, key) {
  return readRewardsCounterAttr(pickActiveRewardsCounter(counterArray), key);
}

function isRewardsSearchCounterComplete(counterArray) {
  const active = pickActiveRewardsCounter(counterArray);
  if (!active) return false;
  const progress = readRewardsCounterAttr(active, "progress");
  const max = readRewardsCounterAttr(active, "max");
  // A tier that still has room means the day is NOT done, whatever a stale
  // `complete` flag on that entry claims. Checking this first is what stops an
  // 18/60 mobile counter from being reported as finished.
  if (max > 0 && progress < max) return false;
  if (readRewardsCounterAttr(active, "complete") >= 1) return true;
  return max > 0 && progress >= max;
}

function getRewardsSearchCounterDone(counters, name) {
  return isRewardsSearchCounterComplete(counters?.[name]) ? 1 : 0;
}

function isDailySearchCounterDone(value) {
  return Number(value) >= 1;
}

async function resetRuntime(config) {
  const logs = config?.control?.log;
  try {
    config.runtime.done = 0;
    config.runtime.total = 0;
    config.runtime.failed = 0;
    config.runtime.mobile = 0;
    config.runtime.act = 0;

    await set(config);
    if (logs) {
      log("[RESET RUNTIME] - Runtime counters reset successfully.", "success");
    }
    return true;
  } catch (error) {
    log(
      `[RESET RUNTIME] - Error resetting runtime: ${error?.message}`,
      "error",
    );
    return false;
  }
}

export {
  log,
  set,
  get,
  atomicUpdate,
  resetRuntime,
  applyConfigDefaults,
  getRewardsCounterField,
  isRewardsSearchCounterComplete,
  getRewardsSearchCounterDone,
  isDailySearchCounterDone,
};
