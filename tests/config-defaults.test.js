import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultConfig } from "../js/config-defaults.js";
import {
  DEFAULT_SEARCH_DELAY_MIN,
  DEFAULT_SEARCH_DELAY_MAX,
} from "../js/search-plan.js";
import { applyConfigDefaults } from "../js/utils.js";

describe("createDefaultConfig pacing", () => {
  it("uses the 6-10s search delay band", () => {
    const config = createDefaultConfig();
    assert.equal(config.search.min, DEFAULT_SEARCH_DELAY_MIN);
    assert.equal(config.search.max, DEFAULT_SEARCH_DELAY_MAX);
    assert.equal(config.schedule.min, DEFAULT_SEARCH_DELAY_MIN);
    assert.equal(config.schedule.max, DEFAULT_SEARCH_DELAY_MAX);
  });
});

describe("applyConfigDefaults pacing migration", () => {
  it("rewrites stored 7/14 defaults to 6/10 and leaves custom pacing", () => {
    const fromOldDefault = applyConfigDefaults(createDefaultConfig(), {
      search: { desk: 31, mob: 21, min: 7, max: 14 },
      schedule: { desk: 31, mob: 21, min: 7, max: 14, mode: "m1" },
      control: {},
    });
    assert.equal(fromOldDefault.search.min, 6);
    assert.equal(fromOldDefault.search.max, 10);
    assert.equal(fromOldDefault.schedule.min, 6);
    assert.equal(fromOldDefault.schedule.max, 10);
    assert.equal(fromOldDefault.control.fastPacingDefaultApplied, 2);

    const custom = applyConfigDefaults(createDefaultConfig(), {
      search: { desk: 31, mob: 21, min: 8, max: 12 },
      schedule: { desk: 31, mob: 21, min: 8, max: 12, mode: "m1" },
      control: { fastPacingDefaultApplied: 2 },
    });
    assert.equal(custom.search.min, 8);
    assert.equal(custom.search.max, 12);
  });
});
