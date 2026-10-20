const { loadEsmModule } = require("./esm-loader.js");

// In-memory chrome.storage.local mock whose callbacks fire synchronously, so the
// write-lock's read-after-write confirmation works like the real API.
function makeChromeMock() {
  const store = {};
  return {
    _store: store,
    runtime: { lastError: null },
    storage: {
      local: {
        set: (data, cb) => {
          Object.assign(store, data);
          if (cb) cb();
        },
        get: (keys, cb) => {
          let result = {};
          if (typeof keys === "string") {
            result[keys] = store[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => (result[k] = store[k]));
          } else if (keys == null) {
            result = { ...store };
          } else {
            Object.keys(keys).forEach((k) => (result[k] = store[k] ?? keys[k]));
          }
          if (cb) cb(result);
        },
        remove: (key, cb) => {
          delete store[key];
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
  };
}

function loadUtils(chrome, navigator) {
  return loadEsmModule("../js/utils.js", {
    chrome,
    navigator,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    Object,
    Array,
    Error,
    Boolean,
    Number,
    JSON,
    Set,
  });
}

describe("utils config storage", () => {
  test("set() then get() round-trips the config through storage", async () => {
    const chrome = makeChromeMock();
    const { set, get } = loadUtils(chrome);
    const cfg = { control: { log: 0 }, runtime: { done: 3 } };
    await set(cfg);
    const loaded = await get();
    expect(loaded).toEqual(cfg);
  });

  test("set() releases the write lock so a later write can proceed", async () => {
    const chrome = makeChromeMock();
    const { set } = loadUtils(chrome);
    await set({ control: {}, runtime: { done: 1 } });
    // Lock must not be left behind after a successful write.
    expect(chrome._store._configWriteLock).toBeUndefined();
    await set({ control: {}, runtime: { done: 2 } });
    expect(chrome._store.config.runtime.done).toBe(2);
  });

  test("get() returns null when nothing is stored", async () => {
    const chrome = makeChromeMock();
    const { get } = loadUtils(chrome);
    expect(await get()).toBeNull();
  });

  test("resetRuntime() zeroes the runtime counters and persists", async () => {
    const chrome = makeChromeMock();
    const { resetRuntime, get } = loadUtils(chrome);
    const cfg = {
      control: { log: 0 },
      runtime: { done: 9, total: 10, failed: 2, mobile: 1, act: 1 },
    };
    const ok = await resetRuntime(cfg);
    expect(ok).toBe(true);
    const loaded = await get();
    expect(loaded.runtime).toMatchObject({
      done: 0,
      total: 0,
      failed: 0,
      mobile: 0,
      act: 0,
    });
  });

  test("concurrent set() calls serialize (last write wins, no lost lock)", async () => {
    const chrome = makeChromeMock();
    const { set, get } = loadUtils(chrome);
    await Promise.all([
      set({ control: {}, runtime: { done: 1 } }),
      set({ control: {}, runtime: { done: 2 } }),
      set({ control: {}, runtime: { done: 3 } }),
    ]);
    // Whatever the order, the lock is released and a valid config remains.
    expect(chrome._store._configWriteLock).toBeUndefined();
    const loaded = await get();
    expect([1, 2, 3]).toContain(loaded.runtime.done);
  });

  test("uses the browser Web Lock across extension contexts when available", async () => {
    const chrome = makeChromeMock();
    const locks = {
      request: jest.fn(async (_name, _options, callback) => callback()),
    };
    const { set } = loadUtils(chrome, { locks });

    await set({ control: {}, runtime: { done: 1 } });

    expect(locks.request).toHaveBeenCalledWith(
      "_configWriteLock",
      { mode: "exclusive" },
      expect.any(Function),
    );
    expect(chrome._store._configWriteLock).toBeUndefined();
  });
});
