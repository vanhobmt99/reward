const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('acorn');
const {ROOT, listJavaScriptFiles} = require('./source-files.cjs');

/**
 * Finds missing type annotations on named declarations, assigned functions and
 * object/class methods. This checks coverage, not the correctness of the types.
 * Anonymous callback signatures can be inferred and are not required by 7.8.
 * @param {string} source JavaScript source.
 * @return {!Array<{name: string, line: number, missing: !Array<string>}>} Gaps.
 */
function auditJsdoc(source) {
  const comments = [];
  const tree = parse(source, {
    ecmaVersion: 2022,
    sourceType: 'module',
    locations: true,
    allowHashBang: true,
    onComment: comments,
  });
  const gaps = [];

  /**
   * Checks return statements without accidentally counting nested callbacks.
   * @param {!Object} node AST node inside the function body.
   * @return {boolean} Whether a value is returned.
   */
  function returnsValue(node) {
    if (node.type === 'ReturnStatement') {
      return node.argument !== null;
    }
    if (/Function/.test(node.type)) {
      return false;
    }
    return Object.values(node).some(
        (value) => Array.isArray(value) ?
            value.some((entry) => entry?.type && returnsValue(entry)) :
            value?.type && returnsValue(value));
  }

  /**
   * Visits a function with enough parent context to locate its declaration doc.
   * @param {!Object} node Acorn node.
   * @param {!Array<!Object>} parents Ancestors from outermost to innermost.
   * @return {void}
   */
  function visit(node, parents) {
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/
            .test(node.type)) {
      const parent = parents.at(-1);
      let anchor = node;
      let name = node.id?.name;
      if (parent?.type === 'VariableDeclarator' &&
          parent.id.type === 'Identifier') {
        name = parent.id.name;
        anchor = parents.at(-2);
      } else if (['Property', 'MethodDefinition'].includes(parent?.type)) {
        name = parent.key.name || parent.key.value || '[computed]';
        anchor = parent;
      } else if (parent?.type === 'AssignmentExpression') {
        name = source.slice(parent.left.start, parent.left.end);
        anchor = parents.at(-2);
      }
      const exported = parents.find(
          (entry) => entry.type === 'ExportNamedDeclaration' &&
              entry.declaration === anchor);
      anchor = exported || anchor;
      if (name) {
        const prior =
            comments.filter((comment) => comment.end <= anchor.start).at(-1);
        const doc = prior?.type === 'Block' && prior.value.startsWith('*') &&
                !source.slice(prior.end, anchor.start).trim() ?
            prior.value :
            '';
        const params = [...doc.matchAll(/@param\s*\{\s*[^}\s]/g)].length;
        const missing = [];
        const inlineParams =
            node.params
                .filter(
                    (param, index) => comments.some(
                        (comment) => comment.type === 'Block' &&
                            comment.value.startsWith('*') &&
                            comment.start >= (index ?
                                                  node.params[index - 1].end :
                                                  node.start) &&
                            comment.end <= param.start &&
                            !source.slice(comment.end, param.start).trim() &&
                            comment.value.slice(1).trim() &&
                            !comment.value.includes('@'),
                        ))
                .length;
        if (params + inlineParams < node.params.length) {
          missing.push(`parameter types (${params + inlineParams}/${
              node.params.length})`);
        }
        const valueReturned = node.body.type === 'BlockStatement' ?
            returnsValue(node.body) :
            !(node.body.type === 'UnaryExpression' &&
              node.body.operator === 'void');
        const inlineReturn = node.id &&
            comments.some(
                (comment) => comment.start >= node.start &&
                    comment.end <= node.id.start && comment.type === 'Block' &&
                    comment.value.startsWith('*') &&
                    comment.value.slice(1).trim() &&
                    !comment.value.includes('@'),
            );
        if (valueReturned && !/@returns?\s*\{\s*[^}\s]/.test(doc) &&
            !inlineReturn) {
          missing.push('return type');
        }
        if (missing.length) {
          gaps.push({name, line: node.loc.start.line, missing});
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.filter((entry) => entry?.type).forEach((entry) => visit(entry, [
                                                       ...parents,
                                                       node,
                                                     ]));
      } else if (value?.type) {
        visit(value, [...parents, node]);
      }
    }
  }
  visit(tree, []);
  return gaps;
}

if (require.main === module) {
  const results = listJavaScriptFiles().flatMap(
      (file) => auditJsdoc(fs.readFileSync(file, 'utf8'))
                    .map((gap) => ({file: path.relative(ROOT, file), ...gap})),
  );
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const counts = new Map();
    for (const gap of results) {
      counts.set(gap.file, (counts.get(gap.file) || 0) + 1);
    }
    for (const [file, count] of counts) {
      console.log(`${file}: ${count} functions missing type annotations`);
    }
    console.log(`Total: ${
        results.length}; annotation coverage only, not type correctness.`);
  }
  if (process.argv.includes('--check') && results.length) {
    process.exitCode = 1;
  }
}

module.exports = {auditJsdoc};
