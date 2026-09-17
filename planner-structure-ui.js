(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerStructureUI = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Drafts) {
  'use strict';
  const kinds = ['grid', 'column', 'beam', 'slab', 'footing'];
  const sources = ['unspecified', 'assumed', 'authored', 'engineer-provided'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const segment = kind => ['grid', 'beam'].includes(kind);
  const blank = () => ({ kind: 'column', label: '', startX: '', startY: '', startZ: '',
    endX: '', endY: '', endZ: '', widthM: '', depthM: '', heightM: '', material: '',
    sizeSource: 'unspecified', reference: '', replaceAnchors: false });
  const number = (value, label, required = false, positive = false) => {
    if (value === '' || value === null || (typeof value === 'string' && !value.trim())) {
      if (required) throw new Error(`${label} is required; enter a coordinate explicitly.`);
      return null;
    }
    if (!['string', 'number'].includes(typeof value)) throw new Error(`${label} must be a finite number.`);
    const result = Number(value);
    if (!Number.isFinite(result) || Math.abs(result) > 1e9 || (positive && result <= 0))
      throw new Error(`${label} must be ${positive ? 'positive, ' : ''}finite and at most 1e9 in magnitude.`);
    return result;
  };
  const text = (value, label) => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 16384 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error(`${label} must be text without control characters (maximum 16384 characters).`);
    return value.trim() || null;
  };

  function createController(planner, runtime = root) {
    if (!planner?.getProject || !planner?.execute || !planner?.getDrawingScene || !planner?.inputFingerprint)
      throw new Error('Structural workbench requires the project bridge and drawing foundation.');
    let project = planner.getProject(), fingerprint = planner.inputFingerprint();
    let selectedId = '', draft = blank(), touched = new Set(), disposed = false;
    const drafts = Drafts.createStore(planner, 'Structural intent'), selections = new Map();
    let baseRecord = null, draftConflict = '';
    const owner = () => JSON.stringify([project.id, project.activeFloorId]);
    const draftScope = (id = selectedId) => ({ projectId: project.id, floorId: project.activeFloorId, entityId: id });
    let previewSettings = { paper: 'A3', orientation: 'landscape', scaleDenominator: 100, pageIndex: 0 };
    let result = null, preview = null, previewPages = null, projected = null, error = '';
    let message = 'Enter authored intent, or select an existing element. Refresh to compute coordination and preview.';
    const listeners = new Set();
    const floor = () => project.floors.find(item => item.id === project.activeFloorId);
    const records = () => floor()?.authored?.structural || [];
    const selected = () => records().find(item => item.id === selectedId);
    function getState() {
      const record = selected();
      return { projectId: project.id, revision: project.revision, floorId: project.activeFloorId,
        floorName: floor()?.name || project.activeFloorId, selectedId, draft: { ...draft },
        engineeringStatus: 'not-assessed', dirty: touched.size > 0, error: error || draftConflict, message, preview, previewSettings: { ...previewSettings },
        retainedDraftIds: drafts.scopes().filter(scope => scope.projectId === project.id && scope.floorId === project.activeFloorId &&
          scope.entityId && !records().some(record => record.id === scope.entityId)).map(scope => scope.entityId),
        anchorSummary: record ? record.anchors.map((anchor, index) => {
          const resolved = projected?.authored.find(entry => entry.collection === 'structural' && entry.floorId === project.activeFloorId && entry.record.id === record.id)?.anchors[index];
          return { authored: copy(anchor), resolution: resolved ? copy(resolved) : null };
        }) : [],
        schedule: records().map(record => ({ record: copy(record),
          projected: result?.elements.find(element => element.floorId === project.activeFloorId && element.id === record.id) || null })),
        findings: result?.findings.filter(item => item.floorId === null || item.floorId === project.activeFloorId) || [],
        stale: !result };
    }
    const notify = () => { if (!disposed) listeners.forEach(fn => fn(getState())); };
    const invalidate = () => { result = null; projected = null; preview = null; previewPages = null; error = ''; };
    function load(id) {
      const record = records().find(item => item.id === id);
      const pending = drafts.get(draftScope(id));
      if (id && !record && !pending) throw new Error('The selected structural element no longer exists on this floor.');
      selectedId = id; draft = blank(); touched = new Set();
      baseRecord = record ? copy(record) : null; draftConflict = '';
      if (record) {
        for (const key of ['kind', 'label', 'widthM', 'depthM', 'heightM', 'material', 'sizeSource', 'reference'])
          if (record[key] !== undefined && record[key] !== null) draft[key] = String(record[key]);
        record.anchors.forEach((anchor, index) => {
          if (anchor?.kind === 'point' && anchor.floorId === project.activeFloorId)
            for (const axis of ['x', 'y', 'z']) draft[`${index ? 'end' : 'start'}${axis.toUpperCase()}`] = String(anchor.point[axis]);
        });
      }
      if (pending) {
        draft = pending.draft; touched = new Set(pending.touched);
        if (JSON.stringify(pending.baseRecord) !== JSON.stringify(baseRecord))
          draftConflict = 'Project changed the selected record. Your draft is retained; copy needed values, then discard/reload fields before saving.';
        baseRecord = pending.baseRecord;
      }
      selections.set(owner(), selectedId);
    }
    function sync() {
      if (disposed) return false;
      const next = planner.getProject();
      const nextFingerprint = next === project ? fingerprint : planner.inputFingerprint();
      const navigated = next.id !== project.id || next.activeFloorId !== project.activeFloorId;
      const changed = next.id !== project.id || next.revision !== project.revision || nextFingerprint !== fingerprint;
      selections.set(owner(), selectedId);
      project = next; fingerprint = nextFingerprint;
      if (changed || navigated) {
        previewSettings.pageIndex = 0;
        invalidate();
        const id = navigated ? selections.get(owner()) || '' : selectedId;
        load(id && !records().some(record => record.id === id) && !drafts.get(draftScope(id)) ? '' : id);
        message = navigated ? 'Floor/project changed. Drafts are retained on their original owners; no anchors were rehosted.'
          : 'Project changed. Pending fields were retained; previous coordination/preview discarded. Refresh explicitly.';
        notify();
      }
      return changed || navigated;
    }
    const unsubscribe = planner.subscribe?.(sync);
    function select(id = '') { sync(); load(id); error = ''; notify(); }
    function setDraft(patch) {
      sync();
      if (Object.keys(patch).some(key => !Object.hasOwn(draft, key))) throw new Error('Unknown structural field.');
      for (const [key, value] of Object.entries(patch)) { draft[key] = value; touched.add(key); }
      drafts.put(draftScope(), { draft, touched: [...touched], baseRecord });
      error = ''; notify();
    }
    function discardDraft() {
      sync(); drafts.remove(draftScope());
      load(selected() ? selectedId : ''); error = ''; message = 'Current draft discarded; fields reloaded from the project.'; notify();
    }
    function fail(cause) { error = cause.message || String(cause); notify(); return null; }
    function save() {
      try {
        if (disposed) throw new Error('Structural workbench has been disposed.');
        const originalOwner = owner(), originalScope = draftScope();
        sync();
        if (owner() !== originalOwner) throw new Error('Floor/project changed. Review this owner before saving; the original draft was retained.');
        if (draftConflict) throw new Error(draftConflict);
        if (!kinds.includes(draft.kind) || !sources.includes(draft.sizeSource)) throw new Error('Choose a supported kind and size source.');
        if (typeof draft.replaceAnchors !== 'boolean') throw new Error('Anchor replacement must be explicitly selected.');
        const existing = selected(), value = existing ? copy(existing) : {
          id: `${project.activeFloorId}:authored:${runtime.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
        };
        value.kind = draft.kind;
        for (const key of ['widthM', 'depthM', 'heightM']) {
          const parsed = number(draft[key], key, false, true);
          if (!existing || touched.has(key)) value[key] = parsed;
        }
        for (const key of ['label', 'material', 'reference']) {
          const parsed = text(draft[key], key);
          if (!existing || touched.has(key)) value[key] = parsed;
        }
        if (!existing || touched.has('sizeSource')) value.sizeSource = draft.sizeSource;
        if (!existing || draft.replaceAnchors) {
          value.anchors = (segment(value.kind) ? ['start', 'end'] : ['start']).map(prefix => ({
            kind: 'point', floorId: project.activeFloorId,
            point: Object.fromEntries(['x', 'y', 'z'].map(axis =>
              [axis, number(draft[`${prefix}${axis.toUpperCase()}`], `${prefix} ${axis} (m)`, true)]))
          }));
        }
        if (value.anchors.length !== (segment(value.kind) ? 2 : 1))
          throw new Error('Changing this kind requires explicit anchor replacement and all required coordinates.');
        if (segment(value.kind) && value.heightM != null) throw new Error('Beam/grid height must be blank; beam vertical thickness uses depth.');
        if (value.kind === 'grid' && [value.widthM, value.depthM, value.material].some(item => item !== null))
          throw new Error('Grid width, depth and material must be blank (not applicable).');
        planner.execute({ type: 'upsert-authored', collection: 'structural', value });
        drafts.remove(originalScope);
        sync(); load(value.id); invalidate();
        message = 'Structural intent saved in project history. Engineering not assessed; refresh coordination and preview.';
        notify(); return copy(value);
      } catch (cause) { return fail(cause); }
    }
    function deleteSelected({ confirmed = false } = {}) {
      try {
        if (disposed) throw new Error('Structural workbench has been disposed.');
        if (sync()) throw new Error('Project changed. Review the selection before deleting.');
        if (!selected()) throw new Error('Select an existing element before deleting.');
        if (!confirmed) throw new Error('Confirm deletion of the selected structural element.');
        const originalScope = draftScope();
        planner.execute({ type: 'delete-authored', collection: 'structural', id: selectedId });
        drafts.remove(originalScope);
        sync(); load(''); invalidate(); message = 'Element deleted. Other records and surviving references are retained; Undo restores it.';
        notify(); return true;
      } catch (cause) { return fail(cause); }
    }
    function setPreviewSettings(patch) {
      sync();
      const choices = { paper: ['A4', 'A3', 'A2'], orientation: ['portrait', 'landscape'], scaleDenominator: [50, 75, 100] };
      if (Object.entries(patch).some(([key, value]) => key === 'pageIndex'
        ? !Number.isSafeInteger(value) || value < 0 : !choices[key]?.includes(value)))
        throw new Error('Unsupported preview paper, orientation, fixed scale or page index.');
      const pageOnly = Object.keys(patch).length === 1 && Object.hasOwn(patch, 'pageIndex');
      previewSettings = { ...previewSettings, ...patch }; preview = null; error = '';
      if (pageOnly && previewPages) {
        try {
          preview = selectedPreview();
          message = 'Preview page changed. Current coordination retained; engineering not assessed.';
          notify();
        } catch (cause) { previewPages = null; fail(cause); }
        return;
      }
      previewSettings.pageIndex = 0; previewPages = null;
      message = 'Preview settings changed. Refresh explicitly; fixed scale is never reduced automatically.'; notify();
    }
    function selectedPreview() {
      const { sheets, toSVG } = previewPages;
      previewSettings.pageIndex = Math.min(previewSettings.pageIndex, sheets.length - 1);
      const sheet = sheets[previewSettings.pageIndex], svg = toSVG(sheet);
      if (typeof svg !== 'string' || svg.length > 20 * 1024 * 1024) throw new Error('Invalid or oversized structural SVG preview (20 MiB maximum).');
      return { sheet, svg, pages: sheets, pageCount: sheets.length, pageIndex: previewSettings.pageIndex };
    }
    function refresh() {
      try {
        if (disposed) throw new Error('Structural workbench has been disposed.');
        sync(); invalidate();
        if (!runtime.HomePlannerStructure?.build) throw new Error('Structural coordination module unavailable. Reload and refresh.');
        const scene = planner.getDrawingScene();
        if (scene.projectId !== project.id || scene.revision !== project.revision || scene.inputFingerprint !== fingerprint)
          throw new Error('Structural snapshot does not match the current project inputs.');
        result = runtime.HomePlannerStructure.build(scene); projected = scene;
        const drawing = runtime.HomePlannerStructureDrawing, common = runtime.HomePlannerDrawing;
        if (!drawing?.createSheet || !(drawing.toSVG || common?.toSVG))
          throw new Error('Structural 2D renderer unavailable; coordination is shown. Load planner-structure-drawing.js and refresh.');
        if (!common?.validateSheet) throw new Error('Common drawing sheet validator unavailable. Reload and refresh.');
        const { paper, orientation, scaleDenominator } = previewSettings;
        const options = { paper, orientation, scaleDenominator, floorId: project.activeFloorId, floorName: floor()?.name, units: 'metric' };
        const sheets = typeof drawing.createSheets === 'function' ? drawing.createSheets(scene, options) : [drawing.createSheet(scene, options)];
        if (!Array.isArray(sheets) || !sheets.length) throw new Error('Renderer must return a nonempty array of sheets.');
        for (const sheet of sheets) {
          const validation = common.validateSheet(sheet);
          if (validation === false || validation?.valid === false) throw new Error('Structural sheet validation failed.');
        }
        previewPages = { sheets, toSVG: (drawing.toSVG || common.toSVG).bind(drawing.toSVG ? drawing : common) };
        preview = selectedPreview();
        message = 'Current-floor coordination and 2D preview ready from one scene. Engineering not assessed.'; notify(); return getState();
      } catch (cause) {
        preview = null; previewPages = null; message = 'Review the error. For fit errors choose paper, orientation or fixed scale manually; scale is never silently reduced.';
        return fail(cause);
      }
    }
    return { getState, select, setDraft, discardDraft, save, deleteSelected, sync, refresh, setPreviewSettings,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dispose() { disposed = true; previewPages = null; unsubscribe?.(); drafts.dispose(); listeners.clear(); } };
  }

  function mount(document = root.document) {
    const host = document?.getElementById('workspaceStructure');
    if (!host || host.homePlannerStructure) return host?.homePlannerStructure || null;
    const view = document.defaultView || root;
    const el = (tag, value = '', className = '') => {
      const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node;
    };
    let controller;
    try { controller = createController(view.HomePlanner, view); }
    catch (cause) { const error = el('p', cause.message); error.setAttribute('role', 'alert'); host.replaceChildren(error); return null; }
    host.classList.add('hp-structure');
    const warning = el('p', 'Engineering status: NOT ASSESSED. Conceptual geometry coordination only—not safety, capacity, compliance or construction approval. No loads, soil, reinforcement, material strengths or costs are inferred.', 'hp-structure-warning');
    const context = el('p');
    const help = el('p', 'Choose an element, enter its position, then Save. Blank sizes/material may stay Not supplied for a sketch; use drawing dimensions and the engineer’s material specification for more detail. Refresh reviews saved geometry only.');
    const geometryHelp = el('details');
    geometryHelp.append(el('summary', 'Position, size and source conventions'), el('p', 'Column/slab/footing width and depth follow the site axes; height extends upward from the bottom center. Beam endpoints are bottom centers: width crosses the beam and depth is its upward vertical thickness. Leave beam/grid height blank. Grids have no sizes or material. Existing hosted positions stay unchanged unless replacement is checked. Computed positions use site-local x/y, project-relative z; do not paste them into floor-local fields without conversion. Source and reference are unverified author claims.'));
    const form = el('form', '', 'hp-structure-form'), fields = {};
    function field(name, label, options) {
      const wrapper = el('label', label), input = el(options ? 'select' : 'input');
      input.id = `hp-structure-${name}`; wrapper.htmlFor = input.id;
      if (options) for (const [value, title] of options) { const option = el('option', title); option.value = value; input.append(option); }
      else { input.type = 'text'; input.maxLength = 16384; }
      wrapper.append(input); form.append(wrapper); fields[name] = input; return input;
    }
    field('selectedId', 'Element to edit', []).addEventListener('change', () => controller.select(fields.selectedId.value));
    field('kind', 'Element type', kinds.map(value => [value, value]));
    field('label', 'Name (optional)');
    for (const prefix of ['start', 'end']) for (const axis of ['X', 'Y', 'Z']) {
      const input = field(`${prefix}${axis}`, `${prefix === 'start' ? 'Start / bottom center' : 'End (beam/grid only)'} ${axis.toLowerCase()} (m, floor-relative plate-local)`);
      input.inputMode = 'decimal';
    }
    for (const [name, label] of [['widthM', 'Width'], ['depthM', 'Depth'], ['heightM', 'Height']])
      field(name, `${label} (m; blank = Not supplied / not applicable)`).inputMode = 'decimal';
    field('material', 'Material (from specification; blank = Not supplied)');
    field('sizeSource', 'Size source (unverified claim)', [['unspecified', 'Not supplied'], ['assumed', 'Assumed for a sketch'],
      ['authored', 'Entered by you'], ['engineer-provided', 'Engineer-provided (unverified)']]);
    field('reference', 'Drawing / specification reference (optional; unverified)');
    const replaceLabel = el('label'), replace = el('input'); replace.type = 'checkbox'; replace.id = 'hp-structure-replaceAnchors';
    replaceLabel.htmlFor = replace.id; replaceLabel.append(replace, document.createTextNode('Replace anchors with entered point coordinates'));
    form.append(replaceLabel); fields.replaceAnchors = replace;
    for (const [name, input] of Object.entries(fields)) if (name !== 'selectedId')
      input.addEventListener(input.tagName === 'SELECT' || name === 'replaceAnchors' ? 'change' : 'input',
        () => controller.setDraft({ [name]: name === 'replaceAnchors' ? input.checked : input.value }));
    const anchorSummary = el('p', '', 'hp-structure-anchor-summary'), anchorDetails = el('details'), anchorRaw = el('pre');
    anchorDetails.append(el('summary', 'Technical details — saved positions and resolution'), anchorRaw);
    const save = el('button', 'Save structural intent'); save.type = 'submit';
    const reload = el('button', 'Discard draft / reload fields'); reload.type = 'button';
    reload.addEventListener('click', () => {
      if (!controller.getState().dirty || view.confirm('Discard the pending structural draft and reload saved fields?')) controller.discardDraft();
    });
    const remove = el('button', 'Delete selected element'); remove.type = 'button';
    remove.addEventListener('click', () => {
      const state = controller.getState();
      if (state.selectedId && view.confirm(`Delete structural element ${state.selectedId}? Other references will be retained for repair. Undo is available.`))
        controller.deleteSelected({ confirmed: true });
    });
    form.append(save, remove, reload);
    form.addEventListener('submit', event => { event.preventDefault(); controller.save(); });
    const previewControls = el('div', '', 'hp-structure-preview-controls'), previewFields = {};
    for (const [name, label, values] of [['paper', 'Preview paper', ['A4', 'A3', 'A2']], ['orientation', 'Preview orientation', ['portrait', 'landscape']], ['scaleDenominator', 'Fixed scale', [50, 75, 100]]]) {
      const wrapper = el('label', label), input = el('select'); input.id = `hp-structure-preview-${name}`; wrapper.htmlFor = input.id;
      for (const value of values) { const option = el('option', name === 'scaleDenominator' ? `1:${value}` : value); option.value = value; input.append(option); }
      input.addEventListener('change', () => controller.setPreviewSettings({ [name]: name === 'scaleDenominator' ? Number(input.value) : input.value }));
      wrapper.append(input); previewControls.append(wrapper); previewFields[name] = input;
    }
    const pageLabel = el('label', 'Preview page'), pageSelect = el('select');
    pageSelect.id = 'hp-structure-preview-pageIndex'; pageLabel.htmlFor = pageSelect.id;
    pageLabel.append(pageSelect); previewControls.append(pageLabel); previewFields.pageIndex = pageSelect;
    pageSelect.addEventListener('change', () => controller.setPreviewSettings({ pageIndex: Number(pageSelect.value) }));
    const refresh = el('button', 'Refresh coordination & 2D preview'); refresh.type = 'button';
    refresh.addEventListener('click', () => controller.refresh()); previewControls.append(refresh);
    const layout = el('a', 'Open shared Design / Layout for 2D / 3D'); layout.href = '?workspace=design&section=layout';
    layout.dataset.workspace = 'design'; layout.dataset.section = 'layout';
    const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = el('p', '', 'hp-structure-error'); error.setAttribute('role', 'alert');
    const schedule = el('div', '', 'hp-structure-schedule'); schedule.tabIndex = 0; schedule.setAttribute('role', 'region'); schedule.setAttribute('aria-label', 'Scrollable current-floor structural schedule');
    const findings = el('ul'), preview = el('div', '', 'hp-structure-preview'); preview.tabIndex = 0; preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', 'Scrollable structural sheet preview');
    host.replaceChildren(el('h2', 'Editable structural intent'), warning, context, help, geometryHelp, form, anchorSummary, anchorDetails, previewControls, layout, status, error,
      el('h3', 'Current-floor elements'), el('p', 'The schedule is view-only. Select an element above to edit it. Technical details retain every saved field, identifier and computed position; computed coordinates are not replacement form values.'), schedule,
      el('h3', 'Current coordination findings — not an engineering assessment'), findings, preview);
    const readable = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
    const findingText = item => ({
      'unknown-dimensions': 'Dimensions not supplied or unusable. Enter width, depth and applicable height from a drawing or measurement to show the solid; leave them blank for an early sketch.',
      'unknown-material': 'Material: Not supplied. Obtain the material description from the engineer’s specification; a drawn shape is not a material specification.',
      'unknown-provenance': 'Size source: Not supplied. Record whether dimensions are assumed, entered from a drawing, or supplied by an engineer, and add the reference when available.',
      'unresolved-anchor': 'Position cannot be resolved. Place or repair the referenced object, or explicitly replace its position above; no shape is invented.',
      'unsupported-height': 'Leave beam/grid height blank. Beam depth is its vertical thickness; grids have no vertical extent.'
    }[item.code] || item.message);
    function technical(value) {
      const node = el('details'); node.append(el('summary', 'Technical details — fields and identifiers'), el('pre', JSON.stringify(value, null, 2))); return node;
    }
    const dimension = (record, key) => record.kind === 'grid' || (key === 'heightM' && record.kind === 'beam')
      ? 'Not applicable' : record[key] == null ? 'Not supplied' : String(record[key]);
    function position(anchor) {
      if (!anchor) return 'Not supplied — place or repair position';
      const floor = view.HomePlanner.getProject().floors.find(floor => floor.id === anchor.floorId);
      const floorName = floor?.name || 'Unavailable floor';
      if (anchor.kind === 'point') return `${floorName} · x ${anchor.point.x}, y ${anchor.point.y}, z ${anchor.point.z} m (floor-local)`;
      const record = Object.values(floor?.authored || {}).flat().find(record => record?.id === anchor.entityId);
      return `${floorName} · ${record?.label || readable(anchor.entityKind || anchor.kind)} reference`;
    }
    let url = null, priorPreview = null, selectKey = '', scheduleKey = '', pageKey = '', findingsKey = '';
    function render(state) {
      context.textContent = `${state.floorName} · Revision ${state.revision}`;
      context.title = `Floor ${state.floorId} · Project ${state.projectId}`;
      status.textContent = `${state.message}${state.dirty ? ' Pending unsaved input draft; project Save does not include it.' : ''}`; error.textContent = state.error; error.hidden = !state.error;
      const nextKey = JSON.stringify([state.projectId, state.floorId, state.retainedDraftIds,
        state.schedule.map(row => [row.record.id, row.record.label, row.record.kind])]);
      if (nextKey !== selectKey || !fields.selectedId.children.length) {
        const option = el('option', 'New element'); option.value = '';
        fields.selectedId.replaceChildren(option, ...state.schedule.map(({ record }, index) => {
          const node = el('option', `${record.label || `${record.kind} ${index + 1}`} (${record.kind})`); node.value = record.id; return node;
        }), ...state.retainedDraftIds.map(id => {
          const node = el('option', `Unavailable element — input draft ${id}`); node.value = id; return node;
        })); selectKey = nextKey;
      }
      fields.selectedId.value = state.selectedId;
      for (const [name, value] of Object.entries(state.draft)) {
        if (name === 'replaceAnchors') fields[name].checked = value;
        else if (fields[name].value !== String(value)) fields[name].value = String(value);
      }
      for (const prefix of ['start', 'end']) for (const axis of ['X', 'Y', 'Z']) {
        const input = fields[`${prefix}${axis}`], applicable = prefix === 'start' || segment(state.draft.kind);
        input.disabled = !applicable || (!!state.selectedId && !state.draft.replaceAnchors);
        input.required = applicable && !input.disabled;
      }
      remove.disabled = !state.selectedId; replace.disabled = !state.selectedId;
      anchorSummary.textContent = state.selectedId
        ? `Saved positions stay unchanged unless replacement is checked. ${state.anchorSummary.map((entry, index) => `Position ${index + 1}: ${position(entry.authored)}. ${!entry.resolution ? 'Refresh to check its location.' : entry.resolution.status === 'resolved' ? 'Location resolved; not an engineering assessment.' : 'Location unresolved — place or repair the referenced object.'}`).join(' ')}`
        : 'New elements require every applicable point coordinate explicitly. No zero coordinates, member dimensions or materials are prefilled.';
      anchorDetails.hidden = !state.selectedId; anchorRaw.textContent = JSON.stringify(state.anchorSummary, null, 2);
      const pageCount = state.preview?.pageCount || 0;
      pageLabel.hidden = pageCount <= 1; pageSelect.disabled = pageCount <= 1;
      const nextPageKey = JSON.stringify([state.floorName, pageCount]);
      if (pageKey !== nextPageKey) {
        pageSelect.replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
          const option = el('option', `${state.floorName} · Page ${index + 1} of ${pageCount}`);
          option.value = String(index); return option;
        })); pageKey = nextPageKey;
      }
      for (const [name, value] of Object.entries(state.previewSettings)) previewFields[name].value = String(value);
      const nextSchedule = JSON.stringify(state.schedule);
      if (scheduleKey !== nextSchedule) {
        const table = el('table'), caption = el('caption', 'Current floor only. Not supplied means no value was entered, never zero.');
        const headers = ['Element', 'Type', 'Saved position', 'Width (m)', 'Depth (m)', 'Height (m)', 'Material', 'Size source', 'Reference', 'Drawing shape', 'Review', 'Technical details'];
        const head = el('tr'); headers.forEach(title => { const cell = el('th', title); cell.scope = 'col'; head.append(cell); }); const thead = el('thead'); thead.append(head);
        const body = el('tbody');
        for (const [index, { record, projected }] of state.schedule.entries()) {
          const row = el('tr');
          const values = [record.label || `${record.kind} ${index + 1}`, readable(record.kind), record.anchors.map(position).join(' → '),
            ...['widthM', 'depthM', 'heightM'].map(key => dimension(record, key)), record.kind === 'grid' ? 'Not applicable' : record.material ?? 'Not supplied',
            !record.sizeSource || record.sizeSource === 'unspecified' ? 'Not supplied' : readable(record.sizeSource), record.reference ?? 'Not supplied',
            !projected ? 'Not refreshed' : projected.geometry ? (projected.geometry.kind === 'grid' ? 'Reference line' : 'Conceptual solid') : 'Cannot draw yet — review missing inputs',
            projected ? (projected.issues.length ? `${projected.issues.length} review items — see findings below` : 'No local findings; engineering NOT ASSESSED') : 'Not refreshed'];
          for (const value of values) row.append(el('td', String(value)));
          const detailsCell = el('td'); detailsCell.append(technical({ authored: record, projected })); row.append(detailsCell);
          body.append(row);
        }
        table.append(caption, thead, body); schedule.replaceChildren(table); scheduleKey = nextSchedule;
      }
      const nextFindings = JSON.stringify([state.stale, state.findings, nextSchedule]);
      if (findingsKey !== nextFindings) {
        const seen = new Set();
        findings.replaceChildren(...(state.stale ? [el('li', 'Coordination is stale / not yet computed. Refresh explicitly. Engineering remains not assessed.')]
        : state.findings.filter(item => {
          const key = JSON.stringify([item.code, item.floorId, [...item.elementIds].sort(), item.message, item.severity]);
          if (seen.has(key)) return false; seen.add(key); return true;
        }).map(item => {
          const names = item.elementIds.map(id => state.schedule.findIndex(row => row.record.id === id))
            .filter(index => index >= 0).map(index => state.schedule[index].record.label || `${readable(state.schedule[index].record.kind)} ${index + 1}`);
          const node = el('li', `${names.length ? `${names.join(', ')}: ` : ''}${findingText(item)}`);
          node.append(technical(item)); return node;
        })));
        findingsKey = nextFindings;
      }
      if (priorPreview !== state.preview) {
        if (url) view.URL.revokeObjectURL(url); url = null; priorPreview = state.preview; preview.replaceChildren();
        if (state.preview) {
          url = view.URL.createObjectURL(new view.Blob([state.preview.svg], { type: 'image/svg+xml' }));
          const image = el('img'); image.src = url; image.alt = `${state.floorName} · Page ${state.preview.pageIndex + 1} of ${state.preview.pageCount} · structural reference sheet. Engineering not assessed. Print at 100% / Actual size.`;
          image.addEventListener('error', () => {
            if (priorPreview === state.preview) { error.textContent = 'Structural SVG could not be displayed. Refresh and review renderer output.'; error.hidden = false; }
          });
          preview.append(image);
        }
      }
    }
    const unsubscribe = controller.subscribe(render);
    const onRoute = () => controller.sync();
    document.addEventListener('homeplanner:workspace-change', onRoute);
    const dispose = controller.dispose;
    controller.dispose = () => {
      unsubscribe(); dispose(); if (url) view.URL.revokeObjectURL(url); url = null;
      document.removeEventListener('homeplanner:workspace-change', onRoute);
      view.removeEventListener('pagehide', onHide); delete host.homePlannerStructure; host.replaceChildren();
    };
    const onHide = event => { if (!event.persisted) controller.dispose(); };
    view.addEventListener('pagehide', onHide);
    host.homePlannerStructure = controller; render(controller.getState()); return controller;
  }
  return { createController, mount };
});
