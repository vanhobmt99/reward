"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const serviceSource = fs.readFileSync(
  path.join(__dirname, "../js/service.js"),
  "utf8",
);
const contentSource = fs.readFileSync(
  path.join(__dirname, "../js/content.js"),
  "utf8",
);
const popupSource = fs.readFileSync(
  path.join(__dirname, "../js/popup.js"),
  "utf8",
);
const configDefaultsSource = fs.readFileSync(
  path.join(__dirname, "../js/config-defaults.js"),
  "utf8",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"),
);

function loadDefaultConfig() {
  const modified = `${configDefaultsSource.replace(
    /export function createDefaultConfig/,
    "function createDefaultConfig",
  )}
module.exports = { createDefaultConfig };
`;
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(modified, sandbox);
  return sandbox.module.exports.createDefaultConfig();
}

// Cookie helpers now live in js/cookies.js as an injectable factory. Load the
// module and build helpers backed by the supplied mock chrome.cookies object.
const { loadEsmModule } = require("./esm-loader.js");
const cookiesModule = loadEsmModule("../js/cookies.js");

function loadCookieHelpers(cookies) {
  const helpers = cookiesModule.createCookieHelpers({
    cookies,
    log: jest.fn(),
    logEnabled: () => false,
  });
  return {
    CLEARED_COOKIE_DOMAINS: cookiesModule.CLEARED_COOKIE_DOMAINS,
    ...helpers,
  };
}

describe("service regressions", () => {
  test("default runtime stores the Rewards counter date", () => {
    const config = loadDefaultConfig();
    expect(config.runtime).toHaveProperty("searchCounterDate", "");
  });

  test("Rewards counter sync is centralized in the service worker", () => {
    expect(serviceSource).toContain(
      "config.runtime.searchCounterDate = todayKey();",
    );
    expect(contentSource).not.toContain("rewards.bing.com/api/getuserinfo");
    expect(contentSource).not.toContain("nextConfig.runtime.searchCounterDate");
  });

  test("service worker clears persisted stale sessions on fresh loads", () => {
    expect(serviceSource).toContain(
      'function clearActiveRuntimeState(reason = "stale_runtime")',
    );
    expect(serviceSource).toContain(
      'async function applyStoredConfig(stored, reason = "load")',
    );
    expect(serviceSource).toContain("const hadLiveInMemoryRun = Boolean(");
    expect(serviceSource).toContain(
      'await applyStoredConfig(stored, `message:${message?.action || "unknown"}`);',
    );
  });

  test("popup schedule mode selection does not directly mutate alarms", () => {
    expect(popupSource).not.toContain("armScheduleAlarmForMode");
    expect(popupSource).not.toContain('chrome.alarms.clear("schedule")');
    expect(serviceSource).toContain('await chrome.alarms.clear("schedule");');
  });

  test("popup saves merge into latest config and command responses report real outcomes", () => {
    expect(popupSource).toContain("async function saveConfigMutation(mutator)");
    expect(popupSource).toContain(
      "const updated = await atomicUpdate((stored) => {",
    );
    expect(serviceSource).toContain(
      "const cleared = await clear(false, true);",
    );
    expect(serviceSource).toContain("success: cleared");
    expect(serviceSource).toContain(
      "const simulated = await toggleSimulate();",
    );
    expect(serviceSource).toContain("success: simulated");
  });

  test("daily search plan ignores stale Rewards counters", () => {
    expect(serviceSource).toContain("function resetStaleSearchCounters()");
    expect(serviceSource).toContain("function hasFreshSearchCounters()");
    expect(serviceSource).toContain(
      "freshCounters && isDailySearchCounterDone(config?.runtime?.pcSearch)",
    );
    expect(serviceSource).toContain(
      "freshCounters && isDailySearchCounterDone(config?.runtime?.mobileSearch)",
    );
  });

  test("search query selection keeps per-run template history", () => {
    // Template rotation logic now lives in js/search-plan.js and is covered by
    // real behaviour tests in tests/searchPlan.test.js. Here we only assert the
    // service worker still wires the shared per-run history Set into the picker.
    expect(serviceSource).toContain(
      "let usedSearchQueryTemplates = new Set();",
    );
    expect(serviceSource).toContain("resetSearchQueryHistory();");
    expect(serviceSource).toMatch(
      /pickSearchTemplate\(\s*niche,\s*queries,\s*usedSearchQueryTemplates,?\s*\)/,
    );
    expect(serviceSource).toContain("takeDynamicTopic()");
    expect(serviceSource).toContain("void startDynamicTopicPrefetch();");
    expect(serviceSource).toContain("dynamicTopicFirstWaitMs = 500");
    expect(serviceSource).toContain("Promise.race([");
    expect(serviceSource).not.toContain(
      "searchQuery = queryList[Math.floor(Math.random() * queryList.length)]",
    );
  });

  test("topic prefetch is skipped for activity-only runs", () => {
    const initialiseStart = serviceSource.indexOf("async function initialise(");
    const initialiseEnd = serviceSource.indexOf(
      "chrome.alarms.onAlarm.addListener",
      initialiseStart,
    );
    const initialiseSource = serviceSource.slice(
      initialiseStart,
      initialiseEnd,
    );
    expect(initialiseSource.indexOf("if (!hasSearchPhase)")).toBeGreaterThan(
      -1,
    );
    expect(
      initialiseSource.indexOf("resetSearchQueryHistory();"),
    ).toBeGreaterThan(initialiseSource.indexOf("if (!hasSearchPhase)"));

    const scheduledStart = serviceSource.indexOf(
      "async function tryStartScheduledRun(",
    );
    const scheduledEnd = serviceSource.indexOf(
      "function chromeStorageGet(",
      scheduledStart,
    );
    expect(serviceSource.slice(scheduledStart, scheduledEnd)).not.toContain(
      "resetSearchQueryHistory();",
    );
  });

  test("mobile sign-in is confirmed without diverting forced searches into click", () => {
    expect(serviceSource).toContain('"before the first mobile search"');
    expect(serviceSource).toContain('"after the mobile patch cleared cookies"');
    // Forced runs skip login-click except right after the mobile cookie wipe.
    expect(serviceSource).toContain("const mobileLoginRequired =");
    expect(serviceSource).toContain(
      "if (ignoreDailyQuota && !mobileLoginRequired)",
    );
    // Stall recovery on a forced run must not open the account menu either: it
    // only re-lands the tab on Bing (capturing the pre-navigation url so the
    // wait cannot resolve against the document being replaced).
    expect(serviceSource).toMatch(
      /if \(ignoreDailyQuota\) \{\s*const beforeNav = await getTabUrl\(tabId\);\s*await chrome\.tabs\.update\(tabId, \{ url: bing/,
    );
    expect(serviceSource).toContain(
      "[POST_SEARCH] Forced run: skipping post-search login click.",
    );
    expect(serviceSource).toContain("if (!sessionReady && !ignoreDailyQuota)");
    expect(serviceSource).not.toContain(
      '`before the first ${mobilePhase ? "mobile" : "desktop"} search`',
    );
    // A successful trusted hamburger press must still be followed by the
    // content-script step that inspects/clicks the actual Sign in menu item.
    expect(serviceSource).toContain("if (config?.runtime?.mobile || !success)");
    expect(serviceSource).not.toContain("let clickedForPatch = false;");
    // Search submit is CDP Enter first, not the account-menu click() path.
    expect(serviceSource).toContain("async function submitSearchViaDebugger");
    expect(serviceSource).toContain("await submitSearchViaDebugger(tabId)");
  });

  test("a manual start runs the requested plan regardless of today's counters", () => {
    // Pressing Search is an explicit request; answering it with "nothing
    // remaining for today" is not useful. Scheduled triggers must NOT pass
    // force, or a repeating alarm would re-run the whole plan all day.
    expect(serviceSource).toContain(
      "await initialise(config?.search, searchSession.id, { force: true });",
    );
    const scheduleStart = serviceSource.indexOf(
      "async function tryStartScheduledRun",
    );
    const scheduleEnd = serviceSource.indexOf("\nfunction ", scheduleStart);
    expect(serviceSource.slice(scheduleStart, scheduleEnd)).not.toContain(
      "force: true",
    );
    // The force flag must be scoped to the run that set it.
    expect(serviceSource).toContain("ignoreDailyQuota = Boolean(force);");
    expect(serviceSource).toContain("ignoreDailyQuota = false;");
    // A FULL counter still stops the phase: those searches provably earn
    // nothing. A merely FROZEN counter must not, because it is indistinguishable
    // from a Rewards API publishing in a slow batch, and stopping on it dropped
    // every remaining search of the plan.
    expect(serviceSource).toContain('earlyStopReason = "quota_full"');
    expect(serviceSource).not.toContain('earlyStopReason = "plateau"');
    expect(serviceSource).toContain(
      "slowing down but finishing the requested plan",
    );
    expect(serviceSource).not.toContain(
      "continuing the requested search plan.",
    );
    // Forced runs skip multi-minute "stepped away" pauses; scheduled runs keep them.
    expect(serviceSource).toContain(
      "const longPauseIndices = ignoreDailyQuota",
    );
    // Desktop search must not clear Bing cache (mobile clear stays in search-phases).
    expect(serviceSource).not.toContain(
      "if (clearIt && !config?.runtime?.mobile) await clear();",
    );
  });

  test("activity confirmation does not count skips or zero-delta processed tabs as success", () => {
    expect(
      serviceSource.match(
        /const confirmedClick = Number\.isFinite\(pointDelta\)/g,
      ),
    ).toHaveLength(2);
    expect(
      serviceSource.match(/processed: confirmedClick \? processedTabs : 0/g),
    ).toHaveLength(2);
    expect(serviceSource).not.toContain("passResult.skipped > 0 ||");
  });

  test("auth cookie backup only reads Bing/Rewards domains cleared by mobile flow", async () => {
    const getAll = jest.fn(({ domain }) =>
      Promise.resolve([
        {
          domain: domain === "bing.com" ? ".bing.com" : "rewards.bing.com",
          path: "/",
          name: `cookie-${domain}`,
          value: "value",
          secure: true,
        },
      ]),
    );
    const helpers = loadCookieHelpers({ getAll });

    const snapshot = await helpers.backupAuthCookies();

    expect(helpers.CLEARED_COOKIE_DOMAINS).toEqual([
      "bing.com",
      "rewards.bing.com",
    ]);
    expect(getAll.mock.calls.map(([details]) => details.domain)).toEqual([
      "bing.com",
      "rewards.bing.com",
    ]);
    expect(snapshot.map((cookie) => cookie.name)).toEqual([
      "cookie-bing.com",
      "cookie-rewards.bing.com",
    ]);
  });

  test("post-search activities respect stop via isRuntimeActive", () => {
    expect(serviceSource).toContain(
      "const shouldContinueActivity = () => isRuntimeActive();",
    );
    expect(serviceSource).not.toContain("!interruptible || isRuntimeActive()");
  });

  test("manual schedule start persists config before initialise", () => {
    const scheduleCase = serviceSource.slice(
      serviceSource.indexOf("case ACTIONS.SCHEDULE:"),
      serviceSource.indexOf("case ACTIONS.STOP:"),
    );
    const sessionIndex = scheduleCase.indexOf(
      'const scheduleSession = RunCoordinator.startNewSession("schedule")',
    );
    const manualStartBlock = scheduleCase.slice(sessionIndex);
    const setIndex = manualStartBlock.indexOf("await set(config);");
    const initialiseIndex = manualStartBlock.indexOf(
      "await initialise(config?.schedule, scheduleSession.id)",
    );
    expect(sessionIndex).toBeGreaterThan(-1);
    expect(setIndex).toBeGreaterThan(-1);
    expect(initialiseIndex).toBeGreaterThan(setIndex);
  });

  test("stop handler proactively cleans up keepalive, debugger, and badge", () => {
    expect(serviceSource).toContain("async function handleUserStop()");
    expect(serviceSource).toContain("searchKeepaliveCancel()");
    expect(serviceSource).toContain("await detach(rsaTab, false)");
    expect(serviceSource).toContain("config.runtime.rsaTab = null");
    expect(serviceSource).toContain("await set(config)");
    expect(serviceSource).toContain("case ACTIONS.STOP:");
    expect(serviceSource).toContain("await handleUserStop();");
  });

  test("service worker handles unexpected debugger detach events", () => {
    expect(serviceSource).toContain("chrome.debugger.onDetach.addListener");
  });

  test("initialise passes ended session type into cleanup for schedule re-arm", () => {
    expect(serviceSource).toContain(
      "const endedSessionType = config?.runtime?.currentSession?.type ?? null",
    );
    expect(serviceSource).toContain("endedSessionType,");
  });

  test("wait helpers respect interruptible run stop checks", () => {
    expect(serviceSource).toContain(
      "async function wait(tabId, interruptible = true, { awayFrom = null } = {})",
    );
    expect(serviceSource).toContain("async function waitForUrl(");
    expect(serviceSource).toContain("interruptible = true");
  });

  test("wait() cannot resolve against the document being navigated away from", () => {
    // chrome.tabs.update() resolves before the navigation commits, so a bare
    // tabs.get right after it still reports the OLD page as complete. Every
    // navigate-then-interact site in the search path must gate on `awayFrom`,
    // or the query gets typed into a document that is about to be discarded.
    expect(serviceSource).toContain(
      "const isStale = (url) => Boolean(awayFrom) && url === awayFrom;",
    );
    expect(serviceSource).toContain(
      'if (tab.status === "complete" && !isStale(tab.url || ""))',
    );
    expect(serviceSource).toContain(
      "await wait(tabId, true, { awayFrom: pageUrl })",
    );
  });

  test("typed query is verified against the box before submitting", () => {
    // typeBackspace swallows a dropped keystroke, so a lost typo correction used
    // to leave corrupted text in the box. Bing then credits that text while
    // perform() compares `q` to searchQuery exactly, calls the search failed, and
    // re-submits duplicates that earn nothing.
    expect(serviceSource).toContain("async function syncSearchInput(");
    expect(serviceSource).toContain(
      "const synced = await syncSearchInput(tabId, searchQuery);",
    );
    expect(serviceSource).toContain(
      'throw new Error("Search input vanished before submit.")',
    );
  });

  test("a submit that reached a results page is not retried with the same query", () => {
    // Bing ignores a duplicate query fired seconds later, so re-sending one that
    // already landed on a SERP burns the retry for nothing.
    expect(serviceSource).toContain("let reuseOnRetry = true;");
    expect(serviceSource).toContain(
      "reuse: attempt > 1 && reuseOnRetry && searchQuery !== previousQuery,",
    );
    expect(serviceSource).toContain("if (isConfirmedBingSearchUrl(landedUrl))");
  });

  test("mobile sign-in waits for the login redirect chain instead of cancelling it", () => {
    // The next attempt's tabs.update used to cancel the in-flight
    // bing -> login.live.com -> bing chain, so all three attempts failed and the
    // whole mobile phase was dropped.
    expect(serviceSource).toContain("(url) => isBingPageUrl(url),");
    expect(serviceSource).toContain("for (let probe = 0; probe < 4; probe++)");
  });

  test("service worker bootstraps config before listeners rely on storage", () => {
    expect(serviceSource).toContain("async function bootstrapConfig()");
    expect(serviceSource).toContain("const configReady = bootstrapConfig();");
    expect(serviceSource).toContain("await configReady;");
    expect(serviceSource).toContain("chrome.runtime.onInstalled.addListener");
    expect(serviceSource).toContain("await bootstrapConfig();");
  });

  test("m2 schedule mode does not auto-start on counter refresh alarms", () => {
    expect(serviceSource).toContain("if (isScheduledModeActive())");
    expect(serviceSource).toContain(
      'await tryStartScheduledRun("ALARM_CLEAR");',
    );
    expect(serviceSource).toContain(
      "m2 runs at startup only, not on timed alarms",
    );
  });

  test("popup stops active runs before runtime or extension reset", () => {
    expect(popupSource).toContain("async function stopActiveRunIfNeeded()");
    // Stop is now sent through the timeout wrapper using the shared ACTIONS enum.
    expect(popupSource).toContain(
      "sendMessageWithTimeout({ action: ACTIONS.STOP })",
    );
    // Registration markers stop at "$runtime.on(" / "$reset.on(" because the
    // handlers are wrapped in withConfirm(...) and prettier splits the
    // .on("click", ...) call across lines. The safety property under test —
    // both handlers stop an active run before wiping — is unchanged.
    const runtimeHandler = popupSource.slice(
      popupSource.indexOf("$runtime.on("),
      popupSource.indexOf("$reset.on("),
    );
    const resetHandler = popupSource.slice(
      popupSource.indexOf("$reset.on("),
      popupSource.indexOf("chrome.storage.onChanged.addListener"),
    );
    expect(runtimeHandler).toContain("await stopActiveRunIfNeeded();");
    expect(resetHandler).toContain("await stopActiveRunIfNeeded();");
  });

  test("popup paginates Bing history export and deletion", () => {
    expect(popupSource).toContain(
      "async function fetchBingHistoryLast24Hours()",
    );
    expect(popupSource).toContain("endTime: lastVisitTime");
    expect(popupSource).toContain("await fetchBingHistoryLast24Hours()");
  });

  test("popup shows Stop on schedule trigger while a run is active", () => {
    expect(popupSource).toContain('$scheduleTrigger.text("Dừng")');
  });

  test("login click reports sign-in initiation instead of logged-in state", () => {
    expect(contentSource).toContain("signInInitiated: true");
    expect(contentSource).not.toContain("loggedIn: true");
  });

  test("applyStoredConfig resets in-memory config when storage is cleared", () => {
    expect(serviceSource).toContain("config = createDefaultConfig();");
    expect(serviceSource).toContain(
      "[CONFIG] Reset in-memory config to defaults (${reason}).",
    );
    expect(serviceSource).toContain("chrome.storage.onChanged.addListener");
    expect(serviceSource).toContain("storage_removed");
  });

  test("stop handler closes RSA tab after detaching debugger", () => {
    const stopBlock = serviceSource.slice(
      serviceSource.indexOf("async function handleUserStop()"),
      serviceSource.indexOf(
        "(async function () {",
        serviceSource.indexOf("async function handleUserStop()"),
      ),
    );
    expect(stopBlock).toContain("await chrome.tabs.remove(rsaTab)");
  });

  test("post-search warmup and activity runs use interruptible delays", () => {
    const searchPhasesSource = fs.readFileSync(
      path.join(__dirname, "../js/search-phases.js"),
      "utf8",
    );
    expect(searchPhasesSource).toContain(
      "await delayFn(activityWarmupDelay, true);",
    );
    expect(searchPhasesSource).toContain(
      "await activityFn(activityTabId, true);",
    );
    expect(searchPhasesSource).not.toContain(
      "await activityFn(activityTabId, false);",
    );
  });

  test("popup waits for worker stop before reset actions", () => {
    const stopFn = popupSource.slice(
      popupSource.indexOf("async function stopActiveRunIfNeeded()"),
      popupSource.indexOf("async function fetchBingHistoryLast24Hours()"),
    );
    // Timeout window is a named constant (STOP_WAIT_TIMEOUT_MS = 15000).
    expect(stopFn).toContain(
      "const deadline = Date.now() + STOP_WAIT_TIMEOUT_MS",
    );
    expect(popupSource).toContain("const STOP_WAIT_TIMEOUT_MS = 15000;");
    expect(stopFn).toContain("return false");
    expect(stopFn).not.toContain("setTimeout(resolve, 150)");
  });

  test("popup aborts runtime reset when stop times out", () => {
    expect(popupSource).toContain("Stop timed out; runtime not reset");
    expect(popupSource).toContain("Stop timed out; extension not reset");
  });

  test("popup handles custom search mode labels", () => {
    expect(popupSource).toContain('config.search.mode = "custom"');
  });

  test("popup paginates history without skipping equal timestamps", () => {
    expect(popupSource).toContain("const excludedIds = new Set()");
    expect(popupSource).toContain("excludedIds.add(item.id)");
  });

  test("popup dedupes paginated Bing history results", () => {
    expect(popupSource).toContain("function dedupeHistoryEntries(entries)");
    expect(popupSource).toContain("return dedupeHistoryEntries(allResults);");
  });

  test("content script does not load unused utils module", () => {
    expect(contentSource).not.toContain(
      'import(chrome.runtime.getURL("js/utils.js"))',
    );
    expect(contentSource).not.toContain("await loadUtils");
  });

  test("auth cookie restore does not overwrite cookies already recreated", async () => {
    const get = jest.fn(({ name }) =>
      Promise.resolve(name === "existing" ? { name, value: "new" } : null),
    );
    const set = jest.fn().mockResolvedValue({});
    const helpers = loadCookieHelpers({ get, set });

    const restored = await helpers.restoreAuthCookies([
      {
        domain: ".bing.com",
        path: "/",
        name: "existing",
        value: "old",
        secure: true,
      },
      {
        domain: ".bing.com",
        path: "/",
        name: "missing",
        value: "old",
        secure: true,
      },
    ]);

    expect(restored).toBe(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "missing",
        value: "old",
      }),
    );
  });

  test("fingerprint patch is scoped to the automation tab through CDP", () => {
    const staticScripts = manifest.content_scripts.flatMap(
      (entry) => entry.js || [],
    );
    expect(staticScripts).not.toContain("/js/fingerprint.js");
    expect(serviceSource).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(serviceSource).toContain("installFingerprintPatch(tabId)");
  });

  test("Daily Set, Keep earning, and Claim use trusted CDP mouse presses", () => {
    expect(serviceSource).toContain("async function dispatchTrustedPress");
    expect(serviceSource).toContain('"DAILY SET"');
    expect(serviceSource).toContain('"KEEP EARNING"');
    expect(serviceSource).toContain('"CLAIM"');
    expect(serviceSource).toContain(
      "createEarnActivityScript([...blockedKeys], 1, true)",
    );
    expect(serviceSource).toContain("refreshSolvePressPoint(");
    expect(serviceSource).toContain("refreshClaimPressPoint(");
  });

  test("search path does not open organic result links", () => {
    // Visits were a major source of slow + flaky next-search behaviour.
    expect(serviceSource).not.toContain("createResultPickScript");
    expect(serviceSource).not.toContain("visitOneResult");
    expect(serviceSource).not.toContain("browseResults");
    expect(serviceSource).toContain("async function stabilizeAfterSearch");
    expect(serviceSource).toContain("Closed");
    expect(serviceSource).toContain("stray tab");
  });

  test("scheduled runs fail closed when Rewards counters are unavailable", () => {
    expect(serviceSource).toContain(
      "Rewards counters unavailable; postponed scheduled run.",
    );
    expect(serviceSource).toContain("keeping previous counters as unknown.");
  });

  test("completed runs do not download diagnostic log files", () => {
    expect(serviceSource).not.toContain("flushDiagnosticLog");
    expect(serviceSource).not.toContain("chrome.downloads");
    expect(manifest.permissions).not.toContain("downloads");
  });
});
