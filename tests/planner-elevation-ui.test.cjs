const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const UI = require('../planner-elevation-ui.js');
const Drawing = require('../planner-drawing.js');
const Elevation = require('../planner-elevation.js');
const Model = require('../planner-model.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const point = (x = 0, y = 0, z = 0, floorId = 'ground') => ({ kind: 'point', floorId, point: { x, y, z } });
const saved = (id = 'north', extra = {}) => ({ id, name: 'North elevation', kind: 'elevation',
  floorId: 'ground', scaleDenominator: 100, direction: 'N', cut: [], ...extra });
function setup(views = [], heading = 'E', subscribed = true) {
  const doc = createFixture('multiple-floors').project;
  for (const floor of doc.floors) {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 14, h: 14 };
    floor.legacy.context.plate.frontEdge = heading;
  }
  doc.legacy = copy(doc.floors[0].legacy);
  doc.documentation = { version: 1, views: [saved('plan', { kind: 'plan', direction: null }), ...views],
    sheets: [{ id: 'sheet-keep', number: 'A-1', title: 'Keep sheet', paper: 'A3', orientation: 'landscape', viewIds: ['plan'] }] };
  const planner = controllerFor(doc), commands = [], captures = [], renderCalls = [];
  const runtime = { Blob, crypto: { randomUUID: () => 'test-uuid' }, HomePlannerDrawing: Drawing,
    HomePlannerElevation: { ...Elevation, createSheets(scene, options) { renderCalls.push({ scene, options }); return Elevation.createSheets(scene, options); } } };
  const bridge = { ...planner, subscribe: subscribed ? planner.subscribe : undefined,
    execute(command) { commands.push(command); return planner.execute(command); },
    getDrawingScene() { const scene = planner.getDrawingScene(); captures.push(scene); return scene; } };
  const ui = UI.createController(bridge, runtime);
  ui.setPreviewSettings({ paper: 'A2' });
  return { ui, planner, bridge, runtime, commands, captures, renderCalls };
}

test('new views never invent direction/cut coordinates, project edits, or render on navigation', () => {
  const { ui, planner, captures } = setup();
  const before = planner.exportProject();
  for (const field of ['name', 'direction', 'ax', 'ay', 'az', 'bx', 'by', 'bz']) assert.equal(ui.getState().draft[field], '');
  ui.setDraft({ name: 'Draft across modes and floors' }); ui.sync();
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().draft.name, 'Draft across modes and floors');
  assert.equal(ui.getState().draft.floorId, 'ground');
  assert.equal(captures.length, 0);
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.equal(planner.exportProject(), before);
});

test('real bridge saves once, preserves all documentation, retains IDs, Undo/Redo and JSON', () => {
  const { ui, planner, commands, captures } = setup([saved('keep')]);
  const original = copy(planner.getProject().documentation);
  ui.setDraft({ name: 'East view', direction: 'E', scaleDenominator: '75' });
  const value = ui.save(); assert.ok(value, ui.getState().error);
  assert.equal(commands.length, 1); assert.equal(commands[0].type, 'set-documentation');
  assert.deepEqual(planner.getProject().documentation, { ...original, views: [...original.views, value] });
  assert.equal(captures.length, 0);
  ui.setDraft({ name: 'Renamed east' });
  const edited = ui.save(); assert.equal(edited.id, value.id);
  assert.throws(() => ui.setDraft({ id: 'rename' }), /stable/);
  planner.undo(); assert.deepEqual(planner.getProject().documentation.views.at(-1), value);
  planner.redo(); assert.deepEqual(planner.getProject().documentation.views.at(-1), edited);
  assert.equal(ui.deleteSelected(), null);
  assert.equal(ui.deleteSelected({ confirmed: true }), true);
  assert.deepEqual(planner.getProject().documentation, original);
  planner.undo(); assert.deepEqual(planner.getProject().documentation.views.at(-1), edited);
  const imported = controllerFor(Model.createProject()); imported.importProject(planner.exportProject());
  assert.deepEqual(imported.getProject(), planner.getProject());
});

test('four relative side views capture true non-N front compass in one command, collision-free across repeated creates', () => {
  for (const [heading, expected] of [['N', ['N', 'S', 'W', 'E']], ['E', ['E', 'W', 'N', 'S']],
    ['S', ['S', 'N', 'E', 'W']], ['W', ['W', 'E', 'S', 'N']]]) {
    const { ui, planner, captures, commands, renderCalls } = setup([], heading);
    assert.equal(planner.getProject().site.front, undefined);
    const before = copy(planner.getProject().documentation);
    const created = ui.createFrontViews(); assert.ok(created, ui.getState().error);
    assert.deepEqual(created.map(item => item.direction), expected);
    assert.deepEqual(created.map(item => item.name), ['Front elevation', 'Rear elevation', 'Left elevation', 'Right elevation']);
    assert.equal(commands.length, 1); assert.equal(captures.length, 1); assert.equal(renderCalls.length, 0);
    const again = ui.createFrontViews(); assert.ok(again);
    assert.equal(new Set([...created, ...again].map(item => item.id)).size, 8);
    planner.undo(); assert.equal(planner.getProject().documentation.views.length, before.views.length + 4);
    planner.undo(); assert.deepEqual(planner.getProject().documentation, before);
    planner.redo(); assert.deepEqual(planner.getProject().documentation.views.slice(1), created);
  }
  assert.throws(() => UI.frontDirections(45), /cardinal/);
  assert.throws(() => UI.frontDirections(undefined), /unknown/);
});

test('metadata edits preserve point/wall/entity/cross-floor/null/unresolved hosts without implicit replacement', () => {
  const hosts = [
    [point(), point(5, 0)],
    [{ kind: 'wall', floorId: 'ground', entityId: 'missing-wall', offsetM: 2, heightM: 1 },
      { kind: 'entity', floorId: 'upper', entityKind: 'structural', entityId: 'upper:authored:missing' }],
    [null, { kind: 'entity', floorId: 'ground', entityKind: 'room', entityId: 'ground:living' }]
  ];
  for (const cut of hosts) {
    const original = saved('cut', { kind: 'section', direction: null, cut });
    const { ui, planner, commands } = setup([original]);
    ui.select('cut'); ui.setDraft({ name: 'Metadata edited', floorId: 'upper', ax: '9' });
    const value = ui.save(); assert.ok(value, ui.getState().error);
    assert.deepEqual(value.cut, cut); assert.equal(value.floorId, 'upper');
    assert.equal(commands.length, 1);
    assert.deepEqual(ui.getState().anchorSummary, cut);
    ui.setDraft({ kind: 'elevation', direction: 'W' });
    assert.equal(ui.save(), null); assert.match(ui.getState().error, /Replace cut anchors/);
    ui.setDraft({ replaceAnchors: true });
    assert.ok(ui.save()); assert.deepEqual(planner.getProject().documentation.views.at(-1).cut, []);
  }
});

test('new/replaced section points require explicit six coordinates and atomic valid horizontal cut', () => {
  const { ui, planner, commands } = setup();
  const original = planner.exportProject();
  ui.setDraft({ kind: 'section', name: 'Cut A-B', ax: '0', ay: '0', bx: '6', by: '0', bz: '0' });
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /A z.*required/);
  assert.equal(planner.exportProject(), original); assert.equal(commands.length, 0);
  ui.setDraft({ az: '1' }); assert.equal(ui.save(), null); assert.match(ui.getState().error, /equal z/);
  ui.setDraft({ az: '0' }); const created = ui.save(); assert.ok(created, ui.getState().error);
  assert.deepEqual(created.cut, [point(), point(6, 0)]);
  ui.setDraft({ replaceAnchors: true, floorId: 'upper', ax: '-3', ay: '4', az: '0', bx: '9', by: '4', bz: '0' });
  const updated = ui.save(); assert.ok(updated, ui.getState().error);
  assert.deepEqual(updated.cut, [point(-3, 4, 0, 'upper'), point(9, 4, 0, 'upper')]);
  assert.deepEqual(planner.getProject().documentation.sheets[0].viewIds, ['plan']);
});

test('invalid ID/scale/kind/name saves and rejected bridge transactions never partially change documents', () => {
  const { ui, planner, bridge, runtime } = setup();
  const before = planner.exportProject();
  for (const patch of [{ id: 'plan' }, { scaleDenominator: 200 }, { kind: 'plan' }, { name: '' }]) {
    ui.select(); ui.setDraft({ name: 'Test', direction: 'N', ...patch });
    assert.equal(ui.save(), null); assert.equal(planner.exportProject(), before);
  }
  const rejected = UI.createController({ ...bridge, execute() { throw new Error('Bridge rejected transaction'); } }, runtime);
  rejected.setDraft({ name: 'Rejected', direction: 'N' }); assert.equal(rejected.save(), null);
  assert.match(rejected.getState().error, /Bridge rejected/); assert.equal(planner.exportProject(), before);
});

test('same-ID/revision replacement and import retain conflicted drafts and invalidate previews', () => {
  const { ui, planner, captures } = setup([saved()]);
  ui.select('north'); assert.ok(ui.refresh(), ui.getState().error);
  ui.setDraft({ name: 'Unsaved draft' });
  const replacement = JSON.parse(planner.exportProject());
  replacement.documentation.views[1].name = 'Replacement';
  planner.replaceProject(replacement);
  assert.equal(ui.getState().draft.name, 'Unsaved draft'); assert.equal(ui.getState().preview, null);
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Project changed/);
  ui.discardDraft(); assert.equal(ui.getState().draft.name, 'Replacement');
  assert.equal(captures.length, 1);
  ui.setDraft({ name: 'Another draft' }); ui.sync();
  assert.equal(ui.getState().draft.name, 'Another draft');
  replacement.documentation.views[1].direction = 'S'; planner.importProject(JSON.stringify(replacement));
  assert.equal(ui.getState().draft.name, 'Another draft');
  assert.equal(ui.save(), null);
  ui.discardDraft(); assert.equal(ui.getState().draft.direction, 'S');
  replacement.id = 'new-project'; planner.replaceProject(replacement);
  assert.equal(ui.getState().selectedId, ''); assert.equal(ui.getState().draft.name, '');
});

test('unsubscribed same-ID changes abort stale saves and preserve the replacement', () => {
  const { ui, planner } = setup([saved()], 'E', false);
  ui.select('north'); ui.setDraft({ name: 'Stale' });
  const replacement = JSON.parse(planner.exportProject()); replacement.documentation.views[1].name = 'Replacement';
  planner.replaceProject(replacement);
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Project changed/);
  assert.equal(planner.getProject().documentation.views[1].name, 'Replacement');
});

test('real preview uses saved scale, unknown explicit fallback, common validation and no automatic projection', () => {
  const { ui, runtime, planner, captures, renderCalls } = setup([saved('north', { scaleDenominator: 75 })]);
  ui.select('north'); assert.equal(captures.length, 0);
  assert.ok(ui.refresh(), ui.getState().error);
  assert.equal(renderCalls[0].options.scaleDenominator, 75);
  assert.equal(ui.getState().preview.sheet.metadata.scaleDenominator, 75);
  ui.setDraft({ scaleDenominator: '' }); ui.save();
  ui.setPreviewSettings({ scaleDenominator: 100 });
  assert.equal(captures.length, 1);
  assert.ok(ui.refresh(), ui.getState().error); assert.equal(ui.getState().preview.sheet.metadata.scaleDenominator, 100);
  const before = planner.exportProject();
  delete runtime.HomePlannerElevation;
  assert.equal(ui.refresh(), null); assert.match(ui.getState().error, /Load planner-elevation/);
  assert.equal(planner.exportProject(), before);
});

test('cached multipage selection does not reproject and validation rejects all partial results', () => {
  const { ui, runtime, captures } = setup([saved()]);
  ui.select('north');
  let validations = 0;
  runtime.HomePlannerElevation = {
    createSheets(scene, options) { return [0, 1, 2].map(index => ({ metadata: { ...options, title: `Page ${index}` } })); },
    toSVG(sheet) { return `<svg>${sheet.metadata.title}</svg>`; }
  };
  runtime.HomePlannerDrawing = { validateSheet() { validations++; return true; } };
  assert.equal(ui.refresh().pageCount, 3);
  ui.setPreviewSettings({ pageIndex: 1 });
  assert.equal(ui.getState().preview.pageIndex, 1); assert.match(ui.getState().preview.svg, /Page 1/);
  assert.equal(captures.length, 1); assert.equal(validations, 3);
  ui.setPreviewSettings({ pageIndex: 99 }); assert.equal(ui.getState().preview.pageIndex, 2);
  assert.throws(() => ui.setPreviewSettings({ pageIndex: -1 }), /Unsupported/);
  runtime.HomePlannerDrawing.validateSheet = () => false;
  assert.equal(ui.refresh(), null); assert.equal(ui.getState().preview, null);
  assert.match(ui.getState().error, /validation/);
});

test('browser registration waits for DOMContentLoaded and public host contract is explicit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'planner-elevation-ui.js'), 'utf8');
  const callbacks = [];
  const context = { document: { readyState: 'loading', addEventListener(...args) { callbacks.push(args); }, getElementById: () => null } };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.HomePlannerElevationUI.createController, 'function');
  assert.equal(callbacks[0][0], 'DOMContentLoaded'); assert.equal(callbacks[0][2].once, true);
  callbacks[0][1]();
  assert.equal(UI.mount({ getElementById: () => null }), null);
});

function workbenchDocument(planner, runtime) {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {};
      this.listeners = new Map(); this.value = ''; this.style = {}; this.classList = { add() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {} }); }
  }
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  const host = new Node('section'), facade = new Node('section'), document = new Node('document');
  facade.append(new Node('form')); const originalFacade = facade.children[0];
  document.createElement = tag => new Node(tag);
  document.getElementById = id => id === 'workspaceViews' ? host : id === 'workspaceFacades' ? facade : find(host, node => node.id === id);
  document.defaultView = new Node('window');
  let confirmed = false, confirmations = 0;
  const urls = [], revoked = [];
  Object.assign(document.defaultView, runtime, { HomePlanner: planner,
    confirm() { confirmations++; return confirmed; },
    URL: { createObjectURL() { const url = `blob:view-${urls.length}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); } } });
  return { document, host, facade, originalFacade, find, urls, revoked,
    confirm(value) { confirmed = value; }, confirmations: () => confirmations };
}

test('mounted-once workbench preserves adjacent facade, form drafts, native confirmation and cached page URL lifetime', () => {
  const { ui: unused, bridge, planner, runtime, captures } = setup([saved()]); unused.dispose();
  runtime.HomePlannerElevation = {
    createSheets(scene, options) { return [0, 1].map(index => ({ metadata: { ...options, title: `Sheet ${index}` } })); },
    toSVG: sheet => `<svg>${sheet.metadata.title}</svg>`
  };
  runtime.HomePlannerDrawing = { validateSheet: () => true };
  const { document, host, facade, originalFacade, find, urls, revoked, confirm, confirmations } = workbenchDocument(bridge, runtime);
  const ui = UI.mount(document);
  assert.equal(UI.mount(document), ui); assert.equal(captures.length, 0);
  const name = document.getElementById('hp-view-name'); name.value = 'Draft'; name.dispatch('input');
  document.dispatch('homeplanner:workspace-change'); ui.sync();
  assert.equal(ui.getState().draft.name, 'Draft');
  assert.equal(captures.length, 0); assert.equal(facade.children[0], originalFacade);
  ui.select('north'); ui.refresh();
  const page = document.getElementById('hp-view-preview-pageIndex');
  assert.equal(page.disabled, false); assert.equal(page.children.length, 2);
  const options = [...page.children]; page.value = '1'; page.dispatch('change');
  assert.equal(ui.getState().preview.pageIndex, 1);
  assert.deepEqual(page.children, options); assert.equal(captures.length, 1);
  assert.ok(revoked.includes(urls[0]));
  const remove = find(host, node => node.tagName === 'BUTTON' && node.textContent === 'Delete selected view');
  remove.dispatch('click'); assert.equal(confirmations(), 1); assert.equal(planner.getProject().documentation.views.length, 2);
  confirm(true); remove.dispatch('click');
  assert.equal(planner.getProject().documentation.views.length, 1);
  assert.equal(find(host, node => node.attributes.role === 'alert').hidden, true);
  const form = find(host, node => node.tagName === 'FORM');
  ui.setDraft({ name: 'Keyboard submit', direction: 'W' }); form.dispatch('submit');
  assert.equal(planner.getProject().documentation.views.at(-1).name, 'Keyboard submit');
  assert.equal(facade.children[0], originalFacade);
  ui.dispose(); assert.deepEqual(new Set(urls), new Set(revoked));
  assert.equal(urls.length, revoked.length); assert.equal(host.homePlannerViews, undefined);
});

test('deleting a scheduled view retains every sheet and dangling reference for Undo', () => {
  const { ui, planner } = setup([saved()]);
  const doc = copy(planner.getProject().documentation);
  doc.sheets[0].viewIds.push('north');
  planner.execute({ type: 'set-documentation', value: doc });
  ui.select('north');
  assert.equal(ui.deleteSelected({ confirmed: true }), true);
  assert.deepEqual(planner.getProject().documentation.sheets, doc.sheets);
  planner.undo(); assert.deepEqual(planner.getProject().documentation, doc);
});

test('phone table retains semantic headers, readable names and expandable full identifiers; zoom is display-only', () => {
  const id = 'project:01234567-89ab-cdef-0123-456789abcdef:view:north:01234567-89ab-cdef-0123-456789abcdef';
  const { ui: unused, bridge, planner, runtime, captures } = setup([saved(id)]); unused.dispose();
  const { document, host, find, urls, revoked } = workbenchDocument(bridge, runtime);
  const ui = UI.mount(document), before = planner.exportProject();
  const region = find(host, node => node.className === 'hp-view-table-region');
  assert.equal(region.tabIndex, 0); assert.equal(region.attributes.role, 'region');
  assert.match(region.attributes['aria-label'], /Saved views.*scroll horizontally/);
  const table = region.children[0];
  assert.equal(table.tagName, 'TABLE'); assert.equal(table.children[0].tagName, 'CAPTION');
  assert.ok(table.children[1].children[0].children.every(th => th.scope === 'col'));
  const row = table.children[2].children[0];
  assert.equal(row.children[0].children[0].textContent, 'North elevation');
  const details = row.children[1].children[0];
  assert.equal(details.tagName, 'DETAILS'); assert.equal(details.children[0].textContent, 'ID');
  assert.equal(details.children[1].textContent, id);
  ui.setPreviewSettings({ paper: 'A2' }); ui.select(id); ui.refresh();
  const cached = ui.getState().preview, capturesBefore = captures.length, urlsBefore = urls.length;
  const zoom = document.getElementById('hp-view-zoom');
  const previewHost = find(host, node => node.className === 'hp-view-preview');
  assert.equal(zoom.value, 'fit'); assert.equal(previewHost.dataset.zoom, 'fit');
  for (const value of ['full', 'fit']) {
    zoom.value = value; zoom.dispatch('change');
    assert.equal(previewHost.dataset.zoom, value); assert.equal(ui.getState().preview, cached);
  }
  assert.equal(captures.length, capturesBefore); assert.equal(urls.length, urlsBefore); assert.equal(revoked.length, 0);
  const link = find(host, node => node.dataset.drawingDiscipline === 'views');
  assert.equal(link.dataset.drawingViewId, id); assert.match(link.href, /discipline=views&viewId=/);
  ui.select(); assert.equal(link.dataset.drawingViewId, ''); assert.doesNotMatch(link.href, /viewId=/);
  assert.equal(planner.exportProject(), before); ui.dispose();
  const css = fs.readFileSync(path.join(__dirname, '..', 'planner-elevation-ui.css'), 'utf8');
  assert.match(css, /minmax\(min\(100%, 15rem\), 1fr\)/);
  assert.match(css, /min-width: 52rem/); assert.match(css, /\[data-zoom="fit"\] img \{ width: 100%/);
});
