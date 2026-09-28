"use strict";

/**
 * Minimal ESM → CommonJS loader for unit tests.
 *
 * The extension ships browser ESM (`export function foo`, `export const bar`)
 * and there is no Babel/ts-jest transform in this repo. Tests therefore read a
 * module's source, strip the `export` keyword from named declarations, collect
 * those names, and evaluate the result in a fresh `vm` sandbox — returning the
 * exported bindings as a plain object.
 *
 * Supports the subset the pure helper modules use:
 *   export function name(...) {}
 *   export const name = ...
 * (No re-exports, default exports, or `export { ... }` lists.)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadEsmModule(relativePath, extraContext = {}) {
  const absolute = path.join(__dirname, relativePath);
  const source = fs.readFileSync(absolute, "utf8");

  const names = [];
  const declRegex =
    /export\s+(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = declRegex.exec(source)) !== null) {
    names.push(match[2]);
  }

  let stripped = source.replace(
    /export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\s)/g,
    "",
  );

  // Also support trailing `export { a, b };` list form (no re-export from).
  stripped = stripped.replace(/export\s*\{([^}]*)\}\s*;?/g, (_full, inner) => {
    for (const part of inner.split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.push(name);
    }
    return "";
  });

  const uniqueNames = [...new Set(names)];
  const wrapped = `${stripped}\nmodule.exports = { ${uniqueNames.join(", ")} };`;

  const sandboxModule = { exports: {} };
  const context = vm.createContext({
    module: sandboxModule,
    exports: sandboxModule.exports,
    console,
    ...extraContext,
  });
  vm.runInContext(wrapped, context, { filename: absolute });
  return sandboxModule.exports;
}

module.exports = { loadEsmModule };
