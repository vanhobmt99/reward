import {normalizeSearchPlan} from '/js/search-plan.js';
import {normalizeDailyTime} from '/js/schedule-utils.js';

const CONFIG_SECTIONS = ['search', 'schedule', 'device', 'control', 'runtime'];
const RESERVED_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @typedef {{desk: number, mob: number, min: number, max: number}} ConfigPlan
 */
/**
 * @typedef {{desk: number, mob: number, min: number, max: number,
 *     mode: string, time: string}} ConfigSchedule
 */
/**
 * @typedef {{name: string, ua: string, h: number, w: number, scale: number}}
 * ConfigDevice
 */
/**
 * Flags are numeric zero/one; migration markers are nonnegative versions.
 * @typedef {{niche: string, clear: number, preserveRewards: number, act:
 * number, log: number, enhancedPatchDefaultApplied: number,
 *     humanPacingDefaultApplied: number,
 *     fastPacingDefaultApplied: (number|undefined)}} ConfigControl
 */
/**
 * @typedef {{id: string, type: ('search'|'schedule'|'activity'),
 *     startedAt: number}} ConfigSession
 */
/**
 * @typedef {{done: number, total: number, failed: number, running: number,
 *     rsaTab: ?number, mobile: number, act: number, pcSearch: number,
 *     mobileSearch: number, searchCounterDate: string,
 *     currentSession: ?ConfigSession, currentPhase: ?string,
 *     mode: (string|null|undefined), activityRunDate: (string|undefined),
 *     activityRunsToday: (number|undefined)}} ConfigRuntime
 */
/**
 * Known configuration sections. Unknown future fields are retained when
 * merging.
 * @typedef {{search: !ConfigPlan, schedule: !ConfigSchedule,
 *     device: !ConfigDevice, control: !ConfigControl,
 *     runtime: !ConfigRuntime}} ExtensionConfig
 */

/**
 * Shared defaults for service, popup and options; every call owns its objects.
 * @return {!ExtensionConfig} Fresh defaults, before stored-version migrations.
 */
export function createDefaultConfig() {
  return {
    search: {
      desk: 31,
      mob: 21,
      min: 7,
      max: 14,
    },
    schedule: {
      desk: 31,
      mob: 21,
      min: 7,
      max: 14,
      mode: 'm1',
      // Wall-clock time ("HH:MM", 24h) for the m5 "daily at a fixed time" mode.
      time: '08:00',
    },
    device: {
      name: '',
      ua: '',
      h: 844,
      w: 390,
      scale: 3,
    },
    control: {
      // Default UI mode: live background topics with a local-pool fallback.
      niche: 'random',
      clear: 1,
      enhancedPatchDefaultApplied: 1,
      humanPacingDefaultApplied: 1,
      preserveRewards: 1,
      act: 1,
      log: 0,
    },
    runtime: {
      done: 0,
      total: 0,
      failed: 0,
      running: 0,
      rsaTab: null,
      mobile: 0,
      act: 0,
      pcSearch: 0,
      mobileSearch: 0,
      searchCounterDate: '',
      currentSession: null,
      currentPhase: null,
    },
  };
}

/**
 * @param {*} value Unvalidated storage or updater output.
 * @return {boolean} Whether this is a dictionary rather than a
 *     scalar/container.
 */
export function isConfigRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  // Storage dictionaries can come from another realm or use a null prototype.
  // Class instances and built-in containers have an additional prototype level.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * @param {*} stored Unvalidated stored configuration.
 * @return {!Object<string, *>} Copy without invalid sections or obsolete
 *     fields.
 */
function sanitizeStoredConfig(stored) {
  if (!isConfigRecord(stored)) {
    return {};
  }
  const sanitized = {...stored};
  delete sanitized.pro;
  for (const section of CONFIG_SECTIONS) {
    if (Object.hasOwn(sanitized, section) &&
        !isConfigRecord(sanitized[section])) {
      delete sanitized[section];
    }
  }
  if (isConfigRecord(sanitized.control)) {
    sanitized.control = {...sanitized.control};
    delete sanitized.control.consent;
  }
  return sanitized;
}

/**
 * Merges own dictionary fields and rejects prototype-mutating keys at every
 * dictionary depth. Arrays and unrelated future values remain replacements.
 * @param {!Object<string, *>} base Defaults or previously merged fields.
 * @param {!Object<string, *>} patch Unvalidated stored dictionary.
 * @return {!Object<string, *>} Merged dictionary without mutating either input.
 */
function deepMergePlainObjects(base, patch) {
  const merged = {...base};
  for (const [key, value] of Object.entries(patch)) {
    if (RESERVED_CONFIG_KEYS.has(key)) {
      continue;
    }
    if (isConfigRecord(value)) {
      merged[key] = deepMergePlainObjects(
          Object.hasOwn(merged, key) && isConfigRecord(merged[key]) ?
              merged[key] :
              {},
          value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Repairs malformed known fields and applies versioned migrations in place.
 * Valid custom limits, explicit zero values and unrelated fields are retained.
 * @param {!Object<string, *>} target Mutable defaults/current configuration.
 * @param {*} stored Unvalidated storage value.
 * @return {!ExtensionConfig} The same target with normalized known sections.
 */
export function applyConfigDefaults(target, stored) {
  const defaults = createDefaultConfig();
  const baseline =
      deepMergePlainObjects(defaults, sanitizeStoredConfig(target));
  const sanitizedStored = sanitizeStoredConfig(stored);
  const storedPatchDefaultApplied =
      binaryFlag(sanitizedStored.control?.enhancedPatchDefaultApplied, 0) === 1;
  const storedHumanPacingDefaultApplied =
      binaryFlag(sanitizedStored.control?.humanPacingDefaultApplied, 0) === 1;
  Object.assign(target, deepMergePlainObjects(baseline, sanitizedStored));
  normalizeConfigFields(target, defaults);
  for (const key of RESERVED_CONFIG_KEYS) {
    delete target[key];
  }
  delete target.control.consent;
  delete target.pro;
  if (!storedPatchDefaultApplied) {
    target.control.clear = 1;
    target.control.enhancedPatchDefaultApplied = 1;
    target.control.preserveRewards = 1;
  }
  if (!storedHumanPacingDefaultApplied) {
    if (target.search?.min === 10 && target.search?.max === 20) {
      target.search = {...target.search, min: 7, max: 14};
    }
    if (target.schedule?.min === 10 && target.schedule?.max === 20) {
      target.schedule = {...target.schedule, min: 7, max: 14};
    }
    target.control.humanPacingDefaultApplied = 1;
  }
  // One-time migration to the faster pacing defaults (6-10s). Only rewrites
  // configs still on a previous default band (7/14 or the short-lived 5/8);
  // custom pacing is preserved. Versioned flag: bumping the number re-runs
  // the migration once for configs already stamped with an older version.
  if (target.control.fastPacingDefaultApplied < 2) {
    /**
     * @param {!ConfigPlan|!ConfigSchedule} band Stored delay range in seconds.
     * @return {boolean} Whether it matches an old default range.
     */
    const isOldDefault = (band) => (band?.min === 7 && band?.max === 14) ||
        (band?.min === 5 && band?.max === 8);
    if (isOldDefault(target.search)) {
      target.search = {...target.search, min: 6, max: 10};
    }
    if (isOldDefault(target.schedule)) {
      target.schedule = {...target.schedule, min: 6, max: 10};
    }
    target.control.fastPacingDefaultApplied = 2;
  }

  return target;
}

/**
 * @param {*} value Stored numeric input.
 * @return {number} A finite number, or NaN for unsupported coercions.
 */
function configNumber(value) {
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && value.trim())) {
    return NaN;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

/**
 * @param {*} value Stored numeric/boolean flag, including legacy strings.
 * @param {number} fallback Value for malformed input.
 * @return {number} Exactly zero or one for supported input.
 */
function binaryFlag(value, fallback) {
  if ([true, 1, '1', 'true'].includes(value)) {
    return 1;
  }
  if ([false, 0, '0', 'false'].includes(value)) {
    return 0;
  }
  return fallback;
}

/**
 * @param {*} value Stored count.
 * @return {number} Finite nonnegative integer, or zero.
 */
function configCount(value) {
  const number = configNumber(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

/**
 * Normalizes known fields only; unrelated future settings remain intact.
 * @param {!Object<string, !Object<string, *>>} config Raw section dictionaries.
 * @param {!ExtensionConfig} defaults Fallback values for this version.
 * @return {void}
 */
function normalizeConfigFields(config, defaults) {
  for (const name of ['search', 'schedule']) {
    const input = {...config[name]};
    for (const key of ['desk', 'mob', 'min', 'max']) {
      input[key] = configNumber(input[key]);
    }
    config[name] = normalizeSearchPlan(input, {
      defaultMin: defaults[name].min,
      defaultMax: defaults[name].max,
    });
  }
  if (!['m1', 'm2', 'm3', 'm4', 'm5'].includes(config.schedule.mode)) {
    config.schedule.mode = defaults.schedule.mode;
  }
  config.schedule.time = normalizeDailyTime(
      typeof config.schedule.time === 'string' ? config.schedule.time :
                                                 defaults.schedule.time);
  for (const key of ['name', 'ua']) {
    if (typeof config.device[key] !== 'string') {
      config.device[key] = defaults.device[key];
    }
  }
  for (const key of ['h', 'w', 'scale']) {
    const number = configNumber(config.device[key]);
    const valid = number > 0 && (key === 'scale' || Number.isInteger(number));
    config.device[key] = valid ? number : defaults.device[key];
  }
  if (typeof config.control.niche !== 'string' ||
      !config.control.niche.trim()) {
    config.control.niche = defaults.control.niche;
  }
  for (const key of ['clear', 'preserveRewards', 'act', 'log']) {
    config.control[key] =
        binaryFlag(config.control[key], defaults.control[key]);
  }
  for (const key
           of ['enhancedPatchDefaultApplied', 'humanPacingDefaultApplied',
               'fastPacingDefaultApplied']) {
    config.control[key] = configCount(config.control[key]);
  }
  for (const key of ['done', 'total', 'failed', 'pcSearch', 'mobileSearch']) {
    config.runtime[key] = configCount(config.runtime[key]);
  }
  if (Object.hasOwn(config.runtime, 'activityRunsToday')) {
    config.runtime.activityRunsToday =
        configCount(config.runtime.activityRunsToday);
  }
  for (const key of ['running', 'mobile', 'act']) {
    config.runtime[key] = binaryFlag(config.runtime[key], 0);
  }
  for (const key of ['searchCounterDate', 'activityRunDate']) {
    if (Object.hasOwn(config.runtime, key) &&
        typeof config.runtime[key] !== 'string') {
      config.runtime[key] = '';
    }
  }
  const tab = configNumber(config.runtime.rsaTab);
  config.runtime.rsaTab = Number.isInteger(tab) && tab > 0 ? tab : null;
  for (const key of ['mode', 'currentPhase']) {
    if (Object.hasOwn(config.runtime, key) &&
        typeof config.runtime[key] !== 'string') {
      config.runtime[key] = null;
    }
  }
  const session = config.runtime.currentSession;
  const startedAt = configNumber(session?.startedAt);
  config.runtime.currentSession = isConfigRecord(session) &&
          typeof session.id === 'string' && session.id.trim() &&
          ['search', 'schedule', 'activity'].includes(session.type) &&
          startedAt >= 0 ?
      {...session, startedAt} :
      null;
}
