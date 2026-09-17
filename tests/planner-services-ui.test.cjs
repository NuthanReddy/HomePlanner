const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../planner-services-ui.js');
const Report = require('../planner-drawing-ui.js');
const Model = require('../planner-model.js');
const Services = require('../planner-services.js');
const Drawing = require('../planner-drawing.js');
const ServicesDrawing = require('../planner-services-drawing.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const point = (floorId = 'ground', x = 2, y = 2, z = 0) => ({ kind: 'point', floorId, point: { x, y, z } });
const pair = (floorId, entityId) => JSON.stringify([floorId, entityId]);
const fixture = (id = 'ground:authored:unknown') => ({ id, kind: 'equipment', anchor: null, widthM: null, depthM: null, heightM: null });
const node = (floorId, id, extra = {}) => ({ id: `${floorId}:authored:${id}`, kind: 'junction', system: 'water',
  anchor: point(floorId), diameterMm: null, invertM: null, ...extra });
function setup(subscribed = true) {
  const doc = createFixture('multiple-floors').project;
  for (const floor of doc.floors) {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
    floor.authored = Model.emptyAuthored();
  }
  doc.legacy = copy(doc.floors[0].legacy);
  doc.floors[0].authored.fixtures.push(fixture());
  doc.floors[0].authored.annotations.push({ id: 'ground:authored:keep-note', text: 'Keep documentation', anchor: null });
  doc.documentation = { version: 1, views: [], sheets: [] };
  const planner = controllerFor(doc), captures = [], builds = [], sheets = [];
  const bridge = { ...planner, subscribe: subscribed ? planner.subscribe : undefined,
    getDrawingScene() { const scene = planner.getDrawingScene(); captures.push(scene); return scene; } };
  const runtime = { Blob, crypto: require('node:crypto').webcrypto, HomePlannerDrawing: Drawing,
    HomePlannerServices: { build(scene, options) { builds.push({ scene, options }); return Services.build(scene, options); } },
    HomePlannerServicesDrawing: { ...ServicesDrawing,
      createSheets(scene, options) { sheets.push({ scene, options }); return ServicesDrawing.createSheets(scene, options); } },
    HomePlannerDrawingExport: { pdfBytes: async () => new Uint8Array([37, 80, 68, 70]),
      pngBlob: async () => new Blob(['png'], { type: 'image/png' }) } };
  const ui = UI.createController(bridge, runtime); ui.setPreviewSettings({ paper: 'A2' });
  return { planner, bridge, ui, runtime, captures, builds, sheets };
}
function saved(ui) { const value = ui.save(); assert.ok(value, ui.getState().error); return value; }
function makeFixture(ui) {
  ui.select('fixtures'); ui.setDraft({ kind: 'basin', x: '3', y: '4', z: '.8', widthM: '.6', depthM: '.45', heightM: '' }); return saved(ui);
}
function makeNetwork(ui, planner) {
  const basin = makeFixture(ui);
  ui.select('serviceNodes'); ui.setDraft({ kind: 'fixture', role: 'port', circuit: 'cold', anchorMode: 'fixture',
    fixtureRef: pair('ground', basin.id), label: 'Basin cold port', diameterMm: '15', invertM: '' });
  const port = saved(ui);
  planner.execute({ type: 'select-floor', id: 'upper' });
  ui.select('serviceNodes'); ui.setDraft({ kind: 'supply', role: 'supply', circuit: 'cold', label: 'Upper supply',
    x: '3', y: '4', z: '1.2', diameterMm: '25' });
  const supply = saved(ui);
  planner.execute({ type: 'select-floor', id: 'ground' });
  ui.select('serviceRoutes'); ui.setDraft({ system: 'water', circuit: 'cold', from: pair('upper', supply.id),
    to: pair('ground', port.id), label: 'Proposed supply → basin', diameterMm: '15', slope: '', waypoints: '3, 4, 1.4\n3, 4, 1' });
  const route = saved(ui);
  return { basin, port, supply, route };
}
test('blank authoring does not invent coordinates, fixture ports, physical values or analysis', () => {
  const { ui, planner, captures } = setup();
  for (const field of ['x', 'y', 'z', 'widthM', 'diameterMm', 'invertM', 'slope', 'role', 'circuit'])
    assert.equal(ui.getState().draft[field], '');
  assert.equal(ui.getState().engineeringStatus, 'not-assessed');
  makeFixture(ui);
  assert.equal(planner.getProject().floors[0].authored.serviceNodes.length, 0);
  assert.equal(captures.length, 0);
  assert.equal(ui.getState().dirty, false);
  ui.setDraft({ widthM: '.8' }); assert.equal(ui.getState().dirty, true);
  assert.equal(planner.getProject().floors[0].authored.fixtures[1].widthM, .6);
});
test('real bridge fixture, explicit port and directed cross-floor water route CRUD preserve others and JSON history', () => {
  const { ui, planner } = setup(), docs = copy(planner.getProject().documentation);
  const { basin, port, supply, route } = makeNetwork(ui, planner);
  assert.match(basin.id, /^ground:authored:[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(basin.heightM, null);
  assert.deepEqual(port.anchor, { kind: 'entity', entityKind: 'fixture', floorId: 'ground', entityId: basin.id });
  assert.deepEqual(route.from, { floorId: 'upper', entityId: supply.id });
  assert.deepEqual(route.to, { floorId: 'ground', entityId: port.id });
  assert.equal(route.slope, null);
  assert.deepEqual(route.via, [point('ground', 3, 4, 1.4), point('ground', 3, 4, 1)]);
  ui.setDraft({ label: 'Updated route', diameterMm: '20' }); const update = saved(ui);
  assert.equal(update.id, route.id);
  planner.undo(); assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], route);
  planner.redo(); assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], update);
  assert.equal(ui.deleteSelected(), null); assert.match(ui.getState().error, /Confirm deletion/);
  assert.equal(ui.deleteSelected({ confirmed: true }), true);
  planner.undo(); assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], update);
  planner.redo(); assert.equal(planner.getProject().floors[0].authored.serviceRoutes.length, 0);
  planner.undo();
  const imported = controllerFor(Model.createProject()); imported.importProject(planner.exportProject());
  assert.deepEqual(imported.getProject(), planner.getProject());
  assert.deepEqual(planner.getProject().floors[0].authored.fixtures[0], fixture());
  assert.deepEqual(planner.getProject().documentation, docs);
  assert.equal(planner.getProject().floors[0].authored.annotations[0].text, 'Keep documentation');
});
test('duplicate floor remaps exact internal refs while keeping external endpoint floor and fixture identity', () => {
  const { ui, planner } = setup();
  const { basin, port, supply, route } = makeNetwork(ui, planner);
  planner.execute({ type: 'add-floor', copyFromId: 'ground', name: 'Copied plumbing' });
  const duplicate = planner.getProject().floors.find(f => f.id === planner.getProject().activeFloorId);
  const copiedPort = duplicate.authored.serviceNodes.find(n => n.label === port.label), copiedRoute = duplicate.authored.serviceRoutes[0];
  assert.equal(copiedPort.anchor.floorId, duplicate.id);
  assert.equal(copiedPort.anchor.entityId, duplicate.authored.fixtures.find(f => f.kind === basin.kind).id);
  assert.deepEqual(copiedRoute.from, { floorId: 'upper', entityId: supply.id });
  assert.deepEqual(copiedRoute.to, { floorId: duplicate.id, entityId: copiedPort.id });
  assert.deepEqual(route.from, copiedRoute.from);
});
test('deleted node leaves dangling route reference selected, never accidentally replaced by first option', () => {
  const { ui, planner } = setup(), { route, port } = makeNetwork(ui, planner);
  ui.select('serviceNodes', port.id); ui.deleteSelected({ confirmed: true });
  ui.select('serviceRoutes', route.id);
  assert.equal(ui.getState().draft.to, pair('ground', port.id));
  ui.setDraft({ label: 'Retain dangling endpoint for repair' }); const updated = saved(ui);
  assert.deepEqual(updated.to, route.to);
  assert.ok(ui.refresh(), ui.getState().error);
  assert.ok(ui.getState().findings.some(f => f.code === 'dangling-node'));
  assert.equal(planner.getProject().floors[0].authored.serviceRoutes.length, 1);
});
test('metadata edits preserve null, wall, cross-floor entity and point anchors; absent optional fields stay absent', () => {
  const { ui, planner } = setup();
  const wall = planner.getScene().walls[0];
  const anchors = [null, { kind: 'wall', floorId: 'ground', entityId: wall.id, offsetM: 0, heightM: 0 },
    { kind: 'entity', entityKind: 'fixture', floorId: 'upper', entityId: 'upper:authored:missing' }, point('upper', 1, 2, 3)];
  for (let i = 0; i < anchors.length; i++) {
    const record = node('ground', `old-${i}`, { anchor: anchors[i] });
    planner.execute({ type: 'upsert-authored', collection: 'serviceNodes', value: record });
    ui.select('serviceNodes', record.id); ui.setDraft({ label: 'Only metadata' });
    assert.deepEqual(saved(ui), { ...record, label: 'Only metadata' });
    assert.equal(Object.hasOwn(saved(ui), 'role'), false);
  }
});
test('raw unknown endpoint pairs and mixed via host anchors require explicit replacement, not metadata edits', () => {
  const { ui, planner } = setup();
  const a = node('ground', 'a'), b = node('upper', 'b');
  planner.execute({ type: 'upsert-authored', collection: 'serviceNodes', value: a });
  planner.execute({ type: 'select-floor', id: 'upper' }); planner.execute({ type: 'upsert-authored', collection: 'serviceNodes', value: b });
  planner.execute({ type: 'select-floor', id: 'ground' });
  const route = { id: 'ground:authored:old-route', system: 'water',
    from: { floorId: 'upper', entityId: a.id }, to: { floorId: 'ground', entityId: 'ground:authored:missing' },
    via: [null, point('upper'), { kind: 'entity', entityKind: 'fixture', floorId: 'ground', entityId: 'ground:authored:missing' }],
    diameterMm: null, slope: null };
  planner.execute({ type: 'upsert-authored', collection: 'serviceRoutes', value: route });
  ui.select('serviceRoutes', route.id); ui.setDraft({ label: 'Repair pending', waypoints: '9,9,9' });
  const updated = saved(ui); assert.deepEqual(updated, { ...route, label: 'Repair pending' });
  assert.equal(ui.getState().draft.from, pair('upper', a.id));
  ui.setDraft({ from: pair('ground', a.id), to: pair('upper', b.id), replaceWaypoints: true, waypoints: '1, 2, 3' });
  const repaired = saved(ui); assert.deepEqual(repaired.from, { floorId: 'ground', entityId: a.id });
  assert.deepEqual(repaired.via, [point('ground', 1, 2, 3)]);
});
test('explicit fixture anchor can target another floor; point replacement remains owner-floor local', () => {
  const { ui, planner } = setup(); const basin = makeFixture(ui);
  planner.execute({ type: 'select-floor', id: 'upper' }); ui.select('serviceNodes');
  ui.setDraft({ role: 'port', anchorMode: 'fixture', fixtureRef: pair('ground', basin.id) });
  const port = saved(ui); assert.equal(port.anchor.floorId, 'ground');
  ui.setDraft({ replaceAnchors: true, anchorMode: 'point', x: '1', y: '2', z: '3' });
  assert.deepEqual(saved(ui).anchor, point('upper', 1, 2, 3));
});
for (const patch of [{ x: '' }, { y: 'NaN' }, { z: 'Infinity' }, { widthM: '0' }, { depthM: '-1' }, { heightM: '1e10' }])
  test(`invalid fixture draft is atomic: ${JSON.stringify(patch)}`, () => {
    const { ui, planner } = setup();
    ui.setDraft({ x: '1', y: '2', z: '3', ...patch }); const before = planner.exportProject();
    assert.equal(ui.save(), null); assert.ok(ui.getState().error); assert.equal(planner.exportProject(), before);
  });
for (const patch of [{ role: 'supply' }, { circuit: 'soil' }, { diameterMm: '0' }, { invertM: 'no' }, { label: 'bad\ntext' },
  { anchorMode: 'fixture', fixtureRef: pair('upper', 'ground:authored:unknown') }])
  test(`invalid node role, system, numeric or exact-pair anchor is atomic: ${JSON.stringify(patch)}`, () => {
    const { ui, planner } = setup(); ui.select('serviceNodes');
    ui.setDraft({ x: '1', y: '2', z: '3', ...patch }); const before = planner.exportProject();
    assert.equal(ui.save(), null); assert.ok(ui.getState().error); assert.equal(planner.exportProject(), before);
  });
test('role mapping is strict while water/waste circuit unknowns stay null', () => {
  const { ui } = setup();
  for (const [kind, role] of [['fixture', 'trap'], ['junction', 'stack'], ['junction', 'valve'], ['junction', 'cleanout'], ['supply', 'supply'], ['outlet', 'outlet']]) {
    ui.select('serviceNodes'); ui.setDraft({ kind, role, system: kind === 'outlet' ? 'waste' : 'water', x: '1', y: '2', z: '3' });
    const n = saved(ui); assert.equal(n.role, role); assert.equal(n.circuit, null);
  }
});
test('malformed waypoint triples and negative slopes fail without a partial update', () => {
  const { ui, planner } = setup(); makeNetwork(ui, planner);
  for (const patch of [{ waypoints: '1,2', replaceWaypoints: true }, { waypoints: '1,,3', replaceWaypoints: true },
    { waypoints: '1,2,3\n', slope: '-.01', replaceWaypoints: true }]) {
    ui.setDraft(patch); const before = planner.exportProject();
    assert.equal(ui.save(), null); assert.equal(planner.exportProject(), before);
  }
});
test('selection/workspace sync preserves drafts, floor switch parks them and no edit auto-refreshes', () => {
  const { ui, planner, captures } = setup(); makeFixture(ui);
  ui.setDraft({ widthM: '.75' }); planner.select({ kind: 'room', id: 'ground:living' }); ui.sync();
  assert.equal(ui.getState().draft.widthM, '.75'); assert.equal(ui.getState().dirty, true);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().draft.widthM, ''); assert.equal(ui.getState().selectedId, '');
  assert.equal(captures.length, 0);
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.equal(ui.getState().draft.widthM, '.75'); assert.equal(ui.getState().dirty, true);
});
test('refresh uses one scene for core/renderer, raw schedule ignores filters, and cached page selection never rebuilds', () => {
  const { ui, planner, captures, builds, sheets } = setup(); makeNetwork(ui, planner);
  const before = planner.exportProject();
  ui.setPreviewSettings({ view: 'riser', plumbingSystem: 'water', units: 'imperial', paper: 'A2', orientation: 'portrait', scaleDenominator: 75 });
  assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(captures.length, 1); assert.equal(builds[0].scene, captures[0]); assert.equal(sheets[0].scene, captures[0]);
  assert.deepEqual(builds[0].options, { systems: ['water'] });
  assert.deepEqual(sheets[0].options, { view: 'riser', floorId: 'ground', floorName: 'Ground floor', systems: ['water'],
    units: 'imperial', paper: 'A2', orientation: 'portrait', scaleDenominator: 75 });
  assert.equal(ui.getState().preview.sheet.widthMm, 420);
  assert.equal(ui.getState().preview.sheet.heightMm, 594);
  assert.equal(ui.getState().preview.sheet.metadata.scaleDenominator, 75);
  const total = ui.getState().preview.pageCount;
  ui.setPreviewSettings({ pageIndex: total - 1 }); assert.equal(captures.length, 1);
  assert.equal(ui.getState().engineeringStatus, 'not-assessed');
  ui.setPreviewSettings({ plumbingSystem: 'waste' }); assert.equal(ui.getState().preview, null);
  assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(ui.getState().schedule.serviceNodes.length, 1);
  assert.equal(ui.getState().schedule.serviceRoutes.length, 1);
  assert.equal(ui.getState().schedule.fixtures.length, 2);
  assert.equal(planner.exportProject(), before);
});
for (const subscribed of [true, false]) test(`same ID/revision replacement invalidates plumbing results by fingerprint (${subscribed})`, () => {
  const { ui, planner } = setup(subscribed); makeFixture(ui); assert.ok(ui.refresh(), ui.getState().error);
  const project = copy(planner.getProject()), before = project.revision;
  project.floors[0].authored.fixtures[0].widthM = .8; planner.replaceProject(project); ui.sync();
  assert.equal(planner.getProject().revision, before); assert.equal(ui.getState().preview, null); assert.equal(ui.getState().stale, true);
});
test('browser entry point exposes mount, accessible native authoring and bounded zoom without HTML injection', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'planner-services-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'planner-services-ui.css'), 'utf8');
  assert.match(source, /DOMContentLoaded/); assert.match(source, /workspacePlumbing/); assert.match(source, /host\.homePlannerServices = controller/);
  assert.match(source, /role', 'alert'/); assert.match(source, /optgroup/); assert.match(source, /revokeObjectURL/);
  assert.match(source, /PLATE-LOCAL/); assert.match(source, /one x,y,z triple per line/); assert.match(source, /'details'/);
  assert.match(source, /dataset\.drawingDiscipline = 'plumbing'/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage|fetch\(/);
  assert.match(css, /overflow: auto/); assert.match(css, /max-width: 600px/); assert.match(css, /data-zoom="full"/);
});

function plumbingDocument(planner, runtime) {
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.attributes = {};
      this.dataset = {}; this.value = ''; this.classList = { add() {} };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {}, ...event }); }
    focus() {}
  }
  const find = (node, predicate) => predicate(node) ? node : node.children.map(n => find(n, predicate)).find(Boolean);
  const host = new Element('section'), document = new Element('document'), urls = [], revoked = [];
  document.createElement = tag => new Element(tag);
  document.createTextNode = text => { const n = new Element('text'); n.textContent = text; return n; };
  document.getElementById = id => id === 'workspacePlumbing' ? host : find(host, n => n.id === id);
  document.defaultView = new Element('window');
  Object.assign(document.defaultView, runtime, { HomePlanner: planner, confirm: () => true,
    URL: { createObjectURL() { const url = `blob:plumbing-${urls.length}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); } } });
  return { host, document, urls, revoked, find };
}
test('mounted native fixture/node/route authoring, pending edits, missing refs, cached zoom and URL cleanup', () => {
  const { ui: unused, planner, bridge, runtime, captures } = setup(); unused.dispose();
  const { host, document, find, urls, revoked } = plumbingDocument(bridge, runtime);
  const ui = UI.mount(document), before = planner.exportProject();
  assert.equal(UI.mount(document), ui); assert.equal(host.homePlannerServices, ui);
  const field = name => document.getElementById(`hp-service-${name}`);
  const change = (name, value) => { const input = field(name); input.value = value; input.dispatch(input.tagName === 'SELECT' ? 'change' : 'input'); };
  const submit = () => find(host, n => n.tagName === 'FORM').dispatch('submit');
  change('x', '3'); change('y', '4'); change('z', '.8');
  assert.equal(planner.exportProject(), before, 'draft typing does not save');
  submit(); const basin = planner.getProject().floors[0].authored.fixtures.at(-1);
  assert.equal(basin.kind, 'basin'); assert.equal(field('x').disabled, true, 'saved anchor is protected until explicit replacement');
  change('collection', 'serviceNodes'); change('role', 'port'); change('anchorMode', 'fixture');
  change('fixtureRef', pair('ground', basin.id)); submit();
  const port = planner.getProject().floors[0].authored.serviceNodes[0]; assert.ok(port, ui.getState().error);
  assert.equal(field('fixtureRef').children.some(n => n.tagName === 'OPTGROUP'), true);
  change('collection', 'serviceRoutes'); change('from', pair('ground', port.id)); change('to', pair('ground', port.id)); submit();
  const route = planner.getProject().floors[0].authored.serviceRoutes[0]; assert.ok(route, ui.getState().error);
  assert.equal(captures.length, 0);
  planner.execute({ type: 'delete-authored', collection: 'serviceNodes', id: port.id });
  ui.select('serviceRoutes', route.id);
  assert.equal(field('to').value, pair('ground', port.id));
  assert.equal(field('to').children.at(-1).textContent, 'Unavailable reference — retained until explicitly repaired');
  change('label', 'Do not reset endpoint'); submit();
  assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0].to, route.to);
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  const preview = ui.getState().preview, firstURL = urls.at(-1), captureCount = captures.length;
  const zoom = field('zoom'); zoom.value = 'full'; zoom.dispatch('change');
  assert.equal(find(host, n => n.className === 'hp-service-preview').dataset.zoom, 'full');
  assert.equal(ui.getState().preview, preview); assert.equal(captures.length, captureCount);
  assert.equal(revoked.includes(firstURL), false);
  ui.setPreviewSettings({ pageIndex: 0 }); assert.ok(revoked.includes(firstURL));
  const lastURL = urls.at(-1); planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().selectedId, ''); assert.ok(revoked.includes(lastURL));
  const schedule = find(host, n => n.className === 'hp-service-table-region');
  assert.equal(schedule.tabIndex, 0); assert.equal(schedule.attributes.role, 'region');
  ui.dispose(); assert.equal(host.homePlannerServices, undefined);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
  assert.equal(new Set(revoked).size, urls.length);
});

test('legacy fixture entity anchor can be explicitly replaced using visible point coordinates', () => {
  const { ui, planner } = setup();
  const legacy = fixture('ground:authored:hosted-fixture');
  legacy.anchor = { kind: 'entity', floorId: 'upper', entityKind: 'fixture', entityId: 'upper:authored:missing' };
  planner.execute({ type: 'upsert-authored', collection: 'fixtures', value: legacy });
  ui.select('fixtures', legacy.id);
  assert.equal(ui.getState().draft.anchorMode, 'point');
  ui.setDraft({ replaceAnchors: true, x: '1', y: '2', z: '3' });
  assert.deepEqual(saved(ui).anchor, point('ground', 1, 2, 3));
});

test('shared drainage extension does not backfill new optional fields into new plumbing records', () => {
  const { ui, planner } = setup(); const { port, route } = makeNetwork(ui, planner);
  for (const key of ['groundM', 'finishedFloorM', 'levelSource', 'levelReference', 'accessRadiusM', 'discharge'])
    assert.equal(Object.hasOwn(port, key), false, key);
  for (const key of ['viaInvertsM', 'slopeSource', 'slopeReference', 'clearanceM'])
    assert.equal(Object.hasOwn(route, key), false, key);
  assert.equal(ui.getState().domain, 'plumbing');
  assert.equal(Object.hasOwn(ui.getState().previewSettings, 'drainageSystem'), false);
});

test('Report plumbing strict options, shared PDF/PNG pipeline and all-floor pages use one real scene', async () => {
  const { ui, planner, bridge, runtime, captures, sheets } = setup(); makeNetwork(ui, planner);
  const report = Report.createController(bridge, runtime), before = planner.exportProject();
  report.setSettings({ discipline: 'plumbing', scope: 'all', serviceView: 'riser', plumbingSystem: 'water',
    paper: 'A2', orientation: 'portrait', scaleDenominator: 75, units: 'imperial', pngDpi: 72 });
  let pages; runtime.HomePlannerDrawingExport.pdfBytes = async p => { pages = p; return new Uint8Array([37, 80, 68, 70]); };
  const output = await report.exportFiles('pdf'); assert.ok(output, report.getState().error);
  assert.equal(captures.length, 1); assert.equal(sheets.length, 2);
  assert.ok(sheets.every(s => s.scene === captures[0]));
  assert.ok(sheets.every(s => s.options.view === 'riser' && s.options.systems.length === 1 && !Object.hasOwn(s.options, 'layers')));
  assert.deepEqual([...new Set(pages.map(p => p.metadata.floorId))], ['ground', 'upper']);
  assert.ok(pages.every(p => p.widthMm === 420 && p.heightMm === 594 && p.metadata.scaleDenominator === 75));
  const densities = [];
  runtime.HomePlannerDrawingExport.pngBlob = async (sheet, options) => { densities.push(options.pixelsPerMm); return new Blob(['png']); };
  assert.ok(await report.exportFiles('png'), report.getState().error);
  assert.ok(densities.every(d => d === 72 / 25.4));
  assert.equal(planner.exportProject(), before); report.dispose();
});
test('Report cancels multi-page plumbing PNG on explicit cancel or same-revision replacement without publishing partial files', async () => {
  for (const reason of ['cancel', 'replace']) {
    const { ui, planner, bridge, runtime } = setup(); makeNetwork(ui, planner);
    const report = Report.createController(bridge, runtime);
    report.setSettings({ discipline: 'plumbing', scope: 'all', paper: 'A2' });
    let finish, starts = 0;
    runtime.HomePlannerDrawingExport.pngBlob = () => { starts++; return new Promise(resolve => { finish = resolve; }); };
    const pending = report.exportFiles('png'); assert.equal(report.getState().busy, true);
    if (reason === 'cancel') report.cancel();
    else { const replacement = copy(planner.getProject()); replacement.floors[0].authored.fixtures[0].depthM = .4; planner.replaceProject(replacement); }
    finish(new Blob(['png'])); assert.equal(await pending, null);
    assert.equal(starts, 1); assert.deepEqual(report.getState().outputs, []); report.dispose();
  }
});
