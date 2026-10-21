const js = require('@eslint/js');
const globals = require('globals');

/**
 * Flat ESLint config for the Search Auto extension.
 *
 * - js/**            → browser + WebExtension (chrome.*) globals, ES modules.
 * - tests/**         → Node + Jest (CommonJS); jsdom-style browser globals too.
 * Google layout is enforced by clang-format; language rules live here.
 * Owned query catalogues, tools and browser tests are checked too.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '.cleanup-baseline/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'curly': ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'one-var': ['error', 'never'],
      'eqeqeq': ['error', 'always', {null: 'ignore'}],
      'no-eval': 'error',
      'no-new-wrappers': 'error',
      'no-array-constructor': 'error',
      'no-caller': 'error',
      'no-with': 'error',
      'no-throw-literal': 'error',
      'no-duplicate-imports': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'quotes': [
        'error',
        'single',
        {avoidEscape: false, allowTemplateLiterals: true},
      ],
      'key-spacing': ['error', {beforeColon: false, afterColon: true}],
      'quote-props': ['error', 'consistent-as-needed'],
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'never',
          exports: 'always-multiline',
          functions: 'ignore',
        },
      ],
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Extension source (service worker, popup, content script, helper modules).
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-empty': ['error', {allowEmptyCatch: true}],
    },
  },

  // Test suite: Node + Jest, CommonJS, with jsdom browser globals available.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Config files run in Node/CommonJS.
  {
    files: ['eslint.config.js', 'scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {...globals.node},
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    files: ['e2e/**/*.mjs', 'playwright.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {...globals.node, ...globals.browser, chrome: 'readonly'},
    },
  },
  {
    files: ['scripts/test-firefox.cjs'],
    languageOptions: {
      globals: {...globals.browser},
    },
  },
];

module.exports = config;
