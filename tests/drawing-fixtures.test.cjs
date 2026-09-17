const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../planner-model.js');
const { fixtureIds, createFixture, controllerFor, buildScenes } = require('./fixtures/drawing-fixtures.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const diagnosticsFor = (scene, id, pattern) => scene.diagnostics.filter(item =>
  item.ids.includes(id) && pattern.test(item.message));

for (const id of fixtureIds) {
  test(`${id}: deterministic, independent, schema-1 round trip and pure real-model projection`, () => {
    const fixture = createFixture(id);
    const second = createFixture(id);
    assert.deepEqual(second, fixture);
    assert.notEqual(second.project, fixture.project);
    assert.notEqual(second.project.floors[0].legacy, fixture.project.floors[0].legacy);
    const serialized = JSON.stringify(fixture);
    freeze(fixture);
    assert.equal(Model.validateProject(fixture.project), fixture.project);
    const parsed = Model.parseProject(JSON.stringify(fixture.project));
    assert.deepEqual(parsed, fixture.project);
    const scenes = buildScenes(fixture.project);
    assert.deepEqual(buildScenes(parsed), scenes);
    assert.deepEqual(buildScenes(second.project), scenes);
    assert.equal(JSON.stringify(fixture), serialized);
    assert.deepEqual(JSON.parse(controllerFor(parsed).exportProject()), parsed);
    if (fixture.project.legacy.context) {
      const direct = Model.buildScene(fixture.project.legacy.context, fixture.project);
      assert.deepEqual(direct, scenes.find(scene => scene.floorId === fixture.project.activeFloorId));
      assert.deepEqual(Model.buildScene(fixture.project.legacy.context, fixture.project), direct);
    }
    for (const scene of scenes) {
      assert.ok(Object.isFrozen(scene));
      assert.ok(scene.walls.length > 0);
      assert.ok(scene.walls.every(wall => wall.structuralRole === 'unknown'));
      assert.ok(scene.diagnostics.some(item => /not a construction survey/.test(item.message)));
      for (const collection of ['rooms', 'walls', 'openings', 'furniture', 'obstacles']) {
        const ids = scene[collection].map(item => item.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(ids.every(entityId => entityId.startsWith(`${scene.floorId}:`)));
      }
      for (const opening of scene.openings) {
        const wall = scene.walls.find(item => item.id === opening.wallId);
        assert.ok(wall, opening.id);
        assert.ok(opening.offsetM >= 0);
        assert.ok(opening.offsetM + opening.widthM <=
          Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) + 1e-8);
      }
      if (id !== 'invalid-attachments') {
        assert.deepEqual(scene.unresolvedOpenings, []);
        assert.deepEqual(scene.diagnostics.filter(item => item.level === 'error'), []);
      }
    }
  });
}

test('furnished sample has actual shared partitions, hosted apertures and clear-carpet furniture', () => {
  const { project } = createFixture('furnished-single');
  const scene = Model.buildScene(project.legacy.context, project);
  assert.equal(scene.rooms.length, 4);
  assert.equal(scene.furniture.length, 6);
  assert.equal(scene.openings.filter(item => item.kind === 'hinged').length, 4);
  assert.equal(scene.openings.filter(item => item.kind === 'window').length, 4);
  assert.ok(scene.walls.some(wall => !wall.exterior && wall.roomIds.length === 2));
  close(scene.metrics.roomCarpetM2, 4 * 4.2 * 3.2);
  for (const item of scene.furniture) {
    const room = scene.rooms.find(room => room.id === item.roomId);
    assert.ok(room);
    assert.ok(item.rect.x >= room.rect.x && item.rect.y >= room.rect.y);
    assert.ok(item.rect.x + item.rect.w <= room.rect.x + room.rect.w);
    assert.ok(item.rect.y + item.rect.h <= room.rect.y + room.rect.h);
    assert.equal(item.headDirectionAssumed, false);
  }
  const bed = scene.furniture.find(item => item.sourceId === 'bed');
  assert.equal(bed.headLocal, 'E');
  assert.equal(bed.pinned, true);
  const door = scene.openings.find(item => item.sourceId === 'bedroom-access');
  assert.equal(door.openFraction, .25);
  assert.equal(door.hinge, 'end');
  close(Model.doorGeometry(door, scene.walls.find(wall => wall.id === door.wallId)).radiusM, .9);
  assert.equal(scene.openings.find(item => item.sourceId === 'living-window').openFraction, .4);
  assert.deepEqual(scene.diagnostics.filter(item => item.level === 'warning'), []);
});

test('real bridge isolates different floors, edits, attachments and stacked elevations on selection', () => {
  const { project } = createFixture('multiple-floors');
  const controller = controllerFor(project);
  const [ground, upper] = controller.getScenes();
  assert.deepEqual([ground.rooms.length, upper.rooms.length], [4, 2]);
  close(ground.floorElevationM, .45);
  close(upper.floorElevationM, 3.65);
  close(ground.wallHeightM, 2.8);
  close(upper.wallHeightM, 2.6);
  assert.ok(upper.walls.every(wall => wall.baseM === upper.floorElevationM && wall.heightM === 2.6));
  assert.equal(ground.rooms.find(item => item.sourceId === 'living').id, 'ground:living');
  assert.equal(upper.rooms.find(item => item.sourceId === 'living').id, 'upper:living');
  for (const key of ['rooms', 'walls', 'openings', 'furniture', 'electrical']) {
    const lowerIds = new Set(ground[key].map(item => item.id));
    assert.ok(upper[key].every(item => !lowerIds.has(item.id)));
  }
  for (const scene of [ground, upper]) {
    assert.equal(scene.electrical.length, 1);
    assert.ok(scene.walls.some(wall => wall.id === scene.electrical[0].wallId));
  }
  controller.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(controller.getScene().floorId, 'upper');
  assert.deepEqual(controller.getScene().rooms, upper.rooms);
  assert.deepEqual(controller.getProject().furnitureEdits, project.floors[1].furnitureEdits);
  assert.deepEqual(controller.getProject().electrical, project.floors[1].electrical);
  assert.equal(controller.getScene().furniture[0].headLocal, 'W');
  controller.execute({ type: 'set-electrical', value: [] });
  controller.execute({ type: 'select-floor', id: 'ground' });
  assert.deepEqual(controller.getScene().rooms, ground.rooms);
  assert.deepEqual(controller.getScene().electrical, ground.electrical);
  assert.deepEqual(controller.getProject().furnitureEdits, project.floors[0].furnitureEdits);
  const restored = controllerFor(Model.parseProject(controller.exportProject()));
  assert.deepEqual(restored.getScenes()[0].electrical, ground.electrical);
  assert.deepEqual(restored.getScenes()[1].electrical, []);
  assert.deepEqual(restored.getScenes()[1].rooms, upper.rooms);
  assert.deepEqual(project, createFixture('multiple-floors').project);
});

test('setback plot, floor, building and ENU site coordinates remain distinct', () => {
  const { project } = createFixture('setback-plot');
  const scene = buildScenes(project)[0];
  assert.deepEqual(scene.floor, { x: 0, y: 0, w: 10, h: 8 });
  assert.deepEqual(scene.building, { x: .5, y: .5, w: 9, h: 7 });
  assert.deepEqual(scene.plot, { x: -1, y: -3, w: 13, h: 15 });
  assert.equal(scene.headingDeg, 90);
  close(scene.floorElevationM, .45);
  assert.equal(project.legacy.context.plate.floorElevation, 90);
  const centre = Model.localToWorld({ x: 5, y: 4 }, scene);
  close(centre.east, 0); close(centre.north, 0); close(centre.up, .45);
  const corner = Model.localToWorld({ x: scene.plot.x, y: scene.plot.y }, scene);
  close(corner.east, 7); close(corner.north, 6);
  const vector = Model.worldVectorToLocal({ east: corner.east, north: corner.north, up: 0 }, scene);
  close(vector.x, -6); close(vector.y, -7);
  assert.equal(scene.obstacles[0].x, -4);
  assert.equal(scene.obstacles[0].baseM, 0);
  assert.equal(scene.regulatory.nonCompliantSetbacks, true);
  assert.equal(scene.regulatory.allowedFloors, 4);
  assert.equal(scene.regulatory.plannedFloors, 3);
  assert.match(scene.regulatory.basis, /Not independently validated planning permission/);
  const explicit = clone(project.legacy.context);
  explicit.plate.sitePlot = { x: -2, y: -4, w: 15, h: 17 };
  assert.deepEqual(Model.buildScene(explicit, project).plot, explicit.plate.sitePlot);
  explicit.plate.sitePlot.w = 1;
  assert.throws(() => Model.buildScene(explicit, project), /outside.*plot boundary/);
});

test('sparse inputs retain unknowns and fallback diagnostics rather than inventing analysis data', () => {
  const { project } = createFixture('sparse-unknown');
  const scene = buildScenes(project)[0];
  assert.deepEqual(project.environment, {});
  assert.equal(scene.plot, null);
  assert.equal(scene.regulatory.allowedFloors, null);
  assert.equal(scene.regulatory.selectedHeightM, null);
  for (const key of ['rooms', 'furniture', 'openings', 'obstacles', 'electrical']) assert.deepEqual(scene[key], []);
  assert.equal(scene.walls.length, 4);
  assert.equal(scene.metrics.roomCarpetM2, 0);
  assert.ok(scene.metrics.wallFootprintM2 > 0);
  assert.ok(scene.diagnostics.some(item => item.level === 'warning' && /Missing wall thickness/.test(item.message)));
  const blank = createFixture('missing-context').project;
  assert.equal(Model.validateProject(blank), blank);
  assert.deepEqual(buildScenes(blank), []);
  assert.equal(controllerFor(blank).getScene(), null);
  assert.throws(() => Model.buildScene(null, blank), /Legacy context/);
});

test('invalid or deleted hosts retain source records and report actionable model diagnostics', () => {
  const { project } = createFixture('invalid-attachments');
  const before = JSON.stringify(project);
  const scene = buildScenes(project)[0];
  const removedHost = project.electrical[0].wallId;
  assert.equal(scene.walls.find(wall => wall.id === removedHost).removed, true);
  assert.ok(diagnosticsFor(scene, 'ground:deleted-wall', /no current host/).length);
  for (const id of ['ground:deleted-door', 'ground:deleted-window', 'ground:deleted-bed']) {
    assert.ok(diagnosticsFor(scene, id, /no current source/).length, id);
  }
  for (const id of ['ground:on-removed-wall', 'ground:on-missing-wall']) {
    assert.ok(diagnosticsFor(scene, id, /no surviving wall host/).length, id);
  }
  for (const id of ['ground:missing-host-window', 'ground:diagonal-window']) {
    assert.ok(scene.unresolvedOpenings.some(item => item.id === id), id);
    assert.ok(!scene.openings.some(item => item.id === id));
  }
  assert.ok(diagnosticsFor(scene, 'ground:diagonal-window', /non-orthogonal/).some(item => item.level === 'error'));
  assert.ok(scene.diagnostics.some(item => /Furniture has no stable id or parent room/.test(item.message)));
  assert.ok(!scene.furniture.some(item => item.sourceId === 'orphan-chair'));
  assert.ok(project.legacy.context.plan.furniture.some(item => item.id === 'orphan-chair'));
  assert.deepEqual(scene.electrical, project.electrical);
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(Model.parseProject(before), project);
});

test('dense annotations are external source inputs tied to actual rooms, not invented production fields', () => {
  const fixture = createFixture('dense-annotations');
  const scene = buildScenes(fixture.project)[0];
  assert.equal(scene.rooms.length, 24);
  assert.equal(scene.furniture.length, 24);
  assert.equal(scene.electrical.length, 24);
  assert.equal(scene.openings.filter(item => item.kind === 'hinged').length, 20);
  assert.equal(scene.openings.filter(item => item.kind === 'window').length, 6);
  assert.equal(fixture.annotationInputs.length, 96);
  assert.equal(new Set(fixture.annotationInputs.map(item => item.id)).size, 96);
  assert.equal(Object.hasOwn(fixture.project, 'annotationInputs'), false);
  for (const input of fixture.annotationInputs) {
    const room = scene.rooms.find(item => item.id === input.targetId);
    assert.ok(room);
    if (input.kind === 'dimension-input') {
      close(Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y), input.valueM);
      close(input.valueM, input.id.endsWith(':width') ? room.rect.w : room.rect.h);
    } else {
      assert.ok(input.text.length > 30);
      close(input.anchor.x, room.rect.x + room.rect.w / 2);
      close(input.anchor.y, room.rect.y + room.rect.h / 2);
    }
  }
  assert.deepEqual(fixture.annotationInputs[0].anchor, fixture.annotationInputs[1].anchor);
  assert.deepEqual(scene.diagnostics.filter(item => item.level === 'warning'), []);
});

test('non-cardinal project authoring is explicitly unsupported while numeric coordinate math works', () => {
  const fixture = createFixture('non-cardinal-request');
  assert.equal(fixture.support, 'unsupported-authoring');
  assert.equal(fixture.requestedBearingDeg, 32.5);
  const scene = buildScenes(fixture.project)[0];
  assert.equal(scene.headingDeg, 0);
  assert.equal(Object.hasOwn(fixture.project, 'requestedBearingDeg'), false);
  for (const frontEdge of ['NE', fixture.requestedBearingDeg]) {
    const ctx = clone(fixture.project.legacy.context);
    ctx.plate.frontEdge = frontEdge;
    assert.throws(() => Model.buildScene(ctx, fixture.project), /Road\/front direction must be one of N, E, S, W/);
  }
  // This is a coordinate-helper capability check, not a fabricated compiled project scene.
  const frame = { floor: scene.floor, floorElevationM: scene.floorElevationM, headingDeg: fixture.requestedBearingDeg };
  const angle = fixture.requestedBearingDeg * Math.PI / 180;
  const world = Model.localToWorld({ x: 7, y: 1 }, frame);
  close(world.east, 2 * Math.cos(angle) + 3 * Math.sin(angle));
  close(world.north, -2 * Math.sin(angle) + 3 * Math.cos(angle));
  const local = Model.worldVectorToLocal(world, frame);
  close(local.x, 2); close(local.y, -3);
});
