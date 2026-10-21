// How many times the mobile emulation handshake is retried before the mobile
// phase is abandoned.
const MOBILE_SIMULATION_ATTEMPTS = 3;

/**
 * @typedef {{desk: number, mob: number, min: number, max: number}}
 *     SearchPhaseCounts
 */
/**
 * @typedef {{clear: (number|undefined), preserveRewards: (number|undefined)}}
 *     SearchPhaseControl
 */
/**
 * @typedef {{mobile: (number|undefined),
 *     currentPhase: (string|null|undefined)}} SearchPhaseRuntime
 */
/**
 * @typedef {{control: (SearchPhaseControl|undefined),
 *     runtime: !SearchPhaseRuntime}} SearchPhaseConfig
 */
/**
 * @typedef {{name: (string|undefined)}} SearchPhaseCookie
 */
/**
 * @typedef {!Array<!SearchPhaseCookie>|{cookies: !Array<!SearchPhaseCookie>,
 *     safeToClear: (boolean|undefined)}} SearchPhaseCookieBackup
 */
/**
 * @typedef {{isSessionStillActive: function(string): boolean,
 *     log: function(string, string): void,
 *     searchFn: function(number, number, number): !Promise<boolean>,
 *     simulateFn: function(number): !Promise<boolean>,
 *     clearFn: function(boolean, boolean): !Promise<boolean>,
 *     setConfig: function(!SearchPhaseConfig): !Promise<void>,
 *     getConfig: function(): !SearchPhaseConfig,
 *     delayFn: function(number, boolean): !Promise<void>,
 *     shortestDelay: number,
 *     detachFn: (undefined|function(number, boolean): !Promise<void>),
 *     backupAuthCookiesFn: (undefined|function():
 * !Promise<SearchPhaseCookieBackup>), restoreAuthCookiesFn:
 * (undefined|function(!Array<!SearchPhaseCookie>):
 * !Promise<({complete: (boolean|undefined)}|number)>)}} SearchPhaseDependencies
 */

/**
 * Runs the requested desktop searches, then mobile searches when mob is above
 * zero. A failed desktop phase does not cancel the mobile phase.
 * @param {!SearchPhaseCounts} searches Desktop and mobile counts plus the read
 *     delay bounds in seconds.
 * @param {string} expectedSessionId Session that must stay current.
 * @param {number} tabId Search tab passed to mobile simulation.
 * @param {!SearchPhaseDependencies} deps Session, logging, search and cookie
 *     hooks.
 * @return {!Promise<boolean>} False when either phase did not complete cleanly.
 */
export async function runSearchPhases(
    searches,
    expectedSessionId,
    tabId,
    deps,
) {
  const {
    isSessionStillActive,
    log,
    searchFn,
    simulateFn,
    clearFn,
    setConfig,
    getConfig,
    delayFn,
    shortestDelay,
    detachFn,
    backupAuthCookiesFn,
    restoreAuthCookiesFn,
  } = deps;

  let searchPhasesSuccessful = true;
  let authCookieSnapshot = null;
  let authCookieBackupSafe = false;

  /**
   * Copies the phase onto the in-memory runtime and persists that config.
   * @param {string} phase Runtime currentPhase value.
   * @param {!SearchPhaseRuntime=} extra Runtime fields merged before the write.
   *     Defaults to an empty object.
   */
  const updatePhase = async (phase, extra = {}) => {
    const cfg = getConfig();
    cfg.runtime.currentPhase = phase;
    Object.assign(cfg.runtime, extra);
    await setConfig(cfg);
  };

  try {
    if (searches.desk > 0 && isSessionStillActive(expectedSessionId)) {
      log(`[SEARCH] - Starting desktop searches...`, 'update');
      const desktopOk = await searchFn(
          searches.desk,
          searches.min,
          searches.max,
      );

      if (!desktopOk) {
        searchPhasesSuccessful = false;
        log(`[SEARCH] - Desktop searches did not complete cleanly.`, 'warning');
      } else {
        log(`[SEARCH] - Desktop searches completed.`, 'success');
      }
    }

    let mobilePhaseStarted = false;
    try {
      if (searches.mob > 0 && isSessionStillActive(expectedSessionId)) {
        if (!searchPhasesSuccessful) {
          log(
              `[SEARCH] - Desktop phase did not complete cleanly; continuing requested mobile searches.`,
              'warning',
          );
        }

        mobilePhaseStarted = true;
        await updatePhase('mobile_pre_clear', {mobile: 1});

        if (getConfig()?.control?.clear) {
          const preserveRewards = getConfig()?.control?.preserveRewards !== 0;
          if (preserveRewards && backupAuthCookiesFn) {
            const backupResult = await backupAuthCookiesFn();
            authCookieSnapshot = Array.isArray(backupResult) ?
                backupResult :
                backupResult?.cookies || [];
            authCookieBackupSafe = Array.isArray(backupResult) ?
                authCookieSnapshot.length > 0 :
                backupResult?.safeToClear === true;
            log(
                `[SEARCH] - Backed up Rewards login before mobile clear for mobile points.`,
                'update',
            );
          }
          // Only wipe cookies when we can restore login afterwards. If the
          // backup came back empty (e.g. a transient cookies API failure),
          // clearing cookies would log the user out with nothing to restore —
          // so skip the cookie part of the clear and keep the session.
          const clearCookies = !preserveRewards || authCookieBackupSafe;
          if (preserveRewards && !clearCookies) {
            log(
                `[SEARCH] - No auth cookies backed up; skipping cookie clear to avoid logging out (mobile points may not register this run).`,
                'warning',
            );
          }
          log(
              `[SEARCH] - Clearing browsing data before mobile simulation${
                  clearCookies ? ' (cookies included for mobile points)' :
                                 ''}...`,
              'update',
          );
          const cleared = await clearFn(true, clearCookies);
          if (!cleared) {
            throw new Error(
                'Failed to clear browsing data before mobile simulation.',
            );
          }
          await delayFn(shortestDelay, true);
        }

        await updatePhase('mobile_simulation');

        log(`[SEARCH] - Simulating mobile environment...`, 'update');
        // A failed simulation costs the entire mobile phase (all of the day's
        // mobile points), and it fails for transient reasons: the debugger
        // raced the post-clear reload, the tab was still settling. Retry before
        // writing the phase off.
        let simulated = false;
        for (let attempt = 1; attempt <= MOBILE_SIMULATION_ATTEMPTS;
             attempt++) {
          simulated = await simulateFn(tabId);
          if (simulated) {
            break;
          }
          if (!isSessionStillActive(expectedSessionId)) {
            break;
          }
          if (attempt < MOBILE_SIMULATION_ATTEMPTS) {
            log(
                `[SEARCH] - Mobile simulation attempt ${attempt}/${
                    MOBILE_SIMULATION_ATTEMPTS} failed; retrying.`,
                'warning',
            );
            // Drop the half-configured debugger session so the retry starts
            // from a clean attach.
            try {
              await detachFn?.(tabId, false);
            } catch (e) {
            }
            await delayFn(shortestDelay, true);
          }
        }
        if (!simulated) {
          try {
            await detachFn?.(tabId, false);
          } catch (e) {
          }
          throw new Error(
              `Mobile simulation failed after ${
                  MOBILE_SIMULATION_ATTEMPTS} attempts.`,
          );
        }

        await delayFn(shortestDelay, true);

        await updatePhase('mobile_search');

        const mobileOk = await searchFn(
            searches.mob,
            searches.min,
            searches.max,
        );
        if (!mobileOk) {
          searchPhasesSuccessful = false;
          log(
              `[SEARCH] - Mobile searches did not complete cleanly.`,
              'warning',
          );
        } else {
          log(`[SEARCH] - Mobile searches completed.`, 'success');
        }

        if (getConfig()?.control?.clear) {
          log(
              `[SEARCH] - Clearing Bing cache after mobile searches...`,
              'update',
          );
          const cleared = await clearFn(true, false);
          if (!cleared) {
            throw new Error(
                'Failed to clear browsing data after mobile searches.',
            );
          }
          const preserveRewards = getConfig()?.control?.preserveRewards !== 0;
          if (preserveRewards && authCookieSnapshot?.length &&
              restoreAuthCookiesFn) {
            const restoreResult =
                await restoreAuthCookiesFn(authCookieSnapshot);
            if (restoreResult?.complete === false) {
              log(
                  '[SEARCH] - Rewards cookies were only partially restored; keeping recovery snapshot for retry.',
                  'warning',
              );
            } else {
              authCookieSnapshot = null;
            }
          }
          await delayFn(shortestDelay, true);
        }

        await updatePhase('post_mobile', {mobile: 0});
      } else if (searches.mob > 0 && !isSessionStillActive(expectedSessionId)) {
        log(
            `[SEARCH] - Skipping mobile searches because the session is no longer active.`,
            'warning',
        );
      }
    } catch (searchError) {
      searchPhasesSuccessful = false;
      log(
          `[SEARCH] - Error during mobile searches: ${searchError.message}`,
          'error',
      );
    } finally {
      if (mobilePhaseStarted) {
        try {
          await detachFn?.(tabId, false);
        } catch (e) {
        }
        if (authCookieSnapshot?.length && restoreAuthCookiesFn &&
            getConfig()?.control?.preserveRewards !== 0) {
          const restoreResult = await restoreAuthCookiesFn(authCookieSnapshot);
          if (restoreResult?.complete !== false) {
            authCookieSnapshot = null;
          }
        }
        const cfg = getConfig();
        if (cfg.runtime.mobile) {
          cfg.runtime.mobile = 0;
          // SAFETY: getConfig() returns the same object reference the
          // coordinator already mutated (running=0 etc.), so this write won't
          // re-enable running.
          await setConfig(cfg);
        }
      }
    }
  } catch (err) {
    searchPhasesSuccessful = false;
    log(`[SEARCH_PHASES] - Error: ${err.message}`, 'error');
  }

  return searchPhasesSuccessful;
}

/**
 * @typedef {{running: (number|undefined)}} PostSearchRuntime
 */
/**
 * @typedef {{clear: (number|undefined), act: (number|undefined)}}
 *     PostSearchControl
 */
/**
 * @typedef {{control: (PostSearchControl|undefined),
 *     runtime: (PostSearchRuntime|undefined)}} PostSearchConfig
 */
/**
 * @typedef {{isSessionStillActive: function(string): boolean,
 *     log: function(string, string): void,
 *     attachFn: function(number): !Promise<void>,
 *     detachFn: function(number, boolean): !Promise<void>,
 *     clearFn: function(): !Promise<void>, clickFn: function(): !Promise<void>,
 *     waitFn: function(number): !Promise<void>,
 *     delayFn: function(number, boolean): !Promise<void>,
 *     createTabFn: function({url: string, active: boolean}):
 * !Promise<{id: number}>, removeTabFn: function(number): !Promise<void>,
 *     updateTabFn: function(number, {url: string, active: boolean}):
 * !Promise<void>, activityFn: function(number, boolean): !Promise<boolean>,
 *     shortestDelay: number, mediumDelay: (number|undefined), rewards: string,
 *     bing: string, getConfig: function(): !PostSearchConfig,
 *     hasActivityQuotaFn: (undefined|function(): boolean)}}
 *     PostSearchDependencies
 */
/**
 * @typedef {{searchTabClosed: boolean, runSuccessful: boolean,
 *     searchSuccessful: boolean}} PostSearchResult
 */

/**
 * Closes the search tab and, when activities are enabled and quota remains,
 * runs them on a fresh Rewards tab.
 * @param {!SearchPhaseCounts} searches Plan counts. Only mob is read here.
 * @param {string} expectedSessionId Session that must stay current.
 * @param {?number} tabId Search tab to detach and close. Null skips tab work.
 * @param {boolean} searchPhasesSuccessful Whether both search phases finished
 *     cleanly.
 * @param {!PostSearchDependencies} deps Tab, activity and logging hooks.
 * @return {!Promise<!PostSearchResult>} Whether the search tab was closed and
 *     whether the run and searches succeeded.
 */
export async function handlePostSearchTasks(
    searches,
    expectedSessionId,
    tabId,
    searchPhasesSuccessful,
    deps,
) {
  const {
    isSessionStillActive,
    log,
    attachFn,
    detachFn,
    clearFn,
    clickFn,
    waitFn,
    delayFn,
    createTabFn,
    removeTabFn,
    updateTabFn,
    activityFn,
    shortestDelay,
    mediumDelay,
    rewards,
    bing,
    getConfig,
    hasActivityQuotaFn,
  } = deps;
  // When no quota function is supplied, default to "quota available" so callers
  // that don't care about the daily activity cap keep their previous behaviour.
  const activityQuotaAvailable =
      typeof hasActivityQuotaFn !== 'function' || hasActivityQuotaFn();

  if (!isSessionStillActive(expectedSessionId)) {
    log(
        `[POST_SEARCH] - Session no longer active before post-search tasks.`,
        'warning',
    );
    return {
      searchTabClosed: false,
      runSuccessful: false,
      searchSuccessful: false,
    };
  }

  if (!searchPhasesSuccessful && isSessionStillActive(expectedSessionId) &&
      getConfig()?.control?.act) {
    log(
        `[POST_SEARCH] - Searches finished with warnings; continuing automated activities.`,
        'warning',
    );
  }

  if (!getConfig()?.runtime?.running) {
    log(
        `[POST_SEARCH] - Run stopped before cleanup/activity phase.`,
        'warning',
    );
    return {
      searchTabClosed: false,
      runSuccessful: false,
      searchSuccessful: false,
    };
  }

  let activitySuccessful = true;

  if (tabId) {
    await detachFn(tabId, false).catch(() => {});
  }
  await delayFn(shortestDelay, false);

  const shouldRunPostSearchClear = isSessionStillActive(expectedSessionId) &&
      getConfig()?.control?.clear && !getConfig()?.control?.act &&
      Number(searches?.mob || 0) <= 0;
  const shouldSkipPostSearchClear = isSessionStillActive(expectedSessionId) &&
      getConfig()?.control?.clear && !shouldRunPostSearchClear;

  if (shouldRunPostSearchClear && tabId) {
    try {
      await attachFn(tabId);
      await delayFn(shortestDelay, true);
      await updateTabFn(tabId, {url: bing, active: true});
      await waitFn(tabId);
      await delayFn(shortestDelay, true);
      await clearFn();
      await delayFn(shortestDelay, true);
      await clickFn();
      await delayFn(shortestDelay, true);
      await detachFn(tabId, false);
      log(`[POST_SEARCH] - Browsing data cleared after searches.`, 'success');
    } catch (clearError) {
      log(
          `[POST_SEARCH] - Error clearing browsing data: ${clearError.message}`,
          'warning',
      );
      await detachFn(tabId, false).catch(() => {});
    }
  } else if (shouldSkipPostSearchClear) {
    const skipMessage = getConfig()?.control?.act ?
        `[POST_SEARCH] - Skipping post-search clear to preserve Rewards session before returning to Rewards.` :
        `[POST_SEARCH] - Skipping post-search clear because mobile phase already cleared browsing data.`;
    log(skipMessage, 'update');
  }

  if (tabId) {
    try {
      await removeTabFn(tabId);
      log(`[POST_SEARCH] - Closed search tab early: ${tabId}`, 'update');
      tabId = null;
    } catch (err) {
      log(
          `[POST_SEARCH] - Failed to close search tab early: ${err.message}`,
          'warning',
      );
    }
  }

  let activityQuotaExceeded = false;

  if (isSessionStillActive(expectedSessionId) && getConfig()?.control?.act) {
    if (!activityQuotaAvailable) {
      activityQuotaExceeded = true;
      log(
          `[POST_SEARCH] - Skipping activities; daily activity run quota already reached.`,
          'update',
      );
    } else {
      let activityTabId = null;
      try {
        log(`[POST_SEARCH] - Creating a clean tab for activities...`, 'update');
        const activityTab = await createTabFn({
          // Daily Set cards live on the Dashboard. The activity engine moves
          // to /earn itself after this pass for Keep earning cards.
          url: rewards + 'dashboard',
          active: true,
        });
        activityTabId = Number(activityTab.id);

        log(
            `[POST_SEARCH] - Activity started for tab ${activityTabId}.`,
            'update',
        );
        const activityWarmupDelay = Number(searches?.mob || 0) > 0 ?
            mediumDelay || shortestDelay :
            shortestDelay;
        await delayFn(activityWarmupDelay, true);
        const activityOk = await activityFn(activityTabId, true);
        if (!activityOk) {
          activitySuccessful = false;
          log(
              `[POST_SEARCH] - Activity incomplete; closing the automation tab.`,
              'warning',
          );
        } else {
          log(
              `[POST_SEARCH] - Activity completed for tab ${activityTabId}.`,
              'success',
          );
        }
      } catch (activityError) {
        activitySuccessful = false;
        log(
            `[POST_SEARCH] - Error during activities: ${activityError.message}`,
            'error',
        );
      } finally {
        if (activityTabId) {
          try {
            await removeTabFn(activityTabId);
            log(
                `[POST_SEARCH] - Closed activity tab ${activityTabId}.`,
                'update',
            );
          } catch (err) {
            log(
                `[POST_SEARCH] - Failed to close activity tab: ${err.message}`,
                'warning',
            );
          }
        }
      }
    }
  }

  const sessionStillActive = isSessionStillActive(expectedSessionId) &&
      !!getConfig()?.runtime?.running;
  const activitiesEnabled =
      !!getConfig()?.control?.act && !activityQuotaExceeded;
  const searchSuccessful = searchPhasesSuccessful && sessionStillActive;
  const runSuccessful =
      searchSuccessful && (!activitiesEnabled || activitySuccessful);

  if (!runSuccessful && sessionStillActive) {
    if (!searchPhasesSuccessful) {
      log(
          `[POST_SEARCH] - Run not successful because search phases did not complete cleanly.`,
          'warning',
      );
    } else if (activitiesEnabled && !activitySuccessful) {
      log(
          `[POST_SEARCH] - Searches completed but activities did not finish cleanly.`,
          'warning',
      );
    }
  }

  return {searchTabClosed: tabId === null, runSuccessful, searchSuccessful};
}

/**
 * @typedef {{runtime: {running: (number|undefined),
 *     currentSession: ({id: string, type: string}|null|undefined),
 *     rsaTab: (number|null|undefined), mobile: (number|undefined),
 *     act: (number|undefined), currentPhase: (string|null|undefined)},
 *     schedule: ({mode: string}|undefined)}} CleanupConfig
 */
/**
 * @typedef {{removeTabFn: function(number): !Promise<void>,
 *     stopCurrentSession: function(string): (void|!Promise<void>),
 *     setConfig: function(!CleanupConfig): (void|!Promise<*>),
 *     createAlarm: function(string, {when: number}): (void|!Promise<void>),
 *     log: function(string, string): void, getConfig: function():
 * !CleanupConfig, clearBadgeFn: (undefined|function(): (void|!Promise<void>)),
 *     isActiveSession: function(?string): boolean,
 *     runSucceeded: (boolean|undefined), endedSessionType:
 * (string|null|undefined), getScheduleAlarmDelayMs:
 * (undefined|function((string|undefined)): ?number), isScheduledModeActive:
 * (undefined|function(): boolean), notifyFn: (undefined|function(boolean):
 * void)}} CleanupDependencies
 */
/**
 * Releases a run's tab and, only while no newer run owns shared state, its UI,
 * runtime and schedule. Ownership is checked again after asynchronous effects;
 * commands already sent to browser APIs cannot be retroactively cancelled.
 * @param {?number} tabId Tab originally owned by the finishing run.
 * @param {?string} expectedSessionId Finishing session ID.
 * @param {!CleanupDependencies} deps Live ownership, persistence and browser
 *     I/O.
 * @return {!Promise<void>} Completes cleanup or stops when ownership changes.
 */
export async function cleanupAfterRun(tabId, expectedSessionId, deps) {
  const {
    removeTabFn,
    stopCurrentSession,
    setConfig,
    createAlarm,
    log,
    getConfig,
    clearBadgeFn,
    runSucceeded = false,
    getScheduleAlarmDelayMs,
    isScheduledModeActive,
    notifyFn,
  } = deps;

  /** @return {boolean} Whether another run owns shared state now. */
  const hasConflictingRun = () => {
    const runtime = getConfig()?.runtime;
    const session = runtime?.currentSession;
    return session ? session.id !== expectedSessionId :
                     Boolean(runtime?.running);
  };
  if (tabId &&
      !(hasConflictingRun() && getConfig()?.runtime?.rsaTab === tabId)) {
    try {
      await removeTabFn(tabId).catch(() => {});
    } catch (e) {
    }
  }

  if (hasConflictingRun()) {
    return;
  }
  const sessionType =
      getConfig()?.runtime?.currentSession?.type ?? deps.endedSessionType;
  const isCurrentSession = deps.isActiveSession(expectedSessionId);
  if (isCurrentSession) {
    await stopCurrentSession('normal_finish');
  }
  if (hasConflictingRun()) {
    return;
  }
  try {
    await clearBadgeFn?.();
  } catch (e) {
  }

  if (hasConflictingRun()) {
    return;
  }
  const config = getConfig();

  if (isCurrentSession || !config?.runtime?.currentSession) {
    config.runtime.rsaTab = null;
    config.runtime.mobile = 0;
    config.runtime.act = 0;
    config.runtime.currentPhase = null;
    await setConfig(config);
  }
  if (hasConflictingRun()) {
    return;
  }

  // A scheduled run finished while the popup was closed — surface the outcome
  // via a system notification when the caller provides one. `isCurrentSession`
  // filters out user-initiated stops (the session is already gone by cleanup
  // time), which need no "run failed" notification.
  if (sessionType === 'schedule' && isCurrentSession &&
      typeof notifyFn === 'function') {
    try {
      notifyFn(runSucceeded);
    } catch (e) {
    }
  }

  const shouldRearmSchedule = !hasConflictingRun() &&
      (isCurrentSession || deps.endedSessionType) &&
      typeof getScheduleAlarmDelayMs === 'function' &&
      typeof isScheduledModeActive === 'function' && isScheduledModeActive();

  if (shouldRearmSchedule &&
      (sessionType === 'schedule' || sessionType === 'search')) {
    const scheduleMode = getConfig()?.schedule?.mode;
    let delayMs = getScheduleAlarmDelayMs(scheduleMode);
    if (!runSucceeded && delayMs) {
      // Backoff: double the delay on failure (cap at 30 minutes)
      delayMs = Math.min(delayMs * 2, 30 * 60 * 1000);
      log(
          `[CLEANUP] - Run failed; re-arming schedule with backoff delay (${
              Math.round(delayMs / 1000)}s).`,
          'warning',
      );
    }
    if (delayMs) {
      await createAlarm('schedule', {when: Date.now() + delayMs});
      if (runSucceeded) {
        log(`[CLEANUP] - Scheduled next run.`, 'update');
      }
    }
  }
}
