(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerServicesUI = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Drafts) {
  'use strict';
  const collections = ['fixtures', 'serviceNodes', 'serviceRoutes'];
  const fixtureKinds = ['basin', 'sink', 'toilet', 'shower', 'equipment'];
  const roles = { fixture: ['port', 'fixture', 'trap', 'floor-trap', 'gully-trap', 'roof-outlet'],
    junction: ['junction', 'stack', 'valve', 'trap', 'cleanout', 'chamber', 'downpipe'],
    supply: ['supply'], outlet: ['outlet', 'outfall'] };
  const circuits = { water: ['cold', 'hot'], waste: ['soil', 'waste', 'vent'], rain: ['storm'] };
  const sources = ['assumed', 'surveyed', 'engineer-provided'];
  const discharges = ['sewer', 'surface-outfall', 'soakaway', 'septic', 'reuse', 'other'];
  function domainConfig(options = {}) {
    if (Object.keys(options).some(key => key !== 'domain') || !['plumbing', 'drainage'].includes(options.domain || 'plumbing'))
      throw new Error('Unknown workbench domain.');
    const drainage = options.domain === 'drainage';
    return { drainage, title: drainage ? 'Drainage' : 'Plumbing', domain: drainage ? 'drainage' : 'plumbing',
      systems: drainage ? ['waste', 'rain'] : ['water', 'waste'],
      hostId: drainage ? 'workspaceDrainage' : 'workspacePlumbing',
      prefix: drainage ? 'hp-drainage' : 'hp-service', property: drainage ? 'homePlannerDrainage' : 'homePlannerServices',
      systemSetting: drainage ? 'drainageSystem' : 'plumbingSystem' };
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  const pair = ref => ref ? JSON.stringify([ref.floorId, ref.entityId]) : '';
  const blank = collection => ({ kind: collection === 'fixtures' ? 'basin' : 'fixture',
    system: 'water', label: '', role: '', circuit: '', widthM: '', depthM: '', heightM: '',
    diameterMm: '', invertM: '', slope: '', anchorMode: 'point', fixtureRef: '',
    x: '', y: '', z: '', from: '', to: '', waypoints: '', replaceAnchors: false, replaceWaypoints: false,
    groundM: '', finishedFloorM: '', levelSource: '', levelReference: '', accessRadiusM: '',
    dischargeKind: '', dischargeReference: '', removeDischarge: false,
    viaInvertsM: '', keepViaInverts: false, slopeSource: '', slopeReference: '', clearanceM: '' });
  function number(value, name, required = false, min = -1e9, positive = false) {
    if (value === '' || value === null || (typeof value === 'string' && !value.trim())) {
      if (required) throw new Error(`${name} is required; enter a coordinate explicitly.`);
      return null;
    }
    if (!['string', 'number'].includes(typeof value)) throw new Error(`${name} must be a finite number.`);
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
      throw new Error(`${name} must be a decimal number, not an expression or non-decimal literal.`);
    const result = Number(value);
    if (!Number.isFinite(result) || Math.abs(result) > 1e9 || result < min || (positive && result === min))
      throw new Error(`${name} must be ${positive ? 'positive' : min === 0 ? 'nonnegative' : 'finite'}, at most 1e9 in magnitude.`);
    return result;
  }
  function text(value, name) {
    if (value === '' || value === null) return null;
    if (typeof value !== 'string' || value.length > 16384 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error(`${name} must be text without control characters (maximum 16384 characters).`);
    return value.trim() || null;
  }
  function uuid(runtime) {
    if (runtime.crypto?.randomUUID) return runtime.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (!runtime.crypto?.getRandomValues && !root.crypto?.getRandomValues)
      throw new Error('Secure ID generator unavailable. Reload in a secure browser context.');
    (runtime.crypto || root.crypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0'));
    return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10)].map(a => a.join('')).join('-');
  }
  function createController(planner, runtime = root, configuration = {}) {
    const config = domainConfig(configuration), { drainage, title, systemSetting } = config;
    if (!planner?.getProject || !planner?.execute || !planner?.getDrawingScene || !planner?.inputFingerprint)
      throw new Error(`${title} workbench requires the project bridge and drawing foundation.`);
    let project = planner.getProject(), fingerprint = planner.inputFingerprint(), collection = 'fixtures';
    const newDraft = () => ({ ...blank(collection), system: config.systems[0] });
    let selectedId = '', draft = newDraft(), touched = new Set(), disposed = false;
    const drafts = Drafts.createStore(planner, `${title} intent`), selections = new Map();
    let baseRecord = null, draftConflict = '';
    const owner = () => JSON.stringify([project.id, project.activeFloorId]);
    const draftScope = (id = selectedId) => ({ projectId: project.id, floorId: project.activeFloorId, collection, entityId: id });
    let result = null, preview = null, previewPages = null, error = '';
    let message = 'Enter authored intent. Save drafts explicitly; refresh explicitly for coordination and preview.';
    let previewSettings = { view: 'plan', [systemSetting]: 'both', paper: 'A3', orientation: 'landscape',
      scaleDenominator: 100, units: 'metric', pageIndex: 0 };
    const listeners = new Set(), floor = () => project.floors.find(f => f.id === project.activeFloorId);
    const records = (name = collection) => floor()?.authored?.[name] || [];
    const selected = () => records().find(r => r.id === selectedId);
    function options(name) {
      return project.floors.map(f => ({ floorId: f.id, floorName: f.name,
        entries: (f.authored?.[name] || []).map((r, i) => ({ value: pair({ floorId: f.id, entityId: r.id }),
          floorId: f.id, entityId: r.id, label: `${r.label || `${r.kind || 'route'} ${i + 1}`}${r.system ? ` · ${r.circuit || r.system}` : ''}` })) }));
    }
    function getState() {
      return { domain: config.domain, projectId: project.id, revision: project.revision, floorId: project.activeFloorId, floorName: floor()?.name,
        collection, selectedId, draft: { ...draft }, dirty: touched.size > 0, error: error || draftConflict, message,
        retainedDraftIds: drafts.scopes().filter(scope => scope.projectId === project.id && scope.floorId === project.activeFloorId &&
          scope.collection === collection && scope.entityId && !records().some(record => record.id === scope.entityId)).map(scope => scope.entityId),
        engineeringStatus: 'not-assessed', stale: !result, preview, previewSettings: { ...previewSettings },
        fixtureOptions: options('fixtures'), nodeOptions: options('serviceNodes'),
        selectedRecord: selected() ? copy(selected()) : null,
        schedule: Object.fromEntries(collections.map(name => [name, records(name).map(record => ({
          record: copy(record), projected: result?.[{ fixtures: 'fixtures', serviceNodes: 'nodes', serviceRoutes: 'routes' }[name]]
            ?.find(r => r.floorId === project.activeFloorId && r.id === record.id) || null
        }))])),
        findings: result?.findings.filter(f => drainage || f.floorId === null || f.floorId === project.activeFloorId) || [] };
    }
    const notify = () => { if (!disposed) listeners.forEach(fn => fn(getState())); };
    const invalidate = () => { result = null; preview = null; previewPages = null; error = ''; };
    function load(id = '') {
      const record = records().find(r => r.id === id);
      const pending = drafts.get(draftScope(id));
      if (id && !record && !pending) throw new Error('Selected record no longer exists on this floor.');
      selectedId = id; draft = newDraft(); touched = new Set();
      baseRecord = record ? copy(record) : null; draftConflict = '';
      if (record) {
        for (const key of ['kind', 'system', 'label', 'role', 'circuit', 'widthM', 'depthM', 'heightM', 'diameterMm', 'invertM', 'slope',
        'groundM', 'finishedFloorM', 'levelSource', 'levelReference', 'accessRadiusM', 'slopeSource', 'slopeReference', 'clearanceM'])
        if (record[key] !== undefined && record[key] !== null) draft[key] = String(record[key]);
      if (record.discharge) { draft.dischargeKind = record.discharge.kind; draft.dischargeReference = record.discharge.reference || ''; }
      if (record.viaInvertsM) draft.viaInvertsM = record.viaInvertsM.map(v => v === null ? '?' : String(v)).join('\n');
      if (record.anchor?.kind === 'point' && record.anchor.floorId === project.activeFloorId)
        for (const axis of ['x', 'y', 'z']) draft[axis] = String(record.anchor.point[axis]);
      if (collection === 'serviceNodes' && record.anchor?.kind === 'entity' && record.anchor.entityKind === 'fixture') {
        draft.anchorMode = 'fixture'; draft.fixtureRef = pair(record.anchor);
      }
      if (record.from) draft.from = pair(record.from);
      if (record.to) draft.to = pair(record.to);
      if (record.via?.every(a => a?.kind === 'point' && a.floorId === project.activeFloorId))
        draft.waypoints = record.via.map(a => ['x', 'y', 'z'].map(axis => a.point[axis]).join(', ')).join('\n');
      }
      if (pending) {
        draft = pending.draft; touched = new Set(pending.touched);
        if (JSON.stringify(pending.baseRecord) !== JSON.stringify(baseRecord))
          draftConflict = 'Project changed the selected record. Your draft is retained; copy needed values, then discard/reload fields before saving.';
        baseRecord = pending.baseRecord;
      }
      selections.set(owner(), { collection, selectedId });
    }
    function sync() {
      if (disposed) return false;
      const next = planner.getProject(), nextFingerprint = planner.inputFingerprint();
      const navigated = next.id !== project.id || next.activeFloorId !== project.activeFloorId;
      const changed = next.id !== project.id || next.revision !== project.revision || nextFingerprint !== fingerprint;
      selections.set(owner(), { collection, selectedId });
      project = next; fingerprint = nextFingerprint;
      if (navigated || changed) {
        invalidate(); previewSettings.pageIndex = 0;
        const position = navigated ? selections.get(owner()) || { collection: 'fixtures', selectedId: '' } : { collection, selectedId };
        collection = position.collection;
        const id = position.selectedId;
        load(id && !records().some(record => record.id === id) && !drafts.get(draftScope(id)) ? '' : id);
        message = navigated ? 'Floor/project changed. Drafts are retained on their original owners; no anchors were rehosted.'
          : 'Project changed. Pending fields were retained and stale results discarded. Refresh explicitly.';
        notify();
      }
      return navigated || changed;
    }
    const unsubscribe = planner.subscribe?.(sync);
    function select(name = collection, id = '') {
      sync();
      if (!collections.includes(name)) throw new Error(`Unsupported ${config.domain} collection.`);
      if (id && !(floor()?.authored?.[name] || []).some(r => r.id === id) &&
          !drafts.get({ ...draftScope(id), collection: name })) throw new Error('Selected record no longer exists on this floor.');
      collection = name; load(id); error = ''; message = id ? 'Editing a saved record. Changes remain a pending draft until Save.' : 'New draft. Nothing is saved until Save.';
      notify();
    }
    function setDraft(patch) {
      sync();
      if (Object.keys(patch).some(key => !Object.hasOwn(draft, key))) throw new Error(`Unknown ${config.domain} field.`);
      for (const [key, value] of Object.entries(patch)) {
        if (['replaceAnchors', 'replaceWaypoints', 'keepViaInverts', 'removeDischarge'].includes(key)) {
          if (typeof value !== 'boolean') throw new Error('Replacement must be explicitly checked.');
        } else if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
          throw new Error(`${key} must be plain text or a finite number.`);
      }
      for (const [key, value] of Object.entries(patch)) { draft[key] = value; touched.add(key); }
      drafts.put(draftScope(), { draft, touched: [...touched], baseRecord });
      error = ''; notify();
    }
    function discardDraft() {
      sync(); drafts.remove(draftScope()); load(selected() ? selectedId : '');
      error = ''; message = 'Current draft discarded; fields reloaded from the project.'; notify();
    }
    function fail(cause) { error = cause.message || String(cause); notify(); return null; }
    function reference(value, name, targetCollection) {
      const match = options(targetCollection).flatMap(g => g.entries).find(r => r.value === value);
      if (!match) throw new Error(`${name}: choose an existing ${targetCollection === 'fixtures' ? 'fixture' : 'node'} explicitly. Unavailable references are retained until repaired.`);
      return { floorId: match.floorId, entityId: match.entityId };
    }
    const point = (values, label) => ({ kind: 'point', floorId: project.activeFloorId,
      point: Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, number(values[i], `${label} ${axis} (m)`, true)])) });
    function save() {
      try {
        if (disposed) throw new Error(`${title} workbench has been disposed.`);
        const originalOwner = owner(), originalScope = draftScope(); sync();
        if (owner() !== originalOwner) throw new Error('Floor/project changed. Review this owner before saving; original drafts were retained.');
        if (draftConflict) throw new Error(draftConflict);
        const existing = selected(), value = existing ? copy(existing) : { id: `${project.activeFloorId}:authored:${uuid(runtime)}` };
        for (const key of ['replaceAnchors', 'replaceWaypoints', 'keepViaInverts', 'removeDischarge'])
          if (typeof draft[key] !== 'boolean') throw new Error('Replacement must be explicitly checked.');
        const assign = (key, parsed) => { if (!existing || touched.has(key)) value[key] = parsed; };
        if (collection === 'fixtures') {
          if (!fixtureKinds.includes(draft.kind)) throw new Error('Choose a supported fixture kind.');
          value.kind = draft.kind;
          for (const key of ['widthM', 'depthM', 'heightM']) assign(key, number(draft[key], key, false, 0, true));
        } else {
          if (!config.systems.includes(draft.system) && !(existing?.system === draft.system && Object.hasOwn(circuits, draft.system)))
            throw new Error(`Choose ${config.systems.join(' or ')}. Other saved systems are retained for repair only.`);
          value.system = draft.system;
          if (draft.circuit !== '' && !circuits[value.system].includes(draft.circuit)) throw new Error('Circuit is incompatible with the selected system; choose a compatible circuit or unknown.');
          assign('circuit', draft.circuit || null); assign('label', text(draft.label, 'Label'));
          assign('diameterMm', number(draft.diameterMm, 'Diameter (mm)', false, 0, true));
          if (collection === 'serviceNodes') {
            if (!Object.hasOwn(roles, draft.kind)) throw new Error('Choose a supported node kind.');
            if (draft.role !== '' && !roles[draft.kind].includes(draft.role)) throw new Error('Role is incompatible with node kind; choose an allowed role or unknown.');
            value.kind = draft.kind; assign('role', draft.role || null); assign('invertM', number(draft.invertM, 'Invert (m)'));
            for (const key of ['groundM', 'finishedFloorM', 'accessRadiusM'])
              if (drainage || touched.has(key)) assign(key, number(draft[key], key, false, key === 'accessRadiusM' ? 0 : -1e9));
            if (drainage || touched.has('levelSource')) {
              if (draft.levelSource && !sources.includes(draft.levelSource)) throw new Error('Choose a supported claimed level source or unknown.');
              assign('levelSource', draft.levelSource || null);
            }
            if (drainage || touched.has('levelReference')) assign('levelReference', text(draft.levelReference, 'Level reference'));
            const dischargeTouched = touched.has('dischargeKind') || touched.has('dischargeReference');
            if (draft.removeDischarge) {
              if (draft.dischargeKind || draft.dischargeReference)
                throw new Error('Clear discharge kind and reference before explicitly removing discharge metadata.');
              delete value.discharge;
            } else if (value.kind !== 'outlet' && (Object.hasOwn(value, 'discharge') || dischargeTouched && (draft.dischargeKind || draft.dischargeReference))) {
              throw new Error('Discharge belongs only to outlet kind. Keep outlet, or clear both discharge fields and explicitly remove discharge metadata before changing kind.');
            } else if (value.kind === 'outlet' && ((!existing && drainage) || dischargeTouched)) {
              if (draft.dischargeKind && !discharges.includes(draft.dischargeKind)) throw new Error('Choose an explicit discharge kind or unknown; no sewer destination is inferred.');
              if (!draft.dischargeKind && draft.dischargeReference) throw new Error('Discharge reference requires an explicit discharge kind; clear reference or choose kind.');
              value.discharge = draft.dischargeKind ? { kind: draft.dischargeKind, reference: text(draft.dischargeReference, 'Discharge reference') } : null;
            }
          } else {
            assign('slope', number(draft.slope, 'Slope (fall/run)', false, 0));
            if (drainage || touched.has('clearanceM')) assign('clearanceM', number(draft.clearanceM, 'Clearance (m)', false, 0));
            if (drainage || touched.has('slopeSource')) {
              if (draft.slopeSource && !sources.includes(draft.slopeSource)) throw new Error('Choose a supported claimed slope source or unknown.');
              assign('slopeSource', draft.slopeSource || null);
            }
            if (drainage || touched.has('slopeReference')) assign('slopeReference', text(draft.slopeReference, 'Slope reference'));
            for (const key of ['from', 'to'])
              if (!existing || touched.has(key)) value[key] = reference(draft[key], key, 'serviceNodes');
            if (!existing || draft.replaceWaypoints) {
              if (typeof draft.waypoints !== 'string') throw new Error('Waypoints must be one x,y,z triple per line.');
              const lines = draft.waypoints.trim() ? draft.waypoints.trim().split(/\r?\n/) : [];
              if (lines.length > 10000) throw new Error('At most 10000 waypoints are supported.');
              value.via = lines.map((line, index) => {
                const values = line.split(',').map(s => s.trim());
                if (values.length !== 3) throw new Error(`Waypoint ${index + 1}: enter exactly one x,y,z triple per line.`);
                return point(values, `Waypoint ${index + 1}`);
              });
            }
            const replacingLevels = touched.has('viaInvertsM');
            if (existing && draft.replaceWaypoints && Object.hasOwn(existing, 'viaInvertsM') && !replacingLevels && !draft.keepViaInverts)
              throw new Error('Waypoints replaced: supply aligned via invert levels (one number or ? per waypoint), or explicitly choose to keep the existing ordered levels.');
            if (draft.keepViaInverts && existing?.viaInvertsM && !replacingLevels) {
              if (existing.viaInvertsM.length !== value.via.length) throw new Error('Existing via invert count does not match replacement waypoints. Repair the invert list explicitly.');
            } else if (replacingLevels || (!existing && drainage)) {
              if (typeof draft.viaInvertsM !== 'string') throw new Error('Via inverts must be one number or ? per line.');
              const lines = draft.viaInvertsM.trim() ? draft.viaInvertsM.trim().split(/\r?\n/) : [];
              if (lines.length !== value.via.length) throw new Error(`Via inverts require exactly ${value.via.length} entries, one number or ? per waypoint; received ${lines.length}.`);
              value.viaInvertsM = lines.map((line, i) => line.trim() === '?' ? null : number(line, `Via invert ${i + 1}`, true));
            }
          }
        }
        if (collection !== 'serviceRoutes' && (!existing || draft.replaceAnchors)) {
          if (collection === 'serviceNodes' && draft.anchorMode === 'fixture')
            value.anchor = { kind: 'entity', entityKind: 'fixture', ...reference(draft.fixtureRef, 'Anchor', 'fixtures') };
          else {
            if (draft.anchorMode !== 'point') throw new Error('Choose a point anchor (or explicit fixture anchor for nodes).');
            value.anchor = point(['x', 'y', 'z'].map(axis => draft[axis]), 'Anchor');
          }
        }
        planner.execute({ type: 'upsert-authored', collection, value });
        drafts.remove(originalScope);
        sync(); load(value.id); invalidate();
        message = `${title} intent saved in project history. No ports, fittings or engineering values were invented; refresh explicitly.`;
        notify(); return copy(value);
      } catch (cause) { return fail(cause); }
    }
    function deleteSelected({ confirmed = false } = {}) {
      try {
        if (disposed) throw new Error(`${title} workbench has been disposed.`);
        if (sync()) throw new Error('Project changed. Review the selection before deleting.');
        if (!selected()) throw new Error('Select a saved record before deleting.');
        if (!confirmed) throw new Error('Confirm deletion of the selected record.');
        const originalScope = draftScope();
        planner.execute({ type: 'delete-authored', collection, id: selectedId });
        drafts.remove(originalScope);
        sync(); load(); invalidate(); message = 'Record deleted. Surviving references are retained for repair; Undo restores it.';
        notify(); return true;
      } catch (cause) { return fail(cause); }
    }
    function selectedPreview() {
      const { sheets, toSVG } = previewPages;
      previewSettings.pageIndex = Math.min(previewSettings.pageIndex, sheets.length - 1);
      const sheet = sheets[previewSettings.pageIndex], svg = toSVG(sheet);
      if (typeof svg !== 'string' || svg.length > 20 * 1024 * 1024 ||
        new (runtime.Blob || root.Blob)([svg]).size > 20 * 1024 * 1024)
        throw new Error('Invalid or oversized SVG preview (20 MiB UTF-8 maximum).');
      return { sheet, svg, pageCount: sheets.length, pageIndex: previewSettings.pageIndex };
    }
    function setPreviewSettings(patch) {
      sync();
      const choices = { view: ['plan', drainage ? 'profile' : 'riser'], [systemSetting]: ['both', ...config.systems], paper: ['A4', 'A3', 'A2'],
        orientation: ['portrait', 'landscape'], scaleDenominator: [50, 75, 100], units: ['metric', 'imperial'] };
      if (Object.entries(patch).some(([key, value]) => key === 'pageIndex'
        ? !Number.isSafeInteger(value) || value < 0 : !choices[key]?.includes(value))) throw new Error(`Unsupported ${config.domain} preview setting.`);
      previewSettings = { ...previewSettings, ...patch }; preview = null; error = '';
      if (Object.keys(patch).length === 1 && Object.hasOwn(patch, 'pageIndex') && previewPages) {
        try { preview = selectedPreview(); notify(); } catch (cause) { previewPages = null; fail(cause); }
        return;
      }
      invalidate(); previewSettings.pageIndex = 0; message = 'Preview settings changed. Refresh explicitly; model and physical scale have not been edited.'; notify();
    }
    function refresh() {
      try {
        if (disposed) throw new Error(`${title} workbench has been disposed.`);
        sync(); invalidate();
        const analysis = drainage ? runtime.HomePlannerDrainage : runtime.HomePlannerServices;
        if (!analysis?.build) throw new Error(`${title} coordination module unavailable. Reload and refresh.`);
        const scene = planner.getDrawingScene();
        if (scene.projectId !== project.id || scene.revision !== project.revision || scene.inputFingerprint !== fingerprint)
          throw new Error(`${title} snapshot does not match the current project inputs.`);
        const systems = previewSettings[systemSetting] === 'both' ? config.systems : [previewSettings[systemSetting]];
        result = analysis.build(scene, { systems });
        const drawing = drainage ? runtime.HomePlannerDrainageDrawing : runtime.HomePlannerServicesDrawing, common = runtime.HomePlannerDrawing;
        if (!drawing?.createSheets || !(drawing.toSVG || common?.toSVG) || !common?.validateSheet)
          throw new Error(`${title} drawing renderer unavailable; coordination is shown. Load planner-${drainage ? 'drainage' : 'services'}-drawing.js and refresh.`);
        const { view, paper, orientation, scaleDenominator, units } = previewSettings;
        const sheets = drawing.createSheets(scene, { floorId: project.activeFloorId, floorName: floor()?.name,
          view, paper, orientation, scaleDenominator, units, systems });
        if (!Array.isArray(sheets) || !sheets.length || sheets.length > 100) throw new Error('Renderer must return 1–100 sheets.');
        for (const sheet of sheets) {
          const validation = common.validateSheet(sheet);
          if (validation === false || validation?.valid === false) throw new Error(`${title} sheet validation failed.`);
        }
        previewPages = { sheets, toSVG: (drawing.toSVG || common.toSVG).bind(drawing.toSVG ? drawing : common) };
        preview = selectedPreview(); message = 'Current-floor coordination and preview ready from one scene. Engineering remains NOT ASSESSED.';
        notify(); return getState();
      } catch (cause) {
        preview = null; previewPages = null;
        message = 'Review the error. Choose paper, orientation or fixed scale manually for fit errors; scale is never reduced automatically.';
        return fail(cause);
      }
    }
    return { getState, select, setDraft, discardDraft, save, deleteSelected, sync, refresh, setPreviewSettings,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dispose() { disposed = true; unsubscribe?.(); drafts.dispose(); listeners.clear(); result = null; preview = null; previewPages = null; } };
  }

  function mount(document = root.document, options = {}) {
    const config = domainConfig(options), { drainage, title, prefix, property, systemSetting } = config;
    const host = document?.getElementById(config.hostId);
    if (!host || host[property]) return host?.[property] || null;
    const view = document.defaultView || root;
    const el = (tag, text = '', className = '') => {
      const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
    };
    let controller;
    try { controller = createController(view.HomePlanner, view, options); }
    catch (cause) { const error = el('p', cause.message); error.setAttribute('role', 'alert'); host.replaceChildren(error); return null; }
    host.classList.add('hp-service');
    if (drainage) host.classList.add('hp-drainage');
    const warning = el('p', `Engineering status: NOT ASSESSED. Authored ${drainage ? 'waste / vent / rain' : 'water/waste'} intent only. No hydraulic sizing, pressure, capacity, drainage compliance, approved penetrations or construction details. No finding-free result is an engineering pass.`, 'hp-service-warning');
    if (drainage) warning.textContent = 'Engineering NOT ASSESSED. Geometric intent only; not capacity, compliance or construction approval.';
    const context = el('p'), status = el('p'), error = el('p', '', 'hp-service-error');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); error.setAttribute('role', 'alert');
    const help = el('p', `Add fixtures, connection points, then routes. Save applies edits; Refresh reviews saved ${config.domain} only. Blank values can stay Not supplied for a sketch. Use drawing dimensions and specified pipe diameters. ${drainage ? 'For a gravity profile, supply endpoint and waypoint invert levels from a level survey.' : 'Pressure and flow are not calculated; Drainage reviews gravity profiles.'}`);
    const coordinateHelp = el('details');
    coordinateHelp.append(el('summary', 'Coordinates, levels and connection conventions'), el('p', 'Point and replacement waypoint coordinates are metres: x/y from the owner floor’s plate origin, z relative to that floor. Invert means the inside bottom of the pipe; invert, ground and finished-floor levels are independently supplied project-relative metres, not anchor z or floor offsets. Fixtures do not create connection points automatically. From → to records proposed direction, not verified flow. Source/reference claims are unverified; access and clearance distances are supplied review intent, not approved allowances.'));
    const form = el('form', '', 'hp-service-form'), fields = {}, wrappers = {};
    function field(name, label, values, tag) {
      const wrapper = el('label', label), input = el(tag || (values ? 'select' : 'input'));
      input.id = `${prefix}-${name}`; input.name = name; wrapper.htmlFor = input.id;
      if (values) for (const [value, title] of values) { const option = el('option', title); option.value = value; input.append(option); }
      else if (tag !== 'textarea') { input.type = 'text'; input.maxLength = 16384; }
      wrapper.append(input); form.append(wrapper); fields[name] = input; wrappers[name] = wrapper; return input;
    }
    field('collection', 'Record type', [['fixtures', 'Fixtures'], ['serviceNodes', 'Nodes / explicit fixture ports'], ['serviceRoutes', 'Directed routes']]);
    field('selectedId', 'Saved record to edit', []);
    const draftStatus = el('p', '', 'hp-service-draft'); draftStatus.id = `${prefix}-draft-status`; form.append(draftStatus);
    field('kind', 'Object type', []);
    field('system', 'System', [['water', 'Water'], ['waste', 'Waste']]);
    field('label', 'Name (optional)');
    field('role', 'Node role (compatible with kind)', []);
    field('circuit', 'Circuit (compatible with system)', []);
    field('anchorMode', 'Position attached to', [['point', 'Point on owner floor'], ['fixture', 'Existing fixture on any floor']]);
    field('fixtureRef', 'Referenced fixture (choose its floor and name)', []);
    for (const axis of ['x', 'y', 'z']) field(axis, `Anchor ${axis} (m, owner-floor plate-local / floor-relative)`).inputMode = 'decimal';
    for (const [name, label] of [['widthM', 'Width (m)'], ['depthM', 'Depth (m)'], ['heightM', 'Height (m)'],
      ['diameterMm', 'Diameter (mm; from specification)'], ['invertM', 'Invert level (m; pipe inside bottom, from survey)'], ['slope', 'Slope (fall/run; from design, not enforced)']])
      field(name, `${label}; blank = Not supplied`).inputMode = 'decimal';
    field('from', 'From node — proposed direction', []); field('to', 'To node — proposed direction', []);
    field('waypoints', 'Optional waypoints: one x,y,z triple per line (metres, owner-floor PLATE-LOCAL x/y; floor-relative z). Blank = no vias.', null, 'textarea').rows = 4;
    for (const [name, label] of [['groundM', 'Ground level'], ['finishedFloorM', 'Finished-floor level']])
      field(name, `${label} (signed project-relative m; from survey; blank = Not supplied)`).inputMode = 'decimal';
    field('accessRadiusM', 'Access review radius (nonnegative m; blank = Not supplied)').inputMode = 'decimal';
    field('clearanceM', 'Route review clearance (nonnegative m; blank = Not supplied)').inputMode = 'decimal';
    for (const scope of ['level', 'slope']) {
      field(`${scope}Source`, `Claimed ${scope} source (unverified)`, [['', 'Not supplied'], ...sources.map(s => [s, s])]);
      field(`${scope}Reference`, `${scope === 'level' ? 'Level' : 'Slope'} reference (optional; unverified)`);
    }
    field('dischargeKind', 'Outlet discharge destination (blank = Not supplied)', [['', 'Not supplied — no destination inferred'], ...discharges.map(s => [s, s])]);
    field('dischargeReference', 'Outlet discharge reference (optional; unverified)');
    field('viaInvertsM', 'Ordered via invert levels: one signed project-relative number or ? per waypoint. Exact count required; no interpolation.', null, 'textarea').rows = 4;
    for (const [name, label] of [['replaceAnchors', 'Explicitly replace existing anchor (otherwise preserve exact host / unknown)'],
      ['replaceWaypoints', 'Explicitly replace existing waypoints (otherwise preserve exact anchors, including unresolved)'],
      ['keepViaInverts', 'Explicitly keep existing ordered via invert levels on replacement coordinates (same count required)'],
      ['removeDischarge', 'Explicitly remove discharge metadata (clear kind and reference first; required to change outlet base kind)']]) {
      const input = field(name, label); input.type = 'checkbox';
    }
    const summary = el('details', '', 'hp-service-record-details'), summaryBody = el('pre');
    summary.append(el('summary', 'Technical details — saved record and identifiers (preserved until Save)'), summaryBody); form.append(summary);
    const actions = el('div', '', 'hp-service-actions'), save = el('button', 'Save fixture'), remove = el('button', 'Delete saved record'), reset = el('button', 'Discard draft / reload fields');
    save.type = 'submit'; remove.type = reset.type = 'button'; actions.append(save, remove, reset); form.append(actions);
    const confirmDiscard = () => {
      if (!controller.getState().dirty) return true;
      if (!view.confirm(`Discard the pending unsaved ${config.domain} draft?`)) return false;
      controller.discardDraft(); return true;
    };
    fields.collection.addEventListener('change', () => { if (confirmDiscard()) controller.select(fields.collection.value); else render(controller.getState()); });
    fields.selectedId.addEventListener('change', () => { if (confirmDiscard()) controller.select(controller.getState().collection, fields.selectedId.value); else render(controller.getState()); });
    reset.addEventListener('click', () => { if (confirmDiscard()) controller.discardDraft(); });
    remove.addEventListener('click', () => {
      if (controller.getState().selectedId && view.confirm(`Delete this saved ${config.domain} record? Surviving references are retained for repair. Undo is available.`))
        controller.deleteSelected({ confirmed: true });
    });
    for (const [name, input] of Object.entries(fields)) if (!['collection', 'selectedId'].includes(name))
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input',
        () => controller.setDraft({ [name]: input.type === 'checkbox' ? input.checked : input.value }));
    form.addEventListener('submit', event => { event.preventDefault(); controller.save(); });
    const previewControls = el('div', '', 'hp-service-preview-controls'), previewFields = {};
    const reviewSettings = el('details', '', 'hp-service-review-settings'), reviewSummary = el('summary');
    reviewSettings.append(reviewSummary, previewControls);
    const printSettings = el('details', '', 'hp-service-print-settings'), printSummary = el('summary');
    const printFields = el('div', '', 'hp-service-preview-controls'); printSettings.append(printSummary, printFields);
    for (const [name, label, values] of [['view', `${title} view`, ['plan', drainage ? 'profile' : 'riser']], [systemSetting, 'Analyze / preview systems (does not edit records)', ['both', ...config.systems]],
      ['paper', 'Paper', ['A4', 'A3', 'A2']], ['orientation', 'Orientation', ['portrait', 'landscape']],
      ['scaleDenominator', 'Fixed scale', [50, 75, 100]], ['units', 'Drawing units', ['metric', 'imperial']], ['pageIndex', 'Preview page', []]]) {
      const wrapper = el('label', label), input = el('select'); input.id = `${prefix}-preview-${name}`; wrapper.htmlFor = input.id;
      for (const value of values) { const option = el('option', name === 'scaleDenominator' ? `1:${value}` : value); option.value = value; input.append(option); }
      input.addEventListener('change', () => {
        try { controller.setPreviewSettings({ [name]: ['pageIndex', 'scaleDenominator'].includes(name) ? Number(input.value) : input.value }); }
        catch (cause) { error.textContent = cause.message; error.hidden = false; }
      });
      wrapper.append(input);
      (drainage && ['paper', 'orientation', 'scaleDenominator', 'units'].includes(name) ? printFields : previewControls).append(wrapper);
      previewFields[name] = input;
    }
    const refresh = el('button', drainage ? 'Refresh drainage preview' : 'Refresh plumbing coordination & preview'); refresh.id = `${prefix}-refresh`; refresh.type = 'button';
    refresh.addEventListener('click', () => controller.refresh());
    if (!drainage) previewControls.append(refresh);
    const links = el('div', '', 'hp-service-actions');
    for (const [section, label] of [['layout', `Open Layout / 3D (enable ${config.domain} intent explicitly)`], ['drawings', `Open Report / Drawings · ${config.domain}`]]) {
      const link = el('a', label); link.dataset.workspace = section === 'layout' ? 'design' : 'report'; link.dataset.section = section;
      link.href = `?workspace=${link.dataset.workspace}&section=${section}${section === 'drawings' ? `&discipline=${config.domain}` : ''}`;
      if (section === 'drawings') {
        if (drainage) link.dataset.drawingDiscipline = 'drainage';
        else link.dataset.drawingDiscipline = 'plumbing';
      }
      links.append(link);
    }
    const schedules = el('div', '', 'hp-service-schedules'), findings = el(drainage ? 'div' : 'ul', '', drainage ? 'hp-service-table-region' : 'hp-service-findings');
    if (drainage) { findings.tabIndex = 0; findings.setAttribute('role', 'region'); findings.setAttribute('aria-label', 'Scrollable drainage findings with qualified references'); }
    const preview = el('div', '', 'hp-service-preview'); preview.tabIndex = 0; preview.setAttribute('role', 'region');
    preview.setAttribute('aria-label', `Scrollable ${config.domain} sheet preview`); preview.dataset.zoom = 'fit';
    const zoomLabel = el('label', 'View zoom (screen only)'), zoom = el('select'); zoom.id = `${prefix}-zoom`; zoomLabel.htmlFor = zoom.id;
    for (const [value, label] of [['fit', 'Fit to width'], ['full', 'Full view (intrinsic size)']]) {
      const option = el('option', label); option.value = value; zoom.append(option);
    }
    zoom.addEventListener('change', () => { preview.dataset.zoom = zoom.value; }); zoomLabel.append(zoom); previewControls.append(zoomLabel);
    if (drainage) previewControls.append(printSettings);
    const printHelp = el('p', 'Print at 100% / Actual size. Fit / Full view changes screen zoom only, never sheet dimensions or physical scale.');
    const scheduleHeading = el('h3', 'Current-floor schedule — all authored fixtures, nodes and routes');
    const findingsHeading = el('h3', 'Coordination findings — project engineering NOT ASSESSED');
    if (drainage) host.replaceChildren(el('h2', 'Drainage intent workbench'), warning, reviewSettings, refresh, error,
      preview, context, status, printHelp, links, el('h3', 'Author drainage intent'), help, coordinateHelp, form, findingsHeading, findings,
      scheduleHeading, el('p', 'Analysis filters never hide or edit raw records. Water records remain available for compatible metadata repair.'), schedules);
    else host.replaceChildren(el('h2', 'Plumbing intent workbench'), warning, context, help, coordinateHelp, form, previewControls, links, status, error,
      el('h3', 'Current-floor schedule — fixtures, connection points and routes'), el('p', 'System filtering affects analysis and sheets only. These view-only tables keep every saved record; use Edit to change one. Not supplied means no value was entered, never zero. Technical details retain original fields and identifiers.'), schedules,
      el('h3', 'Coordination findings — project engineering NOT ASSESSED'), findings,
      printHelp, preview);
    let priorPreview, url = null, scheduleKey = '', optionKey = '', pageKey = '', findingsKey = '';
    function setOptions(input, values, selectedValue) {
      input.replaceChildren(...values.map(([value, title]) => { const option = el('option', title); option.value = value; return option; }));
      if (selectedValue && !values.some(([value]) => value === selectedValue)) {
        const option = el('option', `${selectedValue} — incompatible / retained; choose explicitly`); option.value = selectedValue; input.append(option);
      }
      input.value = selectedValue || '';
    }
    function grouped(input, groups, value, label) {
      const unknown = el('option', `Choose ${label} explicitly`); unknown.value = '';
      input.replaceChildren(unknown);
      for (const group of groups) {
        const node = el('optgroup'); node.label = group.floorName || 'Unnamed floor';
        for (const entry of group.entries) { const option = el('option', entry.label); option.value = entry.value; node.append(option); }
        input.append(node);
      }
      if (value && !groups.some(g => g.entries.some(e => e.value === value))) {
        const missing = el('option', 'Unavailable reference — retained until explicitly repaired'); missing.value = value; input.append(missing);
      }
      input.value = value;
    }
    const showValue = value => value == null ? 'Not supplied' : String(value);
    const readable = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
    const collectionNames = { fixtures: 'Fixtures', serviceNodes: 'Connection points', serviceRoutes: 'Routes' };
    const findingText = finding => ({
      'unresolved-anchor': 'Position cannot be resolved. Place or repair the referenced object, or explicitly replace its position. No location is guessed.',
      'unknown-level': 'Position or connection level cannot be resolved. Supply its coordinates from the drawing or repair the referenced object.',
      'unknown-fixture-size': 'Fixture dimensions: Not supplied. Enter measured or drawing dimensions to show its extent; an early sketch can leave them blank.',
      'unknown-diameter': 'Pipe diameter: Not supplied. Obtain it from the engineer’s specification; the drawing uses a line or marker, not a sized pipe.',
      'unknown-invert': 'Invert level: Not supplied. Obtain the pipe inside-bottom level from a survey using the project datum; it is independent of the position height.',
      'unknown-outfall-level': 'Outlet invert level: Not supplied. Obtain its level from a survey to review the drain’s connection; no external level is guessed.',
      'unknown-ground-level': 'Ground level: Not supplied. Obtain a local level survey using the project datum; the floor plane is not ground evidence.',
      'unknown-finished-floor-level': 'Finished-floor level: Not supplied. Use the drawing or surveyed level relative to the project datum.',
      'unknown-slope': drainage ? 'Design slope: Not supplied. Enter the intended fall/run from the drainage design to compare it with surveyed levels; measured geometry does not choose a design slope.'
        : 'Design slope: Not supplied. Obtain the fall/run from the drainage design; this plumbing view does not calculate gravity profiles.',
      'unknown-circuit': 'Circuit: Not supplied. Choose the intended cold/hot water, soil/waste/vent, or storm circuit in the record form.',
      'unknown-discharge-destination': 'Discharge destination: Not supplied. Record the intended outlet and its reference from the drainage design; a sewer connection is not assumed.',
      'unknown-access-radius': 'Access review radius: Not supplied. Obtain the required review distance from the design brief or engineer; no allowance is assumed.',
      'unknown-clearance': 'Route review clearance: Not supplied. Obtain the review distance from the design brief or engineer; blank does not mean zero or safe.'
    }[finding.code] || finding.message);
    function uniqueFindings(items) {
      const seen = new Set();
      return items.filter(item => {
        const refs = (item.entityRefs || []).map(ref => [ref.floorId, ref.entityId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const key = JSON.stringify([item.code, item.floorId, item.componentId, refs, [...(item.entityIds || [])].sort(), item.message, item.severity]);
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    }
    function details(value, title = 'Technical details — fields and identifiers') {
      const node = el('details'); node.append(el('summary', title), el('pre', JSON.stringify(value, null, 2))); return node;
    }
    function render(state) {
      context.textContent = `${state.floorName} · Revision ${state.revision}`;
      context.title = `Floor ${state.floorId} · Project ${state.projectId}`;
      status.textContent = state.message; error.textContent = state.error; error.hidden = !state.error;
      const isFixture = state.collection === 'fixtures', isNode = state.collection === 'serviceNodes', isRoute = state.collection === 'serviceRoutes';
      fields.collection.value = state.collection;
      draftStatus.textContent = `${state.selectedId ? 'Editing saved record' : 'New record'} · ${state.dirty ? 'Pending unsaved changes' : 'No pending changes'}. Save is separate from preview.`;
      const nextOptions = JSON.stringify([state.projectId, state.floorId, state.collection, state.retainedDraftIds, state.schedule[state.collection].map(r => r.record), state.fixtureOptions, state.nodeOptions,
        state.draft.kind, state.draft.system, state.draft.role, state.draft.circuit, state.draft.from, state.draft.to, state.draft.fixtureRef,
        state.draft.levelSource, state.draft.slopeSource, state.draft.dischargeKind]);
      if (nextOptions !== optionKey) {
        setOptions(fields.selectedId, [['', 'New record'], ...state.schedule[state.collection].map(({ record }, index) =>
          [record.id, `${record.label || `${record.kind || 'route'} ${index + 1}`} · ${record.system || record.kind}`]),
          ...state.retainedDraftIds.map(id => [id, `Unavailable record — input draft ${id}`])], state.selectedId);
        setOptions(fields.kind, (isFixture ? fixtureKinds : Object.keys(roles)).map(v => [v, v]), state.draft.kind);
        setOptions(fields.system, config.systems.map(s => [s, s === 'rain' ? 'Rain / storm' : s === 'waste' ? 'Waste / soil / vent' : 'Water']), state.draft.system);
        setOptions(fields.role, [['', 'Not supplied'], ...(roles[state.draft.kind] || []).map(v => [v, readable(v)])], state.draft.role);
        setOptions(fields.circuit, [['', 'Not supplied'], ...(circuits[state.draft.system] || []).map(v => [v, readable(v)])], state.draft.circuit);
        for (const key of ['levelSource', 'slopeSource'])
          setOptions(fields[key], [['', 'Not supplied'], ...sources.map(v => [v, readable(v)])], state.draft[key]);
        setOptions(fields.dischargeKind, [['', 'Not supplied — no destination inferred'], ...discharges.map(v => [v, readable(v)])], state.draft.dischargeKind);
        grouped(fields.fixtureRef, state.fixtureOptions, state.draft.fixtureRef, 'fixture');
        grouped(fields.from, state.nodeOptions, state.draft.from, 'from node'); grouped(fields.to, state.nodeOptions, state.draft.to, 'to node');
        optionKey = nextOptions;
      }
      fields.selectedId.value = state.selectedId;
      const applicable = name => {
        if (['groundM', 'finishedFloorM', 'levelSource', 'levelReference', 'accessRadiusM', 'dischargeKind', 'dischargeReference', 'removeDischarge'].includes(name))
          return isNode && (drainage || ['groundM', 'finishedFloorM', 'levelSource', 'levelReference', 'accessRadiusM', 'discharge'].some(key => Object.hasOwn(state.selectedRecord || {}, key)));
        if (['viaInvertsM', 'keepViaInverts', 'slopeSource', 'slopeReference', 'clearanceM'].includes(name))
          return isRoute && (drainage || ['viaInvertsM', 'slopeSource', 'slopeReference', 'clearanceM'].some(key => Object.hasOwn(state.selectedRecord || {}, key)));
        if (['collection', 'selectedId'].includes(name)) return true;
        if (['widthM', 'depthM', 'heightM'].includes(name)) return isFixture;
        if (['system', 'label', 'circuit', 'diameterMm'].includes(name)) return !isFixture;
        if (['role', 'invertM', 'anchorMode', 'fixtureRef'].includes(name)) return isNode;
        if (['from', 'to', 'waypoints', 'replaceWaypoints', 'slope'].includes(name)) return isRoute;
        return !isRoute;
      };
      for (const [name, input] of Object.entries(fields)) {
        const visible = applicable(name); wrappers[name].hidden = !visible; input.disabled = !visible;
        if (Object.hasOwn(state.draft, name)) {
          if (input.type === 'checkbox') input.checked = state.draft[name];
          else if (input.value !== String(state.draft[name])) input.value = String(state.draft[name]);
        }
      }
      const anchorEnabled = !state.selectedId || state.draft.replaceAnchors;
      fields.replaceAnchors.disabled = !state.selectedId; fields.replaceWaypoints.disabled = !state.selectedId;
      fields.anchorMode.disabled = !isNode || !anchorEnabled;
      fields.fixtureRef.disabled = !isNode || !anchorEnabled || state.draft.anchorMode !== 'fixture';
      for (const axis of ['x', 'y', 'z']) {
        fields[axis].disabled = isRoute || !anchorEnabled || (isNode && state.draft.anchorMode === 'fixture');
        fields[axis].required = !fields[axis].disabled;
      }
      fields.waypoints.disabled = !isRoute || (!!state.selectedId && !state.draft.replaceWaypoints);
      fields.keepViaInverts.disabled = !isRoute || !state.selectedRecord?.viaInvertsM || !state.draft.replaceWaypoints;
      summary.hidden = !state.selectedRecord; summaryBody.textContent = state.selectedRecord ? JSON.stringify(state.selectedRecord, null, 2) : '';
      save.textContent = `Save ${isFixture ? 'fixture' : isNode ? 'node / explicit port' : 'directed route'}`;
      remove.disabled = !state.selectedId;
      const pageCount = state.preview?.pageCount || 0;
      if (pageKey !== String(pageCount)) {
        setOptions(previewFields.pageIndex, pageCount ? Array.from({ length: pageCount }, (_, i) => [String(i), `Page ${i + 1} of ${pageCount}`])
          : [['', 'Refresh to view pages']], pageCount ? String(state.previewSettings.pageIndex) : '');
        pageKey = String(pageCount);
      }
      previewFields.pageIndex.disabled = pageCount <= 1;
      for (const [name, value] of Object.entries(state.previewSettings)) previewFields[name].value = name === 'pageIndex' && !pageCount ? '' : String(value);
      printSummary.textContent = `Print settings · ${state.previewSettings.paper} ${state.previewSettings.orientation} · 1:${state.previewSettings.scaleDenominator} · ${state.previewSettings.units}`;
      reviewSummary.textContent = `View & print settings · ${state.previewSettings.view} · ${state.previewSettings[systemSetting]} systems · ${state.previewSettings.paper} · 1:${state.previewSettings.scaleDenominator}`;
      const nextSchedule = JSON.stringify(state.schedule);
      if (nextSchedule !== scheduleKey) {
        schedules.replaceChildren();
        for (const name of collections) {
          const region = el('div', '', 'hp-service-table-region'); region.tabIndex = 0; region.setAttribute('role', 'region');
          region.setAttribute('aria-label', `Scrollable ${collectionNames[name]} schedule`);
          const table = el('table'), head = el('thead'), header = el('tr'), body = el('tbody');
          const columns = name === 'fixtures' ? ['Fixture', 'Saved position', 'Width (m)', 'Depth (m)', 'Height (m)', 'Review', 'Edit / technical details']
            : name === 'serviceNodes' ? ['Connection point', 'System / circuit', 'Type / role', 'Saved position', 'Diameter (mm)', 'Invert level (m)', 'Review', 'Edit / technical details']
              : ['Route', 'System / circuit', 'From → to (with floor)', 'Diameter (mm)', 'Slope (fall/run)', 'Waypoints', 'Length (m)', 'Review', 'Edit / technical details'];
          columns.forEach(title => { const cell = el('th', title); cell.scope = 'col'; header.append(cell); }); head.append(header);
          function anchorDescription(anchor) {
            if (!anchor) return 'Not supplied — place or repair position';
            const f = state.fixtureOptions.find(g => g.floorId === anchor.floorId);
            const label = f?.entries.find(entry => entry.entityId === anchor.entityId)?.label;
            return anchor.kind === 'point' ? `${f?.floorName || 'Unavailable floor'} · x ${anchor.point.x}, y ${anchor.point.y}, z ${anchor.point.z} m (floor-local)`
              : `${f?.floorName || 'Unavailable floor'} · ${label || `${readable(anchor.entityKind || anchor.kind)} reference`}`;
          }
          function endpoint(ref) {
            const group = state.nodeOptions.find(g => g.floorId === ref.floorId), entry = group?.entries.find(e => e.entityId === ref.entityId);
            return `${group?.floorName || 'Unavailable floor'} · ${entry?.label || 'Unavailable connection — repair reference'}`;
          }
          state.schedule[name].forEach(({ record: r, projected }, index) => {
            const row = el('tr'), label = r.label || `${r.kind || 'route'} ${index + 1}`;
            const values = name === 'fixtures' ? [label, anchorDescription(r.anchor), ...[r.widthM, r.depthM, r.heightM].map(showValue)]
              : name === 'serviceNodes' ? [label, `${r.system} / ${showValue(r.circuit)}`, `${r.kind} / ${readable(showValue(r.role))}`, anchorDescription(r.anchor), showValue(r.diameterMm), showValue(r.invertM)]
                : [label, `${r.system} / ${showValue(r.circuit)}`, `${endpoint(r.from)} → ${endpoint(r.to)}`, showValue(r.diameterMm), showValue(r.slope),
                  String(r.via.length), projected ? projected.lengthM == null ? 'Cannot calculate — repair route positions' : showValue(projected.lengthM) : 'Not refreshed / not selected'];
            values.push(projected ? projected.issues.length ? `${projected.issues.length} review items — see findings below` : 'No local findings; NOT ASSESSED' : 'Not refreshed / not selected');
            values.forEach(value => row.append(el('td', value)));
            const cell = el('td'), edit = el('button', `Edit ${label}`); edit.type = 'button';
            edit.addEventListener('click', () => {
              if (confirmDiscard()) { controller.select(name, r.id); (name === 'serviceRoutes' ? fields.label : fields.kind).focus(); form.scrollIntoView?.({ block: 'nearest' }); }
            });
            cell.append(edit, details({ authored: r, projected })); row.append(cell); body.append(row);
          });
          if (!state.schedule[name].length) { const row = el('tr'), cell = el('td', 'No authored records on this floor. Choose a record type above and enter explicit intent, then Save.'); cell.colSpan = columns.length; row.append(cell); body.append(row); }
          table.append(el('caption', `${collectionNames[name]} · ${state.schedule[name].length} saved records on ${state.floorName}`), head, body);
          region.append(table); schedules.append(region);
        }
        scheduleKey = nextSchedule;
      }
      const nextFindings = JSON.stringify([state.stale, state.findings, state.nodeOptions, nextSchedule]);
      if (findingsKey !== nextFindings && drainage) {
        const table = el('table'), head = el('thead'), header = el('tr'), body = el('tbody');
        for (const label of ['Finding / severity', 'Scope', 'Review', 'Related records']) { const cell = el('th', label); cell.scope = 'col'; header.append(cell); }
        head.append(header);
        for (const finding of uniqueFindings(state.findings)) {
          const row = el('tr'), refs = el('td');
          row.append(el('td', readable(finding.severity)), el('td', state.nodeOptions.find(group => group.floorId === finding.floorId)?.floorName || finding.floorId || 'Project'), el('td', findingText(finding)), refs);
          for (const ref of finding.entityRefs || []) {
            const group = state.nodeOptions.find(g => g.floorId === ref.floorId);
            const button = el('button', `${group?.floorName || ref.floorId} · ${group?.entries.find(e => e.entityId === ref.entityId)?.label || 'Related record'}`);
            button.type = 'button'; button.disabled = typeof view.HomePlanner.select !== 'function';
            button.addEventListener('click', () => {
              if (!confirmDiscard()) return;
              try {
                const project = view.HomePlanner.getProject(), target = project.floors.find(f => f.id === ref.floorId);
                const name = collections.find(key => target?.authored?.[key]?.some(r => r.id === ref.entityId));
                if (!target) throw new Error('Related floor is unavailable; inspect the qualified reference.');
                if (project.activeFloorId !== ref.floorId) view.HomePlanner.execute({ type: 'select-floor', id: ref.floorId });
                if (name) controller.select(name, ref.entityId);
                let kind = { serviceNodes: 'serviceNode', serviceRoutes: 'serviceRoute', fixtures: 'fixture' }[name];
                if (!kind) {
                  for (const key of ['structural', 'stairs', 'annotations', 'dimensions'])
                    if (target.authored?.[key]?.some(r => r.id === ref.entityId))
                      kind = { structural: 'structural', stairs: 'stair', annotations: 'annotation', dimensions: 'dimension' }[key];
                  const scene = view.HomePlanner.getScene?.();
                  for (const key of ['walls', 'rooms', 'openings', 'furniture', 'obstacles'])
                    if (scene?.[key]?.some(r => r.id === ref.entityId))
                      kind = { walls: 'wall', rooms: 'room', openings: 'opening', furniture: 'furniture', obstacles: 'obstacle' }[key];
                }
                if (!kind) throw new Error('Related record cannot be selected by this bridge; inspect its qualified reference.');
                view.HomePlanner.select({ kind, id: ref.entityId });
              } catch (cause) { error.textContent = cause.message; error.hidden = false; }
            });
            refs.append(button);
          }
          refs.append(details(finding, 'Technical details — finding and qualified references'));
          body.append(row);
        }
        if (state.stale || !state.findings.length) { const row = el('tr'), cell = el('td', state.stale ? 'Not refreshed / stale. Refresh explicitly; engineering remains NOT ASSESSED.' : 'No selected findings. Engineering remains NOT ASSESSED.'); cell.colSpan = 4; row.append(cell); body.append(row); }
        table.append(el('caption', 'All selected drainage findings, including other-floor and project scope'), head, body); findings.replaceChildren(table);
      } else if (findingsKey !== nextFindings) findings.replaceChildren(...(state.stale ? [el('li', 'Not refreshed / stale. Engineering remains NOT ASSESSED.')]
        : uniqueFindings(state.findings).map(f => {
          const scope = state.nodeOptions.find(group => group.floorId === f.floorId)?.floorName || f.floorId || 'Project';
          const labels = (f.entityIds || []).map(id => Object.values(state.schedule).flat().find(row => row.record.id === id)?.record)
            .filter(Boolean).map(record => record.label || readable(record.kind || 'route'));
          const item = el('li', `${scope}${labels.length ? ` · ${labels.join(', ')}` : ''}: ${findingText(f)}`);
          item.append(details(f)); return item;
        })));
      findingsKey = nextFindings;
      if (priorPreview !== state.preview) {
        if (url) view.URL.revokeObjectURL(url); url = null; priorPreview = state.preview; preview.replaceChildren();
        if (state.preview) {
          try { url = view.URL.createObjectURL(new view.Blob([state.preview.svg], { type: 'image/svg+xml' })); }
          catch (cause) { error.textContent = `Preview could not be displayed: ${cause.message}. Refresh to retry.`; error.hidden = false; return; }
          const image = el('img'); image.src = url;
          image.alt = `${state.floorName} · ${title} ${state.previewSettings.view} · Page ${state.preview.pageIndex + 1} of ${state.preview.pageCount}. Engineering NOT ASSESSED.`;
          image.addEventListener('error', () => {
            if (priorPreview === state.preview) {
              if (url) view.URL.revokeObjectURL(url); url = null;
              preview.replaceChildren(el('p', 'Preview image failed. Refresh to retry.'));
              error.textContent = 'SVG preview could not be displayed. Refresh and review renderer output.'; error.hidden = false;
            }
          });
          preview.append(image);
        } else preview.append(el('p', 'No current preview. Refresh explicitly.'));
      }
    }
    const unsubscribe = controller.subscribe(render), onRoute = () => controller.sync();
    document.addEventListener('homeplanner:workspace-change', onRoute);
    const dispose = controller.dispose;
    controller.dispose = () => {
      unsubscribe(); dispose(); if (url) view.URL.revokeObjectURL(url); url = null;
      document.removeEventListener('homeplanner:workspace-change', onRoute); view.removeEventListener('pagehide', onHide);
      delete host[property]; host.replaceChildren();
    };
    const onHide = event => { if (!event.persisted) controller.dispose(); };
    view.addEventListener('pagehide', onHide);
    if (drainage) host.homePlannerDrainage = controller;
    else host.homePlannerServices = controller;
    render(controller.getState()); return controller;
  }
  return { createController, mount };
});
