# JavaScript conventions and verification

The target is the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html).
`npm.cmd run audit:types` checks annotation coverage, not type correctness.
Browser E2E and Firefox smoke were not repeated on the latest tree.

## Files and tool boundaries

Owned source basenames use lowercase with dashes or underscores. Unit tests use
`*-test.js`; Playwright scenarios use `*-spec.mjs`. The syntax precheck validates
filenames as well as parsing source. Runtime modules retain `.js`.

The project keeps these explicit tooling conventions:

- `eslint.config.js` and `playwright.config.mjs` retain their tool-discovered names.
- Node CommonJS tools use `.cjs`; Playwright ES modules use `.mjs`, so Node can
  distinguish their module systems without changing the browser source package.
- Jest fixtures use CommonJS under the current test runner. Manifest content
  scripts remain classic scripts because the browser loads them that way.
- Tests execute owned script expressions in isolated fixtures to check what is
  actually sent through browser injection APIs. These evaluation sites are test
  boundaries, not a general allowance for evaluating remote or user-provided code.

These are local platform conventions, not claims that every file literally
follows every filename/module recommendation in the guide.

## Language rules

ESLint errors when owned code omits braces, uses `var`, uses `==` (except the
guide's `== null` nullish check), builds arrays with `Array()`, evaluates
source, or leaves a local unused. Strings in code use single quotes. Each
declaration is its own statement. Named functions and methods use lowerCamelCase.
Module-level immutable values use `CONSTANT_CASE`. `crash-logger.js` keeps the
stored key `_crashLog` because that string is already in user storage; the
identifiers around it do not use a leading underscore.

Every `switch` in `js/` has a `default`. There is no `for-in`. `content.js`
cannot `import`: MV3 content scripts are classic scripts, so its short `delay`
stays local. `playwright.config.mjs` uses the runner's default export. Two
`resetRuntime` functions are different jobs: `utils.js` clears search counters
and writes the runtime section, and `run-coordinator.js` clears in-memory
session ownership. `service.js` stays one worker because the remaining helpers
already live in the modules it imports.

## Checks

`npm.cmd run format:check` checks Google layout and preserves the parsed program
structure. The formatter repairs LLVM 15's malformed wrapping of long method
JSDoc comments, keeping leading stars on multiline comments. ESLint checks
language rules; `npm.cmd test -- --runInBand` checks behavior and source filenames.

`npm.cmd run audit:types` reports missing annotations. It does not prove type
correctness or replace a review of nullability, units and API boundaries.

The shared test loader parses module syntax, loads project-local dependencies,
caches their evaluation within each fixture, and rejects missing imports/cycles.
Its import bindings are snapshots suited to the project's immutable named
exports; it is not a complete implementation of ECMAScript module semantics.
UI fixtures that replace imported dependencies do so explicitly using parsed
declarations. Test limitations must not justify copying production algorithms.
