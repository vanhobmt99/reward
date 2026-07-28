/**
 * Single source of truth for the default configuration.
 * Imported by service.js, popup.js, and content.js to avoid drift.
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
      mode: "m1",
      // Wall-clock time ("HH:MM", 24h) for the m5 "daily at a fixed time" mode.
      time: "08:00",
    },
    device: {
      name: "",
      ua: "",
      h: 844,
      w: 390,
      scale: 3,
    },
    control: {
      // Default UI mode: live background topics with a local-pool fallback.
      niche: "random",
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
      searchCounterDate: "",
      currentSession: null,
      currentPhase: null,
    },
    user: {
      // `country` fills the [country] placeholder in query templates;
      // `countryCode` picks the Google Trends region. Nothing reads a city, so
      // no city is stored.
      country: "",
      countryCode: "",
    },
  };
}
