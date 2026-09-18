const { createFixture, controllerFor } = require('./drawing-fixtures.cjs');
const CFD = require('../../planner-cfd.js');
const clone = value => JSON.parse(JSON.stringify(value));

function project() {
  const p = createFixture('furnished-single').project;
  p.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
  p.doorEdits = {}; p.windowEdits = {};
  return p;
}
function inputs(geometry) {
  const form = CFD.draft(geometry);
  Object.assign(form, { floorThicknessM: .15, ceilingThicknessM: .15,
    sourceNote: 'Synthetic test inputs only; no building prediction.',
    acknowledgeGeometry: true, acknowledgeEmptyRoom: true, acknowledgeModel: true });
  form.air = { initialC: 20, pressurePa: 101325, molarMassGmol: 28.965, cpJkgK: 1006, muPaS: .0000181, prandtl: .71 };
  form.solid = { initialC: 20, densityKgM3: 1800, cpJkgK: 850, conductivityWmK: .8 };
  form.boundaries = { N: 25, E: 20, S: 20, W: 20, floor: 20, ceiling: 20 };
  form.sampling = { heightM: 1, columns: 2, rows: 2 };
  form.openings.forEach(row => { row.temperatureC = 20; });
  return form;
}
function fill(controller) {
  const form = inputs(controller.getState().inventory.geometry);
  for (const field of CFD.FIELDS) controller.setValue(field.path, CFD.getPath(form, field.path));
  for (const name of ['sourceNote', 'acknowledgeGeometry', 'acknowledgeEmptyRoom', 'acknowledgeModel'])
    controller.setValue(name, form[name]);
  for (const row of form.openings)
    for (const field of ['mode', 'temperatureC', 'speedMps', 'gaugePressurePa'])
      controller.setOpening(row.id, field, row[field]);
}
function manifest(request) {
  return { version: 1, profile: CFD.PROFILE, engine: { id: 'OpenCFD-OpenFOAM', version: '2606', solver: 'chtMultiRegionFoam' },
    caseHash: 'a'.repeat(64), source: clone(request.source), geometry: clone(request.geometry),
    scenario: clone(request.scenario), mesh: { cells: 1000 }, receiverHeightM: request.scenario.sampling.heightM,
    coordinateSpace: 'room-right-front-up', probeLocations: [
      { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }, { x: 1, y: 2, z: 1 }, { x: 2, y: 2, z: 1 }
    ], limitations: ['Synthetic API fixture, not engine computation.'], runtimeVerification: 'pending' };
}
function job(manifest, status = 'running') {
  return { id: '11111111-1111-4111-8111-111111111111', caseHash: manifest.caseHash, source: clone(manifest.source),
    status, message: `Synthetic lifecycle ${status}`, stage: 'solve', logTail: [], resultAvailable: status === 'completed' };
}
function result(manifest) {
  return { kind: 'CoupledCfdResult', version: 1, caseHash: manifest.caseHash, source: clone(manifest.source),
    engine: clone(manifest.engine), coordinateSpace: 'room-right-front-up', validationStatus: 'unvalidated',
    timeSeconds: manifest.scenario.numerics.endTimeSeconds, receiverHeightM: manifest.receiverHeightM,
    samples: manifest.probeLocations.map(positionM => ({ positionM: clone(positionM), temperatureC: 20,
      velocityMps: { x: .1, y: .2, z: 0 }, speedMps: Math.hypot(.1, .2), absolutePressurePa: 101325 })),
    diagnostics: { energyBalance: { status: 'not-evaluated' } }, limitations: ['Synthetic test-only data'] };
}
module.exports = { project, inputs, fill, manifest, job, result, clone, controllerFor };
