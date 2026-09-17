(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerFacadeUI = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Drafts) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const numeric = ['x', 'y', 'w', 'h', 'heightM', 'baseM', 'transmittance'];
  const blank = () => Object.fromEntries([...numeric, 'label', 'finish'].map(key => [key, '']));
  const isFacade = record => record.type === 'building' && record.facade?.version === 1;
  const describe = record => `${record.label || record.id}: x ${record.x}, y ${record.y}, width ${record.w}, depth ${record.h}, height ${record.heightM} m; project-relative base ${record.baseM} m; transmittance ${record.transmittance}; finish ${record.facade.finish ?? 'unknown'}`;
  function number(value, label) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '')
      throw new Error(`${label} is required; enter an explicit number.`);
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite.`);
    if (['w', 'h', 'heightM'].includes(label) && result <= 0) throw new Error(`${label} must be positive.`);
    if (label === 'transmittance' && (result < 0 || result > 1))
      throw new Error('Transmittance must be between 0 and 1.');
    return result;
  }
  function text(value, label) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error(`${label} must be text without control characters (maximum 512 characters).`);
    return value.trim() || null;
  }
  function createController(planner, runtime = root) {
    if (!planner?.getProject || !planner?.execute || !planner?.inputFingerprint)
      throw new Error('Facade editor requires the project bridge.');
    let project = planner.getProject(), fingerprint = planner.inputFingerprint();
    let selectedId = '', draft = blank(), error = '', disposed = false;
    const drafts = Drafts.createStore(planner, 'Physical facade box'), selections = new Map();
    let dirty = false, baseRecord = null, draftConflict = '';
    const owner = () => JSON.stringify([project.id, project.activeFloorId]);
    const draftScope = (id = selectedId) => ({ projectId: project.id, floorId: project.activeFloorId, entityId: id });
    let message = 'Enter every physical number explicitly. Blank finish and label mean unknown.';
    const listeners = new Set();
    const floor = () => project.floors.find(item => item.id === project.activeFloorId);
    const records = () => project.obstacles.filter(isFacade);
    const selected = () => records().find(item => item.id === selectedId);
    function getState() {
      return { projectId: project.id, revision: project.revision, floorId: project.activeFloorId,
        floorName: floor()?.name || project.activeFloorId, selectedId, draft: { ...draft }, dirty, error: error || draftConflict, message,
        retainedDraftIds: drafts.scopes().filter(scope => scope.projectId === project.id && scope.floorId === project.activeFloorId &&
          scope.entityId && !records().some(record => record.id === scope.entityId)).map(scope => scope.entityId),
        schedule: copy(records()), selectedRecord: selected() ? copy(selected()) : null };
    }
    const notify = () => { if (!disposed) listeners.forEach(fn => fn(getState())); };
    function load(id = '') {
      const record = records().find(item => item.id === id);
      const pending = drafts.get(draftScope(id));
      if (id && !record && !pending) throw new Error('Select a facade box on the current floor.');
      selectedId = id; draft = blank();
      dirty = false; baseRecord = record ? copy(record) : null; draftConflict = '';
      if (record) {
        for (const key of [...numeric, 'label']) if (record[key] != null) draft[key] = String(record[key]);
        draft.finish = record.facade.finish ?? '';
      }
      if (pending) {
        draft = pending.draft; dirty = true;
        if (JSON.stringify(pending.baseRecord) !== JSON.stringify(baseRecord))
          draftConflict = 'Project changed the selected box. Your draft is retained; copy needed values, then discard/reload fields before saving.';
        baseRecord = pending.baseRecord;
      }
      selections.set(owner(), selectedId);
    }
    function sync() {
      if (disposed) return false;
      const next = planner.getProject(), nextFingerprint = next === project ? fingerprint : planner.inputFingerprint();
      const navigated = next.id !== project.id || next.activeFloorId !== project.activeFloorId;
      const changed = navigated || next.revision !== project.revision || nextFingerprint !== fingerprint;
      selections.set(owner(), selectedId);
      project = next; fingerprint = nextFingerprint;
      if (changed) {
        const id = navigated ? selections.get(owner()) || '' : selectedId;
        load(id && !records().some(item => item.id === id) && !drafts.get(draftScope(id)) ? '' : id);
        error = '';
        message = navigated ? 'Floor/project changed. Drafts are retained on their original owners; no box was moved.'
          : 'Project changed. Pending fields were retained; review any record conflict before saving.';
        notify();
      }
      return changed;
    }
    const unsubscribe = planner.subscribe?.(sync);
    function select(id = '') { if (disposed) return; sync(); load(id); error = ''; notify(); }
    function setDraft(patch) {
      if (disposed) return;
      sync();
      if (Object.keys(patch).some(key => !Object.hasOwn(draft, key))) throw new Error('Unknown facade field.');
      draft = { ...draft, ...patch }; dirty = true;
      drafts.put(draftScope(), { draft, baseRecord }); error = ''; notify();
    }
    function discardDraft() {
      sync(); drafts.remove(draftScope()); load(selected() ? selectedId : '');
      error = ''; message = 'Current draft discarded; fields reloaded from the project.'; notify();
    }
    const fail = cause => { error = cause.message || String(cause); notify(); return null; };
    function ready(confirmed) {
      if (disposed) throw new Error('Facade editor has been disposed.');
      const originalOwner = owner(); sync();
      if (originalOwner !== owner()) throw new Error('Floor/project changed. Review this owner before continuing; original drafts were retained.');
      if (draftConflict) throw new Error(draftConflict);
      if (!confirmed) throw new Error('Confirm this facade box change before saving or deleting.');
    }
    function save({ confirmed = false } = {}) {
      try {
        ready(confirmed);
        const originalScope = draftScope();
        const existing = selected(), value = existing ? copy(existing) : { type: 'building' };
        for (const key of numeric) value[key] = number(draft[key], key);
        const label = text(draft.label, 'Label');
        if (label === null) delete value.label; else value.label = label;
        value.facade = { version: 1, finish: text(draft.finish, 'Finish') };
        if (!existing) {
          if (!runtime.crypto?.randomUUID) throw new Error('UUID support is unavailable; reload in a supported browser.');
          value.id = `${project.activeFloorId}:facade:${runtime.crypto.randomUUID()}`;
        }
        const list = copy(project.obstacles), index = list.findIndex(item => item.id === value.id);
        if (!existing && index >= 0) throw new Error('Identifier collision. Try creating the box again.');
        if (existing) list[index] = value; else list.push(value);
        planner.execute({ type: 'set-obstacles', value: list });
        drafts.remove(originalScope);
        sync(); load(value.id); error = ''; message = 'Physical facade box saved. Existing Undo/Redo and project persistence apply.';
        notify(); return copy(value);
      } catch (cause) { return fail(cause); }
    }
    function deleteSelected({ confirmed = false } = {}) {
      try {
        ready(confirmed);
        if (!selected()) throw new Error('Select a facade box before deleting.');
        const originalScope = draftScope();
        planner.execute({ type: 'set-obstacles', value: copy(project.obstacles.filter(item => item.id !== selectedId)) });
        drafts.remove(originalScope);
        sync(); load(); error = ''; message = 'Facade box deleted; other obstacles retained. Undo restores the box.';
        notify(); return true;
      } catch (cause) { return fail(cause); }
    }
    return { getState, sync, select, setDraft, discardDraft, save, deleteSelected,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dispose() { disposed = true; unsubscribe?.(); drafts.dispose(); listeners.clear(); } };
  }

  function mount(document = root.document) {
    const host = document?.getElementById('workspaceFacades');
    if (!host || host.homePlannerFacades) return host?.homePlannerFacades || null;
    const view = document.defaultView || root;
    function el(tag, text = '', className = '') {
      const node = document.createElement(tag); node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    let controller;
    try { controller = createController(view.HomePlanner, view); }
    catch (cause) { const error = el('p', cause.message); error.setAttribute('role', 'alert'); host.replaceChildren(error); return null; }
    host.classList.add('hp-facade');
    const heading = el('h3', 'Physical facade projections & finish intent');
    const warning = el('p', 'Free-positioned rectangular physical boxes—not complete canopy, parapet or cladding assemblies. Editing a wall does not move these boxes. No automatic wall hosting or tracking.', 'hp-facade-warning');
    const help = el('p', 'x/y are the footprint corner in this floor’s PLATE-LOCAL coordinates, in metres. Width follows x; depth follows y. Base is PROJECT-RELATIVE, not relative to this floor. Height extends up from that base. Duplicating a floor copies the base verbatim: adjust it yourself if needed. Finish is unverified text, not an optical property; transmittance is your explicit analysis input.');
    const context = el('p'), form = el('form', '', 'hp-facade-form'), fields = {};
    form.noValidate = true;
    function field(key, label, select = false) {
      const wrapper = el('label', label), input = el(select ? 'select' : 'input');
      input.id = `hp-facade-${key}`; wrapper.htmlFor = input.id;
      if (!select) { input.type = 'text'; input.maxLength = 512; }
      input.setAttribute('aria-describedby', 'hp-facade-error');
      wrapper.append(input); form.append(wrapper); fields[key] = input; return input;
    }
    field('selectedId', 'Facade box to edit', true).addEventListener('change', () => controller.select(fields.selectedId.value));
    field('label', 'Label (blank = unknown)');
    const labels = { x: 'x (m, plate-local)', y: 'y (m, plate-local)', w: 'Width along x (m)',
      h: 'Depth along y (m)', heightM: 'Physical height (m)', baseM: 'Base (m, PROJECT-RELATIVE)',
      transmittance: 'Beam transmittance (0–1, explicit input)' };
    for (const key of numeric) {
      const input = field(key, labels[key]); input.inputMode = 'decimal'; input.required = true;
    }
    field('finish', 'Finish intent (blank = unknown; no inferred optical properties)');
    for (const key of Object.keys(blank()))
      fields[key].addEventListener('input', () => controller.setDraft({ [key]: fields[key].value }));
    const save = el('button', 'Save physical box'), remove = el('button', 'Delete selected box'), fresh = el('button', 'New box');
    save.type = 'submit'; remove.type = fresh.type = 'button'; form.append(save, remove, fresh);
    const reload = el('button', 'Discard draft / reload fields'); reload.type = 'button'; form.append(reload);
    reload.addEventListener('click', () => {
      if (!controller.getState().dirty || view.confirm('Discard the pending facade draft and reload saved fields?')) controller.discardDraft();
    });
    const error = el('p', '', 'hp-facade-error'); error.id = 'hp-facade-error'; error.setAttribute('role', 'alert'); error.tabIndex = -1;
    const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const navigation = el('p', '', 'hp-facade-actions');
    for (const [title, destination, section] of [['Report drawings', 'report', 'drawings'], ['Layout · Open 3D inspection', 'design', 'layout']]) {
      const link = el('a', title); link.href = `?workspace=${destination}&section=${section}`;
      if (destination === 'report') {
        link.dataset.drawingDiscipline = 'views';
        link.dataset.drawingUseActiveView = 'true';
        link.href += '&discipline=views';
      }
      link.dataset.workspace = destination; link.dataset.section = section; navigation.append(link);
    }
    const schedule = el('div', '', 'hp-facade-schedule');
    schedule.tabIndex = 0; schedule.setAttribute('role', 'region'); schedule.setAttribute('aria-label', 'Physical facade box schedule');
    host.replaceChildren(heading, warning, help, context, form, error, status, navigation, schedule);
    function render(state) {
      context.textContent = `Current floor: ${state.floorName}. Only facade-tagged boxes on this floor are managed here.`;
      const option = el('option', 'New facade box'); option.value = '';
      fields.selectedId.replaceChildren(option);
      for (const record of state.schedule) {
        const option = el('option', record.label || record.id); option.value = record.id; fields.selectedId.append(option);
      }
      for (const id of state.retainedDraftIds) {
        const missing = el('option', `Unavailable box — input draft ${id}`); missing.value = id; fields.selectedId.append(missing);
      }
      fields.selectedId.value = state.selectedId;
      for (const [key, value] of Object.entries(state.draft)) if (fields[key].value !== value) fields[key].value = value;
      remove.disabled = !state.selectedId;
      error.hidden = !state.error; error.textContent = state.error; status.textContent = `${state.message}${state.dirty ? ' Pending unsaved input draft; project Save does not include it.' : ''}`;
      const table = el('table'), caption = el('caption', 'Physical boxes: plate-local footprints; project-relative base and top levels. Finish does not determine optical behavior.');
      const head = el('thead'), row = el('tr');
      for (const title of ['ID / label', 'Floor', 'x / y (m)', 'Width / depth (m)', 'Height (m)', 'Base / top (m, project-relative)', 'Finish intent', 'Transmittance']) {
        const th = el('th', title); th.scope = 'col'; row.append(th);
      }
      head.append(row); const body = el('tbody');
      for (const record of state.schedule) {
        const row = el('tr');
        for (const value of [`${record.id} / ${record.label || 'unknown'}`, state.floorName, `${record.x} / ${record.y}`,
          `${record.w} / ${record.h}`, record.heightM, `${record.baseM} / ${record.baseM + record.heightM}`,
          record.facade.finish ?? 'unknown', record.transmittance]) row.append(el('td', String(value)));
        body.append(row);
      }
      table.append(caption, head, body); schedule.replaceChildren(table);
    }
    function confirmChange(action) {
      controller.sync();
      const state = controller.getState(), current = state.selectedRecord;
      const proposed = { ...state.draft, id: 'new facade box', facade: { finish: state.draft.finish || null } };
      return view.confirm(`${action} physical facade box on ${state.floorName}?\n${current ? `Current: ${describe(current)}\n` : ''}${action === 'Save' ? `Proposed: ${describe(proposed)}\n` : ''}Other obstacles are retained. Undo is available.`);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (confirmChange('Save') && !controller.save({ confirmed: true })) error.focus();
    });
    remove.addEventListener('click', () => {
      if (confirmChange('Delete') && !controller.deleteSelected({ confirmed: true })) error.focus();
    });
    fresh.addEventListener('click', () => { controller.select(); fields.label.focus(); });
    const unsubscribe = controller.subscribe(render);
    const onRoute = () => controller.sync();
    document.addEventListener('homeplanner:workspace-change', onRoute);
    const dispose = controller.dispose;
    controller.dispose = () => {
      unsubscribe(); dispose();
      document.removeEventListener('homeplanner:workspace-change', onRoute);
      view.removeEventListener('pagehide', onHide);
      delete host.homePlannerFacades; host.replaceChildren();
    };
    const onHide = event => { if (!event.persisted) controller.dispose(); };
    view.addEventListener('pagehide', onHide);
    render(controller.getState());
    host.homePlannerFacades = controller;
    return controller;
  }
  return { createController, mount };
});
