'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const physics = require('..\\building-physics.js');

const clone = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`
);
const find = (result, id) => {
  const value = (result.receivers || result.surfaces).find(surface => surface.id === id);
  assert.ok(value, `Missing receiver ${id}`);
  return value;
};
const material = overrides => ({
  thicknessM: 0.2, conductivityW_MK: 0.4, densityKgM3: 1000,
  specificHeatJ_KgK: 900, label: 'Analytical fixture', source: 'Hypothetical known equation',
  ...overrides
});
const scene = overrides => ({
  floorId: 'f', headingDeg: 0, floorElevationM: 0, wallHeightM: 3,
  floor: { x: 0, y: 0, w: 20, h: 20 },
  building: { x: 8, y: 8, w: 4, h: 4 },
  walls: [], openings: [], rooms: [], obstacles: [], ...overrides
});
const wall = overrides => ({
  id: 'front', start: { x: 8, y: 8 }, end: { x: 12, y: 8 },
  thicknessM: 0.2, heightM: 3, baseM: 0, exterior: true, removed: false,
  roomIds: [], openings: [], solidSegments: [{ startM: 0, endM: 4 }], ...overrides
});
const opening = overrides => ({
  id: 'window', wallId: 'front', kind: 'window', offsetM: 1, widthM: 2,
  sillM: 1, heightM: 1, openFraction: 0, exterior: true, ...overrides
});
const obstacle = overrides => ({
  id: 'block', type: 'building', x: 4, y: 4, w: 2, h: 2,
  heightM: 3, baseM: 0, transmittance: 0, ...overrides
});
const zenith = { east: 0, north: 0, up: 1 };
const east45 = { east: Math.SQRT1_2, north: 0, up: Math.SQRT1_2 };
const north45 = { east: 0, north: Math.SQRT1_2, up: Math.SQRT1_2 };
const clearNeighbors = () => Object.fromEntries(['front', 'right', 'rear', 'left'].map(side => [side, { state: 'clear' }]));
const sunInterval = (sunENU = zenith, startUTC = '2026-09-15T06:00:00Z', endUTC = '2026-09-15T07:00:00Z') => ({
  startUTC, endUTC, sunENU
});
function sunlightAt(models, sunENU = zenith, options = {}) {
  const study = physics.createSunlightStudy(Array.isArray(models) ? models : [models], { neighbors: clearNeighbors(), ...options });
  study.addInterval(sunInterval(sunENU));
  return study.getResult();
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function plainFiniteJSON(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') {
    assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, 'Non-plain result object');
    Object.values(value).forEach(plainFiniteJSON);
  } else assert.ok(value === null || ['string', 'boolean'].includes(typeof value));
  assert.doesNotThrow(() => JSON.stringify(value));
}

test('CommonJS and browser IIFE expose exactly the frozen numerical API including the sunlight study', () => {
  const names = ['assemblyProperties', 'shadowAt', 'surfaceExposure', 'solveAirflow', 'simulateThermal', 'createSunlightStudy', 'createReceiverKernel'];
  assert.deepEqual(Object.keys(physics), names);
  assert.equal(Object.isFrozen(physics), true);
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'building-physics.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.BuildingPhysics), names);
  assert.equal(Object.isFrozen(context.BuildingPhysics), true);
  near(context.BuildingPhysics.assemblyProperties([material()]).resistanceM2K_W, 0.67);
  const study = context.BuildingPhysics.createSunlightStudy([scene()], { neighbors: clearNeighbors() });
  assert.equal(Object.isFrozen(study), true);
  study.addInterval(sunInterval());
  near(find(study.getResult(), 'f:roof').averageHours, 1);
});

test('arbitrary receiver kernel reuses wall reveals, explicit optics and ENU transform without an inferred roof', () => {
  const source=scene({coordinateSpace:'site-local',plot:{x:0,y:0,w:20,h:20},headingDeg:37,
    walls:[wall()],openings:[opening()]});
  const original=clone(source),kernel=physics.createReceiverKernel([source],{windowTransmittance:.4});
  assert.ok(Object.isFrozen(kernel));assert.ok(Object.isFrozen(kernel.metadata));
  assert.deepEqual(source,original);
  assert.deepEqual(kernel.metadata.omittedRoofFloorIds,['f']);
  near(kernel.trace({x:10,y:10,z:1.5},zenith),1);
  const a=37*Math.PI/180;
  const towardFront={east:Math.sin(a)*Math.SQRT1_2,north:Math.cos(a)*Math.SQRT1_2,up:Math.SQRT1_2};
  // The rising ray crosses strictly above the sill at both finite-thickness faces.
  near(kernel.trace({x:10,y:9,z:.2},towardFront),.4);
  source.roofThicknessM=.2;
  near(physics.createReceiverKernel([source],{windowTransmittance:.4}).trace({x:10,y:10,z:1.5},zenith),0);
  assert.throws(()=>kernel.trace({x:0,y:0,z:0},{east:1,north:1,up:1}),RangeError);
  assert.throws(()=>physics.createReceiverKernel([source],{}),TypeError);
});

test('arbitrary receiver preflight bounds geometry tessellation, floor frame and physical ID ambiguity', () => {
  const s=scene({coordinateSpace:'site-local',plot:{x:0,y:0,w:20,h:20},walls:[wall()]});
  s.openings=Array.from({length:200},(_,i)=>opening({id:'opening-'+i}));
  assert.throws(()=>physics.createReceiverKernel([s],{windowTransmittance:1}),/tessellation budget/);
  s.openings=[];const other=clone(s);other.floorId='upper';other.headingDeg=20;
  assert.throws(()=>physics.createReceiverKernel([s,other],{windowTransmittance:1}),/share/);
  s.obstacles=[obstacle({id:'front'})];
  assert.throws(()=>physics.createReceiverKernel([s],{windowTransmittance:1}),/unique/);
});

test('assembly uses d/k, explicit film resistances, and rho*c*d in SI units', () => {
  const result = physics.assemblyProperties([material()]);
  near(result.resistanceM2K_W, 0.67);
  near(result.uValueW_M2K, 1 / 0.67);
  near(result.arealHeatCapacityJ_M2K, 180000);
  assert.deepEqual(result.films, { inside: 0.13, outside: 0.04 });
  assert.match(result.warnings.join(' '), /ASSUMED.*not universal/);
  const multilayer = physics.assemblyProperties([
    material(), material({ thicknessM: 0.05, conductivityW_MK: 0.1, densityKgM3: 200, specificHeatJ_KgK: 1000 })
  ], { inside: 0, outside: 0 });
  near(multilayer.resistanceM2K_W, 1);
  near(multilayer.uValueW_M2K, 1);
  near(multilayer.arealHeatCapacityJ_M2K, 190000);
});

test('assembly requires capacity properties even when a U-value alone could be calculated', () => {
  for (const property of ['thicknessM', 'conductivityW_MK', 'densityKgM3', 'specificHeatJ_KgK']) {
    for (const value of [undefined, null, 0, -1, Infinity, NaN, '100']) {
      assert.throws(() => physics.assemblyProperties([material({ [property]: value })]), /positive|finite/);
    }
  }
  assert.throws(() => physics.assemblyProperties([]), /nonempty/);
  assert.throws(() => physics.assemblyProperties([material()], { inside: 0.13 }), /finite/);
  assert.throws(() => physics.assemblyProperties([material()], { inside: -1, outside: 0 }), /nonnegative/);
  assert.throws(() => physics.assemblyProperties([material({ unknownCp: 1000 })]), /not supported/);
  assert.throws(() => physics.assemblyProperties([material({ densityKgM3: 1e308 })]), /numerical range/);
});

test('assembly does not silently convert kJ/kgK or infer dynamic lag from layer order', () => {
  const a = material({ specificHeatJ_KgK: 1240 });
  const b = material({ thicknessM: 0.03, conductivityW_MK: 0.04, densityKgM3: 40, specificHeatJ_KgK: 1400 });
  const forwards = physics.assemblyProperties([a, b]);
  const backwards = physics.assemblyProperties([b, a]);
  near(forwards.resistanceM2K_W, backwards.resistanceM2K_W);
  near(forwards.arealHeatCapacityJ_M2K, backwards.arealHeatCapacityJ_M2K);
  near(physics.assemblyProperties([material({ specificHeatJ_KgK: 1.24 })]).arealHeatCapacityJ_M2K * 1000,
    physics.assemblyProperties([a]).arealHeatCapacityJ_M2K);
  assert.equal('indoorC' in forwards, false);
  assert.equal('timeLagHours' in forwards, false);
});

for (const altitude of [30, 45, 60]) {
  test(`3 m rectangular caster ground projection agrees with h/tan(${altitude} degrees)`, () => {
    const angle = altitude * Math.PI / 180;
    const result = physics.shadowAt(scene({ obstacles: [obstacle()] }), { east: Math.cos(angle), north: 0, up: Math.sin(angle) });
    const polygon = result.groundPolygons.find(value => value.obstacleId === 'block');
    assert.ok(polygon);
    near(Math.min(...polygon.points.map(point => point.x)), 4 - 3 / Math.tan(angle));
    near(Math.max(...polygon.points.map(point => point.x)), 6);
    near(Math.min(...polygon.points.map(point => point.y)), 4);
    near(Math.max(...polygon.points.map(point => point.y)), 6);
    let twiceArea = 0;
    polygon.points.forEach((point, i) => {
      const next = polygon.points[(i + 1) % polygon.points.length];
      twiceArea += point.x * next.y - next.x * point.y;
    });
    near(twiceArea / 2, (2 + 3 / Math.tan(angle)) * 2);
  });
}

test('ENU directions and all four building headings rotate exactly once, without rotating local coordinates', () => {
  const expectedLocalDirections = {
    east: [[1, 0], [0, -1], [-1, 0], [0, 1]],
    north: [[0, -1], [-1, 0], [0, 1], [1, 0]]
  };
  for (const cardinal of ['east', 'north']) {
    for (const polarity of [-1, 1]) {
      for (let h = 0; h < 4; h++) {
        const sun = { east: 0, north: 0, up: Math.SQRT1_2, [cardinal]: polarity * Math.SQRT1_2 };
        const result = physics.shadowAt(scene({ headingDeg: h * 90, obstacles: [obstacle()] }), sun, { samplesPerAxis: 2 });
        const polygon = result.groundPolygons.find(value => value.obstacleId === 'block');
        const [dx, dy] = expectedLocalDirections[cardinal][h].map(value => value * polarity);
        near(Math.min(...polygon.points.map(point => point.x)), 4 + Math.min(0, -3 * dx));
        near(Math.max(...polygon.points.map(point => point.x)), 6 + Math.max(0, -3 * dx));
        near(Math.min(...polygon.points.map(point => point.y)), 4 + Math.min(0, -3 * dy));
        near(Math.max(...polygon.points.map(point => point.y)), 6 + Math.max(0, -3 * dy));
      }
    }
  }
});

test('ground projection includes base clearance and does not move an elevated object footprint down vertically', () => {
  const result = physics.shadowAt(scene({ obstacles: [obstacle({ baseM: 2 })] }), east45);
  const points = result.groundPolygons.find(value => value.obstacleId === 'block').points;
  near(Math.min(...points.map(point => point.x)), 4 - 5);
  near(Math.max(...points.map(point => point.x)), 6 - 2);
});

test('roof receivers and geometric rays resolve partial and overlapping obstacle shade', () => {
  const half = obstacle({ x: 8, y: 8, w: 2, h: 4, baseM: 4, heightM: 1 });
  const first = physics.shadowAt(scene({ obstacles: [half] }), zenith);
  near(find(first, 'f:roof').areaM2, 16);
  near(find(first, 'f:roof').sunlitFraction, 0.5);
  near(find(first, 'block:roof').sunlitFraction, 1);
  const duplicateFootprint = physics.shadowAt(scene({ obstacles: [half, { ...half, id: 'second' }] }), zenith);
  near(find(duplicateFootprint, 'f:roof').sunlitFraction, 0.5);
  const overlap = physics.shadowAt(scene({ obstacles: [half, { ...half, id: 'second', x: 9 }] }), zenith);
  near(find(overlap, 'f:roof').sunlitFraction, 0.25);
  const full = physics.shadowAt(scene({ obstacles: [half, { ...half, id: 'second', x: 10 }] }), zenith);
  near(find(full, 'f:roof').sunlitFraction, 0);
});

test('explicit roof thickness projects a slab from its absolute underside through its geometric top', () => {
  const model = scene({ floorElevationM: 5, roofThicknessM: 0.5 });
  const result = physics.shadowAt(model, east45);
  const polygon = result.groundPolygons.find(value => value.obstacleId === 'f:roof');
  // Underside 5 + 3 = 8 m; top 8.5 m. Both elevations bound the slab shadow.
  near(Math.min(...polygon.points.map(point => point.x)), 8 - 8.5);
  near(Math.max(...polygon.points.map(point => point.x)), 12 - 8);
  near(find(result, 'f:roof').areaM2, 16);
  near(find(result, 'f:roof').sunlitFraction, 1);
  assert.match(result.warnings.join(' '), /supplied roofThicknessM = 0.5.*receiver on the geometric top/);
  const fallback = physics.shadowAt(scene(), east45);
  assert.match(fallback.warnings.join(' '), /Roof thickness unavailable: ASSUMED/);
  const zero = physics.shadowAt(scene({ roofThicknessM: 0 }), east45);
  assert.deepEqual(zero.groundPolygons, fallback.groundPolygons);
  assert.match(zero.warnings.join(' '), /Explicit roofThicknessM = 0/);
});

test('roof exposure is sampled at the supplied slab top, not the wall-top underside', () => {
  const model = scene({ obstacles: [obstacle({ x: 12, y: 8, w: 1, h: 4, heightM: 6 })] });
  const zeroThickness = physics.shadowAt(model, east45);
  near(find(zeroThickness, 'f:roof').sunlitFraction, 0.25);
  model.roofThicknessM = 0.5;
  const thick = physics.shadowAt(model, east45);
  near(find(thick, 'f:roof').sunlitFraction, 0.375);
  const exposure = physics.surfaceExposure(model, east45, { dniWm2: 800, dhiWm2: 100, ghiWm2: 600 });
  near(find(exposure, 'f:roof').beamWm2, 800 * Math.SQRT1_2 * 0.375);
});

test('a thick roof still blocks interior upward rays at its underside, not only at its top plane', () => {
  const model = apertureScene('passage', 1);
  model.walls[0].removed = true;
  model.openings[0] = opening({ kind: 'passage', offsetM: 0, widthM: 4, sillM: 0, heightM: 3, openFraction: 1 });
  const thin = physics.shadowAt(model, north45, { samplesPerAxis: 60 });
  model.roofThicknessM = 0.5;
  const thick = physics.shadowAt(model, north45, { samplesPerAxis: 60 });
  near(find(thin, 'internal:side-b').sunlitFraction, 0.7);
  near(find(thick, 'internal:side-b').sunlitFraction, 0.7);
});

test('bounded outdoor ground receiver subtracts occupied areas and integrates overlap, not polygon sums', () => {
  const first = obstacle({ x: 0, y: 0, w: 2, h: 4, baseM: 1, heightM: 1 });
  const model = scene({
    floor: { x: 0, y: 0, w: 6, h: 4 }, building: { x: 4, y: 0, w: 2, h: 4 },
    obstacles: [first, { ...first, id: 'second', x: 1 }]
  });
  const result = physics.shadowAt(model, zenith, { samplesPerAxis: 24 });
  near(find(result, 'f:ground').areaM2, 16);
  near(find(result, 'f:ground').sunlitFraction, 0.25);
  assert.equal(result.groundPolygons.filter(value => ['block', 'second'].includes(value.obstacleId)).length, 2);
  model.obstacles = [{ ...first, baseM: 0 }];
  const occupied = physics.shadowAt(model, zenith);
  near(find(occupied, 'f:ground').areaM2, 8);
  near(find(occupied, 'f:ground').sunlitFraction, 1);
});

test('canopy transmittance is supplied, applied once per box, and multiplied for separate overlapping trees', () => {
  const canopy = obstacle({ type: 'tree', x: 8, y: 8, w: 4, h: 4, baseM: 4, heightM: 2, transmittance: 0.5 });
  const one = physics.shadowAt(scene({ obstacles: [canopy] }), zenith);
  near(find(one, 'f:roof').sunlitFraction, 0.5);
  assert.equal(one.groundPolygons.find(value => value.obstacleId === 'block').transmittance, 0.5);
  assert.match(one.warnings.join(' '), /once per intersected object/);
  const two = physics.shadowAt(scene({ obstacles: [canopy, { ...canopy, id: 'second' }] }), zenith);
  near(find(two, 'f:roof').sunlitFraction, 0.25);
  for (const transmittance of [0, 1]) {
    near(find(physics.shadowAt(scene({ obstacles: [{ ...canopy, transmittance }] }), zenith), 'f:roof').sunlitFraction, transmittance);
  }
});

test('opening transmission is invariant to sill/lintel partitioning elsewhere on the wall', () => {
  const model = apertureScene();
  model.openings[0] = opening({ sillM: 0.5, heightM: 2 });
  model.openings.push(opening({ id: 'other-window', offsetM: 0, widthM: 0.5, sillM: 1, heightM: 1 }));
  for (const samplesPerAxis of [8, 16, 32, 60]) {
    const clear = physics.shadowAt(model, north45, { samplesPerAxis, windowTransmittance: 1 });
    const transmitting = physics.shadowAt(model, north45, { samplesPerAxis, windowTransmittance: 0.5 });
    near(find(transmitting, 'internal:side-b').sunlitFraction, 0.5 * find(clear, 'internal:side-b').sunlitFraction);
  }
});

test('wall and opening receiver areas exclude aperture material, including sill and lintel', () => {
  const model = scene({ walls: [wall({ solidSegments: [{ startM: 0, endM: 1 }, { startM: 3, endM: 4 }] })], openings: [opening()] });
  const result = physics.shadowAt(model, north45);
  near(find(result, 'front').areaM2, 10);
  near(find(result, 'window').areaM2, 2);
  near(find(result, 'front').sunlitFraction, 1);
  near(find(result, 'window').sunlitFraction, 1);
  assert.match(result.warnings.join(' '), /NOT SHGC.*airflow/);
  assert.ok(result.groundPolygons.some(value => value.obstacleId === 'front'));
  assert.ok(result.groundPolygons.some(value => value.obstacleId === 'f:roof'));
});

function apertureScene(kind = 'window', openFraction = 0) {
  return scene({
    walls: [wall(), wall({ id: 'internal', start: { x: 8, y: 9 }, end: { x: 12, y: 9 }, exterior: false })],
    openings: [opening({ kind, openFraction })]
  });
}

test('finite wall thickness casts aperture-reveal shade and the flat roof blocks top-of-room rays', () => {
  const result = physics.shadowAt(apertureScene(), north45, { samplesPerAxis: 60 });
  // At y=8.9 the receiving face sees a 2 m by 0.8 m aperture after
  // traversing a 0.2 m wall at a 45-degree elevation.
  near(find(result, 'internal:side-b').sunlitFraction, 2 * 0.8 / 12);
  near(find(result, 'internal:side-a').sunlitFraction, 0);
  const closedGlass = physics.shadowAt(apertureScene(), north45, { samplesPerAxis: 60, windowTransmittance: 0 });
  near(find(closedGlass, 'internal:side-b').sunlitFraction, 0);
  const partlyOpen = physics.shadowAt(apertureScene('window', 0.5), north45, { samplesPerAxis: 60, windowTransmittance: 0 });
  near(find(partlyOpen, 'internal:side-b').sunlitFraction, 2 * 0.8 / 12 * 0.5);
});

test('door operating state, not a drawn hinge angle, controls the declared optical opening', () => {
  const fractions = [];
  for (const open of [0, 0.25, 1]) {
    const model = apertureScene('hinged', open);
    model.openings[0].hinge = 'start';
    model.openings[0].swing = 'left';
    const result = physics.shadowAt(model, north45, { samplesPerAxis: 60 });
    fractions.push(find(result, 'internal:side-b').sunlitFraction);
    near(find(result, 'window').sunlitFraction, 1); // Incident flux before the leaf.
    assert.match(result.warnings.join(' '), /spatially averaged/);
  }
  near(fractions[0], 0);
  near(fractions[1], fractions[2] / 4);
  near(fractions[2], 2 * 0.8 / 12);
  const removed = apertureScene();
  removed.walls[0].removed = true;
  removed.openings = [];
  const openPartition = physics.shadowAt(removed, north45, { samplesPerAxis: 60 });
  assert.ok(find(openPartition, 'internal:side-b').sunlitFraction > fractions[2]);
  assert.equal(openPartition.receivers.some(value => value.id === 'front'), false);
});

test('external rectangle shades a vertical facade and also receives on its own faces', () => {
  const result = physics.shadowAt(scene({
    walls: [wall()], obstacles: [obstacle({ x: 8, y: 6, w: 2, h: 1, heightM: 10 })]
  }), north45);
  near(find(result, 'front').sunlitFraction, 0.5);
  near(find(result, 'block:front').sunlitFraction, 1);
  near(find(result, 'block:rear').sunlitFraction, 0);
  assert.equal(find(result, 'block:front').type, 'obstacle-wall');
});

test('removed masonry does not erase a declared closed full-wall door leaf', () => {
  const model = apertureScene('hinged', 0);
  model.walls[0].removed = true;
  model.openings[0] = opening({ kind: 'hinged', offsetM: 0, widthM: 4, sillM: 0, heightM: 3, openFraction: 0 });
  const closed = physics.shadowAt(model, north45, { samplesPerAxis: 60 });
  near(find(closed, 'internal:side-b').sunlitFraction, 0);
  assert.equal(closed.receivers.some(value => value.id === 'front'), false);
  model.openings[0].openFraction = 1;
  const open = physics.shadowAt(model, north45, { samplesPerAxis: 60 });
  assert.ok(find(open, 'internal:side-b').sunlitFraction > 0.5);
});

test('exterior normals follow the adjacent room instead of misreading a recessed facade', () => {
  const result = physics.shadowAt(scene({
    rooms: [{ id: 'r', rect: { x: 8, y: 8, w: 4, h: 1 } }],
    walls: [wall({ id: 'recess', start: { x: 8, y: 9 }, end: { x: 12, y: 9 }, roomIds: ['r'] })]
  }), { east: 0, north: -Math.SQRT1_2, up: Math.SQRT1_2 });
  // The ray is on the outward (+local y) side; the main roof can still shade it.
  assert.ok(find(result, 'recess').sunlitFraction >= 0);
  const exposure = physics.surfaceExposure(scene({
    rooms: [{ id: 'r', rect: { x: 8, y: 8, w: 4, h: 1 } }],
    walls: [wall({ id: 'recess', start: { x: 8, y: 9 }, end: { x: 12, y: 9 }, roomIds: ['r'] })]
  }), { east: 0, north: -Math.SQRT1_2, up: Math.SQRT1_2 }, { dniWm2: 800, dhiWm2: 0, ghiWm2: 0 });
  assert.ok(find(exposure, 'recess').beamWm2 > 0);
});

test('shadow grid refinement converges for an off-grid rectangular edge', () => {
  const expected = 1 - 1.3 / 4;
  const model = scene({ obstacles: [obstacle({ x: 8, y: 8, w: 1.3, h: 4, baseM: 4, heightM: 1 })] });
  let coarseError;
  for (const n of [8, 32, 128]) {
    const actual = find(physics.shadowAt(model, zenith, { samplesPerAxis: n }), 'f:roof').sunlitFraction;
    const error = Math.abs(actual - expected);
    assert.ok(error <= 0.5 / n + 1e-12);
    if (coarseError === undefined) coarseError = error;
    if (n === 128) assert.ok(error < coarseError);
  }
});

test('below-horizon and near-horizon cases are explicitly bounded and never huge fake polygons', () => {
  for (const up of [-0.5, 0, Math.sin(0.5 * Math.PI / 180)]) {
    const result = physics.shadowAt(scene({ obstacles: [obstacle({ heightM: 100 })] }),
      { east: Math.sqrt(1 - up * up), north: 0, up });
    assert.equal(result.groundPolygons.length, 0);
    assert.ok(result.receivers.every(surface => surface.sunlitFraction === 0));
    assert.equal(result.directSunStatus, up > 0 ? 'near-horizon-suppressed' : 'below-horizon');
  }
  const result = physics.shadowAt(scene({ obstacles: [obstacle({ heightM: 10000 })] }), east45);
  assert.equal(result.groundPolygons.some(value => value.obstacleId === 'block'), false);
  assert.match(result.warnings.join(' '), /omitted beyond 1000.*block/);
  plainFiniteJSON(result);
});

test('radiation is beam plus independently assumed diffuse/ground W/m2, not beam-shaded darkness or lux', () => {
  const model = scene({
    walls: [wall()], obstacles: [obstacle({ x: 8, y: 6, w: 4, h: 1, heightM: 10 })]
  });
  const result = physics.surfaceExposure(model, north45, { dniWm2: 800, dhiWm2: 100, ghiWm2: 600, groundAlbedo: 0.2 });
  const facade = find(result, 'front');
  near(facade.sunlitFraction, 0);
  near(facade.beamWm2, 0);
  near(facade.skyDiffuseWm2, 50);
  near(facade.groundReflectedWm2, 60);
  near(facade.incidentWm2, 110);
  near(facade.skyViewFactor, 0.5);
  near(facade.groundViewFactor, 0.5);
  assert.match(result.warnings.join(' '), /UNOBSTRUCTED.*independently/);
  assert.equal('lux' in facade, false);
  const clear = physics.surfaceExposure(scene({ walls: [wall()] }), north45,
    { dniWm2: 800, dhiWm2: 100, ghiWm2: 600, groundAlbedo: 0.2 });
  near(find(clear, 'front').incidentWm2, 800 * Math.SQRT1_2 + 110);
  near(find(clear, 'f:roof').incidentWm2, 800 * Math.SQRT1_2 + 100);
  near(find(clear, 'f:roof').groundReflectedWm2, 0);
});

test('night beam is zero while independently supplied diffuse remains available, with default albedo disclosed', () => {
  const result = physics.surfaceExposure(scene({ walls: [wall()] }), { east: 0, north: 0, up: -1 },
    { dniWm2: 500, dhiWm2: 12, ghiWm2: 0 });
  near(find(result, 'front').incidentWm2, 6);
  near(find(result, 'f:roof').incidentWm2, 12);
  assert.match(result.warnings.join(' '), /ASSUMED ground albedo/);
});

test('interior diffuse is explicitly unavailable rather than assigned outdoor hemisphere irradiance', () => {
  const result = physics.surfaceExposure(apertureScene(), north45, { dniWm2: 800, dhiWm2: 100, ghiWm2: 600 });
  assert.ok(result.surfaces.every(surface => !surface.id.startsWith('internal:')));
  assert.match(result.warnings.join(' '), /Interior receiver irradiance is unavailable/);
});

test('solar inputs reject invalid geometry, unknown optical data, nonunit vectors and unsupported shapes', () => {
  for (const sun of [{ east: 0, north: 0, up: 0 }, { east: 2, north: 0, up: 0 }, { east: NaN, north: 0, up: 1 },
    { east: '0', north: 0, up: 1 }, { x: 0, y: 0, z: 1 }]) {
    assert.throws(() => physics.shadowAt(scene(), sun), /unit|finite|not supported/);
  }
  const mutations = [
    value => { value.headingDeg = NaN; },
    value => { value.floor.w = 0; },
    value => { value.building.h = -1; },
    value => { value.building.roofType = 'pitched'; },
    value => { value.roofThicknessM = -1; },
    value => { value.roofThicknessM = NaN; },
    value => { value.roofThicknessM = null; },
    value => { value.roofThicknessM = '0.15'; },
    value => { value.roofThicknessM = 1e-300; },
    value => { value.floorElevationM = -1; },
    value => { value.walls = [wall({ end: { x: 8, y: 8 } })]; },
    value => { value.walls = [wall({ thicknessM: 0 })]; },
    value => { value.walls = [wall({ removed: undefined })]; },
    value => { value.walls = [wall({ exterior: 'true' })]; },
    value => { value.walls = [wall(), wall()]; },
    value => { value.walls = [wall()]; value.openings = [opening({ widthM: 10 })]; },
    value => { value.walls = [wall()]; value.openings = [opening({ heightM: 3 })]; },
    value => { value.walls = [wall()]; value.openings = [opening({ kind: 'mesh' })]; },
    value => { value.walls = [wall()]; value.openings = [opening({ openFraction: null })]; },
    value => { value.walls = [wall()]; value.openings = [opening({ wallId: 'missing' })]; },
    value => { value.walls = [wall()]; value.openings = [opening(), opening({ id: 'overlap' })]; },
    value => { value.obstacles = [obstacle({ transmittance: undefined })]; },
    value => { value.obstacles = [obstacle({ transmittance: 1.1 })]; },
    value => { value.obstacles = [obstacle({ type: 'terrain' })]; },
    value => { value.obstacles = [obstacle({ baseM: -1 })]; },
    value => { value.obstacles = [obstacle({ heightM: 0 })]; },
    value => { value.obstacles = [obstacle({ baseM: 1e20, heightM: 1 })]; },
    value => { value.obstacles = [obstacle(), obstacle()]; }
  ];
  for (const mutate of mutations) {
    const value = scene();
    mutate(value);
    assert.throws(() => physics.shadowAt(value, zenith), Error);
  }
  for (const options of [{ samplesPerAxis: 0 }, { samplesPerAxis: 2.5 }, { samplesPerAxis: 129 },
    { minSunAltitudeDeg: 0 }, { minSunAltitudeDeg: 90 }, { maxShadowDistanceM: Infinity }, { windowTransmittance: -1 }]) {
    assert.throws(() => physics.shadowAt(scene(), zenith, options), Error);
  }
});

test('radiation requires nonnegative finite DNI/DHI/GHI and bounded albedo without treating missing as zero', () => {
  const valid = { dniWm2: 500, dhiWm2: 100, ghiWm2: 400 };
  for (const property of Object.keys(valid)) {
    for (const value of [null, undefined, NaN, Infinity, -1, '100']) {
      assert.throws(() => physics.surfaceExposure(scene(), zenith, { ...valid, [property]: value }), /finite|nonnegative/);
    }
  }
  assert.throws(() => physics.surfaceExposure(scene(), zenith, { ...valid, groundAlbedo: 1.1 }), /between/);
  assert.throws(() => physics.surfaceExposure(scene(), zenith, { ...valid, lux: 10000 }), /not supported/);
});

test('sunlight study starts at zero with a finite, explicit result and sampling contract', () => {
  const study = physics.createSunlightStudy([scene()], { neighbors: clearNeighbors() });
  assert.equal(Object.isFrozen(study), true);
  assert.deepEqual(Object.keys(study), ['addInterval', 'getResult']);
  const result = study.getResult();
  assert.deepEqual(Object.keys(result), [
    'elapsedHours', 'aboveHorizonHours', 'nearHorizonExcludedHours', 'sampling', 'assumptions', 'warnings', 'surfaces'
  ]);
  assert.deepEqual(result.sampling, {
    method: 'area-weighted midpoint rays', samplesPerAxis: 8, sampleCount: 64, intervalCount: 0,
    timeIntegration: 'duration-weighted midpoint sun vectors', minSunAltitudeDeg: 1
  });
  assert.deepEqual(find(result, 'f:roof'), {
    id: 'f:roof', floorId: 'f', type: 'roof', normal: { x: 0, y: 0, z: 1 },
    areaM2: 16, sampleCount: 64, averageHours: 0, minHours: 0, maxHours: 0,
    unobstructedHours: 0, blockedHours: 0, firstSunUTC: null, lastSunUTC: null
  });
  near(result.elapsedHours, 0);
  near(result.aboveHorizonHours, 0);
  near(result.nearHorizonExcludedHours, 0);
  assert.match(result.assumptions.join(' '), /continuous opaque.*without along-side ends/);
  assert.match(result.warnings.join(' '), /no opaque exterior wall receivers; no walls were invented/);
  plainFiniteJSON(result);
  assert.equal(find(sunlightAt(scene({ floorId: undefined })), 'roof').floorId, null);
});

test('unobstructed constant sunlight integrates known hours on roof and only outward opaque wall faces', () => {
  const model = scene({
    walls: [
      wall(),
      wall({ id: 'right', start: { x: 12, y: 8 }, end: { x: 12, y: 12 } }),
      wall({ id: 'rear', start: { x: 12, y: 12 }, end: { x: 8, y: 12 } }),
      wall({ id: 'left', start: { x: 8, y: 12 }, end: { x: 8, y: 8 } }),
      wall({ id: 'internal', start: { x: 8, y: 9 }, end: { x: 12, y: 9 }, exterior: false })
    ],
    openings: [opening()]
  });
  const study = physics.createSunlightStudy([model], { neighbors: clearNeighbors() });
  study.addInterval(sunInterval(north45, '2026-09-15T06:00:00Z', '2026-09-15T08:00:00Z'));
  study.addInterval(sunInterval(north45, '2026-09-15T08:00:00Z', '2026-09-15T10:00:00Z'));
  const result = study.getResult();
  assert.deepEqual(result.surfaces.map(surface => surface.id), ['front', 'right', 'rear', 'left', 'f:roof']);
  near(result.elapsedHours, 4);
  near(result.aboveHorizonHours, 4);
  near(find(result, 'front').areaM2, 10); // 12 m2 face minus the 2 m2 window.
  for (const id of ['front', 'f:roof']) {
    const surface = find(result, id);
    for (const field of ['averageHours', 'minHours', 'maxHours', 'unobstructedHours']) near(surface[field], 4);
    near(surface.blockedHours, 0);
    assert.equal(surface.firstSunUTC, '2026-09-15T06:00:00.000Z');
    assert.equal(surface.lastSunUTC, '2026-09-15T10:00:00.000Z');
  }
  for (const id of ['right', 'rear', 'left']) {
    const surface = find(result, id);
    near(surface.averageHours, 0);
    near(surface.unobstructedHours, 0);
    near(surface.blockedHours, 0);
    assert.equal(surface.firstSunUTC, null);
    assert.equal(surface.lastSunUTC, null);
  }
  const removed = sunlightAt(scene({ walls: [wall({ removed: true })], openings: [opening()] }), north45);
  assert.deepEqual(removed.surfaces.map(surface => surface.type), ['roof']);
});

test('high, low, far and partially obstructing neighbours resolve roof and facade sun hours', () => {
  const model = scene({ walls: [wall()] });
  const run = (heightM, gapM = 0) => sunlightAt(model, north45, {
    neighbors: { ...clearNeighbors(), front: { state: 'block', heightM, gapM } }
  });
  const high = run(100);
  for (const id of ['front', 'f:roof']) {
    const surface = find(high, id);
    near(surface.averageHours, 0);
    near(surface.unobstructedHours, 1);
    near(surface.blockedHours, 1);
    assert.equal(surface.firstSunUTC, null);
    assert.equal(surface.lastSunUTC, null);
  }
  for (const result of [run(1), run(100, 100)]) {
    near(find(result, 'front').averageHours, 1);
    near(find(result, 'f:roof').averageHours, 1);
  }
  const roofHalf = find(run(13), 'f:roof');
  near(roofHalf.averageHours, 0.5);
  near(roofHalf.minHours, 0);
  near(roofHalf.maxHours, 1);
  near(roofHalf.blockedHours, 0.5);
  assert.equal(roofHalf.firstSunUTC, '2026-09-15T06:00:00.000Z');
  const wallHalf = run(9.4);
  near(find(wallHalf, 'front').averageHours, 0.5);
  near(find(wallHalf, 'f:roof').averageHours, 1);
});

test('neighbour gap starts at the actual plot boundary so house setbacks and translated plot origins matter', () => {
  const options = { neighbors: { ...clearNeighbors(), front: { state: 'block', heightM: 10, gapM: 2 } } };
  const nearBoundary = scene({ building: { x: 8, y: 2, w: 4, h: 4 } });
  near(find(sunlightAt(nearBoundary, north45, options), 'f:roof').averageHours, 0.25);
  near(find(sunlightAt(scene(), north45, options), 'f:roof').averageHours, 1);
  const shifted = scene({
    floor: { x: 100, y: 200, w: 20, h: 20 }, building: { x: 108, y: 202, w: 4, h: 4 }
  });
  near(find(sunlightAt(shifted, north45, options), 'f:roof').averageHours, 0.25);
  const raisedDatum = scene({ floorElevationM: 10 });
  const raisedOptions = { groundElevationM: 10, neighbors: {
    ...clearNeighbors(), front: { state: 'block', heightM: 13, gapM: 0 }
  } };
  near(find(sunlightAt(raisedDatum, north45, raisedOptions), 'f:roof').averageHours, 0.5);
});

test('all four neighbour sides and cardinal/noncardinal headings use exactly one ENU rotation', () => {
  const local = { front: [0, -1], right: [1, 0], rear: [0, 1], left: [-1, 0] };
  for (const headingDeg of [0, 90, 180, 270, 33]) {
    const angle = headingDeg * Math.PI / 180;
    for (const [side, [x, y]] of Object.entries(local)) {
      const options = { samplesPerAxis: 2, neighbors: {
        ...clearNeighbors(), [side]: { state: 'block', heightM: 100, gapM: 2 }
      } };
      for (const sign of [-1, 1]) {
        const sun = {
          east: sign * Math.SQRT1_2 * (x * Math.cos(angle) - y * Math.sin(angle)),
          north: -sign * Math.SQRT1_2 * (x * Math.sin(angle) + y * Math.cos(angle)),
          up: Math.SQRT1_2
        };
        const result = sunlightAt(scene({ headingDeg, walls: [wall()] }), sun, options);
        near(find(result, 'f:roof').averageHours, sign === 1 ? 0 : 1);
        near(find(result, 'front').normal.x, 0);
        near(find(result, 'front').normal.y, -1);
        near(find(result, 'front').normal.z, 0);
      }
    }
  }
});

test('neighbours are unbounded along the side, with no finite footprint or projection-distance truncation', () => {
  const diagonal = { east: 0.9, north: 0.1, up: Math.sqrt(0.18) };
  const result = sunlightAt(scene(), diagonal, {
    neighbors: { ...clearNeighbors(), front: { state: 'block', heightM: 1000, gapM: 5 } }
  });
  // These rays reach the front screen well beyond the plot's right endpoint.
  near(find(result, 'f:roof').averageHours, 0);
  const far = sunlightAt(scene(), north45, {
    neighbors: { ...clearNeighbors(), front: { state: 'block', heightM: 1000000, gapM: 10000 } }
  });
  near(find(far, 'f:roof').averageHours, 0);
  assert.doesNotMatch(far.warnings.join(' '), /projection omitted/);
});

test('sunlight excludes at/below-horizon rays and separately reports positive near-horizon time', () => {
  const study = physics.createSunlightStudy([scene()], { neighbors: clearNeighbors() });
  const sunAt = degrees => ({ east: Math.cos(degrees * Math.PI / 180), north: 0, up: Math.sin(degrees * Math.PI / 180) });
  study.addInterval(sunInterval({ east: 0, north: 0, up: -1 }, '2026-09-15T00:00:00Z', '2026-09-15T01:00:00Z'));
  study.addInterval(sunInterval(sunAt(0), '2026-09-15T01:00:00Z', '2026-09-15T03:00:00Z'));
  study.addInterval(sunInterval(sunAt(0.5), '2026-09-15T03:00:00Z', '2026-09-15T03:30:00Z'));
  study.addInterval(sunInterval(sunAt(1), '2026-09-15T03:30:00Z', '2026-09-15T03:45:00Z'));
  study.addInterval(sunInterval(sunAt(2), '2026-09-15T03:45:00Z', '2026-09-15T04:00:00Z'));
  const result = study.getResult();
  near(result.elapsedHours, 4);
  near(result.aboveHorizonHours, 1);
  near(result.nearHorizonExcludedHours, 0.75);
  near(find(result, 'f:roof').averageHours, 0.25);
  near(find(result, 'f:roof').unobstructedHours, 0.25);
  near(find(result, 'f:roof').blockedHours, 0);
  assert.equal(find(result, 'f:roof').firstSunUTC, '2026-09-15T03:45:00.000Z');
  assert.match(result.warnings.join(' '), /nearHorizonExcludedHours.*cutoff/);
  const stricter = sunlightAt(scene(), sunAt(2), { minSunAltitudeDeg: 5 });
  near(stricter.nearHorizonExcludedHours, 1);
  near(find(stricter, 'f:roof').unobstructedHours, 0);
});

test('unequal, fractional and separated intervals use duration weights, not counts, elapsed span or cosine', () => {
  const study = physics.createSunlightStudy([scene({ walls: [wall()] })], { neighbors: clearNeighbors() });
  study.addInterval(sunInterval(north45, '2026-09-15T06:00:00Z', '2026-09-15T06:15:00Z'));
  study.addInterval(sunInterval(zenith, '2026-09-15T06:30:00Z', '2026-09-15T08:00:00Z'));
  study.addInterval(sunInterval({ east: 0, north: 0, up: -1 }, '2026-09-15T08:00:00Z', '2026-09-15T08:30:00Z'));
  study.addInterval(sunInterval(north45, '2026-09-15T08:30:00Z', '2026-09-15T08:30:00.5Z'));
  const result = study.getResult();
  near(result.elapsedHours, 2.25 + 0.5 / 3600);
  near(result.aboveHorizonHours, 1.75 + 0.5 / 3600);
  near(find(result, 'f:roof').averageHours, 1.75 + 0.5 / 3600);
  near(find(result, 'front').averageHours, 0.25 + 0.5 / 3600);
  assert.equal(find(result, 'front').lastSunUTC, '2026-09-15T08:30:00.500Z');
  assert.match(result.warnings.join(' '), /gaps.*excluded from elapsedHours/);
  assert.match(result.warnings.join(' '), /not a claim of uninterrupted/);
  assert.equal(result.sampling.intervalCount, 4);
});

test('sunlight point minima and maxima integrate changing shadows before taking the spatial range', () => {
  for (const split of ['07:00:00', '06:30:00']) {
    const study = physics.createSunlightStudy([scene()], {
      neighbors: {
        ...clearNeighbors(), front: { state: 'block', heightM: 13, gapM: 0 },
        rear: { state: 'block', heightM: 13, gapM: 0 }
      }
    });
    const change = '2026-09-15T' + split + 'Z';
    study.addInterval(sunInterval(north45, '2026-09-15T06:00:00Z', change));
    study.addInterval(sunInterval({ east: 0, north: -Math.SQRT1_2, up: Math.SQRT1_2 }, change, '2026-09-15T08:00:00Z'));
    const roof = find(study.getResult(), 'f:roof');
    near(roof.averageHours, 1);
    near(roof.minHours, split === '07:00:00' ? 1 : 0.5);
    near(roof.maxHours, split === '07:00:00' ? 1 : 1.5);
    near(roof.unobstructedHours, 2);
    near(roof.blockedHours, 1);
  }
});

test('unequal terrace patch areas weight the average rather than each sample getting an equal vote', () => {
  const lower = scene({ obstacles: [obstacle({ x: 10, y: 8, w: 2, h: 4, baseM: 7, heightM: 1 })] });
  const upper = scene({ floorId: 'u', floorElevationM: 3, building: { x: 9, y: 8, w: 1, h: 3 } });
  const result = sunlightAt([lower, upper], zenith, { samplesPerAxis: 1 });
  const terrace = find(result, 'f:roof');
  near(terrace.areaM2, 13);
  assert.equal(terrace.sampleCount, 5);
  near(terrace.averageHours, 5 / 13); // Three lit patches have areas 3, 1, 1; shaded patches have areas 6, 2.
  near(terrace.blockedHours, 8 / 13);
  near(terrace.minHours, 0);
  near(terrace.maxHours, 1);
  for (const surface of result.surfaces) {
    assert.ok(surface.minHours <= surface.averageHours && surface.averageHours <= surface.maxHours);
    assert.ok(surface.maxHours <= surface.unobstructedHours);
    near(surface.blockedHours + surface.averageHours, surface.unobstructedHours);
  }
  plainFiniteJSON(result);
});

test('explicit scene obstacles and distinct transmission layers weight hours without adding obstacle receivers', () => {
  const tree = obstacle({ type: 'tree', x: 8, y: 8, w: 2, h: 4, baseM: 4, heightM: 2, transmittance: 0.5 });
  const one = sunlightAt(scene({ obstacles: [tree] }));
  near(find(one, 'f:roof').averageHours, 0.75);
  near(find(one, 'f:roof').minHours, 0.5);
  near(find(one, 'f:roof').maxHours, 1);
  near(find(one, 'f:roof').blockedHours, 0.25);
  assert.deepEqual(one.surfaces.map(surface => surface.type), ['roof']);
  assert.match(one.warnings.join(' '), /partial-transmission.*area\/transmission-weighted/);
  const two = sunlightAt(scene({ obstacles: [tree, { ...tree, id: 'second' }] }));
  near(find(two, 'f:roof').averageHours, 0.625);
  near(find(two, 'f:roof').minHours, 0.25);
  const clear = sunlightAt(scene({ obstacles: [{ ...tree, transmittance: 1 }] }));
  near(find(clear, 'f:roof').averageHours, 1);
  const aperture = sunlightAt(apertureScene('window', 0.5), north45, { windowTransmittance: 0.2 });
  assert.match(aperture.warnings.join(' '), /closed-window beam transmittance = 0.2/);
  assert.match(aperture.warnings.join(' '), /partial-transmission/);
});

test('the same explicitly identified environment obstacle copied into multiple floors transmits only once', () => {
  const tree = obstacle({
    id: 'f:tree', sourceId: 'environment-tree', type: 'tree', x: 8, y: 8, w: 4, h: 4,
    baseM: 7, heightM: 2, transmittance: 0.5
  });
  const lower = scene({ obstacles: [tree] });
  const upper = scene({ floorId: 'u', floorElevationM: 3, obstacles: [{ ...tree, id: 'u:tree' }] });
  const result = sunlightAt([lower, upper]);
  near(find(result, 'u:roof').averageHours, 0.5);
  assert.match(result.warnings.join(' '), /same explicit sourceId are applied once/);
  for (const change of [{ transmittance: 0.25 }, { x: 8.1 }, { baseM: 8 }]) {
    const inconsistent = clone(upper);
    Object.assign(inconsistent.obstacles[0], change);
    assert.throws(() => sunlightAt([lower, inconsistent]), /sourceId.*ambiguous/);
  }
});

test('covered intermediate slabs are omitted while the raw single-scene roof API remains unchanged', () => {
  const lower = scene({ roofThicknessM: 0.2, walls: [wall()] });
  const upper = scene({
    floorId: 'u', floorElevationM: 3.2, roofThicknessM: 0.2,
    walls: [wall({ id: 'u:front', baseM: 3.2 })]
  });
  const result = sunlightAt([upper, lower]);
  assert.deepEqual(result.surfaces.filter(surface => surface.type === 'roof').map(surface => surface.id), ['u:roof']);
  near(find(result, 'u:roof').areaM2, 16);
  near(find(result, 'u:roof').averageHours, 1);
  assert.equal(find(result, 'u:front').floorId, 'u');
  assert.equal(find(result, 'front').floorId, 'f');
  assert.match(result.warnings.join(' '), /fully covered.*omitted/);
  assert.doesNotMatch(result.warnings.join(' '), /Only this scene is modeled/);
  near(find(physics.shadowAt(lower, zenith), 'f:roof').sunlitFraction, 1);
});

test('upper-storey roofs and explicitly supplied walls mutually shade lower roof terraces', () => {
  const lower = scene();
  const upper = scene({ floorId: 'u', floorElevationM: 3, building: { x: 8, y: 8, w: 2, h: 4 } });
  const west45 = { east: -Math.SQRT1_2, north: 0, up: Math.SQRT1_2 };
  const roofOnly = sunlightAt([lower, upper], west45);
  near(find(roofOnly, 'f:roof').areaM2, 8);
  near(find(roofOnly, 'f:roof').averageHours, 0.5);
  upper.walls = [wall({ id: 'u:right', start: { x: 10, y: 8 }, end: { x: 10, y: 12 }, baseM: 3 })];
  const enclosed = sunlightAt([lower, upper], west45);
  near(find(enclosed, 'f:roof').averageHours, 0);
  near(find(enclosed, 'f:roof').unobstructedHours, 1);
  near(find(enclosed, 'u:roof').averageHours, 1);
  near(find(sunlightAt(lower, west45), 'f:roof').averageHours, 1);
});

test('supplied upper walls can shade lower exterior walls, with unspecified projecting undersides disclosed', () => {
  const lower = scene({ walls: [wall({ id: 'f:right', start: { x: 12, y: 8 }, end: { x: 12, y: 12 } })] });
  const upper = scene({
    floorId: 'u', floorElevationM: 3, building: { x: 9, y: 8, w: 4, h: 4 },
    walls: [wall({ id: 'u:right', start: { x: 13, y: 8 }, end: { x: 13, y: 12 }, baseM: 3, thicknessM: 0.02 })]
  });
  const result = sunlightAt([lower, upper], east45);
  near(find(result, 'f:right').averageHours, 0.75);
  near(find(result, 'f:right').minHours, 0);
  near(find(result, 'f:right').maxHours, 1);
  near(find(sunlightAt(lower, east45), 'f:right').averageHours, 1);
  assert.match(result.warnings.join(' '), /Unspecified projecting floor undersides.*may add shade/);
});

test('all higher footprints are union-subtracted without double counting covered roof areas', () => {
  const middle = scene({ floorId: 'm', floorElevationM: 3, building: { x: 8, y: 8, w: 2, h: 4 } });
  const top = scene({ floorId: 't', floorElevationM: 6, building: { x: 9, y: 8, w: 2, h: 4 } });
  const result = sunlightAt([scene(), middle, top]);
  near(find(result, 'f:roof').areaM2, 4);
  near(find(result, 'm:roof').areaM2, 4);
  near(find(result, 't:roof').areaM2, 8);
  result.surfaces.forEach(surface => near(surface.averageHours, 1));
  const gap = sunlightAt([scene(), { ...middle, floorElevationM: 4 }]);
  assert.match(gap.warnings.join(' '), /explicit vertical gap/);
});

test('sunlight requires known, well-formed neighbours on every side and strict finite option units', () => {
  assert.throws(() => physics.createSunlightStudy([scene()]), /neighbors.*front.*right.*rear.*left/);
  assert.throws(() => physics.createSunlightStudy([scene()], {}), /neighbors/);
  for (const neighbors of [null, [], {}, { ...clearNeighbors(), other: { state: 'clear' } }]) {
    assert.throws(() => physics.createSunlightStudy([scene()], { neighbors }), /neighbors/);
  }
  for (const side of ['front', 'right', 'rear', 'left']) {
    const missing = clearNeighbors();
    delete missing[side];
    assert.throws(() => physics.createSunlightStudy([scene()], { neighbors: missing }), new RegExp(side + '.*required'));
    for (const value of [undefined, null, {}, { state: 'unknown' }, { state: 'Clear' }, { state: 'clear', heightM: 1 },
      { state: 'block', heightM: 1 }, { state: 'block', gapM: 0 },
      { state: 'block', heightM: 1, gapM: 0, widthM: 4 }, { state: 'block', heightM: 1, gapM: 0, depthM: 4 }]) {
      assert.throws(() => physics.createSunlightStudy([scene()], { neighbors: { ...clearNeighbors(), [side]: value } }), new RegExp(side));
    }
    for (const field of ['heightM', 'gapM']) {
      for (const value of [undefined, null, NaN, Infinity, -1, '3', ...(field === 'heightM' ? [0] : [])]) {
        const block = { state: 'block', heightM: 3, gapM: 0, [field]: value };
        assert.throws(() => physics.createSunlightStudy([scene()], { neighbors: { ...clearNeighbors(), [side]: block } }),
          new RegExp(side + '.*' + field));
      }
    }
  }
  const inherited = Object.create(clearNeighbors());
  assert.throws(() => physics.createSunlightStudy([scene()], { neighbors: inherited }), /front.*required/);
  for (const options of [
    { samplesPerAxis: 0 }, { samplesPerAxis: 2.5 }, { samplesPerAxis: 129 }, { samplesPerAxis: null },
    { groundElevationM: NaN }, { groundElevationM: '0' }, { minSunAltitudeDeg: 0 }, { minSunAltitudeDeg: 90 },
    { windowTransmittance: null }, { windowTransmittance: -0.1 }, { windowTransmittance: 1.1 }, { maxShadowDistanceM: 1000 }
  ]) {
    assert.throws(() => physics.createSunlightStudy([scene()], { neighbors: clearNeighbors(), ...options }), Error);
  }
});

test('sunlight rejects mismatched plot frames, duplicate IDs and inconsistent stacked geometry without guessed alignment', () => {
  assert.throws(() => physics.createSunlightStudy([], { neighbors: clearNeighbors() }), /nonempty/);
  const upper = () => scene({ floorId: 'u', floorElevationM: 3 });
  const bad = [
    { ...upper(), floor: { x: 1, y: 0, w: 20, h: 20 } },
    { ...upper(), floor: { x: 0, y: 0, w: 21, h: 20 } },
    { ...upper(), headingDeg: 90 },
    { ...upper(), plot: { x: 0, y: 0, w: 22, h: 20 } },
    { ...upper(), floorId: 'f' },
    { ...upper(), floorId: undefined },
    { ...upper(), floorElevationM: 2.9 },
    { ...upper(), walls: [wall({ id: 'u:front', baseM: 0 })] },
    { ...upper(), walls: [wall({ id: 'u:front', baseM: 3, heightM: 4 })] },
    { ...upper(), walls: [wall({ id: 'u:front', baseM: 3, start: { x: 0, y: 0 } })] },
    { ...upper(), building: { x: 19, y: 8, w: 4, h: 4 } },
    { ...upper(), obstacles: [obstacle({ id: 'f:roof' })] }
  ];
  for (const model of bad) assert.throws(() => sunlightAt([scene(), model]), /plot|heading|floorId|stacked|Wall|geometry ID/);
  assert.throws(() => sunlightAt([scene({ roofThicknessM: 0.2 }), upper()]), /upper floor base.*roof slab top/);
  assert.throws(() => sunlightAt([scene({ walls: [wall()] }), { ...upper(), walls: [wall({ baseM: 3 })] }]), /Duplicate geometry ID/);
  assert.throws(() => sunlightAt(scene({
    building: { x: 8, y: 0, w: 4, h: 4 },
    walls: [wall({ start: { x: 8, y: 0 }, end: { x: 12, y: 0 } })]
  })), /wall face.*outside the plot/);
  assert.doesNotThrow(() => sunlightAt([scene(), { ...upper(), headingDeg: 360 }]));
});

test('invalid sunlight times and vectors fail atomically before consuming chronology or exposure', () => {
  const study = physics.createSunlightStudy([scene()], { neighbors: clearNeighbors() });
  study.addInterval(sunInterval());
  const before = study.getResult();
  const valid = sunInterval(zenith, '2026-09-15T07:00:00Z', '2026-09-15T08:00:00Z');
  const invalid = [
    null, {}, { ...valid, extra: 1 },
    { ...valid, startUTC: 0 }, { ...valid, endUTC: Infinity },
    { ...valid, startUTC: '2026-09-15T07:00:00' }, { ...valid, endUTC: '2026-09-15T08:00:00+00:00' },
    { ...valid, startUTC: '2026-02-30T07:00:00Z' }, { ...valid, endUTC: '2026-09-15T24:00:00Z' },
    { ...valid, endUTC: valid.startUTC }, { ...valid, endUTC: '2026-09-15T06:00:00Z' },
    { ...valid, startUTC: '2026-09-15T06:59:59.999Z' }, sunInterval(),
    { ...valid, startUTC: '2026-09-15T07:00:00.0001Z' },
    ...[undefined, null, { east: 0, north: 0, up: 0 }, { east: 0, north: 0, up: 2 },
      { east: NaN, north: 0, up: 1 }, { east: 0, north: Infinity, up: 1 }, { east: '0', north: 0, up: 1 },
      { x: 0, y: 0, z: 1 }, { east: 0, north: 0, up: 1, altitude: 90 }
    ].map(sunENU => ({ ...valid, sunENU }))
  ];
  for (const interval of invalid) {
    assert.throws(() => study.addInterval(interval), Error);
    assert.deepEqual(study.getResult(), before);
  }
  study.addInterval({ ...valid, sunENU: { east: 0, north: 0, up: 1 + 1e-8 } });
  near(study.getResult().elapsedHours, 2);
  near(find(study.getResult(), 'f:roof').averageHours, 2);
});

test('sunlight compiles inputs once, preserves frozen data and returns independent finite JSON snapshots', () => {
  const models = [scene({ walls: [wall()], openings: [opening()] })];
  const options = { neighbors: clearNeighbors(), samplesPerAxis: 4 };
  const interval = sunInterval(north45);
  const before = JSON.stringify({ models, options, interval });
  deepFreeze(models); deepFreeze(options); deepFreeze(interval);
  const study = physics.createSunlightStudy(models, options);
  study.addInterval(interval);
  assert.equal(JSON.stringify({ models, options, interval }), before);
  const expected = study.getResult();
  const external = study.getResult();
  external.surfaces[0].normal.y = 99;
  external.surfaces[0].averageHours = 99;
  external.sampling.samplesPerAxis = 99;
  external.assumptions.length = 0;
  external.warnings.push('External mutation');
  assert.deepEqual(study.getResult(), expected);
  plainFiniteJSON(expected);

  const mutable = scene();
  const mutableOptions = { neighbors: clearNeighbors() };
  const compiled = physics.createSunlightStudy([mutable], mutableOptions);
  Object.defineProperty(mutable, 'walls', { get() { throw new Error('Geometry was read again'); } });
  mutable.headingDeg = NaN;
  mutable.building.y = -100;
  mutableOptions.neighbors.front = { state: 'unknown' };
  compiled.addInterval(sunInterval());
  near(find(compiled.getResult(), 'f:roof').averageHours, 1);
});

test('a derived ray-distance overflow rejects the interval without leaving partially accumulated hours', () => {
  const study = physics.createSunlightStudy([scene()], {
    neighbors: { ...clearNeighbors(), front: { state: 'block', heightM: 1e308, gapM: 1e308 } }
  });
  study.addInterval(sunInterval());
  const before = study.getResult();
  const direction = { east: 0.7, north: 0.01, up: Math.sqrt(1 - 0.7 ** 2 - 0.01 ** 2) };
  assert.throws(() => study.addInterval(sunInterval(direction, '2026-09-15T07:00:00Z', '2026-09-15T08:00:00Z')), /Ray\/plane.*finite numerical range/);
  assert.deepEqual(study.getResult(), before);
  study.addInterval(sunInterval(zenith, '2026-09-15T07:00:00Z', '2026-09-15T08:00:00Z'));
  near(find(study.getResult(), 'f:roof').averageHours, 2);
});

test('sunlight stays finite across large valid dimensions and durations without arbitrary dimension maxima', () => {
  const model = scene({
    floor: { x: 0, y: 0, w: 1e308, h: 1e-308 },
    building: { x: 0, y: 0, w: 1e308, h: 1e-308 }
  });
  const study = physics.createSunlightStudy([model], { neighbors: clearNeighbors() });
  study.addInterval(sunInterval(zenith, '0001-01-01T00:00:00Z', '9999-12-31T23:59:59.999Z'));
  const result = study.getResult();
  plainFiniteJSON(result);
  near(find(result, 'f:roof').averageHours, result.elapsedHours);
  assert.equal(find(result, 'f:roof').sampleCount, 64);
  near(find(result, 'f:roof').blockedHours, 0);
});

const zone = (id = 'room', volumeM3 = 30) => ({ id, volumeM3 });
const airLink = (id, from, to, pressurePa, freeAreaM2 = 0.5, cd = 0.6) => ({ id, from, to, pressurePa, freeAreaM2, cd });
const series = (pressurePa = 10, overrides = {}) => ({
  zones: [zone()], densityKgM3: 1.2, outsideId: 'outside',
  links: [airLink('in', 'outside', 'room', pressurePa), airLink('out', 'room', 'outside', 0)],
  ...overrides
});

function massBalance(input, result) {
  assert.equal(result.converged, true, result.warnings.join('\n'));
  const residuals = new Map(input.zones.map(value => [value.id, 0]));
  for (const flow of result.flows) {
    if (residuals.has(flow.from)) residuals.set(flow.from, residuals.get(flow.from) + flow.m3s);
    if (residuals.has(flow.to)) residuals.set(flow.to, residuals.get(flow.to) - flow.m3s);
    const link = input.links.find(value => value.id === flow.id);
    const dp = result.pressures[flow.from] - result.pressures[flow.to] + link.pressurePa;
    const expected = link.cd * link.freeAreaM2 * Math.sign(dp) * Math.sqrt(2 * Math.abs(dp) / (input.densityKgM3 ?? 1.2));
    near(flow.m3s, expected, Math.max(1e-12, Math.abs(expected) * 1e-13));
  }
  for (const [id, value] of residuals) {
    assert.ok(Math.abs(value) <= result.toleranceM3s * 1.01, `${id}: ${value} m3/s mass imbalance`);
    near(result.zoneResidualsM3s[id], value, 1e-12);
  }
  near(result.residualM3s, Math.max(0, ...[...residuals.values()].map(Math.abs)), 1e-12);
}

test('zero-forcing network, sealed zone and closed links have exact zero flow with explicit references', () => {
  const input = series(0);
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.deepEqual(result.flows.map(flow => flow.m3s), [0, 0]);
  assert.deepEqual(result.pressures, { outside: 0, room: 0 });
  const sealed = physics.solveAirflow({ zones: [zone('sealed')], links: [] });
  assert.equal(sealed.converged, true);
  assert.deepEqual(sealed.pressures, { outside: 0, sealed: 0 });
  assert.deepEqual(sealed.flows, []);
  assert.equal(sealed.residualM3s, 0);
  assert.match(sealed.warnings.join(' '), /Sealed zone sealed.*no leakage/);
  const closedPath = series(12);
  closedPath.links[1].freeAreaM2 = 0;
  const closed = physics.solveAirflow(closedPath);
  massBalance(closedPath, closed);
  near(closed.pressures.room, 12);
  assert.ok(closed.flows.every(flow => flow.m3s === 0));
  assert.match(closed.warnings.join(' '), /single-sided ventilation is outside/);
});

for (const pressure of [12, -12, 1e-6, -1e-6, 1e6]) {
  test(`two equal one-way restrictions have K/sqrt(2) series conductance at ${pressure} Pa`, () => {
    const input = series(pressure);
    const result = physics.solveAirflow(input);
    const k = 0.6 * 0.5;
    const expected = Math.sign(pressure) * k / Math.sqrt(2) * Math.sqrt(2 * Math.abs(pressure) / 1.2);
    near(result.pressures.room, pressure / 2);
    result.flows.forEach(flow => near(flow.m3s, expected, 1e-10));
    massBalance(input, result);
  });
}

test('unequal restrictions and three-link series agree with analytical equivalent orifice areas', () => {
  const input = series(9);
  input.links[0].freeAreaM2 = 0.25;
  input.links[1].freeAreaM2 = 0.75;
  const result = physics.solveAirflow(input);
  const k1 = 0.25 * 0.6;
  const k2 = 0.75 * 0.6;
  const equivalent = 1 / Math.sqrt(1 / (k1 * k1) + 1 / (k2 * k2));
  near(result.flows[0].m3s, equivalent * Math.sqrt(2 * 9 / 1.2), 1e-9);
  massBalance(input, result);
  const three = {
    zones: [zone('a'), zone('b')], links: [
      airLink('in', 'outside', 'a', 9), airLink('middle', 'a', 'b', 0), airLink('out', 'b', 'outside', 0)
    ]
  };
  const threeResult = physics.solveAirflow(three);
  threeResult.flows.forEach(flow => near(flow.m3s, 0.3 / Math.sqrt(3) * Math.sqrt(18 / 1.2), 2e-9));
  near(threeResult.pressures.a, 6, 1e-8);
  near(threeResult.pressures.b, 3, 1e-8);
  massBalance(three, threeResult);
});

test('branched pressure network conserves every node and reverses consistently with the forcing', () => {
  const input = {
    zones: ['a', 'b', 'c', 'd'].map(id => zone(id)),
    links: [
      airLink('in-a', 'outside', 'a', 16, 0.5), airLink('a-b', 'a', 'b', 0, 0.3),
      airLink('a-c', 'a', 'c', 0, 0.8), airLink('b-c', 'b', 'c', -1, 0.15),
      airLink('b-d', 'b', 'd', 2, 0.2), airLink('c-d', 'c', 'd', 0, 0.7),
      airLink('d-out', 'd', 'outside', 0, 0.6), airLink('b-out', 'b', 'outside', 0, 0.1)
    ]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  const reverseInput = { ...input, links: input.links.map(link => ({ ...link, pressurePa: -link.pressurePa })) };
  const reverse = physics.solveAirflow(reverseInput);
  massBalance(reverseInput, reverse);
  result.flows.forEach((flow, i) => near(reverse.flows[i].m3s, -flow.m3s, 1e-9));
  input.zones.forEach(value => near(reverse.pressures[value.id], -result.pressures[value.id], 1e-9));
});

test('reversing a link and its forcing changes only its reporting sign, not physical node pressures', () => {
  const input = series(10);
  const original = physics.solveAirflow(input);
  input.links[0] = { ...input.links[0], from: 'room', to: 'outside', pressurePa: -10 };
  const reversedLink = physics.solveAirflow(input);
  massBalance(input, reversedLink);
  near(reversedLink.pressures.room, original.pressures.room);
  near(reversedLink.flows[0].m3s, -original.flows[0].m3s);
  near(reversedLink.flows[1].m3s, original.flows[1].m3s);
});

test('closed links remain exactly zero without unnecessarily evaluating an overflowing unused pressure difference', () => {
  const input = series(1e308);
  input.links[1].freeAreaM2 = 0;
  input.links[1].pressurePa = 1e308;
  const result = physics.solveAirflow(input);
  assert.equal(result.converged, true);
  assert.equal(result.pressures.room, 1e308);
  assert.deepEqual(result.flows.map(flow => flow.m3s), [0, 0]);
  plainFiniteJSON(result);
});

test('disconnected components solve with a gauge, zero-area links do not add phantom leakage', () => {
  const input = series(8);
  input.zones.push(zone('a'), zone('b'), zone('sealed'));
  input.links.push(airLink('isolated-path', 'a', 'b', 5), airLink('closed', 'b', 'outside', 999, 0));
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  near(result.pressures.a, 0);
  near(result.pressures.b, 5);
  near(result.pressures.sealed, 0);
  result.flows.filter(flow => ['closed', 'isolated-path'].includes(flow.id)).forEach(flow => near(flow.m3s, 0));
  assert.equal(result.references.filter(reference => !reference.connectedToOutside).length, 2);
  assert.match(result.warnings.join(' '), /Disconnected component referenced to a/);
});

test('a forced closed circuit can circulate without an outside link while conserving all zone masses', () => {
  const input = {
    zones: ['a', 'b', 'c'].map(id => zone(id)),
    links: [airLink('ab', 'a', 'b', 2), airLink('bc', 'b', 'c', 2), airLink('ca', 'c', 'a', 2)]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  result.flows.forEach(flow => near(flow.m3s, 0.3 * Math.sqrt(4 / 1.2)));
  assert.equal(result.pressures.a, 0);
});

test('custom outside ID and JSON-safe zone IDs work without prototype pollution', () => {
  const input = {
    outsideId: 'ambient', zones: [zone('__proto__'), zone('constructor')],
    links: [airLink('a', 'ambient', '__proto__', 2), airLink('b', '__proto__', 'constructor', 0),
      airLink('c', 'constructor', 'ambient', 0)]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.ok(Object.hasOwn(result.pressures, '__proto__'));
  assert.equal(Object.getPrototypeOf(result.pressures), Object.prototype);
  assert.equal(result.pressures.ambient, 0);
});

test('pressure bracketing diagnoses floating-point stalling instead of inventing leakage or claiming convergence', () => {
  const input = series(1);
  input.links[0].freeAreaM2 = 1e6;
  input.links[1].freeAreaM2 = 0.01;
  const result = physics.solveAirflow(input);
  assert.equal(result.converged, false);
  assert.equal(result.status, 'stalled');
  assert.ok(result.residualM3s > result.toleranceM3s);
  assert.match(result.warnings.join(' '), /Do not treat these flows as a balanced solution/);
  plainFiniteJSON(result);
});

test('Phase 8 exact browser two-zone manual dead-end input converges without changing its tolerance', () => {
  const input = {
    outsideId: '["outside"]',
    densityKgM3: 1.2,
    zones: [
      { id: '["zone","room-2"]', volumeM3: 30 },
      { id: '["zone","room-7"]', volumeM3: 30 }
    ],
    links: [
      { id: '["link","opening-3"]', from: '["outside"]', to: '["zone","room-2"]', freeAreaM2: 0.5, cd: 0.6, pressurePa: 10 },
      { id: '["link","opening-4"]', from: '["zone","room-2"]', to: '["outside"]', freeAreaM2: 0.5, cd: 0.6, pressurePa: 0 },
      { id: '["link","manual-8"]', from: '["zone","room-2"]', to: '["zone","room-7"]', freeAreaM2: 0.5, cd: 0.6, pressurePa: 0 }
    ]
  };
  const result = physics.solveAirflow(deepFreeze(input));
  massBalance(input, result);
  assert.equal(result.status, 'converged');
  assert.equal(result.iterations, 1);
  assert.equal(result.pressures['["zone","room-2"]'], 5);
  assert.equal(result.pressures['["zone","room-7"]'], 5);
  near(result.flows[0].m3s, Math.sqrt(0.75), 1e-15);
  assert.equal(result.flows[0].m3s, result.flows[1].m3s);
  assert.equal(result.flows[2].m3s, 0);
  assert.equal(result.residualM3s, 0);
  assert.equal(result.toleranceM3s, 1e-9 + 1e-10 * (0.6 * 0.5 * Math.sqrt(2 / 1.2) * Math.sqrt(10)));
});

test('equal-orifice core with deeper signed branches is independent of leaf ordering and link orientation', () => {
  for (const sign of [1, -1]) {
    for (const reverse of [false, true]) {
      const input = series(12 * sign);
      input.zones = ['tip', 'side', 'branch', 'room'].map(id => zone(id));
      input.links.push(
        airLink('tip', 'tip', 'branch', 4 * sign),
        airLink('branch', 'room', 'branch', -2 * sign),
        airLink('side', 'room', 'side', 3 * sign)
      );
      if (reverse) input.links = input.links.map(link => ({
        ...link, from: link.to, to: link.from, pressurePa: -link.pressurePa
      })).reverse();
      const result = physics.solveAirflow(input);
      massBalance(input, result);
      assert.deepEqual(result.pressures, {
        outside: 0, tip: 0, side: 9 * sign, branch: 4 * sign, room: 6 * sign
      });
      assert.equal(result.iterations, 1);
      for (const flow of result.flows) {
        if (['in', 'out'].includes(flow.id)) near(flow.m3s, (reverse ? -1 : 1) * sign * 0.3 * Math.sqrt(10), 1e-14);
        else assert.equal(flow.m3s, 0);
      }
    }
  }
});

test('outside-rooted forced tree back-substitutes every branch even with no active core edges', () => {
  const input = {
    zones: ['tip', 'left', 'right', 'hub'].map(id => zone(id)),
    links: [
      airLink('tip', 'right', 'tip', 5), airLink('left', 'left', 'hub', 3),
      airLink('right', 'hub', 'right', -2), airLink('root', 'outside', 'hub', 4),
      airLink('closed-cycle', 'tip', 'outside', 999, 0)
    ]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.deepEqual(result.pressures, { outside: 0, tip: 7, left: 1, right: 2, hub: 4 });
  assert.ok(result.flows.every(flow => flow.m3s === 0));
  assert.equal(result.iterations, 1);
  assert.deepEqual(result.references, [{ id: 'outside', pressurePa: 0, connectedToOutside: true }]);
});

test('tolerance uses original zero-pressure flows including the largest peeled-branch forcing', () => {
  const input = series(10);
  input.zones.push(zone('leaf'));
  input.links.push(airLink('leaf', 'room', 'leaf', 1024));
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.equal(result.pressures.leaf, 1029);
  const initialFlowScale = 0.6 * 0.5 * Math.sqrt(2 / 1.2) * Math.sqrt(1024);
  assert.equal(result.toleranceM3s, 1e-9 + 1e-10 * initialFlowScale);
  assert.equal(result.flows[2].m3s, 0);
});

test('disconnected forced tree preserves its first-listed reference in the middle and isolated gauges', () => {
  const input = {
    zones: ['gauge', 'left', 'right', 'tip', 'sealed'].map(id => zone(id)),
    links: [
      airLink('left', 'left', 'gauge', -4),
      airLink('right', 'gauge', 'right', -2),
      airLink('tip', 'right', 'tip', -3),
      airLink('closed-outside', 'tip', 'outside', 100, 0)
    ]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.deepEqual(result.pressures, { outside: 0, gauge: 0, left: 4, right: -2, tip: -5, sealed: 0 });
  assert.ok(result.flows.every(flow => flow.m3s === 0));
  assert.deepEqual(result.references, [
    { id: 'gauge', pressurePa: 0, connectedToOutside: false },
    { id: 'sealed', pressurePa: 0, connectedToOutside: false }
  ]);
});

test('disconnected forced cycle retains circulation with several peeled branches and an unchanged gauge', () => {
  const input = {
    zones: ['a', 'tip', 'b', 'left', 'c', 'right'].map(id => zone(id)),
    links: [
      airLink('ab', 'a', 'b', 2), airLink('bc', 'b', 'c', 2), airLink('ca', 'c', 'a', 2),
      airLink('left', 'left', 'b', -4), airLink('tip', 'tip', 'left', 3),
      airLink('right', 'c', 'right', -2)
    ]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.deepEqual(result.pressures, { outside: 0, a: 0, tip: 1, b: 0, left: 4, c: 0, right: -2 });
  result.flows.slice(0, 3).forEach(flow => near(flow.m3s, 0.3 * Math.sqrt(4 / 1.2)));
  assert.ok(result.flows.slice(3).every(flow => flow.m3s === 0));
  assert.deepEqual(result.references, [{ id: 'a', pressurePa: 0, connectedToOutside: false }]);
});

test('parallel internal links are distinct cycle edges, not a peelable single neighbour', () => {
  const input = {
    zones: ['a', 'b', 'leaf'].map(id => zone(id)),
    links: [
      airLink('forward', 'a', 'b', 12), airLink('return', 'b', 'a', 0),
      airLink('leaf', 'b', 'leaf', -2)
    ]
  };
  const result = physics.solveAirflow(input);
  massBalance(input, result);
  assert.deepEqual(result.pressures, { outside: 0, a: 0, b: 6, leaf: 4 });
  result.flows.slice(0, 2).forEach(flow => near(flow.m3s, 0.3 * Math.sqrt(10)));
  assert.equal(result.flows[2].m3s, 0);
});

test('peeled leaves preserve raw floating-point cancellation failures instead of snapping flows to zero', () => {
  for (const reverse of [false, true]) {
    const input = series(10);
    input.zones.push(zone('leaf'));
    input.links.push(reverse
      ? airLink('leaf', 'leaf', 'room', -0.1)
      : airLink('leaf', 'room', 'leaf', 0.1));
    const result = physics.solveAirflow(input);
    assert.equal(result.converged, false);
    assert.equal(result.status, 'stalled');
    assert.equal(result.pressures.room, 5);
    assert.equal(result.pressures.leaf, 5.1);
    const link = input.links[2];
    const dp = result.pressures[link.from] - result.pressures[link.to] + link.pressurePa;
    const flow = 0.6 * 0.5 * Math.sqrt(2 / 1.2) * Math.sign(dp) * Math.sqrt(Math.abs(dp));
    assert.equal(result.flows[2].m3s, flow);
    assert.ok(Math.abs(flow) > result.toleranceM3s);
    assert.equal(result.residualM3s, Math.abs(flow));
    assert.equal(Math.abs(result.zoneResidualsM3s.leaf), Math.abs(flow));
    assert.match(result.warnings.join(' '), /Do not treat these flows as a balanced solution/);
    plainFiniteJSON(result);
  }
});

test('a dead-end does not hide the existing extreme-coefficient core failure', () => {
  const input = series(1);
  input.links[0].freeAreaM2 = 1e6;
  input.links[1].freeAreaM2 = 0.01;
  const core = physics.solveAirflow(input);
  input.zones.push(zone('leaf'));
  input.links.push(airLink('leaf', 'room', 'leaf', 0));
  const result = physics.solveAirflow(input);
  assert.equal(result.status, 'stalled');
  assert.equal(result.converged, false);
  assert.equal(result.pressures.room, core.pressures.room);
  assert.equal(result.residualM3s, core.residualM3s);
  assert.equal(result.toleranceM3s, core.toleranceM3s);
  assert.equal(result.flows[2].m3s, 0);
});

test('closed-only graphs remain isolated and validate every link before numerical solving', () => {
  const closed = {
    zones: ['a', 'b'].map(id => zone(id)),
    links: [airLink('closed', 'a', 'b', 10, 0)]
  };
  const result = physics.solveAirflow(closed);
  massBalance(closed, result);
  assert.equal(result.iterations, 0);
  assert.deepEqual(result.pressures, { outside: 0, a: 0, b: 0 });
  assert.equal(result.references.length, 2);
  closed.links[0].cd = 0;
  assert.throws(() => physics.solveAirflow(closed), /cd/);
  const tree = {
    zones: ['a', 'b'].map(id => zone(id)),
    links: [
      airLink('root', 'outside', 'a', 1e308),
      airLink('overflow', 'a', 'b', 1e308),
      airLink('invalid', 'b', 'outside', NaN, 0)
    ]
  };
  assert.throws(() => physics.solveAirflow(tree), /links\[2\].pressurePa/);
  const underflow = { zones: [zone()], links: [airLink('tiny', 'outside', 'room', 1, Number.MIN_VALUE, Number.MIN_VALUE)] };
  assert.throws(() => physics.solveAirflow(underflow), /coefficient underflows/);
});

test('airflow rejects malformed links, NaNs, invalid coefficients and unsupported two-way/CFD requests', () => {
  const mutations = [
    value => { value.zones[0].volumeM3 = 0; },
    value => { value.zones[0].id = 'outside'; },
    value => { value.zones.push(zone()); },
    value => { value.densityKgM3 = 0; },
    value => { value.densityKgM3 = NaN; },
    value => { value.links[0].id = 'out'; },
    value => { value.links[0].to = 'missing'; },
    value => { value.links[0].to = 'outside'; },
    value => { value.links[0].freeAreaM2 = -1; },
    value => { value.links[0].freeAreaM2 = Infinity; },
    value => { value.links[0].cd = 0; },
    value => { value.links[0].cd = 1.1; },
    value => { value.links[0].cd = undefined; },
    value => { value.links[0].pressurePa = NaN; },
    value => { value.links[0].pressurePa = '10'; },
    value => { value.links[0].pressurePa = undefined; },
    value => { value.links[0].type = 'two-way'; },
    value => { value.model = 'CFD'; }
  ];
  for (const mutate of mutations) {
    const input = series();
    mutate(input);
    assert.throws(() => physics.solveAirflow(input), Error);
  }
});

const thermalZone = (id = 'room', overrides = {}) => ({
  id, capacityJ_K: 100000, initialC: 20, outsideConductanceW_K: 100, ...overrides
});
const thermalInput = overrides => ({
  zones: [thermalZone()], links: [],
  steps: [{ durationSeconds: 100, outdoorC: 30, gainsW: { room: 0 } }], ...overrides
});

test('backward Euler matches its closed form and approaches the continuous single-zone RC solution with a proven bound', () => {
  const duration = 1000;
  const tau = 1000;
  const continuous = 30 - 10 * Math.exp(-duration / tau);
  const errors = [];
  for (const dt of [100, 50, 25]) {
    const input = thermalInput({
      steps: Array.from({ length: duration / dt }, () => ({ durationSeconds: dt, outdoorC: 30, gainsW: { room: 0 } }))
    });
    const result = physics.simulateThermal(input);
    const final = result.samples.at(-1);
    near(final.elapsedSeconds, duration);
    const backwardEuler = 30 - 10 * (1 + dt / tau) ** (-duration / dt);
    near(final.temperaturesC.room, backwardEuler, 1e-11);
    const error = Math.abs(final.temperaturesC.room - continuous);
    const bound = 10 * Math.exp(-duration / tau) * Math.expm1(duration / tau * (dt / tau) / 2);
    assert.ok(error <= bound + 1e-11, `${error} > first-order refinement bound ${bound}`);
    errors.push(error);
    assert.ok(Math.abs(result.energyResidualJ) < 1e-7);
    assert.ok(result.maxZoneEnergyResidualJ < 1e-7);
    assert.equal(result.samples.length, duration / dt + 1);
  }
  assert.ok(errors[1] < 0.55 * errors[0]);
  assert.ok(errors[2] < 0.55 * errors[1]);
});

test('large implicit timesteps remain stable and do not overshoot a fixed exterior temperature', () => {
  const result = physics.simulateThermal(thermalInput({
    steps: [{ durationSeconds: 1e9, outdoorC: 30, gainsW: { room: 0 } }]
  }));
  const value = result.samples[1].temperaturesC.room;
  assert.ok(value > 20 && value < 30);
  near(value, 30 - 10 / (1 + 1e6), 1e-12);
  plainFiniteJSON(result);
});

test('adiabatic, no-gain equal-temperature multi-zone state stays exactly constant', () => {
  const input = {
    zones: [thermalZone('a', { initialC: 23, outsideConductanceW_K: 0 }),
      thermalZone('b', { initialC: 23, capacityJ_K: 230000, outsideConductanceW_K: 0 })],
    links: [{ from: 'a', to: 'b', conductanceW_K: 400 }],
    steps: [1, 60, 86400].map(durationSeconds => ({ durationSeconds, outdoorC: 50, gainsW: { a: 0, b: 0 } }))
  };
  const result = physics.simulateThermal(input);
  result.samples.forEach(value => assert.deepEqual(value.temperaturesC, { a: 23, b: 23 }));
  assert.equal(result.energyResidualJ, 0);
  assert.equal(result.maxZoneEnergyResidualJ, 0);
});

test('isolated supplied heat produces exactly Q*dt/C, with no covert solar or air Cp gains', () => {
  const input = thermalInput({
    zones: [thermalZone('room', { capacityJ_K: 2000, initialC: 10, outsideConductanceW_K: 0 })],
    steps: [{ durationSeconds: 300, outdoorC: -20, gainsW: { room: 100 } },
      { durationSeconds: 200, outdoorC: 80, gainsW: { room: -100 } }]
  });
  const result = physics.simulateThermal(input);
  near(result.samples[1].temperaturesC.room, 25);
  near(result.samples[2].temperaturesC.room, 15);
  near(result.energyBalances[0].storedEnergyChangeJ, 30000);
  near(result.energyBalances[0].gainsEnergyJ, 30000);
  near(result.energyBalances[0].outdoorEnergyJ, 0);
  near(result.energyBalances[1].storedEnergyChangeJ, -20000);
  near(result.energyResidualJ, 0);
  assert.match(result.warnings.join(' '), /No automatic solar gains, air heat capacity/);
});

test('interzone transfer is equal and opposite, agreeing with the analytic two-capacity difference mode', () => {
  const input = {
    zones: [thermalZone('hot', { capacityJ_K: 10000, initialC: 40, outsideConductanceW_K: 0 }),
      thermalZone('cold', { capacityJ_K: 20000, initialC: 10, outsideConductanceW_K: 0 })],
    links: [{ from: 'hot', to: 'cold', conductanceW_K: 100 }],
    steps: [{ durationSeconds: 60, outdoorC: 5, gainsW: { hot: 0, cold: 0 } }]
  };
  const result = physics.simulateThermal(input);
  const final = result.samples[1].temperaturesC;
  const difference = 30 / (1 + 100 * 60 * (1 / 10000 + 1 / 20000));
  const transfer = 100 * 60 * difference;
  near(final.hot, 40 - transfer / 10000);
  near(final.cold, 10 + transfer / 20000);
  near(final.hot - final.cold, difference);
  near(10000 * final.hot + 20000 * final.cold, 10000 * 40 + 20000 * 10, 1e-8);
  near(result.energyBalances[0].interzoneTransfers[0].energyJ, transfer, 1e-8);
  near(result.energyResidualJ, 0, 1e-8);
  assert.ok(result.maxZoneEnergyResidualJ < 1e-8);
  const reordered = physics.simulateThermal({ ...input, zones: [...input.zones].reverse() });
  near(reordered.samples[1].temperaturesC.hot, final.hot);
  near(reordered.samples[1].temperaturesC.cold, final.cold);
});

test('thermal ledger uses the actual backward-Euler final temperatures, gains, outside fluxes and shared transfers', () => {
  const input = {
    zones: [thermalZone('a', { capacityJ_K: 12345, initialC: 17, outsideConductanceW_K: 21 }),
      thermalZone('b', { capacityJ_K: 67890, initialC: 31, outsideConductanceW_K: 13 })],
    links: [{ from: 'a', to: 'b', conductanceW_K: 7 }, { from: 'a', to: 'b', conductanceW_K: 3 }],
    steps: [{ durationSeconds: 123, outdoorC: 5, gainsW: { a: 120, b: -30 } },
      { durationSeconds: 567, outdoorC: 34, gainsW: { a: 0, b: 90 } }]
  };
  const result = physics.simulateThermal(input);
  let signedResidual = 0;
  input.steps.forEach((step, index) => {
    const before = result.samples[index].temperaturesC;
    const after = result.samples[index + 1].temperaturesC;
    const balance = result.energyBalances[index];
    let stored = 0;
    let external = 0;
    let gain = 0;
    input.zones.forEach(value => {
      stored += value.capacityJ_K * (after[value.id] - before[value.id]);
      external += step.durationSeconds * value.outsideConductanceW_K * (step.outdoorC - after[value.id]);
      gain += step.durationSeconds * step.gainsW[value.id];
    });
    near(balance.storedEnergyChangeJ, stored, 1e-8);
    near(balance.outdoorEnergyJ, external, 1e-8);
    near(balance.gainsEnergyJ, gain, 1e-8);
    near(balance.residualJ, stored - external - gain, 1e-8);
    balance.interzoneTransfers.forEach((transfer, i) => {
      near(transfer.energyJ, step.durationSeconds * input.links[i].conductanceW_K * (after.a - after.b), 1e-8);
    });
    signedResidual += balance.residualJ;
  });
  near(result.energyResidualJ, signedResidual, 1e-8);
  assert.ok(result.maxZoneEnergyResidualJ < 1e-7);
});

test('timestamped thermal steps are contiguous UTC interval starts, including leap-day and variable duration', () => {
  const input = thermalInput({
    steps: [
      { timestamp: '2024-02-29T23:30:00Z', durationSeconds: 1800, outdoorC: 20, gainsW: { room: 0 } },
      { timestamp: '2024-03-01T00:00:00Z', durationSeconds: 900, outdoorC: 20, gainsW: { room: 0 } }
    ]
  });
  const result = physics.simulateThermal(input);
  assert.deepEqual(result.samples.map(value => value.elapsedSeconds), [0, 1800, 2700]);
  assert.deepEqual(result.samples.map(value => value.timestamp), [
    '2024-02-29T23:30:00.000Z', '2024-03-01T00:00:00.000Z', '2024-03-01T00:15:00.000Z'
  ]);
  for (const timestamp of ['2024-03-01T00:01:00Z', '2024-02-29T23:59:00Z', '2024-02-30T00:00:00Z', '2024-03-01T05:30:00+05:30']) {
    const invalid = clone(input);
    invalid.steps[1].timestamp = timestamp;
    assert.throws(() => physics.simulateThermal(invalid), /contiguous|calendar|UTC/);
  }
  const mixed = clone(input);
  delete mixed.steps[1].timestamp;
  assert.throws(() => physics.simulateThermal(mixed), /every thermal step/);
  const fractional = clone(input);
  fractional.steps = [{ ...fractional.steps[0], durationSeconds: 0.0005 }];
  assert.throws(() => physics.simulateThermal(fractional), /milliseconds/);
});

test('thermal initial state without timesteps is explicit and has no hidden warmup', () => {
  const result = physics.simulateThermal(thermalInput({ steps: [] }));
  assert.deepEqual(result.samples, [{ elapsedSeconds: 0, temperaturesC: { room: 20 } }]);
  assert.equal(result.energyResidualJ, 0);
  assert.match(result.warnings.join(' '), /No warmup is performed/);
  assert.match(result.warnings.join(' '), /No thermal intervals/);
});

test('unrepresentably small temperature changes retain their real nonzero energy residual and warn', () => {
  const input = thermalInput({
    zones: [thermalZone('room', { capacityJ_K: 1e20, outsideConductanceW_K: 0 })],
    steps: [{ durationSeconds: 1, outdoorC: 20, gainsW: { room: 1 } }]
  });
  const result = physics.simulateThermal(input);
  assert.equal(result.samples[1].temperaturesC.room, 20);
  assert.equal(result.energyResidualJ, -1);
  assert.equal(result.maxZoneEnergyResidualJ, 1);
  assert.match(result.warnings.join(' '), /energy-balance accuracy is unresolved.*not a balanced thermal solution/);
});

test('thermal solver rejects missing capacities/gains, nonphysical scales and unsupported coupling instead of guessing', () => {
  const mutations = [
    value => { value.zones[0].capacityJ_K = 0; },
    value => { value.zones[0].capacityJ_K = -10; },
    value => { value.zones[0].capacityJ_K = undefined; },
    value => { value.zones[0].capacityJ_K = NaN; },
    value => { value.zones[0].outsideConductanceW_K = -1; },
    value => { value.zones[0].initialC = null; },
    value => { value.zones[0].initialC = -274; },
    value => { value.zones.push(thermalZone()); },
    value => { value.links = [{ from: 'room', to: 'unknown', conductanceW_K: 10 }]; },
    value => { value.links = [{ from: 'room', to: 'room', conductanceW_K: 10 }]; },
    value => { value.steps[0].durationSeconds = 0; },
    value => { value.steps[0].durationSeconds = Infinity; },
    value => { value.steps[0].outdoorC = NaN; },
    value => { value.steps[0].gainsW = {}; },
    value => { value.steps[0].gainsW.room = NaN; },
    value => { value.steps[0].gainsW.room = '100'; },
    value => { value.steps[0].gainsW.other = 0; },
    value => { value.steps[0].solarBonusC = 2; },
    value => { value.airflowM3s = 1; },
    value => { value.zones[0].capacityJ_K = 1e-308; value.steps[0].durationSeconds = 1e308; }
  ];
  for (const mutate of mutations) {
    const input = thermalInput();
    mutate(input);
    assert.throws(() => physics.simulateThermal(input), Error);
  }
  assert.throws(() => physics.simulateThermal({
    zones: [thermalZone('a', { capacityJ_K: 1e-300, outsideConductanceW_K: 0 }),
      thermalZone('b', { capacityJ_K: 1e-300, outsideConductanceW_K: 0 })],
    links: [{ from: 'a', to: 'b', conductanceW_K: 1e300 }],
    steps: [{ durationSeconds: 1, outdoorC: 20, gainsW: { a: 0, b: 0 } }]
  }), /ill-conditioned/);
});

test('all APIs preserve frozen inputs and return only JSON-safe finite outputs', () => {
  const calls = [
    [physics.assemblyProperties, [[material()], { inside: 0.13, outside: 0.04 }]],
    [physics.shadowAt, [apertureScene(), north45, { samplesPerAxis: 4 }]],
    [physics.surfaceExposure, [scene({ walls: [wall()] }), north45, { dniWm2: 800, dhiWm2: 100, ghiWm2: 600 }]],
    [physics.solveAirflow, [series(8)]],
    [physics.simulateThermal, [thermalInput()]]
  ];
  for (const [fn, inputs] of calls) {
    const before = JSON.stringify(inputs);
    inputs.forEach(deepFreeze);
    const result = fn(...inputs);
    assert.equal(JSON.stringify(inputs), before);
    plainFiniteJSON(result);
  }
});
