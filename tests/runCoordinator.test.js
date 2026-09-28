"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const coordinatorPath = path.join(__dirname, "../js/run-coordinator.js");
const source = fs.readFileSync(coordinatorPath, "utf8");
const modifiedSource = source
  .replace(/export function /g, "function ")
  .replace(
    /\nfunction createRunCoordinator/,
    "\nmodule.exports = { createSession, createIsSessionStillActive, createRunCoordinator };\nfunction createRunCoordinator",
  );

const sandbox = {
  module: { exports: {} },
  exports: {},
  Date,
  Math,
};

vm.createContext(sandbox);
vm.runInContext(modifiedSource, sandbox);

const { createIsSessionStillActive, createRunCoordinator } =
  sandbox.module.exports;

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
      getConfig: () => config,
      setConfig,
      log: jest.fn(),
    }),
    setConfig,
  };
}

describe("createIsSessionStillActive()", () => {
  test("allows legacy no-session callers", () => {
    const isSessionStillActive = createIsSessionStillActive(() => null);
    expect(isSessionStillActive(null)).toBe(true);
  });

  test("matches the active session id", () => {
    const isSessionStillActive = createIsSessionStillActive(() => ({
      id: "s1",
    }));
    expect(isSessionStillActive("s1")).toBe(true);
    expect(isSessionStillActive("s2")).toBe(false);
  });
});

describe("createRunCoordinator()", () => {
  test("blocks a new run when running is true without a session", () => {
    const { coordinator } = makeCoordinator({
      running: 1,
      currentSession: null,
    });
    expect(coordinator.canStartNewRun()).toEqual({
      allowed: false,
      reason: "RUNNING_WITHOUT_SESSION",
      currentSession: null,
    });
  });

  test("stopCurrentSession clears stale running state even without a session", async () => {
    const { config, coordinator, setConfig } = makeCoordinator({
      running: 1,
      mode: "activity",
      currentSession: null,
      currentPhase: "activities",
    });

    await coordinator.stopCurrentSession("test");

    expect(config.runtime.running).toBe(0);
    expect(config.runtime.mode).toBeNull();
    expect(config.runtime.currentSession).toBeNull();
    expect(config.runtime.currentPhase).toBeNull();
    expect(config.runtime.rsaTab).toBeNull();
    expect(config.runtime.mobile).toBe(0);
    expect(setConfig).toHaveBeenCalledWith(config);
  });

  test("can start and stop an activity session", async () => {
    const { config, coordinator, setConfig } = makeCoordinator();

    const session = coordinator.startNewSession("activity");
    expect(session.type).toBe("activity");
    expect(config.runtime.running).toBe(1);
    expect(config.runtime.mode).toBe("activity");
    expect(config.runtime.currentSession).toBe(session);

    await coordinator.stopCurrentSession("done");
    expect(config.runtime.running).toBe(0);
    expect(config.runtime.mode).toBeNull();
    expect(config.runtime.currentSession).toBeNull();
    expect(setConfig).toHaveBeenCalledWith(config);
  });
});
