const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('nearby-obstacle edits preserve metadata and reject facade or deleted edit targets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf("      bindForm('env-obstacle-form'");
  const end = source.indexOf("      bindClick('env-obstacle-new'", start);
  assert.ok(start >= 0 && end > start);
  const facade = { id: 'facade', facade: { version: 1, finish: 'Unverified cladding' } };
  const neighbour = { id: 'neighbour', userMetadata: { source: 'Manual' } };
  const project = { obstacles: [neighbour, facade] }, commands = [];
  const fields = { 'env-obstacle-id': 'neighbour', 'env-obstacle-label': 'Updated building',
    'env-obstacle-type': 'building', 'env-obstacle-w': '3', 'env-obstacle-h': '4',
    'env-obstacle-height': '5' };
  let save;
  vm.runInNewContext(source.slice(start, end), {
    bindForm(form, error, handler) { save = handler; },
    value: id => fields[id], by: () => ({}),
    number: () => 0, positive: Number, copy: value => JSON.parse(JSON.stringify(value)),
    setStatus() {}, planner: { getProject: () => project, execute: command => commands.push(command) }
  });
  save();
  assert.deepEqual(commands[0].value[0].userMetadata, neighbour.userMetadata);
  assert.deepEqual(commands[0].value[1], facade);
  fields['env-obstacle-id'] = 'facade';
  assert.throws(save, /physical facade projections/);
  fields['env-obstacle-id'] = 'deleted';
  assert.throws(save, /no longer exists/);
  assert.equal(commands.length, 1);
});

test('stale nearby-obstacle edit and delete buttons cannot mutate facades', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf('      const onClick=event=>{');
  const end = source.indexOf("        if(layer)action(", start);
  assert.ok(start >= 0 && end > start);
  const records = [{ id: 'facade', facade: { version: 1, finish: null } }, { id: 'neighbour' }];
  const commands = [], errors = [];
  let click;
  vm.runInNewContext(source.slice(start, end) + '\n}; capture(onClick);', {
    capture: handler => { click = handler; },
    planner: { getProject: () => ({ id: 'one', activeFloorId: 'ground', floors: [{ id: 'ground', name: 'Ground' }], obstacles: records }), execute: command => commands.push(command) },
    action(id, handler) { try { handler(); } catch (error) { errors.push(error.message); } },
    value: () => '', setStatus() {}, root: { confirm: () => true }, by: () => ({ focus() {} }),
    syncForm() { assert.fail('Facade must not enter the neighbour editor'); }
  });
  const event = (kind, id) => ({ target: { closest(selector) {
    return selector === `[data-env-obstacle-${kind}]`
      ? { dataset: { [kind === 'edit' ? 'envObstacleEdit' : 'envObstacleRemove']: id } } : null;
  } } });
  click(event('edit', 'facade'));
  click(event('remove', 'facade'));
  click(event('remove', 'deleted'));
  assert.equal(commands.length, 0);
  assert.equal(errors.length, 3);
  click(event('remove', 'neighbour'));
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].value, [records[0]]);
});

test('failed wind submission invalidates old results without retaining a running status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf("      bindForm('env-wind-form'");
  const end = source.indexOf("      bindClick('env-pressure-template'", start);
  assert.ok(start >= 0 && end > start, 'The real wind form binding must be available');
  let submit, status = 'Previous successful result', result = { old: true };
  const rose = { innerHTML: 'Previous chart' };
  const fields = {
    'env-wind-source': 'weather', 'env-wind-month': '', 'env-wind-hours': 'all',
    'env-wind-clock': 'site', 'env-window-width': '1', 'env-window-height': '1'
  };
  vm.runInNewContext(source.slice(start, end), {
    bindForm(form, error, handler) {
      assert.equal(form, 'env-wind-form');
      assert.equal(error, 'env-wind-error');
      submit = handler;
    },
    needData() {},
    invalidateWind(message) { status = message; result = null; },
    by(id) { assert.equal(id, 'env-wind-rose'); return rose; },
    value: id => fields[id],
    number: () => 0,
    positive: value => Number(value),
    planner: { getProject: () => ({ environment: {} }) }
  });
  assert.throws(() => submit(), /Import weather.*No data were fetched/);
  assert.equal(result, null);
  assert.equal(rose.innerHTML, '');
  assert.equal(status, 'Wind results cleared. Complete a valid scenario to calculate.');
  assert.doesNotMatch(status, /building|running|calculating/i);
});

for (const [id, next, inputs, checked, field] of [
  ['env-site-form', "      bindClick('env-detect'", { 'env-lat': 19.5, 'env-lon': 78.2, 'env-zone': 'Asia/Kolkata' }, 'env-site-verified', 'siteProvenance'],
  ['env-building-form', "      bindForm('env-storey-form'", { 'env-wall-height': 3.1, 'env-base': 0.4, 'env-roof': 0.15 }, 'env-geometry-ack', 'buildingAssumptions']
]) test(`${id} applies inputs and provenance with one environmentPatch command`, () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf(`      bindForm('${id}'`), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  const commands = [], notices = []; let submit;
  vm.runInNewContext(source.slice(start, end), {
    bindForm(form, error, handler) { submit = handler; },
    value: key => inputs[key], number: key => inputs[key], positive: Number,
    by: key => ({ checked: key === checked }), Intl, Date,
    planner: { getProject: () => ({ activeFloorId: 'ground' }), execute: command => commands.push(command) },
    setStatus(id, message) { notices.push(message); }
  });
  submit();
  assert.equal(commands.length, 1);
  assert.ok(commands[0].environmentPatch[field]);
  assert.equal(commands[0].environmentPatch.schemaVersion, 1);
  assert.match(notices[0], /one Undo step.*Save now/);
  if (field === 'siteProvenance') {
    assert.equal(commands[0].patch.latitude, 19.5);
    assert.equal(commands[0].environmentPatch.siteProvenance.latitude, 19.5);
    assert.equal(commands[0].environmentPatch.siteProvenance.buildingSiteConfirmed, true);
  } else {
    assert.equal(commands[0].patch.wallHeightM, 3.1);
    assert.equal(commands[0].environmentPatch.buildingAssumptions.floorId, 'ground');
    assert.equal(commands[0].environmentPatch.buildingAssumptions.acknowledged, true);
  }
});

test('form submit ownership guard rejects an unrendered floor change and a changed saved input', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf('    function assertFormOwner(id){'), end = source.indexOf('    function discardForm(id){', start);
  const Drafts = require('../planner-drafts.js');
  const owner = { projectId: 'one', floorId: 'ground', entityId: 'env-storey-form' };
  let current = { ...owner }, base = '3', assertOwner;
  vm.runInNewContext(source.slice(start, end) + '\ncapture(assertFormOwner);', {
    formOwners: new Map([['env-storey-form', owner]]), Drafts,
    formScope: () => current, formBase: () => base,
    drafts: { get: () => ({ base: '3' }) }, capture: fn => { assertOwner = fn; }
  });
  assert.doesNotThrow(() => assertOwner('env-storey-form'));
  current = { ...owner, floorId: 'upper' };
  assert.throws(() => assertOwner('env-storey-form'), /original owner/);
  current = owner; base = '4';
  assert.throws(() => assertOwner('env-storey-form'), /Saved inputs changed.*draft is retained/);
});

test('a calculation stores its inputs and result in one environment patch without changing other results', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf('    function storeResult('), end = source.indexOf('    function prepareExperiment(', start);
  assert.ok(start >= 0 && end > start);
  const prior = { input: { preserved: null }, output: { measured: false } };
  const project = { revision: 8, site: { latitude: 0 }, building: { wallHeightM: 3 }, environment: { results: { prior } } };
  const commands = []; let store;
  vm.runInNewContext(source.slice(start, end) + '\ncapture(storeResult);', {
    planner: { getProject: () => project },
    currentGeometryKey: () => 'geometry-8', scenes: () => [],
    copy: value => JSON.parse(JSON.stringify(value)), Date,
    saveEnvironment: patch => commands.push(JSON.parse(JSON.stringify(patch))),
    capture: fn => { store = fn; }
  });
  const input = { capacityJ_K: 1000 }, output = { energyResidualJ: 0 };
  const entry = store('thermal', input, output, { notes: 'Synthetic reference' },
    { thermal: { input, notes: 'Synthetic reference', acknowledged: true } });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].thermal.input, input);
  assert.deepEqual(commands[0].results.thermal.output, output);
  assert.equal(commands[0].results.thermal.projectRevision, 8, 'The entry retains the captured source revision');
  assert.deepEqual(commands[0].results.prior, prior);
  input.capacityJ_K = 2000; output.energyResidualJ = 1;
  assert.equal(entry.input.capacityJ_K, 1000);
  assert.equal(entry.output.energyResidualJ, 0);
  assert.equal(project.environment.thermal, undefined);
});

for (const name of ['pressure', 'thermal']) {
  test(`${name} evaluation publishes once after calculation, and publishes nothing on a solver error`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
    const start = source.indexOf(`      bindForm('env-${name}-form'`);
    const end = source.indexOf(name === 'pressure' ? "      bindForm('env-thermal-form'" : "      bindClick('env-export-weather'", start);
    assert.ok(start >= 0 && end > start);
    const input = { fixture: name }, output = { exampleResult: true }, calls = [];
    let submit, fail = false;
    vm.runInNewContext(source.slice(start, end), {
      bindForm(form, error, handler) { submit = handler; },
      by: () => ({ innerHTML: '' }), requireAcknowledgement() {},
      pressureTemplateKey: 'geometry', thermalTemplateKey: 'geometry', currentGeometryKey: () => 'geometry',
      parseInput: () => input, validatePressureInput: value => value, validateThermalInput: value => value,
      scene: () => ({}), value: () => 'Explicit synthetic inputs',
      needPhysics: method => ({ [method]() {
        calls.push('calculate');
        if (fail) throw new Error('Synthetic numerical failure');
        return output;
      } }),
      saveEnvironment() { assert.fail('Inputs must not be applied separately before calculation'); },
      storeResult(resultName, actualInput, actualOutput, metadata, patch) {
        calls.push('store');
        assert.equal(resultName, name);
        assert.equal(actualInput, input); assert.equal(actualOutput, output);
        assert.equal(patch[name].input, input);
        assert.equal(patch[name].acknowledged, true);
        assert.equal(metadata.notes, patch[name].notes);
        return { input: actualInput, output: actualOutput };
      },
      renderPressure() { calls.push('render'); }, renderThermal() { calls.push('render'); }
    });
    submit();
    assert.deepEqual(calls, ['calculate', 'store', 'render']);
    calls.length = 0; fail = true;
    assert.throws(submit, /Synthetic numerical failure/);
    assert.deepEqual(calls, ['calculate']);
  });
}

test('clean focused environment fields follow restored values while pending fields are retained', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf('    function syncForm('), end = source.indexOf('    function renderObstacles(', start);
  const field = { value: '0.4', type: 'number' }, form = { dataset: {}, contains: () => true };
  const bases = new Map(); let sync;
  vm.runInNewContext(source.slice(start, end) + '\ncapture(syncForm);', {
    by: id => id === 'form' ? form : field, formBases: bases, formBase: () => 'saved-base',
    root: { document: { activeElement: field } }, capture: fn => { sync = fn; }
  });
  sync('form', { field: 0.2 });
  assert.equal(field.value, 0.2);
  form.dataset.dirty = 'true'; field.value = 'incomplete';
  sync('form', { field: 0.3 });
  assert.equal(field.value, 'incomplete');
  form.dataset.reload = 'true';
  sync('form', { field: 0.3 });
  assert.equal(field.value, 0.3);
  assert.equal(form.dataset.dirty, '');
});

test('successful form application clears only its unchanged owned draft; failure retains it', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf('    async function applyForm('), end = source.indexOf('    function bindForm(', start);
  const Drafts = require('../planner-drafts.js');
  const scope = { projectId: 'project', floorId: 'ground', entityId: 'form' };
  const form = { dataset: { dirty: 'true' } }, pending = new Map([[Drafts.key(scope), { value: 'pending' }]]);
  let apply, renders = 0;
  vm.runInNewContext(source.slice(start, end) + '\ncapture(applyForm);', {
    assertFormOwner() {}, formOwners: new Map([['form', scope]]), formScope: () => scope, Drafts,
    formBases: new Map(), formBase: () => 'new-base', by: () => form,
    drafts: { get: owner => pending.get(Drafts.key(owner)), remove: owner => pending.delete(Drafts.key(owner)) },
    render() { renders++; }, capture: fn => { apply = fn; }
  });
  await assert.rejects(apply('form', () => { throw new Error('Rejected transaction'); }), /Rejected transaction/);
  assert.equal(pending.size, 1); assert.equal(form.dataset.dirty, 'true'); assert.equal(renders, 0);
  await apply('form', () => {});
  assert.equal(pending.size, 0); assert.equal(form.dataset.dirty, ''); assert.equal(renders, 1);
  pending.set(Drafts.key(scope), { value: 'before' }); form.dataset.dirty = 'true';
  await apply('form', () => { pending.set(Drafts.key(scope), { value: 'typed during apply' }); });
  assert.equal(pending.get(Drafts.key(scope)).value, 'typed during apply');
  assert.equal(form.dataset.dirty, 'true');
});

for (const reject of [false, true]) test(`device location uses one compound command and retains draft on failure (${reject})`, async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'environment-ui.js'), 'utf8');
  const start = source.indexOf("      bindClick('env-detect'"), end = source.indexOf("      bindForm('env-building-form'", start);
  const siteForm = { dataset: { dirty: 'true' } }, detect = { disabled: false };
  const commands = [], synced = [], removed = [], project = { site: { timeZone: 'Asia/Kolkata' } };
  let run;
  vm.runInNewContext('let locationOperation=0,destroyed=false;\n' + source.slice(start, end), {
    bindClick(id, error, handler) { run = handler; },
    root: { confirm: () => true, HomePlannerLocation: { detect: async () => ({
      latitude: 19.5, longitude: 78.2, accuracyM: 8, timestamp: 1789600000000
    }) } },
    by: id => id === 'env-site-form' ? siteForm : detect,
    planner: { getProject: () => project, execute: command => {
      commands.push(command); if (reject) throw new Error('Rejected site transaction');
    } },
    siteKey: () => 'unchanged-owner', requireNumber() {}, setStatus() {}, nice: String, Date,
    drafts: { remove: scope => removed.push(scope) }, formScope: () => ({ projectId: 'p', entityId: 'site' }),
    syncForm(...args) { synced.push(args); siteForm.dataset.dirty = ''; }, render() {}
  });
  if (reject) await assert.rejects(run(), /Rejected site transaction/); else await run();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].environmentPatch.siteProvenance.method, 'device');
  assert.equal(commands[0].environmentPatch.siteProvenance.buildingSiteConfirmed, false);
  assert.equal(commands[0].patch.latitude, 19.5);
  assert.equal(removed.length, reject ? 0 : 1);
  assert.equal(synced.length, reject ? 0 : 1);
  assert.equal(siteForm.dataset.dirty, reject ? 'true' : '');
  assert.equal(detect.disabled, false);
});
