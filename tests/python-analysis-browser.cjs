/* Explicit isolated browser test; run against a separately launched local Flask service. */
const assert = require('node:assert/strict');
const path = require('node:path');

const base = process.env.HOMEPLANNER_ANALYSIS_URL || 'http://127.0.0.1:8018';
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) throw Error('Set PLAYWRIGHT_MODULE to the existing playwright-core package; no install is needed.');
const { chromium } = require(playwrightPath);
const executablePath = process.env.HOMEPLANNER_BROWSER ||
  path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const fixture = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/planner-python-analysis.css">
<style>body{font:15px system-ui,sans-serif;margin:12px;max-width:1100px}.clock{display:flex;flex-wrap:wrap;gap:6px}.clock input{max-width:150px}</style>
</head><body>
<div class="clock" id="sunForm">
<input id="sunLatitude" value="17.385"><input id="sunLongitude" value="78.4867">
<input id="sunTimeZone" value="Asia/Kolkata"><input id="sunDate" type="date" value="2026-06-21">
<input id="sunTime" type="time" value="12:00"><input id="sunOccurrence" value="">
</div>
<div id="workspaceAirflow" hidden><div id="hp-airflow-inputs"><input id="uncommitted-density"></div></div>
<div id="python-density-analysis"></div><div id="python-solar-analysis"></div>
<script src="/vendor/suncalc-2.0.1.js"></script><script src="/sun-model.js"></script>
<script src="/planner-regions.js"></script><script src="/building-physics.js"></script>
<script src="/planner-airflow.js"></script><script src="/planner-airflow-ui.js"></script>
<script src="/environment-data.js"></script>
<script>
const weather = EnvironmentData.parseWeatherJSON(JSON.stringify({
  kind:'scenario', source:{label:'Isolated synthetic weather fixture',elevationM:542},
  latitude:17.385,longitude:78.4867,records:[
    {timestamp:'2026-06-21T06:30:00Z',durationSeconds:3600,temperatureC:25,rhPct:0,pressurePa:95000},
    {timestamp:'2026-06-21T07:30:00Z',durationSeconds:3600,temperatureC:30,rhPct:80,pressurePa:95000}
  ]
}));
const project = {id:'isolated-python-browser',revision:1,site:{latitude:17.385,longitude:78.4867,timeZone:'Asia/Kolkata'},
  activeFloorId:'ground',floors:[{id:'ground',name:'Ground'}],environment:{weather}};
const listeners = new Set();
window.HomePlanner = {
  getProject(){return structuredClone(project)},getDrawingScene(){throw Error('No geometry required for density')},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},execute(){throw Error('Unexpected project mutation')}
};
window.airflow = HomePlannerAirflowUI.createController(HomePlanner);
document.getElementById('workspaceAirflow').homePlannerAirflow=airflow;
window.fixture = {before:JSON.stringify(project),project,listeners};
</script>
<script src="/planner-python-analysis.js"></script></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block' });
  const errors = [], requests = [];
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/python-analysis-fixture') return route.fulfill({ contentType: 'text/html', body: fixture });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/analysis/')) requests.push(request.url()); });
    await page.goto(`${base}/python-analysis-fixture`);
    await page.locator('#hp-python-density-calculate').waitFor();
    assert.equal(requests.length, 0, 'mounting must not request capabilities or perform analysis');
    assert.match(await page.locator('#hp-python-density-status').innerText(), /Not calculated/);
    const densityRequest = page.waitForResponse(response => response.url().endsWith('/api/analysis/air-density'));
    await page.locator('#hp-python-density-calculate').click();
    const dry = await (await densityRequest).json();
    await page.waitForFunction(() => document.querySelector('#python-density-analysis .hp-python-analysis').dataset.state === 'current');
    assert.equal(dry.engine.name, 'PsychroLib'); assert.equal(dry.inputs.rhPct, 0);
    assert.equal(dry.output.humidityRatioFloorApplied, true);
    assert.equal(await page.evaluate(() => airflow.getState().draft.densityKgM3), dry.output.densityKgM3);
    assert.match(await page.locator('#hp-python-density-output').innerText(), /kg\/m³/);
    assert.equal(await page.evaluate(() => JSON.stringify(fixture.project) === fixture.before), true);

    await page.locator('#hp-python-density-recordIndex').fill('2');
    const humidRequest = page.waitForResponse(response => response.url().endsWith('/api/analysis/air-density'));
    await page.locator('#hp-python-density-calculate').click();
    const humid = await (await humidRequest).json();
    await page.waitForFunction(() => document.querySelector('#python-density-analysis .hp-python-analysis').dataset.state === 'current');
    assert.equal(humid.inputs.rhPct, 80);
    assert.ok(humid.output.densityKgM3 < dry.output.densityKgM3);

    let release, fetched;
    const held = new Promise(resolve => { fetched = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const delayRoute = async route => {
      const response = await route.fetch(); fetched(); await hold;
      try { await route.fulfill({ response }); } catch (_) { /* The browser cancelled this stale job. */ }
    };
    await page.route('**/api/analysis/air-density', delayRoute);
    await page.locator('#hp-python-density-calculate').click(); await held;
    await page.evaluate(() => {
      const input = document.getElementById('uncommitted-density'); input.value = '1.271';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#uncommitted-density').inputValue(), '1.271');
    assert.equal(await page.evaluate(() => airflow.getState().draft.densityKgM3), humid.output.densityKgM3,
      'typing is not a controller commit, but must already cancel the pending estimate');
    await page.evaluate(() => airflow.setDraft({ densityKgM3: 1.271, sources: { densityKgM3: 'Later explicit user value' } }));
    release();
    await page.waitForFunction(() => document.querySelector('#python-density-analysis .hp-python-analysis').dataset.state === 'stale');
    assert.equal(await page.evaluate(() => airflow.getState().draft.densityKgM3), 1.271);
    assert.equal(await page.locator('#hp-python-density-output').innerText(), '');
    await page.unroute('**/api/analysis/air-density', delayRoute);

    async function solar() {
      const response = page.waitForResponse(item => item.url().endsWith('/api/analysis/solar-position'));
      await page.locator('#hp-python-solar-calculate').click();
      const result = await (await response).json();
      await page.waitForFunction(() => document.querySelector('#python-solar-analysis .hp-python-analysis').dataset.state === 'current');
      assert.equal(result.status, 'ok'); assert.equal(result.engine.name, 'pvlib');
      assert.equal(await page.locator('#hp-python-solar-output svg').count(), 1);
      return result;
    }
    const initialSolar = await solar();
    assert.ok(initialSolar.output.selected.apparentElevationDeg > 80);
    assert.equal(initialSolar.inputs.altitudeM, 542);
    assert.match(await page.locator('#hp-python-solar-output').innerText(), /geometric elevation/);
    await page.locator('#sunTime').fill('00:00');
    assert.ok((await solar()).output.selected.apparentElevationDeg < 0);

    for (const [id, value] of Object.entries({ sunLatitude: '40.7128', sunLongitude: '-74.006', sunTimeZone: 'America/New_York',
      sunTime: '12:00', sunDate: '2026-03-08' })) await page.locator(`#${id}`).fill(value);
    assert.equal((await solar()).output.day.durationHours, 23);
    await page.locator('#sunDate').fill('2026-11-01');
    assert.equal((await solar()).output.day.durationHours, 25);
    assert.match(await page.locator('#hp-python-solar-output').innerText(), /25 h civil day/);

    await page.locator('#hp-python-solar-mode').selectOption('manual');
    const beforeMissing = requests.length;
    await page.locator('#hp-python-solar-calculate').click();
    assert.equal(requests.length, beforeMissing, 'missing conditions must not invoke Python without acknowledgement');
    assert.match(await page.locator('#hp-python-solar-status').innerText(), /acknowledgement/);
    await page.locator('#hp-python-solar-acknowledgeReferenceAtmosphere').check();
    const reference = await solar();
    assert.equal(reference.inputs.altitudeM, 0);
    assert.equal(reference.inputs.pressurePa, 101325);
    assert.equal(reference.inputs.temperatureC, 15);
    assert.deepEqual(reference.inputs.referenceFields, ['altitudeM', 'pressurePa', 'temperatureC']);

    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, viewport: innerWidth,
      labelled: [...document.querySelectorAll('.hp-python-analysis input, .hp-python-analysis select')]
        .every(input => document.querySelector('label[for="' + input.id + '"]')),
    }));
    assert.ok(layout.width <= layout.viewport, 'chart may scroll internally, not overflow the mobile page');
    assert.equal(layout.labelled, true);

    const offlineRoute = route => route.fulfill({ status: 404, body: 'Static server' });
    await page.route('**/api/analysis/air-density', offlineRoute);
    await page.locator('#hp-python-density-calculate').click();
    await page.waitForFunction(() => document.querySelector('#python-density-analysis .hp-python-analysis').dataset.state === 'unavailable');
    assert.match(await page.locator('#hp-python-density-status').innerText(), /\\\.venv\\Scripts\\python\.exe -B app\.py/);
    assert.equal(await page.evaluate(() => airflow.getState().draft.densityKgM3), 1.271);
    assert.equal(await page.evaluate(() => JSON.stringify(fixture.project) === fixture.before), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', densityDryKgM3: dry.output.densityKgM3,
      densityHumidKgM3: humid.output.densityKgM3, psychrolib: dry.engine.version, pvlib: initialSolar.engine.version,
      cases: ['no automatic requests', 'normalized 0%/humid weather', 'real airflow controller draft', 'stale edit guard',
        'solar midday/night', '23/25 hour civil days', 'explicit reference acknowledgement', 'mobile/native labels', 'static-service guidance'],
      apiRequests: requests.length, pageErrors: errors.length }, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
