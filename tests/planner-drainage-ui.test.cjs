const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../planner-drainage-ui.js');
const Shared = require('../planner-services-ui.js');
const Model = require('../planner-model.js');
const Drainage = require('../planner-drainage.js');
const Drawing = require('../planner-drawing.js');
const DrainageDrawing = require('../planner-drainage-drawing.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const pair = (floorId, entityId) => JSON.stringify([floorId, entityId]);
const point = (floorId = 'ground', x = 2, y = 2, z = 0) => ({ kind: 'point', floorId, point: { x, y, z } });
function setup(subscribed = true) {
  const doc = createFixture('multiple-floors').project;
  for (const floor of doc.floors) {
    floor.authored = Model.emptyAuthored();
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
  }
  doc.legacy = copy(doc.floors[0].legacy);
  const planner = controllerFor(doc), captures = [], builds = [], sheets = [];
  const bridge = { ...planner, subscribe: subscribed ? planner.subscribe : undefined,
    getDrawingScene() { const scene = planner.getDrawingScene(); captures.push(scene); return scene; } };
  const runtime = { Blob, crypto: require('node:crypto').webcrypto, HomePlannerDrawing: Drawing,
    HomePlannerDrainage: { build(scene, options) { builds.push({ scene, options }); return Drainage.build(scene, options); } },
    HomePlannerDrainageDrawing: { ...DrainageDrawing,
      createSheets(scene, options) { sheets.push({ scene, options }); return DrainageDrawing.createSheets(scene, options); } } };
  const ui = UI.createController(bridge, runtime);
  return { planner, bridge, runtime, ui, captures, builds, sheets };
}
function save(ui) { const value = ui.save(); assert.ok(value, ui.getState().error); return value; }
function addNode(ui, patch = {}) {
  ui.select('serviceNodes'); ui.setDraft({ x: '2', y: '2', z: '0', ...patch }); return save(ui);
}
function network(ui) {
  const a = addNode(ui, { role: 'floor-trap', circuit: 'waste', invertM: '-.2', groundM: '0', finishedFloorM: '.1',
    levelSource: 'surveyed', levelReference: 'Unverified survey note', accessRadiusM: '.5' });
  const b = addNode(ui, { kind: 'outlet', role: 'outfall', circuit: 'waste', x: '4', invertM: '-.4' });
  ui.select('serviceRoutes');
  ui.setDraft({ circuit: 'waste', from: pair('ground', a.id), to: pair('ground', b.id), waypoints: '3,2,0',
    viaInvertsM: '-.3', slope: '.1', slopeSource: 'assumed', slopeReference: 'Review only', clearanceM: '.1' });
  return { a, b, route: save(ui) };
}
test('drainage domain defaults once without invented geometry, levels, circuits or automatic analysis', () => {
  const { ui, planner, captures } = setup();
  assert.equal(ui.getState().domain, 'drainage'); assert.equal(ui.getState().draft.system, 'waste');
  for (const key of ['x', 'y', 'z', 'invertM', 'groundM', 'finishedFloorM', 'levelSource', 'accessRadiusM', 'dischargeKind', 'circuit'])
    assert.equal(ui.getState().draft[key], '');
  assert.equal(ui.save(), null);
  const n = addNode(ui);
  for (const key of ['invertM', 'groundM', 'finishedFloorM', 'levelSource', 'levelReference', 'accessRadiusM']) assert.equal(n[key], null);
  assert.equal(Object.hasOwn(n, 'discharge'), false);
  assert.equal(n.circuit, null);
  assert.equal(planner.getProject().floors[0].authored.serviceNodes.length, 1);
  assert.equal(captures.length, 0);
  ui.setDraft({ system: 'rain', role: 'roof-outlet', circuit: 'storm' });
  ui.sync(); assert.equal(ui.getState().draft.system, 'rain');
  const rain = save(ui); assert.equal(rain.circuit, 'storm');
});
test('explicit drainage purposes use correct base kinds; levels remain independent on unequal floors', () => {
  const { ui, planner } = setup();
  planner.execute({ type: 'select-floor', id: 'upper' });
  for (const [kind, role, system, circuit] of [
    ['fixture', 'floor-trap', 'waste', 'soil'], ['fixture', 'gully-trap', 'waste', 'waste'],
    ['junction', 'chamber', 'waste', 'waste'], ['fixture', 'roof-outlet', 'rain', 'storm'],
    ['junction', 'downpipe', 'rain', 'storm'], ['outlet', 'outfall', 'rain', 'storm'],
    ['junction', 'stack', 'waste', 'vent']
  ]) {
    const node = addNode(ui, { kind, role, system, circuit, z: '2', invertM: '-2', groundM: '-1.2',
      finishedFloorM: '0', levelSource: 'engineer-provided', levelReference: 'Claim only', accessRadiusM: '0' });
    assert.equal(node.kind, kind); assert.equal(node.role, role); assert.equal(node.system, system);
    assert.equal(node.anchor.floorId, 'upper'); assert.equal(node.anchor.point.z, 2);
    assert.equal(node.invertM, -2); assert.equal(node.groundM, -1.2); assert.equal(node.finishedFloorM, 0);
    assert.equal(node.accessRadiusM, 0);
  }
  ui.setDraft({ kind: 'fixture', role: 'downpipe' });
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Role is incompatible/);
});
test('outlet destination unknown never means sewer and kind changes require explicit metadata repair', () => {
  const { ui, planner } = setup();
  const outlet = addNode(ui, { kind: 'outlet', role: 'outfall' }); assert.equal(outlet.discharge, null);
  ui.setDraft({ dischargeKind: 'soakaway', dischargeReference: 'Unverified destination' });
  const original = save(ui); assert.deepEqual(original.discharge, { kind: 'soakaway', reference: 'Unverified destination' });
  ui.setDraft({ kind: 'junction', role: 'chamber' }); const before = planner.exportProject();
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Discharge belongs only/); assert.equal(planner.exportProject(), before);
  ui.setDraft({ dischargeKind: '', dischargeReference: '' });
  assert.equal(ui.save(), null, 'even retained null is invalid on non-outlet');
  ui.setDraft({ removeDischarge: true }); const repaired = save(ui);
  assert.equal(Object.hasOwn(repaired, 'discharge'), false);
  ui.setDraft({ kind: 'outlet', role: 'outfall', dischargeReference: 'No kind' });
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /requires an explicit discharge kind/);
});
test('metadata edits retain optional absence, null/hosted anchors, unknown endpoints and drainage fields in plumbing', () => {
  const { planner, runtime } = setup();
  const drainage = UI.createController(planner, runtime), plumbing = Shared.createController(planner, runtime);
  const base = { id: 'ground:authored:legacy', system: 'waste', kind: 'fixture', role: 'gully-trap',
    anchor: null, diameterMm: null, invertM: null, groundM: -2, levelSource: 'assumed', levelReference: 'Keep', accessRadiusM: 0 };
  planner.execute({ type: 'upsert-authored', collection: 'serviceNodes', value: base });
  for (const ui of [drainage, plumbing]) {
    ui.select('serviceNodes', base.id); ui.setDraft({ label: 'Only metadata' });
    assert.deepEqual(save(ui), { ...base, label: 'Only metadata' });
    assert.equal(Object.hasOwn(save(ui), 'finishedFloorM'), false);
    const state = ui.getState(); state.selectedRecord.levelReference = 'Not persisted';
    assert.equal(planner.getProject().floors[0].authored.serviceNodes[0].levelReference, 'Keep');
  }
  const r = { id: 'ground:authored:legacy-route', system: 'waste', circuit: 'waste',
    from: { floorId: 'upper', entityId: base.id }, to: { floorId: 'ground', entityId: 'missing' },
    via: [null, point('upper')], viaInvertsM: [null, -2], slope: null, diameterMm: null,
    slopeSource: 'surveyed', slopeReference: 'Keep slope note', clearanceM: .25 };
  planner.execute({ type: 'upsert-authored', collection: 'serviceRoutes', value: r });
  for (const ui of [drainage, plumbing]) {
    ui.select('serviceRoutes', r.id); ui.setDraft({ label: 'Retained', waypoints: '7,7,7' });
    assert.deepEqual(save(ui), { ...r, label: 'Retained' });
    assert.equal(ui.getState().draft.from, pair('upper', base.id));
    assert.equal(ui.getState().draft.viaInvertsM, '?\n-2');
  }
});
test('waypoint replacement cannot silently reapply, drop or misalign existing invert levels in either workbench', () => {
  for (const usePlumbing of [false, true]) {
    const { ui: drain, planner, runtime } = setup(), { route } = network(drain);
    const ui = usePlumbing ? Shared.createController(planner, runtime) : drain;
    ui.select('serviceRoutes', route.id);
    ui.setDraft({ replaceWaypoints: true, waypoints: '8,9,2' });
    const before = planner.exportProject();
    assert.equal(ui.save(), null); assert.match(ui.getState().error, /Waypoints replaced/); assert.equal(planner.exportProject(), before);
    ui.setDraft({ keepViaInverts: true });
    assert.deepEqual(save(ui).viaInvertsM, [-.3]);
    ui.setDraft({ replaceWaypoints: true, keepViaInverts: true, waypoints: '1,2,3\n2,3,4' });
    assert.equal(ui.save(), null); assert.match(ui.getState().error, /count does not match/);
    ui.setDraft({ keepViaInverts: false, viaInvertsM: '?\n-.7' });
    const repaired = save(ui); assert.deepEqual(repaired.viaInvertsM, [null, -.7]);
    assert.deepEqual(repaired.via, [point('ground', 1, 2, 3), point('ground', 2, 3, 4)]);
    ui.setDraft({ replaceWaypoints: true, waypoints: '', viaInvertsM: '' }); const cleared = save(ui);
    assert.deepEqual(cleared.via, []); assert.deepEqual(cleared.viaInvertsM, []);
  }
});
test('via-only edits align with preserved unresolved and cross-floor anchors; invalid input is atomic', () => {
  const { ui, planner } = setup(), { route } = network(ui);
  const hosted = { ...route, via: [null, point('upper', 2, 3, 4)], viaInvertsM: [null, -.8] };
  planner.execute({ type: 'upsert-authored', collection: 'serviceRoutes', value: hosted });
  ui.select('serviceRoutes', route.id);
  for (const viaInvertsM of ['', '-1', '-1\n\n-2', 'NaN\n?', 'Infinity\n?', '0x10\n?', '[1,2]', 'true\n?', '1e10\n?']) {
    ui.setDraft({ viaInvertsM }); const before = planner.exportProject();
    assert.equal(ui.save(), null, viaInvertsM); assert.equal(planner.exportProject(), before);
  }
  ui.setDraft({ viaInvertsM: '-1.2\n?' }); const updated = save(ui);
  assert.deepEqual(updated.via, hosted.via); assert.deepEqual(updated.viaInvertsM, [-1.2, null]);
  planner.undo(); assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], hosted);
  planner.redo(); assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], updated);
  const imported = controllerFor(Model.createProject()); imported.importProject(planner.exportProject());
  assert.deepEqual(imported.getProject(), planner.getProject());
  assert.equal(ui.deleteSelected({ confirmed: true }), true); planner.undo();
  assert.deepEqual(planner.getProject().floors[0].authored.serviceRoutes[0], updated);
});
test('strict scalar/provenance/circuit parsing rejects unsupported edits without JSON coercion', () => {
  const { ui, planner } = setup(); addNode(ui);
  for (const patch of [{ groundM: '0x10' }, { groundM: 'NaN' }, { finishedFloorM: 'Infinity' },
    { accessRadiusM: '-.1' }, { levelSource: 'verified' }, { levelReference: 'bad\nreference' }, { system: 'rain', circuit: 'soil' }]) {
    ui.select('serviceNodes', planner.getProject().floors[0].authored.serviceNodes[0].id);
    ui.setDraft(patch); const before = planner.exportProject(); assert.equal(ui.save(), null); assert.equal(planner.exportProject(), before);
  }
  assert.throws(() => ui.setDraft({ groundM: {} }), /plain text/);
  assert.throws(() => ui.setDraft({ replaceAnchors: 'true' }), /explicitly/);
  assert.throws(() => ui.setDraft({ groundM: undefined }), /plain text/);
});
for (const subscribed of [true, false]) test(`draft persistence and same-identity replacement fingerprint invalidation (${subscribed})`, () => {
  const { ui, planner } = setup(subscribed); const { route } = network(ui);
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  ui.setDraft({ label: 'Unsaved work', viaInvertsM: '-.35' });
  planner.select({ kind: 'room', id: 'ground:living' }); ui.sync();
  assert.equal(ui.getState().dirty, true); assert.equal(ui.getState().draft.label, 'Unsaved work');
  ui.setPreviewSettings({ drainageSystem: 'rain' });
  assert.equal(ui.getState().draft.viaInvertsM, '-.35');
  assert.equal(planner.getProject().floors[0].authored.serviceRoutes[0].label, route.label);
  const replacement = copy(planner.getProject()); replacement.floors[0].authored.serviceRoutes[0].clearanceM = .9;
  planner.replaceProject(replacement); ui.sync();
  assert.equal(ui.getState().stale, true); assert.equal(ui.getState().preview, null);
  assert.equal(ui.getState().dirty, true); assert.equal(ui.getState().draft.label, 'Unsaved work');
  assert.match(ui.getState().error, /Project changed/);
  assert.equal(ui.save(), null);
  ui.discardDraft(); assert.equal(ui.getState().draft.clearanceM, '0.9');
  ui.setDraft({ label: 'Floor draft' }); planner.execute({ type: 'select-floor', id: 'upper' }); ui.sync();
  assert.equal(ui.getState().selectedId, ''); assert.equal(ui.getState().draft.label, '');
  planner.execute({ type: 'select-floor', id: 'ground' }); ui.sync();
  assert.equal(ui.getState().draft.label, 'Floor draft');
});
test('one immutable scene supplies drainage analysis and renderer; filters and cached pages never edit raw records', () => {
  const { ui, planner, captures, builds, sheets } = setup(); network(ui);
  addNode(ui, { system: 'rain', circuit: 'storm', role: 'roof-outlet' });
  const water = { id: 'ground:authored:water', kind: 'junction', system: 'water', anchor: point(), diameterMm: null, invertM: null };
  planner.execute({ type: 'upsert-authored', collection: 'serviceNodes', value: water });
  const before = planner.exportProject();
  ui.setPreviewSettings({ view: 'profile', drainageSystem: 'waste', paper: 'A2', orientation: 'portrait', scaleDenominator: 75, units: 'imperial' });
  assert.ok(ui.refresh(), ui.getState().error); assert.equal(captures.length, 1);
  assert.equal(builds[0].scene, captures[0]); assert.equal(sheets[0].scene, captures[0]);
  assert.deepEqual(sheets[0].options, { floorId: 'ground', floorName: 'Ground floor', view: 'profile', systems: ['waste'],
    paper: 'A2', orientation: 'portrait', scaleDenominator: 75, units: 'imperial' });
  assert.equal(ui.getState().schedule.serviceNodes.length, 4);
  const width = ui.getState().preview.sheet.widthMm;
  ui.setPreviewSettings({ pageIndex: ui.getState().preview.pageCount - 1 });
  assert.equal(captures.length, 1); assert.equal(ui.getState().preview.sheet.widthMm, width);
  assert.equal(planner.exportProject(), before);
  assert.throws(() => ui.setPreviewSettings({ plumbingSystem: 'water' }), /Unsupported/);
  assert.throws(() => ui.setPreviewSettings({ view: 'riser' }), /Unsupported/);
  assert.ok(ui.getState().findings.every(f => Array.isArray(f.entityRefs)));
});
test('renderer absence, invalid pages, excessive pages, SVG errors and bounds fail visibly without partial preview', () => {
  const { ui, runtime } = setup(); network(ui); ui.setPreviewSettings({ paper: 'A2' });
  assert.ok(ui.refresh(), ui.getState().error); const good = ui.getState().preview.sheet;
  const original = runtime.HomePlannerDrainageDrawing;
  for (const drawing of [undefined, { createSheets: () => [] }, { createSheets: () => Array(101).fill(good) },
    { createSheets: () => [good, {}] }, { createSheets: () => [good], toSVG() { throw new Error('serialization failed'); } },
    { createSheets: () => [good], toSVG: () => null }, { createSheets: () => [good], toSVG: () => 'x'.repeat(20 * 1024 * 1024 + 1) }]) {
    runtime.HomePlannerDrainageDrawing = drawing;
    assert.equal(ui.refresh(), null); assert.ok(ui.getState().error); assert.equal(ui.getState().preview, null);
    assert.ok(ui.getState().findings.length, 'successful analysis is still inspectable');
  }
  runtime.HomePlannerDrainageDrawing = { createSheets: () => Array(100).fill(good), toSVG: original.toSVG };
  assert.ok(ui.refresh(), ui.getState().error); assert.equal(ui.getState().preview.pageCount, 100);
  ui.setPreviewSettings({ pageIndex: 99 }); assert.equal(ui.getState().preview.pageIndex, 99);
  runtime.HomePlannerDrainage.build = () => { throw new Error('analysis limit'); };
  assert.equal(ui.refresh(), null); assert.equal(ui.getState().stale, true);
});

function dom(planner, runtime) {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.dataset = {}; this.attributes = {}; this.value = ''; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {}, ...event }); }
    focus() {}
  }
  const find = (node, predicate) => predicate(node) ? node : node.children.map(n => find(n, predicate)).find(Boolean);
  const host = new Element('section'), plumbingHost = new Element('section'), document = new Element('document'), urls = [], revoked = [];
  document.createElement = tag => new Element(tag);
  document.getElementById = id => id === 'workspaceDrainage' ? host : id === 'workspacePlumbing' ? plumbingHost : find(host, n => n.id === id) || find(plumbingHost, n => n.id === id);
  document.defaultView = new Element('window');
  Object.assign(document.defaultView, runtime, { HomePlanner: planner, confirm: () => true,
    URL: { createObjectURL() { const url = `blob:drainage-${urls.length}`; urls.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } } });
  return { host, plumbingHost, document, find, urls, revoked };
}
test('shared multi-host native forms isolate defaults, retain invalid choices, show preview first and expose passive integration links', () => {
  const { planner, bridge, runtime, ui: unused, captures } = setup(); unused.dispose();
  const { host, document, find, urls, revoked } = dom(bridge, runtime);
  const plumbing = Shared.mount(document), ui = UI.mount(document);
  assert.equal(UI.mount(document), ui); assert.equal(host.homePlannerDrainage, ui);
  assert.equal(plumbing.getState().draft.system, 'water'); assert.equal(ui.getState().draft.system, 'waste');
  const field = name => document.getElementById(`hp-drainage-${name}`);
  const settings = find(host, n => n.className === 'hp-service-review-settings');
  assert.equal(settings.tagName, 'DETAILS');
  assert.ok(!settings.open, 'secondary controls start collapsed');
  assert.equal(find(settings, n => n.id === 'hp-drainage-preview-view'), field('preview-view'));
  assert.equal(find(settings, n => n.id === 'hp-drainage-refresh'), undefined, 'refresh remains outside collapsed controls');
  assert.ok(host.children.findIndex(n => n.className === 'hp-service-preview') < host.children.findIndex(n => n.className === 'hp-service-actions'));
  const change = (name, value) => { field(name).value = value; field(name).dispatch(field(name).tagName === 'SELECT' ? 'change' : 'input'); };
  assert.ok(host.children.findIndex(n => n.className === 'hp-service-preview') < host.children.findIndex(n => n.tagName === 'FORM'));
  assert.match(find(host, n => n.className === 'hp-service-preview').children[0].textContent, /No current preview/);
  change('collection', 'serviceNodes'); change('x', '2'); change('y', '3'); change('z', '0'); change('role', 'floor-trap');
  change('groundM', '-.2'); change('finishedFloorM', '.1'); change('invertM', '-.4');
  find(host, n => n.tagName === 'FORM').dispatch('submit');
  assert.equal(planner.getProject().floors[0].authored.serviceNodes[0].groundM, -.2);
  change('system', 'rain'); change('circuit', 'soil');
  assert.equal(field('circuit').value, 'soil'); assert.match(field('circuit').children.at(-1).textContent, /incompatible/);
  find(host, n => n.tagName === 'FORM').dispatch('submit'); assert.ok(ui.getState().error);
  assert.equal(captures.length, 0); assert.equal(plumbing.getState().draft.system, 'water');
  change('circuit', 'storm'); change('role', 'roof-outlet'); find(host, n => n.tagName === 'FORM').dispatch('submit');
  const report = find(host, n => n.dataset.drawingDiscipline === 'drainage');
  assert.equal(report.dataset.workspace, 'report'); assert.equal(report.dataset.section, 'drawings');
  assert.match(report.href, /discipline=drainage/); assert.equal(report.listeners.size, 0, 'Report owns pre-routing discipline handling');
  const layout = find(host, n => n.dataset.section === 'layout'); assert.equal(layout.listeners.size, 0, 'no automatic 3D layer toggle');
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  assert.match(settings.children[0].textContent, /A2.*1:100/);
  const first = urls.at(-1), count = captures.length;
  change('label', 'Draft retained on workspace event');
  document.dispatch('homeplanner:workspace-change'); assert.equal(ui.getState().draft.label, 'Draft retained on workspace event');
  const preview = ui.getState().preview;
  field('zoom').value = 'full'; field('zoom').dispatch('change');
  assert.equal(ui.getState().preview, preview); assert.equal(captures.length, count);
  ui.setPreviewSettings({ pageIndex: 0 }); assert.ok(revoked.includes(first));
  const image = find(host, n => n.tagName === 'IMG'), last = urls.at(-1); image.dispatch('error');
  assert.ok(revoked.includes(last)); assert.match(find(host, n => n.className === 'hp-service-error').textContent, /could not be displayed/);
  assert.ok(ui.refresh(), ui.getState().error);
  ui.dispose(); plumbing.dispose(); assert.equal(host.homePlannerDrainage, undefined);
  assert.equal(new Set(revoked).size, urls.length);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
});

test('cross-floor fixture anchors and exact node pairs survive floor duplication with drainage provenance intact', () => {
  const { ui, planner } = setup();
  ui.select('fixtures'); ui.setDraft({ kind: 'sink', x: '1', y: '2', z: '.8' }); const fixture = save(ui);
  const local = addNode(ui, { anchorMode: 'fixture', fixtureRef: pair('ground', fixture.id), circuit: 'waste',
    role: 'gully-trap', groundM: '-1', invertM: '-1.2', levelReference: 'Do not remap textual reference' });
  planner.execute({ type: 'select-floor', id: 'upper' });
  const upper = addNode(ui, { anchorMode: 'fixture', fixtureRef: pair('ground', fixture.id), circuit: 'waste',
    role: 'floor-trap', invertM: '1.8' });
  assert.equal(upper.anchor.floorId, 'ground');
  planner.execute({ type: 'select-floor', id: 'ground' });
  ui.select('serviceRoutes');
  ui.setDraft({ circuit: 'waste', from: pair('upper', upper.id), to: pair('ground', local.id), waypoints: '1,2,1', viaInvertsM: '.7' });
  const route = save(ui);
  planner.execute({ type: 'add-floor', copyFromId: 'ground', name: 'Copied drainage' });
  const f = planner.getProject().floors.find(f => f.id === planner.getProject().activeFloorId);
  assert.deepEqual(f.authored.serviceRoutes[0].from, route.from);
  assert.equal(f.authored.serviceRoutes[0].to.floorId, f.id);
  assert.equal(f.authored.serviceRoutes[0].to.entityId, f.authored.serviceNodes[0].id);
  assert.deepEqual(f.authored.serviceRoutes[0].viaInvertsM, [.7]);
  assert.equal(f.authored.serviceNodes[0].groundM, -1);
  assert.equal(f.authored.serviceNodes[0].levelReference, local.levelReference);
  assert.equal(f.authored.serviceNodes[0].anchor.entityId, f.authored.fixtures[0].id);
});

test('full other-floor findings have exact-pair navigation and collapsed raw IDs without automatic analysis', () => {
  const { planner, bridge, runtime, ui: unused, captures } = setup(); unused.dispose();
  const { host, document, find } = dom(bridge, runtime), ui = UI.mount(document);
  planner.execute({ type: 'select-floor', id: 'upper' });
  const target = addNode(ui, { role: 'floor-trap' });
  planner.execute({ type: 'select-floor', id: 'ground' });
  const build = runtime.HomePlannerDrainage.build;
  runtime.HomePlannerDrainage.build = (scene, options) => ({ ...build(scene, options),
    findings: [{ code: 'test-qualified', severity: 'warning', floorId: 'upper', message: 'Other floor stays visible',
      entityIds: [target.id], entityRefs: [{ floorId: 'upper', entityId: target.id }], componentId: null }] });
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  const region = find(host, n => n.attributes['aria-label'] === 'Scrollable drainage findings with qualified references');
  assert.ok(find(region, n => n.textContent === 'Other floor stays visible'));
  assert.ok(find(region, n => n.tagName === 'DETAILS'));
  const button = find(region, n => n.tagName === 'BUTTON'), count = captures.length;
  ui.setDraft({ label: 'Keep pending' }); document.defaultView.confirm = () => false;
  button.dispatch('click'); assert.equal(planner.getProject().activeFloorId, 'ground'); assert.equal(ui.getState().dirty, true);
  document.defaultView.confirm = () => true; button.dispatch('click');
  assert.equal(planner.getProject().activeFloorId, 'upper'); assert.equal(ui.getState().selectedId, target.id);
  assert.equal(captures.length, count); ui.dispose();
});

test('drainage level guidance preserves zero, raw findings and separate qualified owners while deduplicating copies', () => {
  const { planner, bridge, runtime, ui: unused } = setup(); unused.dispose();
  const baseBuild = runtime.HomePlannerDrainage.build;
  const item = { code: 'unknown-invert', severity: 'warning', floorId: 'ground', message: 'Original independently supplied invert evidence.',
    entityIds: ['same-id'], entityRefs: [{ floorId: 'ground', entityId: 'same-id' }], componentId: null };
  runtime.HomePlannerDrainage.build = (scene, options) => ({ ...baseBuild(scene, options),
    findings: [item, copy(item), { ...copy(item), entityRefs: [{ floorId: 'upper', entityId: 'same-id' }] }] });
  const { host, document, find } = dom(bridge, runtime), ui = UI.mount(document);
  addNode(ui, { invertM: '0' });
  const before = planner.exportProject();
  ui.setPreviewSettings({ paper: 'A2' }); assert.ok(ui.refresh(), ui.getState().error);
  const region = find(host, node => node.attributes['aria-label'] === 'Scrollable drainage findings with qualified references');
  const body = find(region, node => node.tagName === 'TBODY');
  assert.equal(body.children.length, 2, 'same bare ID on a different qualified floor is not deduplicated');
  assert.equal(ui.getState().findings.length, 3);
  const review = body.children[0].children[2];
  assert.match(review.textContent, /Invert level: Not supplied.*survey.*project datum/);
  const detail = find(region, node => node.tagName === 'DETAILS'); assert.ok(!detail.open);
  assert.deepEqual(JSON.parse(find(detail, node => node.tagName === 'PRE').textContent), item);
  const schedules = find(host, node => node.className === 'hp-service-schedules');
  assert.ok(find(schedules, node => node.tagName === 'TD' && node.textContent === '0'), 'supplied zero level remains zero');
  assert.ok(find(host, node => node.tagName === 'P' && /endpoint and waypoint invert levels from a level survey/.test(node.textContent)));
  assert.equal(planner.exportProject(), before); ui.dispose();
});

test('multibyte SVG byte bound and later-page serializer failures clear cached previews', () => {
  const { ui, runtime } = setup(); network(ui); ui.setPreviewSettings({ paper: 'A2' });
  assert.ok(ui.refresh(), ui.getState().error); const sheet = ui.getState().preview.sheet;
  runtime.HomePlannerDrainageDrawing = { createSheets: () => [sheet], toSVG: () => '漢'.repeat(7 * 1024 * 1024) };
  assert.equal(ui.refresh(), null); assert.match(ui.getState().error, /UTF-8 maximum/);
  let broken = false;
  runtime.HomePlannerDrainageDrawing = { createSheets: () => [sheet, sheet],
    toSVG(value) { if (broken) throw new Error('Later page failed'); return Drawing.toSVG(value); } };
  assert.ok(ui.refresh(), ui.getState().error); broken = true;
  ui.setPreviewSettings({ pageIndex: 1 }); assert.equal(ui.getState().preview, null);
  assert.match(ui.getState().error, /Later page failed/);
});
