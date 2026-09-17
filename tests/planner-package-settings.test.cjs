const test = require('node:test');
const assert = require('node:assert/strict');
const Package = require('../planner-package.js');
const Model = require('../planner-model.js');
const Storage = require('../planner-storage.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');

test('strict complete settings and canonical optional storage validation agree', () => {
  const expected = { version: 1, title: '', paper: 'A3', orientation: 'landscape',
    scaleDenominator: 100, units: 'metric', pngDpi: 150 };
  assert.deepEqual(Package.defaults(), expected);
  assert.notEqual(Package.defaults(), Package.defaults());
  assert.deepEqual(Package.normalizeSettings(expected), expected);
  assert.ok(Object.isFrozen(Package.normalizeSettings(expected)));
  const invalid = [null, {}, { ...expected, extra: 1 }, { ...expected, version: 2 }, { ...expected, title: 'x'.repeat(201) },
    { ...expected, title: '\u0000' }, { ...expected, title: '\u007f' }, { ...expected, title: '\ud800' },
    { ...expected, paper: 'A1' }, { ...expected, orientation: 'square' }, { ...expected, units: 'feet' },
    { ...expected, scaleDenominator: 25 }, { ...expected, pngDpi: 300 }, { ...expected, pngDpi: NaN }];
  for (const value of invalid) {
    assert.throws(() => Package.normalizeSettings(value));
    const p = createFixture('missing-context').project;
    p.documentation = { version: 1, views: [], sheets: [], package: value };
    assert.throws(() => Model.validateProject(p));
  }
  for (const paper of ['A4', 'A3', 'A2']) for (const scaleDenominator of [50, 75, 100])
    for (const pngDpi of [72, 150]) assert.doesNotThrow(() => Package.normalizeSettings({
      ...expected, title: 'A title é', paper, scaleDenominator, pngDpi, units: 'imperial'
    }));
  assert.throws(() => Package.normalizeSettings({ ...expected, title: undefined }));
  assert.throws(() => Package.normalizeSettings(Object.defineProperty({ ...expected }, 'title', { get() { throw Error('accessed'); } })));
});

test('old documentation and absent package remain unchanged through storage and projection', () => {
  for (const documentation of [undefined, { version: 1, views: [], sheets: [] }]) {
    const project = createFixture('missing-context').project;
    if (documentation) project.documentation = documentation;
    const controller = controllerFor(project), before = controller.getProject();
    const reopened = Storage.parseProject(JSON.stringify(before));
    assert.deepEqual(reopened.documentation, documentation);
    assert.equal(Object.hasOwn(controller.getDrawingScene().documentation, 'package'), false);
    assert.equal(Model.canonicalDocument(reopened).schemaVersion, before.schemaVersion);
  }
});

test('real bridge command, undo/redo, save/reopen and floor copy/removal preserve shared settings', () => {
  const controller = controllerFor(createFixture('multiple-floors').project);
  const old = { version: 1, views: [], sheets: [] };
  controller.execute({ type: 'set-documentation', value: old });
  const settings = { ...Package.defaults(), title: 'Coordination package', paper: 'A2', units: 'imperial' };
  controller.execute({ type: 'set-documentation', value: { ...old, package: settings } });
  assert.deepEqual(controller.getProject().documentation.package, settings);
  assert.deepEqual(controller.getDrawingScene().documentation.package, settings);
  controller.undo();
  assert.deepEqual(controller.getProject().documentation, old);
  controller.redo();
  assert.deepEqual(controller.getProject().documentation.package, settings);
  const saved = JSON.stringify(controller.getProject());
  const reopened = controllerFor(Storage.parseProject(saved));
  assert.deepEqual(reopened.getProject().documentation.package, settings);
  reopened.execute({ type: 'add-floor', copyFromId: 'ground', name: 'Copied' });
  const copiedId = reopened.getProject().activeFloorId;
  assert.deepEqual(reopened.getProject().documentation.package, settings);
  reopened.execute({ type: 'delete-floor', id: copiedId });
  assert.deepEqual(reopened.getProject().documentation.package, settings);
  reopened.undo();
  assert.deepEqual(reopened.getProject().documentation.package, settings);
  assert.equal(reopened.getProject().floors.some(f => Object.hasOwn(f, 'package')), false);
});
