const test = require('node:test');
const assert = require('node:assert/strict');
const CFD = require('../planner-cfd.js');
const UI = require('../planner-cfd-ui.js');
const Projection = require('../planner-projection.js');
const { project, inputs, fill, manifest, job, result, clone, controllerFor } = require('./fixtures/planner-cfd-fixtures.cjs');
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function run() {
  const p = project(), inventory = CFD.inspect(Projection.build(p), p.activeFloorId, 'ground:bathroom');
  const m = manifest(CFD.request(inventory, inputs(inventory.geometry)));
  return { id: '11111111-1111-4111-8111-111111111111', manifest: m, result: result(m) };
}
function refined(baseline, { mesh = true, time = true } = {}) {
  const candidate = clone(baseline);
  candidate.id = '22222222-2222-4222-8222-222222222222';
  if (mesh) {
    candidate.manifest.scenario.numerics.spacingM /= 2;
    for (const name of ['cells', 'airCells', 'solidCells']) candidate.manifest.mesh[name] *= 2;
    candidate.manifest.mesh.selectedSpacingM /= 2;
  }
  if (time) candidate.manifest.scenario.numerics.deltaTSeconds /= 2;
  candidate.manifest.caseHash = 'b'.repeat(64); candidate.result.caseHash = 'b'.repeat(64);
  return candidate;
}

test('matching point comparisons report actual scalar and vector differences, not convergence or an error bound', () => {
  const a = run(), b = refined(a), before = JSON.stringify([a, b]);
  for (const point of b.result.samples) {
    point.temperatureC += 2; point.absolutePressurePa += 10;
    point.velocityMps.x = -.1;
  }
  const output = CFD.compareRuns(a, b, b.manifest);
  assert.equal(output.status, 'compared-not-validated');
  assert.equal(output.comparisonType, 'mesh-and-time');
  assert.equal(output.meshChange, 'more-cells'); assert.equal(output.timestepChange, 'smaller');
  near(output.differences.temperatureC.maxAbsolute, 2); near(output.differences.temperatureC.rootMeanSquare, 2);
  near(output.differences.absolutePressurePa.mean, 10);
  near(output.differences.speedMps.maxAbsolute, 0);
  near(output.differences.velocityDifferenceMps.maxAbsolute, .2);
  assert.equal(output.observedOrder, null); assert.equal(output.gridConvergenceIndex, null);
  assert.equal(output.extrapolatedSolution, null);
  assert.match(output.limitations.join(' '), /not error bounds/);
  assert.ok(Object.isFrozen(output.differences.temperatureC));
  const after = clone(b); for (const point of after.result.samples) {
    point.temperatureC -= 2; point.absolutePressurePa -= 10; point.velocityMps.x = .1;
  }
  assert.equal(JSON.stringify([a, after]), before);
});

test('time-only, mesh-only, mixed and repeat comparisons remain distinct', () => {
  const a = run();
  assert.equal(CFD.compareRuns(a, refined(a, { mesh: false })).comparisonType, 'time-step');
  assert.equal(CFD.compareRuns(a, refined(a, { time: false })).comparisonType, 'mesh');
  assert.equal(CFD.compareRuns(a, refined(a, { mesh: false, time: false })).comparisonType, 'repeat');
  assert.equal(CFD.compareRuns(refined(a), a).meshChange, 'fewer-cells');
  assert.equal(CFD.compareRuns(refined(a), a).timestepChange, 'larger');
  const redistributed = refined(a, { mesh: false, time: false });
  redistributed.manifest.mesh.axes = { X: { fixtureIntervals: [2, 3] } };
  assert.equal(CFD.compareRuns(a, redistributed).comparisonType, 'mesh');
  assert.equal(CFD.compareRuns(a, redistributed).meshChange, 'redistributed');
});

test('physical changes, other owners, changed end time, sample points and numerical methods are not refinements', () => {
  const a = run();
  const edits = [
    b => { b.manifest.geometry.rect.w += 1; },
    b => { b.manifest.scenario.air.initialC += 1; },
    b => { b.manifest.scenario.boundaries.N += 1; },
    b => { b.manifest.scenario.openings[0].temperatureC += 1; },
    b => { b.manifest.source.projectId = 'another'; b.result.source.projectId = 'another'; },
    b => { b.manifest.source.roomId = 'another'; b.result.source.roomId = 'another'; },
    b => { b.manifest.scenario.numerics.endTimeSeconds += 1; b.result.timeSeconds += 1; },
    b => { b.manifest.scenario.numerics.maxCo = .8; },
    b => { b.manifest.engine.version = '2506'; b.result.engine.version = '2506'; },
    b => { b.manifest.numerics = { spatialAdvection: 'different scheme' }; },
    b => { b.manifest.probeLocations.reverse(); b.result.samples.reverse(); },
  ];
  for (const edit of edits) {
    const b = refined(a); edit(b);
    assert.throws(() => CFD.compareRuns(a, b), /identical|supported|match|incomplete/);
  }
});

test('physical provenance notes/revisions and output budgets can vary but current physical inputs must match', () => {
  const a = run(), b = refined(a);
  b.manifest.scenario.sourceNote = 'Same physical values with additional source commentary';
  b.manifest.scenario.numerics.maxRuntimeSeconds *= 2;
  b.manifest.scenario.numerics.writeIntervalSeconds /= 2;
  b.manifest.source.revision++; b.result.source.revision++;
  b.manifest.source.inputFingerprint += ' changed unrelated presentation';
  b.result.source.inputFingerprint = b.manifest.source.inputFingerprint;
  assert.equal(CFD.compareRuns(a, b, b.manifest).status, 'compared-not-validated');
  const changed = clone(b.manifest); changed.scenario.solid.conductivityWmK *= 2;
  assert.throws(() => CFD.compareRuns(a, b, changed), /current room and physical scenario/);
});

test('mismatched result provenance, invalid values, wrong time and impossible mesh counts are rejected', () => {
  const a = run();
  for (const edit of [
    b => { b.result.caseHash = 'c'.repeat(64); },
    b => { b.result.timeSeconds += 10; },
    b => { b.result.samples[0].temperatureC = NaN; },
    b => { b.result.samples[0].speedMps = 12; },
    b => { b.manifest.mesh.airCells = -1; },
    b => { b.manifest.mesh.cells++; },
    b => { b.result.samples.pop(); },
  ]) {
    const b = refined(a); edit(b); assert.throws(() => CFD.compareRuns(a, b));
  }
});

test('RMS differences remain finite for large finite values, while unrepresentable differences fail', () => {
  const a = run(), b = refined(a);
  for (const sample of b.result.samples) sample.temperatureC = 1e300;
  const values = CFD.compareRuns(a, b).differences.temperatureC;
  assert.equal(values.rootMeanSquare, 1e300); assert.equal(values.mean, 1e300);
  for (const sample of a.result.samples) { sample.velocityMps = { x: -1e308, y: 0, z: 0 }; sample.speedMps = 1e308; }
  for (const sample of b.result.samples) { sample.velocityMps = { x: 1e308, y: 0, z: 0 }; sample.speedMps = 1e308; }
  assert.throws(() => CFD.compareRuns(a, b), /finite numerical range/);
});

test('new output contracts require complete regional and interface evidence before showing a result', () => {
  const a = run(), captured = { manifest: a.manifest, request: a.manifest };
  a.manifest.conservation = { version: 1, method: 'cht-enthalpy-end-step-v1' };
  assert.throws(() => UI.verifyResult(a.result, captured), /Conservation evidence/);
  a.result.diagnostics = {
    conservation: { version: 1, method: 'cht-enthalpy-end-step-v1', status: 'computed-unvalidated',
      coverage: { startSeconds: 0, endSeconds: 10, intervals: 100, includesInitialState: true } },
    massBalance: { status: 'computed-unvalidated', residualKg: 0, maxAbsStepResidualKg: .01, maxAbsStepResidualKgS: .1 },
    energyBalance: { status: 'computed-unvalidated',
      fluid: { residualJ: 0, maxAbsStepResidualJ: 4 }, solid: { residualJ: 0, maxAbsStepResidualJ: 4 },
      combinedExternal: { residualJ: 0, maxAbsStepResidualJ: 0 },
      interface: { maxAbsMismatchW: 2, signedMismatchJ: 0 } },
  };
  assert.equal(UI.verifyResult(a.result, captured).diagnostics.energyBalance.fluid.maxAbsStepResidualJ, 4);
  const html = UI.conservationMarkup(a.result.diagnostics);
  assert.match(html, /4.00000 J/); assert.match(html, /2.00000 W/);
  assert.match(html, /not acceptance thresholds/); assert.doesNotMatch(html, /passed|certified/);
  a.result.diagnostics.energyBalance.interface.maxAbsMismatchW = -1;
  assert.throws(() => UI.verifyResult(a.result, captured), /cannot be negative/);
});

test('missing or insufficient conservation history remains unavailable rather than zero', () => {
  assert.match(UI.conservationMarkup({}), /no zero residual is assumed/);
  assert.match(UI.conservationMarkup({ conservation: { status: 'insufficient-history' } }), /inventing an initial state/);
});

test('real controller keeps bounded completed histories, compares explicitly and never mutates the project', async t => {
  const bridge = controllerFor(project()), before = bridge.exportProject(), jobs = new Map(), calls = [];
  let prepared, count = 0;
  const runtime = { location: { protocol: 'http:', hostname: 'localhost' }, fetch: async (url, options) => {
    calls.push(url); const payload = options.body ? JSON.parse(options.body) : null;
    let body;
    if (url.endsWith('/prepare')) {
      prepared = manifest(payload);
      const cells = Math.round(1000 * .25 / payload.scenario.numerics.spacingM);
      Object.assign(prepared.mesh, { cells, airCells: Math.round(cells * .6), solidCells: cells - Math.round(cells * .6) });
      body = { status: 'prepared', manifest: prepared };
    } else if (url.endsWith('/runtime')) body = { execution: { available: true, status: 'ready', message: 'TEST transport only' } };
    else if (url.endsWith('/jobs')) {
      const id = `${String(++count).padStart(8, '0')}-1111-4111-8111-111111111111`;
      const record = { ...job(prepared, 'completed'), id }; jobs.set(id, { manifest: clone(prepared), job: record });
      body = { job: record };
    } else {
      const id = url.split('/')[4], record = jobs.get(id);
      body = url.endsWith('/result') ? { status: 'computed-unvalidated', result: result(record.manifest) } : { job: record.job };
    }
    return { ok: true, status: 200, json: async () => body };
  } };
  const controller = UI.createController(bridge, runtime); t.after(() => controller.dispose());
  fill(controller); await controller.checkEngine();
  const compute = async () => {
    assert.equal(await controller.prepare(), true); await controller.run();
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.getState().status, 'completed');
  };
  await compute(); controller.setValue('numerics.spacingM', .125); await compute();
  const history = controller.getState().history;
  assert.equal(history.length, 2);
  const requestsBeforeComparison = calls.length;
  assert.equal(controller.compare(history[0].id, history[1].id), true);
  assert.equal(calls.length, requestsBeforeComparison);
  assert.equal(controller.getState().comparison.comparisonType, 'mesh');
  controller.setValue('air.initialC', 21);
  assert.equal(controller.getState().comparison, null);
  assert.equal(controller.compare(history[0].id, history[1].id), false);
  assert.match(controller.getState().comparisonMessage, /current room and physical scenario/);
  controller.setValue('air.initialC', 20);
  for (let i = 0; i < 5; i++) await compute();
  assert.equal(controller.getState().history.length, 6);
  assert.equal(controller.compare(history[0].id, controller.getState().history.at(-1).id), false);
  assert.equal(controller.getState().comparison, null);
  controller.clear();
  assert.equal(controller.getState().result, null);
  assert.equal(controller.getState().history.length, 6);
  controller.selectRoom('ground:kitchen'); assert.equal(controller.getState().history.length, 0);
  controller.selectRoom('ground:bathroom'); assert.equal(controller.getState().history.length, 6);
  controller.clearHistory(); assert.equal(controller.getState().history.length, 0);
  assert.equal(bridge.exportProject(), before);
});
