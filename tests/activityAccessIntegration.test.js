const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadEsmModule } = require("./esm-loader");
const { ACTIVITY_ISSUE_KEY, checkActivityAccess } = loadEsmModule(
  "../js/activity-access.js",
);
const source = fs.readFileSync(
  path.join(__dirname, "../js/service.js"),
  "utf8",
);

test("the real activity entry stops a restricted Edge tab before login reloads or clicks", async () => {
  const start = source.indexOf("async function activity(tabId");
  const end = source.indexOf("\n// `notifyOnFinish`", start);
  const chrome = {
    tabs: {
      query: jest.fn().mockResolvedValue([{ id: 99 }]),
      update: jest.fn(),
      remove: jest.fn(),
    },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    storage: { local: { remove: jest.fn(), set: jest.fn() } },
  };
  const attach = jest.fn(async (_id, _interruptible, onError) => {
    onError(new Error("The extensions gallery cannot be scripted."));
    return false;
  });
  const context = {
    chrome,
    attach,
    checkActivityAccess,
    ACTIVITY_ISSUE_KEY,
    navigator: { onLine: true, userAgent: "Edg/152.0.0.0" },
    config: { runtime: { running: 1, act: 0 } },
    set: jest.fn(),
    log: jest.fn(),
    logs: false,
    isRuntimeActive: () => true,
    wait: jest.fn(),
    delay: jest.fn(),
    rewards: "https://rewards.bing.com/",
    mediumDelay: 3000,
    recordCrash: jest.fn(),
    recordEvent: jest.fn(),
    closeOpenedActivityTabs: jest.fn(),
    isRewardsSessionActive: jest.fn(),
    runDashboardActivityPass: jest.fn(),
    recordActivityRun: jest.fn(),
    detach: jest.fn(),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  expect(await context.activity(99)).toBe(false);
  expect(attach).toHaveBeenCalledTimes(1);
  expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
  expect(context.isRewardsSessionActive).not.toHaveBeenCalled();
  expect(context.runDashboardActivityPass).not.toHaveBeenCalled();
  expect(context.recordActivityRun).not.toHaveBeenCalled();
  expect(context.recordCrash).not.toHaveBeenCalled();
  expect(context.recordEvent).toHaveBeenCalledWith(
    "activity-access",
    "The extensions gallery cannot be scripted.",
    { code: "browser_access_blocked" },
  );
  expect(chrome.tabs.remove).not.toHaveBeenCalled();
  expect(chrome.storage.local.set).toHaveBeenCalledWith(
    expect.objectContaining({
      [ACTIVITY_ISSUE_KEY]: expect.objectContaining({
        code: "browser_access_blocked",
        tabId: 99,
      }),
    }),
  );
  expect(context.config.runtime.act).toBe(0);
});

test("an attached debugger owned by another client is not treated as usable", async () => {
  const start = source.indexOf("async function attach(tabId");
  const end = source.indexOf("async function simulate(", start);
  const error = new Error("Debugger is not attached to the tab with id: 99.");
  const onError = jest.fn();
  const context = {
    config: { runtime: { running: 1 } },
    logs: false,
    log: jest.fn(),
    isDebuggerAttached: async () => true,
    chrome: {
      debugger: {
        sendCommand: jest.fn().mockRejectedValue(error),
        attach: jest.fn(),
      },
    },
    race: (promise) => promise,
    shortestDelay: 1000,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  expect(await context.attach(99, true, onError)).toBe(false);
  expect(onError).toHaveBeenCalledWith(error);
  expect(context.chrome.debugger.attach).not.toHaveBeenCalled();
});
