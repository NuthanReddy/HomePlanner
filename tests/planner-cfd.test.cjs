const test = require('node:test');
const assert = require('node:assert/strict');
const CFD = require('../planner-cfd.js');
const Projection = require('../planner-projection.js');
const UI = require('../planner-cfd-ui.js');
const { project, inputs, clone } = require('./fixtures/planner-cfd-fixtures.cjs');
const drawing = () => Projection.build(project());
const inspect = d => CFD.inspect(d, 'ground', 'ground:bathroom');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('CFD captures the real registered inner wall faces and preserves carpet, plot origin and source IDs', () => {
  const d = drawing(), before = JSON.stringify(d), inventory = inspect(d);
  assert.deepEqual(inventory.findings, []);
  assert.equal(inventory.geometry.coordinateSpace, 'site-local');
  near(inventory.geometry.rect.x, 6.05); near(inventory.geometry.rect.y, 6.05);
  near(inventory.geometry.rect.w, 4.25); near(inventory.geometry.rect.h, 3.25);
  near(inventory.geometry.sourceRoomRect.w, 4.2); near(inventory.geometry.sourceRoomRect.h, 3.2);
  near(inventory.geometry.floorElevationM, .45); near(inventory.geometry.heightM, 2.8);
  assert.equal(inventory.source.roomId, 'ground:bathroom');
  assert.equal(inventory.source.inputFingerprint, d.inputFingerprint);
  assert.equal(inventory.geometry.walls.length, 4);
  const door = inventory.geometry.openings.find(row => row.id === 'ground:bathroom-access');
  near(door.offsetM, .65); near(door.widthM, .8);
  assert.equal(door.adjacent, 'adjacent-room');
  assert.equal(inventory.geometry.openings.find(row => row.kind === 'window').adjacent, 'outside');
  assert.equal(JSON.stringify(d), before);
  assert.ok(Object.isFrozen(inventory.geometry.openings[0]));
  assert.match(inventory.notes.join(' '), /actual inner wall faces/);
});

test('missing plot, wrong frame, absent room and service outlines cannot become a sample enclosure', () => {
  assert.throws(() => CFD.inspect({ kind: 'scene' }, 'ground', 'a'), /DrawingScene/);
  const d = clone(drawing());
  assert.equal(CFD.inspect(d, 'absent', 'a').geometry, null);
  assert.equal(CFD.inspect(d, 'ground', 'absent').geometry, null);
  d.scenes[0].coordinateSpace = 'floor-local';
  assert.throws(() => inspect(d), /site-local/);
  d.scenes[0].coordinateSpace = 'site-local';
  d.scenes[0].rooms.find(row => row.id === 'ground:bathroom').service = true;
  assert.match(inspect(d).findings.join(' '), /Lift and stair/);
});

test('reservations including an empty usableRegions array are never replaced by the carpet rectangle', () => {
  for (const regions of [[], [{ x: 6.05, y: 6.05, w: 2, h: 3.2 }]]) {
    const d = clone(drawing()), room = d.scenes[0].rooms.find(row => row.id === 'ground:bathroom');
    room.usableRegions = regions;
    assert.match(inspect(d).findings.join(' '), /reserved or excluded/);
    assert.throws(() => CFD.request(inspect(d), inputs(inspect(d).geometry)), /bounding box/);
  }
});

test('missing enclosure, stepped thickness, gaps, obstacles and unresolved apertures block preparation', () => {
  const base = clone(drawing());
  const chosen = base.scenes[0].walls.find(w => w.roomIds.includes('ground:bathroom') && !w.openings.length);
  const removed = clone(base); removed.scenes[0].walls = removed.scenes[0].walls.filter(w => w.id !== chosen.id);
  assert.match(inspect(removed).findings.join(' '), /no resolved enclosing wall/);
  const gap = clone(base), wall = gap.scenes[0].walls.find(w => w.id === chosen.id);
  wall.start.y += .5;
  assert.match(inspect(gap).findings.join(' '), /gap|span/);
  const obstacle = clone(base);
  obstacle.scenes[0].obstacles.push({ x: 7, y: 7, w: .5, h: .5, baseM: .45, heightM: 1 });
  assert.match(inspect(obstacle).findings.join(' '), /obstacle/);
  const unknown = clone(base); unknown.scenes[0].unresolvedOpenings.push({ id: 'missing' });
  assert.match(inspect(unknown).findings.join(' '), /unresolved opening/);
});

test('a beam crossing the room is not omitted just because both anchors are outside it', () => {
  const d = clone(drawing()), { rect } = inspect(d).geometry;
  d.authored.push({ floorId: 'ground', collection: 'structural', record: { kind: 'beam', widthM: .2, depthM: .4 },
    anchorStatus: 'resolved', anchors: [
      { point: { x: rect.x - 1, y: rect.y + 1, z: 2 } },
      { point: { x: rect.x + rect.w + 1, y: rect.y + 1, z: 2 } }
    ] });
  assert.match(inspect(d).findings.join(' '), /authored structural/);
});

test('fractional operation blocks; unknown adjacency is not outside; full-wall apertures survive removed masonry', () => {
  const d = clone(drawing()), f = d.scenes[0], opening = f.openings.find(row => row.id === 'ground:bathroom-window');
  opening.openFraction = .25;
  assert.match(inspect(d).findings.join(' '), /partly open/);
  opening.openFraction = 1;
  const wall = f.walls.find(w => w.id === opening.wallId);
  wall.removed = true;
  assert.doesNotMatch(inspect(d).findings.join(' '), /removed masonry/);
  wall.roomIds.push('missing-room');
  assert.equal(inspect(d).geometry.openings.find(row => row.id === opening.id).adjacent, 'unknown');
  assert.match(inspect(d).notes.join(' '), /not inferred outdoor air/);
});

test('physical fingerprint changes with height/opening/geometry but not labels, revisions or unrelated presentation', () => {
  const d = clone(drawing()), original = inspect(d);
  d.revision++; d.inputFingerprint += 'presentation-only';
  d.scenes[0].rooms.find(row => row.id === 'ground:bathroom').label = 'Renamed';
  assert.equal(inspect(d).geometryFingerprint, original.geometryFingerprint);
  d.scenes[0].openings.find(row => row.id === 'ground:bathroom-window').openFraction = 1;
  assert.notEqual(inspect(d).geometryFingerprint, original.geometryFingerprint);
});

test('payload conversion leaves unknowns null and converts only explicit inputs, with a separate absolute pressure', () => {
  const inventory = inspect(drawing()), form = CFD.draft(inventory.geometry);
  assert.equal(form.air.pressurePa, null);
  assert.equal(form.solid.conductivityWmK, null);
  assert.throws(() => CFD.request(inventory, form), /required/);
  const filled = inputs(inventory.geometry); filled.air.pressurePa = '95000';
  const req = CFD.request(inventory, filled);
  assert.equal(req.scenario.air.pressurePa, 95000);
  assert.equal(filled.air.pressurePa, '95000');
  assert.equal(req.scenario.openings[0].gaugePressurePa, null);
  assert.equal(req.source.roomId, 'ground:bathroom');
  assert.equal(req.profile, CFD.PROFILE);
  for (const bad of [NaN, Infinity, true, 'abc']) {
    const broken = clone(filled); broken.air.initialC = bad;
    assert.throws(() => CFD.request(inventory, broken), /finite|decimal/);
  }
});

test('inlet/outlet and closed conditions must match actual opening operation and require all physical inputs', () => {
  const d = clone(drawing()), target = d.scenes[0].openings.find(o => o.id === 'ground:bathroom-window');
  target.openFraction = 1;
  const inventory = inspect(d), form = inputs(inventory.geometry), row = form.openings.find(o => o.id === target.id);
  assert.throws(() => CFD.request(inventory, form), /Choose an inlet/);
  row.mode = 'inlet'; row.speedMps = .1;
  assert.throws(() => CFD.request(inventory, form), /also needs a pressure outlet/);
  row.mode = 'outlet'; row.gaugePressurePa = 0;
  assert.equal(CFD.request(inventory, form).scenario.openings.find(o => o.id === target.id).speedMps, null);
  row.mode = 'closed';
  assert.throws(() => CFD.request(inventory, form), /saved operating state/);
});

test('sampling plane is height resolved, bounded and cannot produce fabricated result colors', () => {
  const inventory = inspect(drawing()), form = inputs(inventory.geometry);
  form.sampling.heightM = inventory.geometry.heightM;
  assert.throws(() => CFD.request(inventory, form), /strictly inside/);
  form.sampling.heightM = 1; form.sampling.columns = 64; form.sampling.rows = 64;
  assert.throws(() => CFD.request(inventory, form), /512/);
  const svg = UI.plotSvg(inventory.geometry);
  assert.match(svg, /no CFD result/); assert.doesNotMatch(svg, /<circle|hsl/);
  assert.equal(UI.bearingSide('N', { headingDeg: 90 }), 'E');
  assert.equal(UI.bearingSide('W', { headingDeg: 270 }), 'S');
});

test('UI ranges match the pinned physical profile and reject nonpositive gas heat capacity', () => {
  const inventory = inspect(drawing()), form = inputs(inventory.geometry);
  form.air.cpJkgK = 100;
  assert.throws(() => CFD.request(inventory, form), /positive Cv/);
  form.air.cpJkgK = 1006; form.floorThicknessM = .01;
  assert.throws(() => CFD.request(inventory, form), /between 0.02 and 1/);
  form.floorThicknessM = .15; form.sampling.heightM = inventory.geometry.heightM - .001;
  assert.throws(() => CFD.request(inventory, form), /at least 0.005/);
  assert.match(CFD.FIELDS.find(field => field.path === 'numerics.deltaTSeconds').label, /Fixed time/);
});
