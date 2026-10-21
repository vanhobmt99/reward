const {tokenizer} = require('acorn');

/**
 * Tokenizes complete programs or source fragments without depending on layout.
 * @param {string} source Program or fragment.
 * @return {!Array<!Object>} Tokens including original source positions.
 */
function sourceTokens(source) {
  const tokens = [...tokenizer(source, {
    ecmaVersion: 2022,
    sourceType: 'module',
    allowHashBang: true,
  })];
  return tokens.filter((token, index) => !(token.type.label === ',' && [
                         ')',
                         ']',
                         '}',
                       ].includes(tokens[index + 1]?.type.label)));
}

/**
 * Compares token kinds and semantic values, including string/regexp contents.
 * @param {!Object} token Acorn token.
 * @return {string} Comparable token.
 */
function tokenKey(token) {
  return JSON.stringify([token.type.label, token.value]);
}

/**
 * Finds a source fragment by tokens, excluding comments and whitespace.
 * @param {string} source Program or fragment to search.
 * @param {string} fragment Expected code.
 * @return {number} Original character offset or -1.
 */
function indexOfCode(source, fragment) {
  const tokens = sourceTokens(source);
  const expected = sourceTokens(fragment).map(tokenKey);
  if (expected.length === 0) {
    throw new Error('Source assertion requires nonempty code');
  }
  const keys = tokens.map(tokenKey);
  const index = keys.findIndex(
      (_, start) =>
          expected.every((key, offset) => keys[start + offset] === key));
  return index < 0 ? -1 : tokens[index].start;
}

/**
 * Counts non-overlapping token matches. Comments and whitespace do not count.
 * @param {string} source Program or fragment to search.
 * @param {string} fragment Expected code.
 * @return {number} Match count.
 */
function countCode(source, fragment) {
  const tokens = sourceTokens(source);
  const expected = sourceTokens(fragment).map(tokenKey);
  if (expected.length === 0) {
    throw new Error('Source assertion requires nonempty code');
  }
  const keys = tokens.map(tokenKey);
  let count = 0;
  for (let start = 0; start + expected.length <= keys.length; start++) {
    const matched =
        expected.every((key, offset) => keys[start + offset] === key);
    if (matched) {
      count++;
      start += expected.length - 1;
    }
  }
  return count;
}

/**
 * Asserts code presence or diagnostic text inside an actual string/template.
 * This preserves legacy wiring checks while excluding comment-only matches.
 * @param {string} source Program source.
 * @param {string} expected Code fragment or literal text.
 * @return {{pass: boolean, message: function(): string}} Jest matcher result.
 */
function toContainSource(source, expected) {
  if (typeof source !== 'string' || typeof expected !== 'string' || !expected) {
    throw new Error('Source assertions require nonempty string arguments');
  }
  const tokens = sourceTokens(source);
  let pass = tokens.some(
      token => ['string', 'template'].includes(token.type.label) &&
          token.value.includes(expected));
  if (!pass) {
    // Diagnostic text can contain punctuation that is not valid JavaScript.
    try {
      pass = indexOfCode(source, expected) >= 0;
    } catch {
      pass = false;
    }
  }
  return {
    pass,
    /**
     * Explains whether the source contained the expected fragment.
     * @return {string} Jest matcher diagnostic.
     */
    message: () => `Expected source ${
        pass ? 'not ' :
               ''}to contain code or literal text: ${JSON.stringify(expected)}`,
  };
}

module.exports = {
  countCode,
  indexOfCode,
  toContainSource,
};
