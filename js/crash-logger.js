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
 *   chrome.storage.local.get('_crashLog', r => console.table(r._crashLog || []))
 * Dump full JSON (with stacks):
 *   chrome.storage.local.get('_crashLog', r => console.log(JSON.stringify(r._crashLog || [], null, 2)))
 * Clear:
 *   chrome.storage.local.set({ _crashLog: [] })
 *
 * Kept import-free (no dependency on utils.js) so it can never be the thing that
 * crashes the logger, and so it works even before config is loaded.
 */

export const CRASH_LOG_KEY = "_crashLog";
const MAX_ENTRIES = 300;
const MAX_MESSAGE_LEN = 2000;

// Serialize writes so two crashes firing back-to-back don't lose each other
// through a read-modify-write race on the same storage key.
let _writeChain = Promise.resolve();

function _storageGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (items) => {
        void chrome.runtime.lastError; // never throw from the logger
        resolve(items || {});
      });
    } catch (_) {
      resolve({});
    }
  });
}

function _storageSet(obj) {
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

function _safeExtra(extra) {
  try {
    return JSON.parse(JSON.stringify(extra));
  } catch (_) {
    return String(extra);
  }
}

function _serializeError(err) {
  if (err == null) return { message: String(err) };
  if (typeof err === "string") {
    return { message: err.slice(0, MAX_MESSAGE_LEN) };
  }
  return {
    message: String(err.message ?? err).slice(0, MAX_MESSAGE_LEN),
    name: err.name,
    stack: err.stack ? String(err.stack).slice(0, MAX_MESSAGE_LEN) : undefined,
  };
}

async function _append(entry) {
  _writeChain = _writeChain
    .then(async () => {
      const { [CRASH_LOG_KEY]: existing } = await _storageGet(CRASH_LOG_KEY);
      const list = Array.isArray(existing) ? existing : [];
      const last = list[list.length - 1];
      // Collapse a tight crash-loop into one entry with a count instead of
      // flushing the whole buffer with identical lines.
      if (
        last &&
        last.level === entry.level &&
        last.context === entry.context &&
        last.message === entry.message
      ) {
        last.count = (last.count || 1) + 1;
        last.lastTs = entry.ts;
      } else {
        list.push(entry);
        if (list.length > MAX_ENTRIES) {
          list.splice(0, list.length - MAX_ENTRIES);
        }
      }
      await _storageSet({ [CRASH_LOG_KEY]: list });
    })
    .catch(() => {});
  return _writeChain;
}

/**
 * Record a crash/error. `context` labels where it happened (e.g. "initialise",
 * "message:start"), `error` is the thrown value, `extra` is any extra state.
 */
export function recordCrash(context, error, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level: "crash",
    context: String(context || "unknown"),
    ..._serializeError(error),
  };
  if (extra !== undefined) entry.extra = _safeExtra(extra);
  try {
    console.error(`[CRASH][${entry.context}] ${entry.message}`, error);
  } catch (_) {}
  return _append(entry);
}

/** Record a non-fatal breadcrumb (e.g. "run started", "phase = mobile"). */
export function recordEvent(context, message, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level: "event",
    context: String(context || "unknown"),
    message: String(message ?? "").slice(0, MAX_MESSAGE_LEN),
  };
  if (extra !== undefined) entry.extra = _safeExtra(extra);
  return _append(entry);
}

export async function getCrashLog() {
  const { [CRASH_LOG_KEY]: existing } = await _storageGet(CRASH_LOG_KEY);
  return Array.isArray(existing) ? existing : [];
}

export async function clearCrashLog() {
  await _storageSet({ [CRASH_LOG_KEY]: [] });
}

/** Flatten the log into human-readable text, ready to drop into a .txt file. */
export async function exportCrashLogText() {
  const list = await getCrashLog();
  if (list.length === 0) return "No crash log entries.";
  return list
    .map((e) => {
      const repeats = e.count && e.count > 1 ? ` (x${e.count})` : "";
      let line = `${e.ts} [${e.level}] [${e.context}] ${e.message || ""}${repeats}`;
      if (e.stack) line += `\n    ${String(e.stack).replace(/\n/g, "\n    ")}`;
      if (e.extra !== undefined) {
        const extraStr =
          typeof e.extra === "string" ? e.extra : JSON.stringify(e.extra);
        line += `\n    extra: ${extraStr}`;
      }
      return line;
    })
    .join("\n");
}

let _installed = false;

/** Install once at service-worker startup. Safe to call repeatedly. */
export function installGlobalCrashHandlers() {
  if (_installed) return;
  _installed = true;
  try {
    self.addEventListener("error", (event) => {
      recordCrash("global.error", event?.error || event?.message, {
        filename: event?.filename,
        lineno: event?.lineno,
        colno: event?.colno,
      });
    });
    self.addEventListener("unhandledrejection", (event) => {
      recordCrash("global.unhandledrejection", event?.reason);
    });
    recordEvent("crash-logger", "Global crash handlers installed.");
  } catch (e) {
    try {
      console.error("[CRASH] Failed to install global handlers", e);
    } catch (_) {}
  }
}
