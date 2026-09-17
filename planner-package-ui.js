(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerPackageUI = api;
    if (root.document?.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else if (root.document) api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Drafts) {
  'use strict';
  const defaults = () => ({ version: 1, title: '', paper: 'A3', orientation: 'landscape',
    scaleDenominator: 100, units: 'metric', pngDpi: 150 });
  const choices = { paper: ['A4', 'A3', 'A2'], orientation: ['portrait', 'landscape'],
    scaleDenominator: [50, 75, 100], units: ['metric', 'imperial'], pngDpi: [72, 150] };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const identity = project => JSON.stringify([project.id, project.revision]);
  const fileName = (revision, extension, index) =>
    `homeplanner-package-r${Number.isSafeInteger(revision) && revision >= 0 ? revision : 'unknown'}${index === undefined ? '' : `-${index + 1}`}.${extension}`;

  function createController(bridge, runtime = root, document = runtime?.document) {
    if (!bridge?.getProject || !bridge?.getDrawingScene || !bridge?.inputFingerprint)
      throw new Error('Package bridge unavailable. Reload after the planner finishes loading.');
    const listeners = new Set(), sources = new Map();
    let disposed = false, syncing = false, sequence = 0, abort = null, cached = null, pageIndex = 0;
    let project = bridge.getProject(), key = identity(project), fingerprint = bridge.inputFingerprint();
    function normalize(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(name => !Object.hasOwn(defaults(), name)))
        throw new Error('Unknown package setting.');
      for (const [name, allowed] of Object.entries(choices))
        if (!allowed.includes(value[name])) throw new Error(`Unsupported package ${name}.`);
      if (value.version !== 1) throw new Error('Unsupported package settings version.');
      if (typeof value.title !== 'string' || value.title.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value.title))
        throw new Error('Package title must be at most 200 characters, without control characters.');
      return { ...(runtime?.HomePlannerPackage?.normalizeSettings
        ? runtime.HomePlannerPackage.normalizeSettings(value) : value) };
    }
    const readSaved = current => normalize(current.documentation?.package || defaults());
    let saved = readSaved(project), savedPresent = !!project.documentation?.package;
    const drafts = Drafts.createStore(bridge, 'Package settings');
    const draftScope = () => ({ projectId: project.id, entityId: 'package-settings' });
    const savedSignature = () => JSON.stringify([savedPresent, saved]);
    let settingsBase = savedSignature(), settingsConflict = '';
    let settings = { ...saved }, evidence = { airflow: null, light: null };
    let state = { busy: false, error: '', message: 'Refresh preview to assemble a package. No analysis runs here.',
      settingsDirty: false, preview: null, outputs: [], package: null, stale: false, zoom: 'fit' };
    const getState = () => ({ ...state, error: state.error || settingsConflict, settings: { ...settings }, outputs: state.outputs.slice(),
      projectId: project.id, revision: project.revision, projectName: project.name });
    const notify = () => { if (!disposed) listeners.forEach(listener => listener(getState())); };
    function revokeOutputs() {
      for (const output of state.outputs) if (output.url) runtime.URL.revokeObjectURL(output.url);
      state = { ...state, outputs: [] };
    }
    function stop() { sequence++; abort?.abort(); abort = null; }
    function invalidate(message) {
      stop(); revokeOutputs(); cached = null; pageIndex = 0;
      state = { ...state, busy: false, error: '', preview: null, package: null, stale: true, message };
    }
    function reconnect() {
      for (const [name, hostId, alias] of [['airflow', 'workspaceAirflow', 'homePlannerAirflow'],
        ['light', 'workspaceLightStudy', 'homePlannerLight']]) {
        const controller = document?.getElementById(hostId)?.[alias] || null;
        const previous = sources.get(name);
        if (previous?.controller === controller) continue;
        previous?.unsubscribe?.();
        const source = { controller, unsubscribe: null };
        sources.set(name, source);
        source.unsubscribe = controller?.subscribe?.(() => sync()) || null;
      }
    }
    function readEvidence() {
      return { airflow: sources.get('airflow')?.controller?.getState()?.result || null,
        light: sources.get('light')?.controller?.getState()?.result || null };
    }
    function sync() {
      if (disposed || syncing) return false;
      syncing = true;
      let changed = false;
      try {
        reconnect();
        const next = bridge.getProject(), nextKey = identity(next), nextFingerprint = bridge.inputFingerprint();
        const nextSaved = readSaved(next), switched = next.id !== project.id;
        const nextSavedPresent = !!next.documentation?.package;
        const savedChanged = savedPresent !== nextSavedPresent || !same(saved, nextSaved), nextEvidence = readEvidence();
        const evidenceChanged = evidence.airflow !== nextEvidence.airflow || evidence.light !== nextEvidence.light;
        changed = switched || key !== nextKey || fingerprint !== nextFingerprint || evidenceChanged;
        project = next; key = nextKey; fingerprint = nextFingerprint; evidence = nextEvidence;
        if (switched || savedChanged) {
          saved = nextSaved; savedPresent = nextSavedPresent;
          const pending = drafts.get(draftScope());
          settings = { ...(pending?.settings || nextSaved) };
          settingsBase = pending?.base || savedSignature();
          settingsConflict = pending && settingsBase !== savedSignature()
            ? 'Saved package intent changed. Your settings draft is retained; discard/reload settings before applying over the changed record.' : '';
        }
        state = { ...state, settingsDirty: !same(settings, saved) };
        if (changed || savedChanged) {
          invalidate(switched ? 'Project loaded. Its saved settings or session draft restored; refresh preview.'
            : savedChanged ? 'Saved package settings changed (load, undo or redo). Pending drafts retained; otherwise visible settings reloaded. Refresh preview.'
              : evidenceChanged ? 'Analysis evidence changed. Previous files discarded; refresh preview.'
                : 'Project changed. Previous files discarded; refresh preview.');
          changed = true;
        }
      } catch (error) {
        invalidate('Current package inputs could not be verified. Refresh after correcting the project.');
        state = { ...state, error: error.message }; changed = true;
      } finally { syncing = false; }
      if (changed) notify();
      return changed;
    }
    reconnect(); evidence = readEvidence();
    const unsubscribe = bridge.subscribe?.(sync);
    function setSettings(patch) {
      if (disposed) return;
      sync();
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Choose valid package settings.');
      const next = normalize({ ...settings, ...patch });
      if (same(next, settings)) return;
      const dpiOnly = same({ ...next, pngDpi: settings.pngDpi }, settings);
      settings = next; state = { ...state, settingsDirty: !same(settings, saved) };
      if (state.settingsDirty) drafts.put(draftScope(), { settings, base: settingsBase });
      else { drafts.remove(draftScope()); settingsBase = savedSignature(); settingsConflict = ''; }
      if (dpiOnly) {
        stop(); revokeOutputs();
        // Raster intent changes manifest metadata, never physical sheet geometry.
        if (cached?.manifest.settings) {
          cached = Object.freeze({ ...cached, manifest: Object.freeze({ ...cached.manifest,
            settings: Object.freeze({ ...cached.manifest.settings, pngDpi: settings.pngDpi })
          }) });
        }
        state = { ...state, busy: false, error: '',
          package: cached,
          message: 'PNG resolution changed. Sheet geometry is unchanged; prepare new download files.' };
      } else invalidate('Package settings changed. Refresh preview; the design has not been edited.');
      notify();
    }
    function saveSettings() {
      if (disposed) return false;
      sync();
      if (state.error || settingsConflict) return false;
      try {
        const current = bridge.getProject();
        bridge.execute({ type: 'set-documentation', value: {
          ...(current.documentation || { version: 1, views: [], sheets: [] }), package: { ...settings }
        } });
        drafts.remove(draftScope()); settingsConflict = '';
        sync();
        saved = readSaved(bridge.getProject());
        savedPresent = !!bridge.getProject().documentation?.package;
        settingsBase = savedSignature();
        state = { ...state, settingsDirty: !same(settings, saved), error: '',
          message: 'Package settings applied to the project (undoable). Use the global project Save to keep them in browser storage.' };
        notify(); return true;
      } catch (error) {
        state = { ...state, error: error.message, message: 'Package settings were not saved. Correct the settings and try again.' };
        notify(); return false;
      }
    }
    function discardSettingsDraft() {
      sync(); drafts.remove(draftScope()); settings = { ...saved }; settingsBase = savedSignature(); settingsConflict = '';
      state = { ...state, settingsDirty: false };
      invalidate('Settings draft discarded; current project settings restored. Refresh preview.'); notify();
    }
    function ensure(job) {
      sync();
      if (disposed || job.token !== sequence || job.key !== key || job.fingerprint !== fingerprint ||
          job.evidence.airflow !== evidence.airflow || job.evidence.light !== evidence.light)
        throw new Error('Package task cancelled: project, settings or analysis evidence changed.');
    }
    function begin() {
      sync();
      if (disposed) throw new Error('Package controller is disposed.');
      stop(); revokeOutputs();
      abort = runtime?.AbortController ? new runtime.AbortController() : null;
      const job = { token: sequence, key, fingerprint, evidence: { ...evidence }, settings: { ...settings },
        revision: project.revision, projectId: project.id, signal: abort?.signal };
      state = { ...state, busy: true, error: '', message: 'Assembling one captured project revision…' };
      notify(); return job;
    }
    function toSVG(sheet) {
      if (!runtime?.HomePlannerDrawing?.toSVG) throw new Error('Drawing renderer unavailable. Load planner-drawing.js and refresh.');
      const svg = runtime.HomePlannerDrawing.toSVG(sheet);
      if (typeof svg !== 'string' || svg.length > 20 * 1024 * 1024)
        throw new Error('Sheet exceeds the 20 MiB SVG preview limit.');
      return svg;
    }
    function selectedPreview() {
      pageIndex = Math.min(pageIndex, cached.sheets.length - 1);
      const sheet = cached.sheets[pageIndex];
      return { sheet, svg: toSVG(sheet), pageCount: cached.sheets.length, pageIndex };
    }
    function build(job) {
      ensure(job);
      if (!runtime?.HomePlannerPackage?.build)
        throw new Error('Package foundation unavailable. Load planner-package.js and refresh.');
      if (!runtime?.HomePlannerDrawing?.toSVG)
        throw new Error('Drawing renderer unavailable. Load planner-drawing.js and refresh.');
      if (!cached) {
        const scene = bridge.getDrawingScene();
        ensure(job);
        if (scene.projectId !== job.projectId || scene.revision !== job.revision)
          throw new Error('Captured package source does not match the current project revision.');
        const result = runtime.HomePlannerPackage.build(scene, job.settings, job.evidence);
        ensure(job);
        if (!result || result.version !== 1 || !Array.isArray(result.sheets) ||
            !result.sheets.length || result.sheets.length > 100 || !result.manifest ||
            !Array.isArray(result.findings) || !Array.isArray(result.attachments))
          throw new Error('Package foundation returned an invalid package (requires 1–100 sheets).');
        cached = result;
      }
      state = { ...state, package: cached, preview: selectedPreview(), stale: false };
      return cached;
    }
    function fail(job, error) {
      if (!disposed && (!job || job.token === sequence)) {
        revokeOutputs();
        state = { ...state, busy: false, error: error.message,
          message: 'No download files published. Correct the problem and retry; fixed-scale sheets are never shrunk to fit.' };
        notify();
      }
      return null;
    }
    function refresh() {
      let job;
      try {
        job = begin(); build(job); ensure(job);
        state = { ...state, busy: false, message: `${cached.sheets.length} package pages ready. Review findings before sharing.` };
        notify(); return getState();
      } catch (error) { return fail(job, error); }
    }
    async function exportFiles(format) {
      let job;
      try {
        if (!['pdf', 'svg', 'png', 'manifest'].includes(format)) throw new Error('Choose PDF, SVG, PNG or manifest.');
        job = begin();
        const pack = build(job), BlobClass = runtime?.Blob;
        if (!BlobClass) throw new Error('Browser Blob downloads unavailable. Use a supported browser.');
        const outputs = [], add = (content, name, mime) =>
          outputs.push({ blob: content instanceof BlobClass ? content : new BlobClass([content], { type: mime }), fileName: name, mime });
        const exporter = runtime?.HomePlannerDrawingExport;
        if (format === 'pdf') {
          if (!exporter?.pdfBytes) throw new Error('PDF exporter unavailable. Load planner-drawing-export.js and retry.');
          state = { ...state, message: `Encoding PDF · pages 1–${pack.sheets.length} of ${pack.sheets.length}…` }; notify();
          ensure(job);
          const bytes = await exporter.pdfBytes(pack.sheets);
          ensure(job);
          add(bytes, fileName(job.revision, 'pdf'), 'application/pdf');
        } else if (format !== 'manifest') {
          for (let index = 0; index < pack.sheets.length; index++) {
            ensure(job);
            state = { ...state, message: `Encoding ${format.toUpperCase()} · page ${index + 1} of ${pack.sheets.length}…` }; notify();
            ensure(job);
            if (format === 'png') {
              if (!exporter?.pngBlob) throw new Error('PNG exporter unavailable. Load planner-drawing-export.js and retry.');
              const blob = await exporter.pngBlob(pack.sheets[index], { pixelsPerMm: job.settings.pngDpi / 25.4, signal: job.signal });
              ensure(job);
              add(blob, fileName(job.revision, 'png', index), 'image/png');
            } else add(toSVG(pack.sheets[index]), fileName(job.revision, 'svg', index), 'image/svg+xml;charset=utf-8');
          }
        }
        ensure(job);
        add(JSON.stringify(pack.manifest, null, 2), fileName(job.revision, 'manifest.json'), 'application/json');
        for (const attachment of pack.attachments) {
          if (typeof attachment.content !== 'string' || typeof attachment.fileName !== 'string' ||
              typeof attachment.mime !== 'string') throw new Error('Package evidence attachment is invalid.');
          add(attachment.content, attachment.fileName, attachment.mime);
        }
        ensure(job);
        // Publish only the complete set. URL allocation failure is atomic too.
        try {
          for (const output of outputs) {
            ensure(job);
            if (runtime.URL?.createObjectURL) output.url = runtime.URL.createObjectURL(output.blob);
          }
          ensure(job);
        } catch (error) {
          for (const output of outputs) if (output.url) runtime.URL.revokeObjectURL(output.url);
          throw error;
        }
        state = { ...state, outputs: outputs.map(output => Object.freeze(output)), busy: false,
          message: `${outputs.length} files ready. Download each file, including the manifest and available analysis evidence. Nothing was uploaded.` };
        notify();
        return { outputs: state.outputs.slice(), package: pack, isCurrent: () => {
          sync(); return !disposed && job.token === sequence && key === job.key && !state.stale;
        } };
      } catch (error) { return fail(job, error); }
    }
    function setPage(index) {
      if (disposed) return;
      sync();
      if (!cached || !Number.isSafeInteger(index) || index < 0 || index >= cached.sheets.length)
        throw new Error('Choose an available package page.');
      pageIndex = index;
      state = { ...state, preview: selectedPreview() }; notify();
    }
    function setZoom(zoom) {
      if (!['fit', 'full'].includes(zoom)) throw new Error('Choose Fit to width or 100% screen zoom.');
      if (!disposed) { state = { ...state, zoom }; notify(); }
    }
    function cancel() {
      if (disposed) return;
      stop(); revokeOutputs();
      state = { ...state, busy: false, preview: null, error: '',
        message: 'Cancelled. No files published; no further pages will be encoded.' }; notify();
    }
    function openFinding(id) {
      sync();
      try {
        const finding = state.package?.findings.find(item => item.id === id);
        if (!finding) throw new Error('Finding unavailable. Refresh the package first.');
        const routes = { airflow: 'environment/airflow', light: 'environment/light',
          structural: 'design/structure', structure: 'design/structure', plumbing: 'design/plumbing',
          drainage: 'design/drainage', electrical: 'design/electrical', elevation: 'design/elevations',
          elevations: 'design/elevations', section: 'design/elevations' };
        let route = routes[finding.discipline] || 'design/layout';
        const floorId = finding.floorId || project.activeFloorId;
        const floor = project.floors.find(floor => floor.id === floorId);
        if (finding.floorId) {
          if (!floor)
            throw new Error('Finding object unavailable: its floor no longer exists.');
          bridge.execute({ type: 'select-floor', id: finding.floorId });
        }
        if (finding.entityId) {
          if (!bridge.select) throw new Error('Finding object selection is unavailable in the project bridge.');
          const authoredKinds = { structural: 'structural', fixtures: 'fixture', serviceNodes: 'serviceNode',
            serviceRoutes: 'serviceRoute', stairs: 'stair', annotations: 'annotation', dimensions: 'dimension' };
          const authoredCollection = Object.keys(authoredKinds).find(name =>
            floor?.authored?.[name]?.some(record => record.id === finding.entityId));
          let ref = null;
          if (authoredCollection) {
            ref = { kind: authoredKinds[authoredCollection], id: finding.entityId };
            if (authoredCollection === 'structural') {
              const editor = document?.getElementById('workspaceStructure')?.homePlannerStructure;
              if (!editor?.select) throw new Error('Structural workbench unavailable. Reload before opening this source.');
              editor.select(finding.entityId); route = 'design/structure';
            } else if (['fixtures', 'serviceNodes', 'serviceRoutes'].includes(authoredCollection)) {
              const drainage = finding.discipline === 'drainage';
              const editor = document?.getElementById(drainage ? 'workspaceDrainage' : 'workspacePlumbing')
                ?.[drainage ? 'homePlannerDrainage' : 'homePlannerServices'];
              if (!editor?.select) throw new Error('Service workbench unavailable. Reload before opening this source.');
              editor.select(authoredCollection, finding.entityId);
              route = drainage ? 'design/drainage' : 'design/plumbing';
            } else throw new Error(`The ${authoredCollection} source has no routed editor. Its qualified reference is retained; inspect the project JSON rather than selecting a substitute.`);
          }
          const current = bridge.getProject();
          if (!ref && (current.electrical || floor?.electrical || []).some(point => point.id === finding.entityId)) {
            ref = { kind: 'electrical', id: finding.entityId }; route = 'design/electrical';
          }
          const savedView = current.documentation?.views?.find(view => view.id === finding.entityId);
          if (!ref && savedView && ['elevation', 'section'].includes(savedView.kind)) {
            const editor = document?.getElementById('workspaceViews')?.homePlannerViews;
            if (!editor?.select) throw new Error('Saved-view workbench unavailable. Reload before opening this source.');
            editor.select(savedView.id); ref = { kind: 'view', id: savedView.id }; route = 'design/elevations';
          }
          const scene = bridge.getScene?.();
          const collections = [['rooms', 'room'], ['walls', 'wall'], ['furniture', 'furniture'], ['openings', 'opening'], ['obstacles', 'obstacle']];
          for (const [collection, kind] of collections) {
            if (ref) break;
            const entity = scene?.[collection]?.find(item => item.id === finding.entityId);
            if (entity) {
              ref = { kind, id: entity.id };
              if (collection === 'obstacles') {
                const source = current.obstacles?.find(record => record.id === (entity.sourceId || entity.id));
                if (source?.facade) {
                  const editor = document?.getElementById('workspaceFacades')?.homePlannerFacades;
                  if (!editor?.select) throw new Error('Physical facade workbench unavailable. Reload before opening this source.');
                  editor.select(source.id); route = 'design/elevations';
                } else {
                  const edit = [...(document?.querySelectorAll?.('[data-env-obstacle-edit]') || [])]
                    .find(button => button.dataset.envObstacleEdit === source?.id);
                  if (!edit) throw new Error('Nearby-obstacle editor unavailable for this exact source. Review Site → Context; no substitute was selected.');
                  edit.click(); route = 'site/context';
                  if (document.getElementById('env-obstacle-id')?.value !== source.id) return false;
                }
              }
              break;
            }
          }
          if (!ref) throw new Error('Finding object unavailable in the selectable scene. No substitute object was selected.');
          bridge.select(ref);
        }
        runtime?.HomePlannerWorkspace?.navigate?.(route);
        state = { ...state, error: '', message: finding.entityId ? 'Finding object selected on its exact floor.'
          : 'Related workspace opened. This finding has no linked object.' }; notify(); return true;
      } catch (error) {
        state = { ...state, error: error.message }; notify(); return false;
      }
    }
    return { getState, setSettings, saveSettings, discardSettingsDraft, refresh, exportFiles, setPage, setZoom, cancel, sync, openFinding,
      subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
      dispose() {
        if (disposed) return;
        stop(); revokeOutputs(); cached = null;
        state = { ...state, busy: false, preview: null, package: null }; notify();
        disposed = true; unsubscribe?.();
        drafts.dispose();
        for (const source of sources.values()) source.unsubscribe?.();
        sources.clear(); listeners.clear();
      }
    };
  }

  function mount(document = root.document, runtime = document?.defaultView || root) {
    const host = document?.getElementById('workspacePackage');
    if (!host || host.homePlannerPackage) return host?.homePlannerPackage || null;
    const el = (tag, text = '', className = '') => {
      const node = document.createElement(tag); node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    let controller;
    try { controller = createController(runtime?.HomePlanner, runtime, document); }
    catch (error) { host.replaceChildren(el('p', error.message, 'hp-package-error')); return null; }
    host.homePlannerPackage = controller; host.classList.add('hp-package');
    const heading = el('h2', 'Coordinated package');
    const warning = el('p', 'Conceptual reference only. Engineering NOT ASSESSED.', 'hp-package-warning');
    const actions = el('div', '', 'hp-package-actions'), fields = {};
    const status = el('p', '', 'hp-package-status'); status.id = 'hp-package-status'; status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const errorBox = el('p', '', 'hp-package-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
    const attempt = action => { try { action(); } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; } };
    function button(text, id, action, parent = actions) {
      const node = el('button', text); node.type = 'button'; node.id = `hp-package-${id}`;
      node.addEventListener('click', () => attempt(action)); parent.append(node); return node;
    }
    const refreshButton = button('Refresh preview', 'refresh', () => controller.refresh());
    const exportActions = el('div', '', 'hp-package-actions');
    const exportButtons = ['pdf', 'svg', 'png', 'manifest'].map(format =>
      button(`Prepare ${format === 'manifest' ? 'manifest' : format.toUpperCase()}`, `export-${format}`, () => controller.exportFiles(format),
        format === 'pdf' ? actions : exportActions));
    const cancelButton = button('Cancel', 'cancel', () => controller.cancel());
    const previewPanel = el('details', '', 'hp-package-view');
    const previewSummary = el('summary', 'Preview controls');
    const previewControls = el('div', '', 'hp-package-view-controls');
    function select(name, label, values, action, parent) {
      const wrapper = el('label', label), input = el('select'); input.id = `hp-package-${name}`; wrapper.htmlFor = input.id;
      for (const [value, text] of values) { const option = el('option', text); option.value = String(value); input.append(option); }
      input.addEventListener('change', () => attempt(() => action(input.value))); wrapper.append(input); parent.append(wrapper); return input;
    }
    const pageSelect = select('page', 'Preview page', [], value => controller.setPage(Number(value)), previewControls);
    const zoomSelect = select('zoom', 'Screen zoom', [['fit', 'Fit to width'], ['full', '100% (screen only)']],
      value => controller.setZoom(value), previewControls);
    previewPanel.append(previewSummary, previewControls);
    const preview = el('div', '', 'hp-package-preview'); preview.id = 'hp-package-preview'; preview.tabIndex = 0;
    preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', 'Scrollable package sheet preview');
    const outputList = el('ul', '', 'hp-package-outputs');
    const summary = el('p', '', 'hp-package-summary');
    const settingsPanel = el('details', '', 'hp-package-settings'), settingsSummary = el('summary', 'Package & print settings');
    const controls = el('div', '', 'hp-package-controls');
    const titleLabel = el('label', 'Package title'), title = el('input'); title.id = 'hp-package-title';
    title.type = 'text'; title.maxLength = 200; titleLabel.htmlFor = title.id; titleLabel.append(title); controls.append(titleLabel);
    title.addEventListener('input', () => attempt(() => controller.setSettings({ title: title.value }))); fields.title = title;
    for (const [name, label] of [['paper', 'Paper'], ['orientation', 'Orientation'], ['scaleDenominator', 'Fixed scale'],
      ['units', 'Dimension units'], ['pngDpi', 'PNG resolution (raster only)']]) {
      fields[name] = select(name, label, choices[name].map(value => [value,
        name === 'scaleDenominator' ? `1:${value}` : name === 'pngDpi' ? `${value} dpi` : value]),
      value => controller.setSettings({ [name]: ['scaleDenominator', 'pngDpi'].includes(name) ? Number(value) : value }), controls);
    }
    const saveActions = el('div', '', 'hp-package-actions');
    const saveButton = button('Save package settings', 'save-settings', () => controller.saveSettings(), saveActions);
    button('Discard draft / reload settings', 'reload-settings', () => {
      if (!controller.getState().settingsDirty || runtime.confirm('Discard the pending package-settings draft?')) controller.discardSettingsDraft();
    }, saveActions);
    const settingsHelp = el('p', 'Settings are an undoable project change. Use the global project Save to keep them in browser storage. Print at 100% / Actual size, never Fit to page. PNG is capped at 16 million pixels; screen zoom does not alter physical scale.', 'hp-package-help');
    settingsPanel.append(settingsSummary, controls, saveActions, settingsHelp);
    const findingsPanel = el('details', '', 'hp-package-findings'), findingsSummary = el('summary', 'Findings & missing evidence');
    const findingsBody = el('div', '', 'hp-package-table-wrap'); findingsBody.tabIndex = 0;
    findingsBody.setAttribute('role', 'region'); findingsBody.setAttribute('aria-label', 'Package findings');
    findingsPanel.append(findingsSummary, findingsBody);
    host.replaceChildren(heading, warning, actions, status, errorBox, previewPanel, preview, summary,
      exportActions, outputList, settingsPanel, findingsPanel);
    let previewValue, previewURL, outputsValue = [], findingsValue, pageCount = -1;
    function clearPreviewURL() { if (previewURL) runtime.URL.revokeObjectURL(previewURL); previewURL = null; }
    function render(state) {
      host.setAttribute('aria-busy', String(state.busy));
      status.textContent = state.message; errorBox.textContent = state.error; errorBox.hidden = !state.error;
      refreshButton.disabled = state.busy; exportButtons.forEach(node => { node.disabled = state.busy; });
      cancelButton.hidden = !state.busy; cancelButton.disabled = !state.busy;
      saveButton.disabled = state.busy || !state.settingsDirty;
      for (const [name, field] of Object.entries(fields)) {
        if (field.value !== String(state.settings[name])) field.value = String(state.settings[name]);
      }
      settingsSummary.textContent = `Package & print settings · ${state.settings.paper} · 1:${state.settings.scaleDenominator}${state.settingsDirty ? ' · unsaved settings draft' : ''}`;
      zoomSelect.value = state.zoom; preview.dataset.zoom = state.zoom;
      const count = state.preview?.pageCount || 0;
      if (count !== pageCount) {
        pageSelect.replaceChildren(...Array.from({ length: count }, (_, index) => {
          const option = el('option', `Page ${index + 1} of ${count}`); option.value = String(index); return option;
        })); pageCount = count;
      }
      pageSelect.value = String(state.preview?.pageIndex || 0); pageSelect.disabled = count < 2;
      previewSummary.textContent = count
        ? `Preview controls · Page ${(state.preview?.pageIndex || 0) + 1} / ${count}`
        : 'Preview controls';
      summary.textContent = state.package
        ? `${state.package.sheets.length} pages · ${state.package.findings.length} findings · ${state.package.attachments.length} evidence attachments · Revision ${state.revision}`
        : 'No package built. Refresh explicitly; missing analysis stays unavailable.';
      if (previewValue !== state.preview) {
        clearPreviewURL(); previewValue = state.preview; preview.replaceChildren();
        if (state.preview) {
          try {
            previewURL = runtime.URL.createObjectURL(new runtime.Blob([state.preview.svg], { type: 'image/svg+xml' }));
            const image = el('img'); image.src = previewURL;
            image.alt = `Package page ${state.preview.pageIndex + 1} of ${count} · conceptual reference`;
            image.addEventListener('error', () => {
              if (previewValue === state.preview) { errorBox.textContent = 'Sheet preview could not be displayed. Refresh and retry.'; errorBox.hidden = false; }
            });
            preview.append(image);
          } catch (error) { errorBox.textContent = `Preview unavailable: ${error.message}`; errorBox.hidden = false; }
        } else preview.append(el('p', state.stale ? 'Package is stale. Refresh preview to use current evidence.' : 'Refresh preview to inspect the coordinated sheets.'));
      }
      if (outputsValue.length !== state.outputs.length || outputsValue.some((value, index) => value !== state.outputs[index])) {
        outputsValue = state.outputs; outputList.replaceChildren();
        for (const output of state.outputs) {
          const item = el('li'), link = el('a', `Download ${output.fileName}`);
          link.href = output.url || ''; link.download = output.fileName;
          link.addEventListener('click', event => {
            controller.sync();
            if (!output.url || !controller.getState().outputs.includes(output)) event.preventDefault();
          });
          item.append(link); outputList.append(item);
        }
      }
      if (findingsValue !== state.package?.findings) {
        findingsValue = state.package?.findings; findingsBody.replaceChildren();
        findingsSummary.textContent = `Findings & missing evidence · ${findingsValue?.length || 0}`;
        if (!findingsValue?.length) findingsBody.append(el('p', state.package ? 'No findings returned.' : 'Build a package to inspect findings.'));
        else {
          const table = el('table'), head = el('thead'), header = el('tr'), body = el('tbody');
          for (const text of ['Discipline / severity', 'Finding', 'Source']) { const th = el('th', text); th.scope = 'col'; header.append(th); }
          head.append(header);
          for (const finding of findingsValue) {
            const row = el('tr'), source = el('td');
            button('Open source', `finding-${body.children.length}`, () => controller.openFinding(finding.id), source);
            row.append(el('td', `${finding.discipline || 'Package'} · ${finding.severity || 'info'}`),
              el('td', `${finding.code || ''}${finding.code ? '\n' : ''}${finding.message || ''}`), source);
            body.append(row);
          }
          table.append(head, body); findingsBody.append(table);
        }
      }
    }
    const unsubscribeRender = controller.subscribe(render);
    const onRoute = () => controller.sync();
    document.addEventListener?.('homeplanner:workspace-change', onRoute);
    const originalDispose = controller.dispose;
    controller.dispose = () => {
      originalDispose(); clearPreviewURL(); unsubscribeRender();
      document.removeEventListener?.('homeplanner:workspace-change', onRoute);
      runtime?.removeEventListener?.('pagehide', controller.dispose);
      delete host.homePlannerPackage;
    };
    runtime?.addEventListener?.('pagehide', controller.dispose, { once: true });
    render(controller.getState());
    return controller;
  }
  return Object.freeze({ createController, mount });
});
