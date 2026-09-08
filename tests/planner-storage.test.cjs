const test = require('node:test');
const assert = require('node:assert/strict');
const Storage = require('../planner-storage.js');
const Persistence = require('../planner-persistence.js');

const time = '2026-09-08T10:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const code = expected => error => error.code === expected;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function project(id = 'project-one', revision = 0) {
  const legacy = { controls: { bedCount: { value: '2' } }, manualLayouts: [['shape', { rooms: [] }]], context: null };
  return {
    schemaVersion: 1, id, name: 'Home study', revision,
    site: { latitude: 17.385, longitude: 78.4867, timeZone: 'Asia/Kolkata' },
    building: { wallHeightM: 2.7, floorElevationM: 0, roofThicknessM: .15 },
    wallEdits: {}, doorEdits: {}, windowEdits: {}, furnitureEdits: {}, obstacles: [], electrical: [],
    activeFloorId: 'ground', legacy: copy(legacy),
    floors: [
      { id: 'ground', name: 'Ground', heightM: 3, legacy: copy(legacy), electrical: [{ id: 'ground:socket', x: 2, y: 3 }] },
      { id: 'upper', name: 'Upper', heightM: 3.2, legacy: copy(legacy), wallEdits: { 'upper:partition': { full: true } } }
    ],
    environment: {
      weather: { source: { provider: 'User-supplied example', provenance: { importedAt: time, classification: 'TMY' } },
        records: [{ timestamp: time, temperatureC: null, missing: ['temperatureC'], windSpeedMps: 2.5 }] },
      scenarios: [{ acknowledged: true, layers: [{ label: 'Test insulation', conductivityW_MK: .04 }] }]
    }
  };
}

test('database and setting names are static, local and versioned', () => {
  assert.equal(Storage.DB_NAME, 'HomePlanner.local-projects');
  assert.equal(Storage.DB_VERSION, 1);
  assert.equal(Storage.RECORD_VERSION, 1);
  assert.equal(Storage.AUTOSAVE_SETTING, 'autosave-enabled');
  assert.equal(Storage.LAST_PROJECT_SETTING, 'last-project-id');
});

test('project envelopes retain every floor, weather sample and provenance as independent snapshots', () => {
  const input = project(), before = copy(input);
  const record = Storage.createRecord(input, undefined, time);
  input.floors[1].wallEdits['upper:partition'].full = false;
  input.environment.weather.records[0].windSpeedMps = 55;
  assert.deepEqual(record.document, before);
  assert.equal(record.id, before.id);
  assert.equal(record.revision, before.revision);
  assert.equal(record.createdAt, time);
  assert.equal(record.updatedAt, time);
  const read = Storage.readRecord(record);
  read.document.site.latitude = 0;
  assert.equal(record.document.site.latitude, 17.385);
});

test('saving commits metadata with the document and preserves creation time', () => {
  const first = Storage.createRecord(project(), undefined, time);
  const next = project('project-one', 2);
  next.name = 'Upper-floor study';
  const saved = Storage.createRecord(next, first, '2026-09-08T11:00:00.000Z');
  assert.equal(saved.createdAt, first.createdAt);
  assert.equal(saved.updatedAt, '2026-09-08T11:00:00.000Z');
  assert.equal(saved.name, next.name);
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.document, next);
  assert.equal(Storage.createRecord(project('project-one', 3), saved, time).updatedAt, saved.updatedAt);
});

test('same-revision saves are idempotent even if JSON property order changes', () => {
  const old = Storage.createRecord(project(), undefined, time);
  const reordered = Object.fromEntries(Object.entries(old.document).reverse());
  assert.deepEqual(Storage.createRecord(reordered, old, '2026-09-09T00:00:00.000Z'), old);
});

test('stale or divergent revisions never overwrite a recoverable record', () => {
  const old = Storage.createRecord(project('project-one', 4), undefined, time);
  assert.throws(() => Storage.createRecord(project('project-one', 3), old, time), code('StaleRevisionError'));
  const conflict = project('project-one', 4);
  conflict.environment.weather.records[0].windSpeedMps = 3;
  assert.throws(() => Storage.createRecord(conflict, old, time), code('RevisionConflictError'));
  assert.equal(old.document.environment.weather.records[0].windSpeedMps, 2.5);
});

test('newer schema, newer envelope formats and corrupt metadata are explicit failures', () => {
  const record = Storage.createRecord(project(), undefined, time);
  for (const mutate of [
    value => { value.revision++; },
    value => { value.name = 'Misleading metadata'; },
    value => { value.id = 'other-project'; },
    value => { value.updatedAt = 'not a date'; }
  ]) {
    const corrupt = copy(record); mutate(corrupt);
    assert.throws(() => Storage.readRecord(corrupt), code('CorruptRecordError'));
    assert.throws(() => Storage.createRecord(project('project-one', 10), corrupt, time));
  }
  const future = copy(record); future.recordVersion = 2;
  assert.throws(() => Storage.readRecord(future), code('UnsupportedRecordVersionError'));
  assert.throws(() => Storage.createRecord(project('project-one', 10), future, time), code('UnsupportedRecordVersionError'));
  const newerProject = project(); newerProject.schemaVersion = 2;
  assert.throws(() => Storage.parseProject(JSON.stringify(newerProject)), code('UnsupportedSchemaVersionError'));
  assert.throws(() => Storage.readRecord(record, undefined, 'wrong-key'), code('CorruptRecordError'));
});

test('minimal schema checks reject missing required fields, invalid values and ambiguous IDs', () => {
  for (const mutate of [
    value => { delete value.revision; },
    value => { value.revision = -1; },
    value => { value.revision = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.site.latitude = 91; },
    value => { value.building.wallHeightM = 0; },
    value => { value.floors[1].id = value.floors[0].id; },
    value => { delete value.floors[1].legacy; },
    value => { value.activeFloorId = 'missing'; },
    value => { delete value.legacy; },
    value => { value.electrical = {}; },
    value => { value.name = ' '; },
    value => { value.id = '__proto__'; }
  ]) {
    const invalid = project(); mutate(invalid);
    assert.throws(() => Storage.validateProject(invalid));
  }
});

test('shared model validation accepts document/true/void but never false or an error result', () => {
  for (const result of [true, undefined, project(), { valid: true }, { ok: true, errors: [] }]) {
    assert.deepEqual(Storage.validateProject(project(), { validateProject: () => result }), project());
  }
  for (const result of [false, null, 0, '', [], {}, { valid: false }, { ok: false }, { valid: 'false' },
    { errors: ['invalid field'] }, { errors: 'invalid field' }]) {
    assert.throws(() => Storage.validateProject(project(), { validateProject: () => result }), code('ProjectValidationError'));
  }
  assert.throws(() => Storage.validateProject(project(), { validateProject() { throw new Error('password=private-value'); } }),
    error => error.code === 'ProjectValidationError' && !error.message.includes('private-value'));
});

test('model validation cannot silently mutate or discard stored JSON extension fields', () => {
  let parsed = false;
  const model = {
    validateProject(value) { delete value.environment.weather; value.site.latitude = 0; return value; },
    parseProject(text) { parsed = true; return JSON.parse(text); }
  };
  assert.deepEqual(Storage.parseProject(JSON.stringify(project()), model), project());
  assert.equal(parsed, true);
  assert.throws(() => Storage.parseProject(JSON.stringify(project()), { parseProject: () => false }), code('ProjectValidationError'));
  assert.throws(() => Storage.parseProject('{ broken'), code('InvalidJSONError'));
  const annotated = project(); annotated.errors = ['A user annotation, not a validator result'];
  assert.deepEqual(Storage.validateProject(annotated, { validateProject: value => value }), annotated);
});

test('unsafe JSON cannot invoke getters, custom prototypes or prototype injection', () => {
  let invoked = false;
  const getter = { get value() { invoked = true; return 'bad'; } };
  assert.throws(() => Storage.cloneJSON(getter), code('UnsafeJSONError'));
  assert.equal(invoked, false);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const malicious = `{"safe":{"${key}":{"polluted":true}}}`;
    assert.throws(() => Storage.cloneJSON(JSON.parse(malicious)), code('UnsafeJSONError'));
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => Storage.cloneJSON(Object.create({ inherited: true })), code('UnsafeJSONError'));
  assert.throws(() => Storage.cloneJSON(new Date()), code('UnsafeJSONError'));
  assert.deepEqual(Storage.cloneJSON(Object.assign(Object.create(null), { safe: true })), { safe: true });
});

test('non-JSON values are rejected rather than dropped, zeroed or coerced', () => {
  const circular = {}; circular.self = circular;
  for (const value of [{ a: undefined }, { a: NaN }, { a: Infinity }, { a: BigInt(1) }, { a() {} }, circular,
    Array(2), Object.assign([], { extra: true }), { [Symbol('hidden')]: 1 }]) {
    assert.throws(() => Storage.cloneJSON(value));
  }
  const shared = { value: null };
  assert.deepEqual(Storage.cloneJSON([shared, shared]), [{ value: null }, { value: null }]);
});

test('security, quota and version failures keep useful codes without exposing raw messages', async () => {
  await assert.rejects(Storage.open(null), code('UnavailableError'));
  for (const name of ['SecurityError', 'QuotaExceededError', 'VersionError']) {
    await assert.rejects(Storage.open({ open() { throw { name, message: 'https://user:secret@example.test' }; } }),
      error => error.code === name && !Persistence.errorText(error).includes('secret'));
  }
});

test('a blocked open rejects and closes a connection that arrives later', async () => {
  const request = {}, db = { closed: false, close() { this.closed = true; } };
  const result = Storage.open({ open(name, version) {
    assert.equal(name, Storage.DB_NAME); assert.equal(version, Storage.DB_VERSION);
    queueMicrotask(() => request.onblocked());
    return request;
  } });
  await assert.rejects(result, code('BlockedError'));
  request.result = db; request.onsuccess();
  assert.equal(db.closed, true);
});

// Scripted request events test settlement rules, not an emulation of IndexedDB.
function scriptedDatabase(version = 1) {
  const transactions = [];
  const db = {
    version, closed: false,
    objectStoreNames: { contains: name => ['projects', 'settings'].includes(name) },
    close() { this.closed = true; },
    transaction(names, mode) {
      const tx = {
        names, mode, requests: [], aborted: false, error: null,
        abort() { this.aborted = true; queueMicrotask(() => this.onabort && this.onabort()); },
        complete() { if (this.oncomplete) this.oncomplete(); },
        objectStore(name) {
          function request(type, value) {
            const req = { type, value, result: undefined, error: null,
              succeed(result) { this.result = result; this.onsuccess(); },
              fail(error) { this.error = error; this.onerror(); } };
            tx.requests.push(req);
            return req;
          }
          return { keyPath: name === 'projects' ? 'id' : 'key',
            get: key => request('get', key), put: value => request('put', value),
            delete: key => request('delete', key), openCursor: () => request('cursor') };
        }
      };
      transactions.push(tx);
      if (transactions.length === 1) queueMicrotask(() => tx.complete());
      return tx;
    }
  };
  const factory = { open() {
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  return { factory, db, transactions };
}

test('save uses one readwrite transaction and resolves only after commit, not put success', async () => {
  const script = scriptedDatabase(), store = await Storage.open(script.factory);
  const input = project();
  let settled = false;
  const promise = store.save(input).then(value => { settled = true; return value; });
  input.environment.weather.records[0].windSpeedMps = 100;
  const tx = script.transactions[1];
  assert.deepEqual(tx.names, ['projects']);
  assert.equal(tx.mode, 'readwrite');
  tx.requests[0].succeed(undefined);
  const put = tx.requests[1];
  assert.equal(put.value.document.environment.weather.records[0].windSpeedMps, 2.5);
  put.succeed(input.id);
  await tick();
  assert.equal(settled, false);
  tx.complete();
  assert.equal((await promise).document.environment.weather.records[0].windSpeedMps, 2.5);
  store.close();
  await assert.rejects(store.load(input.id), code('StorageClosedError'));
});

test('quota errors and explicit transaction aborts reject a save', async () => {
  for (const quota of [true, false]) {
    const script = scriptedDatabase(), store = await Storage.open(script.factory);
    const promise = store.save(project());
    const checked = assert.rejects(promise, code(quota ? 'QuotaExceededError' : 'AbortError'));
    const tx = script.transactions[1];
    tx.requests[0].succeed(undefined);
    if (quota) tx.requests[1].fail({ name: 'QuotaExceededError', message: 'private path' });
    else { tx.requests[1].succeed('project-one'); tx.abort(); }
    await checked;
    assert.equal(tx.aborted, true);
    store.close();
  }
});

test('corrupt stored projects are never overwritten and list reports unreadable entries explicitly', async () => {
  const script = scriptedDatabase(), store = await Storage.open(script.factory);
  const corrupt = Storage.createRecord(project(), undefined, time); corrupt.recordVersion = 10;
  const promise = store.save(project('project-one', 5));
  const rejected = assert.rejects(promise, code('UnsupportedRecordVersionError'));
  script.transactions[1].requests[0].succeed(corrupt);
  await rejected;
  assert.equal(script.transactions[1].requests.length, 1);
  const listed = store.list(), tx = script.transactions[2], req = tx.requests[0];
  req.succeed({ primaryKey: 'project-one', value: corrupt, continue() {
    queueMicrotask(() => { req.succeed(null); tx.complete(); });
  } });
  const records = await listed;
  assert.equal(records[0].unreadable, true);
  assert.equal(records[0].error.code, 'UnsupportedRecordVersionError');
  assert.equal(Object.hasOwn(records[0], 'document'), false);
  const load = store.load('project-one');
  const loadRejected = assert.rejects(load, code('UnsupportedRecordVersionError'));
  script.transactions[3].requests[0].succeed(corrupt);
  await loadRejected;
  store.close();
});

test('settings are validated and unknown settings formats are not reset', async () => {
  const script = scriptedDatabase(), store = await Storage.open(script.factory);
  const promise = store.setSetting(Storage.AUTOSAVE_SETTING, true);
  const rejected = assert.rejects(promise, code('CorruptSettingError'));
  script.transactions[1].requests[0].succeed({ recordVersion: 2, key: Storage.AUTOSAVE_SETTING, value: false });
  await rejected;
  assert.equal(script.transactions[1].requests.length, 1);
  await assert.rejects(store.setSetting('test', undefined), code('InvalidJSONValueError'));
  const absent = store.getSetting('missing');
  script.transactions[2].requests[0].succeed(undefined);
  script.transactions[2].complete();
  assert.equal(await absent, undefined);
  store.close();
});

test('database structure/version mismatches and version changes close rather than reset data', async () => {
  const future = scriptedDatabase(2);
  await assert.rejects(Storage.open(future.factory), code('DatabaseSchemaError'));
  assert.equal(future.db.closed, true);
  const current = scriptedDatabase(), store = await Storage.open(current.factory);
  current.db.onversionchange();
  assert.equal(current.db.closed, true);
  await assert.rejects(store.save(project()), code('VersionChangedError'));
});

test('autosave serializes writes, coalesces pending revisions and does not drop other projects', async () => {
  const release = deferred(), writes = [];
  let active = 0, maxActive = 0;
  const queue = Storage.createSaveQueue(async snapshot => {
    maxActive = Math.max(maxActive, ++active);
    writes.push(copy(snapshot));
    if (writes.length === 1) await release.promise;
    active--;
    return { id: snapshot.id, revision: snapshot.revision };
  });
  const original = project('project-one', 1);
  const first = queue.enqueue(original);
  original.environment.weather.records[0].windSpeedMps = 100;
  await tick();
  const second = queue.enqueue(project('project-one', 2));
  const third = queue.enqueue(project('project-one', 3));
  const other = queue.enqueue(project('project-two', 1));
  release.resolve();
  const results = await Promise.all([first, second, third, other]);
  await queue.flush();
  assert.equal(maxActive, 1);
  assert.deepEqual(writes.map(value => [value.id, value.revision]), [['project-one', 1], ['project-one', 3], ['project-two', 1]]);
  assert.equal(writes[0].environment.weather.records[0].windSpeedMps, 2.5);
  assert.equal(results[1].revision, 3);
  assert.equal(results[2].revision, 3);
});

test('queued older or conflicting revisions reject before any late write', async () => {
  const gate = deferred(), writes = [];
  const queue = Storage.createSaveQueue(async snapshot => { writes.push(snapshot); await gate.promise; return snapshot; });
  const latest = queue.enqueue(project('project-one', 5));
  await assert.rejects(queue.enqueue(project('project-one', 4)), code('StaleRevisionError'));
  const conflict = project('project-one', 5); conflict.name = 'Conflict';
  await assert.rejects(queue.enqueue(conflict), code('RevisionConflictError'));
  gate.resolve();
  await latest;
  assert.equal(writes.length, 1);
});

test('failed writes reject waiters, remain visible to flush, and permit an explicit retry', async () => {
  let attempts = 0;
  const queue = Storage.createSaveQueue(async snapshot => {
    if (++attempts === 1) throw { name: 'QuotaExceededError' };
    return snapshot;
  });
  await assert.rejects(queue.enqueue(project()), code('QuotaExceededError'));
  await assert.rejects(queue.flush(), code('QuotaExceededError'));
  assert.equal((await queue.enqueue(project())).revision, 0);
  await queue.flush();
});

test('cancelling pending saves preserves the in-flight write and lets an explicit Open reset queue history', async () => {
  const gate = deferred(), writes = [];
  const queue = Storage.createSaveQueue(async snapshot => { writes.push(snapshot.revision); await gate.promise; return snapshot; });
  const first = queue.enqueue(project('project-one', 1));
  await tick();
  const later = queue.enqueue(project('project-one', 8));
  const rejected = assert.rejects(later, code('SaveCancelledError'));
  queue.cancel('project-one');
  assert.throws(() => queue.forget('project-one'), code('QueueBusyError'));
  gate.resolve();
  await Promise.all([first, rejected]);
  await queue.flush();
  queue.forget('project-one');
  await queue.enqueue(project('project-one', 2));
  assert.deepEqual(writes, [1, 2]);
  queue.close();
  await assert.rejects(queue.enqueue(project('new')), code('QueueClosedError'));
});

function memoryStore(initial = [], preferences = {}) {
  const records = new Map(initial.map(record => [record.id, copy(record)]));
  const settings = new Map(Object.entries(preferences)), saves = [], removed = [];
  const store = {
    records, settings, saves, removed, beforeLoad: null, beforeSave: null, beforeSetting: null,
    async list() { return [...records.values()].map(record => {
      try { return Storage.readRecord(record); }
      catch (error) { return { id: record.id, name: record.name, unreadable: true, error: { code: error.code, message: error.message } }; }
    }); },
    async load(id) {
      if (this.beforeLoad) await this.beforeLoad(id);
      return records.has(id) ? Storage.readRecord(records.get(id)) : null;
    },
    async save(snapshot) {
      if (this.beforeSave) await this.beforeSave(snapshot);
      const record = Storage.createRecord(snapshot, records.get(snapshot.id), time);
      records.set(record.id, copy(record));
      saves.push(copy(record));
      return record;
    },
    async remove(id) { removed.push(id); return records.delete(id); },
    async getSetting(key) { return settings.get(key); },
    async setSetting(key, value) {
      if (this.beforeSetting) await this.beforeSetting(key, value);
      settings.set(key, copy(value));
      return copy(value);
    },
    close() {}
  };
  return store;
}

function fakePlanner(initial = project()) {
  let document = copy(initial), newCount = 0;
  const listeners = new Set();
  const planner = {
    replacements: 0,
    getProject: () => document,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(type) { listeners.forEach(listener => listener({ type, project: document, selection: null })); },
    change(mutate) { document = copy(document); mutate(document); document.revision++; this.emit('change'); },
    execute(command) { assert.equal(command.type, 'rename-project'); this.change(value => { value.name = command.name; }); },
    replaceProject(next) { document = Storage.validateProject(next); this.replacements++; this.emit('project'); return document; },
    newProject() { return this.replaceProject(project(`new-project-${++newCount}`)); },
    exportProject: () => JSON.stringify(document, null, 2),
    importProject(text) { return this.replaceProject(Storage.parseProject(text)); }
  };
  return planner;
}

function clock() {
  let id = 0;
  const timers = new Map();
  return {
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(key) { timers.delete(key); },
    run() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    get pending() { return timers.size; }
  };
}

function controllerFor(t, planner, store, extra = {}) {
  const timer = clock();
  const controller = Persistence.createController(planner, {
    openStore: async () => store, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout, ...extra
  });
  t.after(() => controller.destroy());
  return { controller, timer };
}

test('first launch is opt-in: no project writes, no restore and no autosave for selection-only events', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  assert.equal(controller.getState().autosave, false);
  assert.equal(store.saves.length, 0);
  planner.emit('selection');
  assert.equal(timer.pending, 0);
  planner.change(value => { value.name = 'Memory only'; });
  timer.run(); await tick();
  assert.equal(store.saves.length, 0);
  assert.equal(controller.getState().dirty, true);
  assert.equal(planner.replacements, 0);
});

test('Save now works without enabling autosave and a later reload does not secretly restore it', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  await controller.saveNow();
  assert.equal(controller.getState().status, 'saved');
  assert.equal(controller.getState().autosave, false);
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), undefined);
  assert.equal(store.settings.get(Storage.LAST_PROJECT_SETTING), 'project-one');
  const nextPlanner = fakePlanner(project('fresh-boot'));
  const next = controllerFor(t, nextPlanner, store).controller;
  await next.ready;
  assert.equal(nextPlanner.getProject().id, 'fresh-boot');
  assert.equal(nextPlanner.replacements, 0);
});

test('opt-in saves edits, ignores selections, and commits the latest captured revision', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  await controller.setAutosave(true);
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), true);
  assert.equal(store.saves.length, 1);
  planner.emit('selection');
  assert.equal(timer.pending, 0);
  planner.change(value => { value.environment.weather.records[0].windSpeedMps = 4; });
  planner.change(value => { value.floors[1].heightM = 3.5; });
  assert.equal(timer.pending, 1);
  timer.run(); await tick();
  assert.equal(store.saves.at(-1).revision, 2);
  assert.equal(store.saves.at(-1).document.floors[1].heightM, 3.5);
  assert.equal(controller.getState().dirty, false);
});

test('previously enabled autosave restores exactly once, including inactive floors and weather', async t => {
  const saved = Storage.createRecord(project('remembered', 5), undefined, time);
  const store = memoryStore([saved], { [Storage.AUTOSAVE_SETTING]: true, [Storage.LAST_PROJECT_SETTING]: 'remembered' });
  const planner = fakePlanner(project('fresh-boot'));
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  assert.deepEqual(planner.getProject(), saved.document);
  assert.equal(planner.replacements, 1);
  assert.equal(controller.getState().dirty, false);
  await controller.retry();
  assert.equal(planner.replacements, 1);
  assert.equal(store.saves.length, 0);
});

test('edits during a delayed startup read prevent automatic restore and pause autosave', async t => {
  const gate = deferred();
  const saved = Storage.createRecord(project('remembered', 5), undefined, time);
  const store = memoryStore([saved], { [Storage.AUTOSAVE_SETTING]: true, [Storage.LAST_PROJECT_SETTING]: 'remembered' });
  store.beforeLoad = () => gate.promise;
  const planner = fakePlanner(project('fresh-boot')), { controller } = controllerFor(t, planner, store);
  await tick();
  planner.change(value => { value.name = 'My startup edits'; });
  gate.resolve();
  await controller.ready;
  assert.equal(planner.getProject().name, 'My startup edits');
  assert.equal(planner.replacements, 0);
  assert.equal(controller.getState().pendingRestoreId, 'remembered');
  assert.equal(controller.getState().autosave, true);
  assert.equal(controller.getState().paused, true);
  assert.equal(store.saves.length, 0);
  assert.deepEqual(store.records.get('remembered'), saved);
});

test('disposing controls during a startup read prevents a late restore', async t => {
  const gate = deferred(), saved = Storage.createRecord(project('remembered'), undefined, time);
  const store = memoryStore([saved], { [Storage.AUTOSAVE_SETTING]: true, [Storage.LAST_PROJECT_SETTING]: 'remembered' });
  store.beforeLoad = () => gate.promise;
  const planner = fakePlanner(), { controller } = controllerFor(t, planner, store);
  await tick();
  controller.destroy();
  gate.resolve();
  await controller.ready;
  assert.equal(planner.replacements, 0);
  await assert.rejects(controller.newProject(), code('StorageClosedError'));
});

test('corrupt/newer remembered records fail visibly without modifying them or the current project', async t => {
  const saved = Storage.createRecord(project('remembered'), undefined, time); saved.recordVersion = 3;
  const store = memoryStore([saved], { [Storage.AUTOSAVE_SETTING]: true, [Storage.LAST_PROJECT_SETTING]: 'remembered' });
  const planner = fakePlanner(project('working')), before = copy(planner.getProject());
  const { controller } = controllerFor(t, planner, store);
  await assert.rejects(controller.ready, code('UnsupportedRecordVersionError'));
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().projects[0].unreadable, true);
  assert.deepEqual(planner.getProject(), before);
  assert.deepEqual(store.records.get('remembered'), saved);
});

test('a nonboolean stored opt-in is an error, not truthy consent', async t => {
  const store = memoryStore([], { [Storage.AUTOSAVE_SETTING]: 'true' });
  const { controller } = controllerFor(t, fakePlanner(), store);
  await assert.rejects(controller.ready, code('CorruptSettingError'));
  assert.equal(controller.getState().autosave, false);
  assert.equal(store.saves.length, 0);
});

test('explicit Open also preserves edits made while its database read is pending', async t => {
  const saved = Storage.createRecord(project('selected'), undefined, time);
  const store = memoryStore([saved]), planner = fakePlanner();
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  const gate = deferred(); store.beforeLoad = () => gate.promise;
  const opening = controller.openProject('selected');
  const rejected = assert.rejects(opening, code('ProjectChangedError'));
  await tick();
  planner.change(value => { value.name = 'Edit while opening'; });
  gate.resolve();
  await rejected;
  assert.equal(planner.getProject().name, 'Edit while opening');
  assert.equal(planner.getProject().id, 'project-one');
});

test('Save remains Saving/unsaved until the write finishes and old completion does not mark new edits saved', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  const gate = deferred(); store.beforeSave = () => gate.promise;
  const saving = controller.saveNow();
  await tick();
  assert.equal(controller.getState().status, 'saving');
  planner.change(value => { value.name = 'Newer revision'; });
  gate.resolve();
  await saving;
  assert.equal(store.saves[0].revision, 0);
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().status, 'unsaved');
});

test('storage failure never reports Saved, and JSON backup/import still works in memory', async t => {
  const planner = fakePlanner(), before = copy(planner.getProject());
  const { controller } = controllerFor(t, planner, null, {
    openStore: async () => { throw { name: 'SecurityError', message: 'do not expose credentials' }; }
  });
  await assert.rejects(controller.ready, code('SecurityError'));
  assert.equal(controller.getState().available, false);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error.message.includes('credentials'), false);
  assert.deepEqual(JSON.parse(controller.exportJSON().text), before);
  assert.throws(() => controller.prepareImport('{"schemaVersion":true}'), code('UnsupportedSchemaVersionError'));
  assert.deepEqual(planner.getProject(), before);
  const imported = controller.prepareImport(JSON.stringify(project('imported-source', 8)));
  await controller.importPrepared(imported);
  assert.equal(planner.getProject().revision, 8);
  assert.equal(planner.getProject().environment.weather.source.provenance.classification, 'TMY');
  assert.equal(controller.getState().dirty, true);
  await controller.newProject();
  assert.equal(planner.getProject().id, 'new-project-1');
});

test('JSON import always creates a separate ID and keeps the previous saved project unchanged', async t => {
  const saved = Storage.createRecord(project(), undefined, time);
  const store = memoryStore([saved]), planner = fakePlanner();
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  const document = controller.prepareImport(JSON.stringify(saved.document));
  assert.notEqual(document.id, saved.id);
  await controller.importPrepared(document);
  await controller.saveNow();
  assert.equal(store.records.size, 2);
  assert.deepEqual(store.records.get(saved.id), saved);
  assert.deepEqual(planner.getProject().floors, saved.document.floors);
  assert.deepEqual(planner.getProject().environment, saved.document.environment);
});

test('false model validation prevents import without changing memory or browser records', async t => {
  const planner = fakePlanner(), store = memoryStore(), before = copy(planner.getProject());
  const { controller } = controllerFor(t, planner, store, { model: { validateProject: () => false } });
  await controller.ready;
  assert.throws(() => controller.prepareImport(JSON.stringify(project())), code('ProjectValidationError'));
  assert.deepEqual(planner.getProject(), before);
  assert.equal(store.saves.length, 0);
});

test('quota errors preserve memory, report the native code and never mark a failed save successful', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller } = controllerFor(t, planner, store);
  await controller.ready;
  store.beforeSave = () => { throw { name: 'QuotaExceededError', message: 'secret token' }; };
  await assert.rejects(controller.saveNow(), code('QuotaExceededError'));
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().dirty, true);
  assert.equal(store.saves.length, 0);
  assert.ok(controller.exportJSON().text.includes('User-supplied example'));
});

test('a failed first autosave keeps confirmed consent visible as paused and Save now can resume it', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  store.beforeSave = () => { throw { name: 'QuotaExceededError' }; };
  await assert.rejects(controller.setAutosave(true), code('QuotaExceededError'));
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), true);
  assert.equal(controller.getState().autosave, true);
  assert.equal(controller.getState().paused, true);
  assert.equal(controller.getState().dirty, true);
  assert.equal(controller.getState().status, 'error');
  store.beforeSave = null;
  await controller.saveNow();
  assert.equal(controller.getState().paused, false);
  assert.equal(controller.getState().status, 'saved');
  planner.change(value => { value.name = 'Autosave resumed'; });
  timer.run(); await tick();
  assert.equal(store.saves.at(-1).document.name, 'Autosave resumed');
});

test('disabling autosave cancels pending edits but retains the saved project', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  await controller.setAutosave(true);
  planner.change(value => { value.name = 'Do not autosave this edit'; });
  await controller.setAutosave(false);
  timer.run(); await tick();
  assert.equal(store.saves.length, 1);
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), false);
  assert.equal(controller.getState().dirty, true);
});

test('turning autosave off also cancels a timer callback waiting to enqueue its snapshot', async t => {
  const store = memoryStore(), planner = fakePlanner();
  const { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  await controller.setAutosave(true);
  planner.change(value => { value.name = 'Do not queue after opt-out'; });
  timer.run();
  await controller.setAutosave(false);
  await tick();
  assert.equal(store.saves.length, 1);
  assert.equal(controller.getState().dirty, true);
});

test('an opt-out preference failure keeps this tab off and warns about a possible reload resume', async t => {
  const store = memoryStore(), { controller } = controllerFor(t, fakePlanner(), store);
  await controller.ready;
  await controller.setAutosave(true);
  store.beforeSetting = () => { throw { name: 'QuotaExceededError' }; };
  await assert.rejects(controller.setAutosave(false), code('QuotaExceededError'));
  assert.equal(controller.getState().autosave, false);
  assert.match(controller.getState().error.message, /may resume on reload/);
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), true);
});

test('deleting the current browser copy turns off autosave and leaves working and other projects intact', async t => {
  const other = Storage.createRecord(project('other'), undefined, time), store = memoryStore([other]);
  const planner = fakePlanner(), { controller, timer } = controllerFor(t, planner, store);
  await controller.ready;
  await controller.setAutosave(true);
  planner.change(value => { value.name = 'Unsaved working copy'; });
  const before = copy(planner.getProject());
  await controller.deleteProject('project-one');
  timer.run(); await tick();
  assert.deepEqual(planner.getProject(), before);
  assert.equal(store.records.has('project-one'), false);
  assert.deepEqual(store.records.get('other'), other);
  assert.equal(controller.getState().autosave, false);
  assert.equal(controller.getState().dirty, true);
  assert.equal(store.settings.get(Storage.LAST_PROJECT_SETTING), null);
  assert.equal(store.settings.get(Storage.AUTOSAVE_SETTING), false);
});

test('export filenames are Windows-safe and errors do not echo untrusted exception messages', () => {
  for (const name of ['../secret\\project:*?"<>|\n', 'CON', 'nul.json', 'CON .json', ' ... ', 'COM1.txt', '🌤'.repeat(110)]) {
    const filename = Persistence.fileName(name);
    assert.ok(filename.endsWith('.homeplanner.json'));
    assert.equal(/[<>:"/\\|?*\u0000-\u001f]/.test(filename), false);
    assert.equal(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename), false);
  }
  assert.equal(Persistence.errorText({ name: 'NotReadableError', message: 'https://user:password@example.test' }).includes('password'), false);
  assert.match(Persistence.errorText({ code: 'EIO', message: 'private path' }), /^EIO:/);
});

test('real shared model and bridge restore complete multi-floor snapshots without changing their revision', async t => {
  const Model = require('../planner-model.js');
  const { createController } = require('../planner-bridge.js');
  let legacy = { controls: { bedCount: { value: '1' } }, manualLayouts: [], context: null };
  const planner = createController({
    capture: () => copy(legacy), restore(value) { legacy = copy(value); }, render() {}
  }, Model);
  planner.execute({ type: 'add-floor', name: 'Upper' });
  planner.execute({ type: 'set-environment', patch: project().environment });
  const store = memoryStore(), { controller } = controllerFor(t, planner, store, { model: Model });
  await controller.ready;
  await controller.saveNow();
  const saved = copy(planner.getProject());
  planner.execute({ type: 'rename-project', name: 'Unsaved rename' });
  await controller.openProject(saved.id);
  assert.deepEqual(planner.getProject(), saved);
  assert.equal(controller.getState().dirty, false);
  assert.deepEqual(Storage.parseProject(controller.exportJSON().text, Model), saved);
});

function domHarness() {
  let document;
  const downloads = [], revoked = [], blobs = new Map(), timers = new Map();
  let sequence = 0;
  class Element {
    constructor(tag) {
      this.tag = tag; this.ownerDocument = document; this.children = []; this.parentNode = null;
      this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.className = '';
      this.hidden = false; this.disabled = false; this.value = ''; this.text = '';
      this.classList = { add: value => { this.className += ` ${value}`; } };
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    get options() { return this.children.filter(child => child.tag === 'option'); }
    append(...nodes) { nodes.forEach(child => { child.parentNode = this; this.children.push(child); }); }
    replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    async dispatch(type, extra = {}) {
      const event = { target: this, preventDefault() {}, ...extra };
      await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    }
    click() {
      if (this.tag === 'a') downloads.push({ href: this.href, name: this.download });
      this.dispatch('click');
    }
    focus() { document.activeElement = this; }
  }
  const view = {
    Blob,
    URL: {
      createObjectURL(blob) { const url = `blob:test-${++sequence}`; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {}, removeEventListener() {}
  };
  document = {
    defaultView: view, activeElement: null,
    createElement: tag => new Element(tag),
    createTextNode(text) { const node = new Element('#text'); node.textContent = text; return node; }
  };
  const host = new Element('div');
  function all(node = host) { return [node, ...node.children.flatMap(child => all(child))]; }
  return {
    host, document, view, downloads, revoked, blobs,
    byClass: name => all().find(node => node.className.split(' ').includes(name)),
    byId: id => all().find(node => node.id === id),
    button: (name, within = host) => all(within).find(node => node.tag === 'button' && node.textContent === name),
    finishDownloads() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }
  };
}

function mounted(t, extra = {}) {
  const dom = domHarness(), planner = fakePlanner(), store = memoryStore(), timer = clock();
  const ui = Persistence.mount(dom.host, planner, {
    openStore: async () => store, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout, ...extra
  });
  t.after(() => ui.destroy());
  return { dom, planner, store, ui };
}

test('mounted New uses an in-app confirmation and Cancel preserves current edits', async t => {
  const { dom, planner, ui } = mounted(t);
  await ui.controller.ready;
  dom.button('New project').click();
  await tick();
  assert.equal(dom.byClass('hp-storage-confirm').hidden, false);
  assert.equal(planner.replacements, 0);
  dom.button('Cancel').click();
  assert.equal(dom.byClass('hp-storage-confirm').hidden, true);
  assert.equal(planner.replacements, 0);
  dom.button('New project').click();
  dom.button('Create a new project').click();
  await tick();
  assert.equal(planner.getProject().id, 'new-project-1');
});

test('mounted Delete changes no browser data before its explicit confirmation', async t => {
  const { dom, planner, store, ui } = mounted(t);
  await ui.controller.ready;
  await ui.controller.saveNow();
  dom.button('Delete local copy').click();
  assert.equal(store.records.has('project-one'), true);
  assert.equal(dom.byClass('hp-storage-confirm').hidden, false);
  dom.button('Delete local copy', dom.byClass('hp-storage-confirm')).click();
  await tick();
  assert.equal(store.records.has('project-one'), false);
  assert.equal(planner.getProject().id, 'project-one');
});

test('mounted Import catches file-read failures visibly and preserves the current project', async t => {
  const { dom, planner, ui } = mounted(t);
  await ui.controller.ready;
  const before = copy(planner.getProject()), input = dom.byClass('hp-storage-file');
  input.value = 'unreadable.json';
  input.files = [{ size: 100, text: async () => { throw { name: 'NotReadableError', message: 'private path' }; } }];
  await input.dispatch('change');
  assert.match(dom.byClass('hp-storage-status').textContent, /NotReadableError/);
  assert.equal(dom.byClass('hp-storage-status').textContent.includes('private path'), false);
  assert.deepEqual(planner.getProject(), before);
  assert.equal(input.value, '');
  assert.equal(dom.button('Import JSON').disabled, false);
});

test('mounted Import shows strict model validation failures instead of treating false as success', async t => {
  const { dom, planner, ui } = mounted(t, { model: { validateProject: () => false } });
  await ui.controller.ready;
  const before = copy(planner.getProject()), input = dom.byClass('hp-storage-file');
  input.files = [{ size: 100, text: async () => JSON.stringify(project()) }];
  await input.dispatch('change');
  assert.match(dom.byClass('hp-storage-status').textContent, /ProjectValidationError/);
  assert.deepEqual(planner.getProject(), before);
  assert.equal(dom.byClass('hp-storage-confirm').hidden, true);
});

test('mounted Export remains available without IndexedDB and revokes its Blob URL after the download request', async t => {
  const { dom, planner, ui } = mounted(t, { openStore: () => Promise.reject({ name: 'SecurityError' }) });
  await assert.rejects(ui.controller.ready, code('SecurityError'));
  assert.equal(dom.button('Save now').disabled, true);
  assert.equal(dom.button('Export JSON').disabled, false);
  dom.button('Export JSON').click();
  await tick();
  assert.equal(dom.downloads.length, 1);
  const download = dom.downloads[0];
  assert.deepEqual(JSON.parse(await dom.blobs.get(download.href).text()), planner.getProject());
  assert.ok(download.name.endsWith('.homeplanner.json'));
  assert.equal(dom.revoked.length, 0);
  dom.finishDownloads();
  assert.deepEqual(dom.revoked, [download.href]);
  assert.equal(ui.controller.getState().dirty, true);
  assert.equal(ui.controller.getState().autosave, false);
});

test('disposing a mounted importer prevents a late file read from replacing the project', async t => {
  const { dom, planner, ui } = mounted(t);
  await ui.controller.ready;
  await ui.controller.saveNow();
  const gate = deferred(), input = dom.byClass('hp-storage-file');
  input.files = [{ size: 100, text: () => gate.promise }];
  const reading = input.dispatch('change');
  ui.destroy();
  gate.resolve(JSON.stringify(project('late-import')));
  await reading; await tick();
  assert.equal(planner.replacements, 0);
});
