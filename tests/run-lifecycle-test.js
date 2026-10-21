const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('acorn');
const {loadEsmModule} = require('./esm-loader');
const {createRunCoordinator} = loadEsmModule('../js/run-coordinator.js');
const {cleanupAfterRun} = loadEsmModule('../js/search-phases.js');

/**
 * Builds cleanup dependencies around a mutable runtime config.
 * @return {!{config: !Object, deps: !Object, startNew: function(): undefined}}
 *     Config, cleanup dependencies, and a newer-run mutator.
 */
function fixture() {
  const config = {
    runtime: {
      running: 1,
      currentSession: {id: 'old', type: 'schedule'},
      currentPhase: 'search',
      rsaTab: 11,
      mobile: 1,
      act: 1,
    },
    schedule: {mode: 'm3'},
  };
  const startNew = () => {
    config.runtime = {
      running: 1,
      currentSession: {id: 'new', type: 'search'},
      currentPhase: 'search',
      rsaTab: 99,
      mobile: 1,
      act: 1,
    };
  };
  const deps = {
    /**
     * Returns the mutable config shared with the cleanup under test.
     * @return {!Object} Current config.
     */
    getConfig: () => config,
    /**
     * Matches the session id still recorded on the config.
     * @param {string} id Session id to compare.
     * @return {boolean} Whether that session is current.
     */
    isActiveSession: (id) => config.runtime.currentSession?.id === id,
    removeTabFn: jest.fn().mockResolvedValue(),
    stopCurrentSession: jest.fn(async () => {
      config.runtime.running = 0;
      config.runtime.currentSession = null;
    }),
    setConfig: jest.fn().mockResolvedValue(),
    clearBadgeFn: jest.fn().mockResolvedValue(),
    createAlarm: jest.fn().mockResolvedValue(),
    /**
     * Returns the delay before the next schedule alarm.
     * @return {number} Delay in milliseconds.
     */
    getScheduleAlarmDelayMs: () => 1000,
    /**
     * Reports that a repeating schedule is enabled.
     * @return {boolean} Whether schedule mode is active.
     */
    isScheduledModeActive: () => true,
    notifyFn: jest.fn(),
    log: jest.fn(),
  };
  return {config, deps, startNew};
}

test(
    'stale cleanup closes only its old tab and leaves the new run badge/state alone',
    async () => {
      const {config, deps, startNew} = fixture();
      startNew();
      await cleanupAfterRun(11, 'old', deps);
      expect(deps.removeTabFn).toHaveBeenCalledWith(11);
      expect(deps.clearBadgeFn).not.toHaveBeenCalled();
      expect(deps.setConfig).not.toHaveBeenCalled();
      expect(deps.stopCurrentSession).not.toHaveBeenCalled();
      expect(deps.createAlarm).not.toHaveBeenCalled();
      expect(config.runtime.rsaTab).toBe(99);
    });

test('stale cleanup cannot close a tab now owned by the new run', async () => {
  const {config, deps, startNew} = fixture();
  startNew();
  config.runtime.rsaTab = 11;
  await cleanupAfterRun(11, 'old', deps);
  expect(deps.removeTabFn).not.toHaveBeenCalled();
});

test.each(['removeTabFn', 'stopCurrentSession', 'clearBadgeFn'])(
    'cleanup rechecks ownership after awaiting %s', async (operation) => {
      const {config, deps, startNew} = fixture();
      deps[operation].mockImplementationOnce(async () => startNew());
      await cleanupAfterRun(11, 'old', deps);
      expect(config.runtime).toMatchObject({
        running: 1,
        currentSession: {id: 'new'},
        rsaTab: 99,
        mobile: 1,
        act: 1,
        currentPhase: 'search',
      });
      expect(deps.setConfig).not.toHaveBeenCalled();
      expect(deps.createAlarm).not.toHaveBeenCalled();
      expect(deps.notifyFn).not.toHaveBeenCalled();
    });

test(
    'a new run during persistence prevents old notifications and alarm changes',
    async () => {
      const {deps, startNew} = fixture();
      deps.setConfig.mockImplementationOnce(async () => startNew());
      await cleanupAfterRun(11, 'old', deps);
      expect(deps.notifyFn).not.toHaveBeenCalled();
      expect(deps.createAlarm).not.toHaveBeenCalled();
    });

test(
    'coordinator blocks starts and shares concurrent stops while persistence is pending',
    async () => {
      const config = {runtime: {running: 0}};
      let finish;
      const write = jest.fn(() => new Promise((resolve) => {
                              finish = resolve;
                            }));
      const coordinator = createRunCoordinator({
        /**
         * Returns the config observed while persistence is pending.
         * @return {!Object} Current config.
         */
        getConfig: () => config,
        setConfig: write,
      });
      coordinator.startNewSession('search');
      const first = coordinator.stopCurrentSession();
      // Persistence may start in a microtask after the stop ownership is
      // claimed.
      await Promise.resolve();
      try {
        expect(coordinator.canStartNewRun())
            .toMatchObject({allowed: false, reason: 'STOPPING'});
        expect(coordinator.startNewSession('activity')).toBeNull();
        expect(coordinator.stopCurrentSession()).toBe(first);
        expect(write).toHaveBeenCalledTimes(1);
      } finally {
        finish();
        await first;
      }
      expect(coordinator.startNewSession('activity')).not.toBeNull();
    });

test(
    'failed stop persistence releases coordinator stop ownership', async () => {
      const config = {runtime: {running: 0}};
      const coordinator = createRunCoordinator({
        /**
         * Returns the config observed while stop persistence fails.
         * @return {!Object} Current config.
         */
        getConfig: () => config,
        setConfig: async () => {
          throw new Error('Storage failed');
        },
      });
      coordinator.startNewSession('search');
      await expect(coordinator.stopCurrentSession())
          .rejects.toThrow('Storage failed');
      expect(coordinator.canStartNewRun().allowed).toBe(true);
    });

test.each(['none', 'new-run', 'adopted-tab'])(
    'user stop cleans up while respecting a concurrent transition: %s',
    async (transition) => {
      const source =
          fs.readFileSync(path.join(__dirname, '../js/service.js'), 'utf8');
      const node = parse(source, {ecmaVersion: 2022, sourceType: 'module'})
                       .body.find(
                           (entry) => entry.type === 'FunctionDeclaration' &&
                               entry.id.name === 'handleUserStop');
      const config = {runtime: {running: 0}};
      const persist = jest.fn().mockResolvedValue();
      const coordinator = createRunCoordinator({
        /**
         * Returns the config observed during a user stop.
         * @return {!Object} Current config.
         */
        getConfig: () => config,
        setConfig: persist,
      });
      coordinator.startNewSession('search');
      config.runtime.rsaTab = 11;
      const context = {
        config,
        runCoordinator: coordinator,
        searchKeepaliveCancel: jest.fn(),
        detach: jest.fn(async () => {
          if (transition !== 'none') {
            coordinator.startNewSession('activity');
            Object.assign(config.runtime, {
              rsaTab: transition === 'adopted-tab' ? 11 : 99,
              act: 1,
              currentPhase: 'activities',
            });
          }
        }),
        chrome: {
          tabs: {remove: jest.fn().mockResolvedValue()},
          action: {setBadgeText: jest.fn().mockResolvedValue()},
        },
        updateConfigSections: jest.fn().mockResolvedValue(),
        log: jest.fn(),
        logs: false,
      };
      vm.createContext(context);
      vm.runInContext(source.slice(node.start, node.end), context);
      const cancelKeepalive = context.searchKeepaliveCancel;
      await context.handleUserStop();
      expect(cancelKeepalive).toHaveBeenCalledTimes(1);
      expect(context.searchKeepaliveCancel).toBeNull();
      if (transition === 'none') {
        expect(config.runtime)
            .toMatchObject(
                {rsaTab: null, act: 0, currentPhase: null, running: 0});
        expect(context.chrome.action.setBadgeText).toHaveBeenCalledWith({
          text: '',
        });
      } else {
        expect(config.runtime).toMatchObject({
          rsaTab: transition === 'adopted-tab' ? 11 : 99,
          act: 1,
          currentPhase: 'activities',
          running: 1,
        });
        expect(context.chrome.action.setBadgeText).not.toHaveBeenCalled();
      }
      if (transition === 'adopted-tab') {
        expect(context.chrome.tabs.remove).not.toHaveBeenCalled();
      } else {
        expect(context.chrome.tabs.remove).toHaveBeenCalledWith(11);
      }
      expect(context.updateConfigSections).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledTimes(1);
    });
