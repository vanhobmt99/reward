const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {parse} = require('acorn');
const {getNativeBinary} = require('clang-format');
const {Linter} = require('eslint');
const eslintConfig = require('../eslint.config.js');
const {ROOT, listJavaScriptFiles} = require('./source-files.cjs');

const linter = new Linter();
const commaRule = eslintConfig.find(entry => entry.rules?.['comma-dangle'])
                      .rules['comma-dangle'];

/**
 * Retains program structure and literal values while ignoring source positions.
 * Template raw text is preserved because String.raw can observe it.
 * @param {string} source JavaScript source.
 * @return {string} Comparable syntax tree.
 */
function syntaxSignature(source) {
  const tree = parse(source, {
    ecmaVersion: 2022,
    sourceType: 'module',
    allowHashBang: true,
  });
  return JSON.stringify(tree, function(key, value) {
    if (['start', 'end'].includes(key) ||
        (key === 'raw' && this.type === 'Literal')) {
      return undefined;
    }
    return value;
  });
}

/**
 * Keeps ES imports on one line as required by Google section 3.4.1.
 * Clang-format otherwise preserves some pre-existing multiline imports.
 * @param {string} source JavaScript source.
 * @return {string} Source with compact import declarations.
 */
function compactImports(source) {
  const comments = [];
  const tree = parse(source, {
    ecmaVersion: 2022,
    sourceType: 'module',
    allowHashBang: true,
    onComment: comments,
  });
  const imports = tree.body.filter(node => node.type === 'ImportDeclaration');
  for (const node of imports.reverse()) {
    if (comments.some(
            comment => comment.start > node.start && comment.end < node.end)) {
      throw new Error(
          'Move comments out of import declarations before formatting');
    }
    source = source.slice(0, node.start) +
        source.slice(node.start, node.end).replace(/\r?\n\s*/g, ' ') +
        source.slice(node.end);
  }
  return source;
}

/**
 * Runs the formatter/comma pipeline to a fixed point before returning source.
 * A bounded iteration rejects oscillating layouts instead of requiring users
 * to run the format command repeatedly. Every pass keeps the original AST.
 * @param {string} source Original source.
 * @param {string} file Absolute filename used to locate the style config.
 * @return {string} Stable formatted source.
 */
function formatSource(source, file) {
  const signature = syntaxSignature(source);
  let current = source;
  const seen = new Set([source]);
  for (let pass = 0; pass < 8; pass++) {
    // Force JavaScript parsing for Node .cjs and Playwright .mjs as well.
    const result = spawnSync(
        getNativeBinary(),
        [
          '--style=file',
          `--assume-filename=${file}.js`,
        ],
        {
          input: compactImports(current),
          encoding: 'utf8',
          cwd: ROOT,
          maxBuffer: 8 * 1024 ** 2,
        });
    if (result.error || result.status !== 0) {
      throw result.error || new Error(result.stderr);
    }
    // LLVM 15 can add invalid commas after rest bindings with its own trailing
    // comma option. Use ESLint's AST-aware rule instead, then validate
    // semantics.
    const formatted =
        linter
            .verifyAndFix(normalizeJsdocBlocks(result.stdout), {
              linterOptions: {reportUnusedDisableDirectives: 'off'},
              languageOptions: {ecmaVersion: 2022, sourceType: 'module'},
              rules: {
                'comma-dangle': commaRule,
                'key-spacing':
                    ['error', {beforeColon: false, afterColon: true}],
              },
            })
            .output;
    if (signature !== syntaxSignature(formatted)) {
      throw new Error(`Formatter changed JavaScript semantics: ${file}`);
    }

    if (formatted === current) {
      return formatted;
    }
    if (seen.has(formatted)) {
      throw new Error('Formatter layout oscillates: ' + file);
    }
    seen.add(formatted);
    current = formatted;
  }
  throw new Error('Formatter did not converge: ' + file);
}

/**
 * LLVM 15 can wrap a long one-line method JSDoc without leading stars. Restore
 * the required multiline JSDoc form using parsed comments, never string data.
 * @param {string} source Clang-formatted source.
 * @return {string} Source with stars on every multiline JSDoc line.
 */
function normalizeJsdocBlocks(source) {
  const comments = [];
  parse(source, {
    ecmaVersion: 2022,
    sourceType: 'module',
    allowHashBang: true,
    onComment: comments,
  });
  for (const comment of comments.reverse()) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
      continue;
    }
    const block = source.slice(comment.start, comment.end);
    const lines = block.split('\n');
    for (let index = 1; index < lines.length; index++) {
      if (!lines[index].trimStart().startsWith('*')) {
        lines[index] = lines[index].replace(/^(\s*)(.*)$/, '$1* $2');
      }
    }
    source = source.slice(0, comment.start) + lines.join('\n') +
        source.slice(comment.end);
  }
  return source;
}

/**
 * Formats all owned JavaScript and refuses syntax/behavior-altering output.
 * @param {boolean} write Whether to update files instead of checking them.
 * @return {boolean} Whether the requested operation succeeded.
 */
function formatJavaScript(write) {
  const files = listJavaScriptFiles();
  let changed = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const formatted = formatSource(source, file);
    if (source !== formatted) {
      changed++;
      if (write) {
        fs.writeFileSync(file, formatted);
      } else {
        console.error(
            `Google formatting required: ${path.relative(ROOT, file)}`);
      }
    }
  }
  console.log(`Google format: ${files.length} files, ${changed} ${
      write ? 'updated' : 'differ'}.`);
  return write || changed === 0;
}

if (require.main === module) {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode)) {
    throw new Error('Usage: node scripts/format-js.cjs --write|--check');
  }
  process.exitCode = formatJavaScript(mode === '--write') ? 0 : 1;
}

module.exports = {
  formatJavaScript,
  formatSource,
  syntaxSignature,
  compactImports,
};
