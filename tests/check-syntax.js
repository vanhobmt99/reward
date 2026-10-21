#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('acorn');
const {ROOT, listJavaScriptFiles} = require('../scripts/source-files.cjs');

const files = listJavaScriptFiles();
// These tool-discovered root config names and explicit Node module extensions
// are the documented platform conventions; owned module basenames stay
// lowercase.
const toolConfigs = new Set(['eslint.config.js', 'playwright.config.mjs']);
let failures = 0;
for (const file of files) {
  try {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
    if (!toolConfigs.has(relative) &&
        !/^[a-z0-9_-]+\.[cm]?js$/.test(path.basename(file))) {
      throw new Error(
          'Source filename must be lowercase with only dashes or underscores');
    }
    parse(fs.readFileSync(file, 'utf8'), {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowHashBang: true,
    });
  } catch (error) {
    failures++;
    console.error(`${path.relative(ROOT, file)}: ${error.message}`);
  }
}
if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`Syntax and filename checks passed for ${files.length} files.`);
}
