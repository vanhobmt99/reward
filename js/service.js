import { queries as queriesBase } from "/js/queries.js";
import { queriesExtra } from "/js/queries_extra.js";
import { queriesV1 } from "/js/queries_v1.js";
// Merge every query source ADDITIVELY per niche group. Spreading the objects
// (`{ ...base, ...extra }`) let a later source's array replace an earlier one
// for any shared key (e.g. "sports", "food"), silently dropping ~450 queries.
// Concatenating keeps them all and folds in the real-world v1 query pool.
const queries = {};
for (const source of [queriesBase, queriesExtra, queriesV1]) {
  for (const [group, list] of Object.entries(source)) {
    if (!Array.isArray(list)) continue;
    queries[group] = (queries[group] || []).concat(list);
  }
}
import {
  log,
  set,
  get,
  resetRuntime,
  applyConfigDefaults,
  getRewardsSearchCounterDone,
  isDailySearchCounterDone,
} from "/js/utils.js";
import {
  getScheduleAlarmDelayMs,
  isScheduledModeActive as isScheduleModeActive,
  armScheduleAlarmForMode,
  getDailyAlarmWhen,
  normalizeDailyTime,
} from "/js/schedule-utils.js";
import {
  createIsSessionStillActive,
  createRunCoordinator,
} from "/js/run-coordinator.js";
import {
  runSearchPhases,
  handlePostSearchTasks,
  cleanupAfterRun,
} from "/js/search-phases.js";
import { createDefaultConfig } from "/js/config-defaults.js";
import { buildRewardsSnapshot, getScoreDelta } from "/js/rewards-metrics.js";
import { formatActivityDiag } from "/js/activity-pass-utils.js";
import {
  migrateActivityMemory,
  getBlockedActivityKeys,
  confirmActivityKeys,
  markUnconfirmedActivityKeys,
} from "/js/activity-memory.js";
import {
  DEFAULT_SEARCH_DELAY_MIN as defaultSearchDelayMin,
  DEFAULT_SEARCH_DELAY_MAX as defaultSearchDelayMax,
  MINIMUM_SEARCH_DELAY as minimumSearchDelay,
  normalizeSearchPlan,
  hasSearchWork,
  chooseSearchTemplate as pickSearchTemplate,
} from "/js/search-plan.js";
import {
  todayKey,
  areCountersFresh,
  limitPlanForCompletedCounters,
} from "/js/daily-counters.js";
import { ACTIONS } from "/js/messages.js";
import {
  createDashboardActivityScript,
  createEarnActivityScript,
  createSolveActivityScript,
  createClaimReadyScript,
  createResultPickScript,
} from "/js/injected-scripts.js";
import { createCookieHelpers } from "/js/cookies.js";
import { installGlobalCrashHandlers, recordCrash } from "/js/crash-logger.js";

import {
  isRewardActivityUrl as isTrustedRewardActivityUrl,
  isActivityOpenedTab as isTrustedActivityOpenedTab,
  DEFAULT_REWARD_HOSTS as msDomains,
} from "/js/activity-tabs.js";
import {
  isConfirmedBingSearchUrl,
  isCompleteSearchCount,
} from "/js/search-results.js";
import {
  fetchSuggestions,
  buildQueryBurst,
  fetchDynamicTopics,
  createDynamicTopicCache,
  readFreshDynamicTopicCache,
  DYNAMIC_TOPIC_CACHE_TTL_MS,
} from "/js/query-sources.js";
import {
  planTypingSteps,
  createNicheSession,
  planScrollSteps,
  humanReadDelayMs,
  planLongPauseIndices,
  longPauseMs,
} from "/js/human-behavior.js";

installGlobalCrashHandlers();

const bing = "https://www.bing.com/";
const rewards = "https://rewards.bing.com/";

const loading = "/loading.html?type=";
let config = createDefaultConfig();
let logs = config?.control?.log;
let needPatch = false;
let searchQuery = "";
let usedSearchQueryTemplates = new Set();
// Set for the duration of a manual run: the user asked for these searches, so
// neither the plan trimming nor the "daily quota is full" early stop applies.
let ignoreDailyQuota = false;
// Topic run for the current session: keeps consecutive queries inside one
// subject for a few searches instead of re-rolling the category every time.
let nicheSession = null;
// Remaining queries in the current topic run (seed + its live refinements).
let queryBurst = [];
const dynamicTopicCacheKey = "_dynamicQueryTopicsV1";
const dynamicTopicFirstWaitMs = 500;
const dynamicTopicFailureRetryMs = 5 * 60 * 1000;
let dynamicTopicPool = [];
let usedDynamicTopics = new Set();
let dynamicTopicPromise = null;
let dynamicTopicLocaleKey = "";
let dynamicTopicLoadedAt = 0;
let shortestDelay = 1000;
let mediumDelay = 3000;
let longestDelay = 15000;
let searchKeepaliveCancel = null;
const typingDelayMin = 55;
const typingDelayMax = 125;
const preSubmitDelayMin = 700;
const preSubmitDelayMax = 1700;
const failedSearchSettleDelayMin = 1200;
const failedSearchSettleDelayMax = 2600;
// How many times one search is re-attempted before it counts as failed.
const searchAttempts = 3;
const searchRetryDelayMin = 1800;
const searchRetryDelayMax = 3200;
// Share of searches that end in opening one of the results, and how long that
// page is read for. A click-through rate of exactly 0 across every search of
// every day is not a rate a person produces.
const resultVisitChance = 0.2;
const resultDwellMin = 9000;
const resultDwellMax = 26000;
const finalSearchSettleDelayMax = 8000;
const runtimeDefaults = { ...config.runtime };

// Last cursor position, remembered across clicks so the pointer travels from
// where it "was" rather than teleporting to each target.
let lastMouseX = Math.floor(100 + Math.random() * 600);
let lastMouseY = Math.floor(100 + Math.random() * 400);

// Build a curved, eased sequence of points from (fromX,fromY) to (toX,toY) so
// desktop mouse movement looks human instead of a single instant jump.
function generateMousePath(fromX, fromY, toX, toY, steps = 8) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ease-in-out: accelerate then decelerate.
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    // Slight lateral bow so the path is an arc, not a straight line.
    const curveOffset = Math.sin(t * Math.PI) * (5 + Math.random() * 10);
    const x = fromX + (toX - fromX) * ease + (Math.random() - 0.5) * 2;
    const y = fromY + (toY - fromY) * ease + curveOffset;
    points.push({ x, y });
  }
  return points;
}

// Client Hints (Sec-CH-UA-*) metadata matching the emulated device. Returns
// null for iOS/WebKit, which does not support Client Hints — sending them there
// would contradict the UA string and give the emulation away. Overriding only
// the UA string (without this) leaves the Sec-CH-UA HTTP headers reporting the
// real desktop, an inconsistency Bing can use to reject mobile points.
function getUAMetadata(device) {
  const ua = device?.ua || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return null;

  let platform = "Android";
  let platformVersion = "15.0.0";
  const androidMatch = ua.match(/Android\s+([0-9.]+)/);
  if (androidMatch) {
    platformVersion = androidMatch[1];
  } else if (!/Android/i.test(ua)) {
    // Non-Android, non-iOS UA (unusual for our device list) — treat as desktop.
    platform = "Windows";
  }

  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const edgeMatch = ua.match(/EdgA?\/(\d+)/);
  const version = chromeMatch
    ? chromeMatch[1]
    : edgeMatch
      ? edgeMatch[1]
      : "131";

  const brands = [
    { brand: "Not_A Brand", version: "8" },
    { brand: "Chromium", version },
    edgeMatch
      ? { brand: "Microsoft Edge", version: edgeMatch[1] }
      : { brand: "Google Chrome", version },
  ];

  return {
    brands,
    fullVersion: version + ".0.0.0",
    platform,
    platformVersion,
    architecture: "arm64",
    model: device?.name || "",
    mobile: true,
  };
}

// Build the Network.setUserAgentOverride payload, attaching Client Hints
// metadata when the platform supports it so Sec-CH-UA-* headers stay consistent
// with the spoofed UA string.
function buildUAOverride(device) {
  const payload = { userAgent: device?.ua };
  const metadata = getUAMetadata(device);
  if (metadata) payload.userAgentMetadata = metadata;
  return payload;
}

// Real phones report multiple simultaneous touch points; keep this consistent
// with the emulated platform instead of the desktop-ish default of 1.
function getMaxTouchPoints(device) {
  return /iPhone|iPad|iPod/i.test(device?.ua || "") ? 5 : 10;
}

const activityMemoryKey = "activityMemory";
const maxActivityRunsPerDay = 2;

function isRuntimeActive() {
  return Boolean(config?.runtime?.running || config?.runtime?.act);
}

const { backupAuthCookiesDetailed, restoreAuthCookiesDetailed } =
  createCookieHelpers({
    cookies: chrome.cookies,
    log,
    logEnabled: () => logs,
  });

// The mobile-points flow clears login cookies and restores them afterwards. If
// the MV3 worker is killed in that window the in-memory snapshot is lost and the
// user stays logged out for good. So we also mirror the snapshot to storage
// before clearing and drop it once restore succeeds; bootstrap restores any
// leftover snapshot from an interrupted run.
const persistedAuthCookiesKey = "_pendingAuthCookieRestore";

async function persistAuthCookieSnapshot(snapshot) {
  try {
    if (Array.isArray(snapshot) && snapshot.length) {
      await chrome.storage.local.set({ [persistedAuthCookiesKey]: snapshot });
      return true;
    }
    return false;
  } catch (error) {
    logs &&
      log(
        `[COOKIES] Could not persist auth snapshot: ${error.message}`,
        "warning",
      );
  }
}

async function clearPersistedAuthCookieSnapshot() {
  try {
    await chrome.storage.local.remove(persistedAuthCookiesKey);
  } catch (error) {
    /* best-effort */
  }
}

async function restorePendingAuthCookies() {
  let snapshot = null;
  try {
    const res = await chrome.storage.local.get(persistedAuthCookiesKey);
    snapshot = res?.[persistedAuthCookiesKey];
  } catch (error) {
    return;
  }
  if (!Array.isArray(snapshot) || !snapshot.length) return;
  let restoreComplete = false;
  try {
    logs &&
      log(
        `[RECOVERY] Restoring ${snapshot.length} auth cookies left over from an interrupted mobile run.`,
        "warning",
      );
    const result = await restoreAuthCookiesDetailed(snapshot);
    restoreComplete = result.complete;
  } catch (error) {
    logs &&
      log(
        `[RECOVERY] Could not restore pending auth cookies: ${error.message}`,
        "warning",
      );
  } finally {
    if (restoreComplete) {
      await clearPersistedAuthCookieSnapshot();
    }
  }
}

function applyConfig(stored) {
  let countersReset = false;
  if (stored) {
    const activeRunKeys = [
      "done",
      "failed",
      "total",
      "rsaTab",
      "running",
      "currentSession",
      "currentPhase",
      "act",
      "mobile",
      "mode",
    ];
    const preservedRuntime = {};
    if (config?.runtime?.running) {
      for (const key of activeRunKeys) {
        if (config.runtime[key] !== undefined) {
          preservedRuntime[key] = config.runtime[key];
        }
      }
    }
    applyConfigDefaults(config, stored);
    config.runtime = {
      ...runtimeDefaults,
      ...(stored.runtime || {}),
      ...preservedRuntime,
    };
    countersReset = resetStaleSearchCounters();
  }
  logs = Boolean(config?.control?.log);
  return countersReset;
}

function clearActiveRuntimeState(reason = "stale_runtime") {
  if (!config?.runtime) return false;
  const hadActiveState = Boolean(
    config.runtime.running ||
    config.runtime.currentSession ||
    config.runtime.currentPhase ||
    config.runtime.act ||
    config.runtime.mobile,
  );
  if (!hadActiveState) return false;

  config.runtime.running = 0;
  config.runtime.mode = null;
  config.runtime.currentSession = null;
  config.runtime.currentPhase = null;
  config.runtime.act = 0;
  config.runtime.mobile = 0;
  config.runtime.rsaTab = null;
  logs && log(`[RUNTIME] - Cleared ${reason} active runtime state.`, "warning");
  return true;
}

async function applyStoredConfig(stored, reason = "load") {
  const hadLiveInMemoryRun = Boolean(
    config?.runtime?.running && config?.runtime?.currentSession,
  );
  let countersReset = false;
  if (stored) {
    countersReset = applyConfig(stored);
  } else if (!hadLiveInMemoryRun) {
    config = createDefaultConfig();
    logs = Boolean(config?.control?.log);
    logs &&
      log(`[CONFIG] Reset in-memory config to defaults (${reason}).`, "update");
    return false;
  }
  if (!config?.runtime?.running) {
    if (countersReset) await set(config);
    return false;
  }
  if (hadLiveInMemoryRun) return false;
  // Capture the orphaned automation tab BEFORE clearActiveRuntimeState nulls it,
  // so we can detach its debugger and close it after a worker death.
  const staleTab = Number(config?.runtime?.rsaTab) || null;
  const cleared = clearActiveRuntimeState(`${reason} stale session`);
  if (cleared || countersReset) {
    await set(config);
  }
  if (cleared) {
    await cleanupStaleRun(staleTab);
  }
  return cleared;
}

// Recover from a service worker that died mid-run: restore any login cookies we
// had cleared for the mobile phase, then detach the debugger from and close the
// orphaned automation tab so its "being debugged" banner and mobile emulation
// don't linger.
async function cleanupStaleRun(staleTab) {
  await restorePendingAuthCookies();
  staleTab = Number(staleTab) || null;
  if (staleTab) {
    try {
      await chrome.debugger.detach({ tabId: staleTab });
    } catch (error) {
      /* not attached / already gone */
    }
    try {
      await chrome.tabs.remove(staleTab);
      logs &&
        log(
          `[RECOVERY] Closed orphaned automation tab ${staleTab}.`,
          "warning",
        );
    } catch (error) {
      /* tab already closed */
    }
  }
}

// Alarms are lost when the worker is killed mid-run (the schedule alarm is
// cleared at the start of every run and only re-armed on clean finish). Recreate
// the daily counter-refresh alarms and re-arm the periodic schedule alarm on
// every worker startup if they are missing. All creations are conditional so we
// never reset a pending timer.
async function ensureAlarms() {
  try {
    const nextAtHour = (hour) => {
      const t = new Date();
      t.setHours(hour, 0, 0, 0);
      if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1);
      return t.getTime();
    };
    if (!(await chrome.alarms.get("clear"))) {
      await chrome.alarms.create("clear", {
        when: nextAtHour(6),
        periodInMinutes: 24 * 60,
      });
    }
    if (!(await chrome.alarms.get("clear_afternoon"))) {
      await chrome.alarms.create("clear_afternoon", {
        when: nextAtHour(15),
        periodInMinutes: 24 * 60,
      });
    }
    if (isScheduledModeActive() && !config?.runtime?.running) {
      if (!(await chrome.alarms.get("schedule"))) {
        await armScheduleAlarm(config?.schedule?.mode);
        logs &&
          log(
            `[ALARMS] Re-armed missing schedule alarm after worker restart.`,
            "warning",
          );
      }
    }
    // m5 uses its own periodic daily alarm; recreate it if Chrome dropped it
    // (alarms don't survive extension updates/reloads).
    if (config?.schedule?.mode === "m5") {
      if (!(await chrome.alarms.get("schedule_daily"))) {
        await armDailyScheduleAlarm();
        logs &&
          log(
            `[ALARMS] Re-armed missing daily schedule alarm after worker restart.`,
            "warning",
          );
      }
    } else {
      // Leaving m5 (or fresh install): make sure no stale daily alarm lingers.
      await chrome.alarms.clear("schedule_daily");
    }
  } catch (error) {
    logs &&
      log(`[ALARMS] Could not ensure alarms: ${error.message}`, "warning");
  }
}

function resetStaleSearchCounters() {
  const currentDate = todayKey();
  config.runtime = config.runtime || {};
  if (config.runtime.searchCounterDate === currentDate) return false;
  config.runtime.pcSearch = 0;
  config.runtime.mobileSearch = 0;
  config.runtime.searchCounterDate = currentDate;
  return true;
}

function hasFreshSearchCounters() {
  return areCountersFresh(config?.runtime, todayKey());
}

function getBackgroundTopicLocale() {
  const locale = String(
    globalThis.navigator?.language ||
      globalThis.navigator?.languages?.[0] ||
      "en-US",
  );
  const [rawLanguage, rawRegion] = locale.split("-");
  const configuredRegion = String(config?.user?.countryCode || "").trim();
  return {
    languageCode: /^[a-z]{2,3}$/i.test(rawLanguage)
      ? rawLanguage.toLowerCase()
      : "en",
    regionCode: /^[a-z]{2}$/i.test(configuredRegion)
      ? configuredRegion.toUpperCase()
      : /^[a-z]{2}$/i.test(rawRegion)
        ? rawRegion.toUpperCase()
        : "US",
  };
}

function startDynamicTopicPrefetch() {
  if ((config?.control?.niche || "random") !== "random") {
    return Promise.resolve([]);
  }

  const locale = getBackgroundTopicLocale();
  const localeKey = `${locale.languageCode}:${locale.regionCode}`;
  const cacheAge = Date.now() - dynamicTopicLoadedAt;
  const freshnessWindow =
    dynamicTopicPool.length > 0
      ? DYNAMIC_TOPIC_CACHE_TTL_MS
      : dynamicTopicFailureRetryMs;
  const sameLocale = dynamicTopicLocaleKey === localeKey;
  const freshInMemory =
    dynamicTopicLoadedAt > 0 && cacheAge >= 0 && cacheAge <= freshnessWindow;
  if (
    dynamicTopicPromise &&
    sameLocale &&
    (dynamicTopicLoadedAt === 0 || freshInMemory)
  ) {
    return dynamicTopicPromise;
  }

  dynamicTopicLocaleKey = localeKey;
  dynamicTopicLoadedAt = 0;
  dynamicTopicPool = [];
  usedDynamicTopics = new Set();

  dynamicTopicPromise = (async () => {
    try {
      const cached = await chromeStorageGet(dynamicTopicCacheKey);
      const cachedTopics = readFreshDynamicTopicCache(
        cached?.[dynamicTopicCacheKey],
        Date.now(),
        DYNAMIC_TOPIC_CACHE_TTL_MS,
        locale,
      );
      if (dynamicTopicLocaleKey !== localeKey) return [];
      if (cachedTopics.length > 0) {
        dynamicTopicPool = cachedTopics;
        dynamicTopicLoadedAt = Number(cached?.[dynamicTopicCacheKey]?.savedAt);
        logs &&
          log(
            `[QUERY] - Loaded ${cachedTopics.length} background topics from cache.`,
            "update",
          );
        return dynamicTopicPool;
      }
    } catch (error) {
      logs &&
        log(
          `[QUERY] - Dynamic topic cache unavailable: ${error.message}`,
          "warning",
        );
    }

    const topics = await fetchDynamicTopics({
      ...locale,
      limit: 60,
    });
    if (dynamicTopicLocaleKey !== localeKey) return [];
    dynamicTopicPool = topics;
    dynamicTopicLoadedAt = Date.now();
    if (topics.length > 0) {
      try {
        await chromeStorageSet({
          [dynamicTopicCacheKey]: createDynamicTopicCache(
            topics,
            dynamicTopicLoadedAt,
            locale,
          ),
        });
      } catch (error) {
        logs &&
          log(
            `[QUERY] - Could not cache dynamic topics: ${error.message}`,
            "warning",
          );
      }
      logs &&
        log(
          `[QUERY] - Prepared ${topics.length} live topics in the background.`,
          "update",
        );
    } else {
      logs &&
        log(
          "[QUERY] - Live topic sources unavailable; local topic pool will be used.",
          "warning",
        );
    }
    return dynamicTopicPool;
  })().catch((error) => {
    if (dynamicTopicLocaleKey !== localeKey) return [];
    logs &&
      log(
        `[QUERY] - Background topic preparation failed: ${error.message}`,
        "warning",
      );
    dynamicTopicPool = [];
    dynamicTopicLoadedAt = Date.now();
    return [];
  });

  return dynamicTopicPromise;
}

async function takeDynamicTopic() {
  const pendingTopics = startDynamicTopicPrefetch();
  let timer = null;
  const topics =
    dynamicTopicPool.length > 0
      ? dynamicTopicPool
      : await Promise.race([
          pendingTopics,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve([]), dynamicTopicFirstWaitMs);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
  if (!Array.isArray(topics) || topics.length === 0) return "";

  let available = topics.filter(
    (topic) => !usedDynamicTopics.has(topic.toLocaleLowerCase()),
  );
  if (available.length === 0) {
    usedDynamicTopics = new Set();
    available = topics;
  }
  const topic = available[Math.floor(Math.random() * available.length)] || "";
  if (topic) usedDynamicTopics.add(topic.toLocaleLowerCase());
  return topic;
}

function resetSearchQueryHistory() {
  usedSearchQueryTemplates = new Set();
  usedDynamicTopics = new Set();
  nicheSession = null;
  queryBurst = [];
  // Warm the live topic pool while the automation tab is being prepared.
  // The first query awaits this same promise only when the prefetch is not done.
  void startDynamicTopicPrefetch();
}

const RunCoordinator = createRunCoordinator({
  getConfig: () => config,
  setConfig: async (newConfig) => {
    config = newConfig;
    await set(config);
  },
  log: (msg, level) => logs && log(msg, level),
});
const isSessionStillActive = createIsSessionStillActive(
  () => config?.runtime?.currentSession,
);

function limitSearchPlanForToday(searches, options = {}) {
  const basePlan = normalizeSearchPlan(searches);
  const freshCounters = hasFreshSearchCounters();
  const pcDone =
    freshCounters && isDailySearchCounterDone(config?.runtime?.pcSearch);
  const mobileDone =
    freshCounters && isDailySearchCounterDone(config?.runtime?.mobileSearch);
  const plan = limitPlanForCompletedCounters(basePlan, { pcDone, mobileDone });
  if (!options.silent && (pcDone || mobileDone)) {
    logs &&
      log(
        `[PLAN] Search plan limited for today's completed counters: desktop=${plan.desk}, mobile=${plan.mob}.`,
        "update",
      );
  }
  return plan;
}

function hasActivityQuota() {
  if (!config?.control?.act) return false;
  if (config?.runtime?.activityRunDate !== todayKey()) return true;
  return (
    (Number(config?.runtime?.activityRunsToday) || 0) < maxActivityRunsPerDay
  );
}

function hasActivityWork(options = {}) {
  if (!config?.control?.act) return false;
  if (options.ignoreActivityLimit) return true;
  return hasActivityQuota();
}

function isScheduledModeActive() {
  return isScheduleModeActive(config?.schedule);
}

async function armScheduleAlarm(mode = config?.schedule?.mode) {
  const armed = await armScheduleAlarmForMode(mode, (name, opts) =>
    chrome.alarms.create(name, opts),
  );
  if (armed) {
    logs &&
      log(
        `[SCHEDULE] - Next run armed in ~${Math.round(armed / 1000)}s.`,
        "update",
      );
  }
  return Boolean(armed);
}

// How late a schedule_daily fire may be and still count as "on time". Chrome
// replays alarms that elapsed while the browser was closed as soon as it
// starts; anything beyond this window is treated as a missed day (no catch-up).
const DAILY_ALARM_LATE_TOLERANCE_MS = 10 * 60 * 1000;

// m5 "daily at a fixed wall-clock time" mode. The alarm is periodic (24h), so
// Chrome re-fires it every day without any post-run re-arm; if the browser is
// closed at the scheduled time the occurrence is simply missed (no catch-up,
// by design).
async function armDailyScheduleAlarm(time = config?.schedule?.time) {
  const normalized = normalizeDailyTime(time);
  const when = getDailyAlarmWhen(normalized);
  await chrome.alarms.create("schedule_daily", {
    when,
    periodInMinutes: 24 * 60,
  });
  logs &&
    log(
      `[SCHEDULE] - Daily run armed for ${normalized} (next: ${new Date(when).toLocaleString()}).`,
      "update",
    );
  return true;
}

// Notify the user when a background (scheduled) run finishes — the popup is
// closed at that point, so a toast can't reach them.
function notifyScheduledRunFinished(succeeded) {
  try {
    chrome.notifications?.create({
      type: "basic",
      iconUrl: "/logo/128.png",
      title: "Kiếm điểm",
      message: succeeded
        ? "Chạy theo lịch hoàn tất — nhiệm vụ hằng ngày đã xong."
        : "Chạy theo lịch gặp lỗi. Mở extension để xem chi tiết.",
      priority: 1,
    });
  } catch (error) {
    logs && log(`[NOTIFY] - Could not notify: ${error.message}`, "warning");
  }
}

async function checkRewardsApiSession() {
  try {
    const response = await fetch("https://rewards.bing.com/api/getuserinfo", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.status?.userStatus);
  } catch {
    return false;
  }
}

async function checkRewardsTabSession(tabId) {
  tabId = Number(tabId);
  if (!tabId) return false;
  try {
    const response = await sendTabMessage(
      tabId,
      { action: "checkRewardsSession" },
      "ACTIVITY",
      { attempts: 2, delayMs: shortestDelay },
    );
    return Boolean(response?.active);
  } catch {
    return false;
  }
}

async function isRewardsSessionActive(tabId = null) {
  if (await checkRewardsApiSession()) return true;
  if (tabId && (await checkRewardsTabSession(tabId))) return true;
  return false;
}

async function refreshSearchCountersFromRewards() {
  try {
    const response = await fetch("https://rewards.bing.com/api/getuserinfo", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const counters = data?.status?.userStatus?.counters;
    if (!counters || typeof counters !== "object" || Array.isArray(counters)) {
      throw new Error(
        "Rewards counters are unavailable for the current session.",
      );
    }
    config.runtime.pcSearch = getRewardsSearchCounterDone(counters, "pcSearch");
    config.runtime.mobileSearch = getRewardsSearchCounterDone(
      counters,
      "mobileSearch",
    );
    config.runtime.searchCounterDate = todayKey();
    await set(config);
    logs &&
      log(
        `[COUNTERS] Synced pcSearch=${config.runtime.pcSearch}, mobileSearch=${config.runtime.mobileSearch} for ${config.runtime.searchCounterDate}.`,
        "update",
      );
    return true;
  } catch (error) {
    logs &&
      log(
        `[COUNTERS] Could not refresh Rewards counters: ${error.message}`,
        "warning",
      );
    return false;
  }
}

async function tryStartScheduledRun(source = "SCHEDULE") {
  // m2 (at-startup) and m5 (daily at fixed time) are not "active" periodic
  // modes but are still legitimate scheduled-run entry points from their own
  // triggers (startup event / schedule_daily alarm).
  if (
    !isScheduledModeActive() &&
    !["m2", "m5"].includes(config?.schedule?.mode)
  ) {
    return false;
  }

  // Unknown counters are not the same as incomplete counters. Fail closed so a
  // logged-out/API-failure state cannot trigger the full plan every few minutes.
  const countersRefreshed = await refreshSearchCountersFromRewards();
  if (!countersRefreshed) {
    if (isScheduledModeActive()) {
      await armScheduleAlarm(config?.schedule?.mode);
    }
    logs &&
      log(
        `[${source}] - Rewards counters unavailable; postponed scheduled run.`,
        "warning",
      );
    return false;
  }

  const limitedPlan = limitSearchPlanForToday(config.schedule, {
    silent: true,
  });
  if (!hasSearchWork(limitedPlan) && !hasActivityWork()) {
    logs &&
      log(`[${source}] - No runnable work remaining for today.`, "update");
    return false;
  }

  const runCheck = RunCoordinator.canStartNewRun();
  if (!runCheck.allowed) {
    logs &&
      log(
        `[${source}] - Skipping scheduled run because another session is active (${runCheck.currentSession?.id}).`,
        "warning",
      );
    return false;
  }

  const session = RunCoordinator.startNewSession("schedule");
  if (!session) return false;

  // Single persistence: counters + session state
  await set(config);
  // Scheduled runs start in the background (alarm/startup) — the popup is
  // closed, so surface the outcome via an OS notification.
  return initialise(config.schedule, session.id, { notifyOnFinish: true });
}

function chromeStorageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(items);
    });
  });
}

function chromeStorageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function defaultActivityMemory() {
  return {
    date: todayKey(),
    // Cards that scored today (never clicked again) vs. cards that failed today
    // (retried a few more times, then left alone). See activity-memory.js.
    confirmed: {},
    attempts: {},
    lastScore: null,
    runs: 0,
    lastRunAt: "",
  };
}

async function loadActivityMemory() {
  try {
    const items = await chromeStorageGet(activityMemoryKey);
    const memory = items?.[activityMemoryKey] || defaultActivityMemory();
    if (memory.date !== todayKey()) {
      return defaultActivityMemory();
    }
    const { confirmed, attempts } = migrateActivityMemory(memory);
    return {
      date: memory.date,
      confirmed,
      attempts,
      lastScore: Number.isFinite(memory.lastScore) ? memory.lastScore : null,
      runs: Number(memory.runs) || 0,
      lastRunAt: memory.lastRunAt || "",
    };
  } catch (error) {
    logs &&
      log(
        `[ACTIVITY] Failed to load activity memory: ${error.message}`,
        "warning",
      );
    return defaultActivityMemory();
  }
}

async function saveActivityMemory(memory) {
  try {
    await chromeStorageSet({ [activityMemoryKey]: memory });
  } catch (error) {
    logs &&
      log(
        `[ACTIVITY] Failed to save activity memory: ${error.message}`,
        "warning",
      );
  }
}

async function recordActivityRun(memory = null) {
  const current = memory || (await loadActivityMemory());
  const runAt = new Date().toISOString();
  current.runs = (Number(current.runs) || 0) + 1;
  current.lastRunAt = runAt;
  await saveActivityMemory(current);
  config.runtime.activityRunDate = current.date;
  config.runtime.activityRunsToday = current.runs;
  config.runtime.activityLastRunAt = runAt;
}

async function fetchRewardsSnapshot() {
  try {
    const response = await fetch("https://rewards.bing.com/api/getuserinfo", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return buildRewardsSnapshot(data?.status?.userStatus || {});
  } catch (error) {
    logs &&
      log(
        `[ACTIVITY] Could not read Rewards score: ${error.message}`,
        "warning",
      );
    return null;
  }
}

// Run generation counter — incremented each new session.
// delay() uses this to avoid killing delays that belong to a new run.
let _runGeneration = 0;
function _bumpRunGeneration() {
  _runGeneration++;
  return _runGeneration;
}
function _getRunGeneration() {
  return _runGeneration;
}

async function delay(ms, interruptible = true) {
  if (ms > 1000) {
    logs &&
      log(
        `[DELAY] Waiting for ${ms}ms... (${
          interruptible ? "interruptible" : "non-interruptible"
        })`,
      );
  }
  if (!interruptible) {
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve();
      }, ms),
    );
  }
  // Capture the run generation at the start of this delay.
  // If a new run starts, _runGeneration changes and we let this delay finish
  // (it belongs to the old run but won't interfere with the new one since
  // the coordinator prevents concurrent runs).
  const startedAtGen = _getRunGeneration();
  if (interruptible && !config?.runtime?.running) {
    logs && log(`[DELAY] Interrupted - not running.`, "warning");
    return false;
  }
  const checkInterval = 100;
  let resolved = false;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      // Only interrupt if both: run stopped AND no new run has started
      if (
        !config?.runtime?.running &&
        _getRunGeneration() === startedAtGen &&
        !resolved
      ) {
        resolved = true;
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        if (ms > 1000) {
          logs &&
            log(
              `[DELAY] Interrupted in ${Date.now() - startTime}ms.`,
              "warning",
            );
        }
        resolve();
      }
    }, checkInterval);
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(intervalId);
      }
      resolve();
    }, ms);
  });
}

async function getTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || false;
  } catch (err) {
    log(
      `[GET TAB URL] Error fetching URL for tab ${tabId}: ${err.message}`,
      "error",
    );
    return false;
  }
}

async function sendTabMessage(
  tabId,
  message,
  context = "TAB MESSAGE",
  options = {},
) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const delayMs = Math.max(0, Number(options.delayMs) || shortestDelay);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      logs &&
        log(
          `[${context}] Could not send message to tab ${tabId} (attempt ${attempt}/${attempts}): ${error.message}`,
          "warning",
        );
      if (attempt < attempts) {
        await delay(delayMs, false);
      }
    }
  }

  logs &&
    log(
      `[${context}] Giving up sending message to tab ${tabId}: ${lastError?.message || "unknown error"}`,
      "error",
    );
  return null;
}

async function wait(tabId, interruptible = true) {
  logs && log(`[WAIT] Waiting for tab ${tabId} to load...`);
  const startTime = Date.now();
  const startedAtGen = _getRunGeneration();
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    let interruptTimer = null;

    const done = (success, message = `Tab ${tabId} loaded successfully.`) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(interruptTimer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      logs &&
        log(
          `[WAIT] ${message} (Took ${Date.now() - startTime}ms) - ${
            success ? "Success" : "Failed"
          }`,
        );
      resolve(success);
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") done(true);
    };
    timer = setTimeout(() => {
      done(false, `Tab ${tabId} did not load within the timeout period.`);
    }, longestDelay);

    if (interruptible) {
      interruptTimer = setInterval(() => {
        if (
          !config?.runtime?.running &&
          _getRunGeneration() === startedAtGen &&
          !resolved
        ) {
          done(false, `Tab ${tabId} wait interrupted because run stopped.`);
        }
      }, 100);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          done(true);
        }
      })
      .catch((error) => {
        log(`[WAIT] Error getting tab ${tabId}: ${error.message}`, "error");
        done(false, `Error getting tab ${tabId}: ${error.message}`);
      });
  });
}

async function clear(interruptible = true, clearCookies = false) {
  if (interruptible && !config?.runtime?.running) {
    logs && log("[CLEAR] Interrupted, skipping clear.", "warning");
    return false;
  }
  const tabId = config?.runtime?.rsaTab;
  const originalUrl = await getTabUrl(tabId);
  if (tabId && originalUrl) {
    await chrome.tabs.update(tabId, {
      url: loading + "clear",
    });
    await wait(tabId);
    await delay(shortestDelay, interruptible);
    logs &&
      log(`[CLEAR] Tab updated to loading page: ${loading}clear`, "update");
  }

  try {
    const dataToRemove = {
      cache: true,
      cacheStorage: true,
      serviceWorkers: true,
      pluginData: true,
    };
    if (clearCookies) {
      dataToRemove.cookies = true;
      dataToRemove.localStorage = true;
    }

    const origins = clearCookies ? [bing, rewards] : [bing];
    await chrome.browsingData.remove(
      {
        origins,
        since: 0,
      },
      dataToRemove,
    );
    await delay(shortestDelay, interruptible);
    logs &&
      log(
        `[CLEAR] Browsing data cleared (${clearCookies ? "including" : "preserving"} auth storage).`,
        "success",
      );
  } catch (error) {
    log(`[CLEAR] Error clearing browsing data: ${error.message}`, "error");
    return false;
  }

  if (tabId && originalUrl) {
    await chrome.tabs.update(tabId, {
      url: originalUrl,
    });
    await wait(tabId);
    logs &&
      log(`[CLEAR] Tab updated to original URL: ${originalUrl}`, "update");
  }
  return true;
}

function startSearchKeepalive(tabId) {
  let cancelled = false;
  let failures = 0;
  const loop = async () => {
    while (!cancelled && config?.runtime?.running) {
      try {
        await chrome.tabs.sendMessage(tabId, { action: "ping" });
        failures = 0;
      } catch (error) {
        failures++;
        if (failures >= 3) {
          logs &&
            log(
              `[SEARCH] Content script unreachable after ${failures} ping failures.`,
              "warning",
            );
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, longestDelay));
    }
  };
  loop().catch((err) => {
    logs && log(`[SEARCH] Keepalive loop crashed: ${err?.message}`, "error");
  });
  return () => {
    cancelled = true;
  };
}

async function bootstrapConfig() {
  try {
    const stored = await get();
    await applyStoredConfig(stored, "bootstrap");
    await ensureAlarms();
    logs && log("[BOOTSTRAP] - Config loaded.", "update");
  } catch (error) {
    log(`[BOOTSTRAP] - Error loading config: ${error.message}`, "error");
  }
}

const configReady = bootstrapConfig();

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = Number(source?.tabId);
  if (!tabId) return;
  logs &&
    log(
      `[DEBUGGER] Detached from tab ${tabId}: ${reason || "unknown"}`,
      "warning",
    );
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.config) return;
  const stored = changes.config.newValue ?? null;
  try {
    await applyStoredConfig(
      stored,
      stored ? "storage_changed" : "storage_removed",
    );
  } catch (error) {
    // applyStoredConfig -> set() can reject (e.g. cross-context write-lock
    // timeout). Contain it here like the alarm/message handlers instead of
    // letting it surface as an unhandled rejection.
    recordCrash("storage_changed", error);
  }
});

async function handleUserStop() {
  if (searchKeepaliveCancel) {
    searchKeepaliveCancel();
    searchKeepaliveCancel = null;
  }
  const rsaTab = Number(config?.runtime?.rsaTab);
  await RunCoordinator.stopCurrentSession("user_requested");
  if (rsaTab) {
    await detach(rsaTab, false).catch(() => {});
    try {
      await chrome.tabs.remove(rsaTab);
    } catch (error) {
      logs &&
        log(`[STOP] Could not close RSA tab: ${error.message}`, "warning");
    }
  }
  config.runtime.rsaTab = null;
  config.runtime.mobile = 0;
  config.runtime.act = 0;
  config.runtime.currentPhase = null;
  await set(config);
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch (error) {
    logs && log(`[STOP] Could not clear badge: ${error.message}`, "warning");
  }
}

// Registered synchronously at top level (MV3 requirement) so the listener is
// reinstated whenever the worker respawns and can wake it on navigation. The
// handler no-ops until config is ready thanks to optional chaining.
const handleMsNavigation = ({ tabId, url }) => {
  tabId = Number(tabId);
  if (tabId === config?.runtime?.rsaTab) return;
  if (
    url &&
    msDomains.some((domain) => url.includes(domain)) &&
    config?.runtime?.running &&
    config?.runtime?.mobile &&
    config?.control?.clear &&
    !config?.runtime?.act
  ) {
    needPatch = true;
    logs &&
      log(
        `[WATCHER] - (Patch Required) MS domain navigation detected in tab ${tabId}: ${url}`,
        "warning",
      );
  }
};
chrome.webNavigation.onCommitted.addListener(handleMsNavigation);

async function isDebuggerAttached(tabId) {
  tabId = Number(tabId);
  logs &&
    log(`[DEBUGGER CHECK] Checking if debugger is attached to tab ${tabId}...`);
  try {
    const targets = await chrome.debugger.getTargets();
    return targets.some(
      (target) =>
        target.type === "page" && target.tabId === tabId && target.attached,
    );
  } catch (error) {
    log(
      `[DEBUGGER CHECK] Error checking debugger status: ${error.message}`,
      "error",
    );
    return false;
  }
}

async function race(promise, ms, errorMsg = "Operation timed out") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let fingerprintSourcePromise = null;
const fingerprintPatchedTabs = new Set();

async function installFingerprintPatch(tabId) {
  tabId = Number(tabId);
  if (!tabId || fingerprintPatchedTabs.has(tabId)) return true;
  try {
    fingerprintSourcePromise ||= fetch(
      chrome.runtime.getURL("/js/fingerprint.js"),
    ).then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load fingerprint patch: ${response.status}`);
      }
      return response.text();
    });
    const source = await fingerprintSourcePromise;
    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Page.addScriptToEvaluateOnNewDocument",
        { source },
      ),
      longestDelay,
      "Timed out registering fingerprint patch.",
    );
    await race(
      chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: source,
      }),
      longestDelay,
      "Timed out applying fingerprint patch.",
    );
    fingerprintPatchedTabs.add(tabId);
    return true;
  } catch (error) {
    logs &&
      log(
        `[FINGERPRINT] Could not patch automation tab ${tabId}: ${error.message}`,
        "warning",
      );
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  fingerprintPatchedTabs.delete(Number(tabId));
});

async function attach(tabId, interruptible = true) {
  if (interruptible && !config?.runtime?.running) {
    logs &&
      log(`[ATTACH] Interrupted, skipping attach to tab ${tabId}.`, "warning");
    return false;
  }
  tabId = Number(tabId);
  const isAttached = await isDebuggerAttached(tabId);
  if (isAttached) {
    logs &&
      log(`[ATTACH] - Debugger already attached to tab ${tabId}.`, "update");
    return true;
  }
  const originalUrl = await getTabUrl(tabId);
  logs && log(`[ATTACH] - Attaching debugger to tab ${tabId}...`, "update");

  if (!tabId || !originalUrl) {
    log(`[ATTACH] - Invalid tabId or URL. Skipping...`, "warning");
    return false;
  }

  try {
    await race(
      chrome.debugger.attach({ tabId }, "1.3").catch((err) => {
        if (err.message?.includes("Another debugger")) {
          log(`[ATTACH] - Another debugger is already attached.`, "warning");
        }
        throw err;
      }),
      longestDelay,
    );
    logs && log(`[ATTACH] - Debugger attached to tab ${tabId}.`, "success");
    await delay(shortestDelay, interruptible);

    await race(
      chrome.debugger.sendCommand({ tabId }, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
      longestDelay,
    );
    logs && log(`[ATTACH] - Auto-attach set for tab ${tabId}.`, "success");
    await delay(shortestDelay, interruptible);
  } catch (error) {
    log(`[ATTACH] - Error attaching debugger: ${error.message}`, "error");
    return false;
  }

  return true;
}

async function simulate(tabId, interruptible = true) {
  if (interruptible && !config?.runtime?.running) {
    logs &&
      log(
        `[SIMULATE] Interrupted, skipping simulate for tab ${tabId}.`,
        "warning",
      );
    return false;
  }
  tabId = Number(tabId);
  const originalUrl = await getTabUrl(tabId);
  logs && log(`[SIMULATE] - Simulating tab ${tabId}...`, "update");

  if (!tabId || !originalUrl) {
    log(`[SIMULATE] - Invalid tabId or URL. Skipping...`, "warning");
    return false;
  }

  let attached = await isDebuggerAttached(tabId);
  if (!attached) {
    attached = await attach(tabId, interruptible);
    if (!attached) return false;
    await delay(shortestDelay, interruptible);
    logs && log(`[SIMULATE] - Debugger attached to tab ${tabId}.`, "success");
  }
  await installFingerprintPatch(tabId);

  if (tabId && originalUrl) {
    await chrome.tabs.update(tabId, {
      url: loading + "simulate",
    });
    await wait(tabId);
    logs &&
      log(
        `[SIMULATE] - Tab updated to loading page: ${loading}simulate`,
        "update",
      );
    await delay(shortestDelay, interruptible);
  }

  try {
    const stillAttached = await isDebuggerAttached(tabId);
    if (!stillAttached) {
      logs &&
        log(
          `[SIMULATE] - Debugger not attached before emulation commands. Re-attaching...`,
          "warning",
        );
      await attach(tabId, interruptible);
    }

    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.clearDeviceMetricsOverride",
      ),
      shortestDelay,
    );
    logs &&
      log(`[SIMULATE] - Device metrics cleared for tab ${tabId}.`, "success");

    const deviceMetrics = {
      mobile: true,
      fitWindow: true,
      width: config.device.w,
      height: config.device.h,
      deviceScaleFactor: config.device.scale,
    };

    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setDeviceMetricsOverride",
        deviceMetrics,
      ),
      shortestDelay,
    );
    logs &&
      log(
        `[SIMULATE] - Device metrics set for tab ${tabId}: ${JSON.stringify(
          deviceMetrics,
        )}`,
        "success",
      );

    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Network.setUserAgentOverride",
        buildUAOverride(config?.device),
      ),
      shortestDelay,
    );
    logs &&
      log(
        `[SIMULATE] - User agent overridden for tab ${tabId}: ${config?.device?.ua}`,
        "success",
      );

    await race(
      chrome.debugger.sendCommand({ tabId }, "Network.setBypassServiceWorker", {
        bypass: true,
      }),
      shortestDelay,
    );
    logs &&
      log(
        `[SIMULATE] - Bypass service worker enabled for tab ${tabId}.`,
        "success",
      );

    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setTouchEmulationEnabled",
        {
          enabled: true,
          maxTouchPoints: getMaxTouchPoints(config?.device),
          configuration: "mobile",
        },
      ),
      shortestDelay,
    );
    logs &&
      log(`[SIMULATE] - Touch emulation enabled for tab ${tabId}.`, "success");

    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setEmitTouchEventsForMouse",
        {
          enabled: true,
          configuration: "mobile",
        },
      ),
      shortestDelay,
    );
    logs &&
      log(
        `[SIMULATE] - Mouse events set for touch for tab ${tabId}.`,
        "success",
      );
    await delay(shortestDelay, interruptible);
    logs &&
      log(
        `[SIMULATE] - Done for ${tabId} using device ${config.device.name}`,
        "update",
      );
  } catch (error) {
    log(`[SIMULATE] - Error simulating tab: ${error.message}`, "error");
    await detach(tabId).catch(() => {});
    return false;
  }

  if (tabId && originalUrl) {
    await chrome.tabs.update(tabId, {
      url: originalUrl,
    });
    await wait(tabId);
    logs &&
      log(`[SIMULATE] Tab updated to original URL: ${originalUrl}`, "update");
    await delay(shortestDelay, interruptible);

    try {
      const deviceMetrics = {
        mobile: true,
        fitWindow: true,
        width: config.device.w,
        height: config.device.h,
        deviceScaleFactor: config.device.scale,
      };
      await race(
        chrome.debugger.sendCommand(
          { tabId },
          "Emulation.setDeviceMetricsOverride",
          deviceMetrics,
        ),
        shortestDelay,
      );
      await race(
        chrome.debugger.sendCommand(
          { tabId },
          "Network.setUserAgentOverride",
          buildUAOverride(config?.device),
        ),
        shortestDelay,
      );
      logs &&
        log(
          `[SIMULATE] - Re-applied emulation after navigation for tab ${tabId}.`,
          "success",
        );
    } catch (error) {
      log(
        `[SIMULATE] - Error re-applying emulation after navigation: ${error.message}`,
        "error",
      );
    }
  }
  return true;
}

async function detach(tabId, interruptible = true) {
  if (interruptible && !config?.runtime?.running) {
    logs &&
      log(`[DETACH] Interrupted, skipping detach for tab ${tabId}.`, "warning");
    return false;
  }
  tabId = Number(tabId);
  const originalUrl = await getTabUrl(tabId);

  if (!tabId || !originalUrl) {
    log(`[DETACH] - Invalid tabId or URL. Skipping...`, "warning");
    return false;
  }

  const attached = await isDebuggerAttached(tabId);
  if (!attached) {
    logs &&
      log(
        `[DETACH] - Debugger not attached to tab ${tabId}, skipping detach.`,
        "update",
      );
    return true;
  }

  logs && log(`[DETACH] - Detaching debugger from tab ${tabId}...`, "update");

  const resetCommands = [
    ["Emulation.clearDeviceMetricsOverride", {}],
    ["Network.setUserAgentOverride", { userAgent: "" }],
    ["Network.setBypassServiceWorker", { bypass: false }],
    ["Emulation.setTouchEmulationEnabled", { enabled: false }],
    ["Emulation.setEmitTouchEventsForMouse", { enabled: false }],
  ];
  for (const [command, params] of resetCommands) {
    try {
      await race(
        chrome.debugger.sendCommand({ tabId }, command, params),
        shortestDelay,
      );
      logs &&
        log(
          `[DETACH] - Reset command sent: ${command} with params: ${JSON.stringify(
            params,
          )}`,
          "success",
        );
    } catch (error) {
      logs &&
        log(
          `[DETACH] - Error sending reset command ${command}: ${error.message}`,
          "error",
        );
      continue;
    }
  }
  await delay(shortestDelay, interruptible);
  try {
    await race(
      chrome.debugger.detach({ tabId }),
      mediumDelay,
      `Failed to detach debugger from tab ${tabId} within timeout.`,
    );
    logs && log(`[DETACH] - Debugger detached from tab ${tabId}.`, "success");
  } catch (error) {
    log(`[DETACH] - Error detaching tab: ${error.message}`, "error");
    return false;
  }

  return true;
}

async function toggleSimulate() {
  try {
    const currentTab = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = currentTab?.[0];
    const tabId = tab?.id;
    if (!tabId) {
      logs && log("[TOGGLE SIMULATE] No active tab found.", "error");
      return false;
    }
    const isAttached = await isDebuggerAttached(tabId);
    if (!isAttached) {
      // Only ever attach the debugger to a Bing page — never to whatever
      // unrelated site (bank, email, …) the user happens to have focused.
      if (!/:\/\/([^/]*\.)?bing\.com\//i.test(tab?.url || "")) {
        logs &&
          log(
            "[TOGGLE SIMULATE] Active tab is not a Bing page; refusing to attach debugger.",
            "warning",
          );
        return false;
      }
      await attach(tabId, false);
      await delay(shortestDelay, false);
      await simulate(tabId, false);
      logs &&
        log(
          `[TOGGLE SIMULATE] Debugger attached and simulated for tab ${tabId}.`,
          "success",
        );
      return true;
    } else {
      await detach(tabId, false);
      await delay(shortestDelay, false);
      logs &&
        log(
          `[TOGGLE SIMULATE] Debugger detached from tab ${tabId}.`,
          "success",
        );
      return true;
    }
  } catch (error) {
    log(`[TOGGLE SIMULATE] Error toggling simulate: ${error.message}`, "error");
    return false;
  }
}

async function ensureEmulation(tabId) {
  if (!config?.runtime?.mobile) return true;
  tabId = Number(tabId);
  try {
    const isAttached = await isDebuggerAttached(tabId);
    if (!isAttached) {
      logs &&
        log(
          `[EMULATION] Debugger not attached to tab ${tabId}. Attaching...`,
          "update",
        );
      await attach(tabId, false);
      await delay(shortestDelay, false);
    }
    const deviceMetrics = {
      mobile: true,
      fitWindow: true,
      width: config.device.w,
      height: config.device.h,
      deviceScaleFactor: config.device.scale,
    };
    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setDeviceMetricsOverride",
        deviceMetrics,
      ),
      shortestDelay,
    );
    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Network.setUserAgentOverride",
        buildUAOverride(config?.device),
      ),
      shortestDelay,
    );
    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setTouchEmulationEnabled",
        {
          enabled: true,
          maxTouchPoints: getMaxTouchPoints(config?.device),
          configuration: "mobile",
        },
      ),
      shortestDelay,
    );
    await race(
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setEmitTouchEventsForMouse",
        { enabled: true, configuration: "mobile" },
      ),
      shortestDelay,
    );
    logs &&
      log(
        `[EMULATION] - Mobile emulation verified/applied for tab ${tabId}.`,
        "success",
      );
    return true;
  } catch (error) {
    log(
      `[EMULATION] - Error ensuring emulation for tab ${tabId}: ${error.message}`,
      "error",
    );
    return false;
  }
}

async function enableDomains(tabId) {
  tabId = Number(tabId);
  try {
    const domains = ["Page", "Runtime", "DOM"];
    for (const domain of domains) {
      await race(
        chrome.debugger.sendCommand({ tabId }, `${domain}.enable`, {}),
        shortestDelay,
        `Failed to enable ${domain} domain for tab ${tabId} within timeout.`,
      );
    }
    logs &&
      log(`[ENABLE DOMAINS] - Enabled domains for tab ${tabId}.`, "success");
    await delay(shortestDelay, true);
    return true;
  } catch (error) {
    log(
      `[ENABLE DOMAINS] - Error enabling domains for tab ${tabId}: ${error.message}`,
      "error",
    );
    return false;
  }
}

/**
 * Press a viewport point as a trusted input event: curved cursor travel then a
 * press/release pair (or a touch tap while emulating mobile).
 *
 * This is the coordinate-based half of `click()`, split out so callers that
 * already know where to press — the search-result visit, which gets its point
 * from `createResultPickScript` — do not have to go through that function's
 * sign-in-specific element lookup.
 */
async function pressAtPoint(tabId, x, y, interruptible = true) {
  if (config?.runtime?.mobile) {
    await race(
      chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, radiusX: 5, radiusY: 5, force: 0.5 }],
      }),
      shortestDelay,
      `Failed to dispatch touch event for tab ${tabId} within timeout.`,
    );
    await delay(80 + Math.random() * 120, interruptible);
    await race(
      chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      }),
      shortestDelay,
      `Failed to dispatch touch event for tab ${tabId} within timeout.`,
    );
    return;
  }

  const path = generateMousePath(lastMouseX, lastMouseY, x, y);
  for (const point of path) {
    await race(
      chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
      }),
      shortestDelay,
    ).catch(() => {});
    await delay(8 + Math.random() * 12, interruptible);
  }
  lastMouseX = x;
  lastMouseY = y;
  await delay(80 + Math.random() * 120, interruptible);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await race(
      chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type,
        button: "left",
        x,
        y,
        clickCount: 1,
      }),
      shortestDelay,
      `Failed to dispatch mouse event for tab ${tabId} within timeout.`,
    );
    if (type === "mousePressed") {
      await delay(80 + Math.random() * 120, interruptible);
    }
  }
}

async function click(interruptible = true) {
  if (interruptible && !config?.runtime?.running) {
    logs && log("[CLICK] Interrupted, skipping click operation.", "warning");
    return false;
  }

  const tabId = Number(config?.runtime?.rsaTab);
  if (!tabId) {
    logs &&
      log("[CLICK] No RSA tab found, skipping click operation.", "warning");
    return false;
  }
  if (!(await ensureEmulation(tabId))) {
    logs &&
      log("[CLICK] Mobile emulation is not ready; skipping click.", "warning");
    return false;
  }

  let success = false;
  try {
    await enableDomains(tabId);
    const selector = config?.runtime?.mobile ? "#mHamburger" : ".b_clickarea";

    const { root: documentNode } = await race(
      chrome.debugger.sendCommand({ tabId }, "DOM.getDocument"),
      shortestDelay,
      `Failed to get document for tab ${tabId} within timeout.`,
    );

    if (!documentNode || !documentNode.nodeId) {
      logs &&
        log(`[CLICK] - Failed to get document node for tab ${tabId}.`, "error");
      return false;
    }

    const { nodeId } = await race(
      chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", {
        nodeId: documentNode.nodeId,
        selector: selector,
      }),
      shortestDelay,
      `Failed to query selector "${selector}" for tab ${tabId} within timeout.`,
    );
    if (!nodeId) {
      logs &&
        log(
          `[CLICK] - Failed to get node ID for selector "${selector}" in tab ${tabId}.`,
          "error",
        );
      return false;
    }

    await race(
      chrome.debugger.sendCommand({ tabId }, "DOM.scrollIntoViewIfNeeded", {
        nodeId: nodeId,
      }),
      shortestDelay,
      `Failed to scroll into view for node ID ${nodeId} in tab ${tabId} within timeout.`,
    );
    await delay(shortestDelay, interruptible);

    const { model } = await race(
      chrome.debugger.sendCommand({ tabId }, "DOM.getBoxModel", {
        nodeId: nodeId,
      }),
      shortestDelay,
      `Failed to get box model for node ID ${nodeId} in tab ${tabId} within timeout.`,
    );
    if (!model || !Array.isArray(model.content) || model.content.length < 6) {
      logs &&
        log(
          `[CLICK] - Invalid box model for node ID ${nodeId} in tab ${tabId}.`,
          "error",
        );
      return false;
    }

    const quad = model.content;
    const x = (quad[0] + quad[2]) / 2;
    const y = (quad[1] + quad[5]) / 2;
    logs &&
      log(
        `[CLICK] - Click coordinates for tab ${tabId}: (${x}, ${y})`,
        "update",
      );

    if (config?.runtime?.mobile) {
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            {
              x,
              y,
              radiusX: 5,
              radiusY: 5,
              force: 0.5,
            },
          ],
        }),
        shortestDelay,
        `Failed to dispatch touch event for tab ${tabId} within timeout.`,
      );
    } else {
      // Move the cursor toward the target along a human-like curved path,
      // emitting several intermediate mouseMoved events, before pressing.
      const path = generateMousePath(lastMouseX, lastMouseY, x, y);
      for (const point of path) {
        await race(
          chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: point.x,
            y: point.y,
          }),
          shortestDelay,
        ).catch(() => {}); // ignore transient path errors, keep moving
        await delay(8 + Math.random() * 12, interruptible);
      }
      lastMouseX = x;
      lastMouseY = y;
      await delay(80 + Math.random() * 120, interruptible);
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: "left",
          x,
          y,
          clickCount: 1,
        }),
        shortestDelay,
        `Failed to dispatch mouse event for tab ${tabId} within timeout.`,
      );
    }
    await delay(80 + Math.random() * 120, interruptible);
    if (config?.runtime?.mobile) {
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        }),
        shortestDelay,
        `Failed to dispatch touch event for tab ${tabId} within timeout.`,
      );
    } else {
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button: "left",
          x,
          y,
          clickCount: 1,
        }),
        shortestDelay,
        `Failed to dispatch mouse event for tab ${tabId} within timeout.`,
      );
    }
    logs &&
      log(`[CLICK] - Click operation completed for tab ${tabId}.`, "success");
    await delay(shortestDelay, interruptible);
    success = true;
  } catch (error) {
    log(`[CLICK] - Error during click operation: ${error.message}`, "error");
  }

  // Fallback login only runs when debugger click didn't succeed
  if (!success) {
    logs &&
      log(
        `[CLICK] - Applying fallback method for login for tab ${tabId}.`,
        "update",
      );
    await sendTabMessage(
      tabId,
      {
        action: "login",
        mobile: config?.runtime?.mobile,
      },
      "CLICK",
    );
    await delay(shortestDelay, interruptible);
  }
  if (needPatch) {
    needPatch = false;
  }
  return success;
}

// Pick the subject for the next topic run. A fixed niche in settings is
// honoured as-is; "random" rotates, never landing on the same subject twice in
// a row. Called once per burst, not once per query.
function resolveNiche() {
  const configured = config?.control?.niche || "random";
  const categories = Object.keys(queries);
  if (categories.length === 0) return "";

  if (configured !== "random") {
    if (queries[configured]) return configured;
    logs &&
      log(
        `[QUERY] - Unknown niche "${configured}", falling back to random category.`,
        "warning",
      );
  }

  if (!nicheSession) {
    // minBurst/maxBurst of 1: the *query* burst now decides how long a topic
    // run lasts, so the niche only has to change once per refill.
    nicheSession = createNicheSession(categories, { minBurst: 1, maxBurst: 1 });
  }
  return nicheSession.next() || categories[0];
}

// Expand a local template into a run of related queries using Bing's own
// suggestion endpoint, so consecutive searches read as one person narrowing a
// topic rather than as unrelated picks from a static list. Falls back to the
// bare template whenever the endpoint is unavailable.
async function refillQueryBurst() {
  const configured = config?.control?.niche || "random";
  // A live trending topic needs no niche at all. Resolving one up front would
  // rotate `nicheSession` on every refill only to throw the result away — and
  // would abort the refill outright when the local pool is empty, even though
  // the live topic on its own is perfectly usable.
  let seed = configured === "random" ? await takeDynamicTopic() : "";
  let sourceLabel = "live";

  if (!seed) {
    const niche = resolveNiche();
    if (!niche) return false;
    const template = pickSearchTemplate(
      niche,
      queries,
      usedSearchQueryTemplates,
    );
    if (!template) return false;

    const currentYear = new Date().getFullYear();
    const country = config?.user?.country || "";
    seed = template
      .replace(/\[year\]/g, currentYear.toString())
      .replace(/\[country\]/g, country);
    sourceLabel = niche;
  }
  logs &&
    log(`[QUERY] - New background topic "${seed}" (${sourceLabel}).`, "update");

  // No `mkt` override: Bing infers the market from the request IP, which is by
  // definition the one consistent with where the searches are coming from.
  const suggestions = await fetchSuggestions(seed);
  queryBurst = buildQueryBurst(seed, suggestions);

  if (suggestions.length > 0) {
    logs &&
      log(
        `[QUERY] - Topic run of ${queryBurst.length} from live suggestions for "${seed}".`,
        "update",
      );
  } else {
    logs &&
      log(
        `[QUERY] - No live suggestions for "${seed}"; using the template alone.`,
        "update",
      );
  }
  return queryBurst.length > 0;
}

async function nextBurstQuery() {
  if (queryBurst.length === 0) {
    const refilled = await refillQueryBurst();
    if (!refilled) return "";
  }
  return queryBurst.shift() || "";
}

// Backspace has to go through dispatchKeyEvent — Input.insertText can only add
// text, so a correction made by rewriting input.value would emit no key events
// at all (exactly the gap this is meant to close).
async function typeBackspace(tabId) {
  const base = {
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  };
  for (const type of ["rawKeyDown", "keyUp"]) {
    await race(
      chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type,
        ...base,
      }),
      shortestDelay,
      `Failed to dispatch Backspace for tab ${tabId} within timeout.`,
    ).catch(() => {}); // a dropped correction keystroke must not fail the query
  }
}

// `reuse` re-types the query already in `searchQuery` instead of consuming the
// next one from the topic run. A retry after a failed submit is the same person
// re-entering the same search, and pulling a fresh query would both change the
// intent and burn an entry from the burst.
async function query(interruptible = true, options = {}) {
  const reuse = options.reuse === true && Boolean(searchQuery);
  if (interruptible && !config?.runtime?.running) {
    logs && log("[QUERY] Interrupted, skipping query operation.", "warning");
    return false;
  }
  const tabId = Number(config?.runtime?.rsaTab);
  if (!tabId) {
    logs &&
      log("[QUERY] No RSA tab found, skipping query operation.", "warning");
    return false;
  }
  if (!(await ensureEmulation(tabId))) {
    logs &&
      log("[QUERY] Mobile emulation is not ready; skipping query.", "warning");
    return false;
  }
  logs &&
    log(`[QUERY] - Starting query operation for tab ${tabId}...`, "update");
  if (!reuse) searchQuery = await nextBurstQuery();
  if (!searchQuery) {
    logs && log(`[QUERY] - No query templates available.`, "error");
    return false;
  }
  logs && log(`[QUERY] - Search query: ${searchQuery}`, "update");

  let debuggerTypedQuery = false;
  try {
    await enableDomains(tabId);
    const isAttached = await isDebuggerAttached(tabId);
    if (!isAttached) {
      await attach(tabId, interruptible);
      await delay(shortestDelay, interruptible);
    }
    const expression = `(function() {
			const input = document.querySelector("#sb_form_q");
			if (input) {
				input.focus();
				input.value = "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				return true;
			}
			return false;
		})()`;
    await race(
      chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: expression,
        allowUnsafeEvalBlockedByCSP: true,
        returnByValue: true,
      }),
      shortestDelay,
      `Failed to clear search input for tab ${tabId} within timeout.`,
    );
    await delay(250 + Math.random() * 250, interruptible);
    // Type word-by-word, occasionally hitting a neighbouring key and correcting
    // it with a real Backspace. The steps always reconstruct `searchQuery`
    // exactly — an *uncorrected* typo is a worse tell than a clean query, since
    // real users notice and fix their mistakes.
    const typingSteps = planTypingSteps(searchQuery);
    for (const step of typingSteps) {
      if (!config?.runtime?.running) {
        logs &&
          log("[QUERY] Interrupted during typing, stopping query.", "warning");
        return false;
      }
      if (step.type === "pause") {
        await delay(step.ms, interruptible);
        continue;
      }
      if (step.type === "backspace") {
        for (let b = 0; b < step.count; b++) {
          await typeBackspace(tabId);
          await delay(90 + Math.random() * 110, interruptible);
        }
        continue;
      }
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
          text: step.text,
        }),
        shortestDelay,
        `Failed to insert text for tab ${tabId} within timeout.`,
      );
      await delay(
        typingDelayMin + Math.random() * (typingDelayMax - typingDelayMin),
        interruptible,
      );
    }
    debuggerTypedQuery = true;
    logs && log(`[QUERY] - Search query typed: ${searchQuery}`, "update");
    // No pause here: the caller waits `preSubmitDelayMin..Max` immediately
    // after this returns, which is the same "finished typing, about to press
    // Enter" beat. Having both made that single beat 1.65s long.
  } catch (error) {
    log(`[QUERY] - Error during query operation: ${error.message}`, "error");
  }

  if (interruptible && !config?.runtime?.running) {
    logs &&
      log("[QUERY] Interrupted before content-script fallback.", "warning");
    return false;
  }

  if (debuggerTypedQuery) {
    logs && log(`[QUERY] - Search query ready: ${searchQuery}`, "update");
    return true;
  }

  const response = await sendTabMessage(
    tabId,
    {
      action: "query",
      query: searchQuery,
    },
    "QUERY",
  );
  if (!response || response.success === false) {
    log(
      `[QUERY] - Content script did not confirm query: ${response?.message || "no response"}`,
      "error",
    );
    return false;
  }
  await delay(300 + Math.random() * 300, interruptible);
  logs && log(`[QUERY] - Search query sent: ${searchQuery}`, "update");
  return true;
}

/**
 * Read the results page: scroll down in uneven steps, sometimes back up.
 *
 * Landing on a SERP and never moving is the strongest behavioural tell left in
 * this extension — real dwell time comes with scroll depth. Best-effort only;
 * a failure here must never fail the search that already scored.
 */
async function browseResults(tabId, interruptible = true) {
  const mobile = Boolean(config?.runtime?.mobile);
  const steps = planScrollSteps({ mobile });
  const startedAt = Date.now();
  try {
    for (const step of steps) {
      if (interruptible && !config?.runtime?.running) return;
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: lastMouseX,
          y: lastMouseY,
          deltaX: 0,
          deltaY: step.deltaY,
        }),
        shortestDelay,
      ).catch(() => {});
      await delay(step.pauseMs, interruptible);
    }
    logs &&
      log(
        `[BROWSE] - Read results with ${steps.length} scroll steps.`,
        "update",
      );
  } catch (error) {
    logs && log(`[BROWSE] - Scroll skipped: ${error.message}`, "warning");
  }

  if (shouldVisitResult()) {
    await visitOneResult(tabId, interruptible);
  }

  // Scrolling and reading ARE dwell time, so the caller subtracts them from the
  // read delay rather than adding both — otherwise every run takes roughly
  // twice as long.
  return Date.now() - startedAt;
}

// Roughly one search in five ends in a result visit. A real click-through rate
// is neither 0 (what this extension did before) nor 1 — both are distributions
// no user produces.
function shouldVisitResult() {
  return Math.random() < resultVisitChance;
}

/**
 * Open one organic result, read it briefly, then come back to the results page.
 *
 * Fully best-effort and heavily fenced: the search has already scored by the
 * time this runs, so every failure path just returns. Tabs opened by the
 * destination page are closed, and the SERP URL is restored by navigation
 * rather than by history, because a page that pushed history entries would
 * otherwise leave the tab somewhere unexpected for the next search.
 */
async function visitOneResult(tabId, interruptible = true) {
  const serpUrl = await getTabUrl(tabId);
  if (!serpUrl || !isConfirmedBingSearchUrl(serpUrl, searchQuery)) return;

  const tabsBefore = new Set(
    (await chrome.tabs.query({}).catch(() => [])).map((tab) => tab.id),
  );

  try {
    const evaluation = await race(
      chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: createResultPickScript(),
        allowUnsafeEvalBlockedByCSP: true,
        returnByValue: true,
      }),
      mediumDelay,
    );
    const pick = evaluation?.result?.value;
    if (!pick?.found) {
      logs &&
        log(
          `[BROWSE] - No result worth visiting (${pick?.reason || "unknown"}).`,
          "update",
        );
      return;
    }

    logs && log(`[BROWSE] - Visiting result: ${pick.title}`, "update");
    // A trusted CDP press, not a page-side el.click(): Bing logs the click and
    // the navigation happens through the same path a person's click takes.
    await pressAtPoint(tabId, pick.x, pick.y, interruptible);

    // Give the destination time to load, then read it the same way the SERP was
    // read. Scrolling a third-party page is what a visit actually looks like.
    await delay(mediumDelay, interruptible);
    await wait(tabId).catch(() => {});
    const dwell =
      resultDwellMin + Math.random() * (resultDwellMax - resultDwellMin);
    const readSteps = planScrollSteps({
      mobile: Boolean(config?.runtime?.mobile),
    });
    const perStep = Math.max(shortestDelay, dwell / (readSteps.length || 1));
    for (const step of readSteps) {
      if (interruptible && !config?.runtime?.running) break;
      await race(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: lastMouseX,
          y: lastMouseY,
          deltaX: 0,
          deltaY: step.deltaY,
        }),
        shortestDelay,
      ).catch(() => {});
      await delay(Math.min(perStep, step.pauseMs + perStep / 2), interruptible);
    }
  } catch (error) {
    logs && log(`[BROWSE] - Result visit skipped: ${error.message}`, "warning");
  } finally {
    // Close anything the destination opened (target=_blank, popup) before
    // returning, so stray tabs cannot accumulate across a 30-search run.
    try {
      const opened = (await chrome.tabs.query({})).filter(
        (tab) => tab.id !== tabId && !tabsBefore.has(tab.id),
      );
      for (const tab of opened) {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
      if (opened.length > 0) {
        logs &&
          log(
            `[BROWSE] - Closed ${opened.length} tab(s) opened by the result.`,
            "update",
          );
      }
    } catch (e) {}

    // Back to the SERP so the next search starts from a known page.
    try {
      const current = await getTabUrl(tabId);
      if (current !== serpUrl) {
        await chrome.tabs.update(tabId, { url: serpUrl });
        await wait(tabId);
        await delay(shortestDelay, interruptible);
      }
    } catch (error) {
      logs &&
        log(
          `[BROWSE] - Could not return to the results page: ${error.message}`,
          "warning",
        );
    }
  }
}

async function perform(interruptible = true) {
  if (interruptible && !config?.runtime?.running) {
    logs &&
      log("[PERFORM] Interrupted, skipping perform operation.", "warning");
    return false;
  }
  const tabId = Number(config?.runtime?.rsaTab);
  if (!tabId) {
    logs &&
      log("[PERFORM] No RSA tab found, skipping perform operation.", "warning");
    return false;
  }
  if (!(await ensureEmulation(tabId))) {
    logs &&
      log(
        "[PERFORM] Mobile emulation is not ready; skipping search submit.",
        "warning",
      );
    return false;
  }
  const originalUrl = await getTabUrl(tabId);
  logs && log("[PERFORM] Starting perform operation...", "update");
  try {
    await enableDomains(tabId);
    const response = await sendTabMessage(
      tabId,
      {
        action: "perform",
        query: searchQuery,
      },
      "PERFORM",
    );
    if (!response || response.success === false) {
      throw new Error(
        response?.message || "Content script perform did not respond.",
      );
    }
    logs && log(`[PERFORM] - Search query sent: ${searchQuery}`, "update");
    const navigation = await waitForUrl(
      tabId,
      (url) =>
        url !== originalUrl && isConfirmedBingSearchUrl(url, searchQuery),
      longestDelay,
    );
    if (navigation.success) {
      await wait(tabId);
    } else {
      await delay(mediumDelay, interruptible);
    }
    await delay(shortestDelay, interruptible);
    const newUrl = await getTabUrl(tabId);
    if (
      newUrl &&
      newUrl !== originalUrl &&
      isConfirmedBingSearchUrl(newUrl, searchQuery)
    ) {
      logs &&
        log(
          `[PERFORM] - Search performed. URL changed from ${originalUrl} to ${newUrl}`,
          "success",
        );
      return true;
    } else {
      logs &&
        log(
          `[PERFORM] - Search failed and URL did not change: ${originalUrl}`,
          "error",
        );
      return false;
    }
  } catch (error) {
    log(
      `[PERFORM] - Error during perform operation: ${error.message}`,
      "error",
    );
    return false;
  }
}

async function search(searches, min, max, interruptible = true) {
  searches = Number(searches) || 0;
  min = Number(min) || defaultSearchDelayMin;
  max = Number(max) || defaultSearchDelayMax;
  min = Math.max(minimumSearchDelay, min);
  if (max < min) max = min;
  if (interruptible && !config?.runtime?.running) {
    logs && log("[SEARCH] Interrupted, skipping search operation.", "warning");
    return false;
  }
  if (!navigator.onLine) {
    logs &&
      log(
        "[SEARCH] No internet connection, skipping search operation.",
        "warning",
      );
    return false;
  }
  if (!searches) {
    logs &&
      log(
        "[SEARCH] No searches provided, skipping search operation.",
        "warning",
      );
    return false;
  }
  logs && log("[SEARCH] Starting search operation...", "update");
  const tabId = Number(config?.runtime?.rsaTab);
  const originalUrl = await getTabUrl(tabId);
  const clearIt = config?.control?.clear;

  if (clearIt && !config?.runtime?.mobile) await clear();
  await delay(shortestDelay, interruptible);
  if (originalUrl && originalUrl !== bing) {
    await chrome.tabs.update(tabId, {
      url: bing,
    });
    await wait(tabId);
    await delay(shortestDelay, interruptible);
    logs && log(`[SEARCH] Tab updated to Bing URL: ${bing}`, "update");
  }
  searchKeepaliveCancel = startSearchKeepalive(tabId);

  let successfulSearches = 0;
  const updateProgressBadge = async () => {
    const total = Number(config?.runtime?.total) || searches || 1;
    await chrome.action.setBadgeText({
      text:
        Math.round(
          ((config.runtime.done + config.runtime.failed) / total) * 100,
        ) + "%",
    });
  };
  const randomBetween = (minMs, maxMs) =>
    Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  // Log-normal, not uniform. Individual uniform delays look fine, but across a
  // 30-search run a flat distribution is trivially separable from human
  // inter-query timing, which is right-skewed: mostly short, with a long tail.
  // `checkpointDelayBoost` slows everything down after a detected "searches not
  // crediting" stall — rapid-fire searching is the most common reason Bing
  // silently stops awarding points.
  const getReadDelay = () =>
    humanReadDelayMs(min, max, { boost: checkpointDelayBoost });

  // A couple of "stepped away from the keyboard" gaps per run. A session with
  // no interruption at all is itself unusual.
  const longPauseIndices = planLongPauseIndices(searches);

  // ── Point-crediting checkpoint ─────────────────────────────────────────────
  // A search that navigated successfully can still earn nothing (half-logged-in
  // session after the mobile cookie clear, silently detached debugger dropping
  // the mobile UA, Bing rate limiting). Every few successful searches, compare
  // the real Rewards counter against our local progress; if the counter is
  // frozen while we kept searching, recover the session in-place (the same
  // things a manual restart fixes) and grant make-up searches.
  const mobilePhase = Boolean(config?.runtime?.mobile);
  const counterField = mobilePhase ? "mobProgress" : "pcProgress";
  const counterMaxField = mobilePhase ? "mobMax" : "pcMax";
  // 4 rather than 6: the counter check is also what detects "daily quota is
  // already full", and every search between the quota filling up and the next
  // checkpoint is ~17s spent earning nothing. Tightening the interval costs two
  // extra getuserinfo calls per phase and saves up to two wasted searches.
  const CHECKPOINT_EVERY = 4;
  const MAX_STALL_RECOVERIES = 2;
  let checkpointSnapshot = null;
  let checkpointDone = 0;
  let checkpointDelayBoost = 1;
  let stallRecoveries = 0;
  // Set when the counter says there is nothing left to earn — either the daily
  // quota is full, or Bing has stopped crediting and recovery did not help.
  // Both mean "stop", and neither is a failure of the search phase.
  let earlyStopReason = null;

  const recoverFromStall = async () => {
    stallRecoveries++;
    logs &&
      log(
        `[SEARCH] ${mobilePhase ? "Mobile" : "PC"} counter frozen while searches kept running; recovering session (attempt ${stallRecoveries}).`,
        "warning",
      );
    if (!(await checkRewardsApiSession())) {
      logs &&
        log(
          "[SEARCH] Rewards session not active during searches; attempting re-login.",
          "warning",
        );
      if (clearIt) {
        await click(interruptible);
        await delay(shortestDelay, interruptible);
      }
    }
    if (mobilePhase) {
      // Re-attach the debugger and re-apply UA/device overrides in case they
      // were silently dropped (searches would run with a desktop UA otherwise).
      await ensureEmulation(tabId);
    }
    await chrome.tabs.update(tabId, { url: bing, active: true });
    await wait(tabId);
    await delay(shortestDelay, interruptible);
    checkpointDelayBoost = Math.min(checkpointDelayBoost * 2, 4);
  };

  const verifySearchProgress = async () => {
    const snapshot = await fetchRewardsSnapshot();
    if (!snapshot) return;
    if (!checkpointSnapshot) {
      checkpointSnapshot = snapshot;
      checkpointDone = successfulSearches;
      return;
    }
    const progressed =
      Number(snapshot[counterField]) - Number(checkpointSnapshot[counterField]);
    const counterMax = Number(snapshot[counterMaxField]) || 0;
    const quotaFull =
      counterMax > 0 && Number(snapshot[counterField]) >= counterMax;
    if (quotaFull && !ignoreDailyQuota) {
      earlyStopReason = "quota_full";
      logs &&
        log(
          `[SEARCH] ${mobilePhase ? "Mobile" : "PC"} search counter reached max (${snapshot[counterField]}/${counterMax}); stopping this phase.`,
          "success",
        );
    } else if (quotaFull) {
      // Manual run: the counter is full and these searches earn nothing, but
      // the user asked for them explicitly, so keep going and say so plainly.
      logs &&
        log(
          `[SEARCH] ${mobilePhase ? "Mobile" : "PC"} counter is already at max (${snapshot[counterField]}/${counterMax}); continuing anyway because this is a manual run.`,
          "warning",
        );
    } else if (progressed <= 0 && stallRecoveries < MAX_STALL_RECOVERIES) {
      await recoverFromStall();
    } else if (progressed <= 0) {
      // Recovery has already been tried the allowed number of times and the
      // counter still has not moved. Searching harder is the wrong response:
      // the account is not being credited, and continuing only adds volume to
      // a session Bing is already ignoring. Stop and leave the rest for the
      // next run.
      earlyStopReason = "plateau";
      logs &&
        log(
          `[SEARCH] ${mobilePhase ? "Mobile" : "PC"} counter did not move across ${stallRecoveries} recovery attempts; stopping instead of searching further.`,
          "warning",
        );
    } else {
      logs &&
        log(
          `[SEARCH] Counter check OK: +${progressed} since last checkpoint.`,
          "update",
        );
    }
    checkpointSnapshot = snapshot;
    checkpointDone = successfulSearches;
  };
  // ───────────────────────────────────────────────────────────────────────────

  const waitAfterIteration = async (index, readDelay, searched = true) => {
    if (!searched) {
      logs && log("[SEARCH] Waiting briefly after failed search...", "update");
      await delay(
        randomBetween(failedSearchSettleDelayMin, failedSearchSettleDelayMax),
        interruptible,
      );
      return;
    }

    if (index >= searches - 1) {
      const finalDelay = Math.min(readDelay, finalSearchSettleDelayMax);
      logs && log("[SEARCH] Waiting for final results read delay...", "update");
      await delay(finalDelay, interruptible);
      return;
    }

    logs && log("[SEARCH] Waiting on results before next search...", "update");
    // `readDelay` already IS the gap between one search and the next, sampled
    // from the configured band. A second fixed wait stacked on top of it was
    // double-counting the same pause — ~1.2 minutes across a 52-search run for
    // a beat the user never asked for and the distribution already covers.
    await delay(readDelay, interruptible);
  };

  try {
    checkpointSnapshot = await fetchRewardsSnapshot();
    for (let i = 0; i < searches; i++) {
      let clickedForPatch = false;
      let browsedMs = 0;
      if (interruptible && !config?.runtime?.running) {
        logs &&
          log("[SEARCH] Interrupted, skipping search operation.", "warning");
        return false;
      }
      if (!navigator.onLine) {
        logs &&
          log(
            "[SEARCH] No internet connection, skipping search operation.",
            "warning",
          );
        return false;
      }
      if (needPatch && clearIt && config?.runtime?.mobile) {
        logs &&
          log(
            "[SEARCH] Need patch, clearing browsing data (cookies included)...",
            "warning",
          );
        await clear(interruptible, true);
        await delay(shortestDelay, interruptible);
        clickedForPatch = await click(interruptible);
        await delay(shortestDelay, interruptible);
      }
      const readDelay = getReadDelay();
      // Re-establish the sign-in only in the phase that actually destroyed it.
      // `clear()` defaults to clearCookies=false and logs "preserving auth
      // storage", so the desktop phase is never signed out — clicking Bing's
      // sign-in area there navigated away from the search flow for no reason,
      // three times per run.
      if (mobilePhase && clearIt && i < 3 && !clickedForPatch) {
        await chrome.tabs.update(tabId, {
          active: true,
        });
        await delay(shortestDelay, interruptible);
        await click(interruptible);
        await delay(shortestDelay, interruptible);
      }
      // A search can fail for reasons that clear up on their own: the input was
      // not ready, the navigation raced the page load, the tab was still
      // settling after a cookie clear. Writing the whole iteration off on the
      // first miss silently drops a search's worth of points, so retry the
      // type-and-submit pair before counting it as failed.
      let queried = false;
      let searched = false;
      // `query()` bails out before drawing a query when the tab or the mobile
      // emulation is not ready, which leaves `searchQuery` holding the PREVIOUS
      // iteration's text. Comparing against it is what makes "reuse" mean "the
      // query this iteration already drew" rather than "whatever is in the
      // global" — without it a retry would re-run the previous search verbatim,
      // earning nothing while still counting as a success.
      const previousQuery = searchQuery;
      for (let attempt = 1; attempt <= searchAttempts; attempt++) {
        queried = await query(interruptible, {
          reuse: attempt > 1 && searchQuery !== previousQuery,
        });
        if (!config?.runtime?.running) break;
        if (!queried) {
          if (attempt < searchAttempts) {
            logs &&
              log(
                `[SEARCH] Query attempt ${attempt}/${searchAttempts} failed; retrying.`,
                "warning",
              );
            await delay(
              randomBetween(searchRetryDelayMin, searchRetryDelayMax),
              interruptible,
            );
          }
          continue;
        }
        await delay(
          randomBetween(preSubmitDelayMin, preSubmitDelayMax),
          interruptible,
        );
        // NOTE: Do NOT re-read storage here — it would overwrite in-memory
        // runtime.done/failed counters if popup wrote config concurrently.
        searched = await perform(interruptible);
        if (searched || !config?.runtime?.running) break;
        if (attempt < searchAttempts) {
          logs &&
            log(
              `[SEARCH] Submit attempt ${attempt}/${searchAttempts} did not reach a results page; retrying.`,
              "warning",
            );
          // Return to a clean Bing homepage so the next attempt types into a
          // fresh input rather than whatever half-loaded state we are in.
          await chrome.tabs.update(tabId, { url: bing, active: true });
          await wait(tabId);
          await delay(
            randomBetween(searchRetryDelayMin, searchRetryDelayMax),
            interruptible,
          );
        }
      }
      if (!config?.runtime?.running) {
        // Run was stopped mid-attempt: don't count it as a real failure or
        // navigate the tab (which may already be closing).
        break;
      }
      if (!queried) {
        config.runtime.failed++;
        await set(config);
        await updateProgressBadge();
        logs &&
          log(
            `[SEARCH] Query failed after ${searchAttempts} attempts.`,
            "error",
          );
        await waitAfterIteration(i, readDelay, false);
        continue;
      }
      if (!searched) {
        await chrome.tabs.update(tabId, {
          url: bing,
          active: true,
        });
        await wait(tabId);
        config.runtime.failed++;
        logs &&
          log(
            `[SEARCH] Search ${i + 1} failed with query: ${searchQuery}.`,
            "error",
          );
      } else {
        config.runtime.done++;
        successfulSearches++;
        logs &&
          log(
            `[SEARCH] Search ${i + 1} performed with query: ${searchQuery}.`,
            "success",
          );
        // Read the page before moving on — dwell time without scroll depth is
        // the pattern this is meant to avoid.
        browsedMs = await browseResults(tabId, interruptible);
      }
      await set(config);
      await updateProgressBadge();
      await waitAfterIteration(
        i,
        Math.max(shortestDelay, readDelay - browsedMs),
        searched,
      );
      if (searched && longPauseIndices.has(i) && i < searches - 1) {
        const pause = longPauseMs();
        logs &&
          log(
            `[SEARCH] Taking a longer break (${Math.round(pause / 1000)}s).`,
            "update",
          );
        await delay(pause, interruptible);
      }
      // Right after the mobile cookie clear the login is re-established by the
      // sign-in clicks of the first iterations; verify it actually took before
      // burning through the whole phase logged out.
      if (searched && mobilePhase && clearIt && i === 3) {
        if (!(await checkRewardsApiSession())) {
          logs &&
            log(
              "[SEARCH] Mobile session not confirmed after re-login clicks; retrying sign-in.",
              "warning",
            );
          await click(interruptible);
          await delay(shortestDelay, interruptible);
        }
      }
      if (
        searched &&
        successfulSearches - checkpointDone >= CHECKPOINT_EVERY &&
        i < searches - 1
      ) {
        await verifySearchProgress();
        if (earlyStopReason) break;
      }
    }
  } finally {
    if (searchKeepaliveCancel) {
      searchKeepaliveCancel();
      searchKeepaliveCancel = null;
    }
  }

  if (interruptible && !config?.runtime?.running) {
    logs && log("[SEARCH] Search phase stopped before completion.", "warning");
    return false;
  }
  await chrome.tabs.update(tabId, {
    url: loading + "complete",
  });
  await wait(tabId);
  if (successfulSearches === 0) {
    logs &&
      log(
        "[SEARCH] Phase completed, but no searches were confirmed.",
        "warning",
      );
    return false;
  }
  // Stopping because the daily counter is full is the *goal*, not a shortfall —
  // the remaining planned searches would have earned nothing. A plateau stop is
  // reported as incomplete so the run is retried later.
  if (earlyStopReason === "quota_full") {
    logs &&
      log(
        `[SEARCH] Phase complete at ${successfulSearches}/${searches} searches: daily counter is full.`,
        "success",
      );
    return true;
  }
  if (earlyStopReason === "plateau") {
    logs &&
      log(
        `[SEARCH] Phase stopped early at ${successfulSearches}/${searches} searches: points were no longer being credited.`,
        "warning",
      );
    return false;
  }
  if (!isCompleteSearchCount(successfulSearches, searches)) {
    logs &&
      log(
        `[SEARCH] Phase incomplete: ${successfulSearches}/${searches} searches confirmed.`,
        "warning",
      );
    return false;
  }
  return true;
}

async function waitForUrl(
  tabId,
  predicate,
  timeout = longestDelay * 2,
  interruptible = true,
) {
  const startTime = Date.now();
  const startedAtGen = _getRunGeneration();
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    let interruptTimer = null;

    const done = (success, url = "") => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(interruptTimer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      logs &&
        log(
          `[WAIT URL] ${success ? "Matched" : "Timed out"} for tab ${tabId}: ${url} (${Date.now() - startTime}ms)`,
          success ? "success" : "warning",
        );
      resolve({ success, url });
    };

    const checkCurrentUrl = async () => {
      try {
        const url = await getTabUrl(tabId);
        if (predicate(url || "")) {
          done(true, url);
        }
      } catch (error) {}
    };

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      const url = changeInfo.url || tab?.url || "";
      if (predicate(url)) {
        done(true, url);
        return;
      }
      if (changeInfo.status === "complete") {
        checkCurrentUrl();
      }
    };

    timer = setTimeout(async () => {
      const url = await getTabUrl(tabId);
      done(false, url || "");
    }, timeout);

    if (interruptible) {
      interruptTimer = setInterval(() => {
        if (
          !config?.runtime?.running &&
          _getRunGeneration() === startedAtGen &&
          !resolved
        ) {
          done(false, "");
        }
      }, 100);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    checkCurrentUrl();
  });
}

async function completeRewardActivityTab(tabId) {
  tabId = Number(tabId);
  if (!tabId) return false;

  let attachedHere = false;
  let interactions = 0;
  try {
    if (!config?.runtime?.running) return false;
    const loaded = await wait(tabId, true);
    if (!loaded || !config?.runtime?.running) return false;
    await delay(mediumDelay, true);
    if (!config?.runtime?.running) return false;

    const alreadyAttached = await isDebuggerAttached(tabId);
    if (!alreadyAttached) {
      attachedHere = await attach(tabId, false);
    }
    if (!alreadyAttached && !attachedHere) return false;

    await enableDomains(tabId);

    const solveScript = createSolveActivityScript();

    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await race(
        chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: solveScript,
          returnByValue: true,
        }),
        mediumDelay,
        `Failed to interact with reward tab ${tabId}.`,
      ).catch((error) => {
        logs &&
          log(
            `[ACTIVITY] Reward tab interaction failed: ${error.message}`,
            "warning",
          );
        return null;
      });
      const value = result?.result?.value;
      if (!value?.clicked) break;

      interactions++;
      logs &&
        log(`[ACTIVITY] Reward tab ${tabId} clicked: ${value.text}`, "update");
      if (!config?.runtime?.running) break;
      await delay(1200 + Math.random() * 800, true);
      if (!config?.runtime?.running) break;
      await wait(tabId, true);
    }
  } catch (error) {
    logs &&
      log(
        `[ACTIVITY] Error completing reward tab ${tabId}: ${error.message}`,
        "error",
      );
  } finally {
    if (attachedHere) {
      await detach(tabId, false);
    }
  }

  return interactions > 0;
}

// Both helpers already default to DEFAULT_REWARD_HOSTS, so passing the same
// list back in was a no-op; these wrappers exist only to keep the call sites
// short.
function isRewardActivityUrl(url) {
  return isTrustedRewardActivityUrl(url);
}

function getTabActivityUrl(tab) {
  return String(tab?.url || tab?.pendingUrl || "").toLowerCase();
}

function isActivityOpenedTab(tab, mainTabId, existingTabIds) {
  return isTrustedActivityOpenedTab(tab, mainTabId, existingTabIds);
}

async function processOpenedActivityTabs(
  mainTabId,
  existingTabIds,
  returnUrl = rewards + "dashboard",
) {
  const allTabs = await chrome.tabs.query({});
  const newTabs = allTabs.filter((tab) =>
    isActivityOpenedTab(tab, mainTabId, existingTabIds),
  );
  let processed = 0;
  for (const tab of newTabs) {
    const loaded = await waitForUrl(
      tab.id,
      (url) => Boolean(url && url !== "about:blank"),
      longestDelay,
    );
    const tabUrl = loaded.url || (await getTabUrl(tab.id));
    if (!isRewardActivityUrl(tabUrl)) {
      logs &&
        log(
          `[ACTIVITY] Leaving non-reward tab open: ${tab.id} (${tabUrl || "unknown url"})`,
          "update",
        );
      continue;
    }
    const completed = await completeRewardActivityTab(tab.id);
    await delay(shortestDelay, false);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (error) {}
    if (completed) {
      processed++;
    }
    logs &&
      log(
        `[ACTIVITY] Closed opened tab: ${tab.id} (${tabUrl || "unknown url"}) - ${completed ? "completed" : "not completed"}`,
        completed ? "update" : "warning",
      );
  }

  const mainUrl = await getTabUrl(mainTabId);
  if (
    mainUrl &&
    isRewardActivityUrl(mainUrl) &&
    !mainUrl.startsWith(returnUrl)
  ) {
    const completed = await completeRewardActivityTab(mainTabId);
    await chrome.tabs.update(mainTabId, { url: returnUrl, active: true });
    await wait(mainTabId);
    if (completed) {
      processed++;
    }
  }

  return processed;
}

async function closeOpenedActivityTabs(mainTabId, existingTabIds) {
  const allTabs = await chrome.tabs.query({});
  const openedTabs = allTabs.filter(
    (tab) =>
      isActivityOpenedTab(tab, mainTabId, existingTabIds) &&
      isRewardActivityUrl(getTabActivityUrl(tab)),
  );
  let closed = 0;
  for (const tab of openedTabs) {
    try {
      await chrome.tabs.remove(tab.id);
      closed++;
      logs &&
        log(
          `[ACTIVITY] Cleanup closed leftover tab: ${tab.id} (${tab.url || tab.pendingUrl || "unknown url"})`,
          "update",
        );
    } catch (error) {}
  }
  return closed;
}

async function dispatchTrustedPress(tabId, point, context = "ACTIVITY") {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await delay(80, false);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    return true;
  } catch (error) {
    logs &&
      log(
        `[${context}] Trusted click failed at (${Math.round(x)}, ${Math.round(y)}): ${error.message}`,
        "warning",
      );
    return false;
  }
}

// The Rewards pages are React SPAs: `wait(tabId)` resolves on document load,
// well before the cards render. Poll for the target section heading so the
// first click pass doesn't fire against an empty page (the classic "first icon
// click misses" failure). Returns true once the heading exists, false on
// timeout — callers still proceed, the pass scripts have their own retry.
async function waitForRewardsSection(tabId, patternSource, timeoutMs = 15000) {
  const probe = `(() => {
    try {
      const re = new RegExp(${JSON.stringify(patternSource)}, "i");
      const nodes = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const el of nodes) {
        if (re.test(el.textContent || "")) return true;
      }
      return false;
    } catch (e) { return false; }
  })()`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isRuntimeActive()) return false;
    const result = await race(
      chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: probe,
        returnByValue: true,
      }),
      shortestDelay * 3,
    ).catch(() => null);
    if (result?.result?.value === true) return true;
    await delay(500, false);
  }
  logs &&
    log(
      `[ACTIVITY] Section heading not detected within ${Math.round(timeoutMs / 1000)}s; proceeding anyway.`,
      "warning",
    );
  return false;
}

const DAILY_SET_HEADING_PATTERN =
  "daily set|daily check.?in|today'?s? set|bộ hàng ngày|chuỗi hàng ngày|nhiệm vụ hàng ngày|phần thưởng hàng ngày";
const KEEP_EARNING_HEADING_PATTERN =
  "keep earning|more activities|more points|earn more|kiếm thêm|hoạt động khác|tiếp tục kiếm|kiếm điểm thêm";

async function runDashboardActivityPass(
  tabId,
  memory,
  sessionVisited,
  sessionMisses,
  pass,
) {
  const tabsBefore = await chrome.tabs.query({});
  const existingTabIds = new Set(tabsBefore.map((tab) => tab.id));
  const blockedKeys = getBlockedActivityKeys(memory, sessionVisited);
  const beforeScore = await fetchRewardsSnapshot();
  const dashboardScript = createDashboardActivityScript(
    [...blockedKeys],
    1,
    true,
  );
  const result = await race(
    chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: dashboardScript,
      returnByValue: true,
    }),
    longestDelay,
    `Failed to scan rewards dashboard pass ${pass}.`,
  ).catch((error) => {
    logs &&
      log(
        `[ACTIVITY] Dashboard pass ${pass} failed: ${error.message}`,
        "warning",
      );
    return null;
  });

  const value = result?.result?.value || {};
  let clickedItems = value.clicked || [];
  const skippedItems = value.skipped || [];
  if (clickedItems.length > 0 && value.pressPoint) {
    const pressed = await dispatchTrustedPress(
      tabId,
      value.pressPoint,
      "DAILY SET",
    );
    if (!pressed) clickedItems = [];
  }
  if (value.reason) {
    logs &&
      log(`[ACTIVITY] Dashboard pass ${pass}: ${value.reason}.`, "warning");
  }
  if (clickedItems.length > 0) {
    logs &&
      log(
        `[ACTIVITY] Pass ${pass} clicked ${clickedItems.length} dashboard items.`,
        "success",
      );
    for (const item of clickedItems) {
      logs && log(`[ACTIVITY]   clicked ${item.type}: ${item.text}`, "update");
    }
  }
  if (skippedItems.length > 0) {
    logs &&
      log(
        `[ACTIVITY] Pass ${pass} skipped ${skippedItems.length} completed items.`,
        "update",
      );
  }

  await delay(4000 + Math.random() * 2500, false);
  const processedTabs = await processOpenedActivityTabs(tabId, existingTabIds);
  const nonExpandClicks = clickedItems.filter((item) => item.type !== "expand");
  if (nonExpandClicks.length > 0 || processedTabs > 0) {
    await chrome.tabs.update(tabId, {
      url: rewards + "dashboard",
      active: true,
    });
    await wait(tabId);
    await delay(mediumDelay, false);
  }
  const afterScore = await fetchRewardsSnapshot();
  let pointDelta = getScoreDelta(beforeScore, afterScore);
  if (afterScore && Number.isFinite(afterScore.score)) {
    memory.lastScore = afterScore.score;
  }
  // Points from a just-clicked card can lag the getuserinfo API by several
  // seconds. If we clicked something but neither a processed tab nor a positive
  // delta confirms it yet, wait longer and re-check once before deciding it was
  // a miss (repeated misses get the card blocked for the rest of the session).
  for (
    let recheck = 0;
    recheck < 2 &&
    clickedItems.length > 0 &&
    processedTabs === 0 &&
    !(Number.isFinite(pointDelta) && pointDelta > 0);
    recheck++
  ) {
    await delay(4000 + Math.random() * 2000, false);
    const retryScore = await fetchRewardsSnapshot();
    const retryDelta = getScoreDelta(beforeScore, retryScore);
    if (Number.isFinite(retryDelta)) pointDelta = retryDelta;
    if (retryScore && Number.isFinite(retryScore.score)) {
      memory.lastScore = retryScore.score;
    }
  }
  // Only a positive score delta confirms a click; a clicked-but-zero-delta card
  // stays a retryable miss (so multi-step quizzes get another pass). The
  // re-check above is what rescues the (often first) card whose points merely
  // register slowly, without falsely confirming a tab that opened but earned 0.
  const confirmedClick = Number.isFinite(pointDelta)
    ? pointDelta > 0
    : processedTabs > 0;
  let retryableMiss = false;
  if (confirmedClick) {
    confirmActivityKeys(
      memory,
      sessionVisited,
      sessionMisses,
      value.openedKeys || [],
    );
  } else if (clickedItems.length > 0) {
    const missed = markUnconfirmedActivityKeys(
      value.openedKeys || [],
      sessionVisited,
      sessionMisses,
      undefined,
      memory,
    );
    retryableMiss = missed.retryable;
    logs &&
      log(
        `[ACTIVITY] Pass ${pass} daily-set click did not open/score; ${retryableMiss ? "retrying" : "moving on"}.`,
        "warning",
      );
  }
  await saveActivityMemory(memory);

  if (pointDelta !== null) {
    logs &&
      log(
        `[ACTIVITY] Pass ${pass} score delta: ${pointDelta >= 0 ? "+" : ""}${pointDelta}.`,
        pointDelta > 0 ? "success" : "warning",
      );
  }

  log(
    formatActivityDiag("Dashboard", pass, {
      clicked: clickedItems,
      skipped: skippedItems,
      reason: value.reason,
      pointDelta,
      processedTabs,
      confirmed: confirmedClick,
    }),
    "update",
  );

  return {
    clicked: confirmedClick ? clickedItems.length : 0,
    attempted: clickedItems.length,
    nonExpandClicked: confirmedClick ? nonExpandClicks.length : 0,
    processed: confirmedClick ? processedTabs : 0,
    skipped: skippedItems.length,
    retry: Boolean(value.retry) || retryableMiss,
    pointDelta,
  };
}

async function runEarnActivityPass(
  tabId,
  memory,
  sessionVisited,
  sessionMisses,
  pass,
) {
  const earnUrl = rewards + "earn";
  const tabsBefore = await chrome.tabs.query({});
  const existingTabIds = new Set(tabsBefore.map((tab) => tab.id));
  const blockedKeys = getBlockedActivityKeys(memory, sessionVisited);
  const beforeScore = await fetchRewardsSnapshot();
  const earnScript = createEarnActivityScript([...blockedKeys], 1);
  const result = await race(
    chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: earnScript,
      returnByValue: true,
    }),
    longestDelay,
    `Failed to scan rewards earn pass ${pass}.`,
  ).catch((error) => {
    logs &&
      log(`[ACTIVITY] Earn pass ${pass} failed: ${error.message}`, "warning");
    return null;
  });

  const value = result?.result?.value || {};
  const clickedItems = value.clicked || [];
  const skippedItems = value.skipped || [];
  if (value.reason) {
    logs && log(`[ACTIVITY] Earn pass ${pass}: ${value.reason}.`, "warning");
  }
  if (clickedItems.length > 0) {
    logs &&
      log(
        `[ACTIVITY] Earn pass ${pass} clicked ${clickedItems.length} Keep earning items.`,
        "success",
      );
    for (const item of clickedItems) {
      logs && log(`[ACTIVITY]   clicked ${item.type}: ${item.text}`, "update");
    }
  }
  if (skippedItems.length > 0) {
    logs &&
      log(
        `[ACTIVITY] Earn pass ${pass} skipped ${skippedItems.length} non-point, locked, or completed items.`,
        "update",
      );
  }

  await delay(4000 + Math.random() * 2500, false);
  const processedTabs = await processOpenedActivityTabs(
    tabId,
    existingTabIds,
    earnUrl,
  );
  if (clickedItems.length > 0 || processedTabs > 0) {
    await chrome.tabs.update(tabId, { url: earnUrl, active: true });
    await wait(tabId);
    await delay(mediumDelay, false);
  }
  const afterScore = await fetchRewardsSnapshot();
  let pointDelta = getScoreDelta(beforeScore, afterScore);
  if (afterScore && Number.isFinite(afterScore.score)) {
    memory.lastScore = afterScore.score;
  }
  // Same lag handling as the dashboard pass: re-check the score before
  // concluding a clicked earn card did not score.
  for (
    let recheck = 0;
    recheck < 2 &&
    clickedItems.length > 0 &&
    processedTabs === 0 &&
    !(Number.isFinite(pointDelta) && pointDelta > 0);
    recheck++
  ) {
    await delay(4000 + Math.random() * 2000, false);
    const retryScore = await fetchRewardsSnapshot();
    const retryDelta = getScoreDelta(beforeScore, retryScore);
    if (Number.isFinite(retryDelta)) pointDelta = retryDelta;
    if (retryScore && Number.isFinite(retryScore.score)) {
      memory.lastScore = retryScore.score;
    }
  }
  // Only a positive delta confirms; the re-check above gives lagging points
  // time to land without falsely confirming a tab that opened but earned 0.
  const confirmedClick = Number.isFinite(pointDelta)
    ? pointDelta > 0
    : processedTabs > 0;
  let retryableMiss = false;
  if (confirmedClick) {
    confirmActivityKeys(
      memory,
      sessionVisited,
      sessionMisses,
      value.openedKeys || [],
    );
  } else if (clickedItems.length > 0) {
    const missed = markUnconfirmedActivityKeys(
      value.openedKeys || [],
      sessionVisited,
      sessionMisses,
      undefined,
      memory,
    );
    retryableMiss = missed.retryable;
    logs &&
      log(
        `[ACTIVITY] Earn pass ${pass} click did not open/score; ${retryableMiss ? "retrying" : "moving on"}.`,
        "warning",
      );
  }
  await saveActivityMemory(memory);

  if (pointDelta !== null) {
    logs &&
      log(
        `[ACTIVITY] Earn pass ${pass} score delta: ${pointDelta >= 0 ? "+" : ""}${pointDelta}.`,
        pointDelta > 0 ? "success" : "warning",
      );
  }

  log(
    formatActivityDiag("Earn", pass, {
      clicked: clickedItems,
      skipped: skippedItems,
      reason: value.reason,
      pointDelta,
      processedTabs,
      confirmed: confirmedClick,
    }),
    "update",
  );

  return {
    clicked: confirmedClick ? clickedItems.length : 0,
    attempted: clickedItems.length,
    processed: confirmedClick ? processedTabs : 0,
    skipped: skippedItems.length,
    retry: Boolean(value.retry) || retryableMiss,
    pointDelta,
  };
}

// Silent "Ready to claim" collector: clicks the pending-points card on the
// dashboard and confirms it actually collected via the Rewards score delta.
async function runClaimReadyPass(tabId, pass) {
  const beforeScore = await fetchRewardsSnapshot();
  const claimScript = createClaimReadyScript(true);
  const result = await race(
    chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: claimScript,
      returnByValue: true,
    }),
    longestDelay,
    `Failed to run ready-to-claim pass ${pass}.`,
  ).catch((error) => {
    logs &&
      log(`[ACTIVITY] Claim pass ${pass} failed: ${error.message}`, "warning");
    return null;
  });

  const value = result?.result?.value || {};
  let clicked = Boolean(value.clicked);
  if (clicked && value.pressPoint) {
    clicked = await dispatchTrustedPress(tabId, value.pressPoint, "CLAIM");
  }
  if (value.reason) {
    logs && log(`[ACTIVITY] Claim pass ${pass}: ${value.reason}.`, "update");
  }
  if (clicked) {
    logs &&
      log(
        `[ACTIVITY] Claim pass ${pass} clicked "${value.text || "claim"}" (pending: ${value.count}).`,
        "update",
      );
  }

  let pointDelta = null;
  if (clicked) {
    // Opening the card is only stage one; return quickly so the next pass can
    // click the dialog confirm. After the confirm, poll longer for API lag.
    const checks = value.stage === "confirm" ? 4 : 1;
    for (let check = 0; check < checks; check++) {
      await delay(
        value.stage === "confirm"
          ? 2500 + Math.random() * 1200
          : 1200 + Math.random() * 600,
        false,
      );
      const afterScore = await fetchRewardsSnapshot();
      pointDelta = getScoreDelta(beforeScore, afterScore);
      if (Number.isFinite(pointDelta) && pointDelta > 0) break;
    }
  }
  if (Number.isFinite(pointDelta) && pointDelta !== 0) {
    logs &&
      log(
        `[ACTIVITY] Claim pass ${pass} score delta: ${pointDelta > 0 ? "+" : ""}${pointDelta}.`,
        pointDelta > 0 ? "success" : "update",
      );
  }

  log(
    `[DIAG] Claim pass ${pass}: clicked=${clicked} stage=${value.stage || "-"} count=${value.count} text="${(value.text || "").slice(0, 60)}" reason=${value.reason || "-"} delta=${pointDelta} url=${value.url || "-"}`,
    "update",
  );

  return {
    clicked,
    retry: Boolean(value.retry),
    count: Number.isFinite(value.count) ? value.count : null,
    pointDelta,
  };
}

async function activity(tabId, interruptible = true, options = {}) {
  // Manual "activities only" runs pass recordRun:false so they don't consume the
  // automated daily activity quota (which would otherwise block scheduled runs).
  const recordRun = options.recordRun !== false;
  if (interruptible && !config?.runtime?.running && !config?.runtime?.act) {
    logs && log(`[ACTIVITY] Interrupted, skipping activity.`, "warning");
    return false;
  }
  if (!navigator.onLine) {
    logs && log(`[ACTIVITY] No internet connection, skipping.`, "warning");
    return false;
  }
  tabId = Number(tabId);
  if (!tabId) {
    logs && log(`[ACTIVITY] No tab ID, skipping.`, "warning");
    return false;
  }

  config.runtime.act = 1;
  await set(config);
  const shouldContinueActivity = () => isRuntimeActive();
  const activityStartTabs = new Set(
    (await chrome.tabs.query({})).map((tab) => tab.id),
  );
  let clicked = false;
  let debuggerReady = false;
  let activityMemory = null;
  let meaningfulActivityRun = false;
  let sessionFailed = false;
  let activityStopped = false;
  let result = false;
  try {
    await chrome.action.setBadgeText({ text: "ACT" });
    await chrome.action.setBadgeBackgroundColor({ color: "#0072FF" });

    await chrome.tabs.update(tabId, {
      url: rewards + "dashboard",
      active: true,
    });
    await wait(tabId);
    await delay(mediumDelay, interruptible);

    let rewardsSessionOk = await isRewardsSessionActive(tabId);
    if (!rewardsSessionOk) {
      logs &&
        log(
          `[ACTIVITY] Rewards session not detected; reloading dashboard once...`,
          "warning",
        );
      await chrome.tabs.update(tabId, {
        url: rewards + "dashboard",
        active: true,
      });
      await wait(tabId);
      await delay(mediumDelay, interruptible);
      rewardsSessionOk = await isRewardsSessionActive(tabId);
    }
    if (!rewardsSessionOk) {
      sessionFailed = true;
      logs &&
        log(
          `[ACTIVITY] Rewards login unavailable; cannot run Daily set or Keep earning.`,
          "error",
        );
    }

    if (!sessionFailed) {
      debuggerReady = await attach(tabId, interruptible);
      if (!debuggerReady) {
        logs &&
          log(
            `[ACTIVITY] First debugger attach failed; retrying once...`,
            "warning",
          );
        await delay(mediumDelay, interruptible);
        debuggerReady = await attach(tabId, interruptible);
      }
      if (!debuggerReady) {
        logs &&
          log(
            `[ACTIVITY] Debugger attach failed after retry; cannot scan activity cards.`,
            "error",
          );
      } else {
        await enableDomains(tabId);
      }

      if (debuggerReady) {
        // Wait for the Daily set section to actually render before the first
        // pass; a fixed post-load delay is regularly too short for the SPA.
        await waitForRewardsSection(tabId, DAILY_SET_HEADING_PATTERN);
      }
      // Promo/streak popups can appear late and cover the first card; close
      // twice with a gap instead of once.
      await sendTabMessage(tabId, { action: "closePopups" }, "ACTIVITY");
      await delay(shortestDelay, interruptible);
      await sendTabMessage(tabId, { action: "closePopups" }, "ACTIVITY");
      await delay(shortestDelay, interruptible);

      activityMemory = await loadActivityMemory();
      const sessionVisited = new Set();
      let totalClicked = 0;
      let totalProcessed = 0;
      let measuredDelta = 0;
      let idlePasses = 0;
      const sessionMisses = new Map();

      if (debuggerReady) {
        for (let pass = 1; pass <= 35; pass++) {
          if (!shouldContinueActivity()) {
            activityStopped = true;
            break;
          }
          const passResult = await runDashboardActivityPass(
            tabId,
            activityMemory,
            sessionVisited,
            sessionMisses,
            pass,
          );
          totalClicked += passResult.clicked;
          totalProcessed += passResult.processed;
          if (Number.isFinite(passResult.pointDelta)) {
            measuredDelta += passResult.pointDelta;
          }
          if (
            passResult.clicked > 0 ||
            passResult.processed > 0 ||
            (Number.isFinite(passResult.pointDelta) &&
              passResult.pointDelta > 0)
          ) {
            meaningfulActivityRun = true;
          }
          clicked = totalClicked > 0 || totalProcessed > 0;

          if (passResult.retry) {
            idlePasses = 0;
          } else if (passResult.clicked === 0 && passResult.processed === 0) {
            idlePasses++;
          } else {
            idlePasses = 0;
          }
          if (idlePasses >= 3) break;
        }
      } else {
        logs &&
          log(`[ACTIVITY] Skipping dashboard and earn passes.`, "warning");
      }

      if (debuggerReady && shouldContinueActivity()) {
        if (totalClicked === 0 && totalProcessed === 0) {
          logs &&
            log(`[ACTIVITY] Daily set idle, moving to Keep earning.`, "update");
        }
        logs && log(`[ACTIVITY] Opening Keep earning page.`, "update");
        await chrome.tabs.update(tabId, {
          url: rewards + "earn",
          active: true,
        });
        await wait(tabId);
        await delay(mediumDelay, interruptible);
        await waitForRewardsSection(tabId, KEEP_EARNING_HEADING_PATTERN);
        await sendTabMessage(tabId, { action: "closePopups" }, "ACTIVITY");
        await delay(shortestDelay, interruptible);
        await sendTabMessage(tabId, { action: "closePopups" }, "ACTIVITY");
        idlePasses = 0;

        for (let pass = 1; pass <= 45; pass++) {
          if (!shouldContinueActivity()) {
            activityStopped = true;
            break;
          }
          const passResult = await runEarnActivityPass(
            tabId,
            activityMemory,
            sessionVisited,
            sessionMisses,
            pass,
          );
          totalClicked += passResult.clicked;
          totalProcessed += passResult.processed;
          if (Number.isFinite(passResult.pointDelta)) {
            measuredDelta += passResult.pointDelta;
          }
          if (
            passResult.clicked > 0 ||
            passResult.processed > 0 ||
            (Number.isFinite(passResult.pointDelta) &&
              passResult.pointDelta > 0)
          ) {
            meaningfulActivityRun = true;
          }
          clicked = totalClicked > 0 || totalProcessed > 0;

          if (passResult.retry) {
            idlePasses = 0;
          } else if (passResult.clicked === 0 && passResult.processed === 0) {
            idlePasses++;
          } else {
            idlePasses = 0;
          }
          if (idlePasses >= 3) break;
        }
      } else if (!debuggerReady) {
        logs &&
          log(
            `[ACTIVITY] Keep earning skipped because debugger attach failed.`,
            "warning",
          );
      } else if (activityStopped) {
        logs &&
          log(
            `[ACTIVITY] Keep earning skipped because activity was stopped.`,
            "warning",
          );
      }

      // Silent final step: collect any "Ready to claim" pending points that
      // remain after Daily set + Keep earning. Best-effort; a failure here must
      // never break the run, so it is fully guarded.
      if (debuggerReady && shouldContinueActivity()) {
        try {
          logs &&
            log(`[ACTIVITY] Checking for ready-to-claim points.`, "update");
          // The "Ready to claim" pending-points widget lives on the Rewards
          // HOMEPAGE (rewards.bing.com/), not /dashboard — the new React UI
          // shows the card there and opens a "Claim points" flyout. Claiming on
          // /dashboard silently finds nothing.
          await chrome.tabs.update(tabId, {
            url: rewards,
            active: true,
          });
          await wait(tabId);
          await delay(mediumDelay, interruptible);
          // A logged-out page has no claim card, so verify the Rewards session
          // first and reload once if it isn't detected yet (e.g. cookies were
          // still settling after the mobile phase).
          if (!(await isRewardsSessionActive(tabId))) {
            logs &&
              log(
                `[ACTIVITY] Rewards session not detected before claim; reloading page.`,
                "warning",
              );
            await chrome.tabs.reload(tabId);
            await wait(tabId);
            await delay(mediumDelay, interruptible);
          }
          await sendTabMessage(tabId, { action: "closePopups" }, "ACTIVITY");
          for (let pass = 1; pass <= 6; pass++) {
            if (!shouldContinueActivity()) break;
            const claimResult = await runClaimReadyPass(tabId, pass);
            if (
              Number.isFinite(claimResult.pointDelta) &&
              claimResult.pointDelta > 0
            ) {
              meaningfulActivityRun = true;
              clicked = true;
              measuredDelta += claimResult.pointDelta;
            }
            // Stop when nothing was clickable or the pending count reached zero.
            if (claimResult.retry) {
              await delay(shortestDelay, true);
              continue;
            }
            if (!claimResult.clicked || claimResult.count === 0) break;
          }
        } catch (claimError) {
          logs &&
            log(
              `[ACTIVITY] Ready-to-claim step error: ${claimError.message}`,
              "warning",
            );
        }
      }

      logs &&
        log(
          `[ACTIVITY] Engine finished. Activity clicks: ${totalClicked}, processed tabs: ${totalProcessed}, measured delta: ${measuredDelta}.`,
          clicked ? "success" : "warning",
        );
      result = Boolean(clicked || meaningfulActivityRun);
    }
  } catch (error) {
    logs && log(`[ACTIVITY] Error: ${error.message}`, "error");
  } finally {
    if (sessionFailed) {
      logs &&
        log(
          `[ACTIVITY] Activity aborted because Rewards login was unavailable.`,
          "warning",
        );
    } else if (!clicked && !meaningfulActivityRun) {
      logs && log(`[ACTIVITY] No activities to click.`, "warning");
    }
    if (meaningfulActivityRun && activityMemory && recordRun) {
      await recordActivityRun(activityMemory);
    } else if (meaningfulActivityRun && activityMemory && !recordRun) {
      logs &&
        log(
          `[ACTIVITY] Manual run — not counted toward the daily activity quota.`,
          "update",
        );
    } else if (!sessionFailed) {
      logs &&
        log(
          `[ACTIVITY] Run not counted because no activity cards were processed.`,
          "warning",
        );
    }
    config.runtime.act = 0;
    await chrome.action.setBadgeText({ text: "" });
    if (debuggerReady) {
      await detach(tabId, false);
    }
    await closeOpenedActivityTabs(tabId, activityStartTabs);
    await set(config);
  }
  return result;
}

// `notifyOnFinish` is set only by background triggers (alarms/startup): a user
// who started the run from the open popup watches it live and needs no OS
// notification.
/**
 * `force` runs the requested plan as-is, ignoring today's counters entirely:
 * no trimming for a completed counter, and no stopping when the daily quota
 * turns out to be full. It is set by the popup's Search button, where the user
 * has explicitly asked for a run — a scheduled trigger must never set it, or a
 * repeating alarm would re-run the whole plan every few minutes for the rest
 * of the day.
 */
async function initialise(
  searches,
  expectedSessionId = null,
  { notifyOnFinish = false, force = false } = {},
) {
  if (expectedSessionId && !isSessionStillActive(expectedSessionId)) {
    logs &&
      log(
        `[INITIALISE] - Session ${expectedSessionId} is no longer active. Aborting.`,
        "warning",
      );
    return false;
  }

  const endedSessionType = config?.runtime?.currentSession?.type ?? null;
  _bumpRunGeneration();
  await resetRuntime(config);
  ignoreDailyQuota = Boolean(force);
  searches = normalizeSearchPlan(searches);
  if (!force) {
    searches = limitSearchPlanForToday(searches);
  } else {
    logs &&
      log(
        `[INITIALISE] Manual run: using the full plan (${searches.desk} desktop, ${searches.mob} mobile) regardless of today's counters.`,
        "update",
      );
  }
  const hasSearchPhase = searches.desk > 0 || searches.mob > 0;

  let tabId = null;
  let runSucceeded = false;
  let scheduleSucceeded = false;
  try {
    if (!navigator.onLine) {
      logs &&
        log(
          "[INITIALISE] No internet connection, skipping initialisation.",
          "warning",
        );
      return false;
    }

    if (!hasSearchPhase && !hasActivityWork()) {
      logs &&
        log(
          "[INITIALISE] No searches or activities remaining for today, skipping.",
          "warning",
        );
      return false;
    }

    if (!hasSearchPhase) {
      logs &&
        log(
          "[INITIALISE] Daily searches complete; running activities only.",
          "update",
        );
      config.runtime.currentPhase = "activities";
      await set(config);
      const activityOnlyResult = await handlePostSearchTasks(
        searches,
        expectedSessionId,
        null,
        true,
        {
          isSessionStillActive,
          log: (msg, level) => logs && log(msg, level),
          attachFn: attach,
          detachFn: detach,
          clearFn: clear,
          clickFn: click,
          waitFn: wait,
          delayFn: delay,
          createTabFn: (opts) => chrome.tabs.create(opts),
          removeTabFn: (id) => chrome.tabs.remove(id),
          updateTabFn: (id, opts) => chrome.tabs.update(id, opts),
          activityFn: activity,
          shortestDelay,
          mediumDelay,
          rewards,
          bing,
          getConfig: () => config,
          hasActivityQuotaFn: hasActivityQuota,
        },
      );
      if (activityOnlyResult?.searchTabClosed) {
        tabId = null;
      }
      runSucceeded = Boolean(activityOnlyResult?.runSuccessful);
      scheduleSucceeded = Boolean(
        activityOnlyResult?.searchSuccessful ??
        activityOnlyResult?.runSuccessful,
      );
      return runSucceeded;
    }

    // Only prepare live topics when this run will actually perform searches.
    // Activity-only sessions should not contact external topic providers.
    resetSearchQueryHistory();
    const rsaTab = await chrome.tabs.create({ url: bing, active: true });
    tabId = Number(rsaTab.id);
    config.runtime.rsaTab = tabId;
    config.runtime.total = searches.desk + searches.mob;
    await wait(tabId);
    await delay(shortestDelay, true);

    logs && log(`[INITIALISE] - Created new tab with ID: ${tabId}`, "update");

    await chrome.tabs.update(tabId, { autoDiscardable: false });
    await set(config);
    const debuggerAttached = await attach(tabId);
    if (!debuggerAttached) {
      throw new Error("Could not attach debugger to automation tab.");
    }
    await installFingerprintPatch(tabId);
    await delay(shortestDelay, true);
    await chrome.alarms.clear("schedule");
    await chrome.action.setBadgeText({ text: "0%" });
    await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    await chrome.action.setBadgeBackgroundColor({ color: "#0072FF" });

    config.runtime.currentPhase = "search";
    await set(config);

    const searchPhasesSuccessful = await runSearchPhases(
      searches,
      expectedSessionId,
      tabId,
      {
        isSessionStillActive,
        log: (msg, level) => logs && log(msg, level),
        searchFn: search,
        simulateFn: simulate,
        clearFn: clear,
        setConfig: set,
        getConfig: () => config,
        delayFn: delay,
        shortestDelay,
        detachFn: detach,
        backupAuthCookiesFn: async () => {
          const result = await backupAuthCookiesDetailed();
          // Mirror to storage so an interrupted (worker-killed) run can still
          // restore login on next startup.
          const persisted =
            result.complete &&
            result.cookies.length > 0 &&
            (await persistAuthCookieSnapshot(result.cookies));
          return {
            ...result,
            safeToClear: Boolean(persisted),
          };
        },
        restoreAuthCookiesFn: async (snapshot) => {
          const result = await restoreAuthCookiesDetailed(snapshot);
          if (result.complete) {
            await clearPersistedAuthCookieSnapshot();
          }
          return result;
        },
      },
    );

    config.runtime.currentPhase = "post_search";
    await set(config);

    const postSearchResult = await handlePostSearchTasks(
      searches,
      expectedSessionId,
      tabId,
      searchPhasesSuccessful,
      {
        isSessionStillActive,
        log: (msg, level) => logs && log(msg, level),
        attachFn: attach,
        detachFn: detach,
        clearFn: clear,
        clickFn: click,
        waitFn: wait,
        delayFn: delay,
        createTabFn: (opts) => chrome.tabs.create(opts),
        removeTabFn: (id) => chrome.tabs.remove(id),
        updateTabFn: (id, opts) => chrome.tabs.update(id, opts),
        activityFn: activity,
        shortestDelay,
        mediumDelay,
        rewards,
        bing,
        getConfig: () => config,
        hasActivityQuotaFn: hasActivityQuota,
      },
    );
    if (postSearchResult?.searchTabClosed) {
      tabId = null;
    }

    runSucceeded = Boolean(postSearchResult?.runSuccessful);
    scheduleSucceeded = Boolean(
      postSearchResult?.searchSuccessful ?? postSearchResult?.runSuccessful,
    );
  } catch (err) {
    logs && log(`[INITIALISE] - Unexpected error: ${err.message}`, "error");
    recordCrash("initialise", err, {
      expectedSessionId,
      phase: config?.runtime?.currentPhase,
    });
  } finally {
    needPatch = false;
    // Scoped to this run only: a scheduled run starting later must go back to
    // respecting today's counters.
    ignoreDailyQuota = false;
    await cleanupAfterRun(tabId, expectedSessionId, {
      removeTabFn: (id) => chrome.tabs.remove(id),
      stopCurrentSession:
        RunCoordinator.stopCurrentSession.bind(RunCoordinator),
      setConfig: set,
      createAlarm: (name, opts) => chrome.alarms.create(name, opts),
      log: (msg, level) => logs && log(msg, level),
      getConfig: () => config,
      isActiveSession: RunCoordinator.isActiveSession.bind(RunCoordinator),
      clearBadgeFn: () => chrome.action.setBadgeText({ text: "" }),
      runSucceeded: scheduleSucceeded,
      endedSessionType,
      getScheduleAlarmDelayMs,
      isScheduledModeActive: () => isScheduledModeActive(),
      notifyFn: notifyOnFinish ? notifyScheduledRunFinished : undefined,
    });
  }

  return runSucceeded;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    const stored = await get();
    await applyStoredConfig(stored, "alarm");
    logs && log(`[ALARM] - Alarm triggered.`, "update");
    if (alarm.name === "schedule") {
      if (isScheduledModeActive()) {
        await tryStartScheduledRun("ALARM");
      } else {
        // Mode changed (m1/m2/m5) since this one-shot alarm was armed; a stale
        // fire must not start a run outside the newly chosen mode. Retire it.
        await chrome.alarms.clear("schedule");
        logs &&
          log(
            `[ALARM] - Stale schedule alarm retired (mode changed).`,
            "update",
          );
      }
    } else if (alarm.name === "schedule_daily") {
      if (config?.schedule?.mode !== "m5") {
        // Mode changed since the periodic alarm was created; retire it.
        await chrome.alarms.clear("schedule_daily");
      } else if (
        alarm.scheduledTime &&
        Date.now() - alarm.scheduledTime > DAILY_ALARM_LATE_TOLERANCE_MS
      ) {
        // No catch-up by design: Chrome fires alarms that elapsed while the
        // browser was closed as soon as it starts. Skip occurrences that are
        // meaningfully late; the periodic alarm stays anchored to the chosen
        // time, so the next day's run fires normally.
        logs &&
          log(
            `[ALARM] - Missed daily run (late by ${Math.round((Date.now() - alarm.scheduledTime) / 60000)} min); waiting for tomorrow.`,
            "warning",
          );
      } else {
        await tryStartScheduledRun("ALARM_DAILY");
      }
    } else if (alarm.name === "clear" || alarm.name === "clear_afternoon") {
      logs && log(`[ALARM] - ${alarm.name} alarm triggered.`, "update");
      const refreshed = await refreshSearchCountersFromRewards();
      if (!refreshed) {
        logs &&
          log(
            `[ALARM] - Rewards refresh failed; keeping previous counters as unknown.`,
            "warning",
          );
      }
      if (isScheduledModeActive()) {
        await tryStartScheduledRun("ALARM_CLEAR");
      } else if (config?.schedule?.mode === "m2") {
        logs &&
          log(
            `[ALARM] - Counter refreshed; m2 runs at startup only, not on timed alarms.`,
            "update",
          );
      }
    }
  } catch (error) {
    log(
      `[ALARM] - Error handling alarm ${alarm?.name}: ${error.message}`,
      "error",
    );
    recordCrash(`alarm:${alarm?.name || "unknown"}`, error);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({ mobile_points_enabled: true });
  await configReady;
  await bootstrapConfig();
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    const mobilePref = await chromeStorageGet("mobile_points_enabled");
    if (!mobilePref?.mobile_points_enabled) {
      await chromeStorageSet({ mobile_points_enabled: true });
    }
    const stored = await get();
    await applyStoredConfig(stored, "startup");
    log(`[STARTUP] - Extension started.`, "success");
    const isAtStartupMode = config?.schedule?.mode === "m2";
    if (isScheduledModeActive() || isAtStartupMode) {
      await delay(longestDelay, false);
      await tryStartScheduledRun("STARTUP");
    }
    // The 6 AM "clear" and 3 PM "clear_afternoon" (Asian-timezone reset) alarms
    // are owned by ensureAlarms(); reuse it so alarm setup has a single source
    // of truth instead of being recreated here on every startup.
    await ensureAlarms();
  } catch (error) {
    log(`[STARTUP] - Error during startup: ${error.message}`, "error");
    recordCrash("startup", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let responseSent = false;
  const reply = (payload) => {
    responseSent = true;
    sendResponse(payload);
  };
  (async () => {
    await configReady;
    const stored = await get();
    await applyStoredConfig(stored, `message:${message?.action || "unknown"}`);
    log(`Message received: ${message.action}`);

    switch (message.action) {
      case ACTIONS.START: {
        // Reject BEFORE mutating/persisting config, so a rejected start (because
        // another run is in progress) doesn't silently overwrite the search plan
        // or search counters.
        const startCheck = RunCoordinator.canStartNewRun();
        if (!startCheck.allowed) {
          log(
            `[MESSAGE] - Cannot start search. ${startCheck.reason}`,
            "warning",
          );
          reply({ success: false, message: "A run is already in progress." });
          return;
        }

        config.search = normalizeSearchPlan(message?.searches || config.search);
        // Counters are refreshed for the popup's display only. A manual start
        // runs the plan the user asked for even when today's counters are
        // already complete — being told "nothing remaining" after pressing
        // Search is not a useful answer to an explicit request.
        await refreshSearchCountersFromRewards();

        if (!hasSearchWork(config.search) && !hasActivityWork()) {
          log(
            "Nothing to run: the plan is empty and activities are off.",
            "error",
          );
          reply({
            success: false,
            message:
              "Nothing to run: the plan is empty and activities are off.",
          });
          return;
        }

        const searchSession = RunCoordinator.startNewSession("search");
        if (!searchSession) {
          reply({ success: false, message: "Failed to start session." });
          return;
        }

        await set(config);

        const startLabel = hasSearchWork(config.search)
          ? `${config.search.desk} desktop and ${config.search.mob} mobile`
          : "activities only";
        log(`Starting searches: ${startLabel}. (session: ${searchSession.id})`);
        reply({ success: true, message: "Starting searches." });

        await initialise(config?.search, searchSession.id, { force: true });
        break;
      }

      case ACTIONS.SCHEDULE: {
        config.schedule = normalizeSearchPlan(
          message?.searches || config.schedule,
        );
        config.schedule.time = normalizeDailyTime(config?.schedule?.time);
        await set(config);

        // Any mode other than m5 must not leave a stale daily alarm behind.
        if (config?.schedule?.mode !== "m5") {
          await chrome.alarms.clear("schedule_daily");
        }

        if (config?.schedule?.mode === "m5") {
          await chrome.alarms.clear("schedule");
          if (config?.schedule?.desk === 0 && config?.schedule?.mob === 0) {
            await chrome.alarms.clear("schedule_daily");
            log("No searches to schedule.", "error");
            reply({ success: false, message: "No searches to schedule." });
            return;
          }
          await armDailyScheduleAlarm(config.schedule.time);
          log(
            `[MESSAGE] - Daily schedule armed for ${config.schedule.time}.`,
            "update",
          );
          reply({
            success: true,
            message: `Đã đặt lịch chạy hằng ngày lúc ${config.schedule.time}.`,
          });
          return;
        }

        if (["m3", "m4"].includes(config?.schedule?.mode)) {
          if (config?.schedule?.desk === 0 && config?.schedule?.mob === 0) {
            await chrome.alarms.clear("schedule");
            log("No searches to schedule.", "error");
            reply({ success: false, message: "No searches to schedule." });
            return;
          }
          const armed = await armScheduleAlarm(config.schedule.mode);
          if (!armed) {
            reply({ success: false, message: "Could not arm schedule alarm." });
            return;
          }
          log(
            `[MESSAGE] - Schedule armed for mode ${config.schedule.mode}; next run queued.`,
            "update",
          );
          reply({
            success: true,
            message: "Schedule armed. The next run will start automatically.",
          });
          return;
        }

        await chrome.alarms.clear("schedule");
        if (config?.schedule?.desk === 0 && config?.schedule?.mob === 0) {
          log("No searches to perform.", "error");
          reply({ success: false, message: "No searches to perform." });
          return;
        }

        await refreshSearchCountersFromRewards();
        const limitedSchedulePlan = limitSearchPlanForToday(config.schedule, {
          silent: true,
        });
        if (!hasSearchWork(limitedSchedulePlan) && !hasActivityWork()) {
          log("No searches or activities remaining for today.", "error");
          reply({
            success: false,
            message: "No searches or activities remaining for today.",
          });
          return;
        }

        const scheduleCheck = RunCoordinator.canStartNewRun();
        if (!scheduleCheck.allowed) {
          log(
            `[MESSAGE] - Cannot start schedule. ${scheduleCheck.reason}`,
            "warning",
          );
          reply({ success: false, message: "A run is already in progress." });
          return;
        }

        const scheduleSession = RunCoordinator.startNewSession("schedule");
        if (!scheduleSession) {
          reply({
            success: false,
            message: "Failed to start schedule session.",
          });
          return;
        }

        await set(config);

        const scheduleLabel = hasSearchWork(limitedSchedulePlan)
          ? `${limitedSchedulePlan.desk} desktop and ${limitedSchedulePlan.mob} mobile`
          : "activities only";
        log(
          `Starting scheduled searches: ${scheduleLabel}. (session: ${scheduleSession.id})`,
        );
        reply({ success: true, message: "Starting scheduled searches." });

        await initialise(config?.schedule, scheduleSession.id);
        break;
      }

      case ACTIONS.STOP:
        log("Stopping searches or activities.");
        await handleUserStop();
        reply({
          success: true,
          message: "Stopping searches or activities.",
        });
        break;

      case ACTIONS.CLEAR_BROWSING_DATA: {
        log("Clearing Bing browsing data.");
        const cleared = await clear(false, true);
        reply({
          success: cleared,
          message: cleared
            ? "Bing browsing data cleared."
            : "Failed to clear Bing browsing data.",
        });
        break;
      }

      case ACTIONS.SIMULATE: {
        log("Toggling mobile device simulation.");
        const simulated = await toggleSimulate();
        reply({
          success: simulated,
          message: simulated
            ? "Mobile device simulation toggled."
            : "Failed to toggle mobile device simulation.",
        });
        break;
      }

      case ACTIONS.ACTIVITY: {
        log("Starting activity.");
        const activityCheck = RunCoordinator.canStartNewRun();
        if (!activityCheck.allowed) {
          reply({ success: false, message: "A run is already in progress." });
          return;
        }

        const activitySession = RunCoordinator.startNewSession("activity");
        if (!activitySession) {
          reply({
            success: false,
            message: "Failed to start activity session.",
          });
          return;
        }

        await set(config);
        reply({
          success: true,
          message: "Starting activity.",
        });

        let activityTab = null;
        try {
          activityTab = await chrome.tabs.create({
            url: rewards + "dashboard",
            active: true,
          });
          await wait(activityTab.id);
          await activity(activityTab.id, true, { recordRun: false });
        } finally {
          if (activityTab?.id) {
            try {
              await chrome.tabs.remove(activityTab.id);
            } catch (error) {
              logs &&
                log(
                  `[MESSAGE] Failed to close activity tab: ${error.message}`,
                  "warning",
                );
            }
          }
          if (RunCoordinator.isActiveSession(activitySession.id)) {
            await RunCoordinator.stopCurrentSession("activity_finish");
          } else {
            await set(config);
          }
        }
        break;
      }

      default:
        log(`Unknown message action: ${message.action}`, "error");
        reply({
          success: false,
          message: "Unknown message action.",
        });
        break;
    }
  })().catch((error) => {
    log(
      `[MESSAGE] Error handling ${message?.action || "unknown"}: ${error.message}`,
      "error",
    );
    recordCrash(`message:${message?.action || "unknown"}`, error);
    if (!responseSent) {
      reply({
        success: false,
        message: error.message,
      });
    }
  });
  return true;
});
