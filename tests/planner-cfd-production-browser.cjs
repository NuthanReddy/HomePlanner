const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CFD = require('../planner-cfd.js');
const { inputs } = require('./fixtures/planner-cfd-fixtures.cjs');

module.exports = async function coupledCfdProduction(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/cfd/')) requests.push(request.url()); });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => HomePlannerWorkspace.navigate('environment/cfd'));
    await page.waitForFunction(() => !!document.getElementById('workspaceCfd').homePlannerCFD);
    const root = page.locator('#workspaceCfd');
    assert.equal(await root.isVisible(), true);
    assert.equal(requests.length, 0, 'Opening CFD must not check or start the engine');
    const selected = await page.evaluate(() => {
      const drawing = HomePlanner.getDrawingScene(), project = HomePlanner.getProject();
      const floor = drawing.scenes.find(floor => floor.floorId === project.activeFloorId);
      return floor.rooms.find(room => {
        const inventory = HomePlannerCFD.inspect(drawing, floor.floorId, room.id);
        return !inventory.findings.length && inventory.geometry?.openings.some(opening => opening.kind === 'window');
      })?.id;
    });
    assert.ok(selected, 'The actual default layout must contain a supported current room');
    await root.locator('[data-cfd-room]').selectOption(selected);
    const state = await page.evaluate(() => document.getElementById('workspaceCfd').homePlannerCFD.getState());
    const form = inputs(state.inventory.geometry), before = await page.evaluate(() => HomePlanner.getProject());
    for (const field of CFD.FIELDS)
      await root.locator(`[data-cfd-input="${field.path}"]`).fill(String(CFD.getPath(form, field.path)));
    await root.locator('[data-cfd-input="sourceNote"]').fill(form.sourceNote);
    for (const row of form.openings) {
      const condition = root.locator(`[data-cfd-opening="${row.id}"][data-cfd-field="mode"]`);
      await condition.selectOption(row.mode);
      await root.locator(`[data-cfd-opening="${row.id}"][data-cfd-field="temperatureC"]`).fill(String(row.temperatureC));
    }
    for (const field of ['acknowledgeGeometry', 'acknowledgeEmptyRoom', 'acknowledgeModel'])
      await root.locator(`[data-cfd-input="${field}"]`).check();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getProject()), before, 'Typing must preserve the complete current project');
    assert.equal(requests.length, 0);
    const preparationResponse = page.waitForResponse(response => response.url().endsWith('/api/cfd/prepare'));
    await root.locator('[data-cfd-action="prepare"]').click();
    const preparation = await preparationResponse, prepared = await preparation.json();
    assert.equal(preparation.status(), 200, JSON.stringify(prepared));
    await page.waitForFunction(() => document.getElementById('workspaceCfd').homePlannerCFD.getState().status === 'prepared');
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.manifest.source.roomId, selected);
    assert.equal(prepared.manifest.source.projectId, before.id);
    assert.deepEqual(prepared.manifest.geometry, state.inventory.geometry);
    assert.ok(prepared.manifest.mesh.cells > 0);
    assert.equal(prepared.manifest.runtimeVerification, 'pending');
    assert.equal(await root.locator('[data-cfd-output]').isVisible(), false);
    assert.equal(await root.locator('[data-cfd-plot] circle').count(), 0, 'No fabricated pre-run field');
    const downloadEvent = page.waitForEvent('download');
    await root.locator('[data-cfd-action="download"]').click();
    const download = await downloadEvent, file = await download.path();
    assert.equal(download.suggestedFilename(), 'homeplanner-openfoam-case.zip');
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.ok(bytes.length > 1000);
    const engineResponse = page.waitForResponse(response => response.url().endsWith('/api/cfd/runtime'));
    await root.locator('[data-cfd-action="checkEngine"]').click();
    const runtime = await (await engineResponse).json();
    assert.equal((runtime.execution || runtime).available, false, 'This test intentionally requires an unavailable, unconfigured engine');
    await page.waitForFunction(() => document.getElementById('workspaceCfd').homePlannerCFD.getState().engine.status !== 'checking');
    assert.equal(await root.locator('[data-cfd-action="run"]').isDisabled(), true);
    assert.equal(requests.some(url => url.endsWith('/api/cfd/jobs')), false);
    await root.locator('[data-cfd-action="save"]').click();
    const saved = await page.evaluate(() => HomePlanner.getProject());
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual(saved.legacy, before.legacy); assert.deepEqual(saved.floors, before.floors);
    assert.equal(saved.environment.coupledCfd.scenarios[0].roomId, selected);
    assert.equal(saved.environment.coupledCfd.scenarios[0].scenario.air.pressurePa, 101325);
    await page.evaluate(() => HomePlanner.undo());
    assert.equal(await page.evaluate(() => HomePlanner.getProject().environment.coupledCfd), undefined);
    await page.evaluate(() => HomePlanner.redo());
    assert.deepEqual(await page.evaluate(() => HomePlanner.getProject().environment.coupledCfd), saved.environment.coupledCfd);
    assert.equal(await root.locator('[data-cfd-input="air.pressurePa"]').inputValue(), '101325');
    const window = state.inventory.geometry.openings.find(opening => opening.kind === 'window');
    await root.locator(`[data-cfd-operation="1"][data-cfd-opening="${window.id}"]`).click();
    assert.equal(await root.locator('[data-cfd-input="acknowledgeGeometry"]').isChecked(), false);
    assert.equal(await page.evaluate(() => document.getElementById('workspaceCfd').homePlannerCFD.getState().manifest), null);
    await root.locator(`[data-cfd-opening="${window.id}"][data-cfd-field="mode"]`).selectOption('outlet');
    await root.locator(`[data-cfd-opening="${window.id}"][data-cfd-field="gaugePressurePa"]`).fill('0');
    await root.locator('[data-cfd-input="acknowledgeGeometry"]').check();
    const openedResponse = page.waitForResponse(response => response.url().endsWith('/api/cfd/prepare'));
    await root.locator('[data-cfd-action="prepare"]').click();
    const opened = await (await openedResponse).json();
    assert.equal(opened.status, 'prepared', JSON.stringify(opened));
    assert.equal(opened.manifest.geometry.openings.find(opening => opening.id === window.id).openFraction, 1);
    const requestCount = requests.length;
    await page.evaluate(() => HomePlanner.undo());
    assert.equal(requests.length, requestCount, 'Undo must not rerun or prepare a case');
    assert.equal(await root.locator('[data-cfd-input="acknowledgeGeometry"]').isChecked(), false);
    if (process.env.HOMEPLANNER_TEST_ARTIFACTS) {
      await page.screenshot({ path: path.join(process.env.HOMEPLANNER_TEST_ARTIFACTS, 'coupled-cfd-desktop.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'CFD workbench must fit a narrow viewport');
    if (process.env.HOMEPLANNER_TEST_ARTIFACTS)
      await page.screenshot({ path: path.join(process.env.HOMEPLANNER_TEST_ARTIFACTS, 'coupled-cfd-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    return { currentRoom: true, actualCompiler: true, caseZip: true, cells: prepared.manifest.mesh.cells,
      noEngineRun: true, noPlaceholderField: true, inputHistory: true, openingUndo: true, mobileFits: true };
  } finally { await context.close(); }
};
