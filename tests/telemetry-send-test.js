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
  expect(payload.schemaVersion).toBe(4);
  expect(payload.device.language).toBe('vi-VN');
  expect(payload.device.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(payload.device.browserSignals.quality.source)
      .toBe('navigator / screen / window');
  expect(payload.device.webRtc.status).toBe('unsupported');
  expect(digest.mock.calls.some(
             ([, input]) => Buffer.from(input).toString('utf8').includes(
                 'Asia/Ho_Chi_Minh###vi-VN')))
      .toBe(true);
  expect(language).toHaveBeenCalledTimes(1);
  expect(DateTimeFormat).toHaveBeenCalledTimes(1);
});

test(
    'an old report does not suppress an explicitly approved expanded report',
    async () => {
      const {api, fetch, storage} = setup({}, {
        telemetrySent: true,
        machineId: 'PC-previous',
      });
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'sent'});
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(storage.telemetrySentVersion).toBe(4);
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'already-sent'});
      expect(fetch).toHaveBeenCalledTimes(1);
    });

test(
    'v4 reports additional browser capabilities and origin quota', async () => {
      const {api, fetch} =
          setup({
            navigator: {
              locks: {request: async (_name, _options, work) => work({})},
              userAgentData: {
                brands: [{brand: 'Chromium', version: '150'}],
                getHighEntropyValues: async () => ({
                  platform: 'Windows',
                  platformVersion: '15.0.0',
                  architecture: 'x86',
                  bitness: '64',
                  fullVersionList: [{brand: 'Chromium', version: '150.1.2.3'}],
                  model: '',
                  wow64: false,
                }),
              },
              storage: {estimate: async () => ({usage: 1024, quota: 4096})},
              globalPrivacyControl: true,
            },
            document:
                {
                  createElement: (tag) =>
                      tag === 'video' || tag === 'audio' ? {
                        canPlayType: (codec) =>
                            codec.includes('webm') ? 'probably' : '',
                      } :
                                                           {
                                                             getContext: () =>
                                                                 null,
                                                           },
                },
            screen: {
              width: 1920,
              height: 1080,
              orientation: {type: 'landscape-primary', angle: 0},
            },
            window: {
              innerWidth: 1280,
              innerHeight: 720,
              outerWidth: 1300,
              outerHeight: 800,
              matchMedia: (query) =>
                  ({matches: query.includes('reduced-motion: reduce')}),
            },
          });
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'sent'});
      const device = JSON.parse(fetch.mock.calls[0][1].body).device;
      expect(device.browserSignals.clientHints.fullVersionList[0].version)
          .toBe('150.1.2.3');
      expect(device.browserSignals.globalPrivacyControl).toBe(true);
      expect(device.browserSignals.screen.orientationAngle).toBe(0);
      expect(device.browserSignals.viewport.outerWidth).toBe(1300);
      expect(device.browserSignals.mediaQueries.reducedMotion).toBe('reduce');
      expect(device.browserSignals.mediaCodecs.webmVideo).toBe('probably');
      expect(device.originStorage).toMatchObject({
        usageBytes: 1024,
        quotaBytes: 4096,
        status: 'estimated',
      });
    });

test(
    'expanded report labels browser signals and local WebRTC candidates',
    async () => {
      const peers = [];
      class FakePeer {
        constructor(config) {
          this.config = config;
          peers.push(this);
        }
        createDataChannel() {}
        async createOffer() {
          return {};
        }
        async setLocalDescription() {
          Promise.resolve().then(() => {
            this.onicecandidate({
              candidate: {
                type: 'host',
                address: 'device.local',
                candidate: '',
              },
            });
            this.onicecandidate({candidate: null});
          });
        }
        close() {
          this.closed = true;
        }
      }
      const {api, fetch} = setup({
        RTCPeerConnection: FakePeer,
        navigator: {
          locks: {request: async (_name, _options, work) => work({})},
          language: 'vi-VN',
          userAgent: 'ExampleBrowser/1',
          maxTouchPoints: 2,
        },
        screen: {width: 1920, height: 1080, colorDepth: 24},
        window: {innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2},
      });
      expect(await api.sendTelemetryOnce('https://mock.invalid', {
        consent: true,
      })).toEqual({status: 'sent'});
      const device = JSON.parse(fetch.mock.calls[0][1].body).device;
      expect(device.browserSignals.userAgent).toBe('ExampleBrowser/1');
      expect(device.browserSignals.screen.width).toBe(1920);
      expect(device.webRtc).toEqual({
        status: 'partial',
        mode: 'host-only',
        candidates: [{type: 'host', address: 'device.local'}],
      });
      expect(peers[0].config).toEqual({iceServers: []});
      expect(peers[0].closed).toBe(true);
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
