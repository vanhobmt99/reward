const {loadEsmModule} = require('./esm-loader');
const {webcrypto} = require('node:crypto');
const {TextEncoder} = require('node:util');

/**
 * Loads telemetry with storage, fetch and lock doubles.
 * @param {!Object=} overrides Globals that replace the default browser context.
 * @param {!Object=} storage Mutable chrome.storage.local snapshot.
 * @return {!{
 *   api: !Object,
 *   local: !Object,
 *   fetch: function(),
 *   request: function(),
 *   storage: !Object
 * }} Module exports and the doubles the test asserts on.
 */
function setup(overrides = {}, storage = {}) {
  const local = {
    get: jest.fn(async () => ({...storage})),
    set: jest.fn(async (values) => Object.assign(storage, values)),
  };
  const fetch = jest.fn().mockResolvedValue({ok: true});
  const request = jest.fn(async (name, options, work) => work({}));
  const context = {
    URL,
    setTimeout,
    clearTimeout,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    chrome: {storage: {local}},
    navigator: {locks: {request}},
    fetch,
    ...overrides,
  };
  const api = loadEsmModule('../js/telemetry.js', context);
  return {api, local, fetch, request, storage};
}

afterEach(() => jest.useRealTimers());

test('hash and report reuse one language and timezone reading', async () => {
  const language =
      jest.fn().mockReturnValueOnce('vi-VN').mockReturnValue('en-US');
  const DateTimeFormat = jest.fn(
      () => ({
        /** @return {!{timeZone: string}} Time zone read once per send. */
        resolvedOptions: () => ({timeZone: 'Asia/Ho_Chi_Minh'}),
      }));
  const digest = jest.fn(async () => new ArrayBuffer(32));
  const {api, fetch} = setup({
    navigator: {
      /**
       * @return {string} Language tag from the one-shot spy.
       */
      get language() {
        return language();
      },
      locks: {
        /**
         * @param {string} name Lock name.
         * @param {!Object} options Lock options.
         * @param {function(!Object): !Promise<!Object>} work
         *     Callback given the granted lock.
         * @return {!Promise<!Object>} Result of the lock callback.
         */
        request: async (name, options, work) => work({}),
      },
    },
    Intl: {DateTimeFormat},
    crypto: {
      /** @return {string} Stable profile id for this test. */
      randomUUID: () => 'test-profile',
      subtle: {digest},
    },
  });
  expect(await api.sendTelemetryOnce('https://mock.invalid', {
    consent: true,
  })).toEqual({status: 'sent'});
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.device.language).toBe('vi-VN');
  expect(payload.device.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(Buffer.from(digest.mock.calls[0][1]).toString('utf8'))
      .toContain('Asia/Ho_Chi_Minh###vi-VN');
  expect(language).toHaveBeenCalledTimes(1);
  expect(DateTimeFormat).toHaveBeenCalledTimes(1);
});

test(
    'an endpoint alone never authorizes collection or transmission',
    async () => {
      const {api, local, fetch, request} = setup();
      expect(await api.sendTelemetryOnce('https://mock.invalid')).toEqual({
        status: 'consent-required',
      });
      expect(local.get).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

test.each([false, 'false', 'true', 1, {}, []])(
    'consent must be the boolean true, not %j', async (consent) => {
      const {api, local, fetch, request} = setup();
      expect(await api.sendTelemetryOnce('https://mock.invalid', {consent}))
          .toEqual({status: 'consent-required'});
      expect(local.get).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

test.each([
  'http://mock.invalid',
  'invalid',
  'https://u:p@mock.invalid',
  'https://your-worker-name.workers.dev',
])('rejects an unconfigured/insecure receiver: %s', async (endpoint) => {
  const {api, local, fetch} = setup();
  expect(await api.sendTelemetryOnce(endpoint, {consent: true})).toEqual({
    status: 'unconfigured',
  });
  expect(local.get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test(
    'overlapping sends share one collection and use one read per API',
    async () => {
      const cpu = jest.fn().mockResolvedValue(
          {modelName: 'CPU', archName: 'x86', numOfProcessors: 4});
      const {api, local, fetch} = setup();
      // A new module context shares the mocked storage but owns its hardware
      // API.
      const module = loadEsmModule('../js/telemetry.js', {
        URL,
        setTimeout,
        clearTimeout,
        TextEncoder,
        AbortController,
        crypto: webcrypto,
        fetch,
        chrome: {storage: {local}, system: {cpu: {getInfo: cpu}}},
        navigator: {
          locks: {
            /**
             * @param {string} name Lock name.
             * @param {!Object} options Lock options.
             * @param {function(!Object): !Promise<!Object>} work
             *     Callback given the granted lock.
             * @return {!Promise<!Object>} Result of the lock callback.
             */
            request: async (name, options, work) => work({}),
          },
        },
      });
      const results = await Promise.all([
        module.sendTelemetryOnce('https://mock.invalid', {consent: true}),
        module.sendTelemetryOnce('https://mock.invalid', {consent: true}),
      ]);
      expect(results).toEqual([{status: 'sent'}, {status: 'sent'}]);
      expect(cpu).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body).device.cpuModel)
          .toBe('CPU');
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'already-sent'});
      expect(fetch).toHaveBeenCalledTimes(1);
    });

test('a busy cross-page lock prevents collection', async () => {
  const {api, local, fetch} = setup({
    navigator: {
      locks: {
        /**
         * @param {string} name Lock name.
         * @param {!Object} options Lock options.
         * @param {function(?Object): !Promise<!Object>} work
         *     Callback given null when the lock is already held.
         * @return {!Promise<!Object>} Result of the lock callback.
         */
        request: async (name, options, work) => work(null),
      },
    },
  });
  expect(await api.sendTelemetryOnce('https://mock.invalid', {
    consent: true,
  })).toEqual({status: 'busy'});
  expect(local.get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test('absence of Web Locks does not start an uncoordinated send', async () => {
  const {api, local} = setup({navigator: {}});
  expect(await api.sendTelemetryOnce('https://mock.invalid', {
    consent: true,
  })).toEqual({status: 'unsupported'});
  expect(local.get).not.toHaveBeenCalled();
});

test(
    'a hung hardware API times out without losing other readings', async () => {
      jest.useFakeTimers();
      const {api} = setup({
        chrome: {
          system: {
            cpu: {
              /** @return {!Promise<undefined>} CPU read that never settles. */
              getInfo: () => new Promise(() => {}),
            },
            memory: {
              /**
               * @return {!Promise<!{
               *   capacity: number,
               *   availableCapacity: number
               * }>} Eight gibibytes installed and none available.
               */
              getInfo: async () =>
                  ({capacity: 8 * 1024 ** 3, availableCapacity: 0}),
            },
          },
        },
      });
      const report = api.getDeviceSpecs();
      await jest.advanceTimersByTimeAsync(1500);
      const result = await report;
      expect(result.dataQuality.cpu.status).toBe('error');
      expect(result.ramTotal).toBe('8.0 GiB');
      expect(jest.getTimerCount()).toBe(0);
    });

test.each(['reject', 'timeout', 'http-error'])(
    'failed transport (%s) releases timers and permits explicit retry',
    async (failure) => {
      jest.useFakeTimers();
      const fetch = jest.fn()
                        .mockImplementationOnce(() => {
                          if (failure === 'reject') {
                            return Promise.reject(new Error('offline'));
                          }
                          return failure === 'timeout' ?
                              new Promise(() => {}) :
                              Promise.resolve({ok: false});
                        })
                        .mockResolvedValue({ok: true});
      // Avoid native crypto I/O so fake time can reach the transport
      // deterministically.
      const {api, storage} = setup({
        fetch,
        crypto: {
          /** @return {string} Stable profile id for this test. */
          randomUUID: () => 'test-profile',
          subtle: {
            /** @return {!Promise<!ArrayBuffer>} Thirty-two zero bytes. */
            digest: async () => new ArrayBuffer(32),
          },
        },
      });
      const pending =
          api.sendTelemetryOnce('https://mock.invalid', {consent: true});
      await jest.advanceTimersByTimeAsync(0);
      if (failure === 'timeout') {
        await jest.advanceTimersByTimeAsync(7000);
      }
      expect(await pending).toEqual({status: 'failed'});
      expect(storage.telemetrySent).toBeUndefined();
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'sent'});
      expect(jest.getTimerCount()).toBe(0);
      expect(fetch.mock.calls[1][1])
          .toMatchObject({credentials: 'omit', redirect: 'error'});
    });
