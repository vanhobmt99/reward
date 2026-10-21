const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {moduleFixtureSource, loadEsmModule} = require('./esm-loader');

test(
    'loader preserves export-looking data and handles aliases and multiple declarations',
    () => {
      const source = `
    // export const imaginary = 3;
    export const text = 'export const hidden = 1;', second = 2;
    const other = 4;
    export {other as renamed};
    export function read() { return text; }
  `;
      const context = {module: {exports: {}}};
      vm.runInNewContext(moduleFixtureSource(source), context);
      expect(context.module.exports.text).toBe('export const hidden = 1;');
      expect(context.module.exports.second).toBe(2);
      expect(context.module.exports.renamed).toBe(4);
      expect(context.module.exports.read()).toBe(context.module.exports.text);
      expect(context.module.exports).not.toHaveProperty('imaginary');
    });

test.each([
  'import a from "./other.js";',
  'export {a} from "./other.js";',
  'export * from "./other.js";',
  'export default 1;',
])('unsupported module linkage fails clearly: %s', (source) => {
  expect(() => moduleFixtureSource(source))
      .toThrow('named exports and local imports only');
});

const fixtureRoot = path.resolve(__dirname, '../.cleanup-baseline');
let fixtureDirectory;
beforeEach(() => {
  fs.mkdirSync(fixtureRoot, {recursive: true});
  fixtureDirectory = fs.mkdtempSync(path.join(fixtureRoot, 'module-loader-'));
});
afterEach(() => {
  // Remove only this test's verified direct child, never a computed parent.
  expect(path.dirname(fixtureDirectory)).toBe(fixtureRoot);
  expect(path.basename(fixtureDirectory)).toMatch(/^module-loader-/);
  fs.rmSync(fixtureDirectory, {recursive: true, force: true});
});

/**
 * @param {string} name Fixture file name.
 * @param {string} source Fixture module source.
 * @return {string} Entry path relative to the test loader.
 */
function fixture(name, source) {
  const file = path.join(fixtureDirectory, name);
  fs.writeFileSync(file, source);
  return path.relative(__dirname, file);
}

test(
    'real dependency graph shares globals, caches modules and isolates scopes',
    () => {
      fixture('shared.js', `
    globalThis.loads = (globalThis.loads || 0) + 1;
    const internal = 3;
    export const shared = {value: internal};
  `);
      fixture(
          'left.js',
          `import {shared} from './shared.js'; export const left = shared;`);
      const entry = fixture('entry.js', `
    import './shared.js';
    import {left as renamed} from './left.js';
    import * as namespace from './shared.js';
    const internal = 9;
    export const same = renamed === namespace.shared;
    export const count = globalThis.loads;
    export const value = internal + namespace.shared.value + browserValue;
  `);
      expect(loadEsmModule(entry, {
        browserValue: 2,
      })).toEqual({same: true, count: 1, value: 14});
      expect(loadEsmModule(entry, {browserValue: 5}).count).toBe(1);
    });

test(
    'extension-root imports and private test bindings use actual module code',
    () => {
      const entry = fixture('entry.js', `
    import {createDefaultConfig} from '/js/config-defaults.js';
    function privateRead() { return createDefaultConfig().search.desk; }
    export const result = privateRead();
  `);
      const loaded = loadEsmModule(entry, {}, ['privateRead']);
      expect(loaded.privateRead()).toBe(loaded.result);
      expect(() => loadEsmModule(entry, {}, ['missing']))
          .toThrow('Unknown private fixture binding');
    });

test('missing named imports fail instead of silently becoming undefined', () => {
  fixture('other.js', 'export const available = 1;');
  const entry = fixture(
      'entry.js',
      'import {missing} from \'./other.js\'; export const value = missing;');
  expect(() => loadEsmModule(entry)).toThrow('Missing fixture export missing');
});

test('cycles and bare module specifiers fail clearly', () => {
  fixture('other.js', 'import \'./entry.js\'; export const value = 1;');
  const entry =
      fixture('entry.js', 'import \'./other.js\'; export const value = 2;');
  expect(() => loadEsmModule(entry)).toThrow('Circular fixture import');
  const bare =
      fixture('bare.js', 'import \'node:fs\'; export const value = 1;');
  expect(() => loadEsmModule(bare)).toThrow('Unsupported fixture import');
});
