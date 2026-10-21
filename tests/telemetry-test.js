const {loadEsmModule} = require('./esm-loader');
const {webcrypto} = require('node:crypto');
const {TextEncoder} = require('node:util');

const UNKNOWN = 'Không xác định';
/**
 * Loads telemetry.js with URL, timers and test-specific globals.
 * @param {!Object=} context Extra globals merged over the timer harness.
 * @return {!Object} Telemetry module exports.
 */
const load = (context = {}) => loadEsmModule('../js/telemetry.js', {
  URL,
  setTimeout,
  clearTimeout,
  ...context,
});
/**
 * Reads one device snapshot from a partial browser context.
 * @param {!Object=} context Extra globals for this reading.
 * @return {!Promise<!Object>} Specs and data-quality fields.
 */
const report = (context = {}) => load(context).getDeviceSpecs();
/**
 * Builds a chrome.system context whose named API resolves one payload.
 * @param {string} name chrome.system namespace, such as cpu or memory.
 * @param {!Object|!Array<(!Object|null)>} value Payload resolved by getInfo.
 * @return {!{chrome: !Object}} Context fragment passed to report().
 */
const systemContext = (name, value) => ({
  chrome: {
    system: {[name]: {getInfo: jest.fn().mockResolvedValue(value)}},
  },
});
/**
 * Builds a navigator context that resolves one Client Hints payload.
 * @param {!Object} hints High-entropy values returned to telemetry.
 * @return {!{navigator: !Object}} Context fragment passed to report().
 */
const hintsContext = (hints) => ({
  navigator: {
    userAgentData: {getHighEntropyValues: jest.fn().mockResolvedValue(hints)},
  },
});

test.each(['invalid', {}, [null, 'sse', 42]])(
    'malformed optional CPU features %j preserve valid CPU readings',
    async (features) => {
      const result = await report(systemContext('cpu', {
        modelName: 'CPU',
        archName: 'x86_64',
        numOfProcessors: 8,
        features,
      }));
      expect(result.cpuModel).toBe('CPU');
      expect(result.cpuThreads).toBe('8 luồng logic');
    });

test('one invalid display does not discard another valid display', async () => {
  const result = await report(systemContext('display', [
    null,
    {
      name: 'Panel',
      bounds: {width: 1920, height: 1080},
      isPrimary: true,
      isInternal: false,
    },
  ]));
  expect(result.displays).toContain('Panel (1920x1080 px logic - Chính)');
  expect(result.displays).toContain(UNKNOWN);
  expect(result.dataQuality.displays.status).toBe('partial');
});

test(
    'one invalid storage unit does not discard another valid unit',
    async () => {
      const result = await report(systemContext('storage', [
        null,
        {
          name: 'Disk',
          type: 'fixed',
          capacity: 512 * 1024 ** 3,
        },
      ]));
      expect(result.storage).toContain('Disk (512.0 GiB');
      expect(result.storage).toContain(UNKNOWN);
      expect(result.dataQuality.storage.status).toBe('partial');
    });

test.each([[{}], [{kind: 'unknown'}], [null], {length: 0}])(
    'invalid peripheral enumeration %j cannot report zero devices',
    async (devices) => {
      const result = await report({
        navigator: {
          mediaDevices: {
            /**
             * @return {!Promise<!Array<(!Object|null)>|!{length: number}>}
             *     Devices supplied by this row, including malformed lists.
             */
            enumerateDevices: async () => devices,
          },
        },
      });
      expect(result.peripherals).toBe(UNKNOWN);
      expect(result.dataQuality.peripherals.status).toBe('error');
    });

test('unavailable timezone does not discard the device report', async () => {
  const result = await report({
    ...systemContext('cpu', {
      modelName: 'CPU',
      archName: 'x86_64',
      numOfProcessors: 8,
    }),
    Intl: {
      DateTimeFormat() {
        throw new Error('Unavailable');
      },
    },
  });
  expect(result.timezone).toBe(UNKNOWN);
  expect(result.cpuModel).toBe('CPU');
});

/**
 * Builds a document whose canvas reports one WebGL renderer.
 * @param {string} renderer Unmasked WebGL renderer string.
 * @param {!{
 *   debug: (boolean|undefined),
 *   measureText: (function(): !{width: number}|undefined)
 * }=} options Whether debug renderer info is exposed, and the 2D measurer.
 * @return {!{context: !Object, loseContext: function(): undefined, gl:
 *     !Object}} Browser fragment, loseContext spy and WebGL mock.
 */
function canvasContext(
    renderer,
    {debug = true, measureText = () => ({width: 100})} = {},
) {
  const loseContext = jest.fn();
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    getExtension: jest.fn(
        (name) => name === 'WEBGL_lose_context' ?
            {loseContext} :
            name === 'WEBGL_debug_renderer_info' && debug ?
            {UNMASKED_VENDOR_WEBGL: 2, UNMASKED_RENDERER_WEBGL: 3} :
            null,
        ),
    getParameter: jest.fn(
        (key) => ({1: 16384, 2: 'Test vendor', 3: renderer})[key],
        ),
    getSupportedExtensions: jest.fn(() => []),
  };
  const context = {
    document: {
      /**
       * @return {!{
       *   getContext: function(string): !Object,
       *   toDataURL: function(): string
       * }} Canvas element mock.
       */
      createElement: () => ({
        /**
         * @param {string} type Canvas context id, `2d` or a WebGL kind.
         * @return {!Object} 2D measurer or the shared WebGL mock.
         */
        getContext: (type) => type === '2d' ?
            {measureText, fillRect() {}, fillText() {}} :
            type === 'webgl2' ? null :
                                gl,
        /** @return {string} Static PNG data URL. */
        toDataURL: () => 'data:image/png;base64,mock',
      }),
    },
  };
  return {context, loseContext, gl};
}

test(
    'missing APIs remain unknown rather than inventing a hardware report',
    async () => {
      const result = await report();
      for (const key
               of ['cpuModel',
                   'cpuThreads',
                   'ramTotal',
                   'ramAvailable',
                   'isLaptop',
                   'battery',
                   'bitness',
                   'displays',
                   'storage',
                   'peripherals',
                   'gpu',
                   'webglExtensions',
                   'installedFonts',
                   'audioFingerprint',
                   'pixelRatio',
                   'hdrSupport',
                   'theme',
                   'network',
                   'automation',
                   'environment',
      ]) {
        expect(result[key]).toBe(UNKNOWN);
      }
      for (const key
               of ['cpu',
                   'memory',
                   'storage',
                   'peripherals',
                   'gpu',
                   'fonts',
                   'audio',
                   'network',
                   'theme',
                   'hdr',
      ]) {
        expect(result.dataQuality[key].status).toBe('unsupported');
      }
      expect(JSON.stringify(result))
          .not.toMatch(
              /NaN|undefined|Máy thật|PC để bàn/,
          );
    });

test.each([
  {level: 1, charging: true},
  {level: 0.45, charging: false},
])('battery readings do not classify a laptop: %j', async (battery) => {
  const result = await report({
    navigator: {
      /**
       * @return {!Promise<!{level: number, charging: boolean}>} Battery status
       *     for this row.
       */
      getBattery: async () => battery,
    },
  });
  expect(result.isLaptop).toBe(UNKNOWN);
  expect(result.battery).toContain(`${Math.round(battery.level * 100)}%`);
  expect(result.dataQuality.formFactor.status).toBe('unknown');
});

test(
    'internal display alone does not prove a laptop, and unavailable battery is not desktop',
    async () => {
      const result = await report(
          systemContext(
              'display',
              [
                {
                  name: 'Panel',
                  isInternal: true,
                  bounds: {width: 1920, height: 1080},
                },
              ]),
      );
      expect(result.isLaptop).toBe(UNKNOWN);
      expect(result.battery).toBe(UNKNOWN);
      expect(result.displays).toContain('Màn tích hợp');
    });

test('invalid battery values are not rendered as facts', async () => {
  const result = await report({
    navigator: {
      /**
       * @return {!Promise<!{level: number, charging: string}>} Out-of-range
       *     battery status.
       */
      getBattery: async () => ({level: 2, charging: 'yes'}),
    },
  });
  expect(result.battery).toBe(UNKNOWN);
  expect(result.charging).toBe(UNKNOWN);
  expect(result.dataQuality.battery.status).toBe('partial');
});

test.each([
  ['13.0.0', 'Windows 11 hoặc mới hơn'],
  ['10.0.0', 'Windows 10'],
  ['0.0.0', 'Windows trước 10'],
  ['11.0.0', 'Windows (chưa xác định phiên bản)'],
  ['', 'Windows (chưa xác định phiên bản)'],
  ['bad', 'Windows (chưa xác định phiên bản)'],
])(
    'Windows platform version %s is interpreted conservatively',
    async (platformVersion, expected) => {
      const result = await report(
          hintsContext({platform: 'Windows', platformVersion, bitness: '64'}),
      );
      expect(result.os).toBe(expected);
      expect(result.osVersion).not.toMatch(/^Build /);
      if (platformVersion === '13.0.0') {
        expect(result.osVersion).toContain('không phải OS build');
      }
    },
);

test.each(['arm64', 'aarch64', 'x86-64', 'mips64', 'riscv64'])(
    'Client Hints failure falls back to %s as 64-bit',
    async (arch) => {
      const result = await report({
        navigator: {
          userAgentData: {
            getHighEntropyValues: async () => {
              throw new Error('Denied');
            },
          },
        },
        chrome: {
          runtime: {
            /**
             * @return {!Promise<!{os: string, arch: string}>} Windows platform
             *     for this architecture row.
             */
            getPlatformInfo: async () => ({os: 'win', arch}),
          },
        },
      });
      expect(result.os).toBe('Windows');
      expect(result.bitness).toBe('64-bit');
      expect(result.osVersion).toBe(UNKNOWN);
      expect(result.dataQuality.os.source)
          .toBe('chrome.runtime.getPlatformInfo');
    },
);

test('unknown architecture does not default to 32-bit or 64-bit', async () => {
  const result = await report({
    chrome: {
      runtime: {
        /**
         * @return {!Promise<!{os: string, arch: string}>} Linux platform with
         *     an unrecognized architecture.
         */
        getPlatformInfo: async () => ({os: 'linux', arch: 'new-arch'}),
      },
    },
  });
  expect(result.bitness).toBe(UNKNOWN);
});

test.each(['toString', '__proto__', 'constructor'])(
    'platform lookup ignores inherited keys: %s', async (key) => {
      const result = await report({
        chrome: {
          runtime: {
            /**
             * @return {!Promise<!{os: string, arch: string}>} Platform fields
             *     set to an inherited property name.
             */
            getPlatformInfo: async () => ({os: key, arch: key}),
          },
        },
      });
      expect(result.os).toBe(UNKNOWN);
      expect(result.bitness).toBe(UNKNOWN);
    });

test(
    'missing Client Hints bitness can fall back without discarding Windows version',
    async () => {
      const result = await report({
        ...hintsContext({platform: 'Windows', platformVersion: '13.0.0'}),
        chrome: {
          runtime: {
            /**
             * @return {!Promise<!{os: string, arch: string}>} Windows on ARM
             *     when Client Hints omit bitness.
             */
            getPlatformInfo: async () => ({os: 'win', arch: 'arm64'}),
          },
        },
      });
      expect(result.os).toBe('Windows 11 hoặc mới hơn');
      expect(result.bitness).toBe('64-bit');
    });

test(
    'RAM uses binary units and preserves a genuine zero available reading',
    async () => {
      const result = await report(
          systemContext(
              'memory', {capacity: 16 * 1024 ** 3, availableCapacity: 0}),
      );
      expect(result.ramTotal).toBe('16.0 GiB');
      expect(result.ramMB).toBe('16384 MiB');
      expect(result.ramAvailable).toBe('0 MiB');
      expect(result.dataQuality.memory.status).toBe('reported');
    });

test.each([undefined, -1, Infinity, 32 * 1024 ** 3])(
    'invalid available memory %s stays unknown',
    async (availableCapacity) => {
      const result = await report(
          systemContext(
              'memory', {capacity: 16 * 1024 ** 3, availableCapacity}),
      );
      expect(result.ramAvailable).toBe(UNKNOWN);
      expect(result.dataQuality.memory.status).toBe('partial');
    },
);

test('CPU and memory browser fallbacks are labelled estimates', async () => {
  const result = await report({
    navigator: {hardwareConcurrency: 8, deviceMemory: 8},
  });
  expect(result.cpuThreads).toContain('có thể bị giới hạn');
  expect(result.ramTotal).toBe('~8 GiB (ước lượng)');
  expect(result.dataQuality.cpu.status).toBe('estimated');
  expect(result.dataQuality.memory.status).toBe('estimated');
});

test(
    'CPU reports logical threads without pretending to count physical cores',
    async () => {
      const result = await report(
          systemContext('cpu', {
            modelName: ' Mock CPU ',
            archName: 'x86_64',
            numOfProcessors: 16,
          }),
      );
      expect(result.cpuModel).toBe('Mock CPU');
      expect(result.cpuThreads).toBe('16 luồng logic');
      expect(result.dataQuality.cpu.status).toBe('reported');
    });

test(
    'display bounds are logical pixels, and screen fallback is not a primary-display claim',
    async () => {
      const result = await report(
          systemContext(
              'display',
              [
                {
                  name: 'Panel',
                  bounds: {width: 1920, height: 1080},
                  isPrimary: true,
                },
              ]),
      );
      expect(result.displays).toContain('1920x1080 px logic');
      const fallback = await report({screen: {width: 1280, height: 720}});
      expect(fallback.screen).toBe('1280x720 CSS px');
      expect(fallback.displays).not.toContain('Chính');
      expect(fallback.dataQuality.displays.status).toBe('partial');
    });

test('storage does not claim SSD/HDD or invent a zero capacity', async () => {
  const result = await report(
      systemContext(
          'storage',
          [
            {name: 'Disk', type: 'fixed', capacity: 512 * 1024 ** 3},
            {name: 'USB', type: 'removable'},
          ]),
  );
  expect(result.storage).toContain('512.0 GiB');
  expect(result.storage).toContain('chưa xác định SSD/HDD');
  expect(result.storage).toContain(UNKNOWN);
  expect(result.storage).not.toMatch(/\(0(?:\.0)? GiB/);
  expect(result.dataQuality.storage.status).toBe('partial');
});

test('empty storage enumeration differs from API failure', async () => {
  const empty = await report(systemContext('storage', []));
  const failed = await report({
    chrome: {
      system: {
        storage: {
          getInfo: async () => {
            throw new Error('failed');
          },
        },
      },
    },
  });
  expect(empty.storage).toContain('API không liệt kê');
  expect(empty.dataQuality.storage.status).toBe('reported');
  expect(failed.storage).toBe(UNKNOWN);
  expect(failed.dataQuality.storage.status).toBe('error');
});

test('permission denied differs from zero visible peripherals', async () => {
  const error = Object.assign(new Error('Denied'), {name: 'NotAllowedError'});
  const denied = await report({
    navigator: {
      mediaDevices: {
        enumerateDevices: async () => {
          throw error;
        },
      },
    },
  });
  const empty = await report({
    navigator: {
      mediaDevices: {
        /** @return {!Promise<!Array<!Object>>} No visible media devices. */
        enumerateDevices: async () => [],
      },
    },
  });
  expect(denied.peripherals).toBe(UNKNOWN);
  expect(denied.dataQuality.peripherals.status).toBe('denied');
  expect(empty.peripherals).toContain('Micro: 0');
  expect(empty.peripherals).toContain('không phải tổng thiết bị vật lý');
  expect(empty.dataQuality.peripherals.status).toBe('partial');
});

test.each(['SwiftShader', 'llvmpipe'])(
    'software renderer %s does not prove a VM',
    async (renderer) => {
      const {context, loseContext} = canvasContext(renderer);
      const result = await report(context);
      expect(result.environment)
          .toBe(
              'Render bằng phần mềm; chưa xác định máy thật/máy ảo',
          );
      expect(loseContext).toHaveBeenCalledTimes(1);
    },
);

test.each(['NVIDIA GeForce', 'VMware SVGA'])(
    'GPU %s never proves physical/virtual hardware',
    async (renderer) => {
      const {context} = canvasContext(renderer);
      const result = await report(context);
      expect(result.environment).not.toBe('Máy thật (Physical PC)');
      if (renderer.includes('VMware')) {
        expect(result.environment).toContain('chưa xác nhận máy ảo');
      } else {
        expect(result.environment).toBe(UNKNOWN);
      }
    },
);

test('blocked WebGL debug info does not fabricate a GPU model', async () => {
  const {context} = canvasContext('Hidden GPU', {debug: false});
  const result = await report(context);
  expect(result.gpu).toBe(UNKNOWN);
  expect(result.dataQuality.gpu.status).toBe('partial');
  expect(result.webglExtensions).toBe('0 extensions');
});

test('WebGL details include bounded limits and extension names', async () => {
  const {context, gl, loseContext} = canvasContext('Test GPU');
  Object.assign(gl, {
    MAX_VIEWPORT_DIMS: 4,
    MAX_RENDERBUFFER_SIZE: 5,
    VERSION: 6,
    SHADING_LANGUAGE_VERSION: 7,
  });
  gl.getParameter.mockImplementation((key) => ({
                                       1: 16384,
                                       2: 'Test vendor',
                                       3: 'Test GPU',
                                       4: new Int32Array([16384, 16384]),
                                       5: 8192,
                                       6: 'WebGL 1.0',
                                       7: 'WebGL GLSL ES 1.0',
                                     })[key]);
  gl.getSupportedExtensions.mockReturnValue([
    'OES_texture_float',
    'WEBGL_lose_context',
  ]);
  const result = await report(context);
  expect(result.webglDetails.version).toBe('WebGL 1.0');
  expect(result.webglDetails.limits.maxViewportDims).toEqual([16384, 16384]);
  expect(result.webglDetails.limits.maxRenderbufferSize).toBe(8192);
  expect(result.webglDetails.extensions).toContain('OES_texture_float');
  expect(loseContext).toHaveBeenCalledTimes(1);
});

test(
    'Canvas reports a separate hash without sending the rendered image',
    async () => {
      const {context} = canvasContext('GPU');
      const result = await report({...context, crypto: webcrypto, TextEncoder});
      expect(result.canvasFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(result.dataQuality.canvas.status).toBe('reported');
      expect(JSON.stringify(result)).not.toContain('data:image/png');
    });

test('WebGL2 reports support and its own limits when available', async () => {
  const {context, gl} = canvasContext('GPU');
  const loseWebgl2 = jest.fn();
  const webgl2 = {
    MAX_3D_TEXTURE_SIZE: 11,
    MAX_COLOR_ATTACHMENTS: 12,
    getParameter: (key) => ({11: 2048, 12: 8})[key],
    getSupportedExtensions: () => ['EXT_color_buffer_float'],
    getExtension: (name) =>
        name === 'WEBGL_lose_context' ? {loseContext: loseWebgl2} : null,
  };
  context.document.createElement = () => ({
    getContext: (name) => name === 'webgl2' ? webgl2 :
        name === 'webgl'                    ? gl :
                                              null,
  });
  const result = await report(context);
  expect(result.webglDetails.webgl2.supported).toBe(true);
  expect(result.webglDetails.webgl2.limits.max3DTextureSize).toBe(2048);
  expect(result.webglDetails.webgl2.limits.maxColorAttachments).toBe(8);
  expect(result.webglDetails.webgl2.extensions)
      .toContain('EXT_color_buffer_float');
  expect(loseWebgl2).toHaveBeenCalledTimes(1);
});

test.each([true, false, undefined])(
    'webdriver %s is reported only as a signal',
    async (webdriver) => {
      const result = await report({navigator: {webdriver}});
      expect(result.automation)
          .toBe(
              webdriver === true ?
                  'Trình duyệt báo cáo webdriver=true' :
                  webdriver === false ?
                  'Không có tín hiệu WebDriver; chưa loại trừ tự động hóa' :
                  UNKNOWN,
          );
    },
);

test(
    'empty font probe is distinguished from unavailable font probe',
    async () => {
      const {context} = canvasContext('GPU');
      const result = await report(context);
      expect(result.installedFonts)
          .toContain(
              'Không phát hiện trong 50 font ứng viên',
          );
      expect(result.dataQuality.fonts.status).toBe('estimated');
      const missing = await report();
      expect(missing.installedFonts).toBe(UNKNOWN);
    });

test('font matches remain estimates over a fixed candidate list', async () => {
  const {context} = canvasContext('GPU', {
    /** @return {!{width: number}} Wider width when the font is Arial. */
    measureText() {
      return {width: this.font.includes('\'Arial\'') ? 101 : 100};
    },
  });
  const result = await report(context);
  expect(result.installedFonts).toBe('Ước lượng trong 50 font ứng viên: Arial');
});

test('font probe includes additional cross-platform candidates', async () => {
  const {context} = canvasContext('GPU', {
    measureText() {
      return {width: this.font.includes('\'Noto Sans\'') ? 101 : 100};
    },
  });
  const result = await report(context);
  expect(result.installedFonts).toContain('Noto Sans');
});

test.each([NaN, Infinity, -1, undefined])(
    'invalid font width %s does not imply that every font is installed',
    async (width) => {
      const {context} = canvasContext('GPU', {
        /**
         * @return {!{width: number}} Width from this row, including non-finite
         *     values.
         */
        measureText: () => ({width}),
      });
      const result = await report(context);
      expect(result.installedFonts).toBe(UNKNOWN);
      expect(result.dataQuality.fonts.status).toBe('error');
    });

test('invalid candidate width does not count as a font match', async () => {
  const {context} = canvasContext('GPU', {
    /**
     * @return {!{width: number}} Non-finite width for Arial and a baseline
     *     otherwise.
     */
    measureText() {
      return {width: this.font.includes('\'Arial\'') ? NaN : 100};
    },
  });
  const result = await report(context);
  expect(result.installedFonts).toBe(UNKNOWN);
  expect(result.dataQuality.fonts.status).toBe('error');
});

test.each([
  'short',
  'nan',
  'infinite',
  'valid-zero',
  'cleanup-error',
])('audio readings validate samples and independently release nodes: %s',
   async (scenario) => {
     const samples = new Float32Array(scenario === 'short' ? 100 : 5000);
     if (scenario === 'nan') {
       samples[4500] = NaN;
     } else if (scenario === 'infinite') {
       samples[4500] = Infinity;
     }
     const disconnectOscillator = jest.fn(() => {
       if (scenario === 'cleanup-error') {
         throw new Error('node already released');
       }
     });
     const disconnectCompressor = jest.fn();
     const param = {setValueAtTime: jest.fn()};
     const oscillator = {
       frequency: param,
       connect: jest.fn(),
       start: jest.fn(),
       disconnect: disconnectOscillator,
     };
     const compressor = {
       threshold: param,
       knee: param,
       ratio: param,
       attack: param,
       release: param,
       connect: jest.fn(),
       disconnect: disconnectCompressor,
     };
     const result = await report({
       window: {
         OfflineAudioContext: jest.fn().mockImplementation(
             () => ({
               currentTime: 0,
               destination: {},
               /** @return {!Object} Oscillator node mock. */
               createOscillator: () => oscillator,
               /** @return {!Object} Dynamics compressor node mock. */
               createDynamicsCompressor: () => compressor,
               /**
                * @return {!Promise<!{getChannelData: function():
                *     !Float32Array}>} Rendered audio buffer.
                */
               startRendering: async () => ({
                 /**
                  * @return {!Float32Array} Channel samples for this scenario.
                  */
                 getChannelData: () => samples,
               }),
             })),
       },
     });
     const valid = ['valid-zero', 'cleanup-error'].includes(scenario);
     expect(result.audioFingerprint).toBe(valid ? '0.000000' : UNKNOWN);
     expect(result.dataQuality.audio.status).toBe(valid ? 'reported' : 'error');
     expect(disconnectOscillator).toHaveBeenCalledTimes(1);
     expect(disconnectCompressor).toHaveBeenCalledTimes(1);
   });

test(
    'unsupported media queries do not imply light theme or absent HDR',
    async () => {
      const result = await report({
        window: {
          /** @return {!{matches: boolean}} Query that never matches. */
          matchMedia: () => ({matches: false}),
        },
      });
      expect(result.theme).toBe(UNKNOWN);
      expect(result.hdrSupport).toBe(UNKNOWN);
    });

test(
    'media queries describe browser output, and downlink remains an estimate',
    async () => {
      const result = await report({
        window: {
          /**
           * @param {string} query Media query text.
           * @return {!{matches: boolean}} Whether this query is in the
           *     supported set.
           */
          matchMedia: (query) => ({
            matches: [
              '(dynamic-range: standard)',
              '(prefers-color-scheme: dark)',
            ].includes(query),
          }),
        },
        navigator: {connection: {effectiveType: '4g', downlink: 0}},
      });
      expect(result.theme).toBe('Ưu tiên giao diện tối');
      expect(result.hdrSupport).toBe('Trình duyệt báo cáo dải động tiêu chuẩn');
      expect(result.network).toContain('~0 Mbps');
      expect(result.network).toContain('không xác định Wi-Fi/di động');
      expect(result.dataQuality.network.status).toBe('estimated');
    });

test(
    'fingerprint is an environment snapshot that changes with language',
    async () => {
      const navigator = {language: 'vi-VN'};
      const api = load({navigator, crypto: webcrypto, TextEncoder});
      const first = await api.getDeviceFingerprint();
      navigator.language = 'en-US';
      const second = await api.getDeviceFingerprint();
      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(second).not.toBe(first);
    });

test(
    'default placeholder endpoint performs no collection or network request',
    async () => {
      const get = jest.fn();
      const fetch = jest.fn();
      await load({
        chrome: {storage: {local: {get}}},
        fetch,
      }).sendTelemetryOnce();
      expect(get).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

test(
    'mocked payload identifies fingerprint limitations and installation scope',
    async () => {
      const fetch = jest.fn().mockResolvedValue({ok: true});
      const local = {
        get: jest.fn().mockResolvedValue({machineId: 'test-install'}),
        set: jest.fn().mockResolvedValue(),
      };
      await load({
        chrome: {storage: {local}},
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
        fetch,
        crypto: webcrypto,
        TextEncoder,
        AbortController,
        setTimeout,
        clearTimeout,
      }).sendTelemetryOnce('https://mock.invalid', {consent: true});
      expect(fetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(fetch.mock.calls[0][1].body);
      expect(payload.fingerprintIsStableDeviceId).toBe(false);
      expect(payload.fingerprintKind).toBe('environment-snapshot-v3');
      expect(payload.machineIdScope).toContain('not hardware identity');
      expect(payload.schemaVersion).toBe(4);
      expect(Number.isNaN(Date.parse(payload.reportedAt))).toBe(false);
      expect(payload).not.toHaveProperty('installedAt');
      expect(payload.device.dataQuality.formFactor.status).toBe('unknown');
    });

test.each(['cpu', 'memory', 'display', 'storage'])(
    '%s API errors do not fabricate measurements',
    async (name) => {
      const result = await report({
        chrome: {
          system: {
            [name]: {
              getInfo: async () => {
                throw new Error('API failed');
              },
            },
          },
        },
      });
      const group = name === 'display' ? 'displays' : name;
      expect(result.dataQuality[group].status).toBe('error');
    },
);

test(
    'invalid CPU and RAM readings cannot become negative, zero or NaN hardware specs',
    async () => {
      const result = await report({
        chrome: {
          system: {
            cpu: {
              /**
               * @return {!Promise<!{numOfProcessors: number}>} Invalid
               *     processor count.
               */
              getInfo: async () => ({numOfProcessors: -1}),
            },
            memory: {
              /**
               * @return {!Promise<!{
               *   capacity: number,
               *   availableCapacity: number
               * }>} Invalid memory capacities.
               */
              getInfo: async () => ({capacity: NaN, availableCapacity: -1}),
            },
          },
        },
      });
      expect(result.cpuThreads).toBe(UNKNOWN);
      expect(result.ramTotal).toBe(UNKNOWN);
      expect(result.ramAvailable).toBe(UNKNOWN);
    });
