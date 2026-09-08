const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../planner-model.js');

const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} ≈ ${expected}`);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function placed(id, type, module, seq = 0) {
  return {
    req: { id, type, label: id, seq },
    module,
    carpet: { x: module.x + .05, y: module.y + .05, w: module.w - .1, h: module.h - .1 }
  };
}

function fixture(front = 'N', withOpenings = true) {
  const project = Model.createProject();
  const left = placed('living-1', 'living', { x: .7, y: .7, w: 4.3, h: 6.6 });
  const right = placed('kitchen-1', 'kitchen', { x: 5, y: .7, w: 4.3, h: 6.6 }, 1);
  const context = {
    plate: { frontEdge: front, width: 10, depth: 8, floorElevation: 90 },
    g: {
      W: 10, D: 8, outerX: .5, outerY: .5, outerW: 9, outerD: 7,
      coreX: .7, coreY: .7, coreW: 8.6, coreD: 6.6,
      frontEdge: front, corridors: [], balconies: []
    },
    cfg: { walls: { external: .2, internal: .1 }, ceilingHeight: 2.7432, window: { operability: .5 } },
    plan: {
      placed: [left, right], furniture: [], flexSpaces: [],
      openings: {
        doors: withOpenings ? [{
          id: 'door-kitchen-1-W', roomId: 'kitchen-1', targetRoomId: 'living-1', edge: 'W',
          width: 1, kind: 'access', segment: { x1: 5, y1: 3, x2: 5, y2: 4 }
        }] : [],
        windows: withOpenings ? [{
          id: 'window-living-1-N', roomId: 'living-1', edge: 'N', width: 1, height: 1.2, operability: .5,
          segment: { x1: 2, y1: .7, x2: 3, y2: .7 }
        }] : []
      },
      wallOpenings: [], customOpenings: []
    }
  };
  return { project, context, scene: () => Model.buildScene(context, project) };
}

const shared = scene => scene.walls.filter(wall => wall.roomIds.length === 2 && !wall.exterior);
const physicalLength = scene => scene.walls.reduce((sum, wall) => sum + Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y), 0);
const shellArea = 9 * 7 - 8.6 * 6.6;

test('browser IIFE exports the same pure public API without a DOM', () => {
  const sandbox = { Intl };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'planner-model.js'), 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerModel).sort(), Object.keys(Model).sort());
  const serialized = vm.runInNewContext('JSON.stringify(HomePlannerModel.createProject())', sandbox);
  assert.equal(Model.parseProject(serialized).schemaVersion, 1);
});

test('complete new projects are independent, versioned and JSON-round-trippable', () => {
  const a = Model.createProject(), b = Model.createProject();
  assert.notEqual(a.id, b.id);
  assert.equal(Model.validateProject(a), a);
  assert.deepEqual(Model.parseProject(JSON.stringify(a)), a);
  assert.equal(a.site.latitude, 17.385);
  assert.equal(a.site.longitude, 78.4867);
  assert.equal(a.site.timeZone, 'Asia/Kolkata');
  a.legacy.controls.front = { value: 'E' };
  assert.deepEqual(a.floors[0].legacy.controls, {});
  assert.deepEqual(b.legacy.controls, {});
});

test('project validation rejects malformed JSON, future schemas and nonfinite numbers anywhere', () => {
  assert.throws(() => Model.parseProject('{bad'), /JSON/);
  assert.throws(() => Model.parseProject(''), /nonempty/);
  assert.throws(() => Model.parseProject('null'), /object/);
  for (const value of [undefined, 0, 2, '1']) {
    const project = Model.createProject();
    if (value === undefined) delete project.schemaVersion;
    else project.schemaVersion = value;
    assert.throws(() => Model.validateProject(project), /schema/);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    const project = Model.createProject();
    project.environment.deep = { readings: [value] };
    assert.throws(() => Model.validateProject(project), /finite/);
  }
  const source = JSON.stringify(Model.createProject()).replace('"latitude":17.385', '"latitude":1e999');
  assert.throws(() => Model.parseProject(source), /finite/);
});

test('import rejects prototype keys recursively without polluting global prototypes', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const project = Model.createProject();
    const source = JSON.stringify(project).replace('"environment":{}', `"environment":{"nested":{"${key}":{"polluted":true}}}`);
    assert.throws(() => Model.parseProject(source), /prototype key/);
  }
  assert.equal({}.polluted, undefined);
  const project = Model.createProject();
  project.environment = Object.create({ inherited: true });
  assert.throws(() => Model.validateProject(project), /plain JSON/);
});

test('validation does not execute accessors, serialize functions, accept cycles or mutate data', () => {
  let read = false;
  const accessor = Model.createProject();
  Object.defineProperty(accessor.environment, 'secret', { enumerable: true, get() { read = true; return 1; } });
  assert.throws(() => Model.validateProject(accessor), /accessor/);
  assert.equal(read, false);
  const cyclic = Model.createProject();
  cyclic.environment.loop = cyclic;
  assert.throws(() => Model.validateProject(cyclic), /circular/);
  const extended = [1, , 3];
  extended.extra = 2;
  for (const value of [undefined, () => 1, new Map(), new Date(), [1, , 3], extended]) {
    const project = Model.createProject();
    project.environment.value = value;
    assert.throws(() => Model.validateProject(project));
  }
  const valid = freeze(Model.createProject());
  assert.equal(Model.validateProject(valid), valid);
});

test('core schema validates coordinates, fractions, enums, heights and active floor identity', () => {
  const invalidMutations = [
    p => { p.site.latitude = 91; }, p => { p.site.longitude = -181; },
    p => { p.site.timeZone = 'Not/A_Zone'; }, p => { p.revision = -1; },
    p => { p.building.wallHeightM = 0; }, p => { p.building.roofThicknessM = -1; },
    p => { p.floors[0].heightM = 0; }, p => { p.activeFloorId = 'missing'; },
    p => { p.floors[0].id = p.activeFloorId = 'ambiguous:floor'; },
    p => { p.floors.push(clone(p.floors[0])); }, p => { p.floors = []; },
    p => { p.legacy.manualLayouts = ['invalid']; },
    p => { p.wallEdits.x = { full: false, offsetM: -1, widthM: 1 }; },
    p => { p.wallEdits.x = { full: false, offsetM: 0, widthM: 0 }; },
    p => { p.doorEdits.x = { hinge: 'north' }; },
    p => { p.doorEdits.x = { swing: 'in' }; },
    p => { p.windowEdits.x = { openFraction: 1.1 }; },
    p => { p.windowEdits.x = { sillM: -1 }; },
    p => { p.furnitureEdits.x = { headLocal: 'NE' }; },
    p => { p.furnitureEdits.x = { pinned: 'true' }; },
    p => { p.electrical = [null]; },
    p => { p.electrical = [{ id: 'same' }, { id: 'same' }]; }
  ];
  for (const mutate of invalidMutations) {
    const project = Model.createProject();
    mutate(project);
    assert.throws(() => Model.validateProject(project), mutate.toString());
  }
});

test('opaque environment/electrical records and supplemental inactive-floor edits survive save/load', () => {
  const { project, context } = fixture();
  project.legacy = { controls: { face: { value: 'E' } }, manualLayouts: [['config-1', { rooms: {}, furniture: {} }]], context: clone(context) };
  const upper = {
    id: 'upper', name: 'Upper floor', heightM: 3.4, wallHeightM: 2.8,
    legacy: clone(project.legacy),
    wallEdits: { 'upper:wall:retained': { full: false, offsetM: .2, widthM: 1 } },
    doorEdits: { 'upper:door': { hinge: 'end', swing: 'right', openFraction: .5 } },
    windowEdits: { 'upper:window': { sillM: 1, heightM: 1.3, widthM: 1.2 } },
    furnitureEdits: { 'upper:bed': { headLocal: 'S', pinned: true } },
    electrical: [{ id: 'upper:point', mounting: { wallId: 'missing', heightM: 1.2 }, status: 'review' }],
    obstacles: [{ id: 'tree', label: 'Tree', type: 'tree', x: -5, y: 3, w: 2, h: 2, heightM: 8, baseM: 0, transmittance: .3 }]
  };
  project.floors.push(upper);
  project.environment = { scenario: { acknowledged: true }, weather: { records: [{ temperatureC: null, missing: ['temperatureC'] }] } };
  const original = JSON.stringify(project);
  assert.deepEqual(Model.parseProject(original), project);
  assert.equal(JSON.stringify(project), original);
});

test('obstacles validate dimensions and duplicate IDs while retaining geographic context uncertainty', () => {
  const project = Model.createProject();
  const obstacle = { id: 'neighbor', label: 'Assumed neighbor', type: 'building', x: -2, y: 1, w: 3, h: 4, heightM: 6, baseM: 0, transmittance: 0 };
  project.obstacles = [obstacle];
  assert.equal(Model.validateProject(project), project);
  project.obstacles.push(clone(obstacle));
  assert.throws(() => Model.validateProject(project), /duplicate/);
  project.obstacles.pop();
  obstacle.transmittance = 1.01;
  assert.throws(() => Model.validateProject(project), /transmittance/);
});

test('local-to-ENU mapping and inverse vectors respect all four road fronts exactly once', () => {
  const expected = { N: { east: 2, north: 3 }, E: { east: 3, north: -2 }, S: { east: -2, north: -3 }, W: { east: -3, north: 2 } };
  for (const front of ['N', 'E', 'S', 'W']) {
    const { scene: build } = fixture(front);
    const scene = build(), world = Model.localToWorld({ x: 7, y: 1, z: 8 }, scene);
    close(world.east, expected[front].east);
    close(world.north, expected[front].north);
    assert.equal(world.up, 8);
    const local = Model.worldVectorToLocal({ east: world.east, north: world.north, up: 4 }, scene);
    close(local.x, 2); close(local.y, -3); assert.equal(local.z, 4);
    const frontVector = Model.worldVectorToLocal({ east: Math.sin(scene.headingDeg * Math.PI / 180), north: Math.cos(scene.headingDeg * Math.PI / 180), up: 0 }, scene);
    close(frontVector.x, 0); close(frontVector.y, -1);
  }
});

test('compiling frozen legacy inputs is deterministic, pure and independent of front heading', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  freeze(data.context); freeze(data.project);
  const scene = Model.buildScene(data.context, data.project);
  assert.deepEqual(Model.buildScene(data.context, data.project), scene);
  assert.equal(JSON.stringify(data), before);
  for (const front of ['E', 'S', 'W']) {
    const other = fixture(front).scene();
    assert.deepEqual(other.rooms, scene.rooms);
    assert.deepEqual(other.walls, scene.walls);
    assert.deepEqual(other.openings, scene.openings);
  }
});

test('module interfaces produce one shared wall while preserving carpet and complete shell quantities', () => {
  const { context, scene: build } = fixture('N', false);
  const scene = build();
  assert.equal(shared(scene).length, 1);
  const wall = shared(scene)[0];
  assert.equal(wall.exterior, false);
  assert.equal(wall.structuralRole, 'unknown');
  close(wall.thicknessM, .1);
  close(wall.start.x, 5); close(wall.start.y, .7); close(wall.end.y, 7.3);
  assert.ok(scene.walls.filter(item => item.exterior).every(item => item.thicknessM === .2));
  assert.deepEqual(scene.rooms.find(room => room.sourceId === 'living-1').rect, context.plan.placed[0].carpet);
  close(scene.metrics.wallFootprintM2, shellArea + .66);
  close(scene.metrics.solidWallFaceAreaM2, physicalLength(scene) * scene.wallHeightM);
  close(scene.metrics.roomCarpetM2, 2 * 4.2 * 6.5);
});

test('empty floor programmes retain exterior enclosure instead of inventing or losing rooms', () => {
  const data = fixture('N', false);
  data.context.plan.placed = [];
  const scene = data.scene();
  assert.deepEqual(scene.rooms, []);
  assert.equal(scene.walls.length, 4);
  assert.ok(scene.walls.every(wall => wall.exterior && !wall.removed && wall.roomIds.length === 0));
  close(scene.metrics.wallFootprintM2, shellArea);
  close(scene.metrics.roomCarpetM2, 0);
});

test('invalid envelopes and nonfinite legacy base geometry fail explicitly', () => {
  const data = fixture();
  data.context.g.outerW = 20;
  assert.throws(() => data.scene(), /outside.*floor plate/);
  data.context.g.outerW = NaN;
  assert.throws(() => data.scene(), /finite/);
  data.context.g.outerW = 9;
  data.context.plan.placed[0].carpet.w = Infinity;
  assert.throws(() => data.scene(), /finite/);
});

test('partial overlaps and T junctions split each interface with correct room adjacency', () => {
  const data = fixture('N', false);
  data.context.plan.placed.splice(1, 1,
    placed('bed-1', 'bedroom', { x: 5, y: .7, w: 4.3, h: 3.3 }, 1),
    placed('bed-2', 'bedroom', { x: 5, y: 4, w: 4.3, h: 3.3 }, 2));
  const scene = data.scene();
  assert.equal(shared(scene).length, 3);
  assert.equal(new Set(scene.walls.map(wall => wall.id)).size, scene.walls.length);
  const vertical = shared(scene).filter(wall => closeEnough(wall.start.x, wall.end.x));
  assert.equal(vertical.length, 2);
  close(vertical.reduce((sum, wall) => sum + wall.end.y - wall.start.y, 0), 6.6);
  assert.ok(vertical.every(wall => wall.roomIds.includes('floor-1:living-1')));
  close(scene.metrics.wallFootprintM2, shellArea + .66 + .43 - .005);
});

function closeEnough(a, b) { return Math.abs(a - b) <= 1e-8; }

test('overlapping opposing wall bands consolidate between unchanged carpet faces, including unequal allowances', () => {
  for (const gap of [0, .04, -.02]) {
    const data = fixture('N', false);
    const right = data.context.plan.placed[1];
    right.module.x += gap;
    right.module.w -= gap;
    right.carpet.x += gap;
    right.carpet.w -= gap;
    if (gap === 0) { right.carpet.x += .02; right.carpet.w -= .02; }
    const scene = data.scene(), interfaces = shared(scene);
    assert.equal(interfaces.length, 1);
    const wall = interfaces[0];
    const lowFace = data.context.plan.placed[0].carpet.x + data.context.plan.placed[0].carpet.w;
    const highFace = right.carpet.x;
    close(wall.start.x - wall.thicknessM / 2, lowFace);
    close(wall.start.x + wall.thicknessM / 2, highFace);
    close(wall.thicknessM, highFace - lowFace);
    assert.deepEqual(scene.rooms.find(room => room.sourceId === 'kitchen-1').rect, right.carpet);
    assert.equal(scene.walls.filter(wall => !wall.exterior).length, 1);
    assert.ok(scene.diagnostics.some(item => /not extruded twice/.test(item.message)));
  }
});

test('separate walls with a true air gap are not welded merely because an old opening tolerance allowed access', () => {
  const data = fixture('N', false);
  const right = data.context.plan.placed[1];
  right.module.x += .2; right.module.w -= .2;
  right.carpet.x += .2; right.carpet.w -= .2;
  const scene = data.scene();
  assert.equal(shared(scene).length, 0);
  assert.equal(scene.walls.filter(wall => !wall.exterior).length, 2);
});

test('wall IDs use interface/end lineage, not coordinates, array order or floor elevation', () => {
  const data = fixture('N', false);
  data.context.plan.placed[1] = placed('kitchen-1', 'kitchen', { x: 5, y: 2, w: 4.3, h: 2 });
  const before = data.scene();
  const aOnly = before.walls.filter(wall => !wall.exterior && wall.roomIds.length === 1 && wall.roomIds[0] === 'floor-1:living-1');
  assert.equal(aOnly.length, 2);
  assert.notEqual(aOnly[0].id, aOnly[1].id);
  data.context.plan.placed[1] = placed('kitchen-1', 'kitchen', { x: 5, y: 2.2, w: 4.3, h: 2.1 });
  data.context.plan.placed.reverse();
  data.project.building.floorElevationM = 2;
  const after = data.scene();
  assert.deepEqual(before.walls.map(wall => wall.id), after.walls.map(wall => wall.id));
});

test('identities adapt legacy sequence fallbacks but never fall back to positions', () => {
  const data = fixture('N', false);
  delete data.context.plan.placed[0].req.id;
  data.context.plan.furniture = [{ seq: 4, roomId: 'room-living-seq-0', type: 'bed', x: 1, y: 1, w: 1, h: 2, headLocal: 'S' }];
  const scene = data.scene();
  assert.ok(scene.rooms.some(room => room.sourceId === 'room-living-seq-0' && room.id === 'floor-1:room-living-seq-0'));
  assert.equal(scene.furniture[0].sourceId, 'furniture-bed-room-living-seq-0-seq-4');
  delete data.context.plan.placed[0].req.seq;
  const unresolved = data.scene();
  assert.equal(unresolved.rooms.length, 1);
  assert.ok(unresolved.diagnostics.some(item => /no stable id/.test(item.message)));
});

test('door/window hosts have bounded horizontal and vertical intervals and count holes once', () => {
  const scene = fixture().scene();
  assert.equal(scene.openings.length, 2);
  for (const opening of scene.openings) {
    const wall = scene.walls.find(item => item.id === opening.wallId);
    assert.ok(wall.openings.includes(opening));
    assert.ok(opening.offsetM >= 0);
    assert.ok(opening.offsetM + opening.widthM <= Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) + 1e-8);
    assert.ok(opening.sillM >= 0 && opening.sillM + opening.heightM <= wall.heightM);
    assert.equal(opening.openFraction, 0);
  }
  const door = scene.openings.find(item => item.kind === 'hinged');
  const window = scene.openings.find(item => item.kind === 'window');
  assert.equal(door.exterior, false);
  assert.equal(door.targetRoomId, 'floor-1:living-1');
  assert.equal(window.exterior, true);
  close(window.segment.y1, .6);
  assert.equal(window.operableFraction, .5);
  close(scene.metrics.wallFootprintM2, shellArea + .56);
  close(scene.metrics.solidWallFaceAreaM2, physicalLength(scene) * scene.wallHeightM - 2.1 - 1.2);
});

test('door nominal leaf, schematic aperture and requested clear width remain distinct', () => {
  const data = fixture();
  Object.assign(data.context.plan.openings.doors[0], { requestedClearWidthM: .9, nominalLeafWidthM: .95 });
  const scene = data.scene(), opening = scene.openings.find(item => item.kind === 'hinged');
  assert.equal(opening.widthM, 1);
  assert.equal(opening.requestedClearWidthM, .9);
  assert.equal(opening.nominalLeafWidthM, .95);
  assert.equal(opening.clearWidthVerified, false);
  assert.equal(opening.leafWidthAssumed, false);
  assert.equal(opening.dimensionConvention, 'schematic-proxy');
  close(Model.doorGeometry(opening, scene.walls.find(wall => wall.id === opening.wallId)).radiusM, .95);
  assert.ok(scene.diagnostics.some(item => /clear width is unverified/.test(item.message)));
});

test('generated fallback opening identities use room/kind/edge/target rather than position', () => {
  const data = fixture();
  delete data.context.plan.openings.doors[0].id;
  delete data.context.plan.openings.doors[0].targetRoomId;
  const first = data.scene().openings.find(item => item.kind === 'hinged');
  data.context.plan.openings.doors[0].segment = { x1: 5, y1: 4.2, x2: 5, y2: 5.2 };
  const next = data.scene().openings.find(item => item.kind === 'hinged');
  assert.equal(first.id, next.id);
  assert.ok(first.id.includes('kitchen-1') && first.id.includes('living-1'));
  assert.notEqual(first.offsetM, next.offsetM);
});

test('conflicting duplicate opening source IDs are rejected rather than resolved by array order', () => {
  const data = fixture();
  data.context.plan.customOpenings = [{ ...clone(data.context.plan.openings.doors[0]), width: 1.5 }];
  assert.throws(() => data.scene(), /Duplicate opening source id/);
});

test('legacy reprojected glyph handing is not promoted to a confirmed design decision', () => {
  const data = fixture();
  const source = data.context.plan.openings.doors[0];
  Object.assign(source, { hinge: 'end', swing: 'left', structuralRole: 'nonstructural' });
  let opening = data.scene().openings.find(item => item.kind === 'hinged');
  assert.equal(opening.handingAssumed, true);
  assert.equal(opening.hinge, 'end');
  data.project.doorEdits[opening.id] = { hinge: 'end', swing: 'right' };
  opening = data.scene().openings.find(item => item.kind === 'hinged');
  assert.equal(opening.handingAssumed, false);
});

test('custom fraction means center, edits retain start anchoring, and sliding doors remain sliding', () => {
  const data = fixture('N', false);
  data.context.plan.customOpenings.push({ id: 'custom-slider', roomId: 'kitchen-1', edge: 'W', fraction: .5, width: 1.2, kind: 'balcony-slider' });
  let scene = data.scene(), opening = scene.openings[0];
  assert.equal(opening.kind, 'sliding');
  close(opening.offsetM, (6.6 - 1.2) / 2);
  const offset = opening.offsetM;
  data.project.doorEdits[opening.id] = { widthM: 1.4, openFraction: .35, hinge: 'end', swing: 'right' };
  scene = data.scene(); opening = scene.openings[0];
  assert.equal(opening.kind, 'sliding');
  assert.equal(opening.openFraction, .35);
  assert.equal(opening.widthM, 1.4);
  close(opening.offsetM, offset);
  assert.throws(() => Model.doorGeometry(opening, scene.walls.find(wall => wall.id === opening.wallId)), /hinged/);
});

test('invalid or crossing aperture intervals remain unresolved instead of clamping or fabricating geometry', () => {
  const data = fixture();
  const opening = data.scene().openings.find(item => item.kind === 'hinged');
  data.project.doorEdits[opening.id] = { widthM: 20 };
  let scene = data.scene();
  assert.ok(!scene.openings.some(item => item.id === opening.id));
  assert.ok(scene.unresolvedOpenings.some(item => item.id === opening.id));
  delete data.project.doorEdits[opening.id];
  const window = scene.openings.find(item => item.kind === 'window');
  data.project.windowEdits[window.id] = { heightM: 4 };
  scene = data.scene();
  assert.ok(!scene.openings.some(item => item.kind === 'window'));
  assert.equal(data.project.windowEdits[window.id].heightM, 4);
});

test('duplicate opposing door proposals are one physical opening; conflicting holes are unresolved', () => {
  const data = fixture();
  data.context.plan.openings.doors.push({
    ...clone(data.context.plan.openings.doors[0]), id: 'door-living-1-E', roomId: 'living-1', targetRoomId: 'kitchen-1', edge: 'E'
  });
  let scene = data.scene();
  assert.equal(scene.openings.filter(item => item.kind === 'hinged').length, 1);
  assert.equal(scene.openings.find(item => item.kind === 'hinged').sourceIds.length, 2);
  close(scene.metrics.solidWallFaceAreaM2, physicalLength(scene) * scene.wallHeightM - 2.1 - 1.2);
  data.context.plan.openings.windows.push({
    id: 'window-overlap', roomId: 'kitchen-1', edge: 'W', width: .8, height: 1, sillM: 1,
    segment: { x1: 5, y1: 3.2, x2: 5, y2: 4 }
  });
  scene = data.scene();
  assert.ok(scene.unresolvedOpenings.some(item => /overlap/.test(item.reason)));
});

test('solidSections represent exact sill/head/piers without refilling vertically stacked apertures', () => {
  const data = fixture('N', false);
  data.context.plan.openings.windows = [
    { id: 'lower-window', roomId: 'kitchen-1', edge: 'W', width: 1, height: .5, sillM: .5, segment: { x1: 5, y1: 3, x2: 5, y2: 4 } },
    { id: 'upper-window', roomId: 'kitchen-1', edge: 'W', width: 1, height: .5, sillM: 1.5, segment: { x1: 5, y1: 3, x2: 5, y2: 4 } }
  ];
  const scene = data.scene(), wall = shared(scene)[0], length = wall.end.y - wall.start.y;
  assert.equal(wall.openings.length, 2);
  const area = wall.solidSections.reduce((sum, section) => sum + (section.endM - section.startM) * section.heightM, 0);
  close(area, length * wall.heightM - 1);
  for (const section of wall.solidSections) for (const aperture of wall.openings) {
    const alongOverlap = section.startM < aperture.offsetM + aperture.widthM - 1e-8 && section.endM > aperture.offsetM + 1e-8;
    const verticalOverlap = section.sillM < aperture.sillM + aperture.heightM - 1e-8 && section.sillM + section.heightM > aperture.sillM + 1e-8;
    assert.ok(!(alongOverlap && verticalOverlap));
  }
  close(scene.metrics.wallFootprintM2, shellArea + .66);
});

test('chains of overlapping legacy passages produce one physical interval with retained source aliases', () => {
  const data = fixture('N', false);
  const intervals = [[1, 2], [3, 4], [1.5, 3.5]];
  data.context.plan.wallOpenings = intervals.map(([lo, hi], index) => ({
    id: `passage-${index}`, roomId: 'kitchen-1', edge: 'W', width: hi - lo, full: false,
    segment: { x1: 5, y1: lo, x2: 5, y2: hi }
  }));
  const scene = data.scene(), wall = shared(scene)[0];
  assert.equal(wall.openings.length, 1);
  assert.equal(wall.openings[0].sourceIds.length, 3);
  close(wall.openings[0].widthM, 3);
  close(scene.metrics.wallFootprintM2, shellArea + .36);
});

test('hinge start/end and left/right derive all four quarter-circle orientations consistently', () => {
  const walls = [
    { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    { start: { x: 4, y: 0 }, end: { x: 0, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 0, y: 4 } },
    { start: { x: 0, y: 4 }, end: { x: 0, y: 0 } }
  ];
  for (const wall of walls) for (const hinge of ['start', 'end']) for (const swing of ['left', 'right']) {
    const opening = { kind: 'hinged', offsetM: 1, widthM: 1, hinge, swing, openFraction: 0 };
    const geometry = Model.doorGeometry(opening, wall);
    assert.deepEqual(geometry.hinge, Model.wallPoint(wall, hinge === 'start' ? 1 : 2));
    assert.deepEqual(geometry.closedEnd, Model.wallPoint(wall, hinge === 'start' ? 2 : 1));
    const closed = { x: geometry.closedEnd.x - geometry.hinge.x, y: geometry.closedEnd.y - geometry.hinge.y };
    const open = { x: geometry.openEnd.x - geometry.hinge.x, y: geometry.openEnd.y - geometry.hinge.y };
    close(Math.hypot(open.x, open.y), 1);
    close(closed.x * open.x + closed.y * open.y, 0);
    assert.equal(geometry.arcSweep, closed.x * open.y - closed.y * open.x > 0 ? 1 : 0);
    const tx = (wall.end.x - wall.start.x) / 4, ty = (wall.end.y - wall.start.y) / 4;
    close(open.x * ty - open.y * tx, swing === 'left' ? 1 : -1);
    assert.deepEqual(Model.doorGeometry({ ...opening, openFraction: 1 }, wall), geometry);
  }
});

test('wall helpers reject invalid intervals, nonfinite coordinates and degenerate walls', () => {
  const wall = { start: { x: 1, y: 1 }, end: { x: 4, y: 5 } };
  assert.deepEqual(Model.wallPoint(wall, 0), wall.start);
  assert.deepEqual(Model.wallPoint(wall, 5), wall.end);
  assert.throws(() => Model.wallPoint(wall, -1), /offset/);
  assert.throws(() => Model.wallPoint(wall, 6), /offset/);
  assert.throws(() => Model.wallPoint({ start: wall.start, end: wall.start }, 0), /length/);
  assert.throws(() => Model.wallPoint({ start: { x: NaN, y: 0 }, end: { x: 1, y: 0 } }, 0), /finite/);
});

test('all furniture head polarities survive square footprints, JSON restore and all four fronts', () => {
  for (const front of ['N', 'E', 'S', 'W']) for (const headLocal of ['N', 'E', 'S', 'W']) {
    const data = fixture(front, false);
    data.context.plan.furniture = [{ id: 'square-bed', roomId: 'living-1', type: 'bed', label: 'Bed', x: 1, y: 1, w: 1.5, h: 1.5, headLocal, pinned: true }];
    let item = data.scene().furniture[0];
    assert.equal(item.headLocal, headLocal); assert.equal(item.pinned, true);
    data.project.furnitureEdits[item.id] = { headLocal: 'W', pinned: false };
    data.project = Model.parseProject(JSON.stringify(data.project));
    item = Model.buildScene(data.context, data.project).furniture[0];
    assert.equal(item.headLocal, 'W'); assert.equal(item.pinned, false);
  }
});

test('legacy two-axis furniture orientation is explicitly assumed, never claimed as true head polarity', () => {
  const data = fixture('N', false);
  data.context.plan.furniture = [{ id: 'old-bed', roomId: 'living-1', type: 'bed', x: 1, y: 1, w: 2, h: 1.5, rotated: true }];
  const scene = data.scene();
  assert.equal(scene.furniture[0].headLocal, 'W');
  assert.equal(scene.furniture[0].headDirectionAssumed, true);
  assert.ok(scene.diagnostics.some(item => /polarity was not recorded/.test(item.message)));
});

test('full wall removal changes actual solids and quantities, not logical room labels', () => {
  const data = fixture();
  const before = data.scene(), wall = shared(before)[0], door = before.openings.find(item => item.kind === 'hinged');
  data.project.wallEdits[wall.id] = { full: true };
  const serialized = JSON.stringify(data.project);
  const scene = data.scene(), removed = scene.walls.find(item => item.id === wall.id);
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.solidSegments, []);
  assert.deepEqual(scene.rooms, before.rooms);
  close(scene.metrics.wallFootprintM2, shellArea);
  close(scene.metrics.solidWallFaceAreaM2, (physicalLength(before) - 6.6) * scene.wallHeightM - 1.2);
  assert.ok(scene.unresolvedOpenings.some(item => item.id === door.id));
  assert.ok(!scene.openings.some(item => item.id === door.id));
  assert.equal(JSON.stringify(data.project), serialized);
  assert.equal(data.context.plan.openings.doors.length, 1);
  delete data.project.wallEdits[wall.id];
  assert.deepEqual(data.scene(), before);
});

test('a full-span full-height closed door removes masonry but retains the declared opaque infill', () => {
  const data = fixture('N', false);
  data.context.plan.openings.doors = [{
    id: 'full-height-slider', roomId: 'kitchen-1', targetRoomId: 'living-1', edge: 'W',
    width: 6.6, heightM: data.project.building.wallHeightM, kind: 'sliding', openFraction: 0,
    segment: { x1: 5, y1: .7, x2: 5, y2: 7.3 }
  }];
  const scene = data.scene(), wall = shared(scene)[0];
  assert.equal(wall.removed, true);
  assert.deepEqual(wall.solidSegments, []);
  assert.deepEqual(wall.solidSections, []);
  assert.equal(scene.openings.length, 1);
  assert.equal(scene.openings[0].kind, 'sliding');
  assert.equal(scene.openings[0].openFraction, 0);
  assert.equal(scene.openings[0].wallId, wall.id);
  assert.deepEqual(scene.unresolvedOpenings, []);
  close(scene.metrics.wallFootprintM2, shellArea);
});

test('partial wall edits create bounded full-height passage solids and undo-serializable records', () => {
  const data = fixture('N', false), before = data.scene(), wall = shared(before)[0];
  const history = [JSON.stringify(data.project)];
  data.project.wallEdits[wall.id] = { full: false, offsetM: 1, widthM: 2 };
  history.push(JSON.stringify(data.project));
  const after = data.scene(), edited = after.walls.find(item => item.id === wall.id);
  assert.equal(edited.removed, false);
  assert.equal(edited.solidSegments.length, 2);
  close(edited.solidSegments[0].endM, 1);
  close(edited.solidSegments[1].startM, 3);
  close(after.metrics.wallFootprintM2, before.metrics.wallFootprintM2 - .2);
  close(after.metrics.solidWallFaceAreaM2, before.metrics.solidWallFaceAreaM2 - 2 * before.wallHeightM);
  const passage = after.openings.find(item => item.kind === 'passage');
  assert.equal(passage.heightM, before.wallHeightM); assert.equal(passage.openFraction, 1);
  assert.deepEqual(Model.buildScene(data.context, Model.parseProject(history[0])), before);
  assert.deepEqual(Model.buildScene(data.context, Model.parseProject(history[1])), after);
});

test('legacy full partitions remove true shared span rather than their shortened painted glyph', () => {
  const data = fixture('N', false);
  data.context.plan.wallOpenings = [{
    id: 'legacy-partition', roomId: 'living-1', targetRoomId: 'kitchen-1', edge: 'E', full: true, width: 6.44,
    segment: { x1: 5, y1: .78, x2: 5, y2: 7.22 }
  }];
  const scene = data.scene(), wall = shared(scene)[0];
  assert.equal(wall.removed, true);
  close(wall.openings[0].widthM, 6.6);
  close(scene.metrics.wallFootprintM2, shellArea);
});

test('full room-to-passage records use actual passage overlap, not the entire unrelated wall', () => {
  const data = fixture('N', false);
  data.context.plan.placed.pop();
  data.context.plan.flexSpaces = [{ x: 5, y: 2, w: 4.3, h: 2 }];
  data.context.plan.wallOpenings = [{
    id: 'passage-1', roomId: 'living-1', edge: 'E', full: true, width: 1.84,
    segment: { x1: 5, y1: 2.08, x2: 5, y2: 3.92 }
  }];
  const scene = data.scene(), opening = scene.openings.find(item => item.kind === 'passage');
  close(opening.widthM, 2); close(opening.segment.y1, 2); close(opening.segment.y2, 4);
  const wall = scene.walls.find(item => item.id === opening.wallId);
  assert.equal(wall.removed, false);
});

test('a partly out-of-range passage does not silently succeed as a shortened cut', () => {
  const data = fixture('N', false);
  data.context.plan.wallOpenings = [{
    id: 'oversized-passage', roomId: 'kitchen-1', edge: 'W', full: false, width: 3,
    segment: { x1: 5, y1: 6, x2: 5, y2: 9 }
  }];
  const scene = data.scene();
  assert.equal(scene.openings.length, 0);
  assert.ok(scene.unresolvedOpenings.some(item => /complete requested passage/.test(item.reason)));
  close(scene.metrics.wallFootprintM2, shellArea + .66);
});

test('zero room wall allowance is not fabricated by consuming clear carpet', () => {
  const data = fixture('N', false);
  const left = data.context.plan.placed[0], right = data.context.plan.placed[1];
  left.carpet.w += .05; right.carpet.x -= .05; right.carpet.w += .05;
  const scene = data.scene();
  assert.deepEqual(scene.rooms.find(room => room.sourceId === 'living-1').rect, left.carpet);
  assert.equal(shared(scene).length, 0);
  assert.ok(scene.diagnostics.some(item => item.level === 'error' && /no wall allowance/.test(item.message)));
});

test('exterior wall removal is protected in both saved edit and legacy passage paths', () => {
  const data = fixture('N', false), wall = data.scene().walls.find(item => item.exterior && item.roomIds.includes('floor-1:living-1'));
  data.project.wallEdits[wall.id] = { full: true };
  let scene = data.scene();
  assert.equal(scene.walls.find(item => item.id === wall.id).removed, false);
  assert.ok(scene.diagnostics.some(item => item.level === 'error' && /Exterior/.test(item.message)));
  data.context.plan.wallOpenings = [{
    id: 'bad-outside', roomId: 'living-1', edge: 'N', width: 1, full: false,
    segment: { x1: 2, y1: .7, x2: 3, y2: .7 }
  }];
  scene = data.scene();
  assert.ok(!scene.openings.some(item => item.sourceId === 'bad-outside'));
  assert.ok(scene.unresolvedOpenings.some(item => /exterior/.test(item.reason)));
});

test('orphaned edits and wall-mounted attachments are retained and explicitly reviewable', () => {
  const data = fixture('N', false), wall = shared(data.scene())[0];
  data.project.wallEdits[wall.id] = { full: true };
  data.project.wallEdits['floor-1:gone-wall'] = { full: true };
  data.project.doorEdits['floor-1:gone-door'] = { widthM: 1 };
  data.project.electrical = [{ id: 'point-1', wallId: wall.id }];
  const before = JSON.stringify(data.project), scene = data.scene();
  assert.deepEqual(scene.electrical, data.project.electrical);
  assert.notEqual(scene.electrical, data.project.electrical);
  assert.ok(scene.diagnostics.some(item => item.ids.includes('floor-1:gone-wall')));
  assert.ok(scene.diagnostics.some(item => item.ids.includes('floor-1:gone-door')));
  assert.ok(scene.diagnostics.some(item => item.ids.includes('point-1')));
  assert.equal(JSON.stringify(data.project), before);
});

test('all floor geometry is namespaced and elevations stack ordered storey heights, not regulatory selector elevation', () => {
  const data = fixture();
  data.project.obstacles = [{ id: 'tree', label: 'Tree', type: 'tree', x: -2, y: 1, w: 1, h: 1, heightM: 6, baseM: 0, transmittance: .3 }];
  const lower = data.scene();
  const upperFloor = { ...clone(data.project.floors[0]), id: 'upper', name: 'Upper', heightM: 3.6, legacy: { controls: {}, manualLayouts: [], context: clone(data.context) } };
  data.project.floors[0].heightM = 3.2;
  data.project.floors.push(upperFloor);
  data.project.activeFloorId = 'upper';
  data.project.building.floorElevationM = .4;
  data.project.building.roofThicknessM = .18;
  const upper = Model.buildScene(upperFloor.legacy.context, data.project);
  close(upper.floorElevationM, 3.6);
  close(upper.roofThicknessM, .18);
  assert.ok(upper.walls.every(wall => wall.baseM === upper.floorElevationM));
  assert.ok(upper.rooms.every(room => room.id.startsWith('upper:')));
  assert.ok(upper.walls.every(wall => wall.id.startsWith('upper:')));
  assert.ok(upper.openings.every(opening => opening.id.startsWith('upper:')));
  assert.equal(upper.obstacles[0].id, 'upper:tree');
  assert.equal(lower.obstacles[0].id, 'floor-1:tree');
  assert.equal(upper.obstacles[0].sourceId, 'tree');
  assert.equal(data.project.obstacles[0].id, 'tree');
  assert.equal(upper.obstacles[0].baseM, 0);
  assert.deepEqual(upper.rooms.map(room => room.sourceId), lower.rooms.map(room => room.sourceId));
  assert.ok(!upper.walls.some(wall => lower.walls.some(other => other.id === wall.id)));
  close(Model.localToWorld({ x: 5, y: 4 }, upper).up, 3.6);
  close(Model.localToWorld({ x: 5, y: 4, z: 8 }, upper).up, 8);
  const explicit = Model.buildScene({ ...data.context, floorElevationM: -2 }, data.project);
  assert.equal(explicit.floorElevationM, -2);
});

test('read-only regulatory comparison exposes the selected optimizer estimate without changing physical floor geometry', () => {
  const data = fixture('N', false), before = data.scene();
  Object.assign(data.context.plate, { id: 'A', floors: 4, selectedHeight: 12, ffh: 3, stilt: true, floorIndex: 4, floorElevation: 12 });
  const scene = data.scene();
  assert.equal(scene.regulatory.allowedFloors, 4);
  assert.equal(scene.regulatory.source, 'legacy-optimizer');
  assert.equal(scene.regulatory.plateId, 'A');
  assert.equal(scene.regulatory.selectedHeightM, 12);
  assert.equal(scene.regulatory.floorToFloorM, 3);
  assert.equal(scene.regulatory.stiltParking, true);
  assert.match(scene.regulatory.basis, /Not independently validated planning permission/);
  assert.deepEqual(scene.walls, before.walls);
  assert.deepEqual(scene.metrics, before.metrics);
  assert.equal(scene.floorElevationM, 0);
  assert.equal(data.project.floors.length, 1);
});

test('absent or malformed optimizer allowance stays unknown instead of using editable-floor count', () => {
  const data = fixture('N', false);
  let scene = data.scene();
  assert.equal(scene.regulatory.allowedFloors, null);
  assert.equal(scene.regulatory.plateId, null);
  assert.equal(scene.regulatory.selectedHeightM, null);
  assert.equal(scene.regulatory.stiltParking, null);
  for (const floors of ['4', -1, 2.5, NaN, Infinity, null]) {
    data.context.plate.floors = floors;
    scene = data.scene();
    assert.equal(scene.regulatory.allowedFloors, null);
  }
  data.context.plate.floors = 0;
  assert.equal(data.scene().regulatory.allowedFloors, 0);
});

test('a floor-specific edit cannot remove the same source wall on a different storey', () => {
  const data = fixture('N', false), lowerWall = shared(data.scene())[0];
  data.project.wallEdits[lowerWall.id] = { full: true };
  data.project.floors.push({ ...clone(data.project.floors[0]), id: 'upper', name: 'Upper' });
  data.project.activeFloorId = 'upper';
  const scene = data.scene();
  assert.equal(shared(scene)[0].removed, false);
  assert.ok(scene.diagnostics.some(item => item.ids.includes(lowerWall.id) && /no current host/.test(item.message)));
});

test('legacy role/axis annotations cannot manufacture structural certainty or rotate local geometry', () => {
  const data = fixture('E', false);
  data.context.plan.placed[0].structuralRole = 'nonstructural';
  data.context.plan.placed[0].walls = { structuralRole: 'safe-to-remove', material: 'verified masonry' };
  data.context.plan.walls = [{ exterior: false, structuralRole: 'nonstructural', heightM: 100 }];
  const scene = data.scene();
  assert.ok(scene.walls.every(wall => wall.structuralRole === 'unknown'));
  assert.ok(scene.walls.every(wall => wall.heightM === data.project.building.wallHeightM));
  assert.equal(scene.headingDeg, 90);
  assert.ok(scene.diagnostics.some(item => /unverified/.test(item.message)));
});
