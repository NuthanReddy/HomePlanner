const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../planner-drawing-ui.js');
const Workspace = require('../planner-workspace.js');

function setup() {
  let project = { id: 'project-one', revision: 7, name: 'House', activeFloorId: 'ground',
    floors: [{ id: 'ground', name: 'Ground' }, { id: 'upper', name: 'Upper' }] };
  const listeners = new Set(), calls = [], captures = [];
  const planner = {
    getProject: () => project,
    inputFingerprint: () => JSON.stringify({ name: project.name, floors: project.floors, documentation: project.documentation }),
    getDrawingScene() {
      const scene = Object.freeze({ projectId: project.id, revision: project.revision, scenes: [], documentation: project.documentation });
      captures.push(scene); return scene;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    execute() { throw new Error('UI must never edit the model'); }
  };
  const runtime = {
    Blob,
    HomePlannerDrawing: {
      createSheet(scene, options) {
        calls.push({ scene, options });
        return { version: 1, widthMm: 420, heightMm: 297, primitives: [],
          metadata: { ...options, projectId: scene.projectId, revision: scene.revision, assumptions: ['Schematic only'] } };
      },
      toSVG: sheet => `<svg xmlns="http://www.w3.org/2000/svg"><text>${sheet.metadata.floorId}</text></svg>`,
      validateSheet: () => true
    },
    HomePlannerDrawingExport: {
      pdfBytes: async () => new Uint8Array([37, 80, 68, 70]),
      pngBlob: async () => new Blob(['png'], { type: 'image/png' })
    }
  };
  const controller = UI.createController(planner, runtime);
  return { controller, planner, runtime, calls, captures, listeners,
    change(patch, emit = true) { project = { ...project, ...patch }; if (emit) listeners.forEach(fn => fn({ type: 'project', project })); } };
}

test('Report defaults to Drawings and preserves all schedule/export deep links', () => {
  assert.equal(Workspace.normalizeRoute('report').section, 'drawings');
  for (const [section, view] of [['drawings', 'drawings'], ['schedules', 'schedules'], ['electrical', 'electrical-schedule'], ['exports', 'env-exports']])
    assert.equal(Workspace.viewFor(`report/${section}`), view);
});

test('defaults are fixed-scale A3 landscape metric; preview uses current floor and no editing', () => {
  const { controller, calls, captures, planner } = setup();
  const before = JSON.stringify(planner.getProject());
  controller.refresh();
  assert.equal(captures.length, 1);
  assert.equal(calls[0].scene, captures[0]);
  assert.equal(calls[0].options.floorId, 'ground');
  assert.equal(calls[0].options.paper, 'A3');
  assert.equal(calls[0].options.orientation, 'landscape');
  assert.equal(calls[0].options.scaleDenominator, 100);
  assert.equal(calls[0].options.units, 'metric');
  assert.equal(JSON.stringify(planner.getProject()), before);
  assert.ok(controller.getState().preview);
});

test('all-floor PDF builds every page from exactly one captured revision without switching floors', async () => {
  const { controller, runtime, captures, calls, planner } = setup();
  let pages;
  runtime.HomePlannerDrawingExport.pdfBytes = async value => { pages = value; return new Uint8Array([1]); };
  controller.setSettings({ scope: 'all', floorId: 'upper', title: 'Issued reference', paper: 'A2', units: 'imperial' });
  const result = await controller.exportFiles('pdf');
  assert.equal(captures.length, 1);
  assert.equal(pages.length, 2);
  assert.ok(calls.every(call => call.scene === captures[0]));
  assert.deepEqual(calls.map(call => call.options.floorId), ['ground', 'upper']);
  assert.ok(pages.every(page => page.metadata.title === 'Issued reference' && page.metadata.revision === 7));
  assert.equal(planner.getProject().activeFloorId, 'ground');
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].blob.type, 'application/pdf');
  assert.match(result.outputs[0].name, /all-floors-r7\.drawing\.pdf$/);
  assert.equal(result.isCurrent(), true);
});

for (const format of ['svg', 'png']) test(`all-floor ${format} supplies distinct explicit per-floor files`, async () => {
  const { controller, captures } = setup();
  controller.setSettings({ scope: 'all' });
  const result = await controller.exportFiles(format);
  assert.equal(captures.length, 1);
  assert.equal(result.outputs.length, 2);
  assert.notEqual(result.outputs[0].name, result.outputs[1].name);
  assert.match(result.outputs[0].name, new RegExp(`\\.drawing\\.${format}$`));
  assert.match(controller.getState().message, /Choose each floor link/);
});

for (const event of ['revision', 'project', 'settings']) test(`${event} changes cancel pending export without publishing stale files`, async () => {
  const { controller, runtime, change } = setup();
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const pending = controller.exportFiles('pdf');
  assert.equal(controller.getState().busy, true);
  if (event === 'revision') change({ revision: 8 });
  else if (event === 'project') change({ id: 'different-project' });
  else controller.setSettings({ paper: 'A4' });
  complete(new Uint8Array([1]));
  assert.equal(await pending, null);
  assert.equal(controller.getState().outputs.length, 0);
  assert.equal(controller.getState().stale, true);
  assert.equal(controller.getState().busy, false);
});

test('live identity guard catches changes even when subscription is not emitted', async () => {
  const { controller, runtime, change } = setup();
  runtime.HomePlannerDrawingExport.pdfBytes = async () => {
    change({ revision: 8 }, false); return new Uint8Array([1]);
  };
  assert.equal(await controller.exportFiles('pdf'), null);
  assert.equal(controller.getState().outputs.length, 0);
});

test('completed result becomes unusable after edits; navigation alone preserves all-floor snapshots', async () => {
  const { controller, change } = setup();
  controller.setSettings({ scope: 'all' });
  const result = await controller.exportFiles('svg');
  change({ activeFloorId: 'upper' });
  assert.equal(result.isCurrent(), true);
  change({ revision: 8 });
  assert.equal(result.isCurrent(), false);
  assert.equal(controller.isCurrent(), false);
});

test('current-floor navigation invalidates preview while preserving view-only title and paper', () => {
  const { controller, change } = setup();
  controller.setSettings({ title: 'My title', paper: 'A2' });
  controller.refresh();
  change({ activeFloorId: 'upper' });
  assert.equal(controller.getState().preview, null);
  assert.equal(controller.getState().settings.title, 'My title');
  assert.equal(controller.getState().settings.paper, 'A2');
  controller.refresh();
  assert.equal(controller.getState().preview.sheet.metadata.floorId, 'upper');
});

test('project settings are isolated and restored when returning to a project', () => {
  const { controller, change } = setup();
  controller.setSettings({ title: 'Project A', paper: 'A2' });
  change({ id: 'project-two' });
  assert.equal(controller.getState().settings.title, '');
  controller.setSettings({ title: 'Project B' });
  change({ id: 'project-one' });
  assert.equal(controller.getState().settings.title, 'Project A');
  assert.equal(controller.getState().settings.paper, 'A2');
});

test('missing runtimes and fixed-scale fit failures show explicit errors, never dummy previews', async () => {
  const { controller, runtime, calls } = setup();
  const renderer = runtime.HomePlannerDrawing;
  delete runtime.HomePlannerDrawing;
  assert.equal(controller.refresh(), null);
  assert.match(controller.getState().error, /renderer unavailable or still loading/);
  runtime.HomePlannerDrawing = renderer;
  delete runtime.HomePlannerDrawingExport;
  assert.equal(await controller.exportFiles('png'), null);
  assert.match(controller.getState().error, /PNG exporter unavailable/);
  renderer.createSheet = () => { throw new Error('Fixed scale does not fit paper'); };
  const callsBefore = calls.length;
  assert.equal(controller.refresh(), null);
  assert.match(controller.getState().error, /does not fit/);
  assert.match(controller.getState().message, /never shrunk automatically/);
  assert.equal(controller.getState().settings.scaleDenominator, 100);
  assert.equal(calls.length, callsBefore);
});

test('invalid settings reject atomically; title remains literal metadata and oversized SVG is rejected', () => {
  const { controller, runtime } = setup();
  assert.throws(() => controller.setSettings({ paper: 'A0' }), /Unsupported/);
  assert.throws(() => controller.setSettings({ title: 'bad\nname' }), /Sheet title/);
  assert.throws(() => controller.setSettings({ layers: { secret: true } }), /layers/);
  controller.setSettings({ title: '<script>alert(1)</script>' });
  controller.refresh();
  assert.equal(controller.getState().preview.sheet.metadata.title, '<script>alert(1)</script>');
  runtime.HomePlannerDrawing.toSVG = () => 'x'.repeat(20 * 1024 * 1024 + 1);
  assert.equal(controller.refresh(), null);
  assert.match(controller.getState().error, /preview limit/);
});

test('failed later PNG page does not publish a partial all-floor set', async () => {
  const { controller, runtime } = setup();
  controller.setSettings({ scope: 'all' });
  let count = 0;
  runtime.HomePlannerDrawingExport.pngBlob = async () => {
    if (++count === 2) throw new Error('Raster limit exceeded');
    return new Blob(['png']);
  };
  assert.equal(await controller.exportFiles('png'), null);
  assert.equal(controller.getState().outputs.length, 0);
  assert.match(controller.getState().error, /Raster limit/);
});

test('disposal cancels in-flight output and unsubscribes', async () => {
  const { controller, runtime, listeners } = setup();
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const pending = controller.exportFiles('pdf');
  controller.dispose(); complete(new Uint8Array([1]));
  assert.equal(await pending, null);
  assert.equal(listeners.size, 0);
});

test('a superseded async export cannot overwrite a newer completed export', async () => {
  const { controller, runtime } = setup();
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const old = controller.exportFiles('pdf');
  const current = await controller.exportFiles('svg');
  complete(new Uint8Array([1]));
  assert.equal(await old, null);
  assert.equal(current.isCurrent(), true);
  assert.equal(controller.getState().outputs[0].blob.type, 'image/svg+xml;charset=utf-8');
});

test('real foundation and sheet renderer export the registered setback plot without project edits', async () => {
  const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
  const planner = controllerFor(createFixture('setback-plot').project);
  const controller = UI.createController(planner, { Blob, HomePlannerDrawing: require('../planner-drawing.js') });
  const before = JSON.stringify(planner.getProject());
  controller.setSettings({ paper: 'A2', scope: 'all', title: 'Reference <sheet> & dimensions' });
  assert.ok(controller.refresh(), controller.getState().error);
  const result = await controller.exportFiles('svg');
  assert.ok(result, controller.getState().error);
  const svg = await result.outputs[0].blob.text();
  assert.match(svg, /<svg/);
  assert.match(svg, /Reference &lt;sheet&gt; &amp; dimensions/);
  assert.equal(JSON.stringify(planner.getProject()), before);
  controller.dispose();
});

function realSetup(fixture = 'setback-plot', subscribed = true) {
  const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
  const planner = controllerFor(typeof fixture === 'string' ? createFixture(fixture).project : fixture);
  let fingerprints = 0;
  const runtime = { Blob, HomePlannerDrawing: require('../planner-drawing.js') };
  const controller = UI.createController({
    ...planner,
    inputFingerprint() { fingerprints++; return planner.inputFingerprint(); },
    subscribe: subscribed ? planner.subscribe : undefined
  }, runtime);
  controller.setSettings({ paper: 'A2', scope: 'all' });
  return { planner, controller, runtime, fingerprintCount: () => fingerprints };
}

function replaceRoom(planner, method = 'replaceProject') {
  const project = JSON.parse(JSON.stringify(planner.getProject()));
  project.legacy.context.plan.placed[0].req.label = 'REPLACED ROOM';
  planner[method](method === 'importProject' ? JSON.stringify(project) : project);
}

for (const method of ['replaceProject', 'importProject'])
  test(`real bridge ${method} invalidates same-ID/revision previews and completed SVG links`, async () => {
    const { planner, controller } = realSetup();
    const before = planner.getProject(), fingerprint = planner.inputFingerprint();
    assert.ok(controller.refresh(), controller.getState().error);
    const result = await controller.exportFiles('svg');
    assert.ok(result, controller.getState().error);
    assert.doesNotMatch(await result.outputs[0].blob.text(), /REPLACED ROOM/);
    let notifications = 0;
    controller.subscribe(() => { notifications++; });
    replaceRoom(planner, method);
    assert.equal(planner.getProject().id, before.id);
    assert.equal(planner.getProject().revision, before.revision);
    assert.notEqual(planner.inputFingerprint(), fingerprint);
    assert.ok(notifications > 0);
    assert.equal(controller.getState().preview, null);
    assert.deepEqual(controller.getState().outputs, []);
    assert.equal(result.isCurrent(), false);
    assert.equal(controller.isCurrent(), false);
    const fresh = await controller.exportFiles('svg');
    assert.ok(fresh, controller.getState().error);
    assert.match(await fresh.outputs[0].blob.text(), /REPLACED ROOM/);
    assert.equal(fresh.isCurrent(), true);
    controller.dispose();
  });

for (const subscribed of [true, false])
  test(`real bridge same-identity replacement cancels in-flight PDF (subscription ${subscribed})`, async () => {
    const { planner, controller, runtime } = realSetup('setback-plot', subscribed);
    let complete;
    runtime.HomePlannerDrawingExport = {
      pdfBytes: () => new Promise(resolve => { complete = resolve; })
    };
    const pending = controller.exportFiles('pdf');
    assert.equal(controller.getState().busy, true);
    replaceRoom(planner);
    complete(new Uint8Array([1]));
    assert.equal(await pending, null);
    assert.deepEqual(controller.getState().outputs, []);
    assert.equal(controller.getState().busy, false);
    assert.equal(controller.getState().stale, true);
    controller.dispose();
  });

test('real bridge canonical navigation and same-content replacement preserve all-floor outputs', async () => {
  const project = require('./fixtures/drawing-fixtures.cjs').createFixture('setback-plot').project;
  project.floors.push({ ...JSON.parse(JSON.stringify(project.floors[0])), id: 'upper', name: 'Upper' });
  const { planner, controller, fingerprintCount } = realSetup(project);
  const result = await controller.exportFiles('svg');
  assert.ok(result, controller.getState().error);
  const before = fingerprintCount();
  for (let index = 0; index < 5; index++) {
    assert.equal(result.isCurrent(), true);
    assert.equal(controller.isCurrent(), true);
  }
  planner.select({ kind: 'room', id: 'ground:living' });
  assert.equal(fingerprintCount(), before, 'unchanged frozen project must reuse the cached fingerprint');
  const fingerprint = planner.inputFingerprint();
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(planner.inputFingerprint(), fingerprint);
  assert.equal(result.isCurrent(), true);
  assert.equal(fingerprintCount(), before + 1);
  planner.importProject(planner.exportProject());
  assert.equal(result.isCurrent(), true);
  assert.equal(controller.isCurrent(), true);
  controller.setSettings({ scope: 'current' });
  assert.ok(controller.refresh(), controller.getState().error);
  const current = await controller.exportFiles('svg');
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.equal(current.isCurrent(), false);
  assert.equal(controller.getState().preview, null);
  controller.dispose();
});

test('safe naming follows project export sanitization and includes floor/revision', () => {
  const name = UI.fileName('../CON\u202e', 'Ground/West', 7, 'svg');
  assert.doesNotMatch(name, /[<>:"/\\|?*\u202e]/);
  assert.match(name, /Ground-West-r7\.drawing\.svg$/);
  for (const format of ['pdf', 'svg', 'png'])
    assert.equal(UI.fileName('House', 'Ground', 0, format), `House-Ground-r0.drawing.${format}`);
});

test('classic runtime order and safe DOM APIs retain one drawing mount', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const html = read('index.html'), ui = read('planner-drawing-ui.js');
  assert.equal((html.match(/id="workspaceDrawings"/g) || []).length, 1);
  assert.ok(html.indexOf('src="planner-drawing.js"') < html.indexOf('src="planner-drawing-ui.js"'));
  assert.ok(html.indexOf('src="planner-drawing-export.js"') < html.indexOf('src="planner-drawing-ui.js"'));
  assert.doesNotMatch(ui, /\.innerHTML|insertAdjacentHTML|\.execute\(|select-floor|localStorage|fetch\(/);
  assert.match(ui, /revokeObjectURL/);
  assert.match(ui, /role', 'alert'/);
  assert.match(ui, /result\.isCurrent\(\)/);
});

test('discipline defaults architectural and structural dispatch uses the common sheet validator', () => {
  const { controller, runtime, captures, calls } = setup();
  assert.equal(controller.getState().settings.discipline, 'architectural');
  let structuralCalls = 0, validated = 0;
  runtime.HomePlannerStructureDrawing = {
    createSheet(scene, options) {
      structuralCalls++;
      assert.equal(scene, captures[0]);
      return { version: 1, metadata: { ...options, discipline: 'structural' } };
    }
  };
  runtime.HomePlannerDrawing.validateSheet = () => { validated++; return true; };
  controller.setSettings({ discipline: 'structural' });
  assert.ok(controller.refresh(), controller.getState().error);
  assert.equal(structuralCalls, 1);
  assert.equal(calls.length, 0);
  assert.equal(validated, 1);
  assert.equal(controller.getState().preview.sheet.metadata.discipline, 'structural');
  assert.throws(() => controller.setSettings({ discipline: 'engineering-certified' }), /Unsupported/);
  delete runtime.HomePlannerStructureDrawing;
  assert.equal(controller.refresh(), null);
  assert.match(controller.getState().error, /Structural drawing renderer unavailable/);
});

test('real structural current/all-floor PDF captures one graph and same-identity edits cancel publication', async () => {
  const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
  const doc = createFixture('multiple-floors').project;
  for (const floor of doc.floors) floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
  doc.legacy = JSON.parse(JSON.stringify(doc.floors[0].legacy));
  const Model = require('../planner-model.js');
  doc.floors[0].authored = Model.emptyAuthored();
  doc.floors[0].authored.structural = [{
    id: 'ground:authored:c1', kind: 'column',
    anchors: [{ kind: 'point', floorId: 'ground', point: { x: 2, y: 2, z: 0 } }],
    widthM: null, depthM: null, material: null
  }];
  const planner = controllerFor(doc), captures = [], scenes = [], batches = [];
  const structural = require('../planner-structure-drawing.js');
  const runtime = { Blob, HomePlannerDrawing: require('../planner-drawing.js'),
    HomePlannerStructureDrawing: { ...structural, createSheet(scene, options) {
      scenes.push(scene); return structural.createSheet(scene, options);
    }, createSheets(scene, options) {
      scenes.push(scene); return structural.createSheets ? structural.createSheets(scene, options) : [structural.createSheet(scene, options)];
    } },
    HomePlannerDrawingExport: { async pdfBytes(sheets) { batches.push(sheets); return new Uint8Array([37, 80, 68, 70]); } }
  };
  const controller = UI.createController({ ...planner, getDrawingScene() {
    const scene = planner.getDrawingScene(); captures.push(scene); return scene;
  } }, runtime);
  controller.setSettings({ discipline: 'structural', paper: 'A2' });
  const before = planner.exportProject();
  assert.ok(await controller.exportFiles('pdf'), controller.getState().error);
  assert.equal(batches[0].length, 1);
  controller.setSettings({ scope: 'all' });
  const all = await controller.exportFiles('pdf');
  assert.ok(all, controller.getState().error);
  assert.match(all.outputs[0].name, /structural-all-floors/);
  assert.equal(captures.length, 2);
  assert.equal(batches[1].length, 2);
  assert.equal(scenes[1], captures[1]);
  assert.equal(scenes[2], captures[1]);
  assert.equal(planner.exportProject(), before);
  assert.ok(batches[1].every(sheet => sheet.version === 1 && sheet.metadata.revision === planner.getProject().revision));
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const pending = controller.exportFiles('pdf');
  const replacement = JSON.parse(before);
  replacement.floors[0].authored.structural[0].label = 'Changed structural label';
  planner.replaceProject(replacement);
  complete(new Uint8Array([1]));
  assert.equal(await pending, null);
  assert.equal(all.isCurrent(), false);
  assert.equal(controller.getState().outputs.length, 0);
  controller.dispose();
});

test('changing discipline cancels pending PDF and is session-only per project', async () => {
  const { controller, runtime, change, planner } = setup();
  const before = JSON.stringify(planner.getProject());
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const pending = controller.exportFiles('pdf');
  controller.setSettings({ discipline: 'structural' });
  complete(new Uint8Array([1]));
  assert.equal(await pending, null);
  assert.equal(JSON.stringify(planner.getProject()), before);
  change({ id: 'other-project' });
  assert.equal(controller.getState().settings.discipline, 'architectural');
  change({ id: 'project-one' });
  assert.equal(controller.getState().settings.discipline, 'structural');
});

function multipageSetup() {
  const value = setup(), { runtime, controller } = value;
  const batches = [], validated = [];
  runtime.HomePlannerStructureDrawing = {
    createSheet() { throw new Error('Multipage API must take precedence'); },
    createSheets(scene, options) {
      const sheets = Array.from({ length: options.floorId === 'ground' ? 3 : 2 }, (_, index) =>
        runtime.HomePlannerDrawing.createSheet(scene, { ...options, title: `${options.floorName} page ${index + 1}` }));
      batches.push({ scene, sheets }); return sheets;
    }
  };
  runtime.HomePlannerDrawing.toSVG = sheet => `<svg><text>${sheet.metadata.title}</text></svg>`;
  runtime.HomePlannerDrawing.validateSheet = sheet => { validated.push(sheet); return true; };
  controller.setSettings({ discipline: 'structural' });
  return { ...value, batches, validated };
}

test('multipage preview selects cached pages, validates each once and bounds/reset session-only settings', () => {
  const { controller, planner, captures, batches, validated, change } = multipageSetup();
  const before = JSON.stringify(planner.getProject());
  assert.equal(controller.refresh().pageCount, 3);
  assert.deepEqual(validated, batches[0].sheets);
  controller.setSettings({ pageIndex: 1 });
  assert.equal(controller.getState().preview.sheet, batches[0].sheets[1]);
  assert.match(controller.getState().preview.svg, /Ground page 2/);
  assert.equal(captures.length, 1);
  assert.equal(validated.length, 3, 'page selection does not rebuild/revalidate sheets');
  controller.sync();
  assert.equal(controller.getState().settings.pageIndex, 1);
  controller.setSettings({ pageIndex: 99 });
  assert.equal(controller.getState().preview.pageIndex, 2);
  assert.throws(() => controller.setSettings({ pageIndex: -1 }), /nonnegative/);
  assert.throws(() => controller.setSettings({ pageIndex: 1.5 }), /nonnegative/);
  assert.equal(JSON.stringify(planner.getProject()), before);
  change({ id: 'other-project' }); change({ id: 'project-one' });
  assert.equal(controller.getState().settings.pageIndex, 2);
  assert.equal(controller.refresh().pageIndex, 2);
  for (const patch of [{ title: 'new' }, { layers: { site: false } }, { paper: 'A2' },
    { scope: 'all', floorId: 'upper' }]) {
    controller.setSettings({ pageIndex: 1 });
    controller.setSettings(patch);
    assert.equal(controller.getState().preview, null);
    assert.equal(controller.getState().settings.pageIndex, 0);
    assert.equal(controller.refresh().pageIndex, 0);
  }
  assert.equal(controller.getState().preview.sheet.metadata.floorId, 'upper');
  assert.equal(controller.getState().preview.pageCount, 2);
});

for (const format of ['pdf', 'svg', 'png']) test(`multipage ${format} exports all floor pages in order from one scene`, async () => {
  const { controller, runtime, batches, validated, captures, change } = multipageSetup();
  let pdfPages;
  runtime.HomePlannerDrawingExport.pdfBytes = async pages => { pdfPages = pages; return new Uint8Array([1]); };
  change({ floors: [{ id: 'ground', name: 'Same/name' }, { id: 'upper', name: 'Same\\name' }] });
  controller.setSettings({ scope: 'all', floorId: 'upper' });
  const result = await controller.exportFiles(format);
  assert.ok(result, controller.getState().error);
  assert.equal(captures.length, 1);
  assert.ok(batches.every(batch => batch.scene === captures[0]));
  const expected = batches.flatMap(batch => batch.sheets);
  assert.deepEqual(expected.map(sheet => sheet.metadata.floorId), ['ground', 'ground', 'ground', 'upper', 'upper']);
  assert.deepEqual(validated, expected);
  if (format === 'pdf') {
    assert.deepEqual(pdfPages, expected);
    assert.match(result.outputs[0].name, /all-floors/);
  } else {
    assert.equal(result.outputs.length, 5);
    assert.equal(new Set(result.outputs.map(output => output.name)).size, 5);
    assert.deepEqual(result.outputs.map(output => output.label.match(/Page (\d+) of (\d+)/).slice(1)), [
      ['1', '3'], ['2', '3'], ['3', '3'], ['1', '2'], ['2', '2']
    ]);
    result.outputs.forEach(output => assert.match(output.name, /Same-name-page-\d-r7/));
  }
});

test('current-floor PDF includes continuations; preview page changes preserve pending and completed files', async () => {
  const { controller, runtime } = multipageSetup();
  let pages;
  runtime.HomePlannerDrawingExport.pdfBytes = async value => { pages = value; return new Uint8Array([1]); };
  const pdf = await controller.exportFiles('pdf');
  assert.equal(pages.length, 3);
  assert.match(pdf.outputs[0].name, /structural-Ground-r7/);
  assert.doesNotMatch(pdf.outputs[0].name, /all-floors/);
  controller.refresh();
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const pending = controller.exportFiles('pdf');
  controller.setSettings({ pageIndex: 1 });
  assert.equal(controller.getState().preview.pageIndex, 1);
  complete(new Uint8Array([1]));
  const output = await pending;
  assert.equal(output.outputs.length, 1);
  assert.equal(output.isCurrent(), true);
  controller.setSettings({ pageIndex: 2 });
  assert.equal(controller.getState().outputs[0], output.outputs[0]);
  assert.equal(output.isCurrent(), true);
});

test('invalid continuation or empty renderer output fails atomically before serialization/export', async () => {
  const { controller, runtime } = multipageSetup();
  let validated = 0, serialized = 0;
  runtime.HomePlannerDrawing.validateSheet = () => ++validated !== 2;
  runtime.HomePlannerDrawing.toSVG = () => { serialized++; return '<svg/>'; };
  assert.equal(await controller.exportFiles('svg'), null);
  assert.equal(serialized, 0);
  assert.match(controller.getState().error, /validation failed/);
  runtime.HomePlannerStructureDrawing.createSheets = () => [];
  assert.equal(controller.refresh(), null);
  assert.match(controller.getState().error, /nonempty array/);
});

test('page suffix and global ordinal survive long, duplicated sanitized floor names', async () => {
  const { controller, change } = multipageSetup();
  change({ floors: [{ id: 'ground', name: 'X'.repeat(200) }, { id: 'upper', name: 'X'.repeat(200) }] });
  controller.setSettings({ scope: 'all' });
  const result = await controller.exportFiles('svg');
  assert.equal(new Set(result.outputs.map(output => output.name)).size, 5);
  result.outputs.forEach(output => assert.match(output.name, /-page-\d-r7\.drawing\.svg$/));
});

test('real five-kind UUID records overflow one A2 sheet but UI exports and previews all valid continuation pages', async () => {
  const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
  const Model = require('../planner-model.js'), Drawing = require('../planner-drawing.js');
  const Structural = require('../planner-structure-drawing.js'), Structure = require('../planner-structure.js');
  assert.equal(typeof Structural.createSheets, 'function', 'renderer continuation API required for integration');
  const doc = createFixture('multiple-floors').project;
  for (const floor of doc.floors) {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
    floor.authored = Model.emptyAuthored();
    floor.authored.structural = ['grid', 'column', 'beam', 'slab', 'footing'].map((kind, index) => ({
      id: `${floor.id}:authored:12345678-1234-4321-8123-12345678900${index}`,
      kind, label: kind, anchors: (['grid', 'beam'].includes(kind) ? [2, 5] : [2]).map(x =>
        ({ kind: 'point', floorId: floor.id, point: { x, y: 2, z: 0 } })),
      widthM: null, depthM: null, heightM: null, material: kind === 'grid' ? null : 'Concrete', sizeSource: 'unspecified', reference: null
    }));
  }
  doc.legacy = JSON.parse(JSON.stringify(doc.floors[0].legacy));
  const planner = controllerFor(doc), scene = planner.getDrawingScene();
  assert.equal(Structure.build(scene).findings.filter(item => !item.floorId || item.floorId === 'ground').length, 14);
  assert.throws(() => Structural.createSheet(scene, { floorId: 'ground', paper: 'A2' }), /do not fit/);
  const captures = [], batches = [], validated = [];
  let pdfPages;
  const runtime = { Blob, HomePlannerDrawing: { ...Drawing, validateSheet(sheet) {
    validated.push(sheet); return Drawing.validateSheet(sheet);
  } }, HomePlannerStructureDrawing: { ...Structural, createSheets(scene, options) {
    const sheets = Structural.createSheets(scene, options); batches.push({ scene, sheets }); return sheets;
  } }, HomePlannerDrawingExport: { async pdfBytes(sheets) { pdfPages = sheets; return new Uint8Array([1]); } } };
  const controller = UI.createController({ ...planner, getDrawingScene() {
    const scene = planner.getDrawingScene(); captures.push(scene); return scene;
  } }, runtime);
  controller.setSettings({ discipline: 'structural', paper: 'A2' });
  const before = planner.exportProject(), preview = controller.refresh();
  assert.ok(preview, controller.getState().error);
  assert.ok(preview.pageCount > 1);
  assert.deepEqual(validated, batches[0].sheets);
  controller.setSettings({ pageIndex: preview.pageCount - 1 });
  assert.equal(controller.getState().preview.sheet, batches[0].sheets.at(-1));
  assert.equal(captures.length, 1);
  const current = await controller.exportFiles('pdf');
  assert.ok(current, controller.getState().error);
  assert.equal(pdfPages.length, preview.pageCount);
  assert.match(current.outputs[0].name, /structural-Ground/);
  controller.setSettings({ scope: 'all' });
  const start = batches.length, validations = validated.length;
  const all = await controller.exportFiles('pdf');
  assert.ok(all, controller.getState().error);
  const floorBatches = batches.slice(start);
  assert.equal(floorBatches.length, 2);
  assert.equal(floorBatches[0].scene, floorBatches[1].scene);
  assert.equal(floorBatches[0].scene, captures.at(-1));
  assert.deepEqual(pdfPages, floorBatches.flatMap(batch => batch.sheets));
  assert.deepEqual(validated.slice(validations), pdfPages);
  assert.deepEqual([...new Set(pdfPages.map(sheet => sheet.metadata.floorId))], ['ground', 'upper']);
  for (const format of ['svg', 'png']) {
    runtime.HomePlannerDrawingExport.pngBlob = async sheet => new Blob([Drawing.toSVG(sheet)]);
    const result = await controller.exportFiles(format);
    assert.ok(result, controller.getState().error);
    assert.equal(result.outputs.length, pdfPages.length);
    assert.equal(new Set(result.outputs.map(output => output.name)).size, pdfPages.length);
    result.outputs.forEach(output => assert.match(output.label, /Page \d+ of \d+/));
  }
  assert.equal(planner.exportProject(), before);
  let complete;
  runtime.HomePlannerDrawingExport.pdfBytes = sheets => {
    assert.ok(sheets.length > 2);
    return new Promise(resolve => { complete = resolve; });
  };
  const pending = controller.exportFiles('pdf');
  const replacement = JSON.parse(before);
  replacement.floors[0].authored.structural[0].label = 'Replacement during export';
  planner.replaceProject(replacement);
  complete(new Uint8Array([1]));
  assert.equal(await pending, null);
  assert.equal(controller.getState().preview, null);
  assert.deepEqual(controller.getState().outputs, []);
  assert.equal(all.isCurrent(), false);
  controller.dispose();
});

function drainageSetup() {
  const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
  const Model = require('../planner-model.js'), Drawing = require('../planner-drawing.js');
  const project = createFixture('multiple-floors').project;
  project.floors.forEach(floor => {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 16, h: 16 };
  });
  project.legacy = JSON.parse(JSON.stringify(project.floors[0].legacy));
  project.floors[0].authored = Model.emptyAuthored();
  project.floors[0].authored.serviceNodes.push({
    id: 'ground:authored:drainage-report', system: 'rain', circuit: 'storm', kind: 'outlet',
    anchor: { kind: 'point', floorId: 'ground', point: { x: 2, y: 3, z: 1 } },
    diameterMm: null, invertM: -1.1234567, groundM: 2.34567,
    discharge: { kind: 'surface-outfall', reference: 'Unverified outlet' }
  });
  const planner = controllerFor(project), captures = [], calls = [], batches = [], encoded = [];
  const runtime = {
    Blob, HomePlannerDrawing: Drawing,
    HomePlannerDrainageDrawing: {
      createSheets(scene, options) {
        assert.deepEqual(Object.keys(options).sort(),
          ['floorId', 'floorName', 'paper', 'orientation', 'scaleDenominator', 'units', 'view', 'systems'].sort());
        assert.ok(Object.isFrozen(scene));
        assert.ok(['plan', 'profile'].includes(options.view));
        assert.ok(options.systems.every(s => ['rain', 'waste'].includes(s)));
        calls.push({ scene, options });
        const { systems, view, ...sheetOptions } = options;
        const count = view === 'profile' ? (options.floorId === 'ground' ? 2 : 3) : 1;
        return Array.from({ length: count }, (_, i) =>
          Drawing.createSheet(scene, { ...sheetOptions, title: `Drainage ${view} ${i + 1}` }));
      }
    },
    HomePlannerDrawingExport: {
      pdfBytes: async sheets => { batches.push(sheets); return new Uint8Array([1, 2]); },
      pngBlob: async (sheet, options) => { encoded.push({ sheet, options }); return new Blob(['png']); }
    }
  };
  const wrapped = { ...planner, getDrawingScene() { const scene = planner.getDrawingScene(); captures.push(scene); return scene; } };
  const controller = UI.createController(wrapped, runtime);
  controller.setSettings({ discipline: 'drainage', paper: 'A2', drainageView: 'profile', scope: 'all' });
  return { controller, planner, wrapped, runtime, captures, calls, batches, encoded };
}

for (const format of ['pdf', 'svg', 'png'])
  test(`drainage ${format} real bridge uses exact options and flattens full per-floor profile arrays from one frozen capture`, async () => {
    const f = drainageSetup(), before = JSON.stringify(f.planner.getProject());
    try {
      const result = await f.controller.exportFiles(format);
      assert.ok(result, f.controller.getState().error);
      assert.equal(f.captures.length, 1);
      assert.equal(f.calls.length, 2);
      assert.ok(f.calls.every(c => c.scene === f.captures[0]));
      assert.deepEqual(f.calls.map(c => c.options.floorId), ['ground', 'upper']);
      assert.deepEqual(f.calls[0].options.systems, ['waste', 'rain']);
      if (format === 'pdf') assert.deepEqual(f.batches[0].map(s => s.metadata.floorId), ['ground', 'ground', 'upper', 'upper', 'upper']);
      else {
        assert.equal(result.outputs.length, 5);
        assert.equal(new Set(result.outputs.map(o => o.name)).size, 5);
      }
      assert.equal(JSON.stringify(f.planner.getProject()), before);
      assert.equal(f.planner.getProject().activeFloorId, 'ground');
    } finally { f.controller.dispose(); }
  });

test('drainage plan/profile and sanitary/storm filters persist separately from plumbing preferences and cached page choice', () => {
  const f = drainageSetup();
  try {
    f.controller.setSettings({ serviceView: 'riser', plumbingSystem: 'water', drainageSystem: 'storm' });
    assert.equal(f.controller.refresh().pageCount, 2);
    assert.deepEqual(f.calls.at(-1).options.systems, ['rain']);
    const captures = f.captures.length;
    f.controller.setSettings({ pageIndex: 1 });
    assert.equal(f.controller.getState().preview.pageIndex, 1);
    assert.equal(f.captures.length, captures);
    f.controller.setSettings({ discipline: 'plumbing' });
    assert.equal(f.controller.getState().settings.serviceView, 'riser');
    assert.equal(f.controller.getState().settings.plumbingSystem, 'water');
    f.controller.setSettings({ discipline: 'drainage' });
    assert.equal(f.controller.getState().settings.drainageView, 'profile');
    assert.equal(f.controller.getState().settings.drainageSystem, 'storm');
    f.controller.setSettings({ drainageView: 'plan', drainageSystem: 'sanitary' });
    assert.equal(f.controller.refresh().pageCount, 1);
    assert.deepEqual(f.calls.at(-1).options.systems, ['waste']);
    assert.equal(f.calls.at(-1).options.view, 'plan');
    assert.throws(() => f.controller.setSettings({ drainageView: 'riser' }), /Unsupported/);
    assert.throws(() => f.controller.setSettings({ drainageSystem: 'water' }), /Unsupported/);
  } finally { f.controller.dispose(); }
});

for (const format of ['pdf', 'svg', 'png'])
  test(`drainage ${format} rejects invalid or over-limit continuation batches atomically before encoding`, async () => {
    const f = drainageSetup();
    try {
      const original = f.runtime.HomePlannerDrainageDrawing.createSheets;
      let exports = 0, serializes = 0;
      f.runtime.HomePlannerDrawingExport.pdfBytes = async () => { exports++; return new Uint8Array([1]); };
      f.runtime.HomePlannerDrawingExport.pngBlob = async () => { exports++; return new Blob(['png']); };
      f.runtime.HomePlannerDrainageDrawing.toSVG = () => { serializes++; return '<svg/>'; };
      for (const mode of ['invalid', 'empty', 'overflow']) {
        f.runtime.HomePlannerDrainageDrawing.createSheets = (scene, options) => {
          const pages = original(scene, options);
          if (options.floorId === 'ground') return pages;
          return mode === 'invalid' ? [...pages, {}] : mode === 'empty' ? [] : Array(99).fill(pages[0]);
        };
        assert.equal(await f.controller.exportFiles(format), null);
        assert.equal(f.controller.getState().outputs.length, 0);
        assert.match(f.controller.getState().error, mode === 'overflow' ? /100-page limit/ : mode === 'empty' ? /nonempty array/ : /sheet/i);
        assert.equal(exports, 0); assert.equal(serializes, 0);
      }
    } finally { f.controller.dispose(); }
  });

test('drainage real same-ID/revision metadata replacements invalidate preview, outputs and in-flight generations', async () => {
  const f = drainageSetup();
  try {
    const change = () => {
      const replacement = JSON.parse(JSON.stringify(f.planner.getProject()));
      replacement.floors[0].authored.serviceNodes[0].invertM -= .1;
      f.planner.replaceProject(replacement);
    };
    assert.ok(f.controller.refresh());
    const output = await f.controller.exportFiles('svg');
    const identity = [f.planner.getProject().id, f.planner.getProject().revision];
    change();
    assert.deepEqual([f.planner.getProject().id, f.planner.getProject().revision], identity);
    assert.equal(output.isCurrent(), false);
    assert.equal(f.controller.getState().preview, null);
    for (const format of ['pdf', 'png']) {
      let resolve, encoded = 0;
      f.runtime.HomePlannerDrawingExport[format === 'pdf' ? 'pdfBytes' : 'pngBlob'] =
        () => { encoded++; return new Promise(done => { resolve = done; }); };
      const pending = f.controller.exportFiles(format);
      change();
      resolve(format === 'pdf' ? new Uint8Array([1]) : new Blob(['png']));
      assert.equal(await pending, null);
      assert.equal(encoded, 1);
      assert.deepEqual(f.controller.getState().outputs, []);
    }
  } finally { f.controller.dispose(); }
});

test('drainage cancellation preserves cached preview, freezes batch DPI and publishes no partial PNG files', async () => {
  const f = drainageSetup();
  try {
    f.controller.refresh(); const preview = f.controller.getState().preview;
    let resolve, encodes = 0;
    f.runtime.HomePlannerDrawingExport.pngBlob = (_sheet, options) => {
      encodes++; assert.equal(options.pixelsPerMm, 72 / 25.4); return new Promise(done => { resolve = done; });
    };
    f.controller.setSettings({ pngDpi: 72 });
    const pending = f.controller.exportFiles('png');
    f.controller.setSettings({ pngDpi: 150 });
    f.controller.cancel(); resolve(new Blob(['png']));
    assert.equal(await pending, null); assert.equal(encodes, 1);
    assert.equal(f.controller.getState().preview, preview);
    assert.deepEqual(f.controller.getState().outputs, []);
  } finally { f.controller.dispose(); }
});

test('drainage authoring link selects before router without rendering and exposes only discipline controls', async () => {
  const f = drainageSetup(); f.controller.dispose();
  const { document, find, host } = drawingDocument(f.wrapped, f.runtime), disciplines = [];
  document.addEventListener('click', () => {
    disciplines.push(host.homePlannerDrawings.getState().settings.discipline);
    document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
    document.dispatch('homeplanner:workspace-change');
  });
  const ui = UI.mount(document);
  try {
    ui.setSettings({ serviceView: 'riser', plumbingSystem: 'water' });
    const link = { dataset: { workspace: 'report', section: 'drawings', drawingDiscipline: 'drainage' } };
    await document.dispatch('click', { target: { closest: () => link }, button: 0 });
    assert.deepEqual(disciplines, ['drainage']); assert.equal(f.captures.length, 0);
    const view = document.getElementById('hp-drawing-drainageView'), system = document.getElementById('hp-drawing-drainageSystem');
    view.value = 'profile'; await view.dispatch('change');
    system.value = 'storm'; await system.dispatch('change');
    assert.equal(f.captures.length, 0);
    assert.equal(ui.getState().settings.serviceView, 'riser');
    assert.equal(ui.getState().settings.plumbingSystem, 'water');
    assert.equal(find(host, n => n.children.includes(view)).hidden, false);
    assert.equal(find(host, n => n.children.includes(document.getElementById('hp-drawing-serviceView'))).hidden, true);
    assert.equal(find(host, n => n.className === 'hp-drawing-layers').hidden, true);
    ui.setSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
    const captures = f.captures.length, preview = ui.getState().preview;
    const zoom = document.getElementById('hp-drawing-zoom'); zoom.value = 'full'; await zoom.dispatch('change');
    assert.equal(f.captures.length, captures); assert.equal(ui.getState().preview, preview);
  } finally { ui.dispose(); }
});

test('drainage URL remains explicit refresh and missing renderer fails without architectural fallback', () => {
  const { controller: unused, planner, runtime, captures } = setup(); unused.dispose();
  const { document } = drawingDocument(planner, runtime);
  document.defaultView.location = { href: 'https://example.test/?workspace=report&section=drawings&discipline=drainage' };
  document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
  const ui = UI.mount(document);
  assert.equal(ui.getState().settings.discipline, 'drainage'); assert.equal(captures.length, 0);
  assert.equal(ui.refresh(), null);
  assert.match(ui.getState().error, /Drainage drawing renderer unavailable/);
  assert.equal(captures.length, 0); ui.dispose();
});

function drawingDocument(planner, runtime) {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {};
      this.listeners = new Map(); this.value = ''; this.style = {}; this.classList = { add() {} };
      this.clicks = 0; this.captureListeners = new Set();
    }

    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn, capture = false) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
      if (capture === true) this.captureListeners.add(fn);
    }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name, event = {}) {
      return Promise.all([...this.listeners.get(name) || []]
        .sort((a, b) => Number(this.captureListeners.has(b)) - Number(this.captureListeners.has(a)))
        .map(fn => fn({ preventDefault() {}, ...event })));
    }
    querySelector(tag) { return find(this, node => node !== this && node.tagName === tag.toUpperCase()); }
    click() { this.clicks++; return this.dispatch('click'); }
  }
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  const host = new Node('section'), document = new Node('document'), urls = [], revoked = [];
  document.body = new Node('body');
  document.createElement = tag => new Node(tag);
  document.createTextNode = text => { const node = new Node('text'); node.textContent = text; return node; };
  document.getElementById = id => id === 'workspaceDrawings' ? host : find(host, node => node.id === id);
  document.defaultView = new Node('window');
  Object.assign(document.defaultView, runtime, { HomePlanner: planner,
    URL: { createObjectURL() { const url = `blob:drawing-${urls.length}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); } } });
  return { host, document, find, urls, revoked };
}

test('Report keeps refresh and discipline above the preview with closed live-summary print settings', () => {
  const { controller: unused, planner, runtime, captures } = setup(); unused.dispose();
  const { host, document, find } = drawingDocument(planner, runtime);
  const ui = UI.mount(document);
  const settings = find(host, node => node.className === 'hp-drawing-print-settings');
  const toolbar = find(host, node => node.className === 'hp-drawing-toolbar');
  assert.equal(settings.tagName, 'DETAILS');
  assert.ok(!settings.open);
  for (const name of ['paper', 'orientation', 'scaleDenominator', 'units', 'pngDpi', 'scope'])
    assert.equal(find(settings, node => node.id === `hp-drawing-${name}`), document.getElementById(`hp-drawing-${name}`));
  assert.equal(find(toolbar, node => node.id === 'hp-drawing-discipline'), document.getElementById('hp-drawing-discipline'));
  assert.ok(find(toolbar, node => node.tagName === 'BUTTON' && node.textContent === 'Refresh preview'));
  assert.ok(host.children.findIndex(node => node.className === 'hp-drawing-preview') < host.children.findIndex(node => node.className === 'hp-drawing-actions'));
  ui.setSettings({ discipline: 'drainage', drainageView: 'profile', paper: 'A2', scaleDenominator: 75 });
  assert.match(settings.children[0].textContent, /profile.*A2.*1:75/);
  assert.equal(captures.length, 0, 'presentation controls do not start analysis');
  ui.dispose();
});

test('plumbing authoring link selects discipline before workspace route and never auto-builds architectural fallback', async () => {
  const { controller: unused, planner, runtime, captures } = setup(); unused.dispose();
  const { document } = drawingDocument(planner, runtime);
  const disciplines = [];
  document.addEventListener('click', () => {
    disciplines.push(document.getElementById('workspaceDrawings').homePlannerDrawings.getState().settings.discipline);
    document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
    document.dispatch('homeplanner:workspace-change');
  });
  const ui = UI.mount(document), link = { dataset: { workspace: 'report', section: 'drawings', drawingDiscipline: 'plumbing' } };
  await document.dispatch('click', { target: { closest: () => link }, button: 0 });
  assert.deepEqual(disciplines, ['plumbing']); assert.equal(captures.length, 0);
  assert.equal(ui.getState().error, '');
  const serviceView = document.getElementById('hp-drawing-serviceView'), systems = document.getElementById('hp-drawing-plumbingSystem');
  serviceView.value = 'riser'; await serviceView.dispatch('change');
  systems.value = 'waste'; await systems.dispatch('change');
  assert.equal(ui.getState().settings.serviceView, 'riser'); assert.equal(ui.getState().settings.plumbingSystem, 'waste');
  assert.equal(captures.length, 0);
  assert.equal(ui.refresh(), null); assert.match(ui.getState().error, /Plumbing drawing renderer unavailable/);
  assert.equal(captures.length, 0, 'missing renderer never falls back to architectural capture');
  ui.dispose();
});

test('narrow plumbing URL initializes discipline without automatic analysis', () => {
  const { controller: unused, planner, runtime, captures } = setup(); unused.dispose();
  const { document } = drawingDocument(planner, runtime);
  document.defaultView.location = { href: 'https://example.test/?workspace=report&section=drawings&discipline=plumbing' };
  document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
  const ui = UI.mount(document);
  assert.equal(ui.getState().settings.discipline, 'plumbing'); assert.equal(captures.length, 0);
  assert.equal(ui.getState().error, ''); ui.dispose();
});

test('native Report zoom and PNG resolution retain cached preview, output URLs and geometry', async () => {
  const { controller: unused, planner, runtime, captures } = setup(); unused.dispose();
  const { document, host, find, urls, revoked } = drawingDocument(planner, runtime);
  const ui = UI.mount(document), before = JSON.stringify(planner.getProject());
  ui.refresh(); const result = await ui.exportFiles('svg');
  const state = ui.getState(), capturesBefore = captures.length, urlsBefore = urls.length;
  const zoom = document.getElementById('hp-drawing-zoom'), dpi = document.getElementById('hp-drawing-pngDpi');
  assert.equal(zoom.value, 'fit');
  for (const value of ['full', 'fit']) {
    zoom.value = value; await zoom.dispatch('change');
    assert.equal(find(host, node => node.className === 'hp-drawing-preview').dataset.zoom, value);
    assert.equal(ui.getState().preview, state.preview);
  }
  dpi.value = '72'; await dpi.dispatch('change');
  assert.equal(ui.getState().settings.pngDpi, 72);
  assert.equal(ui.getState().preview, state.preview); assert.equal(ui.getState().outputs, state.outputs);
  assert.equal(result.isCurrent(), true); assert.equal(captures.length, capturesBefore);
  assert.equal(urls.length, urlsBefore); assert.equal(revoked.length, 0);
  assert.equal(JSON.stringify(planner.getProject()), before);
  const css = fs.readFileSync(path.join(__dirname, '..', 'planner-drawing-ui.css'), 'utf8');
  assert.doesNotMatch(css, /min-width: 48rem/); assert.match(css, /\[data-zoom="full"\] img \{ width: auto/);
  ui.dispose();
});

test('explicit authoring links select views before an already-registered router without rendering; ordinary links do not', async () => {
  const { controller: unused, planner, runtime, captures } = viewSetup(); unused.dispose();
  const { document } = drawingDocument(planner, runtime);
  const routeDisciplines = [];
  document.addEventListener('click', () => {
    routeDisciplines.push(document.getElementById('workspaceDrawings').homePlannerDrawings.getState().settings.discipline);
    document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
    document.dispatch('homeplanner:workspace-change');
  });
  const ui = UI.mount(document);
  const getElement = document.getElementById.bind(document);
  document.getElementById = id => id === 'workspaceViews'
    ? { homePlannerViews: { getState: () => ({ selectedId: 'view-c' }) } } : getElement(id);
  const link = { dataset: { workspace: 'report', section: 'drawings', drawingDiscipline: 'views', drawingUseActiveView: 'true' } };
  const target = { closest: selector => selector === 'a[data-drawing-discipline]' ? link : null };
  await document.dispatch('click', { target, button: 0 });
  assert.deepEqual(routeDisciplines, ['views']);
  assert.equal(ui.getState().settings.viewId, 'view-c'); assert.equal(captures.length, 0);
  delete link.dataset.drawingViewId;
  document.getElementById = getElement;
  await document.dispatch('click', { target }); // Keyboard activation; facade link preserves Report choice.
  assert.equal(ui.getState().settings.viewId, 'view-c'); assert.equal(captures.length, 0);
  link.dataset.drawingViewId = 'deleted-view';
  await document.dispatch('click', { target });
  assert.equal(ui.getState().settings.viewId, 'deleted-view');
  assert.match(ui.getState().error, /unavailable or deleted/);
  assert.equal(ui.refresh(), null); assert.equal(captures.length, 0);
  ui.setSettings({ discipline: 'architectural' });
  document.body.dataset = {};
  link.dataset.drawingDiscipline = 'unrelated';
  await document.dispatch('click', { target });
  assert.equal(ui.getState().settings.discipline, 'architectural');
  assert.equal(routeDisciplines.at(-1), 'architectural');
  ui.dispose(); assert.equal(document.listeners.get('click').size, 1, 'only original router remains');
});

test('narrow views URL initializes discipline and requested view without automatic preview or PDF', () => {
  for (const query of ['?workspace=report&section=drawings&discipline=views&viewId=view-c',
    '?workspace=report&section=schedules&discipline=views', '?workspace=report&section=drawings']) {
    const { controller: unused, planner, runtime, captures } = viewSetup(); unused.dispose();
    const { document } = drawingDocument(planner, runtime);
    document.defaultView.location = { href: `http://localhost/${query}` };
    const ui = UI.mount(document);
    const intended = query.includes('viewId=view-c');
    assert.equal(ui.getState().settings.discipline, intended ? 'views' : 'architectural');
    if (intended) assert.equal(ui.getState().settings.viewId, 'view-c');
    assert.equal(captures.length, 0); ui.dispose();
  }
});

test('PNG dpi accepts only explicit 72/150, stays out of sheet options and snapshots the batch resolution', async () => {
  const { controller, runtime, captures, calls } = setup();
  assert.equal(controller.getState().settings.pngDpi, 150);
  for (const value of [0, 96, 300, '72', NaN, null])
    assert.throws(() => controller.setSettings({ pngDpi: value }), /Unsupported drawing pngDpi/);
  const options = [];
  runtime.HomePlannerDrawingExport.pngBlob = async (sheet, option) => { options.push(option); return new Blob(['png']); };
  controller.setSettings({ scope: 'all' });
  await controller.exportFiles('png');
  assert.equal(captures.length, 1); assert.ok(options.every(option => option.pixelsPerMm === 150 / 25.4));
  options.length = 0;
  controller.setSettings({ pngDpi: 72 });
  runtime.HomePlannerDrawingExport.pngBlob = async (sheet, option) => {
    options.push(option); controller.setSettings({ pngDpi: 150 }); return new Blob(['png']);
  };
  const result = await controller.exportFiles('png');
  assert.ok(options.every(option => option.pixelsPerMm === 72 / 25.4 && option.maxPixels === 16000000));
  assert.ok(result.outputs.every(output => /72 dpi/.test(output.label)));
  assert.equal(captures.length, 2);
  assert.ok(calls.every(call => !Object.hasOwn(call.options, 'pngDpi')));
});

for (const [discipline, factory] of [['architectural', setup], ['structural', multipageSetup], ['views', viewSetup]])
  for (const format of ['png', 'pdf']) test(`Cancel ${discipline} ${format} keeps preview and rejects pending batch without later PNG pages`, async () => {
    const { controller, runtime, captures } = factory();
    controller.setSettings({ scope: 'all' }); controller.refresh();
    const preview = controller.getState().preview, before = captures.length;
    let complete, encodes = 0;
    runtime.HomePlannerDrawingExport[format === 'png' ? 'pngBlob' : 'pdfBytes'] = () => {
      encodes++; return new Promise(resolve => { complete = resolve; });
    };
    const pending = controller.exportFiles(format);
    assert.equal(encodes, 1); assert.equal(controller.getState().busy, true);
    controller.cancel();
    assert.equal(controller.getState().busy, false); assert.equal(controller.getState().error, '');
    assert.equal(controller.getState().preview, preview); assert.match(controller.getState().message, /Export cancelled/);
    complete(format === 'png' ? new Blob(['png']) : new Uint8Array([1]));
    assert.equal(await pending, null); assert.equal(encodes, 1);
    assert.equal(captures.length, before + 1); assert.deepEqual(controller.getState().outputs, []);
    assert.equal(controller.getState().preview, preview);
    controller.setSettings({ pageIndex: 0 }); assert.equal(captures.length, before + 1);
  });

test('mounted Cancel button remains visible during first PNG encode and publishes no download URLs', async () => {
  const { controller: unused, planner, runtime } = setup(); unused.dispose();
  const { document, find, host, urls } = drawingDocument(planner, runtime);
  const ui = UI.mount(document); ui.setSettings({ scope: 'all' }); ui.refresh();
  const count = urls.length;
  let complete;
  runtime.HomePlannerDrawingExport.pngBlob = () => new Promise(resolve => { complete = resolve; });
  const cancel = document.getElementById('hp-drawing-cancel');
  assert.equal(cancel.hidden, true);
  const pending = find(host, node => node.dataset.drawingExport === 'png').dispatch('click');
  assert.equal(cancel.hidden, false); assert.equal(cancel.disabled, false);
  await cancel.dispatch('click'); assert.equal(cancel.hidden, true);
  complete(new Blob(['png'])); await pending;
  assert.equal(urls.length, count); assert.deepEqual(ui.getState().outputs, []);
  assert.equal(ui.getState().error, ''); ui.dispose();
});

for (const format of ['pdf', 'svg', 'png']) test(`${format} rejects over 100 total continuation pages before any serialization`, async () => {
  const { controller, runtime, calls } = setup();
  let serializations = 0;
  runtime.HomePlannerDrawing.createSheets = (scene, options) => Array.from({ length: 51 }, () => runtime.HomePlannerDrawing.createSheet(scene, options));
  runtime.HomePlannerDrawing.toSVG = () => { serializations++; return '<svg/>'; };
  runtime.HomePlannerDrawingExport.pdfBytes = runtime.HomePlannerDrawingExport.pngBlob = () => { serializations++; throw new Error('Must not encode'); };
  controller.setSettings({ scope: 'all' });
  assert.equal(await controller.exportFiles(format), null);
  assert.equal(calls.length, 102); assert.equal(serializations, 0);
  assert.match(controller.getState().error, /100-page limit/); assert.deepEqual(controller.getState().outputs, []);
});

test('mounted report native page select switches images, revokes old URLs and exposes one link per page', async () => {
  const { controller: unused, planner, runtime, captures } = multipageSetup(); unused.dispose();
  const { host, document, find, urls, revoked } = drawingDocument(planner, runtime);
  const ui = UI.mount(document);
  assert.equal(UI.mount(document), ui);
  const select = document.getElementById('hp-drawing-pageIndex');
  const label = find(host, node => node.htmlFor === select.id);
  assert.equal(select.tagName, 'SELECT');
  assert.equal(label.hidden, true);
  ui.setSettings({ discipline: 'structural' }); ui.refresh();
  assert.equal(label.hidden, false); assert.equal(select.disabled, false);
  assert.equal(select.children.length, 3);
  assert.match(select.children[1].textContent, /Ground.*Page 2 of 3/);
  const options = [...select.children], notifications = [];
  const unsubscribe = ui.subscribe(state => { notifications.push(state.preview?.pageCount); });
  const before = JSON.stringify(planner.getProject()), oldURL = urls[0];
  select.value = '1'; await select.dispatch('change');
  unsubscribe();
  assert.deepEqual(notifications, [3], 'page selection never transiently hides/disables the focused native select');
  assert.deepEqual(select.children, options, 'retain option nodes for keyboard navigation');
  assert.equal(ui.getState().preview.pageIndex, 1);
  assert.equal(captures.length, 1);
  assert.deepEqual(revoked, [oldURL]);
  assert.match(find(host, node => node.tagName === 'IMG').alt, /Ground.*Page 2 of 3/);
  const svgButton = find(host, node => node.dataset.drawingExport === 'svg');
  await svgButton.dispatch('click');
  const outputList = find(host, node => node.className === 'hp-drawing-outputs');
  const links = outputList.children.map(item => item.children[0]);
  assert.equal(links.length, 3);
  assert.equal(new Set(links.map(link => link.download)).size, 3);
  links.forEach((link, index) => {
    assert.match(link.textContent, new RegExp(`Ground.*Page ${index + 1} of 3`));
    assert.equal(link.clicks, 0, 'multiple pages require explicit individual downloads');
  });
  select.value = '2'; await select.dispatch('change');
  assert.equal(outputList.children.length, 3);
  assert.deepEqual(outputList.children.map(item => item.children[0]), links);
  links.forEach(link => assert.ok(!revoked.includes(link.href)));
  assert.equal(JSON.stringify(planner.getProject()), before);
  ui.setSettings({ discipline: 'architectural' }); ui.refresh();
  assert.equal(label.hidden, true); assert.equal(select.disabled, true);
  assert.equal(ui.getState().preview.pageCount, 1);
  ui.dispose();
  assert.deepEqual(new Set(revoked), new Set(urls));
  assert.equal(revoked.length, urls.length, 'each URL is revoked exactly once');
});

function viewSetup() {
    const value = setup(), { controller, runtime, change } = value;
    const views = [
      { id: 'view-a', name: 'Same/name', kind: 'elevation', floorId: 'upper', direction: 'E', scaleDenominator: 75, cut: [] },
      { id: 'plan', name: 'Not exported', kind: 'plan', floorId: 'ground', direction: null, scaleDenominator: 100, cut: [] },
      { id: 'view-b', name: 'Same\\name', kind: 'section', floorId: 'ground', direction: null, scaleDenominator: null, cut: [] },
      { id: 'view-c', name: 'Same/name', kind: 'elevation', floorId: 'upper', direction: 'W', scaleDenominator: 50, cut: [] }
    ];
    change({ documentation: { version: 1, views, sheets: [] } });
    const batches = [];
    runtime.HomePlannerElevation = {
      createSheets(scene, options) {
        assert.deepEqual(Object.keys(options).sort(), ['floorName', 'orientation', 'paper', 'scaleDenominator', 'units', 'viewId']);
        const saved = scene.documentation.views.find(item => item.id === options.viewId);
        assert.equal(options.scaleDenominator, saved.scaleDenominator ?? controller.getState().settings.scaleDenominator);
        const sheets = Array.from({ length: saved.id === 'view-a' ? 3 : 2 }, (_, index) => ({
          metadata: { ...options, floorId: saved.floorId, title: `${saved.name} page ${index + 1}` }
        }));
        batches.push({ scene, options, sheets }); return sheets;
      },
      toSVG: sheet => `<svg>${sheet.metadata.title}</svg>`
    };
    controller.setSettings({ discipline: 'views' });
    return { ...value, views, batches };
  }

  for (const format of ['pdf', 'svg', 'png']) test(`saved-view ${format} flattens every selected view once, with all continuations and authoritative scales`, async () => {
    const { controller, runtime, batches, captures, planner } = viewSetup();
    let pdfPages;
    runtime.HomePlannerDrawingExport.pdfBytes = async sheets => { pdfPages = sheets; return new Uint8Array([1]); };
    controller.setSettings({ scope: 'all' });
    const before = JSON.stringify(planner.getProject());
    const output = await controller.exportFiles(format); assert.ok(output, controller.getState().error);
    assert.equal(captures.length, 1);
    assert.equal(batches.length, 3);
    assert.ok(batches.every(batch => batch.scene === captures[0]));
    assert.deepEqual(batches.map(batch => batch.options.viewId), ['view-a', 'view-b', 'view-c']);
    assert.deepEqual(batches.map(batch => batch.options.scaleDenominator), [75, 100, 50]);
    const expected = batches.flatMap(batch => batch.sheets);
    assert.deepEqual(expected.map(sheet => sheet.metadata.floorId), ['upper', 'upper', 'upper', 'ground', 'ground', 'upper', 'upper']);
    if (format === 'pdf') { assert.deepEqual(pdfPages, expected); assert.match(output.outputs[0].name, /views-all-views/); }
    else {
      assert.equal(output.outputs.length, 7);
      assert.equal(new Set(output.outputs.map(item => item.name)).size, 7);
      assert.match(output.outputs[0].name, /Same-name.*view-a/);
      assert.match(output.outputs.at(-1).label, /view-c.*Page 2 of 2/);
    }
    assert.equal(JSON.stringify(planner.getProject()), before);
  });

  test('selected view owns its floor and scale; cached all-view preview pages include all continuations', () => {
    const { controller, batches, captures, change } = viewSetup();
    controller.setSettings({ viewId: 'view-c' });
    assert.equal(controller.refresh().sheet.metadata.floorId, 'upper');
    assert.equal(batches[0].options.scaleDenominator, 50);
    change({ activeFloorId: 'upper' });
    assert.ok(controller.getState().preview, 'saved-view output is independent of active floor');
    controller.setSettings({ scope: 'all' });
    assert.equal(controller.refresh().pageCount, 7);
    const capturesBefore = captures.length, batchesBefore = batches.length;
    controller.setSettings({ pageIndex: 4 });
    assert.equal(controller.getState().preview.sheet.metadata.viewId, 'view-b');
    assert.equal(captures.length, capturesBefore); assert.equal(batches.length, batchesBefore);
  });

  test('missing saved views or runtime gives actionable errors and never an architectural fallback', async () => {
    const { controller, runtime, calls, change } = setup();
    controller.setSettings({ discipline: 'views' });
    runtime.HomePlannerElevation = { createSheets() { throw new Error('Should not build missing view'); }, toSVG() {} };
    assert.equal(controller.refresh(), null);
    assert.match(controller.getState().error, /Design.*Elevations/);
    assert.equal(await controller.exportFiles('pdf'), null);
    assert.match(controller.getState().error, /Design.*Elevations/);
    assert.equal(calls.length, 0);
    delete runtime.HomePlannerElevation;
    change({ documentation: { version: 1, sheets: [], views: [{ id: 'north', kind: 'elevation', floorId: 'ground', name: 'North', direction: 'N', scaleDenominator: 100, cut: [] }] } });
    assert.equal(controller.refresh(), null);
    assert.match(controller.getState().error, /planner-elevation.js/);
  });

  for (const event of ['documentation', 'settings', 'page', 'dispose']) test(`saved-view pending exports respect ${event} change`, async () => {
    const { controller, runtime, change, views } = viewSetup();
    controller.refresh();
    let complete;
    runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
    const pending = controller.exportFiles('pdf');
    if (event === 'documentation') change({ documentation: { version: 1, views: views.map(item => ({ ...item, name: 'Changed same ID/revision' })), sheets: [] } }, false);
    if (event === 'settings') controller.setSettings({ viewId: 'view-c' });
    if (event === 'page') controller.setSettings({ pageIndex: 1 });
    if (event === 'dispose') controller.dispose();
    complete(new Uint8Array([1]));
    const output = await pending;
    if (event === 'page') {
      assert.equal(output.outputs.length, 1); assert.equal(output.isCurrent(), true);
    } else { assert.equal(output, null); assert.deepEqual(controller.getState().outputs, []); }
  });

  test('mounted view report hides floor controls, presents saved scale and never renders on route or discipline selection', async () => {
    const { controller: unused, planner, runtime, captures } = viewSetup(); unused.dispose();
    const { host, document, find, urls, revoked } = drawingDocument(planner, runtime);
    const ui = UI.mount(document);
    const discipline = document.getElementById('hp-drawing-discipline');
    discipline.value = 'views'; await discipline.dispatch('change');
    assert.equal(captures.length, 0);
    document.body.dataset = { workspace: 'report', workspaceSection: 'drawings' };
    await document.dispatch('homeplanner:workspace-change'); assert.equal(captures.length, 0);
    assert.equal(find(host, node => node.htmlFor === 'hp-drawing-floorId').hidden, true);
    assert.equal(find(host, node => node.htmlFor === 'hp-drawing-viewId').hidden, false);
    assert.match(find(host, node => /overrides Report fallback/.test(node.textContent || '')).textContent, /1:75.*1:100/);
    assert.equal(document.getElementById('hp-drawing-scope').children[0].textContent, 'Selected view');
    assert.match(document.getElementById('hp-drawing-scope').children[1].textContent, /All saved/);
    ui.refresh();
    const oldURL = urls[0], page = document.getElementById('hp-drawing-pageIndex');
    page.value = '1'; await page.dispatch('change');
    assert.equal(captures.length, 1); assert.ok(revoked.includes(oldURL));
    assert.match(find(host, node => node.tagName === 'IMG').alt, /1:75/);
    ui.dispose(); assert.deepEqual(new Set(urls), new Set(revoked));
  });

  test('real multi-floor multi-view continuations export one actual local PDF in saved-view order and reject same-ID replacement', async () => {
    const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
    const Model = require('../planner-model.js'), Drawing = require('../planner-drawing.js');
    const Elevation = require('../planner-elevation.js'), Export = require('../planner-drawing-export.js');
    const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
    const doc = createFixture('multiple-floors').project;
    for (const floor of doc.floors) {
      floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
      floor.authored = Model.emptyAuthored();
      floor.authored.structural = Array.from({ length: 18 }, (_, index) => ({
        id: `${floor.id}:authored:12345678-1234-4321-8123-1234567890${String(index).padStart(2, '0')}`,
        kind: 'column', label: `Column ${index}`, anchors: [{ kind: 'point', floorId: floor.id, point: { x: 2, y: 2, z: 0 } }],
        widthM: null, depthM: null, heightM: null, material: null, sizeSource: 'unspecified', reference: null
      }));
    }
    doc.legacy = JSON.parse(JSON.stringify(doc.floors[0].legacy));
    doc.documentation = { version: 1, sheets: [], views: [
      { id: 'east-upper', name: 'East', kind: 'elevation', direction: 'E', floorId: 'upper', scaleDenominator: 75, cut: [] },
      { id: 'cut-ground', name: 'Finite cut', kind: 'section', direction: null, floorId: 'ground', scaleDenominator: 100,
        cut: [0, 8].map(x => ({ kind: 'point', floorId: 'ground', point: { x, y: 2, z: 0 } })) },
      { id: 'west-upper', name: 'West', kind: 'elevation', direction: 'W', floorId: 'upper', scaleDenominator: null, cut: [] }
    ] };
    const planner = controllerFor(doc), captures = [], batches = [];
    let pdfPages;
    const runtime = { Blob, HomePlannerDrawing: Drawing,
      HomePlannerElevation: { ...Elevation, createSheets(scene, options) {
        const sheets = Elevation.createSheets(scene, options); batches.push({ scene, options, sheets }); return sheets;
      } },
      HomePlannerDrawingExport: { async pdfBytes(sheets) { pdfPages = sheets; return Export.pdfBytes(sheets); } } };
    const controller = UI.createController({ ...planner, getDrawingScene() { const scene = planner.getDrawingScene(); captures.push(scene); return scene; } }, runtime);
    controller.setSettings({ discipline: 'views', scope: 'all', paper: 'A2' });
    const before = planner.exportProject();
    const result = await controller.exportFiles('pdf'); assert.ok(result, controller.getState().error);
    assert.equal(captures.length, 1); assert.equal(batches.length, 3);
    assert.ok(batches.every(batch => batch.scene === captures[0] && batch.sheets.length > 1));
    assert.deepEqual(batches.map(batch => batch.options.viewId), ['east-upper', 'cut-ground', 'west-upper']);
    assert.deepEqual(pdfPages, batches.flatMap(batch => batch.sheets));
    const pdf = await PDF.PDFDocument.load(await result.outputs[0].blob.arrayBuffer());
    assert.equal(pdf.getPageCount(), pdfPages.length);
    assert.equal(planner.exportProject(), before);
    let complete;
    runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
    const pending = controller.exportFiles('pdf');
    const replacement = JSON.parse(before); replacement.documentation.views[0].direction = 'N';
    planner.replaceProject(replacement); complete(new Uint8Array([1]));
    assert.equal(await pending, null); assert.equal(result.isCurrent(), false);
    assert.deepEqual(controller.getState().outputs, []);
    controller.dispose();
  });

test('saved-view filenames distinguish separate selected-view exports even after long-name sanitization/truncation', async () => {
  const { controller, change, views } = viewSetup();
  change({ documentation: { version: 1, sheets: [], views: views.map(item => ({ ...item, name: 'X'.repeat(150) })) } });
  const names = [];
  for (const viewId of ['view-a', 'view-b', 'view-c']) {
    controller.setSettings({ viewId });
    const result = await controller.exportFiles('pdf'); assert.ok(result, controller.getState().error);
    names.push(result.outputs[0].name);
  }
  assert.equal(new Set(names).size, 3);
  names.forEach(name => assert.match(name, /views-view-\d/));
});

test('saved-view PNG same-identity replacement during continuation rasterization publishes no partial files', async () => {
  const { controller, runtime, change, views } = viewSetup();
  controller.setSettings({ scope: 'all' });
  let complete, count = 0;
  runtime.HomePlannerDrawingExport.pngBlob = async () => {
    if (++count === 2) return new Promise(resolve => { complete = resolve; });
    return new Blob(['png']);
  };
  const pending = controller.exportFiles('png');
  await Promise.resolve();
  assert.equal(typeof complete, 'function');
  change({ documentation: { version: 1, sheets: [], views: views.map(item => ({ ...item, name: 'Replacement' })) } });
  complete(new Blob(['png']));
  assert.equal(await pending, null);
  assert.deepEqual(controller.getState().outputs, []);
});
