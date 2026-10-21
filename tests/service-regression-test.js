'use strict';

const {parse} = require('acorn');
const {countCode, toContainSource, indexOfCode} =
    require('./source-assertions');
expect.extend({toContainSource});

const fs = require('fs');
const path = require('path');

const serviceSource = fs.readFileSync(
    path.join(__dirname, '../js/service.js'),
    'utf8',
);
const contentSource = fs.readFileSync(
    path.join(__dirname, '../js/content.js'),
    'utf8',
);
const popupSource = fs.readFileSync(
    path.join(__dirname, '../js/popup.js'),
    'utf8',
);
const popupHtml = fs.readFileSync(
    path.join(__dirname, '../popup.html'),
    'utf8',
);
const optionsSource = fs.readFileSync(
    path.join(__dirname, '../js/options.js'),
    'utf8',
);
const optionsHtml = fs.readFileSync(
    path.join(__dirname, '../options.html'),
    'utf8',
);
const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'),
);
const serviceProgram = parse(serviceSource, {
  ecmaVersion: 2022,
  sourceType: 'module',
});

/**
 * Returns the source of a top-level service worker function.
 * @param {string} name Function identifier.
 * @return {string} Declaration text from its start through its end.
 */
function serviceFunctionSource(name) {
  const node = serviceProgram.body.find(
      (entry) =>
          entry.type === 'FunctionDeclaration' && entry.id.name === name);
  if (!node || node.end <= node.start) {
    throw new Error(`Missing function declaration: ${name}`);
  }
  return serviceSource.slice(node.start, node.end);
}

/**
 * Visits every Acorn node under a root.
 * @param {!Object} node Acorn node to walk.
 * @param {function(!Object): void} visit Callback for each node.
 * @return {void}
 */
function walkServiceNodes(node, visit) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry.type === 'string') {
          walkServiceNodes(entry, visit);
        }
      }
    } else if (value && typeof value.type === 'string') {
      walkServiceNodes(value, visit);
    }
  }
}

/**
 * Returns the source of one ACTIONS switch case in the service worker.
 * @param {string} action Property name on ACTIONS, such as `SCHEDULE`.
 * @return {string} Case text from `case` through the end of that case.
 */
function actionsCaseSource(action) {
  let found = null;
  walkServiceNodes(serviceProgram, (node) => {
    const test = node.test;
    if (found || node.type !== 'SwitchCase' || !test) {
      return;
    }
    if (test.type === 'MemberExpression' && test.object.type === 'Identifier' &&
        test.object.name === 'ACTIONS' && test.property.type === 'Identifier' &&
        test.property.name === action) {
      found = node;
    }
  });
  if (!found || found.end <= found.start) {
    throw new Error(`Missing switch case ACTIONS.${action}`);
  }
  return serviceSource.slice(found.start, found.end);
}

/**
 * Loads the production default config factory.
 * @return {!Object} Default extension config.
 */
function loadDefaultConfig() {
  return loadEsmModule('../js/config-defaults.js').createDefaultConfig();
}

// Cookie helpers now live in js/cookies.js as an injectable factory. Load the
// module and build helpers backed by the supplied mock chrome.cookies object.
const {loadEsmModule} = require('./esm-loader.js');
const cookiesModule = loadEsmModule('../js/cookies.js');

/**
 * Builds cookie helpers against a mock cookies API.
 * @param {!Object} cookies Mock chrome.cookies implementation.
 * @return {!Object} Cleared-domain list and cookie helpers.
 */
function loadCookieHelpers(cookies) {
  const helpers = cookiesModule.createCookieHelpers({
    cookies,
    log: jest.fn(),
    /**
     * Reports that cookie helper logging is disabled.
     * @return {boolean} Always false in this fixture.
     */
    logEnabled: () => false,
  });
  return {
    CLEARED_COOKIE_DOMAINS: cookiesModule.CLEARED_COOKIE_DOMAINS,
    ...helpers,
  };
}

describe('service regressions', () => {
  test('default runtime stores the Rewards counter date', () => {
    const config = loadDefaultConfig();
    expect(config.runtime).toHaveProperty('searchCounterDate', '');
  });

  test('Rewards counter sync is centralized in the service worker', () => {
    expect(serviceSource)
        .toContainSource(
            'config.runtime.searchCounterDate = todayKey();',
        );
    expect(contentSource)
        .not.toContainSource('rewards.bing.com/api/getuserinfo');
    expect(contentSource)
        .not.toContainSource('nextConfig.runtime.searchCounterDate');
  });

  test('service worker clears persisted stale sessions on fresh loads', () => {
    expect(serviceSource)
        .toContainSource(
            'function clearActiveRuntimeState(reason = "stale_runtime")',
        );
    expect(serviceSource)
        .toContainSource(
            'async function applyStoredConfig(stored, reason = "load")',
        );
    expect(serviceSource)
        .toContainSource('const hadLiveInMemoryRun = Boolean(');
    expect(serviceSource)
        .toContainSource(
            'await applyStoredConfig(stored, `message:${message?.action || "unknown"}`);',
        );
  });

  test('popup schedule mode selection does not directly mutate alarms', () => {
    expect(popupSource).not.toContainSource('armScheduleAlarmForMode');
    expect(popupSource).not.toContainSource('chrome.alarms.clear("schedule")');
    expect(serviceSource)
        .toContainSource('await chrome.alarms.clear("schedule");');
  });

  test(
      'quick start uses saved search config and reports command outcomes',
      () => {
        expect(popupSource).toContainSource('action: ACTIONS.START');
        expect(popupSource).toContainSource('searches: { ...config.search }');
        expect(popupSource).toContainSource('action: ACTIONS.STOP');
        expect(popupSource)
            .toContainSource('chrome.storage.onChanged.addListener');
        expect(popupSource).toContainSource('await atomicUpdate((stored) => {');
        expect(serviceSource)
            .toContainSource(
                'const cleared = await clear(false, true);',
            );
        expect(serviceSource).toContainSource('success: cleared');
        expect(serviceSource)
            .toContainSource(
                'const simulated = await toggleSimulate();',
            );
        expect(serviceSource).toContainSource('success: simulated');
      });

  test('daily search plan ignores stale Rewards counters', () => {
    expect(serviceSource)
        .toContainSource('function resetStaleSearchCounters()');
    expect(serviceSource).toContainSource('function hasFreshSearchCounters()');
    expect(serviceSource)
        .toContainSource(
            'freshCounters && isDailySearchCounterDone(config?.runtime?.pcSearch)',
        );
    expect(serviceSource)
        .toContainSource(
            'freshCounters && isDailySearchCounterDone(config?.runtime?.mobileSearch)',
        );
  });

  test('search query selection keeps per-run template history', () => {
    // Template rotation logic now lives in js/search-plan.js and is covered by
    // real behaviour tests in tests/search-plan-test.js. Here we only assert
    // the service worker still wires the shared per-run history Set into the
    // picker.
    expect(serviceSource)
        .toContainSource(
            'let usedSearchQueryTemplates = new Set();',
        );
    expect(serviceSource).toContainSource('resetSearchQueryHistory();');
    expect(serviceSource)
        .toContainSource(
            'pickSearchTemplate(niche, queries, usedSearchQueryTemplates)',
        );
    expect(serviceSource).toContainSource('takeDynamicTopic()');
    expect(serviceSource).toContainSource('void startDynamicTopicPrefetch();');
    expect(serviceSource).toContainSource('dynamicTopicFirstWaitMs = 500');
    expect(serviceSource).toContainSource('Promise.race([');
    expect(serviceSource)
        .not.toContainSource(
            'searchQuery = queryList[Math.floor(Math.random() * queryList.length)]',
        );
  });

  test('topic prefetch is skipped for activity-only runs', () => {
    const initialiseSource = serviceFunctionSource('initialise');
    const activityOnlyIndex =
        indexOfCode(initialiseSource, 'if (!hasSearchPhase)');
    const historyResetIndex =
        indexOfCode(initialiseSource, 'resetSearchQueryHistory();');
    expect(activityOnlyIndex).toBeGreaterThan(-1);
    expect(historyResetIndex).toBeGreaterThan(activityOnlyIndex);

    expect(serviceFunctionSource('tryStartScheduledRun'))
        .not.toContainSource('resetSearchQueryHistory();');
  });

  test(
      'mobile sign-in is confirmed without diverting forced searches into click',
      () => {
        expect(serviceSource)
            .toContainSource('"before the first mobile search"');
        expect(serviceSource)
            .toContainSource('"after the mobile patch cleared cookies"');
        // Forced runs skip login-click except right after the mobile cookie
        // wipe.
        expect(serviceSource).toContainSource('const mobileLoginRequired =');
        expect(serviceSource)
            .toContainSource(
                'if (ignoreDailyQuota && !mobileLoginRequired)',
            );
        // Stall recovery on a forced run must not open the account menu either:
        // it only re-lands the tab on Bing (capturing the pre-navigation url so
        // the wait cannot resolve against the document being replaced).
        expect(serviceSource)
            .toContainSource(
                'if (ignoreDailyQuota) { const beforeNav = await getTabUrl(tabId); await chrome.tabs.update(tabId, {url: bing',
            );
        expect(serviceSource)
            .toContainSource(
                '[POST_SEARCH] Forced run: skipping post-search login click.',
            );
        expect(serviceSource)
            .toContainSource('if (!sessionReady && !ignoreDailyQuota)');
        expect(serviceSource)
            .not.toContainSource(
                '`before the first ${mobilePhase ? "mobile" : "desktop"} search`',
            );
        // A successful trusted hamburger press must still be followed by the
        // content-script step that inspects/clicks the actual Sign in menu
        // item.
        expect(serviceSource)
            .toContainSource('if (config?.runtime?.mobile || !success)');
        expect(serviceSource)
            .not.toContainSource('let clickedForPatch = false;');
        // Search submit is CDP Enter first, not the account-menu click() path.
        expect(serviceSource)
            .toContainSource('async function submitSearchViaDebugger');
        expect(serviceSource)
            .toContainSource('await submitSearchViaDebugger(tabId)');
      });

  test(
      'a manual start runs the requested plan regardless of today\'s counters',
      () => {
        // Pressing Search is an explicit request; answering it with "nothing
        // remaining for today" is not useful. Scheduled triggers must NOT pass
        // force, or a repeating alarm would re-run the whole plan all day.
        expect(serviceSource)
            .toContainSource(
                'await initialise(config?.search, searchSession.id, { force: true });',
            );
        expect(serviceFunctionSource('tryStartScheduledRun'))
            .not.toContainSource('force: true');
        // The force flag must be scoped to the run that set it.
        expect(serviceSource)
            .toContainSource('ignoreDailyQuota = Boolean(force);');
        expect(serviceSource).toContainSource('ignoreDailyQuota = false;');
        // A FULL counter still stops the phase: those searches provably earn
        // nothing. A merely FROZEN counter must not, because it is
        // indistinguishable from a Rewards API publishing in a slow batch, and
        // stopping on it dropped every remaining search of the plan.
        expect(serviceSource).toContainSource('earlyStopReason = "quota_full"');
        expect(serviceSource)
            .not.toContainSource('earlyStopReason = "plateau"');
        expect(serviceSource)
            .toContainSource(
                'slowing down but finishing the requested plan',
            );
        expect(serviceSource)
            .not.toContainSource(
                'continuing the requested search plan.',
            );
        // Forced runs skip multi-minute "stepped away" pauses; scheduled runs
        // keep them.
        expect(serviceSource)
            .toContainSource(
                'const longPauseIndices = ignoreDailyQuota',
            );
        // Desktop search must not clear Bing cache (mobile clear stays in
        // search-phases).
        expect(serviceSource)
            .not.toContainSource(
                'if (clearIt && !config?.runtime?.mobile) { await clear(); }',
            );
      });

  test(
      'activity confirmation does not count skips or zero-delta processed tabs as success',
      () => {
        expect(countCode(
                   serviceSource,
                   'const confirmedClick = Number.isFinite(pointDelta)',
                   ))
            .toBe(2);
        expect(countCode(
                   serviceSource,
                   'processed: confirmedClick ? processedTabs : 0',
                   ))
            .toBe(2);
        expect(serviceSource).not.toContainSource('passResult.skipped > 0 ||');
      });

  test(
      'auth cookie backup only reads Bing/Rewards domains cleared by mobile flow',
      async () => {
        const getAll = jest.fn(
            ({domain}) => Promise.resolve([
              {
                domain: domain === 'bing.com' ? '.bing.com' :
                                                'rewards.bing.com',
                path: '/',
                name: `cookie-${domain}`,
                value: 'value',
                secure: true,
              },
            ]),
        );
        const helpers = loadCookieHelpers({getAll});

        const snapshot = await helpers.backupAuthCookies();

        expect(helpers.CLEARED_COOKIE_DOMAINS).toEqual([
          'bing.com',
          'rewards.bing.com',
        ]);
        expect(getAll.mock.calls.map(([details]) => details.domain)).toEqual([
          'bing.com',
          'rewards.bing.com',
        ]);
        expect(snapshot.map((cookie) => cookie.name)).toEqual([
          'cookie-bing.com',
          'cookie-rewards.bing.com',
        ]);
      });

  test('post-search activities respect stop via isRuntimeActive', () => {
    expect(serviceSource)
        .toContainSource(
            'const shouldContinueActivity = () => isRuntimeActive();',
        );
    expect(serviceSource)
        .not.toContainSource('!interruptible || isRuntimeActive()');
  });

  test('manual schedule start persists config before initialise', () => {
    const scheduleCase = actionsCaseSource('SCHEDULE');
    const sessionIndex = indexOfCode(
        scheduleCase,
        'const scheduleSession = runCoordinator.startNewSession("schedule")',
    );
    const manualStartBlock = scheduleCase.slice(sessionIndex);
    const setIndex = indexOfCode(
        manualStartBlock,
        'await updateConfigSections({runtime: config.runtime});');
    const initialiseIndex = indexOfCode(
        manualStartBlock,
        'await initialise(config?.schedule, scheduleSession.id)',
    );
    expect(sessionIndex).toBeGreaterThan(-1);
    expect(setIndex).toBeGreaterThan(-1);
    expect(initialiseIndex).toBeGreaterThan(setIndex);
  });



  test('service worker handles unexpected debugger detach events', () => {
    expect(serviceSource)
        .toContainSource('chrome.debugger.onDetach.addListener');
  });

  test(
      'initialise passes ended session type into cleanup for schedule re-arm',
      () => {
        expect(serviceSource)
            .toContainSource(
                'const endedSessionType = config?.runtime?.currentSession?.type ?? null',
            );
        expect(serviceSource).toContainSource('endedSessionType,');
      });

  test('wait helpers respect interruptible run stop checks', () => {
    expect(serviceSource)
        .toContainSource(
            'async function wait(tabId, interruptible = true, { awayFrom = null } = {})',
        );
    expect(serviceSource).toContainSource('async function waitForUrl(');
    expect(serviceSource).toContainSource('interruptible = true');
  });

  test(
      'wait() cannot resolve against the document being navigated away from',
      () => {
        // chrome.tabs.update() resolves before the navigation commits, so a
        // bare tabs.get right after it still reports the OLD page as complete.
        // Every navigate-then-interact site in the search path must gate on
        // `awayFrom`, or the query gets typed into a document that is about to
        // be discarded.
        // The actual wait predicates and event lifecycle are exercised in
        // tab-wait-test.js; this assertion verifies the navigation call site.
        expect(serviceSource)
            .toContainSource(
                'await wait(tabId, true, { awayFrom: pageUrl })',
            );
      });

  test('typed query is verified against the box before submitting', () => {
    // typeBackspace swallows a dropped keystroke, so a lost typo correction
    // used to leave corrupted text in the box. Bing then credits that text
    // while perform() compares `q` to searchQuery exactly, calls the search
    // failed, and re-submits duplicates that earn nothing.
    expect(serviceSource).toContainSource('async function syncSearchInput(');
    expect(serviceSource)
        .toContainSource(
            'const synced = await syncSearchInput(tabId, searchQuery);',
        );
    expect(serviceSource)
        .toContainSource(
            'throw new Error("Search input vanished before submit.")',
        );
  });

  test(
      'a submit that reached a results page is not retried with the same query',
      () => {
        // Bing ignores a duplicate query fired seconds later, so re-sending one
        // that already landed on a SERP burns the retry for nothing.
        expect(serviceSource).toContainSource('let reuseOnRetry = true;');
        expect(serviceSource)
            .toContainSource(
                'reuse: attempt > 1 && reuseOnRetry && searchQuery !== previousQuery',
            );
        expect(serviceSource)
            .toContainSource('if (isConfirmedBingSearchUrl(landedUrl))');
      });

  test(
      'mobile sign-in waits for the login redirect chain instead of cancelling it',
      () => {
        // The next attempt's tabs.update used to cancel the in-flight
        // bing -> login.live.com -> bing chain, so all three attempts failed
        // and the whole mobile phase was dropped.
        expect(serviceSource).toContainSource('(url) => isBingPageUrl(url),');
        expect(serviceSource)
            .toContainSource('for (let probe = 0; probe < 4; probe++)');
      });

  test(
      'service worker bootstraps config before listeners rely on storage',
      () => {
        expect(serviceSource)
            .toContainSource('async function bootstrapConfig()');
        expect(serviceSource)
            .toContainSource('const configReady = bootstrapConfig();');
        expect(serviceSource).toContainSource('await configReady;');
        expect(serviceSource)
            .toContainSource('chrome.runtime.onInstalled.addListener');
        expect(serviceSource).toContainSource('await bootstrapConfig();');
        expect(serviceSource)
            .not.toContainSource('chrome.runtime.getURL(DONATE_PAGE)');
      });

  test('m2 schedule mode does not auto-start on counter refresh alarms', () => {
    expect(serviceSource).toContainSource('if (isScheduledModeActive())');
    expect(serviceSource)
        .toContainSource(
            'await tryStartScheduledRun("ALARM_CLEAR");',
        );
    expect(serviceSource)
        .toContainSource(
            'm2 runs at startup only, not on timed alarms',
        );
  });

  test('popup and options expose the approved safe flows', () => {
    expect(popupHtml).toContain('id="searchTrigger"');
    expect(popupHtml).toContain('id="runStatus"');
    expect(popupHtml).toContain('id="progressFill"');
    expect(popupHtml).toContain('id="openSettings"');
    expect(popupHtml).not.toContain('id="delete"');
    expect(popupHtml).not.toContain('id="reset"');
    expect(optionsHtml).not.toContain('id="delete"');
    expect(optionsHtml).not.toContain('id="clearCrashLog"');
    expect(optionsHtml).not.toContain('id="runtime"');
    expect(optionsSource)
        .toContainSource(
            'document.querySelector("#scheduleTrigger")',
        );
    expect(optionsSource).toContainSource('ACTIONS.SCHEDULE');
    expect(optionsSource).toContainSource('config?.runtime?.running');
  });
  test(
      'login click reports sign-in initiation instead of logged-in state',
      () => {
        expect(contentSource).toContainSource('signInInitiated: true');
        expect(contentSource).not.toContainSource('loggedIn: true');
      });

  test(
      'applyStoredConfig resets in-memory config when storage is cleared',
      () => {
        expect(serviceSource)
            .toContainSource('config = createDefaultConfig();');
        expect(serviceSource)
            .toContainSource(
                '`[CONFIG] Reset in-memory config to defaults (${reason}).`',
            );
        expect(serviceSource)
            .toContainSource('chrome.storage.onChanged.addListener');
        expect(serviceSource).toContainSource('storage_removed');
      });

  test('stop handler closes RSA tab after detaching debugger', () => {
    expect(serviceFunctionSource('handleUserStop'))
        .toContainSource('await chrome.tabs.remove(rsaTab)');
  });

  test('post-search warmup and activity runs use interruptible delays', () => {
    const searchPhasesSource = fs.readFileSync(
        path.join(__dirname, '../js/search-phases.js'),
        'utf8',
    );
    expect(searchPhasesSource)
        .toContainSource(
            'await delayFn(activityWarmupDelay, true);',
        );
    expect(searchPhasesSource)
        .toContainSource(
            'await activityFn(activityTabId, true);',
        );
    expect(searchPhasesSource)
        .not.toContainSource(
            'await activityFn(activityTabId, false);',
        );
  });

  test('content script does not load unused utils module', () => {
    expect(contentSource)
        .not.toContainSource(
            'import(chrome.runtime.getURL("js/utils.js"))',
        );
    expect(contentSource).not.toContainSource('await loadUtils');
  });

  test(
      'auth cookie restore does not overwrite cookies already recreated',
      async () => {
        const get = jest.fn(
            ({name}) => Promise.resolve(
                name === 'existing' ? {name, value: 'new'} : null),
        );
        const set = jest.fn().mockResolvedValue({});
        const helpers = loadCookieHelpers({get, set});

        const restored = await helpers.restoreAuthCookies([
          {
            domain: '.bing.com',
            path: '/',
            name: 'existing',
            value: 'old',
            secure: true,
          },
          {
            domain: '.bing.com',
            path: '/',
            name: 'missing',
            value: 'old',
            secure: true,
          },
        ]);

        expect(restored).toBe(1);
        expect(get).toHaveBeenCalledTimes(2);
        expect(set).toHaveBeenCalledTimes(1);
        expect(set.mock.calls[0][0])
            .toEqual(
                expect.objectContaining({
                  name: 'missing',
                  value: 'old',
                }),
            );
      });

  test('fingerprint patch is scoped to the automation tab through CDP', () => {
    const staticScripts = manifest.content_scripts.flatMap(
        (entry) => entry.js || [],
    );
    expect(staticScripts).not.toContain('/js/fingerprint.js');
    expect(serviceSource)
        .toContainSource('Page.addScriptToEvaluateOnNewDocument');
    expect(serviceSource).toContainSource('installFingerprintPatch(tabId)');
  });

  test(
      'Daily Set, Keep earning, and Claim use trusted CDP mouse presses',
      () => {
        expect(serviceSource)
            .toContainSource('async function dispatchTrustedPress');
        expect(serviceSource).toContainSource('trustedPressCommands(point,');
        expect(serviceSource)
            .toContainSource('touch: Boolean(config?.runtime?.mobile)');
        expect(serviceSource)
            .toContainSource(
                'await chrome.tabs.update(tabId, { active: true })',
            );
        expect(serviceSource).toContainSource('"DAILY SET"');
        expect(serviceSource).toContainSource('"KEEP EARNING"');
        expect(serviceSource).toContainSource('"CLAIM"');
        expect(serviceSource)
            .toContainSource(
                'createEarnActivityScript([...blockedKeys], 1, true)',
            );
        expect(serviceSource).toContainSource('refreshSolvePressPoint(');
        expect(serviceSource).toContainSource('refreshClaimPressPoint(');
      });

  test(
      'activity cleanup closes every tab opened after the pre-click snapshot',
      () => {
        const closeSource = serviceFunctionSource('closeOpenedActivityTabs');
        expect(closeSource)
            .toContainSource(
                'tabsToClose(allTabs, mainTabId, existingTabIds)',
            );
        expect(closeSource).not.toContainSource('isRewardActivityUrl');

        const processSource =
            serviceFunctionSource('processOpenedActivityTabs');
        expect(processSource)
            .toContainSource(
                'tabsToClose(allTabs, mainTabId, existingTabIds)',
            );
        expect(processSource)
            .not.toContainSource('Leaving non-reward tab open');
        expect(serviceSource)
            .toContainSource(
                'await closeOpenedActivityTabs(tabId, existingTabIds)',
            );
        expect(serviceSource)
            .toContainSource(
                'await closeOpenedActivityTabs(tabId, activityStartTabs)',
            );
      });

  test(
      'claim retries a React homepage that rendered before its claim widget',
      () => {
        const activitySource = serviceFunctionSource('activity');

        expect(activitySource).toContainSource('url: rewards,');
        expect(activitySource).toContainSource('let claimNoControlPasses = 0;');
        expect(activitySource)
            .toContainSource(
                'claimResult.reason === "no claim control found"',
            );
        expect(activitySource)
            .toContainSource('await chrome.tabs.reload(tabId);');
        expect(activitySource)
            .toContainSource('for (let pass = 1; pass <= 12; pass++)');
      });

  test('a preparatory Bing-search scroll receives another solver pass', () => {
    expect(serviceSource).toContainSource('if (value?.retry) {');
    expect(serviceSource)
        .toContainSource(
            'await delay(600 + Math.random() * 400, true)',
        );
    expect(serviceSource).toContainSource('value?.completed');
  });

  test(
      'post-search activities start on Dashboard for Daily Set, then use Earn',
      () => {
        expect(serviceSource).toContainSource('url: rewards + "dashboard"');
        expect(serviceSource).toContainSource('url: rewards + "earn"');
        expect(serviceSource).toContainSource('runApiOfferPass(');
        expect(serviceSource).toContainSource('collectPendingOffers');
      });

  test('Rewards session probe shares the current offer API contract', () => {
    const sessionProbe = serviceFunctionSource('checkRewardsApiSession');

    expect(sessionProbe).toContainSource('await fetchRewardsUserinfo()');
    expect(sessionProbe).toContainSource('data?.dashboard?.userStatus');
    expect(sessionProbe)
        .not.toContainSource(
            'fetch("https://rewards.bing.com/api/getuserinfo"',
        );
  });

  test(
      'an unverified Rewards probe only blocks a real Microsoft sign-in redirect',
      () => {
        const activitySource = serviceFunctionSource('activity');

        expect(serviceSource)
            .toContainSource('function isMicrosoftSignInUrl(url)');
        expect(activitySource)
            .toContainSource(
                'sessionFailed = isMicrosoftSignInUrl(activityUrl);',
            );
        expect(activitySource)
            .toContainSource(
                'Rewards session could not be confirmed; continuing with guarded card scan.',
            );
      });

  test('search path does not open organic result links', () => {
    // Visits were a major source of slow + flaky next-search behaviour.
    expect(serviceSource).not.toContainSource('createResultPickScript');
    expect(serviceSource).not.toContainSource('visitOneResult');
    expect(serviceSource).not.toContainSource('browseResults');
    expect(serviceSource)
        .toContainSource('async function stabilizeAfterSearch');
    expect(serviceSource).toContainSource('Closed');
    expect(serviceSource).toContainSource('stray tab');
  });

  test(
      'scheduled runs fail closed when Rewards counters are unavailable',
      () => {
        expect(serviceSource)
            .toContainSource(
                'Rewards counters unavailable; postponed scheduled run.',
            );
        expect(serviceSource)
            .toContainSource('keeping previous counters as unknown.');
      });

  test('completed runs do not download diagnostic log files', () => {
    expect(serviceSource).not.toContainSource('flushDiagnosticLog');
    expect(serviceSource).not.toContainSource('chrome.downloads');
    expect(manifest.permissions).not.toContain('downloads');
  });
});
