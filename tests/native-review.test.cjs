const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Runtime = require('../planner-design-runtime.js');

function functions(source) {
  const ast = ts.createSourceFile('source.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

test('native Review uses verbatim incumbent score, fix strategy and improvement functions', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const legacy = functions([...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('function roomPlannerConfig')));
  const native = functions(fs.readFileSync('planner-design-runtime.js', 'utf8'));
  for (const name of ['roomScienceItems','roomGreenItems','roomVastuItems',
    'roomChecklistItemsFor','roomChecklistAggregate','roomApplyChecklistFix',
    'roomFixImproved','roomFixWindows','roomFixExposure','roomPreferredMove'])
    assert.equal(native.get(name), legacy.get(name), `${name} was replaced or changed`);
});

test('Review registry is not a global authority and unknown owners have no model', () => {
  assert.equal(typeof Runtime.getReview, 'function');
  assert.equal(Runtime.getReview({}), null);
  const source = fs.readFileSync('scripts\\design-runtime-host.js', 'utf8');
  assert.match(source, /const reviewOwners=new WeakMap/);
  assert.match(source, /reviewOwners\.delete\(controller\)/);
  assert.match(source, /controller\.beginLegacyGesture\(\)/);
  assert.match(source, /controller\.endLegacyGesture\(true\)/);
  assert.match(source, /latest\.after!==controller\.exportProject\(\)/);
});
