(function (root, factory) {
  'use strict';
  const commonJS = typeof module === 'object' && module.exports;
  const api = factory(root, commonJS ? require('./planner-storage.js') : root.HomePlannerStorage);
  if (commonJS) { module.exports = api; return; }
  root.HomePlannerPersistence = api;
  function start() {
    const host = root.document && root.document.getElementById('plannerPersistence');
    if (!host || host.homePlannerPersistence) return;
    if (!root.HomePlanner || !root.HomePlannerStorage) {
      host.textContent = 'Local project controls could not load. Keep the planner, model, storage and persistence scripts together.';
      return;
    }
    try { api.instance = api.mount(host, root.HomePlanner); }
    catch (error) { host.textContent = api.errorText(error); }
  }
  if (root.document) {
    if (root.HomePlanner || root.document.readyState !== 'loading') start();
    else root.document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Storage) {
  'use strict';

  const cancelled = error => error && error.code === 'SaveCancelledError';
  const unavailableCodes = new Set(['UnavailableError', 'SecurityError', 'VersionError', 'VersionChangedError',
    'StorageClosedError', 'InvalidStateError', 'DatabaseSchemaError', 'BlockedError']);
  const ownError = (code, message) => new Storage.StorageError(code, message);

  function errorText(error) {
    if (!Storage) return 'StorageUnavailableError: Local storage controls are unavailable.';
    const normalized = Storage.asError(error);
    return `${normalized.code}: ${normalized.message}`;
  }

  function fileName(name) {
    let value = typeof name === 'string' ? name : 'HomePlanner project';
    value = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, '-')
      .replace(/^\.+/, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
    value = value.replace(/(?:\.homeplanner)?\.json$/i, '').replace(/[. ]+$/, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) value = `HomePlanner-${value}`;
    value = Array.from(value || 'HomePlanner project').slice(0, 100).join('').replace(/[. ]+$/, '');
    return `${value}.homeplanner.json`;
  }

  function freshProjectId() {
    return `project-${root.crypto && typeof root.crypto.randomUUID === 'function' ? root.crypto.randomUUID() :
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
  }

  function metadata(record) {
    return { id: record.id, name: record.name, revision: record.revision, updatedAt: record.updatedAt,
      unreadable: record.unreadable === true, error: record.error ? { ...record.error } : null };
  }

  function createController(planner, options = {}) {
    const storage = options.storage || Storage;
    const model = options.model;
    const delay = options.autosaveDelay === undefined ? 600 : options.autosaveDelay;
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    const unschedule = options.clearTimeout || root.clearTimeout.bind(root);
    const listeners = new Set();
    let store = null, connection = null, destroyed = false, suppressEvents = false;
    let timer = null, activity = 0, preferenceIntent = 0, preferenceBusy = false, actionBusy = false;
    let settingsTail = Promise.resolve(), lastError = null, savedKey = null;
    let current = planner.getProject(), currentKey = storage.fingerprint(current);
    const initialKey = currentKey;
    const state = { available: false, connecting: true, initialized: false, autosave: false, paused: false,
      saving: false, savingRevision: null, projects: [], selectedId: '', pendingRestoreId: null,
      lastSavedAt: null, error: null, notice: '' };

    function getState() {
      const dirty = savedKey !== currentKey;
      return { ...state, busy: actionBusy || preferenceBusy,
        current: { id: current.id, name: storage.projectName(current), revision: current.revision },
        dirty, projects: state.projects.map(record => ({ ...record, error: record.error && { ...record.error } })),
        error: state.error && { ...state.error },
        status: state.error ? 'error' : state.saving ? 'saving' :
          state.connecting || actionBusy || preferenceBusy ? 'busy' : dirty ? 'unsaved' : 'saved' };
    }

    function emit() {
      if (destroyed) return;
      const snapshot = getState();
      listeners.forEach(listener => {
        try { listener(snapshot); }
        catch (_) {
          if (root.console) root.console.warn('A local project status view could not update.');
        }
      });
    }

    function reportError(error, scope = 'action', prefix = '') {
      if (cancelled(error) || destroyed) return;
      if (scope === 'action' && state.error && lastError &&
          (lastError === error || lastError.cause === error)) return;
      lastError = storage.asError(error, scope === 'import' ? 'Reading or importing JSON' : 'Local project action');
      state.error = { code: lastError.code, message: prefix + lastError.message, scope };
      if (unavailableCodes.has(lastError.code)) state.available = false;
      if (scope === 'save' && state.autosave) state.paused = true;
      emit();
    }

    function clearError(scope) {
      if (!scope || (state.error && state.error.scope === scope)) {
        state.error = null;
        lastError = null;
      }
    }

    function stopTimer() {
      if (timer !== null) { unschedule(timer); timer = null; }
    }

    function syncCurrent() {
      const next = planner.getProject(), key = storage.fingerprint(next);
      if (key === currentKey) return false;
      if (current.id !== next.id) { savedKey = null; state.lastSavedAt = null; }
      current = next;
      currentKey = key;
      activity++;
      return true;
    }

    function queueSetting(work) {
      const result = settingsTail.then(() => {
        if (destroyed) throw ownError('StorageClosedError', 'Local project controls have been closed.');
        if (!store) throw lastError || ownError('UnavailableError', 'The browser database is unavailable.');
        return work(store);
      });
      settingsTail = result.catch(() => {});
      return result;
    }

    function remember(id) {
      return queueSetting(db => current.id === id ? db.setSetting(storage.LAST_PROJECT_SETTING, id) : undefined);
    }

    function updateList(records) {
      state.projects = records.map(metadata);
      if (!state.projects.some(record => record.id === state.selectedId))
        state.selectedId = state.projects.length ? state.projects[0].id : '';
      const saved = records.find(record => !record.unreadable && record.id === current.id);
      if (saved) {
        savedKey = storage.fingerprint(saved.document);
        state.lastSavedAt = saved.updatedAt;
      } else {
        savedKey = null;
        state.lastSavedAt = null;
      }
    }

    function upsertRecord(record) {
      state.projects = state.projects.filter(item => item.id !== record.id);
      state.projects.push(metadata(record));
      state.projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || String(a.id).localeCompare(String(b.id)));
      if (current.id === record.id) {
        savedKey = storage.fingerprint(record.document);
        state.lastSavedAt = record.updatedAt;
        state.selectedId = record.id;
        if (state.pendingRestoreId) {
          state.pendingRestoreId = null;
          state.notice = 'Saved the current project. Earlier browser projects remain available in the list.';
        }
      }
    }

    const queue = storage.createSaveQueue(async snapshot => {
      try {
        if (!store || !state.available)
          throw lastError || ownError('UnavailableError', 'The browser database is unavailable. Export JSON to keep your work.');
        const record = await store.save(snapshot);
        if (destroyed) return record;
        upsertRecord(record);
        clearError('save');
        state.paused = false;
        try {
          await remember(record.id);
          clearError('preference');
        } catch (error) {
          if (state.autosave) state.paused = true;
          reportError(error, 'preference', 'The project was saved, but its reload preference could not be updated. ');
        }
        emit();
        return record;
      } catch (error) {
        reportError(error, 'save');
        throw error;
      }
    }, { model, onChange(progress) {
      state.saving = !!progress.active || progress.pending > 0;
      state.savingRevision = progress.active && progress.active.id === current.id ? progress.active.revision : null;
      emit();
    } });

    function scheduleSave() {
      stopTimer();
      if (destroyed || !state.initialized || state.connecting || actionBusy || preferenceBusy ||
          !state.autosave || state.paused || !state.available || savedKey === currentKey) return;
      const intent = preferenceIntent;
      timer = schedule(() => { timer = null; saveNow(true, intent).catch(() => {}); }, delay);
    }

    const unsubscribe = planner.subscribe(event => {
      if (destroyed || suppressEvents || (event && event.type === 'selection')) return;
      try {
        if (syncCurrent()) {
          state.notice = '';
          scheduleSave();
          emit();
        }
      } catch (error) { reportError(error, 'action'); }
    });

    function applyProject(work) {
      suppressEvents = true;
      try { work(); }
      finally { suppressEvents = false; syncCurrent(); }
    }

    function checkUnchanged(expectedActivity, expectedKey) {
      syncCurrent();
      if (expectedActivity !== activity || expectedKey !== currentKey)
        throw ownError('ProjectChangedError',
          'The layout changed while this action was waiting. Your edits were kept. Choose the action again when ready.');
    }

    async function connect(startup) {
      state.connecting = true;
      state.available = false;
      emit();
      try {
        if (store) store.close();
        store = await (options.openStore ? options.openStore() : storage.open());
        if (destroyed) { store.close(); return; }
        state.available = true;
        const [records, enabled, remembered] = await Promise.all([
          store.list(), store.getSetting(storage.AUTOSAVE_SETTING), store.getSetting(storage.LAST_PROJECT_SETTING)
        ]);
        if (destroyed) return;
        updateList(records);
        if (enabled !== undefined && typeof enabled !== 'boolean')
          throw ownError('CorruptSettingError', 'The remembered autosave preference is not a boolean. Autosave remains off.');
        if (remembered !== undefined && remembered !== null && !storage.validId(remembered))
          throw ownError('CorruptSettingError', 'The remembered project ID is invalid. No project was restored.');
        if (remembered && state.projects.some(record => record.id === remembered)) state.selectedId = remembered;
        clearError();
        if (startup && enabled === true && preferenceIntent === 0) {
          state.autosave = true;
          state.paused = true;
          if (remembered) {
            const record = await store.load(remembered);
            if (destroyed) return;
            if (!record) throw ownError('MissingProjectError', 'The remembered browser project no longer exists. Your current layout was kept.');
            syncCurrent();
            if (activity === 0 && currentKey === initialKey && preferenceIntent === 0 && !actionBusy) {
              applyProject(() => planner.replaceProject(storage.cloneJSON(record.document)));
              savedKey = storage.fingerprint(record.document);
              state.lastSavedAt = record.updatedAt;
              state.autosave = true;
              state.paused = savedKey !== currentKey;
              state.notice = 'Restored the remembered browser project. Keep an independent JSON backup.';
              if (savedKey !== currentKey) {
                state.paused = true;
                reportError(ownError('RestoredSnapshotChangedError',
                  'The planner reconstructed this saved layout differently. The stored copy is unchanged. Export JSON before further edits.'), 'restore');
              }
            } else {
              state.pendingRestoreId = remembered;
              state.paused = state.autosave;
              state.notice = 'Your startup edits were kept. Autosave is paused: choose Save now for this layout, Open for the remembered browser copy, or untick autosave to disable it. Export JSON before replacing unsaved work.';
            }
          } else {
            state.autosave = true;
            state.paused = false;
            state.notice = 'Browser autosave was previously enabled. There is no remembered project to restore.';
          }
        } else if (!startup) {
          state.paused = false;
          state.pendingRestoreId = enabled === true && remembered ? remembered : null;
          state.notice = 'Browser storage is available. No project was restored by Retry; choose Open for a saved project.';
        } else {
          state.notice = 'Autosave is off. Save now creates a browser copy; Export JSON creates an independent backup.';
        }
      } catch (error) {
        state.paused = state.autosave;
        reportError(error, 'connection');
        throw storage.asError(error);
      } finally {
        state.connecting = false;
        state.initialized = true;
        emit();
        if (activity > 0) scheduleSave();
      }
    }

    async function availableStore() {
      if (state.connecting && connection) await connection;
      if (destroyed || !store || !state.available)
        throw lastError || ownError('UnavailableError', 'Browser storage is unavailable. The layout remains in memory; export JSON.');
      return store;
    }

    async function saveNow(automatic = false, intent = preferenceIntent) {
      stopTimer();
      try {
        await availableStore();
        if (automatic && (!state.autosave || state.paused || intent !== preferenceIntent || actionBusy || destroyed))
          throw ownError('SaveCancelledError', 'Autosave was paused before this snapshot could be queued.');
        syncCurrent();
        const snapshot = storage.validateProject(current, model);
        return await queue.enqueue(snapshot);
      } catch (error) {
        if (!cancelled(error)) reportError(error, 'save');
        throw storage.asError(error);
      }
    }

    async function action(work) {
      if (destroyed) throw ownError('StorageClosedError', 'Local project controls have been closed.');
      if (actionBusy || preferenceBusy) throw ownError('OperationBusyError', 'Wait for the current local project action to finish.');
      actionBusy = true;
      stopTimer();
      clearError();
      state.notice = '';
      emit();
      try { return await work(); }
      catch (error) { reportError(error, 'action'); throw storage.asError(error); }
      finally { actionBusy = false; emit(); scheduleSave(); }
    }

    async function beforeReplacement() {
      syncCurrent();
      const expectedActivity = activity, expectedKey = currentKey;
      queue.cancel(current.id);
      // An already-started transaction must finish before Open reads that project's latest copy.
      await queue.flush().catch(() => {});
      checkUnchanged(expectedActivity, expectedKey);
      return { activity: expectedActivity, key: expectedKey };
    }

    async function setAutosave(enabled) {
      if (typeof enabled !== 'boolean') throw ownError('InvalidSettingError', 'Autosave must be on or off.');
      const intent = ++preferenceIntent;
      let preferenceSaved = false;
      preferenceBusy = true;
      stopTimer();
      state.notice = '';
      if (!enabled) {
        state.autosave = false;
        state.paused = false;
        queue.cancel();
      }
      emit();
      try {
        await availableStore();
        await queueSetting(db => db.setSetting(storage.AUTOSAVE_SETTING, enabled));
        preferenceSaved = true;
        if (intent !== preferenceIntent) return getState();
        state.autosave = enabled;
        state.paused = false;
        clearError();
        state.pendingRestoreId = null;
        state.notice = enabled ? 'Autosave is enabled for this browser only. Export JSON for a backup.' :
          'Autosave is off. Existing browser copies were kept; future edits stay in memory until Save now.';
        if (enabled) await saveNow();
        else await queue.flush().catch(() => {});
        return getState();
      } catch (error) {
        if (!cancelled(error)) {
          if (intent === preferenceIntent && enabled && !preferenceSaved) state.autosave = false;
          reportError(error, enabled && preferenceSaved ? 'save' : 'preference', !enabled ?
            'Autosave is off in this tab, but its preference could not be saved and may resume on reload. ' :
            preferenceSaved ? '' : 'Autosave could not be enabled. ');
        }
        throw storage.asError(error);
      } finally {
        if (intent === preferenceIntent) preferenceBusy = false;
        emit();
        scheduleSave();
      }
    }

    const api = {
      getState,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      reportError,
      setNotice(message) { state.notice = message; emit(); },
      revisionToken() { return `${activity}:${currentKey}`; },
      saveNow,
      setAutosave,
      async refresh() {
        return action(async () => {
          const db = await availableStore();
          updateList(await db.list());
          state.notice = 'The list reflects this browser database. Unreadable entries are left untouched.';
        });
      },
      async retry() {
        if (state.connecting) return connection;
        return action(async () => {
          queue.cancel();
          await queue.flush().catch(() => {});
          connection = connect(false);
          return connection;
        });
      },
      selectProject(id) {
        if (!state.projects.some(record => record.id === id)) return;
        state.selectedId = id;
        emit();
      },
      renameProject(name) {
        if (destroyed) throw ownError('StorageClosedError', 'Local project controls have been closed.');
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 150)
          throw ownError('ProjectValidationError', 'Enter a project name containing 1–150 characters.');
        planner.execute({ type: 'rename-project', name: name.trim() });
      },
      async openProject(id) {
        return action(async () => {
          const expected = await beforeReplacement(), db = await availableStore();
          const record = await db.load(id);
          if (!record) throw ownError('MissingProjectError', 'This browser project no longer exists. Refresh the list.');
          checkUnchanged(expected.activity, expected.key);
          queue.forget(id);
          applyProject(() => planner.replaceProject(storage.cloneJSON(record.document)));
          clearError('save');
          savedKey = storage.fingerprint(record.document);
          state.lastSavedAt = record.updatedAt;
          state.selectedId = id;
          state.pendingRestoreId = null;
          state.paused = savedKey !== currentKey;
          if (state.paused)
            reportError(ownError('RestoredSnapshotChangedError',
              'The restored layout was reconstructed differently. The stored copy was kept; export JSON before further edits.'), 'restore');
          else state.notice = 'Opened the browser copy. Other saved projects were not changed.';
          try { await remember(id); }
          catch (error) { reportError(error, 'preference', 'The project opened, but its reload preference could not be updated. '); }
          return planner.getProject();
        });
      },
      async newProject() {
        return action(async () => {
          await beforeReplacement();
          applyProject(() => planner.newProject());
          savedKey = null;
          state.lastSavedAt = null;
          state.pendingRestoreId = null;
          state.paused = false;
          state.notice = 'New project in memory. Existing browser projects were kept.';
          return planner.getProject();
        });
      },
      prepareImport(text) {
        const document = storage.parseProject(text, model);
        document.id = freshProjectId();
        document.name = `${storage.projectName(document).slice(0, 139)} (imported)`;
        return storage.validateProject(document, model);
      },
      async importPrepared(document) {
        const checked = storage.validateProject(document, model);
        return action(async () => {
          await beforeReplacement();
          applyProject(() => {
            if (typeof planner.importProject === 'function') planner.importProject(JSON.stringify(checked));
            else planner.replaceProject(checked);
          });
          savedKey = null;
          state.lastSavedAt = null;
          state.pendingRestoreId = null;
          state.paused = false;
          state.notice = 'Imported as a separate project ID. No existing browser project was overwritten.';
          return planner.getProject();
        });
      },
      exportJSON() {
        const text = planner.exportProject();
        storage.parseProject(text, model);
        return { text, fileName: fileName(storage.projectName(planner.getProject())) };
      },
      async deleteProject(id) {
        return action(async () => {
          const db = await availableStore(), deletingCurrent = id === current.id;
          queue.cancel(id);
          if (deletingCurrent) {
            state.autosave = false;
            state.paused = false;
            await queueSetting(database => database.setSetting(storage.AUTOSAVE_SETTING, false));
          }
          await queue.flush().catch(() => {});
          const removed = await db.remove(id);
          state.projects = state.projects.filter(record => record.id !== id);
          if (id === current.id) { savedKey = null; state.lastSavedAt = null; }
          if (state.selectedId === id) state.selectedId = state.projects.length ? state.projects[0].id : '';
          if (state.pendingRestoreId === id) state.pendingRestoreId = null;
          state.notice = removed ? 'Deleted only this browser copy. The current layout and downloaded JSON files were kept.' :
            'That browser copy was already absent. The current layout was kept.';
          try {
            await queueSetting(async database => {
              if (await database.getSetting(storage.LAST_PROJECT_SETTING) === id)
                await database.setSetting(storage.LAST_PROJECT_SETTING, null);
            });
          } catch (error) { reportError(error, 'preference', 'The browser copy was deleted, but its reload preference could not be cleared. '); }
          return removed;
        });
      },
      destroy() {
        destroyed = true;
        stopTimer();
        unsubscribe();
        listeners.clear();
        queue.close();
        if (store) store.close();
      }
    };
    connection = Promise.resolve().then(() => connect(true));
    api.ready = connection;
    return api;
  }

  function mount(host, planner, options = {}) {
    const document = host.ownerDocument, view = document.defaultView || root;
    const controller = createController(planner, options);
    const downloads = new Map();
    let confirmation = null, importReading = false, destroyed = false, lastListKey = '';
    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function button(text) {
      const element = node('button', 'hp-storage-button', text);
      element.type = 'button';
      return element;
    }
    function row(...children) {
      const element = node('div', 'hp-storage-row');
      element.append(...children);
      return element;
    }
    function perform(work) {
      Promise.resolve().then(() => { if (!destroyed) return work(); })
        .catch(error => { if (!cancelled(error)) controller.reportError(error); });
    }
    function dateText(value) {
      return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'no readable timestamp';
    }

    const panel = node('section', 'hp-storage');
    panel.setAttribute('aria-label', 'Local projects and JSON backups');
    const heading = node('h2', 'hp-storage-heading', 'Local projects');
    const help = node('p', 'hp-storage-help',
      'Optional browser-only IndexedDB storage — no account or cloud. Browser data is not a backup: clearing site data, private browsing or changing origin can remove or hide it. Export JSON regularly. Storage for file:// pages depends on your browser.');
    const nameLabel = node('label', 'hp-storage-name-label', 'Project name');
    const nameInput = node('input', 'hp-storage-name');
    nameInput.type = 'text'; nameInput.maxLength = 150;
    nameInput.id = 'hp-storage-project-name';
    nameInput.autocomplete = 'off';
    nameLabel.htmlFor = nameInput.id;
    const rename = button('Rename');
    const projectMeta = node('p', 'hp-storage-meta');
    const status = node('p', 'hp-storage-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    const notice = node('p', 'hp-storage-notice');
    notice.setAttribute('aria-live', 'polite');
    const autoLabel = node('label', 'hp-storage-autosave');
    const autosave = node('input');
    autosave.type = 'checkbox'; autosave.id = 'hp-storage-autosave';
    autoLabel.append(autosave, document.createTextNode(' Autosave in this browser'));
    const save = button('Save now'), fresh = button('New project'), exportButton = button('Export JSON'), importButton = button('Import JSON');
    const file = node('input', 'hp-storage-file');
    file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.setAttribute('aria-label', 'Import a HomePlanner JSON project');
    const listLabel = node('label', 'hp-storage-list-label', 'Saved in this browser');
    const list = node('select', 'hp-storage-list');
    list.id = 'hp-storage-project-list'; listLabel.htmlFor = list.id;
    const open = button('Open'), remove = button('Delete local copy'), refresh = button('Refresh list'), retry = button('Retry browser database');
    remove.classList.add('hp-storage-danger');
    const details = node('p', 'hp-storage-meta');
    const confirmBox = node('div', 'hp-storage-confirm');
    confirmBox.hidden = true;
    confirmBox.setAttribute('role', 'group'); confirmBox.setAttribute('aria-labelledby', 'hp-storage-confirm-message');
    const confirmMessage = node('p'); confirmMessage.id = 'hp-storage-confirm-message';
    const confirmButton = button('Continue'), cancelButton = button('Cancel');
    confirmBox.append(confirmMessage, row(cancelButton, confirmButton));
    panel.append(heading, help, nameLabel, row(nameInput, rename), projectMeta, autoLabel,
      row(save, fresh, exportButton, importButton, file), status, notice, listLabel,
      row(list, open, remove, refresh), details, retry, confirmBox);
    host.replaceChildren(panel);
    host.homePlannerPersistence = controller;

    function hideConfirmation() {
      confirmation = null;
      confirmBox.hidden = true;
      render(controller.getState());
    }

    function ask(message, label, work, guard = true) {
      confirmation = { work, guard, token: controller.revisionToken() };
      confirmMessage.textContent = message;
      confirmButton.textContent = label;
      confirmBox.hidden = false;
      render(controller.getState());
      cancelButton.focus();
    }

    function replaceAction(label, work) {
      if (controller.getState().dirty)
        ask(`The current project has changes not saved in this browser. Export JSON first to keep a backup. ${label}?`,
          label, work);
      else perform(work);
    }

    function render(state) {
      if (destroyed) return;
      const blocked = state.busy || state.connecting || !!confirmation;
      if (document.activeElement !== nameInput) nameInput.value = state.current.name;
      projectMeta.textContent = `Project ID: ${state.current.id} · Revision ${state.current.revision}`;
      autosave.checked = state.autosave;
      autosave.disabled = state.connecting || state.busy || !!confirmation;
      nameInput.disabled = state.busy;
      rename.disabled = state.busy;
      save.disabled = blocked || !state.available;
      fresh.disabled = blocked;
      importButton.disabled = blocked || importReading;
      exportButton.disabled = state.busy;
      refresh.disabled = blocked || !state.available;
      retry.hidden = state.available && !state.error;
      retry.disabled = blocked;
      const listKey = JSON.stringify(state.projects);
      if (lastListKey !== listKey || !list.options.length) {
        lastListKey = listKey;
        list.replaceChildren();
        if (!state.projects.length) {
          const option = node('option', '', state.connecting ? 'Checking browser projects…' : 'No browser projects');
          option.value = '';
          list.append(option);
        }
        for (const record of state.projects) {
          const suffix = record.unreadable ? `Unreadable (${record.error.code})` :
            `r${record.revision} · ${dateText(record.updatedAt)}`;
          const option = node('option', '', `${record.name} · ${suffix} · ${String(record.id).slice(-12)}`);
          option.value = typeof record.id === 'string' ? record.id : '';
          option.disabled = !Storage.validId(record.id);
          list.append(option);
        }
      }
      list.value = typeof state.selectedId === 'string' ? state.selectedId : '';
      list.disabled = blocked || !state.projects.length;
      const selected = state.projects.find(record => record.id === state.selectedId);
      open.disabled = blocked || !state.available || !selected || selected.unreadable || !Storage.validId(selected.id);
      remove.disabled = blocked || !state.available || !selected || !Storage.validId(selected.id);
      details.textContent = selected ? selected.unreadable ?
        `${selected.error.code}: This record cannot be opened by this app. It is retained for recovery, not replaced by an empty project.` :
        `Selected ID: ${selected.id} · Last committed ${dateText(selected.updatedAt)}` :
        'Saved projects use independent IDs; duplicate names do not overwrite one another.';
      status.dataset.state = state.status;
      if (state.error) {
        status.textContent = `${state.error.code}: ${state.error.message} ${state.dirty ?
          'Current changes are not confirmed saved; Export JSON remains available.' : 'The current committed browser copy is unchanged.'}`;
      } else if (state.connecting) status.textContent = 'Checking browser storage… The current layout remains in memory.';
      else if (state.saving) status.textContent = state.savingRevision !== null ?
        `Saving revision ${state.savingRevision}…${state.savingRevision !== state.current.revision ? ' Newer edits are not saved yet.' : ''}` :
        'Saving a browser project…';
      else if (state.busy) status.textContent = 'Updating local project controls… Wait for this action to complete.';
      else if (state.dirty) status.textContent = state.autosave && !state.paused ?
        'Unsaved changes · waiting for browser autosave.' : 'Unsaved in this browser · working in memory. Export JSON for a backup.';
      else status.textContent = `Saved in this browser · revision ${state.current.revision} · ${dateText(state.lastSavedAt)}${state.autosave ?
        ' · autosave on' : ' · autosave off'}.`;
      if (state.paused) status.textContent += ' Autosave is paused; use Save now to retry or turn it off.';
      notice.textContent = state.notice;
      notice.hidden = !state.notice;
    }

    rename.addEventListener('click', () => perform(() => controller.renameProject(nameInput.value)));
    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); perform(() => controller.renameProject(nameInput.value)); }
      if (event.key === 'Escape') nameInput.value = controller.getState().current.name;
    });
    autosave.addEventListener('change', () => {
      const checked = autosave.checked;
      perform(() => controller.setAutosave(checked));
    });
    save.addEventListener('click', () => perform(() => controller.saveNow()));
    fresh.addEventListener('click', () => replaceAction('Create a new project', () => controller.newProject()));
    list.addEventListener('change', () => controller.selectProject(list.value));
    open.addEventListener('click', () => {
      const id = list.value;
      replaceAction('Open the selected project', () => controller.openProject(id));
    });
    refresh.addEventListener('click', () => perform(() => controller.refresh()));
    retry.addEventListener('click', () => perform(() => controller.retry()));
    remove.addEventListener('click', () => {
      const state = controller.getState(), selected = state.projects.find(record => record.id === list.value);
      if (!selected) return;
      ask(`Delete the browser copy of “${selected.name}” (${selected.id})? This cannot be undone here. Downloaded backups and the working layout are kept.${selected.id === state.current.id ?
        ' Autosave will turn off so this copy is not silently recreated.' : ''}`, 'Delete local copy',
      () => controller.deleteProject(selected.id), false);
    });
    cancelButton.addEventListener('click', hideConfirmation);
    confirmButton.addEventListener('click', () => {
      if (!confirmation) return;
      if (confirmation.guard && confirmation.token !== controller.revisionToken()) {
        confirmation.token = controller.revisionToken();
        confirmMessage.textContent = 'The layout changed after this confirmation appeared. Export JSON to keep those edits, or confirm again to replace the current layout.';
        return;
      }
      const work = confirmation.work;
      hideConfirmation();
      perform(work);
    });
    confirmBox.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); hideConfirmation(); }
    });

    exportButton.addEventListener('click', () => perform(() => {
      const exported = controller.exportJSON();
      if (!view.URL || typeof view.URL.createObjectURL !== 'function')
        throw ownError('DownloadUnavailableError', 'This browser cannot create a JSON download. Use a browser that supports Blob downloads.');
      const url = view.URL.createObjectURL(new view.Blob([exported.text], { type: 'application/json;charset=utf-8' }));
      const link = node('a');
      link.href = url; link.download = exported.fileName; link.hidden = true;
      panel.append(link);
      try {
        link.click();
        controller.setNotice('JSON download requested. Verify the downloaded file and keep it separately; it does not enable autosave.');
      } finally {
        link.remove();
        const timerId = view.setTimeout(() => { view.URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
        downloads.set(url, timerId);
      }
    }));
    importButton.addEventListener('click', () => perform(() => file.click()));
    file.addEventListener('change', async () => {
      const selected = file.files && file.files[0];
      if (!selected) return;
      importReading = true;
      render(controller.getState());
      let text;
      try {
        if (selected.size > Storage.MAX_JSON_BYTES)
          throw ownError('JSONLimitError', 'JSON imports are limited to 32 MiB. The current project was not changed.');
        if (typeof selected.text === 'function') text = await selected.text();
        else text = await new Promise((resolve, reject) => {
          const reader = new view.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || ownError('NotReadableError', 'The selected file could not be read.'));
          reader.onabort = () => reject(ownError('AbortError', 'Reading the selected file was cancelled.'));
          reader.readAsText(selected);
        });
      } catch (error) {
        controller.reportError(error, 'import', 'Import did not change the current project. ');
        return;
      } finally {
        file.value = '';
        importReading = false;
        render(controller.getState());
      }
      if (destroyed) return;
      try {
        const prepared = controller.prepareImport(text);
        replaceAction('Import JSON as a separate project', () => controller.importPrepared(prepared));
      } catch (error) { controller.reportError(error, 'import'); }
    });
    const beforeUnload = event => {
      if (controller.getState().dirty || controller.getState().saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    view.addEventListener('beforeunload', beforeUnload);
    const unsubscribe = controller.subscribe(render);
    render(controller.getState());
    controller.ready.catch(() => {});
    return {
      controller,
      destroy() {
        destroyed = true;
        unsubscribe();
        controller.destroy();
        view.removeEventListener('beforeunload', beforeUnload);
        for (const [url, timeout] of downloads) { view.clearTimeout(timeout); view.URL.revokeObjectURL(url); }
        downloads.clear();
        if (host.homePlannerPersistence === controller) {
          delete host.homePlannerPersistence;
          host.replaceChildren();
        }
      }
    };
  }

  return { createController, mount, fileName, errorText };
});
