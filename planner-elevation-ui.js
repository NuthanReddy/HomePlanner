(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerElevationUI = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Drafts) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const directions = ['N', 'E', 'S', 'W'];
  const scales = [50, 75, 100];
  const blank = floorId => ({ id: '', name: '', kind: 'elevation', floorId, direction: '',
    scaleDenominator: '', replaceAnchors: false, ax: '', ay: '', az: '', bx: '', by: '', bz: '' });
  function text(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 16384 ||
        /[\u0000-\u001f\u007f]/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
      throw new Error(`${label} must be nonempty text without control characters (maximum 16384 characters).`);
    return value.trim();
  }
  function coordinate(value, label) {
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '')
      throw new Error(`${label} is required; enter each coordinate explicitly.`);
    const result = Number(value);
    if (!Number.isFinite(result) || Math.abs(result) > 1e9) throw new Error(`${label} must be finite and at most 1e9 in magnitude.`);
    return result;
  }
  function frontDirections(heading) {
    if (!Number.isFinite(heading)) throw new Error('Current scene heading is unknown. Set a cardinal site/front orientation first.');
    const normalized = ((heading % 360) + 360) % 360, index = normalized / 90;
    if (!Number.isInteger(index)) throw new Error('Front view authoring requires a cardinal scene heading (0/90/180/270 degrees).');
    return { front: directions[index], rear: directions[(index + 2) % 4],
      left: directions[(index + 3) % 4], right: directions[(index + 1) % 4] };
  }

  function createController(planner, runtime = root) {
    if (!planner?.getProject || !planner?.execute || !planner?.getDrawingScene || !planner?.inputFingerprint)
      throw new Error('Saved views require the project bridge and drawing foundation.');
    let project = planner.getProject(), fingerprint = planner.inputFingerprint(), disposed = false;
    let selectedId = '', draft = blank(project.activeFloorId), error = '', preview = null, pages = null;
    const drafts = Drafts.createStore(planner, 'Saved elevation / section'), selections = new Map();
    let dirty = false, baseRecord = null, draftConflict = '';
    const draftScope = (id = selectedId) => ({ projectId: project.id, entityId: id });
    let message = 'Create or select a saved view. Rendering happens only on Refresh preview.';
    let previewSettings = { paper: 'A3', orientation: 'landscape', scaleDenominator: 100, units: 'metric', pageIndex: 0 };
    const listeners = new Set();
    const documentation = () => copy(project.documentation || { version: 1, views: [], sheets: [] });
    const views = () => (project.documentation?.views || []).filter(item => ['elevation', 'section'].includes(item.kind));
    const selected = () => views().find(item => item.id === selectedId);
    function getState() {
      return { projectId: project.id, revision: project.revision, selectedId, draft: { ...draft }, dirty, error: error || draftConflict, message,
        preview, previewSettings: { ...previewSettings }, stale: !preview,
        retainedDraftIds: drafts.scopes().filter(scope => scope.projectId === project.id && scope.entityId &&
          !views().some(view => view.id === scope.entityId)).map(scope => scope.entityId),
        floors: project.floors.map(item => ({ id: item.id, name: item.name })),
        views: copy(views()), anchorSummary: copy(selected()?.cut || []) };
    }
    const notify = () => { if (!disposed) listeners.forEach(fn => fn(getState())); };
    const invalidate = () => { preview = null; pages = null; previewSettings.pageIndex = 0; error = ''; };
    function load(id = '') {
      const item = views().find(item => item.id === id);
      const pending = drafts.get(draftScope(id));
      if (id && !item && !pending) throw new Error('Saved view no longer exists.');
      selectedId = id; draft = blank(project.activeFloorId);
      dirty = false; baseRecord = item ? copy(item) : null; draftConflict = '';
      if (item) {
        for (const key of ['id', 'name', 'kind', 'floorId', 'direction', 'scaleDenominator']) draft[key] = item[key] ?? '';
        item.cut.forEach((anchor, index) => {
          if (anchor?.kind === 'point' && anchor.floorId === item.floorId)
            for (const axis of ['x', 'y', 'z']) draft[`${index ? 'b' : 'a'}${axis}`] = String(anchor.point[axis]);
        });
      }
      if (pending) {
        draft = pending.draft; dirty = true;
        if (JSON.stringify(pending.baseRecord) !== JSON.stringify(baseRecord))
          draftConflict = 'Project changed the selected view. Your draft is retained; copy needed values, then discard/reload fields before saving.';
        baseRecord = pending.baseRecord;
      }
      selections.set(project.id, selectedId);
    }
    function sync() {
      if (disposed) return false;
      const next = planner.getProject(), nextFingerprint = next === project ? fingerprint : planner.inputFingerprint();
      const replaced = next.id !== project.id;
      const changed = replaced || next.revision !== project.revision || nextFingerprint !== fingerprint;
      const navigated = next.activeFloorId !== project.activeFloorId;
      selections.set(project.id, selectedId);
      project = next; fingerprint = nextFingerprint;
      if (changed) {
        invalidate();
        const id = replaced ? selections.get(project.id) || '' : selectedId;
        load(id && !views().some(item => item.id === id) && !drafts.get(draftScope(id)) ? '' : id);
        message = 'Project changed. Pending drafts retain their project and owner floor; previous preview discarded. Refresh explicitly.';
        notify();
      } else if (navigated) {
        invalidate();
        message = 'Active floor changed. Draft and owner floor retained; previous preview discarded.';
        notify();
      }
      return changed;
    }
    const unsubscribe = planner.subscribe?.(sync);
    function select(id = '') { sync(); load(id); invalidate(); notify(); }
    function setDraft(patch) {
      sync();
      if (Object.keys(patch).some(key => !Object.hasOwn(draft, key))) throw new Error('Unknown saved-view field.');
      if (selectedId && Object.hasOwn(patch, 'id') && patch.id !== selectedId) throw new Error('Saved view IDs are stable and cannot be renamed.');
      draft = { ...draft, ...patch };
      dirty = true; drafts.put(draftScope(), { draft, baseRecord });
      invalidate(); message = 'Draft changed; Save before refreshing the saved view.'; notify();
    }
    function discardDraft() {
      sync(); drafts.remove(draftScope()); load(selected() ? selectedId : '');
      invalidate(); message = 'Current draft discarded; fields reloaded from the project.'; notify();
    }
    function fail(cause) { error = cause.message || String(cause); notify(); return null; }
    function ready() {
      if (disposed) throw new Error('View workbench has been disposed.');
      const originalProject = project.id; sync();
      if (originalProject !== project.id) throw new Error('Project changed. Review this project before continuing; original drafts were retained.');
      if (draftConflict) throw new Error(draftConflict);
    }
    function freshId(doc, suffix = 'view') {
      const used = new Set([...doc.views, ...doc.sheets].map(item => item.id));
      const seed = `${project.id}:view:${suffix}:${runtime.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
      let id = seed, index = 1;
      while (used.has(id)) id = `${seed}-${index++}`;
      return id;
    }
    function floorId() {
      if (!project.floors.some(item => item.id === draft.floorId)) throw new Error('Choose an existing owner floor.');
      return draft.floorId;
    }
    function scale() {
      if (draft.scaleDenominator === '' || draft.scaleDenominator === null) return null;
      const result = Number(draft.scaleDenominator);
      if (!scales.includes(result)) throw new Error('Saved scale must be unknown, 1:50, 1:75 or 1:100.');
      return result;
    }
    function save() {
      try {
        ready();
        const originalScope = draftScope();
        const doc = documentation(), existing = selected();
        if (!['elevation', 'section'].includes(draft.kind)) throw new Error('Choose elevation or section.');
        if (typeof draft.replaceAnchors !== 'boolean') throw new Error('Anchor replacement must be explicitly selected.');
        const id = existing?.id || (draft.id ? text(draft.id, 'View ID') : freshId(doc));
        if (!existing && [...doc.views, ...doc.sheets].some(item => item.id === id)) throw new Error('View ID is already in use.');
        const value = { id, name: text(draft.name, 'View name'), kind: draft.kind, floorId: floorId(),
          scaleDenominator: scale(), direction: draft.direction || null, cut: [] };
        if (value.direction !== null && !directions.includes(value.direction)) throw new Error('Direction must be geographic N/E/S/W.');
        if (value.kind === 'elevation' && !value.direction) throw new Error('Choose the geographic side occupied by the viewer.');
        if (existing?.cut.length && value.kind !== 'section' && !draft.replaceAnchors)
          throw new Error('Changing a section to elevation removes its cut. Explicitly select Replace cut anchors.');
        if (value.kind === 'section') {
          if (existing?.kind === 'section' && !draft.replaceAnchors) value.cut = copy(existing.cut);
          else value.cut = ['a', 'b'].map(prefix => ({ kind: 'point', floorId: value.floorId,
            point: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, coordinate(draft[`${prefix}${axis}`], `${prefix.toUpperCase()} ${axis} (m)`)])) }));
          if ((!existing || draft.replaceAnchors || existing.kind !== 'section') &&
              (Math.abs(value.cut[0].point.z - value.cut[1].point.z) > 1e-7 ||
               Math.hypot(value.cut[0].point.x - value.cut[1].point.x, value.cut[0].point.y - value.cut[1].point.y) <= 1e-7))
            throw new Error('A/B must define a nonzero finite horizontal cut with equal z coordinates.');
        }
        if (existing) doc.views[doc.views.findIndex(item => item.id === id)] = value;
        else doc.views.push(value);
        planner.execute({ type: 'set-documentation', value: doc });
        drafts.remove(originalScope);
        sync(); load(id); invalidate(); message = 'Saved in project JSON and Undo/Redo history. Refresh explicitly.'; notify();
        return copy(value);
      } catch (cause) { return fail(cause); }
    }
    function createFrontViews() {
      try {
        ready();
        const owner = floorId(), savedScale = scale();
        // Read the compiled legacy front convention, never an assumed project.site.front.
        const scene = planner.getDrawingScene();
        if (scene.projectId !== project.id || scene.revision !== project.revision || scene.inputFingerprint !== fingerprint)
          throw new Error('Drawing snapshot does not match current project inputs.');
        const heading = scene.scenes.find(item => item.floorId === owner)?.headingDeg;
        const mapping = frontDirections(heading), doc = documentation(), created = [];
        for (const side of ['front', 'rear', 'left', 'right']) {
          const value = { id: freshId(doc, side), name: `${side[0].toUpperCase()}${side.slice(1)} elevation`,
            kind: 'elevation', floorId: owner, scaleDenominator: savedScale, direction: mapping[side], cut: [] };
          doc.views.push(value); created.push(value);
        }
        planner.execute({ type: 'set-documentation', value: doc });
        sync(); load(created[0].id); invalidate();
        message = 'Four named views appended in one Undo step; geographic directions captured from the current scene heading. Refresh explicitly.';
        notify(); return copy(created);
      } catch (cause) { return fail(cause); }
    }
    function deleteSelected({ confirmed = false } = {}) {
      try {
        ready();
        if (!selected()) throw new Error('Select a saved view to delete.');
        if (!confirmed) throw new Error('Confirm deletion of the saved view.');
        const originalScope = draftScope();
        const doc = documentation(); doc.views = doc.views.filter(item => item.id !== selectedId);
        planner.execute({ type: 'set-documentation', value: doc });
        drafts.remove(originalScope);
        sync(); load(); invalidate();
        message = 'View deleted; sheet references are retained (possibly unresolved). Undo restores the view.'; notify(); return true;
      } catch (cause) { return fail(cause); }
    }
    function showPage() {
      previewSettings.pageIndex = Math.min(previewSettings.pageIndex, pages.sheets.length - 1);
      const sheet = pages.sheets[previewSettings.pageIndex], svg = pages.toSVG(sheet);
      if (typeof svg !== 'string' || svg.length > 20 * 1024 * 1024) throw new Error('Invalid or oversized SVG preview (20 MiB maximum).');
      preview = { sheet, svg, pageIndex: previewSettings.pageIndex, pageCount: pages.sheets.length };
    }
    function setPreviewSettings(patch) {
      sync();
      const choices = { paper: ['A4', 'A3', 'A2'], orientation: ['portrait', 'landscape'],
        scaleDenominator: scales, units: ['metric', 'imperial'] };
      if (Object.entries(patch).some(([key, value]) => key === 'pageIndex'
        ? !Number.isSafeInteger(value) || value < 0 : !choices[key]?.includes(value))) throw new Error('Unsupported preview setting.');
      previewSettings = { ...previewSettings, ...patch }; error = '';
      if (Object.keys(patch).length === 1 && Object.hasOwn(patch, 'pageIndex') && pages) {
        try { showPage(); notify(); } catch (cause) { invalidate(); fail(cause); }
      } else { invalidate(); message = 'Preview settings changed. Refresh explicitly; saved scale overrides fallback.'; notify(); }
    }
    function refresh() {
      try {
        if (disposed) throw new Error('View workbench has been disposed.');
        sync(); invalidate();
        const saved = selected();
        if (!saved) throw new Error('Save or select an elevation/section view before refreshing.');
        const drawing = runtime.HomePlannerElevation, common = runtime.HomePlannerDrawing;
        if (!drawing?.createSheets || !drawing?.toSVG || !common?.validateSheet)
          throw new Error('Load planner-elevation.js and the common drawing renderer, then refresh.');
        const scene = planner.getDrawingScene();
        if (scene.projectId !== project.id || scene.revision !== project.revision || scene.inputFingerprint !== fingerprint)
          throw new Error('Drawing snapshot does not match current project inputs.');
        const { paper, orientation, units, scaleDenominator } = previewSettings;
        const owner = project.floors.find(item => item.id === saved.floorId);
        if (!owner) throw new Error('Saved view owner floor is missing; select an existing floor and save.');
        const sheets = drawing.createSheets(scene, { viewId: saved.id, paper, orientation, units,
          scaleDenominator: saved.scaleDenominator ?? scaleDenominator, floorName: owner.name });
        if (!Array.isArray(sheets) || !sheets.length) throw new Error('Renderer must return a nonempty array of sheets.');
        if (sheets.length > 100) throw new Error('Saved view exceeds the 100-page limit. Reduce schedule content before previewing.');
        for (const sheet of sheets) {
          const valid = common.validateSheet(sheet);
          if (valid === false || valid?.valid === false) throw new Error('Common sheet validation failed.');
        }
        pages = { sheets, toSVG: drawing.toSVG.bind(drawing) }; showPage();
        message = 'Saved view preview ready. Unsaved form changes are not rendered. Export through Report → Drawings.';
        notify(); return preview;
      } catch (cause) { invalidate(); return fail(cause); }
    }
    return { getState, select, setDraft, discardDraft, save, createFrontViews, deleteSelected, sync, refresh, setPreviewSettings,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dispose() { disposed = true; pages = null; unsubscribe?.(); drafts.dispose(); listeners.clear(); } };
  }

  function mount(document = root.document) {
    const host = document?.getElementById('workspaceViews');
    if (!host || host.homePlannerViews) return host?.homePlannerViews || null;
    const view = document.defaultView || root;
    const el = (tag, text = '', className = '') => {
      const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
    };
    let controller;
    try { controller = createController(view.HomePlanner, view); }
    catch (cause) { const error = el('p', cause.message); error.setAttribute('role', 'alert'); host.replaceChildren(error); return null; }
    host.classList.add('hp-views');
    const help = el('p', 'Saved documentation views, not physical facade geometry. The adjacent facade panel is independent. Direction is the geographic viewer location N/E/S/W, not the viewing ray. Sections show only cut solids, never beyond-cut geometry. No exposed stairs, roof or parapet levels are invented. View zoom changes screen display only; saved scale and physical SVG/PDF/PNG exports are unchanged.');
    const guide = el('a', 'Saved view guide'); guide.href = 'docs/view-workbench.md';
    const form = el('form', '', 'hp-view-form'), fields = {};
    function field(name, label, choices) {
      const wrapper = el('label', label), input = el(choices ? 'select' : 'input');
      input.id = `hp-view-${name}`; wrapper.htmlFor = input.id;
      if (choices) for (const [value, text] of choices) { const option = el('option', text); option.value = value; input.append(option); }
      else input.type = 'text';
      wrapper.append(input); form.append(wrapper); fields[name] = input;
      input.addEventListener(choices ? 'change' : 'input', () => {
        try { controller.setDraft({ [name]: input.value }); } catch (cause) { alert.textContent = cause.message; alert.hidden = false; }
      });
      return wrapper;
    }
    field('id', 'Stable view ID (blank generates one)');
    field('name', 'View name');
    field('kind', 'View kind', [['elevation', 'Elevation'], ['section', 'Section']]);
    field('floorId', 'Owner floor', []);
    field('scaleDenominator', 'Saved scale', [['', 'Unknown — use explicit preview / Report fallback'], ...scales.map(value => [value, `1:${value}`])]);
    field('direction', 'Geographic viewer side (section uses A→B)', [['', 'Unknown / unused for section'], ...directions.map(value => [value, value])]);
    const anchorHelp = el('p', 'A/B coordinates: metres, plate-local x/y on the selected owner floor; z relative to that floor elevation. Enter all six values explicitly for new sections. Endpoints must have equal z. Existing point/wall/entity (including cross-floor or unresolved) anchors are preserved unless replacement is checked.');
    form.append(anchorHelp);
    const replacementLabel = el('label'), replacement = el('input'); replacement.type = 'checkbox';
    replacement.id = 'hp-view-replaceAnchors'; replacementLabel.htmlFor = replacement.id;
    replacementLabel.append(replacement, el('span', 'Replace cut anchors explicitly (or remove cut when converting to elevation)'));
    replacement.addEventListener('change', () => controller.setDraft({ replaceAnchors: replacement.checked })); form.append(replacementLabel);
    const coordinateLabels = [];
    for (const prefix of ['a', 'b']) for (const axis of ['x', 'y', 'z'])
      coordinateLabels.push(field(`${prefix}${axis}`, `${prefix.toUpperCase()} ${axis} (m)`));
    const anchorSummary = el('pre', '', 'hp-view-anchors');
    const actions = el('div', '', 'hp-view-actions');
    function button(label, action) {
      const node = el('button', label); node.type = 'button'; node.addEventListener('click', action); actions.append(node); return node;
    }
    button('New view', () => controller.select());
    button('Discard draft / reload fields', () => {
      if (!controller.getState().dirty || view.confirm('Discard the pending saved-view draft and reload saved fields?')) controller.discardDraft();
    });
    const save = button('Save view', () => {}); save.type = 'submit';
    form.addEventListener('submit', event => { event.preventDefault(); controller.save(); });
    button('Create front/rear/left/right views', () => controller.createFrontViews());
    const remove = button('Delete selected view', () => {
      if (view.confirm('Delete this saved view? Sheet references will be retained. Undo can restore it.'))
        controller.deleteSelected({ confirmed: true });
    });
    button('Undo', () => view.HomePlanner.undo?.());
    button('Redo', () => view.HomePlanner.redo?.());
    form.append(actions);
    const table = el('table', '', 'hp-view-table'), caption = el('caption', 'Saved elevation / section views');
    const head = el('thead'), header = el('tr'); ['Name / edit', 'ID', 'Kind', 'Owner floor', 'Scale', 'Viewer side'].forEach(text => {
      const th = el('th', text); th.scope = 'col'; header.append(th);
    });
    head.append(header); const body = el('tbody'); table.append(caption, head, body);
    const tableRegion = el('div', '', 'hp-view-table-region');
    tableRegion.tabIndex = 0; tableRegion.setAttribute('role', 'region');
    tableRegion.setAttribute('aria-label', 'Saved views table; scroll horizontally for all columns');
    tableRegion.append(table);
    const previewControls = el('div', '', 'hp-view-actions'), previewFields = {};
    for (const [name, label, choices] of [
      ['paper', 'Preview paper', ['A4', 'A3', 'A2']], ['orientation', 'Orientation', ['portrait', 'landscape']],
      ['scaleDenominator', 'Fallback scale (saved scale overrides)', scales], ['units', 'Units', ['metric', 'imperial']], ['pageIndex', 'Preview page', []]
    ]) {
      const wrapper = el('label', label), input = el('select'); input.id = `hp-view-preview-${name}`; wrapper.htmlFor = input.id;
      for (const value of choices) { const option = el('option', name === 'scaleDenominator' ? `1:${value}` : String(value)); option.value = value; input.append(option); }
      input.addEventListener('change', () => {
        try { controller.setPreviewSettings({ [name]: ['scaleDenominator', 'pageIndex'].includes(name) ? Number(input.value) : input.value }); }
        catch (cause) { alert.textContent = cause.message; alert.hidden = false; }
      });
      wrapper.append(input); previewControls.append(wrapper); previewFields[name] = input;
    }
    const refresh = el('button', 'Refresh preview'); refresh.type = 'button'; refresh.addEventListener('click', () => controller.refresh()); previewControls.append(refresh);
    const report = el('a', 'Export saved views: Report → Drawings → Elevations / sections'); report.href = '?workspace=report&section=drawings';
    report.dataset.workspace = 'report'; report.dataset.section = 'drawings'; report.dataset.drawingDiscipline = 'views';
    const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const alert = el('p', '', 'hp-view-error'); alert.setAttribute('role', 'alert');
    const previewHost = el('div', '', 'hp-view-preview'); previewHost.tabIndex = 0;
    previewHost.dataset.zoom = 'fit';
    previewHost.setAttribute('role', 'region'); previewHost.setAttribute('aria-label', 'Scrollable saved view sheet preview');
    const zoomLabel = el('label', 'View zoom (screen only)'), zoom = el('select');
    zoom.id = 'hp-view-zoom'; zoomLabel.htmlFor = zoom.id;
    for (const [value, label] of [['fit', 'Fit to width'], ['full', 'Full resolution (intrinsic size)']]) {
      const option = el('option', label); option.value = value; zoom.append(option);
    }
    zoom.value = 'fit'; zoom.addEventListener('change', () => { previewHost.dataset.zoom = zoom.value; });
    zoomLabel.append(zoom); previewControls.append(zoomLabel);
    const retainedDrafts = el('div', '', 'hp-view-actions');
    host.replaceChildren(el('h2', 'Saved elevations / sections'), help, guide, form, anchorSummary, retainedDrafts, tableRegion, previewControls, report, status, alert, previewHost);
    let floorKey, tableKey, retainedKey, pageCount = -1, previousPreview, previewURL;
    function render(state) {
      status.textContent = `${state.message} Project revision ${state.revision}.${state.dirty ? ' Pending unsaved input draft; project Save does not include it.' : ''}`;
      report.dataset.drawingViewId = state.selectedId;
      report.href = `?workspace=report&section=drawings&discipline=views${state.selectedId ? `&viewId=${encodeURIComponent(state.selectedId)}` : ''}`;
      alert.textContent = state.error; alert.hidden = !state.error;
      const nextRetainedKey = JSON.stringify(state.retainedDraftIds);
      if (retainedKey !== nextRetainedKey) {
        retainedDrafts.replaceChildren(...state.retainedDraftIds.map(id => {
          const button = el('button', `Restore input draft for unavailable view ${id}`); button.type = 'button';
          button.addEventListener('click', () => controller.select(id)); return button;
        })); retainedKey = nextRetainedKey;
      }
      const nextFloorKey = JSON.stringify(state.floors);
      if (nextFloorKey !== floorKey) {
        fields.floorId.replaceChildren(...state.floors.map(item => { const option = el('option', item.name); option.value = item.id; return option; }));
        floorKey = nextFloorKey;
      }
      for (const [name, input] of Object.entries(fields)) if (input.value !== String(state.draft[name])) input.value = state.draft[name];
      fields.id.readOnly = !!state.selectedId; replacement.checked = state.draft.replaceAnchors; remove.disabled = !state.selectedId;
      coordinateLabels.forEach(label => { label.hidden = state.draft.kind !== 'section'; });
      anchorSummary.textContent = state.anchorSummary.length ? `Existing saved cut anchors (unchanged unless explicitly replaced):\n${JSON.stringify(state.anchorSummary, null, 2)}` : 'No saved cut anchors.';
      const nextTableKey = JSON.stringify([state.views, state.floors]);
      if (nextTableKey !== tableKey) {
        body.replaceChildren(...state.views.map(item => {
          const row = el('tr'), cell = el('td'), edit = el('button', item.name); edit.type = 'button';
          edit.addEventListener('click', () => controller.select(item.id)); cell.append(edit); row.append(cell);
          const identifier = el('td', '', 'hp-view-identifier'), details = el('details');
          details.append(el('summary', 'ID'), el('span', item.id)); identifier.append(details); row.append(identifier);
          for (const value of [item.kind, state.floors.find(f => f.id === item.floorId)?.name || item.floorId,
            item.scaleDenominator == null ? 'Unknown' : `1:${item.scaleDenominator}`, item.direction || 'Unused / unknown']) row.append(el('td', value));
          return row;
        })); tableKey = nextTableKey;
      }
      const count = state.preview?.pageCount || 0, page = previewFields.pageIndex;
      page.disabled = count <= 1;
      if (pageCount !== count) {
        page.replaceChildren(...Array.from({ length: count }, (_, index) => { const option = el('option', `Page ${index + 1} of ${count}`); option.value = index; return option; }));
        pageCount = count;
      }
      for (const [name, input] of Object.entries(previewFields)) input.value = state.previewSettings[name];
      if (previousPreview !== state.preview) {
        if (previewURL) view.URL.revokeObjectURL(previewURL);
        previewURL = null; previousPreview = state.preview; previewHost.replaceChildren();
        if (state.preview) {
          previewURL = view.URL.createObjectURL(new view.Blob([state.preview.svg], { type: 'image/svg+xml' }));
          const image = el('img'); image.src = previewURL;
          image.alt = `${state.preview.sheet.metadata.title} · Page ${state.preview.pageIndex + 1} of ${count} · 1:${state.preview.sheet.metadata.scaleDenominator}`;
          image.addEventListener('error', () => { if (previousPreview === state.preview) { alert.textContent = 'SVG preview could not be displayed. Refresh and review renderer output.'; alert.hidden = false; } });
          previewHost.append(image);
        } else previewHost.append(el('p', 'No current preview. Save/select a view and refresh explicitly.'));
      }
    }
    const unsubscribe = controller.subscribe(render), disposeController = controller.dispose;
    const onHide = event => { if (!event.persisted) controller.dispose(); };
    controller.dispose = () => {
      unsubscribe(); disposeController(); if (previewURL) view.URL.revokeObjectURL(previewURL); previewURL = null;
      view.removeEventListener('pagehide', onHide); delete host.homePlannerViews; host.replaceChildren();
    };
    host.homePlannerViews = controller; view.addEventListener('pagehide', onHide); render(controller.getState());
    return controller;
  }
  return { createController, frontDirections, mount };
});
