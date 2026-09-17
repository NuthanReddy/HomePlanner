const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UI = require('../planner-airflow-ui.js');
const A = require('../planner-airflow.js');
const Display = require('../planner-airflow-display.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const ref = (floorId, entityId) => ({ floorId, entityId });
const living = ref('ground', 'ground:living');
const entry = ref('ground', 'ground:entry');
const windowRef = ref('ground', 'ground:living-window');
function projectFixture() {
  const project = createFixture('multiple-floors').project;
  for (const floor of project.floors) {
    floor.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
    for (const opening of [...floor.legacy.context.plan.openings.doors, ...floor.legacy.context.plan.openings.windows])
      opening.openFraction = 1;
    floor.doorEdits = {}; floor.windowEdits = {};
  }
  project.legacy = copy(project.floors[0].legacy); project.doorEdits = {}; project.windowEdits = {};
  return project;
}
function setup({ pending = false, subscribed = true, timers = false } = {}) {
  const planner = controllerFor(projectFixture()), requests = [], captures = [], calls = { cancel: 0, dispose: 0 };
  const bridge = { ...planner, subscribe: subscribed ? planner.subscribe : undefined,
    getDrawingScene() { const value = planner.getDrawingScene(); captures.push(value); return value; } };
  const jobs = new Map(); let timerId = 0;
  const runtime = { Blob, HomePlannerAirflow: A, HomePlannerAirflowDisplay: Display,
    HomePlannerAirflowRunner: { createRunner() {
      return {
        run(input) {
          if (pending) return new Promise((resolve, reject) => requests.push({ input, resolve, reject }));
          requests.push({ input }); return Promise.resolve(A.run(input.scene, input.scenario,
            { expectedPhysicalFingerprint: input.expectedPhysicalFingerprint }));
        },
        cancel() { calls.cancel++; }, dispose() { calls.dispose++; }
      };
    } }
  };
  if (timers) Object.assign(runtime, {
    setTimeout(fn) { jobs.set(++timerId, fn); return timerId; }, clearTimeout(id) { jobs.delete(id); }
  });
  const ui = UI.createController(bridge, runtime);
  return { ui, planner, bridge, runtime, requests, captures, calls, jobs };
}
function author(ui) {
  assert.ok(ui.prepare(), ui.getState().error);
  assert.ok(ui.addRoom(living), ui.getState().error);
  const zone = ui.getState().draft.zones[0];
  ui.updateZone(zone.id, { volumeM3: 30, volumeSource: 'Explicit test volume' });
  ui.setDraft({ densityKgM3: 1.2 });
  assert.ok(ui.addOpening(entry), ui.getState().error);
  assert.ok(ui.addOpening(windowRef), ui.getState().error);
  const [incoming, outgoing] = ui.getState().draft.links;
  ui.updateLink(incoming.id, { from: 'outside', to: zone.id, enabled: true, freeAreaM2: .5, cd: .6, pressurePa: 12 });
  ui.updateLink(outgoing.id, { from: zone.id, to: 'outside', enabled: true, freeAreaM2: .5, cd: .6, pressurePa: 0 });
  return { zone: zone.id, incoming: incoming.id, outgoing: outgoing.id };
}
function resolve(request) {
  request.resolve(A.run(request.input.scene, request.input.scenario,
    { expectedPhysicalFingerprint: request.input.expectedPhysicalFingerprint }));
}
test('mount/controller construction and navigation do no discovery or analysis; explicit prepare captures once', () => {
  const { ui, planner, captures, requests } = setup();
  assert.deepEqual(ui.getState().draft.zones, []); assert.deepEqual(ui.getState().draft.links, []);
  assert.equal(ui.getState().draft.densityKgM3, null);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(captures.length, 0); assert.equal(requests.length, 0);
  ui.prepare(); assert.equal(captures.length, 1); assert.equal(requests.length, 0);
  assert.ok(ui.getState().preview.svg); assert.equal(ui.getState().result, null); ui.dispose();
});
test('accessible authoring uses real inventory references, no duplicate rooms/openings and blank is null', async () => {
  const { ui, planner, captures, requests } = setup(), before = planner.exportProject();
  const ids = author(ui);
  assert.equal(ui.addRoom(living), null); assert.match(ui.getState().error, /only one/i);
  assert.equal(ui.addOpening(entry), null); assert.match(ui.getState().error, /duplicate/i);
  ui.updateZone(ids.zone, { volumeM3: UI.numeric('') }); assert.equal(ui.getState().draft.zones[0].volumeM3, null);
  ui.updateZone(ids.zone, { volumeM3: 30 });
  const count = captures.length, result = await ui.run();
  assert.equal(captures.length, count + 2, 'exactly one run snapshot and one publication verification');
  assert.equal(requests.length, 1); assert.ok(Object.isFrozen(requests[0].input.scene));
  assert.equal(result.status, 'converged'); assert.equal(result.balanced, true);
  assert.equal(planner.exportProject(), before, 'scenarios and calculation do not mutate physical project');
  const forward = result.flowResults[0].m3s;
  ui.updateLink(ids.incoming, { pressurePa: -12 }); assert.equal(ui.getState().result, null);
  const reverse = await ui.run();
  assert.ok(Math.abs(reverse.flowResults[0].m3s + forward) < 1e-9);
  assert.deepEqual(reverse.flowResults[0].direction, { from: ids.zone, to: 'outside' });
  ui.dispose();
});
test('closed modeled operation blocks, cannot scenario override; explicit confirmed bridge update works and invalidates', async () => {
  const { ui, planner } = setup(); const ids = author(ui); await ui.run();
  assert.equal(ui.applyOperation(entry, 0), null); assert.match(ui.getState().error, /Confirm/);
  assert.equal(ui.applyOperation(entry, 0, true), true, ui.getState().error);
  assert.equal(ui.getState().result, null);
  const closed = await ui.run();
  assert.equal(closed.status, 'blocked');
  assert.ok(closed.findings.some(f => f.code === 'closed-opening-positive-area'));
  ui.updateLink(ids.incoming, { openFraction: 1 });
  const mismatch = await ui.run();
  assert.ok(mismatch.findings.some(f => f.code === 'operating-state-mismatch'));
  ui.updateLink(ids.incoming, { openFraction: null });
  assert.equal(ui.applyOperation(entry, 1, true), true);
  assert.equal((await ui.run()).status, 'converged');
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.applyOperation(entry, .5, true), null); assert.match(ui.getState().error, /Switch/);
  assert.equal(ui.getState().floorId, 'upper'); ui.dispose();
});
test('exact physical adjacency, disabled missing links and room removal retain repairable references', async () => {
  const { ui } = setup(); ui.prepare();
  assert.equal(ui.addOpening(entry), null); assert.match(ui.getState().error, /adjacent rooms/);
  ui.addRoom(living); ui.addOpening(entry);
  assert.equal(ui.getState().draft.links[0].enabled, false);
  assert.deepEqual(new Set(ui.openingEndpoints(entry)), new Set(['outside', ui.getState().draft.zones[0].id]));
  const draft = ui.getState().draft, oldId = draft.zones[0].id;
  ui.removeZone(oldId);
  assert.ok([draft.links[0].from, draft.links[0].to].includes(oldId));
  assert.deepEqual(ui.getState().draft.links[0], draft.links[0], 'links are retained, never silently rebound');
  assert.equal((await ui.run()).status, 'blocked'); ui.dispose();
});
test('manual connection requires explicit per-anchor floors and absolute numeric points; no inferred shaft', async () => {
  const { ui } = setup(); author(ui); ui.addManual();
  const id = ui.getState().draft.links.at(-1).id;
  assert.equal(ui.getState().draft.links.at(-1).anchors, undefined);
  for (const side of ['from', 'to']) {
    assert.ok(ui.setAnchor(id, side, 'floorId', side === 'from' ? 'ground' : 'upper'), ui.getState().error);
    for (const [axis, value] of [['x', '3'], ['y', '4'], ['z', side === 'from' ? '.45' : '3.65']])
      assert.ok(ui.setAnchor(id, side, axis, value), ui.getState().error);
  }
  const link = ui.getState().draft.links.at(-1);
  assert.equal(link.anchors.to.point.z, 3.65); assert.equal(link.enabled, false);
  ui.setAnchor(id, 'to', 'z', ''); assert.equal(ui.getState().draft.links.at(-1).anchors.to.point.z, null);
  assert.equal(ui.setAnchor(id, 'to', 'x', '0x10'), null); ui.dispose();
});
test('atomic scenario import/append/rename/clone/delete preserves old draft on invalid JSON, types, duplicates or size', () => {
  const { ui } = setup(); author(ui);
  const before = ui.getState().draft, selected = ui.getState().selectedScenarioId;
  for (const text of ['{', JSON.stringify({ ...before, densityKgM3: '1' }), ' '.repeat(UI.IMPORT_LIMIT + 1),
    JSON.stringify({ ...before, zones: [before.zones[0], before.zones[0]] })]) {
    assert.equal(ui.importScenario(text), null); assert.deepEqual(ui.getState().draft, before);
  }
  const imported = copy(before); delete imported.notes; imported.label = 'Imported';
  assert.ok(ui.importScenario(JSON.stringify(imported), true));
  assert.equal(ui.getState().scenarios.length, 2); assert.notEqual(ui.getState().selectedScenarioId, selected);
  assert.equal(Object.hasOwn(ui.getState().draft, 'notes'), false);
  ui.renameScenario('Named trial'); assert.equal(ui.getState().draft.label, 'Named trial');
  const clone = ui.addScenario('Clone', true); assert.ok(clone); assert.equal(ui.getState().scenarios.length, 3);
  assert.deepEqual(ui.getState().draft.links, before.links);
  assert.equal(ui.deleteScenario(clone), null);
  assert.equal(ui.deleteScenario(clone, true), true);
  ui.selectScenario(selected); assert.deepEqual(ui.getState().draft, before); ui.dispose();
});
test('project switch restores only its session scenarios/history and never leaks a current result', async () => {
  const { ui, planner } = setup(); author(ui); await ui.run();
  ui.renameScenario('Project one'); await ui.run();
  const first = planner.exportProject(), history = ui.getState().history.length;
  const second = projectFixture(); second.id = 'second-project';
  planner.importProject(JSON.stringify(second));
  assert.equal(ui.getState().projectId, second.id); assert.equal(ui.getState().result, null);
  assert.equal(ui.getState().history.length, 0); assert.equal(ui.getState().draft.zones.length, 0);
  ui.renameScenario('Project two');
  planner.importProject(first);
  assert.equal(ui.getState().draft.label, 'Project one'); assert.equal(ui.getState().history.length, history);
  assert.equal(ui.getState().result, null); ui.dispose();
});
test('floor selection reuses results, same-ID same-revision physical replacement invalidates and forbids comparison', async () => {
  const { ui, planner } = setup(); author(ui); const result = await ui.run();
  const baseline = ui.getState().history.at(-1).id; ui.pinBaseline(baseline);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().result, result); assert.equal(ui.getState().preview.floorId, 'upper');
  planner.execute({ type: 'select-floor', id: 'ground' });
  const replacement = copy(planner.getProject());
  replacement.doorEdits[entry.entityId] = { openFraction: .8 };
  replacement.floors[0].doorEdits = copy(replacement.doorEdits);
  planner.importProject(JSON.stringify(replacement));
  assert.equal(ui.getState().result, null);
  await ui.run(); assert.equal(ui.getState().comparison.comparable, false);
  assert.ok(ui.getState().comparison.reasons.includes('physical-inputs-changed')); ui.dispose();
});
test('comparison is explicit, matches physical rooms and refuses changed room sets', async () => {
  const { ui } = setup(); const ids = author(ui); await ui.run();
  ui.pinBaseline(ui.getState().history[0].id);
  ui.addScenario('Lower forcing', true); ui.updateLink(ids.incoming, { pressurePa: 3 });
  await ui.run();
  assert.equal(ui.getState().comparison.comparable, true);
  assert.ok(ui.getState().comparison.zoneDeltas[0].directOutsideInflowM3s < 0);
  ui.addRoom(ref('ground', 'ground:kitchen')); const kitchen = ui.getState().draft.zones.at(-1);
  ui.updateZone(kitchen.id, { volumeM3: 20 }); await ui.run();
  assert.equal(ui.getState().comparison.comparable, false);
  assert.ok(ui.getState().comparison.reasons.includes('zone-selection-changed')); ui.dispose();
});
test('cancel, draft edits and out-of-order completion never publish obsolete worker snapshots', async () => {
  const { ui, requests, calls } = setup({ pending: true }); const ids = author(ui);
  const first = ui.run(); assert.equal(ui.getState().busy, true);
  ui.updateLink(ids.incoming, { pressurePa: 6 });
  assert.equal(ui.getState().busy, false); assert.equal(await first, null);
  const second = ui.run(); resolve(requests[0]);
  assert.equal(ui.getState().busy, true); resolve(requests[1]);
  assert.equal((await second).scenario.links[0].pressurePa, 6);
  const third = ui.run(); ui.cancel();
  assert.equal(await third, null); resolve(requests[2]);
  await Promise.resolve(); assert.equal(ui.getState().result, null);
  assert.ok(calls.cancel >= 2); ui.dispose(); assert.equal(calls.dispose, 1);
});
test('same scene physical changes at publication without subscription veto stale output', async () => {
  const { ui, planner, requests } = setup({ pending: true, subscribed: false }); author(ui);
  const pending = ui.run(); planner.execute({ type: 'update-door', id: entry.entityId, openFraction: 0 });
  resolve(requests[0]); assert.equal(await pending, null);
  assert.equal(ui.getState().result, null); assert.equal(ui.getState().busy, false); ui.dispose();
});
test('worker timeout and missing dependency are actionable; never fallback to main-thread solver', async () => {
  const { ui, runtime, jobs, calls } = setup({ pending: true, timers: true }); author(ui);
  const pending = ui.run(); [...jobs.values()][0]();
  assert.equal(await pending, null); assert.match(ui.getState().error, /timed out/); assert.ok(calls.cancel);
  ui.dispose();
  const missing = setup(); delete missing.runtime.HomePlannerAirflowRunner;
  assert.ok(missing.ui.prepare()); assert.ok(missing.ui.addRoom(living));
  assert.equal(await missing.ui.run(), null); assert.match(missing.ui.getState().error, /worker runner unavailable/);
  assert.equal(missing.requests.length, 0); missing.ui.dispose();
  delete runtime.HomePlannerAirflowDisplay;
});
test('real nonconverged and numerical range failures remain diagnostic, with original solver evidence and no ACH', async () => {
  const { ui } = setup(); const ids = author(ui);
  ui.updateLink(ids.incoming, { pressurePa: 1, freeAreaM2: 1 });
  ui.updateLink(ids.outgoing, { freeAreaM2: 5e-9 });
  const stalled = await ui.run();
  assert.equal(stalled.status, 'nonconverged'); assert.equal(stalled.balanced, false);
  assert.equal(stalled.solver.status, 'stalled');
  assert.equal(stalled.zoneResults[0].directOutsideInflowACH, null);
  assert.match(ui.getState().message, /diagnostic only/);
  assert.ok(ui.getState().preview.openingRows.every(row => row.directionVector === null));
  ui.setDraft({ densityKgM3: Number.MIN_VALUE });
  const failed = await ui.run();
  assert.equal(failed.status, 'numerical-error'); assert.equal(failed.solver, null);
  assert.match(ui.getState().message, /diagnostic only/); ui.dispose();
});
test('unknown modeled operation and unknown adjacency require explicit inputs, never exterior or open defaults', async () => {
  const { ui: old, planner, runtime } = setup(); old.dispose();
  let unknownAdjacency = false;
  const bridge = { ...planner, getDrawingScene() {
    const scene = copy(planner.getDrawingScene());
    const opening = scene.scenes[0].openings.find(item => item.id === entry.entityId);
    delete opening.openFraction;
    if (unknownAdjacency) opening.wallId = 'missing-wall';
    return scene;
  } };
  const ui = UI.createController(bridge, runtime); const ids = author(ui);
  const blocked = await ui.run();
  assert.ok(blocked.findings.some(finding => finding.code === 'missing-openFraction'));
  ui.updateLink(ids.incoming, { openFraction: 1 }); assert.equal((await ui.run()).status, 'converged');
  unknownAdjacency = true; ui.sync();
  assert.equal(ui.getState().result, null);
  assert.deepEqual(ui.openingEndpoints(entry), []);
  assert.equal((await ui.run()).status, 'blocked'); ui.dispose();
});
test('project switches and disposal cancel pending generations, late results cannot populate another project history', async () => {
  const { ui, planner, requests } = setup({ pending: true }); author(ui);
  const pending = ui.run(), second = projectFixture(); second.id = 'switch-during-worker';
  planner.importProject(JSON.stringify(second));
  assert.equal(await pending, null); resolve(requests[0]); await Promise.resolve();
  assert.equal(ui.getState().projectId, second.id);
  assert.equal(ui.getState().history.length, 0); assert.equal(ui.getState().result, null);
  const again = ui.run(); ui.dispose(); assert.equal(await again, null);
  resolve(requests[1]); await Promise.resolve();
});
test('mismatched worker output is rejected rather than attached or silently rerun', async () => {
  const { ui, requests } = setup({ pending: true }); author(ui);
  const pending = ui.run(), request = requests[0];
  const bad = copy(A.run(request.input.scene, request.input.scenario));
  bad.scenario.densityKgM3 = 999;
  request.resolve(bad); assert.equal(await pending, null);
  assert.match(ui.getState().error, /mismatched snapshot/);
  assert.equal(ui.getState().history.length, 0); ui.dispose();
});
test('failed physical recapture revokes existing output and lazy display recovery needs no additional analysis', async () => {
  const { ui, bridge, runtime, requests } = setup(); author(ui); await ui.run();
  const realCapture = bridge.getDrawingScene;
  bridge.getDrawingScene = () => { throw new Error('Drawing scene unavailable'); };
  assert.equal(ui.prepare(), null); assert.equal(ui.getState().result, null);
  assert.equal(ui.getState().inventory, null);
  bridge.getDrawingScene = realCapture;
  delete runtime.HomePlannerAirflowDisplay;
  ui.prepare(); assert.ok(ui.getState().inventory); assert.equal(ui.getState().preview, null);
  runtime.HomePlannerAirflowDisplay = Display;
  ui.prepare(); assert.ok(ui.getState().preview); assert.equal(requests.length, 1);
  ui.dispose();
});
test('no-op scenario edits do not invalidate results; actual changes do; result JSON is the full immutable snapshot', async () => {
  const { ui } = setup(); author(ui); const result = await ui.run();
  ui.replaceDraft(copy(ui.getState().draft)); assert.equal(ui.getState().result, result);
  const exported = ui.exportData('json');
  assert.deepEqual(JSON.parse(await exported.blob.text()), result);
  assert.ok(Object.isFrozen(result.solver));
  ui.setDraft({ notes: 'Changed input provenance' });
  assert.equal(ui.exportData('json'), null); assert.match(ui.getState().error, /Run the current/); ui.dispose();
});
test('CSV preserves signed numeric flow, unknown blanks, qualified findings, units and formula-safe string quoting', async () => {
  assert.equal(UI.csvCell(null), ''); assert.equal(UI.csvCell(undefined), '');
  assert.equal(UI.csvCell(-1.2), '"-1.2"'); assert.equal(UI.csvCell(' =HYPERLINK("x")'), '"\' =HYPERLINK(""x"")"');
  assert.equal(UI.csvCell('@sum(1,2)'), '"\'@sum(1,2)"'); assert.equal(UI.csvCell('line\n"quote"'), '"line\n""quote"""');
  const { ui } = setup(); const ids = author(ui);
  ui.updateLink(ids.incoming, { pressurePa: -12 }); const result = await ui.run();
  const text = await ui.exportData('csv').blob.text();
  assert.ok(text.includes(String(result.flowResults[0].m3s))); assert.match(text, /mass residual \(kg\/s\)/);
  assert.match(text, /signed from → to flow \(m³\/s\)/); assert.match(text, /original|Original/);
  ui.dispose();
});

function documentFor(bridge, runtime) {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.classList = { add() {} }; this.value = ''; this.textContent = ''; this.open = false;
    }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(name) { for (const fn of this.listeners.get(name) || []) fn({ preventDefault() {} }); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) {
      const tags = selector.split(',').map(value => value.toUpperCase());
      const collect = node => node.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...collect(child)]);
      return collect(this);
    }
    querySelector(selector) {
      const control = selector.match(/data-control="([^"]+)"/)?.[1];
      return this.querySelectorAll('input,select,button').find(node => node.dataset.control === control) || null;
    }
    focus() { document.activeElement = this; }
    click() { this.dispatch('click'); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  }
  const find = (node, fn) => fn(node) ? node : node.children.map(child => find(child, fn)).find(Boolean);
  const host = new Element('section'), urls = [], revoked = [], view = new Element('window');
  document = new Element('document'); document.createElement = tag => new Element(tag);
  document.getElementById = id => id === 'workspaceAirflow' ? host : find(host, node => node.id === id);
  document.defaultView = view;
  Object.assign(view, runtime, { HomePlanner: bridge, confirm: () => true,
    URL: { createObjectURL() { const url = `blob:airflow-${urls.length}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); } } });
  return { document, host, urls, revoked, find };
}
test('native mounted form controls, idempotency, preview priority, labels, draft preservation and Blob revocation', async () => {
  const setupState = setup(); setupState.ui.dispose();
  const { bridge, runtime, planner, captures } = setupState;
  const { document, host, find, urls, revoked } = documentFor(bridge, runtime);
  const ui = UI.mount(document);
  assert.equal(ui, host.homePlannerAirflow); assert.equal(UI.mount(document), ui);
  assert.equal(captures.length, 0);
  const byId = id => document.getElementById(`hp-airflow-${id}`);
  assert.ok(host.children.indexOf(byId('preview')) < host.children.indexOf(find(host, node => node.tagName === 'DETAILS')));
  assert.equal(byId('status').attributes.role, 'status');
  byId('prepare').click(); assert.equal(captures.length, 1);
  const changeLabel = (label, value, checked = false) => {
    const wrapper = find(host, node => node.tagName === 'LABEL' && node.textContent === label);
    assert.ok(wrapper, label);
    const input = wrapper.children[0]; assert.equal(wrapper.htmlFor, input.id);
    if (checked) input.checked = value; else input.value = value;
    input.dispatch('change'); return input;
  };
  changeLabel('Room to add', JSON.stringify(['ground', 'ground:living'])); byId('add-room').click();
  changeLabel('Clear room volume (m³) · blank = unknown', '30');
  changeLabel('Air density (kg/m³) · blank = unknown', '1.2');
  changeLabel('Known opening to add', JSON.stringify(['ground', 'ground:entry'])); byId('add-opening').click();
  changeLabel('Enabled — include this link', true, true);
  changeLabel('Operating free area (m²) · blank = unknown', '.5');
  changeLabel('Discharge coefficient (0 < Cd ≤ 1) · blank = unknown', '.6');
  changeLabel('Signed from → to forcing (Pa) · blank = unknown', '12');
  assert.equal((await ui.run()).status, 'converged');
  const firstURL = urls.at(-1);
  assert.match(find(host, node => node.tagName === 'IMG').alt, /Computed 2D.*potential-flow/);
  assert.equal(ui.getState().result.planField.status, 'complete');
  changeLabel('Scenario notes / assumptions', 'Explicit source');
  assert.equal(ui.getState().draft.notes, 'Explicit source'); assert.ok(revoked.includes(firstURL));
  const invalid = changeLabel('Air density (kg/m³) · blank = unknown', 'not-numeric');
  assert.equal(Number(invalid.value), 1.2, 'invalid visible edit returns to actual controlled draft');
  assert.equal(ui.getState().draft.densityKgM3, 1.2);
  const source = fs.readFileSync(require.resolve('../planner-airflow-ui.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|<iframe|\.run\(scene/);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().draft.notes, 'Explicit source');
  ui.dispose(); assert.equal(host.homePlannerAirflow, undefined);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
  assert.equal(new Set(revoked).size, urls.length);
});
test('browser global and narrow responsive CSS retain native controls without page horizontal overflow', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-airflow-ui.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.HomePlannerAirflowUI.mount, 'function');
  assert.equal(UI.mount({ getElementById() { return null; } }), null);
  const css = fs.readFileSync(require.resolve('../planner-airflow-ui.css'), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /max-width: 600px/);
  assert.match(css, /overflow-x: auto/); assert.match(css, /min-width: 0/);
  assert.match(css, /focus-visible/);
});

test('display status distinguishes absent rooms, blocked inputs, another floor and legitimate zero flow', async () => {
  const { ui, planner } = setup();
  assert.equal(ui.getState().displayStatus.code, 'not-prepared');
  const ids = author(ui);
  await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'result');
  assert.match(ui.getState().displayStatus.message, /2 signed opening-flow arrows/);
  planner.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(ui.getState().displayStatus.code, 'other-floor');
  planner.execute({ type: 'select-floor', id: 'ground' });
  ui.updateLink(ids.incoming, { pressurePa: 0 });
  await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'zero-flow');
  assert.ok(ui.getState().preview.openingRows.every(row => row.directionVector === null));
  ui.updateLink(ids.incoming, { pressurePa: null });
  await ui.run();
  assert.equal(ui.getState().displayStatus.code, 'blocked');
  assert.match(ui.getState().displayStatus.message, /pressurePa/);
  planner.importProject(JSON.stringify(createFixture('sparse-unknown').project));
  ui.prepare();
  assert.equal(ui.getState().displayStatus.code, 'empty');
  assert.match(ui.getState().displayStatus.message, /Add and place rooms in Design/);
  assert.equal(ui.getState().result, null);
  ui.dispose();
});

test('clear revokes arrows and pending publication, retains inputs and permits explicit recalculation', async () => {
  const { ui, planner } = setup(), before = planner.exportProject();
  author(ui); const result = await ui.run(), draft = ui.getState().draft;
  const history = ui.getState().history.length;
  ui.clearResult();
  assert.equal(ui.getState().result, null);
  assert.match(ui.getState().message, /Result cleared/);
  assert.deepEqual(ui.getState().draft, draft);
  assert.equal(ui.getState().history.length, history);
  assert.doesNotMatch(ui.getState().preview.svg, /data-flow=/);
  assert.equal(ui.exportData('svg'), null);
  assert.deepEqual((await ui.run()).flowResults, result.flowResults);
  assert.equal(planner.exportProject(), before);
  ui.dispose();
  const pending = setup({ pending: true }); author(pending.ui);
  const run = pending.ui.run(); pending.ui.clearResult();
  assert.equal(await run, null);
  resolve(pending.requests[0]); await Promise.resolve();
  assert.equal(pending.ui.getState().result, null);
  assert.ok(pending.calls.cancel);
  pending.ui.dispose();
});

test('renderer errors survive successful edits and recover without rerunning numerical work', async () => {
  const { ui, runtime, requests } = setup(); author(ui); const result = await ui.run();
  runtime.HomePlannerAirflowDisplay = {
    createInventoryView() { throw new Error('readable diagram budget exceeded'); },
    createView() { throw new Error('readable diagram budget exceeded'); }
  };
  assert.ok(ui.prepare());
  assert.equal(ui.getState().result, result);
  assert.match(ui.getState().previewError, /diagram budget exceeded/);
  assert.equal(ui.getState().displayStatus.code, 'unavailable');
  assert.equal(ui.getState().preview, null);
  ui.replaceDraft(ui.getState().draft);
  assert.match(ui.getState().previewError, /diagram budget exceeded/);
  delete runtime.HomePlannerAirflowDisplay; ui.prepare();
  assert.match(ui.getState().previewError, /renderer unavailable/);
  runtime.HomePlannerAirflowDisplay = Display; ui.prepare();
  assert.equal(ui.getState().previewError, '');
  assert.ok(ui.getState().preview.svg.includes('data-flow='));
  assert.equal(requests.length, 1);
  ui.dispose();
});

test('new reserved-area geometry revokes old results and remains available for explicit recalculation', async () => {
  const { ui, bridge } = setup(); author(ui); await ui.run();
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
  assert.match(ui.getState().message, /stale.*review clear volumes/i);
  assert.ok(ui.getState().inventory.rooms.some(room => room.geometry.usableRegions[0].w < room.geometry.rect.w));
  assert.equal((await ui.run()).status, 'converged');
  bridge.getDrawingScene = original; ui.prepare();
  assert.equal((await ui.run()).status, 'converged');
  ui.dispose();
});

test('failed publication recapture is reported even when revocation changes the worker generation', async () => {
  const { ui, bridge, requests } = setup({ pending: true, subscribed: false }); author(ui);
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

test('mounted setup, image failure and clear controls never leave an unexplained blank panel', async () => {
  const state = setup(); state.ui.dispose();
  const { document, host, find, revoked } = documentFor(state.bridge, state.runtime);
  const ui = UI.mount(document), byId = id => document.getElementById(`hp-airflow-${id}`);
  assert.match(byId('preview').textContent, /Prepare inventory/);
  byId('inputs').click();
  const inputs = find(host, node => node.tagName === 'DETAILS' &&
    node.children[0].textContent === 'Scenario, rooms & opening inputs');
  assert.equal(inputs.open, true);
  author(ui); await ui.run();
  const img = find(host, node => node.tagName === 'IMG'), url = img.src;
  img.dispatch('error');
  assert.match(byId('preview').children[0].textContent, /image unavailable/);
  assert.match(byId('error').textContent, /result tables/);
  assert.ok(revoked.includes(url));
  ui.prepare();
  assert.ok(find(host, node => node.tagName === 'IMG'));
  assert.equal(byId('error').hidden, true);
  byId('clear').click();
  assert.equal(ui.getState().result, null);
  assert.doesNotMatch(ui.getState().preview.svg, /data-flow=/);
  ui.dispose();
});
