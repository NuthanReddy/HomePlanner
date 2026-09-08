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

test('CommonJS and browser IIFE expose exactly the frozen pure numerical functions', () => {
  const names = ['assemblyProperties', 'shadowAt', 'surfaceExposure', 'solveAirflow', 'simulateThermal'];
  assert.deepEqual(Object.keys(physics), names);
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'building-physics.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.BuildingPhysics), names);
  assert.equal(Object.isFrozen(context.BuildingPhysics), true);
  near(context.BuildingPhysics.assemblyProperties([material()]).resistanceM2K_W, 0.67);
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
