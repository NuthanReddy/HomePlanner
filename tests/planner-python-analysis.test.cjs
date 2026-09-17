const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../planner-python-analysis.js');
const AirflowUI = require('../planner-airflow-ui.js');
const Airflow = require('../planner-airflow.js');
const Data = require('../environment-data.js');
const HomeSun = require('../sun-model.js');
const copy = value => JSON.parse(JSON.stringify(value));

function setup({ weather = true, protocol = 'http:', timeoutMs } = {}) {
  const listeners = new Set(), requests = [], edits = [];
  let project = { id: 'python-test-project', revision: 1, activeFloorId: 'ground', floors: [{ id: 'ground', name: 'Ground' }],
    site: { latitude: 17.385, longitude: 78.4867, timeZone: 'Asia/Kolkata' }, environment: {} };
  if (weather) project.environment.weather = Data.parseWeatherJSON(JSON.stringify({
    kind: 'scenario', source: { label: 'Synthetic normalized weather, not measurements', elevationM: 542 },
    latitude: 17.385, longitude: 78.4867,
    records: [0, 1].map(index => ({ timestamp: `2026-06-21T0${6 + index}:30:00Z`, durationSeconds: 3600,
      temperatureC: 25 + index, rhPct: index ? 60 : 0, pressurePa: 95000 })),
  }));
  let solarInput = { ...project.site, date: '2026-06-21', time: '12:00', occurrence: '' };
  const planner = {
    getProject: () => copy(project), getDrawingScene: () => { throw Error('Density must not discover or rebuild geometry'); },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    execute(command) { edits.push(command); throw Error('Python analysis must not mutate the project'); },
  };
  const airflow = AirflowUI.createController(planner, { HomePlannerAirflow: Airflow });
  const runtime = { location: { protocol, hostname: '127.0.0.1' }, AbortController, HomeSun, setTimeout, clearTimeout };
  const ui = UI.createController({ planner, airflowController: airflow, getSolarInput: () => copy(solarInput),
    runtime, timeoutMs,
    fetch(path, options) { return new Promise((resolve, reject) => requests.push({ path, options,
      input: JSON.parse(options.body), resolve, reject })); } });
  const mutate = (callback, notify = true) => { callback(project); if (notify) listeners.forEach(listener => listener()); };
  const setSolar = patch => { solarInput = { ...solarInput, ...patch }; ui.sync(); };
  const dispose = () => { ui.dispose(); airflow.dispose(); };
  return { ui, airflow, planner, requests, edits, mutate, setSolar, dispose };
}
function densityResponse(request, density = 1.17556) {
  return { status: 'ok', kind: 'air-density', inputs: copy(request.input),
    output: { densityKgM3: density, humidityRatioKgKgDryAir: .01, vapourPressurePa: 1900 },
    engine: { name: 'PsychroLib', version: '2.5.0' }, assumptions: ['Synthetic test response; real-library values tested by unittest.'] };
}
function reply(request, value = densityResponse(request), status = 200) {
  request.resolve({ ok: status >= 200 && status < 300, status, json: async () => value });
}
function solarResponse(request) {
  const instantUTC = request.input.instantUTC, selectedDate = new Date(instantUTC);
  const start = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate());
  const position = (time, elevation) => ({ instantUTC: new Date(time).toISOString(), localTime: new Date(time).toISOString(),
    azimuthDeg: 135, geometricElevationDeg: elevation, apparentElevationDeg: elevation + .1, aboveHorizon: elevation > 0 });
  const path = [position(start, -40), position(start + 12 * 3600e3, 45), position(start + 24 * 3600e3, -40)];
  return { status: 'ok', kind: 'solar-position', inputs: { ...copy(request.input),
    ...Object.fromEntries(Object.entries(UI.REFERENCE).map(([key, value]) => [key, request.input[key] ?? value])) },
    output: { selected: position(Date.parse(instantUTC), 45), path,
      day: { durationHours: 24, sampleCount: path.length, sampleMinutes: request.input.sampleMinutes } },
    engine: { name: 'pvlib', version: '0.15.2' }, assumptions: ['Synthetic response for UI lifecycle tests.'] };
}

test('construction, sync and unrelated selection do not fetch, calculate, discover or edit', () => {
  const { ui, requests, edits, mutate, dispose } = setup();
  assert.equal(ui.getState().density.status, 'unknown');
  assert.equal(ui.getState().densityInputs.mode, 'weather');
  assert.equal(ui.getState().weatherCount, 2);
  mutate(project => { project.name = 'Rename only'; project.activeFloorId = 'upper'; project.revision++; });
  ui.sync();
  assert.equal(requests.length, 0); assert.deepEqual(edits, []);
  assert.equal(UI.mount({ document: { getElementById() { return null; } } }), null);
  dispose();
});

test('one explicit calculation derives normalized weather including 0% RH and uses the actual controller draft API', async () => {
  const { ui, airflow, requests, edits, planner, dispose } = setup();
  airflow.setDraft({ sources: { pressurePa: 'Keep existing forcing source' } });
  const before = planner.getProject(), pending = ui.calculateDensity();
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.path, '/api/analysis/air-density');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.input.temperatureC, 25); assert.equal(request.input.rhPct, 0);
  assert.equal(request.input.pressurePa, 95000);
  assert.equal(request.input.source.recordTimestamp, '2026-06-21T06:30:00.000Z');
  assert.equal(airflow.getState().draft.densityKgM3, null);
  reply(request, densityResponse(request, 1.1));
  assert.equal((await pending).output.densityKgM3, 1.1);
  assert.equal(airflow.getState().draft.densityKgM3, 1.1);
  assert.equal(airflow.getState().draft.sources.pressurePa, 'Keep existing forcing source');
  assert.match(airflow.getState().draft.sources.densityKgM3, /PsychroLib 2\.5\.0.*95000 Pa.*2026-06-21/);
  assert.equal(ui.getState().density.status, 'current');
  assert.equal(ui.getState().density.applied, true);
  assert.deepEqual(planner.getProject(), before); assert.deepEqual(edits, []);
  ui.sync(); assert.equal(ui.getState().density.status, 'current');
  dispose();
});

test('manual familiar hPa inputs convert once; blanks are not zeros; compute-only does not apply', async () => {
  const { ui, airflow, requests, dispose } = setup({ weather: false });
  assert.equal(ui.getState().densityInputs.mode, 'manual');
  await ui.calculateDensity(); assert.equal(requests.length, 0);
  assert.equal(ui.getState().density.status, 'failed');
  ui.setDensityInputs({ temperatureC: '25', rhPct: '0', pressureHpa: '1013.25' });
  const pending = ui.calculateDensity({ apply: false });
  assert.equal(requests[0].input.pressurePa, 101325);
  assert.equal(requests[0].input.rhPct, 0);
  reply(requests[0]); await pending;
  assert.equal(airflow.getState().draft.densityKgM3, null);
  assert.equal(ui.getState().density.status, 'current');
  ui.setDensityInputs({ rhPct: '' });
  await ui.calculateDensity(); assert.equal(requests.length, 1);
  assert.equal(ui.getState().density.status, 'failed'); dispose();
});

test('unknown weather inputs block instead of fabricating density from location', async () => {
  const { ui, requests, mutate, dispose } = setup();
  mutate(project => {
    project.environment.weather.records[0].temperatureC = null;
    project.environment.weather.records[0].missing.push('temperatureC');
  });
  await ui.calculateDensity(); assert.equal(requests.length, 0);
  assert.match(ui.getState().density.message, /Temperature/);
  mutate(project => { project.environment.weather.records[0].temperatureC = 25; });
  await ui.calculateDensity(); assert.equal(requests.length, 0, 'explicit missing mask is authoritative');
  dispose();
});

test('pending density cannot overwrite a manually edited density or provenance', async () => {
  const { ui, airflow, requests, dispose } = setup();
  const pending = ui.calculateDensity();
  airflow.setDraft({ densityKgM3: 1.31, sources: { densityKgM3: 'Reviewed user value' } });
  assert.equal(requests[0].options.signal.aborted, true);
  reply(requests[0]); assert.equal(await pending, null);
  assert.equal(airflow.getState().draft.densityKgM3, 1.31);
  assert.equal(airflow.getState().draft.sources.densityKgM3, 'Reviewed user value');
  assert.equal(ui.getState().density.status, 'stale'); dispose();
});

test('uncommitted native airflow input cancels before the public draft changes', async () => {
  const { ui, airflow, requests, dispose } = setup();
  const pending = ui.calculateDensity();
  ui.notifyDensityDraftInput();
  reply(requests[0]); assert.equal(await pending, null);
  assert.equal(airflow.getState().draft.densityKgM3, null);
  assert.equal(ui.getState().density.status, 'stale');
  assert.match(ui.getState().density.message, /being edited/); dispose();
});

test('selected scenario changes cancel density even if input density is still blank', async () => {
  const { ui, airflow, requests, dispose } = setup();
  const pending = ui.calculateDensity(), first = airflow.getState().selectedScenarioId;
  airflow.addScenario('Another scenario');
  assert.notEqual(airflow.getState().selectedScenarioId, first);
  reply(requests[0]); assert.equal(await pending, null);
  assert.equal(airflow.getState().draft.densityKgM3, null); dispose();
});

test('project switch, return, and same-id weather replacement reject stale work and preserve project-owned forms', async () => {
  const { ui, requests, airflow, mutate, dispose } = setup();
  ui.setDensityInputs({ recordIndex: '2' });
  const pending = ui.calculateDensity();
  mutate(project => { project.id = 'other-project'; });
  assert.equal(ui.getState().densityInputs.recordIndex, '1');
  ui.setDensityInputs({ recordIndex: '1', sourceNote: 'Other project draft' });
  mutate(project => { project.id = 'python-test-project'; });
  assert.equal(ui.getState().densityInputs.recordIndex, '2');
  reply(requests[0]); assert.equal(await pending, null);
  assert.equal(airflow.getState().draft.densityKgM3, null);
  const newer = ui.calculateDensity();
  mutate(project => { project.environment.weather.records[1].pressurePa = 97000; }, false);
  reply(requests[1]); assert.equal(await newer, null, 'completion rechecks content without relying on a notification/revision');
  assert.equal(airflow.getState().draft.densityKgM3, null); dispose();
});

test('latest-response guards reject older jobs and cancellation without holding promises open', async () => {
  const { ui, requests, airflow, dispose } = setup();
  const first = ui.calculateDensity(), second = ui.calculateDensity();
  assert.equal(await first, null);
  reply(requests[0], densityResponse(requests[0], 1.9));
  assert.equal(airflow.getState().draft.densityKgM3, null);
  reply(requests[1], densityResponse(requests[1], 1.05)); await second;
  assert.equal(airflow.getState().draft.densityKgM3, 1.05);
  const third = ui.calculateDensity(); ui.cancel('density');
  assert.equal(await third, null); reply(requests[2]);
  assert.equal(airflow.getState().draft.densityKgM3, 1.05);
  assert.equal(ui.getState().density.status, 'cancelled'); dispose();
});

test('floor selection, rename, other weather records and no-op input changes keep a relevant result current', async () => {
  const { ui, requests, mutate, dispose } = setup();
  const pending = ui.calculateDensity();
  mutate(project => {
    project.activeFloorId = 'other-floor'; project.name = 'Unrelated'; project.revision++;
    project.environment.weather.records[1].pressurePa = 96500;
  });
  ui.setDensityInputs({ recordIndex: '1' });
  reply(requests[0]); assert.ok(await pending);
  mutate(project => { project.name = 'Renamed again'; });
  assert.equal(ui.getState().density.status, 'current');
  mutate(project => { project.site.latitude = 18; });
  assert.equal(ui.getState().density.status, 'stale'); dispose();
});

test('file mode and static/offline service errors are actionable, with no unsolicited requests', async () => {
  const file = setup({ protocol: 'file:' });
  assert.equal(file.ui.getState().density.status, 'unavailable');
  await file.ui.calculateDensity(); await file.ui.calculateSolar();
  assert.equal(file.requests.length, 0);
  assert.match(file.ui.getState().solar.message, /\\\.venv\\Scripts\\python\.exe -B app\.py/);
  assert.match(file.ui.getState().solar.message, /http:\/\/127\.0\.0\.1:8000/); file.dispose();
  const offline = setup();
  const pending = offline.ui.calculateDensity(); offline.requests[0].reject(new TypeError('Failed to fetch'));
  assert.equal(await pending, null); assert.equal(offline.ui.getState().density.status, 'unavailable');
  const missing = offline.ui.calculateDensity(); reply(offline.requests[1], {}, 404); await missing;
  assert.match(offline.ui.getState().density.message, /not file:\/\/ or a static server/);
  const absent = offline.ui.calculateDensity();
  reply(offline.requests[2], { error: { code: 'dependency_unavailable', message: 'Do not show a private stack' } }, 503);
  await absent;
  assert.match(offline.ui.getState().density.message, /requirements-analysis\.txt/);
  assert.doesNotMatch(offline.ui.getState().density.message, /private stack/);
  offline.dispose();
});

test('timeout, disposal and malformed responses cannot publish success or mutate density', async () => {
  const { ui, airflow, requests, dispose } = setup({ timeoutMs: 5 });
  assert.equal(await ui.calculateDensity(), null);
  assert.equal(ui.getState().density.status, 'failed'); assert.match(ui.getState().density.message, /timed out/);
  assert.equal(requests[0].options.signal.aborted, true);
  const pending = ui.calculateDensity(); reply(requests[1], densityResponse(requests[1], 0)); await pending;
  assert.equal(ui.getState().density.status, 'failed');
  assert.equal(airflow.getState().draft.densityKgM3, null);
  const last = ui.calculateDensity(); dispose();
  assert.equal(await last, null); reply(requests[2]);
});

test('a response for different inputs or provenance is not applied', async () => {
  const { ui, airflow, requests, dispose } = setup();
  const pending = ui.calculateDensity(), mismatched = densityResponse(requests[0]);
  mismatched.inputs.temperatureC = 55; reply(requests[0], mismatched);
  assert.equal(await pending, null);
  assert.equal(ui.getState().density.status, 'failed');
  const second = ui.calculateDensity(), wrongSource = densityResponse(requests[1]);
  wrongSource.inputs.source.label = 'Another record'; reply(requests[1], wrongSource);
  assert.equal(await second, null);
  assert.equal(airflow.getState().draft.densityKgM3, null); dispose();
});

test('weather-selected solar uses station altitude and the actual HomeSun UTC/IANA resolver, never guessed defaults', async () => {
  const { ui, requests, planner, dispose } = setup();
  const before = planner.getProject(), pending = ui.calculateSolar(), request = requests[0];
  assert.equal(request.path, '/api/analysis/solar-position');
  assert.equal(request.input.instantUTC, '2026-06-21T06:30:00.000Z');
  assert.equal(request.input.altitudeM, 542); assert.equal(request.input.temperatureC, 25);
  assert.equal(request.input.pressurePa, 95000);
  assert.equal(request.input.acknowledgeReferenceAtmosphere, false);
  reply(request, solarResponse(request)); assert.ok(await pending);
  assert.equal(ui.getState().solar.status, 'current');
  assert.deepEqual(planner.getProject(), before); dispose();
});

test('missing solar atmosphere requires explicit acknowledgement and leaves absent values null for the API', async () => {
  const { ui, requests, dispose } = setup({ weather: false });
  await ui.calculateSolar(); assert.equal(requests.length, 0);
  assert.match(ui.getState().solar.message, /acknowledgement/);
  ui.setSolarInputs({ acknowledgeReferenceAtmosphere: true });
  const pending = ui.calculateSolar();
  assert.equal(requests[0].input.altitudeM, null); assert.equal(requests[0].input.temperatureC, null);
  assert.equal(requests[0].input.pressurePa, null);
  reply(requests[0], solarResponse(requests[0])); await pending;
  assert.equal(ui.getState().solar.result.inputs.pressurePa, 101325);
  ui.setSolarInputs({ altitudeM: '400' });
  assert.equal(ui.getState().solarInputs.acknowledgeReferenceAtmosphere, false);
  assert.equal(ui.getState().solar.status, 'stale'); dispose();
});

test('solar DST gaps/repeats are explicit and solar selection changes revoke pending work', async () => {
  const { ui, requests, setSolar, dispose } = setup();
  setSolar({ latitude: 40.7128, longitude: -74.006, timeZone: 'America/New_York', date: '2026-03-08', time: '02:30' });
  await ui.calculateSolar(); assert.equal(requests.length, 0); assert.equal(ui.getState().solar.status, 'failed');
  setSolar({ date: '2026-11-01', time: '01:30', occurrence: '' });
  await ui.calculateSolar(); assert.equal(requests.length, 0);
  setSolar({ occurrence: 'later' });
  const pending = ui.calculateSolar();
  assert.equal(requests[0].input.instantUTC, '2026-11-01T06:30:00.000Z');
  setSolar({ time: '12:00' }); reply(requests[0], solarResponse(requests[0]));
  assert.equal(await pending, null); assert.equal(ui.getState().solar.status, 'stale'); dispose();
});

test('only selected, relevant solar weather fields affect freshness; changing the density record does not', async () => {
  const { ui, requests, mutate, dispose } = setup();
  const pending = ui.calculateSolar();
  ui.setDensityInputs({ recordIndex: '2' });
  mutate(project => { project.environment.weather.records[0].rhPct = 80; project.revision++; });
  reply(requests[0], solarResponse(requests[0])); assert.ok(await pending);
  assert.equal(ui.getState().solar.status, 'current');
  mutate(project => { project.environment.weather.records[0].temperatureC = 27; });
  assert.equal(ui.getState().solar.status, 'stale'); dispose();
});

test('solar chart plots actual returned geometric/apparent/night values with accessible labels and escaped metadata', () => {
  const request = { input: { instantUTC: '2026-06-21T06:30:00Z', date: '2026-06-21', timeZone: 'UTC<script>evil</script>' } };
  const result = solarResponse(request), svg = UI.solarChart(result);
  assert.match(svg, /role="img"/); assert.match(svg, /pvlib daily solar elevation/);
  assert.match(svg, /hp-python-geometric/); assert.match(svg, /hp-python-apparent/);
  assert.match(svg, /0° horizon/); assert.match(svg, /-90°/);
  assert.match(svg, /Geometric and apparent elevation, including night/);
  assert.doesNotMatch(svg, /<script>/);
  result.output.path[1].apparentElevationDeg = 50;
  assert.notEqual(UI.solarChart(result), svg, 'chart geometry comes from returned numerical samples');
});
