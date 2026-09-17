(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerDrawingUI = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const defaults = () => ({
    discipline: 'architectural', serviceView: 'plan', plumbingSystem: 'both', drainageView: 'plan', drainageSystem: 'both', scope: 'current', floorId: '', viewId: '', paper: 'A3', orientation: 'landscape',
    scaleDenominator: 100, units: 'metric', title: '', pageIndex: 0, pngDpi: 150,
    layers: { furniture: true, fixtures: true, dimensions: true, site: true }
  });
  const choices = {
    discipline: ['architectural', 'structural', 'views', 'plumbing', 'drainage'], serviceView: ['plan', 'riser'],
    drainageView: ['plan', 'profile'], drainageSystem: ['both', 'sanitary', 'storm'],
    plumbingSystem: ['both', 'water', 'waste'], scope: ['current', 'all'], paper: ['A4', 'A3', 'A2'],
    orientation: ['portrait', 'landscape'], scaleDenominator: [50, 75, 100],
    units: ['metric', 'imperial'], pngDpi: [72, 150]
  };
  const MAX_PAGES = 100;
  const identity = project => `${project.id}\n${project.revision}`;
  function fileName(name, floorName, revision, extension, pageIndex) {
    const clean = value => {
      let text = String(value ?? 'HomePlanner').normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, '-')
        .replace(/^\.+/, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(text)) text = `HomePlanner-${text}`;
      return Array.from(text || 'HomePlanner').slice(0, 80).join('');
    };
    return `${clean(name)}-${clean(floorName)}${pageIndex === undefined ? '' : `-page-${pageIndex + 1}`}-r${clean(revision)}.drawing.${extension}`;
  }

  function createController(planner, runtime = root) {
    if (!planner?.getProject || !planner?.getDrawingScene || !planner?.inputFingerprint)
      throw new Error('Drawing foundation unavailable. Reload after planner scripts finish loading.');
    const listeners = new Set(), preferences = new Map();
    let project = planner.getProject(), key = identity(project), activeFloorId = project.activeFloorId;
    let fingerprint = planner.inputFingerprint();
    let settings = defaults(), sequence = 0, disposed = false, previewPages = null;
    let state = { busy: false, message: 'Refresh preview to build a reference sheet.', error: '', stale: false, preview: null, outputs: [] };
    const savedViews = () => (project.documentation?.views || []).filter(item => ['elevation', 'section'].includes(item.kind));
    function currentSettings() {
      if (settings.discipline === 'views') {
        if (!settings.viewId) {
          settings.viewId = savedViews()[0]?.id || ''; settings.pageIndex = 0;
        }
      } else if ((settings.scope === 'current' && settings.floorId !== project.activeFloorId) ||
          !project.floors.some(floor => floor.id === settings.floorId)) {
        settings.floorId = project.activeFloorId; settings.pageIndex = 0;
      }
      return { ...settings, layers: { ...settings.layers } };
    }
    function getState() {
      return { ...state, settings: currentSettings(), projectId: project.id, revision: project.revision,
        projectName: project.name, views: savedViews().map(item => ({ ...item })),
        floors: project.floors.map(floor => ({ id: floor.id, name: floor.name })) };
    }
    const notify = () => { if (!disposed) listeners.forEach(fn => fn(getState())); };
    function invalidate(message) {
      sequence++;
      previewPages = null;
      state = { busy: false, message, error: '', stale: true, preview: null, outputs: [] };
      notify();
    }
    function sync() {
      const next = planner.getProject(), nextKey = identity(next);
      // The bridge caches its frozen document until it changes. Fingerprint only
      // new snapshots; canonical inputs ignore selection and active-floor aliases.
      const nextFingerprint = next === project ? fingerprint : planner.inputFingerprint();
      const changed = key !== nextKey || fingerprint !== nextFingerprint, navigated = activeFloorId !== next.activeFloorId;
      if (next.id !== project.id) {
        preferences.set(project.id, currentSettings());
        settings = preferences.get(next.id) || defaults();
      }
      project = next; key = nextKey; fingerprint = nextFingerprint; activeFloorId = next.activeFloorId;
      if (changed || (navigated && settings.scope === 'current' && settings.discipline !== 'views'))
        invalidate('Project or current floor changed. Previous outputs were discarded; refresh the preview.');
      return changed;
    }
    const unsubscribe = planner.subscribe?.(sync);
    function setSettings(patch) {
      sync();
      for (const [name, value] of Object.entries(patch)) {
        if (choices[name] && !choices[name].includes(value)) throw new Error(`Unsupported drawing ${name}.`);
        if (!choices[name] && !['floorId', 'viewId', 'title', 'layers', 'pageIndex'].includes(name)) throw new Error('Unknown drawing setting.');
        if (name === 'viewId' && !savedViews().some(item => item.id === value)) throw new Error('Saved view unavailable. Go to Design → Elevations / sections to create a view.');
        if (name === 'pageIndex' && (!Number.isSafeInteger(value) || value < 0))
          throw new Error('Preview page must be a nonnegative integer.');
        if (name === 'title' && (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)))
          throw new Error('Sheet title must be at most 200 characters, without control characters.');
        if (name === 'floorId' && !project.floors.some(floor => floor.id === value)) throw new Error('Floor no longer exists.');
        if (name === 'layers' && (!value || Object.entries(value).some(([layer, enabled]) =>
          !Object.hasOwn(settings.layers, layer) || typeof enabled !== 'boolean'))) throw new Error('Invalid drawing layers.');
      }
      const pageOnly = Object.keys(patch).length === 1 && Object.hasOwn(patch, 'pageIndex');
      const resolutionOnly = Object.keys(patch).length === 1 && Object.hasOwn(patch, 'pngDpi');
      settings = { ...settings, ...patch, layers: { ...settings.layers, ...(patch.layers || {}) } };
      if (resolutionOnly) { notify(); return; }
      if (!pageOnly) settings.pageIndex = 0;
      if (pageOnly && previewPages) {
        state = { ...state, error: '' };
        try {
          state = { ...state, stale: false, preview: selectedPreview(),
            message: state.busy ? state.message : 'Preview page changed. Prepared downloads retained; engineering not assessed.' };
          notify();
        } catch (error) { fail({ token: sequence }, error); }
      } else invalidate('Drawing settings changed. Refresh preview; geometry has not been edited.');
    }
    function openViews(viewId) {
      sync();
      const requested = typeof viewId === 'string' && viewId ? viewId : settings.viewId;
      if (settings.discipline !== 'views' || (requested && requested !== settings.viewId) ||
          (viewId && settings.scope !== 'current')) {
        settings = { ...settings, discipline: 'views', viewId: requested,
          ...(viewId ? { scope: 'current' } : {}), pageIndex: 0 };
        invalidate('Saved views selected. Refresh explicitly to build a preview; no analysis or export was started.');
      }
      if (requested && !savedViews().some(item => item.id === requested)) {
        invalidate('The requested saved view is unavailable. Choose an existing saved view or create one in Design → Elevations / sections.');
        state = { ...state, error: 'Saved view unavailable or deleted. Select an existing view before refreshing or exporting.' };
        notify(); return false;
      }
      return true;
    }
    function cancel() {
      if (disposed || !state.busy) return;
      sequence++;
      state = { ...state, busy: false, outputs: [], error: '',
        message: 'Export cancelled. No files published; any in-progress encoding may finish, but no later pages will start.' };
      notify();
    }
    function ensureCurrent(token, capturedKey) {
      sync();
      if (disposed || token !== sequence || capturedKey !== key) throw new Error('Drawing task cancelled: project or settings changed.');
    }
    function renderer(discipline) {
      const drawing = runtime.HomePlannerDrawing;
      if (!drawing?.createSheet || !drawing?.toSVG || !drawing?.validateSheet)
        throw new Error('Drawing renderer unavailable or still loading. Check planner-drawing.js, then refresh preview.');
      if (discipline === 'views') {
        const elevation = runtime.HomePlannerElevation;
        if (!elevation?.createSheets || !elevation?.toSVG)
          throw new Error('Elevation/section renderer unavailable. Load planner-elevation.js and refresh.');
        return { createSheets: elevation.createSheets.bind(elevation), toSVG: elevation.toSVG.bind(elevation),
          validateSheet: drawing.validateSheet.bind(drawing) };
      }
      if (discipline === 'plumbing') {
        const plumbing = runtime.HomePlannerServicesDrawing;
        if (!plumbing?.createSheets)
          throw new Error('Plumbing drawing renderer unavailable. Load planner-services-drawing.js and refresh.');
        return { createSheets: plumbing.createSheets.bind(plumbing),
          toSVG: (plumbing.toSVG || drawing.toSVG).bind(plumbing.toSVG ? plumbing : drawing),
          validateSheet: drawing.validateSheet.bind(drawing) };
      }
      if (discipline === 'drainage') {
        const drainage = runtime.HomePlannerDrainageDrawing;
        if (!drainage?.createSheets)
          throw new Error('Drainage drawing renderer unavailable. Load planner-drainage-drawing.js and refresh.');
        return { createSheets: drainage.createSheets.bind(drainage),
          toSVG: (drainage.toSVG || drawing.toSVG).bind(drainage.toSVG ? drainage : drawing),
          validateSheet: drawing.validateSheet.bind(drawing) };
      }
      if (discipline === 'structural') {
        const structure = runtime.HomePlannerStructureDrawing;
        if (!structure?.createSheet)
          throw new Error('Structural drawing renderer unavailable or still loading. Check planner-structure-drawing.js, then refresh preview.');
        return {
          createSheet: structure.createSheet.bind(structure),
          createSheets: typeof structure.createSheets === 'function' ? structure.createSheets.bind(structure) : undefined,
          validateSheet: drawing.validateSheet.bind(drawing),
          toSVG: (structure.toSVG || drawing.toSVG).bind(structure.toSVG ? structure : drawing)
        };
      }
      return drawing;
    }
    function begin() {
      sync();
      const token = ++sequence, capturedKey = key, options = currentSettings();
      state = { ...state, busy: true, error: '', stale: false, outputs: [], message: 'Building sheets from one project revision…' };
      notify();
      return { token, capturedKey, options };
    }
    function capture(job) {
      const drawing = renderer(job.options.discipline), scene = planner.getDrawingScene();
      ensureCurrent(job.token, job.capturedKey);
      if (scene.projectId !== project.id || scene.revision !== project.revision)
        throw new Error('Drawing snapshot does not match the current project revision.');
      return { drawing, scene };
    }
    function sheetsFor(capture, targetId, options) {
      const saved = options.discipline === 'views'
        ? capture.scene.documentation?.views?.find(item => item.id === targetId && ['elevation', 'section'].includes(item.kind)) : null;
      if (options.discipline === 'views' && !saved)
        throw new Error('No saved elevation/section view selected. Go to Design → Elevations / sections to create a view.');
      const floorId = saved ? saved.floorId : targetId;
      const floor = project.floors.find(item => item.id === floorId);
      if (!floor) throw new Error('Selected floor is unavailable.');
      const sheetOptions = saved ? {
        viewId: saved.id, floorName: floor.name, paper: options.paper, orientation: options.orientation,
        scaleDenominator: saved.scaleDenominator ?? options.scaleDenominator, units: options.units,
        ...(options.title.trim() ? { title: options.title.trim() } : {})
      } : {
        floorId, floorName: floor.name, paper: options.paper, orientation: options.orientation,
        scaleDenominator: options.scaleDenominator, units: options.units,
        title: options.title.trim() || project.name || 'HomePlanner reference plan', layers: options.layers
      };
      if (options.discipline === 'plumbing') {
        delete sheetOptions.layers;
        sheetOptions.view = options.serviceView;
        sheetOptions.systems = options.plumbingSystem === 'both' ? ['water', 'waste'] : [options.plumbingSystem];
      }
      if (options.discipline === 'drainage') {
        delete sheetOptions.layers;
        delete sheetOptions.title;
        sheetOptions.view = options.drainageView;
        sheetOptions.systems = options.drainageSystem === 'both' ? ['waste', 'rain']
          : [options.drainageSystem === 'sanitary' ? 'waste' : 'rain'];
      }
      const sheets = typeof capture.drawing.createSheets === 'function'
        ? capture.drawing.createSheets(capture.scene, sheetOptions)
        : [capture.drawing.createSheet(capture.scene, sheetOptions)];
      if (!Array.isArray(sheets) || !sheets.length) throw new Error('Renderer must return a nonempty array of sheets.');
      if (sheets.length > MAX_PAGES) throw new Error('Drawing exceeds the 100-page limit. Select fewer views/floors or reduce schedule content.');
      for (const sheet of sheets) {
        const validation = capture.drawing.validateSheet(sheet);
        if (validation === false || validation?.valid === false)
          throw new Error('Sheet validation failed. Review geometry, paper and fixed scale.');
      }
      return sheets;
    }
    function targets(options) {
      if (options.discipline !== 'views')
        return options.scope === 'all' ? project.floors.map(item => item.id) : [options.floorId];
      if (!savedViews().length)
        throw new Error('No saved elevation/section views. Go to Design → Elevations / sections to create a view.');
      if (options.scope !== 'all' && !savedViews().some(item => item.id === options.viewId))
        throw new Error('Saved view unavailable or deleted. Select an existing view before refreshing or exporting.');
      return options.scope === 'all' ? savedViews().map(item => item.id) : [options.viewId];
    }
    function collectPages(targetIds, build) {
      if (targetIds.length > MAX_PAGES) throw new Error('Drawing exceeds the 100-page limit. Select fewer views/floors.');
      const pages = [];
      for (const id of targetIds) {
        const next = build(id);
        if (pages.length + next.length > MAX_PAGES)
          throw new Error('Drawing exceeds the 100-page limit. Select fewer views/floors or reduce schedule content.');
        pages.push(...next);
      }
      return pages;
    }
    function selectedPreview() {
      const { sheets, drawing } = previewPages;
      settings.pageIndex = Math.min(settings.pageIndex, sheets.length - 1);
      const sheet = sheets[settings.pageIndex], svg = drawing.toSVG(sheet);
      if (typeof svg !== 'string' || svg.length > 20 * 1024 * 1024) throw new Error('SVG preview is invalid or exceeds the 20 MiB preview limit.');
      return { sheet, svg, pageCount: sheets.length, pageIndex: settings.pageIndex };
    }
    function fail(job, error) {
      if (job.token === sequence && !disposed) {
        previewPages = null;
        state = { ...state, busy: false, preview: null, outputs: [], error: error.message || String(error),
          message: 'No output created. Review the error and try again. Fixed scale is never shrunk automatically.' };
        notify();
      }
      return null;
    }
    function refresh() {
      const job = begin();
      try {
        const viewTargets = job.options.discipline === 'views' ? targets(job.options) : null;
        const captured = capture(job), sheets = viewTargets
          ? collectPages(viewTargets, id => sheetsFor(captured, id, job.options))
          : sheetsFor(captured, job.options.floorId, job.options);
        previewPages = { sheets, drawing: captured.drawing };
        const preview = selectedPreview();
        ensureCurrent(job.token, job.capturedKey);
        state = { ...state, busy: false, preview, message: 'Preview ready. Reference drawing only; print at 100% / Actual size.' };
        notify();
        return state.preview;
      } catch (error) { return fail(job, error); }
    }
    async function exportFiles(format) {
      const job = begin();
      try {
        if (!['pdf', 'svg', 'png'].includes(format)) throw new Error('Unsupported export format.');
        const floors = targets(job.options);
        const captured = capture(job);
        const isViews = job.options.discipline === 'views';
        const downloadName = job.options.discipline !== 'architectural' ? `${project.name || 'HomePlanner'}-${job.options.discipline}` : project.name;
        if (!floors.length) throw new Error('No floors are available for export.');
        const pages = collectPages(floors, floorId => {
          const sheets = sheetsFor(captured, floorId, job.options);
          const saved = isViews ? savedViews().find(item => item.id === floorId) : null;
          const label = saved ? `${saved.name} (${saved.id})` : null;
          return sheets.map((sheet, pageIndex) => ({ sheet, pageIndex, pageCount: sheets.length,
            label: label || sheet.metadata.floorName,
            fileLabel: saved ? `view-${savedViews().findIndex(item => item.id === saved.id) + 1}-${label}` : sheet.metadata.floorName }));
        });
        const sheets = pages.map(page => page.sheet);
        const exporter = runtime.HomePlannerDrawingExport;
        if (format !== 'svg' && typeof exporter?.[format === 'pdf' ? 'pdfBytes' : 'pngBlob'] !== 'function')
          throw new Error(`${format.toUpperCase()} exporter unavailable or still loading. Check planner-drawing-export.js and retry.`);
        const outputs = [];
        if (format === 'pdf') {
          const bytes = await exporter.pdfBytes(sheets);
          ensureCurrent(job.token, job.capturedKey);
          outputs.push({ name: fileName(downloadName, job.options.scope === 'all' ? (isViews ? 'all-views' : 'all-floors') : pages[0].fileLabel, project.revision, format),
            blob: new runtime.Blob([bytes], { type: 'application/pdf' }), label: `PDF · ${sheets.length} page(s)` });
        } else {
          for (let index = 0; index < sheets.length; index++) {
            ensureCurrent(job.token, job.capturedKey);
            state = { ...state, message: `Preparing ${format.toUpperCase()} ${index + 1} of ${sheets.length}…` }; notify();
            const { sheet, pageIndex, pageCount, label, fileLabel } = pages[index];
            const blob = format === 'svg'
              ? new runtime.Blob([captured.drawing.toSVG(sheet)], { type: 'image/svg+xml;charset=utf-8' })
              : await exporter.pngBlob(sheet, { pixelsPerMm: job.options.pngDpi / 25.4, maxPixels: 16000000 });
            ensureCurrent(job.token, job.capturedKey);
            outputs.push({ name: fileName(downloadName, `${index + 1}-${fileLabel}`, project.revision, format,
              pageCount > 1 ? pageIndex : undefined),
              blob, label: `${label} · Page ${pageIndex + 1} of ${pageCount} · ${format.toUpperCase()}${format === 'png' ? ` · ${job.options.pngDpi} dpi` : ''}` });
          }
        }
        ensureCurrent(job.token, job.capturedKey);
        state = { ...state, busy: false, outputs, message: format === 'pdf'
          ? 'PDF ready. Download requested; keep the link below if your browser blocks it.'
          : outputs.length === 1 ? 'File ready. Download requested; keep the link below if your browser blocks it.'
            : `${outputs.length} file(s) ready. Choose each ${isViews ? 'saved-view' : 'floor'} link (one per page) below to download; no automatic multi-downloads.` };
        notify();
        return { outputs, isCurrent: () => {
          try { ensureCurrent(job.token, job.capturedKey); return true; } catch (_) { return false; }
        } };
      } catch (error) { return fail(job, error); }
    }
    return { getState, setSettings, refresh, exportFiles, sync, cancel, openViews,
      isCurrent: () => { sync(); return !disposed && !state.stale && !state.error; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      dispose() { disposed = true; sequence++; previewPages = null; unsubscribe?.(); listeners.clear(); preferences.clear(); }
    };
  }

  function mount(document = root.document) {
    const host = document?.getElementById('workspaceDrawings');
    if (!host || host.homePlannerDrawings) return host?.homePlannerDrawings || null;
    const view = document.defaultView || root;
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    let controller;
    try { controller = createController(view.HomePlanner, view); }
    catch (error) { host.replaceChildren(el('p', error.message)); return null; }
    host.classList.add('hp-drawings');
    const heading = el('h2', 'Drawing sheets');
    const note = el('p', 'Architectural, structural, plumbing, drainage or saved elevation/section reference sheets, not engineered or certified drawings. Structural, plumbing and drainage engineering are always NOT ASSESSED. Report settings are view-only for this browser session; saved views are authored separately in Design.', 'hp-drawing-help');
    const controls = el('div', '', 'hp-drawing-controls'), fields = {};
    const primaryControls = el('div', '', 'hp-drawing-toolbar');
    const printSettings = el('details', '', 'hp-drawing-print-settings'), printSummary = el('summary');
    function field(name, label, values, target = controls) {
      const wrapper = el('label', label), input = el('select');
      input.id = `hp-drawing-${name}`; wrapper.htmlFor = input.id;
      values.forEach(([value, text]) => { const option = el('option', text); option.value = value; input.append(option); });
      wrapper.append(input); target.append(wrapper); fields[name] = input;
      input.addEventListener('change', () => update({ [name]: ['scaleDenominator', 'pageIndex', 'pngDpi'].includes(name) ? Number(input.value) : input.value }));
      return input;
    }
    function update(patch) {
      try {
        controller.setSettings(patch);
        if (!Object.hasOwn(patch, 'pageIndex') && !Object.hasOwn(patch, 'pngDpi') &&
            !['views', 'plumbing', 'drainage'].includes(controller.getState().settings.discipline)) controller.refresh();
      }
      catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
    }
    field('discipline', 'Drawing discipline', [['architectural', 'Architectural'], ['structural', 'Structural · engineering not assessed'], ['views', 'Elevations / sections'], ['plumbing', 'Plumbing · engineering NOT ASSESSED'], ['drainage', 'Drainage · engineering NOT ASSESSED']], primaryControls);
    field('serviceView', 'Plumbing view', [['plan', 'Plan'], ['riser', 'Riser']]);
    const serviceViewLabel = controls.children[controls.children.length - 1];
    field('plumbingSystem', 'Plumbing systems (analysis filter only)', [['both', 'Water and waste'], ['water', 'Water'], ['waste', 'Waste']]);
    const plumbingSystemLabel = controls.children[controls.children.length - 1];
    field('drainageView', 'Drainage view', [['plan', 'Plan'], ['profile', 'Profile']]);
    const drainageViewLabel = controls.children[controls.children.length - 1];
    field('drainageSystem', 'Drainage systems (review filter only)', [['both', 'Sanitary and storm'], ['sanitary', 'Sanitary'], ['storm', 'Storm']]);
    const drainageSystemLabel = controls.children[controls.children.length - 1];
    field('scope', 'Sheets to export', [['current', 'Current active floor'], ['all', 'All project floors']]);
    field('floorId', 'Preview floor', []);
    const floorLabel = controls.children[controls.children.length - 1];
    field('viewId', 'Saved view', []);
    const viewLabel = controls.children[controls.children.length - 1];
    const pageSelect = field('pageIndex', 'Preview page', []);
    const pageLabel = controls.children[controls.children.length - 1];
    field('paper', 'Paper', ['A4', 'A3', 'A2'].map(value => [value, value]));
    field('orientation', 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']]);
    field('scaleDenominator', 'Fixed scale', [50, 75, 100].map(value => [value, `1:${value}`]));
    field('units', 'Dimension units', [['metric', 'Metric'], ['imperial', 'Feet & inches']]);
    field('pngDpi', 'PNG resolution (raster only)', [[72, '72 dpi · fast screen review'], [150, '150 dpi · print review (default)']]);
    const titleLabel = el('label', 'Sheet title (view-only)'), title = el('input');
    title.type = 'text'; title.id = 'hp-drawing-title'; title.maxLength = 200;
    titleLabel.htmlFor = title.id; titleLabel.append(title); controls.append(titleLabel); fields.title = title;
    title.addEventListener('input', () => {
      try { controller.setSettings({ title: title.value }); } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
    });
    title.addEventListener('change', () => { if (!['views', 'plumbing', 'drainage'].includes(controller.getState().settings.discipline)) controller.refresh(); });
    const layers = el('fieldset', '', 'hp-drawing-layers'); layers.append(el('legend', 'Sheet layers'));
    const layerFields = {};
    for (const name of ['furniture', 'fixtures', 'dimensions', 'site']) {
      const label = el('label'), checkbox = el('input'); checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => update({ layers: { [name]: checkbox.checked } }));
      label.append(checkbox, document.createTextNode(name[0].toUpperCase() + name.slice(1)));
      layers.append(label); layerFields[name] = checkbox;
    }
    const revision = el('p', '', 'hp-drawing-help'), actions = el('div', '', 'hp-drawing-actions');
    const refresh = el('button', 'Refresh preview'); refresh.type = 'button';
    refresh.addEventListener('click', () => controller.refresh()); primaryControls.append(refresh);
    const exportButtons = [];
    for (const format of ['pdf', 'svg', 'png']) {
      const button = el('button', `Download ${format.toUpperCase()}`);
      button.type = 'button'; button.dataset.drawingExport = format; exportButtons.push(button);
      button.addEventListener('click', async () => {
        const result = await controller.exportFiles(format);
        if (result?.outputs.length === 1 && result.isCurrent()) outputList.querySelector('a')?.click();
      });
      actions.append(button);
    }
    const cancel = el('button', 'Cancel export'); cancel.type = 'button'; cancel.id = 'hp-drawing-cancel';
    cancel.addEventListener('click', () => controller.cancel()); primaryControls.append(cancel);
    const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const errorBox = el('p', '', 'hp-drawing-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
    const outputList = el('ul', '', 'hp-drawing-outputs'), preview = el('div', '', 'hp-drawing-preview');
    preview.tabIndex = 0; preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', 'Scrollable vector sheet preview');
    preview.dataset.zoom = 'fit';
    const zoomLabel = el('label', 'View zoom (screen only)'), zoom = el('select');
    zoom.id = 'hp-drawing-zoom'; zoomLabel.htmlFor = zoom.id;
    for (const [value, label] of [['fit', 'Fit to width'], ['full', 'Full resolution (intrinsic size)']]) {
      const option = el('option', label); option.value = value; zoom.append(option);
    }
    zoom.value = 'fit'; zoom.addEventListener('change', () => { preview.dataset.zoom = zoom.value; });
    zoomLabel.append(zoom); controls.append(zoomLabel);
    const assumptions = el('ul', '', 'hp-drawing-assumptions');
    const viewHelp = el('p', '', 'hp-drawing-help');
    const viewLink = el('a', 'Create or edit saved views in Design → Elevations / sections');
    viewLink.href = '?workspace=design&section=elevations';
    viewLink.dataset.workspace = 'design'; viewLink.dataset.section = 'elevations';
    printSettings.append(printSummary, controls, viewHelp, viewLink, layers);
    const warning = el('p', 'Conceptual only. Engineering NOT ASSESSED.', 'hp-drawing-help');
    host.replaceChildren(heading, warning, primaryControls, printSettings, errorBox, preview, status, actions, outputList, revision, note, assumptions);
    let previewValue, outputsValue, floorKey, viewKey, pageKey, previewURL;
    const outputURLs = new Set();
    function clearOutputs() { for (const url of outputURLs) view.URL.revokeObjectURL(url); outputURLs.clear(); outputList.replaceChildren(); }
    function render(state) {
      host.setAttribute('aria-busy', String(state.busy));
      status.textContent = state.message; errorBox.textContent = state.error; errorBox.hidden = !state.error;
      revision.textContent = `Project: ${state.projectName || state.projectId} · Revision ${state.revision} · ${state.settings.discipline} · ${state.settings.paper}, ${state.settings.orientation}, 1:${state.settings.scaleDenominator}. Print at 100% / Actual size; do not “Fit to page”. PNG: ${state.settings.pngDpi} dpi, maximum 16 million pixels. View zoom affects the screen only, not sheet scale or exports.`;
      const isViews = state.settings.discipline === 'views';
      const isPlumbing = state.settings.discipline === 'plumbing';
      const isDrainage = state.settings.discipline === 'drainage';
      const drawingView = isViews ? 'Saved views' : isPlumbing ? state.settings.serviceView : isDrainage ? state.settings.drainageView : 'Plan';
      printSummary.textContent = `View & print settings · ${drawingView} · ${state.settings.scope === 'all' ? 'All' : 'Current'} · ${state.settings.paper} ${state.settings.orientation} · ${isViews ? 'saved scales / fallback ' : ''}1:${state.settings.scaleDenominator} · ${state.settings.units}`;
      drainageViewLabel.hidden = !isDrainage; drainageSystemLabel.hidden = !isDrainage;
      titleLabel.hidden = isDrainage;
      serviceViewLabel.hidden = !isPlumbing; plumbingSystemLabel.hidden = !isPlumbing;
      floorLabel.hidden = isViews; viewLabel.hidden = !isViews; layers.hidden = isViews || isPlumbing || isDrainage;
      viewHelp.hidden = !isViews; viewLink.hidden = !isViews;
      fields.scope.children[0].textContent = isViews ? 'Selected view' : 'Current active floor';
      fields.scope.children[1].textContent = isViews ? 'All saved elevation/section views' : 'All project floors';
      fields.viewId.disabled = state.settings.scope === 'all' || !state.views.length;
      const saved = state.views.find(item => item.id === state.settings.viewId);
      viewHelp.textContent = !state.views.length ? 'No saved views. Create a named elevation or section in Design first; no plan fallback is generated.'
        : state.settings.scope === 'all' ? `Each saved view’s scale is authoritative; only unknown scales use the Report fallback 1:${state.settings.scaleDenominator}. All views render once in saved order, not once per floor. Refresh explicitly.`
          : saved?.scaleDenominator != null ? `Saved scale 1:${saved.scaleDenominator} overrides Report fallback 1:${state.settings.scaleDenominator}; the renderer receives 1:${saved.scaleDenominator}.`
            : `Saved scale is unknown. Explicit Report fallback 1:${state.settings.scaleDenominator} will be used.`;
      if (isViews) revision.textContent = `Project: ${state.projectName || state.projectId} · Revision ${state.revision} · Elevations / sections · ${state.settings.paper}, ${state.settings.orientation}. Scale: saved per view; Report fallback 1:${state.settings.scaleDenominator}. Print at 100% / Actual size. PNG: ${state.settings.pngDpi} dpi, maximum 16 million pixels. View zoom affects the screen only, not sheet scale or exports.`;
      const nextViewKey = JSON.stringify([state.views, state.settings.viewId]);
      if (nextViewKey !== viewKey) {
        fields.viewId.replaceChildren(...state.views.map(item => {
          const option = el('option', `${item.name} · ${item.kind} · ${item.floorId}`); option.value = item.id; return option;
        })); viewKey = nextViewKey;
        if (state.settings.viewId && !saved) {
          const missing = el('option', 'Saved view unavailable — choose another view');
          missing.value = state.settings.viewId; missing.disabled = true; fields.viewId.append(missing);
        }
      }
      const nextFloorKey = JSON.stringify(state.floors);
      if (nextFloorKey !== floorKey) {
        fields.floorId.replaceChildren(...state.floors.map(floor => {
          const option = el('option', floor.name); option.value = floor.id; return option;
        })); floorKey = nextFloorKey;
      }
      const pageCount = state.preview?.pageCount || 0;
      pageLabel.hidden = pageCount <= 1; pageSelect.disabled = pageCount <= 1;
      const nextPageKey = JSON.stringify([isViews ? 'views' : state.preview?.sheet.metadata.floorName, pageCount]);
      if (pageKey !== nextPageKey) {
        pageSelect.replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
          const option = el('option', `${isViews ? 'Saved views' : state.preview.sheet.metadata.floorName} · Page ${index + 1} of ${pageCount}`);
          option.value = String(index); return option;
        })); pageKey = nextPageKey;
      }
      for (const [name, input] of Object.entries(fields)) if (input.value !== String(state.settings[name])) input.value = state.settings[name];
      title.placeholder = state.projectName || 'HomePlanner reference plan';
      fields.floorId.disabled = state.settings.scope === 'current';
      for (const [name, input] of Object.entries(layerFields)) input.checked = state.settings.layers[name];
      refresh.disabled = state.busy; exportButtons.forEach(button => { button.disabled = state.busy; });
      cancel.hidden = !state.busy; cancel.disabled = !state.busy;
      fields.pngDpi.disabled = state.busy;
      if (previewValue !== state.preview) {
        if (previewURL) view.URL.revokeObjectURL(previewURL);
        previewURL = null; previewValue = state.preview; preview.replaceChildren(); assumptions.replaceChildren();
        if (state.preview) {
          previewURL = view.URL.createObjectURL(new view.Blob([state.preview.svg], { type: 'image/svg+xml' }));
          const image = el('img'); image.src = previewURL;
          image.alt = `${isViews ? state.preview.sheet.metadata.title : state.preview.sheet.metadata.floorName} · Page ${state.preview.pageIndex + 1} of ${state.preview.pageCount} · reference drawing at 1:${state.preview.sheet.metadata.scaleDenominator}`;
          image.addEventListener('error', () => {
            if (previewValue !== state.preview) return;
            errorBox.textContent = 'The SVG preview could not be displayed. Check renderer output and refresh.'; errorBox.hidden = false;
          });
          preview.append(image);
          for (const text of state.preview.sheet.metadata.assumptions || []) assumptions.append(el('li', text));
        } else preview.append(el('p', state.stale ? 'Preview is stale. Refresh to use the current project and settings.' : 'No sheet preview available.'));
      }
      if (outputsValue !== state.outputs) {
        clearOutputs(); outputsValue = state.outputs;
        for (const output of state.outputs) {
          const url = view.URL.createObjectURL(output.blob); outputURLs.add(url);
          const item = el('li'), link = el('a', `Download ${output.label}`); link.href = url; link.download = output.name;
          link.addEventListener('click', event => { if (!controller.isCurrent()) event.preventDefault(); });
          item.append(link); outputList.append(item);
        }
      }
    }
    const unsubscribe = controller.subscribe(render);
    const onRoute = () => {
      if (document.body.dataset.workspace === 'report' && document.body.dataset.workspaceSection === 'drawings' &&
          !['views', 'plumbing', 'drainage'].includes(controller.getState().settings.discipline) && !controller.getState().preview && !controller.getState().busy) controller.refresh();
    };
    document.addEventListener('homeplanner:workspace-change', onRoute);
    // Capture runs before the workspace router's bubbling handler, including for
    // authoring links added after this panel was mounted.
    const onDrawingLink = event => {
      if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[data-drawing-discipline]');
      if (['plumbing', 'drainage'].includes(link?.dataset.drawingDiscipline) && link.dataset.workspace === 'report' && link.dataset.section === 'drawings') {
        controller.setSettings({ discipline: link.dataset.drawingDiscipline });
        return;
      }
      if (link?.dataset.drawingDiscipline === 'views' && link.dataset.workspace === 'report' && link.dataset.section === 'drawings') {
        let viewId = link.dataset.drawingViewId;
        if (!viewId && link.dataset.drawingUseActiveView === 'true' && !controller.getState().settings.viewId)
          viewId = document.getElementById('workspaceViews')?.homePlannerViews?.getState().selectedId;
        controller.openViews(viewId);
      }
    };
    document.addEventListener('click', onDrawingLink, true);
    const disposeController = controller.dispose;
    const dispose = () => {
      unsubscribe(); disposeController(); clearOutputs();
      if (previewURL) view.URL.revokeObjectURL(previewURL);
      previewURL = null;
      document.removeEventListener('homeplanner:workspace-change', onRoute);
      document.removeEventListener('click', onDrawingLink, true);
      view.removeEventListener('pagehide', onHide);
      delete host.homePlannerDrawings; host.replaceChildren();
    };
    const onHide = event => { if (!event.persisted) dispose(); };
    controller.dispose = dispose;
    view.addEventListener('pagehide', onHide);
    host.homePlannerDrawings = controller;
    if (view.location?.href) {
      const params = new URL(view.location.href).searchParams;
      if (params.get('workspace') === 'report' && params.get('section') === 'drawings' && params.get('discipline') === 'views')
        controller.openViews(params.get('viewId') || undefined);
      if (params.get('workspace') === 'report' && params.get('section') === 'drawings' && ['plumbing', 'drainage'].includes(params.get('discipline')))
        controller.setSettings({ discipline: params.get('discipline') });
    }
    render(controller.getState()); onRoute();
    return controller;
  }
  return { defaults, fileName, createController, mount };
});
