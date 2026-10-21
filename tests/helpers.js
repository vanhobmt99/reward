/**
 * Test adapters for the actual injected DOM helpers; no algorithm copies.
 */
const {loadEsmModule} = require('./esm-loader');
const {createActivityDomHelpers, createSolverDomHelpers} = loadEsmModule(
    '../js/injected-scripts.js', {document, window, getComputedStyle});
const activity = createActivityDomHelpers(
    'daily', 520, {
      clicked: [],
      openedKeys: [],
      visited: new Set(),
      seen: new Set(),
      safetyLimit: 12,
      deferToCdp: true,
    },
    () => null);
const solver = createSolverDomHelpers();
const helpers = {
  normalize: solver.normalize,
  textOf: activity.textOf,
  isVisible: activity.isVisible,
  clickTargetFor: solver.clickTargetFor,
  REJECT_TEXT: solver.rejectText,
  HARD_REJECT: solver.hardRejectText,
  PREFER_TEXT: solver.preferText,
  rankCandidates: solver.rankCandidates,
};
module.exports = helpers;
