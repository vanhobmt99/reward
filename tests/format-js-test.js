const path = require('node:path');
const {parse} = require('acorn');
const {formatSource, syntaxSignature} = require('../scripts/format-js.cjs');

test.each([
  'const values = [\n  {name:"alpha", nested:[1,2,3]},\n  {name:"beta", nested:[4,5,6]}\n];',
  'module.exports = {first: value.first, second: value.second, third: value.third};',
  'const pattern = String.raw`a\\s+b`; const text = "quoted \' value";',
])('one format call is stable and retains the original AST: %s', (source) => {
  const filename = path.resolve(__dirname, '../format-fixture.js');
  const formatted = formatSource(source, filename);
  expect(syntaxSignature(formatted)).toBe(syntaxSignature(source));
  expect(formatSource(formatted, filename)).toBe(formatted);
  if (source.startsWith('module.exports')) {
    expect(formatted).not.toMatch(/\w +:/);
  }
});

test('wrapped method JSDoc retains leading stars and stays stable', () => {
  const source = `const cache = {
    /** @return {!Array<string>} Current topics; callers cannot mutate the cached source collection. */
    peek() { return []; }
  };`;
  const filename = path.resolve(__dirname, '../format-fixture.js');
  const formatted = formatSource(source, filename);
  const comments = [];
  parse(formatted, {ecmaVersion: 2022, onComment: comments});
  expect(comments).toHaveLength(1);
  const lines = formatted.slice(comments[0].start, comments[0].end).split('\n');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).every((line) => line.trimStart().startsWith('*')))
      .toBe(true);
  expect(formatSource(formatted, filename)).toBe(formatted);
  expect(syntaxSignature(formatted)).toBe(syntaxSignature(source));
});
