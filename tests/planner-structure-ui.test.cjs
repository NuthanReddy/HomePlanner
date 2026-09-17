const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../planner-structure-ui.js');
const Structure = require('../planner-structure.js');
const Drawing = require('../planner-drawing.js');
const StructureDrawing = require('../planner-structure-drawing.js');
const Model = require('../planner-model.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const point = (x = 2, y = 2, z = 0, floorId = 'ground') => ({ kind: 'point', floorId, point: { x, y, z } });
const record = (id = 'ground:authored:c1', anchors = [point()]) =>
  ({ id, kind: 'column', anchors, widthM: null, depthM: null, material: null });
function setup(records = [], doc = createFixture('multiple-floors').project, subscribed = true) {
  for (const floor of doc.floors) floor.legacy.context.plate.sitePlot ||= { x: -1, y: -2, w: 14, h: 14 };
  doc.legacy = copy(doc.floors.find(floor => floor.id === doc.activeFloorId).legacy);
  doc.floors[0].authored = Model.emptyAuthored();
  doc.floors[0].authored.annotations.push({ id: 'ground:authored:note', text: 'Keep this record', anchor: null });
  doc.floors[0].authored.structural = records;
  const planner = controllerFor(doc), calls = [];
  const runtime = { Blob, HomePlannerStructure: { build(scene) { calls.push(['build', scene]); return Structure.build(scene); } },
    HomePlannerDrawing: Drawing, HomePlannerStructureDrawing: {
      createSheet(scene, options) { calls.push(['sheet', scene]); return StructureDrawing.createSheet(scene, options); },
      toSVG: StructureDrawing.toSVG
    } };
  const ui = UI.createController({ ...planner, subscribe: subscribed ? planner.subscribe : undefined }, runtime);
  ui.setPreviewSettings({ paper: 'A2' });
  return { planner, ui, runtime, calls };
}
const list = planner => planner.getProject().floors[0].authored.structural;
const fill = ui => ui.setDraft({ startX: '2', startY: '2', startZ: '0', label: 'C-01', widthM: '.4', depthM: '.6', heightM: '3',
  sizeSource: 'authored', reference: '', material: '' });

test('new form does not invent coordinates, dimensions, materials or engineering values', () => {
  const { ui, calls } = setup();
  const state = ui.getState();
  for (const key of ['startX', 'startY', 'startZ', 'endX', 'widthM', 'depthM', 'heightM', 'material', 'reference'])
    assert.equal(state.draft[key], '');
  assert.equal(state.engineeringStatus, 'not-assessed');
  assert.equal(state.draft.sizeSource, 'unspecified');
  assert.equal(calls.length, 0);
  ui.setDraft({ label: 'Draft across workspaces' }); ui.sync();
  assert.equal(ui.getState().draft.label, 'Draft across workspaces');
  assert.equal(calls.length, 0);
});

test('real bridge create/update/delete Undo/Redo/JSON retain IDs and every other authored record', () => {
  const other = record('ground:authored:other'), { ui, planner, calls } = setup([other]);
  const annotations = copy(planner.getProject().floors[0].authored.annotations);
  fill(ui);
  const saved = ui.save();
  assert.ok(saved, ui.getState().error);
  assert.match(saved.id, /^ground:authored:.+/);
  assert.deepEqual(saved.anchors, [point()]);
  assert.equal(saved.material, null);
  assert.equal(saved.reference, null);
  assert.equal(list(planner).length, 2);
  assert.equal(calls.length, 0, 'save invalidates but never performs background coordination');
  ui.setDraft({ label: 'C-02', heightM: '3.2' });
  const updated = ui.save();
  assert.equal(updated.id, saved.id);
  assert.equal(updated.label, 'C-02');
  planner.undo(); assert.deepEqual(list(planner)[1], saved);
  planner.redo(); assert.deepEqual(list(planner)[1], updated);
  assert.equal(ui.deleteSelected(), null);
  assert.match(ui.getState().error, /Confirm deletion/);
  assert.equal(list(planner).length, 2);
  assert.equal(ui.deleteSelected({ confirmed: true }), true);
  assert.deepEqual(list(planner), [other]);
  planner.undo(); assert.deepEqual(list(planner), [other, updated]);
  planner.redo(); assert.deepEqual(list(planner), [other]);
  planner.undo();
  const imported = controllerFor(Model.createProject());
  imported.importProject(planner.exportProject());
  assert.deepEqual(imported.getProject(), planner.getProject());
  assert.deepEqual(planner.getProject().floors[0].authored.annotations, annotations);
});

test('metadata editing preserves existing hosted, cross-floor, null and unresolved anchors exactly', () => {
  const { planner, ui } = setup();
  const wall = planner.getScene().walls[0];
  const anchors = [
    { kind: 'wall', floorId: 'ground', entityId: wall.id, offsetM: 0, heightM: 0 },
    { kind: 'entity', floorId: 'ground', entityKind: 'room', entityId: 'ground:living' },
    { kind: 'entity', floorId: 'upper', entityKind: 'structural', entityId: 'upper:authored:missing' },
    point(3, 4, 1, 'upper'), null
  ];
  for (let index = 0; index < anchors.length; index++) {
    const old = record(`ground:authored:host-${index}`, [anchors[index]]);
    planner.execute({ type: 'upsert-authored', collection: 'structural', value: old });
    ui.select(old.id);
    ui.setDraft({ label: 'Metadata only' });
    const saved = ui.save();
    assert.ok(saved, ui.getState().error);
    assert.deepEqual(saved, { ...old, label: 'Metadata only' });
    assert.deepEqual(ui.getState().anchorSummary[0].authored, anchors[index]);
    assert.equal(Object.hasOwn(saved, 'heightM'), false, 'old absent metadata is not backfilled');
  }
});

test('anchor replacement and kind cardinality changes require explicit action and complete entered points', () => {
  const old = record('ground:authored:host', [null]), { ui, planner } = setup([old]);
  ui.select(old.id); ui.setDraft({ kind: 'beam' });
  assert.equal(ui.save(), null);
  assert.match(ui.getState().error, /explicit anchor replacement/);
  assert.deepEqual(list(planner), [old]);
  ui.setDraft({ replaceAnchors: true, startX: '1', startY: '2', startZ: '3', endX: '5', endY: '2' });
  assert.equal(ui.save(), null);
  assert.match(ui.getState().error, /end z.*required/);
  ui.setDraft({ endZ: '3' });
  const beam = ui.save();
  assert.ok(beam, ui.getState().error);
  assert.deepEqual(beam.anchors, [point(1, 2, 3), point(5, 2, 3)]);
});

for (const patch of [{ startX: '' }, { startZ: 'NaN' }, { startY: 'Infinity' }, { endX: '3', widthM: 'oops' },
  { depthM: '-1' }, { heightM: '0' }, { widthM: '1e10' }, { kind: 'roof' }, { material: 'bad\ntext' }, { sizeSource: 'verified' }])
  test(`invalid input is atomic: ${JSON.stringify(patch)}`, () => {
    const { ui, planner } = setup(); fill(ui);
    const before = planner.exportProject();
    ui.setDraft(patch);
    assert.equal(ui.save(), null);
    assert.ok(ui.getState().error);
    assert.equal(planner.exportProject(), before);
  });

test('beam height/grid material are rejected, not silently discarded; blank remains unknown', () => {
  const { ui, planner } = setup(); fill(ui);
  ui.setDraft({ kind: 'beam', endX: '5', endY: '2', endZ: '0' });
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /height must be blank/);
  ui.setDraft({ kind: 'grid', heightM: '', widthM: '', depthM: '', material: 'Unverified supplied text' });
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Grid width, depth and material must be blank/);
  ui.setDraft({ material: '' });
  const saved = ui.save();
  assert.ok(saved, ui.getState().error);
  assert.deepEqual([saved.widthM, saved.depthM, saved.heightM, saved.material], [null, null, null, null]);
  assert.equal(list(planner).length, 1);
});

test('selection and workspace navigation preserve draft; floor navigation parks it without rehosting', () => {
  const { planner, ui, calls } = setup([record()]);
  ui.select('ground:authored:c1'); ui.setDraft({ label: 'Unsaved' });
  planner.select({ kind: 'room', id: 'ground:living' }); ui.sync();
  assert.equal(ui.getState().draft.label, 'Unsaved');
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().selectedId, '');
  assert.equal(ui.getState().draft.label, '');
  assert.deepEqual(list(planner)[0].anchors, [point()]);
  assert.equal(calls.length, 0);
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.equal(ui.getState().selectedId, 'ground:authored:c1');
  assert.equal(ui.getState().draft.label, 'Unsaved');
});

test('refresh uses one scene for projected schedule, coordination and 2D; retains authored coordinate clarity', () => {
  const doc = createFixture('setback-plot').project;
  const { ui, planner, calls } = setup([record()], doc);
  const before = planner.exportProject();
  ui.select('ground:authored:c1');
  assert.ok(ui.refresh(), ui.getState().error);
  const state = ui.getState();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], calls[1][1]);
  assert.deepEqual(state.schedule[0].record.anchors, [point()]);
  const projected = calls[0][1].authored.find(entry => entry.collection === 'structural').anchors[0].point;
  assert.deepEqual(state.schedule[0].projected.anchors, [projected]);
  assert.notDeepEqual(projected, point().point, 'registered site/floor transforms are not form coordinates');
  assert.equal(state.schedule[0].projected.geometry, null, 'unknown dimensions never gain geometry');
  assert.ok(state.findings.some(item => item.code === 'engineering-not-assessed'));
  assert.ok(state.findings.some(item => item.code === 'unknown-dimensions'));
  assert.equal(state.anchorSummary[0].resolution.status, 'resolved');
  assert.equal(planner.exportProject(), before);
});

for (const subscribed of [true, false]) test(`same-ID/revision replacement invalidates stale structural data (${subscribed})`, () => {
  const { planner, ui } = setup([record()], createFixture('multiple-floors').project, subscribed);
  assert.ok(ui.refresh(), ui.getState().error);
  const replaced = copy(planner.getProject());
  replaced.floors[0].authored.structural[0].label = 'Replaced label';
  planner.replaceProject(replaced); ui.sync();
  assert.equal(ui.getState().preview, null);
  assert.equal(ui.getState().stale, true);
  assert.equal(ui.getState().schedule[0].record.label, 'Replaced label');
  assert.equal(ui.getState().schedule[0].projected, null);
});

test('missing renderer and fixed-scale fit errors preserve coordination, never shrink or invent preview', () => {
  const { ui, runtime } = setup([record()]);
  delete runtime.HomePlannerStructureDrawing;
  assert.equal(ui.refresh(), null);
  assert.match(ui.getState().error, /renderer unavailable/);
  assert.equal(ui.getState().stale, false);
  runtime.HomePlannerStructureDrawing = { createSheet() { throw new Error('Fixed scale does not fit paper'); }, toSVG() {} };
  assert.equal(ui.refresh(), null);
  assert.match(ui.getState().error, /does not fit/);
  assert.equal(ui.getState().preview, null);
  assert.equal(ui.getState().previewSettings.scaleDenominator, 100);
  ui.setPreviewSettings({ paper: 'A4' });
  assert.equal(ui.getState().previewSettings.paper, 'A4');
});

test('disposal stops project subscription and forbids edits or analysis', () => {
  const { ui, planner, calls } = setup();
  ui.dispose(); fill(ui);
  const before = planner.exportProject();
  assert.equal(ui.save(), null); assert.equal(ui.refresh(), null);
  assert.equal(planner.exportProject(), before);
  assert.equal(calls.length, 0);
});

test('DOM integration uses one mount, accessible explicit actions, scoped overflow and safe image-only SVG', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'planner-structure-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'planner-structure-ui.css'), 'utf8');
  assert.match(source, /getElementById\('workspaceStructure'\)/);
  assert.match(source, /host\.homePlannerStructure/);
  assert.match(source, /DOMContentLoaded/);
  assert.match(source, /role', 'alert'/);
  assert.match(source, /view\.confirm/);
  assert.match(source, /floor-relative plate-local/);
  assert.match(source, /site-local x\/y, project-relative z/);
  assert.match(source, /revokeObjectURL/);
  assert.match(source, /type = 'submit'/);
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|localStorage|setInterval|fetch\(/);
  assert.doesNotMatch(source, /type: 'set-authored'/);
  assert.match(css, /\.hp-structure.*overflow: auto/);
});

function documentFor(planner) {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {};
      this.listeners = new Map(); this.value = ''; this.style = {};
      this.classList = { add() {} };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {}, ...event }); }
  }
  const host = new Node('section'), document = new Node('document'), urls = [], revoked = [];
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  document.createElement = tag => new Node(tag);
  document.createTextNode = text => { const node = new Node('text'); node.textContent = text; return node; };
  document.getElementById = id => id === 'workspaceStructure' ? host : find(host, node => node.id === id);
  document.defaultView = new Node('window');
  Object.assign(document.defaultView, {
    HomePlanner: planner, HomePlannerStructure: Structure, HomePlannerDrawing: Drawing,
    HomePlannerStructureDrawing: StructureDrawing, Blob, confirm: () => true,
    URL: { createObjectURL() { const url = `blob:preview-${urls.length}`; urls.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } }
  });
  return { document, host, find, urls, revoked };
}

test('mounted workbench performs keyboard submission, explicit host replacement/deletion and lifecycle cleanup', () => {
  const { planner, ui: unused } = setup([record('ground:authored:host', [null])]);
  unused.dispose();
  const { document, host, find, urls, revoked } = documentFor(planner);
  const ui = UI.mount(document);
  assert.equal(UI.mount(document), ui);
  const input = id => document.getElementById(`hp-structure-${id}`);
  const change = (id, value) => {
    const node = input(id);
    if (id === 'replaceAnchors') node.checked = value; else node.value = value;
    node.dispatch(node.tagName === 'SELECT' || id === 'replaceAnchors' ? 'change' : 'input');
  };
  const form = find(host, node => node.tagName === 'FORM');
  change('selectedId', 'ground:authored:host');
  assert.equal(input('startX').disabled, true);
  change('label', 'Edited with keyboard');
  form.dispatch('submit');
  assert.deepEqual(list(planner)[0].anchors, [null]);
  assert.equal(list(planner)[0].label, 'Edited with keyboard');
  change('replaceAnchors', true);
  assert.equal(input('startX').disabled, false);
  for (const [key, value] of Object.entries({ startX: '2', startY: '2', startZ: '0' })) change(key, value);
  form.dispatch('submit');
  assert.deepEqual(list(planner)[0].anchors, [point()]);
  change('label', 'Unsaved workspace draft');
  document.dispatch('homeplanner:workspace-change');
  assert.equal(input('label').value, 'Unsaved workspace draft');
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(urls.length, 1);
  assert.ok(find(host, node => node.tagName === 'IMG'));
  change('replaceAnchors', true); change('startX', 'not numeric');
  form.dispatch('submit');
  const error = find(host, node => node.attributes.role === 'alert');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /finite/);
  const remove = find(host, node => node.tagName === 'BUTTON' && node.textContent === 'Delete selected element');
  document.defaultView.confirm = () => false; remove.dispatch('click');
  assert.equal(list(planner).length, 1);
  document.defaultView.confirm = () => true; remove.dispatch('click');
  assert.equal(list(planner).length, 0);
  assert.deepEqual(revoked, urls);
  document.defaultView.dispatch('pagehide', { persisted: true });
  assert.equal(host.homePlannerStructure, ui);
  document.defaultView.dispatch('pagehide', { persisted: false });
  assert.equal(host.homePlannerStructure, undefined);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
  const remounted = UI.mount(document);
  assert.notEqual(remounted, ui);
  remounted.dispose();
});

const ordinaryRecords = () => ['grid', 'column', 'beam', 'slab', 'footing'].map((kind, index) => ({
  id: `ground:authored:12345678-1234-4321-8123-12345678900${index}`, kind, label: kind,
  anchors: ['grid', 'beam'].includes(kind) ? [point(), point(5)] : [point()],
  widthM: null, depthM: null, heightM: null, material: kind === 'grid' ? null : 'Concrete', sizeSource: 'unspecified', reference: null
}));

test('real five-kind UUID workbench renders all pages from one scene without recomputing on page selection', () => {
  const { ui, planner, runtime, calls } = setup(ordinaryRecords());
  assert.equal(typeof StructureDrawing.createSheets, 'function');
  let pages, validations = 0, captures = 0;
  runtime.HomePlannerStructureDrawing.createSheets = (scene, options) => {
    calls.push(['sheets', scene]); captures++;
    pages = StructureDrawing.createSheets(scene, options); return pages;
  };
  runtime.HomePlannerDrawing = { ...Drawing, validateSheet(sheet) { validations++; return Drawing.validateSheet(sheet); } };
  const before = planner.exportProject();
  const state = ui.refresh();
  assert.ok(state, ui.getState().error);
  assert.equal(state.findings.length, 14);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], calls[1][1]);
  assert.equal(state.preview.pages, pages);
  assert.ok(pages.length > 1);
  assert.equal(validations, pages.length);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    ui.setPreviewSettings({ pageIndex });
    const current = ui.getState();
    assert.equal(current.preview.sheet, pages[pageIndex]);
    assert.equal(current.preview.svg, StructureDrawing.toSVG(pages[pageIndex]));
    assert.equal(current.preview.pageIndex, pageIndex);
    assert.equal(current.preview.pageCount, pages.length);
    assert.deepEqual(current.findings, state.findings);
    assert.equal(current.engineeringStatus, 'not-assessed');
    assert.equal(current.stale, false);
  }
  assert.equal(captures, 1);
  assert.equal(calls.length, 2, 'UI coordination and sheet factory each run once, not per page');
  assert.equal(validations, pages.length);
  ui.setPreviewSettings({ pageIndex: 100 });
  assert.equal(ui.getState().preview.pageIndex, pages.length - 1);
  assert.throws(() => ui.setPreviewSettings({ pageIndex: -1 }), /Unsupported/);
  assert.equal(planner.exportProject(), before);
  ui.setPreviewSettings({ paper: 'A3' });
  assert.equal(ui.getState().previewSettings.pageIndex, 0);
  assert.equal(ui.getState().preview, null);
  assert.ok(ui.refresh(), ui.getState().error);
  ui.setPreviewSettings({ pageIndex: 1 });
  const replacement = copy(planner.getProject());
  replacement.floors[0].authored.structural[0].label = 'Changed without a new revision';
  planner.replaceProject(replacement);
  ui.setPreviewSettings({ pageIndex: 1 });
  assert.equal(ui.getState().preview, null);
  assert.equal(ui.getState().stale, true);
  assert.deepEqual(ui.getState().findings, []);
  assert.ok(ui.refresh(), ui.getState().error);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().previewSettings.pageIndex, 0);
  assert.equal(ui.getState().preview, null);
  assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(ui.getState().preview.sheet.metadata.floorId, 'upper');
  ui.dispose();
});

test('workbench validates unseen continuation pages and rejects empty results without losing current coordination', () => {
  const { ui, runtime } = setup([record()]);
  runtime.HomePlannerStructureDrawing.createSheets = (scene, options) => [
    StructureDrawing.createSheet(scene, options), { version: 999 }
  ];
  assert.equal(ui.refresh(), null);
  assert.ok(ui.getState().error);
  assert.equal(ui.getState().preview, null);
  assert.equal(ui.getState().stale, false);
  runtime.HomePlannerStructureDrawing.createSheets = () => [];
  assert.equal(ui.refresh(), null);
  assert.match(ui.getState().error, /nonempty array/);
  assert.equal(ui.getState().preview, null);
});

test('mounted workbench page select preserves caveat/findings and revokes old-page URLs without reauthoring', () => {
  const { planner, ui: unused } = setup(ordinaryRecords()); unused.dispose();
  const { document, host, find, urls, revoked } = documentFor(planner);
  let builds = 0, sheetCalls = 0;
  document.defaultView.HomePlannerStructure = { build(scene) { builds++; return Structure.build(scene); } };
  document.defaultView.HomePlannerStructureDrawing = { ...StructureDrawing, createSheets(scene, options) {
    sheetCalls++; return StructureDrawing.createSheets(scene, options);
  } };
  const ui = UI.mount(document), select = document.getElementById('hp-structure-preview-pageIndex');
  const label = find(host, node => node.htmlFor === select.id);
  assert.equal(select.tagName, 'SELECT');
  assert.equal(label.hidden, true);
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(label.hidden, false); assert.equal(select.disabled, false);
  assert.equal(select.children.length, ui.getState().preview.pageCount);
  const options = [...select.children];
  const before = planner.exportProject(), findings = ui.getState().findings;
  select.value = '1'; select.dispatch('change');
  assert.deepEqual(select.children, options, 'retain native option nodes during keyboard page selection');
  assert.equal(ui.getState().preview.pageIndex, 1);
  assert.deepEqual(revoked, [urls[0]]);
  assert.equal(builds, 1); assert.equal(sheetCalls, 1);
  assert.match(find(host, node => node.tagName === 'IMG').alt, /Ground.*Page 2.*Engineering not assessed/);
  const caveat = find(host, node => node.className === 'hp-structure-warning');
  assert.match(caveat.textContent, /NOT ASSESSED/); assert.notEqual(caveat.hidden, true);
  assert.deepEqual(ui.getState().findings, findings);
  assert.equal(planner.exportProject(), before);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(label.hidden, true);
  assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(ui.getState().preview.pageCount, 1);
  assert.equal(select.disabled, true);
  ui.dispose();
  assert.deepEqual(new Set(revoked), new Set(urls));
  assert.equal(revoked.length, urls.length);
});
