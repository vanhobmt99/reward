// Firefox MV2 keeps the existing, packaged script expressions without eval or
// page script tags. tabs.executeScript runs them in the isolated content world.
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/executeScript
export function createFirefoxApi(native, { automationEnabled = true } = {}) {
  let lastError;
  const cache = new WeakMap();
  function wrap(object) {
    if (cache.has(object)) return cache.get(object);
    const proxy = new Proxy(object, {
      get(target, key) {
        if (target === native.runtime && key === "lastError") return lastError;
        const value = target[key];
        // Event registration is synchronous and must retain listener identity.
        if (value && typeof value === "object") {
          return typeof value.addListener === "function" ? value : wrap(value);
        }
        if (typeof value !== "function") return value;
        return (...args) => {
          const callback =
            typeof args.at(-1) === "function" ? args.pop() : null;
          if (!callback) return value.apply(target, args);
          Promise.resolve()
            .then(() => value.apply(target, args))
            .then(
              (result) => callback(result),
              (error) => {
                lastError = { message: error.message || String(error) };
                try {
                  callback();
                } finally {
                  lastError = undefined;
                }
              },
            );
        };
      },
    });
    cache.set(object, proxy);
    return proxy;
  }

  const sessions = new Map();
  const detachListeners = new Set();
  async function execute(tabId, code) {
    const results = await native.tabs.executeScript(tabId, {
      code,
      runAt: "document_idle",
    });
    return results[0];
  }
  function scriptCall(fn, args) {
    // Arguments are serialized data, never concatenated as executable source.
    return `(${fn.toString()})(${JSON.stringify(args)})`;
  }
  async function sendCommand({ tabId }, method, params = {}) {
    const session = sessions.get(tabId);
    if (!session)
      throw new Error("Firefox automation is not attached to this tab.");
    switch (method) {
      case "Runtime.evaluate": {
        const value = await execute(tabId, params.expression);
        return { result: { value } };
      }
      case "Page.bringToFront":
        await native.tabs.update(tabId, { active: true });
        return {};
      case "Network.setUserAgentOverride":
        session.userAgent = params.userAgent || "";
        return {};
      case "DOM.getDocument":
        return { root: { nodeId: 1 } };
      case "DOM.querySelector": {
        const found = await execute(
          tabId,
          `Boolean(document.querySelector(${JSON.stringify(params.selector)}))`,
        );
        if (!found) return { nodeId: 0 };
        const nodeId = ++session.nextNode;
        session.selectors.set(nodeId, params.selector);
        return { nodeId };
      }
      case "DOM.scrollIntoViewIfNeeded":
      case "DOM.getBoxModel": {
        const selector = session.selectors.get(params.nodeId);
        if (!selector) throw new Error("Unknown Firefox DOM node.");
        const result = await execute(
          tabId,
          scriptCall(
            function ({ selector, scroll }) {
              const el = document.querySelector(selector);
              if (!el) throw new Error("Firefox DOM target disappeared.");
              if (scroll) el.scrollIntoView({ block: "center" });
              const r = el.getBoundingClientRect();
              return {
                model: {
                  content: [
                    r.left,
                    r.top,
                    r.right,
                    r.top,
                    r.right,
                    r.bottom,
                    r.left,
                    r.bottom,
                  ],
                },
              };
            },
            { selector, scroll: method === "DOM.scrollIntoViewIfNeeded" },
          ),
        );
        return result;
      }
      case "Input.insertText":
      case "Input.dispatchKeyEvent":
      case "Input.dispatchMouseEvent":
      case "Input.dispatchTouchEvent": {
        if (method === "Input.dispatchTouchEvent") {
          if (params.type === "touchStart")
            session.touchPoint = params.touchPoints?.[0];
          params = { ...params, ...session.touchPoint };
        }
        return execute(tabId, scriptCall(firefoxInput, { method, params }));
      }
      // CDP-only capabilities cannot be reproduced by WebExtensions. These
      // lifecycle commands deliberately do nothing; see docs/firefox.md.
      case "Target.setAutoAttach":
      case "Page.enable":
      case "Runtime.enable":
      case "DOM.enable":
      case "Page.addScriptToEvaluateOnNewDocument":
      case "Emulation.clearDeviceMetricsOverride":
      case "Emulation.setDeviceMetricsOverride":
      case "Emulation.setTouchEmulationEnabled":
      case "Emulation.setEmitTouchEventsForMouse":
      case "Network.setBypassServiceWorker":
        return {};
      default:
        throw new Error(`Unsupported Firefox automation command: ${method}`);
    }
  }
  const automation = {
    supportsFingerprintPatch: false,
    async attach({ tabId }) {
      await execute(tabId, "1"); // Prove host access before claiming attachment.
      sessions.set(tabId, { userAgent: "", selectors: new Map(), nextNode: 1 });
    },
    async detach({ tabId }) {
      sessions.delete(tabId);
    },
    async getTargets() {
      return (await native.tabs.query({})).map((tab) => ({
        type: "page",
        tabId: tab.id,
        attached: sessions.has(tab.id),
      }));
    },
    sendCommand,
    onDetach: {
      addListener: (fn) => detachListeners.add(fn),
      removeListener: (fn) => detachListeners.delete(fn),
    },
  };
  if (automationEnabled)
    native.tabs.onRemoved.addListener((tabId) => {
      if (!sessions.delete(tabId)) return;
      for (const fn of detachListeners) fn({ tabId }, "target_closed");
    });
  // Only this extension's automation tabs on Bing receive the mobile UA.
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeSendHeaders
  if (automationEnabled)
    native.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        const userAgent = sessions.get(details.tabId)?.userAgent;
        if (!userAgent) return {};
        const headers = (details.requestHeaders || []).filter(
          (h) =>
            h.name.toLowerCase() !== "user-agent" &&
            !/^sec-ch-ua/i.test(h.name),
        );
        headers.push({ name: "User-Agent", value: userAgent });
        return { requestHeaders: headers };
      },
      { urls: ["*://*.bing.com/*"] },
      ["blocking", "requestHeaders"],
    );

  // Firefox ignores Chrome's origins filter on older versions. Restrict each
  // supported storage removal to explicit hosts; never fall back to global cache.
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browsingData/RemovalOptions
  async function removeData(options, types) {
    const { origins, ...rest } = options;
    if (!origins)
      throw new Error("Firefox data cleanup requires explicit origins.");
    const urls = origins.map((origin) => new URL(origin));
    const relatedHosts = (host) =>
      host === "bing.com" || host.endsWith(".bing.com")
        ? [host, "bing.com", "www.bing.com", "rewards.bing.com"]
        : [host];
    const hostnames = [
      ...new Set(urls.flatMap((url) => relatedHosts(url.hostname))),
    ];
    // Firefox's QuotaManager matches hostPort for localStorage/indexedDB,
    // while cookie/service-worker removal matches hostname without a port.
    // https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/extensions/parent/ext-browsingData.js
    const storageHosts = [
      ...new Set(
        urls.flatMap((url) =>
          url.port ? [url.host] : relatedHosts(url.hostname),
        ),
      ),
    ];
    const supported = {};
    for (const key of [
      "cookies",
      "localStorage",
      "indexedDB",
      "serviceWorkers",
    ]) {
      if (types[key]) supported[key] = true;
    }
    if (Object.keys(supported).length && urls.some((url) => url.port)) {
      const storage = {};
      for (const key of ["localStorage", "indexedDB"]) {
        if (supported[key]) {
          storage[key] = true;
          delete supported[key];
        }
      }
      if (Object.keys(storage).length)
        await native.browsingData.remove(
          { ...rest, hostnames: storageHosts },
          storage,
        );
    }
    if (Object.keys(supported).length) {
      await native.browsingData.remove({ ...rest, hostnames }, supported);
    }
  }
  const api = wrap(native);
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "debugger") return automation;
        if (key === "action") return wrap(native.browserAction);
        if (key === "browsingData") return { remove: removeData };
        return api[key];
      },
    },
  );
}

// Synthetic input has ordinary DOM default actions, but isTrusted remains false.
// Keep this self-contained: Firefox serializes it into a content script.
function firefoxInput({ method, params: p }) {
  if (method === "Input.insertText" || method === "Input.dispatchKeyEvent") {
    const el = document.activeElement;
    if (!el) throw new Error("No focused Firefox input.");
    if (method === "Input.dispatchKeyEvent") {
      const type = p.type === "keyUp" ? "keyup" : "keydown";
      const allowed = el.dispatchEvent(
        new KeyboardEvent(type, {
          key: p.key,
          code: p.code,
          bubbles: true,
          cancelable: true,
        }),
      );
      if (!allowed || type === "keyup") return {};
      if (p.key === "Enter") {
        const form = el.closest("form");
        if (form) form.requestSubmit();
        return {};
      }
      if (p.key !== "Backspace") return {};
    }
    if (typeof el.value !== "string" || typeof el.setRangeText !== "function") {
      throw new Error("Focused Firefox element is not a text input.");
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const deleting = method === "Input.dispatchKeyEvent";
    el.setRangeText(
      deleting ? "" : p.text,
      deleting && start === end ? Math.max(0, start - 1) : start,
      end,
      "end",
    );
    const cursor = deleting
      ? start === end
        ? Math.max(0, start - 1)
        : start
      : start + p.text.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return {};
  }
  const el = document.elementFromPoint(p.x, p.y);
  if (!el) throw new Error("Firefox click target is outside the viewport.");
  const touch = method === "Input.dispatchTouchEvent";
  const type = touch
    ? p.type === "touchStart"
      ? "mousedown"
      : "mouseup"
    : {
        mouseMoved: "mousemove",
        mousePressed: "mousedown",
        mouseReleased: "mouseup",
      }[p.type];
  if (!type) throw new Error("Unsupported Firefox input event.");
  el.dispatchEvent(
    new MouseEvent(type, {
      clientX: p.x,
      clientY: p.y,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "mousedown" ? 1 : 0,
    }),
  );
  if (type === "mousedown") el.focus();
  if (type === "mouseup") el.click();
  return {};
}
