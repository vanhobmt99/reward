'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('acorn');

/**
 * Converts local named imports/exports for synchronous VM tests. AST offsets
 * preserve comments, regular expressions and source strings. Import bindings
 * are snapshots, suitable for this project's immutable named exports; default
 * exports and re-exports fail explicitly rather than being guessed.
 * @param {string} source Module source.
 * @param {!Array<string>=} expose Private top-level names to expose in tests.
 * @return {string} Executable CommonJS fixture source.
 */
function moduleFixtureSource(source, expose = []) {
  const ast = parse(source, {ecmaVersion: 2022, sourceType: 'module'});
  const edits = [];
  const exports = [];
  const imports = [];
  const declared = new Set();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.specifiers.some(
              (item) => item.type === 'ImportDefaultSpecifier')) {
        throw new Error(
            'Test loader supports named exports and local imports only');
      }
      const request = `__loadModule(${JSON.stringify(node.source.value)})`;
      if (node.specifiers.length === 0) {
        imports.push(`${request};`);
      } else if (node.specifiers[0].type === 'ImportNamespaceSpecifier') {
        imports.push(`const ${node.specifiers[0].local.name} = ${request};`);
      } else {
        const bindings = node.specifiers.map(
            (item) => `${
                JSON.stringify(item.imported.name || item.imported.value)}: ${
                item.local.name}`);
        const names = node.specifiers.map(
            (item) => item.imported.name || item.imported.value);
        imports.push(`const {${bindings.join(', ')}} = __loadModule(${
            JSON.stringify(node.source.value)}, ${JSON.stringify(names)});`);
      }
      edits.push({start: node.start, end: node.end});
      continue;
    }
    if (node.type === 'ExportAllDeclaration' ||
        node.type === 'ExportDefaultDeclaration' || node.source) {
      throw new Error(
          'Test loader supports named exports and local imports only');
    }
    const top = node.declaration || node;
    if (top.type === 'VariableDeclaration') {
      for (const entry of top.declarations) {
        if (entry.id.type === 'Identifier') {
          declared.add(entry.id.name);
        }
      }
    } else if (top.id?.name) {
      declared.add(top.id.name);
    }
    if (node.type !== 'ExportNamedDeclaration') {
      continue;
    }
    if (node.declaration) {
      const declaration = node.declaration;
      const names = declaration.type === 'VariableDeclaration' ?
          declaration.declarations.map((entry) => entry.id) :
          [declaration.id];
      for (const name of names) {
        if (name?.type !== 'Identifier') {
          throw new Error('Test loader requires identifier export bindings');
        }
        exports.push(JSON.stringify(name.name) + ': ' + name.name);
      }
      edits.push({start: node.start, end: declaration.start});
    } else {
      for (const specifier of node.specifiers) {
        exports.push(
            JSON.stringify(
                specifier.exported.name || specifier.exported.value) +
            ': ' + specifier.local.name);
      }
      edits.push({start: node.start, end: node.end});
    }
  }
  for (const {start, end} of edits.reverse()) {
    source = source.slice(0, start) + source.slice(end);
  }
  for (const name of expose) {
    if (!declared.has(name)) {
      throw new Error(`Unknown private fixture binding: ${name}`);
    }
    exports.push(JSON.stringify(name) + ': ' + name);
  }
  return imports.join('\n') + '\n' + source + '\nmodule.exports = { ' +
      exports.join(', ') + ' };';
}

/**
 * Evaluates the actual helper module with supplied browser/API mocks.
 * @param {string} relativePath Path relative to this test directory.
 * @param {!Object=} extraContext Explicit globals for the fixture.
 * @param {!Array<string>=} expose Private entry-module bindings to inspect.
 * @return {!Object} Module exports (snapshot bindings).
 */
function loadEsmModule(relativePath, extraContext = {}, expose = []) {
  const root = path.resolve(__dirname, '..');
  const cache = new Map();
  const loading = new Set();
  const context = vm.createContext({console, ...extraContext});
  /**
   * @param {string} file Absolute dependency path.
   * @param {!Array<string>=} exposed Private bindings for the entry module.
   * @return {!Object} Cached exports from this fixture's module graph.
   */
  function load(file, exposed = []) {
    const absolute = fs.realpathSync(file);
    const relative = path.relative(root, absolute);
    if (path.isAbsolute(relative) || relative.split(path.sep).includes('..') ||
        path.extname(absolute) !== '.js') {
      throw new Error('Fixture imports must be project-local JavaScript files');
    }
    if (loading.has(absolute)) {
      throw new Error(`Circular fixture import: ${relative}`);
    }
    if (cache.has(absolute)) {
      return cache.get(absolute);
    }
    loading.add(absolute);
    try {
      const source =
          moduleFixtureSource(fs.readFileSync(absolute, 'utf8'), exposed);
      const execute = vm.runInContext(
          `(function(__loadModule, module) { 'use strict';\n${source}\n})`,
          context, {filename: absolute});
      const module = {exports: {}};
      execute((specifier, names = []) => {
        if (!specifier.startsWith('/') && !specifier.startsWith('.')) {
          throw new Error(`Unsupported fixture import: ${specifier}`);
        }
        const dependency = specifier.startsWith('/') ?
            path.join(root, specifier) :
            path.resolve(path.dirname(absolute), specifier);
        const imported = load(dependency);
        for (const name of names) {
          if (!Object.hasOwn(imported, name)) {
            throw new Error(`Missing fixture export ${name} from ${specifier}`);
          }
        }
        return imported;
      }, module);
      cache.set(absolute, module.exports);
      return module.exports;
    } finally {
      loading.delete(absolute);
    }
  }
  return load(path.resolve(__dirname, relativePath), expose);
}

module.exports = {
  loadEsmModule,
  moduleFixtureSource,
};
