'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Field = require('../planner-airflow-field.js'), Regions = require('../planner-regions.js'), A = require('../planner-airflow.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function channel(flow = 1) {
  const ref = { floorId: 'ground', entityId: 'room' }, rect = { x: 0, y: 0, w: 4, h: 2 };
  const opening = (id, x, from, to) => ({ id, kind: 'opening', openingRef: { floorId: 'ground', entityId: id },
    from, to, m3s: flow, geometry: { start: { x, y: 0 }, end: { x, y: 2 }, wallThicknessM: .2 } });
  const links = [opening('in', 0, 'outside', 'room'), opening('out', 4, 'room', 'outside')];
  return { kind: 'AirflowResult', version: 1, status: 'converged', balanced: true, solver: { converged: true },
    provenance: { inputFingerprint: 'analytical-channel' }, zones: [{ id: 'room', roomRef: ref, volumeM3: 16,
      geometry: { rect, usableRegions: [rect] } }], flowResults: links,
    inventory: { openings: links.map(link => ({ ref: link.openingRef })) } };
}
const run = (network, spacingM = .5) => Field.run(network, { enabled: true, spacingM });

test('finite-volume channel matches Q/(depth × width), preserves flux and exposes its non-CFD assumptions', () => {
  const network = channel(), before = JSON.stringify(network), field = run(network);
  assert.equal(field.status, 'complete', JSON.stringify(field.findings));
  assert.equal(field.cells.length, 32);
  for (const cell of field.cells) {
    near(cell.velocityMps.x, .25); near(cell.velocityMps.y, 0);
    near(cell.speedMps, .25); near(cell.conservationResidualM3s, 0);
  }
  assert.ok(field.assumptions.some(text => /not validated CFD/.test(text)));
  assert.equal(field.rooms[0].modelDepthM, 2);
  assert.equal(field.rooms[0].usableAreaM2, 8);
  assert.equal(field.units, 'm/s');
  assert.ok(Object.isFrozen(field.cells[0].velocityMps));
  assert.equal(JSON.stringify(network), before);
});
test('reversal flips every vector without fabricating a different speed field', () => {
  const forward = run(channel()), reverse = run(channel(-1));
  assert.equal(reverse.status, 'complete');
  reverse.cells.forEach((cell, i) => {
    near(cell.speedMps, forward.cells[i].speedMps);
    near(cell.velocityMps.x, -forward.cells[i].velocityMps.x);
    near(cell.velocityMps.y, -forward.cells[i].velocityMps.y);
  });
});
test('small nonzero flows are solved rather than painted as a thresholded zero', () => {
  const field = run(channel(1e-12));
  assert.equal(field.status, 'complete', JSON.stringify(field.findings));
  for (const cell of field.cells) near(cell.speedMps, 2.5e-13, 1e-20);
});
test('closed zero forcing yields a genuine zero field, whereas missing/nonconverged inputs stay unavailable', () => {
  const zero = run(channel(0));
  assert.equal(zero.status, 'complete');
  assert.ok(zero.cells.every(cell => cell.speedMps === 0));
  const unavailable = channel(); unavailable.status = 'nonconverged'; unavailable.balanced = false;
  assert.equal(run(unavailable).status, 'unavailable');
  assert.deepEqual(run(unavailable).cells, []);
  assert.equal(Field.run(channel(), { enabled: true, spacingM: null }).status, 'unavailable');
});
test('reserved lift footprint clips the mesh and changes the solved field without losing usable area or crossing solids', () => {
  const network = channel(), cut = { x: 1.5, y: .5, w: 1, h: 1 };
  network.zones[0].geometry.usableRegions = Regions.subtractRectangle(network.zones[0].geometry.rect, [cut]);
  network.zones[0].volumeM3 = 14;
  const field = run(network, .25);
  assert.equal(field.status, 'complete', JSON.stringify(field.findings));
  near(field.cells.reduce((area, cell) => area + cell.rect.w * cell.rect.h, 0), 7);
  assert.ok(field.cells.every(cell => Regions.intersection(cell.rect, cut) === null));
  assert.ok(field.cells.some(cell => Math.abs(cell.velocityMps.y) > .01));
  assert.ok(field.cells.every(cell => Math.abs(cell.conservationResidualM3s) < 1e-7));
});
test('disconnected forced regions and manual ports never become a fake through-wall velocity field', () => {
  const disconnected = channel();
  disconnected.zones[0].geometry.usableRegions = Regions.subtractRectangle(disconnected.zones[0].geometry.rect,
    [{ x: 1.5, y: 0, w: 1, h: 2 }]);
  const result = run(disconnected);
  assert.equal(result.status, 'unavailable');
  assert.match(result.findings[0].message, /disconnected usable air region/);
  const manual = channel(); manual.flowResults[0].kind = 'manual';
  assert.equal(run(manual).status, 'unavailable');
  assert.match(run(manual).findings[0].message, /manual connection/);
});
test('mesh budgets and incompatible aperture position are reported instead of coarsening or moving inputs', () => {
  const network = channel(), result = run(network, 1e-6);
  assert.equal(result.status, 'unavailable'); assert.equal(result.spacingM, 1e-6);
  assert.match(result.findings[0].message, /coordinate budget/);
  network.flowResults[0].geometry.start.x = network.flowResults[0].geometry.end.x = -5;
  assert.equal(run(network).status, 'unavailable');
  assert.match(run(network).findings[0].message, /does not map uniquely/);
});
test('a physical interior wall absent from the supplied air-region partition is not crossed by a guessed field', () => {
  const network = channel();
  network.inventory.walls = [{ ref: { floorId: 'ground', entityId: 'partition' }, removed: false,
    start: { x: 2, y: 0 }, end: { x: 2, y: 2 }, thicknessM: .1 }];
  const field = run(network);
  assert.equal(field.status, 'unavailable'); assert.deepEqual(field.cells, []);
  assert.match(field.findings[0].message, /will not pass through it/);
});
test('real projected apertures drive the worker-ready optional field, including supplied wall/carpet allowances', () => {
  const project = createFixture('furnished-single').project, floor = project.floors[0];
  floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
  for (const opening of [...floor.legacy.context.plan.openings.doors, ...floor.legacy.context.plan.openings.windows])
    opening.openFraction = 1;
  floor.doorEdits = {}; floor.windowEdits = {}; project.doorEdits = {}; project.windowEdits = {};
  project.legacy = copy(floor.legacy);
  const ref = id => ({ floorId: 'ground', entityId: `ground:${id}` });
  const result = A.run(controllerFor(project).getDrawingScene(), { version: 1, id: 'field-fixture', densityKgM3: 1.2,
    planField: { enabled: true, spacingM: .5 }, zones: [{ id: 'living', room: ref('living'), volumeM3: 30 }],
    links: [
      { id: 'in', kind: 'opening', opening: ref('entry'), from: 'outside', to: 'living', enabled: true, freeAreaM2: .5, cd: .6, pressurePa: 12 },
      { id: 'out', kind: 'opening', opening: ref('living-window'), from: 'living', to: 'outside', enabled: true, freeAreaM2: .5, cd: .6, pressurePa: 0 }
    ] });
  assert.equal(result.status, 'converged');
  assert.equal(result.planField.status, 'complete', JSON.stringify(result.planField.findings));
  assert.ok(result.planField.cells.length > 32);
  assert.ok(result.planField.maximumSpeedMps > 0);
  assert.equal(result.planField.inputFingerprint, result.provenance.inputFingerprint);
  assert.ok(result.planField.rooms[0].ports.some(port => port.faces.some(face => face.normalProjectionM > .1)));
});
