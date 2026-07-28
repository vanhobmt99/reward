const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

/**
 * Flat ESLint config for the Search Auto extension.
 *
 * - js/**            → browser + WebExtension (chrome.*) globals, ES modules.
 * - js/popup.js      → additionally exposes the bundled jQuery ($ / jQuery).
 * - tests/**         → Node + Jest (CommonJS); jsdom-style browser globals too.
 * - Vendored/data    → jquery.js and the query catalogues are not linted.
 *
 * Formatting is delegated to Prettier (eslint-config-prettier disables any
 * stylistic rules that would conflict), so ESLint only flags real problems.
 */
module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "js/jquery.js",
      "js/queries.js",
      "js/queries_extra.js",
    ],
  },

  js.configs.recommended,

  // Extension source (service worker, popup, content script, helper modules).
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          args: "none",
          caughtErrors: "none",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // popup.js drives the UI through the bundled jQuery.
  {
    files: ["js/popup.js"],
    languageOptions: {
      globals: { ...globals.jquery },
    },
  },

  // Test suite: Node + Jest, CommonJS, with jsdom browser globals available.
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },

  // Config files run in Node/CommonJS.
  {
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },

  prettier,
];
