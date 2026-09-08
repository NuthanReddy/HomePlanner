(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DB_NAME = 'HomePlanner.local-projects';
  const DB_VERSION = 1;
  const RECORD_VERSION = 1;
  const PROJECT_SCHEMA_VERSION = 1;
  const MAX_JSON_BYTES = 32 * 1024 * 1024;
  const PROJECTS = 'projects';
  const SETTINGS = 'settings';
  const AUTOSAVE_SETTING = 'autosave-enabled';
  const LAST_PROJECT_SETTING = 'last-project-id';
  const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  class StorageError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'HomePlannerStorageError';
      this.code = code;
      if (cause) Object.defineProperty(this, 'cause', { value: cause });
    }
  }

  function fail(code, message, cause) {
    return new StorageError(code, message, cause);
  }

  function asError(error, operation = 'Browser storage') {
    if (error instanceof StorageError) return error;
    const nativeName = error && typeof error.name === 'string' ? error.name : '';
    const explicitCode = error && typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.code) ? error.code : '';
    const code = /^[A-Za-z][A-Za-z0-9]{0,60}Error$/.test(nativeName) ? nativeName : explicitCode || 'StorageError';
    const descriptions = {
      QuotaExceededError: 'The browser storage quota was exceeded. Export JSON before clearing any data.',
      SecurityError: 'Browser security settings or this file origin prohibit IndexedDB.',
      NotAllowedError: 'The browser did not permit this operation.',
      AbortError: 'The browser aborted the transaction; it was not confirmed saved.',
      VersionError: 'This database was created by a newer app. Use that app; existing data was not changed.',
      InvalidStateError: 'The browser database is unavailable or its connection has closed.',
      UnknownError: 'The browser could not complete the storage operation.',
      NotReadableError: 'The selected file could not be read. Choose it again or use another copy.'
    };
    return fail(code, descriptions[code] || `${operation} failed. The operation was not confirmed complete.`, error);
  }

  function cloneJSON(value) {
    const ancestors = new Set();
    let nodes = 0;
    function visit(item, depth) {
      if (++nodes > 2000000 || depth > 100)
        throw fail('JSONLimitError', 'The project is too large or deeply nested to process safely.');
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number' && Number.isFinite(item)) return item;
      if (!item || typeof item !== 'object')
        throw fail('InvalidJSONValueError', 'Projects and settings must contain only finite, plain JSON values.');
      if (ancestors.has(item)) throw fail('InvalidJSONValueError', 'JSON data cannot contain circular references.');
      const array = Array.isArray(item);
      const prototype = Object.getPrototypeOf(item);
      if (!array && prototype !== Object.prototype && prototype !== null)
        throw fail('UnsafeJSONError', 'Only plain JSON objects are accepted; custom prototypes are not allowed.');
      if (array && prototype !== Array.prototype)
        throw fail('UnsafeJSONError', 'Custom array prototypes are not accepted.');
      if (Object.getOwnPropertySymbols(item).length)
        throw fail('InvalidJSONValueError', 'Symbol properties cannot be saved as JSON.');
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Object.keys(descriptors).filter(key => !(array && key === 'length'));
      if (array && keys.length !== item.length)
        throw fail('InvalidJSONValueError', 'Sparse arrays and extra array properties are not accepted.');
      const copy = array ? [] : {};
      ancestors.add(item);
      for (const key of keys) {
        if (unsafeKeys.has(key)) throw fail('UnsafeJSONError', 'Unsafe prototype-related JSON keys are not accepted.');
        const descriptor = descriptors[key];
        if (!has(descriptor, 'value') || !descriptor.enumerable)
          throw fail('UnsafeJSONError', 'JSON data cannot contain getters or hidden properties.');
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))
          throw fail('InvalidJSONValueError', 'Extra array properties cannot be saved as JSON.');
        copy[key] = visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
      return copy;
    }
    return visit(value, 0);
  }

  function validId(value) {
    return typeof value === 'string' && value.trim().length > 0 &&
      value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) && !unsafeKeys.has(value);
  }

  function requireId(value) {
    if (!validId(value)) throw fail('InvalidProjectIdError', 'Choose a project with a valid, nonempty ID.');
    return value;
  }

  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validateBase(project) {
    if (!object(project)) throw fail('ProjectValidationError', 'A project must be a JSON object.');
    if (project.schemaVersion !== PROJECT_SCHEMA_VERSION)
      throw fail('UnsupportedSchemaVersionError', 'This app reads project schema version 1 only. No migration was attempted.');
    requireId(project.id);
    if (!Number.isSafeInteger(project.revision) || project.revision < 0)
      throw fail('ProjectValidationError', 'A project requires a nonnegative integer revision.');
    if (has(project, 'name') && (typeof project.name !== 'string' || !project.name.trim() || project.name.length > 150))
      throw fail('ProjectValidationError', 'Project names must contain 1–150 characters.');
    if (!object(project.site) || !Number.isFinite(project.site.latitude) ||
        Math.abs(project.site.latitude) > 90 || !Number.isFinite(project.site.longitude) ||
        Math.abs(project.site.longitude) > 180 || typeof project.site.timeZone !== 'string' || !project.site.timeZone.trim())
      throw fail('ProjectValidationError', 'The project requires valid site coordinates and a time zone.');
    const building = project.building;
    if (!object(building) || !Number.isFinite(building.wallHeightM) || building.wallHeightM <= 0 ||
        !Number.isFinite(building.floorElevationM) || !Number.isFinite(building.roofThicknessM) || building.roofThicknessM < 0)
      throw fail('ProjectValidationError', 'The project requires valid building dimensions.');
    if (!Array.isArray(project.floors) || !project.floors.length)
      throw fail('ProjectValidationError', 'A project must contain at least one floor.');
    const floorIds = new Set();
    for (const floor of project.floors) {
      if (!object(floor) || !validId(floor.id) || floorIds.has(floor.id) ||
          typeof floor.name !== 'string' || !floor.name.trim() ||
          !Number.isFinite(floor.heightM) || floor.heightM <= 0)
        throw fail('ProjectValidationError', 'Every floor requires a unique ID, name and positive height.');
      if (!object(floor.legacy) || !object(floor.legacy.controls) || !Array.isArray(floor.legacy.manualLayouts))
        throw fail('ProjectValidationError', 'Every floor requires its own saved layout and controls.');
      floorIds.add(floor.id);
    }
    if (!floorIds.has(project.activeFloorId))
      throw fail('ProjectValidationError', 'The active floor must exist in the project.');
    for (const field of ['wallEdits', 'doorEdits', 'windowEdits', 'furnitureEdits', 'environment'])
      if (!object(project[field])) throw fail('ProjectValidationError', `The project requires a ${field} object.`);
    for (const field of ['obstacles', 'electrical'])
      if (!Array.isArray(project[field])) throw fail('ProjectValidationError', `The project requires a ${field} array.`);
    if (!object(project.legacy) || !object(project.legacy.controls) || !Array.isArray(project.legacy.manualLayouts))
      throw fail('ProjectValidationError', 'The project requires its active floor layout and controls.');
  }

  function checkValidationResult(result) {
    if (result === undefined || result === true) return;
    if (object(result) && result.schemaVersion === PROJECT_SCHEMA_VERSION && validId(result.id)) return;
    if (!object(result) || (has(result, 'valid') && result.valid !== true) ||
        (has(result, 'ok') && result.ok !== true) ||
        (has(result, 'errors') && (!Array.isArray(result.errors) || result.errors.length)) ||
        (result.valid !== true && result.ok !== true))
      throw fail('ProjectValidationError', 'The shared model rejected this project. The current project was not changed.');
  }

  function validateProject(project, model = root.HomePlannerModel) {
    const copy = cloneJSON(project);
    validateBase(copy);
    if (model && typeof model.validateProject === 'function') {
      try {
        // Validation must not project away weather, provenance or inactive-floor fields.
        checkValidationResult(model.validateProject(cloneJSON(copy)));
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw fail('ProjectValidationError', 'The shared model rejected this project. Check its schema and field values.', error);
      }
    }
    return copy;
  }

  function parseProject(text, model = root.HomePlannerModel) {
    if (typeof text !== 'string') throw fail('InvalidJSONError', 'Import requires JSON text.');
    if (text.length > MAX_JSON_BYTES) throw fail('JSONLimitError', 'JSON imports are limited to 32 MiB.');
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (error) { throw fail('InvalidJSONError', 'The file is not valid JSON. The current project was not changed.', error); }
    const copy = validateProject(parsed, model);
    if (model && typeof model.parseProject === 'function') {
      try {
        const checked = model.parseProject(text);
        checkValidationResult(checked);
        if (!object(checked) || checked.schemaVersion !== PROJECT_SCHEMA_VERSION)
          throw fail('ProjectValidationError', 'The shared model did not return a validated project.');
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw fail('ProjectValidationError', 'The shared model could not import this project. Its contents were preserved.', error);
      }
    }
    return copy;
  }

  function fingerprint(value) {
    function stringify(item) {
      if (item === null || typeof item !== 'object') return JSON.stringify(item);
      if (Array.isArray(item)) return `[${item.map(stringify).join(',')}]`;
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${stringify(item[key])}`).join(',')}}`;
    }
    return stringify(cloneJSON(value));
  }

  function projectName(project) {
    return typeof project.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled project';
  }

  function isTimestamp(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    return new Date(value).toISOString() === value;
  }

  function readRecord(value, model = root.HomePlannerModel, expectedId) {
    const record = cloneJSON(value);
    if (!object(record)) throw fail('CorruptRecordError', 'The local project record is not an object. It was left untouched.');
    if (record.recordVersion !== RECORD_VERSION)
      throw fail('UnsupportedRecordVersionError', 'This local record uses an unsupported format. It was left untouched.');
    const document = validateProject(record.document, model);
    if (record.id !== document.id || (expectedId !== undefined && record.id !== expectedId) ||
        record.name !== projectName(document) || record.revision !== document.revision ||
        !isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt) || record.updatedAt < record.createdAt)
      throw fail('CorruptRecordError', 'Local metadata does not match the project document. The record was left untouched.');
    return { recordVersion: RECORD_VERSION, id: record.id, name: record.name, revision: record.revision,
      createdAt: record.createdAt, updatedAt: record.updatedAt, document };
  }

  function createRecord(project, previous, now = new Date().toISOString(), model = root.HomePlannerModel) {
    const document = validateProject(project, model);
    if (!isTimestamp(now)) throw fail('InvalidTimestampError', 'A save requires a valid UTC timestamp.');
    const old = previous === undefined ? null : readRecord(previous, model, document.id);
    if (old && old.revision > document.revision)
      throw fail('StaleRevisionError', 'A newer revision already exists in this browser. Open it or import a JSON backup as a separate project.');
    if (old && old.revision === document.revision) {
      if (fingerprint(old.document) !== fingerprint(document))
        throw fail('RevisionConflictError', 'This revision differs from the existing browser copy. Export JSON and open the latest copy; neither was overwritten.');
      return old;
    }
    return { recordVersion: RECORD_VERSION, id: document.id, name: projectName(document),
      revision: document.revision, createdAt: old ? old.createdAt : now,
      updatedAt: old && old.updatedAt > now ? old.updatedAt : now, document };
  }

  function requireSettingKey(key) {
    if (!validId(key) || key.length > 128)
      throw fail('InvalidSettingError', 'Browser settings require a valid key.');
  }

  function readSetting(record, key) {
    const copy = cloneJSON(record);
    if (!object(copy) || copy.recordVersion !== RECORD_VERSION || copy.key !== key || !has(copy, 'value'))
      throw fail('CorruptSettingError', 'A browser preference is unreadable. It was not reset or overwritten.');
    return copy.value;
  }

  function unreadableRecord(value, id, error) {
    const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'name') : null;
    const name = descriptor && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 150) : 'Unreadable project';
    return { id, name, revision: null, updatedAt: null, unreadable: true,
      error: { code: asError(error).code, message: asError(error).message } };
  }

  function connect(db) {
    let closedError = null;
    db.onversionchange = function () {
      closedError = fail('VersionChangedError', 'Another app version requested a database upgrade. This connection was closed; reload before saving.');
      db.close();
    };
    db.onclose = function () {
      if (!closedError) closedError = fail('StorageClosedError', 'The browser closed its database connection. Retry before saving.');
    };

    function transaction(names, mode, work) {
      return new Promise((resolve, reject) => {
        if (closedError) { reject(closedError); return; }
        let tx, value, error, settled = false;
        const rejectOnce = reason => { if (!settled) { settled = true; reject(asError(reason)); } };
        const abort = reason => {
          if (!error) error = asError(reason);
          try { tx.abort(); } catch (_) { rejectOnce(error); }
        };
        try {
          tx = db.transaction(names, mode);
          tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            if (error) reject(error); else resolve(value);
          };
          tx.onabort = () => rejectOnce(error || tx.error || fail('AbortError', 'The database transaction was aborted.'));
          tx.onerror = event => {
            if (!error) error = asError(tx.error || (event.target && event.target.error) ||
              fail('StorageError', 'The database transaction failed.'));
          };
          const request = (req, success) => {
            req.onerror = () => abort(req.error || fail('StorageError', 'The database request failed.'));
            req.onsuccess = () => {
              if (error || settled) return;
              try { success(req.result); } catch (reason) { abort(reason); }
            };
          };
          work(tx, request, result => { value = result; });
        } catch (reason) {
          if (tx) abort(reason); else rejectOnce(reason);
        }
      });
    }

    return {
      list() {
        return transaction([PROJECTS], 'readonly', (tx, request, result) => {
          const records = [];
          request(tx.objectStore(PROJECTS).openCursor(), cursor => {
            if (!cursor) {
              records.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') ||
                String(a.id).localeCompare(String(b.id)));
              result(records);
              return;
            }
            try { records.push(readRecord(cursor.value, root.HomePlannerModel, cursor.primaryKey)); }
            catch (error) { records.push(unreadableRecord(cursor.value, cursor.primaryKey, error)); }
            cursor.continue();
          });
        });
      },
      async load(id) {
        requireId(id);
        return transaction([PROJECTS], 'readonly', (tx, request, result) => {
          request(tx.objectStore(PROJECTS).get(id), value =>
            result(value === undefined ? null : readRecord(value, root.HomePlannerModel, id)));
        });
      },
      async save(project) {
        const snapshot = validateProject(project);
        return transaction([PROJECTS], 'readwrite', (tx, request, result) => {
          const store = tx.objectStore(PROJECTS);
          request(store.get(snapshot.id), previous => {
            const record = createRecord(snapshot, previous);
            request(store.put(record), () => result(record));
          });
        });
      },
      async remove(id) {
        requireId(id);
        return transaction([PROJECTS], 'readwrite', (tx, request, result) => {
          const store = tx.objectStore(PROJECTS);
          request(store.get(id), previous => {
            request(store.delete(id), () => result(previous !== undefined));
          });
        });
      },
      async getSetting(key) {
        requireSettingKey(key);
        return transaction([SETTINGS], 'readonly', (tx, request, result) => {
          request(tx.objectStore(SETTINGS).get(key), value =>
            result(value === undefined ? undefined : readSetting(value, key)));
        });
      },
      async setSetting(key, value) {
        requireSettingKey(key);
        const snapshot = cloneJSON(value);
        return transaction([SETTINGS], 'readwrite', (tx, request, result) => {
          const store = tx.objectStore(SETTINGS);
          request(store.get(key), previous => {
            if (previous !== undefined) readSetting(previous, key);
            request(store.put({ recordVersion: RECORD_VERSION, key, value: snapshot }), () => result(cloneJSON(snapshot)));
          });
        });
      },
      close() {
        if (!closedError) closedError = fail('StorageClosedError', 'This browser database connection has been closed.');
        db.close();
      }
    };
  }

  function open(indexedDBFactory) {
    return new Promise((resolve, reject) => {
      let factory, request, upgradeError, settled = false;
      const rejectOnce = error => {
        if (settled) return;
        settled = true;
        reject(asError(error));
      };
      try {
        factory = indexedDBFactory === undefined ? root.indexedDB : indexedDBFactory;
        if (!factory || typeof factory.open !== 'function')
          throw fail('UnavailableError', 'IndexedDB is not available here. Work stays in memory; export JSON for a backup.');
        request = factory.open(DB_NAME, DB_VERSION);
        request.onblocked = () => rejectOnce(fail('BlockedError',
          'Another tab is blocking the database upgrade. Close other HomePlanner tabs, then retry. No saved data was deleted.'));
        request.onupgradeneeded = event => {
          if (settled) { request.transaction.abort(); return; }
          try {
            if (event.oldVersion !== 0)
              throw fail('DatabaseSchemaError', 'There is no supported migration for this database. Existing data was left untouched.');
            const db = request.result;
            db.createObjectStore(PROJECTS, { keyPath: 'id' });
            db.createObjectStore(SETTINGS, { keyPath: 'key' });
          } catch (error) {
            upgradeError = asError(error);
            request.transaction.abort();
          }
        };
        request.onerror = () => rejectOnce(upgradeError || request.error || fail('StorageError', 'Could not open the browser database.'));
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          try {
            if (db.version !== DB_VERSION || !db.objectStoreNames.contains(PROJECTS) || !db.objectStoreNames.contains(SETTINGS))
              throw fail('DatabaseSchemaError', 'The browser database has an unsupported structure. No stores were reset.');
            const tx = db.transaction([PROJECTS, SETTINGS], 'readonly');
            if (tx.objectStore(PROJECTS).keyPath !== 'id' || tx.objectStore(SETTINGS).keyPath !== 'key')
              throw fail('DatabaseSchemaError', 'The browser database has incompatible keys. Existing records were not changed.');
            tx.onabort = () => { db.close(); rejectOnce(tx.error || fail('AbortError', 'The database check was aborted.')); };
            tx.onerror = () => { db.close(); rejectOnce(tx.error || fail('StorageError', 'Could not check the database schema.')); };
            tx.oncomplete = () => {
              if (settled) { db.close(); return; }
              settled = true;
              resolve(connect(db));
            };
          } catch (error) { db.close(); rejectOnce(error); }
        };
      } catch (error) { rejectOnce(error); }
    });
  }

  function createSaveQueue(write, options = {}) {
    if (typeof write !== 'function') throw new TypeError('A save function is required.');
    const pending = new Map(), highest = new Map(), idleWaiters = [];
    let active = null, scheduled = false, closed = false, batchError = null;
    function notify() {
      if (typeof options.onChange === 'function') {
        try {
          options.onChange({ active: active && { id: active.document.id, revision: active.document.revision }, pending: pending.size });
        } catch (_) {
          if (root.console) root.console.warn('A local save queue observer could not update.');
        }
      }
    }
    function finishIdle() {
      if (active || pending.size || scheduled) return;
      idleWaiters.splice(0).forEach(waiter => batchError ? waiter.reject(batchError) : waiter.resolve());
    }
    async function pump() {
      scheduled = false;
      if (active) return;
      while (pending.size) {
        const id = pending.keys().next().value;
        active = pending.get(id);
        pending.delete(id);
        notify();
        try {
          const result = await write(cloneJSON(active.document));
          active.waiters.forEach(waiter => waiter.resolve(result));
        } catch (error) {
          error = asError(error);
          if (!batchError) batchError = error;
          active.waiters.forEach(waiter => waiter.reject(error));
        }
        active = null;
        notify();
      }
      finishIdle();
    }
    return {
      enqueue(project) {
        return new Promise((resolve, reject) => {
          try {
            if (closed) throw fail('QueueClosedError', 'The save queue is closed.');
            const document = validateProject(project, options.model);
            const key = fingerprint(document), previous = highest.get(document.id);
            if (previous && previous.revision > document.revision)
              throw fail('StaleRevisionError', 'An older snapshot cannot replace a newer queued revision.');
            if (previous && previous.revision === document.revision && previous.key !== key)
              throw fail('RevisionConflictError', 'Different documents cannot share one queued revision.');
            if (!active && !pending.size && !scheduled) batchError = null;
            highest.set(document.id, { revision: document.revision, key });
            const queued = pending.get(document.id);
            if (queued) {
              queued.document = document;
              queued.waiters.push({ resolve, reject });
            } else if (active && active.document.id === document.id && active.document.revision === document.revision) {
              active.waiters.push({ resolve, reject });
            } else {
              pending.set(document.id, { document, waiters: [{ resolve, reject }] });
            }
            if (!active && !scheduled) { scheduled = true; Promise.resolve().then(pump); }
            notify();
          } catch (error) { reject(asError(error)); }
        });
      },
      flush() {
        if (!active && !pending.size && !scheduled)
          return batchError ? Promise.reject(batchError) : Promise.resolve();
        return new Promise((resolve, reject) => idleWaiters.push({ resolve, reject }));
      },
      cancel(id) {
        for (const [key, job] of pending) {
          if (id !== undefined && key !== id) continue;
          const error = fail('SaveCancelledError', 'The pending save was cancelled; its snapshot was not written.');
          job.waiters.forEach(waiter => waiter.reject(error));
          pending.delete(key);
        }
        notify();
        finishIdle();
      },
      forget(id) {
        if ((active && active.document.id === id) || pending.has(id))
          throw fail('QueueBusyError', 'Wait for this project to finish saving before resetting its queued revision.');
        highest.delete(id);
      },
      close() { closed = true; this.cancel(); },
      get busy() { return !!active || pending.size > 0 || scheduled; }
    };
  }

  return { DB_NAME, DB_VERSION, RECORD_VERSION, PROJECT_SCHEMA_VERSION, MAX_JSON_BYTES,
    AUTOSAVE_SETTING, LAST_PROJECT_SETTING, StorageError, asError, cloneJSON, validId,
    validateProject, parseProject, fingerprint, projectName, readRecord, createRecord, createSaveQueue, open };
});
