const {loadEsmModule} = require('./esm-loader.js');

// Copies prevent shared references from hiding lost updates between contexts.
/**
 * Builds an in-memory chrome.storage.local mock.
 * @return {!{store: !Object, runtime: !Object, storage: !Object}} Mock chrome.
 */
function makeChromeMock() {
  const store = {};
  return {
    store,
    runtime: {lastError: null},
    storage: {
      local: {
        set: jest.fn((data, callback) => {
          Object.assign(store, structuredClone(data));
          callback();
        }),
        get: jest.fn((key, callback) => {
          callback(structuredClone({[key]: store[key]}));
        }),
      },
    },
  };
}

// Only exclusive FIFO requests and acquisition abort are modelled here.
// Browser tests separately verify the native lock shared by extension pages.
/**
 * Builds a single-waiter exclusive lock that can abort.
 * @return {!{request: !Function}} Subset of navigator.locks.
 */
function makeLocks() {
  let tail = Promise.resolve();
  return {
    request: jest.fn((name, {signal}, callback) => {
      return new Promise((resolve, reject) => {
        /**
         * Rejects this lock request when the caller aborts.
         * @return {undefined} Rejection has no fulfillment value.
         */
        const abort = () => reject(signal.reason);
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, {once: true});
        tail = tail.then(async () => {
          if (signal.aborted) {
            return;
          }
          signal.removeEventListener('abort', abort);
          try {
            resolve(await callback({name}));
          } catch (error) {
            reject(error);
          }
        });
      });
    }),
  };
}

/**
 * Loads storage helpers against one chrome mock and lock implementation.
 * @param {!Object} chrome Mock chrome with storage.local.
 * @param {!Object=} locks navigator.locks stand-in.
 * @return {!Object} Production storage helpers.
 */
function loadUtils(chrome, locks = makeLocks()) {
  return loadEsmModule('../js/utils.js', {
    chrome,
    navigator: {locks},
    setTimeout,
    clearTimeout,
    AbortController,
    structuredClone,
  });
}

afterEach(() => jest.useRealTimers());

test.each(['invalid', [], 5, new Date()])(
    'an invalid stored root %p is absent to readers and updaters',
    async (value) => {
      const chrome = makeChromeMock();
      chrome.store.config = value;
      const {get, atomicUpdate} = loadUtils(chrome);
      expect(await get()).toBeNull();
      const update = jest.fn((current) => ({...current, runtime: {done: 1}}));
      await atomicUpdate(update);
      expect(update).toHaveBeenCalledWith({});
      expect(await get()).toEqual({runtime: {done: 1}});
    });

test(
    'runtime snapshots preserve newer settings and unrelated stored fields',
    async () => {
      const chrome = makeChromeMock();
      const locks = makeLocks();
      const background = loadUtils(chrome, locks);
      const options = loadUtils(chrome, locks);
      const stale = {search: {desk: 31}, control: {log: 0}, runtime: {done: 1}};
      chrome.store.config = structuredClone(stale);
      await options.atomicUpdate((config) => ({
                                   ...config,
                                   search: {desk: 77},
                                   control: {log: 0, niche: 'science'},
                                   futureSetting: {enabled: true},
                                 }));
      stale.runtime.done = 2;
      await background.updateConfigSections({runtime: stale.runtime});
      expect(await options.get()).toEqual({
        search: {desk: 77},
        control: {log: 0, niche: 'science'},
        runtime: {done: 2},
        futureSetting: {enabled: true},
      });
    });

test(
    'concurrent section edits preserve both settings and runtime', async () => {
      const chrome = makeChromeMock();
      const locks = makeLocks();
      const first = loadUtils(chrome, locks);
      const second = loadUtils(chrome, locks);
      await Promise.all([
        first.updateConfigSections({runtime: {done: 5}}),
        second.updateConfigSections({schedule: {desk: 77, mode: 'm5'}}),
      ]);
      expect(await first.get()).toEqual({
        runtime: {done: 5},
        schedule: {desk: 77, mode: 'm5'},
      });
    });

test(
    'unchanged edits skip writes but in-place mutations still persist',
    async () => {
      const chrome = makeChromeMock();
      const {atomicUpdate, get} = loadUtils(chrome);
      chrome.store.config = {runtime: {done: 5}};
      await atomicUpdate((config) => config);
      await atomicUpdate((config) => ({...config}));
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      await atomicUpdate((config) => {
        config.runtime.done++;
        return config;
      });
      expect((await get()).runtime.done).toBe(6);
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    });

test(
    'runtime reset preserves settings saved after the caller took its snapshot',
    async () => {
      const chrome = makeChromeMock();
      const {resetRuntime, get} = loadUtils(chrome);
      chrome.store.config = {search: {desk: 77}, runtime: {done: 3}};
      expect(await resetRuntime({search: {desk: 31}, runtime: {done: 3}}))
          .toBe(true);
      expect((await get()).search.desk).toBe(77);
      expect((await get()).runtime.done).toBe(0);
    });

test.each([null, undefined, 'runtime', [], 0])(
    'invalid section map %j never reaches storage', async (sections) => {
      const chrome = makeChromeMock();
      const {updateConfigSections} = loadUtils(chrome);
      await expect(updateConfigSections(sections))
          .rejects.toThrow('must be an object');
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

test(
    'section writes and reads round-trip independent copies through storage',
    async () => {
      const chrome = makeChromeMock();
      const {updateConfigSections, get} = loadUtils(chrome);
      const config = {control: {log: 0}, runtime: {done: 3}};
      await updateConfigSections(config);
      const loaded = await get();
      expect(loaded).toEqual(config);
      loaded.runtime.done = 99;
      expect((await get()).runtime.done).toBe(3);
    });

test('get returns null when nothing is stored', async () => {
  expect(await loadUtils(makeChromeMock()).get()).toBeNull();
});

test(
    'a section write captures the config before waiting for its lock',
    async () => {
      const chrome = makeChromeMock();
      const {updateConfigSections} = loadUtils(chrome);
      const config = {runtime: {done: 3}};
      const pending = updateConfigSections(config);
      config.runtime.done = 4;
      await pending;
      expect(chrome.store.config.runtime.done).toBe(3);
    });

test(
    'concurrent section replacements finish with the last queued snapshot',
    async () => {
      const chrome = makeChromeMock();
      const {updateConfigSections} = loadUtils(chrome);
      await Promise.all(
          [1, 2, 3].map((done) => updateConfigSections({runtime: {done}})));
      expect(chrome.store.config.runtime.done).toBe(3);
      expect(Object.keys(chrome.store)).toEqual(['config']);
    });

test(
    'two module contexts preserve every asynchronous atomic edit', async () => {
      const chrome = makeChromeMock();
      const locks = makeLocks();
      const first = loadUtils(chrome, locks);
      const second = loadUtils(chrome, locks);
      await first.updateConfigSections({count: 0, untouched: 'saved'});
      /**
       * Increments the shared counter after yielding once.
       * @param {!{count: number, untouched: string}} config Stored snapshot.
       * @return {!Promise<!{count: number, untouched: string}>} Next snapshot.
       */
      const edit = async (config) => {
        await Promise.resolve();
        return {...config, count: config.count + 1};
      };
      await Promise.all(Array
                            .from(
                                {length: 20},
                                () =>
                                    [first.atomicUpdate(edit),
                                     second.atomicUpdate(edit),
      ]).flat());
      expect(await second.get()).toEqual({count: 40, untouched: 'saved'});
      expect(locks.request)
          .toHaveBeenCalledWith(
              '_configWriteLock', {
                mode: 'exclusive',
                signal: expect.any(AbortSignal),
              },
              expect.any(Function));
    });

test(
    'failed updater leaves storage intact and releases the next writer',
    async () => {
      const chrome = makeChromeMock();
      const {updateConfigSections, atomicUpdate, get} = loadUtils(chrome);
      await updateConfigSections({count: 1});
      await expect(atomicUpdate(async (config) => {
        config.count = 99;
        throw new Error('Edit failed');
      })).rejects.toThrow('Edit failed');
      expect(await get()).toEqual({count: 1});
      await atomicUpdate((config) => ({count: config.count + 1}));
      expect(await get()).toEqual({count: 2});
    });

test.each([undefined, null, false, 1, 'config', []])(
    'invalid updater result %j never replaces the config', async (value) => {
      const chrome = makeChromeMock();
      const {updateConfigSections, atomicUpdate, get} = loadUtils(chrome);
      await updateConfigSections({count: 1});
      await expect(atomicUpdate(() => value))
          .rejects.toThrow('must return an object');
      expect(await get()).toEqual({count: 1});
    });

test.each(['get', 'set'])(
    'storage %s errors reject and allow subsequent writes', async (method) => {
      const chrome = makeChromeMock();
      const {updateConfigSections, atomicUpdate, get} = loadUtils(chrome);
      await updateConfigSections({count: 1});
      chrome.storage.local[method].mockImplementationOnce((value, callback) => {
        chrome.runtime.lastError = {message: 'Storage failed'};
        callback();
        chrome.runtime.lastError = null;
      });
      await expect(atomicUpdate(() => ({count: 2}))).rejects.toMatchObject({
        message: 'Storage failed',
      });
      expect(await get()).toEqual({count: 1});
      await updateConfigSections({count: 3});
      expect(await get()).toEqual({count: 3});
    });

test('missing Web Locks rejects before any storage access', async () => {
  const chrome = makeChromeMock();
  const {updateConfigSections, atomicUpdate} = loadUtils(chrome, null);
  await expect(updateConfigSections({
    count: 1,
  })).rejects.toThrow('require Web Locks');
  await expect(atomicUpdate(() => ({}))).rejects.toThrow('require Web Locks');
  expect(chrome.storage.local.get).not.toHaveBeenCalled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

test(
    'an expired queued write never runs later or releases the active write',
    async () => {
      jest.useFakeTimers();
      const chrome = makeChromeMock();
      const locks = makeLocks();
      const first = loadUtils(chrome, locks);
      const second = loadUtils(chrome, locks);
      let finishStorage;
      chrome.storage.local.set.mockImplementationOnce((data, callback) => {
        finishStorage = () => {
          Object.assign(chrome.store, structuredClone(data));
          callback();
        };
      });
      const active = first.updateConfigSections({count: 1});
      await jest.advanceTimersByTimeAsync(0);
      expect(finishStorage).toEqual(expect.any(Function));
      expect(jest.getTimerCount()).toBe(0);
      const expired = expect(second.updateConfigSections({
                        count: 99,
                      })).rejects.toThrow('Could not acquire');
      await jest.advanceTimersByTimeAsync(30000);
      await expired;
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
      expect(chrome.store.config).toBeUndefined();
      finishStorage();
      await active;
      await second.atomicUpdate((config) => ({count: config.count + 1}));
      expect(chrome.store.config).toEqual({count: 2});
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    });

test('a synchronous lock API error leaves no acquisition timer', async () => {
  jest.useFakeTimers();
  const chrome = makeChromeMock();
  const {updateConfigSections} = loadUtils(chrome, {
    request() {
      throw new Error('Unavailable');
    },
  });
  await expect(updateConfigSections({})).rejects.toThrow('Unavailable');
  expect(jest.getTimerCount()).toBe(0);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

test('resetRuntime zeroes runtime counters and persists', async () => {
  const chrome = makeChromeMock();
  const {resetRuntime, get} = loadUtils(chrome);
  const config = {
    control: {log: 0},
    runtime: {done: 9, total: 10, failed: 2, mobile: 1, act: 1},
  };
  expect(await resetRuntime(config)).toBe(true);
  expect((await get()).runtime).toEqual({
    done: 0,
    total: 0,
    failed: 0,
    mobile: 0,
    act: 0,
  });
});
