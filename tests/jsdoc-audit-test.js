const {auditJsdoc} = require('../scripts/audit-jsdoc.cjs');

test('annotation audit covers exported, assigned and method functions', () => {
  const source = `
    export function plain(value) { return value; }
    const assigned = value => value;
    const obj = {method(value) { return value; }};
    class Example { method(value) { return value; } }
  `;
  const gaps = auditJsdoc(source);
  expect(gaps.map((gap) => gap.name)).toEqual([
    'plain',
    'assigned',
    'method',
    'method',
  ]);
  expect(gaps.every((gap) => gap.missing.length === 2)).toBe(true);
});

test(
    'typed declarations and inferred callbacks do not create false gaps',
    () => {
      const source = `
    /** @param {number} value @return {number} */
    export const double = value => value * 2;
    /** @param {number} value */
    function launch(value) { Promise.resolve(value).then(result => result + 1); }
    function /** number */ inline(/** number */ value) { return value; }
    function empty() { return; }
  `;
      expect(auditJsdoc(source)).toEqual([]);
    });

test('a nested return does not require an outer return annotation', () => {
  const gaps =
      auditJsdoc('function outer() { function inner() { return 1; } }');
  expect(gaps).toEqual([{name: 'inner', line: 1, missing: ['return type']}]);
});
