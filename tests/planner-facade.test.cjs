const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UI = require('../planner-facade-ui.js');
const Model = require('../planner-model.js');
const Exposure = require('../sun-exposure.js');
const View = require('../planner-3d.js');
const Storage = require('../planner-storage.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const box = (id = 'ground:facade:existing') => ({ id, type: 'building', x: 1, y: 2, w: 3, h: .4,
  heightM: .25, baseM: 6.2, transmittance: .15, facade: { version: 1, finish: null } });
const confirmed = { confirmed: true };
const fill = ui => ui.setDraft({ x: '2', y: '-.4', w: '2.4', h: '.7', heightM: '.3', baseM: '2.8',
  transmittance: '.12', label: '', finish: '' });
function setup(items = [], subscribed = true, name = 'multiple-floors') {
  const project = createFixture(name).project;
  project.obstacles = copy(items); project.floors[0].obstacles = copy(items);
  if (project.floors[1]) project.floors[1].obstacles = [box('upper:facade:keep')];
  const planner = controllerFor(project);
  const ui = UI.createController({ ...planner, subscribe: subscribed ? planner.subscribe : undefined }, { crypto });
  return { planner, ui };
}
function validateRecord(record) {
  const project = Model.createProject();
  project.obstacles = [record]; project.floors[0].obstacles = [record];
  return Model.validateProject(project);
}

test('optional facade metadata leaves old obstacle shapes unchanged; finish is explicit null or bounded text', () => {
  const old = box(); delete old.facade;
  assert.doesNotThrow(() => validateRecord(old));
  assert.equal(Object.hasOwn(old, 'facade'), false);
  assert.doesNotThrow(() => validateRecord(box()));
  assert.doesNotThrow(() => validateRecord({ ...box(), facade: { version: 1, finish: 'a'.repeat(512) } }));
});

for (const facade of [undefined, null, [], 'finish', {}, { version: 1 }, { finish: null },
  { version: 2, finish: null }, { version: '1', finish: null }, { version: 1, finish: undefined },
  { version: 1, finish: '' }, { version: 1, finish: '   ' }, { version: 1, finish: 1 },
  { version: 1, finish: 'a'.repeat(513) }, { version: 1, finish: 'bad\ntext' },
  { version: 1, finish: null, extra: true }])
  test(`strict facade schema rejects ${JSON.stringify(facade)}`, () => {
    assert.throws(() => validateRecord({ ...box(), facade }));
  });

test('tree facade metadata and invalid stored physical values are rejected', () => {
  assert.throws(() => validateRecord({ ...box(), type: 'tree' }), /only supported on building/);
  for (const patch of [{ x: '' }, { w: 0 }, { h: -1 }, { heightM: null }, { baseM: '3' }, { transmittance: 1.1 }])
    assert.throws(() => validateRecord({ ...box(), ...patch }));
});

test('real bridge add/update/delete, Undo/Redo and JSON preserve surrounding obstacles, metadata and floors', () => {
  const tree = { ...box('tree'), type: 'tree' }; delete tree.facade;
  const neighbor = { ...box('neighbor'), label: 'Neighbor', survey: { unverified: true } }; delete neighbor.facade;
  const old = { ...box(), survey: { source: 'user' } };
  const { planner, ui } = setup([tree, neighbor, old]);
  const upper = copy(planner.getProject().floors[1]);
  fill(ui);
  assert.equal(ui.save(), null); assert.match(ui.getState().error, /Confirm/);
  const added = ui.save(confirmed);
  assert.ok(added, ui.getState().error);
  assert.match(added.id, /^ground:facade:[0-9a-f-]{36}$/);
  assert.deepEqual(added.facade, { version: 1, finish: null });
  assert.equal(Object.hasOwn(added, 'label'), false);
  assert.deepEqual(planner.getProject().obstacles.slice(0, 3), [tree, neighbor, old]);
  assert.throws(() => ui.select('tree'), /facade box/);
  ui.select(old.id); ui.setDraft({ finish: 'User supplied cladding intent', w: '4' });
  const changed = ui.save(confirmed);
  assert.deepEqual(changed, { ...old, w: 4, facade: { version: 1, finish: 'User supplied cladding intent' } });
  assert.deepEqual(planner.getProject().floors[1], upper);
  planner.undo(); assert.deepEqual(planner.getProject().obstacles[2], old);
  planner.redo(); assert.deepEqual(planner.getProject().obstacles[2], changed);
  assert.equal(ui.deleteSelected(), null);
  assert.equal(ui.deleteSelected(confirmed), true);
  assert.deepEqual(planner.getProject().obstacles, [tree, neighbor, added]);
  planner.undo(); assert.deepEqual(planner.getProject().obstacles, [tree, neighbor, changed, added]);
  planner.redo(); assert.deepEqual(planner.getProject().obstacles, [tree, neighbor, added]);
  const imported = controllerFor(Model.createProject());
  imported.importProject(planner.exportProject());
  assert.deepEqual(imported.getProject(), planner.getProject());
  const stored = Storage.createRecord(planner.getProject(), undefined, '2026-09-17T00:00:00.000Z');
  assert.deepEqual(Storage.readRecord(copy(stored)).document, planner.getProject());
});

test('all physical values start blank; finish does not infer transmittance', () => {
  const { ui, planner } = setup();
  assert.ok(Object.values(ui.getState().draft).every(value => value === ''));
  ui.setDraft({ finish: 'glass' });
  assert.equal(ui.getState().draft.transmittance, '');
  assert.equal(ui.save(confirmed), null);
  assert.deepEqual(planner.getProject().obstacles, []);
});

for (const patch of [{ x: '' }, { y: ' ' }, { w: '' }, { h: '' }, { heightM: '' }, { baseM: '' },
  { transmittance: '' }, { x: 'NaN' }, { heightM: 'Infinity' }, { w: '0' }, { h: '-1' },
  { transmittance: '-.1' }, { transmittance: '1.1' }, { baseM: null }, { label: 'bad\ntext' },
  { finish: 'a'.repeat(513) }])
  test(`invalid draft is atomic: ${JSON.stringify(patch)}`, () => {
    const { planner, ui } = setup([box()]); fill(ui);
    const before = planner.exportProject(); ui.setDraft(patch);
    assert.equal(ui.save(confirmed), null); assert.ok(ui.getState().error);
    assert.equal(planner.exportProject(), before);
  });

test('duplicate floor remaps facade namespace, preserving project-relative base and unknown metadata', () => {
  const old = { ...box(), other: { note: 'retain' } }, { planner } = setup([old]);
  planner.execute({ type: 'add-floor', copyFromId: 'ground', name: 'Copied floor' });
  const project = planner.getProject(), duplicate = project.obstacles[0];
  assert.notEqual(project.activeFloorId, 'ground');
  assert.deepEqual(duplicate, { ...old, id: `${project.activeFloorId}:facade:existing` });
  assert.equal(duplicate.baseM, 6.2);
});

for (const subscribed of [true, false])
  test(`same-ID/revision replacement retains conflicted draft (${subscribed})`, () => {
    const { planner, ui } = setup([box()], subscribed);
    ui.select(box().id); ui.setDraft({ finish: 'Unsaved' });
    const replacement = copy(planner.getProject());
    replacement.obstacles[0].facade.finish = 'Replacement';
    replacement.floors[0].obstacles = copy(replacement.obstacles);
    planner.replaceProject(replacement); ui.sync();
    assert.equal(ui.getState().draft.finish, 'Unsaved');
    assert.equal(ui.save(confirmed), null); assert.match(ui.getState().error, /Project changed/);
    assert.equal(planner.getProject().obstacles[0].facade.finish, 'Replacement');
    ui.discardDraft(); assert.equal(ui.getState().draft.finish, 'Replacement');
    assert.equal(ui.getState().selectedId, box().id);
  });

test('workspace/selection retains draft; floor/project change parks it; disposal blocks mutation', () => {
  const { planner, ui } = setup([box()]);
  ui.select(box().id); ui.setDraft({ finish: 'Draft' });
  planner.select({ kind: 'room', id: 'ground:living' }); ui.sync();
  assert.equal(ui.getState().draft.finish, 'Draft');
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().selectedId, ''); assert.equal(ui.getState().draft.finish, '');
  ui.select('upper:facade:keep'); ui.setDraft({ label: 'Draft' });
  const previous = copy(planner.getProject()), replacement = copy(previous); replacement.id = 'another-project';
  planner.replaceProject(replacement);
  assert.equal(ui.getState().selectedId, ''); assert.equal(ui.getState().draft.label, '');
  planner.replaceProject(previous);
  assert.equal(ui.getState().draft.label, 'Draft');
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.equal(ui.getState().draft.finish, 'Draft');
  ui.dispose(); fill(ui);
  const before = planner.exportProject();
  assert.equal(ui.save(confirmed), null); assert.equal(ui.deleteSelected(confirmed), null);
  assert.equal(planner.exportProject(), before);
});

test('shared projection, exposure input/export and real 3D receive the same physical box', async () => {
  const facade = box(), { planner } = setup([facade], true, 'setback-plot');
  const project = planner.getProject(), raw = planner.getScenes(), local = raw[0];
  const drawing = planner.getDrawingScene(), projected = drawing.scenes[0];
  const expected = { ...local.obstacles[0], x: facade.x - local.plot.x, y: facade.y - local.plot.y };
  assert.notEqual(expected.x, facade.x);
  assert.deepEqual(projected.obstacles[0], expected);
  const exposure = Exposure.prepareScenes(project, raw);
  assert.deepEqual(exposure[0].obstacles[0], expected);
  const exportedInputs = JSON.parse(Exposure.inputKey(project, exposure, {}, Exposure.emptyNeighbors()));
  assert.deepEqual(exportedInputs.scenes[0].obstacles[0], expected);
  const snapshot = planner.createSnapshot({ purpose: 'export', engineId: 'facade-test', engineVersion: '1' });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).drawing.scenes[0].obstacles[0], expected);
  const THREE = await import('../vendor/three/three.module.min.js');
  const content = View.buildContent(THREE, drawing.scenes, project, Model);
  try {
    assert.equal(content.obstacleCount, 1);
    const matches = [];
    content.group.traverse(object => {
      if (object.geometry?.type === 'BoxGeometry' && object.material?.color?.getHex() === 0x9b9d97) matches.push(object);
    });
    assert.equal(matches.length, 1);
    const mesh = matches[0], parameters = mesh.geometry.parameters;
    assert.deepEqual([parameters.width, parameters.height, parameters.depth], [facade.w, facade.heightM, facade.h]);
    assert.equal(mesh.position.y, facade.baseM + facade.heightM / 2);
    const point = View.toThree({ x: expected.x + expected.w / 2, y: expected.y + expected.h / 2 }, projected, expected.baseM);
    assert.equal(mesh.position.x, point.x); assert.equal(mesh.position.z, point.z);
  } finally { View.disposeObject(content.group); }
});

test('DOM source exposes scoped accessible editor, native record confirmations and in-place navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'planner-facade-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'planner-facade-ui.css'), 'utf8');
  assert.match(source, /getElementById\('workspaceFacades'\)/);
  assert.match(source, /host\.homePlannerFacades/);
  assert.match(source, /view\.confirm/);
  assert.match(source, /Current: \$\{describe\(current\)\}/);
  assert.match(source, /setAttribute\('role', 'alert'\)/);
  assert.match(source, /setAttribute\('role', 'region'\)/);
  assert.match(source, /link\.dataset\.workspace/);
  assert.match(source, /link\.dataset\.section/);
  assert.doesNotMatch(source, /innerHTML|\.render\(|getDrawingScene\(|HomePlanner3D/);
  assert.match(css, /\.hp-facade .*overflow: auto/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media/);
});

function documentFor(planner) {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.classList = { add() {} }; this.value = '';
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { this.focused = true; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {}, ...event }); }
  }
  const host = new Node('section'), document = new Node('document'), confirmations = [];
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  document.createElement = tag => new Node(tag);
  document.getElementById = id => id === 'workspaceFacades' ? host : find(host, node => node.id === id);
  document.defaultView = new Node('window');
  Object.assign(document.defaultView, { HomePlanner: planner, crypto,
    confirm(message) { confirmations.push(message); return document.acceptConfirmation; } });
  return { document, host, find, confirmations };
}

test('mounted keyboard edits use meaningful native confirmations, cancel atomically and clean up listeners', () => {
  const old = box(), { planner, ui: unused } = setup([old]); unused.dispose();
  const { document, host, find, confirmations } = documentFor(planner), ui = UI.mount(document);
  assert.equal(UI.mount(document), ui);
  const report = find(host, node => node.dataset.workspace === 'report');
  assert.equal(report.dataset.section, 'drawings'); assert.equal(report.dataset.drawingDiscipline, 'views');
  assert.equal(report.dataset.drawingViewId, undefined, 'facade link must retain the Report selected view');
  assert.equal(report.href, '?workspace=report&section=drawings&discipline=views');
  const layout = find(host, node => node.dataset.workspace === 'design');
  assert.equal(layout.dataset.drawingDiscipline, undefined);
  const input = key => document.getElementById(`hp-facade-${key}`);
  const change = (key, value) => { input(key).value = value; input(key).dispatch(key === 'selectedId' ? 'change' : 'input'); };
  const form = find(host, node => node.tagName === 'FORM');
  change('selectedId', old.id); change('finish', 'Authored finish'); change('w', '4');
  const before = planner.exportProject();
  form.dispatch('submit');
  assert.equal(planner.exportProject(), before);
  assert.match(confirmations[0], /Current: ground:facade:existing/);
  assert.match(confirmations[0], /width 3/);
  assert.match(confirmations[0], /Proposed:.*width 4/);
  assert.match(confirmations[0], /project-relative base 6.2/);
  document.acceptConfirmation = true; form.dispatch('submit');
  assert.equal(planner.getProject().obstacles[0].facade.finish, 'Authored finish');
  assert.equal(planner.getProject().obstacles[0].w, 4);
  change('heightM', '');
  form.dispatch('submit');
  assert.equal(planner.getProject().obstacles[0].heightM, old.heightM);
  assert.equal(document.getElementById('hp-facade-error').focused, true);
  assert.equal(document.getElementById('hp-facade-error').attributes.role, 'alert');
  change('heightM', '.8');
  document.dispatch('homeplanner:workspace-change');
  assert.equal(input('heightM').value, '.8');
  const remove = find(host, node => node.tagName === 'BUTTON' && node.textContent === 'Delete selected box');
  document.acceptConfirmation = false; remove.dispatch('click');
  assert.equal(planner.getProject().obstacles.length, 1);
  assert.match(confirmations.at(-1), /Current:.*width 4/);
  assert.doesNotMatch(confirmations.at(-1), /Proposed:/);
  document.acceptConfirmation = true; remove.dispatch('click');
  assert.equal(planner.getProject().obstacles.length, 0);
  document.defaultView.dispatch('pagehide', { persisted: true });
  assert.equal(host.homePlannerFacades, ui);
  document.defaultView.dispatch('pagehide', { persisted: false });
  assert.equal(host.homePlannerFacades, undefined);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
  const remounted = UI.mount(document); assert.notEqual(remounted, ui); remounted.dispose();
});
