/**
 * Persistent crash/error logger for the MV3 service worker.
 *
 * The service worker sleeps and restarts constantly, so an in-memory log is
 * useless right when a crash matters. This keeps a bounded ring buffer in
 * chrome.storage.local (survives worker restarts) plus installs global handlers
 * for uncaught errors and unhandled promise rejections — the two failure modes
 * that otherwise vanish silently.
 *
 * View from the service-worker DevTools console:
 *   chrome.storage.local.get('_crashLog', r => console.table(r._crashLog ||
 * [])) Dump full JSON (with stacks): chrome.storage.local.get('_crashLog', r =>
 * console.log(JSON.stringify(r._crashLog || [], null, 2))) Clear:
 *   chrome.storage.local.set({ _crashLog: [] })
 *
 * Kept import-free (no dependency on utils.js) so it can never be the thing
 * that crashes the logger, and so it works even before config is loaded.
 */

/**
 * @typedef {string|number|boolean|null} CrashJson
 */
/**
 * @typedef {!Object<string, (CrashJson|!Array<CrashJson>|undefined)>}
 * CrashExtra
 */
/**
 * @typedef {{message: (string|undefined), name: (string|undefined),
 *     stack: (string|undefined)}} SerializedError
 */
/**
 * @typedef {{ts: string, level: string, context: string,
 *     message: (string|undefined), name: (string|undefined),
 *     stack: (string|undefined), count: (number|undefined),
 *     lastTs: (string|undefined), extra: (CrashExtra|CrashJson|undefined)}}
 *     CrashLogEntry
 */
/**
 * @typedef {!Object<string, (!Array<!CrashLogEntry>|undefined)>} CrashLogStore
 */

const CRASH_LOG_KEY = '_crashLog';
const MAX_ENTRIES = 300;
const MAX_MESSAGE_LEN = 2000;

// Serialize writes so two crashes firing back-to-back don't lose each other
// through a read-modify-write race on the same storage key.
let writeChain = Promise.resolve();

/**
 * @param {string} key Storage key to read.
 * @return {!Promise<!CrashLogStore>} Stored items, or an empty object when the
 *     read fails.
 */
function readCrashStore(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (items) => {
        void chrome.runtime.lastError;  // never throw from the logger
        resolve(items || {});
      });
    } catch (_) {
      resolve({});
    }
  });
}

/**
 * @param {!CrashLogStore} obj Entries to write under their storage key.
 * @return {!Promise<void>} Resolves even when the write fails.
 */
function writeCrashStore(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(obj, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (_) {
      resolve();
    }
  });
}

/**
 * @param {!CrashExtra|CrashJson} extra Caller state stored with the entry.
 * @return {!CrashExtra|!Array<CrashJson>|CrashJson} JSON clone, or the string
 *     form when the value cannot be cloned.
 */
function cloneCrashExtra(extra) {
  try {
    return JSON.parse(JSON.stringify(extra));
  } catch (_) {
    return String(extra);
  }
}

/**
 * @param {!Error|string|null|undefined} err Thrown value.
 * @return {!SerializedError} Message, and name or stack when err is an object.
 */
function serializeError(err) {
  if (err == null) {
    return {message: String(err)};
  }
  if (typeof err === 'string') {
    return {message: err.slice(0, MAX_MESSAGE_LEN)};
  }
  return {
    message: String(err.message ?? err).slice(0, MAX_MESSAGE_LEN),
    name: err.name,
    stack: err.stack ? String(err.stack).slice(0, MAX_MESSAGE_LEN) : undefined,
  };
}

/**
 * Appends one entry, collapsing an identical crash loop into a repeat count.
 * @param {!CrashLogEntry} entry Next crash or breadcrumb.
 * @return {!Promise<void>} Resolves after the serialized write settles.
 */
async function appendEntry(entry) {
  writeChain = writeChain
                   .then(async () => {
                     const {[CRASH_LOG_KEY]: existing} =
                         await readCrashStore(CRASH_LOG_KEY);
                     const list = Array.isArray(existing) ? existing : [];
                     const last = list[list.length - 1];
                     // Collapse a tight crash-loop into one entry with a count
                     // instead of flushing the whole buffer with identical
                     // lines.
                     if (last && last.level === entry.level &&
                         last.context === entry.context &&
                         last.message === entry.message) {
                       last.count = (last.count || 1) + 1;
                       last.lastTs = entry.ts;
                     } else {
                       list.push(entry);
                       if (list.length > MAX_ENTRIES) {
                         list.splice(0, list.length - MAX_ENTRIES);
                       }
                     }
                     await writeCrashStore({[CRASH_LOG_KEY]: list});
                   })
                   .catch(() => {});
  return writeChain;
}

/**
 * Records a crash. `context` labels where it happened (for example
 * "initialise" or "message:start").
 * @param {string} context Call-site label. Empty becomes "unknown".
 * @param {!Error|string|null|undefined} error Thrown value.
 * @param {!CrashExtra=} extra Extra state cloned into the entry.
 * @return {!Promise<void>} Resolves after the entry is stored.
 */
export function recordCrash(context, error, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level: 'crash',
    context: String(context || 'unknown'),
    ...serializeError(error),
  };
  if (extra !== undefined) {
    entry.extra = cloneCrashExtra(extra);
  }
  try {
    console.error(`[CRASH][${entry.context}] ${entry.message}`, error);
  } catch (_) {
  }
  return appendEntry(entry);
}

/**
 * Records a non-fatal breadcrumb, such as "run started" or "phase = mobile".
 * @param {string} context Call-site label. Empty becomes "unknown".
 * @param {string} message Breadcrumb text.
 * @param {!CrashExtra=} extra Extra state cloned into the entry.
 * @return {!Promise<void>} Resolves after the entry is stored.
 */
export function recordEvent(context, message, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level: 'event',
    context: String(context || 'unknown'),
    message: String(message ?? '').slice(0, MAX_MESSAGE_LEN),
  };
  if (extra !== undefined) {
    entry.extra = cloneCrashExtra(extra);
  }
  return appendEntry(entry);
}

/**
 * @return {!Promise<!Array<!CrashLogEntry>>} Stored entries, or an empty list.
 */
async function getCrashLog() {
  const {[CRASH_LOG_KEY]: existing} = await readCrashStore(CRASH_LOG_KEY);
  return Array.isArray(existing) ? existing : [];
}

/**
 * Flattens the log into human-readable text, ready to drop into a .txt file.
 * @return {!Promise<string>} One block per entry, or a sentence when empty.
 */
export async function exportCrashLogText() {
  const list = await getCrashLog();
  if (list.length === 0) {
    return 'No crash log entries.';
  }
  return list
      .map((e) => {
        const repeats = e.count && e.count > 1 ? ` (x${e.count})` : '';
        let line =
            `${e.ts} [${e.level}] [${e.context}] ${e.message || ''}${repeats}`;
        if (e.stack) {
          line += `\n    ${String(e.stack).replace(/\n/g, '\n    ')}`;
        }
        if (e.extra !== undefined) {
          const extraStr =
              typeof e.extra === 'string' ? e.extra : JSON.stringify(e.extra);
          line += `\n    extra: ${extraStr}`;
        }
        return line;
      })
      .join('\n');
}

let handlersInstalled = false;

/** Install once at service-worker startup. Safe to call repeatedly. */
export function installGlobalCrashHandlers() {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;
  try {
    self.addEventListener('error', (event) => {
      recordCrash('global.error', event?.error || event?.message, {
        filename: event?.filename,
        lineno: event?.lineno,
        colno: event?.colno,
      });
    });
    self.addEventListener('unhandledrejection', (event) => {
      recordCrash('global.unhandledrejection', event?.reason);
    });
    recordEvent('crash-logger', 'Global crash handlers installed.');
  } catch (e) {
    try {
      console.error('[CRASH] Failed to install global handlers', e);
    } catch (_) {
    }
  }
}
