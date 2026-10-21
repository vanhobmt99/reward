// Anti-fingerprinting — injected into the page's MAIN world at document_start.
//
// NOTE: this file is NOT a manifest content script. The service worker fetches
// its source and installs it through CDP
// (Page.addScriptToEvaluateOnNewDocument — see installFingerprintPatch in
// service.js), which is what puts it in the page's MAIN world. A normal content
// script runs in an isolated world, where patching prototypes does NOT affect
// what the page sees — that is why the v1 version of this code was a no-op.
//
// It is also UA-aware: when the tab is emulating a mobile device we must NOT
// leak desktop-only traits (Intel GPU, 5 plugins). Doing so is more suspicious
// than doing nothing, because it contradicts the mobile user-agent. So the GPU
// string and plugin count are chosen to match the emulated platform.
(function initAntiFingerprinting() {
  'use strict';

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || /Mobile/i.test(ua);

  // Pick a WebGL vendor/renderer consistent with the (emulated) platform.
  let glVendor = 'Google Inc. (Intel)';
  let glRenderer =
      'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
  if (isIOS) {
    glVendor = 'Apple Inc.';
    glRenderer = 'Apple GPU';
  } else if (isAndroid) {
    glVendor = 'Qualcomm';
    glRenderer = 'Adreno (TM) 730';
  }

  /**
   * @typedef {{name: string, filename: string, description: string}}
   *     SpoofedPlugin
   */
  /**
   * @typedef {{length: number, item: function(number): ?SpoofedPlugin,
   *     namedItem: function(string): ?SpoofedPlugin}} SpoofedPluginList
   */
  /**
   * @typedef {string|number|boolean|null|!Array<number>|!Float32Array|
   *     !Int32Array|!Uint32Array} WebGlParameter
   */

  /**
   * Defines a configurable getter and ignores a protected property.
   * @param {!Navigator} obj Host object whose property is replaced.
   * @param {string} key Property name.
   * @param {function(): (undefined|number|!Array<string>|!SpoofedPluginList)}
   *     getter Value returned on each read.
   */
  const defineGetter = (obj, key, getter) => {
    try {
      Object.defineProperty(obj, key, {get: getter, configurable: true});
    } catch (e) {
      /* property may be non-configurable / protected */
    }
  };

  // 1. Mask navigator.webdriver — the single most important bot-detection
  //    vector. Safe on every platform.
  defineGetter(navigator, 'webdriver', () => undefined);

  // 2. Spoof consistent navigator properties.
  defineGetter(navigator, 'languages', () => ['en-US', 'en']);
  defineGetter(navigator, 'deviceMemory', () => 8);
  defineGetter(navigator, 'hardwareConcurrency', () => 8);
  // Desktop Chrome exposes a small, fixed set of built-in PDF plugins; mobile
  // Chrome/Safari exposes none. Only spoof on desktop, and expose a *realistic*
  // PluginArray-like object (with indexed, named entries) — a bare {length:5}
  // with no elements is itself a strong bot tell and breaks pages that iterate
  // plugins[i].name.
  if (!isMobile) {
    const pluginNames = [
      'PDF Viewer',
      'Chrome PDF Viewer',
      'Chromium PDF Viewer',
      'Microsoft Edge PDF Viewer',
      'WebKit built-in PDF',
    ];
    const fakePlugins = {length: pluginNames.length};
    pluginNames.forEach((name, i) => {
      fakePlugins[i] = {
        name,
        filename: 'internal-pdf-viewer',
        description: '',
      };
    });
    /**
     * @param {number} i Zero-based plugin index.
     * @return {?SpoofedPlugin} Plugin at that index, or null.
     */
    fakePlugins.item = (i) => fakePlugins[i] || null;
    /**
     * @param {string} n Plugin name.
     * @return {?SpoofedPlugin} Matching plugin, or null.
     */
    fakePlugins.namedItem = (n) =>
        pluginNames.includes(n) ? fakePlugins[pluginNames.indexOf(n)] : null;
    defineGetter(navigator, 'plugins', () => fakePlugins);
  }

  // NOTE: no canvas-fingerprint noise here. Perturbing pixels via
  // getImageData/putImageData permanently mutates the page's own canvas (noise
  // accumulates across reads) and force-creating a "2d" context can break a
  // canvas the page intended to use for WebGL. The risk to the page outweighs
  // the anti-fingerprint benefit, so it is intentionally omitted.

  /**
   * WebGL vendor/renderer spoof (37445 = UNMASKED_VENDOR_WEBGL, 37446 =
   * UNMASKED_RENDERER_WEBGL), matched to the platform above.
   * @param {?{getParameter: function(number): WebGlParameter}} proto Context
   *     prototype, or null when WebGL is missing.
   */
  const patchGetParameter = (proto) => {
    if (!proto) {
      return;
    }
    try {
      const original = proto.getParameter;
      /**
       * @param {number} parameter WebGL pname. 37445 and 37446 are replaced.
       * @param {...(number|string|boolean|null)} rest Arguments forwarded to
       *     the original getter.
       * @return {WebGlParameter} Spoofed vendor or renderer string, otherwise
       *     the original result.
       */
      proto.getParameter = function(parameter, ...rest) {
        if (parameter === 37445) {
          return glVendor;
        }
        if (parameter === 37446) {
          return glRenderer;
        }
        return original.call(this, parameter, ...rest);
      };
    } catch (e) {
      /* prototype locked */
    }
  };
  if (typeof WebGLRenderingContext !== 'undefined') {
    patchGetParameter(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchGetParameter(WebGL2RenderingContext.prototype);
  }
})();
