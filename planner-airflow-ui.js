(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerAirflowUI = api;
    if (root.document?.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const IMPORT_LIMIT = 1000000, HISTORY_LIMIT = 12, SCENARIO_LIMIT = 24;
  const copy = value => JSON.parse(JSON.stringify(value));
  const refKey = ref => ref ? JSON.stringify([ref.floorId, ref.entityId]) : '';
  const operationCommand = kind => kind === 'window' ? 'update-window'
    : ['hinged', 'sliding'].includes(kind) ? 'update-door' : null;
  const canonical = value => JSON.stringify(value, function (_, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  });
  const frozen = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(frozen); Object.freeze(value);
    }
    return value;
  };
  const inputNames = { densityKgM3: 'air density', volumeM3: 'clear room volume',
    freeAreaM2: 'operating free area', cd: 'discharge coefficient (Cd)', pressurePa: 'signed pressure forcing',
    openFraction: 'operating fraction' };
  const inputHelp = {
    densityKgM3: 'Use the Python density card above for a location/weather estimate, or enter a documented constant in kg/m³.',
    volumeM3: 'Use whole house fills a plan-volume estimate from usable area and wall height. Override here if you have a better clear-volume value.',
    freeAreaM2: 'Area air can pass through, not glass area. Enter documented operating area within the cap below; do not multiply by the fraction again.',
    cd: 'Describes opening flow restriction. Enter an applicable measured or documented coefficient, not a material preset.',
    pressurePa: 'Enter documented additional forcing: positive drives from → to, negative reverses it. Zero means no imposed forcing; a wind rose cannot supply this.'
  };
  function readableValue(value) {
    if (value === null || value === undefined || value === 'unknown') return 'Not supplied';
    if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(7))) : 'Unavailable';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return 'See Technical details';
    return ({ 'not-run': 'Not run', 'not-selected': 'Not selected', converged: 'Converged',
      nonconverged: 'Not converged — diagnostic only', 'numerical-error': 'Numerical failure — diagnostic only',
      blocked: 'Inputs needed', active: 'Active', disabled: 'Disabled', complete: 'Complete', partial: 'Partly available',
      unavailable: 'Unavailable', 'outside-zero-Pa': 'Outside = 0 Pa', 'arbitrary-zero-Pa': 'Selected reference room = 0 Pa',
      closed: 'Closed — zero area' })[value] || String(value);
  }
  function referenceLabel(ref, state, kind = 'rooms') {
    const items = state.inventory?.[kind] || [], item = items.find(item => refKey(item.ref) === refKey(ref));
    const floor = state.floors?.find(floor => floor.id === ref?.floorId);
    let name = item?.label && item.label !== ref?.entityId ? item.label : '';
    if (!name && item && kind === 'openings') {
      const rooms = (item.candidateAdjacency || []).filter(side => side.kind === 'room')
        .map(side => state.inventory.rooms.find(room => refKey(room.ref) === refKey(side)))
        .filter(Boolean).map(room => room.label && room.label !== room.ref.entityId ? room.label
          : `Room ${state.inventory.rooms.indexOf(room) + 1}`);
      const kindName = { hinged: 'Hinged door', sliding: 'Sliding door', window: 'Window', passage: 'Passage' }[item.kind] || 'Opening';
      name = `${rooms.length ? rooms.join(' ↔ ') + ' · ' : ''}${kindName} ${items.indexOf(item) + 1}`;
    }
    return `${floor?.name || (floor ? `Floor ${state.floors.indexOf(floor) + 1}` : 'Floor unavailable')} / ${name ||
      (item ? `Room ${items.indexOf(item) + 1}` : kind === 'openings' ? 'Opening unavailable' : 'Room unavailable')}`;
  }
  function readableMessage(value, state) {
    let text = typeof value === 'string' ? value : value?.message || 'Review this input in Technical details.';
    for (const kind of ['rooms', 'openings']) for (const item of state.inventory?.[kind] || []) {
      const label = referenceLabel(item.ref, state, kind);
      text = text.split(refKey(item.ref)).join(label).split(item.key).join(label);
    }
    for (const zone of state.draft?.zones || [])
      text = text.split(JSON.stringify(['zone', zone.id])).join(referenceLabel(zone.room, state));
    for (const [index, link] of (state.draft?.links || []).entries()) {
      const label = link.opening ? referenceLabel(link.opening, state, 'openings') : `Manual connection ${index + 1}`;
      text = text.split(JSON.stringify(['link', link.id])).join(label);
      text = text.split(`Opening ${link.id} `).join(`Opening ${label} `);
    }
    text = text.replace(/(?:scenario\.)?(zones|links)\[(\d+)\]\./g, (_, kind, index) => {
      const record = state.draft?.[kind]?.[Number(index)];
      return record?.room ? `${referenceLabel(record.room, state)} — `
        : record?.opening ? `${referenceLabel(record.opening, state, 'openings')} — ` : `${kind === 'zones' ? 'Room' : 'Connection'} ${Number(index) + 1} — `;
    });
    text = text.replace(/\bscenario\.(?=densityKgM3\b)/g, '');
    for (const [key, name] of Object.entries(inputNames)) text = text.replace(new RegExp(`\\b${key}\\b`, 'g'), name);
    return text;
  }
  function visibleFindings(state) {
    const structured = [...(state.inventory?.findings || []), ...(state.result?.findings || []),
      ...(state.preparedInputs?.issues || []),
      ...(state.result?.planField?.findings || []), ...(state.inventory?.sourceDiagnostics || []),
      ...(state.inventory?.sourceFloorDiagnostics || []).flatMap(floor =>
        (floor.diagnostics || []).map(item => ({ ...item, floorId: floor.floorId })))];
    const normalize = text => {
      let message = String(text).replace(/^(?:blocking|warning|info):\s*/i, '').trim();
      for (const floor of state.floors || []) if (message.startsWith(`Floor ${floor.id}: `))
        message = message.slice(`Floor ${floor.id}: `.length);
      return message;
    };
    const messageOf = item => typeof item === 'string' ? item : item?.message ||
      'Additional source information is available in Technical details.';
    const originals = new Set(structured.map(item => normalize(messageOf(item))));
    const rows = structured.slice(), seen = new Set();
    for (const warning of [...(state.result?.warnings || []), ...(state.preview?.warnings || [])]) {
      const message = typeof warning === 'string' ? warning : warning?.message;
      if (message && !originals.has(normalize(message))) rows.push({ message: normalize(message) });
    }
    rows.sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'));
    return rows.flatMap(item => {
      const match = item.path?.match(/^(zones|links)\[(\d+)\]/);
      const record = match && state.draft[match[1]]?.[Number(match[2])];
      const ref = record?.room || record?.opening || item.reference || item.roomRef || item.openingRef;
      const kind = record?.opening || state.inventory?.openings.some(item => refKey(item.ref) === refKey(ref)) ? 'openings' : 'rooms';
      const inventoryItem = state.inventory?.[kind]?.find(candidate => refKey(candidate.ref) === refKey(ref));
      const floor = state.floors?.find(floor => floor.id === item.floorId || item.path === `floors[${JSON.stringify(floor.id)}]`);
      const anchor = item.path?.match(/\.anchors\.(from|to)/)?.[1];
      const location = (inventoryItem ? referenceLabel(ref, state, kind)
        : record?.kind === 'manual' ? `Manual connection ${Number(match[2]) + 1}` : floor?.name || floor?.id || '') +
        (anchor ? ` — ${anchor} anchor` : '');
      const message = readableMessage(normalize(messageOf(item)), state);
      const key = `${location}|${message}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [`${item.severity === 'blocking' ? 'Needed to run — ' : ''}${location ? location + ': ' : ''}${message}`];
    });
  }
  function numeric(value) {
    if (value === '' || value === null || typeof value === 'string' && !value.trim()) return null;
    if (!['number', 'string'].includes(typeof value) ||
        typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
      throw new TypeError('Enter a decimal number; blank means unknown, not zero.');
    const result = Number(value);
    if (!Number.isFinite(result)) throw new TypeError('Enter a finite number.');
    return result;
  }
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Only textual values need spreadsheet formula protection; signed numbers stay numeric.
    if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function csv(result) {
    const rows = [
      ['Airflow selected-network evidence', 'Not CFD; not room airspeed; not complete fresh-air delivery'],
      ['status', result.status], ['balanced', result.balanced],
      ...Object.entries(result.provenance || {}).map(([key, value]) => [key, value]),
      ['scenario (full explicit inputs)', JSON.stringify(result.scenario)],
      ['inventory (full captured physical inputs and diagnostics)', JSON.stringify(result.inventory)],
      ['solverInput (exact normalized inputs; null if blocked)', JSON.stringify(result.solverInput)],
      [],
      ['room zone ID', 'floor ID', 'room ID', 'pressure (Pa)', 'inflow (m³/s)', 'outflow (m³/s)',
        'direct outside inflow (m³/s)', 'transfer inflow (m³/s)', 'direct outside inflow ACH (1/h)',
        'net outflow residual (m³/s)', 'mass residual (kg/s)', 'numerical status']
    ];
    for (const row of result.zoneResults || []) rows.push([row.id, row.roomRef?.floorId, row.roomRef?.entityId,
      row.pressurePa, row.inflowM3s, row.outflowM3s, row.directOutsideInflowM3s, row.transferInflowM3s,
      row.directOutsideInflowACH, row.netOutflowM3s, row.massResidualKgS, row.numericalStatus]);
    rows.push([], ['link ID', 'kind', 'from zone', 'to zone', 'state', 'signed from → to flow (m³/s)',
      'aperture-mean speed (m/s; not room airspeed)', 'effective free area (m²)', 'forcing (Pa)', 'numerical status']);
    for (const row of result.flowResults || []) rows.push([row.id, row.kind, row.from, row.to, row.state,
      row.m3s, row.meanOpeningSpeedMps, row.effectiveAreaM2, row.pressurePa, row.numericalStatus]);
    if (result.planField) {
      rows.push([], ['2D potential-flow field', result.planField.status, 'Uncalibrated depth average; not measured room velocity or validated CFD'],
        ['Field assumptions', result.planField.assumptions],
        ['Cell', 'Floor', 'Room', 'site x (m)', 'site y (m)', 'x velocity estimate (m/s)', 'y velocity estimate (m/s)',
          'speed estimate (m/s)', 'conservation residual (m³/s)']);
      for (const cell of result.planField.cells) rows.push([cell.id, cell.floorId, cell.roomRef.entityId, cell.point.x, cell.point.y,
        cell.velocityMps.x, cell.velocityMps.y, cell.speedMps, cell.conservationResidualM3s]);
      rows.push([], ['Zone', 'Usable area (m²)', 'Uniform model depth = declared volume / usable area (m)', 'Field status']);
      for (const room of result.planField.rooms) rows.push([room.zoneId, room.usableAreaM2, room.modelDepthM, room.status]);
    }
    rows.push([], ['finding code', 'qualified path', 'severity', 'message']);
    for (const row of result.findings || []) rows.push([row.code, row.path, row.severity, row.message]);
    rows.push([], ['Original solver state (see JSON for full inventory and inputs)', JSON.stringify(result.solver)]);
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function describeDisplay({ inventory, result, preview, previewError, error, busy, floorId, draft }) {
    const status = (code, message) => ({ code, message });
    if (busy) return status('running', 'Calculating the selected network. Previous arrows are cleared until this run is verified.');
    if (previewError) return status('unavailable', previewError);
    if (!inventory && error) return status('unavailable', error);
    if (!inventory) return status('not-prepared', 'Use whole house to select existing rooms and estimate volumes, or Prepare inventory for manual selection. No airflow has been calculated.');
    if (!inventory.rooms.length) return status('empty', 'No rooms are available to study. Add and place rooms in Design → Layout, then prepare inventory again.');
    if (!result) return status('not-run', draft.zones.length
      ? 'No current airflow result. Review room volumes, air density and enabled opening inputs, then Run scenario. Blank values are unknown, not zero.'
      : 'Inventory only — select Room to add in Scenario, rooms & opening inputs. Supply its clear volume and air density, then add and explicitly enable compatible openings.');
    if (result.status === 'blocked') return status('blocked',
      'No flow calculated: inputs are needed. Each issue is listed once in Findings below. Review Scenario, rooms & opening inputs, then run again.');
    if (result.status !== 'converged' || !result.balanced || result.solver?.converged !== true)
      return status('diagnostic', 'No trusted flow arrows: the solver did not produce a balanced result. Review its findings and residuals; diagnostic numbers are not a ventilation assessment.');
    const rows = (preview?.openingRows || []).filter(row => row.inScope && row.selected);
    if (!rows.length && !result.zones.some(zone => zone.roomRef?.floorId === floorId))
      return status('other-floor', 'The selected network is on another floor. Choose its Preview floor to see the result; the analytical room selection is unchanged.');
    if (result.planField) {
      const field = result.planField, cells = (preview?.fieldRows || []).filter(cell => cell.inScope);
      if (!cells.length) return status('field-unavailable', 'The pressure-network result is available, but no velocity field can be shown here. Review Findings and the 2D model inputs; the network tables remain available.');
      if (cells.every(cell => cell.speedMps === 0))
        return status('zero-flow', 'The selected network has a computed zero-velocity potential field on this floor. Blue cells are known zero; no direction arrows are expected. This does not predict single-sided exchange.');
      return status(field.status === 'partial' ? 'field-partial' : 'result',
        `${cells.length} computed depth-averaged velocity cells and ${rows.filter(row => row.directionVector).length} signed opening-flow arrows. ` +
        'The color scale uses this result’s actual m/s values. This reduced potential-flow estimate is not validated CFD or measured occupant-level velocity.' +
        (field.status === 'partial' ? ' Some regions are unavailable; review Findings.' : ''));
    }
    if (!rows.length || rows.every(row => row.m3s === 0))
      return status('zero-flow', 'Converged selected network: zero net flow on this floor, so no flow arrows are expected. Review enabled links and signed pressure forcing. A single opening does not model single-sided exchange.');
    const arrows = rows.filter(row => row.directionVector).length;
    return status('result', arrows
      ? `${arrows} signed opening-flow arrows shown. Exact m³/s, aperture-mean speed and room balances are in the result tables; these are not room airspeeds or CFD.`
      : 'Signed connection results are available in the tables. Dashed manual connections show supplied anchors, not a measured airflow path or an invented physical opening.');
  }
  function createController(bridge, runtime = root) {
    if (!bridge?.getProject || !bridge?.getDrawingScene)
      throw new Error('Airflow needs the HomePlanner project bridge with getDrawingScene(). Reload the workbench.');
    const foundation = () => {
      const value = runtime.HomePlannerAirflow;
      if (!value?.normalizeScenario || !value?.discover || !value?.compare)
        throw new Error('Load building-physics.js and planner-airflow.js before preparing or editing airflow.');
      return value;
    };
    let project = bridge.getProject(), inventory = null, result = null, preview = null;
    let busy = false, error = '', previewError = '', message = 'Prepare geometry, then add the rooms and openings you want to study.';
    let generation = 0, serial = 0, runner = null, disposed = false, timer = null, rejectCancelled = null;
    const projects = new Map(), listeners = new Set();
    const nextId = prefix => `${prefix}-${++serial}`;
    const newScenario = label => ({ version: 1, id: nextId('scenario'), label, densityKgM3: null,
      planField: { enabled: true, spacingM: .5 }, zones: [], links: [] });
    function session() {
      if (!projects.has(project.id)) {
        const draft = newScenario('Scenario 1');
        projects.set(project.id, { selected: draft.id, drafts: new Map([[draft.id, draft]]), history: [], baseline: null,
          preparedInputs: new Map() });
      }
      return projects.get(project.id);
    }
    const draft = () => session().drafts.get(session().selected);
    session();
    const notify = () => { if (!disposed) listeners.forEach(listener => listener(getState())); };
    function clearTimer() { if (timer !== null) (runtime.clearTimeout || root.clearTimeout)(timer); timer = null; }
    function cancelWork() {
      generation++; clearTimer();
      if (rejectCancelled) rejectCancelled(new Error('Cancelled.'));
      rejectCancelled = null;
      if (busy) { try { runner?.cancel(); } catch (_) { /* Token still prevents publication. */ } }
      busy = false;
    }
    function invalidate(text) {
      cancelWork(); result = null; preview = null; error = ''; previewError = ''; if (text) message = text;
    }
    function buildPreview() {
      preview = null; previewError = '';
      const display = runtime.HomePlannerAirflowDisplay;
      if (!inventory) return;
      if (!display?.createView || !display?.createInventoryView) {
        previewError = 'Plan renderer unavailable. Load planner-airflow-display.js, then prepare again. Native inputs and evidence tables remain available; no WebGL is required.';
        return;
      }
      try {
        const floorId = inventory.floors.length ? project.activeFloorId : null;
        preview = result ? display.createView(result, { floorId })
          : display.createInventoryView(inventory, { floorId });
      } catch (cause) { previewError = `Plan preview unavailable: ${cause.message} Review the tables or choose another preview floor; no geometry was clipped or guessed.`; }
    }
    function adopt(nextProject, nextInventory = null) {
      const switched = nextProject.id !== project.id;
      const changed = !switched && inventory && nextInventory &&
        inventory.physicalFingerprint !== nextInventory.physicalFingerprint;
      const navigated = nextProject.activeFloorId !== project.activeFloorId;
      if (switched || changed) invalidate(switched
        ? 'Project changed. Session scenarios restored; prepare this project explicitly.'
        : 'Physical inputs changed (including usable area or modeled operation). Previous output is stale; review clear volumes/free areas and run again.');
      project = nextProject; session();
      if (switched) inventory = null;
      else if (nextInventory) inventory = nextInventory;
      if (changed || navigated) buildPreview();
      return { switched, changed };
    }
    function capture() {
      try {
        const nextProject = bridge.getProject();
        const scene = frozen(copy(bridge.getDrawingScene()));
        const nextInventory = foundation().discover(scene);
        if (nextInventory.projectId !== nextProject.id) throw new Error('Project and drawing scene identities disagree. Reload the project bridge.');
        adopt(nextProject, nextInventory);
        inventory = nextInventory;
        return { scene, inventory: nextInventory };
      } catch (cause) {
        invalidate('Physical inputs could not be verified. Current output revoked; prepare again.');
        inventory = null; error = cause.message || String(cause); notify(); throw cause;
      }
    }
    function sync() {
      if (disposed) return false;
      try {
        const nextProject = bridge.getProject();
        if (nextProject.id !== project.id) adopt(nextProject);
        else if (inventory || busy || result) capture();
        else adopt(nextProject);
        notify(); return true;
      } catch (cause) {
        invalidate('Project inputs could not be verified. Output revoked; prepare again.');
        inventory = null; error = cause.message; notify(); return false;
      }
    }
    const unsubscribe = bridge.subscribe?.(sync);
    function getState() {
      const data = session();
      return {
        projectId: project.id, revision: project.revision, floorId: project.activeFloorId,
        floors: (project.floors || []).map(floor => ({ id: floor.id, name: floor.name })),
        selectedScenarioId: data.selected,
        scenarios: [...data.drafts].map(([id, value]) => ({ id, label: value.label || id })),
        draft: copy(draft()), inventory, result, preview, busy, error, previewError, message,
        preparedInputs: data.preparedInputs.get(data.selected) || null,
        projectWeather: runtime.HomePlannerAirflowInputs?.weather(project) || null,
        displayStatus: describeDisplay({ inventory, result, preview, previewError, error, busy,
          floorId: project.activeFloorId, draft: draft() }),
        history: data.history.map(item => ({ id: item.id, label: item.result.scenario.label || item.result.scenario.id,
          status: item.result.status, revision: item.result.provenance.revision })),
        baselineId: data.baseline?.id || null,
        comparison: data.baseline && result ? foundation().compare(data.baseline.result, result) : null
      };
    }
    function attempt(action) {
      try {
        if (disposed) throw new Error('Airflow workbench is disposed.');
        // Forms stay usable before any geometry capture.
        if (bridge.getProject().id !== project.id) adopt(bridge.getProject());
        const value = action(); error = ''; notify(); return value;
      } catch (cause) { error = cause.message || String(cause); notify(); return null; }
    }
    function replaceDraft(value) {
      const normalized = foundation().normalizeScenario(value);
      if (canonical(normalized) !== canonical(draft())) {
        invalidate('Scenario changed. Run explicitly to update results.');
        session().drafts.set(session().selected, normalized); buildPreview();
      }
      return copy(normalized);
    }
    function edit(action) { return attempt(() => { const value = copy(draft()); action(value); return replaceDraft(value); }); }
    function lookup(collection, ref) {
      if (!inventory) throw new Error('Prepare inventory first. No geometry or outside adjacency is invented.');
      const value = inventory[collection].find(item => refKey(item.ref) === refKey(ref));
      if (!value) throw new Error('This exact floor/object reference is unavailable. Prepare inventory and choose again.');
      return value;
    }
    function endpoints(opening, value = draft()) {
      if (opening.adjacencyStatus !== 'known' || !opening.candidateAdjacency) return [];
      return opening.candidateAdjacency.map(candidate => candidate.kind === 'outside' ? 'outside'
        : value.zones.find(zone => refKey(zone.room) === refKey(candidate))?.id || null);
    }
    function selectScenario(id) {
      return attempt(() => {
        if (!session().drafts.has(id)) throw new Error('Choose an existing scenario.');
        if (session().selected !== id) { invalidate('Scenario selected. Run explicitly.'); session().selected = id; buildPreview(); }
        return true;
      });
    }
    function prepare() {
      return attempt(() => {
        capture(); message = inventory.rooms.length
          ? `${inventory.rooms.length} rooms and ${inventory.openings.length} openings found. Geometry inventory only — no airflow analysis. Review the scenario inputs below.`
          : 'No room geometry found. Add and place rooms in Design → Layout, then prepare again; no airflow analysis was run.';
        buildPreview(); return inventory;
      });
    }
    function prepareHouse(captured, useAreas = false) {
      const inputs = runtime.HomePlannerAirflowInputs;
      if (!inputs?.build) throw new Error('Load planner-airflow-inputs.js to use whole-house plan inputs.');
      let prepared = inputs.build(captured.inventory, captured.scene, project, draft(),
        session().preparedInputs.get(session().selected));
      if (useAreas) prepared = inputs.useOpeningAreas(prepared);
      replaceDraft(prepared.scenario);
      session().preparedInputs.set(session().selected, frozen(prepared));
      return prepared;
    }
    function useWholeHouse(useAreas = false) {
      return attempt(() => {
        const prepared = prepareHouse(capture(), useAreas);
        message = `Whole house selected: ${prepared.scenario.zones.length} rooms, ${prepared.scenario.links.length} links. ` +
          `${prepared.volumes.filter(row => row.volumeM3 !== null).length} plan-volume estimates; manual overrides retained. ` +
          'Review remaining flow inputs, then Run scenario.';
        buildPreview(); return prepared;
      });
    }
    async function run() {
      let token;
      try {
        if (disposed) throw new Error('Airflow workbench is disposed.');
        cancelWork();
        const captured = capture();
        if (session().preparedInputs.has(session().selected)) prepareHouse(captured);
        const scenario = foundation().normalizeScenario(draft());
        const scenarioKey = canonical(scenario), projectId = project.id;
        if (!runtime.HomePlannerAirflowRunner?.createRunner)
          throw new Error('Airflow worker runner unavailable. Load planner-airflow-runner.js and enable Workers; there is no main-thread fallback.');
        if (!runner) runner = runtime.HomePlannerAirflowRunner.createRunner(runtime);
        result = null; preview = null; error = ''; busy = true; token = ++generation;
        message = 'Running an explicit selected-network pressure calculation in a worker…';
        buildPreview(); notify();
        const timeoutMs = 120000;
        const timeout = new Promise((_, reject) => {
          timer = (runtime.setTimeout || root.setTimeout)(() => {
            if (token === generation) {
              reject(new Error('Airflow worker timed out. Reduce the selected network or retry; no fallback result was generated.'));
              try { runner.cancel(); } catch (_) { /* Timeout already rejects. */ }
            }
          }, timeoutMs);
        });
        const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
        const output = await Promise.race([runner.run({ scene: captured.scene, scenario,
          expectedPhysicalFingerprint: captured.inventory.physicalFingerprint }), timeout, cancelled]);
        if (disposed || token !== generation) return null;
        clearTimer(); rejectCancelled = null;
        // Re-read actual geometry, not revision or a supplied cache fingerprint, at publication.
        const latest = capture();
        if (token !== generation || project.id !== projectId || canonical(draft()) !== scenarioKey ||
            latest.inventory.physicalFingerprint !== captured.inventory.physicalFingerprint) { notify(); return null; }
        if (output?.kind !== 'AirflowResult' || output.provenance?.projectId !== projectId ||
            output.provenance.physicalFingerprint !== captured.inventory.physicalFingerprint ||
            canonical(output.scenario) !== scenarioKey)
          throw new Error('Worker returned a mismatched snapshot. Result discarded; reload the worker and retry.');
        busy = false; result = frozen(copy(output));
        const history = session().history;
        history.push({ id: nextId('snapshot'), result });
        if (history.length > HISTORY_LIMIT) history.shift();
        message = result.status === 'converged' && result.balanced ? 'Converged selected-network result. Not CFD.'
          : result.status === 'blocked' ? 'Inputs needed before airflow can be calculated. Review Findings below.'
            : `${readableValue(result.status)}: diagnostic only — not a balanced ventilation assessment. Review Findings below.`;
        buildPreview(); notify(); return result;
      } catch (cause) {
        if (token !== undefined && (disposed || token !== generation)) return null;
        clearTimer(); rejectCancelled = null; busy = false; result = null; preview = null;
        error = cause.message || String(cause); message = 'No current result. Correct inputs or worker availability and run again.';
        buildPreview(); notify(); return null;
      }
    }
    function exportData(kind) {
      return attempt(() => {
        sync();
        const BlobClass = runtime.Blob || root.Blob;
        if (!BlobClass) throw new Error('Local Blob downloads are unavailable in this browser.');
        let text, mime;
        if (kind === 'scenario') { text = JSON.stringify(draft(), null, 2); mime = 'application/json'; }
        else {
          if (!result || busy) throw new Error('Run the current scenario before exporting current evidence.');
          if (kind === 'json') { text = JSON.stringify(result, null, 2); mime = 'application/json'; }
          else if (kind === 'csv') { text = csv(result); mime = 'text/csv;charset=utf-8'; }
          else if (kind === 'svg' && preview?.svg) { text = preview.svg; mime = 'image/svg+xml'; }
          else throw new Error('Choose JSON, CSV, or an available SVG preview.');
        }
        return { blob: new BlobClass([text], { type: mime }),
          fileName: `airflow-${kind === 'scenario' ? 'scenario' : 'evidence'}.${kind === 'scenario' ? 'json' : kind}` };
      });
    }
    return {
      getState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      sync, prepare, run, exportData, useWholeHouse,
      useOpeningAreaEstimates() { return useWholeHouse(true); },
      useProjectWeather() {
        return attempt(() => {
          const weather = runtime.HomePlannerAirflowInputs?.weather(bridge.getProject());
          if (!weather) throw new Error('Load planner-airflow-inputs.js to read saved project weather.');
          message = weather.message; return weather;
        });
      },
      cancel() { invalidate('Cancelled. No new result was published.'); buildPreview(); notify(); },
      clearResult() {
        invalidate('Result cleared. Scenario inputs and inventory are retained; Run scenario to recalculate.');
        buildPreview(); notify();
      },
      setDraft(patch) { return edit(value => Object.assign(value, patch)); },
      replaceDraft(value) { return attempt(() => replaceDraft(value)); },
      selectScenario,
      addScenario(label = 'New scenario', clone = false) {
        return attempt(() => {
          if (session().drafts.size >= SCENARIO_LIMIT) throw new Error(`Keep at most ${SCENARIO_LIMIT} session scenarios per project.`);
          const value = clone ? { ...copy(draft()), id: nextId('scenario'), label } : newScenario(label);
          const normalized = foundation().normalizeScenario(value), id = value.id;
          const prepared = clone && session().preparedInputs.get(session().selected);
          if (prepared) session().preparedInputs.set(id, frozen({ ...copy(prepared), scenario: normalized }));
          session().drafts.set(id, normalized); selectScenario(id); return id;
        });
      },
      renameScenario(label) { return edit(value => { value.label = label; }); },
      deleteScenario(id, confirmed = false) {
        return attempt(() => {
          if (!confirmed) throw new Error('Confirm deletion of this session scenario.');
          if (!session().drafts.has(id)) throw new Error('Scenario no longer exists.');
          if (session().drafts.size === 1) throw new Error('Keep at least one scenario.');
          if (session().selected === id) selectScenario([...session().drafts.keys()].find(key => key !== id));
          session().drafts.delete(id); session().preparedInputs.delete(id); return true;
        });
      },
      importScenario(text, append = false) {
        return attempt(() => {
          if (typeof text !== 'string' || text.length > IMPORT_LIMIT) throw new Error(`Scenario JSON must be text under ${IMPORT_LIMIT} characters.`);
          const value = foundation().normalizeScenario(JSON.parse(text));
          if (!append) {
            const replaced = replaceDraft(value);
            session().preparedInputs.delete(session().selected);
            return replaced;
          }
          if (session().drafts.size >= SCENARIO_LIMIT) throw new Error('Scenario limit reached; delete a session scenario first.');
          const id = nextId('scenario');
          session().drafts.set(id, value); selectScenario(id); return copy(value);
        });
      },
      addRoom(ref) {
        return edit(value => {
          const room = lookup('rooms', ref);
          value.zones.push({ id: nextId('room'), room: copy(room.ref), volumeM3: null, volumeSource: null });
        });
      },
      updateZone(id, patch) {
        return edit(value => {
          const zone = value.zones.find(item => item.id === id);
          if (!zone) throw new Error('Zone no longer exists.');
          if (Object.hasOwn(patch, 'volumeM3') && !Object.hasOwn(patch, 'volumeSource') &&
              session().preparedInputs.get(session().selected)?.volumes.some(row => row.zoneId === id))
            zone.volumeSource = 'User-supplied clear-volume override';
          Object.assign(zone, patch);
        });
      },
      removeZone(id) {
        const value = edit(value => { value.zones = value.zones.filter(item => item.id !== id); });
        if (value) { session().preparedInputs.delete(session().selected); notify(); }
        return value;
      },
      openingEndpoints(ref) { return attempt(() => endpoints(lookup('openings', ref))); },
      addOpening(ref) {
        return edit(value => {
          const opening = lookup('openings', ref), pair = endpoints(opening, value);
          if (pair.length !== 2 || pair.some(id => id === null))
            throw new Error('Add both physically adjacent rooms first. Unknown adjacency cannot be replaced by outside.');
          value.links.push({ id: nextId('opening'), kind: 'opening', opening: copy(opening.ref),
            from: pair[0], to: pair[1], enabled: false, freeAreaM2: null, cd: null, pressurePa: null, notes: null });
        });
      },
      addManual() {
        return edit(value => value.links.push({ id: nextId('manual'), kind: 'manual',
          enabled: false, freeAreaM2: null, cd: null, pressurePa: null, openFraction: null, notes: null }));
      },
      updateLink(id, patch) {
        return edit(value => {
          const link = value.links.find(item => item.id === id);
          if (!link) throw new Error('Link no longer exists.');
          if (Object.hasOwn(patch, 'freeAreaM2') && !Object.hasOwn(patch, 'notes') &&
              session().preparedInputs.get(session().selected)?.openingAreas.some(row => row.linkId === id && row.applied))
            link.notes = 'User-supplied operating free-area override';
          Object.assign(link, patch);
        });
      },
      removeLink(id) {
        const value = edit(value => { value.links = value.links.filter(item => item.id !== id); });
        if (value) { session().preparedInputs.delete(session().selected); notify(); }
        return value;
      },
      setAnchor(id, side, field, value) {
        return edit(scenario => {
          if (!['from', 'to'].includes(side) || !['floorId', 'x', 'y', 'z'].includes(field))
            throw new Error('Choose an explicit anchor floor or coordinate.');
          const link = scenario.links.find(item => item.id === id);
          if (link?.kind !== 'manual') throw new Error('Only manual links have authored anchors.');
          link.anchors ||= {}; link.anchors[side] ||= {};
          if (field === 'floorId') link.anchors[side].floorId = value || null;
          else { link.anchors[side].point ||= {}; link.anchors[side].point[field] = numeric(value); }
        });
      },
      applyOperation(ref, fraction, confirmed = false) {
        return attempt(() => {
          if (!confirmed) throw new Error('Confirm the modeled-operation change. It mutates the physical project, not just this scenario.');
          capture();
          const opening = lookup('openings', ref), value = numeric(fraction);
          if (value === null || value < 0 || value > 1) throw new Error('Modeled open fraction must be explicitly between 0 and 1.');
          if (opening.ref.floorId !== project.activeFloorId)
            throw new Error('Switch to this opening’s floor in Design before applying modeled operation. No hidden floor navigation is performed.');
          if (!bridge.execute || !operationCommand(opening.kind))
            throw new Error('This opening cannot be edited here. Use Design → Layout to edit its modeled operation.');
          bridge.execute({ type: operationCommand(opening.kind),
            id: opening.ref.entityId, openFraction: value });
          sync(); message = 'Modeled operation changed explicitly. Undo is available in Design. Review free area and run again.';
          return true;
        });
      },
      pinBaseline(id) {
        return attempt(() => {
          const snapshot = session().history.find(item => item.id === id);
          if (!snapshot) throw new Error('Choose an available result snapshot.');
          session().baseline = snapshot; return true;
        });
      },
      clearBaseline() { session().baseline = null; notify(); },
      dispose() {
        cancelWork(); disposed = true; runner?.dispose(); unsubscribe?.();
        listeners.clear(); projects.clear(); inventory = result = preview = null;
      }
    };
  }

  function mount(doc = root.document) {
    const host = doc?.getElementById('workspaceAirflow');
    if (!host || host.homePlannerAirflow) return host?.homePlannerAirflow || null;
    const runtime = doc.defaultView || root;
    let controller;
    try { controller = createController(runtime.HomePlanner, runtime); }
    catch (cause) { host.textContent = cause.message; return null; }
    const el = (tag, text = '', className = '') => {
      const node = doc.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
    };
    const action = (text, id, callback) => {
      const node = el('button', text); node.type = 'button'; if (id) node.id = id;
      node.addEventListener('click', callback); return node;
    };
    const section = title => {
      const node = el('details'); node.append(el('summary', title)); return node;
    };
    let fieldSerial = 0;
    function field(parent, label, value, callback, options = null, type = 'text', id = '', help = '') {
      const wrapper = el('label', label), input = el(options ? 'select' : 'input');
      input.id = id || `hp-airflow-field-${++fieldSerial}`; wrapper.htmlFor = input.id;
      if (options) {
        for (const [key, text] of options) { const option = el('option', text); option.value = key; input.append(option); }
        if (value != null && value !== '' && !options.some(([key]) => key === value)) {
          const option = el('option', 'Unavailable — retained selection'); option.value = value; input.append(option);
        }
      } else { input.type = type; if (type === 'number') { input.step = 'any'; input.inputMode = 'decimal'; input.placeholder = 'Not supplied'; } }
      if (type === 'checkbox') input.checked = value === true; else input.value = value ?? '';
      input.addEventListener('change', () => {
        const restore = () => { if (type === 'checkbox') input.checked = value === true; else input.value = value ?? ''; };
        try {
          if (type === 'number' && input.validity?.badInput) throw new TypeError('Enter a complete finite decimal number.');
          if (callback(type === 'checkbox' ? input.checked : input.value) === null) restore();
        }
        catch (cause) { restore(); showError(`${cause.message} Change was not applied.`); }
      });
      wrapper.append(input);
      if (help) {
        const note = el('small', help, 'hp-airflow-input-help'); note.id = `${input.id}-help`;
        input.setAttribute('aria-describedby', note.id); wrapper.append(note);
      }
      parent.append(wrapper); return input;
    }
    const showError = text => { error.textContent = text; error.hidden = !text; };
    host.classList.add('hp-airflow');
    const header = el('div', '', 'hp-airflow-header');
    header.append(el('h2', 'Airflow workbench'), el('p', 'Optional pressure network + 2D velocity estimate · Not CFD or measured room airspeed. No airflow inputs are needed to export a floor plan.', 'hp-airflow-warning'));
    const toolbar = el('div', '', 'hp-airflow-toolbar');
    const wholeHouse = action('Use whole house', 'hp-airflow-whole-house', () => {
      if (controller.useWholeHouse()) settings.open = true;
    });
    const prepare = action('Prepare inventory', 'hp-airflow-prepare', () => {
      if (controller.prepare()) settings.open = true;
    });
    const run = action('Run scenario', 'hp-airflow-run', () => controller.run());
    const cancel = action('Cancel', 'hp-airflow-cancel', () => controller.cancel());
    const clear = action('Clear result', 'hp-airflow-clear', () => controller.clearResult());
    const reviewInputs = action('Review scenario inputs', 'hp-airflow-inputs', () => {
      settings.open = true; settings.children[0].focus();
    });
    const status = el('p', '', 'hp-airflow-status'); status.id = 'hp-airflow-status'; status.setAttribute('role', 'status');
    const error = el('p', '', 'hp-airflow-error'); error.id = 'hp-airflow-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    toolbar.append(wholeHouse, prepare, run, cancel, clear, reviewInputs);
    const topFields = el('div', '', 'hp-airflow-top-fields');
    const scenarioSelect = field(topFields, 'Scenario', '', id => controller.selectScenario(id), [], 'text', 'hp-airflow-scenario');
    const floorSelect = field(topFields, 'Preview floor', '', id => {
      if (!runtime.HomePlanner?.execute) throw new Error('Floor navigation requires the project bridge.');
      runtime.HomePlanner.execute({ type: 'select-floor', id });
    }, [], 'text', 'hp-airflow-floor');
    const preview = el('div', '', 'hp-airflow-preview'); preview.id = 'hp-airflow-preview';
    preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', 'Airflow plan preview, with accessible result tables below');
    const displayStatus = el('p', '', 'hp-airflow-view-status'); displayStatus.id = 'hp-airflow-view-status';
    displayStatus.setAttribute('role', 'status');
    const legend = el('p', '', 'hp-airflow-legend');
    const settings = section('Scenario, rooms & opening inputs');
    const forms = el('div', '', 'hp-airflow-forms'); settings.append(forms);
    const findingsSection = section('Findings & limitations'), findings = el('ul');
    findingsSection.append(findings);
    const tablesSection = section('Room & opening result tables'), tables = el('div'); tablesSection.append(tables);
    const evidence = section('Compare scenarios & download evidence'), evidenceBody = el('div'); evidence.append(evidenceBody);
    const expert = section('Technical details — scenario JSON import / export');
    const jsonLabel = el('label', 'Scenario JSON (maximum 1,000,000 characters; replacement is atomic)');
    const json = el('textarea'); json.id = 'hp-airflow-json'; json.rows = 8; json.maxLength = IMPORT_LIMIT;
    jsonLabel.htmlFor = json.id; jsonLabel.append(json);
    expert.append(jsonLabel, action('Replace current draft', 'hp-airflow-import', () => controller.importScenario(json.value)),
      action('Append as another scenario', '', () => controller.importScenario(json.value, true)),
      action('Export scenario JSON', '', () => download('scenario')));
    const links = el('div', '', 'hp-airflow-links');
    for (const [workspace, sectionName, label] of [['design', 'layout', 'Edit physical model in Design'],
      ['report', 'drawings', 'Open Report exports']]) {
      const link = el('a', label); link.href = `?workspace=${workspace}&section=${sectionName}`;
      link.dataset.workspace = workspace; link.dataset.section = sectionName; links.append(link);
    }
    host.replaceChildren(header, toolbar, topFields, status, error, displayStatus, preview, legend, settings,
      findingsSection, tablesSection, evidence, expert, links);
    let imageURL = null, downloadURLs = new Set(), lastSVG = null, formsKey = '', imageError = '', lastResult = null;
    function revokeDownloads() {
      for (const url of downloadURLs) runtime.URL.revokeObjectURL(url);
      downloadURLs.clear();
    }
    function download(kind) {
      const data = controller.exportData(kind);
      if (!data) return;
      try {
        const url = runtime.URL.createObjectURL(data.blob); downloadURLs.add(url);
        const anchor = el('a'); anchor.href = url; anchor.download = data.fileName;
        host.append(anchor); anchor.click(); anchor.remove();
        (runtime.setTimeout || root.setTimeout)(() => {
          if (downloadURLs.delete(url)) runtime.URL.revokeObjectURL(url);
        }, 1000);
      } catch (cause) { showError(`Download unavailable: ${cause.message}`); }
    }
    function options(select, values, selected) {
      select.replaceChildren(...values.map(([value, label]) => {
        const option = el('option', label); option.value = value; return option;
      })); select.value = selected;
    }
    const labelRef = referenceLabel;
    const plain = readableValue;
    const endpointLabel = (id, state) => id === 'outside' ? 'Outside'
      : state.draft.zones.some(zone => zone.id === id)
        ? labelRef(state.draft.zones.find(zone => zone.id === id).room, state) : id ? 'Unavailable room — repair endpoint' : 'Not selected';
    function renderForms(state) {
      const focus = doc.activeElement;
      const focusKey = forms.contains(focus) ? focus?.dataset?.control : null;
      const disclosures = [...forms.querySelectorAll('details')].map(node => node.open);
      const key = canonical({ draft: state.draft, selected: state.selectedScenarioId, inventory: state.inventory?.physicalFingerprint,
        floor: state.floorId, project: state.projectId, weather: state.projectWeather, wholeHouse: !!state.preparedInputs });
      if (key === formsKey) return;
      formsKey = key; forms.replaceChildren();
      const controls = el('div', '', 'hp-airflow-fields');
      field(controls, 'Scenario name', state.draft.label, label => controller.renameScenario(label));
      controls.append(action('New scenario', '', () => controller.addScenario()),
        action('Clone scenario', '', () => controller.addScenario(`${state.draft.label || 'Scenario'} copy`, true)),
        action('Delete scenario', '', () => {
          if (runtime.confirm?.('Delete this session-only scenario?'))
            controller.deleteScenario(state.selectedScenarioId, true);
        }));
      field(controls, 'Air density (kg/m³) · blank = unknown', state.draft.densityKgM3,
        value => controller.setDraft({ densityKgM3: numeric(value) }), null, 'number', '', inputHelp.densityKgM3);
      field(controls, 'Scenario notes / assumptions', state.draft.notes,
        value => controller.setDraft({ notes: value.trim() || null }));
      field(controls, 'Calculate a 2D potential-flow velocity estimate', state.draft.planField?.enabled === true,
        enabled => controller.setDraft({ planField: { ...(controller.getState().draft.planField || { spacingM: .5 }), enabled } }),
        null, 'checkbox', 'hp-airflow-field-enabled');
      field(controls, 'Maximum numerical field spacing (m)', state.draft.planField?.spacingM,
        value => controller.setDraft({ planField: { ...(controller.getState().draft.planField || { enabled: false }), spacingM: numeric(value) } }),
        null, 'number', 'hp-airflow-field-spacing');
      forms.append(el('p', 'The 2D field is a depth-averaged potential-flow estimate, not validated CFD. Its uniform depth is your declared clear room volume divided by the current usable floor area. It omits turbulence, jet mixing and furniture drag.'));
      const sources = section('Optional input sources');
      for (const name of ['densityKgM3', 'freeAreaM2', 'cd', 'pressurePa', 'openFraction'])
        field(sources, `${inputNames[name]} source`, state.draft.sources?.[name], value =>
          controller.setDraft({ sources: { ...(state.draft.sources || {}), [name]: value.trim() || null } }));
      forms.append(controls, sources, el('h3', 'Selected rooms'));
      if (state.projectWeather) {
        const weather = section('Project wind reference');
        weather.append(el('p', state.projectWeather.message),
          action('Use project weather reference', 'hp-airflow-project-weather', () => controller.useProjectWeather()));
        forms.append(weather);
      }
      const roomChoices = [['', 'Choose an exact room on any floor'], ...(state.inventory?.rooms || [])
        .filter(room => !state.draft.zones.some(zone => refKey(zone.room) === refKey(room.ref)))
        .map(room => [refKey(room.ref), labelRef(room.ref, state)])];
      let roomChoice = '';
      field(forms, 'Room to add', '', value => { roomChoice = value; }, roomChoices);
      forms.append(action('Add room', 'hp-airflow-add-room', () => {
        if (!roomChoice) return showError('Choose a room first; prepare inventory if the list is empty.');
        const [floorId, entityId] = JSON.parse(roomChoice); controller.addRoom({ floorId, entityId });
      }));
      for (const zone of state.draft.zones) {
        const row = el('fieldset', '', 'hp-airflow-fields');
        row.append(el('legend', labelRef(zone.room, state)));
        field(row, 'Clear room volume (m³) · blank = unknown', zone.volumeM3,
          value => controller.updateZone(zone.id, { volumeM3: numeric(value) }), null, 'number', '', inputHelp.volumeM3);
        field(row, 'Volume source / note', zone.volumeSource,
          value => controller.updateZone(zone.id, { volumeSource: value.trim() || null }));
        const refs = [['', 'Unknown / missing room'], ...(state.inventory?.rooms || [])
          .map(room => [refKey(room.ref), labelRef(room.ref, state)])];
        field(row, 'Exact room reference', refKey(zone.room), value => {
          const ref = value ? JSON.parse(value) : null;
          controller.updateZone(zone.id, { room: ref ? { floorId: ref[0], entityId: ref[1] } : null });
        }, refs);
        row.append(action('Remove room (retain links for repair)', '', () => controller.removeZone(zone.id)));
        forms.append(row);
      }
      forms.append(el('h3', 'Selected opening links'), el('p',
        state.preparedInputs ? 'Whole-house selection includes known adjacent openings. Closed openings stay disabled; review remaining flow inputs.'
          : 'Add both adjacent rooms first. New manual selections are disabled until enabled.'));
      if (state.preparedInputs) forms.append(
        action('Use geometric opening areas (estimate)', 'hp-airflow-plan-areas', () => controller.useOpeningAreaEstimates()),
        el('p', 'Optional upper-bound areas from the current opening size and fraction; not verified aerodynamic free areas. Supplied values are preserved.'));
      let openingChoice = '';
      field(forms, 'Known opening to add', '', value => { openingChoice = value; }, [
        ['', 'Choose a known physical opening'], ...(state.inventory?.openings || [])
          .filter(opening => opening.adjacencyStatus === 'known' &&
            !state.draft.links.some(link => refKey(link.opening) === refKey(opening.ref)))
          .map(opening => [refKey(opening.ref), `${labelRef(opening.ref, state, 'openings')} (${opening.kind})`])
      ]);
      forms.append(action('Add opening link', 'hp-airflow-add-opening', () => {
        if (!openingChoice) return showError('Choose a known opening first. Unknown adjacency cannot be assumed exterior.');
        const [floorId, entityId] = JSON.parse(openingChoice); controller.addOpening({ floorId, entityId });
      }), action('Add explicit manual connection', 'hp-airflow-add-manual', () => controller.addManual()));
      const allEndpoints = [['', 'Choose endpoint explicitly'], ['outside', 'Outside'],
        ...state.draft.zones.map(zone => [zone.id, labelRef(zone.room, state)])];
      for (const link of state.draft.links) {
        const row = el('fieldset', '', 'hp-airflow-fields');
        row.append(el('legend', link.kind === 'manual' ? `Manual connection ${state.draft.links.indexOf(link) + 1}` : labelRef(link.opening, state, 'openings')));
        const opening = state.inventory?.openings.find(item => refKey(item.ref) === refKey(link.opening));
        const compatible = opening?.adjacencyStatus === 'known' ? opening.candidateAdjacency.map(candidate =>
          candidate.kind === 'outside' ? 'outside' : state.draft.zones.find(zone => refKey(zone.room) === refKey(candidate))?.id) : [];
        const endpoints = link.kind === 'manual' ? allEndpoints : allEndpoints.filter(([id]) => !id || compatible.includes(id));
        for (const side of ['from', 'to']) field(row, `${side === 'from' ? 'From' : 'To'} zone (positive flow orientation)`,
          link[side], value => controller.updateLink(link.id, { [side]: value || null }), endpoints);
        row.append(action('Reverse from / to orientation', '', () =>
          controller.updateLink(link.id, { from: link.to ?? null, to: link.from ?? null })));
        row.append(el('p', 'Reversing endpoints does not change the supplied forcing sign. Review signed pressure explicitly.'));
        field(row, 'Enabled — include this link', link.enabled, value => controller.updateLink(link.id, { enabled: value }), null, 'checkbox');
        if (link.enabled === undefined) row.append(
          el('p', 'Enablement is unspecified, not disabled. Explicitly enable the link or set it disabled.'),
          action('Set link explicitly disabled', '', () => controller.updateLink(link.id, { enabled: false })));
        for (const [key, label] of [['freeAreaM2', 'Operating free area (m²)'], ['cd', 'Discharge coefficient (0 < Cd ≤ 1)'],
          ['pressurePa', 'Signed from → to forcing (Pa)']])
          field(row, `${label} · blank = unknown`, link[key],
            value => controller.updateLink(link.id, { [key]: numeric(value) }), null, 'number', '', inputHelp[key]);
        field(row, 'Link notes / assumptions', link.notes,
          value => controller.updateLink(link.id, { notes: value.trim() || null }));
        if (link.kind === 'opening') {
          const current = opening?.operation?.openFraction;
          row.append(el('p', `Compiled gross area: ${plain(opening?.grossAreaM2)} m². Modeled open fraction: ${plain(current)}. ` +
            `Area cap: ${plain(current != null && opening?.grossAreaM2 != null ? current * opening.grossAreaM2 : null)} m² (read-only).`));
          if (current === 0) row.append(el('p', 'Modeled closed: positive free area is blocked. Explicitly edit modeled operation, set zero area, or disable.', 'hp-airflow-warning'));
          if (current == null) field(row, 'Unknown modeled state: explicit scenario open fraction (0–1)',
            link.openFraction, value => controller.updateLink(link.id, { openFraction: numeric(value) }), null, 'number');
          else if (link.openFraction != null) {
            row.append(el('p', `Retained scenario fraction: ${link.openFraction}; it cannot override the model.`),
              action('Clear retained scenario fraction', '', () => controller.updateLink(link.id, { openFraction: null })));
          }
          const operation = section('Edit modeled operation — physical project change');
          let nextFraction = '';
          field(operation, 'New modeled open fraction (0–1; affects every scenario)', '', value => { nextFraction = value; }, null, 'number');
          const apply = action('Apply operation to model…', '', () => {
            if (runtime.confirm?.(`Change physical modeled operation from ${plain(current)} to ${nextFraction || 'unknown'}? This edits the project for every scenario. It does not derive free area.`))
              controller.applyOperation(link.opening, nextFraction, true);
          });
          apply.disabled = !opening || opening.ref.floorId !== state.floorId || !operationCommand(opening.kind) || !runtime.HomePlanner?.execute;
          operation.append(apply, el('p', 'Different floor or unsupported opening? Use Design / Layout on its exact floor; then prepare and review again.'));
          row.append(operation);
        } else {
          row.append(el('p', 'Manual intent only: no shaft, penetration, containment or buoyancy is inferred. All anchor coordinates are absolute site-local metres.'));
          field(row, 'Explicit manual operating fraction (0–1)', link.openFraction,
            value => controller.updateLink(link.id, { openFraction: numeric(value) }), null, 'number');
          for (const side of ['from', 'to']) {
            field(row, `${side} anchor floor`, link.anchors?.[side]?.floorId,
              value => controller.setAnchor(link.id, side, 'floorId', value),
              [['', 'Choose registered floor'], ...state.floors.map(floor => [floor.id, floor.name])]);
            for (const axis of ['x', 'y', 'z']) field(row, `${side} anchor ${axis} (absolute site-local m)`,
              link.anchors?.[side]?.point?.[axis], value => controller.setAnchor(link.id, side, axis, value), null, 'number');
          }
        }
        row.append(action('Remove link', '', () => controller.removeLink(link.id))); forms.append(row);
      }
      // Restore keyboard position after controlled form updates; disclosure state is retained separately.
      [...forms.querySelectorAll('input,select,button')].forEach((node, index) => { node.dataset.control = String(index); });
      [...forms.querySelectorAll('details')].forEach((node, index) => { node.open = disclosures[index] || false; });
      if (focusKey) forms.querySelector(`[data-control="${focusKey}"]`)?.focus();
    }
    function table(title, columns, rows) {
      const region = el('div', '', 'hp-airflow-table-region'); region.tabIndex = 0;
      region.setAttribute('role', 'region'); region.setAttribute('aria-label', title);
      const node = el('table'), head = el('thead'), header = el('tr'), body = el('tbody');
      node.append(el('caption', title));
      columns.forEach(([label]) => { const cell = el('th', label); cell.scope = 'col'; header.append(cell); });
      head.append(header);
      let page = 0;
      function paint() {
        body.replaceChildren();
        for (const row of rows.slice(page * 100, (page + 1) * 100)) {
          const tr = el('tr'); columns.forEach(([, getter]) => {
            const value = getter(row);
            tr.append(el('td', plain(value), typeof value === 'number' ? 'hp-airflow-number' : ''));
          }); body.append(tr);
        }
      }
      node.append(head, body); region.append(node); paint();
      if (rows.length > 100) {
        const caption = el('p'), previous = action('Previous rows', '', () => { page--; update(); });
        const next = action('Next rows', '', () => { page++; update(); });
        function update() {
          paint(); previous.disabled = page === 0; next.disabled = (page + 1) * 100 >= rows.length;
          caption.textContent = `Rows ${page * 100 + 1}–${Math.min((page + 1) * 100, rows.length)} of ${rows.length}; exports retain all cells.`;
        }
        region.append(caption, previous, next); update();
      }
      return region;
    }
    function render(state) {
      status.textContent = readableMessage(state.message, state);
      displayStatus.textContent = readableMessage(state.displayStatus.message, state);
      displayStatus.setAttribute('data-state', state.displayStatus.code);
      showError([...new Set([state.error, state.previewError, imageError].filter(Boolean))].map(text => readableMessage(text, state)).join(' '));
      run.disabled = state.busy; cancel.disabled = !state.busy; prepare.disabled = state.busy;
      wholeHouse.disabled = state.busy;
      clear.disabled = !state.result && !state.busy;
      host.setAttribute('aria-busy', String(state.busy));
      options(scenarioSelect, state.scenarios.map(item => [item.id, item.label]), state.selectedScenarioId);
      options(floorSelect, state.floors.map(item => [item.id, item.name]), state.floorId);
      const svg = state.preview?.svg || null;
      if (svg !== lastSVG) {
        if (imageURL) runtime.URL.revokeObjectURL(imageURL);
        imageURL = null; imageError = ''; lastSVG = svg; preview.replaceChildren();
        if (svg) {
          const failed = message => {
            imageError = `Plan image unavailable: ${message}. Use the result tables below, then Prepare inventory to retry.`;
            preview.replaceChildren(el('p', imageError)); showError(imageError);
            if (imageURL) runtime.URL.revokeObjectURL(imageURL);
            imageURL = null; lastSVG = undefined;
          };
          try {
            imageURL = runtime.URL.createObjectURL(new runtime.Blob([svg], { type: 'image/svg+xml' }));
            const image = el('img'); image.src = imageURL;
            image.alt = state.result?.planField ? 'Computed 2D depth-averaged potential-flow velocity field, physical walls and openings. Not validated CFD; exact values and assumptions are in the tables.'
              : state.result ? 'Symbolic airflow opening directions on this floor. Read exact signed results in the tables below.'
              : 'Prepared room and opening inventory. No flow has been calculated and no flow arrows are shown.';
            image.addEventListener('error', () => { if (preview.contains(image)) failed('the SVG could not load'); });
            preview.append(image);
          } catch (cause) { failed(cause.message); }
        }
      }
      if (!svg) preview.textContent = readableMessage(state.previewError || state.displayStatus.message, state);
      showError([...new Set([state.error, state.previewError, imageError].filter(Boolean))].map(text => readableMessage(text, state)).join(' '));
      legend.textContent = state.preview?.legend ? state.preview.legend.map(item =>
        readableMessage(typeof item === 'string' ? item : item.label || item.message, state)).join(' · ')
        : 'Symbolic diagram, not a physical-scale drawing. Unknown inputs are never replaced with defaults.';
      if (!state.result) revokeDownloads();
      renderForms(state);
      findings.replaceChildren();
      for (const finding of visibleFindings(state)) findings.append(el('li', finding));
      if (state.result && state.result !== lastResult && (!state.result.balanced || state.result.planField?.status === 'unavailable')) {
        findingsSection.open = true; settings.open = true;
      }
      lastResult = state.result;
      tables.replaceChildren();
      if (state.inventory) {
        const roomRows = (state.preview?.roomRows || state.result?.zoneResults ||
          state.inventory.rooms.map(room => ({ ...room, roomRef: room.ref }))).map(row => {
          if (state.result) return row;
          const zone = state.draft.zones.find(zone => refKey(zone.room) === refKey(row.roomRef));
          return { ...row, selected: !!zone, volumeM3: zone?.volumeM3 ?? null };
        });
        const openingRows = (state.preview?.openingRows || state.result?.flowResults ||
          state.inventory.openings.map(opening => ({ ...opening, openingRef: opening.ref }))).map(row => {
          if (state.result) return row;
          const link = state.draft.links.find(link => refKey(link.opening) === refKey(row.openingRef));
          return { ...row, selected: !!link, from: link?.from, to: link?.to,
            state: link ? link.enabled === false ? 'disabled' : 'not-run' : 'not-selected' };
        });
        const metric = (row, key) => row[key] ?? (row.selected === false || !state.result && !row.selected
          ? 'Not selected' : !state.result ? 'Not run' : state.result.status === 'blocked' ? 'Not calculated — inputs needed'
            : 'Unavailable — see Findings');
        tables.append(el('p', state.result
          ? `${plain(state.result.status)} · ${state.result.balanced ? 'Balanced selected network' : state.result.status === 'blocked' ? 'No flow calculated' : 'DIAGNOSTIC ONLY — not balanced'}`
          : 'Not run — inventory only. Select rooms and supply inputs before calculating.'),
          table('Rooms — Direct outside inflow ACH; not complete fresh-air delivery or a mixing estimate.', [
            ['Plan key', row => row.shortKey], ['Room', row => labelRef(row.roomRef, state)],
            ['Selected', row => row.selected ?? !!row.solverId],
            ['Clear volume (m³)', row => row.volumeM3 ?? (row.selected ? 'Needed to run' : 'Not supplied')], ['Pressure (Pa)', row => metric(row, 'pressurePa')],
            ['Pressure gauge', row => row.gauge || state.result?.components.find(component => component.zoneIds.includes(row.id))?.gauge],
            ['Inflow (m³/s)', row => metric(row, 'inflowM3s')], ['Outflow (m³/s)', row => metric(row, 'outflowM3s')],
            ['Direct outside inflow (m³/s)', row => metric(row, 'directOutsideInflowM3s')],
            ['Transfer inflow (m³/s)', row => metric(row, 'transferInflowM3s')],
            ['Direct outside ACH (1/h)', row => metric(row, 'directOutsideInflowACH')],
            ['Residual (m³/s)', row => metric(row, 'netOutflowM3s')], ['Mass residual (kg/s)', row => metric(row, 'massResidualKgS')],
            ['No active connections', row => row.sealed], ['Only one connection', row => row.deadEnd],
            ['Connected to outside', row => row.connectedToOutside]
          ], roomRows),
          table('Links — signed flow relative to authored from → to orientation', [
            ['Plan key', row => row.shortKey], ['Opening / connection', row => row.openingRef ? labelRef(row.openingRef, state, 'openings') : 'Manual connection'],
            ['From', row => endpointLabel(row.from, state)], ['To', row => endpointLabel(row.to, state)], ['State', row => row.state],
            ['Signed flow (m³/s)', row => metric(row, 'm3s')], ['Aperture-mean speed (m/s; NOT room airspeed)', row => row.meanOpeningSpeedMps ?? (row.effectiveAreaM2 === 0 ? 'Not applicable — zero area' : metric(row, 'meanOpeningSpeedMps'))],
            ['Free area (m²)', row => row.effectiveAreaM2], ['Numerical status', row => row.numericalStatus]
          ], openingRows));
        if (state.result?.planField) {
          tables.append(table('2D potential-flow cells — depth-averaged estimates, not measured room airspeeds', [
            ['Room', row => labelRef(row.roomRef, state)],
            ['Site x (m)', row => row.point.x], ['Site y (m)', row => row.point.y],
            ['x velocity estimate (m/s)', row => row.velocityMps.x], ['y velocity estimate (m/s)', row => row.velocityMps.y],
            ['Speed estimate (m/s)', row => row.speedMps], ['Conservation residual (m³/s)', row => row.conservationResidualM3s]
          ], state.preview?.fieldRows || state.result.planField.cells),
          table('2D room model depths — declared volume divided by actual usable area', [
            ['Room', row => labelRef(row.roomRef, state)], ['Usable area (m²)', row => row.usableAreaM2],
            ['Uniform model depth (m)', row => row.modelDepthM], ['Field status', row => row.status], ['Reason', row => row.message ? readableMessage(row.message, state) : 'No reported limitation']
          ], state.result.planField.rooms));
        }
      } else tables.append(el('p', 'No current numerical result. Prepare inventory and run an explicit scenario.'));
      evidenceBody.replaceChildren();
      let baselineChoice = state.baselineId || '';
      field(evidenceBody, 'Baseline snapshot (session only)', baselineChoice, value => { baselineChoice = value; },
        [['', 'Choose a previous explicit run'], ...state.history.map(item =>
          [item.id, `${item.label} · ${item.status} · revision ${item.revision}`])]);
      evidenceBody.append(action('Pin baseline', 'hp-airflow-pin', () => controller.pinBaseline(baselineChoice)),
        action('Clear baseline', '', () => controller.clearBaseline()));
      if (state.comparison) {
        evidenceBody.append(el('p', state.comparison.comparable
          ? 'Comparable physical inputs and room set. Deltas are current minus baseline.'
          : `No numerical comparison: ${state.comparison.reasons.map(reason => ({
            'physical-inputs-changed': 'physical geometry or operation changed', 'zone-selection-changed': 'selected rooms changed',
            'project-changed': 'different projects', 'unbalanced-results': 'a result is not balanced'
          })[reason] || reason.replace(/-/g, ' ')).join(', ')}.`));
        if (state.comparison.comparable) evidenceBody.append(table('Comparable room deltas', [
          ['Room', row => labelRef(row.roomRef, state)],
          ['Direct outside inflow Δ (m³/s)', row => row.directOutsideInflowM3s],
          ['Total inflow Δ (m³/s)', row => row.inflowM3s]
        ], state.comparison.zoneDeltas));
      }
      for (const [kind, title] of [['json', 'Download full result JSON'], ['csv', 'Download result CSV'], ['svg', 'Download symbolic SVG']]) {
        const button = action(title, `hp-airflow-export-${kind}`, () => download(kind));
        button.disabled = !state.result || state.busy || kind === 'svg' && !state.preview?.svg;
        evidenceBody.append(button);
      }
      const provenance = section('Technical details — exact references, diagnostics & solver evidence');
      provenance.append(el('p', 'Unrounded values, original diagnostic codes and full captured inputs are retained here and in downloads. Canonical keys are equality encodings, not cryptographic hashes.'),
        el('pre', JSON.stringify({
          draft: state.draft, inventory: state.inventory, result: state.result,
          roomRows: state.preview?.roomRows, openingRows: state.preview?.openingRows,
          fieldRows: state.preview?.fieldRows, legend: state.preview?.legend, warnings: state.preview?.warnings,
          comparison: state.comparison, error: state.error, previewError: state.previewError,
          preparedInputs: state.preparedInputs, projectWeather: state.projectWeather
        }, null, 2)));
      evidenceBody.append(provenance);
    }
    const unsubscribe = controller.subscribe(render);
    const onRoute = () => controller.sync();
    runtime.addEventListener?.('popstate', onRoute);
    doc.addEventListener('homeplanner:workspace-change', onRoute);
    const dispose = controller.dispose;
    controller.dispose = () => {
      unsubscribe(); runtime.removeEventListener?.('popstate', onRoute);
      doc.removeEventListener('homeplanner:workspace-change', onRoute); dispose();
      if (imageURL) runtime.URL.revokeObjectURL(imageURL);
      imageURL = null; revokeDownloads(); delete host.homePlannerAirflow; host.replaceChildren();
    };
    host.homePlannerAirflow = controller; render(controller.getState()); return controller;
  }
  return { createController, mount, numeric, csvCell, csv, IMPORT_LIMIT };
});
