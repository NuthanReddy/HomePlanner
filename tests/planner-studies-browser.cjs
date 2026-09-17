'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require(path.join(__dirname, 'fixtures', 'drawing-fixtures.cjs'));

// Use a separately installed validation dependency, never the user's browser profile.
const { chromium } = require(process.env.HOMEPLANNER_PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.HOMEPLANNER_STUDY_URL || 'http://127.0.0.1:8000/';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Use a local test server');
const artifacts = process.env.HOMEPLANNER_STUDY_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const copy = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(path.join(__dirname, '..', 'planner-bridge.js'), 'utf8');
const boundary = source.indexOf("  if(typeof module==='object'&&module.exports)");
assert.ok(boundary > 0, 'The real bridge factory must be available for the fixture adapter');
const fixtureBridge = source.slice(0, boundary) + `
  let legacy = JSON.parse(JSON.stringify(root.__studyFixture.legacy));
  root.HomePlanner = createController({
    capture: () => JSON.parse(JSON.stringify(legacy)),
    restore: value => { legacy = JSON.parse(JSON.stringify(value)); },
    render() {}
  }, root.HomePlannerModel);
  root.HomePlanner.importProject(JSON.stringify(root.__studyFixture));
})(globalThis);`;

function fixture() {
  const project = createFixture('multiple-floors').project;
  for (const floor of project.floors) {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
    floor.heightM = floor.wallHeightM + project.building.roofThicknessM;
    for (const opening of [...floor.legacy.context.plan.openings.doors, ...floor.legacy.context.plan.openings.windows])
      opening.openFraction = 1;
    floor.doorEdits = {}; floor.windowEdits = {};
  }
  project.legacy = copy(project.floors[0].legacy);
  project.doorEdits = {}; project.windowEdits = {};
  return project;
}
async function openPage(browser, project, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
    ? route.continue() : route.abort());
  // This adapter retains the fixture's authored contexts. The real model, projection,
  // worker assets, numerical engines, display adapters, workspace and UI are unchanged.
  await context.route('**/planner-bridge.js', route => route.fulfill({ contentType: 'application/javascript', body: fixtureBridge }));
  await context.addInitScript(({ project, options }) => {
    window.__studyFixture = project; window.__studyWebGLRequests = 0; window.__studyLightEvents = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (/webgl/i.test(kind)) {
        window.__studyWebGLRequests++;
        if (options.noWebGL) return null;
      }
      return getContext.call(this, kind, ...args);
    };
    if (options.noWorker) window.Worker = undefined;
    document.addEventListener('homeplanner:light-result', event =>
      window.__studyLightEvents.push({ result: !!event.detail.result, stale: event.detail.stale }));
  }, { project, options });
  const page = await context.newPage(), errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(new URL('?workspace=environment&section=light', baseURL).href);
  await page.waitForFunction(() => document.getElementById('workspaceLightStudy')?.lightController);
  return { context, page, errors, workers };
}
async function state(page, study) {
  return page.evaluate(study => {
    const c = study === 'light' ? document.getElementById('workspaceLightStudy').lightController
      : document.getElementById('workspaceAirflow').homePlannerAirflow;
    const s = c.getState();
    return { code: s.displayStatus.code, error: s.error, previewError: s.previewError, message: s.message,
      status: s.result?.status, busy: s.busy, draft: s.draft, history: s.history.length, floorId: s.floorId,
      svg: s.preview?.svg, flows: s.result?.flowResults?.map(row => row.m3s),
      fieldStatus: s.result?.planField?.status, fieldCellCount: s.result?.planField?.cells.length,
      maximumSpeedMps: s.result?.planField?.maximumSpeedMps,
      values: s.preview?.sensorRows?.filter(row => row.inScope).map(row => row.selectedValue) };
  }, study);
}
async function navigate(page, section) {
  await page.evaluate(section => HomePlannerWorkspace.navigate(`environment/${section}`), section);
}
async function reveal(host, title) {
  const summary = host.getByText(title, { exact: true }), details = summary.locator('..');
  if (!await details.evaluate(node => node.open)) await summary.click();
  return details;
}
async function enter(input, value) {
  await input.fill(value); await input.press('Tab');
}
async function run(page, study) {
  await page.locator(study === 'light' ? '#light-run' : '#hp-airflow-run').click();
  await page.waitForFunction(study => !(study === 'light' ? document.getElementById('workspaceLightStudy').lightController
    : document.getElementById('workspaceAirflow').homePlannerAirflow).getState().busy, study);
  return state(page, study);
}
async function image(page, study, suffix) {
  const viewport = page.locator(study === 'light' ? '#light-viewport' : '#hp-airflow-preview');
  await viewport.locator('img').waitFor({ state: 'visible' });
  await page.waitForFunction(id => {
    const image = document.querySelector(`#${id} img`);
    return image?.naturalWidth > 0 && image.clientWidth > 20 && image.clientHeight > 20;
  }, study === 'light' ? 'light-viewport' : 'hp-airflow-preview');
  if (artifacts && suffix) {
    await viewport.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `${study}-${suffix}.png`) });
  }
}
async function authorLight(page) {
  const host = page.locator('#workspaceLightStudy');
  assert.match(await host.locator('#light-viewport').innerText(), /Prepare inventory/);
  await host.locator('#light-prepare').click();
  await host.locator('#light-room').selectOption(JSON.stringify(['ground', 'ground:living']));
  await host.locator('#light-add-room').click();
  await enter(host.getByLabel('Workplane height above floor · m', { exact: true }), '0.8');
  await reveal(host, 'Site, civil time & sun intervals');
  await host.locator('#light-project-site').click();
  await enter(host.locator('#light-date'), '2026-06-15');
  await enter(host.locator('#light-startTime'), '10:00');
  await enter(host.locator('#light-endTime'), '11:00');
  await host.locator('#light-prepare-sun').click();
  await reveal(host, 'Optics, sky quadrature & horizon');
  await host.locator('#light-optics').selectOption('ideal-clear');
  await enter(host.locator('#light-horizon'), '1');
  await reveal(host, 'Neighbors — four explicit side states & site-local boxes');
  for (const side of ['front', 'right', 'rear', 'left'])
    await host.locator(`#light-neighbor-${side}`).selectOption('clear');
  const roofs = await reveal(host, 'Roof context — existing floors only');
  for (const floorId of ['ground', 'upper']) {
    const group = roofs.getByRole('group', { name: floorId, exact: true });
    await group.getByRole('combobox', { name: 'Roof context', exact: true }).selectOption('supplied');
    await enter(group.getByLabel('Declaration source', { exact: true }), 'Synthetic fixture: supplied physical roof');
  }
  assert.equal((await run(page, 'light')).status, 'complete');
  await host.locator('#light-metric').selectOption('sky');
}
async function authorAirflow(page) {
  await navigate(page, 'airflow');
  const host = page.locator('#workspaceAirflow');
  await host.locator('#hp-airflow-prepare').click();
  await host.getByRole('combobox', { name: 'Room to add', exact: true }).selectOption(JSON.stringify(['ground', 'ground:living']));
  await host.locator('#hp-airflow-add-room').click();
  await enter(host.getByLabel('Clear room volume (m³) · blank = unknown', { exact: true }), '30');
  await enter(host.getByLabel('Air density (kg/m³) · blank = unknown', { exact: true }), '1.2');
  const zone = (await state(page, 'airflow')).draft.zones[0].id;
  for (const [opening, from, to, pressure] of [['entry', 'outside', zone, '12'], ['living-window', zone, 'outside', '0']]) {
    await host.getByRole('combobox', { name: 'Known opening to add', exact: true }).selectOption(JSON.stringify(['ground', `ground:${opening}`]));
    await host.locator('#hp-airflow-add-opening').click();
    const group = host.getByRole('group', { name: `Ground floor / ground:${opening}`, exact: true });
    const fromSelect = group.getByRole('combobox', { name: 'From zone (positive flow orientation)', exact: true });
    const toSelect = group.getByRole('combobox', { name: 'To zone (positive flow orientation)', exact: true });
    if (await fromSelect.inputValue() !== from)
      await group.getByRole('button', { name: 'Reverse from / to orientation', exact: true }).click();
    assert.equal(await fromSelect.inputValue(), from); assert.equal(await toSelect.inputValue(), to);
    await group.getByLabel('Enabled — include this link', { exact: true }).check();
    await enter(group.getByLabel('Operating free area (m²) · blank = unknown', { exact: true }), '.5');
    await enter(group.getByLabel('Discharge coefficient (0 < Cd ≤ 1) · blank = unknown', { exact: true }), '.6');
    await enter(group.getByLabel('Signed from → to forcing (Pa) · blank = unknown', { exact: true }), pressure);
  }
  assert.equal((await run(page, 'airflow')).status, 'converged');
}
async function main() {
  const browser = await chromium.launch({ headless: true,
    channel: process.env.HOMEPLANNER_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  const contexts = [], results = {};
  try {
    const test = await openPage(browser, fixture(), { noWebGL: true }); contexts.push(test.context);
    const { page, workers } = test;
    const authored = await page.evaluate(() => HomePlanner.exportProject());
    await authorLight(page);
    const light = await state(page, 'light');
    assert.equal(light.code, 'result'); assert.ok(light.values.some(value => value > 0));
    assert.match(light.svg, /data-sensor=/); assert.match(light.svg, /data-wall=/);
    assert.match(light.svg, /data-legend="light"/); assert.match(light.svg, /\[dimensionless\]/);
    assert.equal(light.error, ''); assert.equal(light.previewError, '');
    await image(page, 'light', 'desktop');
    const jobs = workers.length;
    await page.locator('#light-metric').selectOption('presence-hours');
    await page.locator('#light-metric').selectOption('sky');
    assert.equal(workers.length, jobs, 'changing the cached metric must not run another worker');
    await page.locator('#light-clear').click();
    const clearedLight = await state(page, 'light');
    assert.equal(clearedLight.status, undefined); assert.deepEqual(clearedLight.draft, light.draft);
    assert.doesNotMatch(clearedLight.svg, /data-sensor=/);
    assert.deepEqual(await page.evaluate(() => __studyLightEvents.at(-1)), { result: false, stale: true });
    await run(page, 'light'); assert.deepEqual((await state(page, 'light')).values, light.values);
    await page.evaluate(() => {
      const c = document.getElementById('workspaceLightStudy').lightController;
      c.setSelection({ startTime: '00:00', endTime: '01:00' }); c.prepareSunIntervals(); c.setVisualization({ metric: 'direct' });
    });
    assert.equal((await run(page, 'light')).code, 'night');
    assert.ok((await state(page, 'light')).values.every(value => value === 0));
    await page.locator('#light-metric').selectOption('sky');
    assert.deepEqual((await state(page, 'light')).values, light.values, 'geometric sky access is independent of night');
    await page.evaluate(() => document.getElementById('workspaceLightStudy').lightController.setNeighbor('front', 'unknown'));
    assert.equal((await run(page, 'light')).code, 'unknown-context');
    assert.ok((await state(page, 'light')).values.every(value => value === null));
    await page.locator('#light-modeled').check();
    assert.equal((await state(page, 'light')).code, 'result');
    assert.match(await page.locator('#light-view-status').innerText(), /Supplied model only/);
    await page.evaluate(() => document.getElementById('workspaceLightStudy').lightController.setFloor('upper'));
    assert.equal((await state(page, 'light')).code, 'other-floor');
    assert.equal(await page.evaluate(() => HomePlanner.getProject().activeFloorId), 'ground');
    await page.evaluate(() => {
      const c = document.getElementById('workspaceLightStudy').lightController;
      c.setFloor('ground'); c.setDraft({ windowOptics: { mode: null } });
    });
    assert.equal((await run(page, 'light')).code, 'blocked');
    assert.match(await page.locator('#light-view-status').innerText(), /windowOptics.mode/);
    await page.evaluate(config => {
      const c = document.getElementById('workspaceLightStudy').lightController;
      c.replaceDraft(config); c.setVisualization({ metric: 'sky', modeled: false });
    }, light.draft);
    await run(page, 'light');
    await authorAirflow(page);
    const airflow = await state(page, 'airflow');
    assert.equal(airflow.code, 'result'); assert.equal((airflow.svg.match(/data-flow=/g) || []).length, 2);
    assert.equal(airflow.fieldStatus, 'complete'); assert.ok(airflow.fieldCellCount > 32);
    assert.ok(airflow.maximumSpeedMps > 0);
    assert.match(airflow.svg, /data-field-cell=/); assert.match(airflow.svg, /data-field-vector=/);
    assert.match(airflow.svg, /data-legend="velocity"/); assert.match(airflow.svg, /NOT CFD/);
    airflow.flows.forEach(flow => assert.ok(Math.abs(flow - .9486832980505137) < 1e-9, `Unexpected signed flow: ${flow}`));
    await image(page, 'airflow', 'desktop');
    await page.locator('#hp-airflow-clear').click();
    assert.deepEqual((await state(page, 'airflow')).draft, airflow.draft);
    assert.doesNotMatch((await state(page, 'airflow')).svg, /data-flow=|data-field-cell=/);
    await run(page, 'airflow'); assert.deepEqual((await state(page, 'airflow')).flows, airflow.flows);
    await page.locator('#hp-airflow-floor').selectOption('upper');
    assert.equal((await state(page, 'airflow')).code, 'other-floor');
    await page.locator('#hp-airflow-floor').selectOption('ground');
    for (const [pressure, expected] of [[0, 'zero-flow'], [-12, 'result']]) {
      await page.evaluate(pressure => {
        const c = document.getElementById('workspaceAirflow').homePlannerAirflow;
        c.updateLink(c.getState().draft.links[0].id, { pressurePa: pressure });
      }, pressure);
      assert.equal((await run(page, 'airflow')).code, expected);
      const values = (await state(page, 'airflow')).flows;
      assert.ok(values.every(value => pressure === 0 ? value === 0 : value < 0));
    }
    assert.equal(await page.evaluate(() => HomePlanner.exportProject()), authored, 'study/view controls must preserve authored project');
    assert.equal(await page.evaluate(() => __studyWebGLRequests), 0, '2D studies must not opt into 3D');
    await page.evaluate(() => HomePlanner.execute({ type: 'update-window', id: 'ground:living-window', openFraction: 0 }));
    for (const study of ['light', 'airflow']) {
      const stale = await state(page, study);
      assert.equal(stale.status, undefined); assert.match(stale.message, /stale/i);
      assert.doesNotMatch(stale.svg, /data-sensor=|data-flow=|data-field-cell=/);
    }
    assert.equal((await run(page, 'airflow')).code, 'blocked');
    assert.match(await page.locator('#hp-airflow-view-status').innerText(), /closed|area/i);
    await page.evaluate(() => HomePlanner.execute({ type: 'update-window', id: 'ground:living-window', openFraction: 1 }));
    await run(page, 'airflow'); await navigate(page, 'light'); await run(page, 'light');
    for (const study of ['light', 'airflow']) {
      await navigate(page, study); await page.setViewportSize({ width: 390, height: 900 });
      await image(page, study, 'mobile');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${study}: no page overflow`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => HomePlannerWorkspace.navigate('design/layout'));
    assert.equal(await page.locator('[data-hp3d="lightStudy"]').isChecked(), false);
    await page.locator('[data-hp3d="open"]').click();
    await page.waitForFunction(() => /WebGL2 is unavailable/.test(document.querySelector('[data-hp3d="status"]').textContent));
    for (const study of ['light', 'airflow']) { await navigate(page, study); await image(page, study); }
    assert.ok(workers.some(url => url.endsWith('planner-light-worker.js')));
    assert.ok(workers.some(url => url.endsWith('planner-airflow-worker.js')));
    assert.deepEqual(test.errors, []);
    results.numerical = { lightSensors: light.values.length, positiveSkyCells: light.values.filter(value => value > 0).length,
      signedOpeningFlowsM3s: airflow.flows, velocityCells: airflow.fieldCellCount, maximumEstimatedSpeedMps: airflow.maximumSpeedMps,
      realWorkers: workers.length, webglFallback: true, mobileWidth: 390 };

    const empty = await openPage(browser, createFixture('sparse-unknown').project); contexts.push(empty.context);
    for (const study of ['light', 'airflow']) {
      await navigate(empty.page, study);
      await empty.page.locator(study === 'light' ? '#light-prepare' : '#hp-airflow-prepare').click();
      assert.equal((await state(empty.page, study)).code, 'empty');
      assert.match((await state(empty.page, study)).message, /Add and place rooms in Design/);
      await image(empty.page, study);
    }
    assert.deepEqual(empty.errors, []); results.emptyGeometry = true;
    const reservedProject = fixture();
    reservedProject.floors[0].legacy.context.plan.placed.push({
      req: { id: 'reserved-lift', type: 'lift', label: 'Synthetic reserved lift', reserveFootprint: true, seq: 4 },
      module: { x: 2, y: 2, w: 1, h: 1 }, carpet: { x: 2.05, y: 2.05, w: .9, h: .9 }
    }, {
      req: { id: 'reserved-stair', type: 'staircase', label: 'Synthetic reserved stair', reserveFootprint: true, seq: 5 },
      module: { x: 3.6, y: 1.3, w: 1, h: 1 }, carpet: { x: 3.65, y: 1.35, w: .9, h: .9 }
    });
    reservedProject.floors[0].legacy.context.plan.furniture =
      reservedProject.floors[0].legacy.context.plan.furniture.filter(item => item.roomId !== 'living');
    reservedProject.legacy = copy(reservedProject.floors[0].legacy);
    const reserved = await openPage(browser, reservedProject); contexts.push(reserved.context);
    assert.ok(await reserved.page.evaluate(() =>
      HomePlanner.getDrawingScene().scenes[0].rooms.some(room => room.reservedAreaM2 > 0)));
    await authorLight(reserved.page); await image(reserved.page, 'light', 'reserved');
    await authorAirflow(reserved.page); await image(reserved.page, 'airflow', 'reserved');
    assert.equal((await state(reserved.page, 'airflow')).fieldStatus, 'complete');
    assert.ok(await reserved.page.evaluate(() => {
      const source = HomePlanner.getDrawingScene().scenes[0], host = source.rooms.find(room => room.id === 'ground:living');
      const footprints = source.rooms.filter(room => room.reservesSpace).map(room => room.reservationFootprint);
      const light = document.getElementById('workspaceLightStudy').lightController.getState().result;
      const airflow = document.getElementById('workspaceAirflow').homePlannerAirflow.getState().result;
      const lightArea = light.sensors.reduce((sum, sensor) => sum + sensor.areaWeightM2, 0);
      const flowArea = airflow.planField.cells.reduce((sum, cell) => sum + cell.rect.w * cell.rect.h, 0);
      return footprints.length === 2 && Math.abs(lightArea - host.usableAreaM2) < 1e-8 && Math.abs(flowArea - host.usableAreaM2) < 1e-8 &&
        light.sensors.every(sensor => footprints.every(footprint => HomePlannerRegions.intersection(sensor.cell, footprint) === null)) &&
        airflow.planField.cells.every(cell => footprints.every(footprint => HomePlannerRegions.intersection(cell.rect, footprint) === null));
    }));
    assert.deepEqual(reserved.errors, []);
    results.reservedGeometryClippedToUsableArea = true;
    const unavailable = await openPage(browser, fixture(), { noWorker: true }); contexts.push(unavailable.context);
    for (const [study, draft] of [['light', light.draft], ['airflow', airflow.draft]]) {
      const page = unavailable.page; await navigate(page, study);
      await page.evaluate(({ study, draft }) => {
        const c = study === 'light' ? document.getElementById('workspaceLightStudy').lightController
          : document.getElementById('workspaceAirflow').homePlannerAirflow;
        c.prepare(); c.replaceDraft(draft);
      }, { study, draft });
      const failed = await run(page, study);
      assert.match(failed.error, /Worker/i); assert.equal(failed.status, undefined);
      const alert = page.locator(study === 'light' ? '#light-error' : '#hp-airflow-error');
      assert.ok(await alert.isVisible()); await image(page, study);
      await page.evaluate(study => {
        if (study === 'light') { delete window.HomePlannerLightDisplay; document.getElementById('workspaceLightStudy').lightController.prepare(); }
        else { delete window.HomePlannerAirflowDisplay; document.getElementById('workspaceAirflow').homePlannerAirflow.prepare(); }
      }, study);
      assert.equal((await state(page, study)).code, 'unavailable');
      assert.match(await alert.innerText(), /renderer unavailable/);
      assert.match(await page.locator(study === 'light' ? '#light-viewport' : '#hp-airflow-preview').innerText(), /renderer unavailable/);
    }
    assert.deepEqual(unavailable.errors, []); results.missingWorkersAndRenderers = true;
    if (artifacts) {
      const contact = await browser.newContext({ viewport: { width: 1300, height: 1060 } }); contexts.push(contact);
      const sheet = await contact.newPage();
      const screenshots = ['light-desktop', 'airflow-desktop', 'light-mobile', 'airflow-mobile'];
      await sheet.setContent('<body style="margin:0;background:white;font:14px sans-serif"><main style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        screenshots.map(name => `<section style="text-align:center"><p>${name} · synthetic study</p><img style="max-width:620px;height:465px;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(path.join(artifacts, name + '.png')).toString('base64')}"></section>`).join('') + '</main>');
      await sheet.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await sheet.screenshot({ path: path.join(artifacts, 'studies-contact-sheet.png') });
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
