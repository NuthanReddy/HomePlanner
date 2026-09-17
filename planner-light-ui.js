(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerLightUI = api;
    if (root.document?.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(root.document), { once: true });
    else api.mount(root.document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const SIDES = ['front', 'right', 'rear', 'left'];
  const LIMITS = Object.freeze({ importCharacters: 1000000, exportBytes: 20 * 1024 * 1024,
    scenarios: 24, history: 12, intervals: 2048 });
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const canonical = value => JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const refKey = ref => JSON.stringify([ref?.floorId, ref?.entityId]);
  function numeric(value) {
    if (value === null || value === '' || typeof value === 'string' && !value.trim()) return null;
    if (!['string', 'number'].includes(typeof value) ||
        typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
      throw new TypeError('Enter a complete decimal number. Blank means unknown, not zero.');
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Enter a finite decimal number.');
    return number;
  }
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function sensorCSV(result) {
    const rows = [
      ['Room light evidence', 'Not lux, daylight factor, adequacy, irradiation or artificial photometry'],
      ['status', result.status], ['context', result.context?.status],
      ['config', result.config], ['provenance', result.provenance], [],
      ['sensor ID', 'floor ID', 'room ID', 'x (site-local m)', 'y (site-local m)', 'z (site-local m)',
        'area weight (m²)', 'sky access (dimensionless 0–1)', 'positive-path presence (h)',
        'transmitted-equivalent sun (h)', 'modeled sky access (dimensionless 0–1)',
        'modeled processed positive-path presence (h)', 'modeled processed transmitted-equivalent sun (h)']
    ];
    for (const sensor of result.sensors || []) {
      const sky = result.sky?.sensorResults?.find(row => row.sensorId === sensor.id) || {};
      const sun = result.direct?.sensorResults?.find(row => row.sensorId === sensor.id) || {};
      rows.push([sensor.id, sensor.room?.floorId, sensor.room?.entityId, sensor.point?.x, sensor.point?.y,
        sensor.point?.z, sensor.areaWeightM2, sky.cosineWeightedSkyAccess, sun.positivePathPresenceHours,
        sun.transmittedEquivalentSunHours, sky.modeledCosineWeightedSkyAccess,
        sun.modeledProcessedPositivePathPresenceHours, sun.modeledProcessedTransmittedEquivalentSunHours]);
    }
    rows.push([], ['finding code', 'reference', 'severity', 'message']);
    for (const finding of result.findings || [])
      rows.push([finding.code, finding.reference, finding.severity, finding.message]);
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function prepareIntervals(sun, selection, site) {
    if (!sun?.resolveLocal || !sun?.position)
      throw new Error('Sun helpers unavailable. Load the bundled SunCalc and HomeSun with position and resolveLocal exports.');
    if (!Number.isFinite(site?.latitudeDeg) || Math.abs(site.latitudeDeg) > 90 ||
        !Number.isFinite(site?.longitudeDeg) || Math.abs(site.longitudeDeg) > 180 || !site?.timeZone)
      throw new Error('Supply and confirm latitude, longitude and IANA time zone; unknown coordinates are not zero.');
    const stride = numeric(selection.strideMinutes);
    if (stride === null || !Number.isInteger(stride) || stride < 1 || stride > 1440)
      throw new Error('Interval stride must be an integer from 1 to 1440 minutes (a computational setting).');
    const start = sun.resolveLocal(selection.date, selection.startTime, site.timeZone, selection.startOccurrence).instant.getTime();
    const end = sun.resolveLocal(selection.endDate || selection.date, selection.endTime, site.timeZone, selection.endOccurrence).instant.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new Error('End must be after start in UTC. Choose an explicit end date for an overnight study.');
    if (Math.ceil((end - start) / (stride * 60000)) > LIMITS.intervals)
      throw new Error(`At most ${LIMITS.intervals} intervals. Shorten the period or increase the stride.`);
    const iso = value => new Date(value).toISOString(), samples = [];
    for (let t = start; t < end; t += stride * 60000) {
      const stop = Math.min(t + stride * 60000, end), middle = (t + stop) / 2;
      const position = sun.position(new Date(middle), site.latitudeDeg, site.longitudeDeg);
      samples.push({ startUTC: iso(t), endUTC: iso(stop), sampleUTC: iso(middle),
        sunENU: copy(position.vector) });
    }
    return { period: { startUTC: iso(start), endUTC: iso(end) }, samples };
  }
  function setupRequirements(config) {
    const items = [], missing = value => value === null || value === undefined;
    const add = (id, section, message) => items.push({ id, section, message });
    if (!config.workplanes?.length)
      add('rooms', 'rooms', 'Select at least one room and add its workplane.');
    else if (config.workplanes.some(plane => missing(plane.heightM)))
      add('height', 'rooms', 'Enter the workplane height above the floor for every selected room.');
    if (config.direct?.enabled !== false && (!config.period?.startUTC || !config.period?.endUTC))
      add('period', 'sun', 'Choose the study location, date and start/end times, then click Prepare sun intervals.');
    else if (config.direct?.enabled !== false && !config.samples?.length)
      add('samples', 'sun', 'No sun intervals are prepared. Click Prepare sun intervals after reviewing the study times.');
    if (!config.windowOptics?.mode)
      add('optics', 'optics', 'Choose a Window optical model: ideal-clear geometry or sourced visible transmittance.');
    else if (config.windowOptics.mode === 'visible-transmission' &&
        (missing(config.windowOptics.visibleTransmittance) || !config.windowOptics.source))
      add('transmission', 'optics', 'Supply the visible transmittance and its source for the selected optical model.');
    if (config.direct?.enabled !== false && missing(config.minSunAltitudeDeg))
      add('horizon', 'optics', 'Enter the near-horizon cutoff in degrees (greater than 0 and less than 90). Directions below it remain unresolved.');
    return items;
  }
  function readingNotes(state) {
    const notes = new Set();
    const roomNames = new Map((state.inventory?.rooms || []).map(room => [refKey(room.ref), room.label || room.ref.entityId]));
    const floorNames = new Map((state.floors || []).map(floor => [floor.id, floor.name || floor.id]));
    for (const item of [...(state.inventory?.findings || []), ...(state.result?.findings || [])]) {
      if (item.code === 'missing-control' && state.setupRequirements.length) continue;
      if (item.code === 'unknown-neighbors') continue;
      const messages = {
        'missing-control': 'Some study inputs are still missing. Review the input groups; the exact fields are listed in Technical details.',
        'missing-workplanes': 'Add a room and enter the height of the surface you want to study.',
        'unsupplied-roof': 'Roof dimensions are not supplied. Review Roof context; a missing roof is not an open sky.',
        'unmodeled-interstorey-gap': 'The space between floors is not fully described. Light passing through that gap is only an estimate from the supplied geometry.',
        'missing-physical-floors': 'No floor geometry is ready. Create or repair the floor plan in Design, then prepare inventory again.',
        'unresolved-physical-floor': 'A floor could not be read. Review its layout and dimensions in Design before running a whole-building study.',
        'missing-room-reference': 'A selected room no longer matches the layout. Remove that workplane and select the current room again.',
        'workplane-outside-supported-height': 'The study surface is above the room walls. Check its height above the floor.',
        'unknown-workplane-height-extent': 'The room height is missing, so the study surface cannot be checked. Supply the wall height in Design.',
        'roof-context-conflict': 'This floor already has a roof in the model. Do not mark it as having no roof; review the actual geometry.',
        'missing-roof-geometry': 'The roof is marked as supplied, but its dimensions are missing. Add the dimensions or leave its context unknown.',
        'missing-roof-floor': 'A roof declaration refers to a floor that is no longer available. Review the roof input list.',
        'missing-neighbor-box': 'A side marked as a neighboring building needs a matching building box with dimensions.',
        'unreferenced-neighbor-box': 'A neighboring building box has not been assigned to a side. Choose the side it belongs to.',
        'conflicting-physical-obstacle': 'Two descriptions of the same obstruction disagree. Check their dimensions and transmission; neither is chosen automatically.',
        'ambiguous-physical-obstacle': 'Two obstructions may describe the same building. Review duplicate boxes before calculating.',
        'reused-project-obstacle': 'A neighboring box matches an existing obstruction. Its shading is counted only once.',
        'missing-sun-vector': 'A prepared sun direction is missing. Prepare sun intervals again.',
        'stale-physical-input': 'The layout changed after this study was prepared. Prepare inventory and run again.',
        'unresolved-openings': 'Some doors or windows are not attached to valid walls. Repair them in Design before running.',
        'missing-opening-host': 'A door or window has lost its wall. Repair its placement in Design.'
      };
      let message = messages[item.code];
      if (!message && item.code?.startsWith('missing-wall-')) message = 'A wall is missing dimensions or placement. Review the wall in Design.';
      if (!message && item.code?.startsWith('missing-opening-')) message = 'A door or window is missing dimensions or placement. Review its opening settings in Design.';
      if (!message && item.code?.startsWith('missing-obstacle-')) message = 'An obstruction is missing dimensions or height. Review the building box in the site or facade settings.';
      message ||= item.message || 'A model detail needs review. See Technical details for the source record.';
      const reference = item.reference;
      const label = reference && typeof reference === 'object'
        ? roomNames.get(refKey(reference)) || floorNames.get(reference.floorId) : null;
      notes.add(label ? `${label}: ${message}` : message);
    }
    return [...notes];
  }
  function evidenceRows(state) {
    const view = state.preview, metric = state.visualization.metric;
    const valueTitle = { direct: 'Sun path transmission (0–1)', sky: 'Sky access (0–1)',
      'presence-hours': 'Sun path present (hours)', 'equivalent-hours': 'Transmission-weighted sun (hours)' }[metric];
    const rooms = new Map((view?.roomRows || []).map(room => [refKey(room.roomRef), room.label || room.id]));
    const floors = new Map(state.floors.map(floor => [floor.id, floor.name || floor.id]));
    const column = state.visualization.modeled ? 'modeled' : 'primary';
    return {
      sensors: (view?.sensorRows || []).filter(row => row.inScope).map(row => ({
        'Map point': row.shortKey, Room: rooms.get(refKey(row.roomRef)) || row.roomRef.entityId,
        [valueTitle]: row.selectedValue,
        Meaning: row.selectedValue === null ? 'Not available for this view' : row.selectedValue === 0 ? 'Calculated zero' : 'Calculated',
        'Floor height of point (m)': row.point.z, 'Sampled area (m²)': row.areaWeightM2
      })),
      rooms: (view?.roomRows || []).filter(row => row.inScope).map(row => ({
        Room: row.label || row.id, Floor: floors.get(row.floorId) || row.floorId,
        [`Average ${valueTitle}`]: row[column]?.[metric] ?? null,
        'Study points': row.sensorCount, 'Points without a value': row.unknownSensorCount
      })),
      electrical: (view?.electricalRows || []).filter(row => row.inScope).map(row => ({
        'Map point': row.shortKey, Device: row.record.label || row.record.type || row.record.id,
        Floor: floors.get(row.floorId) || row.floorId,
        'Mounting height (m)': row.heightM,
        'On this map': row.markerVisible ? 'Yes' : 'No — position not supplied or unresolved',
        'Calculated illumination': 'Not supported'
      }))
    };
  }
  function describeDisplay({ inventory, result, preview, previewError, error, busy, floorId, visualization, draft }) {
    const status = (code, message) => ({ code, message });
    if (busy) return status('running', 'Calculating the workplane grid. Previous light cells are cleared until this run is verified.');
    if (previewError) return status('unavailable', previewError);
    if (!inventory && error) return status('unavailable', error);
    if (!inventory) return status('not-prepared', 'Analyze whole house to map sky access across every room. Custom surfaces and time-based sunlight studies are optional.');
    if (!inventory.rooms.length) return status('empty', 'No rooms are available to study. Add and place rooms in Design → Layout, then prepare inventory again.');
    const requirements = setupRequirements(draft);
    if (requirements.length && (!result || result.status === 'blocked'))
      return status(result ? 'blocked' : 'setup-required',
        `Complete ${requirements.length} study ${requirements.length === 1 ? 'setting' : 'settings'} before running. Review study inputs shows what is needed and why.`);
    if (!result) return status('not-run', draft.workplanes?.length
      ? 'No current light result. Supply workplane heights, optics and the horizon cutoff; prepare sun intervals and review roof/neighbor context, then Run study.'
      : 'Inventory only — select a room under Study inputs → Select rooms & workplanes. Room outlines are not a light calculation.');
    if (result.status === 'blocked') return status('blocked',
      'The model needs attention before light can be calculated. Open Read the map & review missing information for the next steps.');
    const rows = (preview?.sensorRows || []).filter(row => row.inScope);
    if (!rows.length) return status('other-floor', 'No sampled workplanes on this display floor. Choose a studied floor under View & session study; neither the project floor nor analytical room selection is changed.');
    const mask = result.direct.masks.find(item => item.sampleIndex === visualization.intervalIndex);
    if (result.direct.status === 'disabled' && visualization.metric !== 'sky')
      return status('disabled', 'This is a sky-access calculation, independent of date and time. Choose Sky access, or start a custom sunlight study for hourly results.');
    if (visualization.metric === 'direct') {
      if (!mask) return status('unprocessed', 'The selected interval has no committed result. Prepare sun intervals and run again, or choose an already calculated interval. Missing is not zero.');
      if (mask.directSunStatus === 'night')
        return status('night', 'Night: zero direct sun is expected for this interval. Choose a daytime interval, or the independent sky-access metric; night does not make geometric sky access zero.');
      if (mask.directSunStatus === 'near-horizon-unresolved')
        return status('unresolved', 'Direct light is unresolved within the configured near-horizon cutoff, not zero shade. Choose another interval or inspect sky access; the cutoff has not been relaxed.');
    }
    if (visualization.metric === 'sky' && result.sky.status === 'disabled')
      return status('disabled', 'Sky access was disabled for this run, not calculated as zero. Enable time-independent sky access under Study inputs and run again.');
    const unknown = rows.filter(row => row.selectedValue === null).length;
    if (unknown && !visualization.modeled && result.context.status === 'unknown-context')
      return status('unknown-context', 'Primary light evidence is unavailable where physical context is unknown. Review neighbor and roof declarations, or explicitly select “Show modeled-only evidence” to inspect only the supplied model. Hatch marks are not zero light.');
    if (unknown) return status('incomplete', `${unknown} of ${rows.length} cells are unavailable for this metric. Review interval coverage and warnings; partial evidence is not a complete-period result.`);
    const scope = visualization.modeled ? 'Supplied model only (not verified context)' : 'Supplied-model primary evidence';
    if (rows.every(row => row.selectedValue === 0))
      return status('zero-light', `${scope}: all selected cells have a known zero value. No positive ${visualization.metric === 'sky' ? 'sky access' : 'direct-light path'} was found for this view. Review openings/context or choose another metric or interval.`);
    return status('result', `${scope}: ${rows.filter(row => row.selectedValue > 0).length} of ${rows.length} workplane cells have positive values. The grid and evidence tables show the selected metric, not lux or illumination adequacy.`);
  }
  function createController(bridge, runtime = root, document = runtime.document) {
    if (!bridge?.getProject || !bridge?.getDrawingScene)
      throw new Error('Light studies need the project bridge with getProject() and getDrawingScene().');
    const foundation = () => {
      if (!runtime.HomePlannerLight?.normalizeConfig || !runtime.HomePlannerLight?.discover)
        throw new Error('Load building-physics.js, planner-projection.js and planner-light.js to edit light inputs.');
      return runtime.HomePlannerLight;
    };
    let project = bridge.getProject(), inventory = null, result = null, preview = null, runner = null;
    let busy = false, disposed = false, generation = 0, serial = 0, error = '', previewError = '';
    let message = 'Analyze all rooms using the current house geometry. No room selection needed.';
    let progress = null, floorId = project.activeFloorId, rejectCancelled = null, timeout = null;
    let visualization = { metric: 'direct', intervalIndex: 0, modeled: false, showElectrical: false };
    const projects = new Map(), listeners = new Set(), nextId = prefix => `${prefix}-${++serial}`;
    const blankSelection = () => ({ date: '', endDate: '', startTime: '', endTime: '',
      startOccurrence: '', endOccurrence: '', strideMinutes: 30 });
    const newDraft = label => ({ version: 1, id: nextId('light'), label, workplanes: [],
      sky: { enabled: true, radialBands: 16, azimuthSectors: 64 }, windowOptics: { mode: null },
      minSunAltitudeDeg: null, neighbors: Object.fromEntries(SIDES.map(side => [side, { state: 'unknown' }])),
      neighborBoxes: [], roofContext: [], period: null, samples: [] });
    function entry(value = newDraft('Study 1')) {
      return { config: value, selection: blankSelection(), intervalSource: 'unprepared',
        siteSource: 'Unknown — no project or browser location applied' };
    }
    function session() {
      if (!projects.has(project.id)) {
        const item = entry();
        projects.set(project.id, { selected: item.config.id, drafts: new Map([[item.config.id, item]]), history: [], baseline: null });
      }
      return projects.get(project.id);
    }
    const current = () => session().drafts.get(session().selected), draft = () => current().config;
    session();
    const notify = () => { if (!disposed) listeners.forEach(listener => listener(getState())); };
    function publish(stale = !result) {
      const doc = document, EventClass = runtime.CustomEvent || doc?.defaultView?.CustomEvent || root.CustomEvent;
      if (doc?.dispatchEvent && EventClass)
        doc.dispatchEvent(new EventClass('homeplanner:light-result', {
          detail: { result: stale ? null : result, visualization: { ...visualization }, stale }
        }));
    }
    function cancelWork() {
      generation++;
      if (timeout !== null) (runtime.clearTimeout || root.clearTimeout)(timeout);
      timeout = null;
      if (rejectCancelled) rejectCancelled(new Error('Cancelled.'));
      rejectCancelled = null;
      if (busy) { try { runner?.cancel(); } catch (_) { /* Generation guard revokes publication. */ } }
      busy = false; progress = null;
    }
    function invalidate(text) {
      cancelWork(); result = null; preview = null; error = ''; previewError = '';
      if (text) message = text;
      publish(true);
    }
    function boundedVisualization() {
      const count = result?.direct?.masks?.length || draft().samples?.length || 0;
      visualization.intervalIndex = Math.max(0, Math.min(visualization.intervalIndex, Math.max(0, count - 1)));
    }
    function buildPreview() {
      preview = null; previewError = '';
      if (!inventory) return;
      const display = runtime.HomePlannerLightDisplay;
      if (!display?.createView || !display?.createInventoryView) {
        previewError = 'Plan renderer unavailable. Load planner-light-display.js; native inputs remain editable.';
        return;
      }
      try {
        boundedVisualization();
        const displayFloorId = inventory.floors.length ? floorId : null;
        preview = result && result.status !== 'blocked' ? display.createView(result, { floorId: displayFloorId, ...visualization })
          : display.createInventoryView(inventory, { floorId: displayFloorId, showElectrical: visualization.showElectrical });
      } catch (cause) { previewError = `Plan preview unavailable: ${cause.message}`; }
    }
    function adopt(nextProject, nextInventory = null) {
      const switched = nextProject.id !== project.id;
      const changed = !switched && inventory && nextInventory &&
        inventory.physicalFingerprint !== nextInventory.physicalFingerprint;
      const navigated = nextProject.activeFloorId !== project.activeFloorId;
      if (switched || changed) invalidate(switched ? 'Project changed. Select and run a session study explicitly.'
        : 'Physical inputs changed. Previous evidence is stale; run again.');
      project = nextProject; session();
      if (switched) inventory = null;
      else if (nextInventory) inventory = nextInventory;
      if (switched || navigated || !(project.floors || []).some(floor => floor.id === floorId))
        floorId = project.activeFloorId;
      if (changed || navigated) buildPreview();
    }
    function capture() {
      try {
        const nextProject = bridge.getProject(), scene = freeze(copy(bridge.getDrawingScene()));
        const nextInventory = foundation().discover(scene);
        if (nextInventory.projectId !== nextProject.id) throw new Error('Drawing scene and project IDs disagree.');
        adopt(nextProject, nextInventory); inventory = nextInventory;
        return { scene, inventory };
      } catch (cause) {
        invalidate('Physical inputs could not be verified. Previous evidence revoked.');
        inventory = null; error = cause.message || String(cause); notify(); throw cause;
      }
    }
    function sync() {
      if (disposed) return false;
      try {
        if (bridge.getProject().id !== project.id) adopt(bridge.getProject());
        else if (inventory || busy || result) capture();
        else adopt(bridge.getProject());
        notify(); return true;
      } catch (cause) { error = cause.message; notify(); return false; }
    }
    const unsubscribe = bridge.subscribe?.(sync);
    function getState() {
      const data = session();
      return { projectId: project.id, revision: project.revision, floorId,
        floors: (project.floors || []).map(floor => ({ id: floor.id, name: floor.name })),
        selectedScenarioId: data.selected,
        scenarios: [...data.drafts].map(([id, item]) => ({ id, label: item.config.label || id })),
        draft: copy(draft()), selection: copy(current().selection), intervalSource: current().intervalSource,
        siteSource: current().siteSource, visualization: { ...visualization }, inventory, result, preview,
        busy, error, previewError, message, progress, setupRequirements: setupRequirements(draft()),
        displayStatus: describeDisplay({ inventory, result, preview, previewError, error, busy, floorId, visualization, draft: draft() }),
        history: data.history.map(item => ({ id: item.id, label: item.result.config.label || item.id, status: item.result.status })),
        baselineId: data.baseline?.id || null,
        comparison: data.baseline && result ? foundation().compare(data.baseline.result, result) : null };
    }
    function attempt(action) {
      try {
        if (disposed) throw new Error('Light workbench is disposed.');
        if (bridge.getProject().id !== project.id) adopt(bridge.getProject());
        const value = action(); error = ''; notify(); return value;
      } catch (cause) { error = cause.message || String(cause); notify(); return null; }
    }
    function replace(value) {
      const normalized = foundation().normalizeConfig(value);
      if (canonical(normalized) !== canonical(draft())) {
        invalidate('Study inputs changed. Run explicitly to update evidence.');
        current().config = normalized; boundedVisualization(); buildPreview();
      }
      return copy(normalized);
    }
    const edit = action => attempt(() => { const value = copy(draft()); action(value); return replace(value); });
    function selectScenario(id) {
      return attempt(() => {
        if (!session().drafts.has(id)) throw new Error('Choose an existing session study.');
        if (session().selected !== id) {
          invalidate('Study selected. Run explicitly.'); session().selected = id; boundedVisualization(); buildPreview();
        }
        return true;
      });
    }
    async function run() {
      let token;
      try {
        if (disposed) throw new Error('Light workbench is disposed.');
        invalidate('Running a light study in a worker…');
        const captured = capture(), config = foundation().normalizeConfig(draft());
        const configKey = canonical(config), projectId = project.id;
        if (!runtime.HomePlannerLightRunner?.createRunner)
          throw new Error('Light worker unavailable. Load planner-light-runner.js and enable Workers. No main-thread fallback.');
        runner ||= runtime.HomePlannerLightRunner.createRunner(runtime);
        token = ++generation; busy = true; buildPreview(); notify();
        const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
        const timedOut = new Promise((_, reject) => {
          timeout = (runtime.setTimeout || root.setTimeout)(() => {
            try { runner.cancel(); } catch (_) { /* Reject below. */ }
            reject(new Error('Light worker timed out. Reduce the study size and run again.'));
          }, 120000);
        });
        const work = new Promise((resolve, reject) => {
          try {
            resolve(runner.run({ scene: captured.scene, config,
              expectedPhysicalFingerprint: captured.inventory.physicalFingerprint }, update => {
              if (disposed || token !== generation) return;
              progress = freeze(copy(update)); notify();
            }));
          } catch (cause) { reject(cause); }
        });
        const output = await Promise.race([work, cancelled, timedOut]);
        if (disposed || token !== generation) return null;
        if (timeout !== null) (runtime.clearTimeout || root.clearTimeout)(timeout);
        timeout = null; rejectCancelled = null;
        const latest = capture();
        if (token !== generation || project.id !== projectId || canonical(draft()) !== configKey ||
            latest.inventory.physicalFingerprint !== captured.inventory.physicalFingerprint) { notify(); return null; }
        if (output?.kind !== 'RoomLightStudy' || output.provenance?.projectId !== projectId ||
            output.provenance?.scenePhysicalFingerprint !== captured.inventory.physicalFingerprint ||
            canonical(output.config) !== configKey)
          throw new Error('Worker snapshot does not match the current physical scene and study. Discarded.');
        const serialized = JSON.stringify(output);
        if (serialized.length > LIMITS.exportBytes) throw new Error('Result exceeds the workbench output budget.');
        result = freeze(JSON.parse(serialized)); busy = false; progress = result.progress;
        const history = session().history;
        history.push({ id: nextId('snapshot'), result }); if (history.length > LIMITS.history) history.shift();
        message = result.complete ? 'Computation complete for the supplied model. Not an illumination-adequacy assessment.'
          : result.computationalComplete
            ? 'Computation complete; evidence remains incomplete. Unknown context is not clear sky or zero light.'
            : `${result.status}: review the missing inputs and findings below.`;
        if (config.direct?.enabled === false && result.computationalComplete) {
          const floors = new Set(config.workplanes.map(plane => plane.room.floorId)).size;
          message = `Sky access calculated for ${config.workplanes.length} rooms across ${floors} ${floors === 1 ? 'floor' : 'floors'}. Showing supplied geometry only; unrecorded surroundings are not included.`;
        }
        boundedVisualization(); buildPreview(); publish(false); notify(); return result;
      } catch (cause) {
        if (token !== undefined && (disposed || token !== generation)) return null;
        cancelWork(); result = null; error = cause.message || String(cause);
        message = 'No current result. Correct inputs or worker availability and run again.';
        buildPreview(); publish(true); notify(); return null;
      }
    }
    function changeSelection(patch) {
      return attempt(() => {
        const selection = { ...current().selection, ...patch };
        if (canonical(selection) !== canonical(current().selection)) {
          const value = copy(draft()); value.period = null; value.samples = [];
          replace(value); current().selection = selection; current().intervalSource = 'unprepared';
          invalidate('Date/time selections changed. Prepare sun intervals, then run again.');
          buildPreview();
        }
        return copy(selection);
      });
    }
    function changeSite(patch, source) {
      return attempt(() => {
        const value = copy(draft()); value.site = { ...value.site, ...patch };
        value.period = null; value.samples = [];
        const updated = replace(value); current().intervalSource = 'unprepared';
        current().siteSource = source || 'Explicit study coordinates — confirm against the actual site';
        return updated;
      });
    }
    const api = {
      getState, sync, run, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      runWholeHouse() {
        const ready = attempt(() => {
          capture();
          if (!inventory.rooms.length) throw new Error('No rooms are available. Add or repair the house layout in Design, then analyze again.');
          const data = session(), existing = data.drafts.get(data.wholeHouseId);
          if (!existing && data.drafts.size >= LIMITS.scenarios)
            throw new Error('The saved-study limit is reached. Remove an unused custom study before adding the whole-house view.');
          const config = {
            ...newDraft('Whole house · floor-level sky access'),
            ...(existing ? { id: existing.config.id } : {}),
            direct: { enabled: false }, period: null, samples: [], minSunAltitudeDeg: null,
            workplanes: inventory.rooms.map(room => ({
              id: JSON.stringify(['whole-house-floor', room.ref.floorId, room.ref.entityId]),
              room: copy(room.ref), heightM: 0, spacingM: .5
            })),
            windowOptics: { mode: 'ideal-clear' }
          };
          const normalized = foundation().normalizeConfig(config);
          invalidate('Preparing all rooms for a floor-level sky-access calculation.');
          const item = entry(normalized);
          item.intervalSource = 'Sky access only — independent of sun position and time';
          item.siteSource = 'Current house geometry; no geographic location needed for sky access';
          data.drafts.set(normalized.id, item); data.selected = normalized.id; data.wholeHouseId = normalized.id;
          visualization = { ...visualization, metric: 'sky', intervalIndex: 0, modeled: true };
          buildPreview(); return true;
        });
        return ready ? run() : Promise.resolve(null);
      },
      prepare() { return attempt(() => {
        capture(); message = inventory.rooms.length
          ? `${inventory.rooms.length} rooms found. Inventory only — review Study inputs below; no analysis or missing physical dimensions invented.`
          : 'No room geometry found. Add and place rooms in Design → Layout, then prepare again; no light analysis was run.';
        buildPreview(); return inventory;
      }); },
      cancel() { invalidate('Cancelled. No new result published.'); buildPreview(); notify(); },
      clearResult() {
        invalidate('Result cleared. Study inputs and inventory are retained; Run study to recalculate.');
        buildPreview(); notify();
      },
      setDraft(patch) { return edit(value => {
        const siteChanged = Object.prototype.hasOwnProperty.call(patch, 'site') &&
          canonical(value.site) !== canonical(patch.site);
        Object.assign(value, patch);
        if (siteChanged) { value.period = null; value.samples = []; }
      }); },
      replaceDraft(value) { return attempt(() => replace(value)); },
      setSelection: changeSelection, setSite: changeSite,
      useProjectSite() { return attempt(() => {
        const site = bridge.getProject().site || {}, value = {};
        if (typeof site.latitude === 'number' && Number.isFinite(site.latitude)) value.latitudeDeg = site.latitude;
        if (typeof site.longitude === 'number' && Number.isFinite(site.longitude)) value.longitudeDeg = site.longitude;
        if (typeof site.timeZone === 'string' && site.timeZone.trim()) value.timeZone = site.timeZone;
        if (!Object.keys(value).length) throw new Error('Project site has no supplied coordinates or time zone.');
        const config = copy(draft()); config.site = value; config.period = null; config.samples = [];
        replace(config); current().intervalSource = 'unprepared';
        current().siteSource = 'Copied project site on request; may be a project default. Verify against the actual site before preparing.';
        return copy(value);
      }); },
      useSunPathSelections(doc = document) { return attempt(() => {
        const read = id => doc?.getElementById(id)?.value;
        if (read('sunDate') === undefined || read('sunTime') === undefined)
          throw new Error('Sun Path selections are unavailable in this page.');
        const site = { latitudeDeg: numeric(read('sunLatitude') ?? ''), longitudeDeg: numeric(read('sunLongitude') ?? ''),
          timeZone: read('sunTimeZone') || null };
        const value = copy(draft()); value.site = site; value.period = null; value.samples = [];
        replace(value); current().selection = { ...current().selection, date: read('sunDate'),
          startTime: read('sunTime'), startOccurrence: read('sunOccurrence') || '' };
        current().intervalSource = 'unprepared';
        current().siteSource = 'Exploratory Sun Path selections copied to this draft only; verify coordinates and choose an end.';
        return true;
      }); },
      prepareSunIntervals() { return attempt(() => {
        const prepared = prepareIntervals(runtime.HomeSun, current().selection, draft().site);
        replace({ ...copy(draft()), ...prepared, ...(draft().direct?.enabled === false ? { direct: { enabled: true } } : {}) });
        current().intervalSource = 'HomeSun / bundled SunCalc; explicit UTC endpoints and exact midpoint vectors';
        message = `${prepared.samples.length} chronological sun intervals prepared. Run explicitly.`;
        return copy(prepared);
      }); },
      localOccurrences(endpoint) {
        try {
          const sel = current().selection, end = endpoint === 'end';
          const date = end ? sel.endDate || sel.date : sel.date, time = end ? sel.endTime : sel.startTime;
          if (!runtime.HomeSun?.localCandidates) return null;
          return runtime.HomeSun.localCandidates(date, time, draft().site?.timeZone).map(value => value.toISOString());
        } catch (_) { return null; }
      },
      setVisualization(patch) { return attempt(() => {
        if (!sync()) throw new Error('Physical inputs could not be verified.');
        const next = { ...visualization, ...patch };
        if (!['direct', 'presence-hours', 'equivalent-hours', 'sky'].includes(next.metric) ||
            !Number.isInteger(next.intervalIndex) || next.intervalIndex < 0 ||
            typeof next.modeled !== 'boolean' || typeof next.showElectrical !== 'boolean')
          throw new Error('Choose an available metric, nonnegative interval index and explicit display toggles.');
        visualization = next; boundedVisualization(); buildPreview(); publish(!result); return { ...visualization };
      }); },
      setFloor(id) { return attempt(() => {
        if (!sync()) throw new Error('Physical inputs could not be verified.');
        if (!(project.floors || []).some(floor => floor.id === id)) throw new Error('Choose an existing floor.');
        floorId = id; buildPreview(); return id;
      }); },
      selectScenario,
      addScenario(label = 'New study', clone = false) { return attempt(() => {
        if (session().drafts.size >= LIMITS.scenarios) throw new Error(`Keep at most ${LIMITS.scenarios} session studies.`);
        const item = clone ? copy(current()) : entry(newDraft(label));
        item.config = { ...item.config, id: nextId('light'), label };
        item.config = foundation().normalizeConfig(item.config);
        const id = item.config.id; session().drafts.set(id, item); selectScenario(id); return id;
      }); },
      renameScenario(label) { return edit(value => { value.label = label; }); },
      deleteScenario(id) { return attempt(() => {
        if (!session().drafts.has(id)) throw new Error('Study no longer exists.');
        if (session().drafts.size === 1) throw new Error('Keep at least one session study.');
        if (session().selected === id) selectScenario([...session().drafts.keys()].find(key => key !== id));
        session().drafts.delete(id); return true;
      }); },
      importConfig(text) { return attempt(() => {
        if (typeof text !== 'string' || text.length > LIMITS.importCharacters)
          throw new Error(`Config JSON must be under ${LIMITS.importCharacters} characters.`);
        const normalized = foundation().normalizeConfig(JSON.parse(text));
        const updated = replace(normalized);
        current().intervalSource = 'Expert-imported UTC / sun inputs; astronomy not independently verified';
        current().siteSource = 'Imported config site metadata retained, not independently verified';
        current().selection = blankSelection(); return updated;
      }); },
      addRoom(ref) { return edit(value => {
        const room = inventory?.rooms.find(item => refKey(item.ref) === refKey(ref));
        if (!room) throw new Error('Prepare inventory and select an exact room reference.');
        value.workplanes ||= [];
        value.workplanes.push({ id: nextId('plane'), room: copy(room.ref), heightM: null, spacingM: 0.5 });
      }); },
      updateWorkplane(id, patch) { return edit(value => {
        const plane = value.workplanes?.find(item => item.id === id);
        if (!plane) throw new Error('Workplane no longer exists.');
        Object.assign(plane, patch);
      }); },
      removeWorkplane(id) { return edit(value => { value.workplanes = value.workplanes.filter(item => item.id !== id); }); },
      setNeighbor(side, state, boxIds = []) { return edit(value => {
        if (!SIDES.includes(side)) throw new Error('Choose an existing site side.');
        if (boxIds.some(id => !value.neighborBoxes?.some(box => box.id === id))) throw new Error('Choose exact supplied box IDs.');
        value.neighbors ||= {}; value.neighbors[side] = state === 'modeled' ? { state, boxIds } : { state };
      }); },
      addBox() { return edit(value => {
        value.neighborBoxes ||= [];
        value.neighborBoxes.push({ id: nextId('neighbor'), x: null, y: null, w: null, h: null,
          baseM: null, heightM: null, transmittance: null });
      }); },
      updateBox(id, patch) { return edit(value => {
        const box = value.neighborBoxes?.find(item => item.id === id);
        if (!box) throw new Error('Neighbor box no longer exists.');
        const nextIdValue = patch.id;
        Object.assign(box, patch);
        if (nextIdValue && nextIdValue !== id)
          SIDES.forEach(side => {
            const neighbor = value.neighbors?.[side];
            if (neighbor?.boxIds) neighbor.boxIds = neighbor.boxIds.map(item => item === id ? nextIdValue : item);
          });
      }); },
      removeBox(id) { return edit(value => {
        value.neighborBoxes = value.neighborBoxes.filter(item => item.id !== id);
        SIDES.forEach(side => {
          const neighbor = value.neighbors?.[side];
          if (neighbor?.boxIds) neighbor.boxIds = neighbor.boxIds.filter(item => item !== id);
        });
      }); },
      setRoof(floor, patch) { return edit(value => {
        if (!inventory?.floors.some(item => item.floorId === floor))
          throw new Error('Prepare inventory and choose an existing floor.');
        value.roofContext ||= [];
        let roof = value.roofContext.find(item => item.floorId === floor);
        if (!roof) { roof = { floorId: floor, state: 'unknown', source: null }; value.roofContext.push(roof); }
        Object.assign(roof, patch);
      }); },
      pinHistory(id) { return attempt(() => {
        const snapshot = session().history.find(item => item.id === id);
        if (!snapshot) throw new Error('Choose a captured result in this project.');
        session().baseline = snapshot; return id;
      }); },
      clearPin() { return attempt(() => { session().baseline = null; return true; }); },
      exportData(kind) { return attempt(() => {
        if (!sync()) throw new Error('Current physical inputs cannot be verified.');
        let text, mime;
        if (kind === 'config') { text = JSON.stringify(draft(), null, 2); mime = 'application/json'; }
        else {
          if (!result || busy) throw new Error('Run the current study before exporting current evidence.');
          if (kind === 'json') { text = JSON.stringify(result, null, 2); mime = 'application/json'; }
          else if (kind === 'csv') { text = sensorCSV(result); mime = 'text/csv;charset=utf-8'; }
          else if (kind === 'svg' && preview?.svg) { text = preview.svg; mime = 'image/svg+xml'; }
          else throw new Error('Choose config, result JSON, sensor CSV or an available current-view SVG.');
        }
        const BlobClass = runtime.Blob || root.Blob;
        const blob = new BlobClass([text], { type: mime });
        if (blob.size > LIMITS.exportBytes) throw new Error('Download exceeds the 20 MiB workbench budget.');
        return { blob, fileName: `light-${kind === 'config' ? 'config.json' : `evidence.${kind}`}` };
      }); },
      dispose() {
        if (disposed) return;
        invalidate('Disposed.'); disposed = true; unsubscribe?.(); runner?.dispose?.(); listeners.clear();
      }
    };
    return Object.freeze(api);
  }

  function mount(doc = root.document, runtime = doc?.defaultView || root) {
    const host = doc?.getElementById('workspaceLightStudy');
    if (!host) return null;
    if (host.lightController) return host.lightController;
    let controller;
    try {
      controller = createController(runtime.HomePlanner, runtime, doc);
    }
    catch (cause) { host.textContent = cause.message; return null; }
    host.lightController = controller; host.classList.add('homePlannerLight');
    const el = (tag, text = '', cls = '') => {
      const node = doc.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node;
    };
    const button = (text, id, action) => {
      const node = el('button', text); node.type = 'button'; if (id) node.id = id;
      node.addEventListener('click', action); return node;
    };
    const disclosure = title => { const node = el('details'); node.append(el('summary', title)); return node; };
    const heading = el('h2', 'House light map');
    const warning = el('p', 'Geometric light access · Not lux, daylight factor or adequacy.', 'light-warning');
    const actions = el('div', '', 'light-actions');
    const wholeHouse = button('Analyze whole house', 'light-whole-house', () => controller.runWholeHouse());
    const presetHelp = el('p', 'Whole-house view: all rooms at floor level, ideal-clear windows, supplied buildings only. Unrecorded surroundings are not included.', 'light-warning');
    const prepare = button('Prepare inventory', 'light-prepare', () => {
      if (controller.prepare()) {
        inputs.open = true;
        const rooms = forms.querySelectorAll('details')[0]; if (rooms) rooms.open = true;
      }
    });
    const run = button('Run custom study', 'light-run', () => {
      if (controller.getState().setupRequirements.length) { openInputs(); return; }
      controller.run();
    });
    const cancel = button('Cancel', 'light-cancel', () => controller.cancel());
    const clear = button('Clear result', 'light-clear', () => controller.clearResult());
    const reviewInputs = button('Review study inputs', 'light-inputs', () => openInputs());
    actions.append(wholeHouse, cancel, clear);
    const status = el('p', '', 'light-status'); status.id = 'light-status'; status.setAttribute('role', 'status');
    const error = el('p', '', 'light-error'); error.id = 'light-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    const choices = disclosure('Display floor & saved studies');
    const viewFields = el('div', '', 'light-fields'); choices.append(viewFields);
    const viewport = el('div', '', 'light-viewport'); viewport.id = 'light-viewport';
    viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Room light plan; equivalent sensor evidence below');
    const displayStatus = el('p', '', 'light-view-status'); displayStatus.id = 'light-view-status';
    displayStatus.setAttribute('role', 'status');
    const scale = el('p', '', 'light-scale'); scale.id = 'light-scale';
    const viewControls = el('div', '', 'light-fields');
    const legend = disclosure('Read the map & review missing information'), legendBody = el('div'); legend.append(legendBody);
    legend.id = 'light-reading-guide';
    const inputs = disclosure('Study inputs — rooms, site, optics & context'), forms = el('div');
    const setupList = el('div'); setupList.id = 'light-setup-checklist';
    const customActions = el('div', '', 'light-actions');
    customActions.append(prepare, run, reviewInputs);
    inputs.append(customActions, setupList, forms);
    function openInputs(section = controller.getState().setupRequirements[0]?.section || 'rooms') {
      inputs.open = true;
      const target = doc.getElementById(`light-input-section-${section}`);
      if (target) {
        target.open = true; target.children[0].focus();
        target.scrollIntoView?.({ block: 'nearest' });
      } else inputs.children[0].focus();
    }
    const scenarios = disclosure('Manage session studies & comparisons'), scenarioBody = el('div'); scenarios.append(scenarioBody);
    const evidence = disclosure('Sensor & room evidence'), evidenceBody = el('div'); evidence.append(evidenceBody);
    const provenance = disclosure('Technical details — diagnostics & model inputs'), provenanceBody = el('pre');
    provenance.id = 'light-technical-details';
    provenance.append(el('p', 'For detailed review and troubleshooting. Full precision, source identifiers and original diagnostics are also retained in result JSON exports.'), provenanceBody);
    const exports = disclosure('Export evidence / expert config import'), exportBody = el('div'); exports.append(exportBody);
    host.append(heading, warning, presetHelp, actions, status, choices, displayStatus, viewport, error, scale, viewControls, legend, inputs, scenarios, evidence, provenance, exports);
    let fieldSerial = 0, imageURL = null, previousPreview, structuralKey = '', previousSetupKey = '', refreshPending = false, destroyed = false;
    let imageError = '', lastResult = null;
    const urlAPI = runtime.URL || root.URL, BlobClass = runtime.Blob || root.Blob;
    function showError(text) { error.textContent = text; error.hidden = !text; }
    function field(parent, label, value, action, options = null, type = 'text', id = '') {
      const wrapper = el('label', label), input = el(options ? 'select' : 'input');
      input.id = id || `light-field-${++fieldSerial}`; wrapper.htmlFor = input.id;
      if (options) options.forEach(([key, text]) => { const option = el('option', text); option.value = key; input.append(option); });
      else { input.type = type; if (type === 'number') { input.step = 'any'; input.inputMode = 'decimal'; } }
      let accepted = value;
      const assign = next => { if (type === 'checkbox') input.checked = next === true; else input.value = next ?? ''; };
      assign(value);
      const onChange = () => {
        try {
          if (type === 'number' && input.validity?.badInput) throw new Error('Enter a complete finite decimal number.');
          const next = type === 'checkbox' ? input.checked : type === 'number' ? numeric(input.value) : input.value;
          if (action(next) === null) assign(accepted); else accepted = next;
        } catch (cause) { assign(accepted); showError(`${cause.message} Previous value retained.`); }
      };
      input.addEventListener('change', onChange);
      if (type === 'date' || type === 'time') input.addEventListener('input', onChange);
      wrapper.append(input); parent.append(wrapper); return input;
    }
    function selectOptions(input, options, value) {
      input.replaceChildren();
      options.forEach(([key, text]) => { const option = el('option', text); option.value = key; input.append(option); });
      input.value = value ?? '';
    }
    const floorSelect = field(viewFields, 'Display floor (not analysis selection)', '', id => controller.setFloor(id), [], 'text', 'light-floor');
    const scenarioSelect = field(viewFields, 'Session study', '', id => controller.selectScenario(id), [], 'text', 'light-scenario');
    const metric = field(viewControls, 'Metric', 'direct', metric => controller.setVisualization({ metric }), [
      ['direct', 'Selected interval · path transmission'], ['presence-hours', 'Positive-path presence · h'],
      ['equivalent-hours', 'Transmitted-equivalent sun · h'], ['sky', 'Cosine-weighted sky access · 0–1']
    ], 'text', 'light-metric');
    const interval = field(viewControls, 'Selected interval (manual; no animation)', 0,
      index => controller.setVisualization({ intervalIndex: Number(index) }), [], 'text', 'light-interval');
    const slider = field(viewControls, 'Scrub cached intervals', 0,
      index => controller.setVisualization({ intervalIndex: Number(index) }), null, 'range', 'light-interval-slider');
    slider.min = '0'; slider.max = '0'; slider.step = '1';
    const modeled = field(viewControls, 'Show modeled-only evidence (unknown context)', false,
      modeled => controller.setVisualization({ modeled }), null, 'checkbox', 'light-modeled');
    const electrical = field(viewControls, 'Show electrical intent (no photometry)', false,
      showElectrical => controller.setVisualization({ showElectrical }), null, 'checkbox', 'light-electrical');
    const nav = button('Open Design / Layout', 'light-design', () => {
      if (runtime.HomePlannerWorkspace?.navigate) runtime.HomePlannerWorkspace.navigate('design/layout');
      else if (doc.getElementById('workspaceNavDesign')) doc.getElementById('workspaceNavDesign').click();
      else showError('Use the Design → Layout navigation to inspect in 3D. Light overlay is opt-in there.');
    });
    viewControls.append(nav, el('p', 'Edit physical rooms in Design. This 2D study needs no WebGL; its 3D light overlay remains explicitly opt-in.'));
    function boxFields(state, parent) {
      parent.append(el('p', 'Boxes are explicit study context in site-local metres, independent of project facades. Do not duplicate an actual physical obstacle. No box dimension or opacity is inferred.'));
      parent.append(button('Add context box', 'light-add-box', () => controller.addBox()));
      for (const box of state.draft.neighborBoxes || []) {
        const group = el('fieldset'), fields = el('div', '', 'light-fields'); group.append(el('legend', box.id), fields);
        field(fields, 'Exact box ID', box.id, id => controller.updateBox(box.id, { id }));
        const labels = { x: 'x · site-local m', y: 'y · site-local m', w: 'Width along x · m', h: 'Depth along y · m',
          baseM: 'Base elevation · m', heightM: 'Box height · m', transmittance: 'Path transmittance · 0–1' };
        Object.entries(labels).forEach(([key, label]) =>
          field(fields, label, box[key], number => controller.updateBox(box.id, { [key]: number }), null, 'number'));
        group.append(button('Remove box', '', () => controller.removeBox(box.id))); parent.append(group);
      }
      for (const side of SIDES) {
        const neighbor = state.draft.neighbors?.[side] || { state: 'unknown' }, group = el('fieldset');
        group.append(el('legend', `${side} context`));
        field(group, 'State', neighbor.state, next => controller.setNeighbor(side, next, next === 'modeled' ? neighbor.boxIds || [] : []),
          ['unknown', 'clear', 'modeled'].map(value => [value, value]), 'text', `light-neighbor-${side}`);
        if (neighbor.state === 'modeled') {
          group.append(el('p', 'Reference exact boxes. A corner box can be selected on two sides; it is still one physical object.'));
          for (const box of state.draft.neighborBoxes || [])
            field(group, box.id, neighbor.boxIds?.includes(box.id), checked => {
              const ids = controller.getState().draft.neighbors[side].boxIds || [];
              return controller.setNeighbor(side, 'modeled', checked ? [...ids, box.id] : ids.filter(id => id !== box.id));
            }, null, 'checkbox');
        }
        parent.append(group);
      }
    }
    function renderForms(state) {
      forms.replaceChildren();
      const rooms = disclosure('Select rooms & workplanes'), roomFields = el('div', '', 'light-fields'); rooms.append(roomFields);
      rooms.id = 'light-input-section-rooms';
      const roomOptions = [['', 'Choose a room from prepared inventory'], ...(state.inventory?.rooms || [])
        .map(room => [refKey(room.ref), `${room.label || room.ref.entityId} · ${room.ref.floorId}`])];
      const roomPick = field(roomFields, 'Room', '', () => true, roomOptions, 'text', 'light-room');
      roomFields.append(button('Add selected room', 'light-add-room', () => {
        if (!roomPick.value) return showError('Prepare inventory and select a room.');
        const [floorId, entityId] = JSON.parse(roomPick.value); controller.addRoom({ floorId, entityId });
      }));
      rooms.append(el('p', 'Workplane height is explicit, relative to its supplied floor elevation. The 0.5 m grid default is numerical only; floor heights and roofs are never invented.'));
      rooms.append(el('p', 'A workplane is the horizontal surface you want to study, such as a desk or the floor. Measure its height above the finished floor. This is not the ceiling height; choose it for your task.'));
      for (const plane of state.draft.workplanes || []) {
        const group = el('fieldset'), fields = el('div', '', 'light-fields');
        group.append(el('legend', `${plane.room?.floorId} · ${plane.room?.entityId}`), fields);
        field(fields, 'Workplane height above floor · m', plane.heightM,
          heightM => controller.updateWorkplane(plane.id, { heightM }), null, 'number');
        field(fields, 'Maximum numerical grid spacing · m', plane.spacingM,
          spacingM => controller.updateWorkplane(plane.id, { spacingM }), null, 'number');
        group.append(button('Remove workplane', '', () => controller.removeWorkplane(plane.id))); rooms.append(group);
      }
      const sun = disclosure('Site, civil time & sun intervals'), sunFields = el('div', '', 'light-fields');
      sun.id = 'light-input-section-sun';
      sun.append(el('p', state.siteSource), button('Use project site', 'light-project-site', () => controller.useProjectSite()),
        button('Use Sun Path selections', 'light-sun-path', () => controller.useSunPathSelections(doc)), sunFields);
      sun.append(el('p', 'Location and local time determine the sun direction. Use the saved project site or your Sun Path selections, check them, then choose the study period. Preparing intervals creates the times to calculate; it does not change the house.'));
      field(sunFields, 'Latitude · degrees (unknown until supplied)', state.draft.site?.latitudeDeg,
        latitudeDeg => controller.setSite({ latitudeDeg }), null, 'number', 'light-latitude');
      field(sunFields, 'Longitude · degrees (unknown until supplied)', state.draft.site?.longitudeDeg,
        longitudeDeg => controller.setSite({ longitudeDeg }), null, 'number', 'light-longitude');
      field(sunFields, 'IANA time zone', state.draft.site?.timeZone,
        timeZone => controller.setSite({ timeZone: timeZone || null }), null, 'text', 'light-time-zone');
      for (const [key, label, type] of [['date', 'Start date', 'date'], ['startTime', 'Start local time', 'time'],
        ['endDate', 'End date (blank uses start date)', 'date'], ['endTime', 'End local time', 'time'],
        ['strideMinutes', 'Computational interval stride · minutes', 'number']])
        field(sunFields, label, state.selection[key], value => controller.setSelection({ [key]: value }),
          null, type, `light-${key}`);
      for (const endpoint of ['start', 'end']) {
        const candidates = controller.localOccurrences(endpoint);
        const label = candidates?.length > 1 ? `${endpoint} occurs twice — choose the UTC occurrence`
          : `${endpoint} DST occurrence (required if this clock time repeats)`;
        field(sunFields, label, state.selection[`${endpoint}Occurrence`],
          value => controller.setSelection({ [`${endpoint}Occurrence`]: value }),
          [['', 'No occurrence selected'], ['earlier', `Earlier${candidates?.length > 1 ? ` · ${candidates[0]}` : ''}`],
            ['later', `Later${candidates?.length > 1 ? ` · ${candidates.at(-1)}` : ''}`]], 'text', `light-${endpoint}-occurrence`);
      }
      sun.append(button('Prepare sun intervals', 'light-prepare-sun', () => controller.prepareSunIntervals()),
        el('p', `${state.intervalSource}. Date/site edits discard previously sampled periods; no browser-local time or guessed UTC offset.`));
      const optics = disclosure('Optics, sky quadrature & horizon'), opticFields = el('div', '', 'light-fields'); optics.append(opticFields);
      optics.id = 'light-input-section-optics';
      optics.append(el('p', 'Ideal-clear studies geometry without glazing losses; it is an assumption, not a claim about your glass. For actual glazing, visible transmittance describes how much visible light passes through it. Get that value from the product data or a measurement, not its heat-gain rating (SHGC).'));
      optics.append(el('p', 'The near-horizon cutoff is an analysis choice: sun directions this close to the horizon are left unresolved rather than reported as reliable shade. Use the threshold specified for your study; the app does not choose one for you.'));
      field(opticFields, 'Window optical model — explicit choice', state.draft.windowOptics?.mode,
        mode => controller.setDraft({ windowOptics: mode === 'visible-transmission'
          ? { mode, visibleTransmittance: null, source: null } : { mode: mode || null } }),
        [['', 'Unknown — choose a model'], ['ideal-clear', 'Ideal-clear geometric apertures'],
          ['visible-transmission', 'Explicit visible transmittance']], 'text', 'light-optics');
      if (state.draft.windowOptics?.mode === 'visible-transmission') {
        field(opticFields, 'Visible transmittance · 0–1 (not SHGC)', state.draft.windowOptics.visibleTransmittance,
          visibleTransmittance => controller.setDraft({ windowOptics: { ...controller.getState().draft.windowOptics, visibleTransmittance } }),
          null, 'number', 'light-visible-transmission');
        field(opticFields, 'Visible optical property source', state.draft.windowOptics.source,
          source => controller.setDraft({ windowOptics: { ...controller.getState().draft.windowOptics, source: source || null } }),
          null, 'text', 'light-optics-source');
      }
      field(opticFields, 'Enable time-independent sky access', state.draft.sky?.enabled,
        enabled => controller.setDraft({ sky: { ...controller.getState().draft.sky, enabled } }), null, 'checkbox', 'light-sky');
      for (const [key, label] of [['radialBands', 'Numerical radial bands (default 16)'], ['azimuthSectors', 'Numerical azimuth sectors (default 64; multiple of 4)']])
        field(opticFields, label, state.draft.sky?.[key],
          value => controller.setDraft({ sky: { ...controller.getState().draft.sky, [key]: value } }), null, 'number', `light-${key}`);
      field(opticFields, 'Unresolved near-horizon cutoff · degrees (0 < value < 90)', state.draft.minSunAltitudeDeg,
        minSunAltitudeDeg => controller.setDraft({ minSunAltitudeDeg }), null, 'number', 'light-horizon');
      const context = disclosure('Neighbors — four explicit side states & site-local boxes'); boxFields(state, context);
      context.append(el('p', 'Leave a side unknown if you have not checked it. Mark it clear only after checking for obstructions, or enter measured neighboring building dimensions. Unknown sides do not stop a supplied-model preview, but the result cannot describe their shading.'));
      const roof = disclosure('Roof context — existing floors only');
      roof.append(el('p', 'An absence declaration cannot remove an actual supplied roof. No declaration invents a missing roof, wall height or interstorey slab.'));
      for (const floor of state.inventory?.floors || []) {
        const item = state.draft.roofContext?.find(value => value.floorId === floor.floorId) || {};
        const group = el('fieldset'); group.append(el('legend', floor.floorId));
        field(group, 'Roof context', item.state || 'unknown', state => controller.setRoof(floor.floorId, { state }),
          [['unknown', 'Unknown'], ['none', 'Explicit absence (does not remove actual roof)'], ['supplied', 'Supplied physical roof']]);
        field(group, 'Declaration source', item.source, source => controller.setRoof(floor.floorId, { source: source || null }));
        roof.append(group);
      }
      forms.append(rooms, sun, optics, context, roof);
    }
    function table(parent, title, rows) {
      if (!rows?.length) { parent.append(el('p', `${title}: no current rows.`)); return; }
      const region = el('div', '', 'light-table-region'); region.tabIndex = 0; region.setAttribute('role', 'region');
      region.setAttribute('aria-label', title);
      const node = el('table'); node.append(el('caption', title));
      const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
      const head = el('thead'), header = el('tr');
      keys.forEach(key => { const cell = el('th', key); cell.scope = 'col'; header.append(cell); }); head.append(header); node.append(head);
      const body = el('tbody'), pageStatus = el('p'); let page = 0;
      function paint() {
        body.replaceChildren();
        const offset = page * 100;
        for (const row of rows.slice(offset, offset + 100)) {
          const line = el('tr');
          keys.forEach(key => {
            const value = row[key], text = value === null || value === undefined ? 'Not available'
              : typeof value === 'number' ? String(Number(value.toPrecision(6))) : String(value);
            const cell = el('td', text);
            if (typeof value === 'number') cell.title = String(value);
            line.append(cell);
          });
          body.append(line);
        }
        pageStatus.textContent = `Rows ${offset + 1}–${Math.min(offset + 100, rows.length)} of ${rows.length}. Exports retain all rows.`;
        previous.disabled = page === 0; next.disabled = offset + 100 >= rows.length;
      }
      const previous = button('Previous rows', '', () => { page--; paint(); });
      const next = button('Next rows', '', () => { page++; paint(); });
      node.append(body); region.append(node); parent.append(pageStatus, previous, next, region); paint();
    }
    function renderScenarios(state) {
      scenarioBody.replaceChildren();
      scenarioBody.append(el('p', 'Session-only studies do not modify the physical project. Up to 24 studies and 12 recent result snapshots; one pinned comparison survives history rotation.'));
      field(scenarioBody, 'Study name', state.draft.label, label => controller.renameScenario(label), null, 'text', 'light-study-name');
      scenarioBody.append(button('New study', 'light-new-study', () => controller.addScenario()),
        button('Clone study', 'light-clone-study', () => controller.addScenario(`${state.draft.label || 'Study'} copy`, true)),
        button('Delete selected study', 'light-delete-study', () => controller.deleteScenario(state.selectedScenarioId)));
      const pick = field(scenarioBody, 'Captured result to pin', state.baselineId || '',
        () => true, [['', 'Select a captured result'], ...state.history.map(item => [item.id, `${item.label} · ${item.status}`])], 'text', 'light-history');
      scenarioBody.append(button('Pin for comparison', 'light-pin', () => controller.pinHistory(pick.value)),
        button('Clear comparison pin', 'light-unpin', () => controller.clearPin()));
      if (state.comparison) {
        scenarioBody.append(el('p', state.comparison.comparable
          ? 'These studies can be compared. Positive changes mean a higher value in the current study.'
          : `These studies cannot be compared: ${state.comparison.reasons.map(reason => reason.replaceAll('-', ' ')).join('; ')}. Match their settings and sampled rooms first.`));
        if (state.comparison.comparable) table(scenarioBody, 'Change from pinned study at matching points', state.comparison.deltas.map((row, index) => ({
          'Study point': `S${index + 1}`, 'Sun path present change (hours)': row.positivePathPresenceHours,
          'Transmission-weighted sun change (hours)': row.transmittedEquivalentSunHours,
          'Sky access change (0–1)': row.cosineWeightedSkyAccess
        })));
      }
    }
    function download(kind) {
      const output = controller.exportData(kind); if (!output) return;
      if (!urlAPI?.createObjectURL) return showError('Local Blob downloads are unavailable.');
      const url = urlAPI.createObjectURL(output.blob), link = el('a');
      link.href = url; link.download = output.fileName; host.append(link); link.click(); link.remove();
      (runtime.setTimeout || root.setTimeout)(() => urlAPI.revokeObjectURL(url), 1000);
    }
    exportBody.append(el('p', 'JSON preserves the complete canonical input/provenance. CSV has true units and empty unknown primary values; modeled evidence is separately labeled. SVG exports precisely the selected cached view.'));
    for (const [kind, label] of [['config', 'Export config JSON'], ['json', 'Export result JSON'], ['csv', 'Export sensor CSV'], ['svg', 'Export current SVG']])
      exportBody.append(button(label, `light-export-${kind}`, () => download(kind)));
    const expert = disclosure('Expert UTC / sun-angle config import (not astronomy verification)');
    const importLabel = el('label', 'Full strict HomePlannerLight config JSON'), importText = el('textarea');
    importText.id = 'light-import-config'; importLabel.htmlFor = importText.id; importText.rows = 8; importText.maxLength = LIMITS.importCharacters;
    importLabel.append(importText); expert.append(importLabel, button('Import config', 'light-import', () => controller.importConfig(importText.value)));
    exportBody.append(expert);
    function updateImage(state) {
      if (state.preview && state.preview === previousPreview) return;
      previousPreview = state.preview;
      if (imageURL) urlAPI?.revokeObjectURL(imageURL);
      imageURL = null; imageError = ''; viewport.replaceChildren();
      if (!state.preview?.svg) {
        viewport.append(el('p', state.previewError || state.displayStatus.message));
        return;
      }
      const failed = message => {
        imageError = `Plan image unavailable: ${message}. Use the equivalent sensor tables, then Prepare inventory to retry.`;
        viewport.replaceChildren(el('p', imageError)); showError(imageError);
        if (imageURL) urlAPI?.revokeObjectURL(imageURL);
        imageURL = null; previousPreview = undefined;
      };
      try {
        const blob = new BlobClass([state.preview.svg], { type: 'image/svg+xml' });
        if (blob.size > LIMITS.exportBytes) throw new Error('image exceeds the 20 MiB workbench budget');
        if (!urlAPI?.createObjectURL) throw new Error('Blob image support unavailable');
        imageURL = urlAPI.createObjectURL(blob);
        const img = el('img'); img.src = imageURL; img.alt = `Room light plan — ${state.visualization.metric}; ${state.visualization.modeled ? 'modeled-only evidence' : 'primary evidence'}`;
        img.addEventListener('error', () => { if (viewport.contains(img)) failed('the SVG could not load'); });
        viewport.append(img);
      } catch (cause) { failed(cause.message); }
    }
    function render(state) {
      if (destroyed) return;
      run.disabled = state.busy; wholeHouse.disabled = state.busy; cancel.disabled = !state.busy; prepare.disabled = state.busy;
      clear.disabled = !state.result && !state.busy;
      host.setAttribute('aria-busy', String(state.busy));
      status.textContent = state.busy && state.progress
        ? `Computing: ${state.progress.completedIntervals ?? 0}/${state.progress.totalIntervals ?? 0} intervals; ${state.progress.processedRays ?? 0} rays.`
        : state.message;
      updateImage(state);
      showError([state.error, state.previewError, imageError].filter(Boolean).join(' '));
      displayStatus.textContent = state.displayStatus.message;
      displayStatus.setAttribute('data-state', state.displayStatus.code);
      scale.textContent = state.preview?.legend?.[0]
        ? `${state.preview.legend[0]} Blue = known zero · cyan → green → yellow → red = increasing computed values · hatch / ? = unavailable.`
        : 'No light values yet. This 2D plan and its evidence tables do not require WebGL.';
      if (state.result && state.result !== lastResult && state.result.status === 'blocked') inputs.open = true;
      if (state.displayStatus.code === 'other-floor' && state.result !== lastResult) choices.open = true;
      lastResult = state.result;
      const setupKey = canonical(state.setupRequirements);
      if (previousSetupKey !== setupKey) {
        previousSetupKey = setupKey; setupList.replaceChildren();
        if (state.setupRequirements.length) {
          setupList.append(el('p', 'Complete these settings before running. Physical inputs are not filled automatically.'));
          const list = el('ul');
          for (const item of state.setupRequirements) {
            const entry = el('li', item.message + ' ');
            entry.append(button('Review setting', `light-setup-${item.id}`, () => openInputs(item.section)));
            list.append(entry);
          }
          setupList.append(list);
        } else setupList.append(el('p', 'Basic study inputs are supplied. Run study to check the model; unknown context may still leave primary results unavailable.'));
      }
      const key = canonical({ draft: state.draft, selection: state.selection, inventory: state.inventory?.physicalFingerprint,
        floor: state.floorId, scenarios: state.scenarios, history: state.history, baseline: state.baselineId,
        result: state.result?.provenance?.inputFingerprint, visualization: state.visualization });
      if (key === structuralKey) return;
      if (host.contains(doc.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(doc.activeElement?.tagName)) {
        refreshPending = true; return;
      }
      structuralKey = key; refreshPending = false;
      const opened = [...forms.querySelectorAll('details')].map((node, index) => node.open ? index : -1);
      renderForms(state);
      [...forms.querySelectorAll('details')].forEach((node, index) => { node.open = opened.includes(index); });
      renderScenarios(state);
      selectOptions(floorSelect, state.floors.map(floor => [floor.id, floor.name || floor.id]), state.floorId);
      selectOptions(scenarioSelect, state.scenarios.map(item => [item.id, item.label]), state.selectedScenarioId);
      metric.value = state.visualization.metric; modeled.checked = state.visualization.modeled; electrical.checked = state.visualization.showElectrical;
      const samples = state.result?.direct?.masks || state.draft.samples || [];
      selectOptions(interval, samples.length ? samples.map((sample, index) => [String(index), `${index + 1} · ${sample.startUTC} → ${sample.endUTC}`])
        : [['0', 'No prepared intervals']], String(state.visualization.intervalIndex));
      interval.disabled = !samples.length; slider.disabled = !samples.length;
      slider.max = String(Math.max(0, samples.length - 1)); slider.value = String(state.visualization.intervalIndex);
      legendBody.replaceChildren();
      const neighborCounts = { clear: 0, modeled: 0, unknown: 0 };
      SIDES.forEach(side => { neighborCounts[state.draft.neighbors?.[side]?.state || 'unknown']++; });
      legendBody.append(el('p', 'Blue means a calculated zero. Increasing colors mean higher values for the selected measure. Hatching and ? mean there is no reliable value yet — not zero light.'));
      const metricMeaning = {
        direct: 'Sun path transmission is the fraction reaching a study point for the selected time: 0 means blocked; 1 means no loss along the modeled path.',
        sky: 'Sky access describes how much of the sky reaches the surface, with more weight given to overhead sky. It is independent of the selected time and is not an illumination reading.',
        'presence-hours': 'Sun path present counts sampled hours with any positive path transmission. Even a partly transmitting window counts the full sampled interval.',
        'equivalent-hours': 'Transmission-weighted sun discounts each interval by the light that passes through. One hour at 40% transmission contributes 0.4 hours.'
      };
      legendBody.append(el('p', metricMeaning[state.visualization.metric]),
        el('p', 'These are estimates of light access, not lux or proof that a room is bright enough. Electrical symbols mark planned devices; they do not emit simulated light.'));
      if (state.setupRequirements.length)
        legendBody.append(el('p', 'The study is not ready to run. Use the missing-settings checklist in Study inputs.'),
          button('Review missing settings', 'light-reading-setup', () => openInputs()));
      if (neighborCounts.unknown)
        legendBody.append(el('p', `${neighborCounts.unknown} of 4 sides have not been checked for neighboring obstructions. You may leave them unknown; primary values then stay unavailable. “Show modeled-only evidence” uses only the buildings you supplied and may miss real shading.`));
      else legendBody.append(el('p', 'All four sides have a declaration. Check those declarations against the site; they are not a survey.'));
      const warningList = el('ul');
      readingNotes(state).forEach(message => warningList.append(el('li', message)));
      if (warningList.children.length) legendBody.append(warningList);
      evidenceBody.replaceChildren();
      evidenceBody.append(el('p', 'Values below are for the displayed floor and selected measure. Room averages use the sampled areas, not a whole-room lighting rating. Full-precision values, coordinates and source records remain in the JSON/CSV exports.'));
      const readable = evidenceRows(state);
      table(evidenceBody, 'Study points', readable.sensors);
      table(evidenceBody, 'Room averages', readable.rooms);
      if (state.visualization.showElectrical)
        table(evidenceBody, 'Planned electrical points — no light output calculated', readable.electrical);
      // Canonical keys can contain the complete model; keep them behind this closed disclosure.
      provenanceBody.textContent = JSON.stringify(state.result ? {
        config: state.result.config, provenance: state.result.provenance, context: state.result.context,
        sampling: state.result.sampling, progress: state.result.progress, findings: state.result.findings,
        inventoryFindings: state.inventory?.findings, legend: state.preview?.legend,
        displayWarnings: state.preview?.warnings, limitations: state.result.limitations, comparison: state.comparison
      } : { intervalSource: state.intervalSource, siteSource: state.siteSource,
        findings: state.inventory?.findings, legend: state.preview?.legend, displayWarnings: state.preview?.warnings }, null, 2);
    }
    const focusOut = () => {
      (runtime.setTimeout || root.setTimeout)(() => { if (refreshPending && !destroyed) render(controller.getState()); }, 0);
    };
    host.addEventListener('focusout', focusOut);
    const unsubscribe = controller.subscribe(render);
    const onRoute = () => controller.sync();
    doc.addEventListener('homeplanner:workspace-change', onRoute);
    render(controller.getState());
    const baseDispose = controller.dispose;
    const mounted = Object.freeze({ ...controller, dispose() {
      if (destroyed) return;
      destroyed = true; unsubscribe(); host.removeEventListener('focusout', focusOut);
      doc.removeEventListener('homeplanner:workspace-change', onRoute);
      if (imageURL) urlAPI?.revokeObjectURL(imageURL);
      imageURL = null; baseDispose(); host.lightController = null; host.homePlannerLight = null; host.replaceChildren();
    } });
    host.lightController = mounted;
    host.homePlannerLight = mounted;
    return mounted;
  }
  return Object.freeze({ createController, mount, numeric, csvCell, sensorCSV, prepareIntervals, LIMITS });
});
