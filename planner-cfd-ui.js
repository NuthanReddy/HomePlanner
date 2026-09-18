(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(root, common ? require('./planner-cfd.js') : root.HomePlannerCFD,
    common ? require('./planner-drafts.js') : root.HomePlannerDrafts);
  if (common) module.exports = api;
  else {
    root.HomePlannerCFDUI = api;
    if (root.document?.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, CFD, Drafts) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const key = CFD.canonical;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const terminal = status => ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(value);
  const LOCAL_HELP = 'Start .\\.venv\\Scripts\\python.exe -B app.py and open http://127.0.0.1:8000/. Case preparation needs the local Python service, but not WSL or OpenFOAM.';
  const numericPaths = new Set(CFD.FIELDS.map(field => field.path));
  const extraPaths = new Set(['sourceNote', 'acknowledgeGeometry', 'acknowledgeEmptyRoom', 'acknowledgeModel']);
  const fieldValue = value => value === null || value === undefined ? '' : String(value);
  function local(runtime) {
    return ['http:', 'https:'].includes(runtime.location?.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(runtime.location?.hostname);
  }
  function savedRecord(project, floorId, roomId) {
    const saved = project.environment?.coupledCfd;
    if (saved === undefined) return null;
    if (saved?.version !== 1 || !Array.isArray(saved.scenarios))
      throw new Error('Saved CFD inputs use an unsupported format. The original project data has been retained.');
    const rows = saved.scenarios.filter(row => row.floorId === floorId && row.roomId === roomId);
    if (rows.length > 1 || rows.some(row => !row.scenario || !Array.isArray(row.scenario.openings)))
      throw new Error('Saved CFD inputs contain duplicate or invalid room records. No record was overwritten.');
    return rows[0] || null;
  }
  function verifyJob(job, captured) {
    if (!job || !uuid(job.id) || job.caseHash !== captured.manifest.caseHash ||
        key(job.source) !== key(captured.request.source))
      throw new Error('The local job response does not match the captured room and case.');
    if (!['preparing', 'running', 'cancelling', 'cancelled', 'failed', 'completed', 'interrupted'].includes(job.status))
      throw new Error('The local job returned an unsupported lifecycle state.');
    return job;
  }
  function verifyResult(result, captured) {
    const manifest = captured.manifest, input = captured.request;
    if (result?.kind !== 'CoupledCfdResult' || result.version !== 1 ||
        result.caseHash !== manifest.caseHash || key(result.source) !== key(input.source) ||
        result.coordinateSpace !== 'room-right-front-up' || result.validationStatus !== 'unvalidated')
      throw new Error('The result provenance or coordinate frame does not match this captured case.');
    if (!finite(result.timeSeconds) || result.timeSeconds < input.scenario.numerics.endTimeSeconds - 1e-7 ||
        result.receiverHeightM !== input.scenario.sampling.heightM ||
        !Array.isArray(result.samples) || result.samples.length !== manifest.probeLocations.length ||
        !result.samples.length || result.samples.length > 512)
      throw new Error('The result is incomplete or has a different sampling plane.');
    result.samples.forEach((sample, index) => {
      const point = manifest.probeLocations[index];
      if (!['x', 'y', 'z'].every(axis => finite(sample.positionM?.[axis]) &&
          finite(sample.velocityMps?.[axis]) && Math.abs(sample.positionM[axis] - point[axis]) <= 1e-6) ||
          ![sample.temperatureC, sample.speedMps, sample.absolutePressurePa].every(finite) ||
          sample.absolutePressurePa <= 0 || sample.speedMps < 0 ||
          Math.abs(sample.speedMps - Math.hypot(...['x', 'y', 'z'].map(axis => sample.velocityMps[axis]))) > 1e-6)
        throw new Error('The result contains a nonfinite, misplaced or inconsistent sample. No heatmap is shown.');
    });
    return copy(result);
  }
  function createController(planner, runtime = root) {
    if (!planner?.getDrawingScene || !planner?.getProject || !Drafts?.createStore)
      throw new Error('CFD needs the shared project, DrawingScene and pending-input registry.');
    const store = Drafts.createStore(planner, 'Coupled thermal / CFD inputs'), entries = new Map();
    const selection = new Map(), listeners = new Set();
    let inventory = null, entry = null, currentScope = null, disposed = false, saving = false;
    let operation = 0, activeRun = null, pollTimer = null, globalError = '', cancellationWarning = '';
    let engine = { available: false, status: 'unchecked', message: 'Engine not checked. Prepare a case without an engine, or explicitly check the local OpenFOAM runtime.' };
    const schedule = runtime.setTimeout?.bind(runtime) || setTimeout;
    const unschedule = runtime.clearTimeout?.bind(runtime) || clearTimeout;
    function announce() { if (!disposed) for (const listener of listeners) listener(getState()); }
    function markPending() {
      entry.pending = true;
      store.put(currentScope, { scenario: entry.form, base: entry.base, geometryFingerprint: inventory?.geometryFingerprint });
    }
    async function service(path, body, blob = false) {
      if (!local(runtime) || typeof runtime.fetch !== 'function') throw new Error(LOCAL_HELP);
      const response = await runtime.fetch(`/api/cfd/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: blob ? 'application/zip' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: `Local CFD service returned HTTP ${response.status}. ${LOCAL_HELP}` } }));
        throw new Error(error.error?.message || `Local CFD service returned HTTP ${response.status}.`);
      }
      return blob ? response.blob() : response.json();
    }
    function stopPolling() { if (pollTimer !== null) unschedule(pollTimer); pollTimer = null; }
    async function cancelCaptured(captured) {
      if (!captured.jobId) return;
      const data = await service(`jobs/${captured.jobId}/cancel`, {});
      return verifyJob(data.job, captured);
    }
    function retireRun() {
      stopPolling();
      const captured = activeRun; activeRun = null;
      if (!captured) return;
      captured.retired = true;
      if (captured.jobId) cancelCaptured(captured).catch(error => {
        cancellationWarning = `Cancellation was not confirmed: ${error.message} The server run limit still applies.`;
        runtime.console?.error('CFD cancellation failed', error); announce();
      });
    }
    function invalidate(message = 'Inputs changed. Prepare a new case; old results are not displayed.') {
      operation++; retireRun();
      if (entry) Object.assign(entry, { prepared: null, result: null, job: null, status: 'stale', message });
    }
    function readInventory() {
      const project = planner.getProject(), floorId = project.activeFloorId, owner = key([project.id, floorId]);
      const drawing = planner.getDrawingScene();
      if (drawing.projectId !== project.id) throw new Error('The captured DrawingScene belongs to another project.');
      const floor = drawing.scenes.find(floor => floor.floorId === floorId);
      const available = floor?.rooms || [];
      if (!selection.has(owner)) {
        const selected = planner.getSelection?.();
        selection.set(owner, available.find(room => selected?.kind === 'room' && selected.id === room.id)?.id ||
          available.find(room => !room.service)?.id || '');
      }
      return { project, floorId, roomId: selection.get(owner), next: CFD.inspect(drawing, floorId, selection.get(owner)) };
    }
    function sync() {
      if (disposed || saving) return;
      try {
        const { project, floorId, roomId, next } = readInventory();
        const scope = { projectId: project.id, floorId, collection: 'coupledCfd', entityId: roomId };
        const scopeKey = Drafts.key(scope), saved = savedRecord(project, floorId, roomId);
        if (currentScope && Drafts.key(currentScope) !== scopeKey) invalidate('Room or project changed. Input drafts are retained with their original owners.');
        currentScope = scope; inventory = next;
        if (!entries.has(scopeKey)) entries.set(scopeKey, { form: saved ? copy(saved.scenario) : CFD.draft(next.geometry),
          base: copy(saved), pending: false, conflict: false, geometryKey: saved?.geometryFingerprint || next.geometryFingerprint,
          status: 'not-prepared', message: 'No CFD run. Review the current room and supply the physical inputs.',
          prepared: null, result: null, job: null });
        entry = entries.get(scopeKey);
        if (key(saved) !== key(entry.base)) {
          if (entry.pending) entry.conflict = true;
          else {
            invalidate('Saved inputs changed. Prepare again before using results.');
            entry.form = saved ? copy(saved.scenario) : CFD.draft(next.geometry);
            entry.base = copy(saved); entry.geometryKey = saved?.geometryFingerprint || next.geometryFingerprint;
          }
        }
        if (entry.geometryKey !== next.geometryFingerprint) {
          invalidate('Room geometry changed. Your values are retained; review the geometry acknowledgement and prepare again.');
          entry.geometryKey = next.geometryFingerprint;
          entry.form.acknowledgeGeometry = false;
          if (entry.base || entry.pending) markPending();
        }
        for (const opening of next.geometry?.openings || [])
          if (!entry.form.openings.some(row => row.id === opening.id)) entry.form.openings.push(CFD.defaultOpening(opening));
        if (entry.prepared && entry.prepared.key !== CFD.currentKey(next, entry.form)) invalidate();
        globalError = '';
      } catch (error) {
        invalidate('Current geometry or saved inputs are unavailable.');
        inventory = null; globalError = error.message;
      }
      announce();
    }
    function getState() {
      return copy({ projectId: currentScope?.projectId || null, floorId: currentScope?.floorId || null,
        roomId: currentScope?.entityId || null, inventory, form: entry?.form || null, pending: entry?.pending || false,
        conflict: entry?.conflict || false, status: entry?.status || 'unavailable',
        message: globalError || entry?.message || '', cancellationWarning, engine,
        manifest: entry?.prepared?.manifest || null, job: entry?.job || null, result: entry?.result || null });
    }
    function selectRoom(roomId) {
      const project = planner.getProject();
      invalidate('Room changed. No previous room result is reused.');
      selection.set(key([project.id, project.activeFloorId]), roomId); sync();
    }
    function setValue(path, value) {
      if (!numericPaths.has(path) && !extraPaths.has(path)) throw new Error('Unsupported CFD input field.');
      if (!entry) throw new Error('Choose an available room first.');
      if (numericPaths.has(path) && value !== null &&
          !(typeof value === 'string' || finite(value))) throw new Error('CFD numeric drafts require text, a finite number or null.');
      if (CFD.getPath(entry.form, path) === value) return;
      invalidate(); CFD.setPath(entry.form, path, value); markPending(); announce();
    }
    function setOpening(id, field, value) {
      if (!['mode', 'temperatureC', 'speedMps', 'gaugePressurePa'].includes(field)) throw new Error('Unsupported opening input.');
      const row = entry?.form.openings.find(item => item.id === id);
      if (!row) throw new Error('The opening input owner is unavailable.');
      if (row[field] === value) return;
      invalidate(); row[field] = value; markPending(); announce();
    }
    function openingOperation(id, fraction) {
      if (![0, 1].includes(fraction)) throw new Error('Only fully open or closed is supported.');
      const opening = inventory?.geometry?.openings.find(item => item.id === id);
      const type = opening?.kind === 'window' ? 'update-window' :
        ['hinged', 'sliding'].includes(opening?.kind) ? 'update-door' : null;
      if (!type) throw new Error('Edit this passage through the shared wall inspector.');
      planner.execute({ type, id, openFraction: fraction });
    }
    function save() {
      sync();
      if (!entry || globalError) throw new Error(globalError || 'No room is selected.');
      if (!currentScope.entityId || !inventory.rooms.some(room => room.id === currentScope.entityId))
        throw new Error('Select an existing room before saving its inputs.');
      if (entry.conflict) throw new Error('Saved inputs changed. Keep the draft explicitly or reload saved inputs before saving.');
      const project = planner.getProject(), form = CFD.scenario(entry.form, inventory.geometry, false);
      const old = project.environment.coupledCfd || { version: 1, scenarios: [] };
      const record = { floorId: currentScope.floorId, roomId: currentScope.entityId,
        geometryFingerprint: inventory.geometryFingerprint, scenario: form };
      const records = old.scenarios.filter(row => row.floorId !== record.floorId || row.roomId !== record.roomId);
      records.push(record);
      saving = true;
      try { planner.execute({ type: 'set-environment', patch: { coupledCfd: { ...copy(old), scenarios: records } } }); }
      finally { saving = false; }
      entry.base = copy(record); entry.pending = false; entry.conflict = false;
      store.remove(currentScope);
      entry.message = 'CFD input values saved to the project in one Undo step. Saving does not prepare or run a case.';
      sync();
    }
    function discard() {
      const project = planner.getProject(), saved = savedRecord(project, currentScope.floorId, currentScope.entityId);
      invalidate('Reloaded the saved room inputs. No calculation was started.');
      entry.form = saved ? copy(saved.scenario) : CFD.draft(inventory?.geometry);
      entry.base = copy(saved); entry.pending = false; entry.conflict = false;
      entry.geometryKey = saved?.geometryFingerprint || inventory?.geometryFingerprint;
      store.remove(currentScope); sync();
    }
    function keepDraft() {
      entry.base = copy(savedRecord(planner.getProject(), currentScope.floorId, currentScope.entityId));
      entry.conflict = false; markPending(); announce();
    }
    function capture() {
      sync();
      if (!inventory || globalError) throw new Error(globalError || 'Current room geometry is unavailable.');
      if (entry.conflict) throw new Error('Review the changed saved inputs before preparing a case.');
      const input = CFD.request(inventory, entry.form);
      if (new TextEncoder().encode(JSON.stringify(input)).length > 262144)
        throw new Error('This captured case exceeds the 256 KiB local API budget. No project data is truncated.');
      return { request: input, key: CFD.currentKey(inventory, entry.form), owner: entry };
    }
    function current(captured) {
      if (disposed || entry !== captured.owner || captured.operation !== operation) return false;
      sync();
      return !disposed && entry === captured.owner && inventory &&
        captured.key === CFD.currentKey(inventory, entry.form) && captured.operation === operation;
    }
    async function prepare() {
      const captured = capture(); invalidate();
      captured.operation = operation;
      entry.status = 'preparing'; entry.message = 'Preparing a case from this room. No solver is running.'; announce();
      try {
        const data = await service('prepare', captured.request);
        if (!current(captured)) return false;
        if (data.status !== 'prepared' || data.manifest?.version !== 1 || data.manifest.profile !== CFD.PROFILE ||
            !/^[a-f0-9]{64}$/.test(data.manifest.caseHash) || key(data.manifest.source) !== key(captured.request.source) ||
            key(data.manifest.geometry) !== key(captured.request.geometry) ||
            key(data.manifest.scenario) !== key(captured.request.scenario) ||
            !Number.isInteger(data.manifest.mesh?.cells) || data.manifest.mesh.cells <= 0 ||
            data.manifest.coordinateSpace !== 'room-right-front-up' ||
            !Array.isArray(data.manifest.probeLocations) || !data.manifest.probeLocations.length ||
            data.manifest.probeLocations.length > 512 ||
            data.manifest.probeLocations.some(point => !['x', 'y', 'z'].every(axis => finite(point[axis]))))
          throw new Error('Prepared-case evidence does not match the requested snapshot and inputs.');
        captured.manifest = copy(data.manifest); entry.prepared = captured;
        entry.status = 'prepared'; entry.message = 'Case prepared, not simulated. Download the OpenFOAM package or run it once the local engine is ready.';
        announce(); return true;
      } catch (error) {
        if (current(captured)) { entry.status = 'failed'; entry.message = error.message; announce(); }
        return false;
      }
    }
    async function download() {
      if (!entry?.prepared) throw new Error('Prepare the current case before downloading it.');
      const captured = entry.prepared, blob = await service('package', captured.request, true);
      if (!current(captured)) throw new Error('Inputs changed while preparing the download. The stale package was not offered.');
      return blob;
    }
    async function checkEngine() {
      engine = { available: false, status: 'checking', message: 'Checking the explicitly configured local OpenFOAM runtime.' }; announce();
      try {
        const data = await service('runtime', {});
        if (disposed) return;
        const info = data.execution || data;
        if (typeof info.available !== 'boolean' || typeof info.message !== 'string')
          throw new Error('The runtime returned an invalid readiness response.');
        engine = copy(info);
      } catch (error) { engine = { available: false, status: 'unavailable', message: error.message }; }
      announce();
    }
    async function poll(captured) {
      if (!current(captured) || captured.retired) return;
      try {
        const data = await service(`jobs/${captured.jobId}`);
        if (!current(captured) || captured.retired) return;
        const job = verifyJob(data.job, captured);
        entry.job = copy(job); entry.status = job.status; entry.message = job.message;
        if (job.status === 'completed') {
          const response = await service(`jobs/${captured.jobId}/result`);
          if (!current(captured) || captured.retired) return;
          if (response.status !== 'computed-unvalidated') throw new Error('The engine has not supplied a completed numerical result.');
          entry.result = verifyResult(response.result, captured); activeRun = null;
          entry.message = 'Computed OpenFOAM samples. The numerical profile is unvalidated; inspect diagnostics and refinement evidence.';
        } else if (terminal(job.status)) activeRun = null;
        else pollTimer = schedule(() => { pollTimer = null; void poll(captured); }, 1000);
        announce();
      } catch (error) {
        if (!current(captured)) return;
        entry.status = 'failed'; entry.message = error.message; entry.result = null;
        retireRun(); announce();
      }
    }
    async function followCancellation(captured, generation) {
      if (disposed || operation !== generation || entry !== captured.owner) return;
      try {
        const data = await service(`jobs/${captured.jobId}`);
        if (disposed || operation !== generation || entry !== captured.owner) return;
        const job = verifyJob(data.job, captured);
        entry.job = copy(job); entry.status = job.status; entry.message = job.message;
        if (!terminal(job.status))
          pollTimer = schedule(() => { pollTimer = null; void followCancellation(captured, generation); }, 1000);
      } catch (error) {
        if (operation !== generation || entry !== captured.owner) return;
        cancellationWarning = `Cancellation status is unavailable: ${error.message} Check the local job log.`;
        entry.status = 'failed'; entry.message = cancellationWarning;
      }
      announce();
    }
    async function run() {
      sync();
      if (!entry?.prepared || !engine.available) throw new Error('Prepare the current case and check the local engine before Run.');
      if (activeRun) throw new Error('Cancel or finish the current job before starting another.');
      const captured = { ...entry.prepared, operation: ++operation, retired: false, jobId: null };
      entry.prepared = captured; activeRun = captured;
      entry.status = 'starting'; entry.message = 'Starting the bounded local job. No result is available yet.'; announce();
      try {
        const data = await service('jobs', captured.request), job = verifyJob(data.job, captured);
        captured.jobId = job.id;
        if (!current(captured) || captured.retired) {
          await cancelCaptured(captured); return false;
        }
        entry.job = copy(job); entry.status = job.status; entry.message = job.message; announce();
        void poll(captured); return true;
      } catch (error) {
        if (activeRun === captured) activeRun = null;
        if (current(captured)) { entry.status = 'failed'; entry.message = error.message; announce(); }
        else {
          cancellationWarning = `An obsolete run could not be confirmed stopped: ${error.message} Check the local job log; its wall-time limit applies.`;
          runtime.console?.error('Obsolete CFD run request failed', error); announce();
        }
        return false;
      }
    }
    async function cancel() {
      const captured = activeRun;
      if (!captured) {
        if (entry?.status === 'preparing') {
          invalidate('Case preparation cancelled. No solver was started.'); announce();
        }
        return;
      }
      captured.retired = true; activeRun = null; stopPolling(); operation++;
      const generation = operation;
      entry.result = null; entry.job = null; entry.prepared = null;
      entry.status = 'cancelling'; entry.message = 'Cancellation requested. A running job is not reported stopped until the server confirms it.'; announce();
      if (!captured.jobId) {
        entry.status = 'stale'; entry.message = 'Run request superseded. If the server creates it, its returned job ID will be cancelled.'; announce(); return;
      }
      try {
        const job = await cancelCaptured(captured);
        if (!disposed && entry === captured.owner && operation === generation) {
          entry.job = copy(job); entry.status = job.status; entry.message = job.message;
          if (!terminal(job.status))
            pollTimer = schedule(() => { pollTimer = null; void followCancellation(captured, generation); }, 1000);
        }
      } catch (error) {
        cancellationWarning = `Cancellation was not confirmed: ${error.message} Check the local job log.`;
        if (entry === captured.owner && operation === generation) {
          entry.status = 'failed'; entry.message = cancellationWarning;
        }
      }
      announce();
    }
    function clear() { invalidate('Case preview and results cleared. Input values and the project are unchanged.'); announce(); }
    function reportError(error) { if (entry) { entry.message = error.message; entry.status = 'failed'; } else globalError = error.message; announce(); }
    sync();
    const off = planner.subscribe(sync);
    return { getState, sync, selectRoom, setValue, setOpening, openingOperation, save, discard, keepDraft,
      prepare, download, checkEngine, run, cancel, clear, reportError,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (disposed) return; retireRun(); disposed = true; operation++; off(); store.dispose(); listeners.clear(); } };
  }
  function bearingSide(side, geometry) {
    if (!geometry || !CFD.SIDES.includes(side)) return side;
    const index = CFD.SIDES.indexOf(side), heading = geometry.headingDeg;
    return Number.isInteger(heading / 90) ? CFD.SIDES[(index + heading / 90 + 4) % 4] : `${side} (plan)`;
  }
  function plotSvg(geometry, result = null, metric = 'temperature') {
    if (!geometry || geometry.rect.w <= 0 || geometry.rect.h <= 0) return '';
    const scale = Math.min(440 / geometry.rect.w, 300 / geometry.rect.h), x0 = 50, y0 = 42;
    const width = geometry.rect.w * scale, height = geometry.rect.h * scale;
    const title = result ? `${metric === 'temperature' ? 'Temperature (C)' : 'Speed (m/s)'} at ${result.receiverHeightM} m above floor, ${result.timeSeconds} s` :
      'Current room enclosure preview - no CFD result';
    let content = `<title>${esc(title)}</title><rect x="${x0}" y="${y0}" width="${width}" height="${height}" class="hp-cfd-room"/>`;
    if (result?.samples?.length) {
      const values = result.samples.map(sample => metric === 'temperature' ? sample.temperatureC : sample.speedMps);
      const low = Math.min(...values), high = Math.max(...values);
      const maxHorizontal = Math.max(...result.samples.map(sample => Math.hypot(sample.velocityMps.x, sample.velocityMps.y)));
      result.samples.forEach((sample, index) => {
        const x = x0 + sample.positionM.x * scale, y = y0 + height - sample.positionM.y * scale;
        const fraction = high === low ? .5 : (values[index] - low) / (high - low);
        const hue = 230 - 220 * fraction, radius = Math.max(2, Math.min(12, Math.sqrt(width * height / result.samples.length) / 3));
        content += `<circle cx="${x}" cy="${y}" r="${radius}" fill="hsl(${hue} 70% 48%)"><title>${esc(values[index].toFixed(4))} ${metric === 'temperature' ? 'C' : 'm/s'}</title></circle>`;
        if (maxHorizontal > 0 && Math.hypot(sample.velocityMps.x, sample.velocityMps.y) > 0) {
          const dx = sample.velocityMps.x / maxHorizontal * 12, dy = -sample.velocityMps.y / maxHorizontal * 12;
          const endX = x + dx, endY = y + dy, angle = Math.atan2(dy, dx);
          content += `<path d="M${x},${y}L${endX},${endY}M${endX - 3 * Math.cos(angle - .6)},${endY - 3 * Math.sin(angle - .6)}L${endX},${endY}L${endX - 3 * Math.cos(angle + .6)},${endY - 3 * Math.sin(angle + .6)}" class="hp-cfd-vector"/>`;
        }
      });
      content += `<text x="${x0}" y="${y0 + height + 45}">${esc(low.toFixed(3))} to ${esc(high.toFixed(3))} ${metric === 'temperature' ? 'C' : 'm/s'} - discrete solver samples, not interpolated cells</text>`;
    }
    for (const opening of geometry.openings) {
      const horizontal = opening.side === 'N' || opening.side === 'S';
      const x = x0 + (horizontal ? opening.offsetM : opening.side === 'E' ? geometry.rect.w : 0) * scale;
      const y = y0 + (horizontal ? opening.side === 'S' ? geometry.rect.h : 0 : opening.offsetM) * scale;
      content += `<path d="M${x},${y}${horizontal ? 'h' : 'v'}${opening.widthM * scale}" class="hp-cfd-aperture ${opening.openFraction === 0 ? 'closed' : ''}"><title>${esc(bearingSide(opening.side, geometry))} ${esc(opening.kind)}: ${opening.openFraction === 0 ? 'closed surface' : 'opening'}</title></path>`;
    }
    content += `<text x="${x0 + width / 2}" y="24" text-anchor="middle">${esc(bearingSide('N', geometry))}</text>
      <text x="${x0 + width + 12}" y="${y0 + height / 2}">${esc(bearingSide('E', geometry))}</text>
      <text x="${x0 + width / 2}" y="${y0 + height + 20}" text-anchor="middle">${esc(bearingSide('S', geometry))} - ${geometry.rect.w.toFixed(2)} m</text>
      <text x="20" y="${y0 + height / 2}">${esc(bearingSide('W', geometry))}</text>`;
    return `<svg viewBox="0 0 ${width + 105} ${height + 108}" role="img" aria-label="${esc(title)}">${content}</svg>`;
  }
  function mount(document = root.document, runtime = root) {
    const host = document?.getElementById('workspaceCfd');
    if (!host || host.homePlannerCFD) return host?.homePlannerCFD || null;
    let controller;
    try { controller = createController(runtime.HomePlanner, runtime); }
    catch (error) { host.textContent = `Coupled CFD unavailable: ${error.message}`; return null; }
    host.classList.add('hp-cfd');
    const groups = [...new Set(CFD.FIELDS.map(field => field.group))];
    host.innerHTML = `<header><h2>Coupled thermal / CFD</h2><p>One current room. Prepare an OpenFOAM case now; solve locally when the engine is installed.</p></header>
      <div class="hp-cfd-toolbar"><label>Room on the active floor<select data-cfd-room aria-label="CFD room"></select></label>
      <button type="button" data-cfd-action="checkEngine">Check local engine</button></div>
      <p data-cfd-engine class="hp-cfd-help"></p><p data-cfd-status role="status" aria-live="polite"></p>
      <p data-cfd-cancel-warning role="alert" hidden></p>
      <div class="hp-cfd-overview"><div data-cfd-plot></div><div><p data-cfd-dimensions></p>
      <div data-cfd-findings></div><details><summary>Geometry and model scope</summary><div data-cfd-notes></div>
      <p>This first profile solves transient laminar ideal-gas airflow coupled to one homogeneous opaque solid shell.
      It does not model turbulence, radiation, HVAC, moisture, furniture or adjacent rooms.
      Closed doors/windows use prescribed inner-face temperatures, not a glass or door-layer conduction model.
      Open doors omit leaf obstruction. Simulation results require mesh/time refinement and independent validation.</p></details></div></div>
      <div data-cfd-conflict hidden role="alert">Saved inputs changed while this draft was open.
      <button type="button" data-cfd-action="keepDraft">Keep my draft for review</button>
      <button type="button" data-cfd-action="discard">Reload saved inputs</button></div>
      <div class="hp-cfd-inputs">${groups.map(group => `<fieldset><legend>${esc(group)}</legend><div class="hp-cfd-fields">${
        CFD.FIELDS.filter(field => field.group === group).map(field => `<label><span data-cfd-label="${esc(field.path)}">${esc(field.label)}</span>
        <input data-cfd-input="${esc(field.path)}" type="number" step="${field.integer ? '1' : 'any'}" min="${field.min}" max="${field.max}"></label>`).join('')
      }</div></fieldset>`).join('')}</div>
      <p class="hp-cfd-help">Blank physical inputs mean unknown. Numerical controls above are editable starting settings, not verified accuracy.
      Boundary temperatures are prescribed at the outer solid faces; pressure is absolute except the explicitly labelled outlet gauge pressure.</p>
      <fieldset><legend>Actual openings and boundary conditions</legend><div data-cfd-openings></div></fieldset>
      <label>Input sources and assumptions<textarea data-cfd-input="sourceNote" rows="3" maxlength="4096"></textarea></label>
      <div class="hp-cfd-acks">
      <label><input type="checkbox" data-cfd-input="acknowledgeGeometry">I reviewed this current modeled enclosure and its unverified dimensions.</label>
      <label><input type="checkbox" data-cfd-input="acknowledgeEmptyRoom">Model an empty room; omit furniture and small services.</label>
      <label><input type="checkbox" data-cfd-input="acknowledgeModel">Use the stated laminar, homogeneous-solid and prescribed-boundary profile as an unvalidated experiment.</label></div>
      <div class="hp-cfd-toolbar"><button type="button" data-cfd-action="prepare">Prepare case</button>
      <button type="button" data-cfd-action="download">Download OpenFOAM case</button>
      <button type="button" data-cfd-action="run">Run OpenFOAM</button><button type="button" data-cfd-action="cancel">Cancel run</button>
      <button type="button" data-cfd-action="save">Save inputs to project</button>
      <button type="button" data-cfd-action="discard">Reload saved inputs</button><button type="button" data-cfd-action="clear">Clear results</button></div>
      <p data-cfd-pending class="hp-cfd-help"></p><p data-cfd-prepared></p>
      <div data-cfd-output hidden><label>Computed quantity<select data-cfd-metric><option value="temperature">Temperature (C)</option>
      <option value="speed">Speed (m/s)</option></select></label><div data-cfd-results></div>
      <details><summary>Numeric sample table</summary><div class="hp-cfd-table" data-cfd-samples></div></details>
      <button type="button" data-cfd-action="exportResult">Download result JSON</button></div>
      <details><summary>Case provenance and numerical diagnostics</summary><pre data-cfd-evidence></pre></details>
      <details><summary>Local job log</summary><pre data-cfd-log>No job started.</pre></details>`;
    const by = name => host.querySelector(`[data-cfd-${name}]`);
    let openingKey = '', roomOptions = '', metric = 'temperature';
    function render(state) {
      const geometry = state.inventory?.geometry;
      const options = key(state.inventory?.rooms || []);
      if (options !== roomOptions) {
        by('room').innerHTML = `<option value="">Choose a room</option>${(state.inventory?.rooms || []).map(room =>
          `<option value="${esc(room.id)}"${room.service ? ' disabled' : ''}>${esc(room.label)}</option>`).join('')}`;
        roomOptions = options;
      }
      by('room').value = state.roomId || '';
      by('status').textContent = state.message; host.dataset.state = state.status;
      by('engine').textContent = state.engine.message;
      by('cancel-warning').textContent = state.cancellationWarning; by('cancel-warning').hidden = !state.cancellationWarning;
      by('dimensions').textContent = geometry ? `${geometry.rect.w.toFixed(3)} x ${geometry.rect.h.toFixed(3)} x ${geometry.heightM.toFixed(3)} m inner enclosure; floor elevation ${geometry.floorElevationM.toFixed(3)} m above project zero.` : '';
      by('plot').innerHTML = plotSvg(geometry);
      by('findings').innerHTML = (state.inventory?.findings || []).length ?
        `<p><strong>Geometry needs attention</strong></p><ul>${state.inventory.findings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` :
        '<p>Rectangular enclosure available for input review. No simulation has been inferred from its geometry.</p>';
      by('notes').innerHTML = (state.inventory?.notes || []).map(note => `<p>${esc(note)}</p>`).join('');
      by('conflict').hidden = !state.conflict;
      for (const field of CFD.FIELDS) {
        const label = host.querySelector(`[data-cfd-label="${field.path}"]`);
        const side = field.path.startsWith('boundaries.') ? field.path.split('.')[1] : null;
        label.textContent = CFD.SIDES.includes(side) ? `${bearingSide(side, geometry)} wall outer-face temperature (C)` : field.label;
      }
      const signature = key([state.projectId, state.floorId, state.roomId, geometry?.openings || null,
        state.form?.openings.map(row => row.id) || []]);
      if (signature !== openingKey) {
        by('openings').innerHTML = (state.form?.openings || []).map((row, index) => {
          const opening = geometry?.openings.find(item => item.id === row.id);
          if (!opening) return `<p class="hp-cfd-help">A saved opening condition is unresolved. Its input record is retained but not exported into a current case.</p>`;
          const label = `${bearingSide(opening.side, geometry)} ${opening.kind === 'window' ? 'window' : 'opening'} ${index + 1}`;
          const editable = ['window', 'hinged', 'sliding'].includes(opening.kind);
          return `<section class="hp-cfd-opening"><h3>${esc(label)}</h3><p>${opening.widthM.toFixed(3)} x ${opening.heightM.toFixed(3)} m; ${esc(opening.adjacent)}; saved open fraction ${esc(opening.openFraction ?? 'unknown')}.</p>
            ${editable ? `<div class="hp-cfd-toolbar"><button type="button" data-cfd-operation="1" data-cfd-opening="${esc(row.id)}">Set fully open</button>
            <button type="button" data-cfd-operation="0" data-cfd-opening="${esc(row.id)}">Set closed</button><span class="hp-cfd-help">Changes the saved opening; supports Undo.</span></div>` : ''}
            <div class="hp-cfd-fields"><label>Boundary condition<select data-cfd-opening="${esc(row.id)}" data-cfd-field="mode">
            <option value="">Choose a condition</option><option value="closed">Closed: prescribed inner-face temperature</option>
            <option value="inlet">Inlet: inward normal velocity</option><option value="outlet">Outlet: pressure with backflow temperature</option></select></label>
            <label>Temperature / outlet backflow (C)<input type="number" step="any" data-cfd-opening="${esc(row.id)}" data-cfd-field="temperatureC"></label>
            <label>Inlet speed (m/s)<input type="number" min="0" step="any" data-cfd-opening="${esc(row.id)}" data-cfd-field="speedMps"></label>
            <label>Outlet gauge pressure (Pa)<input type="number" step="any" data-cfd-opening="${esc(row.id)}" data-cfd-field="gaugePressurePa"></label></div></section>`;
        }).join('') || '<p>No hosted openings: this will be a sealed thermal cavity, not ventilation through invented ports.</p>';
        openingKey = signature;
      }
      for (const input of host.querySelectorAll('[data-cfd-input]')) {
        if (document.activeElement === input) continue;
        const value = CFD.getPath(state.form, input.dataset.cfdInput);
        if (input.type === 'checkbox') input.checked = value === true;
        else input.value = fieldValue(value);
      }
      for (const input of host.querySelectorAll('[data-cfd-field]')) {
        const row = state.form?.openings.find(row => row.id === input.dataset.cfdOpening);
        if (document.activeElement !== input) input.value = fieldValue(row?.[input.dataset.cfdField]);
        if (['speedMps', 'gaugePressurePa'].includes(input.dataset.cfdField))
          input.disabled = row?.mode !== (input.dataset.cfdField === 'speedMps' ? 'inlet' : 'outlet');
      }
      const busy = ['starting', 'preparing', 'running', 'cancelling'].includes(state.status);
      for (const button of host.querySelectorAll('[data-cfd-action]')) {
        const action = button.dataset.cfdAction;
        button.disabled = action === 'run' ? !state.manifest || !state.engine.available || busy :
          action === 'download' ? !state.manifest || busy :
          action === 'cancel' ? !['starting', 'running', 'preparing'].includes(state.status) :
          action === 'checkEngine' ? state.engine.status === 'checking' :
          action === 'prepare' ? busy || !geometry || !!state.inventory?.findings.length || state.conflict :
          action === 'save' ? !state.form || state.conflict : false;
      }
      by('pending').textContent = state.pending ? 'Unsaved CFD inputs are tracked as project-owned drafts. Save inputs explicitly to include them in project JSON and Undo/Redo.' :
        'Typing, preparing and running do not change room geometry. CFD cases/results are separate from the project JSON.';
      by('prepared').textContent = state.manifest ? `${state.manifest.mesh.cells.toLocaleString()} planned cells; ${state.manifest.probeLocations.length} receiver samples. Case ${state.manifest.caseHash.slice(0, 12)}. Engine verification pending.` : '';
      by('output').hidden = !state.result;
      by('results').innerHTML = state.result ? plotSvg(geometry, state.result, metric) : '';
      by('samples').innerHTML = state.result ? `<table><thead><tr>${['X (m)', 'Y (m)', 'Z (m)',
        'Temperature (C)', 'UX (m/s)', 'UY (m/s)', 'UZ (m/s)', 'Speed (m/s)', 'Absolute pressure (Pa)'].map(label =>
        `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${state.result.samples.map(sample =>
        `<tr>${[sample.positionM.x, sample.positionM.y, sample.positionM.z, sample.temperatureC, sample.velocityMps.x,
          sample.velocityMps.y, sample.velocityMps.z, sample.speedMps, sample.absolutePressurePa].map(value =>
          `<td>${value.toPrecision(6)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
      by('evidence').textContent = JSON.stringify(state.result ? { source: state.result.source,
        engine: state.result.engine, diagnostics: state.result.diagnostics, limitations: state.result.limitations,
        validationStatus: state.result.validationStatus } : state.manifest || { status: 'not-prepared' }, null, 2);
      by('log').textContent = state.job?.logTail?.join('\n') || 'No job log available.';
    }
    function downloadBlob(blob, name) {
      const url = runtime.URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; host.append(anchor); anchor.click(); anchor.remove();
      runtime.setTimeout(() => runtime.URL.revokeObjectURL(url), 1000);
    }
    host.addEventListener('input', event => {
      const input = event.target;
      try {
        if (input.dataset.cfdInput) controller.setValue(input.dataset.cfdInput, input.type === 'checkbox' ? input.checked : input.value);
        else if (input.dataset.cfdField) controller.setOpening(input.dataset.cfdOpening, input.dataset.cfdField, input.value || null);
      } catch (error) { controller.reportError(error); }
    });
    host.addEventListener('change', event => {
      if (event.target === by('room')) controller.selectRoom(event.target.value);
      if (event.target === by('metric')) { metric = event.target.value; render(controller.getState()); }
    });
    host.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || !host.contains(button) || button.disabled) return;
      try {
        if (button.dataset.cfdOperation !== undefined)
          controller.openingOperation(button.dataset.cfdOpening, Number(button.dataset.cfdOperation));
        else if (button.dataset.cfdAction === 'download')
          downloadBlob(await controller.download(), 'homeplanner-openfoam-case.zip');
        else if (button.dataset.cfdAction === 'exportResult') {
          const result = controller.getState().result;
          if (!result) throw new Error('No current completed result is available.');
          downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), 'homeplanner-cfd-result.json');
        } else if (button.dataset.cfdAction) await controller[button.dataset.cfdAction]();
      } catch (error) { controller.reportError(error); }
    });
    const off = controller.subscribe(render);
    render(controller.getState()); host.homePlannerCFD = controller;
    runtime.addEventListener?.('pagehide', event => {
      if (event.persisted) { void controller.cancel(); return; }
      off(); controller.dispose();
    });
    return controller;
  }
  return Object.freeze({ createController, mount, plotSvg, verifyResult, bearingSide });
});
