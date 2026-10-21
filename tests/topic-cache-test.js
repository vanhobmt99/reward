const {loadEsmModule} = require('./esm-loader');
const EN = {
  languageCode: 'en',
  regionCode: 'US',
};
const VI = {
  languageCode: 'vi',
  regionCode: 'VN',
};
const DE = {
  languageCode: 'de',
  regionCode: 'DE',
};

/** @return {!Object} Controllable asynchronous operation. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

/**
 * @param {!Object=} overrides Explicit dependency overrides.
 * @return {!Object} Cache, dependency spies and controlled clock.
 */
function setup(overrides = {}) {
  const clock = {now: 1000};
  const deps = {
    read: jest.fn().mockResolvedValue(null),
    write: jest.fn().mockResolvedValue(),
    fetchTopics: jest.fn().mockResolvedValue(['Fresh topic']),
    onRefresh: jest.fn(),
    /**
     * Returns the controlled clock time.
     * @return {number} Milliseconds on the fixture clock.
     */
    now: () => clock.now,
    ...overrides,
  };
  const {createTopicCache} =
      loadEsmModule('../js/topic-cache.js', {setTimeout, clearTimeout});
  return {cache: createTopicCache(deps), deps, clock};
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test(
    'same-locale callers share in-flight work and reuse fresh memory',
    async () => {
      const {cache, deps} = setup();
      const first = cache.prefetch(EN);
      expect(cache.prefetch({...EN})).toBe(first);
      expect(await first).toEqual(['Fresh topic']);
      expect(await cache.prefetch(EN)).toEqual(['Fresh topic']);
      expect(deps.read).toHaveBeenCalledTimes(1);
      expect(deps.fetchTopics).toHaveBeenCalledTimes(1);
      expect(deps.onRefresh).toHaveBeenCalledTimes(1);
    });

test(
    'fresh persisted topics bypass the network and keep their original age',
    async () => {
      const {cache, deps, clock} = setup({
        read: jest.fn().mockResolvedValue({
          ...EN,
          savedAt: 0,
          topics: ['Cached topic'],
        }),
      });
      expect(await cache.prefetch(EN)).toEqual(['Cached topic']);
      expect(deps.fetchTopics).not.toHaveBeenCalled();
      clock.now = 6 * 60 * 60 * 1000 + 1;
      expect(await cache.prefetch(EN)).toEqual(['Fresh topic']);
      expect(deps.fetchTopics).toHaveBeenCalledTimes(1);
    });

test(
    'empty results back off for five minutes without blocking later retry',
    async () => {
      const {cache, deps, clock} =
          setup({fetchTopics: jest.fn().mockResolvedValue([])});
      await cache.prefetch(EN);
      clock.now += 299999;
      await cache.prefetch(EN);
      expect(deps.fetchTopics).toHaveBeenCalledTimes(1);
      clock.now += 2;
      await cache.prefetch(EN);
      expect(deps.fetchTopics).toHaveBeenCalledTimes(2);
    });

test('late A→B→A responses cannot replace the latest A request', async () => {
  const pending = [deferred(), deferred(), deferred()];
  let next = 0;
  const {cache, deps} =
      setup({fetchTopics: jest.fn(() => pending[next++].promise)});
  const first = cache.prefetch(EN);
  await jest.advanceTimersByTimeAsync(0);
  const second = cache.prefetch(VI);
  await jest.advanceTimersByTimeAsync(0);
  const third = cache.prefetch(EN);
  await jest.advanceTimersByTimeAsync(0);
  pending[2].resolve(['Latest topic']);
  expect(await third).toEqual(['Latest topic']);
  pending[0].resolve(['Stale English topic']);
  pending[1].resolve(['Stale Vietnamese topic']);
  expect(await first).toEqual([]);
  expect(await second).toEqual([]);
  expect(cache.peek()).toEqual(['Latest topic']);
  expect(deps.write).toHaveBeenCalledTimes(1);
  expect(deps.write.mock.calls[0][0].topics).toEqual(['Latest topic']);
});

test(
    'a superseded storage read cannot start another network fetch',
    async () => {
      const read = deferred();
      const {cache, deps} = setup({
        read:
            jest.fn().mockReturnValueOnce(read.promise).mockResolvedValue(null),
      });
      const first = cache.prefetch(EN);
      await jest.advanceTimersByTimeAsync(0);
      expect(await cache.prefetch(VI)).toEqual(['Fresh topic']);
      read.resolve(null);
      expect(await first).toEqual([]);
      expect(deps.fetchTopics).toHaveBeenCalledTimes(1);
    });

test.each(['storage', 'network'])(
    'a hanging %s operation has a bounded wait', async (phase) => {
      /**
       * Stands in for storage or network work that never settles.
       * @return {!Promise<undefined>} Unsettled operation.
       */
      const hang = () => new Promise(() => {});
      const {cache} =
          setup(phase === 'storage' ? {read: hang} : {fetchTopics: hang});
      const pending = cache.prefetch(EN);
      await jest.advanceTimersByTimeAsync(phase === 'storage' ? 1500 : 6000);
      expect(await pending).toEqual(phase === 'storage' ? ['Fresh topic'] : []);
    });

test(
    'slow persistence does not block topics and serializes later writes',
    async () => {
      const firstWrite = deferred();
      const write =
          jest.fn().mockReturnValueOnce(firstWrite.promise).mockResolvedValue();
      const {cache} = setup({write});
      expect(await cache.prefetch(EN)).toEqual(['Fresh topic']);
      expect(write).toHaveBeenCalledTimes(1);
      expect(await cache.prefetch(VI)).toEqual(['Fresh topic']);
      expect(await cache.prefetch(DE)).toEqual(['Fresh topic']);
      expect(write).toHaveBeenCalledTimes(1);
      firstWrite.resolve();
      await jest.advanceTimersByTimeAsync(0);
      expect(write.mock.calls.map(([record]) => record.languageCode)).toEqual([
        'en',
        'de',
      ]);
    });

test(
    'observer and persistence errors do not discard usable memory',
    async () => {
      const {cache} = setup({
        onRefresh: () => {
          throw new Error('observer');
        },
        log: () => {
          throw new Error('logger');
        },
        write: jest.fn().mockRejectedValue(new Error('quota')),
      });
      expect(await cache.prefetch(EN)).toEqual(['Fresh topic']);
      await jest.advanceTimersByTimeAsync(0);
      expect(cache.peek()).toEqual(['Fresh topic']);
    });

test('consumer mutations cannot alter the stored memory array', async () => {
  const {cache} = setup();
  (await cache.prefetch(EN)).push('Injected topic');
  cache.peek().pop();
  expect(cache.peek()).toEqual(['Fresh topic']);
  expect(await cache.prefetch(EN)).toEqual(['Fresh topic']);
});
