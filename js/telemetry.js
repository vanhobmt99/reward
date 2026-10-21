/**
 * Báo cáo những thông tin mà trình duyệt cho phép đọc.
 * Dữ liệu có thể thiếu, bị giới hạn hoặc thay đổi; không phải kiểm kê toàn bộ
 * máy.
 */

import {withTimeout} from '/js/async-utils.js';

// Worker nhận báo cáo thiết bị khi người dùng xác nhận gửi.
export const TELEMETRY_ENDPOINT =
    'https://bingreward.petevincy1969.workers.dev';

/**
 * @typedef {'reported'|'estimated'|'partial'|'unsupported'|'denied'|'error'|
 *     'unknown'} QualityStatus
 */
/** @typedef {{status: QualityStatus, source: string}} DataQuality */
/** @typedef {{value: string, quality: !DataQuality}} QualityValue */
/**
 * @typedef {{model: string, arch: string, threads: ?number, features: string,
 *     quality: !DataQuality}} CpuReading
 */
/**
 * @typedef {{totalGB: string, totalMB: string, availableMB: string,
 *     quality: !DataQuality}} MemoryReading
 */
/**
 * @typedef {{name: string, resolution: string, isPrimary: ?boolean,
 *     isInternal: ?boolean}} DisplayReading
 */
/**
 * @typedef {{items: !Array<!DisplayReading>, quality: !DataQuality}}
 * DisplaysReading
 */
/**
 * @typedef {{name: string, type: string, capacityGB: string}}
 * StorageUnitReading
 */
/**
 * @typedef {{items: ?Array<!StorageUnitReading>, quality: !DataQuality}}
 * StorageReading
 */
/**
 * @typedef {{osName: string, osVersion: string, bitness: ?string,
 *     clientHints: ?Object, quality: !DataQuality}} OsReading
 */
/**
 * @typedef {{microphones: ?number, speakers: ?number, cameras: ?number,
 *     quality: !DataQuality}} PeripheralsReading
 */
/**
 * @typedef {{batteryPercent: string, charging: string,
 *     quality: !DataQuality}} BatteryReading
 */
/**
 * @typedef {{gpu: string, vendor: string, maxTexture: ?number,
 *     extensionsCount: ?number, details: !Object,
 *     quality: !DataQuality}} GpuReading
 */
/** @typedef {{fonts: ?Array<string>, quality: !DataQuality}} FontsReading */
/**
 * @typedef {{environment: string, automation: string,
 *     environmentQuality: !DataQuality,
 *     automationQuality: !DataQuality}} EnvironmentReading
 */
/**
 * @typedef {{network: string, networkQuality: !DataQuality,
 *     theme: !QualityValue, hdr: !QualityValue}} NetworkAndThemeReading
 */
/**
 * @typedef {{cpu: !CpuReading, memory: !MemoryReading,
 *     displays: !DisplaysReading, storages: !StorageReading, osInfo:
 * !OsReading, peripherals: !PeripheralsReading, audioFp: !QualityValue,
 *     battery: !BatteryReading, gpuInfo: !GpuReading, fonts: !FontsReading,
 *     vmAndAuto: !EnvironmentReading,
 *     netAndTheme: !NetworkAndThemeReading, language: string,
 *     timezone: string, browserSignals: !Object, canvas: !Object,
 *     originStorage: !Object, webRtc: !Object}} DeviceSnapshot
 */
/**
 * @typedef {{os: string, osVersion: string, bitness: string, isLaptop: string,
 *     battery: string, charging: string, environment: string, automation:
 * string, cpuModel: string, cpuThreads: string, cpuArch: string, ramTotal:
 * string, ramMB: string, ramAvailable: string, gpu: string, gpuVendor: string,
 *     maxTextureSize: (number|string), webglExtensions: string, displays:
 * string, screen: string, pixelRatio: string, hdrSupport: string, theme:
 * string, network: string, storage: string, peripherals: string,
 *     audioFingerprint: string, installedFonts: string, language: string,
 *     timezone: string, browserSignals: !Object, canvasFingerprint: string,
 *     originStorage: !Object,
 *     webglDetails: !Object, webRtc: !Object,
 *     dataQuality: !Object<string, !DataQuality>}}
 * DeviceReport
 */
/**
 * @typedef {{status: ('unconfigured'|'consent-required'|'unsupported'|'busy'|
 *     'failed'|'already-sent'|'sent')}} SendResult
 */

const UNKNOWN = 'Không xác định';
const COLLECTION_TIMEOUT_MS = 1500;
let pendingSend;

/**
 * Bounds an API read; Promise.race observes late failures as well.
 * @template T
 * @param {function(): !Promise<T>} read API operation.
 * @param {number=} timeoutMs Maximum wait.
 * @return {!Promise<T>} API result or a timeout error.
 */
function readWithDeadline(read, timeoutMs = COLLECTION_TIMEOUT_MS) {
  return withTimeout(read, timeoutMs, 'Device API timed out');
}
/**
 * @param {*} value Untrusted API value.
 * @return {boolean} Whether the value is a finite positive number.
 */
const positive = (value) => Number.isFinite(value) && value > 0;
/**
 * @param {*} value Untrusted API value.
 * @return {boolean} Whether the value is a finite nonnegative number.
 */
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
/**
 * @param {*} value Untrusted API value.
 * @return {string} Trimmed text or the unknown label.
 */
const textValue = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN;

/**
 * Isolates unavailable browser text so one failed read cannot lose the report.
 * @param {function(): *} read Browser value to read.
 * @return {string} Reported text or the unknown label.
 */
function readBrowserText(read) {
  try {
    return textValue(read());
  } catch {
    return UNKNOWN;
  }
}
/**
 * @param {*} width API width.
 * @param {*} height API height.
 * @param {string} unit Source coordinate unit.
 * @return {string} Display size or the unknown label.
 */
const resolution = (width, height, unit) =>
    positive(width) && positive(height) ? `${width}x${height} ${unit}` :
                                          UNKNOWN;

/**
 * reported = API trả về, không có nghĩa là đã kiểm chứng phần cứng vật lý.
 * @param {QualityStatus} status Confidence in this reading.
 * @param {string} source API or fallback used.
 * @return {!DataQuality} Metadata attached to a reading.
 */
function quality(status, source) {
  return {status, source};
}

/**
 * Lấy thông tin CPU chi tiết từ Chrome System API
 * @return {!Promise<!CpuReading>} CPU report or labelled fallback.
 */
async function getCpuInfo() {
  let status = 'unsupported';
  try {
    if (typeof chrome !== 'undefined' && chrome.system?.cpu?.getInfo) {
      const cpu = await readWithDeadline(() => chrome.system.cpu.getInfo());
      return {
        model: textValue(cpu.modelName),
        arch: textValue(cpu.archName),
        threads: Number.isInteger(cpu.numOfProcessors) &&
                positive(cpu.numOfProcessors) ?
            cpu.numOfProcessors :
            null,
        features: Array.isArray(cpu.features) ?
            cpu.features.filter((feature) => typeof feature === 'string')
                .join(', ') :
            '',
        quality: quality(
            textValue(cpu.modelName) !== UNKNOWN &&
                    textValue(cpu.archName) !== UNKNOWN &&
                    Number.isInteger(cpu.numOfProcessors) &&
                    positive(cpu.numOfProcessors) ?
                'reported' :
                'partial',
            'chrome.system.cpu',
            ),
      };
    }
  } catch (e) {
    status = 'error';
  }
  const threads =
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null;
  return {
    model: UNKNOWN,
    arch: UNKNOWN,
    threads: Number.isInteger(threads) && positive(threads) ? threads : null,
    features: '',
    quality: quality(
        Number.isInteger(threads) && positive(threads) ? 'estimated' : status,
        Number.isInteger(threads) && positive(threads) ?
            'navigator.hardwareConcurrency' :
            'chrome.system.cpu / navigator.hardwareConcurrency',
        ),
  };
}

/**
 * RAM do hệ thống báo cáo; fallback của trình duyệt chỉ là ước lượng.
 * @return {!Promise<!MemoryReading>} Memory sizes in binary units.
 */
async function getMemoryInfo() {
  let status = 'unsupported';
  try {
    if (typeof chrome !== 'undefined' && chrome.system?.memory?.getInfo) {
      const mem = await readWithDeadline(() => chrome.system.memory.getInfo());
      if (!positive(mem.capacity)) {
        throw new Error('Invalid memory capacity');
      }
      const totalGB = (mem.capacity / (1024 * 1024 * 1024)).toFixed(1);
      const totalMB = Math.round(mem.capacity / (1024 * 1024));
      return {
        totalGB: `${totalGB} GiB`,
        totalMB: `${totalMB} MiB`,
        availableMB: nonnegative(mem.availableCapacity) &&
                mem.availableCapacity <= mem.capacity ?
            `${Math.round(mem.availableCapacity / (1024 * 1024))} MiB` :
            UNKNOWN,
        quality: quality(
            nonnegative(mem.availableCapacity) &&
                    mem.availableCapacity <= mem.capacity ?
                'reported' :
                'partial',
            'chrome.system.memory',
            ),
      };
    }
  } catch (e) {
    status = 'error';
  }
  const memory =
      typeof navigator !== 'undefined' ? navigator.deviceMemory : null;
  return {
    totalGB: positive(memory) ? `~${memory} GiB (ước lượng)` : UNKNOWN,
    totalMB: UNKNOWN,
    availableMB: UNKNOWN,
    quality: quality(
        positive(memory) ? 'estimated' : status,
        positive(memory) ? 'navigator.deviceMemory' :
                           'chrome.system.memory / navigator.deviceMemory',
        ),
  };
}

/**
 * Lấy thông tin các màn hình cắm vào máy
 * @return {!Promise<!DisplaysReading>} Displays exposed by the API.
 */
async function getDisplaysInfo() {
  let status = 'unsupported';
  try {
    if (typeof chrome !== 'undefined' && chrome.system?.display?.getInfo) {
      const displays =
          await readWithDeadline(() => chrome.system.display.getInfo());
      if (!Array.isArray(displays)) {
        throw new Error('Invalid display enumeration');
      }
      const items = displays.map(
          (d) => ({
            name: textValue(d?.name),
            resolution:
                resolution(d?.bounds?.width, d?.bounds?.height, 'px logic'),
            isPrimary: typeof d?.isPrimary === 'boolean' ? d.isPrimary : null,
            isInternal: typeof d?.isInternal === 'boolean' ? d.isInternal :
                                                             null,
          }));
      return {
        items,
        quality: quality(
            items.length > 0 &&
                    items.every(
                        (d) => d.name !== UNKNOWN && d.resolution !== UNKNOWN &&
                            d.isPrimary !== null && d.isInternal !== null) ?
                'reported' :
                'partial',
            'chrome.system.display',
            ),
      };
    }
  } catch (e) {
    status = 'error';
  }
  const size = typeof screen !== 'undefined' ?
      resolution(screen.width, screen.height, 'CSS px') :
      UNKNOWN;
  return {
    items: size === UNKNOWN ? [] :
                              [
                                {
                                  name: 'Màn hình của cửa sổ hiện tại',
                                  resolution: size,
                                  isPrimary: null,
                                  isInternal: null,
                                },
                              ],
    quality: quality(
        size === UNKNOWN ? status : 'partial',
        size === UNKNOWN ? 'chrome.system.display / screen' : 'screen',
        ),
  };
}

/**
 * Các đơn vị lưu trữ được API liệt kê; không xác định SSD/HDD hay serial.
 * @return {!Promise<!StorageReading>} Visible units, or null when unavailable.
 */
async function getStorageInfo() {
  let status = 'unsupported';
  try {
    if (typeof chrome !== 'undefined' && chrome.system?.storage?.getInfo) {
      const units =
          await readWithDeadline(() => chrome.system.storage.getInfo());
      if (!Array.isArray(units)) {
        throw new Error('Invalid storage enumeration');
      }
      const items =
          units.map((u) => ({
                      name: textValue(u?.name),
                      type: u?.type === 'fixed' ?
                          'Lưu trữ cố định; chưa xác định SSD/HDD' :
                          u?.type === 'removable' ? 'Lưu trữ tháo rời' :
                                                    UNKNOWN,
                      capacityGB: positive(u?.capacity) ?
                          `${(u.capacity / 1024 ** 3).toFixed(1)} GiB` :
                          UNKNOWN,
                    }));
      return {
        items,
        quality: quality(
            items.every(
                (u) => u.name !== UNKNOWN && u.type !== UNKNOWN &&
                    u.capacityGB !== UNKNOWN) ?
                'reported' :
                'partial',
            'chrome.system.storage',
            ),
      };
    }
  } catch (e) {
    status = 'error';
  }
  return {items: null, quality: quality(status, 'chrome.system.storage')};
}

/**
 * Trạng thái pin do trình duyệt báo cáo không chứng minh loại máy hoặc có pin
 * thật.
 * @return {!Promise<!BatteryReading>} Battery status without a form-factor
 *     claim.
 */
async function getBatteryAndFormFactor() {
  let status = 'unsupported';
  try {
    if (typeof navigator !== 'undefined' && navigator.getBattery) {
      const b = await readWithDeadline(() => navigator.getBattery());
      return {
        batteryPercent: nonnegative(b.level) && b.level <= 1 ?
            `${Math.round(b.level * 100)}% (trình duyệt báo cáo)` :
            UNKNOWN,
        charging: b.charging === true ? 'Báo cáo đang sạc / dùng nguồn ngoài' :
            b.charging === false ? 'Báo cáo không sạc' :
                                   UNKNOWN,
        quality: quality(
            nonnegative(b.level) && b.level <= 1 &&
                    typeof b.charging === 'boolean' ?
                'reported' :
                'partial',
            'navigator.getBattery',
            ),
      };
    }
  } catch (e) {
    status = 'error';
  }
  return {
    batteryPercent: UNKNOWN,
    charging: UNKNOWN,
    quality: quality(status, 'navigator.getBattery'),
  };
}

/**
 * Client Hints không phải số build Windows. Thiếu dữ liệu phải giữ unknown.
 * @return {!Promise<!OsReading>} Browser-reported OS and architecture width.
 */
async function getDetailedOsInfo() {
  let osName = UNKNOWN;
  let osVersion = UNKNOWN;
  let bitness = null;
  let status = 'unsupported';
  let source = 'navigator.userAgentData';
  let clientHints = null;

  try {
    if (typeof navigator !== 'undefined' &&
        navigator.userAgentData?.getHighEntropyValues) {
      const hints = await readWithDeadline(
          () => navigator.userAgentData.getHighEntropyValues([
            'platform',
            'platformVersion',
            'architecture',
            'bitness',
            'fullVersionList',
            'model',
            'wow64',
            'formFactors',
          ]));
      clientHints = {
        platform: textValue(hints.platform),
        platformVersion: textValue(hints.platformVersion),
        architecture: textValue(hints.architecture),
        bitness: textValue(hints.bitness),
        model: textValue(hints.model),
        wow64: typeof hints.wow64 === 'boolean' ? hints.wow64 : null,
        formFactors: Array.isArray(hints.formFactors) ?
            hints.formFactors.filter((item) => typeof item === 'string')
                .slice(0, 8) :
            null,
        fullVersionList: Array.isArray(hints.fullVersionList) ?
            hints.fullVersionList.slice(0, 12).map(
                (item) => ({
                  brand: textValue(item?.brand),
                  version: textValue(item?.version),
                })) :
            null,
      };
      const version = typeof hints.platformVersion === 'string' &&
              /^\d+\.\d+\.\d+$/.test(hints.platformVersion) ?
          hints.platformVersion :
          null;
      const pVer = version === null ? null : Number(version.split('.')[0]);
      bitness = ['32', '64'].includes(hints.bitness) ? hints.bitness : null;

      if (hints.platform === 'Windows') {
        osName = pVer >= 13         ? 'Windows 11 hoặc mới hơn' :
            pVer >= 1 && pVer <= 10 ? 'Windows 10' :
            pVer === 0              ? 'Windows trước 10' :
                                      'Windows (chưa xác định phiên bản)';
        osVersion = version ?
            `UA-CH platformVersion: ${version} (không phải OS build)` :
            UNKNOWN;
      } else {
        osName = textValue(hints.platform);
        osVersion = version ? `UA-CH platformVersion: ${version}` : UNKNOWN;
      }
      status = osName !== UNKNOWN && osVersion !== UNKNOWN && bitness ?
          'reported' :
          'partial';
    }
  } catch (e) {
    status = 'error';
  }

  // Thử API dự phòng cả khi Client Hints bị từ chối hoặc thiếu trường.
  try {
    if ((osName === UNKNOWN || !bitness) && typeof chrome !== 'undefined' &&
        chrome.runtime?.getPlatformInfo) {
      const platform =
          await readWithDeadline(() => chrome.runtime.getPlatformInfo());
      if (osName === UNKNOWN) {
        const names = {
          win: 'Windows',
          mac: 'macOS',
          linux: 'Linux',
          cros: 'ChromeOS',
          android: 'Android',
          openbsd: 'OpenBSD',
        };
        osName =
            Object.hasOwn(names, platform.os) ? names[platform.os] : UNKNOWN;
      }
      if (!bitness) {
        const widths = {
          'x86-64': '64',
          'arm64': '64',
          'aarch64': '64',
          'mips64': '64',
          'riscv64': '64',
          'x86-32': '32',
          'arm': '32',
          'mips': '32',
        };
        bitness =
            Object.hasOwn(widths, platform.arch) ? widths[platform.arch] : null;
      }
      source = status === 'reported' || status === 'partial' ?
          `${source} + chrome.runtime.getPlatformInfo` :
          'chrome.runtime.getPlatformInfo';
      status = 'partial';
    }
  } catch (e) {
    if (osName === UNKNOWN && !bitness) {
      status = 'error';
    }
  }

  return {
    osName,
    osVersion,
    bitness,
    clientHints,
    quality: quality(status, source),
  };
}

/**
 * Chỉ đếm các mục được phép thấy, không phải số thiết bị vật lý đang cắm.
 * @return {!Promise<!PeripheralsReading>} Counts, or null when unavailable.
 */
async function getPeripheralsCount() {
  let status = 'unsupported';
  try {
    if (typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.enumerateDevices) {
      const devs = await readWithDeadline(
          () => navigator.mediaDevices.enumerateDevices());
      if (!Array.isArray(devs) ||
          !devs.every(
              (device) => ['audioinput', 'audiooutput', 'videoinput'].includes(
                  device?.kind))) {
        throw new Error('Invalid peripheral enumeration');
      }
      return {
        microphones: devs.filter((d) => d.kind === 'audioinput').length,
        speakers: devs.filter((d) => d.kind === 'audiooutput').length,
        cameras: devs.filter((d) => d.kind === 'videoinput').length,
        quality: quality('partial', 'navigator.mediaDevices.enumerateDevices'),
      };
    }
  } catch (e) {
    status = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ?
        'denied' :
        'error';
  }
  return {
    microphones: null,
    speakers: null,
    cameras: null,
    quality: quality(status, 'navigator.mediaDevices.enumerateDevices'),
  };
}

/**
 * @return {!Object} WebGL2 capability sample from a separate context.
 */
function getWebGl2Info() {
  const result = {
    supported: false,
    status: 'unsupported',
    version: null,
    extensions: null,
    limits: {},
  };
  let gl;
  try {
    gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) {
      return result;
    }
    result.supported = true;
    result.status = 'partial';
    result.version = textValue(gl.getParameter(gl.VERSION));
    const extensions = gl.getSupportedExtensions();
    result.extensions = Array.isArray(extensions) ?
        extensions.filter((name) => typeof name === 'string')
            .slice(0, 128)
            .sort() :
        null;
    for (const [label, constant] of Object.entries({
           max3DTextureSize: 'MAX_3D_TEXTURE_SIZE',
           maxArrayTextureLayers: 'MAX_ARRAY_TEXTURE_LAYERS',
           maxColorAttachments: 'MAX_COLOR_ATTACHMENTS',
           maxDrawBuffers: 'MAX_DRAW_BUFFERS',
           maxSamples: 'MAX_SAMPLES',
           maxUniformBufferBindings: 'MAX_UNIFORM_BUFFER_BINDINGS',
           maxVertexUniformBlocks: 'MAX_VERTEX_UNIFORM_BLOCKS',
           maxFragmentUniformBlocks: 'MAX_FRAGMENT_UNIFORM_BLOCKS',
           maxTransformFeedbackSeparateAttribs:
               'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
         })) {
      try {
        const value = Number.isFinite(gl[constant]) ?
            gl.getParameter(gl[constant]) :
            null;
        result.limits[label] = nonnegative(value) ? value : null;
      } catch {
        result.limits[label] = null;
      }
    }
    result.status = result.extensions ? 'reported' : 'partial';
  } catch {
    result.status = 'error';
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Context may already be lost.
    }
  }
  return result;
}

/**
 * Lấy thông tin card đồ họa GPU qua WebGL
 * @return {!GpuReading} Current renderer details and quality metadata.
 */
function getGpuInfo() {
  let gpu = UNKNOWN;
  let vendor = UNKNOWN;
  let maxTexture = null;
  let extensionsCount = null;
  let status = 'unsupported';
  const details = {
    status: 'unsupported',
    version: null,
    shadingLanguageVersion: null,
    maskedVendor: null,
    maskedRenderer: null,
    extensions: null,
    limits: {},
    webgl2: {
      supported: false,
      status: 'unsupported',
      version: null,
      extensions: null,
      limits: {},
    },
  };
  let gl;
  try {
    if (typeof document === 'undefined') {
      return {
        gpu,
        vendor,
        maxTexture,
        extensionsCount,
        details,
        quality: quality(status, 'WebGL'),
      };
    }
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const readParameter = (name) => {
        try {
          return Number.isFinite(gl[name]) ? gl.getParameter(gl[name]) : null;
        } catch {
          return null;
        }
      };
      const readNumber = (name) => {
        const value = readParameter(name);
        return nonnegative(value) ? value : null;
      };
      const readPair = (name) => {
        const value = readParameter(name);
        return value && value.length === 2 &&
                Array.from(value).every(Number.isFinite) ?
            Array.from(value) :
            null;
      };
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        vendor = textValue(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        gpu = textValue(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      }
      const texture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      maxTexture = positive(texture) ? texture : null;
      const extensions = gl.getSupportedExtensions();
      extensionsCount = Array.isArray(extensions) ? extensions.length : null;
      details.status = 'partial';
      details.version = textValue(readParameter('VERSION'));
      details.shadingLanguageVersion =
          textValue(readParameter('SHADING_LANGUAGE_VERSION'));
      details.maskedVendor = textValue(readParameter('VENDOR'));
      details.maskedRenderer = textValue(readParameter('RENDERER'));
      details.extensions = Array.isArray(extensions) ?
          extensions.filter((name) => typeof name === 'string')
              .slice(0, 128)
              .sort() :
          null;
      for (const [label, parameter] of Object.entries({
             maxTextureSize: 'MAX_TEXTURE_SIZE',
             maxCubeMapTextureSize: 'MAX_CUBE_MAP_TEXTURE_SIZE',
             maxRenderbufferSize: 'MAX_RENDERBUFFER_SIZE',
             maxVertexAttribs: 'MAX_VERTEX_ATTRIBS',
             maxVertexUniformVectors: 'MAX_VERTEX_UNIFORM_VECTORS',
             maxFragmentUniformVectors: 'MAX_FRAGMENT_UNIFORM_VECTORS',
             maxVaryingVectors: 'MAX_VARYING_VECTORS',
             maxTextureImageUnits: 'MAX_TEXTURE_IMAGE_UNITS',
             maxVertexTextureImageUnits: 'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
             maxCombinedTextureImageUnits: 'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
             maxVertexUniformComponents: 'MAX_VERTEX_UNIFORM_COMPONENTS',
             maxFragmentUniformComponents: 'MAX_FRAGMENT_UNIFORM_COMPONENTS',
             redBits: 'RED_BITS',
             greenBits: 'GREEN_BITS',
             blueBits: 'BLUE_BITS',
             alphaBits: 'ALPHA_BITS',
             depthBits: 'DEPTH_BITS',
             stencilBits: 'STENCIL_BITS',
           })) {
        details.limits[label] = readNumber(parameter);
      }
      details.limits.maxViewportDims = readPair('MAX_VIEWPORT_DIMS');
      details.limits.aliasedLineWidthRange =
          readPair('ALIASED_LINE_WIDTH_RANGE');
      details.limits.aliasedPointSizeRange =
          readPair('ALIASED_POINT_SIZE_RANGE');
      details.status = extensionsCount !== null && details.version !== UNKNOWN ?
          'reported' :
          'partial';
      status = gpu !== UNKNOWN && vendor !== UNKNOWN && maxTexture !== null &&
              extensionsCount !== null ?
          'reported' :
          'partial';
    }
  } catch (e) {
    status = 'error';
    details.status = 'error';
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (e) {
      /* Context may already be lost. */
    }
  }
  details.webgl2 = getWebGl2Info();
  return {
    gpu,
    vendor,
    maxTexture,
    extensionsCount,
    details,
    quality: quality(
        status,
        'WebGL renderer (không phải danh sách toàn bộ GPU)',
        ),
  };
}

/**
 * Audio Fingerprinting: Đo sai số vi sai xử lý âm thanh số thực
 * (OfflineAudioContext)
 * @return {!Promise<!QualityValue>} Sample sum or an unavailable reading.
 */
async function getAudioFingerprint() {
  let osc;
  let comp;
  try {
    const AudioCtx = typeof window !== 'undefined' ?
        window.OfflineAudioContext || window.webkitOfflineAudioContext :
        null;
    if (!AudioCtx) {
      return {
        value: UNKNOWN,
        quality: quality('unsupported', 'OfflineAudioContext'),
      };
    }

    const ctx = new AudioCtx(1, 44100, 44100);
    osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(10000, ctx.currentTime);

    comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-50, ctx.currentTime);
    comp.knee.setValueAtTime(40, ctx.currentTime);
    comp.ratio.setValueAtTime(12, ctx.currentTime);
    comp.attack.setValueAtTime(0, ctx.currentTime);
    comp.release.setValueAtTime(0.25, ctx.currentTime);

    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);

    const rendered = await readWithDeadline(() => ctx.startRendering());
    const output = rendered.getChannelData(0);
    if (output.length < 5000) {
      throw new Error('Incomplete audio samples');
    }
    let sum = 0;
    for (let i = 4500; i < 5000; i++) {
      if (!Number.isFinite(output[i])) {
        throw new Error('Invalid audio sample');
      }
      sum += Math.abs(output[i]);
    }
    return {
      value: sum.toFixed(6),
      quality: quality(
          'reported',
          'OfflineAudioContext; không phải định danh phần cứng',
          ),
    };
  } catch (e) {
    return {value: UNKNOWN, quality: quality('error', 'OfflineAudioContext')};
  } finally {
    for (const node of [osc, comp]) {
      try {
        node?.disconnect();
      } catch {
        // One released node must not prevent cleanup of the other node.
      }
    }
  }
}

/**
 * Chỉ ước lượng sự hiện diện của 50 font ứng viên qua chiều rộng chữ.
 * @return {!FontsReading} Estimated matches, or null when probing fails.
 */
function detectInstalledFonts() {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';

  try {
    if (typeof document === 'undefined') {
      return {
        fonts: null,
        quality: quality('unsupported', 'canvas.measureText; 50 font ứng viên'),
      };
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        fonts: null,
        quality: quality('unsupported', 'canvas.measureText; 50 font ứng viên'),
      };
    }

    const baseWidths = {};
    for (const base of baseFonts) {
      ctx.font = `${testSize} ${base}`;
      baseWidths[base] = ctx.measureText(testString).width;
      if (!nonnegative(baseWidths[base])) {
        throw new Error('Invalid baseline font width');
      }
    }

    const candidateFonts = [
      'Calibri',
      'Segoe UI',
      'Consolas',
      'Arial',
      'Times New Roman',
      'Verdana',
      'Tahoma',
      'Trebuchet MS',
      'Impact',
      'Comic Sans MS',
      'Georgia',
      'Courier New',
      'Roboto',
      'Open Sans',
      'Lucida Console',
      'Franklin Gothic Medium',
      'Cambria',
      'Constantia',
      'Palatino Linotype',
      'Corbel',
      'Arial Black',
      'Aptos',
      'Bahnschrift',
      'Book Antiqua',
      'Candara',
      'Century Gothic',
      'Garamond',
      'Helvetica',
      'Helvetica Neue',
      'Menlo',
      'Monaco',
      'Avenir Next',
      'Gill Sans',
      'Liberation Sans',
      'Liberation Serif',
      'DejaVu Sans',
      'DejaVu Serif',
      'Noto Sans',
      'Noto Serif',
      'Ubuntu',
      'Microsoft YaHei',
      'Microsoft JhengHei',
      'MS Gothic',
      'MS Mincho',
      'Meiryo',
      'SimSun',
      'Yu Gothic',
      'Segoe UI Emoji',
      'Segoe UI Symbol',
      'Lucida Sans Unicode',
    ];

    const installed = [];
    for (const font of candidateFonts) {
      let detected = false;
      for (const base of baseFonts) {
        ctx.font = `${testSize} '${font}', ${base}`;
        const width = ctx.measureText(testString).width;
        if (!nonnegative(width)) {
          throw new Error('Invalid candidate font width');
        }
        if (width !== baseWidths[base]) {
          detected = true;
          break;
        }
      }
      if (detected) {
        installed.push(font);
      }
    }
    return {
      fonts: installed,
      quality: quality('estimated', 'canvas.measureText; 50 font ứng viên'),
    };
  } catch (e) {
    return {
      fonts: null,
      quality: quality('error', 'canvas.measureText; 50 font ứng viên'),
    };
  }
}

/**
 * Chỉ ghi nhận dấu hiệu, không chứng minh máy thật/máy ảo hoặc không tự động
 * hóa.
 * @param {string=} gpuString Renderer reported by WebGL.
 * @return {!EnvironmentReading} Signals with their interpretation limits.
 */
function checkVmAndAutomation(gpuString = '') {
  const lowerGpu = (gpuString || '').toLowerCase();
  const isVm = lowerGpu.includes('vmware') || lowerGpu.includes('virtualbox') ||
      lowerGpu.includes('vbox') || lowerGpu.includes('qemu') ||
      lowerGpu.includes('parallels') || lowerGpu.includes('hyper-v');

  const softwareRenderer =
      lowerGpu.includes('llvmpipe') || lowerGpu.includes('swiftshader');
  const webdriver =
      typeof navigator !== 'undefined' ? navigator.webdriver : undefined;

  return {
    environment: isVm ? 'Có dấu hiệu GPU ảo; chưa xác nhận máy ảo' :
        softwareRenderer ?
                        'Render bằng phần mềm; chưa xác định máy thật/máy ảo' :
                        UNKNOWN,
    automation: webdriver === true ?
        'Trình duyệt báo cáo webdriver=true' :
        webdriver === false ?
        'Không có tín hiệu WebDriver; chưa loại trừ tự động hóa' :
        UNKNOWN,
    environmentQuality: quality(
        isVm || softwareRenderer ? 'estimated' : 'unknown',
        'Chuỗi WebGL renderer',
        ),
    automationQuality: quality(
        typeof webdriver === 'boolean' ? 'reported' : 'unsupported',
        'navigator.webdriver',
        ),
  };
}

/**
 * Không match một media query không đồng nghĩa trình duyệt đã hỗ trợ nó.
 * @param {string} feature Media feature to query.
 * @param {!Array<!Array<string>>} choices Value/label pairs in preference
 *     order.
 * @return {!QualityValue} First matching label, or an unknown reading.
 */
function readMediaChoice(feature, choices) {
  try {
    if (typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function') {
      return {value: UNKNOWN, quality: quality('unsupported', feature)};
    }
    for (const [value, label] of choices) {
      if (window.matchMedia(`(${feature}: ${value})`).matches) {
        return {value: label, quality: quality('reported', feature)};
      }
    }
    return {value: UNKNOWN, quality: quality('unknown', feature)};
  } catch (e) {
    return {value: UNKNOWN, quality: quality('error', feature)};
  }
}

/**
 * Lấy thông tin Mạng & Theme giao diện
 * @return {!NetworkAndThemeReading} Browser estimates and media-query readings.
 */
function getNetworkAndTheme() {
  let network = UNKNOWN;
  let networkStatus = 'unsupported';
  try {
    const conn = typeof navigator !== 'undefined' ? navigator.connection ||
            navigator.mozConnection || navigator.webkitConnection :
                                                    null;
    if (conn) {
      const type = ['slow-2g', '2g', '3g', '4g'].includes(conn.effectiveType) ?
          conn.effectiveType :
          UNKNOWN;
      network = type !== UNKNOWN || nonnegative(conn.downlink) ?
          `Ước lượng: ${type}${
              nonnegative(conn.downlink) ? ` (~${conn.downlink} Mbps)` :
                                           ''}; không xác định Wi-Fi/di động` :
                                           UNKNOWN;
      networkStatus = network === UNKNOWN ? 'unknown' : 'estimated';
    }
  } catch (e) {
    networkStatus = 'error';
  }

  const theme = readMediaChoice('prefers-color-scheme', [
    ['dark', 'Ưu tiên giao diện tối'],
    ['light', 'Ưu tiên giao diện sáng'],
  ]);
  const hdr = readMediaChoice('dynamic-range', [
    ['high', 'Trình duyệt báo cáo dải động cao'],
    ['standard', 'Trình duyệt báo cáo dải động tiêu chuẩn'],
  ]);

  return {
    network,
    networkQuality: quality(networkStatus, 'navigator.connection'),
    theme,
    hdr,
  };
}

/**
 * @return {!Object} Media query matches, or null when the browser hides them.
 */
function getMediaQuerySignals() {
  const choices = {
    reducedMotion: ['reduce', 'no-preference'],
    contrast: ['more', 'less', 'custom', 'no-preference'],
    forcedColors: ['active', 'none'],
    invertedColors: ['inverted', 'none'],
    colorGamut: ['rec2020', 'p3', 'srgb'],
    pointer: ['fine', 'coarse', 'none'],
    hover: ['hover', 'none'],
    displayMode: ['fullscreen', 'standalone', 'minimal-ui', 'browser'],
  };
  const features = {
    reducedMotion: 'prefers-reduced-motion',
    contrast: 'prefers-contrast',
    forcedColors: 'forced-colors',
    invertedColors: 'inverted-colors',
    colorGamut: 'color-gamut',
    pointer: 'pointer',
    hover: 'hover',
    displayMode: 'display-mode',
  };
  const values = {};
  for (const [name, options] of Object.entries(choices)) {
    values[name] = null;
    for (const option of options) {
      try {
        if (typeof window !== 'undefined' &&
            window.matchMedia?.(`(${features[name]}: ${option})`).matches) {
          values[name] = option;
          break;
        }
      } catch {
        break;
      }
    }
  }
  return values;
}

/**
 * @return {!Object} Codec capability claims without playing media.
 */
function getMediaCodecs() {
  const codecs = {
    h264Video: ['video', 'video/mp4; codecs="avc1.42E01E"'],
    vp8Video: ['video', 'video/webm; codecs="vp8"'],
    vp9Video: ['video', 'video/webm; codecs="vp9"'],
    av1Video: ['video', 'video/mp4; codecs="av01.0.05M.08"'],
    aacAudio: ['audio', 'audio/mp4; codecs="mp4a.40.2"'],
    mp3Audio: ['audio', 'audio/mpeg'],
    opusAudio: ['audio', 'audio/ogg; codecs="opus"'],
    flacAudio: ['audio', 'audio/flac'],
    webmVideo: ['video', 'video/webm'],
  };
  const result = {};
  for (const [name, [tag, mime]] of Object.entries(codecs)) {
    try {
      const element = document.createElement(tag);
      const answer = element.canPlayType?.(mime);
      result[name] = ['probably', 'maybe', ''].includes(answer) ? answer : null;
    } catch {
      result[name] = null;
    }
  }
  return result;
}

/**
 * The quota belongs to this extension origin, not to a physical drive.
 * @return {!Promise<!Object>} Browser quota estimate with an explicit status.
 */
async function getOriginStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      usageBytes: null,
      quotaBytes: null,
      status: 'unsupported',
      source: 'navigator.storage.estimate',
    };
  }
  try {
    const estimate = await readWithDeadline(() => navigator.storage.estimate());
    const usageBytes = nonnegative(estimate?.usage) ? estimate.usage : null;
    const quotaBytes = nonnegative(estimate?.quota) ? estimate.quota : null;
    return {
      usageBytes,
      quotaBytes,
      status: usageBytes !== null || quotaBytes !== null ? 'estimated' :
                                                           'unknown',
      source: 'navigator.storage.estimate',
    };
  } catch {
    return {
      usageBytes: null,
      quotaBytes: null,
      status: 'error',
      source: 'navigator.storage.estimate',
    };
  }
}

/**
 * Read one Intl snapshot for the report and the composite fingerprint.
 * @return {!Object} Browser locale settings.
 */
function getIntlSignals() {
  try {
    const options = Intl.DateTimeFormat().resolvedOptions();
    return {
      timeZone: textValue(options.timeZone),
      locale: textValue(options.locale),
      calendar: textValue(options.calendar),
      numberingSystem: textValue(options.numberingSystem),
      hourCycle: textValue(options.hourCycle),
    };
  } catch {
    return {
      timeZone: UNKNOWN,
      locale: UNKNOWN,
      calendar: UNKNOWN,
      numberingSystem: UNKNOWN,
      hourCycle: UNKNOWN,
    };
  }
}

/**
 * Records browser-exposed values, which can differ from physical hardware.
 * @param {?Object} clientHints Higher entropy UA hints, if available.
 * @param {!Object} intl Browser locale settings.
 * @return {!Object} Browser and display signals with a source label.
 */
function getBrowserSignals(clientHints, intl) {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const display = typeof screen === 'undefined' ? null : screen;
  const view = typeof window === 'undefined' ? null : window;
  try {
    return {
      userAgent: textValue(nav?.userAgent),
      platform: textValue(nav?.platform),
      vendor: textValue(nav?.vendor),
      languages: Array.isArray(nav?.languages) ? nav.languages.slice(0, 12) :
                                                 null,
      cookieEnabled:
          typeof nav?.cookieEnabled === 'boolean' ? nav.cookieEnabled : null,
      doNotTrack: textValue(nav?.doNotTrack),
      globalPrivacyControl: typeof nav?.globalPrivacyControl === 'boolean' ?
          nav.globalPrivacyControl :
          null,
      pdfViewerEnabled: typeof nav?.pdfViewerEnabled === 'boolean' ?
          nav.pdfViewerEnabled :
          null,
      webdriver: typeof nav?.webdriver === 'boolean' ? nav.webdriver : null,
      maxTouchPoints: nonnegative(nav?.maxTouchPoints) ? nav.maxTouchPoints :
                                                         null,
      pluginCount: nonnegative(nav?.plugins?.length) ? nav.plugins.length :
                                                       null,
      userAgentBrands: Array.isArray(nav?.userAgentData?.brands) ?
          nav.userAgentData.brands.slice(0, 12).map(
              (brand) => ({brand: brand.brand, version: brand.version})) :
          null,
      userAgentMobile: typeof nav?.userAgentData?.mobile === 'boolean' ?
          nav.userAgentData.mobile :
          null,
      clientHints,
      intl,
      mediaQueries: getMediaQuerySignals(),
      mediaCodecs: getMediaCodecs(),
      screen: display ? {
        width: positive(display.width) ? display.width : null,
        height: positive(display.height) ? display.height : null,
        availWidth: positive(display.availWidth) ? display.availWidth : null,
        availHeight: positive(display.availHeight) ? display.availHeight : null,
        colorDepth: positive(display.colorDepth) ? display.colorDepth : null,
        pixelDepth: positive(display.pixelDepth) ? display.pixelDepth : null,
        orientationType: textValue(display.orientation?.type),
        orientationAngle: Number.isFinite(display.orientation?.angle) ?
            display.orientation.angle :
            null,
      } :
                        null,
      viewport: view ? {
        innerWidth: positive(view.innerWidth) ? view.innerWidth : null,
        innerHeight: positive(view.innerHeight) ? view.innerHeight : null,
        outerWidth: positive(view.outerWidth) ? view.outerWidth : null,
        outerHeight: positive(view.outerHeight) ? view.outerHeight : null,
        devicePixelRatio:
            positive(view.devicePixelRatio) ? view.devicePixelRatio : null,
      } :
                       null,
      quality: quality('partial', 'navigator / screen / window'),
    };
  } catch {
    return {quality: quality('error', 'navigator / screen / window')};
  }
}

/**
 * Gathers only locally exposed ICE candidates. No third-party STUN server is
 * contacted; a public WebRTC IP may therefore be unavailable or mDNS-masked.
 * @return {!Promise<!Object>} Candidate addresses or an explicit limitation.
 */
async function getWebRtcCandidates() {
  if (typeof RTCPeerConnection === 'undefined') {
    return {status: 'unsupported', candidates: [], mode: 'host-only'};
  }
  let peer;
  const candidates = [];
  try {
    peer = new RTCPeerConnection({iceServers: []});
    const gathered = new Promise((resolve) => {
      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          resolve();
          return;
        }
        const candidate = event.candidate;
        const parts = candidate.candidate?.split(/\s+/) || [];
        const address = candidate.address || parts[4];
        const type = candidate.type || parts[parts.indexOf('typ') + 1];
        if (typeof address === 'string' && address.length <= 255 &&
            ['host', 'srflx', 'relay'].includes(type) &&
            !candidates.some(
                (item) => item.type === type && item.address === address) &&
            candidates.length < 12) {
          candidates.push({type, address});
        }
      };
    });
    peer.createDataChannel('probe');
    await readWithDeadline(async () => {
      await peer.setLocalDescription(await peer.createOffer());
      await gathered;
    });
    return {status: 'partial', candidates, mode: 'host-only'};
  } catch {
    return {status: 'unavailable', candidates, mode: 'host-only'};
  } finally {
    peer?.close();
  }
}

/**
 * Render Canvas once and keep only its digest in the report.
 * @return {!Promise<!Object>} Hash, transient image data, and quality.
 */
async function getCanvasFingerprint() {
  if (typeof document === 'undefined' || typeof crypto === 'undefined' ||
      !crypto.subtle || typeof TextEncoder === 'undefined') {
    return {
      hash: UNKNOWN,
      dataUrl: null,
      quality: quality('unsupported', 'Canvas 2D / SHA-256'),
    };
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        hash: UNKNOWN,
        dataUrl: null,
        quality: quality('unsupported', 'Canvas 2D'),
      };
    }
    ctx.textBaseline = 'top';
    ctx.font = '14px \'Arial\', sans-serif';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('SearchAuto@Device#2026', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('SearchAuto@Device#2026', 4, 17);
    const dataUrl = canvas.toDataURL();
    const bytes = new TextEncoder().encode(dataUrl);
    const digest =
        await readWithDeadline(() => crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(new Uint8Array(digest))
                     .map((byte) => byte.toString(16).padStart(2, '0'))
                     .join('');
    return {hash, dataUrl, quality: quality('reported', 'Canvas 2D / SHA-256')};
  } catch {
    return {
      hash: UNKNOWN,
      dataUrl: null,
      quality: quality('error', 'Canvas 2D / SHA-256'),
    };
  }
}

/**
 * Hash của ảnh chụp môi trường hiện tại, không phải định danh phần cứng.
 * Cùng máy có thể đổi hash; nhiều máy có thể trùng dữ liệu đầu vào.
 * @param {?DeviceSnapshot=} snapshot Readings to reuse, or null to read once.
 * @return {!Promise<string>} Hash không bảo đảm duy nhất hay ổn định.
 */
export async function getDeviceFingerprint(snapshot = null) {
  snapshot = snapshot || await collectDeviceSnapshot();
  const components = [];

  // 1. Reuse the same Canvas sample as the separate report hash.
  components.push(snapshot.canvas.dataUrl || '');

  // 2. WebGL Fingerprint
  const {gpu, vendor, maxTexture, extensionsCount} = snapshot.gpuInfo;
  components.push(gpu, vendor, maxTexture, extensionsCount);
  components.push(JSON.stringify(snapshot.gpuInfo.details));

  // 3. Audio & Fonts Fingerprint
  const {audioFp, fonts} = snapshot;
  components.push(audioFp.value);
  components.push(fonts.fonts?.join(',') || '');

  // 4. Phần cứng chi tiết (CPU Model, RAM MB, Màn hình, Múi giờ)
  const {cpu, memory: mem, displays, storages} = snapshot;

  components.push(cpu.model, cpu.arch, cpu.threads);
  components.push(mem.totalMB);
  components.push(
      displays.items.map((d) => `${d.name}:${d.resolution}`).join('|'),
  );
  components.push(
      storages.items?.map((s) => `${s.name}:${s.capacityGB}`).join('|') || '',
  );
  components.push(JSON.stringify({
    clientHints: snapshot.browserSignals.clientHints,
    mediaCodecs: snapshot.browserSignals.mediaCodecs,
    mediaQueries: snapshot.browserSignals.mediaQueries,
    colorDepth: snapshot.browserSignals.screen?.colorDepth,
    intl: snapshot.browserSignals.intl,
  }));
  components.push(snapshot.timezone, snapshot.language);

  // 5. Băm thành mã hash SHA-256
  try {
    const rawString = components.join('###');
    const msgUint8 = new TextEncoder().encode(rawString);
    const hashBuffer =
        await readWithDeadline(() => crypto.subtle.digest('SHA-256', msgUint8));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return 'UNKNOWN_FP';
  }
}

/**
 * Báo cáo có giới hạn của trình duyệt. dataQuality mô tả nguồn và mức chắc
 * chắn.
 * @return {!Promise<!DeviceReport>} Display fields with per-source quality.
 */
export async function getDeviceSpecs() {
  return deviceSpecsFromSnapshot(await collectDeviceSnapshot());
}

/**
 * Reads each source once for both the report and its environment hash.
 * @return {!Promise<!DeviceSnapshot>} Raw readings with quality metadata.
 */
async function collectDeviceSnapshot() {
  const [cpu, memory, displays, storages, osInfo, peripherals, audioFp, battery, webRtc, originStorage, canvas] =
      await Promise.all([
        getCpuInfo(),
        getMemoryInfo(),
        getDisplaysInfo(),
        getStorageInfo(),
        getDetailedOsInfo(),
        getPeripheralsCount(),
        getAudioFingerprint(),
        getBatteryAndFormFactor(),
        getWebRtcCandidates(),
        getOriginStorageEstimate(),
        getCanvasFingerprint(),
      ]);
  const gpuInfo = getGpuInfo();
  const intl = getIntlSignals();
  return {
    cpu,
    memory,
    displays,
    storages,
    osInfo,
    peripherals,
    audioFp,
    battery,
    gpuInfo,
    fonts: detectInstalledFonts(),
    vmAndAuto: checkVmAndAutomation(gpuInfo.gpu),
    netAndTheme: getNetworkAndTheme(),
    browserSignals: getBrowserSignals(osInfo.clientHints, intl),
    originStorage,
    canvas,
    webRtc,
    language: readBrowserText(() => navigator.language),
    timezone: intl.timeZone,
  };
}

/**
 * Formats the snapshot without reading hardware a second time.
 * @param {!DeviceSnapshot} snapshot Collected readings and quality metadata.
 * @return {!DeviceReport} Display fields and dataQuality groups.
 */
function deviceSpecsFromSnapshot(snapshot) {
  const {
    cpu,
    memory,
    displays,
    storages,
    osInfo,
    peripherals,
    audioFp,
    gpuInfo,
    battery,
    fonts,
    vmAndAuto,
    netAndTheme,
  } = snapshot;
  const {gpu, vendor, maxTexture, extensionsCount} = gpuInfo;

  return {
    os: osInfo.osName,
    osVersion: osInfo.osVersion,
    bitness: osInfo.bitness ? `${osInfo.bitness}-bit` : UNKNOWN,
    isLaptop: UNKNOWN,
    battery: battery.batteryPercent,
    charging: battery.charging,
    environment: vmAndAuto.environment,
    automation: vmAndAuto.automation,
    cpuModel: cpu.model,
    cpuThreads: cpu.threads === null ?
        UNKNOWN :
        `${cpu.threads} luồng logic${
            cpu.quality.status === 'estimated' ?
                ' (trình duyệt báo cáo, có thể bị giới hạn)' :
                ''}`,
    cpuArch: cpu.arch,
    ramTotal: memory.totalGB,
    ramMB: memory.totalMB,
    ramAvailable: memory.availableMB,
    gpu,
    gpuVendor: vendor,
    maxTextureSize: maxTexture ?? UNKNOWN,
    webglExtensions: extensionsCount === null ? UNKNOWN :
                                                `${extensionsCount} extensions`,
    webglDetails: gpuInfo.details,
    canvasFingerprint: snapshot.canvas.hash,
    displays:
        displays.items
            .map(
                (d) => `${d.name} (${d.resolution}${
                    d.isPrimary ? ' - Chính' :
                                  ''}${d.isInternal ? ' - Màn tích hợp' : ''})`,
                )
            .join(', ') ||
        UNKNOWN,
    screen: typeof screen !== 'undefined' ?
        resolution(screen.width, screen.height, 'CSS px') :
        UNKNOWN,
    pixelRatio:
        typeof window !== 'undefined' && positive(window.devicePixelRatio) ?
        `${window.devicePixelRatio}x` :
        UNKNOWN,
    hdrSupport: netAndTheme.hdr.value,
    theme: netAndTheme.theme.value,
    network: netAndTheme.network,
    storage: storages.items === null ?
        UNKNOWN :
        storages.items.length === 0 ?
        'API không liệt kê đơn vị lưu trữ nào' :
        storages.items.map((s) => `${s.name} (${s.capacityGB} - ${s.type})`)
            .join(' | '),
    peripherals: peripherals.microphones === null ?
        UNKNOWN :
        `Các mục trình duyệt cho phép thấy — Micro: ${
            peripherals.microphones}, Loa: ${peripherals.speakers}, Camera: ${
            peripherals.cameras}; không phải tổng thiết bị vật lý`,
    audioFingerprint: audioFp.value,
    installedFonts: fonts.fonts === null ?
        UNKNOWN :
        fonts.fonts.length > 0 ?
        `Ước lượng trong 50 font ứng viên: ${fonts.fonts.join(', ')}` :
        'Không phát hiện trong 50 font ứng viên; không có nghĩa máy không có font',
    language: snapshot.language,
    timezone: snapshot.timezone,
    browserSignals: snapshot.browserSignals,
    originStorage: snapshot.originStorage,
    webRtc: snapshot.webRtc,
    dataQuality: {
      cpu: cpu.quality,
      memory: memory.quality,
      displays: displays.quality,
      storage: storages.quality,
      os: osInfo.quality,
      battery: battery.quality,
      formFactor: quality(
          'unknown',
          'API trình duyệt không chứng minh Laptop/PC',
          ),
      peripherals: peripherals.quality,
      gpu: gpuInfo.quality,
      fonts: fonts.quality,
      audio: audioFp.quality,
      canvas: snapshot.canvas.quality,
      environment: vmAndAuto.environmentQuality,
      automation: vmAndAuto.automationQuality,
      network: netAndTheme.networkQuality,
      theme: netAndTheme.theme.quality,
      hdr: netAndTheme.hdr.quality,
    },
  };
}

/**
 * Validates the destination before any device reading or storage access.
 * @param {string=} endpoint Configured receiver URL.
 * @return {boolean} Whether a real HTTPS destination is configured.
 */
export function isTelemetryConfigured(endpoint = TELEMETRY_ENDPOINT) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password &&
        url.hostname !== 'your-worker-name.workers.dev';
  } catch {
    return false;
  }
}

/**
 * Sends only after the disclosed send button was selected. A profile-local
 * Web Lock prevents overlapping extension pages from sending the same report.
 * @param {string=} endpoint HTTPS receiver shown to the user.
 * @param {{consent: (boolean|undefined)}=} options Approval for this explicit
 *     send.
 * @return {!Promise<!SendResult>} Outcome suitable for the status UI.
 */
export async function sendTelemetryOnce(
    endpoint = TELEMETRY_ENDPOINT, {consent = false} = {}) {
  if (!isTelemetryConfigured(endpoint)) {
    return {status: 'unconfigured'};
  }
  if (consent !== true) {
    return {status: 'consent-required'};
  }
  if (pendingSend) {
    return pendingSend;
  }
  // Without a cross-page lock, leave sending disabled rather than claim that
  // a per-module flag can prevent duplicates across extension pages.
  if (!globalThis.navigator?.locks?.request) {
    return {status: 'unsupported'};
  }
  pendingSend = Promise.resolve()
                    .then(
                        () => navigator.locks.request(
                            'device-report-send',
                            {ifAvailable: true},
                            (lock) => lock ? sendDeviceReport(endpoint) :
                                             {status: 'busy'},
                            ))
                    .catch(() => ({status: 'failed'}))
                    .finally(() => {
                      pendingSend = undefined;
                    });
  return pendingSend;
}

/**
 * Collects and sends while holding the profile lock. Failed sends are retried
 * only by another explicit click; a server must deduplicate the profile ID to
 * handle a response lost after delivery.
 * @param {string} endpoint Validated HTTPS receiver.
 * @return {!Promise<!SendResult>} Delivery outcome.
 */
async function sendDeviceReport(endpoint) {
  const controller = new AbortController();
  try {
    const stored = await readWithDeadline(() => chrome.storage.local.get([
      'telemetrySent',
      'telemetrySentVersion',
      'machineId',
    ]));
    if (stored.telemetrySent && stored.telemetrySentVersion === 4) {
      return {status: 'already-sent'};
    }
    const machineId = stored.machineId || `PC-${crypto.randomUUID()}`;
    if (!stored.machineId) {
      await readWithDeadline(() => chrome.storage.local.set({machineId}));
    }
    const snapshot = await collectDeviceSnapshot();
    const fingerprint = await getDeviceFingerprint(snapshot);
    const res = await readWithDeadline(
        () => fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          body: JSON.stringify({
            schemaVersion: 4,
            machineId,
            machineIdScope: 'browser-profile-storage; not hardware identity',
            fingerprint,
            fingerprintKind: 'environment-snapshot-v3',
            fingerprintIsStableDeviceId: false,
            device: deviceSpecsFromSnapshot(snapshot),
            reportedAt: new Date().toISOString(),
          }),
        }),
        7000);
    if (!res.ok) {
      return {status: 'failed'};
    }
    await readWithDeadline(() => chrome.storage.local.set({
      telemetrySent: true,
      telemetrySentVersion: 4,
      lastTracked: Date.now(),
    }));
    return {status: 'sent'};
  } catch {
    return {status: 'failed'};
  } finally {
    controller.abort();
  }
}
