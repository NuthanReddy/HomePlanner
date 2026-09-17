(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerPythonAnalysis = api;
    if (root.document?.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const HOSTS = { density: 'python-density-analysis', solar: 'python-solar-analysis' };
  const LAUNCH = '.\\.venv\\Scripts\\python.exe -B app.py';
  const INSTALL = '.\\.venv\\Scripts\\python.exe -m pip install -r requirements-analysis.txt';
  const SERVICE_HELP = `Local calculation service unavailable. From the HomePlanner folder run ${LAUNCH}, then open http://127.0.0.1:8000/ (not file:// or a static server).`;
  const REFERENCE = { altitudeM: 0, pressurePa: 101325, temperatureC: 15 };
  const MAX_SAMPLES = 313;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const numeric = value => value === null || value === undefined || String(value).trim() === '' ? null : Number(value);
  const canonical = value => value === undefined ? 'null' : value === null || typeof value !== 'object'
    ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const nice = (value, digits = 2) => finite(value) ? value.toFixed(digits) : 'Unknown';
  const short = (value, limit = 220) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  function inputError(message, code = 'invalid_input') { return Object.assign(new Error(message), { code }); }
  function requireNumber(value, label, min, max) {
    if (!finite(value) || value < min || value > max)
      throw inputError(`${label} must be supplied between ${min} and ${max}.`);
    return value;
  }
  function localService(runtime) {
    return ['http:', 'https:'].includes(runtime.location?.protocol) &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(runtime.location?.hostname);
  }
  function weatherSource(weather, row) {
    return {
      kind: 'weather-record', label: short(weather.source?.label || 'Imported weather record'),
      weatherId: short(weather.id || 'unidentified-weather'), recordTimestamp: row.timestamp,
      ...(row.durationSeconds === undefined ? {} : { durationSeconds: row.durationSeconds }),
      timeBasis: short(weather.timestampMeaning || 'UTC interval end; source temperature/pressure/RH timing retained'),
    };
  }
  function pickedWeather(weather, index) {
    const number = numeric(index);
    return Array.isArray(weather?.records) && Number.isInteger(number) && number >= 1
      ? weather.records[number - 1] || null : null;
  }
  function weatherEvidence(weather, row, kind) {
    if (!row) return null;
    const keys = kind === 'density' ? ['temperatureC', 'rhPct', 'pressurePa'] : ['temperatureC', 'pressurePa'];
    return {
      source: weatherSource(weather, row), kind: weather.kind ?? null,
      latitude: weather.latitude ?? null, longitude: weather.longitude ?? null,
      elevationM: weather.source?.elevationM ?? null,
      values: Object.fromEntries(keys.map(key => [key, row[key] ?? null])),
      missing: (row.missing || []).filter(key => keys.includes(key)),
      units: Object.fromEntries(keys.map(key => [key, weather.units?.[key] ?? null])),
    };
  }
  function weatherValue(row, key) { return row?.missing?.includes(key) ? null : row?.[key] ?? null; }
  function siteEvidence(project) {
    const site = project.site || {};
    return { latitude: site.latitude, longitude: site.longitude, timeZone: site.timeZone,
      altitudeM: site.altitudeM, provenance: project.environment?.siteProvenance ?? null };
  }
  function readSolarInput(doc, project) {
    const ids = { latitude: 'sunLatitude', longitude: 'sunLongitude', timeZone: 'sunTimeZone',
      date: 'sunDate', time: 'sunTime', occurrence: 'sunOccurrence' };
    if (doc && Object.values(ids).every(id => doc.getElementById(id))) {
      const values = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, doc.getElementById(id).value]));
      return { ...values, latitude: numeric(values.latitude), longitude: numeric(values.longitude) };
    }
    return { ...project.site, ...project.environment?.sunSelection };
  }

  function createController(options = {}) {
    const runtime = options.runtime || root, planner = options.planner || runtime.HomePlanner;
    if (!planner?.getProject) throw inputError('Load the HomePlanner project bridge before Python analysis.');
    const getWeather = options.getWeather || (project => project.environment?.weather);
    const getSolarInput = options.getSolarInput || (project => readSolarInput(runtime.document, project));
    const getAirflow = () => typeof options.airflowController === 'function' ? options.airflowController()
      : options.airflowController || runtime.document?.getElementById('workspaceAirflow')?.homePlannerAirflow;
    const sessions = new Map(), listeners = new Set(), jobs = { density: null, solar: null };
    const generations = { density: 0, solar: 0 };
    let ownerId = null, disposed = false, applying = false, subscribedAirflow = null, offAirflow = null;
    const emptyResult = () => ({ status: localService(runtime) ? 'unknown' : 'unavailable',
      message: localService(runtime) ? 'Not calculated. Choose inputs, then calculate explicitly.' : SERVICE_HELP,
      result: null, key: null, applied: false });
    function session(project) {
      if (!sessions.has(project.id)) {
        const hasWeather = !!getWeather(project)?.records?.length;
        sessions.set(project.id, {
          densityInputs: { mode: hasWeather ? 'weather' : 'manual', recordIndex: '1',
            temperatureC: '', rhPct: '', pressureHpa: '', sourceNote: '' },
          solarInputs: { mode: hasWeather ? 'weather' : 'manual', recordIndex: '1',
            altitudeM: '', temperatureC: '', pressureHpa: '', acknowledgeReferenceAtmosphere: false, sampleMinutes: '15' },
          density: emptyResult(), solar: emptyResult(), currentWeather: null,
        });
      }
      return sessions.get(project.id);
    }
    function cancelJob(kind) {
      generations[kind]++;
      const job = jobs[kind]; jobs[kind] = null;
      job?.abort?.abort(); job?.cancel?.();
    }
    function invalidate(kind, data, message = 'Inputs changed. Calculate again; no stale value was applied.', status = 'stale') {
      cancelJob(kind);
      Object.assign(data[kind], { status, message, result: null, key: null, applied: false });
    }
    function capture(kind, project = planner.getProject()) {
      const data = session(project), form = data[`${kind}Inputs`];
      const weather = kind === 'density' && form.mode === 'current' ? data.currentWeather : getWeather(project);
      const row = form.mode === 'current' ? weather?.records?.[0] || null
        : form.mode === 'weather' ? pickedWeather(weather, form.recordIndex) : null;
      const airflowController = kind === 'density' ? getAirflow() : null;
      const airflow = airflowController?.getState?.() || null;
      const solar = kind === 'solar' ? getSolarInput(project) || {} : null;
      const evidence = { projectId: project.id, site: siteEvidence(project), form,
        weather: ['weather', 'current'].includes(form.mode) ? weatherEvidence(weather, row, kind) : null,
        airflow: airflow ? { projectId: airflow.projectId, selectedScenarioId: airflow.selectedScenarioId, draft: airflow.draft } : null,
        solar };
      return { project, data, form, weather, row, airflow, airflowController, solar, key: canonical(evidence) };
    }
    function attachAirflow() {
      const controller = getAirflow();
      if (controller !== subscribedAirflow) {
        offAirflow?.(); subscribedAirflow = controller; offAirflow = controller?.subscribe?.(() => { if (!applying) sync(); });
      }
    }
    function sync() {
      if (disposed) return false;
      try {
        const project = planner.getProject();
        if (!project?.id) throw inputError('The current project is unavailable.');
        if (ownerId !== null && project.id !== ownerId) {
          const previous = sessions.get(ownerId);
          for (const kind of ['density', 'solar']) invalidate(kind, previous, 'Project changed. Your input drafts are retained; calculate for this project explicitly.');
        }
        ownerId = project.id; const data = session(project);
        attachAirflow();
        for (const kind of ['density', 'solar']) {
          const current = capture(kind, project);
          if (data[kind].key && data[kind].key !== current.key)
            invalidate(kind, data);
        }
        notify(); return true;
      } catch (_) {
        for (const kind of ['density', 'solar']) {
          cancelJob(kind);
          if (sessions.has(ownerId)) Object.assign(sessions.get(ownerId)[kind], {
            status: 'unavailable', message: 'Current project inputs unavailable. Reopen the project and retry.',
            result: null, key: null, applied: false,
          });
        }
        notify(); return false;
      }
    }
    function getState() {
      const project = planner.getProject(), data = session(project), weather = getWeather(project);
      return {
        projectId: project.id, ...copy(data),
        weatherCount: weather?.records?.length || 0,
        weatherLabel: short(weather?.source?.label || 'Imported weather'),
        densityWeather: copy(data.densityInputs.mode === 'current' ? data.currentWeather?.records?.[0]
          : pickedWeather(weather, data.densityInputs.recordIndex)),
        solarWeather: copy(pickedWeather(weather, data.solarInputs.recordIndex)),
        solarInput: copy(getSolarInput(project) || {}),
        solarAtmosphere: atmosphere(capture('solar', project)),
        airflowReady: !!getAirflow()?.setDraft,
        savedSite: copy(siteEvidence(project)),
      };
    }
    function notify() {
      if (disposed || !listeners.size) return;
      const state = getState(); listeners.forEach(listener => listener(state));
    }
    function setInputs(kind, patch) {
      if (disposed) return;
      const project = planner.getProject(), data = session(project), form = data[`${kind}Inputs`];
      const accepted = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(form, key)));
      if (canonical({ ...form, ...accepted }) === canonical(form)) return;
      Object.assign(form, accepted);
      if (kind === 'solar' && !Object.hasOwn(accepted, 'acknowledgeReferenceAtmosphere'))
        form.acknowledgeReferenceAtmosphere = false;
      invalidate(kind, data); notify();
    }
    function densityPayload(captured) {
      const { form, weather, row, project } = captured, fromWeather = ['weather', 'current'].includes(form.mode);
      if (fromWeather && !row) throw inputError('Select an imported record, explicitly get weather, or choose Manual inputs.');
      if (form.mode === 'current' && (weather.requestedSite?.latitude !== project.site?.latitude ||
          weather.requestedSite?.longitude !== project.site?.longitude))
        throw inputError('The saved location changed. Get weather for this location again, or choose imported/manual inputs.');
      const temperatureC = fromWeather ? weatherValue(row, 'temperatureC') : numeric(form.temperatureC);
      const rhPct = fromWeather ? weatherValue(row, 'rhPct') : numeric(form.rhPct);
      const pressure = numeric(form.pressureHpa);
      const pressurePa = fromWeather ? weatherValue(row, 'pressurePa') : pressure === null ? null : pressure * 100;
      requireNumber(temperatureC, 'Temperature (°C)', -100, 200);
      requireNumber(rhPct, 'Relative humidity (%)', 0, 100);
      requireNumber(pressurePa, 'Absolute pressure (Pa)', 1000, 120000);
      return { temperatureC, rhPct, pressurePa,
        source: fromWeather ? weatherSource(weather, row)
          : { kind: 'manual', label: short(form.sourceNote) || 'Manually supplied scenario; not measured indoor conditions' } };
    }
    function atmosphere(captured) {
      const { form, row, weather, project, solar } = captured;
      const suppliedAltitude = finite(solar?.altitudeM) ? solar.altitudeM : finite(project.site?.altitudeM)
        ? project.site.altitudeM : form.mode === 'weather' ? weather?.source?.elevationM ?? null : null;
      const manualPressure = numeric(form.pressureHpa);
      return {
        altitudeM: numeric(form.altitudeM) ?? suppliedAltitude,
        temperatureC: form.mode === 'weather' ? weatherValue(row, 'temperatureC') : numeric(form.temperatureC),
        pressurePa: form.mode === 'weather' ? weatherValue(row, 'pressurePa') : manualPressure === null ? null : manualPressure * 100,
      };
    }
    function solarPayload(captured) {
      const { form, solar, row, weather } = captured;
      requireNumber(solar.latitude, 'Selected latitude', -90, 90);
      requireNumber(solar.longitude, 'Selected longitude', -180, 180);
      if (!solar.timeZone || !solar.date) throw inputError('Choose the site, IANA time zone and date in Sun Path first.');
      if (form.mode === 'weather' && !row) throw inputError('Select an imported weather record or choose Manual / reference conditions.');
      let instantUTC = solar.instantUTC;
      if (!instantUTC) {
        if (!runtime.HomeSun?.resolveLocal) throw inputError('Load sun-model.js to resolve the selected civil time.');
        instantUTC = runtime.HomeSun.resolveLocal(solar.date, solar.time, solar.timeZone, solar.occurrence).instant.toISOString();
      }
      if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(instantUTC) || !Number.isFinite(Date.parse(instantUTC)))
        throw inputError('Choose a real, explicitly zoned solar instant.');
      const values = atmosphere(captured);
      for (const [key, bounds] of Object.entries({ altitudeM: [-500, 9000], pressurePa: [1000, 120000], temperatureC: [-100, 100] })) {
        if (values[key] !== null) requireNumber(values[key], key, ...bounds);
        else if (!form.acknowledgeReferenceAtmosphere)
          throw inputError('Supply the missing atmosphere values or tick the reference-values acknowledgement.');
      }
      const sampleMinutes = requireNumber(numeric(form.sampleMinutes), 'Path interval (minutes)', 5, 60);
      if (!Number.isInteger(sampleMinutes)) throw inputError('Choose a whole-minute path interval.');
      return { latitude: solar.latitude, longitude: solar.longitude, timeZone: solar.timeZone,
        date: solar.date, instantUTC, ...values, sampleMinutes,
        acknowledgeReferenceAtmosphere: form.acknowledgeReferenceAtmosphere,
        source: form.mode === 'weather' ? weatherSource(weather, row)
          : { kind: 'manual', label: 'Supplied / explicitly acknowledged atmosphere for the selected Sun Path site' } };
    }
    function validateResponse(kind, value, input) {
      if (value?.status !== 'ok' || !value.engine?.version || !Array.isArray(value.assumptions))
        throw inputError('The local service returned incomplete calculation evidence.', 'invalid_response');
      if (canonical(value.inputs?.source) !== canonical(input.source))
        throw inputError('The local service returned different input provenance.', 'invalid_response');
      if (kind === 'density') {
        if (value.kind !== 'air-density' || value.engine.name !== 'PsychroLib' || !finite(value.output?.densityKgM3) ||
            value.output.densityKgM3 <= 0 || !['temperatureC', 'rhPct', 'pressurePa'].every(key => value.inputs?.[key] === input[key]))
          throw inputError('The local service returned invalid or mismatched density evidence.', 'invalid_response');
      } else {
        const output = value.output, path = output?.path;
        const validPosition = row => row && finite(row.azimuthDeg) && row.azimuthDeg >= 0 && row.azimuthDeg <= 360 &&
          ['geometricElevationDeg', 'apparentElevationDeg'].every(key => finite(row[key]) && row[key] >= -90 && row[key] <= 90) &&
          typeof row.instantUTC === 'string' && Number.isFinite(Date.parse(row.instantUTC)) &&
          typeof row.localTime === 'string' && Date.parse(row.localTime) === Date.parse(row.instantUTC) &&
          row.aboveHorizon === (row.apparentElevationDeg > 0);
        if (value.kind !== 'solar-position' || value.engine.name !== 'pvlib' || !validPosition(output?.selected) ||
            !Array.isArray(path) || path.length < 2 || path.length > MAX_SAMPLES ||
            !path.every((row, i) => validPosition(row) && (!i || Date.parse(row.instantUTC) > Date.parse(path[i - 1].instantUTC))) ||
            !finite(output.day?.durationHours) || output.day.durationHours < 20 || output.day.durationHours > 26 ||
            !['latitude', 'longitude', 'date', 'timeZone'].every(key => value.inputs?.[key] === input[key]) ||
            !Object.entries(REFERENCE).every(([key, reference]) => value.inputs?.[key] === (input[key] ?? reference)) ||
            Date.parse(output.selected.instantUTC) !== Date.parse(input.instantUTC))
          throw inputError('The local service returned invalid or mismatched solar evidence.', 'invalid_response');
      }
      return value;
    }
    function validateCurrentWeather(value, input, captured) {
      const weather = value?.weather, row = weather?.records?.[0];
      if (weather?.kind !== 'current-model' || weather.source?.provider !== 'Open-Meteo' ||
          weather.requestedSite?.latitude !== input.latitude || weather.requestedSite?.longitude !== input.longitude ||
          weather.records?.length !== 1 || !row || !Number.isFinite(Date.parse(row.timestamp)) ||
          !finite(row.intervalSeconds) || row.intervalSeconds <= 0 || row.intervalSeconds > 3600 ||
          weather.units?.temperatureC !== 'C' || weather.units?.rhPct !== '%' || weather.units?.pressurePa !== 'Pa')
        throw inputError('The weather service returned incomplete or mismatched model data. Previous inputs retained.', 'invalid_response');
      const payload = densityPayload({ ...captured, weather, row, form: { ...captured.form, mode: 'current' } });
      return validateResponse('density', value, payload);
    }
    async function requestCalculation(kind, payload, token, endpoint, validate) {
      if (!localService(runtime)) throw inputError(SERVICE_HELP, 'service_unavailable');
      const fetcher = options.fetch || runtime.fetch?.bind(runtime);
      if (!fetcher) throw inputError(SERVICE_HELP, 'service_unavailable');
      const abort = runtime.AbortController ? new runtime.AbortController() : null;
      let cancel, timer;
      const cancelled = new Promise((_, reject) => { cancel = () => reject(inputError('Cancelled.', 'cancelled')); });
      jobs[kind] = { token, abort, cancel };
      const timeout = new Promise((_, reject) => {
        timer = (runtime.setTimeout || setTimeout)(() => {
          abort?.abort(); reject(inputError('The local calculation timed out. Check the service and retry.', 'timeout'));
        }, options.timeoutMs ?? 20000);
      });
      const operation = (async () => {
        let response;
        try {
          response = await fetcher(`/api/analysis/${endpoint || (kind === 'density' ? 'air-density' : 'solar-position')}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            cache: 'no-store', body: JSON.stringify(payload), signal: abort?.signal,
          });
        } catch (_) { throw inputError(SERVICE_HELP, 'service_unavailable'); }
        if ([404, 405, 501].includes(response.status)) throw inputError(SERVICE_HELP, 'service_unavailable');
        let value;
        try { value = await response.json(); }
        catch (_) { throw inputError(SERVICE_HELP, 'service_unavailable'); }
        if (!response.ok) {
          if (value.error?.code === 'dependency_unavailable')
            throw inputError(`Calculation library unavailable. Run ${INSTALL}, then restart with ${LAUNCH}.`, 'service_unavailable');
          // Do not render arbitrary HTML, proxy failures or Python tracebacks from a service.
          const safeCodes = ['invalid_input', 'reference_acknowledgement_required', 'analysis_busy', 'calculation_failed',
            'external_lookup_not_acknowledged', 'weather_rate_limited', 'weather_unavailable', 'weather_invalid_response',
            'weather_timeout', 'weather_stale'];
          throw inputError(safeCodes.includes(value.error?.code) ? short(value.error.message, 420)
            : 'Local service rejected this request. Check the inputs and service, then retry.');
        }
        return validate ? validate(value, payload) : validateResponse(kind, value, payload);
      })();
      try { return await Promise.race([operation, cancelled, timeout]); }
      finally {
        (runtime.clearTimeout || clearTimeout)(timer);
        if (jobs[kind]?.token === token) jobs[kind] = null;
      }
    }
    async function calculate(kind, applyDensity, fetchWeather = false) {
      if (disposed || !sync()) return null;
      let captured = capture(kind), data = captured.data;
      invalidate(kind, data, fetchWeather
        ? 'Requesting Open-Meteo model weather for the saved site, then calculating density locally…'
        : 'Calculating locally…', 'pending');
      const token = generations[kind];
      data[kind].key = captured.key; notify();
      try {
        if (!localService(runtime)) throw inputError(SERVICE_HELP, 'service_unavailable');
        if (kind === 'density' && applyDensity && (!getAirflow()?.setDraft || captured.airflow?.projectId !== captured.project.id))
          throw inputError('Open the Airflow workbench to create the current project’s scenario, then calculate & use density.');
        const payload = fetchWeather ? {
          latitude: requireNumber(captured.project.site?.latitude, 'Saved site latitude', -90, 90),
          longitude: requireNumber(captured.project.site?.longitude, 'Saved site longitude', -180, 180),
          acknowledgeOpenMeteo: true,
        } : kind === 'density' ? densityPayload(captured) : solarPayload(captured);
        const result = await requestCalculation(kind, payload, token,
          fetchWeather ? 'current-weather-density' : undefined,
          fetchWeather ? (value, input) => validateCurrentWeather(value, input, captured) : undefined);
        if (disposed || token !== generations[kind]) return null;
        if (capture(kind).key !== captured.key ||
            kind === 'density' && captured.airflowController !== getAirflow()) {
          invalidate(kind, data); notify(); return null;
        }
        let applied = false;
        if (kind === 'density' && applyDensity) {
          const controller = getAirflow(), current = controller.getState();
          const source = result.inputs.source;
          const location = (result.weather || (captured.form.mode === 'current' ? captured.weather : null))?.requestedSite;
          const note = `${result.engine.name} ${result.engine.version}; ${source.label}; ` +
            `${result.inputs.temperatureC} °C, ${result.inputs.rhPct}% RH, ${result.inputs.pressurePa} Pa absolute` +
            `${source.recordTimestamp ? `; record ${source.recordTimestamp}` : ''}` +
            `${location ? `; saved site ${location.latitude}, ${location.longitude}; Open-Meteo model, not on-site measurement` : ''}` +
            '. Weather/scenario estimate, not measured indoor density.';
          applying = true;
          let draft;
          try { draft = controller.setDraft({ densityKgM3: result.output.densityKgM3,
            sources: { ...(current.draft.sources || {}), densityKgM3: note } }); }
          finally { applying = false; }
          if (!draft || draft.densityKgM3 !== result.output.densityKgM3)
            throw inputError('Density was calculated but the current airflow draft rejected the update. Review that workbench and retry.');
          applied = true;
          if (fetchWeather) { data.currentWeather = copy(result.weather); data.densityInputs.mode = 'current'; }
          captured = capture(kind);
        }
        Object.assign(data[kind], { status: 'current', key: captured.key, result, applied,
          message: kind === 'density' ? applied
            ? fetchWeather ? 'Open-Meteo model sample retained for this session; density applied to the airflow draft. Imported weather is unchanged.'
              : 'Estimate applied to the current airflow scenario draft. Run airflow separately.'
            : 'Density estimate calculated; the airflow draft was not changed.'
            : 'Python solar position and daily path calculated. Existing SunCalc plots are unchanged.' });
        notify(); return copy(result);
      } catch (error) {
        if (disposed || token !== generations[kind] || error.code === 'cancelled') return null;
        if (capture(kind).key !== captured.key) { invalidate(kind, data); notify(); return null; }
        Object.assign(data[kind], { status: error.code === 'service_unavailable' ? 'unavailable' : 'failed',
          message: error.message || 'Calculation failed. Check the inputs and retry.', result: null, applied: false });
        notify(); return null;
      }
    }
    ownerId = planner.getProject().id; session(planner.getProject()); attachAirflow();
    const unsubscribe = planner.subscribe?.(sync);
    return {
      getState, sync, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      setDensityInputs(patch) { setInputs('density', patch); },
      setSolarInputs(patch) { setInputs('solar', patch); },
      notifyDensityDraftInput() {
        if (disposed) return;
        invalidate('density', session(planner.getProject()), 'Airflow input is being edited. No pending density estimate will overwrite it.');
        notify();
      },
      calculateDensity({ apply = true } = {}) { return calculate('density', apply); },
      getWeatherForLocation() { return calculate('density', true, true); },
      calculateSolar() { return calculate('solar', false); },
      cancel(kind) {
        if (!['density', 'solar'].includes(kind) || disposed) return;
        invalidate(kind, session(planner.getProject()), 'Cancelled. Drafts retained; no new result applied.', 'cancelled'); notify();
      },
      dispose() {
        disposed = true; for (const kind of ['density', 'solar']) cancelJob(kind);
        unsubscribe?.(); offAirflow?.(); listeners.clear(); sessions.clear();
      },
    };
  }

  function solarChart(result) {
    const rows = result.output.path, selected = result.output.selected;
    const start = Date.parse(rows[0].instantUTC), end = Date.parse(rows[rows.length - 1].instantUTC);
    const x = instant => 48 + (Date.parse(instant) - start) / (end - start) * 512;
    const y = angle => 22 + (90 - angle) / 180 * 170;
    const curve = key => rows.map((row, i) => `${i ? 'L' : 'M'}${x(row.instantUTC).toFixed(2)} ${y(row[key]).toFixed(2)}`).join(' ');
    const grid = [-90, -45, 0, 45, 90].map(angle =>
      `<path class="${angle === 0 ? 'hp-python-horizon' : 'hp-python-grid'}" d="M48 ${y(angle)}H560"/>` +
      `<text x="42" y="${y(angle) + 4}" text-anchor="end">${angle}°</text>`).join('');
    const ticks = [0, .25, .5, .75, 1].map(fraction => {
      const row = rows[Math.round((rows.length - 1) * fraction)], local = row.localTime || row.instantUTC;
      return `<text x="${x(row.instantUTC)}" y="210" text-anchor="middle">${esc(local.slice(11, 16))}</text>` +
        `<text x="${x(row.instantUTC)}" y="226" text-anchor="middle">${esc(local.slice(19))}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 262" role="img" aria-label="pvlib daily solar elevation in degrees">
      <title>pvlib daily solar elevation — ${esc(result.inputs.date)}</title>
      <desc>Geometric and apparent elevation, including night. Horizontal distance is elapsed UTC time; local ticks show offsets for ${esc(result.inputs.timeZone)}.</desc>
      ${grid}${ticks}
      <path class="hp-python-geometric" d="${curve('geometricElevationDeg')}"/>
      <path class="hp-python-apparent" d="${curve('apparentElevationDeg')}"/>
      <circle class="hp-python-marker" cx="${x(selected.instantUTC)}" cy="${y(selected.apparentElevationDeg)}" r="4">
        <title>Selected instant: ${nice(selected.apparentElevationDeg)}° apparent elevation</title>
      </circle>
      <text x="48" y="253">Solid: apparent · dashed: geometric · 0° horizon</text>
    </svg>`;
  }

  function mount(options = {}) {
    const runtime = options.runtime || root, doc = options.document || runtime.document;
    if (!doc) return null;
    const host = value => typeof value === 'string' ? doc.getElementById(value) : value;
    const densityHost = host(options.densityHost || HOSTS.density), solarHost = host(options.solarHost || HOSTS.solar);
    if (!densityHost && !solarHost) return null;
    const existing = densityHost?.homePlannerPythonAnalysis || solarHost?.homePlannerPythonAnalysis;
    if (existing) return existing;
    let controller;
    try { controller = createController({ ...options, runtime }); }
    catch (error) {
      for (const element of [densityHost, solarHost]) if (element) element.textContent = error.message;
      return null;
    }
    const panels = {};
    function element(tag, text = '', className = '') {
      const node = doc.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
    }
    function field(container, label, name, kind, type = 'number') {
      const wrapper = element('label', label), input = element('input');
      input.id = `hp-python-${kind}-${name}`; input.type = type; input.step = 'any';
      wrapper.htmlFor = input.id; wrapper.append(input); container.append(wrapper);
      input.addEventListener('input', () => controller[kind === 'density' ? 'setDensityInputs' : 'setSolarInputs']({
        [name]: type === 'checkbox' ? input.checked : input.value,
      }));
      return input;
    }
    for (const [kind, target] of Object.entries({ density: densityHost, solar: solarHost })) {
      if (!target) continue;
      const card = element('section', '', 'hp-python-analysis');
      card.setAttribute('aria-label', kind === 'density' ? 'Python air density estimate' : 'Python solar calculation');
      card.append(element('h3', kind === 'density' ? 'Estimate air density' : 'Python solar position & daily path'));
      card.append(element('p', kind === 'density'
        ? 'Use imported weather or supplied conditions. Calculate & use updates only this airflow scenario draft.'
        : 'Use the selected Sun Path site and clock. pvlib runs locally only when requested.', 'hp-python-help'));
      let getWeatherButton = null, disclosure = null;
      if (kind === 'density') {
        const retrieval = element('div', '', 'hp-python-weather-retrieval');
        getWeatherButton = element('button', 'Get weather for this location — Open-Meteo');
        getWeatherButton.id = 'hp-python-density-get-weather'; getWeatherButton.type = 'button';
        disclosure = element('p', '', 'hp-python-help'); disclosure.id = 'hp-python-weather-disclosure';
        getWeatherButton.setAttribute('aria-describedby', disclosure.id);
        getWeatherButton.addEventListener('click', () => { void controller.getWeatherForLocation(); });
        retrieval.append(getWeatherButton, disclosure); card.append(retrieval);
      }
      const selected = element('p', '', 'hp-python-help'); if (kind === 'solar') card.append(selected);
      const inputs = element('div', '', 'hp-python-fields');
      const modeLabel = element('label', 'Conditions'), mode = element('select');
      mode.id = `hp-python-${kind}-mode`; modeLabel.htmlFor = mode.id;
      for (const [value, label] of [['weather', 'Imported weather record'],
        ['manual', kind === 'density' ? 'Manual temperature, pressure & RH' : 'Manual / reference conditions']]) {
        const option = element('option', label); option.value = value; mode.append(option);
      }
      if (kind === 'density') {
        const option = element('option', 'Fetched Open-Meteo sample (session only)'); option.value = 'current'; mode.append(option);
      }
      mode.addEventListener('change', () => controller[kind === 'density' ? 'setDensityInputs' : 'setSolarInputs']({ mode: mode.value }));
      modeLabel.append(mode); inputs.append(modeLabel);
      const weatherBox = element('div', '', 'hp-python-weather');
      const recordIndex = field(weatherBox, 'Weather record #', 'recordIndex', kind);
      recordIndex.min = '1'; recordIndex.step = '1';
      const weatherSummary = element('p', '', 'hp-python-help'); weatherBox.append(weatherSummary);
      inputs.append(weatherBox);
      const currentSummary = element('p', '', 'hp-python-help');
      if (kind === 'density') inputs.append(currentSummary);
      const manual = element('div', '', 'hp-python-fields');
      const fields = { mode, recordIndex };
      fields.temperatureC = field(manual, 'Air temperature (°C)', 'temperatureC', kind);
      fields.pressureHpa = field(manual, 'Absolute station pressure (hPa)', 'pressureHpa', kind);
      if (kind === 'density') fields.rhPct = field(manual, 'Relative humidity (%)', 'rhPct', kind);
      inputs.append(manual); card.append(inputs);
      const advanced = element('details'), advancedBody = element('div', '', 'hp-python-fields');
      advanced.append(element('summary', 'Advanced inputs & provenance'));
      if (kind === 'density') fields.sourceNote = field(advancedBody, 'Manual input source / scenario note', 'sourceNote', kind, 'text');
      else {
        fields.altitudeM = field(advancedBody, 'Altitude override (m above sea level)', 'altitudeM', kind);
        fields.sampleMinutes = field(advancedBody, 'Path interval (minutes, 5–60)', 'sampleMinutes', kind);
        fields.sampleMinutes.min = '5'; fields.sampleMinutes.max = '60'; fields.sampleMinutes.step = '1';
      }
      const provenance = element('pre');
      if (kind === 'density') advanced.append(element('p',
        'Open-Meteo weather data: CC BY 4.0. Free API: non-commercial use with quotas and terms at https://open-meteo.com/en/terms. ' +
        'Current model data are not on-site measurements or historical weather.', 'hp-python-help'));
      advanced.append(advancedBody, provenance); card.append(advanced);
      const atmosphereSummary = element('p', '', 'hp-python-help');
      const acknowledgeBox = element('div', '', 'hp-python-ack');
      if (kind === 'solar') {
        card.append(atmosphereSummary);
        fields.acknowledgeReferenceAtmosphere = field(acknowledgeBox,
          'For missing fields, use reference values: 0 m above sea level, 101325 Pa and 15 °C (not measured).',
          'acknowledgeReferenceAtmosphere', kind, 'checkbox');
        card.append(acknowledgeBox);
      }
      const toolbar = element('div', '', 'hp-python-toolbar');
      const calculate = element('button', kind === 'density' ? 'Calculate & use density' : 'Calculate Python sun path');
      calculate.type = 'button'; calculate.id = `hp-python-${kind}-calculate`;
      const cancel = element('button', 'Cancel'); cancel.type = 'button'; cancel.id = `hp-python-${kind}-cancel`;
      calculate.addEventListener('click', () => { void (kind === 'density' ? controller.calculateDensity() : controller.calculateSolar()); });
      cancel.addEventListener('click', () => controller.cancel(kind));
      toolbar.append(calculate, cancel); card.append(toolbar);
      const status = element('p', '', 'hp-python-status'); status.id = `hp-python-${kind}-status`;
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const output = element('div', '', 'hp-python-output'); output.id = `hp-python-${kind}-output`;
      card.append(status, output); target.append(card); target.homePlannerPythonAnalysis = controller;
      panels[kind] = { card, fields, selected, weatherBox, weatherSummary, manual, provenance, atmosphereSummary,
        acknowledgeBox, calculate, cancel, status, output, getWeatherButton, disclosure, currentSummary, renderedResult: null };
    }
    function render(state) {
      for (const [kind, panel] of Object.entries(panels)) {
        const form = state[`${kind}Inputs`], analysis = state[kind];
        for (const [key, input] of Object.entries(panel.fields)) {
          if (input.type === 'checkbox') input.checked = form[key];
          else if (input.value !== String(form[key] ?? '')) input.value = String(form[key] ?? '');
        }
        panel.fields.recordIndex.max = String(state.weatherCount || 1);
        panel.fields.mode.querySelector('option[value="weather"]').disabled = !state.weatherCount;
        panel.weatherBox.hidden = form.mode !== 'weather'; panel.manual.hidden = form.mode !== 'manual';
        const row = state[`${kind}Weather`];
        panel.weatherSummary.textContent = row ? `${state.weatherLabel} · ${form.recordIndex}/${state.weatherCount} · ${row.timestamp} (interval end). ` +
          `${nice(weatherValue(row, 'temperatureC'))} °C · ${nice(weatherValue(row, 'pressurePa'))} Pa` +
          (kind === 'density' ? ` · ${nice(weatherValue(row, 'rhPct'))}% RH` : '') : 'No selected record. Import in Site or choose Manual conditions.';
        if (kind === 'density') {
          const weather = state.currentWeather, sample = weather?.records?.[0], site = state.savedSite;
          panel.fields.mode.querySelector('option[value="current"]').disabled = !weather;
          panel.getWeatherButton.disabled = analysis.status === 'pending';
          panel.disclosure.textContent = `Click sends the CURRENT SAVED site (${finite(site.latitude) ? site.latitude : 'latitude unknown'}, ` +
            `${finite(site.longitude) ? site.longitude : 'longitude unknown'}) to Open-Meteo, then calculates and uses density in this airflow draft. ` +
            'No geolocation; imported EPW/JSON and manual inputs are kept.';
          panel.currentSummary.hidden = form.mode !== 'current';
          panel.currentSummary.textContent = sample
            ? `Open-Meteo model sample valid ${sample.timestamp}; fetched ${weather.fetchedAtUTC}. ` +
              `${nice(sample.temperatureC)} °C · ${nice(sample.rhPct)}% RH · ${nice(sample.pressurePa)} Pa surface pressure (not sea-level pressure). ` +
              `Returned grid ${nice(weather.latitude, 4)}, ${nice(weather.longitude, 4)}; model elevation ${nice(weather.source?.elevationM)} m above sea level. ` +
              'Session-only sample, not measured at the house or historical weather.'
            : 'No fetched sample. Get weather explicitly or keep using imported/manual conditions.';
        }
        if (kind === 'solar') {
          const solar = state.solarInput, values = state.solarAtmosphere;
          panel.selected.textContent = `Sun Path draft: ${nice(solar.latitude, 4)}, ${nice(solar.longitude, 4)} · ` +
            `${solar.date || 'date unknown'} ${solar.time || solar.instantUTC || ''} · ${solar.timeZone || 'zone unknown'}.`;
          panel.atmosphereSummary.textContent = `Supplied/reference atmosphere: altitude ${nice(values.altitudeM)} m above sea level · ` +
            `${nice(values.temperatureC)} °C · ${nice(values.pressurePa)} Pa. ` +
            (form.mode === 'weather' ? 'Station/grid altitude is not a surveyed house elevation. ' : '') +
            'Values are constant along this path; expand Advanced to override altitude.';
          panel.acknowledgeBox.hidden = Object.values(values).every(value => value !== null);
        }
        panel.card.dataset.state = analysis.status;
        panel.card.setAttribute('aria-busy', String(analysis.status === 'pending'));
        panel.status.textContent = analysis.message;
        panel.calculate.disabled = analysis.status === 'pending';
        panel.cancel.hidden = analysis.status !== 'pending';
        panel.provenance.textContent = analysis.result ? JSON.stringify({
          engine: analysis.result.engine, inputs: analysis.result.inputs, assumptions: analysis.result.assumptions,
          ...(kind === 'density' && form.mode === 'current' ? { weather: state.currentWeather } : {}),
        }, null, 2) : 'No current calculation evidence. Inputs/results remain session drafts unless explicitly exported through the airflow workbench.';
        if (panel.renderedResult === analysis.result) continue;
        panel.renderedResult = analysis.result; panel.output.replaceChildren();
        if (!analysis.result) continue;
        const result = analysis.result;
        if (kind === 'density') {
          panel.output.append(element('strong', `${nice(result.output.densityKgM3, 5)} kg/m³`));
          panel.output.append(element('p', `${result.engine.name} ${result.engine.version} · weather/scenario estimate, not measured indoor density.`, 'hp-python-help'));
        } else {
          const selected = result.output.selected;
          panel.output.append(element('strong', `${nice(selected.azimuthDeg)}° azimuth · ${nice(selected.apparentElevationDeg)}° apparent elevation`));
          panel.output.append(element('p', `${nice(selected.geometricElevationDeg)}° geometric elevation · ` +
            `${selected.aboveHorizon ? 'Above' : 'Below'} apparent horizon · ${selected.localTime}.`, 'hp-python-help'));
          const chart = element('div', '', 'hp-python-chart'); chart.innerHTML = solarChart(result);
          panel.output.append(chart, element('p', `${result.engine.name} ${result.engine.version} · ${result.output.day.durationHours} h civil day · ` +
            `${result.output.path.length} samples · ${result.inputs.timeZone}. Position only, not shade or solar energy.`, 'hp-python-help'));
        }
      }
    }
    const unsubscribe = controller.subscribe(render);
    const onSolar = () => controller.sync();
    const onInput = event => {
      if (['sunLatitude', 'sunLongitude', 'sunDate', 'sunTime', 'sunTimeZone', 'sunOccurrence'].includes(event.target?.id))
        controller.sync();
      // The airflow form commits on change. An in-progress input event must also
      // veto pending estimates, before its accepted controller draft has changed.
      if (event.type === 'input' && event.target?.closest?.('#hp-airflow-inputs') &&
          !event.target.closest('.hp-python-analysis')) controller.notifyDensityDraftInput();
    };
    doc.addEventListener('homeplanner:sun-change', onSolar);
    doc.addEventListener('homeplanner:project-context', onSolar);
    doc.addEventListener('input', onInput);
    doc.addEventListener('change', onInput);
    const dispose = controller.dispose;
    controller.dispose = () => {
      unsubscribe(); dispose();
      doc.removeEventListener('homeplanner:sun-change', onSolar);
      doc.removeEventListener('homeplanner:project-context', onSolar);
      doc.removeEventListener('input', onInput); doc.removeEventListener('change', onInput);
      for (const [kind, target] of Object.entries({ density: densityHost, solar: solarHost })) {
        if (target?.homePlannerPythonAnalysis === controller) delete target.homePlannerPythonAnalysis;
        panels[kind]?.card.remove();
      }
    };
    render(controller.getState());
    return controller;
  }

  return { createController, mount, solarChart, readSolarInput, numeric, HOSTS, LAUNCH, INSTALL, SERVICE_HELP, REFERENCE, MAX_SAMPLES };
});
