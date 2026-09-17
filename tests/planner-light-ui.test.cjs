'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const UI = require('../planner-light-ui.js'), L = require('../planner-light.js');
const Display = require('../planner-light-display.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const ref = { floorId: 'ground', entityId: 'ground:living' };
function homeSun() {
  const sandbox = { SunCalc: require('../vendor/suncalc-2.0.1.js') };
  const source = fs.readFileSync(require.resolve('../sun-model.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  return sandbox.HomeSun;
}
const Sun = homeSun();
class TestEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
function setup({ pending = false, subscribe = true, fixture = 'multiple-floors' } = {}) {
  const project = createFixture(fixture).project;
  for (const floor of project.floors) floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project), requests = [], events = [], calls = { cancel: 0, dispose: 0, captures: 0 };
  const bridge = { ...planner, subscribe: subscribe ? planner.subscribe : undefined,
    getDrawingScene() { calls.captures++; return planner.getDrawingScene(); } };
  const runtime = { Blob, CustomEvent: TestEvent, document: { dispatchEvent(event) { events.push(event); } },
    HomeSun: Sun, HomePlannerLight: L, HomePlannerLightDisplay: Display,
    HomePlannerLightRunner: { createRunner() {
      return { run(input, progress) {
        progress({ completedIntervals: 0, totalIntervals: input.config.samples.length, processedRays: 0 });
        if (pending) return new Promise((resolve, reject) => requests.push({ input, resolve, reject }));
        requests.push({ input });
        return Promise.resolve(copy(L.run(input.scene, input.config, { expectedPhysicalFingerprint: input.expectedPhysicalFingerprint })));
      }, cancel() { calls.cancel++; }, dispose() { calls.dispose++; } };
    } }
  };
  return { planner, bridge, runtime, requests, calls, events, ui: UI.createController(bridge, runtime) };
}
function author(ui, extra = {}) {
  assert.ok(ui.prepare(), ui.getState().error);
  assert.ok(ui.addRoom(ref), ui.getState().error);
  const plane = ui.getState().draft.workplanes[0];
  assert.ok(ui.updateWorkplane(plane.id, { heightM: .8, spacingM: 3 }));
  assert.ok(ui.setDraft({ sky: { enabled: true, radialBands: 2, azimuthSectors: 8 },
    minSunAltitudeDeg: 1, windowOptics: { mode: 'ideal-clear' }, ...extra }));
  for (const side of ['front', 'right', 'rear', 'left']) ui.setNeighbor(side, 'clear');
  for (const floor of ui.getState().inventory.floors)
    ui.setRoof(floor.floorId, { state: floor.roofThicknessM == null ? 'none' : 'supplied',
      source: 'Explicit analytical context declaration; actual roofs retained' });
  ui.setSite({ latitudeDeg: 17.385, longitudeDeg: 78.4867, timeZone: 'Asia/Kolkata' });
  ui.setSelection({ date: '2026-09-15', startTime: '11:00', endTime: '12:00', strideMinutes: 30 });
  assert.ok(ui.prepareSunIntervals(), ui.getState().error);
  return plane.id;
}
function resolve(request) {
  const { input } = request;
  request.resolve(copy(L.run(input.scene, input.config, { expectedPhysicalFingerprint: input.expectedPhysicalFingerprint })));
}
test('repairable draft assumes no physical heights, site, roof, optics or neighbor clearance; navigation never runs', () => {
  const { ui, calls, planner, requests } = setup();
  const state = ui.getState();
  assert.equal(state.draft.site, undefined);
  assert.equal(state.draft.minSunAltitudeDeg, null);
  assert.equal(state.draft.windowOptics.mode, null);
  assert.deepEqual(state.draft.workplanes, []);
  assert.deepEqual(state.draft.roofContext, []);
  for (const item of Object.values(state.draft.neighbors)) assert.equal(item.state, 'unknown');
  assert.deepEqual(state.visualization, { metric: 'direct', intervalIndex: 0, modeled: false, showElectrical: false });
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(calls.captures, 0); assert.equal(requests.length, 0);
  ui.prepare(); assert.equal(calls.captures, 1);
  ui.addRoom(ref); assert.equal(ui.getState().draft.workplanes[0].heightM, null);
  assert.equal(ui.getState().draft.workplanes[0].spacingM, .5);
  assert.equal(ui.addRoom(ref), null);
  ui.dispose();
});
test('native study inputs and immutable worker results use actual bridge without physical mutation', async () => {
  const { ui, planner, requests, events } = setup(), before = planner.exportProject();
  author(ui);
  const result = await ui.run();
  assert.ok(result, ui.getState().error); assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(result.config), JSON.stringify(ui.getState().draft));
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.config.workplanes[0]));
  assert.ok(Object.isFrozen(requests[0].input.scene));
  assert.equal(events.at(-1).type, 'homeplanner:light-result');
  assert.equal(events.at(-1).detail.result, result); assert.equal(events.at(-1).detail.stale, false);
  assert.equal(planner.exportProject(), before);
  assert.ok(ui.getState().preview.svg);
  ui.dispose(); assert.equal(events.at(-1).detail.result, null);
});
test('HomeSun prepares continuous 23-hour and 25-hour DST civil days, clips final interval and uses exact midpoint', () => {
  for (const [date, endDate, hours] of [['2026-03-08', '2026-03-09', 23], ['2026-11-01', '2026-11-02', 25]]) {
    const site = { latitudeDeg: 40.7, longitudeDeg: -74, timeZone: 'America/New_York' };
    const result = UI.prepareIntervals(Sun, { date, endDate, startTime: '00:00', endTime: '00:00', strideMinutes: 53 }, site);
    assert.equal((Date.parse(result.period.endUTC) - Date.parse(result.period.startUTC)) / 3600000, hours);
    assert.equal(result.samples[0].startUTC, result.period.startUTC);
    assert.equal(result.samples.at(-1).endUTC, result.period.endUTC);
    result.samples.forEach((sample, index) => {
      const start = Date.parse(sample.startUTC), end = Date.parse(sample.endUTC), middle = Date.parse(sample.sampleUTC);
      assert.ok(end > start); assert.equal(middle, (start + end) / 2);
      if (index) assert.equal(sample.startUTC, result.samples[index - 1].endUTC);
      assert.deepEqual(sample.sunENU, copy(Sun.position(new Date(middle), site.latitudeDeg, site.longitudeDeg).vector));
    });
  }
});
test('ambiguous/nonexistent local times, invalid or backward periods and excessive budgets reject without UTC offset guesses', () => {
  const site = { latitudeDeg: 40.7, longitudeDeg: -74, timeZone: 'America/New_York' };
  const selection = { date: '2026-11-01', startTime: '01:30', endTime: '02:30', strideMinutes: 30 };
  assert.throws(() => UI.prepareIntervals(Sun, selection, site), /occurs twice/);
  const early = UI.prepareIntervals(Sun, { ...selection, startOccurrence: 'earlier' }, site);
  const late = UI.prepareIntervals(Sun, { ...selection, startOccurrence: 'later' }, site);
  assert.equal(early.samples.length, 4); assert.equal(late.samples.length, 2);
  assert.throws(() => UI.prepareIntervals(Sun, { ...selection, date: '2026-03-08', startTime: '02:30' }, site), /does not exist/);
  assert.throws(() => UI.prepareIntervals(Sun, { ...selection, startTime: '03:00' }, site), /after start/);
  assert.throws(() => UI.prepareIntervals(Sun, { ...selection, startTime: '00:00', endDate: '2026-11-04', strideMinutes: 1 }, site), /2048/);
  assert.throws(() => UI.prepareIntervals(Sun, selection, { ...site, latitudeDeg: null }), /unknown coordinates/);
});
test('midday/night vectors and classification match existing degree-based HomeSun helper, not a radian API', async () => {
  const { ui } = setup(); author(ui);
  ui.setSelection({ startTime: '12:00', endTime: '13:00' }); ui.prepareSunIntervals();
  const day = await ui.run(); assert.equal(day.direct.masks[0].directSunStatus, 'sun-above-horizon');
  ui.setSelection({ startTime: '00:00', endTime: '01:00' }); ui.prepareSunIntervals();
  const night = await ui.run(); assert.equal(night.direct.masks[0].directSunStatus, 'night');
  assert.ok(night.direct.masks[0].directPathWeights.every(value => value === 0));
  ui.dispose();
});
test('date, site and stride edits discard old sampled period; ambiguous resolution is explicit and import stays unverified', async () => {
  const { ui, events } = setup(); author(ui); await ui.run();
  ui.setSelection({ date: '2026-09-16' });
  assert.equal(ui.getState().result, null); assert.equal(ui.getState().draft.period, null);
  assert.deepEqual(ui.getState().draft.samples, []); assert.equal(events.at(-1).detail.stale, true);
  ui.prepareSunIntervals(); const imported = copy(ui.getState().draft);
  imported.site = { latitudeDeg: 8, longitudeDeg: 10, timeZone: 'UTC' };
  imported.label = '=HYPERLINK("untrusted")'; imported.samples[0].sunAnglesDeg = { altitudeDeg: 45, azimuthDeg: 180 };
  delete imported.samples[0].sunENU;
  assert.ok(ui.importConfig(JSON.stringify(imported)));
  assert.deepEqual(ui.getState().draft, imported);
  assert.match(ui.getState().intervalSource, /not independently verified/);
  ui.setSite({ longitudeDeg: 11 }); assert.equal(ui.getState().draft.period, null);
  const previous = copy(ui.getState().draft);
  assert.equal(ui.importConfig('{"bogus":1}'), null); assert.deepEqual(ui.getState().draft, previous);
  ui.dispose();
});
test('Use project site and Sun Path selections are explicit draft copies preserving unknown missing coordinates', () => {
  const { ui, planner } = setup(), before = planner.exportProject();
  assert.equal(ui.getState().draft.site, undefined);
  assert.deepEqual(ui.useProjectSite(), { latitudeDeg: planner.getProject().site.latitude,
    longitudeDeg: planner.getProject().site.longitude, timeZone: planner.getProject().site.timeZone });
  assert.match(ui.getState().siteSource, /may be a project default/);
  const controls = { sunDate: '2026-11-01', sunTime: '01:30', sunTimeZone: 'America/New_York', sunLatitude: '', sunLongitude: '-74', sunOccurrence: 'later' };
  ui.useSunPathSelections({ getElementById(id) { return id in controls ? { value: controls[id] } : null; } });
  assert.equal(ui.getState().draft.site.latitudeDeg, null);
  assert.equal(ui.getState().selection.startOccurrence, 'later');
  assert.equal(ui.prepareSunIntervals(), null); assert.match(ui.getState().error, /unknown coordinates/);
  assert.equal(planner.exportProject(), before); ui.dispose();
});
test('box references are exact and editable across corners; roof declarations only target existing floors', () => {
  const { ui, planner } = setup(), before = planner.exportProject(); ui.prepare(); ui.addBox();
  const id = ui.getState().draft.neighborBoxes[0].id;
  assert.equal(ui.getState().draft.neighborBoxes[0].heightM, null);
  assert.equal(ui.setNeighbor('front', 'modeled', ['missing']), null);
  ui.updateBox(id, { id: 'corner', x: -10, y: -10, w: 5, h: 5, baseM: 0, heightM: 7, transmittance: 0 });
  ui.setNeighbor('front', 'modeled', ['corner']); ui.setNeighbor('left', 'modeled', ['corner']);
  assert.equal(ui.getState().draft.neighborBoxes.length, 1);
  assert.equal(ui.setRoof('invented-floor', { state: 'none' }), null);
  ui.setRoof('ground', { state: 'none', source: 'Analytical declaration, no physical mutation' });
  assert.equal(planner.exportProject(), before);
  ui.removeBox('corner'); assert.deepEqual(ui.getState().draft.neighbors.front.boxIds, []);
  ui.dispose();
});
test('cancel and same-ID same-revision physical replacement reject pending publication; current result invalidates to null event', async () => {
  const { ui, bridge, events, requests, calls } = setup({ pending: true, subscribe: false }); author(ui);
  const job = ui.run(); ui.cancel(); resolve(requests[0]); assert.equal(await job, null); assert.ok(calls.cancel > 0);
  const next = ui.run(); const original = bridge.getDrawingScene;
  bridge.getDrawingScene = () => {
    const scene = copy(original()); scene.scenes[0].rooms[0].rect.w += .1; return scene;
  };
  resolve(requests[1]); assert.equal(await next, null); assert.equal(ui.getState().result, null);
  assert.equal(events.at(-1).detail.result, null); assert.equal(events.at(-1).detail.stale, true);
  ui.dispose();
});
test('new date selection cancels pending worker and cannot publish a stale sampled period', async () => {
  const { ui, requests, calls } = setup({ pending: true }); author(ui);
  const pending = ui.run(); ui.setSelection({ endTime: '13:00' });
  resolve(requests[0]); assert.equal(await pending, null);
  assert.equal(ui.getState().draft.period, null); assert.ok(calls.cancel); ui.dispose();
});
test('completed known-model evidence is revoked by actual window operation and project switch cancels pending generation', async () => {
  const { ui, planner, events } = setup({ fixture: 'furnished-single' }); author(ui);
  const result = await ui.run(); assert.equal(result.complete, true);
  planner.execute({ type: 'update-window', id: 'ground:living-window', openFraction: 0 });
  assert.equal(ui.getState().result, null); assert.equal(events.at(-1).detail.result, null);
  assert.equal(events.at(-1).detail.stale, true); ui.dispose();
  const pending = setup({ pending: true }); author(pending.ui);
  const original = pending.planner.exportProject(), job = pending.ui.run();
  const other = JSON.parse(original); other.id = 'separate-project';
  pending.planner.importProject(JSON.stringify(other));
  resolve(pending.requests[0]); assert.equal(await job, null);
  assert.equal(pending.ui.getState().projectId, 'separate-project');
  assert.deepEqual(pending.ui.getState().draft.workplanes, []);
  pending.planner.importProject(original);
  assert.equal(pending.ui.getState().draft.workplanes.length, 1);
  assert.equal(pending.ui.getState().result, null); pending.ui.dispose();
});
test('metric/time/model/electrical changes publish visualization without rerun and current SVG export is renewed', async () => {
  const { ui, requests, events } = setup(); author(ui);
  const result = await ui.run(), original = ui.getState().preview.svg;
  ui.setVisualization({ metric: 'sky', intervalIndex: 1, modeled: true, showElectrical: true });
  assert.equal(ui.getState().result, result); assert.equal(requests.length, 1);
  assert.notEqual(ui.getState().preview.svg, original);
  assert.equal(await ui.exportData('svg').blob.text(), ui.getState().preview.svg);
  assert.equal(events.at(-1).detail.result, result); assert.equal(events.at(-1).detail.visualization.metric, 'sky');
  ui.setFloor('upper'); assert.equal(ui.getState().result, result);
  assert.equal(ui.getState().visualization.intervalIndex, 1);
  assert.equal(requests.length, 1); ui.dispose();
});
test('unknown context computation never claims ready; modeled-only and primary evidence stay separate', async () => {
  const { ui } = setup(); author(ui); ui.setNeighbor('front', 'unknown');
  const result = await ui.run();
  assert.equal(result.computationalComplete, true); assert.equal(result.complete, false);
  assert.equal(result.context.status, 'unknown-context');
  assert.match(ui.getState().message, /evidence remains incomplete/);
  assert.doesNotMatch(ui.getState().message, /ready|converged/i);
  assert.ok(result.sky.sensorResults.every(row => row.cosineWeightedSkyAccess === null));
  assert.ok(result.sky.sensorResults.every(row => typeof row.modeledCosineWeightedSkyAccess === 'number'));
  ui.dispose();
});
test('session scenario clone/delete/rename and pinned comparison honor strict period reasons and parent project immutability', async () => {
  const { ui, planner } = setup(), before = planner.exportProject(); author(ui);
  await ui.run(); const baseline = ui.getState().history.at(-1).id;
  ui.pinHistory(baseline); const first = ui.getState().selectedScenarioId;
  const second = ui.addScenario('Scenario <script> & "evidence"', true);
  ui.renameScenario('Different period'); ui.setSelection({ endTime: '12:30' }); ui.prepareSunIntervals();
  await ui.run();
  assert.equal(ui.getState().comparison.comparable, false);
  assert.ok(ui.getState().comparison.reasons.includes('different-period'));
  assert.equal(ui.getState().comparison.deltas, null);
  ui.selectScenario(first); assert.notEqual(ui.getState().draft.label, 'Different period');
  ui.deleteScenario(second); assert.equal(ui.getState().scenarios.length, 1);
  assert.equal(ui.deleteScenario(first), null);
  assert.equal(planner.exportProject(), before); ui.dispose();
});
test('strict decimal parsing, formula-safe CSV and complete metadata preservation in exports', async () => {
  assert.equal(UI.numeric(''), null); assert.equal(UI.numeric('  '), null);
  assert.equal(UI.numeric('-1.2e2'), -120);
  for (const value of ['0x20', '1junk', 'Infinity', true, {}, '1e']) assert.throws(() => UI.numeric(value));
  assert.equal(UI.csvCell(null), ''); assert.equal(UI.csvCell(-2), '"-2"');
  assert.equal(UI.csvCell(' =SUM(1,2)'), '"\' =SUM(1,2)"');
  assert.equal(UI.csvCell('@formula'), '"\'@formula"');
  const { ui } = setup(); author(ui); ui.setNeighbor('front', 'unknown');
  const result = await ui.run(), csv = await ui.exportData('csv').blob.text();
  assert.match(csv, /positive-path presence \(h\)/); assert.match(csv, /dimensionless 0–1/);
  assert.ok(csv.includes(',,,'), 'unknown primary cells are empty');
  assert.deepEqual(JSON.parse(await ui.exportData('json').blob.text()), result);
  assert.deepEqual(JSON.parse(await ui.exportData('config').blob.text()), ui.getState().draft);
  ui.dispose();
});
test('worker/renderer failures remain visible with editable forms and no main-thread fallback', async () => {
  const { ui, runtime } = setup(); delete runtime.HomePlannerLightDisplay;
  author(ui); assert.match(ui.getState().previewError, /renderer unavailable/);
  delete runtime.HomePlannerLightRunner;
  assert.equal(await ui.run(), null); assert.match(ui.getState().error, /No main-thread fallback/);
  assert.ok(ui.renameScenario('Still editable')); ui.dispose();
});
function documentFor(bridge, runtime) {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map();
      this.classList = { add() {} }; this.value = ''; this.textContent = ''; this.open = false;
    }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatchEvent(event) { for (const fn of this.listeners.get(event.type) || []) fn(event); }
    dispatch(type) { this.dispatchEvent({ type }); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) {
      const tags = selector.split(',').map(value => value.toUpperCase());
      const collect = node => node.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...collect(child)]);
      return collect(this);
    }
    focus() { document.activeElement = this; }
    click() { this.dispatch('click'); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  }
  const find = (node, fn) => fn(node) ? node : node.children.map(child => find(child, fn)).find(Boolean);
  const host = new Element('section'), outer = new Element('section'), guidance = new Element('p'), urls = [], revoked = [];
  outer.append(guidance, host);
  document = new Element('document'); document.createElement = tag => new Element(tag);
  document.getElementById = id => id === 'workspaceLightStudy' ? host : find(host, node => node.id === id);
  document.defaultView = { ...runtime, document, HomePlanner: bridge,
    URL: { createObjectURL() { const url = `blob:light-${urls.length}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); } } };
  return { document, host, outer, guidance, urls, revoked, find };
}
test('mount is idempotent, keeps outer guidance, short frontmatter, native controls, focus and Blob cleanup', async () => {
  const setupState = setup(); setupState.ui.dispose();
  const { document, host, outer, guidance, urls, revoked, find } = documentFor(setupState.bridge, setupState.runtime);
  const ui = UI.mount(document, document.defaultView);
  assert.equal(UI.mount(document, document.defaultView), ui);
  assert.equal(host.lightController, ui); assert.equal(host.homePlannerLight, ui); assert.ok(outer.children.includes(guidance));
  const byId = id => document.getElementById(`light-${id}`);
  assert.equal(byId('status').attributes.role, 'status');
  assert.ok(host.children.indexOf(byId('viewport')) < host.children.indexOf(find(host, node => node.tagName === 'DETAILS' && node.children[0].textContent.includes('Study inputs'))));
  byId('prepare').click();
  const change = (id, value) => { const input = byId(id); input.value = value; input.dispatch('change'); return input; };
  change('room', JSON.stringify(['ground', 'ground:living'])); byId('add-room').click();
  const wrapper = find(host, node => node.tagName === 'LABEL' && node.textContent === 'Workplane height above floor · m');
  assert.ok(wrapper); const input = wrapper.children[0]; assert.equal(wrapper.htmlFor, input.id);
  input.value = '.8'; input.dispatch('change');
  const updated = find(host, node => node.tagName === 'LABEL' && node.textContent === 'Workplane height above floor · m').children[0];
  updated.focus(); updated.value = '2garbage'; updated.dispatch('change');
  assert.equal(document.activeElement, updated); assert.equal(Number(updated.value), .8);
  assert.equal(ui.getState().draft.workplanes[0].heightM, .8);
  document.activeElement = null;
  const first = urls[0]; ui.setVisualization({ showElectrical: true });
  assert.ok(revoked.includes(first));
  assert.ok(find(host, node => node.tagName === 'IMG'));
  ui.renameScenario('<img onerror=alert(1)>'); assert.equal(ui.getState().draft.label, '<img onerror=alert(1)>');
  assert.equal(host.querySelectorAll('img').length, 1, 'labels are text, never HTML');
  ui.dispose(); assert.equal(host.lightController, null); assert.equal(new Set(revoked).size, urls.length);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
});
test('browser global is lazy and styles preserve inherited workbench contrast, native hit targets and internal overflow', () => {
  const source = fs.readFileSync(require.resolve('../planner-light-ui.js'), 'utf8'), sandbox = {};
  vm.runInNewContext(source, sandbox); assert.equal(typeof sandbox.HomePlannerLightUI.mount, 'function');
  assert.equal(UI.mount({ getElementById() { return null; } }), null);
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|\.createStudy\(|HomePlannerLight\.run\(/);
  const css = fs.readFileSync(require.resolve('../planner-light-ui.css'), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /overflow-x: auto/); assert.match(css, /focus-visible/);
  assert.match(css, /var\(--txt/); assert.match(css, /var\(--panel/);
  assert.match(css, /\.homePlannerLight summary \{ color: inherit/);
});

test('mounted worker receives the original runtime for receiver-sensitive browser getters', async () => {
  const state = setup(); state.ui.dispose();
  const { document } = documentFor(state.bridge, state.runtime);
  const runtime = document.defaultView, createRunner = runtime.HomePlannerLightRunner.createRunner;
  Object.defineProperty(runtime, 'location', { get() {
    assert.equal(this, runtime, 'native Window getters require the actual Window receiver');
    return { href: 'http://127.0.0.1:8016/' };
  } });
  runtime.HomePlannerLightRunner = { createRunner(received) {
    assert.equal(received.location.href, 'http://127.0.0.1:8016/');
    assert.equal(received, runtime);
    return createRunner(received);
  } };
  const ui = UI.mount(document, runtime);
  author(ui);
  assert.ok(await ui.run(), ui.getState().error);
  ui.dispose();
});

test('initial mount paints prerequisite guidance before any inventory, images or worker requests', () => {
  const state = setup(); state.ui.dispose();
  const { document, host, find, urls } = documentFor(state.bridge, state.runtime);
  const ui = UI.mount(document), viewport = document.getElementById('light-viewport');
  assert.equal(ui.getState().displayStatus.code, 'not-prepared');
  assert.match(viewport.children[0].textContent, /Prepare inventory/);
  assert.equal(urls.length, 0);
  assert.equal(state.requests.length, 0);
  document.getElementById('light-inputs').click();
  const inputs = find(host, node => node.tagName === 'DETAILS' &&
    node.children[0].textContent === 'Study inputs — rooms, site, optics & context');
  assert.equal(inputs.open, true);
  assert.equal(inputs.children[1].querySelectorAll('details')[0].open, true);
  ui.dispose();
});

test('display status separates real positive sky, unknown primary context, night and disabled sky', async () => {
  const { ui } = setup({ fixture: 'furnished-single' });
  author(ui, { sky: { enabled: true, radialBands: 16, azimuthSectors: 64 } });
  await ui.run(); ui.setVisualization({ metric: 'sky' });
  assert.equal(ui.getState().displayStatus.code, 'result');
  assert.ok(ui.getState().preview.sensorRows.some(row => row.selectedValue > 0));
  ui.setNeighbor('front', 'unknown'); await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'unknown-context');
  assert.ok(ui.getState().preview.sensorRows.every(row => row.selectedValue === null));
  ui.setVisualization({ modeled: true });
  assert.equal(ui.getState().displayStatus.code, 'result');
  assert.match(ui.getState().displayStatus.message, /Supplied model only/);
  ui.setSelection({ startTime: '00:00', endTime: '01:00' }); ui.prepareSunIntervals();
  await ui.run(); ui.setVisualization({ metric: 'direct', modeled: false });
  assert.equal(ui.getState().displayStatus.code, 'night');
  assert.ok(ui.getState().preview.sensorRows.every(row => row.selectedValue === 0));
  ui.setVisualization({ metric: 'sky' });
  assert.equal(ui.getState().displayStatus.code, 'unknown-context', 'night does not erase unknown sky context');
  ui.setDraft({ sky: { enabled: false } }); await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'disabled');
  assert.ok(ui.getState().preview.sensorRows.every(row => row.selectedValue === null));
  ui.dispose();
});

test('blocked, near-horizon, unprocessed and unselected-floor views explain why cells are unavailable', async () => {
  const { ui, planner } = setup(); author(ui);
  await ui.run(); const floorId = planner.getProject().activeFloorId;
  ui.setFloor('upper');
  assert.equal(ui.getState().displayStatus.code, 'other-floor');
  assert.equal(planner.getProject().activeFloorId, floorId);
  ui.setFloor('ground');
  const config = ui.getState().draft;
  config.samples = config.samples.map(sample => {
    delete sample.sunENU;
    return { ...sample, sunAnglesDeg: { altitudeDeg: .5, azimuthDeg: 180 } };
  });
  ui.replaceDraft(config); await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'unresolved');
  assert.ok(ui.getState().preview.sensorRows.every(row => row.selectedValue === null));
  assert.equal(ui.getState().draft.minSunAltitudeDeg, 1);
  ui.setDraft({ samples: [] }); await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'unprocessed');
  ui.setDraft({ windowOptics: { mode: null } }); await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'blocked');
  assert.match(ui.getState().displayStatus.message, /windowOptics.mode/);
  planner.importProject(JSON.stringify(createFixture('sparse-unknown').project));
  ui.prepare();
  assert.equal(ui.getState().displayStatus.code, 'empty');
  assert.match(ui.getState().displayStatus.message, /Add and place rooms in Design/);
  ui.dispose();
});

test('clear revokes 2D and published 3D evidence, retains exact inputs and rejects a late worker', async () => {
  const { ui, events, planner } = setup({ fixture: 'furnished-single' }), before = planner.exportProject();
  author(ui); const result = await ui.run(), draft = ui.getState().draft, history = ui.getState().history.length;
  ui.clearResult();
  assert.equal(ui.getState().result, null);
  assert.match(ui.getState().message, /Result cleared/);
  assert.deepEqual(ui.getState().draft, draft);
  assert.equal(ui.getState().history.length, history);
  assert.equal(events.at(-1).detail.stale, true);
  assert.equal(events.at(-1).detail.result, null);
  assert.doesNotMatch(ui.getState().preview.svg, /data-sensor=/);
  assert.equal(ui.exportData('svg'), null);
  assert.deepEqual((await ui.run()).sky, result.sky);
  assert.equal(planner.exportProject(), before); ui.dispose();
  const pending = setup({ pending: true }); author(pending.ui);
  const run = pending.ui.run(); pending.ui.clearResult();
  assert.equal(await run, null);
  resolve(pending.requests[0]); await Promise.resolve();
  assert.equal(pending.ui.getState().result, null);
  pending.ui.dispose();
});

test('image and Blob failures stay visible in the viewport and recover on explicit preparation', async () => {
  const state = setup(); state.ui.dispose();
  const { document, host, find, revoked } = documentFor(state.bridge, state.runtime);
  const ui = UI.mount(document), viewport = document.getElementById('light-viewport');
  author(ui); await ui.run();
  const img = find(host, node => node.tagName === 'IMG'), url = img.src;
  img.dispatch('error');
  assert.match(viewport.children[0].textContent, /Plan image unavailable/);
  assert.match(document.getElementById('light-error').textContent, /sensor tables/);
  assert.ok(revoked.includes(url));
  ui.prepare(); assert.ok(find(host, node => node.tagName === 'IMG'));
  assert.equal(document.getElementById('light-error').hidden, true);
  const createURL = document.defaultView.URL.createObjectURL;
  document.defaultView.URL.createObjectURL = () => { throw new Error('Blob URLs disabled'); };
  assert.ok(ui.prepare());
  assert.match(viewport.children[0].textContent, /Blob URLs disabled/);
  document.defaultView.URL.createObjectURL = createURL;
  ui.prepare(); assert.ok(find(host, node => node.tagName === 'IMG'));
  document.getElementById('light-clear').click();
  assert.equal(ui.getState().result, null);
  ui.dispose();
});

test('new reserved-area geometry revokes old cells and supports a region-aware rerun', async () => {
  const { ui, bridge, events } = setup(); author(ui); await ui.run();
  const original = bridge.getDrawingScene;
  bridge.getDrawingScene = () => {
    const drawing = copy(original()), room = drawing.scenes[0].rooms[0];
    room.reservedAreaM2 = room.rect.w * room.rect.h / 2;
    room.usableRegions = [{ ...room.rect, w: room.rect.w / 2 }];
    return drawing;
  };
  assert.equal(ui.sync(), true);
  assert.equal(ui.getState().result, null);
  assert.equal(ui.getState().displayStatus.code, 'not-run');
  assert.match(ui.getState().message, /stale/);
  assert.equal(events.at(-1).detail.stale, true);
  assert.equal(events.at(-1).detail.result, null);
  assert.ok(await ui.run());
  bridge.getDrawingScene = original; ui.prepare();
  assert.ok(await ui.run());
  ui.dispose();
});

test('failed publication recapture notifies the view after revoking the pending worker generation', async () => {
  const { ui, bridge, requests } = setup({ pending: true, subscribe: false }); author(ui);
  const notifications = []; ui.subscribe(value => notifications.push(value));
  const pending = ui.run();
  bridge.getDrawingScene = () => { throw new Error('Current floor geometry is unavailable. Repair it in Design.'); };
  resolve(requests[0]);
  assert.equal(await pending, null);
  assert.equal(notifications.at(-1).busy, false);
  assert.equal(notifications.at(-1).result, null);
  assert.match(notifications.at(-1).displayStatus.message, /Repair it in Design/);
  ui.dispose();
});
