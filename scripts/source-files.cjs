const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRECTORIES = ['js', 'tests', 'scripts', 'e2e'];

/**
 * Lists owned JavaScript, including development tools and query catalogues.
 * @param {string=} root Repository root.
 * @return {!Array<string>} Sorted absolute filenames.
 */
function listJavaScriptFiles(root = ROOT) {
  const files = [];
  /**
   * Visits a source directory without following symlinks.
   * @param {string} directory Absolute directory.
   * @return {void}
   */
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      files.push(path.join(root, entry.name));
    }
  }
  for (const directory of SOURCE_DIRECTORIES) {
    visit(path.join(root, directory));
  }
  return files.sort();
}

module.exports = {
  ROOT,
  listJavaScriptFiles,
};
