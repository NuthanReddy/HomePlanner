'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../planner-model.js');
const Storage = require('../planner-storage.js');
const { createController, preserveLegacyMetadata } = require('../planner-bridge.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(document = createFixture('multiple-floors').project) {
  let live = copy(document.legacy);
  const adapter = {
    capture: () => copy(live),
    restore(value) { live = copy(value); },
    render() {},
    setCeiling(height) { if (live.context) live.context.cfg.ceilingHeight = height; }
  };
  const planner = createController(adapter, Model);
  planner.replaceProject(document);
  return { planner, adapter };
}

function normalized(document) {
  const result = copy(document), floor = result.floors.find(item => item.id === result.activeFloorId);
  floor.legacy = copy(result.legacy);
  floor.wallHeightM = result.building.wallHeightM;
  for (const key of ['wallEdits', 'doorEdits', 'windowEdits', 'furnitureEdits', 'obstacles', 'electrical'])
    floor[key] = copy(result[key]);
  return result;
}

test('a failing observer cannot fail a committed edit or starve later observers, and has visible diagnostics', t => {
  const { planner } = fixture(), calls = [], status = { textContent: 'Current floor.' };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => status } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const log = t.mock.method(console, 'error', () => {});
  const before = planner.getProject();
  planner.subscribe(event => { calls.push(['first', event.type, event.project.revision]); throw new TypeError('Private observer detail'); });
  planner.subscribe(event => { calls.push(['second', event.type, event.project.revision, event.project.name, Object.isFrozen(event)]); });
  let result;
  assert.doesNotThrow(() => { result = planner.execute({ type: 'rename-project', name: 'Committed name' }); });
  assert.equal(result, planner.getProject());
  assert.equal(result.revision, before.revision + 1);
  assert.deepEqual(calls, [
    ['first', 'change', before.revision + 1],
    ['second', 'change', before.revision + 1, 'Committed name', true]
  ]);
  assert.equal(planner.canUndo(), true);
  const errors = planner.getObserverErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'ObserverNotificationError');
  assert.equal(errors[0].projectId, before.id);
  assert.equal(errors[0].revision, result.revision);
  assert.equal(errors[0].errorName, 'TypeError');
  assert.ok(Object.isFrozen(errors) && Object.isFrozen(errors[0]));
  assert.match(status.textContent, /ObserverNotificationError.*action remains applied/);
  assert.doesNotMatch(status.textContent, /Private observer detail/);
  assert.equal(log.mock.callCount(), 1);
  assert.doesNotThrow(() => planner.undo());
  assert.equal(planner.getProject().name, before.name);
  assert.equal(calls.at(-1)[0], 'second');
  assert.equal(calls.at(-1)[1], 'restore');
});

test('asynchronous observer rejection is reported without an unhandled rejection or a second edit', async t => {
  const { planner } = fixture(), before = planner.getProject(), events = [];
  const log = t.mock.method(console, 'error', () => {});
  planner.subscribe(async () => { throw new Error('Private asynchronous error'); });
  planner.subscribe(event => events.push(event.type));
  planner.execute({ type: 'rename-project', name: 'Applied before notification settles' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(planner.getProject().revision, before.revision + 1);
  assert.deepEqual(events, ['change']);
  assert.equal(planner.getObserverErrors()[0].revision, before.revision + 1);
  assert.equal(log.mock.callCount(), 1);
});

test('no-op authored commands preserve snapshot identity, revisions, selection, future history and notifications', () => {
  const { planner } = fixture();
  planner.execute({ type: 'set-environment', patch: { userReview: { unknown: null, order: ['one', 'two'] } } });
  planner.execute({ type: 'rename-project', name: 'Temporary name' });
  planner.undo();
  planner.select({ kind: 'room', id: planner.getScene().rooms[0].id });
  const before = planner.getProject(), selection = planner.getSelection(), scene = planner.getScene(), events = [];
  planner.subscribe(event => events.push(event.type));
  for (const command of [
    { type: 'rename-project', name: before.name },
    { type: 'update-site', patch: copy(before.site) },
    { type: 'update-building', patch: copy(before.building) },
    { type: 'update-floor', id: before.activeFloorId, patch: { name: before.floors.find(floor => floor.id === before.activeFloorId).name } },
    { type: 'set-environment', patch: {} },
    { type: 'set-environment', patch: { userReview: { order: ['one', 'two'], unknown: null } } },
    { type: 'set-electrical', value: copy(before.electrical) },
    { type: 'set-obstacles', value: copy(before.obstacles) }
  ]) {
    assert.equal(planner.execute(command), before);
    assert.equal(planner.getProject(), before);
    assert.equal(planner.getScene(), scene);
    assert.equal(planner.getSelection(), selection);
    assert.equal(planner.canRedo(), true);
  }
  assert.deepEqual(events, []);
  planner.redo();
  assert.equal(planner.getProject().name, 'Temporary name');
});

for (const kind of ['site', 'building']) test(`${kind} inputs and environment provenance are one complete saveable snapshot and one Undo`, () => {
  const { planner } = fixture(), before = planner.getProject(), inactive = before.floors.find(floor => floor.id !== before.activeFloorId);
  const field = kind === 'site' ? 'siteProvenance' : 'buildingAssumptions';
  const patch = kind === 'site'
    ? { latitude: 19.5, longitude: 78.2, timeZone: 'Asia/Kolkata' }
    : { wallHeightM: 3.1, floorElevationM: .4, roofThicknessM: .2 };
  const provenance = { ...patch, floorId: before.activeFloorId, acknowledged: true, reference: null };
  const environmentPatch = { schemaVersion: 1, [field]: provenance };
  const events = [];
  planner.subscribe(event => events.push(event.type));
  planner.execute({ type: `update-${kind}`, patch, environmentPatch });
  provenance.reference = 'Changed outside the command';
  const applied = planner.getProject();
  assert.equal(applied.revision, before.revision + 1);
  assert.deepEqual(applied[kind], { ...before[kind], ...patch });
  assert.deepEqual(applied.environment, { ...before.environment, schemaVersion: 1, [field]: { ...provenance, reference: null } });
  assert.deepEqual(applied.floors.find(floor => floor.id === inactive.id), inactive);
  assert.deepEqual(events, ['change']);
  const record = Storage.createRecord(applied);
  assert.deepEqual(Storage.readRecord(record).document, applied);
  planner.undo();
  assert.deepEqual(planner.getProject()[kind], before[kind]);
  assert.deepEqual(planner.getProject().environment, before.environment);
  assert.equal(planner.canUndo(), false);
  planner.redo();
  assert.deepEqual(planner.getProject()[kind], applied[kind]);
  assert.deepEqual(planner.getProject().environment, applied.environment);
});

test('malformed compound metadata and non-JSON values cannot partially apply inputs', () => {
  const { planner } = fixture(), before = planner.getProject();
  let getterCalls = 0;
  const getter = { get reference() { getterCalls++; return 'Must not run'; } };
  for (const environmentPatch of [null, [], false, 1, 'x', { value: NaN }, { value: undefined }, getter]) {
    assert.throws(() => planner.execute({ type: 'update-site', patch: { latitude: 19.5 }, environmentPatch }));
    assert.deepEqual(planner.getProject(), before);
    assert.equal(planner.canUndo(), false);
  }
  assert.equal(getterCalls, 0);
  assert.throws(() => planner.execute({ type: 'rename-project', name: 'Not applied', environmentPatch: {} }), /only site or building/);
  assert.deepEqual(planner.getProject(), before);
});

test('one combined environment result patch restores both source inputs and results with one Undo', () => {
  const { planner } = fixture(), before = planner.getProject();
  const patch = { materials: { source: 'Synthetic lifecycle fixture', unknown: null },
    results: { assemblies: { input: { unknown: null }, output: { testMarker: 'not a physical prediction' } } } };
  planner.execute({ type: 'set-environment', patch });
  assert.equal(planner.getProject().revision, before.revision + 1);
  assert.deepEqual(planner.getProject().environment, { ...before.environment, ...patch });
  planner.undo();
  assert.deepEqual(planner.getProject().environment, before.environment);
  assert.equal(planner.canUndo(), false);
});

test('raw import preserves full metadata, nullable inputs and inactive floors while normalizing only active mirrors', () => {
  const { planner } = fixture(), input = copy(planner.getProject());
  delete input.name;
  input.revision = 19;
  input.extra = { unknown: null, list: ['b', 'a'] };
  input.legacy.extension = { nullable: null, source: 'Retain the current alias' };
  input.legacy.context.extension = { known: false };
  input.legacy.context.plan.extension = { reference: null };
  const active = input.floors.find(floor => floor.id === input.activeFloorId);
  active.legacy.extension = { source: 'Stale mirror, not an independent document' };
  active.wallEdits = {};
  const inactive = input.floors.find(floor => floor.id !== input.activeFloorId);
  inactive.legacy.extension = { original: null };
  inactive.futureMetadata = { keep: null };
  const supplied = copy(input), expected = normalized(input);
  planner.importProject(JSON.stringify(input));
  assert.deepEqual(planner.getProject(), expected);
  assert.deepEqual(input, supplied);
  assert.equal(planner.getProject().id, supplied.id, 'Raw bridge import retains the supplied ID');
  assert.equal(planner.getProject().revision, supplied.revision);
  assert.equal(Object.hasOwn(planner.getProject(), 'name'), false);
  assert.equal(planner.canUndo(), false);
  assert.equal(planner.canRedo(), false);
  assert.deepEqual(Storage.parseProject(planner.exportProject()), expected);
});

for (const damage of ['metadata', 'controls', 'geometry']) test(`damaged ${damage} recapture rejects replacement without changing project, adapter, selection or history`, () => {
  const { planner, adapter } = fixture();
  planner.execute({ type: 'rename-project', name: 'Keep this edit' });
  planner.execute({ type: 'rename-project', name: 'Redo this edit' });
  planner.undo();
  planner.select({ kind: 'room', id: planner.getScene().rooms[0].id });
  const before = planner.getProject(), selection = planner.getSelection(), beforeAdapter = adapter.capture(), events = [];
  const incoming = copy(before);
  incoming.id = 'replacement-not-accepted';
  incoming.legacy.extension = { keep: null };
  const capture = adapter.capture;
  let corrupt = true;
  adapter.capture = () => {
    const value = capture();
    if (corrupt) {
      corrupt = false;
      if (damage === 'metadata') delete value.extension;
      if (damage === 'controls') value.controls.unknownChangedControl = { value: 'Different inputs' };
      if (damage === 'geometry') value.context.plan.placed.pop();
    }
    return value;
  };
  planner.subscribe(event => events.push(event.type));
  assert.throws(() => planner.replaceProject(incoming), /replacement|re-layout|restore|changed/i);
  assert.equal(planner.getProject(), before);
  assert.equal(planner.getSelection(), selection);
  assert.deepEqual(adapter.capture(), beforeAdapter);
  assert.deepEqual(events, []);
  assert.equal(planner.canUndo(), true);
  assert.equal(planner.canRedo(), true);
  planner.redo();
  assert.equal(planner.getProject().name, 'Redo this edit');
  planner.undo();
  planner.undo();
  assert.equal(planner.canUndo(), false);
});

test('a damaged metadata recapture cannot silently change an Undo snapshot', () => {
  const { planner, adapter } = fixture(), input = copy(planner.getProject());
  input.legacy.extension = { keep: null };
  planner.replaceProject(input);
  planner.execute({ type: 'rename-project', name: 'Current edit' });
  const before = planner.exportProject(), capture = adapter.capture;
  let corrupt = true;
  adapter.capture = () => {
    const value = capture();
    if (corrupt) { corrupt = false; delete value.extension; }
    return value;
  };
  assert.throws(() => planner.undo(), { code: 'RestoredSnapshotChangedError' });
  assert.equal(planner.exportProject(), before);
  assert.equal(planner.canUndo(), true);
  assert.equal(planner.canRedo(), false);
});

test('replacement cannot re-enter another transaction or interrupt a legacy gesture', () => {
  const { planner, adapter } = fixture(), before = planner.getProject();
  adapter.render = () => assert.throws(() => planner.replaceProject(before), /already in progress/);
  planner.execute({ type: 'update-floor', id: before.activeFloorId, patch: { heightM: 3.5 } });
  planner.beginLegacyGesture();
  assert.throws(() => planner.replaceProject(before), /already in progress/);
  planner.endLegacyGesture(true);
});

test('browser capture preservation retains unknown legacy metadata without reviving deleted keyed geometry', () => {
  const before = { controls: { size: { value: '1', extension: null }, unknownControl: { value: 'Keep' } },
    manualLayouts: [['old-signature', { extension: null, rooms: { deleted: { x: 1 } } }]],
    extension: { keep: null }, context: {
      plate: { extension: null }, g: { extension: null, balconies: [] }, cfg: { extension: null },
      plan: { extension: null, furniture: [{ id: 'gone', label: 'Removed' }, { id: 'kept', extension: null, x: 1 }] }
    } };
  const captured = { controls: { size: { value: '2' } },
    manualLayouts: [['old-signature', { rooms: {} }]], context: {
      plate: {}, g: { balconies: [] }, cfg: {},
      plan: { furniture: [{ id: 'kept', x: 2 }, { x: 9 }, { x: 10 }] }
    } };
  const original = copy(before), after = preserveLegacyMetadata(before, captured);
  assert.deepEqual(before, original);
  assert.deepEqual(after.extension, { keep: null });
  assert.deepEqual(after.controls.size, { value: '2', extension: null });
  assert.deepEqual(after.controls.unknownControl, before.controls.unknownControl);
  assert.deepEqual(after.manualLayouts[0][1], { extension: null, rooms: {} });
  assert.deepEqual(after.context.plan.furniture, [{ id: 'kept', extension: null, x: 2 }, { x: 9 }, { x: 10 }]);
  assert.equal(after.context.plan.extension, null);
  assert.equal(after.context.cfg.extension, null);
});

test('browser-compatible adapter capture round-trips nested nullable metadata on a real project', () => {
  const source = createFixture('multiple-floors').project;
  source.legacy.extension = { reference: null };
  source.legacy.context.cfg.walls.extension = { material: null };
  source.legacy.context.plan.placed[0].carpet.extension = { survey: null };
  source.legacy.context.plan.openings.windows[0].segment.extension = { source: null };
  const { planner, adapter } = fixture(source), before = planner.getProject(), capture = adapter.capture;
  adapter.capture = () => {
    const generated = capture();
    delete generated.extension;
    delete generated.context.cfg.walls.extension;
    delete generated.context.plan.placed[0].carpet.extension;
    delete generated.context.plan.openings.windows[0].segment.extension;
    return preserveLegacyMetadata(planner.getProject().legacy, generated);
  };
  planner.replaceProject(before);
  assert.deepEqual(planner.getProject(), before);
  planner.execute({ type: 'rename-project', name: 'Metadata remains attached' });
  assert.deepEqual(planner.getProject().legacy, before.legacy);
});

for (const kind of ['door', 'window']) for (const custom of [false, true])
  test(`${custom ? 'custom' : 'generated'} ${kind} deletion suppresses only its physical aperture and survives Undo, Redo, JSON and floors`, () => {
    const source = createFixture('multiple-floors').project;
    const collection = kind === 'window' ? 'windows' : 'doors';
    const edits = kind === 'window' ? 'windowEdits' : 'doorEdits';
    const sourceId = kind === 'window' ? 'living-window' : 'entry';
    const context = source.legacy.context, record = context.plan.openings[collection].find(item => item.id === sourceId);
    record.extension = { unknown: null };
    if (custom) {
      context.plan.openings[collection] = context.plan.openings[collection].filter(item => item !== record);
      context.plan.customOpenings.push({ ...record, type: kind, custom: true });
    }
    const { planner } = fixture(source), before = planner.getProject(), scene = planner.getScene();
    const opening = scene.openings.find(item => item.sourceId === sourceId), events = [];
    assert.ok(opening);
    planner.select({ kind, id: opening.id });
    planner.subscribe(event => events.push(event.type));
    planner.execute({ type: 'delete-opening', id: opening.id });
    const deleted = planner.getProject(), after = planner.getScene();
    assert.equal(deleted.revision, before.revision + 1);
    assert.deepEqual(events, ['change']);
    assert.deepEqual(deleted[edits][opening.id], { ...before[edits][opening.id], suppressed: true });
    assert.deepEqual(deleted.legacy, before.legacy, 'Source records are retained, not erased from the backup');
    assert.deepEqual(after.openings, scene.openings.filter(item => item.id !== opening.id));
    assert.deepEqual(after.rooms, scene.rooms);
    assert.deepEqual(after.furniture, scene.furniture);
    const restoredWallArea = after.metrics.solidWallFaceAreaM2 - scene.metrics.solidWallFaceAreaM2;
    assert.ok(Math.abs(restoredWallArea - opening.widthM * opening.heightM) < 1e-7);
    assert.equal(planner.getSelection(), null);
    const inactive = before.floors.find(floor => floor.id !== before.activeFloorId);
    assert.deepEqual(deleted.floors.find(floor => floor.id === inactive.id), inactive);
    planner.undo();
    assert.deepEqual(planner.getScene().openings, scene.openings);
    assert.deepEqual(planner.getProject()[edits], before[edits]);
    assert.equal(planner.canUndo(), false);
    planner.redo();
    assert.deepEqual(planner.getScene().openings, after.openings);
    const restored = fixture().planner;
    restored.importProject(planner.exportProject());
    assert.deepEqual(restored.getScene().openings, after.openings);
    const saved = Storage.createRecord(restored.getProject());
    assert.equal(saved.document[edits][opening.id].suppressed, true);
    restored.execute({ type: 'select-floor', id: inactive.id });
    assert.deepEqual(restored.getProject()[edits], inactive[edits]);
    restored.execute({ type: 'select-floor', id: before.activeFloorId });
    assert.deepEqual(restored.getScene().openings, after.openings);
    restored.execute({ type: 'add-floor', copyFromId: before.activeFloorId });
    const duplicatedId = `${restored.getProject().activeFloorId}:${sourceId}`;
    assert.equal(restored.getProject()[edits][duplicatedId].suppressed, true);
    assert.equal(restored.getScene().openings.some(item => item.sourceId === sourceId), false);
  });

test('opening suppression is strictly typed in active and inactive floor imports', () => {
  const { planner } = fixture(), before = planner.getProject();
  for (const suppressed of [null, 'true', 1, []]) {
    const document = copy(before);
    document.windowEdits['ground:living-window'] = { suppressed };
    assert.throws(() => Model.validateProject(document), /suppressed|boolean/);
    delete document.windowEdits['ground:living-window'];
    document.floors[1].doorEdits['upper:study-access'] = { suppressed };
    assert.throws(() => Model.validateProject(document), /suppressed|boolean/);
    assert.equal(planner.getProject(), before);
  }
});

test('opening deletion cannot bypass a protected host and a missing suppression implementation rolls back', () => {
  const source = createFixture('multiple-floors').project;
  let live = copy(source.legacy), protect = true;
  const model = { ...Model, buildScene(context, project) {
    const unsuppressed = copy(project);
    for (const key of ['doorEdits', 'windowEdits'])
      for (const edit of Object.values(unsuppressed[key])) delete edit.suppressed;
    const scene = Model.buildScene(context, unsuppressed);
    if (protect) scene.walls.forEach(wall => { wall.structuralRole = 'structural'; });
    return scene;
  } };
  const planner = createController({ capture: () => copy(live), restore(value) { live = copy(value); }, render() {} }, model);
  planner.replaceProject(source);
  const before = planner.getProject(), opening = planner.getScene().openings[0];
  assert.throws(() => planner.execute({ type: 'delete-opening', id: opening.id }), /unprotected/);
  assert.deepEqual(planner.getProject(), before);
  protect = false;
  planner.replaceProject(before);
  assert.throws(() => planner.execute({ type: 'delete-opening', id: opening.id }), /suppression was not applied.*rolled back/);
  assert.deepEqual(planner.getProject(), before);
  assert.equal(planner.canUndo(), false);
});

test('non-JSON adapter recapture fails before cloning can turn a nonfinite value into null', () => {
  const { planner, adapter } = fixture(), before = planner.getProject(), capture = adapter.capture;
  let corrupt = false, firstRender = true;
  adapter.render = () => {
    if (firstRender) { firstRender = false; corrupt = true; }
  };
  adapter.capture = () => {
    const value = capture();
    if (corrupt) { corrupt = false; value.extension = { invalid: NaN }; }
    return value;
  };
  assert.throws(() => planner.execute({ type: 'update-floor', id: before.activeFloorId, patch: { heightM: 3.8 } }), /finite/);
  assert.deepEqual(planner.getProject(), before);
  assert.equal(planner.canUndo(), false);
  assert.equal(Object.hasOwn(planner.getProject().legacy, 'extension'), false);
});

test('a mutating restore adapter cannot alter caller input or the retained current project', () => {
  const { planner, adapter } = fixture(), before = planner.getProject(), restore = adapter.restore;
  const incoming = copy(before);
  incoming.legacy.extension = { keep: null };
  const supplied = copy(incoming);
  let corrupt = true;
  adapter.restore = value => {
    if (corrupt) { corrupt = false; value.controls.changedByAdapter = { value: 'Unexpected change' }; }
    restore(value);
  };
  assert.throws(() => planner.replaceProject(incoming), { code: 'RestoredSnapshotChangedError' });
  assert.equal(planner.getProject(), before);
  assert.deepEqual(adapter.capture(), before.legacy);
  assert.deepEqual(incoming, supplied);
});

test('scene compilation errors reject the transaction before history or observer publication', () => {
  const source = createFixture('multiple-floors').project;
  let live = copy(source.legacy);
  const model = { ...Model, buildScene(context, project) {
    if (project.name === 'Cannot compile') throw new Error('Synthetic scene build failure');
    return Model.buildScene(context, project);
  } };
  const planner = createController({ capture: () => copy(live), restore(value) { live = copy(value); }, render() {} }, model);
  planner.replaceProject(source);
  const before = planner.getProject(), events = [];
  planner.subscribe(event => events.push(event.type));
  assert.throws(() => planner.execute({ type: 'rename-project', name: 'Cannot compile' }), /Synthetic scene build failure/);
  assert.deepEqual(planner.getProject(), before);
  assert.equal(planner.canUndo(), false);
  assert.equal(planner.canRedo(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(planner.getObserverErrors(), []);
});

for (const kind of ['hinged', 'sliding', 'window'])
  test(`canonical full-wall ${kind} remains editable and deletable without masonry`, () => {
    const document = createFixture('multiple-floors').project;
    const base = Model.buildScene(document.legacy.context, document);
    const wall = base.walls.find(item => !item.exterior &&
      item.roomIds.includes('ground:living') && item.roomIds.includes('ground:kitchen'));
    assert.ok(wall);
    const widthM = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    document.doorEdits = {}; document.windowEdits = {};
    const plan = document.legacy.context.plan;
    plan.openings = { doors: [], windows: [] };
    plan.wallOpenings = [];
    plan.customOpenings = [{
      id: `full-wall-${kind}`, type: kind === 'window' ? 'window' : 'door', kind, custom: true,
      wallId: wall.id, roomId: 'living', targetRoomId: 'kitchen',
      offsetM: 0, widthM, sillM: 0, heightM: wall.heightM, openFraction: 0,
      hinge: 'start', swing: 'left', extension: { reference: null }
    }];
    const { planner } = fixture(document), before = planner.getProject();
    const scene = planner.getScene(), opening = scene.openings.find(item => item.sourceId === `full-wall-${kind}`);
    assert.ok(opening);
    assert.equal(scene.walls.find(item => item.id === wall.id).removed, true);
    assert.deepEqual(scene.walls.find(item => item.id === wall.id).solidSections, []);

    planner.execute({ type: kind === 'window' ? 'update-window' : 'update-door',
      id: opening.id, heightM: wall.heightM / 2 });
    assert.equal(planner.getScene().openings.find(item => item.id === opening.id).heightM, wall.heightM / 2);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, false);
    planner.undo();
    assert.deepEqual(planner.getScene().openings, scene.openings);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, true);

    const beforeAdd = planner.exportProject();
    assert.throws(() => planner.execute({ type: 'add-window', wallId: wall.id,
      offsetM: 0, widthM: .3, sillM: 0, heightM: .5, openFraction: 0 }), /surviving/);
    assert.equal(planner.exportProject(), beforeAdd);
    const revision = planner.getProject().revision;
    planner.execute({ type: 'delete-opening', id: opening.id });
    assert.equal(planner.getProject().revision, revision + 1);
    assert.equal(planner.getScene().openings.some(item => item.id === opening.id), false);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, false);
    const area = planner.getScene().metrics.solidWallFaceAreaM2 - scene.metrics.solidWallFaceAreaM2;
    assert.ok(Math.abs(area - widthM * wall.heightM) < 1e-7);
    assert.deepEqual(planner.getProject().legacy, before.legacy);
    planner.undo();
    assert.deepEqual(planner.getScene().openings, scene.openings);
    assert.equal(planner.canUndo(), false);
    planner.redo();
    const restored = fixture(JSON.parse(planner.exportProject())).planner;
    assert.equal(restored.getScene().openings.some(item => item.id === opening.id), false);
    assert.equal(restored.getScene().walls.find(item => item.id === wall.id).removed, false);
  });

test('partition removal does not make unresolved ordinary openings eligible for deletion or editing', () => {
  const { planner } = fixture(), opening = planner.getScene().openings.find(item => item.sourceId === 'kitchen-access');
  assert.ok(opening);
  planner.execute({ type: 'open-wall', id: opening.wallId, full: true, confirmConceptual: true });
  assert.equal(planner.getScene().openings.some(item => item.id === opening.id), false);
  assert.ok(planner.getScene().unresolvedOpenings.some(item => item.id === opening.id));
  const before = planner.getProject();
  assert.throws(() => planner.execute({ type: 'delete-opening', id: opening.id }), /no longer on this floor/);
  assert.throws(() => planner.execute({ type: 'update-door', id: opening.id, heightM: 1.5 }), /no longer on this floor/);
  assert.equal(planner.getProject(), before);
});

test('production legacy filtering retains merged original sources, provenance and valid source diagnostics through recapture', () => {
  const document = createFixture('multiple-floors').project;
  const original = document.legacy.context.plan.openings.doors.find(item => item.id === 'entry');
  original.provenance = { reference: null, label: 'Original generated source' };
  document.legacy.context.plan.openings.doors.push({ ...copy(original), id: 'ground:entry-alias',
    provenance: { reference: null, label: 'Opaque source alias' } });
  for (const window of document.legacy.context.plan.openings.windows) window.operability = .5;
  document.doorEdits['ground:entry'] = { openFraction: .25, review: { keep: null } };
  document.doorEdits['ground:ground:entry-alias'] = { openFraction: .25, review: { keep: 'Alias review' } };
  let live = copy(document.legacy), helpers;
  const root = { __roomPlanner: live.context };
  let planner;
  const adapter = {
    capture() {
      return helpers ? preserveLegacyMetadata(planner.getProject().legacy,
        { ...copy(live), context: helpers.contextSnapshot() }) : copy(live);
    },
    restore(value) { live = copy(value); root.__roomPlanner = live.context; },
    render() {
      if (helpers) planner.applyOpeningEdits(live.context.g, live.context.plan, live.context.cfg);
    }
  };
  planner = createController(adapter, Model);
  planner.replaceProject(document);
  const source = fs.readFileSync(path.join(__dirname, '..', 'planner-bridge.js'), 'utf8');
  const section = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing production projection anchor: ${start}`);
    return source.slice(first, last);
  };
  vm.runInNewContext("'use strict';\n" +
    section('  const openingSources=new WeakMap();', '  function scheduleCapture()') +
    section('  function renderContext(g,plan,cfg){', '  controller.prepareHostedOpenings=') +
    section('  controller.applyOpeningEdits=', '  const escape=') +
    '\nexpose({sourcePlan,contextSnapshot,renderContext});',
  { root, Model, controller: planner, clone: copy, expose(value) { helpers = value; } },
  { filename: 'planner-bridge-browser-projection.js' });
  adapter.render();
  planner.refresh();
  const before = planner.getProject(), opening = planner.getScene().openings.find(item => item.sourceIds?.includes('entry'));
  assert.ok(opening);
  assert.deepEqual(new Set(opening.sourceIds), new Set(['entry', 'ground:entry-alias']));
  planner.execute({ type: 'delete-opening', id: opening.id });
  const after = planner.getProject();
  assert.equal(after.revision, before.revision + 1);
  for (const id of ['ground:entry', 'ground:ground:entry-alias'])
    assert.deepEqual(after.doorEdits[id], { ...before.doorEdits[id], suppressed: true });
  assert.equal(live.context.plan.openings.doors.some(item => ['entry', 'ground:entry-alias'].includes(item.id)), false);
  assert.deepEqual(after.legacy.context.plan.openings.doors, before.legacy.context.plan.openings.doors);
  assert.deepEqual(helpers.contextSnapshot().plan.openings.doors, before.legacy.context.plan.openings.doors);
  const viewScene = Model.buildScene(helpers.renderContext(live.context.g, live.context.plan, live.context.cfg), after);
  assert.equal(viewScene.openings.some(item => item.sourceIds?.includes('entry') || item.sourceId === 'entry'), false);
  for (const scene of [planner.getScene(), viewScene])
    assert.equal(scene.diagnostics.some(item => /saved opening edit has no current source/i.test(item.message)), false);
  adapter.render();
  planner.acceptLegacy();
  assert.equal(planner.getProject(), after, 'Repeated projection must not author another change');
  planner.undo();
  assert.deepEqual(planner.getProject().doorEdits, before.doorEdits);
  assert.deepEqual(planner.getProject().legacy.context.plan.openings.doors, before.legacy.context.plan.openings.doors);
  planner.redo();
  const imported = fixture(JSON.parse(planner.exportProject())).planner;
  assert.deepEqual(imported.getProject().legacy.context.plan.openings.doors, before.legacy.context.plan.openings.doors);
  assert.equal(imported.getScene().diagnostics.some(item => /saved opening edit has no current source/i.test(item.message)), false);
  assert.equal(imported.getScene().openings.some(item => item.sourceIds?.includes('entry') || item.sourceId === 'entry'), false);
});
