const {loadEsmModule} = require('./esm-loader');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/**
 * @param {boolean=} withAbort Whether the environment supports AbortController.
 * @return {!Object} Production query-source exports with fake-time globals.
 */
function load(withAbort = true) {
  return loadEsmModule('../js/query-sources.js', {
    URL,
    setTimeout,
    clearTimeout,
    AbortController: withAbort ? AbortController : undefined,
  });
}

test.each(['fetchSuggestions', 'fetchGoogleTrends', 'fetchWikipediaTrending'])(
    '%s bounds uncooperative fetch and body reads', async (method) => {
      for (const phase of ['fetch', 'body']) {
        const api = load();
        /**
         * Stands in for a fetch or body read that never settles.
         * @return {!Promise<undefined>} Unsettled operation.
         */
        const hang = () => new Promise(() => {});
        const fetchImpl = jest.fn(phase === 'fetch' ? hang : async () => ({
                                                               ok: true,
                                                               json: hang,
                                                               text: hang,
                                                             }));
        const options = {fetchImpl, timeoutMs: 500};
        const pending = method === 'fetchSuggestions' ?
            api[method]('topic', options) :
            api[method](options);
        let finished = false;
        pending.then(() => {
          finished = true;
        });
        await jest.advanceTimersByTimeAsync(499);
        expect(finished).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(await pending).toEqual([]);
        expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
      }
    });

test('deadline does not depend on AbortController support', async () => {
  const api = load(false);
  const fetchImpl = jest.fn(() => new Promise(() => {}));
  const pending = api.fetchSuggestions('topic', {fetchImpl, timeoutMs: 500});
  await jest.advanceTimersByTimeAsync(500);
  expect(await pending).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});

test('late body failure after a deadline is observed', async () => {
  const api = load();
  let failBody;
  const body = new Promise((resolve, reject) => {
    failBody = reject;
  });
  const pending = api.fetchSuggestions('topic', {
    timeoutMs: 500,
    /**
     * Returns a response whose body read never settles.
     * @return {!Promise<!{ok: boolean, json: function(): !Promise<undefined>}>}
     *     Successful response with an unsettled body.
     */
    fetchImpl: async () => ({
      ok: true,
      /**
       * Never resolves the response body.
       * @return {!Promise<undefined>} Unsettled body.
       */
      json: () => body,
    }),
  });
  await jest.advanceTimersByTimeAsync(500);
  expect(await pending).toEqual([]);
  failBody(new Error('late body failure'));
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['success', 'http-error', 'read-error'])(
    'fetch cleanup runs on %s without waiting for the deadline',
    async (outcome) => {
      const api = load();
      const fetchImpl =
          jest.fn(async () => ({
                    ok: outcome !== 'http-error',
                    /**
                     * Reads a suggest payload or fails the body.
                     * @return {!Promise<!Array<(string|!Array<string>)>>}
                     *     OpenSearch body.
                     */
                    json: async () => {
                      if (outcome === 'read-error') {
                        throw new Error('invalid JSON');
                      }
                      return ['topic', ['topic result']];
                    },
                  }));
      const result =
          await api.fetchSuggestions('topic', {fetchImpl, timeoutMs: 500});
      expect(result).toEqual(outcome === 'success' ? ['topic result'] : []);
      expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });
