const test = require('node:test');
const assert = require('node:assert/strict');
const Inputs = require('../planner-airflow-inputs.js');
const Airflow = require('../planner-airflow.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const project = createFixture('multiple-floors').project;
  for (const floor of project.floors)
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project);
  return { project: planner.getProject(), scene: copy(planner.getDrawingScene()) };
}
const draft = () => ({ version: 1, id: 'whole-house', zones: [], links: [], densityKgM3: null });

test('whole-house inputs select every actual floor room and use reservation-aware area and supplied per-floor height', () => {
  const { project, scene } = fixture();
  const first = scene.scenes[0].rooms[0];
  first.usableRegions = [{ ...first.rect, w: first.rect.w / 2 }];
  scene.scenes[0].wallHeightM = 2.8; scene.scenes[1].wallHeightM = 3.1;
  const inventory = Airflow.discover(scene), before = JSON.stringify({ scene, inventory, project });
  const result = Inputs.build(inventory, scene, project, draft());
  assert.equal(result.scenario.zones.length, inventory.rooms.length);
  for (const room of inventory.rooms) {
    const zone = result.scenario.zones.find(zone => zone.room.floorId === room.ref.floorId && zone.room.entityId === room.ref.entityId);
    const height = scene.scenes.find(floor => floor.floorId === room.ref.floorId).wallHeightM;
    assert.equal(zone.volumeM3, room.usableAreaM2 * height);
    assert.match(zone.volumeSource, /Plan estimate: usable area .*supplied wall height .*not measured clear volume/);
  }
  assert.equal(result.scenario.zones[0].volumeM3, first.rect.w * first.rect.h / 2 * 2.8);
  assert.equal(result.physicalFingerprint, inventory.physicalFingerprint);
  assert.equal(result.scenario.densityKgM3, null);
  assert.equal(JSON.stringify({ scene, inventory, project }), before);
  assert.deepEqual(Airflow.normalizeScenario(result.scenario), result.scenario);
});

test('missing floor height and empty usable area are not invented or replaced by a room rectangle', () => {
  const { project, scene } = fixture();
  scene.scenes[0].wallHeightM = null;
  scene.scenes[1].rooms[0].usableRegions = [];
  const result = Inputs.build(Airflow.discover(scene), scene, project, draft());
  assert.equal(result.scenario.zones[0].volumeM3, null);
  assert.ok(result.issues.some(issue => /wall height in Design/.test(issue.message)));
  assert.ok(result.issues.some(issue => /No usable air area/.test(issue.message)));
});

test('refresh rederives only tracked estimates and preserves manual overrides, stable IDs and unresolved records', () => {
  const { project, scene } = fixture();
  const first = Inputs.build(Airflow.discover(scene), scene, project, draft());
  const edited = copy(first.scenario), manual = edited.zones[0], auto = edited.zones[1];
  manual.volumeM3 = 123; manual.volumeSource = 'Measured clear volume';
  edited.zones.push({ id: 'unresolved', room: { floorId: 'missing', entityId: 'retain' }, volumeM3: 10 });
  scene.scenes[0].wallHeightM += 1;
  const next = Inputs.build(Airflow.discover(scene), scene, project, edited, first);
  assert.deepEqual(next.scenario.zones[0], manual);
  assert.notEqual(next.scenario.zones.find(zone => zone.id === auto.id).volumeM3, auto.volumeM3);
  assert.deepEqual(next.scenario.zones.at(-1), edited.zones.at(-1));
  assert.deepEqual(next.scenario.zones.map(zone => zone.id), edited.zones.map(zone => zone.id));
  assert.notEqual(first.physicalFingerprint, next.physicalFingerprint);
});

test('actual opening adjacency is reused; geometric area stays an explicit upper-bound proposal, never Cd or pressure', () => {
  const { project, scene } = fixture();
  const inventory = Airflow.discover(scene);
  const result = Inputs.build(inventory, scene, project, draft());
  assert.equal(result.scenario.links.length, inventory.openings.filter(opening => opening.adjacencyStatus === 'known').length);
  for (const link of result.scenario.links) {
    const opening = inventory.openings.find(opening => opening.ref.floorId === link.opening.floorId && opening.ref.entityId === link.opening.entityId);
    const endpoint = side => side.kind === 'outside' ? 'outside' : result.scenario.zones.find(zone =>
      zone.room.floorId === side.floorId && zone.room.entityId === side.entityId).id;
    assert.deepEqual([link.from, link.to], opening.candidateAdjacency.map(endpoint));
    assert.equal(link.enabled, opening.operation.openFraction !== 0);
    assert.equal(link.freeAreaM2, null); assert.equal(link.cd, null); assert.equal(link.pressurePa, null);
  }
  result.scenario.links[0].freeAreaM2 = .12;
  const applied = Inputs.useOpeningAreas(result);
  assert.equal(applied.scenario.links[0].freeAreaM2, .12);
  for (const proposal of applied.openingAreas.filter(row => row.applied)) {
    const link = applied.scenario.links.find(link => link.id === proposal.linkId);
    assert.equal(link.freeAreaM2, proposal.geometricCapM2);
    assert.match(link.notes, /upper bound, not verified aerodynamic/);
  }
  assert.deepEqual(Airflow.normalizeScenario(applied.scenario), applied.scenario);
  const unknown = copy(inventory); unknown.openings[0].adjacencyStatus = 'unknown'; unknown.openings[0].candidateAdjacency = null;
  const refused = Inputs.build(unknown, scene, project, draft());
  assert.equal(refused.scenario.links.length, result.scenario.links.length - 1);
  assert.ok(refused.issues.some(issue => /no outside connection/.test(issue.message)));
});

test('saved normalized weather is reused with source/time and calm zero, never converted into pressure', () => {
  const project = { environment: { weather: { id: 'saved-weather', kind: 'reanalysis',
    units: { windSpeedMps: 'm/s', windFromDeg: 'deg' }, source: { label: 'Saved grid', windReferenceHeightM: 10 },
    records: [
      { timestamp: '2026-09-16T00:00:00Z', windSpeedMps: 3, windFromDeg: 90 },
      { timestamp: '2026-09-17T00:00:00Z', windSpeedMps: 0, windFromDeg: null },
      { timestamp: '2026-09-18T00:00:00Z', windSpeedMps: 999, windFromDeg: 45 }
    ] } } };
  const before = JSON.stringify(project), value = Inputs.weather(project);
  assert.equal(value.windSpeedMps, 0); assert.equal(value.windFromDeg, null);
  assert.equal(value.timestamp, '2026-09-17T00:00:00Z');
  assert.equal(value.referenceHeightM, 10); assert.equal(value.source.label, 'Saved grid');
  assert.match(value.message, /not live house wind/);
  assert.equal(Object.hasOwn(value, 'pressurePa'), false);
  assert.equal(JSON.stringify(project), before);
  project.environment.weather.records = [{ timestamp: '2026-09-17T00:00:00Z', windSpeedMps: null, windFromDeg: 90 }];
  assert.equal(Inputs.weather(project).status, 'unavailable');
  project.environment.wind = { source: 'manual', windSpeedMps: 0, windFromDeg: 0 };
  const manual = Inputs.weather(project);
  assert.equal(manual.kind, 'hypothetical');
  assert.equal(manual.windSpeedMps, 0);
  assert.equal(manual.timestamp, null);
  assert.match(manual.message, /Not measured weather/);
});

test('accepted geometric-area estimates refresh with the model, while supplied areas remain unchanged', () => {
  const { project, scene } = fixture();
  for (const floor of scene.scenes) for (const opening of floor.openings) opening.openFraction = 1;
  const first = Inputs.useOpeningAreas(Inputs.build(Airflow.discover(scene), scene, project, draft()));
  const nextDraft = copy(first.scenario), [automatic, manual] = nextDraft.links;
  manual.freeAreaM2 = .13; manual.notes = 'Measured aerodynamic free area';
  for (const floor of scene.scenes) for (const opening of floor.openings) opening.openFraction = .5;
  const next = Inputs.build(Airflow.discover(scene), scene, project, nextDraft, first);
  assert.equal(next.scenario.links.find(row => row.id === automatic.id).freeAreaM2, automatic.freeAreaM2 / 2);
  assert.deepEqual(next.scenario.links.find(row => row.id === manual.id), manual);
  assert.ok(next.scenario.links.every(link => link.pressurePa === null && link.cd === null));
});
