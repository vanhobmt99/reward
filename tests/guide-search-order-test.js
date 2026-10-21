'use strict';

const fs = require('fs');
const path = require('path');
const {parse} = require('acorn');
const {indexOfCode, toContainSource} = require('./source-assertions');

expect.extend({toContainSource});

const root = path.join(__dirname, '..');

/**
 * Reads a repository file as UTF-8 text.
 * @param {string} relative Path from the repository root.
 * @return {string} File contents.
 */
function readRepo(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/**
 * Lists user-facing Markdown and HTML outside build and dependency folders.
 * @param {string} directory Absolute directory to visit.
 * @param {!Array<string>} found Paths collected so far.
 * @return {!Array<string>} Absolute guide paths.
 */
function listGuides(directory, found) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist' ||
        entry.name === '.git' || entry.name === '.cleanup-baseline' ||
        entry.name === '_metadata') {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listGuides(full, found);
    } else if (entry.isFile() && /\.(md|html)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Returns one top-level function declaration.
 * @param {string} source Module source.
 * @param {string} name Function identifier.
 * @return {string} Declaration text.
 */
function functionSource(source, name) {
  const program = parse(source, {ecmaVersion: 2022, sourceType: 'module'});
  const node =
      program.body
          .map(
              (entry) => entry.type === 'ExportNamedDeclaration' &&
                      entry.declaration?.type === 'FunctionDeclaration' ?
                  entry.declaration :
                  entry)
          .find(
              (entry) => entry.type === 'FunctionDeclaration' &&
                  entry.id.name === name);
  if (!node || node.end <= node.start) {
    throw new Error(`Missing function declaration: ${name}`);
  }
  return source.slice(node.start, node.end);
}

describe('user guides and search-first order', () => {
  test('guides do not tell anyone to install a versioned dist zip', () => {
    const forbidden =
        /package:chrome|package:firefox|search-auto-[a-z0-9]+-\d+\.\d+\.\d+\.zip/i;
    const publishedAsset =
        /https:\/\/github\.com\/vanhobmt99\/reward\/releases\/download\/v(\d+\.\d+\.\d+)\/search-auto-(?:chrome|firefox)-\1\.zip/g;
    const guides = listGuides(root, []);
    expect(guides.length).toBeGreaterThan(0);
    for (const file of guides) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text.replace(publishedAsset, '')).not.toMatch(forbidden);
    }

    const readme = readRepo('README.md');
    expect(readme).toContain('manifest.json');
    expect(readme).toContain('Tải tiện ích đã giải nén');
    expect(readme).toContain('**Start**');
    expect(readme).toContain('**Dừng**');
    expect(readme).toContain('**Tùy chọn**');
    expect(readme).toContain('**Chạy một lần**');
    expect(readme).toContain('**Đặt lịch**');
    expect(readme).not.toContain('npm.cmd run build:firefox');
    expect(readme).not.toContain('dist/firefox/manifest.json');

    const firefox = readRepo('docs/firefox.md');
    expect(firefox).toContain('npm.cmd run build:firefox');
    expect(firefox).toContain('dist/firefox/manifest.json');
    expect(firefox).toContain('Load Temporary Add-on');

    const donate = readRepo('donate.html');
    expect(donate).toContain('manifest.json');
    expect(donate).toContain('<strong>Start</strong>');
    expect(donate).toContain('<strong>Dừng</strong>');
    expect(donate).toContain('<strong>Tùy chọn</strong>');
    expect(donate).toContain('<strong>Chạy một lần</strong>');
    expect(donate).toContain('<strong>Đặt lịch</strong>');

    const manual = readRepo('manual.html');
    expect(manual).toContain('<b>Start</b>');
    expect(manual).toContain('<b>Dừng</b>');
    expect(manual).toContain('<b>Tùy chọn</b>');
    expect(manual).toContain('<b>Chạy một lần</b>');
    expect(manual).toContain('<b>Đặt lịch</b>');

    const firefoxManual = readRepo('firefox/manual.html');
    expect(firefoxManual).toContain('<b>Start</b>');
    expect(firefoxManual).toContain('<b>Dừng</b>');
    expect(firefoxManual).toContain('<b>Tùy chọn</b>');
    expect(firefoxManual).toContain('<b>Chạy một lần</b>');
    expect(firefoxManual).toContain('<b>Đặt lịch</b>');
    expect(firefoxManual).toContain('npm.cmd run build:firefox');
    expect(firefoxManual).toContain('dist/firefox/manifest.json');
  });

  test('the worker searches in the current window before later Rewards work', () => {
    const serviceSource = readRepo('js/service.js');
    const phasesSource = readRepo('js/search-phases.js');
    const initialise = functionSource(serviceSource, 'initialise');
    const phases = functionSource(phasesSource, 'runSearchPhases');

    const searchPhase =
        indexOfCode(initialise, 'config.runtime.currentPhase = \'search\';');
    const runPhases = indexOfCode(
        initialise, 'const searchPhasesSuccessful = await runSearchPhases(');
    const postPhase = indexOfCode(
        initialise, 'config.runtime.currentPhase = \'post_search\';');
    expect(searchPhase).toBeGreaterThan(-1);
    expect(runPhases).toBeGreaterThan(searchPhase);
    expect(postPhase).toBeGreaterThan(runPhases);
    expect(indexOfCode(
               initialise.slice(postPhase), 'await handlePostSearchTasks('))
        .toBeGreaterThan(-1);
    expect(
        indexOfCode(
            initialise,
            'const rsaTab = await chrome.tabs.create({url: bing, active: true});'))
        .toBeGreaterThan(-1);
    expect(serviceSource).not.toContainSource('chrome.windows.create');

    const quota = indexOfCode(initialise, 'ignoreDailyQuota = Boolean(force);');
    const limited = indexOfCode(
        initialise, 'searches = limitSearchPlanForToday(searches);');
    expect(limited).toBeGreaterThan(quota);

    const desktop = indexOfCode(
        phases, 'log(`[SEARCH] - Starting desktop searches...`, \'update\');');
    const mobile = indexOfCode(
        phases,
        'log(`[SEARCH] - Simulating mobile environment...`, \'update\');');
    expect(desktop).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(desktop);
    expect(phases).not.toContainSource('handlePostSearchTasks');
  });
});
