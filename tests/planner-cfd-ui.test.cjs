const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const UI = require('../planner-cfd-ui.js');
const Drafts = require('../planner-drafts.js');
const { project, fill, manifest, job, result, clone, controllerFor } = require('./fixtures/planner-cfd-fixtures.cjs');
const response = data => ({ ok: true, status: 200, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(handler) {
  const bridge = controllerFor(project()), calls = [], timers = new Map();
  let timer = 0;
  const runtime = { location: { protocol: 'http:', hostname: '127.0.0.1' },
    fetch: async (url, options) => { const payload = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, payload }); return handler(url, payload); },
    setTimeout: callback => { timers.set(++timer, callback); return timer; }, clearTimeout: id => timers.delete(id),
    console: { error() {} } };
  const controller = UI.createController(bridge, runtime);
  return { bridge, runtime, controller, calls, timers };
}

test('mounting/controller sync and raw typing do not request a service or change the project', t => {
  const f = fixture(() => { throw new Error('Unexpected request'); }); t.after(() => f.controller.dispose());
  const before = f.bridge.exportProject();
  f.controller.setValue('air.initialC', '2e');
  assert.equal(f.controller.getState().form.air.initialC, '2e');
  assert.equal(f.calls.length, 0); assert.equal(f.bridge.exportProject(), before);
  assert.equal(Drafts.hasPending(f.bridge, f.bridge.getProject().id), true);
  assert.throws(() => f.controller.save(), /decimal/);
  f.controller.discard();
  assert.equal(Drafts.hasPending(f.bridge), false);
});

test('explicit Save inputs is one project command and JSON/Undo/Redo preserve nullable inputs and unrelated state', t => {
  const f = fixture(() => response({})); t.after(() => f.controller.dispose());
  const before = clone(f.bridge.getProject());
  f.controller.setValue('air.initialC', '23');
  f.controller.save();
  const after = f.bridge.getProject(), row = after.environment.coupledCfd.scenarios[0];
  assert.equal(row.scenario.air.initialC, 23);
  assert.equal(row.scenario.air.pressurePa, null);
  assert.equal(Drafts.hasPending(f.bridge), false);
  assert.deepEqual(after.legacy, before.legacy); assert.deepEqual(after.floors, before.floors);
  f.bridge.undo(); assert.equal(f.bridge.getProject().environment.coupledCfd, undefined);
  assert.equal(f.controller.getState().form.air.initialC, null);
  f.bridge.redo(); assert.equal(f.controller.getState().form.air.initialC, 23);
  assert.equal(JSON.parse(f.bridge.exportProject()).environment.coupledCfd.scenarios[0].scenario.air.initialC, 23);
});

test('drafts are owned by project/floor/room and conflict with concurrent saved input changes', t => {
  const f = fixture(() => response({})); t.after(() => f.controller.dispose());
  const first = f.controller.getState().roomId;
  f.controller.setValue('air.initialC', '25');
  f.controller.selectRoom('ground:kitchen');
  assert.equal(f.controller.getState().form.air.initialC, null);
  f.controller.setValue('air.initialC', '27');
  f.controller.selectRoom(first); assert.equal(f.controller.getState().form.air.initialC, '25');
  f.controller.save();
  f.controller.setValue('air.initialC', '26');
  const updated = clone(f.bridge.getProject().environment.coupledCfd);
  updated.scenarios[0].scenario.air.initialC = 30;
  f.bridge.execute({ type: 'set-environment', patch: { coupledCfd: updated } });
  assert.equal(f.controller.getState().conflict, true);
  assert.throws(() => f.controller.save(), /Saved inputs changed/);
  f.controller.keepDraft(); f.controller.save();
  assert.equal(f.bridge.getProject().environment.coupledCfd.scenarios[0].scenario.air.initialC, 26);
});

test('prepare returns an immutable provenance-bound case, does not run, and survives irrelevant project changes', async t => {
  const f = fixture((url, payload) => response({ status: 'prepared', manifest: manifest(payload) }));
  t.after(() => f.controller.dispose()); fill(f.controller);
  assert.equal(await f.controller.prepare(), true);
  assert.equal(f.controller.getState().status, 'prepared');
  assert.equal(f.controller.getState().result, null);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, '/api/cfd/prepare');
  f.bridge.execute({ type: 'rename-project', name: 'Only a label changed' });
  assert.ok(f.controller.getState().manifest);
  f.controller.setValue('air.initialC', '21');
  assert.equal(f.controller.getState().manifest, null);
});

test('stale prepare responses and same-revision divergent physical geometry cannot be published', async t => {
  let resolve;
  const f = fixture((url, payload) => new Promise(done => { resolve = () => done(response({ status: 'prepared', manifest: manifest(payload) })); }));
  t.after(() => f.controller.dispose()); fill(f.controller);
  const pending = f.controller.prepare();
  f.controller.setValue('solid.initialC', '21'); resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.getState().manifest, null);
  f.controller.setValue('acknowledgeGeometry', true);
  const opening = f.controller.getState().inventory.geometry.openings[0];
  f.controller.openingOperation(opening.id, 1);
  assert.equal(f.controller.getState().form.acknowledgeGeometry, false);
  assert.equal(f.controller.getState().inventory.geometry.openings.find(row => row.id === opening.id).openFraction, 1);
});

test('publication recaptures physical inputs even when no project notification was delivered', async t => {
  const bridge = controllerFor(project());
  let drawing = bridge.getDrawingScene(), resolve;
  const planner = { ...bridge, getDrawingScene: () => drawing, subscribe: () => () => {} };
  const runtime = { location: { protocol: 'http:', hostname: 'localhost' }, fetch: (url, options) =>
    new Promise(done => { resolve = () => done(response({ status: 'prepared', manifest: manifest(JSON.parse(options.body)) })); }) };
  const controller = UI.createController(planner, runtime); t.after(() => controller.dispose());
  fill(controller);
  const pending = controller.prepare();
  const revised = clone(drawing);
  revised.scenes[0].openings.find(opening => opening.id === 'ground:bathroom-window').openFraction = 1;
  assert.equal(revised.revision, drawing.revision);
  drawing = revised; resolve();
  assert.equal(await pending, false);
  assert.equal(controller.getState().manifest, null);
  assert.match(controller.getState().message, /geometry changed/);
});

test('the real result contract is checked before a heatmap; engine absence has no numeric fallback', async t => {
  let prepared;
  const f = fixture((url, payload) => {
    if (url.endsWith('/prepare')) { prepared = manifest(payload); return response({ status: 'prepared', manifest: prepared }); }
    if (url.endsWith('/runtime')) return response({ execution: { available: false, status: 'unavailable', message: 'WSL2 unavailable' } });
    throw new Error('No solve should run');
  });
  t.after(() => f.controller.dispose()); fill(f.controller); await f.controller.prepare(); await f.controller.checkEngine();
  await assert.rejects(f.controller.run(), /local engine/);
  assert.equal(f.controller.getState().result, null);
  const captured = { manifest: prepared, request: f.calls[0].payload }, output = result(prepared);
  assert.equal(UI.verifyResult(output, captured).samples.length, 4);
  for (const edit of [
    r => { r.source.roomId = 'another'; },
    r => { r.samples[0].velocityMps.x = NaN; },
    r => { r.samples[0].speedMps = 9; },
    r => { r.timeSeconds = 1; },
    r => { r.samples.pop(); }
  ]) {
    const bad = clone(output); edit(bad); assert.throws(() => UI.verifyResult(bad, captured));
  }
});

test('running and completed jobs use only matching actual output and clear it on physical input change', async t => {
  let prepared;
  const f = fixture((url, payload) => {
    if (url.endsWith('/prepare')) { prepared = manifest(payload); return response({ status: 'prepared', manifest: prepared }); }
    if (url.endsWith('/runtime')) return response({ execution: { available: true, status: 'ready', message: 'TEST transport ready' } });
    if (url.endsWith('/jobs')) return response({ job: job(prepared) });
    if (url.endsWith('/result')) return response({ status: 'computed-unvalidated', result: result(prepared) });
    return response({ job: job(prepared, 'completed') });
  });
  t.after(() => f.controller.dispose()); fill(f.controller); await f.controller.prepare(); await f.controller.checkEngine();
  await f.controller.run(); await settle(); await settle();
  assert.equal(f.controller.getState().status, 'completed');
  assert.equal(f.controller.getState().result.samples.length, 4);
  const output = UI.plotSvg(f.controller.getState().inventory.geometry, f.controller.getState().result);
  assert.match(output, /<circle/); assert.match(output, /discrete solver samples/);
  f.controller.clear(); assert.equal(f.controller.getState().result, null);
});

test('a late run-start response is cancelled by exact job ID after Clear, without publishing or losing the server job', async t => {
  let prepared, resolveRun;
  const f = fixture((url, payload) => {
    if (url.endsWith('/prepare')) { prepared = manifest(payload); return response({ status: 'prepared', manifest: prepared }); }
    if (url.endsWith('/runtime')) return response({ execution: { available: true, status: 'ready', message: 'TEST transport ready' } });
    if (url.endsWith('/jobs')) return new Promise(resolve => { resolveRun = () => resolve(response({ job: job(prepared) })); });
    if (url.endsWith('/cancel')) return response({ job: job(prepared, 'cancelled') });
    throw new Error('Retired job must not be polled');
  });
  t.after(() => f.controller.dispose()); fill(f.controller); await f.controller.prepare(); await f.controller.checkEngine();
  const pending = f.controller.run(); f.controller.clear(); resolveRun();
  assert.equal(await pending, false);
  assert.equal(f.controller.getState().result, null);
  assert.equal(f.calls.at(-1).url, '/api/cfd/jobs/11111111-1111-4111-8111-111111111111/cancel');
});

test('cancellation waits for a terminal server state and cannot overwrite a later input edit', async t => {
  let prepared, cancelling = false, resolveCancel;
  const f = fixture((url, payload) => {
    if (url.endsWith('/prepare')) { prepared = manifest(payload); return response({ status: 'prepared', manifest: prepared }); }
    if (url.endsWith('/runtime')) return response({ execution: { available: true, status: 'ready', message: 'TEST ready' } });
    if (url.endsWith('/jobs')) return response({ job: job(prepared) });
    if (url.endsWith('/cancel')) return new Promise(resolve => {
      resolveCancel = () => { cancelling = true; resolve(response({ job: job(prepared, 'cancelling') })); };
    });
    return response({ job: job(prepared, cancelling ? 'cancelled' : 'running') });
  });
  t.after(() => f.controller.dispose()); fill(f.controller); await f.controller.prepare(); await f.controller.checkEngine();
  await f.controller.run(); await settle();
  const cancellation = f.controller.cancel(); resolveCancel(); await cancellation;
  assert.equal(f.controller.getState().status, 'cancelling');
  const follow = [...f.timers.values()].at(-1); follow(); await settle();
  assert.equal(f.controller.getState().status, 'cancelled');
  assert.equal(f.controller.getState().result, null);
  cancelling = false; await f.controller.prepare(); await f.controller.run(); await settle();
  const second = f.controller.cancel(); f.controller.setValue('air.initialC', '22'); resolveCancel(); await second;
  assert.equal(f.controller.getState().status, 'stale');
  assert.equal(f.controller.getState().form.air.initialC, '22');
});

test('cancelling preparation rejects its late completion without claiming an engine was stopped', async t => {
  let resolve;
  const f = fixture((url, payload) => new Promise(done => {
    resolve = () => done(response({ status: 'prepared', manifest: manifest(payload) }));
  }));
  t.after(() => f.controller.dispose()); fill(f.controller);
  const pending = f.controller.prepare(); await f.controller.cancel(); resolve(); await pending;
  assert.equal(f.controller.getState().manifest, null);
  assert.match(f.controller.getState().message, /No solver was started/);
});

test('CFD has a dedicated reachable route with production script ordering and no unconditional network', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const Workspace = require('../planner-workspace.js');
  assert.equal(Workspace.viewFor('environment/cfd'), 'env-cfd');
  assert.equal((html.match(/id="workspaceCfd"/g) || []).length, 1);
  assert.ok(html.indexOf('src="planner-cfd.js"') > html.indexOf('src="planner-projection.js"'));
  assert.ok(html.indexOf('src="planner-cfd-ui.js"') > html.indexOf('src="planner-drafts.js"'));
  assert.ok(html.includes('href="planner-cfd-ui.css"'));
});
