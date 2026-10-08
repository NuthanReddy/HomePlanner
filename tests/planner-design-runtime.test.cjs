const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const Runtime = require('../planner-design-runtime.js');
const classicAssets = require('../planner-classic-assets.cjs');

test('native editable adapter retains the incumbent helper and bridge rendering source verbatim', () => {
  assert.match(execFileSync(process.execPath, ['scripts\\extract-design-runtime.cjs', '--check'], { encoding: 'utf8' }),
    /unchanged incumbent declarations/);
  assert.equal(typeof Runtime.mount, 'function');
});

test('manual browser bridge loading exports a factory without booting the legacy page', () => {
  const root = { document: { currentScript: { hasAttribute: name => name === 'data-homeplanner-manual' } } };
  vm.runInNewContext(fs.readFileSync('planner-bridge.js', 'utf8'), root);
  assert.equal(typeof root.HomePlannerBridge.createController, 'function');
  assert.equal(root.HomePlanner, undefined);
});

test('manual Three.js loading exposes mount without creating a graphics context', () => {
  const root = { document: { currentScript: { hasAttribute: () => true } } };
  vm.runInNewContext(fs.readFileSync('planner-3d.js', 'utf8'), root);
  assert.equal(typeof root.HomePlanner3D.mount, 'function');
  assert.equal(root.HomePlanner3D.instance, undefined);
});

test('manual incumbent inspector loading exports init without booting another editor', () => {
  const root = { document: { currentScript: { hasAttribute: () => true } } };
  root.window = root;
  vm.runInNewContext(fs.readFileSync('planner-editor.js', 'utf8'), root);
  assert.equal(typeof root.HomePlannerEditor.init, 'function');
  assert.equal(root.HomePlannerEditorInstance, undefined);
});

test('Vite middleware delivers the exact classic script and rejects traversal', () => {
  let middleware;
  classicAssets(process.cwd()).configureServer({ middlewares: { use(value) { middleware = value; } } });
  const headers = {};
  let content;
  for (const file of ['planner-3d.js', 'planner-layout-generator.js', 'planner-design-controls.js']) {
    middleware({ url: `/classic/${file}` }, {
      setHeader(key, value) { headers[key] = value; },
      end(value) { content = value; },
    }, () => assert.fail(`${file} was forwarded to Vite.`));
    assert.equal(headers['Content-Type'], 'text/javascript');
    assert.equal(content.toString(), fs.readFileSync(file, 'utf8'));
  }
  let forwarded = false;
  middleware({ url: '/classic/vendor/three/../../private.js' }, {}, () => { forwarded = true; });
  assert.equal(forwarded, true);
});
