'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../planner-model.js');
const { createController } = require('../planner-bridge.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

function initializingFixture() {
  const context = createFixture('furnished-single').project.legacy.context;
  let live = { controls: { ceilingHeight: { value: '9' } }, manualLayouts: [], context: null };
  let planner, failure = null, damageNextRestore = false, renders = 0;
  const renderStates = [];
  const adapter = {
    capture: () => copy(live),
    restore(value) { live = copy(value); },
    render() {
      renders++;
      renderStates.push({ busy: planner?.isBusy(), undo: planner?.canUndo(), redo: planner?.canRedo() });
      if (!live.context) {
        live.controls.initializedDefault = { value: 'Ready' };
        live.context = copy(context);
        if (failure === 'initialize') {
          failure = null;
          throw new Error('Synthetic starter initialization failure');
        }
        if (failure === 'verification') {
          failure = null;
          damageNextRestore = true;
        }
      } else if (damageNextRestore) {
        damageNextRestore = false;
        live.context.unexpectedRecaptureChange = { unknown: null };
      }
    }
  };
  planner = createController(adapter, Model);
  const seed = copy(planner.getProject());
  adapter.render();
  planner.refresh();
  return { planner, adapter, seed, renderStates, get renders() { return renders; }, fail(phase) { failure = phase; } };
}

test('newProject initializes its private seed, then verifies the initialized candidate before one revision-zero publication', () => {
  const state = initializingFixture(), { planner, seed } = state;
  assert.equal(seed.legacy.context, null);
  assert.equal(seed.legacy.controls.initializedDefault, undefined);
  planner.execute({ type: 'rename-project', name: 'Current work' });
  planner.execute({ type: 'set-environment', patch: { keepOnlyInCurrentProject: { unknown: null } } });
  planner.execute({ type: 'update-site', patch: { latitude: 19.5 } });
  planner.select({ kind: 'room', id: planner.getScene().rooms[0].id });
  const before = planner.getProject(), events = [], renders = state.renders;
  planner.subscribe(event => events.push(event));
  const next = planner.newProject();
  assert.notEqual(next.id, before.id);
  assert.notEqual(next.activeFloorId, before.activeFloorId);
  assert.equal(next.revision, 0);
  assert.equal(next.name, 'Untitled project');
  assert.equal(next.site.latitude, 17.385);
  assert.deepEqual(next.environment, seed.environment);
  assert.equal(next.legacy.controls.initializedDefault.value, 'Ready');
  assert.ok(next.legacy.context);
  assert.equal(next.building.wallHeightM, next.legacy.context.cfg.ceilingHeight);
  assert.equal(state.renders - renders, 2, 'Initialization is followed by exact recapture verification');
  assert.ok(state.renderStates.slice(-2).every(value => value.busy));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'project');
  assert.equal(events[0].project, next);
  assert.equal(planner.getSelection(), null);
  assert.equal(planner.canUndo(), false);
  assert.equal(planner.canRedo(), false);
  const saved = planner.exportProject();
  planner.importProject(saved);
  assert.equal(planner.exportProject(), saved, 'The initialized result must pass ordinary exact import');
});

for (const phase of ['initialize', 'verification'])
  test(`failed newProject ${phase} retains the current project, selection, history and adapter`, () => {
    const state = initializingFixture(), { planner, adapter } = state;
    planner.execute({ type: 'rename-project', name: 'Keep this work' });
    planner.execute({ type: 'rename-project', name: 'Keep this redo entry' });
    planner.undo();
    planner.select({ kind: 'room', id: planner.getScene().rooms[0].id });
    const before = planner.getProject(), selection = planner.getSelection(), beforeAdapter = adapter.capture(), events = [];
    planner.subscribe(event => events.push(event.type));
    state.fail(phase);
    assert.throws(() => planner.newProject(), phase === 'initialize'
      ? /Synthetic starter initialization failure/ : { code: 'RestoredSnapshotChangedError' });
    assert.equal(planner.getProject(), before);
    assert.equal(planner.getSelection(), selection);
    assert.deepEqual(adapter.capture(), beforeAdapter);
    assert.equal(planner.canUndo(), true);
    assert.equal(planner.canRedo(), true);
    assert.equal(planner.isBusy(), false);
    assert.deepEqual(events, []);
    planner.redo();
    assert.equal(planner.getProject().name, 'Keep this redo entry');
    assert.doesNotThrow(() => planner.newProject(), 'A failed initialization cannot poison the next deliberate New');
  });

test('public replacement and JSON import cannot request seed initialization or bypass exact preservation', () => {
  const { planner, seed, adapter } = initializingFixture();
  planner.execute({ type: 'rename-project', name: 'Existing initialized work' });
  const before = planner.getProject(), beforeAdapter = adapter.capture();
  for (const replace of [
    () => planner.replaceProject(seed),
    () => planner.replaceProject(seed, { initialize: true }),
    () => planner.importProject(JSON.stringify({ ...seed, initialize: true }))
  ]) {
    assert.throws(replace, { code: 'RestoredSnapshotChangedError' });
    assert.equal(planner.getProject(), before);
    assert.deepEqual(adapter.capture(), beforeAdapter);
    assert.equal(planner.canUndo(), true);
  }
  assert.equal(planner.replaceCandidate, undefined);
});

test('newProject cannot interrupt an active gesture or re-enter initialization', () => {
  const { planner, adapter } = initializingFixture(), before = planner.getProject();
  planner.beginLegacyGesture();
  assert.throws(() => planner.newProject(), /already in progress/);
  planner.endLegacyGesture(true);
  const render = adapter.render;
  adapter.render = () => {
    assert.throws(() => planner.newProject(), /already in progress/);
    render();
  };
  assert.doesNotThrow(() => planner.newProject());
  assert.notEqual(planner.getProject().id, before.id);
  assert.equal(planner.isBusy(), false);
});

// Run only on an isolated production page; this deliberately replaces its disposable project.
module.exports.browserSmoke = async function browserSmoke(page) {
  await page.waitForFunction(() => !!window.HomePlanner && !!window.__roomPlanner);
  const result = await page.evaluate(() => {
    HomePlanner.execute({ type: 'rename-project', name: 'Disposable edited project' });
    HomePlanner.execute({ type: 'set-environment', patch: { initializationProbe: { keep: null } } });
    HomePlanner.execute({ type: 'update-site', patch: { latitude: 19.5 } });
    HomePlanner.execute({ type: 'add-floor', copyFromId: HomePlanner.getProject().activeFloorId });
    for (const [id, value] of Object.entries({ bedCount: '2', kitchenCount: '0', bathCount: '1', livingCount: '1' }))
      HomePlannerRoomInputs.writeCommitted(id, value);
    render(); HomePlanner.acceptLegacy();
    const previous = HomePlanner.getProject();
    const next = HomePlanner.newProject();
    const controls = Object.fromEntries(['bedCount', 'kitchenCount', 'bathCount', 'livingCount']
      .map(id => [id, document.getElementById(id).value]));
    const encoded = HomePlanner.exportProject();
    HomePlanner.importProject(encoded);
    return {
      previousId: previous.id, previousFloorIds: previous.floors.map(floor => floor.id),
      id: next.id, floorId: next.activeFloorId, floorCount: next.floors.length,
      name: next.name, revision: next.revision, controls, counts: window.__roomPlanner.cfg.counts,
      contextPresent: !!next.legacy.context, scenePresent: !!HomePlanner.getScene(),
      latitude: next.site.latitude, carriedEnvironment: Object.hasOwn(next.environment, 'initializationProbe'),
      exactImport: HomePlanner.exportProject() === encoded,
      canUndo: HomePlanner.canUndo(), canRedo: HomePlanner.canRedo(),
      observerErrors: HomePlanner.getObserverErrors()
    };
  });
  assert.notEqual(result.id, result.previousId);
  assert.equal(result.previousFloorIds.includes(result.floorId), false);
  assert.equal(result.floorCount, 1);
  assert.equal(result.name, 'Untitled project');
  assert.equal(result.revision, 0);
  assert.deepEqual(result.controls, { bedCount: '1', kitchenCount: '1', bathCount: '2', livingCount: '0' });
  assert.equal(result.counts.bedroom, 1);
  assert.equal(result.counts.kitchen, 1);
  assert.equal(result.counts.bathroom, 2);
  assert.equal(result.counts.living, 0);
  assert.equal(result.contextPresent, true);
  assert.equal(result.scenePresent, true);
  assert.equal(result.latitude, 17.385);
  assert.equal(result.carriedEnvironment, false);
  assert.equal(result.exactImport, true);
  assert.equal(result.canUndo, false);
  assert.equal(result.canRedo, false);
  assert.deepEqual(result.observerErrors, []);
  return { initializedDefaults: true, freshProjectAndFloorIds: true, exactImport: true, contextPresent: true };
};
