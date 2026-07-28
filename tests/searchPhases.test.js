"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const searchPhasesPath = path.join(__dirname, "../js/search-phases.js");
const source = fs.readFileSync(searchPhasesPath, "utf8");
const modifiedSource = `${source.replace(/export async function /g, "async function ")}
module.exports = { runSearchPhases, handlePostSearchTasks, cleanupAfterRun };
`;

const chrome = {
  tabs: {},
};

const sandbox = {
  module: { exports: {} },
  exports: {},
  chrome,
  console,
  Promise,
};

vm.createContext(sandbox);
vm.runInContext(modifiedSource, sandbox);

const { runSearchPhases, handlePostSearchTasks, cleanupAfterRun } =
  sandbox.module.exports;

function makeConfig(overrides = {}) {
  return {
    control: {
      clear: 1,
      act: 1,
      preserveRewards: 1,
      ...(overrides.control || {}),
    },
    runtime: {
      running: 1,
      mobile: 0,
      ...(overrides.runtime || {}),
    },
  };
}

describe("runSearchPhases()", () => {
  test("clears cookies before mobile and restores auth cookies when preserveRewards is enabled", async () => {
    const config = makeConfig({
      control: { clear: 1, act: 1, preserveRewards: 1 },
    });
    const clearFn = jest.fn().mockResolvedValue(true);
    const searchFn = jest.fn().mockResolvedValue(true);
    const simulateFn = jest.fn().mockResolvedValue(true);
    const detachFn = jest.fn().mockResolvedValue();
    const backupAuthCookiesFn = jest
      .fn()
      .mockResolvedValue([{ name: "session" }]);
    const restoreAuthCookiesFn = jest.fn().mockResolvedValue(1);

    const result = await runSearchPhases(
      { desk: 0, mob: 3, min: 10, max: 20 },
      "session-1",
      123,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        searchFn,
        simulateFn,
        clearFn,
        setConfig: jest.fn().mockResolvedValue(),
        getConfig: () => config,
        delayFn: jest.fn().mockResolvedValue(),
        shortestDelay: 100,
        detachFn,
        backupAuthCookiesFn,
        restoreAuthCookiesFn,
      },
    );

    expect(result).toBe(true);
    expect(backupAuthCookiesFn).toHaveBeenCalledTimes(1);
    expect(clearFn).toHaveBeenCalledTimes(2);
    expect(detachFn).toHaveBeenCalledWith(123, false);
    expect(clearFn).toHaveBeenNthCalledWith(1, true, true);
    expect(clearFn).toHaveBeenNthCalledWith(2, true, false);
    expect(restoreAuthCookiesFn).toHaveBeenCalledWith([{ name: "session" }]);
    expect(simulateFn).toHaveBeenCalledWith(123);
    expect(searchFn).toHaveBeenCalledWith(3, 10, 20);
  });

  test("clears cookies before and after mobile when preserveRewards is disabled", async () => {
    const config = makeConfig({
      control: { clear: 1, act: 0, preserveRewards: 0 },
    });
    const clearFn = jest.fn().mockResolvedValue(true);
    const backupAuthCookiesFn = jest.fn();
    const restoreAuthCookiesFn = jest.fn();

    await runSearchPhases(
      { desk: 0, mob: 3, min: 10, max: 20 },
      "session-1",
      123,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        searchFn: jest.fn().mockResolvedValue(true),
        simulateFn: jest.fn().mockResolvedValue(true),
        clearFn,
        setConfig: jest.fn().mockResolvedValue(),
        getConfig: () => config,
        delayFn: jest.fn().mockResolvedValue(),
        shortestDelay: 100,
        detachFn: jest.fn().mockResolvedValue(),
        backupAuthCookiesFn,
        restoreAuthCookiesFn,
      },
    );

    expect(backupAuthCookiesFn).not.toHaveBeenCalled();
    expect(restoreAuthCookiesFn).not.toHaveBeenCalled();
    expect(clearFn).toHaveBeenNthCalledWith(1, true, true);
    expect(clearFn).toHaveBeenNthCalledWith(2, true, false);
  });

  test("does not clear cookies when the recovery backup is incomplete", async () => {
    const config = makeConfig({
      control: { clear: 1, act: 0, preserveRewards: 1 },
    });
    const clearFn = jest.fn().mockResolvedValue(true);
    const restoreAuthCookiesFn = jest
      .fn()
      .mockResolvedValue({ complete: false });

    await runSearchPhases(
      { desk: 0, mob: 1, min: 10, max: 20 },
      "session-1",
      123,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        searchFn: jest.fn().mockResolvedValue(true),
        simulateFn: jest.fn().mockResolvedValue(true),
        clearFn,
        setConfig: jest.fn().mockResolvedValue(),
        getConfig: () => config,
        delayFn: jest.fn().mockResolvedValue(),
        shortestDelay: 100,
        detachFn: jest.fn().mockResolvedValue(),
        backupAuthCookiesFn: jest.fn().mockResolvedValue({
          cookies: [{ name: "partial" }],
          complete: false,
          safeToClear: false,
        }),
        restoreAuthCookiesFn,
      },
    );

    expect(clearFn).toHaveBeenNthCalledWith(1, true, false);
    expect(restoreAuthCookiesFn).toHaveBeenCalledTimes(2);
  });
});

describe("handlePostSearchTasks()", () => {
  test("skips post-search clear before activities to preserve Rewards session", async () => {
    const config = makeConfig({ control: { clear: 1, act: 1 } });
    const clearFn = jest.fn().mockResolvedValue(true);
    const attachFn = jest.fn().mockResolvedValue(true);
    const clickFn = jest.fn().mockResolvedValue(true);
    const log = jest.fn();

    const result = await handlePostSearchTasks(
      { desk: 0, mob: 3 },
      "session-1",
      123,
      true,
      {
        isSessionStillActive: () => true,
        log,
        attachFn,
        detachFn: jest.fn().mockResolvedValue(),
        clearFn,
        clickFn,
        waitFn: jest.fn().mockResolvedValue(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
        removeTabFn: jest.fn().mockResolvedValue(),
        updateTabFn: jest.fn().mockResolvedValue(),
        activityFn: jest.fn().mockResolvedValue(true),
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result).toEqual({
      searchTabClosed: true,
      runSuccessful: true,
      searchSuccessful: true,
    });
    expect(clearFn).not.toHaveBeenCalled();
    expect(attachFn).not.toHaveBeenCalled();
    expect(clickFn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[POST_SEARCH] - Skipping post-search clear to preserve Rewards session before returning to Rewards.",
      "update",
    );
  });

  test("skips post-search clear after mobile even when activities are disabled", async () => {
    const config = makeConfig({ control: { clear: 1, act: 0 } });
    const clearFn = jest.fn().mockResolvedValue(true);
    const attachFn = jest.fn().mockResolvedValue(true);
    const clickFn = jest.fn().mockResolvedValue(true);
    const log = jest.fn();

    await handlePostSearchTasks({ desk: 0, mob: 3 }, "session-1", 123, true, {
      isSessionStillActive: () => true,
      log,
      attachFn,
      detachFn: jest.fn().mockResolvedValue(),
      clearFn,
      clickFn,
      waitFn: jest.fn().mockResolvedValue(),
      delayFn: jest.fn().mockResolvedValue(),
      createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
      removeTabFn: jest.fn().mockResolvedValue(),
      updateTabFn: jest.fn().mockResolvedValue(),
      activityFn: jest.fn().mockResolvedValue(true),
      shortestDelay: 100,
      rewards: "https://rewards.bing.com/",
      bing: "https://www.bing.com/",
      getConfig: () => config,
    });

    expect(clearFn).not.toHaveBeenCalled();
    expect(attachFn).not.toHaveBeenCalled();
    expect(clickFn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[POST_SEARCH] - Skipping post-search clear because mobile phase already cleared browsing data.",
      "update",
    );
  });

  test("keeps post-search clear when activities are disabled", async () => {
    const config = makeConfig({ control: { clear: 1, act: 0 } });
    const clearFn = jest.fn().mockResolvedValue(true);
    const attachFn = jest.fn().mockResolvedValue(true);
    const clickFn = jest.fn().mockResolvedValue(true);

    const updateTabFn = jest.fn().mockResolvedValue();

    await handlePostSearchTasks({ desk: 3, mob: 0 }, "session-1", 123, true, {
      isSessionStillActive: () => true,
      log: jest.fn(),
      attachFn,
      detachFn: jest.fn().mockResolvedValue(),
      clearFn,
      clickFn,
      waitFn: jest.fn().mockResolvedValue(),
      delayFn: jest.fn().mockResolvedValue(),
      createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
      removeTabFn: jest.fn().mockResolvedValue(),
      updateTabFn,
      activityFn: jest.fn().mockResolvedValue(true),
      shortestDelay: 100,
      rewards: "https://rewards.bing.com/",
      bing: "https://www.bing.com/",
      getConfig: () => config,
    });

    expect(attachFn).toHaveBeenCalledWith(123);
    expect(updateTabFn).toHaveBeenCalledWith(123, {
      url: "https://www.bing.com/",
      active: true,
    });
    expect(clearFn).toHaveBeenCalledWith();
    expect(clickFn).toHaveBeenCalledWith();
  });

  test("returns early when run was stopped before post-search cleanup", async () => {
    const config = makeConfig({ control: { clear: 1, act: 0 } });
    config.runtime.running = 0;
    const clearFn = jest.fn().mockResolvedValue(true);

    const result = await handlePostSearchTasks(
      { desk: 3, mob: 0 },
      "session-1",
      123,
      true,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        attachFn: jest.fn(),
        detachFn: jest.fn().mockResolvedValue(),
        clearFn,
        clickFn: jest.fn(),
        waitFn: jest.fn(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn(),
        removeTabFn: jest.fn(),
        updateTabFn: jest.fn(),
        activityFn: jest.fn(),
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result).toEqual({
      searchTabClosed: false,
      runSuccessful: false,
      searchSuccessful: false,
    });
    expect(clearFn).not.toHaveBeenCalled();
  });

  test("marks run unsuccessful when search phases failed even if activities are enabled", async () => {
    const config = makeConfig({ control: { clear: 1, act: 1 } });
    const activityFn = jest.fn().mockResolvedValue(true);

    const result = await handlePostSearchTasks(
      { desk: 3, mob: 0 },
      "session-1",
      123,
      false,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        attachFn: jest.fn().mockResolvedValue(),
        detachFn: jest.fn().mockResolvedValue(),
        clearFn: jest.fn().mockResolvedValue(),
        clickFn: jest.fn().mockResolvedValue(),
        waitFn: jest.fn().mockResolvedValue(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
        removeTabFn: jest.fn().mockResolvedValue(),
        updateTabFn: jest.fn().mockResolvedValue(),
        activityFn,
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result.runSuccessful).toBe(false);
    expect(result.searchSuccessful).toBe(false);
    expect(activityFn).toHaveBeenCalled();
  });

  test("keeps searchSuccessful when activities fail but searches completed", async () => {
    const config = makeConfig({ control: { clear: 1, act: 1 } });

    const result = await handlePostSearchTasks(
      { desk: 3, mob: 0 },
      "session-1",
      123,
      true,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        attachFn: jest.fn().mockResolvedValue(),
        detachFn: jest.fn().mockResolvedValue(),
        clearFn: jest.fn().mockResolvedValue(),
        clickFn: jest.fn().mockResolvedValue(),
        waitFn: jest.fn().mockResolvedValue(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
        removeTabFn: jest.fn().mockResolvedValue(),
        updateTabFn: jest.fn().mockResolvedValue(),
        activityFn: jest.fn().mockResolvedValue(false),
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result.runSuccessful).toBe(false);
    expect(result.searchSuccessful).toBe(true);
  });

  test("marks run unsuccessful when activity engine returns false", async () => {
    const config = makeConfig({ control: { clear: 1, act: 1 } });

    const result = await handlePostSearchTasks(
      { desk: 3, mob: 0 },
      "session-1",
      123,
      true,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        attachFn: jest.fn().mockResolvedValue(),
        detachFn: jest.fn().mockResolvedValue(),
        clearFn: jest.fn().mockResolvedValue(),
        clickFn: jest.fn().mockResolvedValue(),
        waitFn: jest.fn().mockResolvedValue(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
        removeTabFn: jest.fn().mockResolvedValue(),
        updateTabFn: jest.fn().mockResolvedValue(),
        activityFn: jest.fn().mockResolvedValue(false),
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result.runSuccessful).toBe(false);
  });

  test("marks run unsuccessful when activities throw", async () => {
    const config = makeConfig({ control: { clear: 1, act: 1 } });
    const activityFn = jest
      .fn()
      .mockRejectedValue(new Error("activity failed"));

    const result = await handlePostSearchTasks(
      { desk: 3, mob: 0 },
      "session-1",
      123,
      true,
      {
        isSessionStillActive: () => true,
        log: jest.fn(),
        attachFn: jest.fn().mockResolvedValue(),
        detachFn: jest.fn().mockResolvedValue(),
        clearFn: jest.fn().mockResolvedValue(),
        clickFn: jest.fn().mockResolvedValue(),
        waitFn: jest.fn().mockResolvedValue(),
        delayFn: jest.fn().mockResolvedValue(),
        createTabFn: jest.fn().mockResolvedValue({ id: 456 }),
        removeTabFn: jest.fn().mockResolvedValue(),
        updateTabFn: jest.fn().mockResolvedValue(),
        activityFn,
        shortestDelay: 100,
        rewards: "https://rewards.bing.com/",
        bing: "https://www.bing.com/",
        getConfig: () => config,
      },
    );

    expect(result.runSuccessful).toBe(false);
  });
});

describe("cleanupAfterRun()", () => {
  test("reschedules only for schedule sessions", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 0 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m3" },
    };
    config.runtime.currentSession = {
      id: "session-1",
      type: "search",
      startedAt: Date.now(),
    };
    const createAlarm = jest.fn().mockResolvedValue();
    const stopCurrentSession = jest.fn();
    const setConfig = jest.fn().mockResolvedValue();

    await cleanupAfterRun(null, "session-1", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession,
      setConfig,
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => true,
      clearBadgeFn: jest.fn().mockResolvedValue(),
    });

    expect(stopCurrentSession).toHaveBeenCalledWith("normal_finish");
    expect(createAlarm).not.toHaveBeenCalled();
  });

  test("arms the next schedule alarm after schedule sessions", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 0 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m4" },
    };
    config.runtime.currentSession = {
      id: "session-2",
      type: "schedule",
      startedAt: Date.now(),
    };
    const createAlarm = jest.fn().mockResolvedValue();
    const stopCurrentSession = jest.fn();
    const setConfig = jest.fn().mockResolvedValue();

    await cleanupAfterRun(null, "session-2", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession,
      setConfig,
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => true,
      clearBadgeFn: jest.fn().mockResolvedValue(),
      runSucceeded: true,
      getScheduleAlarmDelayMs: () => 900000,
      isScheduledModeActive: () => true,
    });

    expect(stopCurrentSession).toHaveBeenCalledWith("normal_finish");
    expect(createAlarm).toHaveBeenCalledWith(
      "schedule",
      expect.objectContaining({ when: expect.any(Number) }),
    );
  });

  test("re-arms schedule when searches succeed even if activities fail", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 1 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m3" },
    };
    config.runtime.currentSession = {
      id: "session-3b",
      type: "schedule",
      startedAt: Date.now(),
    };
    const createAlarm = jest.fn().mockResolvedValue();

    await cleanupAfterRun(null, "session-3b", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession: jest.fn().mockResolvedValue(),
      setConfig: jest.fn().mockResolvedValue(),
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => true,
      clearBadgeFn: jest.fn().mockResolvedValue(),
      runSucceeded: true,
      getScheduleAlarmDelayMs: () => 300000,
      isScheduledModeActive: () => true,
    });

    expect(createAlarm).toHaveBeenCalledWith(
      "schedule",
      expect.objectContaining({ when: expect.any(Number) }),
    );
  });

  test("re-arms schedule with backoff after failed runs", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 0 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m3" },
    };
    config.runtime.currentSession = {
      id: "session-3",
      type: "schedule",
      startedAt: Date.now(),
    };
    const createAlarm = jest.fn().mockResolvedValue();
    const normalDelayMs = 300000; // 5 minutes

    await cleanupAfterRun(null, "session-3", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession: jest.fn(),
      setConfig: jest.fn().mockResolvedValue(),
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => true,
      clearBadgeFn: jest.fn().mockResolvedValue(),
      runSucceeded: false,
      getScheduleAlarmDelayMs: () => normalDelayMs,
      isScheduledModeActive: () => true,
    });

    // Should still re-arm, but with doubled delay (backoff)
    expect(createAlarm).toHaveBeenCalledWith(
      "schedule",
      expect.objectContaining({ when: expect.any(Number) }),
    );
    const scheduledTime = createAlarm.mock.calls[0][1].when;
    const actualDelay = scheduledTime - Date.now();
    // Backoff doubles the delay: 300000 * 2 = 600000ms (capped at 1800000)
    expect(actualDelay).toBeGreaterThan(normalDelayMs);
    expect(actualDelay).toBeLessThanOrEqual(normalDelayMs * 2 + 100); // small tolerance
  });

  test("re-arms schedule after user stop when ended session type is provided", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 0 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m3" },
    };
    config.runtime.currentSession = null;
    config.runtime.running = 0;
    const createAlarm = jest.fn().mockResolvedValue();

    await cleanupAfterRun(null, "session-stop", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession: jest.fn(),
      setConfig: jest.fn().mockResolvedValue(),
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => false,
      clearBadgeFn: jest.fn().mockResolvedValue(),
      runSucceeded: false,
      endedSessionType: "schedule",
      getScheduleAlarmDelayMs: () => 300000,
      isScheduledModeActive: () => true,
    });

    expect(createAlarm).toHaveBeenCalledWith(
      "schedule",
      expect.objectContaining({ when: expect.any(Number) }),
    );
  });

  test("re-arms schedule after successful manual search when schedule mode is active", async () => {
    const config = {
      ...makeConfig({ control: { clear: 1, act: 0 } }),
      schedule: { desk: 6, mob: 4, min: 10, max: 20, mode: "m3" },
    };
    config.runtime.currentSession = {
      id: "session-4",
      type: "search",
      startedAt: Date.now(),
    };
    const createAlarm = jest.fn().mockResolvedValue();

    await cleanupAfterRun(null, "session-4", {
      removeTabFn: jest.fn().mockResolvedValue(),
      stopCurrentSession: jest.fn(),
      setConfig: jest.fn().mockResolvedValue(),
      createAlarm,
      log: jest.fn(),
      getConfig: () => config,
      isActiveSession: () => true,
      clearBadgeFn: jest.fn().mockResolvedValue(),
      runSucceeded: true,
      getScheduleAlarmDelayMs: () => 300000,
      isScheduledModeActive: () => true,
    });

    expect(createAlarm).toHaveBeenCalledWith(
      "schedule",
      expect.objectContaining({ when: expect.any(Number) }),
    );
  });
});
