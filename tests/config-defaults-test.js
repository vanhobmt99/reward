'use strict';

const {loadEsmModule} = require('./esm-loader');
const configModule =
    loadEsmModule('../js/config-defaults.js', {}, ['sanitizeStoredConfig']);
const {
  isConfigRecord,
  sanitizeStoredConfig,
  applyConfigDefaults,
  createDefaultConfig,
} = configModule;

test.each([null, undefined, 'invalid', 17, false, [], new Date(), new Map()])(
    'invalid root config %p cannot replace defaults or add indexed fields',
    (stored) => {
      const result = applyConfigDefaults(createDefaultConfig(), stored);
      expect(typeof result.control).toBe('object');
      expect(result.search.desk).toBe(31);
      expect(Object.hasOwn(result, '0')).toBe(false);
    });

test.each(['search', 'schedule', 'device', 'control', 'runtime'])(
    'malformed %s section preserves its default structure', (section) => {
      for (const value of [null, false, 'invalid', 9, [], new Date()]) {
        const result =
            applyConfigDefaults(createDefaultConfig(), {[section]: value});
        expect(isConfigRecord(result[section])).toBe(true);
        expect(Object.keys(result[section]).length).toBeGreaterThan(0);
      }
    });

test('known scalar fields are normalized without truthy string flags', () => {
  const result = applyConfigDefaults(createDefaultConfig(), {
    search: {desk: '19', mob: false, min: {}, max: Infinity},
    schedule: {desk: -2, mode: {}, time: '8:05'},
    device: {name: {}, ua: [], h: -1, w: NaN, scale: 0},
    control:
        {enhancedPatchDefaultApplied: 1, act: 'false', log: '0', niche: {}},
    runtime: {
      running: '0',
      act: 'false',
      done: -7,
      failed: Infinity,
      rsaTab: {},
      currentSession: 'bad',
    },
  });
  expect(result.search.desk).toBe(19);
  expect(result.search.mob).toBe(0);
  expect(Number.isFinite(result.search.min)).toBe(true);
  expect(Number.isFinite(result.search.max)).toBe(true);
  expect(result.schedule).toMatchObject({desk: 0, mode: 'm1', time: '08:05'});
  expect(result.device).toEqual(createDefaultConfig().device);
  expect(result.control).toMatchObject({act: 0, log: 0, niche: 'random'});
  expect(result.runtime).toMatchObject({
    running: 0,
    act: 0,
    done: 0,
    failed: 0,
    rsaTab: null,
    currentSession: null,
  });
});

test(
    'reserved property names never become config prototypes or inherited flags',
    () => {
      const stored = JSON.parse(
          '{"__proto__":{"polluted":true},"control":{"__proto__":{"unsafe":true},"constructor":{"prototype":{"polluted":true}}}}');
      const target = createDefaultConfig();
      const rootPrototype = Object.getPrototypeOf(target);
      const result = applyConfigDefaults(target, stored);
      expect(Object.getPrototypeOf(result)).toBe(rootPrototype);
      expect(result.polluted).toBeUndefined();
      expect(result.control.unsafe).toBeUndefined();
      expect(Object.hasOwn(result.control, 'constructor')).toBe(false);
      expect({}.polluted).toBeUndefined();
    });

test('valid custom settings and future fields survive normalization', () => {
  const stored = {
    search: {desk: 77, mob: 0, min: 23, max: 48},
    control: {enhancedPatchDefaultApplied: 1, act: 0, clear: 0},
    runtime: {done: 0, currentSession: {id: 's', type: 'search', startedAt: 0}},
    future: {nested: {enabled: true}},
  };
  const before = structuredClone(stored);
  const result = applyConfigDefaults(createDefaultConfig(), stored);
  expect(result.search).toEqual(stored.search);
  expect(result.control).toMatchObject({act: 0, clear: 0});
  expect(result.runtime.currentSession).toEqual(stored.runtime.currentSession);
  expect(result.future).toEqual(stored.future);
  expect(stored).toEqual(before);
  expect(applyConfigDefaults(createDefaultConfig(), result)).toEqual(result);
});

test(
    'an object with a non-callable toString cannot break schedule normalization',
    () => {
      const result = applyConfigDefaults(createDefaultConfig(), {
        schedule: {time: {toString: 'invalid'}},
      });
      expect(result.schedule.time).toBe('08:00');
    });

test.each([new Date(), new Map(), new Set(), Object.create({inherited: true})])(
    'dictionary validation rejects non-record objects: %p', (value) => {
      expect(isConfigRecord(value)).toBe(false);
    });

test('dictionary validation accepts null-prototype records', () => {
  expect(isConfigRecord(Object.create(null))).toBe(true);
});

// ── Helpers for building default config
// ───────────────────────────────────────
/**
 * Builds a default config with short search and schedule counts.
 * @return {!Object} Config used by schedule normalization tests.
 */
function makeDefaultConfig() {
  const config = createDefaultConfig();
  config.search = {desk: 1, mob: 0, min: 15, max: 30};
  config.schedule = {...config.schedule, desk: 10, mob: 10, min: 15, max: 30};
  return config;
}
// ═══════════════════════════════════════════════════════════════════════════════
// isConfigRecord()
// ═══════════════════════════════════════════════════════════════════════════════
describe('isConfigRecord()', () => {
  test('returns true for plain object', () => {
    expect(isConfigRecord({})).toBe(true);
    expect(isConfigRecord({a: 1})).toBe(true);
  });

  test('returns false for array', () => {
    expect(isConfigRecord([])).toBe(false);
    expect(isConfigRecord([1, 2, 3])).toBe(false);
  });

  test('returns false for null', () => {
    expect(isConfigRecord(null)).toBeFalsy();
  });

  test('returns false for string', () => {
    expect(isConfigRecord('hello')).toBe(false);
  });

  test('returns false for number', () => {
    expect(isConfigRecord(42)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isConfigRecord(undefined)).toBeFalsy();
  });

  test('returns false for boolean', () => {
    expect(isConfigRecord(true)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeStoredConfig()
// ═══════════════════════════════════════════════════════════════════════════════
describe('sanitizeStoredConfig()', () => {
  test('removes top-level "pro" field', () => {
    const result = sanitizeStoredConfig({pro: true, control: {}});
    expect(result.pro).toBeUndefined();
  });

  test('removes "consent" from control object', () => {
    const result = sanitizeStoredConfig({control: {consent: true, act: 1}});
    expect(result.control.consent).toBeUndefined();
    expect(result.control.act).toBe(1);
  });

  test('preserves other fields unchanged', () => {
    const result = sanitizeStoredConfig({
      search: {desk: 5},
      control: {act: 1},
    });
    expect(result.search).toEqual({desk: 5});
    expect(result.control.act).toBe(1);
  });

  test('ignores non-object input (null)', () => {
    expect(sanitizeStoredConfig(null)).toEqual({});
  });

  test('ignores non-object input (undefined)', () => {
    expect(sanitizeStoredConfig(undefined)).toEqual({});
  });

  test('ignores non-object input (string)', () => {
    expect(sanitizeStoredConfig('invalid')).toEqual({});
  });

  test('does not mutate the original object', () => {
    const original = {pro: true, control: {consent: true, act: 1}};
    sanitizeStoredConfig(original);
    expect(original.pro).toBe(true);
    expect(original.control.consent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applyConfigDefaults()
// ═══════════════════════════════════════════════════════════════════════════════
describe('applyConfigDefaults()', () => {
  test('returns target unchanged when stored is null', () => {
    const target = makeDefaultConfig();
    const result = applyConfigDefaults(target, null);
    expect(result.search.desk).toBe(1);
  });

  test('merges nested objects (deep merge)', () => {
    const target = makeDefaultConfig();
    const stored = {
      search: {desk: 5},
      control: {enhancedPatchDefaultApplied: 1, act: 0},
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.search.desk).toBe(5);  // stored wins
    expect(result.search.min).toBe(15);  // target default preserved
    expect(result.control.act).toBe(0);  // stored wins
  });

  test('recursively merges deeply nested runtime fields', () => {
    const target = makeDefaultConfig();
    target.runtime.done = 2;
    target.runtime.total = 10;
    const stored = {
      control: {enhancedPatchDefaultApplied: 1},
      runtime: {done: 4},
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.runtime.done).toBe(4);
    expect(result.runtime.total).toBe(10);
  });

  test('sets clear=1 and enhancedPatchDefaultApplied=1 when first run', () => {
    const target = makeDefaultConfig();
    const stored = {control: {enhancedPatchDefaultApplied: 0}};
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(1);
    expect(result.control.enhancedPatchDefaultApplied).toBe(1);
  });

  test('preserves existing clear when already patched', () => {
    const target = makeDefaultConfig();
    target.control.clear = 0;
    const stored = {control: {enhancedPatchDefaultApplied: 1, clear: 0}};
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(0);  // already patched; stored value wins
  });

  test('defaults preserveRewards to 1 when missing', () => {
    const target = makeDefaultConfig();
    delete target.control.preserveRewards;
    const stored = {
      control: {
        enhancedPatchDefaultApplied: 1,
        clear: 1,
      },
    };
    applyConfigDefaults(target, stored);
    expect(target.control.preserveRewards).toBe(1);
  });

  test(
      'migrates old default search pacing to human pacing defaults once',
      () => {
        const target = makeDefaultConfig();
        const stored = {
          search: {desk: 31, mob: 21, min: 10, max: 20},
          schedule: {desk: 31, mob: 21, min: 10, max: 20, mode: 'm1'},
          control: {enhancedPatchDefaultApplied: 1},
        };

        const result = applyConfigDefaults(target, stored);

        // 10/20 → 7/14 (human pacing) → 6/10 (fast pacing) in one pass.
        expect(result.search.min).toBe(6);
        expect(result.search.max).toBe(10);
        expect(result.schedule.min).toBe(6);
        expect(result.schedule.max).toBe(10);
        expect(result.control.humanPacingDefaultApplied).toBe(1);
        expect(result.control.fastPacingDefaultApplied).toBe(2);
      });

  test('migrates 7/14 human pacing to fast pacing defaults once', () => {
    const target = makeDefaultConfig();
    const stored = {
      search: {desk: 31, mob: 21, min: 7, max: 14},
      schedule: {desk: 31, mob: 21, min: 7, max: 14, mode: 'm1'},
      control: {enhancedPatchDefaultApplied: 1, humanPacingDefaultApplied: 1},
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(6);
    expect(result.search.max).toBe(10);
    expect(result.schedule.min).toBe(6);
    expect(result.schedule.max).toBe(10);
    expect(result.control.fastPacingDefaultApplied).toBe(2);
  });

  test('migrates the short-lived 5/8 fast pacing band to 6/10', () => {
    const target = makeDefaultConfig();
    const stored = {
      search: {desk: 31, mob: 21, min: 5, max: 8},
      control: {
        enhancedPatchDefaultApplied: 1,
        humanPacingDefaultApplied: 1,
        fastPacingDefaultApplied: 1,
      },
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(6);
    expect(result.search.max).toBe(10);
    expect(result.control.fastPacingDefaultApplied).toBe(2);
  });

  test('fast pacing migration runs only once per version', () => {
    const target = makeDefaultConfig();
    const stored = {
      search: {desk: 31, mob: 21, min: 7, max: 14},
      control: {
        enhancedPatchDefaultApplied: 1,
        humanPacingDefaultApplied: 1,
        fastPacingDefaultApplied: 2,
      },
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(7);
    expect(result.search.max).toBe(14);
  });

  test('preserves custom pacing when applying human pacing migration', () => {
    const target = makeDefaultConfig();
    const stored = {
      search: {desk: 31, mob: 21, min: 12, max: 25},
      schedule: {desk: 31, mob: 21, min: 9, max: 18, mode: 'm1'},
      control: {enhancedPatchDefaultApplied: 1},
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(12);
    expect(result.search.max).toBe(25);
    expect(result.schedule.min).toBe(9);
    expect(result.schedule.max).toBe(18);
    expect(result.control.humanPacingDefaultApplied).toBe(1);
  });

  test('sets clear=1 when patched but clear is null', () => {
    const target = makeDefaultConfig();
    target.control.clear = null;
    const stored = {control: {enhancedPatchDefaultApplied: 1, clear: null}};
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(1);
  });

  test('removes "consent" from control after merge', () => {
    const target = makeDefaultConfig();
    const stored = {
      control: {enhancedPatchDefaultApplied: 1, consent: true},
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.control.consent).toBeUndefined();
  });

  test('removes "pro" from target after merge', () => {
    const target = {...makeDefaultConfig(), pro: true};
    const result = applyConfigDefaults(target, null);
    expect(result.pro).toBeUndefined();
  });

  test('overwrites primitive fields (non-object) from stored', () => {
    const target = makeDefaultConfig();
    const stored = {
      control: {enhancedPatchDefaultApplied: 1},
      someFlag: 42,
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.someFlag).toBe(42);
  });
});
