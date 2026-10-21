const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {parse} = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILES = [
  'popup.html',
  'options.html',
  'manual.html',
  'donate.html',
  'loading.html',
];

/**
 * Resolves and checks a disposable output before replacing it. Existing parent
 * links must resolve inside the real project or dedicated test temp directory.
 * @param {string} target Browser name.
 * @param {string} output Requested output directory.
 * @return {string} Validated absolute output.
 */
function prepareOutput(target, output) {
  const label = target === 'firefox' ? 'Firefox' : 'Chrome';
  output = path.resolve(output);
  const defaultOutput = path.join(ROOT, 'dist', target);
  const tempRelative = path.relative(os.tmpdir(), output);
  const inTestTemp = !path.isAbsolute(tempRelative) &&
      new RegExp(`^search-auto-${
                     target}-(?:build|smoke)-[^\\\\/]+(?:[\\\\/]extension)?$`)
          .test(tempRelative);
  if (output !== defaultOutput && !inTestTemp) {
    throw new Error(
        `${label} output must be dist/${target} or a ${label} test directory.`);
  }
  let existing = output;
  while (!fs.existsSync(existing)) {
    existing = path.dirname(existing);
  }
  const allowedRoot = inTestTemp ? os.tmpdir() : ROOT;
  const actual = fs.realpathSync(existing);
  const relative = path.relative(fs.realpathSync(allowedRoot), actual);
  const expected = path.join(
      fs.realpathSync(allowedRoot), path.relative(allowedRoot, existing));
  if (path.isAbsolute(relative) || relative.split(path.sep).includes('..') ||
      path.relative(expected, actual) !== '') {
    throw new Error(`${label} output resolves outside its build root.`);
  }
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  return output;
}

/**
 * Copies the runtime allowlist, excluding browser-specific inactive adapters.
 * @param {string} output Prepared build directory.
 * @param {string} target Browser name.
 * @return {void}
 */
function copyRuntimeFiles(output, target) {
  const types = {js: '.js', css: '.css', fonts: '.woff2', logo: '.png'};
  for (const [dir, extension] of Object.entries(types)) {
    fs.mkdirSync(path.join(output, dir));
    for (const entry of fs.readdirSync(
             path.join(ROOT, dir), {withFileTypes: true})) {
      if (!entry.isFile() || path.extname(entry.name) !== extension ||
          (target === 'chrome' && entry.name.startsWith('firefox-')) ||
          (target === 'firefox' && entry.name === 'fingerprint.js')) {
        continue;
      }
      fs.copyFileSync(
          path.join(ROOT, dir, entry.name), path.join(output, dir, entry.name));
    }
  }
  fs.mkdirSync(path.join(output, 'docs'));
  for (const name of ['momo.jpg', 'vietcombank.png']) {
    fs.copyFileSync(
        path.join(ROOT, 'docs', name), path.join(output, 'docs', name));
  }
  for (const name of ['LICENSE']) {
    if (fs.existsSync(path.join(ROOT, name))) {
      fs.copyFileSync(path.join(ROOT, name), path.join(output, name));
    }
  }
}

/**
 * Checks parseable scripts and locally referenced manifest/HTML/CSS/modules.
 * @param {string} output Completed build directory.
 * @return {void}
 */
function validateExtension(output) {
  /**
   * Requires a packaged reference to stay inside the build and exist.
   * @param {string|undefined} reference Path or URL from the owner file.
   * @param {string=} owner File that contains the reference.
   */
  function checkReference(reference, owner = 'manifest.json') {
    if (!reference || /^(?:[a-z]+:|#|\/\/)/i.test(reference)) {
      return;
    }
    const name = reference.split(/[?#]/)[0];
    const file = name.startsWith('/') ?
        path.join(output, name) :
        path.resolve(output, path.dirname(owner), name);
    const relative = path.relative(output, file);
    if (path.isAbsolute(relative) || relative.split(path.sep).includes('..') ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Missing or unsafe reference in ${owner}: ${reference}`);
    }
  }
  const manifest =
      JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  for (const reference
           of [manifest.background?.service_worker,
               manifest.background?.page,
               manifest.action?.default_popup,
               manifest.browser_action?.default_popup,
               manifest.options_ui?.page,
               ...Object.values(manifest.icons || {}),
               ...Object.values(
                   (manifest.action || manifest.browser_action)?.default_icon ||
                   {}),
               ...(manifest.content_scripts || [])
                   .flatMap((entry) => [...entry.js || [], ...entry.css || []]),
  ]) {
    checkReference(reference);
  }
  for (const name of fs.readdirSync(path.join(output, 'js'))) {
    const source = fs.readFileSync(path.join(output, 'js', name), 'utf8');
    const ast = parse(source, {ecmaVersion: 2022, sourceType: 'module'});
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration' ||
          node.type === 'ExportAllDeclaration' ||
          (node.type === 'ExportNamedDeclaration' && node.source)) {
        checkReference(node.source.value, `js/${name}`);
      }
    }
  }
  for (const name of fs.readdirSync(output).filter(
           (name) => name.endsWith('.html'))) {
    const source = fs.readFileSync(path.join(output, name), 'utf8');
    for (const match of source.matchAll(
             /(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
      checkReference(match[1], name);
    }
  }
  for (const name of fs.readdirSync(path.join(output, 'css'))) {
    const source = fs.readFileSync(path.join(output, 'css', name), 'utf8');
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      checkReference(match[1].trim(), `css/${name}`);
    }
  }
}

module.exports = {
  ROOT,
  HTML_FILES,
  prepareOutput,
  copyRuntimeFiles,
  validateExtension,
};
