import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTabGoneError, listenForTabGone } from "../js/tab-errors.js";

describe("isTabGoneError", () => {
  it("matches Chrome/Edge closed-tab errors", () => {
    assert.equal(isTabGoneError(new Error("No tab with id: 42")), true);
    assert.equal(isTabGoneError({ message: "Tab not found." }), true);
    assert.equal(isTabGoneError("Invalid tab ID"), true);
    assert.equal(isTabGoneError("Could not attach debugger to automation tab."), false);
    assert.equal(isTabGoneError(null), false);
  });
});

describe("listenForTabGone", () => {
  function fakeTabs() {
    const listeners = [];
    return {
      api: {
        onRemoved: {
          addListener(fn) {
            listeners.push(fn);
          },
          removeListener(fn) {
            const index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          },
        },
      },
      emit(tabId) {
        for (const fn of [...listeners]) fn(tabId);
      },
      listenerCount: () => listeners.length,
    };
  }

  it("calls onGone only for the watched tab and unsubscribes", () => {
    const tabs = fakeTabs();
    const seen = [];
    const stop = listenForTabGone(tabs.api, 7, () => seen.push("gone"));
    tabs.emit(3);
    assert.deepEqual(seen, []);
    tabs.emit(7);
    assert.deepEqual(seen, ["gone"]);
    stop();
    tabs.emit(7);
    assert.deepEqual(seen, ["gone"]);
    assert.equal(tabs.listenerCount(), 0);
  });

  it("returns a no-op unsubscribe when the tabs API is missing", () => {
    const stop = listenForTabGone(null, 1, () => {
      throw new Error("should not fire");
    });
    assert.equal(typeof stop, "function");
    stop();
  });
});
