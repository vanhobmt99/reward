#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ignored = new Set(["jquery.js"]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (!entry.isFile() || !entry.name.endsWith(".js")) return [];
    if (ignored.has(entry.name)) return [];
    return [fullPath];
  });
}

function toScriptSource(source) {
  return source
    .replace(/^\s*import[\s\S]*?;\s*$/gm, "")
    .replace(
      /\bexport\s+(?=(async\s+)?function\b|class\b|const\b|let\b|var\b)/g,
      "",
    )
    .replace(/\bexport\s*\{[\s\S]*?\};?/g, "");
}

const files = [
  ...walk(path.join(root, "js")),
  ...walk(path.join(root, "tests")),
].filter((file) => path.basename(file) !== "check_syntax.js");

const failures = [];
for (const file of files) {
  const relative = path.relative(root, file);
  try {
    const source = toScriptSource(fs.readFileSync(file, "utf8"));
    new vm.Script(source, { filename: relative });
  } catch (error) {
    failures.push({ file: relative, error });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.file}: ${failure.error.message}`);
  }
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} files.`);
