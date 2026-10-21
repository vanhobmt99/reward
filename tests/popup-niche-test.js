'use strict';

const fs = require('fs');
const path = require('path');
const {toContainSource} = require('./source-assertions');
const {loadEsmModule} = require('./esm-loader');
expect.extend({toContainSource});

/**
 * Loads the primary search query catalog.
 * @return {!Object} Queries keyed by niche.
 */
function loadQueries() {
  return loadEsmModule('../js/queries.js').queries;
}

/**
 * Loads the extra search query catalog.
 * @return {!Object} Additional queries keyed by niche.
 */
function loadQueriesExtra() {
  return loadEsmModule('../js/queries-extra.js').queriesExtra;
}

/**
 * Reads niche option values from the settings page markup.
 * @return {!Array<string>} Option values, or empty when the select is absent.
 */
function loadOptionsNicheOptions() {
  const html = fs.readFileSync(
      path.resolve(__dirname, '../options.html'),
      'utf8',
  );
  const selectMatch = html.match(
      /<select[^>]*id="niche"[^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!selectMatch) {
    return [];
  }
  return [...selectMatch[1].matchAll(/<option\s+value="([^"]+)"/gi)].map(
      (match) => match[1],
  );
}

describe('options page Search Niche options', () => {
  test('provides the default background topic mode', () => {
    const html = fs.readFileSync(
        path.resolve(__dirname, '../options.html'),
        'utf8',
    );
    const script = fs.readFileSync(
        path.resolve(__dirname, '../js/options.js'),
        'utf8',
    );
    expect(html).toMatch(/<option\s+value="random">/i);
    expect(script).toContainSource('config.control.niche || "random"');
  });

  test('matches runtime query categories', () => {
    const runtimeQueries = {...loadQueries(), ...loadQueriesExtra()};
    const runtimeCategories = Object.keys(runtimeQueries).sort();
    const options = loadOptionsNicheOptions().sort();
    expect(options.filter((option) => option !== 'random'))
        .toEqual(
            runtimeCategories.filter((category) => category !== 'random'),
        );
    expect(options).toContain('random');
  });
});
