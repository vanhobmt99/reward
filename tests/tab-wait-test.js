const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('acorn');
const {loadEsmModule} = require('./esm-loader');

// Exercise the service's actual wrappers, including their cancellation and
// stale-document predicates, without starting the extension background worker.
const service =
    fs.readFileSync(path.join(__dirname, '../js/service.js'), 'utf8');
const wrappers =
    parse(service, {ecmaVersion: 2022, sourceType: 'module'})
        .body
        .filter(
            (node) => node.type === 'FunctionDeclaration' &&
                ['wait', 'waitForUrl', 'startSearchKeepalive'].includes(
                    node.id.name))
        .map((node) => service.slice(node.start, node.end))
        .join('\n');

/**
 * @return {{listeners: !Set<Function>, addListener: Function,
 *     removeListener: Function, emit: Function}} Browser event mock.
 */
function eventSource() {
  const listeners = new Set();
  return {
    listeners,
    /**
     * Registers a browser event listener.
     * @param {!Function} listener Listener invoked with the event arguments.
     * @return {!Set<!Function>} Listeners after registration.
     */
    addListener: (listener) => listeners.add(listener),
    /**
     * Drops a previously registered listener.
     * @param {!Function} listener Listener to remove.
     * @return {boolean} Whether the listener was registered.
     */
    removeListener: (listener) => listeners.delete(listener),
    /**
     * Delivers an event to every current listener.
     * @param {!Array<(number|!Object)>} args Event arguments.
     * @return {undefined} Listeners are invoked for their side effects.
     */
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
  };
}

/** @return {!Object} Real helper and wrappers with isolated browser state. */
function setup() {
  const {waitForTab} = loadEsmModule('../js/tab-wait.js', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const tabs = {
    sendMessage: jest.fn().mockResolvedValue({ok: true}),
    get: jest.fn().mockResolvedValue(
        {url: 'https://old.test', status: 'loading'}),
    onUpdated: eventSource(),
    onRemoved: eventSource(),
  };
  const state = {running: 1, generation: 1};
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    chrome: {tabs},
    waitForTab,
    config: {runtime: state},
    /**
     * Returns the generation used to ignore stale waits.
     * @return {number} Current run generation.
     */
    getRunGeneration: () => state.generation,
    logs: false,
    longestDelay: 1000,
  });
  vm.runInContext(wrappers, context);
  return {
    tabs,
    state,
    waitForTab,
    wait: context.wait,
    waitForUrl: context.waitForUrl,
    startSearchKeepalive: context.startSearchKeepalive,
  };
}

/** @param {!Object} tabs API mock whose resources must have been released. */
function expectClean(tabs) {
  expect(tabs.onUpdated.listeners.size).toBe(0);
  expect(tabs.onRemoved.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['load', 'url'])(
    '%s wait completes from the initial browser snapshot', async (kind) => {
      const api = setup();
      api.tabs.get.mockResolvedValue(
          {url: 'https://new.test', status: 'complete'});
      const result = kind === 'load' ?
          await api.wait(7) :
          await api.waitForUrl(7, (url) => url === 'https://new.test');
      expect(kind === 'load' ? result : result.success).toBe(true);
      expectClean(api.tabs);
    });

test('load wait ignores the old document and unrelated tabs', async () => {
  const api = setup();
  api.tabs.get.mockResolvedValue({url: 'https://old.test', status: 'complete'});
  let finished = false;
  const pending =
      api.wait(7, true, {awayFrom: 'https://old.test'}).then((value) => {
        finished = true;
        return value;
      });
  await jest.advanceTimersByTimeAsync(0);
  api.tabs.onUpdated.emit(8, {status: 'complete'}, {url: 'https://other.test'});
  api.tabs.onUpdated.emit(7, {status: 'complete'}, {url: 'https://old.test'});
  api.tabs.onUpdated.emit(7, {status: 'complete'}, {});
  await jest.advanceTimersByTimeAsync(0);
  expect(finished).toBe(false);
  api.tabs.onUpdated.emit(
      7, {status: 'complete'}, {url: 'https://redirect.test'});
  expect(await pending).toBe(true);
  expectClean(api.tabs);
});

test.each(['load', 'url'])(
    '%s deadline completes even when tabs.get never resolves', async (kind) => {
      const api = setup();
      api.tabs.get.mockReturnValue(new Promise(() => {}));
      const pending =
          kind === 'load' ? api.wait(7) : api.waitForUrl(7, () => false, 1000);
      await jest.advanceTimersByTimeAsync(1000);
      const result = await pending;
      expect(kind === 'load' ? result : result.success).toBe(false);
      expect(api.tabs.get).toHaveBeenCalledTimes(1);
      expectClean(api.tabs);
    });

test.each(['stop', 'replacement', 'close', 'read-error'])(
    'wait releases resources on %s', async (outcome) => {
      const api = setup();
      if (outcome === 'read-error') {
        api.tabs.get.mockRejectedValue(new Error('tab missing'));
      }
      const pending = api.waitForUrl(7, () => false);
      await jest.advanceTimersByTimeAsync(0);
      if (outcome === 'stop') {
        api.state.running = 0;
      } else if (outcome === 'replacement') {
        api.state.generation++;
      } else if (outcome === 'close') {
        api.tabs.onRemoved.emit(8);
        expect(api.tabs.onUpdated.listeners.size).toBe(1);
        api.tabs.onRemoved.emit(7);
      }
      await jest.advanceTimersByTimeAsync(100);
      expect((await pending).success).toBe(false);
      expectClean(api.tabs);
    });

test('an update cannot succeed after its run was replaced', async () => {
  const api = setup();
  const pending = api.wait(7);
  await jest.advanceTimersByTimeAsync(0);
  api.state.generation++;
  api.tabs.onUpdated.emit(7, {status: 'complete'}, {url: 'https://new.test'});
  expect(await pending).toBe(false);
  expectClean(api.tabs);
});

test(
    'non-interruptible waits can complete while the run is stopped',
    async () => {
      const api = setup();
      api.state.running = 0;
      const pending =
          api.waitForUrl(7, (url) => url === 'https://new.test', 1000, false);
      await jest.advanceTimersByTimeAsync(100);
      // Only the deadline remains; an uninterruptible wait needs no polling.
      expect(jest.getTimerCount()).toBe(1);
      api.tabs.onUpdated.emit(7, {url: 'https://new.test'}, {});
      expect(await pending).toEqual({success: true, url: 'https://new.test'});
      expectClean(api.tabs);
    });

test(
    'a late initial read cannot match a document replaced by an update',
    async () => {
      const api = setup();
      let releaseRead;
      api.tabs.get.mockReturnValue(new Promise((resolve) => {
        releaseRead = resolve;
      }));
      const pending = api.wait(7);
      await jest.advanceTimersByTimeAsync(0);
      api.tabs.onUpdated.emit(
          7, {status: 'loading'}, {url: 'https://new.test'});
      releaseRead({status: 'complete', url: 'https://old.test'});
      await jest.advanceTimersByTimeAsync(0);
      expect(api.tabs.onUpdated.listeners.size).toBe(1);
      api.tabs.onUpdated.emit(
          7, {status: 'complete'}, {url: 'https://new.test'});
      expect(await pending).toBe(true);
      expectClean(api.tabs);
    });

test(
    'predicate errors clean up instead of escaping the update listener',
    async () => {
      const api = setup();
      const pending = api.waitForTab(7, {
        tabs: api.tabs,
        timeoutMs: 1000,
        matches: () => {
          throw new Error('predicate failed');
        },
      });
      expect((await pending).reason).toBe('error');
      expectClean(api.tabs);
    });

test(
    'late API rejection after timeout is handled without changing the result',
    async () => {
      const api = setup();
      let failRead;
      api.tabs.get.mockReturnValue(new Promise((resolve, reject) => {
        failRead = reject;
      }));
      const pending = api.waitForTab(7, {
        tabs: api.tabs,
        timeoutMs: 1000,
        /**
         * Accepts the current tab snapshot.
         * @return {boolean} Always matches in this timeout test.
         */
        matches: () => true,
      });
      await jest.advanceTimersByTimeAsync(1000);
      expect(await pending)
          .toEqual({success: false, url: '', reason: 'timeout'});
      failRead(new Error('late failure'));
      await jest.advanceTimersByTimeAsync(0);
      expectClean(api.tabs);
    });

test(
    'cancelling a heartbeat clears its scheduled tick immediately',
    async () => {
      const api = setup();
      const cancel = api.startSearchKeepalive(7);
      await jest.advanceTimersByTimeAsync(0);
      expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
      cancel();
      cancel();
      expectClean(api.tabs);
      await jest.advanceTimersByTimeAsync(3000);
      expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

test.each(['cancel', 'replacement', 'stop'])(
    'a pending ping cannot reschedule after %s', async (action) => {
      const api = setup();
      let completePing;
      api.tabs.sendMessage.mockReturnValue(new Promise((resolve) => {
        completePing = resolve;
      }));
      const cancel = api.startSearchKeepalive(7);
      await jest.advanceTimersByTimeAsync(3000);
      expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
      if (action === 'cancel') {
        cancel();
      } else if (action === 'replacement') {
        api.state.generation++;
      } else {
        api.state.running = 0;
      }
      completePing({ok: true});
      await jest.advanceTimersByTimeAsync(0);
      expectClean(api.tabs);
    });

test('heartbeat stops after three consecutive failures', async () => {
  const api = setup();
  api.tabs.sendMessage.mockRejectedValue(new Error('unreachable'));
  api.startSearchKeepalive(7);
  await jest.advanceTimersByTimeAsync(3000);
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(3);
  expectClean(api.tabs);
});

test(
    'already-cancelled wait does not read the browser or attach listeners',
    async () => {
      const api = setup();
      api.state.running = 0;
      expect(await api.wait(7)).toBe(false);
      expect(api.tabs.get).not.toHaveBeenCalled();
      expectClean(api.tabs);
    });

test(
    'failed listener setup removes the listener already attached', async () => {
      const api = setup();
      api.tabs.onRemoved.addListener = () => {
        throw new Error('API unavailable');
      };
      expect(await api.wait(7)).toBe(false);
      expect(api.tabs.get).not.toHaveBeenCalled();
      expectClean(api.tabs);
    });
