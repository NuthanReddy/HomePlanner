const test = require('node:test');
const assert = require('node:assert/strict');
const Drafts = require('../planner-drafts.js');
const Model = require('../planner-model.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

test('draft registry is detached, session-only, owner-qualified and independently disposable', () => {
  const planner = {}, otherPlanner = {}, a = Drafts.createStore(planner, 'One'), b = Drafts.createStore(planner, 'Two');
  const scope = { projectId: 'p', floorId: 'ground', entityId: 'x' }, value = { text: 'pending', missing: null };
  let notifications = 0; const unsubscribe = Drafts.subscribe(planner, () => notifications++);
  a.put(scope, value); value.text = 'changed outside';
  const read = a.get(scope); read.text = 'changed copy';
  assert.equal(a.get(scope).text, 'pending');
  assert.equal(Drafts.hasPending(otherPlanner), false);
  b.put({ ...scope, projectId: 'q' }, { text: 'other project' });
  assert.equal(Drafts.pending(planner, 'p').length, 1);
  assert.equal(Drafts.pending(planner).length, 2);
  assert.equal(a.get({ ...scope, floorId: 'upper' }), null);
  const token = Drafts.token(planner);
  a.put(scope, { text: 'pending', missing: null });
  assert.equal(Drafts.token(planner), token);
  a.dispose(); assert.equal(Drafts.pending(planner)[0].projectId, 'q');
  b.dispose(); assert.equal(Drafts.hasPending(planner), false);
  assert.equal(notifications, 4); unsubscribe();
});

const editors = [
  ['Structure', require('../planner-structure-ui.js'), { label: 'Pending structural note', startX: '1.25' }, true],
  ['Plumbing', require('../planner-services-ui.js'), { x: '2.75' }, true],
  ['Drainage', require('../planner-drainage-ui.js'), { x: '3.75' }, true],
  ['Facade', require('../planner-facade-ui.js'), { label: 'Pending canopy', finish: 'unverified' }, true],
  ['Views', require('../planner-elevation-ui.js'), { name: 'Pending elevation', direction: 'N' }, false]
];
for (const [name, module, patch, floorBound] of editors) test(`${name} retains dirty owner drafts across rename, selection, floors and project replacement`, () => {
  const project = createFixture('multiple-floors').project;
  for (const floor of project.floors) floor.authored = Model.emptyAuthored();
  const planner = controllerFor(project), ui = module.createController(planner, { crypto: require('node:crypto').webcrypto });
  ui.setDraft(patch);
  const pending = copy(ui.getState().draft);
  planner.execute({ type: 'rename-project', name: 'Only the project name changed' });
  assert.deepEqual(ui.getState().draft, pending);
  assert.equal(ui.getState().dirty, true);
  assert.equal(Drafts.hasPending(planner, project.id), true);
  planner.select({ kind: 'room', id: 'ground:living' });
  assert.deepEqual(ui.getState().draft, pending);
  planner.execute({ type: 'select-floor', id: 'upper' });
  if (floorBound) assert.equal(ui.getState().dirty, false);
  else assert.deepEqual(ui.getState().draft, pending);
  planner.execute({ type: 'select-floor', id: 'ground' });
  assert.deepEqual(ui.getState().draft, pending);
  const original = copy(planner.getProject()), replacement = { ...copy(original), id: 'a-different-project' };
  planner.replaceProject(replacement);
  assert.equal(ui.getState().dirty, false);
  assert.equal(Drafts.hasPending(planner, original.id), true);
  planner.replaceProject(original);
  assert.deepEqual(ui.getState().draft, pending);
  assert.equal(ui.getState().dirty, true);
  assert.deepEqual(planner.getProject(), original, 'restoring an input draft never authors it');
  ui.discardDraft(); assert.equal(ui.getState().dirty, false);
  assert.equal(Drafts.hasPending(planner), false);
  ui.dispose();
});

test('Structural dirty existing records conflict safely, and explicit reload adopts the current source', () => {
  const project = createFixture('multiple-floors').project;
  project.floors[0].authored = Model.emptyAuthored();
  project.floors[0].authored.structural = [{
    id: 'ground:authored:c', kind: 'column', anchors: [null], widthM: null, depthM: null, material: null, label: 'Original'
  }];
  const planner = controllerFor(project), ui = require('../planner-structure-ui.js').createController(planner);
  ui.select('ground:authored:c'); ui.setDraft({ label: 'Pending change' });
  const replacement = copy(planner.getProject()); replacement.floors[0].authored.structural[0].label = 'External edit';
  planner.replaceProject(replacement);
  assert.equal(ui.getState().draft.label, 'Pending change');
  assert.match(ui.getState().error, /Project changed.*draft is retained/);
  assert.equal(ui.save(), null);
  assert.deepEqual(planner.getProject(), replacement);
  ui.discardDraft(); assert.equal(ui.getState().draft.label, 'External edit');
  assert.equal(ui.getState().error, '');
  ui.setDraft({ label: 'Keep even after source deletion' });
  planner.execute({ type: 'delete-authored', collection: 'structural', id: 'ground:authored:c' });
  ui.select('');
  assert.deepEqual(ui.getState().retainedDraftIds, ['ground:authored:c']);
  ui.select('ground:authored:c'); assert.equal(ui.getState().draft.label, 'Keep even after source deletion');
  assert.equal(ui.save(), null);
  ui.discardDraft(); assert.deepEqual(ui.getState().retainedDraftIds, []);
  ui.dispose();
});

test('service record chooser can resume a retained draft whose source was deleted', () => {
  const project = createFixture('multiple-floors').project;
  project.floors[0].authored = Model.emptyAuthored();
  const id = 'ground:authored:f';
  project.floors[0].authored.fixtures = [{ id, kind: 'equipment', anchor: null, widthM: null, depthM: null, heightM: null }];
  const planner = controllerFor(project), ui = require('../planner-services-ui.js').createController(planner);
  ui.select('fixtures', id); ui.setDraft({ widthM: '0.7' });
  planner.execute({ type: 'delete-authored', collection: 'fixtures', id });
  ui.select('fixtures', '');
  assert.deepEqual(ui.getState().retainedDraftIds, [id]);
  ui.select('fixtures', id); assert.equal(ui.getState().draft.widthM, '0.7');
  assert.equal(ui.save(), null);
  assert.equal(planner.getProject().floors[0].authored.fixtures.length, 0);
  ui.discardDraft(); assert.deepEqual(ui.getState().retainedDraftIds, []); ui.dispose();
});
