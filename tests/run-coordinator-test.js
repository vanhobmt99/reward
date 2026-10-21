'use strict';

const {loadEsmModule} = require('./esm-loader');
const {createIsSessionStillActive, createRunCoordinator} =
    loadEsmModule('../js/run-coordinator.js');

/**
 * Builds a coordinator around a mutable runtime section.
 * @param {!Object=} runtimeOverrides Fields merged into the initial runtime.
 * @return {!{config: !Object, coordinator: !Object, setConfig: !Function}}
 *     Config, coordinator, and persistence spy.
 */
function makeCoordinator(runtimeOverrides = {}) {
  const config = {
    runtime: {
      running: 0,
      mode: null,
      currentSession: null,
      currentPhase: null,
      ...runtimeOverrides,
    },
  };

  const setConfig = jest.fn().mockResolvedValue();
  return {
    config,
    coordinator: createRunCoordinator({
      /**
       * Returns the config owned by this coordinator fixture.
       * @return {!Object} Current config.
       */
      getConfig: () => config,
      setConfig,
      log: jest.fn(),
    }),
    setConfig,
  };
}

describe('createIsSessionStillActive()', () => {
  test('allows legacy no-session callers', () => {
    const isSessionStillActive = createIsSessionStillActive(() => null);
    expect(isSessionStillActive(null)).toBe(true);
  });

  test('matches the active session id', () => {
    const isSessionStillActive = createIsSessionStillActive(() => ({
                                                              id: 's1',
                                                            }));
    expect(isSessionStillActive('s1')).toBe(true);
    expect(isSessionStillActive('s2')).toBe(false);
  });
});

describe('createRunCoordinator()', () => {
  test.each([undefined, null, ''])(
      'a missing session id %s cannot identify an active session', (id) => {
        const {coordinator} = makeCoordinator();
        expect(coordinator.isActiveSession(id)).toBe(false);
      });

  test('blocks a new run when running is true without a session', () => {
    const {coordinator} = makeCoordinator({
      running: 1,
      currentSession: null,
    });
    expect(coordinator.canStartNewRun()).toEqual({
      allowed: false,
      reason: 'RUNNING_WITHOUT_SESSION',
      currentSession: null,
    });
  });

  test(
      'stopCurrentSession clears stale running state even without a session',
      async () => {
        const {config, coordinator, setConfig} = makeCoordinator({
          running: 1,
          mode: 'activity',
          currentSession: null,
          currentPhase: 'activities',
        });

        await coordinator.stopCurrentSession('test');

        expect(config.runtime.running).toBe(0);
        expect(config.runtime.mode).toBeNull();
        expect(config.runtime.currentSession).toBeNull();
        expect(config.runtime.currentPhase).toBeNull();
        expect(config.runtime.rsaTab).toBeNull();
        expect(config.runtime.mobile).toBe(0);
        expect(setConfig).toHaveBeenCalledWith(config);
      });

  test('can start and stop an activity session', async () => {
    const {config, coordinator, setConfig} = makeCoordinator();

    const session = coordinator.startNewSession('activity');
    expect(session.type).toBe('activity');
    expect(config.runtime.running).toBe(1);
    expect(config.runtime.mode).toBe('activity');
    expect(config.runtime.currentSession).toBe(session);

    await coordinator.stopCurrentSession('done');
    expect(config.runtime.running).toBe(0);
    expect(config.runtime.mode).toBeNull();
    expect(config.runtime.currentSession).toBeNull();
    expect(setConfig).toHaveBeenCalledWith(config);
  });

  test(
      'a stop in flight blocks the next session and shares one write',
      async () => {
        let release = () => {};
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        const config = {
          runtime: {
            running: 0,
            mode: null,
            currentSession: null,
            currentPhase: null,
            act: 0,
            rsaTab: null,
            mobile: 0,
          },
        };
        const setConfig = jest.fn(() => gate);
        const coordinator = createRunCoordinator({
          /**
           * @return {!Object} Config owned by this stop-gate fixture.
           */
          getConfig: () => config,
          setConfig,
          log: jest.fn(),
        });
        coordinator.startNewSession('search');
        const firstStop = coordinator.stopCurrentSession('user_stop');
        const secondStop = coordinator.stopCurrentSession('again');

        expect(secondStop).toBe(firstStop);
        expect(coordinator.canStartNewRun()).toEqual({
          allowed: false,
          reason: 'STOPPING',
        });
        expect(coordinator.startNewSession('activity')).toBeNull();
        expect(config.runtime.running).toBe(0);

        release();
        await firstStop;
        expect(setConfig).toHaveBeenCalledTimes(1);
        expect(coordinator.canStartNewRun().allowed).toBe(true);
      });

  test(
      'a failed stop write does not leave the worker stuck stopping',
      async () => {
        const config = {
          runtime: {
            running: 0,
            mode: null,
            currentSession: null,
            currentPhase: null,
            act: 0,
            rsaTab: null,
            mobile: 0,
          },
        };
        const coordinator = createRunCoordinator({
          /**
           * @return {!Object} Config owned by this failed-stop fixture.
           */
          getConfig: () => config,
          setConfig: jest.fn().mockRejectedValue(new Error('storage down')),
          log: jest.fn(),
        });
        coordinator.startNewSession('search');
        await expect(coordinator.stopCurrentSession('fail'))
            .rejects.toThrow('storage down');
        expect(config.runtime.running).toBe(0);
        expect(config.runtime.currentSession).toBeNull();
        expect(coordinator.canStartNewRun().allowed).toBe(true);
        expect(coordinator.startNewSession('schedule')).not.toBeNull();
      });
});
