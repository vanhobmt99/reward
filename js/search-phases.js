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

  // Helper to update runtime state in-memory + persist to storage once
  const updatePhase = async (phase, extra = {}) => {
    const cfg = getConfig();
    cfg.runtime.currentPhase = phase;
    Object.assign(cfg.runtime, extra);
    await setConfig(cfg);
  };

  try {
    if (searches.desk > 0 && isSessionStillActive(expectedSessionId)) {
      log(`[SEARCH] - Starting desktop searches...`, "update");
      const desktopOk = await searchFn(
        searches.desk,
        searches.min,
        searches.max,
      );

      if (!desktopOk) {
        searchPhasesSuccessful = false;
        log(`[SEARCH] - Desktop searches did not complete cleanly.`, "warning");
      } else {
        log(`[SEARCH] - Desktop searches completed.`, "success");
      }
    }

    let mobilePhaseStarted = false;
    try {
      if (searches.mob > 0 && isSessionStillActive(expectedSessionId)) {
        if (!searchPhasesSuccessful) {
          log(
            `[SEARCH] - Desktop phase did not complete cleanly; continuing requested mobile searches.`,
            "warning",
          );
        }

        mobilePhaseStarted = true;
        await updatePhase("mobile_pre_clear", { mobile: 1 });

        if (getConfig()?.control?.clear) {
          const preserveRewards = getConfig()?.control?.preserveRewards !== 0;
          if (preserveRewards && backupAuthCookiesFn) {
            const backupResult = await backupAuthCookiesFn();
            authCookieSnapshot = Array.isArray(backupResult)
              ? backupResult
              : backupResult?.cookies || [];
            authCookieBackupSafe = Array.isArray(backupResult)
              ? authCookieSnapshot.length > 0
              : backupResult?.safeToClear === true;
            log(
              `[SEARCH] - Backed up Rewards login before mobile clear for mobile points.`,
              "update",
            );
          }
          // Only wipe cookies when we can restore login afterwards. If the backup
          // came back empty (e.g. a transient cookies API failure), clearing
          // cookies would log the user out with nothing to restore — so skip the
          // cookie part of the clear and keep the session.
          const clearCookies = !preserveRewards || authCookieBackupSafe;
          if (preserveRewards && !clearCookies) {
            log(
              `[SEARCH] - No auth cookies backed up; skipping cookie clear to avoid logging out (mobile points may not register this run).`,
              "warning",
            );
          }
          log(
            `[SEARCH] - Clearing browsing data before mobile simulation${clearCookies ? " (cookies included for mobile points)" : ""}...`,
            "update",
          );
          const cleared = await clearFn(true, clearCookies);
          if (!cleared)
            throw new Error(
              "Failed to clear browsing data before mobile simulation.",
            );
          await delayFn(shortestDelay, true);
        }

        await updatePhase("mobile_simulation");

        log(`[SEARCH] - Simulating mobile environment...`, "update");
        const simulated = await simulateFn(tabId);
        if (!simulated) {
          try {
            await detachFn?.(tabId, false);
          } catch (e) {}
          throw new Error("Mobile simulation failed.");
        }

        await delayFn(shortestDelay, true);

        await updatePhase("mobile_search");

        const mobileOk = await searchFn(
          searches.mob,
          searches.min,
          searches.max,
        );
        if (!mobileOk) {
          searchPhasesSuccessful = false;
          log(
            `[SEARCH] - Mobile searches did not complete cleanly.`,
            "warning",
          );
        } else {
          log(`[SEARCH] - Mobile searches completed.`, "success");
        }

        if (getConfig()?.control?.clear) {
          log(
            `[SEARCH] - Clearing Bing cache after mobile searches...`,
            "update",
          );
          const cleared = await clearFn(true, false);
          if (!cleared)
            throw new Error(
              "Failed to clear browsing data after mobile searches.",
            );
          const preserveRewards = getConfig()?.control?.preserveRewards !== 0;
          if (
            preserveRewards &&
            authCookieSnapshot?.length &&
            restoreAuthCookiesFn
          ) {
            const restoreResult =
              await restoreAuthCookiesFn(authCookieSnapshot);
            if (restoreResult?.complete === false) {
              log(
                "[SEARCH] - Rewards cookies were only partially restored; keeping recovery snapshot for retry.",
                "warning",
              );
            } else {
              authCookieSnapshot = null;
            }
          }
          await delayFn(shortestDelay, true);
        }

        await updatePhase("post_mobile", { mobile: 0 });
      } else if (searches.mob > 0 && !isSessionStillActive(expectedSessionId)) {
        log(
          `[SEARCH] - Skipping mobile searches because the session is no longer active.`,
          "warning",
        );
      }
    } catch (searchError) {
      searchPhasesSuccessful = false;
      log(
        `[SEARCH] - Error during mobile searches: ${searchError.message}`,
        "error",
      );
    } finally {
      if (mobilePhaseStarted) {
        try {
          await detachFn?.(tabId, false);
        } catch (e) {}
        if (
          authCookieSnapshot?.length &&
          restoreAuthCookiesFn &&
          getConfig()?.control?.preserveRewards !== 0
        ) {
          const restoreResult = await restoreAuthCookiesFn(authCookieSnapshot);
          if (restoreResult?.complete !== false) {
            authCookieSnapshot = null;
          }
        }
        const cfg = getConfig();
        if (cfg.runtime.mobile) {
          cfg.runtime.mobile = 0;
          // SAFETY: getConfig() returns the same object reference the coordinator
          // already mutated (running=0 etc.), so this write won't re-enable running.
          await setConfig(cfg);
        }
      }
    }
  } catch (err) {
    searchPhasesSuccessful = false;
    log(`[SEARCH_PHASES] - Error: ${err.message}`, "error");
  }

  return searchPhasesSuccessful;
}

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
    typeof hasActivityQuotaFn !== "function" || hasActivityQuotaFn();

  if (!isSessionStillActive(expectedSessionId)) {
    log(
      `[POST_SEARCH] - Session no longer active before post-search tasks.`,
      "warning",
    );
    return {
      searchTabClosed: false,
      runSuccessful: false,
      searchSuccessful: false,
    };
  }

  if (
    !searchPhasesSuccessful &&
    isSessionStillActive(expectedSessionId) &&
    getConfig()?.control?.act
  ) {
    log(
      `[POST_SEARCH] - Searches finished with warnings; continuing automated activities.`,
      "warning",
    );
  }

  if (!getConfig()?.runtime?.running) {
    log(
      `[POST_SEARCH] - Run stopped before cleanup/activity phase.`,
      "warning",
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

  const shouldRunPostSearchClear =
    isSessionStillActive(expectedSessionId) &&
    getConfig()?.control?.clear &&
    !getConfig()?.control?.act &&
    Number(searches?.mob || 0) <= 0;
  const shouldSkipPostSearchClear =
    isSessionStillActive(expectedSessionId) &&
    getConfig()?.control?.clear &&
    !shouldRunPostSearchClear;

  if (shouldRunPostSearchClear && tabId) {
    try {
      await attachFn(tabId);
      await delayFn(shortestDelay, true);
      await updateTabFn(tabId, { url: bing, active: true });
      await waitFn(tabId);
      await delayFn(shortestDelay, true);
      await clearFn();
      await delayFn(shortestDelay, true);
      await clickFn();
      await delayFn(shortestDelay, true);
      await detachFn(tabId, false);
      log(`[POST_SEARCH] - Browsing data cleared after searches.`, "success");
    } catch (clearError) {
      log(
        `[POST_SEARCH] - Error clearing browsing data: ${clearError.message}`,
        "warning",
      );
      await detachFn(tabId, false).catch(() => {});
    }
  } else if (shouldSkipPostSearchClear) {
    const skipMessage = getConfig()?.control?.act
      ? `[POST_SEARCH] - Skipping post-search clear to preserve Rewards session before returning to Rewards.`
      : `[POST_SEARCH] - Skipping post-search clear because mobile phase already cleared browsing data.`;
    log(skipMessage, "update");
  }

  if (tabId) {
    try {
      await removeTabFn(tabId);
      log(`[POST_SEARCH] - Closed search tab early: ${tabId}`, "update");
      tabId = null;
    } catch (err) {
      log(
        `[POST_SEARCH] - Failed to close search tab early: ${err.message}`,
        "warning",
      );
    }
  }

  let activityQuotaExceeded = false;

  if (isSessionStillActive(expectedSessionId) && getConfig()?.control?.act) {
    if (!activityQuotaAvailable) {
      activityQuotaExceeded = true;
      log(
        `[POST_SEARCH] - Skipping activities; daily activity run quota already reached.`,
        "update",
      );
    } else {
      try {
        log(`[POST_SEARCH] - Creating a clean tab for activities...`, "update");
        const activityTab = await createTabFn({
          url: rewards + "dashboard",
          active: true,
        });
        const activityTabId = Number(activityTab.id);

        log(
          `[POST_SEARCH] - Activity started for tab ${activityTabId}.`,
          "update",
        );
        const activityWarmupDelay =
          Number(searches?.mob || 0) > 0
            ? mediumDelay || shortestDelay
            : shortestDelay;
        await delayFn(activityWarmupDelay, true);
        const activityOk = await activityFn(activityTabId, true);
        if (!activityOk) {
          activitySuccessful = false;
          log(
            `[POST_SEARCH] - Activity engine finished without clicking any cards.`,
            "warning",
          );
        } else {
          log(
            `[POST_SEARCH] - Activity completed for tab ${activityTabId}.`,
            "success",
          );
        }

        try {
          await removeTabFn(activityTabId);
          log(
            `[POST_SEARCH] - Closed activity tab with ID: ${activityTabId}`,
            "update",
          );
        } catch (err) {
          log(
            `[POST_SEARCH] - Failed to close activity tab: ${err.message}`,
            "warning",
          );
        }
      } catch (activityError) {
        activitySuccessful = false;
        log(
          `[POST_SEARCH] - Error during activities: ${activityError.message}`,
          "error",
        );
      }
    }
  }

  const sessionStillActive =
    isSessionStillActive(expectedSessionId) && !!getConfig()?.runtime?.running;
  const activitiesEnabled =
    !!getConfig()?.control?.act && !activityQuotaExceeded;
  const searchSuccessful = searchPhasesSuccessful && sessionStillActive;
  const runSuccessful =
    searchSuccessful && (!activitiesEnabled || activitySuccessful);

  if (!runSuccessful && sessionStillActive) {
    if (!searchPhasesSuccessful) {
      log(
        `[POST_SEARCH] - Run not successful because search phases did not complete cleanly.`,
        "warning",
      );
    } else if (activitiesEnabled && !activitySuccessful) {
      log(
        `[POST_SEARCH] - Searches completed but activities did not finish cleanly.`,
        "warning",
      );
    }
  }

  return { searchTabClosed: tabId === null, runSuccessful, searchSuccessful };
}

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

  if (tabId) {
    try {
      await removeTabFn(tabId).catch(() => {});
    } catch (e) {}
  }

  try {
    await clearBadgeFn?.();
  } catch (e) {}

  const config = getConfig();
  const sessionType =
    config?.runtime?.currentSession?.type ?? deps.endedSessionType;
  const isCurrentSession = deps.isActiveSession(expectedSessionId);
  const noConflictingRun = !config?.runtime?.currentSession || isCurrentSession;

  if (isCurrentSession) {
    await stopCurrentSession("normal_finish");
  }

  if (isCurrentSession || !config?.runtime?.currentSession) {
    config.runtime.rsaTab = null;
    config.runtime.mobile = 0;
    config.runtime.act = 0;
    config.runtime.currentPhase = null;
    await setConfig(config);
  }

  // A scheduled run finished while the popup was closed — surface the outcome
  // via a system notification when the caller provides one. `isCurrentSession`
  // filters out user-initiated stops (the session is already gone by cleanup
  // time), which need no "run failed" notification.
  if (
    sessionType === "schedule" &&
    isCurrentSession &&
    typeof notifyFn === "function"
  ) {
    try {
      notifyFn(runSucceeded);
    } catch (e) {}
  }

  const shouldRearmSchedule =
    noConflictingRun &&
    (isCurrentSession || deps.endedSessionType) &&
    typeof getScheduleAlarmDelayMs === "function" &&
    typeof isScheduledModeActive === "function" &&
    isScheduledModeActive();

  if (
    shouldRearmSchedule &&
    (sessionType === "schedule" || sessionType === "search")
  ) {
    const scheduleMode = config?.schedule?.mode;
    let delayMs = getScheduleAlarmDelayMs(scheduleMode);
    if (!runSucceeded && delayMs) {
      // Backoff: double the delay on failure (cap at 30 minutes)
      delayMs = Math.min(delayMs * 2, 30 * 60 * 1000);
      log(
        `[CLEANUP] - Run failed; re-arming schedule with backoff delay (${Math.round(delayMs / 1000)}s).`,
        "warning",
      );
    }
    if (delayMs) {
      await createAlarm("schedule", { when: Date.now() + delayMs });
      if (runSucceeded) {
        log(`[CLEANUP] - Scheduled next run.`, "update");
      }
    }
  }
}
