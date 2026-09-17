const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Package = require('../planner-package.js');
const Projection = require('../planner-projection.js');
const Model = require('../planner-model.js');
const Drawing = require('../planner-drawing.js');
const Airflow = require('../planner-airflow.js');
const Light = require('../planner-light.js');
const Export = require('../planner-drawing-export.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const settings = extra => ({ ...Package.defaults(), ...extra });
function project(id = 'furnished-single') {
  const p = createFixture(id).project;
  for (const f of p.floors) if (f.legacy.context) f.legacy.context.plate.sitePlot = { x: 0, y: 0, w: 10, h: 8 };
  p.legacy = copy(p.floors[0].legacy);
  return p;
}
const drawing = id => Projection.build(project(id));
const texts = sheets => sheets.flatMap(s => s.primitives.filter(p => p.type === 'text').map(p => p.text));
function frozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
function air(scene) {
  const inventory = Airflow.discover(scene);
  return Airflow.run(scene, { version: 1, id: 'closed-room', densityKgM3: 1.2,
    zones: [{ id: 'room', room: inventory.rooms[0].ref, volumeM3: 30, volumeSource: 'explicit analytical volume' }], links: [] });
}
function light(scene, unknown = false) {
  const inventory = Light.discover(scene);
  const period = { startUTC: '2026-09-15T06:00:00Z', endUTC: '2026-09-15T07:00:00Z' };
  return Light.run(scene, { version: 1, id: 'tiny-study',
    workplanes: [{ id: 'plane', room: inventory.rooms[0].ref, heightM: 1, spacingM: 20 }],
    sky: { enabled: true, radialBands: 1, azimuthSectors: 4 },
    windowOptics: { mode: 'ideal-clear' },
    neighbors: Object.fromEntries(['front', 'right', 'rear', 'left'].map(s => [s, { state: unknown ? 'unknown' : 'clear' }])),
    neighborBoxes: [], roofContext: [],
    minSunAltitudeDeg: 1, period,
    samples: [{ ...period, sampleUTC: '2026-09-15T06:30:00Z', sunENU: { east: 0, north: 0, up: 1 } }]
  });
}

test('exact browser/CommonJS API, frozen deterministic output and revision zero without mutation', () => {
  assert.deepEqual(Object.keys(Package).sort(), ['build', 'defaults', 'normalizeSettings']);
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-package.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HomePlannerPackage).sort(), Object.keys(Package).sort());
  const p = project(), bridge = controllerFor(p), scene = bridge.getDrawingScene(), before = JSON.stringify(scene);
  const result = Package.build(scene), again = Package.build(scene);
  assert.deepEqual(result, again); frozen(result);
  assert.deepEqual(Object.keys(result).sort(), ['attachments', 'findings', 'manifest', 'sheets', 'version']);
  assert.equal(result.manifest.source.revision, 0);
  assert.equal(result.manifest.source.inputFingerprint, scene.inputFingerprint);
  assert.equal(result.manifest.source.drawingSceneFingerprint, Model.stableStringify(scene));
  assert.equal(JSON.stringify(scene), before);
  result.sheets.forEach(s => assert.equal(Drawing.validateSheet(s), s));
  assert.match(texts(result.sheets).join(' '), /NOT CERTIFIED - NOT ENGINEERED/);
});

test('A2 imperial fixed scale survives shared PDF export with physical pages', async () => {
  const result = Package.build(drawing('sparse-unknown'), settings({ paper: 'A2', scaleDenominator: 75, units: 'imperial' }));
  const bytes = await Export.pdfBytes(result.sheets);
  const pdf = await PDF.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), result.sheets.length);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 594 * 72 / 25.4) < 1e-7);
    assert.ok(Math.abs(page.getHeight() - 420 * 72 / 25.4) < 1e-7);
  }
  result.manifest.pages.forEach(p => { assert.equal(p.scaleDenominator, 75); assert.equal(p.widthMm, 594); });
  assert.match(texts(result.sheets).join(' '), /ft/);
});

test('classic scripts assemble in the documented browser dependency order', () => {
  const context = vm.createContext({});
  for (const file of ['planner-features', 'planner-model', 'electrical-planner', 'planner-projection',
    'building-physics', 'planner-drawing', 'planner-elevation', 'planner-structure', 'planner-structure-drawing',
    'planner-services', 'planner-services-drawing', 'planner-drainage', 'planner-drainage-drawing',
    'planner-airflow', 'planner-light', 'planner-package']) {
    vm.runInContext(fs.readFileSync(require.resolve('../' + file + '.js'), 'utf8'), context);
  }
  const source = JSON.stringify(drawing('sparse-unknown'));
  vm.runInContext('packet = HomePlannerPackage.build(' + source + ');', context);
  assert.deepEqual(copy(context.packet), Package.build(JSON.parse(source)));
});

test('site contains true boundary and building/floor plates, not a renamed architecture page', () => {
  const scene = drawing(), result = Package.build(scene);
  const site = result.sheets[result.manifest.pages.findIndex(p => p.type === 'site')];
  assert.ok(site.primitives.some(p => p.type === 'path' && p.stroke === '#245A81'));
  assert.equal(site.primitives.some(p => p.fill === '#354047'), false);
  const boundary = site.primitives.find(p => p.type === 'path');
  assert.equal(boundary.commands[1][1] - boundary.commands[0][1], scene.scenes[0].plot.w * 10);
  assert.match(texts([site]).join(' '), /datum elevation \(m\): unknown/);
});

test('all canonical floors including missing geometry and registration get explicit indexed slots', () => {
  const p = project('multiple-floors');
  p.floors[1].legacy.context = null;
  p.documentation = { version: 1, views: [{ id: 'missing-elevation', name: 'Upper', kind: 'elevation',
    floorId: 'upper', scaleDenominator: 100, direction: 'N', cut: [] }],
  sheets: [{ id: 'sheet', number: 'A1', title: 'Saved', paper: 'A3', orientation: 'landscape', viewIds: ['lost-view'] }] };
  const result = Package.build(Projection.build(p));
  assert.deepEqual(result.manifest.floorIds, ['ground', 'upper']);
  for (const type of ['architecture', 'structure', 'plumbing-plan', 'plumbing-riser', 'drainage-plan', 'drainage-profile']) {
    const page = result.manifest.pages.find(p => p.type === type && p.floorId === 'upper');
    assert.equal(page.status, 'unavailable');
    assert.ok(page.findingIds.length);
  }
  assert.equal(result.manifest.pages.find(p => p.viewId === 'missing-elevation').status, 'unavailable');
  assert.equal(result.manifest.pages.find(p => p.viewId === 'lost-view').status, 'unavailable');
  assert.equal(result.manifest.analyses.airflow.status, 'unavailable');
  assert.equal(result.manifest.analyses.light.status, 'unavailable');
  const unregistered = Package.build(Projection.build(createFixture('multiple-floors').project));
  assert.equal(unregistered.manifest.pages.filter(p => p.type === 'architecture' && p.status === 'unavailable').length, 2);
});

test('hard geometry errors and fixed-scale renderer overflow abort rather than disappear', () => {
  const scene = copy(drawing());
  scene.diagnostics.push({ code: 'invalid-geometry', ownerId: 'ground', message: 'real failure' });
  assert.throws(() => Package.build(scene), /real failure/);
  const malformed = copy(drawing()); malformed.scenes[0].walls[0].thicknessM = -1;
  assert.throws(() => Package.build(malformed), /geometry|thickness|dimension/i);
  const huge = copy(drawing()); huge.scenes[0].plot.w = 999;
  assert.throws(() => Package.build(huge), /fit/);
});

test('saved elevations flatten every shared renderer page and retain their own scale', () => {
  const p = project('sparse-unknown');
  p.documentation = { version: 1, views: [{ id: 'north', name: 'North elevation', kind: 'elevation',
    floorId: 'ground', scaleDenominator: 75, direction: 'N', cut: [] }], sheets: [] };
  const scene = Projection.build(p), result = Package.build(scene, settings({ paper: 'A2' }));
  const expected = require('../planner-elevation.js').createSheets(scene, { viewId: 'north', paper: 'A2',
    orientation: 'landscape', scaleDenominator: 75, units: 'metric' });
  const pages = result.manifest.pages.filter(p => p.viewId === 'north');
  assert.equal(pages.length, expected.length);
  pages.forEach(p => assert.equal(p.scaleDenominator, 75));
  assert.equal(result.manifest.pages.find(p => p.type === 'architecture').scaleDenominator, 100);
});

test('saved sections and object-linked source findings are retained without inferred IDs', () => {
  const p = project('sparse-unknown');
  p.documentation = { version: 1, views: [{ id: 'section', name: 'Section',
    kind: 'section', floorId: 'ground', scaleDenominator: 100, direction: null,
    cut: [{ kind: 'point', floorId: 'ground', point: { x: 0, y: 4, z: 0 } },
      { kind: 'point', floorId: 'ground', point: { x: 10, y: 4, z: 0 } }] }], sheets: [] };
  p.floors[0].authored = Model.emptyAuthored();
  p.floors[0].authored.structural.push({ id: 'ground:authored:column', kind: 'column', anchors: [null],
    widthM: null, depthM: null, material: null });
  const result = Package.build(Projection.build(p), settings({ paper: 'A2' }));
  assert.ok(result.manifest.pages.some(p => p.type === 'section' && p.viewId === 'section' && p.status === 'available'));
  const linked = result.findings.filter(f => f.entityId === 'ground:authored:column');
  assert.ok(linked.length);
  assert.ok(linked.every(f => f.floorId === 'ground'));
  assert.ok(linked.some(f => f.reference?.floorId === 'ground' && f.reference.entityId === f.entityId));
  assert.ok(result.findings.some(f => f.code === 'engineering-not-assessed' && f.entityId === null));
});

test('electrical schedules preserve every record, exact projected points, bad anchors and long text', () => {
  const p = project(), prefix = 'ground:electrical:';
  p.electrical = [
    { id: prefix + 'bad', type: 'socket', label: 'A'.repeat(900), purpose: 'B'.repeat(800),
      elevationM: null, elevationReference: 'plate-centre', anchor: { kind: 'wall', wallId: 'missing', offsetM: 1 } },
    { id: prefix + 'light', type: 'light', label: 'Ceiling', purpose: 'Intent', elevationM: 2.8,
      elevationReference: 'mounting-point', anchor: { kind: 'ceiling', x: 2, y: 2 } }
  ];
  p.floors[0].electrical = copy(p.electrical);
  const scene = Projection.build(p), result = Package.build(scene);
  assert.equal(result.manifest.electrical.length, 2);
  assert.equal(result.manifest.electrical[0].heightM, null);
  assert.equal(result.manifest.electrical[1].heightM, 2.8);
  result.manifest.electrical.forEach((r, i) => assert.deepEqual(r.point, scene.scenes[0].electrical[i].resolvedPoint));
  assert.equal(result.manifest.electrical[0].label.length, 900);
  const tables = result.manifest.pages.filter(p => p.type === 'electrical').map(p => result.sheets[p.page - 1]);
  assert.ok(texts(tables).every(t => t.length <= 200));
  tables.forEach(Drawing.validateSheet);
  assert.ok(result.findings.some(f => f.entityId === prefix + 'bad' && f.floorId === 'ground'));
});

test('original converged evidence and configuration are exact JSON sidecars without running analysis', () => {
  const scene = drawing(), airflow = air(scene), lighting = light(scene);
  assert.equal(airflow.status, 'converged');
  assert.equal(lighting.status, 'complete');
  const result = Package.build(scene, settings(), { airflow, light: lighting });
  assert.equal(result.manifest.analyses.airflow.status, 'converged');
  assert.equal(result.manifest.analyses.light.status, 'complete');
  assert.deepEqual(JSON.parse(result.attachments.find(a => a.fileName === 'airflow-evidence.json').content), airflow);
  assert.deepEqual(JSON.parse(result.attachments.find(a => a.fileName === 'light-evidence.json').content), lighting);
  assert.deepEqual(result.manifest.analyses.airflow.originalProvenance, airflow.provenance);
  assert.ok(result.attachments.every(a => a.mime === 'application/json'));
});

test('source identity, physical mutation at identical revision and forged configuration invalidate analysis', () => {
  const scene = drawing(), airflow = air(scene), lighting = light(scene);
  const changed = copy(scene);
  changed.scenes[0].headingDeg = 10;
  const result = Package.build(changed, settings(), { airflow, light: lighting });
  assert.equal(result.manifest.analyses.airflow.status, 'unavailable');
  assert.equal(result.manifest.analyses.light.status, 'unavailable');
  assert.match(result.manifest.analyses.airflow.reason, /physical/);
  assert.notEqual(result.manifest.source.drawingSceneFingerprint, Model.stableStringify(scene));
  assert.equal(result.manifest.source.inputFingerprint, scene.inputFingerprint);
  const other = copy(scene); other.projectId = 'other-project';
  assert.match(Package.build(other, settings(), { airflow }).manifest.analyses.airflow.reason, /project identity/);
  const forged = copy(airflow); forged.scenario.densityKgM3 = 1.1;
  assert.match(Package.build(scene, settings(), { airflow: forged }).manifest.analyses.airflow.reason, /configuration/);
  const missing = copy(lighting); delete missing.direct.sensorResults[0].transmittedEquivalentSunHours;
  assert.match(Package.build(scene, settings(), { light: missing }).manifest.analyses.light.reason, /malformed/);
});

test('same physical inputs at another revision are accepted with original revision and explicit warning', () => {
  const scene = drawing(), airflow = air(scene);
  const current = copy(scene); current.revision = 6;
  const result = Package.build(current, settings(), { airflow });
  assert.equal(result.manifest.analyses.airflow.status, 'converged');
  assert.equal(result.manifest.analyses.airflow.samePhysicalOtherRevision, true);
  assert.equal(result.manifest.analyses.airflow.originalProvenance.revision, 0);
  assert.ok(result.findings.some(f => f.code === 'same-physical-other-revision'));
});

test('cancelled/malformed/nonconverged evidence is unavailable; unknown light context stays model-only', () => {
  const scene = drawing(), airflow = copy(air(scene)), cancelled = copy(light(scene));
  airflow.status = 'nonconverged'; airflow.balanced = false; airflow.solver.converged = false;
  cancelled.status = 'cancelled';
  const result = Package.build(scene, settings(), { airflow, light: cancelled });
  assert.match(result.manifest.analyses.airflow.reason, /nonconverged/);
  assert.match(result.manifest.analyses.light.reason, /cancelled/);
  assert.equal(result.manifest.pages.find(p => p.type === 'airflow').status, 'unavailable');
  const unknown = light(scene, true);
  assert.equal(unknown.computationalComplete, true); assert.equal(unknown.status, 'incomplete');
  const modelOnly = Package.build(scene, settings(), { light: unknown });
  assert.equal(modelOnly.manifest.analyses.light.status, 'incomplete');
  assert.equal(JSON.parse(modelOnly.attachments[0].content).sky.sensorResults[0].cosineWeightedSkyAccess, null);
  assert.match(texts(modelOnly.sheets).join(' '), /Model-only values are NOT validated context/);
  const incomplete = copy(unknown); incomplete.computationalComplete = false;
  assert.equal(Package.build(scene, settings(), { light: incomplete }).manifest.analyses.light.status, 'unavailable');
  const malformed = { kind: 'AirflowResult', version: 1 };
  assert.match(Package.build(scene, settings(), { airflow: malformed }).manifest.analyses.airflow.reason, /malformed/);
});

test('complete multipage index accounts for all continuations with contiguous one-based numbers', () => {
  const p = project('multiple-floors');
  p.documentation = { version: 1, views: [], sheets: [{ id: 'saved', number: 'S', title: 'Saved',
    paper: 'A3', orientation: 'landscape',
    viewIds: Array.from({ length: 12 }, (_, i) => 'missing-' + i + '-' + 'x'.repeat(180)) }] };
  const result = Package.build(Projection.build(p));
  const index = result.manifest.pages.filter(p => p.type === 'index');
  assert.ok(index.length > 1);
  const joined = texts(index.map(p => result.sheets[p.page - 1])).join('');
  assert.deepEqual(result.manifest.pages.map(p => p.page), Array.from({ length: result.sheets.length }, (_, i) => i + 1));
  for (const page of result.manifest.pages) assert.ok(joined.includes('PAGE ' + page.page + ' |'), 'missing indexed page ' + page.page);
  assert.ok(result.manifest.pages.filter(p => p.type === 'plumbing-plan').length > 2);
  assert.ok(result.findings.every(f => ['id', 'code', 'message', 'floorId', 'entityId', 'discipline', 'severity'].every(k => Object.hasOwn(f, k))));
});

test('100-page bound is atomic, never returns an early partial package', () => {
  const p = project('missing-context');
  p.documentation = { version: 1, views: Array.from({ length: 100 }, (_, i) => ({
    id: 'view-' + i, name: 'Missing ' + i, floorId: 'ground', kind: 'elevation', direction: 'N', cut: [], scaleDenominator: 100
  })), sheets: [] };
  const scene = Projection.build(p), before = JSON.stringify(scene);
  assert.throws(() => Package.build(scene), /100-page/);
  assert.equal(JSON.stringify(scene), before);
});

test('the exact 100-page inclusive limit remains exportable and fully indexed', async () => {
  const p = project('missing-context');
  p.documentation = { version: 1, views: Array.from({ length: 78 }, (_, i) => ({
    id: 'view-' + i, name: 'Missing ' + i, floorId: 'ground', kind: 'elevation',
    direction: 'N', cut: [], scaleDenominator: 100
  })), sheets: [] };
  const result = Package.build(Projection.build(p));
  assert.equal(result.sheets.length, 100);
  assert.equal(result.manifest.pages[99].page, 100);
  const bytes = await Export.pdfBytes(result.sheets);
  assert.equal((await PDF.PDFDocument.load(bytes)).getPageCount(), 100);
});

test('Unicode is preserved in shared sheets and PDF rejects unsupported glyphs explicitly', async () => {
  const result = Package.build(drawing('sparse-unknown'), settings({ title: '測試' }));
  assert.match(texts(result.sheets).join(''), /測試/);
  await assert.rejects(Export.pdfBytes(result.sheets), /Unicode|font|WinAnsi|glyph|encode/i);
});
