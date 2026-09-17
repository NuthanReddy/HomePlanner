const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UI = require('../environment-ui.js');
const Data = require('../environment-data.js');
const source = fs.readFileSync(require.resolve('../environment-ui.js'), 'utf8');
const Sun = {
  resolveLocal(date, time) { return { instant: new Date(`${date}T${time}:00Z`) }; },
  dateAt(instant) { return instant.toISOString().slice(0, 10); }
};

function runtime() {
  const project = { id: 'runtime-site', site: { latitude: 1, longitude: 2, timeZone: 'UTC' }, environment: {} };
  const fields = new Map(), handlers = {}, requests = [], saved = [];
  const field = id => {
    if (!fields.has(id)) fields.set(id, { dataset: {}, checked: false, disabled: false, value: '' });
    return fields.get(id);
  };
  field('env-fetch-consent').checked = true;
  field('env-weather-start').value = '2024-01-01'; field('env-weather-end').value = '2024-01-01';
  let position = { latitude: 10.25, longitude: 20.75, accuracyM: 9, timestamp: 1 }, responseHook;
  const sandbox = {
    Date, DAY: 86400000, Sun, Data, requireNumber() {}, needData() {}, setStatus() {}, nice: String,
    value: id => field(id).value, by: field, render() {}, siteKey: p => JSON.stringify([p.id, p.site]),
    planner: { getProject: () => project, execute(command) {
      Object.assign(project.site, command.patch);
      Object.assign(project.environment, command.environmentPatch);
    } },
    bindClick: (id, error, callback) => { handlers[id] = callback; },
    bindForm: (id, error, callback) => { handlers[id] = callback; },
    syncForm(id, values) { for (const [key, value] of Object.entries(values)) field(key).value = value; field(id).dataset.dirty = ''; },
    drafts: { remove() {} }, formScope: id => id,
    requireAcknowledgement(id) { if (!field(id).checked) throw new Error('Consent required'); },
    buildArchiveRequest: UI.buildArchiveRequest, trimWeatherToInterval: UI.trimWeatherToInterval,
    saveEnvironment(value) { saved.push(value); Object.assign(project.environment, value); },
    root: {
      confirm: () => true, AbortController, setTimeout, clearTimeout,
      HomePlannerLocation: { detect: async () => ({ ...position }) },
      async fetch(url) {
        requests.push(new URL(url)); if (responseHook) responseHook();
        return { ok: true, json: async () => ({
          latitude: project.site.latitude, longitude: project.site.longitude, timezone: 'UTC',
          hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%',
            surface_pressure: 'hPa', wind_speed_10m: 'm/s', wind_direction_10m: '°' },
          hourly: { time: [1704070800], temperature_2m: [25], relative_humidity_2m: [60],
            surface_pressure: [950], wind_speed_10m: [3], wind_direction_10m: [90] }
        }) };
      }
    }
  };
  const detectStart = source.indexOf("      bindClick('env-detect'");
  const detectEnd = source.indexOf("      bindForm('env-building-form'", detectStart);
  const fetchStart = source.indexOf("      bindForm('env-fetch-form'");
  const fetchEnd = source.indexOf("      bindForm('env-solar-form'", fetchStart);
  assert.ok(detectStart > 0 && detectEnd > detectStart && fetchStart > 0 && fetchEnd > fetchStart);
  vm.runInNewContext('let locationOperation=0,weatherOperation=0,destroyed=false,requestController=null;\n' +
    'function cancelWeather(){weatherOperation++;requestController?.abort();}\n' +
    source.slice(detectStart, detectEnd) + source.slice(fetchStart, fetchEnd), sandbox);
  return { project, field, handlers, requests, saved, sandbox,
    setPosition(next) { position = next; }, onResponse(callback) { responseHook = callback; } };
}

test('weather reads each runtime detected location, never fixed city coordinates, and normalizes station pressure', async () => {
  const r = runtime();
  await r.handlers['env-detect']();
  assert.equal(r.requests.length, 0, 'detecting alone never fetches weather');
  await r.handlers['env-fetch-form']();
  assert.equal(r.requests[0].searchParams.get('latitude'), '10.25');
  assert.equal(r.requests[0].searchParams.get('longitude'), '20.75');
  assert.equal(r.saved[0].weather.records[0].pressurePa, 95000);
  assert.equal(r.saved[0].weather.source.request.site.latitude, 10.25);
  assert.equal(r.field('env-fetch-consent').checked, false);

  r.setPosition({ latitude: -12.5, longitude: 131.75, accuracyM: 7, timestamp: 2 });
  await r.handlers['env-detect']();
  assert.equal(r.requests.length, 1);
  r.field('env-fetch-consent').checked = true;
  await r.handlers['env-fetch-form']();
  assert.equal(r.requests[1].searchParams.get('latitude'), '-12.5');
  assert.equal(r.requests[1].searchParams.get('longitude'), '131.75');
  assert.equal(r.saved[1].weather.source.request.site.longitude, 131.75);
});

test('weather cannot publish after the runtime site changes or send unsaved location edits', async () => {
  const r = runtime();
  r.onResponse(() => { r.project.site.latitude = 3; });
  await r.handlers['env-fetch-form']();
  assert.equal(r.saved.length, 0);
  r.field('env-site-form').dataset.dirty = 'true';
  r.field('env-fetch-consent').checked = true;
  await assert.rejects(r.handlers['env-fetch-form'](), /unsaved site edits/);
  assert.equal(r.requests.length, 1);
});

test('recent-week shortcut selects dates without fetching or retaining consent for a changed request', () => {
  const r = runtime(), handlers = {}, changed = [];
  const start = source.indexOf("      bindClick('env-weather-recent'");
  const end = source.indexOf("      bindForm('env-fetch-form'", start);
  const FixedDate = class extends Date { static now() { return Date.parse('2026-09-18T06:00:00Z'); } };
  vm.runInNewContext(source.slice(start, end), { ...r.sandbox, Date: FixedDate,
    dateParts: value => new Date(`${value}T00:00:00Z`),
    onInput: event => changed.push(event.target),
    bindClick: (id, error, callback) => { handlers[id] = callback; } });
  handlers['env-weather-recent']();
  assert.equal(r.field('env-weather-start').value, '2026-09-05');
  assert.equal(r.field('env-weather-end').value, '2026-09-11');
  assert.equal(r.field('env-fetch-consent').checked, false);
  assert.equal(r.requests.length, 0);
  assert.deepEqual(changed, [r.field('env-weather-start')], 'uses the existing cancellation and draft-storage path');
});
