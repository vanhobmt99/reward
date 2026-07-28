export function createSession(type) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    startedAt: Date.now(),
  };
}

export function createIsSessionStillActive(getCurrentSession) {
  return function isSessionStillActive(expectedSessionId) {
    if (!expectedSessionId) return true;
    if (typeof getCurrentSession !== "function") return false;
    const current = getCurrentSession();
    return Boolean(current && current.id === expectedSessionId);
  };
}

export function createRunCoordinator(deps) {
  const { getConfig, setConfig, log } = deps;

  async function _resetRuntime(config) {
    config.runtime.running = 0;
    config.runtime.mode = null;
    config.runtime.currentSession = null;
    config.runtime.currentPhase = null;
    config.runtime.act = 0;
    config.runtime.rsaTab = null;
    config.runtime.mobile = 0;
    if (setConfig) await setConfig(config);
  }

  const coordinator = {
    canStartNewRun() {
      const config = getConfig();
      const current = config?.runtime?.currentSession;
      const isRunning = !!config?.runtime?.running;

      if (!isRunning) {
        return { allowed: true, reason: null };
      }

      return {
        allowed: false,
        reason: current ? "ALREADY_RUNNING" : "RUNNING_WITHOUT_SESSION",
        currentSession: current,
      };
    },

    startNewSession(type) {
      const check = this.canStartNewRun();

      if (!check.allowed) {
        log &&
          log(
            `[COORDINATOR] - Cannot start new ${type} run. Reason: ${check.reason}. Current: ${check.currentSession?.id}`,
            "warning",
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
          `[COORDINATOR] - Started new session: ${session.id} (type: ${type})`,
        );
      return session;
    },

    async stopCurrentSession(reason = "user_stop") {
      const config = getConfig();
      const session = config?.runtime?.currentSession;

      if (!session) {
        log &&
          log(
            `[COORDINATOR] - Stop requested but no active session.`,
            "warning",
          );
        await _resetRuntime(config);
        return;
      }

      log &&
        log(
          `[COORDINATOR] - Stopping session ${session.id} (type: ${session.type}). Reason: ${reason}`,
        );
      await _resetRuntime(config);
    },

    async forceStop(reason = "force_stop") {
      const config = getConfig();
      const session = config?.runtime?.currentSession;
      log &&
        log(
          `[COORDINATOR] - FORCE STOP triggered. Reason: ${reason}. Active session was: ${session?.id || "none"}`,
          "warning",
        );
      await _resetRuntime(config);
    },

    getActiveSession() {
      const config = getConfig();
      return config?.runtime?.currentSession || null;
    },

    isActiveSession(sessionId) {
      const config = getConfig();
      return config?.runtime?.currentSession?.id === sessionId;
    },

    getStatus() {
      const config = getConfig();
      const session = config?.runtime?.currentSession;
      return {
        isRunning: !!config?.runtime?.running,
        activeSession: session,
        mode: config?.runtime?.mode || null,
      };
    },
  };

  return coordinator;
}
