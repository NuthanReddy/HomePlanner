const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../planner-model.js');
const Regions = require('../planner-regions.js');
const Projection = require('../planner-projection.js');
const Drawing = require('../planner-drawing.js');
const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function placed(id, type, module, reserve = false, margin = .05) {
  return { req: { id, type, label: id, ...(reserve ? { reserveFootprint: true } : {}) }, module,
    carpet: { x: module.x + margin, y: module.y + margin, w: module.w - 2 * margin, h: module.h - 2 * margin } };
}
function fixture(kind = 'contained') {
  const project = Model.createProject();
  project.id = 'reservation-project';
  const hosts = kind === 'contained'
    ? [placed('host-a', 'living', { x: .7, y: .7, w: 8.6, h: 6.6 })]
    : [placed('host-a', 'living', { x: .7, y: .7, w: 4.3, h: 6.6 })];
  if (kind === 'multi') hosts.push(placed('host-b', 'bedroom', { x: 5, y: .7, w: 4.3, h: 6.6 }));
  const lift = placed('lift-1', 'lift', { x: kind === 'contained' ? 3 : kind === 'multi' ? 4 : 4.5, y: 3, w: 2, h: 2 }, true, .06);
  const context = {
    plate: { frontEdge: 'N', width: 10, depth: 8, sitePlot: { x: -1.2, y: -2.3, w: 12.4, h: 12.6 } },
    g: { W: 10, D: 8, outerX: .5, outerY: .5, outerW: 9, outerD: 7,
      coreX: .7, coreY: .7, coreW: 8.6, coreD: 6.6 },
    cfg: { walls: { external: .2, internal: .1 } },
    plan: { placed: [...hosts, lift], furniture: [], flexSpaces: [], openings: { doors: [], windows: [] },
      customOpenings: [], wallOpenings: [] }
  };
  return { project, context, lift, hosts, scene: () => Model.buildScene(context, project) };
}
function drawing(data) {
  const project = clone(data.project);
  project.legacy.context = clone(data.context);
  project.floors[0].legacy = clone(project.legacy);
  return Projection.build(project);
}
function wallBox(wall) {
  const horizontal = Math.abs(wall.start.y - wall.end.y) < 1e-8;
  return horizontal
    ? { x: wall.start.x, y: wall.start.y - wall.thicknessM / 2, w: wall.end.x - wall.start.x, h: wall.thicknessM }
    : { x: wall.start.x - wall.thicknessM / 2, y: wall.start.y, w: wall.thicknessM, h: wall.end.y - wall.start.y };
}
const errors = scene => scene.diagnostics.filter(item => item.level === 'error');
const bySource = (scene, id) => scene.rooms.find(room => room.sourceId === id);
const metricValues = scene => [...Object.values(scene.metrics), ...scene.rooms.flatMap(room =>
  ['grossAreaM2', 'usableAreaM2', 'reservedAreaM2'].filter(key => key in room).map(key => room[key]))];

test('opted-in contained services reserve full wall allowance and deduct host floor without double counting', () => {
  const data = fixture(), scene = data.scene(), host = bySource(scene, 'host-a'), lift = bySource(scene, 'lift-1');
  assert.deepEqual(errors(scene), []);
  assert.equal(lift.reservesSpace, true);
  assert.deepEqual(lift.hostRoomIds, [host.id]);
  assert.deepEqual(host.reservationRoomIds, [lift.id]);
  close(lift.reservationFootprint.x, 2.94); close(lift.reservationFootprint.w, 2.12);
  assert.deepEqual(lift.module, data.lift.module);
  assert.deepEqual(host.rect, data.hosts[0].carpet);
  close(host.grossAreaM2, 55.25);
  close(host.reservedAreaM2, 2.12 ** 2);
  close(host.usableAreaM2, 55.25 - 2.12 ** 2);
  close(lift.usableAreaM2, 1.88 ** 2);
  close(scene.metrics.roomCarpetM2, 55.25 - 2.12 ** 2 + 1.88 ** 2);
  close(scene.metrics.habitableCarpetM2 + scene.metrics.serviceCarpetM2, scene.metrics.roomCarpetM2);
  close(scene.metrics.grossHabitableCarpetM2, scene.metrics.habitableCarpetM2 + scene.metrics.reservedHostAreaM2);
  close(scene.metrics.reservedFootprintM2, 2.12 ** 2);
  close(Regions.area(host.usableRegions), host.usableAreaM2);
  assert.ok(host.usableRegions.every(region => Regions.intersection(region, lift.reservationFootprint) === null));
  assert.ok(scene.diagnostics.some(item => /reserved and deducted/.test(item.message)));
});

test('partial reservations deduct only the intersected host area while retaining service carpet independently', () => {
  const data = fixture('partial'), scene = data.scene(), host = bySource(scene, 'host-a'), lift = bySource(scene, 'lift-1');
  assert.deepEqual(errors(scene), []);
  close(host.grossAreaM2, 4.2 * 6.5);
  close(host.reservedAreaM2, .51 * 2.12);
  close(scene.metrics.roomCarpetM2, 4.2 * 6.5 - .51 * 2.12 + 1.88 ** 2);
  assert.ok(scene.metrics.reservedFootprintM2 > scene.metrics.reservedHostAreaM2);
  assert.deepEqual(lift.hostRoomIds, [host.id]);
});

test('one reservation intersects multiple hosts and wall trim uses its full outer extent', () => {
  const data = fixture('multi'), scene = data.scene(), lift = bySource(scene, 'lift-1');
  assert.deepEqual(errors(scene), []);
  assert.deepEqual(lift.hostRoomIds, ['floor-1:host-a', 'floor-1:host-b']);
  for (const id of ['host-a', 'host-b']) close(bySource(scene, id).reservedAreaM2, 1.01 * 2.12);
  close(scene.metrics.reservedHostAreaM2, 2 * 1.01 * 2.12);
  close(scene.metrics.roomCarpetM2, 2 * 4.2 * 6.5 - 2 * 1.01 * 2.12 + 1.88 ** 2);
  const ordinary = scene.walls.filter(wall => !wall.exterior && !wall.id.includes('room:lift-1:'));
  assert.equal(ordinary.length, 2);
  close(ordinary.reduce((sum, wall) => sum + wall.end.y - wall.start.y, 0), 6.6 - 2.12);
  assert.ok(ordinary.every(wall => Regions.intersection(wallBox(wall), lift.reservationFootprint) === null));
  assert.ok(scene.walls.every(wall => wall.structuralRole === 'unknown'));
  const sharedService = scene.walls.filter(wall => wall.id.includes('room:lift-1:') && wall.roomIds.length === 2);
  assert.ok(sharedService.some(wall => wall.roomIds.includes('floor-1:host-a')));
  assert.ok(sharedService.some(wall => wall.roomIds.includes('floor-1:host-b')));
  assert.ok(scene.walls.every(wall => wall.roomIds.length <= 2));
});

test('wall lineage and reservation quantities stay deterministic under source reorder and same-topology movement', () => {
  const data = fixture('multi'), before = data.scene(), source = JSON.stringify(data.context);
  data.context.plan.placed.reverse();
  assert.deepEqual(data.scene(), before);
  data.lift.module.y += .2; data.lift.carpet.y += .2;
  const after = data.scene();
  assert.deepEqual(after.walls.map(wall => wall.id), before.walls.map(wall => wall.id));
  close(after.metrics.roomCarpetM2, before.metrics.roomCarpetM2);
  assert.notEqual(JSON.stringify(data.context), source);
  assert.equal(new Set(after.walls.map(wall => wall.id)).size, after.walls.length);
});

test('a reservation across a three-room T junction keeps separate host areas and honest two-room wall adjacency', () => {
  const data = fixture('multi');
  data.context.plan.placed = [data.hosts[0],
    placed('host-b', 'bedroom', { x: 5, y: .7, w: 4.3, h: 3.3 }),
    placed('host-c', 'kitchen', { x: 5, y: 4, w: 4.3, h: 3.3 }), data.lift];
  const scene = data.scene(), lift = bySource(scene, 'lift-1');
  assert.deepEqual(errors(scene), []);
  assert.deepEqual(lift.hostRoomIds, ['floor-1:host-a', 'floor-1:host-b', 'floor-1:host-c']);
  close(bySource(scene, 'host-a').reservedAreaM2, 1.01 * 2.12);
  for (const sourceId of ['host-b', 'host-c']) close(bySource(scene, sourceId).reservedAreaM2, 1.01 ** 2);
  assert.ok(scene.walls.every(wall => wall.roomIds.length <= 2));
  const ordinary = scene.walls.filter(wall => !wall.exterior && !wall.id.includes('room:lift-1:'));
  assert.equal(ordinary.length, 3);
  assert.ok(ordinary.every(wall => Regions.intersection(wallBox(wall), lift.reservationFootprint) === null));
  close(scene.metrics.roomCarpetM2, 4.2 * 6.5 + 2 * 4.2 * 3.2 - 1.01 * 2.12 - 2 * 1.01 ** 2 + 1.88 ** 2);
});

test('moving a distant reservation cannot rename wall spans it never cut', () => {
  const data = fixture('multi'), stair = placed('stair-1', 'staircase', { x: 1.5, y: 3, w: 1, h: 2 }, true, .06);
  data.context.plan.placed.push(stair);
  const interfaces = scene => scene.walls.filter(wall =>
    wall.roomIds.includes('floor-1:host-a') && wall.roomIds.includes('floor-1:host-b')).map(wall => wall.id);
  const before = interfaces(data.scene());
  stair.module.y += .2; stair.carpet.y += .2;
  assert.deepEqual(interfaces(data.scene()), before);
});

test('service wall adjacency hosts real doors on the correct host side without rehosting ordinary sources', () => {
  const data = fixture('multi');
  data.context.plan.customOpenings.push({
    id: 'service-access', custom: true, roomId: 'lift-1', targetRoomId: 'host-a',
    edge: 'N', widthM: .6, heightM: 2.1, segment: { x1: 4.15, y1: 3, x2: 4.75, y2: 3 }
  }, {
    id: 'old-partition-door', custom: true, roomId: 'host-a', targetRoomId: 'host-b',
    edge: 'E', widthM: .8, heightM: 2.1, segment: { x1: 5, y1: 3.4, x2: 5, y2: 4.2 }
  });
  const before = JSON.stringify(data.context), scene = data.scene();
  const door = scene.openings.find(item => item.sourceId === 'service-access');
  assert.ok(door);
  assert.equal(door.roomId, 'floor-1:lift-1');
  assert.equal(door.targetRoomId, 'floor-1:host-a');
  const wall = scene.walls.find(item => item.id === door.wallId);
  assert.deepEqual(wall.roomIds, ['floor-1:host-a', 'floor-1:lift-1']);
  assert.equal(wall.openings[0], door);
  assert.ok(door.offsetM >= 0 && door.offsetM + door.widthM <= Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) + 1e-8);
  assert.ok(scene.unresolvedOpenings.some(item => item.sourceId === 'old-partition-door' && /host interval/.test(item.reason)));
  assert.equal(scene.openings.some(item => item.sourceId === 'old-partition-door'), false);
  assert.equal(JSON.stringify(data.context), before);
  assert.throws(() => Drawing.createSheets(drawing(data), { floorId: 'floor-1', paper: 'A2' }), /rejected openings/);
});

test('doors cannot straddle the ordinary-wall junction between two service-adjacent hosts', () => {
  const data = fixture('multi');
  data.context.plan.customOpenings.push({ id: 'cross-junction', roomId: 'lift-1', edge: 'N',
    widthM: 1, segment: { x1: 4.5, y1: 3, x2: 5.5, y2: 3 } });
  const scene = data.scene();
  assert.equal(scene.openings.length, 0);
  assert.ok(scene.unresolvedOpenings.some(item => item.sourceId === 'cross-junction'));
});

test('horizontal interfaces are cut and host west/east service doors with the same physical rules', () => {
  const data = fixture('multi');
  data.context.plan.placed = [
    placed('host-a', 'living', { x: .7, y: .7, w: 8.6, h: 3.3 }),
    placed('host-b', 'bedroom', { x: .7, y: 4, w: 8.6, h: 3.3 }), data.lift
  ];
  data.context.plan.customOpenings.push({ id: 'west-service-door', roomId: 'lift-1', targetRoomId: 'host-a', edge: 'W',
    widthM: .6, segment: { x1: 4, y1: 3.15, x2: 4, y2: 3.75 } });
  const scene = data.scene(), lift = bySource(scene, 'lift-1');
  assert.deepEqual(errors(scene), []);
  close(scene.metrics.roomCarpetM2, 2 * 8.5 * 3.2 - 2 * 1.01 * 2.12 + 1.88 ** 2);
  const walls = scene.walls.filter(wall => !wall.exterior && !wall.id.includes('room:lift-1:'));
  assert.equal(walls.length, 2);
  assert.ok(walls.every(wall => Regions.intersection(wallBox(wall), lift.reservationFootprint) === null));
  assert.equal(scene.openings[0].targetRoomId, 'floor-1:host-a');
  assert.deepEqual(scene.unresolvedOpenings, []);
});

test('separate and touching reservations share no host floor or falsely adjacent service face', () => {
  for (const x of [5.12, 6]) {
    const data = fixture();
    data.context.plan.placed.push(placed('stair-1', 'staircase', { x, y: 3, w: 1.5, h: 2 }, true, .06));
    const scene = data.scene();
    assert.deepEqual(errors(scene), []);
    close(scene.metrics.reservedFootprintM2, 2.12 ** 2 + 1.62 * 2.12);
    close(scene.metrics.roomCarpetM2, 55.25 - 2.12 ** 2 - 1.62 * 2.12 + 1.88 ** 2 + 1.38 * 1.88);
    if (x === 5.12) {
      const contact = scene.walls.filter(wall => wall.id.startsWith('floor-1:wall:room:lift-1:E[') ||
        wall.id.startsWith('floor-1:wall:room:stair-1:W['));
      assert.equal(contact.length, 2);
      assert.ok(contact.every(wall => !wall.roomIds.includes('floor-1:host-a')));
    }
  }
});

test('saved wall hosts and missing room targets remain unresolved after a reservation changes topology', () => {
  const data = fixture('multi');
  data.context.plan.placed.pop();
  const oldWall = data.scene().walls.find(wall => !wall.exterior && wall.roomIds.length === 2);
  data.context.plan.placed.push(data.lift);
  data.project.wallEdits[oldWall.id] = { full: true };
  data.context.plan.customOpenings.push({ id: 'saved-host', wallId: oldWall.id, offsetM: 1, widthM: .7 },
    { id: 'missing-room', roomId: 'lift-1', targetRoomId: 'deleted-room', edge: 'N',
      widthM: .6, segment: { x1: 4.15, y1: 3, x2: 4.75, y2: 3 } });
  const original = JSON.stringify({ project: data.project, context: data.context }), scene = data.scene();
  assert.equal(scene.openings.length, 0);
  assert.ok(scene.unresolvedOpenings.some(item => item.sourceId === 'saved-host'));
  assert.ok(scene.unresolvedOpenings.some(item => item.sourceId === 'missing-room' && /not rebound/.test(item.reason)));
  assert.ok(scene.diagnostics.some(item => item.ids.includes(oldWall.id) && /no current host/.test(item.message)));
  assert.equal(JSON.stringify({ project: data.project, context: data.context }), original);
});

test('partial wall-band cuts retain physical remnants but never silently move independently authored apertures', () => {
  const data = fixture('partial');
  data.lift.module.x = 5.03; data.lift.carpet.x = 5.09;
  data.context.plan.customOpenings.push({ id: 'old-wall-opening', roomId: 'host-a', edge: 'E',
    widthM: .5, segment: { x1: 5, y1: 3.5, x2: 5, y2: 4 } });
  const scene = data.scene(), lift = bySource(scene, 'lift-1');
  const remnant = scene.walls.find(wall => wall.id.includes('room:host-a:E:band:'));
  assert.ok(remnant);
  close(remnant.thicknessM, .02);
  close(remnant.start.x, 4.96);
  assert.equal(Regions.intersection(wallBox(remnant), lift.reservationFootprint), null);
  assert.ok(scene.unresolvedOpenings.some(item => item.sourceId === 'old-wall-opening'));
  assert.equal(scene.openings.length, 0);
});

test('partial shared-wall remnants retain only the usable room touching their surviving face', () => {
  for (const [axis, position, expected] of [
    ['x', 5.03, 'host-a'], ['x', 2.97, 'host-b'], ['y', 4.03, 'host-a'], ['y', 1.97, 'host-b']
  ]) {
    const data = fixture('multi');
    if (axis === 'y') data.context.plan.placed = [
      placed('host-a', 'living', { x: .7, y: .7, w: 8.6, h: 3.3 }),
      placed('host-b', 'bedroom', { x: .7, y: 4, w: 8.6, h: 3.3 }), data.lift
    ];
    data.lift.module[axis] = position; data.lift.carpet[axis] = position + .06;
    const scene = data.scene(), remnants = scene.walls.filter(wall => wall.id.includes(':band:'));
    assert.deepEqual(errors(scene), []);
    assert.equal(remnants.length, 1);
    assert.deepEqual(remnants[0].roomIds, [`floor-1:${expected}`]);
    close(remnants[0].thicknessM, .02);
    assert.equal(remnants[0].exterior, false);
    for (const wall of scene.walls) for (const room of scene.rooms)
      for (const region of room.usableRegions ?? [room.rect])
        assert.equal(Regions.intersection(wallBox(wall), region), null, `${wall.id} must not intrude into ${room.id}`);
  }
});

test('explicit wall IDs cannot reattach an opening to a former host behind a reserved wall band', () => {
  const data = fixture('multi');
  data.lift.module.x = 5.03; data.lift.carpet.x = 5.09;
  const remnant = data.scene().walls.find(wall => wall.id.includes(':band:'));
  data.context.plan.customOpenings.push({ id: 'former-host-door', roomId: 'host-b',
    wallId: remnant.id, offsetM: .3, widthM: .5 });
  const before = JSON.stringify(data.context), scene = data.scene();
  assert.equal(scene.openings.length, 0);
  assert.ok(scene.unresolvedOpenings.some(opening => opening.sourceId === 'former-host-door'));
  assert.equal(JSON.stringify(data.context), before);
});

test('horizontal partial-band reservations preserve full-thickness wall hosts and apertures outside the cut', () => {
  const data = fixture('multi');
  data.context.plan.placed = [
    placed('host-a', 'living', { x: .7, y: .7, w: 8.6, h: 3.3 }),
    placed('host-b', 'bedroom', { x: .7, y: 4, w: 8.6, h: 3.3 }), data.lift
  ];
  data.lift.module.y = 4.03; data.lift.carpet.y = 4.09;
  const originalContext = clone(data.context);
  originalContext.plan.placed.pop();
  const originalFaceArea = Model.buildScene(originalContext, data.project).metrics.solidWallFaceAreaM2;
  data.context.plan.customOpenings.push({ id: 'unchanged-access', roomId: 'host-a', targetRoomId: 'host-b', edge: 'S',
    widthM: .7, segment: { x1: 1.5, y1: 4, x2: 2.2, y2: 4 } });
  const before = JSON.stringify(data.context), scene = data.scene();
  assert.deepEqual(errors(scene), []);
  assert.deepEqual(scene.unresolvedOpenings, []);
  const opening = scene.openings.find(item => item.sourceId === 'unchanged-access');
  assert.ok(opening);
  const wall = scene.walls.find(item => item.id === opening.wallId);
  assert.deepEqual(wall.roomIds, ['floor-1:host-a', 'floor-1:host-b']);
  close(wall.thicknessM, .1);
  close(wall.start.y, 4);
  close(opening.segment.x1, 1.5); close(opening.segment.x2, 2.2);
  close(scene.metrics.solidWallFaceAreaM2, originalFaceArea + 8 * scene.wallHeightM - .7 * 2.1);
  assert.equal(JSON.stringify(data.context), before);
});

test('a reservation touching a shared wall splits adjacency even without cutting its physical material', () => {
  const data = fixture('multi');
  data.lift.module.x = 5.11; data.lift.carpet.x = 5.17;
  const scene = data.scene();
  const interfaces = scene.walls.filter(wall => Math.abs(wall.start.x - 5) < 1e-8 && Math.abs(wall.end.x - 5) < 1e-8);
  assert.deepEqual(errors(scene), []);
  assert.equal(interfaces.length, 3);
  const middle = interfaces.find(wall => wall.start.y < 4 && wall.end.y > 4);
  assert.deepEqual(middle.roomIds, ['floor-1:host-a']);
  assert.equal(middle.exterior, false);
  close(middle.thicknessM, .1);
  assert.ok(interfaces.filter(wall => wall !== middle).every(wall => wall.roomIds.length === 2));
  close(interfaces.reduce((sum, wall) => sum + wall.end.y - wall.start.y, 0), 6.6);
});

test('reserved floor against the shell removes only that host adjacency and retains the known exterior boundary', () => {
  const data = fixture();
  data.lift.module.x = .76; data.lift.carpet.x = .82;
  const scene = data.scene();
  const shell = scene.walls.filter(wall => wall.exterior && Math.abs(wall.start.x - .6) < 1e-8 && Math.abs(wall.end.x - .6) < 1e-8);
  assert.deepEqual(errors(scene), []);
  const middle = shell.find(wall => wall.start.y < 4 && wall.end.y > 4);
  assert.ok(middle);
  assert.deepEqual(middle.roomIds, []);
  assert.ok(shell.filter(wall => wall !== middle).some(wall => wall.roomIds.includes('floor-1:host-a')));
  assert.ok(scene.walls.filter(wall => wall.id.startsWith('floor-1:wall:room:lift-1:')).every(wall => !wall.exterior));
  data.context.plan.customOpenings.push({ id: 'former-shell-window', type: 'window', roomId: 'host-a', edge: 'W',
    widthM: .5, segment: { x1: .7, y1: 3.5, x2: .7, y2: 4 } });
  const before = JSON.stringify(data.context), rebuilt = data.scene();
  assert.ok(rebuilt.unresolvedOpenings.some(opening => opening.sourceId === 'former-shell-window'));
  assert.equal(rebuilt.openings.length, 0);
  assert.equal(JSON.stringify(data.context), before);
});

test('overlapping service wall allowances remain invalid even when their clear carpets do not overlap', () => {
  const data = fixture();
  data.lift.module.w = 1.5; data.lift.carpet.w = 1.38;
  const stair = placed('stair-1', 'staircase', { x: 4.58, y: 3, w: 1.5, h: 2 }, true, .06);
  data.context.plan.placed.push(stair);
  assert.equal(Regions.intersection(data.lift.carpet, stair.carpet), null);
  const scene = data.scene();
  assert.ok(errors(scene).some(item => /reservation footprints overlap/.test(item.message)));
  assert.ok(metricValues(scene).every(value => Number.isFinite(value) && value >= 0));
  close(scene.metrics.reservedFootprintM2, 2 * 1.62 * 2.12 - .04 * 2.12);
  assert.throws(() => Drawing.createSheets(drawing(data), { floorId: 'floor-1', paper: 'A2' }), /geometry errors/);
});

test('ordinary overlaps are still errors in a floor containing a reservation', () => {
  const data = fixture();
  data.context.plan.placed.push(placed('ordinary-overlap', 'bedroom', { x: 1, y: 1, w: 1, h: 1 }));
  const scene = data.scene();
  assert.ok(errors(scene).some(item => /Clear room carpets overlap/.test(item.message)));
  assert.ok(Number.isFinite(scene.metrics.roomCarpetM2));
});

test('furniture that hits reserved walls is retained and explicitly diagnosed without restoring host floor', () => {
  const data = fixture(), originalArea = data.scene().metrics.roomCarpetM2;
  data.context.plan.furniture.push({ id: 'retained-bed', roomId: 'host-a', type: 'bed',
    rect: { x: 2.95, y: 3.5, w: .08, h: 1 }, headLocal: 'S', pinned: true });
  data.project.furnitureEdits['floor-1:retained-bed'] = { headLocal: 'E', pinned: true };
  const before = JSON.stringify({ project: data.project, context: data.context }), scene = data.scene();
  assert.equal(scene.furniture.length, 1);
  assert.equal(scene.furniture[0].headLocal, 'E');
  assert.deepEqual(scene.furniture[0].reservationRoomIds, ['floor-1:lift-1']);
  assert.ok(errors(scene).some(item => /Furniture overlaps a reserved/.test(item.message)));
  close(scene.metrics.roomCarpetM2, originalArea);
  assert.equal(JSON.stringify({ project: data.project, context: data.context }), before);
});

test('frozen inputs, region outputs and imports remain finite, deterministic and nondestructive', () => {
  const data = fixture('multi');
  const before = JSON.stringify({ context: data.context, project: data.project });
  freeze(data.context); freeze(data.project);
  const scene = data.scene();
  assert.deepEqual(data.scene(), scene);
  assert.ok(metricValues(scene).every(value => Number.isFinite(value) && value >= 0));
  for (const room of scene.rooms) {
    assert.ok(Object.isFrozen(room.usableRegions));
    assert.ok(room.usableRegions.every(Object.isFrozen));
    if (room.reservationFootprint) assert.ok(Object.isFrozen(room.reservationFootprint));
  }
  assert.equal(JSON.stringify({ context: data.context, project: data.project }), before);
  const project = clone(data.project); project.legacy.context = clone(data.context);
  assert.deepEqual(Model.parseProject(JSON.stringify(project)), project);
});

test('reservation geometry rejects missing modules, invalid dimensions, outside-building and unresolvable coordinates', () => {
  for (const mutate of [
    data => { delete data.lift.module; },
    data => { data.lift.carpet.w = NaN; },
    data => { data.lift.module.h = Infinity; },
    data => { data.lift.module.w = 0; },
    data => { data.lift.module.x = 20; data.lift.carpet.x = 20.06; },
    data => { data.lift.module.x = 1e20; data.lift.carpet.x = 1e20; },
    data => { data.lift.module.x = data.lift.carpet.x + .01; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => data.scene(), /supplied|finite|greater|outside|resolution/);
  }
  const shellClash = fixture();
  shellClash.lift.module.x = .7; shellClash.lift.carpet.x = .76;
  assert.ok(errors(shellClash.scene()).some(item => /exterior building wall/.test(item.message)));
  const subresolutionJunction = fixture('partial');
  subresolutionJunction.lift.module.x = 5.10999995;
  subresolutionJunction.lift.carpet.x = 5.16999995;
  assert.throws(() => subresolutionJunction.scene(), /topology numerical resolution/);
});

test('old unflagged services and nonservice flags retain their prior geometry and overlap semantics', () => {
  const data = fixture();
  delete data.lift.req.reserveFootprint;
  const legacy = data.scene();
  assert.ok(errors(legacy).some(item => /Clear room carpets overlap/.test(item.message)));
  assert.ok(legacy.rooms.every(room => !Object.hasOwn(room, 'reservesSpace') && !Object.hasOwn(room, 'usableRegions')));
  assert.deepEqual(Object.keys(legacy.metrics).sort(), ['wallFootprintM2', 'solidWallFaceAreaM2', 'roomCarpetM2'].sort());
  data.lift.req.reserveFootprint = false;
  data.hosts[0].req.reserveFootprint = true;
  assert.deepEqual(data.scene(), legacy);
  delete data.lift.module;
  assert.doesNotThrow(() => data.scene());
});

test('browser scenes without reservations do not require Regions; opt-in scenes fail explicitly until it is loaded', () => {
  const data = fixture(), sandbox = { Intl, contextJSON: JSON.stringify(data.context), projectJSON: JSON.stringify(data.project) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-features.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-model.js'), 'utf8'), sandbox);
  const build = 'HomePlannerModel.buildScene(JSON.parse(contextJSON), JSON.parse(projectJSON))';
  assert.throws(() => vm.runInNewContext(build, sandbox), /HomePlannerRegions/);
  delete data.lift.req.reserveFootprint; sandbox.contextJSON = JSON.stringify(data.context);
  assert.equal(vm.runInNewContext(`JSON.stringify(${build})`, sandbox), JSON.stringify(data.scene()));
  data.lift.req.reserveFootprint = true; sandbox.contextJSON = JSON.stringify(data.context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-regions.js'), 'utf8'), sandbox);
  assert.equal(vm.runInNewContext(`JSON.stringify(${build})`, sandbox), JSON.stringify(data.scene()));
});

test('site projection translates every usable region and full reservation exactly once without changing area', () => {
  const data = fixture('multi'), raw = data.scene(), before = JSON.stringify(raw), projected = Projection.projectScene(raw);
  const dx = -raw.plot.x, dy = -raw.plot.y;
  assert.ok(Object.isFrozen(projected));
  for (const source of raw.rooms) {
    const room = bySource(projected, source.sourceId);
    assert.deepEqual(room.usableRegions, source.usableRegions.map(region => ({ ...region, x: region.x + dx, y: region.y + dy })));
    if (source.reservationFootprint) assert.deepEqual(room.reservationFootprint,
      { ...source.reservationFootprint, x: source.reservationFootprint.x + dx, y: source.reservationFootprint.y + dy });
    assert.equal(room.usableAreaM2, source.usableAreaM2);
  }
  assert.deepEqual(projected.metrics, raw.metrics);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(drawing(data).scenes[0], projected);
});

test('projection rejects malformed reserved geometry before JSON copying can erase the invalid numbers', () => {
  for (const mutate of [
    source => { bySource(source, 'host-a').usableRegions[0].x = NaN; },
    source => { bySource(source, 'lift-1').reservationFootprint.w = Infinity; },
    source => { bySource(source, 'lift-1').reservationFootprint.h = -1; }
  ]) {
    const source = clone(fixture().scene()); mutate(source);
    assert.throws(() => Projection.projectScene(source), /finite|positive/);
  }
});

for (const kind of ['contained', 'partial', 'multi']) {
  test(`${kind} reservation sheets use available regions and report net/deducted area rather than bounding CLEAR sizes`, () => {
    const data = fixture(kind), source = drawing(data), before = JSON.stringify(source);
    const sheets = Drawing.createSheets(source, { floorId: 'floor-1', paper: 'A2', scaleDenominator: 50 });
    assert.ok(sheets.length > 0);
    sheets.forEach(sheet => assert.equal(Drawing.validateSheet(sheet), sheet));
    const texts = sheets.flatMap(sheet => sheet.primitives.filter(p => p.type === 'text').map(p => p.text));
    assert.ok(texts.some(text => text.startsWith('NET ')));
    assert.ok(texts.some(text => text.startsWith('RESERVED ')));
    assert.match(sheets[0].metadata.assumptions.join('\n'), /full wall allowance/);
    assert.match(sheets[0].metadata.assumptions.join('\n'), /not building-wide BAY/);
    const site = sheets[0].primitives.find(p => p.type === 'path' && p.strokeWidthMm === .28);
    const origin = { x: site.commands[0][1], y: site.commands[0][2] }, factor = 20;
    for (const room of source.scenes[0].rooms.filter(room => room.reservedAreaM2 > 0)) {
      assert.ok(!texts.includes(`CLEAR ${room.rect.w.toFixed(2)} m x ${room.rect.h.toFixed(2)} m`));
      const label = sheets[0].primitives.find(p => p.type === 'text' && p.text === room.label);
      if (label) {
        const x = (label.xMm - origin.x) / factor, y = (label.yMm - origin.y) / factor;
        assert.ok(room.usableRegions.some(r => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h));
      }
    }
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(Drawing.createSheets(source, { floorId: 'floor-1', paper: 'A2', scaleDenominator: 50 }), sheets);
  });
}

test('no-usable-floor and unreadable regions produce explicit drawing overflow, never a fake bounding label', () => {
  const data = fixture();
  data.context.plan.placed[0] = placed('host-a', 'living', { x: 3.2, y: 3.2, w: 1, h: 1 });
  const scene = data.scene(), host = bySource(scene, 'host-a');
  assert.deepEqual(host.usableRegions, []);
  assert.equal(host.usableAreaM2, 0);
  close(host.reservedAreaM2, host.grossAreaM2);
  close(scene.metrics.roomCarpetM2, bySource(scene, 'lift-1').usableAreaM2);
  assert.throws(() => Drawing.createSheets(drawing(data), { floorId: 'floor-1', paper: 'A2' }), /no usable region/);
  assert.throws(() => Drawing.createSheets(drawing(fixture()), { floorId: 'floor-1', paper: 'A4', scaleDenominator: 50 }),
    /Fixed scale/);
  const malformed = clone(drawing(fixture()));
  delete bySource(malformed.scenes[0], 'host-a').usableAreaM2;
  assert.throws(() => Drawing.createSheets(malformed, { floorId: 'floor-1', paper: 'A2' }), /explicit finite/);
});
