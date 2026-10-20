/** @jest-environment jsdom */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const {
  buildFirefox,
  rewriteChromeApi,
} = require("../scripts/build-firefox.cjs");
const source = fs
  .readFileSync(path.join(__dirname, "../js/firefox-api.js"), "utf8")
  .replace("export function", "function");
const context = { Map, Set, WeakMap, Proxy, Promise, URL };
vm.createContext(context);
vm.runInContext(source, context);

test("Firefox build rewrites actual APIs while preserving queries and script data", () => {
  const input =
    'const query = "chrome.tabs example"; chrome.storage.local.get("config"); const script = `chrome.runtime`; // chrome.tabs\n';
  expect(rewriteChromeApi(input)).toBe(
    'const query = "chrome.tabs example"; extension.storage.local.get("config"); const script = `chrome.runtime`; // chrome.tabs\n',
  );
});

function setup() {
  const native = {
    runtime: {
      getURL: (file) => `moz-extension://test/${file}`,
      onMessage: { addListener: jest.fn() },
    },
    storage: { local: { get: jest.fn(async () => ({ value: 7 })) } },
    tabs: {
      executeScript: jest.fn(async (_tabId, { code }) => [window.eval(code)]),
      update: jest.fn(async () => ({})),
      query: jest.fn(async () => [{ id: 10 }, { id: 20 }]),
      onRemoved: { addListener: jest.fn() },
    },
    browserAction: { setBadgeText: jest.fn(async () => {}) },
    browsingData: { remove: jest.fn(async () => {}) },
    webRequest: { onBeforeSendHeaders: { addListener: jest.fn() } },
  };
  return { native, api: context.createFirefoxApi(native) };
}

test("Firefox facade preserves promises, synchronous methods, events and callback errors", async () => {
  const { native, api } = setup();
  expect(await api.storage.local.get("value")).toEqual({ value: 7 });
  expect(api.runtime.getURL("popup.html")).toBe(
    "moz-extension://test/popup.html",
  );
  expect(api.runtime.onMessage).toBe(native.runtime.onMessage);
  await new Promise((resolve) =>
    api.storage.local.get("value", (data) => {
      expect(data).toEqual({ value: 7 });
      resolve();
    }),
  );
  native.storage.local.get.mockRejectedValueOnce(new Error("storage failed"));
  await new Promise((resolve) =>
    api.storage.local.get("value", () => {
      expect(api.runtime.lastError.message).toBe("storage failed");
      resolve();
    }),
  );
  expect(api.runtime.lastError).toBeUndefined();
  await api.action.setBadgeText({ text: "50%" });
  expect(native.browserAction.setBadgeText).toHaveBeenCalledWith({
    text: "50%",
  });
});

test("Firefox popup facade does not register background automation listeners", () => {
  const { native } = setup();
  native.tabs.onRemoved.addListener.mockClear();
  native.webRequest.onBeforeSendHeaders.addListener.mockClear();
  context.createFirefoxApi(native, { automationEnabled: false });
  expect(native.tabs.onRemoved.addListener).not.toHaveBeenCalled();
  expect(
    native.webRequest.onBeforeSendHeaders.addListener,
  ).not.toHaveBeenCalled();
});

test("attachment proves script access and returns real expression values", async () => {
  const { native, api } = setup();
  await api.debugger.attach({ tabId: 10 });
  expect(
    await api.debugger.sendCommand({ tabId: 10 }, "Runtime.evaluate", {
      expression: "({ count: 2 })",
    }),
  ).toEqual({ result: { value: { count: 2 } } });
  expect(
    (await api.debugger.getTargets())
      .filter((t) => t.attached)
      .map((t) => t.tabId),
  ).toEqual([10]);
  await expect(
    api.debugger.sendCommand({ tabId: 20 }, "Runtime.evaluate", {
      expression: "1",
    }),
  ).rejects.toThrow("not attached");
  await expect(
    api.debugger.sendCommand({ tabId: 10 }, "Unknown.command"),
  ).rejects.toThrow("Unsupported");
  native.tabs.executeScript.mockRejectedValueOnce(
    new Error("Missing host permission"),
  );
  await expect(api.debugger.attach({ tabId: 20 })).rejects.toThrow(
    "Missing host permission",
  );
});

test("mobile headers apply only to attached tab and reset after detach or tab closure", async () => {
  const { native, api } = setup();
  const handler =
    native.webRequest.onBeforeSendHeaders.addListener.mock.calls[0][0];
  await api.debugger.attach({ tabId: 10 });
  await api.debugger.sendCommand(
    { tabId: 10 },
    "Network.setUserAgentOverride",
    { userAgent: "Mobile test" },
  );
  const request = {
    tabId: 10,
    requestHeaders: [
      { name: "User-Agent", value: "Desktop" },
      { name: "Sec-CH-UA", value: "Chrome" },
      { name: "Accept", value: "text/html" },
    ],
  };
  expect(handler(request).requestHeaders).toEqual([
    { name: "Accept", value: "text/html" },
    { name: "User-Agent", value: "Mobile test" },
  ]);
  expect(handler({ ...request, tabId: 20 })).toEqual({});
  await api.debugger.detach({ tabId: 10 });
  expect(handler(request)).toEqual({});
  const detached = jest.fn();
  api.debugger.onDetach.addListener(detached);
  await api.debugger.attach({ tabId: 10 });
  native.tabs.onRemoved.addListener.mock.calls[0][0](10);
  expect(detached).toHaveBeenCalledWith({ tabId: 10 }, "target_closed");
});

test("Firefox typing edits selections, corrects Backspace and submits Enter once", async () => {
  const { api } = setup();
  document.body.innerHTML =
    '<form><input id="sb_form_q" value="hello"><button type="submit">Search</button></form>';
  const input = document.querySelector("input");
  input.focus();
  input.setSelectionRange(1, 4);
  await api.debugger.attach({ tabId: 10 });
  const send = (method, params) =>
    api.debugger.sendCommand({ tabId: 10 }, method, params);
  await send("Input.insertText", { text: 'a"\\b' });
  expect(input.value).toBe('ha"\\bo');
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Backspace",
    code: "Backspace",
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
  });
  expect(input.value).toBe('ha"\\o');
  const form = document.querySelector("form");
  form.requestSubmit = jest.fn();
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter" });
  expect(form.requestSubmit).toHaveBeenCalledTimes(1);
});

test("Firefox DOM lookup and both click paths activate the intended button once", async () => {
  const { api } = setup();
  document.body.innerHTML = '<button id="target">Open</button>';
  const target = document.querySelector("button");
  target.getBoundingClientRect = () => ({
    left: 10,
    right: 30,
    top: 20,
    bottom: 40,
  });
  target.scrollIntoView = jest.fn();
  document.elementFromPoint = jest.fn(() => target);
  const clicked = jest.fn();
  target.addEventListener("click", clicked);
  await api.debugger.attach({ tabId: 10 });
  const send = (method, params) =>
    api.debugger.sendCommand({ tabId: 10 }, method, params);
  const { nodeId } = await send("DOM.querySelector", { selector: "#target" });
  expect(nodeId).toBeGreaterThan(1);
  await send("DOM.scrollIntoViewIfNeeded", { nodeId });
  expect(target.scrollIntoView).toHaveBeenCalled();
  expect((await send("DOM.getBoxModel", { nodeId })).model.content).toEqual([
    10, 20, 30, 20, 30, 40, 10, 40,
  ]);
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: 20, y: 30 });
  expect(clicked).toHaveBeenCalledTimes(1);
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 20, y: 30 }],
  });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(clicked).toHaveBeenCalledTimes(2);
});

test("site data cleanup never becomes a global cache purge", async () => {
  const { native, api } = setup();
  await api.browsingData.remove(
    { origins: ["https://www.bing.com/"], since: 0 },
    {
      cache: true,
      cacheStorage: true,
      pluginData: true,
      cookies: true,
      localStorage: true,
      serviceWorkers: true,
    },
  );
  expect(native.browsingData.remove).toHaveBeenCalledWith(
    { hostnames: ["www.bing.com", "bing.com", "rewards.bing.com"], since: 0 },
    { cookies: true, localStorage: true, serviceWorkers: true },
  );
  await expect(api.browsingData.remove({}, { cache: true })).rejects.toThrow(
    "explicit origins",
  );
});

test("Firefox cleanup uses hostPort for local storage on non-default ports", async () => {
  const { native, api } = setup();
  await api.browsingData.remove(
    { origins: ["http://127.0.0.1:8123/"], since: 0 },
    { cookies: true, localStorage: true, serviceWorkers: true },
  );
  expect(native.browsingData.remove).toHaveBeenCalledWith(
    { hostnames: ["127.0.0.1:8123"], since: 0 },
    { localStorage: true },
  );
  expect(native.browsingData.remove).toHaveBeenCalledWith(
    { hostnames: ["127.0.0.1"], since: 0 },
    { cookies: true, serviceWorkers: true },
  );
});

test("Firefox build is complete and Chrome manifest remains untouched", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "search-auto-firefox-build-"),
  );
  try {
    const original = fs.readFileSync(
      path.join(__dirname, "../manifest.json"),
      "utf8",
    );
    buildFirefox(dir);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.background.page).toBe("firefox-background.html");
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.permissions).toContain("webRequestBlocking");
    expect(manifest.browser_action.default_popup).toBe("/popup.html");
    for (const file of [
      manifest.background.page,
      manifest.browser_action.default_popup,
      ...manifest.content_scripts.flatMap((s) => s.js),
      ...Object.values(manifest.icons),
    ]) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, "popup.html"), "utf8")).toContain(
      "/js/firefox-popup.js",
    );
    expect(fs.readFileSync(path.join(dir, "js/service.js"), "utf8")).toContain(
      "extension.debugger.sendCommand",
    );
    expect(fs.existsSync(path.join(dir, "js/fingerprint.js"))).toBe(false);
    expect(fs.readdirSync(path.join(dir, "docs")).sort()).toEqual([
      "momo.jpg",
      "vietcombank.png",
    ]);
    fs.writeFileSync(path.join(dir, "stale-debug.log"), "old build");
    fs.writeFileSync(path.join(dir, "js/removed-module.js"), "old code");
    buildFirefox(dir);
    expect(fs.existsSync(path.join(dir, "stale-debug.log"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "js/removed-module.js"))).toBe(false);
    expect(
      fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"),
    ).toBe(original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Firefox build refuses cleanup outside disposable build directories", () => {
  expect(() => buildFirefox(path.join(__dirname, ".."))).toThrow(
    "Firefox output must be",
  );
  expect(() => buildFirefox(os.tmpdir())).toThrow("Firefox output must be");
});

test("Firefox build refuses a linked output and preserves the linked directory", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "search-auto-firefox-build-"),
  );
  const target = fs.mkdtempSync(
    path.join(os.tmpdir(), "search-auto-firefox-build-"),
  );
  try {
    fs.writeFileSync(path.join(target, "preserve.txt"), "keep");
    fs.symlinkSync(target, path.join(dir, "extension"), "junction");
    expect(() => buildFirefox(path.join(dir, "extension"))).toThrow(
      "resolves outside its build root",
    );
    expect(fs.readFileSync(path.join(target, "preserve.txt"), "utf8")).toBe(
      "keep",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
