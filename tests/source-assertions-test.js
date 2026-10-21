const {countCode, indexOfCode, toContainSource} =
    require('./source-assertions');

test(
    'source checks ignore layout, quote choice and optional trailing commas',
    () => {
      expect(indexOfCode(
                 'await api(\n \'value\', {active: true},\n);',
                 'await api("value", { active: true });'))
          .toBe(0);
    });

test.each([
  ['api("different");', 'api("value");'],
  ['api(value, false);', 'api(value, true);'],
  ['other(value);', 'api(value);'],
  ['// api(value);', 'api(value);'],
  ['a == b;', 'a === b;'],
])('source assertion detects semantic differences: %s', (source, expected) => {
  expect(toContainSource(source, expected).pass).toBe(false);
});

test('diagnostic text must exist in a literal, not just a comment', () => {
  expect(toContainSource('log("Request failed.");', 'Request failed.').pass)
      .toBe(true);
  expect(toContainSource('// Request failed.', 'Request failed.').pass)
      .toBe(false);
});

test('token counts ignore a comment copy of the same statement', () => {
  const source = [
    'const confirmedClick = Number.isFinite(pointDelta);',
    '// const confirmedClick = Number.isFinite(pointDelta);',
    'const confirmedClick = Number.isFinite(pointDelta);',
  ].join('\n');
  expect(
      countCode(source, 'const confirmedClick = Number.isFinite(pointDelta);'))
      .toBe(2);
});

test('source positions preserve ordering assertions', () => {
  const source = 'save();\nstart({force:true});';
  expect(indexOfCode(source, 'start({ force: true });'))
      .toBeGreaterThan(indexOfCode(source, 'save();'));
});
