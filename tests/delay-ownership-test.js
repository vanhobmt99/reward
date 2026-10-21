const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('acorn');

// Exercise the real service delay, including generation ownership and timer
// cleanup, without starting the extension background worker.
const service =
    fs.readFileSync(path.join(__dirname, '../js/service.js'), 'utf8');
const helperNodes =
    parse(service, {ecmaVersion: 2022, sourceType: 'module'})
        .body.filter((node) => node.type === 'FunctionDeclaration' && [
          'bumpRunGeneration',
          'getRunGeneration',
          'delay',
        ].includes(node.id.name));
if (helperNodes.length !== 3) {
  throw new Error('delay ownership helpers were not found in service.js');
}
const helpers =
    helperNodes.map((node) => service.slice(node.start, node.end)).join('\n');

// delay() polls a stopped run on this interval.
const STOP_POLL_MS = 100;

/**
 * Evaluates the real delay helpers against an isolated run.
 * @param {!Object} runtime Mutable runtime flags read by delay.
 * @return {!{
 *   delay: function(number, boolean=): !Promise<(boolean|undefined)>,
 *   bumpRunGeneration: function(): number,
 *   getRunGeneration: function(): number
 * }} Helpers closed over logs, log, config, and each other.
 */
function loadDelay(runtime) {
  const context = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    logs: false,
    log: jest.fn(),
    config: {runtime},
    runGeneration: 0,
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return {
    delay: context.delay,
    bumpRunGeneration: context.bumpRunGeneration,
    getRunGeneration: context.getRunGeneration,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test(
    'interruptible delay ends early for its own stopped generation',
    async () => {
      const runtime = {running: 1};
      const waitMs = 5000;
      const {delay, getRunGeneration} = loadDelay(runtime);
      const generation = getRunGeneration();
      let resolves = 0;
      const pending = delay(waitMs).then((value) => {
        resolves += 1;
        return value;
      });
      expect(jest.getTimerCount()).toBe(2);
      runtime.running = 0;
      await jest.advanceTimersByTimeAsync(STOP_POLL_MS);
      expect(getRunGeneration()).toBe(generation);
      expect(resolves).toBe(1);
      await expect(pending).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(waitMs * 10);
      expect(resolves).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    });

test(
    'a newer generation does not end an interruptible delay before its timeout',
    async () => {
      const runtime = {running: 1};
      const waitMs = 500;
      const {delay, bumpRunGeneration, getRunGeneration} = loadDelay(runtime);
      const generation = getRunGeneration();
      let resolves = 0;
      const pending = delay(waitMs).then((value) => {
        resolves += 1;
        return value;
      });
      expect(bumpRunGeneration()).toBe(generation + 1);
      await jest.advanceTimersByTimeAsync(STOP_POLL_MS);
      expect(resolves).toBe(0);
      // A stopped run still must not cancel a delay owned by another
      // generation.
      runtime.running = 0;
      await jest.advanceTimersByTimeAsync(waitMs - (STOP_POLL_MS * 2));
      expect(resolves).toBe(0);
      expect(jest.getTimerCount()).toBe(2);
      await jest.advanceTimersByTimeAsync(STOP_POLL_MS);
      expect(resolves).toBe(1);
      await expect(pending).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(waitMs * 10);
      expect(resolves).toBe(1);
    });

test(
    'non-interruptible delay waits the full duration while the run is stopped',
    async () => {
      const runtime = {running: 0};
      const waitMs = 500;
      const {delay} = loadDelay(runtime);
      let resolves = 0;
      const pending = delay(waitMs, false).then((value) => {
        resolves += 1;
        return value;
      });
      expect(resolves).toBe(0);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(waitMs - 1);
      expect(resolves).toBe(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(resolves).toBe(1);
      await expect(pending).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

test(
    'interruptible delay returns false without waiting when already stopped',
    async () => {
      const runtime = {running: 0};
      const waitMs = 5000;
      const {delay, getRunGeneration} = loadDelay(runtime);
      expect(getRunGeneration()).toBe(0);
      let resolves = 0;
      const pending = delay(waitMs).then((value) => {
        resolves += 1;
        return value;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(resolves).toBe(1);
      await expect(pending).resolves.toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(waitMs * 10);
      expect(resolves).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    });
