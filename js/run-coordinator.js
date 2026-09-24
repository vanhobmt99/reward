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

  let releasing = false;

  async function _resetRuntime(config) {
    config.runtime.running = 0;
    config.runtime.stopping = 0;
    config.runtime.mode = null;
    config.runtime.currentSession = null;
    config.runtime.currentPhase = null;
    config.runtime.act = 0;
    config.runtime.rsaTab = null;
    config.runtime.mobile = 0;
    config.runtime.updatedAt = Date.now();
    if (setConfig) await setConfig(config);
  }

  const coordinator = {
    canStartNewRun() {
      const config = getConfig();
      const current = config?.runtime?.currentSession;
      const isRunning = !!config?.runtime?.running;

      if (!isRunning && !current && !config?.runtime?.stopping && !releasing) {
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
      config.runtime.stopping = 0;
      config.runtime.startedAt = session.startedAt;
      config.runtime.updatedAt = session.startedAt;
      config.runtime.lastAction = "Khởi động";
      config.runtime.retry = 0;
      config.runtime.outcome = null;
      config.runtime.outcomeReason = null;

      log &&
        log(
          `[COORDINATOR] - Started new session: ${session.id} (type: ${type})`,
        );
      return session;
    },

    requestStop(reason = "user_requested") {
      const runtime = getConfig()?.runtime;
      if (!runtime?.currentSession) return false;
      runtime.running = 0;
      runtime.stopping = 1;
      runtime.act = 0;
      runtime.outcome = "skipped";
      runtime.outcomeReason = reason;
      return true;
    },

    async stopCurrentSession(reason = "user_stop", expectedSessionId) {
      const config = getConfig();
      const session = config?.runtime?.currentSession;

      if (expectedSessionId && session?.id !== expectedSessionId) return;
      if (releasing) return;

      if (!session) {
        log &&
          log(
            `[COORDINATOR] - Stop requested but no active session.`,
            "warning",
          );
        releasing = true;
        try { await _resetRuntime(config); } finally { releasing = false; }
        return;
      }

      log &&
        log(
          `[COORDINATOR] - Stopping session ${session.id} (type: ${session.type}). Reason: ${reason}`,
        );
      releasing = true;
      try { await _resetRuntime(config); } finally { releasing = false; }
    },

    isActiveSession(sessionId) {
      const config = getConfig();
      return config?.runtime?.currentSession?.id === sessionId;
    },
  };

  return coordinator;
}
