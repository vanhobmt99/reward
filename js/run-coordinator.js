/** @typedef {'search'|'schedule'|'activity'} RunType */
/** @typedef {{id: string, type: RunType, startedAt: number}} RunSession */
/**
 * @typedef {{running: number, mode: (RunType|null|undefined),
 *     currentSession: ?RunSession, currentPhase: ?string,
 *     act: (number|undefined), rsaTab: (number|null|undefined),
 *     mobile: (number|undefined)}} CoordinatorRuntime
 */
/** @typedef {{runtime: !CoordinatorRuntime}} CoordinatorConfig */
/**
 * @typedef {{allowed: boolean, reason: (?string),
 *     currentSession: (RunSession|null|undefined)}} RunStartCheck
 */
/**
 * @typedef {{getConfig: function(): !CoordinatorConfig,
 *     setConfig: (undefined|function(!CoordinatorConfig): !Promise<void>),
 *     log: (undefined|function(string, string=): void)}}
 * CoordinatorDependencies
 */
/**
 * @typedef {{canStartNewRun: function(): !RunStartCheck,
 *     startNewSession: function(RunType): ?RunSession,
 *     stopCurrentSession: function(string=): !Promise<void>,
 *     isActiveSession: function(?string): boolean}} RunCoordinator
 */

/**
 * @param {RunType} type User-selected run category.
 * @return {!RunSession} New in-memory session record.
 */
function createSession(type) {
  const startedAt = Date.now();
  return {
    id: `${type}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    startedAt,
  };
}

/**
 * @param {function(): ?RunSession} getCurrentSession Live session getter.
 * @return {function(?string): boolean} Guard for callers with optional session
 *     IDs.
 */
export function createIsSessionStillActive(getCurrentSession) {
  /**
   * @param {?string} expectedSessionId Expected ID; null permits legacy
   *     callers.
   * @return {boolean} Whether this caller still belongs to the active session.
   */
  function isSessionStillActive(expectedSessionId) {
    if (!expectedSessionId) {
      return true;
    }
    if (typeof getCurrentSession !== 'function') {
      return false;
    }
    const current = getCurrentSession();
    return Boolean(current && current.id === expectedSessionId);
  }
  return isSessionStillActive;
}

/**
 * @param {!CoordinatorDependencies} deps Config access, persistence and
 *     logging.
 * @return {!RunCoordinator} Synchronous session ownership with async
 *     persistence.
 */
export function createRunCoordinator(deps) {
  const {getConfig, setConfig, log} = deps;
  /** @type {?Promise<void>} */
  let pendingStop = null;

  /**
   * @param {!CoordinatorConfig} config Live runtime state to clear.
   * @return {void} In-memory stop is visible immediately.
   */
  function resetRuntime(config) {
    config.runtime.running = 0;
    config.runtime.mode = null;
    config.runtime.currentSession = null;
    config.runtime.currentPhase = null;
    config.runtime.act = 0;
    config.runtime.rsaTab = null;
    config.runtime.mobile = 0;
  }

  const coordinator = {
    /**
     * @return {!RunStartCheck} Whether the current runtime permits a new run.
     */
    canStartNewRun() {
      if (pendingStop) {
        return {allowed: false, reason: 'STOPPING'};
      }
      const config = getConfig();
      const current = config?.runtime?.currentSession;
      const isRunning = !!config?.runtime?.running;

      if (!isRunning) {
        return {allowed: true, reason: null};
      }

      return {
        allowed: false,
        reason: current ? 'ALREADY_RUNNING' : 'RUNNING_WITHOUT_SESSION',
        currentSession: current,
      };
    },

    /**
     * @param {RunType} type Requested run category.
     * @return {?RunSession} Started session, or null when another run owns it.
     */
    startNewSession(type) {
      const check = this.canStartNewRun();

      if (!check.allowed) {
        log &&
            log(
                `[COORDINATOR] - Cannot start new ${type} run. Reason: ${
                    check.reason}. Current: ${check.currentSession?.id}`,
                'warning',
            );
        return null;
      }

      const session = createSession(type);
      const config = getConfig();
      config.runtime.currentSession = session;
      config.runtime.mode = type;
      config.runtime.running = 1;

      log &&
          log(
              `[COORDINATOR] - Started new session: ${session.id} (type: ${
                  type})`,
          );
      return session;
    },

    /**
     * @param {string=} reason Reason recorded in the log.
     * @return {!Promise<void>} Shared pending stop; resolves after persistence.
     */
    stopCurrentSession(reason = 'user_stop') {
      if (pendingStop) {
        return pendingStop;
      }
      const config = getConfig();
      const session = config?.runtime?.currentSession;
      resetRuntime(config);
      // Claim stop ownership before invoking persistence or logging callbacks.
      // Concurrent stops share this result, including rejection; either outcome
      // releases the gate so a storage failure cannot permanently block starts.
      pendingStop =
          Promise.resolve()
              .then(async () => {
                log &&
                    log(session ?
                            `[COORDINATOR] - Stopping session ${
                                session.id} (type: ${session.type}). Reason: ${
                                reason}` :
                            '[COORDINATOR] - Stop requested but no active session.',
                        session ? 'default' : 'warning');
                if (setConfig) {
                  await setConfig(config);
                }
              })
              .finally(() => {
                pendingStop = null;
              });
      return pendingStop;
    },

    /**
     * @param {?string} sessionId Expected owning session ID.
     * @return {boolean} Whether a nonempty ID matches the current owner.
     */
    isActiveSession(sessionId) {
      const config = getConfig();
      return typeof sessionId === 'string' && sessionId.length > 0 &&
          config?.runtime?.currentSession?.id === sessionId;
    },
  };

  return coordinator;
}
