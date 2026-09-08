const test = require('node:test');
const assert = require('node:assert/strict');
const Electrical = require('../electrical-planner.js');

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function sceneFixture(floorId = 'ground', elevation = 3) {
  const roomId = `${floorId}:bedroom`;
  const wall = (name, start, end) => ({
    id: `${floorId}:${name}`, start, end, thicknessM: 0.2, heightM: 2.8, baseM: elevation,
    exterior: true, structuralRole: 'unknown', roomIds: [roomId], openings: [], removed: false,
    solidSegments: [{ startM: 0, endM: Math.hypot(end.x - start.x, end.y - start.y) }]
  });
  return {
    revision: 1, floorId, headingDeg: 37, floorElevationM: elevation, wallHeightM: 2.8,
    floor: { x: 0, y: 0, w: 6, h: 5 }, building: { x: 0, y: 0, w: 6, h: 5 },
    rooms: [{ id: roomId, sourceId: 'bedroom', label: 'Bedroom', type: 'bed', rect: { x: 0, y: 0, w: 6, h: 5 } }],
    walls: [
      wall('north', { x: 0, y: 0 }, { x: 6, y: 0 }),
      wall('east', { x: 6, y: 0 }, { x: 6, y: 5 }),
      wall('south', { x: 6, y: 5 }, { x: 0, y: 5 }),
      wall('west', { x: 0, y: 5 }, { x: 0, y: 0 })
    ],
    openings: [], furniture: [], electrical: [], obstacles: [], diagnostics: []
  };
}

function pointFixture(overrides = {}) {
  const { anchor, envelope, inputs, ...rest } = overrides;
  return {
    version: 1, id: 'ground:electrical:one', floorId: 'ground', roomId: 'ground:bedroom',
    type: 'socket', label: 'Bedside phone charger', purpose: 'Phone charger', loadCategory: 'low',
    anchor: {
      kind: 'wall', wallId: 'ground:north', face: 'right', offsetM: 1,
      basis: { start: { x: 0, y: 0 }, end: { x: 6, y: 0 } }, ...anchor
    },
    elevationM: 0.45, elevationReference: 'plate-centre',
    envelope: { widthM: 0.1, heightM: 0.1, depthM: 0.03, referenceOffsetM: null, ...envelope },
    inputs: { wetArea: 'dry', ...inputs }, origin: { kind: 'manual' }, ...rest
  };
}

function addWindow(scene) {
  scene.openings.push({
    id: `${scene.floorId}:window`, sourceId: 'window', wallId: `${scene.floorId}:north`, roomId: `${scene.floorId}:bedroom`,
    kind: 'window', offsetM: 2, widthM: 1, sillM: 1, heightM: 1.1, openFraction: 0,
    segment: { x1: 2, y1: 0, x2: 3, y2: 0 }
  });
  scene.walls[0].solidSegments = [{ startM: 0, endM: 2 }, { startM: 3, endM: 6 }];
}

function addBed(scene, headLocal = 'N') {
  const bed = { id: `${scene.floorId}:bed`, sourceId: 'bed', roomId: `${scene.floorId}:bedroom`, type: 'bed',
    label: 'Double bed', rect: { x: 1, y: 0.1, w: 2, h: 2 }, headLocal, pinned: false };
  scene.furniture.push(bed);
  return bed;
}

const Model = {
  wallPoint: (wall, offsetM) => Electrical.wallPoint(wall, offsetM),
  doorGeometry(door, wall) {
    const begin = Electrical.wallPoint(wall, door.offsetM);
    const end = Electrical.wallPoint(wall, door.offsetM + door.widthM);
    const hinge = door.hinge === 'start' ? begin : end, radiusM = door.nominalLeafWidthM ?? door.widthM;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const tx = (wall.end.x - wall.start.x) / length, ty = (wall.end.y - wall.start.y) / length;
    const direction = door.hinge === 'start' ? 1 : -1, side = door.swing === 'left' ? 1 : -1;
    const closedEnd = { x: hinge.x + tx * radiusM * direction, y: hinge.y + ty * radiusM * direction };
    const openEnd = { x: hinge.x + ty * radiusM * side, y: hinge.y - tx * radiusM * side };
    const cross = (closedEnd.x - hinge.x) * (openEnd.y - hinge.y) - (closedEnd.y - hinge.y) * (openEnd.x - hinge.x);
    return { hinge, closedEnd, openEnd, radiusM, arcSweep: cross > 0 ? 1 : 0 };
  }
};

function controllerFixture(initial = []) {
  let project = {
    schemaVersion: 1, id: 'local-project', revision: 0, activeFloorId: 'ground',
    floors: [{ id: 'ground', name: 'Ground', electrical: clone(initial) }, { id: 'upper', name: 'Upper', electrical: [] }],
    electrical: clone(initial)
  };
  let selection = null, scene = sceneFixture(), undo = [], redo = [];
  const listeners = new Set(), commands = [];
  const emit = type => listeners.forEach(fn => fn({ type, project: api.getProject(), scene: api.getScene(), selection }));
  const api = {
    commands,
    getProject: () => freeze(clone(project)),
    getScene: () => freeze({ ...clone(scene), electrical: clone(project.electrical) }),
    getSelection: () => selection,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    select(value) { selection = value ? freeze({ ...value }) : null; emit('selection'); },
    execute(command) {
      commands.push(clone(command)); undo.push(clone(project)); redo = [];
      if (command.type === 'set-electrical') project.electrical = clone(command.value);
      else if (command.type === 'select-floor') {
        project.floors.find(floor => floor.id === project.activeFloorId).electrical = clone(project.electrical);
        project.activeFloorId = command.id;
        project.electrical = clone(project.floors.find(floor => floor.id === command.id).electrical);
        scene = sceneFixture(command.id, command.id === 'upper' ? 6 : 3);
        selection = null;
      } else throw new Error('Unexpected command');
      project.floors.find(floor => floor.id === project.activeFloorId).electrical = clone(project.electrical);
      project.revision++; emit('project');
    },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo() { if (undo.length) { redo.push(clone(project)); project = undo.pop(); emit('history'); } },
    redo() { if (redo.length) { undo.push(clone(project)); project = redo.pop(); emit('history'); } },
    exportProject: () => JSON.stringify(project),
    importProject(text) { project = JSON.parse(text); emit('project'); },
    setScene(value) { scene = clone(value); emit('scene'); }
  };
  return api;
}

const check = (review, code) => review.checks.find(item => item.code === code);

test('wall positions use exact local metres and a real wall face, not geographic rotation', () => {
  const scene = sceneFixture(), point = pointFixture();
  let calls = 0;
  const model = { wallPoint(wall, offsetM) { calls++; return Electrical.wallPoint(wall, offsetM); } };
  const resolved = Electrical.resolveAnchor(freeze(point), freeze(scene), model);
  assert.equal(resolved.drawable, true);
  assert.deepEqual(resolved.position, { x: 1, y: 0.1, z: 3.45 });
  assert.equal(calls, 1);
  assert.deepEqual(Electrical.resolveAnchor(pointFixture({ anchor: { face: 'left' } }), scene).position, { x: 1, y: -0.1, z: 3.45 });
});

test('wallPoint is pure and strictly rejects out-of-range, nonfinite and degenerate inputs', () => {
  const wall = freeze(sceneFixture().walls[0]);
  assert.deepEqual(Electrical.wallPoint(wall, 6), { x: 6, y: 0 });
  for (const offset of [-0.01, 6.01, Infinity, NaN, null, '2']) assert.throws(() => Electrical.wallPoint(wall, offset), /not clamped/);
  assert.throws(() => Electrical.wallPoint({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }, 0));
});

test('an unset height remains null and incomplete, never elevation zero', () => {
  const point = pointFixture({ elevationM: null });
  const review = Electrical.reviewPoint(point, sceneFixture());
  assert.equal(review.drawable, true);
  assert.equal(review.position.z, null);
  assert.equal(check(review, 'height-unknown').status, 'unknown');
  assert.equal(check(review, 'reach-unknown').status, 'unknown');
  assert.equal(point.elevationM, null);
  assert.notEqual(review.status, 'pass');
});

test('elevation above finished floor adds the floor datum exactly once', () => {
  const scene = sceneFixture('ground', 8.2), point = pointFixture({ elevationM: 1.2 });
  assert.ok(Math.abs(Electrical.resolveAnchor(point, scene).position.z - 9.4) < 1e-12);
  scene.floorElevationM = null;
  const result = Electrical.resolveAnchor(point, scene);
  assert.equal(result.position.z, null);
  assert.equal(check(result, 'floor-datum-unknown').status, 'unknown');
});

test('actual elevations and complete envelopes outside the wall are rejected, not clamped', () => {
  for (const point of [
    pointFixture({ elevationM: 3 }),
    pointFixture({ elevationM: 0.02 }),
    pointFixture({ elevationM: 2.78 })
  ]) {
    const result = Electrical.resolveAnchor(point, sceneFixture());
    assert.equal(result.drawable, false);
    assert.equal(check(result, 'elevation-out-of-range').status, 'conflict');
  }
});

test('vertical bands distinguish plate centre, bottom and an operable-part datum', () => {
  assert.deepEqual(Electrical.verticalBand(pointFixture({ elevationM: 1, envelope: { heightM: 0.2 } })), { minM: 0.9, maxM: 1.1 });
  assert.deepEqual(Electrical.verticalBand(pointFixture({ elevationM: 1, elevationReference: 'plate-bottom', envelope: { heightM: 0.2 } })), { minM: 1, maxM: 1.2 });
  assert.equal(Electrical.verticalBand(pointFixture({ elevationReference: 'operable-part-centre' })), null);
  assert.deepEqual(Electrical.verticalBand(pointFixture({ elevationM: 1, elevationReference: 'operable-part-centre', envelope: { heightM: 0.2, referenceOffsetM: 0.05 } })),
    { minM: 0.95, maxM: 1.15 });
  assert.equal(Electrical.verticalBand(pointFixture({ envelope: { heightM: null } })), null);
});

test('vertical overlap has explicit unknown and boundary-contact states', () => {
  assert.equal(Electrical.verticalOverlap(null, { minM: 1, maxM: 2 }), null);
  assert.equal(Electrical.verticalOverlap({ minM: null, maxM: 0.5 }, { minM: 1, maxM: 2 }), null);
  assert.equal(Electrical.verticalOverlap({ minM: 0.3, maxM: 0.6 }, { minM: 1, maxM: 2 }), false);
  assert.equal(Electrical.verticalOverlap({ minM: 0.3, maxM: 1 }, { minM: 1, maxM: 2 }), true);
  assert.equal(Electrical.verticalOverlap({ minM: 2, maxM: 1 }, { minM: 0, maxM: 3 }), null);
});

test('below-window devices use vertical aperture bands despite a gap in plan solid segments', () => {
  const scene = sceneFixture(); addWindow(scene);
  const point = pointFixture({ anchor: { offsetM: 2.5 } });
  const result = Electrical.resolveAnchor(point, scene);
  assert.equal(result.drawable, true);
  assert.equal(check(result, 'aperture-vertical-separation').status, 'clear');
  assert.deepEqual(result.position, { x: 2.5, y: 0.1, z: 3.45 });
});

test('plate and window vertical overlap prevents a floating valid icon', () => {
  const scene = sceneFixture(); addWindow(scene);
  const point = pointFixture({ anchor: { offsetM: 2.5 }, elevationM: 1.3 });
  const result = Electrical.resolveAnchor(point, scene);
  assert.equal(result.drawable, false);
  assert.equal(result.position, null);
  assert.equal(check(result, 'aperture-overlap').status, 'conflict');
  assert.doesNotMatch(Electrical.renderDiagram(scene, [point], point.id), /data-elec-select=/);
});

test('missing mounting or aperture heights are not made into below-window passes', () => {
  const scene = sceneFixture(); addWindow(scene);
  const point = pointFixture({ anchor: { offsetM: 2.5 }, elevationM: null });
  assert.equal(Electrical.resolveAnchor(point, scene).drawable, false);
  scene.openings[0].heightM = null;
  const result = Electrical.resolveAnchor({ ...point, elevationM: 0.45 }, scene);
  assert.equal(result.drawable, false);
  assert.equal(check(result, 'aperture-band-unknown').status, 'unknown');
});

test('an above-door mount is based on the vertical lintel band, not a blanket plan exclusion', () => {
  const scene = sceneFixture(); addWindow(scene);
  scene.openings[0] = { ...scene.openings[0], kind: 'hinged', sillM: 0, heightM: 2.1 };
  const result = Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, elevationM: 2.5 }), scene);
  assert.equal(result.drawable, true);
  assert.equal(check(result, 'aperture-vertical-separation').status, 'clear');
});

test('window point with no plate dimensions is explicitly incomplete, even if its reference is below the sill', () => {
  const scene = sceneFixture(); addWindow(scene);
  const result = Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, envelope: { heightM: null, widthM: null } }), scene);
  assert.equal(result.drawable, true);
  assert.equal(check(result, 'aperture-vertical-separation').status, 'unknown');
  assert.equal(check(result, 'plate-width-unknown').status, 'unknown');
});

test('exact solid-section coverage checks the whole along-wall and vertical rectangle, including unions', () => {
  const sections = [
    { startM: 0, endM: 2, sillM: 0, heightM: 1 },
    { startM: 2, endM: 4, sillM: 0, heightM: 0.5 },
    { startM: 2, endM: 4, sillM: 0.5, heightM: 0.5 }
  ];
  const band = { minM: 0.1, maxM: 0.9 };
  assert.equal(Electrical.solidSectionsCover(freeze(sections), 1.5, 2.5, band), true);
  assert.equal(Electrical.solidSectionsCover(sections.slice(0, 2), 1.5, 2.5, band), false);
  assert.equal(Electrical.solidSectionsCover(sections, 2.5, 2.5, { minM: 0.2, maxM: 0.2 }), true);
  assert.equal(Electrical.solidSectionsCover([], 1, 2, band), false);
  assert.equal(Electrical.solidSectionsCover(null, 1, 2, band), null);
  assert.equal(Electrical.solidSectionsCover(sections, 1, 2, null), null);
  assert.equal(Electrical.solidSectionsCover([{ startM: 0, endM: 3, sillM: 0, heightM: null }], 1, 2, band), null);
});

test('stacked-window infill uses the exact solid sections and actual plate bands', () => {
  const scene = sceneFixture(); addWindow(scene);
  scene.openings[0].sillM = 0.8; scene.openings[0].heightM = 0.5;
  scene.openings.push({ ...scene.openings[0], id: 'ground:upper-window', sillM: 1.8, heightM: 0.4 });
  scene.walls[0].solidSections = [
    { startM: 0, endM: 2, sillM: 0, heightM: 2.8 },
    { startM: 3, endM: 6, sillM: 0, heightM: 2.8 },
    { startM: 2, endM: 3, sillM: 0, heightM: 0.8 },
    { startM: 2, endM: 3, sillM: 1.3, heightM: 0.5 },
    { startM: 2, endM: 3, sillM: 2.2, heightM: 0.6 }
  ];
  assert.equal(Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, elevationM: 1.55 }), scene).drawable, true);
  assert.equal(Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, elevationM: 1.78 }), scene).drawable, false);
  assert.equal(Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, elevationM: 0.45 }), scene).drawable, true);
  assert.equal(Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 }, elevationM: null }), scene).drawable, false);
});

test('provided exact wall material takes precedence over inferred window infill', () => {
  const scene = sceneFixture(); addWindow(scene);
  scene.walls[0].solidSections = [
    { startM: 0, endM: 2, sillM: 0, heightM: 2.8 },
    { startM: 3, endM: 6, sillM: 0, heightM: 2.8 }
  ];
  const result = Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 2.5 } }), scene);
  assert.equal(result.drawable, false);
  assert.equal(check(result, 'solid-section-gap').status, 'conflict');
  scene.walls[0].solidSections = null;
  assert.equal(check(Electrical.resolveAnchor(pointFixture(), scene), 'solid-sections-unknown').status, 'unknown');
});

test('an unknown-height reference needs a full-height solid column when exact sections are supplied', () => {
  const scene = sceneFixture(), point = pointFixture({ elevationM: null });
  scene.walls[0].solidSections = [{ startM: 0, endM: 6, sillM: 0, heightM: 2.8 }];
  assert.equal(Electrical.resolveAnchor(point, scene).drawable, true);
  scene.walls[0].solidSections[0].heightM = 1;
  assert.equal(Electrical.resolveAnchor(point, scene).drawable, false);
  assert.equal(check(Electrical.resolveAnchor(point, scene), 'solid-sections-unknown').status, 'unknown');
  scene.walls[0].solidSections[0].heightM = 2.8;
  delete scene.walls[0].solidSegments;
  assert.equal(Electrical.resolveAnchor(pointFixture(), scene).drawable, true);
});

test('wall shortening and plate width overhang never silently clamp', () => {
  const scene = sceneFixture();
  scene.walls[0].end.x = 0.8;
  scene.walls[0].solidSegments = [{ startM: 0, endM: 0.8 }];
  const point = pointFixture(), before = clone(point);
  assert.equal(Electrical.resolveAnchor(point, scene).drawable, false);
  assert.deepEqual(point, before);
  const wide = pointFixture({ anchor: { offsetM: 0.01 } });
  assert.equal(check(Electrical.resolveAnchor(wide, sceneFixture()), 'offset-out-of-range').status, 'conflict');
});

test('deleted and full-open walls produce orphan drafts; nearby walls are not selected', () => {
  for (const removed of [true, false]) {
    const scene = sceneFixture();
    if (removed) scene.walls[0].removed = true;
    else scene.walls = scene.walls.slice(1);
    const point = pointFixture(), before = JSON.stringify(point);
    const result = Electrical.resolveAnchor(point, scene);
    assert.equal(result.drawable, false);
    assert.equal(check(result, 'orphan-wall').status, 'conflict');
    assert.equal(JSON.stringify(point), before);
  }
});

test('an unsupported gap without opening-height evidence stays a draft', () => {
  const scene = sceneFixture();
  scene.walls[0].solidSegments = [{ startM: 0, endM: 0.5 }, { startM: 2, endM: 6 }];
  assert.equal(check(Electrical.resolveAnchor(pointFixture(), scene), 'open-wall-segment').status, 'conflict');
  delete scene.walls[0].solidSegments;
  assert.equal(check(Electrical.resolveAnchor(pointFixture(), scene), 'solid-wall-unknown').status, 'unknown');
});

test('wall translation carries points without moving them with furniture', () => {
  const scene = sceneFixture(), point = pointFixture();
  scene.walls[0].start.y = 0.5; scene.walls[0].end.y = 0.5;
  addBed(scene).rect.x = 3;
  const result = Electrical.resolveAnchor(freeze(point), freeze(scene));
  assert.deepEqual(result.position, { x: 1, y: 0.6, z: 3.45 });
});

test('an oriented wall reversal remaps both offset and face without mutating the record', () => {
  const scene = sceneFixture(), point = freeze(pointFixture());
  scene.walls[0].start = { x: 6, y: 0 }; scene.walls[0].end = { x: 0, y: 0 };
  const before = JSON.stringify(point), result = Electrical.resolveAnchor(point, freeze(scene));
  assert.equal(result.mapping.mapping, 'reversed');
  assert.equal(result.mapping.anchor.offsetM, 5);
  assert.equal(result.mapping.anchor.face, 'left');
  assert.deepEqual(result.position, { x: 1, y: 0.1, z: 3.45 });
  assert.equal(JSON.stringify(point), before);
});

test('explicit wall split lineage maps anchors, while ambiguous split boundaries do not guess', () => {
  const scene = sceneFixture(), original = scene.walls.shift();
  scene.walls.push({ ...original, id: 'ground:north-a', end: { x: 2, y: 0 }, solidSegments: [{ startM: 0, endM: 2 }] });
  scene.walls.push({ ...original, id: 'ground:north-b', start: { x: 2, y: 0 }, solidSegments: [{ startM: 0, endM: 4 }] });
  scene.wallLineage = [
    { sourceWallId: original.id, targetWallId: 'ground:north-a', sourceStartM: 0, sourceEndM: 2, targetStartM: 0, targetEndM: 2 },
    { sourceWallId: original.id, targetWallId: 'ground:north-b', sourceStartM: 2, sourceEndM: 6, targetStartM: 0, targetEndM: 4 }
  ];
  const mapped = Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 3 } }), scene);
  assert.equal(mapped.mapping.mapping, 'lineage');
  assert.equal(mapped.mapping.anchor.wallId, 'ground:north-b');
  assert.equal(mapped.mapping.anchor.offsetM, 1);
  assert.equal(mapped.position.x, 3);
  assert.equal(Electrical.mapWallAnchor(pointFixture({ anchor: { offsetM: 2 } }).anchor, scene).mapping, 'ambiguous-lineage');
  delete scene.wallLineage;
  assert.equal(Electrical.resolveAnchor(pointFixture({ anchor: { offsetM: 3 } }), scene).drawable, false);
});

test('surface anchors are light-only, lie on a known room surface, and need explicit datum height', () => {
  const point = { ...pointFixture({ type: 'light', elevationReference: 'mounting-point', elevationM: 2.8 }), anchor: { kind: 'ceiling', x: 2, y: 3 } };
  assert.deepEqual(Electrical.resolveAnchor(point, sceneFixture()).position, { x: 2, y: 3, z: 5.8 });
  assert.equal(Electrical.resolveAnchor({ ...point, elevationM: null }, sceneFixture()).drawable, false);
  assert.equal(Electrical.resolveAnchor({ ...point, elevationM: 1 }, sceneFixture()).drawable, false);
  assert.ok(Electrical.validatePoint({ ...point, type: 'socket' }).some(message => message.includes('Only lights')));
  assert.equal(Electrical.resolveAnchor({ ...point, anchor: { ...point.anchor, x: 7 } }, sceneFixture()).drawable, false);
  assert.equal(Electrical.resolveAnchor({ ...point, roomId: null }, sceneFixture()).drawable, false);
  assert.deepEqual(Electrical.resolveAnchor({ ...point, anchor: { kind: 'floor', x: 2, y: 3 }, elevationM: 0 }, sceneFixture()).position, { x: 2, y: 3, z: 3 });
});

test('validation rejects invented ratings/types, bad numerics, missing purpose, and cross-floor records', () => {
  assert.deepEqual(Electrical.validatePoint(pointFixture()), []);
  for (const overrides of [
    { elevationM: -1 }, { elevationM: '0.3' }, { elevationM: NaN }, { elevationM: Infinity },
    { type: 'breaker' }, { purpose: '' }, { label: ' ' }, { loadCategory: '16 A' },
    { id: 'not-namespaced' }, { envelope: { widthM: -1 } }, { envelope: { referenceOffsetM: 1 } },
    { inputs: { reachMinM: 1.5, reachMaxM: 1 } }
  ]) assert.ok(Electrical.validatePoint(pointFixture(overrides)).length);
  assert.ok(Electrical.validatePoint(pointFixture(), 'upper').length);
  assert.throws(() => Electrical.pointId('', 'one'));
  assert.equal(Electrical.pointId('upper', 'one'), 'upper:electrical:one');
});

test('bathrooms stay in professional review even when the user marks them dry', () => {
  const scene = sceneFixture(); scene.rooms[0].type = 'bathroom';
  const review = Electrical.reviewPoint(pointFixture({ inputs: { wetArea: 'dry' } }), scene);
  assert.equal(check(review, 'wet-area-review').status, 'review');
  assert.notEqual(review.status, 'pass');
  assert.equal(check(Electrical.reviewPoint(pointFixture({ inputs: { wetArea: 'unknown' } }), sceneFixture()), 'wet-area-review').status, 'review');
});

test('high-load appliances are connection intents without breaker/cable sizing or thermal power', () => {
  const point = pointFixture({ type: 'appliance', purpose: 'Oven supply intent', loadCategory: 'high' });
  const review = Electrical.reviewPoint(point, sceneFixture());
  assert.equal(check(review, 'circuit-protection-review').status, 'review');
  assert.equal(point.watts, undefined);
  assert.equal(point.breakerAmps, undefined);
  assert.equal(point.cableSize, undefined);
  assert.doesNotMatch(JSON.stringify(review), /\b(?:16|20|32|40)\s*A\b|mm²/);
});

test('a chosen reach height does not pass a blocked desk approach or missing counter heights', () => {
  const scene = sceneFixture();
  scene.furniture.push({ id: 'ground:desk', roomId: 'ground:bedroom', type: 'counter', label: 'Desk counter', rect: { x: 1, y: 0.2, w: 2, h: 1 } });
  const point = pointFixture({
    anchor: { offsetM: 1.5 }, elevationM: 1, elevationReference: 'operable-part-centre',
    envelope: { referenceOffsetM: 0.05, depthM: 0.2 },
    inputs: { furnitureId: 'ground:desk', reachMinM: 0.4, reachMaxM: 1.2, approachWidthM: 0.8, approachDepthM: 1.2 }
  });
  const review = Electrical.reviewPoint(point, scene);
  assert.equal(check(review, 'chosen-reach-interval').status, 'clear');
  assert.equal(check(review, 'approach-footprints').status, 'warning');
  assert.equal(check(review, 'counter-envelope').status, 'unknown');
  assert.equal(review.status, 'conflict / review');
});

test('height outside a user-selected interval is a warning, never a universal India numeric rule', () => {
  const point = pointFixture({ elevationM: 1.5, elevationReference: 'operable-part-centre', envelope: { referenceOffsetM: 0.05 }, inputs: { reachMinM: 0.5, reachMaxM: 1.2 } });
  assert.equal(check(Electrical.reviewPoint(point, sceneFixture()), 'chosen-reach-interval').status, 'warning');
  assert.equal(check(Electrical.reviewPoint({ ...point, elevationReference: 'plate-bottom' }, sceneFixture()), 'reach-unknown').status, 'unknown');
});

test('headboard geometry keeps all four actual head polarities, including square beds', () => {
  const bed = addBed(sceneFixture());
  const expected = {
    N: { x: 1, y: 0.1, w: 2, h: 0.2 },
    S: { x: 1, y: 1.9, w: 2, h: 0.2 },
    W: { x: 1, y: 0.1, w: 0.2, h: 2 },
    E: { x: 2.8, y: 0.1, w: 0.2, h: 2 }
  };
  for (const direction of Object.keys(expected)) {
    const result = Electrical.headboardRect({ ...bed, headLocal: direction }, 0.2);
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(result[key] - expected[direction][key]) < 1e-12);
  }
  assert.equal(Electrical.headboardRect({ ...bed, headLocal: null }, 0.2), null);
  assert.equal(Electrical.headboardRect(bed, 3), null);
});

test('measured headboard obstruction follows head polarity, not a fixed north guess', () => {
  const scene = sceneFixture(), bed = addBed(scene);
  const point = pointFixture({ anchor: { offsetM: 1.5 }, elevationM: 0.8, envelope: { depthM: 0.2 },
    inputs: { furnitureId: bed.id, headboardBaseM: 0, headboardHeightM: 1.2, headboardDepthM: 0.2 } });
  assert.equal(check(Electrical.reviewPoint(point, scene), 'headboard-overlap').status, 'warning');
  bed.headLocal = 'S';
  assert.equal(check(Electrical.reviewPoint(point, scene), 'headboard-overlap').status, 'clear');
  assert.equal(Electrical.resolveAnchor(point, scene).position.x, 1.5);
  point.inputs.headboardHeightM = null;
  assert.equal(check(Electrical.reviewPoint(point, scene), 'headboard-unknown').status, 'unknown');
});

test('a known physical headboard is checked even without a logical furniture association', () => {
  const scene = sceneFixture(), bed = addBed(scene);
  bed.headboard = { baseM: 0, heightM: 1.2, depthM: 0.2 };
  const point = pointFixture({ anchor: { offsetM: 1.5 }, elevationM: 0.8, envelope: { depthM: 0.2 } });
  assert.equal(check(Electrical.reviewPoint(point, scene), 'headboard-overlap').status, 'warning');
});

test('floor light references still identify supplied furniture interference without claiming a complete fixture envelope', () => {
  const scene = sceneFixture();
  scene.furniture.push({ id: 'ground:counter', type: 'counter', label: 'Counter', roomId: 'ground:bedroom',
    rect: { x: 1, y: 1, w: 2, h: 1 }, baseM: 0, heightM: 1 });
  const point = { ...pointFixture({ type: 'light', elevationM: 0, elevationReference: 'mounting-point', envelope: { referenceOffsetM: 0 } }),
    anchor: { kind: 'floor', x: 2, y: 1.5 } };
  const review = Electrical.reviewPoint(point, scene);
  assert.equal(check(review, 'counter-envelope').status, 'warning');
  assert.equal(check(review, 'surface-envelope-unknown').status, 'unknown');
});

test('known furniture heights separate true envelope intersections from unknown approach usability', () => {
  const scene = sceneFixture();
  scene.furniture.push({ id: 'ground:counter', type: 'counter', label: 'Counter', roomId: 'ground:bedroom', rect: { x: 0.5, y: 0.1, w: 2, h: 0.6 } });
  const point = pointFixture({ inputs: { furnitureId: 'ground:counter', furnitureBaseM: 0, furnitureHeightM: 0.9 } });
  assert.equal(check(Electrical.reviewPoint(point, scene), 'counter-envelope').status, 'warning');
  point.elevationM = 1.1;
  assert.equal(check(Electrical.reviewPoint(point, scene), 'counter-envelope').status, 'clear');
  assert.equal(check(Electrical.reviewPoint(point, scene), 'approach-unknown').status, 'unknown');
});

test('door sector checks include swept area, radial edges and circle intersections', () => {
  const geometry = { hinge: { x: 0, y: 0 }, closedEnd: { x: 1, y: 0 }, openEnd: { x: 0, y: 1 }, radiusM: 1, arcSweep: 1 };
  assert.equal(Electrical.sectorContains({ x: 0.4, y: 0.4 }, geometry), true);
  assert.equal(Electrical.sectorContains({ x: -0.4, y: 0.4 }, geometry), false);
  assert.equal(Electrical.sectorContains({ x: 0.9, y: 0.9 }, geometry), false);
  assert.equal(Electrical.sectorContains({ x: 0, y: 0 }, {}), null);
  assert.equal(Electrical.sectorTouchesPolygon(geometry, [{ x: 0.2, y: -0.1 }, { x: 0.4, y: -0.1 }, { x: 0.4, y: 0.2 }, { x: 0.2, y: 0.2 }]), true);
  assert.equal(Electrical.sectorTouchesPolygon(geometry, [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }]), false);
});

test('door swing checks use the shared geometry and report incomplete hinges rather than passing', () => {
  const scene = sceneFixture();
  const door = { id: 'ground:door', wallId: 'ground:north', roomId: 'ground:bedroom', kind: 'hinged', offsetM: 1, widthM: 1,
    sillM: 0, heightM: 2.1, hinge: 'start', swing: 'right', openFraction: 0 };
  scene.openings.push(door);
  scene.walls[0].solidSegments = [{ startM: 0, endM: 1 }, { startM: 2, endM: 6 }];
  const point = pointFixture({ anchor: { offsetM: 2.1 }, inputs: { approachWidthM: 0.6, approachDepthM: 0.8 } });
  assert.equal(check(Electrical.reviewPoint(point, scene, Model), 'door-swing-overlap').status, 'warning');
  delete door.hinge;
  assert.equal(check(Electrical.reviewPoint(point, scene, Model), 'door-swing-unknown').status, 'unknown');
});

test('physical door sweeps are not excluded by unrelated logical room labels after a partition change', () => {
  const scene = sceneFixture();
  scene.openings.push({ id: 'ground:door', wallId: 'ground:north', roomId: 'ground:other-logical-room', kind: 'hinged',
    offsetM: 1, widthM: 1, sillM: 0, heightM: 2.1, hinge: 'start', swing: 'right' });
  scene.walls[0].solidSegments = [{ startM: 0, endM: 1 }, { startM: 2, endM: 6 }];
  const point = pointFixture({ anchor: { offsetM: 2.1 }, inputs: { approachWidthM: 0.6, approachDepthM: 0.8 } });
  assert.equal(check(Electrical.reviewPoint(point, scene, Model), 'door-swing-overlap').status, 'warning');
});

function bedsideRequest(overrides = {}) {
  return { kind: 'bedside', roomId: 'ground:bedroom', targetId: 'ground:bed', type: 'socket', purpose: 'Phone charger',
    count: 2, gapM: 0.2, elevationM: null, elevationReference: 'plate-centre', ...overrides };
}

test('bedside proposals are optional, count-driven and change with the actual head end', () => {
  const scene = sceneFixture(), bed = addBed(scene), before = JSON.stringify(scene);
  const north = Electrical.suggestPoints(freeze(clone(scene)), bedsideRequest(), Model);
  assert.equal(north.requestedCount, 2);
  assert.equal(north.candidates.length, 2);
  assert.match(north.candidates[0].reason, /actual N head/);
  assert.equal(north.candidates[0].point.elevationM, null);
  assert.equal(JSON.stringify(scene), before);
  bed.headLocal = 'S';
  const south = Electrical.suggestPoints(scene, bedsideRequest(), Model);
  assert.match(south.candidates[0].reason, /actual S head/);
  assert.notEqual(south.geometryFingerprint, north.geometryFingerprint);
  assert.notDeepEqual(south.candidates.map(item => item.point.anchor), north.candidates.map(item => item.point.anchor));
  assert.throws(() => Electrical.suggestPoints(scene, bedsideRequest({ count: 0 }), Model));
  assert.throws(() => Electrical.suggestPoints(scene, bedsideRequest({ gapM: null }), Model));
});

test('a permanent passage never gets a fictional latch and proposals use surviving wall faces', () => {
  const scene = sceneFixture();
  scene.openings.push({ id: 'ground:portal', wallId: 'ground:north', roomId: 'ground:bedroom', kind: 'passage', offsetM: 0, widthM: 6, sillM: 0, heightM: 2.8 });
  scene.walls[0].removed = true; scene.walls[0].solidSegments = [];
  const request = bedsideRequest({ kind: 'passage', targetId: 'ground:portal' });
  const result = Electrical.suggestPoints(scene, request, Model);
  assert.equal(result.candidates.length, 2);
  for (const candidate of result.candidates) {
    assert.notEqual(candidate.point.anchor.wallId, 'ground:north');
    assert.match(candidate.reason, /no latch assumed/);
    assert.equal(Electrical.resolveAnchor(candidate.point, scene, Model).drawable, true);
  }
  assert.throws(() => Electrical.suggestPoints(scene, { ...request, kind: 'door-latch' }, Model), /no latch/);
});

test('door-latch proposals honor the real hinge end and never clamp an insufficient surviving return', () => {
  const scene = sceneFixture();
  const door = { id: 'ground:door', wallId: 'ground:north', roomId: 'ground:bedroom', kind: 'hinged',
    offsetM: 2, widthM: 1, hinge: 'start', swing: 'right', sillM: 0, heightM: 2.1 };
  scene.openings.push(door); scene.walls[0].solidSegments = [{ startM: 0, endM: 2 }, { startM: 3, endM: 6 }];
  const request = bedsideRequest({ kind: 'door-latch', targetId: door.id, count: 1, elevationM: 1.1 });
  const result = Electrical.suggestPoints(scene, request, Model);
  assert.equal(result.candidates[0].point.anchor.offsetM, 3.2);
  door.hinge = 'end';
  assert.equal(Electrical.suggestPoints(scene, request, Model).candidates[0].point.anchor.offsetM, 1.8);
  door.offsetM = 0;
  assert.equal(Electrical.suggestPoints(scene, request, Model).candidates.length, 0);
});

test('a supplied nominal leaf endpoint, not the aperture width, determines the latch candidate', () => {
  const scene = sceneFixture(), door = { id: 'ground:door', wallId: 'ground:north', roomId: 'ground:bedroom', kind: 'hinged',
    offsetM: 2, widthM: 2, nominalLeafWidthM: 0.6, hinge: 'start', swing: 'right', sillM: 0, heightM: 2.1 };
  scene.openings.push(door); scene.walls[0].solidSegments = [{ startM: 0, endM: 2 }, { startM: 4, endM: 6 }];
  const request = bedsideRequest({ kind: 'door-latch', targetId: door.id, count: 1, elevationM: 1.1 });
  const result = Electrical.suggestPoints(scene, request, Model);
  assert.equal(result.candidates.length, 0);
  assert.match(result.messages[0], /no unambiguous surviving wall face/);
  assert.throws(() => Electrical.suggestPoints(scene, request), /shared closed-leaf geometry/);
  assert.throws(() => Electrical.suggestPoints(scene, request, { ...Model, doorGeometry: () => null }), /geometry is incomplete/);
});

test('bathroom automatic suggestions are blocked rather than falsely green', () => {
  const scene = sceneFixture(); addBed(scene); scene.rooms[0].type = 'bathroom';
  assert.throws(() => Electrical.suggestPoints(scene, bedsideRequest(), Model), /qualified wet-area review/);
});

test('desk candidates carry explicit gap assumptions and missing approach reviews', () => {
  const scene = sceneFixture(); addBed(scene);
  const result = Electrical.suggestPoints(scene, bedsideRequest({ kind: 'desk', type: 'data', purpose: 'Laptop network', count: 1 }), Model);
  assert.equal(result.candidates[0].point.type, 'data');
  assert.match(result.candidates[0].point.origin.assumptions[0], /user chosen, not a national rule/);
  assert.equal(check(result.candidates[0].review, 'approach-unknown').status, 'unknown');
});

test('previews do not edit state; individual acceptance, selection, deletion and Undo use one store', () => {
  const api = controllerFixture(), scene = sceneFixture(); addBed(scene); api.setScene(scene);
  const preview = Electrical.suggestPoints(api.getScene(), bedsideRequest(), Model);
  assert.equal(api.commands.length, 0);
  const accepted = Electrical.acceptSuggestion(api, preview.candidates[0], 'accepted', Model);
  assert.equal(api.commands.length, 1);
  assert.equal(api.commands[0].type, 'set-electrical');
  assert.deepEqual(api.getSelection(), { kind: 'electrical', id: accepted.id });
  assert.equal(api.getProject().electrical.length, 1);
  const revision = api.getProject().revision;
  api.select({ kind: 'electrical', id: accepted.id });
  Electrical.reviewPoint(api.getProject().electrical[0], api.getScene(), Model);
  assert.equal(api.getProject().revision, revision);
  api.undo();
  assert.equal(api.getProject().electrical.length, 0);
  api.redo();
  assert.equal(api.getProject().electrical[0].origin.reason, accepted.origin.reason);
  Electrical.deletePoint(api, accepted.id);
  assert.equal(api.getProject().electrical.length, 0);
  api.undo();
  assert.deepEqual(api.getProject().electrical[0], accepted);
});

test('stale previews reject acceptance, while accepted anchors stay put and become reviewable', () => {
  const api = controllerFixture(), scene = sceneFixture(), bed = addBed(scene);
  api.setScene(scene);
  const preview = Electrical.suggestPoints(api.getScene(), bedsideRequest({ count: 1 }), Model);
  const accepted = Electrical.acceptSuggestion(api, preview.candidates[0], 'accepted', Model);
  const before = Electrical.resolveAnchor(accepted, api.getScene(), Model).position;
  bed.headLocal = 'E'; api.setScene(scene);
  assert.throws(() => Electrical.acceptSuggestion(api, preview.candidates[0], 'second', Model), /stale/);
  const saved = api.getProject().electrical[0], review = Electrical.reviewPoint(saved, api.getScene(), Model);
  assert.equal(check(review, 'suggestion-stale').status, 'warning');
  assert.deepEqual(review.position, before);
  assert.deepEqual(saved, accepted);
});

test('editing metadata on an orphan retains the unsupported anchor; rehosting is explicit', () => {
  const original = pointFixture(), api = controllerFixture([original]), scene = sceneFixture();
  scene.walls[0].removed = true; api.setScene(scene);
  Electrical.savePoint(api, { ...original, label: 'Review missing wall' }, Model);
  assert.deepEqual(api.getProject().electrical[0].anchor, original.anchor);
  assert.equal(Electrical.reviewPoint(api.getProject().electrical[0], api.getScene(), Model).status, 'draft');
  assert.throws(() => Electrical.savePoint(api, { ...original, anchor: { ...original.anchor, offsetM: 2 } }, Model));
  const wall = scene.walls[1];
  Electrical.savePoint(api, { ...api.getProject().electrical[0], anchor: { kind: 'wall', wallId: wall.id, face: 'right', offsetM: 1, basis: { start: wall.start, end: wall.end } } }, Model);
  assert.equal(Electrical.resolveAnchor(api.getProject().electrical[0], api.getScene(), Model).drawable, true);
});

test('save rejects new invalid placements and preserves unrelated imported fields and points', () => {
  const first = { ...pointFixture(), manufacturerReview: { status: 'not supplied' } }, api = controllerFixture([first]);
  assert.throws(() => Electrical.savePoint(api, pointFixture({ id: 'ground:electrical:new', anchor: { offsetM: 30 } }), Model));
  assert.equal(api.commands.length, 0);
  Electrical.savePoint(api, { ...first, label: 'Renamed' }, Model);
  assert.deepEqual(api.getProject().electrical[0].manufacturerReview, first.manufacturerReview);
  const other = pointFixture({ id: 'ground:electrical:two', type: 'data', label: 'Desk network', purpose: 'LAN' });
  Electrical.savePoint(api, other, Model);
  assert.equal(api.getProject().electrical.length, 2);
  assert.deepEqual(api.getProject().electrical[1], other);
});

test('floor slices and JSON roundtrip preserve point IDs, null heights, datum and provenance', () => {
  const api = controllerFixture();
  Electrical.savePoint(api, pointFixture({ elevationM: null }), Model);
  const ground = api.getProject().electrical[0];
  api.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(Electrical.activePoints(api.getProject()).length, 0);
  const upper = pointFixture({
    id: 'upper:electrical:one', floorId: 'upper', roomId: 'upper:bedroom',
    anchor: { wallId: 'upper:north' }, label: 'Upper charger'
  });
  Electrical.savePoint(api, upper, Model);
  api.execute({ type: 'select-floor', id: 'ground' });
  assert.deepEqual(api.getProject().electrical[0], ground);
  const text = api.exportProject(), restored = controllerFixture();
  restored.importProject(text);
  assert.deepEqual(restored.getProject().electrical[0], ground);
  assert.equal(restored.getProject().floors[1].electrical[0].id, upper.id);
  assert.equal(restored.getProject().floors[0].electrical[0].elevationM, null);
  assert.deepEqual(restored.getProject().floors[0].electrical[0].origin, { kind: 'manual' });
});

function fakeForm(values) {
  const controls = new Map(Object.entries(values).map(([name, value]) => [name, { value: value == null ? '' : String(value), validity: { badInput: false } }]));
  return { elements: { namedItem: name => controls.get(name) || { value: '', validity: { badInput: false } } } };
}

test('form parsing retains blank heights and explicit datum; invalid numbers never coerce to zero', () => {
  const values = { label: 'Desk network', purpose: 'LAN', type: 'data', loadCategory: 'low', roomId: 'ground:bedroom',
    anchorKind: 'wall', wallId: 'ground:north', face: 'right', offsetM: '1.4', elevationM: '', elevationReference: 'plate-bottom' };
  const point = Electrical.readPointForm(fakeForm(values), sceneFixture(), null, 'form');
  assert.equal(point.elevationM, null);
  assert.equal(point.anchor.offsetM, 1.4);
  assert.equal(point.elevationReference, 'plate-bottom');
  assert.equal(point.inputs.wetArea, 'unknown');
  assert.equal(point.envelope.heightM, null);
  assert.throws(() => Electrical.readPointForm(fakeForm({ ...values, offsetM: 'Infinity' }), sceneFixture(), null, 'form'), /not be clamped/);
});

test('editing current oriented offsets after a reversal does not reinterpret them in the old basis', () => {
  const scene = sceneFixture(), original = pointFixture();
  scene.walls[0].start = { x: 6, y: 0 }; scene.walls[0].end = { x: 0, y: 0 };
  const values = { label: 'Edited charger', purpose: 'Charger', type: 'socket', loadCategory: 'low', roomId: 'ground:bedroom',
    anchorKind: 'wall', wallId: 'ground:north', face: 'right', offsetM: 1, elevationM: 0.45, elevationReference: 'plate-centre',
    widthM: 0.1, heightM: 0.1, depthM: 0.03, wetArea: 'dry' };
  const changed = Electrical.readPointForm(fakeForm(values), scene, original, 'ignored');
  assert.deepEqual(changed.anchor.basis, { start: { x: 6, y: 0 }, end: { x: 0, y: 0 } });
  assert.deepEqual(Electrical.resolveAnchor(changed, scene).position, { x: 5, y: -0.1, z: 3.45 });
  const unchanged = Electrical.readPointForm(fakeForm({ ...values, face: 'left', offsetM: 5 }), scene, original, 'ignored');
  assert.deepEqual(unchanged.anchor, original.anchor);
  assert.deepEqual(Electrical.resolveAnchor(unchanged, scene).position, { x: 1, y: 0.1, z: 3.45 });
});

test('metadata-only form edits retain shortened-wall drafts even when optional envelope keys were absent', () => {
  const original = pointFixture({ elevationM: null });
  delete original.envelope;
  const api = controllerFixture([original]), scene = sceneFixture();
  scene.walls[0].end.x = 0.8; scene.walls[0].solidSegments = [{ startM: 0, endM: 0.8 }];
  api.setScene(scene);
  const form = fakeForm({ label: 'Needs rehost', purpose: 'Charger', type: 'socket', loadCategory: 'low', roomId: 'ground:bedroom',
    anchorKind: 'wall', wallId: 'ground:north', face: 'right', offsetM: 1, elevationM: '', elevationReference: 'plate-centre', wetArea: 'dry' });
  const edited = Electrical.readPointForm(form, scene, original, 'ignored');
  Electrical.savePoint(api, edited, Model);
  assert.equal(api.getProject().electrical[0].label, 'Needs rehost');
  assert.equal(Electrical.resolveAnchor(api.getProject().electrical[0], scene).drawable, false);
  assert.equal(api.getProject().electrical[0].anchor.offsetM, 1);
});

test('zero-thickness walls and malformed shared door geometry never masquerade as evaluated support', () => {
  const scene = sceneFixture(); scene.walls[0].thicknessM = 0;
  assert.equal(Electrical.resolveAnchor(pointFixture(), scene).drawable, false);
  const valid = sceneFixture();
  valid.openings.push({ id: 'ground:door', wallId: 'ground:west', roomId: 'ground:bedroom', kind: 'hinged',
    offsetM: 1, widthM: 1, sillM: 0, heightM: 2.1, hinge: 'start', swing: 'right' });
  const review = Electrical.reviewPoint(pointFixture(), valid, { ...Model, doorGeometry: () => ({ radiusM: 0 }) });
  assert.equal(check(review, 'door-swing-unknown').status, 'unknown');
});

test('named list and schedule keep orphans reviewable and escape all user-provided markup', () => {
  const scene = sceneFixture(); scene.walls[0].removed = true;
  const point = pointFixture({ label: '<img src=x onerror=alert(1)>', purpose: '<script>bad()</script>', elevationM: null });
  const names = Electrical.renderPointList([point], scene, point.id);
  const table = Electrical.renderSchedule([point], scene, 'Ground <floor>');
  assert.match(names, /data-elec-select=/);
  assert.match(names, /draft/);
  assert.match(names, /&lt;img/);
  assert.doesNotMatch(names, /<img/);
  assert.match(table, /Unset — not zero/);
  assert.match(table, /Plate centre/);
  assert.match(table, /&lt;script&gt;/);
  assert.doesNotMatch(table, /<script>/);
});

test('diagram symbols are keyboard-named, distinct by type, and plotted at exact metre coordinates', () => {
  const scene = sceneFixture(), points = ['socket', 'switch', 'light', 'appliance', 'data'].map((type, i) =>
    pointFixture({ type, id: `ground:electrical:${type}`, label: `${type} point`, anchor: { offsetM: i + 0.5 } }));
  const html = Electrical.renderDiagram(scene, points, points[0].id);
  assert.equal((html.match(/data-elec-select=/g) || []).length, 5);
  assert.match(html, /transform="translate\(0.5 0.1\)"/);
  assert.match(html, /tabindex="0" role="button" aria-pressed="true"/);
  assert.match(html, /aria-label="socket point/);
  assert.match(html, /elec-selection-ring/);
  assert.doesNotMatch(Electrical.renderDiagram(scene, points, points[0].id, { showPoints: false }), /data-elec-select=/);
});

test('point forms expose explicit fields and no default India heights, ratings or fabricated surface hosts', () => {
  const html = Electrical.renderPointForm(null, sceneFixture());
  for (const name of ['label', 'purpose', 'loadCategory', 'wallId', 'face', 'offsetM', 'elevationM', 'elevationReference', 'furnitureId', 'headboardHeightM']) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(html, /name="elevationM"[^>]*value=""/);
  assert.match(html, /never zero/);
  assert.match(html, /not an electrical rating/);
});

test('old projects with no electrical collection and invalid scenes are honest empty states', () => {
  assert.deepEqual(Electrical.activePoints({ activeFloorId: 'ground' }), []);
  assert.match(Electrical.renderDiagram(null, [pointFixture()]), /No valid active-floor geometry/);
  assert.equal(Electrical.reviewPoint(pointFixture(), null).status, 'draft');
  assert.match(Electrical.renderSchedule([], null, 'Ground'), /No points on this floor/);
});

test('geometry fingerprints ignore selection/point edits but include doors, wall segments and head polarity', () => {
  const scene = sceneFixture(); addBed(scene);
  const key = Electrical.geometryFingerprint(scene);
  scene.revision++; scene.electrical.push(pointFixture());
  assert.equal(Electrical.geometryFingerprint(scene), key);
  scene.furniture[0].headLocal = 'W';
  assert.notEqual(Electrical.geometryFingerprint(scene), key);
  scene.furniture[0].headLocal = 'N'; scene.walls[0].solidSegments = [];
  assert.notEqual(Electrical.geometryFingerprint(scene), key);
  scene.walls[0].solidSegments = [{ startM: 0, endM: 6 }];
  scene.walls[0].solidSections = [{ startM: 0, endM: 6, sillM: 0, heightM: 2.8 }];
  assert.notEqual(Electrical.geometryFingerprint(scene), key);
});
