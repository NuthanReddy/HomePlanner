const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Drawing = require('../planner-drawing.js');
const Projection = require('../planner-projection.js');
const Model = require('../planner-model.js');
const Package = require('../planner-package.js');
const Export = require('../planner-drawing-export.js');
const UI = require('../planner-drawing-ui.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const options = extra => ({ floorId: 'ground', paper: 'A2', ...extra });
function project(id = 'sparse-unknown') {
  const p = createFixture(id).project;
  for (const f of p.floors) if (f.legacy.context) f.legacy.context.plate.sitePlot = { x: 0, y: 0, w: 10, h: 8 };
  p.legacy = clone(p.floors[0].legacy);
  return p;
}
function dense(count = 35, tokenLength = 0) {
  const scene = clone(Projection.build(project()));
  for (let i = 0; i < count; i++) scene.diagnostics.push({
    ownerId: 'ground', code: 'unknown-' + String(i).padStart(3, '0') + '-' + 'Z'.repeat(tokenLength)
  });
  return scene;
}
const noteText = sheets => sheets.flatMap(s => s.primitives.filter(p =>
  p.type === 'text' && p.fontSizeMm === 2.05 && p.color === '#647078').map(p => p.text));
const compact = text => text.replace(/\s/gu, '');
function checkNotes(sheets) {
  assert.equal(compact(noteText(sheets).join('')), compact(sheets[0].metadata.assumptions.join('')));
  for (const sheet of sheets) {
    assert.deepEqual(sheet.metadata.assumptions, sheets[0].metadata.assumptions);
    assert.equal(Drawing.validateSheet(sheet), sheet);
  }
}

test('single-page outputs remain byte-identical to the pre-pagination renderer', () => {
  const hashes = {
    'furnished-single': '07bddf195d96d149b5ace17063eb55a1d17aa4024d3d634b6ed48eaefa1b5dc0',
    'sparse-unknown': '097bb1dde4f20361dca07ddec13c45cf2cf088d11fc0f4dd3a875fde6df1e72f'
  };
  for (const [id, hash] of Object.entries(hashes)) {
    const scene = Projection.build(project(id)), sheets = Drawing.createSheets(scene, options());
    assert.equal(sheets.length, 1);
    assert.equal(digest(JSON.stringify(sheets[0])), hash);
    assert.deepEqual(Drawing.createSheet(scene, options()), sheets[0]);
  }
});

test('additive continuation API is discoverable without changing old enumerable exports or strict options', () => {
  assert.equal(typeof Drawing.createSheets, 'function');
  assert.ok(Object.isFrozen(Drawing));
  assert.ok(Object.getOwnPropertyNames(Drawing).includes('createSheets'));
  assert.deepEqual(Object.keys(Drawing).sort(), ['PAPER_SIZES', 'createSheet', 'toSVG', 'validateSheet'].sort());
  for (const key of ['paginate', 'maxPages', 'continuation', 'allowPagination']) {
    assert.throws(() => Drawing.createSheets(dense(), options({ [key]: true })), /options/);
  }
});

for (const [paper, orientation] of [['A4', 'portrait'], ['A3', 'landscape'], ['A2', 'landscape']]) {
  test(`${paper} retains fixed geometry while paginating every assumption exactly once`, async () => {
    const opts = options({ paper, orientation }), scene = dense(), before = JSON.stringify(scene);
    const base = Drawing.createSheet(Projection.build(project()), opts);
    const sheets = Drawing.createSheets(scene, opts);
    assert.ok(sheets.length > 1);
    assert.throws(() => Drawing.createSheet(scene, opts), /use createSheets.*all notes/);
    assert.equal(JSON.stringify(scene), before);
    assert.deepEqual(sheets[0].primitives.filter(p => p.type === 'path'), base.primitives.filter(p => p.type === 'path'));
    const plot = sheets[0].primitives.find(p => p.type === 'path' && p.strokeWidthMm === .28);
    assert.equal(plot.commands[1][1] - plot.commands[0][1], 100, '10m at 1:100 stays 100mm');
    for (const [i, sheet] of sheets.entries()) {
      for (const field of ['projectId', 'revision', 'floorId', 'floorName', 'paper', 'orientation', 'scaleDenominator', 'units'])
        assert.equal(sheet.metadata[field], base.metadata[field]);
      if (i) assert.match(sheet.metadata.title, /ASSUMPTIONS/);
    }
    assert.ok(sheets[0].primitives.some(p => p.text?.startsWith('ASSUMPTIONS CONTINUE')));
    checkNotes(sheets);
    const doc = await PDF.PDFDocument.load(await Export.pdfBytes(sheets));
    assert.equal(doc.getPageCount(), sheets.length);
    assert.ok(Math.abs(doc.getPage(0).getWidth() - base.widthMm * 72 / 25.4) < 1e-7);
  });
}

test('long namespaced unresolved IDs wrap readably without changing unknown model inputs', () => {
  const p = project(), id = 'ground:authored:unresolved-' + 'identifier'.repeat(220);
  p.floors[0].authored = Model.emptyAuthored();
  p.floors[0].authored.annotations.push({ id, text: 'Position is unknown', anchor: null });
  const scene = Projection.build(p), before = JSON.stringify(scene);
  const sheets = Drawing.createSheets(scene, options({ paper: 'A4', orientation: 'portrait', units: 'imperial', floorName: 'Ground / shared namespace' }));
  assert.ok(sheets.length > 1);
  checkNotes(sheets);
  assert.ok(sheets[0].metadata.assumptions.some(n => n.includes(id)));
  assert.ok(compact(noteText(sheets).join('')).includes(id));
  assert.ok(sheets.every(s => s.metadata.revision === 0 && s.metadata.floorId === 'ground' && s.metadata.units === 'imperial'));
  assert.equal(scene.authored[0].record.anchor, null);
  assert.equal(JSON.stringify(scene), before);
});

test('metadata and renderer page budgets abort atomically, never truncate assumptions', () => {
  assert.throws(() => Drawing.createSheets(dense(210), options()), /assumptions/i);
  const huge = dense(65, 15000), before = digest(JSON.stringify(huge));
  assert.throws(() => Drawing.createSheets(huge, options({ paper: 'A4', orientation: 'portrait' })), /100-page.*no partial/);
  assert.equal(digest(JSON.stringify(huge)), before);
  const invalid = dense(); invalid.scenes[0].walls[0].thicknessM = -1;
  assert.throws(() => Drawing.createSheets(invalid, options()), /physical wall geometry/);
});

test('package flattens every architectural continuation and retains the shared atomic PDF bound', async () => {
  const scene = dense(), packet = Package.build(scene, { ...Package.defaults(), paper: 'A2' });
  const pages = packet.manifest.pages.filter(p => p.type === 'architecture');
  const expected = Drawing.createSheets(scene, options({ layers: { site: false } }));
  assert.equal(pages.length, expected.length);
  for (let i = 0; i < pages.length; i++) {
    assert.equal(pages[i].floorId, 'ground');
    assert.equal(pages[i].title, expected[i].metadata.title);
    assert.equal(pages[i].scaleDenominator, 100);
    assert.deepEqual(packet.sheets[pages[i].page - 1].metadata, expected[i].metadata);
  }
  const indexText = packet.manifest.pages.filter(p => p.type === 'index')
    .flatMap(p => packet.sheets[p.page - 1].primitives.filter(p => p.type === 'text').map(p => p.text)).join('');
  for (const p of pages) assert.ok(indexText.includes('PAGE ' + p.page + ' | architecture'));
  checkNotes(pages.map(p => packet.sheets[p.page - 1]));
  assert.equal((await PDF.PDFDocument.load(await Export.pdfBytes(packet.sheets))).getPageCount(), packet.sheets.length);
  await assert.rejects(Export.pdfBytes(Array.from({ length: 101 }, (_, i) => expected[i % expected.length])), /100/);
  const oversized = dense();
  oversized.documentation.sheets.push({ id: 'missing-views', number: 'A1', title: 'Required views',
    paper: 'A2', orientation: 'landscape', viewIds: Array.from({ length: 100 }, (_, i) => 'missing-' + i) });
  assert.throws(() => Package.build(oversized), /100-page/);
});

test('existing Drawing UI automatically selects architectural createSheets and exports all continuations', async () => {
  const p = project(), scene = dense();
  const planner = {
    getProject: () => p, getDrawingScene: () => scene,
    inputFingerprint: () => scene.inputFingerprint,
    subscribe: () => () => {}, execute() { throw Error('Must not edit unknown inputs'); }
  };
  let exported;
  const controller = UI.createController(planner, { Blob, HomePlannerDrawing: Drawing,
    HomePlannerDrawingExport: {
      ...Export, async pdfBytes(sheets) { exported = sheets; return Export.pdfBytes(sheets); }
    }
  });
  controller.setSettings({ paper: 'A2' });
  controller.refresh();
  assert.equal(controller.getState().error, '');
  const result = await controller.exportFiles('pdf');
  assert.ok(result);
  assert.equal(exported.length, Drawing.createSheets(scene, options()).length);
  assert.ok(exported.length > 1);
  checkNotes(exported);
  controller.dispose();
});

const browserFixture = process.env.HOMEPLANNER_PHASE10_FIXTURE;
test('unchanged original browser-review fixture builds A2 package, all notes, index and real PDF',
  { skip: browserFixture ? false : 'Set HOMEPLANNER_PHASE10_FIXTURE to the original browser-review JSON artifact.' }, async () => {
    const raw = fs.readFileSync(browserFixture, 'utf8');
    assert.equal(digest(raw), 'd25cfbc066492957bce81dbd358218fbb0bc2e5194cd9c23f2ab7696b0e232bf');
    const bridge = controllerFor(JSON.parse(raw)), scene = bridge.getDrawingScene(), before = JSON.stringify(scene);
    assert.throws(() => Drawing.createSheet(scene, options({ layers: { site: false } })), /use createSheets/);
    const packet = Package.build(scene, { ...Package.defaults(), paper: 'A2' });
    const architectural = packet.manifest.pages.filter(p => p.type === 'architecture');
    assert.equal(architectural.length, 3);
    for (const floor of scene.scenes) checkNotes(architectural.filter(p => p.floorId === floor.floorId).map(p => packet.sheets[p.page - 1]));
    packet.sheets.forEach(Drawing.validateSheet);
    assert.equal((await PDF.PDFDocument.load(await Export.pdfBytes(packet.sheets))).getPageCount(), packet.sheets.length);
    assert.equal(JSON.stringify(scene), before);
    assert.equal(fs.readFileSync(browserFixture, 'utf8'), raw);
    assert.equal(bridge.getProject().floors[0].authored.structural[0].widthM, null);
  });
