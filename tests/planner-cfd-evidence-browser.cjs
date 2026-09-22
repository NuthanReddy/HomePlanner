// Real page/compiler, explicitly mocked engine transport. This never runs OpenFOAM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { inputs, fillBrowser, clone } = require('./fixtures/planner-cfd-fixtures.cjs');

function fixtureResult(manifest, counter) {
  const end = manifest.scenario.numerics.endTimeSeconds, dt = manifest.scenario.numerics.deltaTSeconds;
  const report = { version: 1, method: manifest.conservation.method, status: 'computed-unvalidated',
    coverage: { startSeconds: dt, endSeconds: end, intervals: Math.round(end / dt) - 1, includesInitialState: false } };
  return { version: 1, kind: 'CoupledCfdResult', caseHash: manifest.caseHash, source: clone(manifest.source),
    engine: clone(manifest.engine), coordinateSpace: manifest.coordinateSpace,
    timeSeconds: end, receiverHeightM: manifest.receiverHeightM, validationStatus: 'unvalidated',
    samples: manifest.probeLocations.map(point => ({ positionM: clone(point), temperatureC: 20 + 2 * counter,
      velocityMps: { x: .1 + counter * .01, y: 0, z: 0 }, speedMps: .1 + counter * .01, absolutePressurePa: 101325 })),
    diagnostics: { conservation: report,
      massBalance: { status: 'computed-unvalidated', residualKg: 0, maxAbsStepResidualKg: .001, maxAbsStepResidualKgS: .01 },
      energyBalance: { status: 'computed-unvalidated', fluid: { residualJ: 0, maxAbsStepResidualJ: 4 },
        solid: { residualJ: 0, maxAbsStepResidualJ: 5 }, combinedExternal: { residualJ: 0, maxAbsStepResidualJ: 6 },
        interface: { maxAbsMismatchW: 2, signedMismatchJ: .01 } } },
    limitations: ['MANUFACTURED BROWSER FIXTURE ONLY. No engine execution or physical validation.'],
  };
}

module.exports = async function cfdEvidenceBrowser(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [], jobs = new Map(), requests = [];
  let prepared = null, counter = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/cfd/')) requests.push(request.url()); });
  await page.route('**/api/cfd/runtime', route => route.fulfill({ json: {
    execution: { available: true, status: 'ready', message: 'MANUFACTURED TEST TRANSPORT ONLY - no OpenFOAM' },
  } }));
  await page.route(/\/api\/cfd\/jobs(?:\/.*)?$/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/jobs')) {
      const payload = route.request().postDataJSON();
      assert.deepEqual(payload.source, prepared.source);
      assert.deepEqual(payload.geometry, prepared.geometry);
      assert.deepEqual(payload.scenario, prepared.scenario);
      const id = `${String(++counter).padStart(8, '0')}-1111-4111-8111-111111111111`;
      const snapshot = { id, status: 'completed', message: 'TEST fixture complete; no process started',
        caseHash: prepared.caseHash, source: clone(prepared.source), stage: 'fixture', logTail: [],
        resultAvailable: true, diagnostic: null };
      jobs.set(id, { job: snapshot, result: fixtureResult(prepared, counter) });
      return route.fulfill({ json: { job: snapshot } });
    }
    const id = path.split('/')[4], row = jobs.get(id);
    assert.ok(row, 'Only owned fixture IDs may be read');
    return route.fulfill({ json: path.endsWith('/result') ?
      { status: 'computed-unvalidated', result: row.result } : { job: row.job } });
  });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => HomePlannerWorkspace.navigate('environment/cfd'));
    const root = page.locator('#workspaceCfd');
    const selection = await page.evaluate(() => {
      const p = HomePlanner.getProject(), d = HomePlanner.getDrawingScene();
      return d.scenes.find(f => f.floorId === p.activeFloorId).rooms.find(room =>
        !HomePlannerCFD.inspect(d, p.activeFloorId, room.id).findings.length)?.id;
    });
    assert.ok(selection);
    await root.locator('[data-cfd-room]').selectOption(selection);
    const state = await page.evaluate(() => document.getElementById('workspaceCfd').homePlannerCFD.getState());
    const before = await page.evaluate(() => HomePlanner.exportProject());
    const form = inputs(state.inventory.geometry);
    form.sourceNote = 'MANUFACTURED browser transport fixture - not solver output or a real-building study.';
    await fillBrowser(root, form);
    assert.equal(requests.length, 0);
    const computeFixture = async () => {
      const response = page.waitForResponse(response => response.url().endsWith('/api/cfd/prepare'));
      await root.locator('[data-cfd-action="prepare"]').click();
      const data = await (await response).json();
      assert.equal(data.status, 'prepared', JSON.stringify(data));
      prepared = data.manifest;
      await root.locator('[data-cfd-action="checkEngine"]').click();
      await page.waitForFunction(() => document.getElementById('workspaceCfd').homePlannerCFD.getState().engine.available);
      await root.locator('[data-cfd-action="run"]').click();
      await page.waitForFunction(() => !!document.getElementById('workspaceCfd').homePlannerCFD.getState().result);
    };
    await computeFixture();
    assert.match(await root.locator('[data-cfd-balances]').innerText(), /4.00000 J/);
    assert.match(await root.locator('[data-cfd-balances]').innerText(), /2.00000 W/);
    assert.match(await root.locator('[data-cfd-balances]').innerText(), /Does not include the unrecorded startup interval/);
    await root.locator('[data-cfd-input="numerics.spacingM"]').fill('.125');
    await computeFixture();
    await root.locator('summary').filter({ hasText: 'Compare mesh / timestep runs' }).click();
    const ids = [...jobs.keys()];
    await root.locator('[data-cfd-baseline]').selectOption(ids[0]);
    await root.locator('[data-cfd-candidate]').selectOption(ids[1]);
    const beforeComparison = requests.length;
    await root.locator('[data-cfd-action="compare"]').click();
    assert.match(await root.locator('[data-cfd-comparison]').innerText(), /2.00000 C/);
    assert.match(await root.locator('[data-cfd-comparison]').innerText(), /No extrapolated solution/);
    assert.equal(requests.length, beforeComparison);
    const exported = page.waitForEvent('download');
    await root.locator('[data-cfd-action="exportComparison"]').click();
    const download = await exported;
    assert.equal(download.suggestedFilename(), 'homeplanner-cfd-comparison.json');
    const comparison = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(comparison.status, 'compared-not-validated');
    assert.equal(comparison.comparisonType, 'mesh');
    assert.equal(comparison.observedOrder, null);
    assert.equal(comparison.baseline.source.projectId, state.projectId);
    await root.locator('[data-cfd-input="air.initialC"]').fill('21');
    assert.equal(await root.locator('[data-cfd-comparison]').innerText(), '');
    await root.locator('[data-cfd-action="compare"]').click();
    assert.match(await root.locator('[data-cfd-comparison-status]').innerText(), /current room and physical scenario/);
    assert.equal(requests.length, beforeComparison);
    await page.setViewportSize({ width: 390, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.evaluate(() => HomePlanner.exportProject()), before);
    assert.deepEqual(errors, []);
    return { realCompiler: true, mockedEngineTransport: true, actualEngineExecuted: false,
      regionalBalancesRendered: true, comparisonExport: true, staleComparisonRejected: true, projectPreserved: true };
  } finally { await context.close(); }
};
