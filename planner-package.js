(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const names = ['Model', 'Features', 'Drawing', 'Elevation', 'Structure', 'StructureDrawing',
    'Services', 'ServicesDrawing', 'Drainage', 'DrainageDrawing', 'Airflow', 'Light'];
  const files = ['model', 'features', 'drawing', 'elevation', 'structure', 'structure-drawing',
    'services', 'services-drawing', 'drainage', 'drainage-drawing', 'airflow', 'light'];
  const api = factory(...names.map((name, i) => common ? require('./planner-' + files[i] + '.js') : root['HomePlanner' + name]));
  if (common) module.exports = api;
  else root.HomePlannerPackage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  Model, Features, Drawing, Elevation, Structure, StructureDrawing, Services, ServicesDrawing,
  Drainage, DrainageDrawing, Airflow, Light
) {
  'use strict';
  const MAX_PAGES = 100, INK = '#263238';
  const copy = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error('Coordinated package: ' + message); };
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function defaults() {
    return { version: 1, title: '', paper: 'A3', orientation: 'landscape',
      scaleDenominator: 100, units: 'metric', pngDpi: 150 };
  }
  function normalizeSettings(value) {
    Model.assertJSON(value);
    Features.validate({ floors: [], documentation: { version: 1, views: [], sheets: [], package: value } });
    return freeze(copy(value));
  }
  function text(sheet, x, y, value, size = 2.5) {
    sheet.primitives.push({ type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size,
      align: 'start', rotationDeg: 0, color: INK });
  }
  function path(sheet, points, color = INK, closed = false) {
    sheet.primitives.push({ type: 'path', commands: points.map(([x, y], i) => [i ? 'L' : 'M', x, y])
      .concat(closed ? [['Z']] : []), fill: null, stroke: color, strokeWidthMm: .25 });
  }
  // Worst-case shared text bounds: wide Unicode is 1.05 em. Split even unbroken IDs.
  function wrap(value, width) {
    const chars = Array.from(String(value)), count = Math.max(1, Math.min(200, Math.floor(width / 2.625)));
    const result = [];
    for (let i = 0; i < chars.length; i += count) {
      const line = chars.slice(i, i + count).join('');
      if (line.trim()) result.push(line);
    }
    return result.length ? result : ['(empty)'];
  }
  function build(drawingScene, settings = defaults(), options = {}) {
    if (![Model, Features, Drawing, Elevation, Structure, StructureDrawing, Services, ServicesDrawing,
      Drainage, DrainageDrawing, Airflow, Light].every(Boolean)) fail('Load all shared drawing and analysis modules first.');
    const config = normalizeSettings(settings);
    Model.assertJSON(drawingScene);
    const scene = copy(drawingScene);
    if (scene?.version !== 1 || scene.kind !== 'DrawingScene' || !Array.isArray(scene.scenes) ||
      !Array.isArray(scene.authored) || !Array.isArray(scene.diagnostics) || !scene.documentation ||
      typeof scene.inputFingerprint !== 'string') fail('A complete shared DrawingScene with source fingerprint is required.');
    if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).some(k => !['airflow', 'light'].includes(k) ||
        !Object.getOwnPropertyDescriptor(options, k).enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value'))) fail('Unknown or non-data analysis options.');
    let source;
    try { source = JSON.parse(scene.inputFingerprint); } catch { fail('DrawingScene source fingerprint is not canonical project JSON.'); }
    if (!Array.isArray(source?.document?.floors)) fail('Source fingerprint must retain all canonical floors.');
    Model.assertJSON(source);
    const floors = source.document.floors;
    const floorIds = floors.map(f => f.id);
    if (floorIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(floorIds).size !== floorIds.length)
      fail('Invalid source floor identities.');
    if (new Set(scene.scenes.map(f => f.floorId)).size !== scene.scenes.length ||
      scene.scenes.some(f => !floorIds.includes(f.floorId))) fail('Ambiguous or foreign projected floor.');
    const byFloor = new Map(scene.scenes.map(f => [f.floorId, f]));
    for (const d of scene.diagnostics) if (d.code === 'invalid-geometry') fail(d.message || 'Invalid floor geometry.');
    for (const f of scene.scenes) {
      if ((f.unresolvedOpenings || []).length || (f.diagnostics || []).some(d => d.level === 'error' || d.severity === 'error'))
        fail('Resolve rejected openings or invalid geometry on ' + f.floorId + '.');
    }
    const findings = [], entries = [], attachments = [], electrical = [], analysis = {};
    const sourceIdentity = { projectId: scene.projectId, revision: scene.revision,
      inputFingerprint: scene.inputFingerprint, drawingSceneFingerprint: Model.stableStringify(scene) };
    const media = Drawing.PAPER_SIZES[config.paper];
    const widthMm = media[config.orientation === 'portrait' ? 'widthMm' : 'heightMm'];
    const heightMm = media[config.orientation === 'portrait' ? 'heightMm' : 'widthMm'];
    const pageLines = Math.floor((heightMm - 50) / 5);
    function addFinding(discipline, f, ref = null) {
      const reference = ref ?? f.reference ?? null;
      const floorId = reference?.floorId ?? f.floorId ?? null;
      const entityId = reference?.entityId ?? f.entityId ?? null;
      const record = { id: 'F' + String(findings.length + 1).padStart(4, '0'),
        code: f.code || 'source-warning', message: f.message || f.code || String(f),
        floorId, entityId, reference: copy(reference), discipline, severity: f.severity || 'warning' };
      findings.push(record);
      return record.id;
    }
    function aggregate(discipline, records) {
      for (const f of records) {
        let refs = f.entityRefs;
        if (!refs?.length && f.floorId) {
          const ids = f.elementIds || f.entityIds || [];
          // Related raw IDs can refer to foreign floors. Link only proven exact owners.
          refs = ids.filter(id => scene.authored.some(e => e.floorId === f.floorId && e.record.id === id) ||
            ['rooms', 'walls', 'openings', 'furniture', 'obstacles', 'electrical'].some(collection =>
              byFloor.get(f.floorId)?.[collection]?.some(e => e.id === id)))
            .map(entityId => ({ floorId: f.floorId, entityId }));
        }
        if (refs?.length) refs.forEach(ref => addFinding(discipline, f, ref));
        else addFinding(discipline, f);
      }
    }
    for (const d of scene.diagnostics) {
      const owner = scene.authored.find(e => e.record.id === d.ownerId);
      addFinding('projection', { ...d, floorId: owner?.floorId ?? (floorIds.includes(d.ownerId) ? d.ownerId : null),
        entityId: owner?.record.id ?? null }, owner ? { floorId: owner.floorId, entityId: owner.record.id } : d.reference);
    }
    aggregate('structure', Structure.build(scene).findings);
    aggregate('plumbing', Services.build(scene).findings);
    aggregate('drainage', Drainage.build(scene).findings);
    function blank(title, floorId = null, scale = config.scaleDenominator) {
      return { version: 1, widthMm, heightMm, metadata: { projectId: scene.projectId, revision: scene.revision,
        floorId: floorId ?? 'package', floorName: floorId ?? 'Project package', title,
        paper: config.paper, orientation: config.orientation, scaleDenominator: scale, units: config.units,
        assumptions: ['CONCEPTUAL - NOT CERTIFIED - NOT ENGINEERED. No construction or compliance approval.'] }, primitives: [] };
    }
    function report(title, rows, floorId = null) {
      const lines = rows.flatMap(row => wrap(row, widthMm - 28)), result = [];
      for (let i = 0; i < Math.max(1, lines.length); i += pageLines) {
        if (result.length >= MAX_PAGES) fail('100-page limit exceeded; no partial package.');
        const sheet = blank(title, floorId);
        text(sheet, 14, 16, title, 3);
        lines.slice(i, i + pageLines).forEach((line, j) => text(sheet, 14, 30 + j * 5, line));
        text(sheet, 14, heightMm - 12, 'CONCEPTUAL - NOT CERTIFIED - NOT ENGINEERED', 2);
        result.push(sheet);
      }
      return result;
    }
    function append(type, sheets, floorId = null, viewId = null, status = 'available', findingIds = []) {
      for (const sheet of sheets) {
        Drawing.validateSheet(sheet);
        entries.push({ sheet: copy(sheet), type, floorId, viewId, status, findingIds: findingIds.slice() });
        if (entries.length > MAX_PAGES) fail('100-page limit exceeded; no partial package.');
      }
    }
    function unavailable(type, reason, floorId = null, viewId = null) {
      const id = addFinding(type, { code: 'unavailable', message: reason, floorId });
      append(type, report(type.toUpperCase() + ' - UNAVAILABLE', [
        'Status: unavailable. ' + reason, 'Floor: ' + (floorId ?? 'project'), 'View: ' + (viewId ?? 'not applicable'),
        'No replacement geometry, analysis, terrain, discharge or zero-valued evidence has been invented.'
      ], floorId), floorId, viewId, 'unavailable', [id]);
    }
    function missingFloor(id) {
      if (!byFloor.has(id)) return 'Missing geometry or plot registration for floor ' + id + '.';
      const f = byFloor.get(id);
      if (f.coordinateSpace !== 'site-local' || !f.plot) return 'Missing site-local registration for floor ' + id + '.';
      const d = scene.diagnostics.find(d => d.ownerId === id &&
        ['missing-geometry', 'missing-plot', 'inconsistent-site-frame', 'unresolved-site-frame'].includes(d.code));
      return d ? d.code + ': ' + id : null;
    }
    const common = { paper: config.paper, orientation: config.orientation, scaleDenominator: config.scaleDenominator, units: config.units };
    function floorSheets(type, renderer, extra = {}) {
      for (const floor of floors) {
        const reason = missingFloor(floor.id);
        if (reason) unavailable(type, reason, floor.id);
        else append(type, renderer(scene, { ...common, floorId: floor.id, ...extra }), floor.id);
      }
    }
    const cover = report('COORDINATED CONCEPT PACKAGE', [
      config.title || 'Coordinated design review', 'CONCEPTUAL ONLY - NOT CERTIFIED - NOT ENGINEERED.',
      'Not for construction, structural approval, survey, permit, hydraulic sizing or electrical installation.',
      'One captured DrawingScene; geometry is shared, not an independently editable drawing store.',
      'Project: ' + scene.projectId, 'Captured revision: ' + scene.revision,
      'Paper: ' + config.paper + ' ' + config.orientation + '; default scale 1:' + config.scaleDenominator + '; units: ' + config.units,
      'Saved view scales override the default. Print actual size, never fit-to-page. Unknown inputs remain unknown.',
      'Analysis is supplied evidence only, never computed by this builder. See original provenance and JSON sidecars.',
      'All source floors and saved elevation/section views are indexed, including unavailable prerequisites.',
      'Site datum elevation (m): ' + (scene.siteDatum?.elevationM ?? 'unknown') + '. Terrain and discharge are not inferred.'
    ]);
    append('cover', cover);
    // The site plate is deliberately not an architectural plan relabeled as a site plan.
    const registered = floors.filter(f => !missingFloor(f.id)).map(f => byFloor.get(f.id));
    if (!registered.length) unavailable('site', 'No registered source floor plot is available.');
    else {
      const base = registered[0], plot = base.plot;
      const rectValid = r => r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) && r.w > 0 && r.h > 0;
      if (!rectValid(plot) || !Number.isFinite(base.headingDeg)) fail('Invalid site boundary or heading.');
      if (registered.some(f => !rectValid(f.plot) || f.plot.x !== plot.x || f.plot.y !== plot.y ||
        Math.abs(f.plot.w - plot.w) > 1e-7 || Math.abs(f.plot.h - plot.h) > 1e-7 ||
        Math.abs(f.headingDeg - base.headingDeg) > 1e-7)) fail('Inconsistent registered site frame.');
      const sheet = blank('SITE PLAN - SUPPLIED MODEL BOUNDARY');
      const factor = 1000 / config.scaleDenominator, top = 50, left = 22;
      const footprintBoxes = registered.flatMap(f => [f.floor, f.building]);
      if (footprintBoxes.some(r => !rectValid(r))) fail('Invalid actual floor/building footprint.');
      const all = [plot, ...footprintBoxes];
      const minX = Math.min(...all.map(r => r.x)), minY = Math.min(...all.map(r => r.y));
      const maxX = Math.max(...all.map(r => r.x + r.w)), maxY = Math.max(...all.map(r => r.y + r.h));
      if ((maxX - minX) * factor > widthMm - 75 || (maxY - minY) * factor > heightMm - 115)
        fail('Site geometry does not fit fixed paper and scale; no auto-shrink.');
      const box = (r, color) => {
        const x = left + (r.x - minX) * factor, y = top + (r.y - minY) * factor, w = r.w * factor, h = r.h * factor;
        path(sheet, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color, true);
      };
      text(sheet, 14, 16, 'SITE PLAN - SUPPLIED MODEL BOUNDARY', 3);
      text(sheet, 14, 27, 'Black: plot; blue: buildable floor plate; grey: actual building footprint.', 2);
      box(plot, INK);
      for (const f of registered) { box(f.floor, '#245A81'); box(f.building, '#647078'); }
      const measure = n => config.units === 'metric' ? n.toFixed(3) + ' m' : (n / .3048).toFixed(3) + ' ft';
      const px = left + (plot.x - minX) * factor, py = top + (plot.y - minY) * factor;
      path(sheet, [[px, py - 6], [px + plot.w * factor, py - 6]]);
      path(sheet, [[px - 6, py], [px - 6, py + plot.h * factor]]);
      text(sheet, px, py - 10, 'PLOT ' + measure(plot.w), 2);
      text(sheet, 14, heightMm - 48, 'PLOT depth: ' + measure(plot.h) + '; fixed scale 1:' + config.scaleDenominator, 2);
      const nx = widthMm - 30, ny = 65, angle = base.headingDeg * Math.PI / 180;
      const tip = [nx - Math.sin(angle) * 15, ny - Math.cos(angle) * 15];
      path(sheet, [[nx, ny], tip]);
      text(sheet, tip[0] - 1, tip[1] - 3, 'N', 2.5);
      text(sheet, 14, heightMm - 38, 'Heading: ' + base.headingDeg + ' deg; datum elevation (m): ' + (scene.siteDatum?.elevationM ?? 'unknown'), 2);
      text(sheet, 14, heightMm - 28, 'Not surveyed. Terrain, roads, discharge and boundary certification unknown.', 2);
      text(sheet, 14, heightMm - 18, 'CONCEPTUAL - NOT CERTIFIED - NOT ENGINEERED', 2);
      append('site', [sheet]);
      append('site-context', report('SITE CONTEXT / REGISTERED FOOTPRINTS', [
        'All coordinates below are actual supplied site-local metres, regardless of label units.',
        ...floors.map(f => JSON.stringify({ floorId: f.id, status: missingFloor(f.id) ? 'unavailable' : 'registered',
          plot: byFloor.get(f.id)?.plot ?? null, buildableFloor: byFloor.get(f.id)?.floor ?? null,
          building: byFloor.get(f.id)?.building ?? null, headingDeg: byFloor.get(f.id)?.headingDeg ?? null })),
        'Site datum: ' + JSON.stringify(scene.siteDatum), 'Terrain and verified discharge: unknown.'
      ]));
    }
    floorSheets('architecture', (s, o) => Drawing.createSheets(s, { ...o, layers: { site: false } }));
    const views = scene.documentation.views.filter(v => ['elevation', 'section'].includes(v.kind));
    if (!views.length) unavailable('views', 'No saved elevation or section views.');
    for (const view of views) {
      const reason = missingFloor(view.floorId) || floors.map(f => missingFloor(f.id)).find(Boolean) ||
        (view.kind === 'elevation' && !view.direction ? 'Saved elevation direction is unknown.' : null) ||
        (view.kind === 'section' && view.cut.some(a => a === null) ? 'Saved section cut has unknown anchors.' : null) ||
        (scene.diagnostics.some(d => d.ownerId === view.id) ? 'Saved view has unresolved source references.' : null);
      if (reason) unavailable(view.kind, reason, view.floorId, view.id);
      else append(view.kind, Elevation.createSheets(scene, { ...common, viewId: view.id,
        scaleDenominator: view.scaleDenominator ?? config.scaleDenominator }), view.floorId, view.id);
    }
    for (const saved of scene.documentation.sheets) for (const viewId of saved.viewIds)
      if (!scene.documentation.views.some(v => v.id === viewId)) unavailable('view', 'Saved sheet references a missing view.', null, viewId);
    floorSheets('structure', StructureDrawing.createSheets);
    floorSheets('plumbing-plan', ServicesDrawing.createSheets, { view: 'plan' });
    floorSheets('plumbing-riser', ServicesDrawing.createSheets, { view: 'riser' });
    floorSheets('drainage-plan', DrainageDrawing.createSheets, { view: 'plan' });
    floorSheets('drainage-profile', DrainageDrawing.createSheets, { view: 'profile' });
    for (const floor of floors) {
      const projected = byFloor.get(floor.id);
      const records = projected?.electrical ?? floor.electrical ?? [];
      for (const record of records) {
        const row = { floorId: floor.id, entityId: record.id ?? null, type: record.type ?? null,
          label: record.label ?? null, purpose: record.purpose ?? null,
          heightM: record.elevationM ?? null,
          elevationReference: record.elevationReference ?? null, coordinateSpace: 'site-local',
          point: record.resolvedPoint ?? null, positionStatus: record.positionStatus ?? 'unavailable',
          source: copy(record) };
        electrical.push(row);
        for (const d of record.positionDiagnostics || []) addFinding('electrical', d, { floorId: floor.id, entityId: record.id ?? null });
      }
    }
    append('electrical', report('ELECTRICAL - COMPLETE INTENT SCHEDULE', [
      'Intent only: no circuits, protection, light strength, illuminance or installation certification.',
      'Point coordinates: site-local metres. Unknown height/elevation reference is null, never zero by default.',
      'All records retained, including invalid/unresolved anchors; source objects are included without reinterpretation.',
      ...(electrical.length ? electrical.map(row => JSON.stringify(row)) : ['No electrical connection intent records supplied.'])
    ]));
    function evidence(kind, result) {
      const engine = kind === 'airflow' ? Airflow : Light;
      const inventory = engine.discover(scene);
      let reason = null, original = null;
      try {
        if (result === null || result === undefined) reason = 'not-run: no supplied ' + kind + ' evidence.';
        else {
          Model.assertJSON(result); original = copy(result);
          const p = original.provenance, air = kind === 'airflow', inv = original.inventory;
          if (original.version !== 1 || original.kind !== (air ? 'AirflowResult' : 'RoomLightStudy') ||
            !p || !inv || !Array.isArray(original.findings)) throw new Error('malformed result envelope');
          if (p.projectId !== scene.projectId || inv.projectId !== scene.projectId) throw new Error('stale source project identity');
          if (!Number.isSafeInteger(p.revision) || p.revision < 0 || inv.revision !== p.revision) throw new Error('malformed original revision');
          if (p.engineId !== (air ? 'HomePlannerAirflow' : 'HomePlannerLight')) throw new Error('unknown evidence engine');
          const physical = air ? p.physicalFingerprint : p.scenePhysicalFingerprint;
          if (physical !== inventory.physicalFingerprint || inv.physicalFingerprint !== inventory.physicalFingerprint)
            throw new Error('stale actual physical fingerprint');
          const sourceKey = air ? 'sourceInputFingerprint' : 'sourceFingerprint';
          if (typeof p[sourceKey] !== 'string' || !p[sourceKey] || inv[sourceKey] !== p[sourceKey])
            throw new Error('missing or inconsistent original source fingerprint');
          let originalSource;
          try { originalSource = JSON.parse(p[sourceKey]); } catch { throw new Error('malformed original source fingerprint'); }
          if (originalSource?.contractVersion !== 1 || !Array.isArray(originalSource.document?.floors) ||
            p.engineVersion !== (air ? '1' : 1)) throw new Error('malformed original source or engine version');
          for (const key of Object.keys(inventory)) {
            if (['revision', sourceKey].includes(key)) continue;
            if (!Object.hasOwn(inv, key) || Model.stableStringify(inv[key]) !== Model.stableStringify(inventory[key]))
              throw new Error('stale or malformed physical inventory: ' + key);
          }
          if (air) {
            const draft = Airflow.normalizeScenario(original.scenario);
            if (p.scenarioFingerprint !== Model.stableStringify(draft) ||
              p.inputFingerprint !== Model.stableStringify({ version: 1, physicalFingerprint: physical, scenarioFingerprint: p.scenarioFingerprint }))
              throw new Error('malformed airflow configuration fingerprint');
            if (!Array.isArray(original.zones) || !Array.isArray(original.links) || !Array.isArray(original.zoneResults) ||
              !Array.isArray(original.flowResults)) throw new Error('malformed airflow result arrays');
            if (original.status !== 'converged' || original.balanced !== true || original.solver?.converged !== true)
              throw new Error('not-validated: airflow status ' + original.status);
            if (original.solver.status !== 'converged' || !original.solverInput ||
              !Array.isArray(original.solver.flows) || !original.solver.pressures)
              throw new Error('malformed converged solver evidence');
            if (original.zoneResults.length !== original.zones.length || original.flowResults.length !== original.links.length ||
              original.zoneResults.some((z, i) => z.id !== original.zones[i].id || !z.roomRef ||
                Model.stableStringify(z.roomRef) !== Model.stableStringify(original.zones[i].roomRef) || !inventory.rooms.some(r =>
                Model.stableStringify(r.ref) === Model.stableStringify(z.roomRef)) ||
                !['pressurePa', 'inflowM3s', 'outflowM3s', 'directOutsideInflowM3s', 'directOutsideInflowACH',
                  'netOutflowM3s', 'massResidualKgS', 'transferInflowM3s'].every(k => Number.isFinite(z[k]))) ||
              original.flowResults.some((f, i) => f.id !== original.links[i].id ||
                !Number.isFinite(f.m3s) || f.numericalStatus !== 'converged'))
              throw new Error('malformed converged airflow metrics');
          } else {
            const normalized = Light.normalizeConfig(original.config);
            if (!Array.isArray(original.sensors) || !Array.isArray(original.sky?.sensorResults) ||
              !Array.isArray(original.direct?.sensorResults)) throw new Error('malformed light result arrays');
            if (p.physicalFingerprint !== Model.stableStringify({ scene: physical, neighborBoxes: normalized.neighborBoxes || [] }) ||
              p.sensorFingerprint !== Model.stableStringify(original.sensors) ||
              p.inputFingerprint !== Model.stableStringify({ physicalFingerprint: p.physicalFingerprint,
                sensorFingerprint: p.sensorFingerprint, config: normalized })) throw new Error('malformed light configuration fingerprint');
            if (!['complete', 'incomplete'].includes(original.status) || original.computationalComplete !== true)
              throw new Error('not-validated: light status ' + original.status + ', computation incomplete');
            if (original.sky.sensorResults.length !== original.sensors.length ||
              original.direct.sensorResults.length !== original.sensors.length || !original.context ||
              typeof original.complete !== 'boolean') throw new Error('malformed light metrics');
            const ids = original.sensors.map(s => s.id);
            if (new Set(ids).size !== ids.length || typeof original.direct.complete !== 'boolean' ||
              !['known-supplied-model', 'unknown-context'].includes(original.context.status)) throw new Error('malformed completed light context');
            const directEnabled = normalized.direct?.enabled !== false;
            if (!directEnabled && (original.direct.status !== 'disabled' || original.direct.complete !== false))
              throw new Error('malformed disabled direct light evidence');
            if (original.complete !== (original.context.status === 'known-supplied-model' && (!directEnabled || original.direct.complete)) ||
              (original.status === 'complete') !== original.complete) throw new Error('malformed light completeness');
            const prepared = Light.createStudy(scene, normalized).getResult();
            if (prepared.status === 'blocked') throw new Error('malformed light configuration: current inputs are blocked');
            if (Model.stableStringify(original.sensors) !== Model.stableStringify(prepared.sensors))
              throw new Error('malformed light sensor physical grid');
            for (const [records, fields] of [
              [original.sky.sensorResults, ['cosineWeightedSkyAccess', 'modeledCosineWeightedSkyAccess']],
              [original.direct.sensorResults, ['positivePathPresenceHours', 'transmittedEquivalentSunHours',
                'modeledProcessedPositivePathPresenceHours', 'modeledProcessedTransmittedEquivalentSunHours']]
            ]) {
              if (new Set(records.map(r => r.sensorId)).size !== ids.length) throw new Error('malformed duplicate light sensors');
              for (const r of records) {
                if (!ids.includes(r.sensorId) || fields.some(k => !Object.hasOwn(r, k) ||
                  (r[k] !== null && (!Number.isFinite(r[k]) || r[k] < 0)))) throw new Error('malformed light sensor metrics');
                if (records === original.sky.sensorResults && fields.some(k => r[k] !== null && r[k] > 1))
                  throw new Error('malformed normalized sky metrics');
                if (records === original.direct.sensorResults && !original.direct.complete &&
                  fields.filter(k => !k.startsWith('modeled')).some(k => r[k] !== null))
                  throw new Error('malformed incomplete primary light hours');
                if (records === original.direct.sensorResults && !directEnabled && fields.some(k => r[k] !== null))
                  throw new Error('malformed disabled direct light hours');
                if (records === original.sky.sensorResults && original.context.status === 'unknown-context' &&
                  fields.filter(k => !k.startsWith('modeled')).some(k => r[k] !== null))
                  throw new Error('malformed light primary values in unknown context');
              }
            }
          }
        }
      } catch (error) { reason = error.message; }
      const fileName = kind + '-evidence.json';
      if (original) attachments.push({ fileName, mime: 'application/json', content: JSON.stringify(original, null, 2) });
      analysis[kind] = { status: reason ? 'unavailable' : original.status, reason,
        currentPhysicalFingerprint: inventory.physicalFingerprint, originalProvenance: original?.provenance ?? null,
        attachment: original ? fileName : null, originalStatus: original?.status ?? null,
        samePhysicalOtherRevision: !reason && original.provenance.revision !== scene.revision };
      if (reason) { unavailable(kind, reason); return; }
      aggregate(kind, original.findings);
      if (original.provenance.revision !== scene.revision) addFinding(kind, {
        code: 'same-physical-other-revision', message: 'Same actual physical inputs; original analysis revision ' +
          original.provenance.revision + ', package revision ' + scene.revision + '. Original provenance is not rewritten.' });
      const rows = [
        'Original analysis status: ' + original.status + '; source revision: ' + original.provenance.revision +
          '; package revision: ' + scene.revision + '.',
        'Actual physical fingerprint matched using shared discovery. Full original source/configuration keys are in the manifest and ' + fileName + '.',
        kind === 'airflow' ? 'Converged selected-room network only; not CFD, full fresh-air delivery or spatial room velocity.' :
          'Primary and modeled values retain their original named keys. null is unknown, not zero. Model-only values are NOT validated context.',
        kind === 'airflow' ? 'No invented pressure, density, volume, leakage or wind Cp.' : 'Not illuminance, lux, lighting strength or certification.',
        ...(kind === 'airflow' ? [
          ...original.zoneResults.map(r => 'ZONE ' + JSON.stringify(r)),
          ...original.flowResults.map(r => 'LINK ' + JSON.stringify(r)), ...(original.warnings || [])
        ] : ['Context: ' + JSON.stringify(original.context),
          ...original.sky.sensorResults.map(r => 'SKY ' + JSON.stringify(r)),
          ...original.direct.sensorResults.map(r => 'DIRECT ' + JSON.stringify(r))])
      ];
      append(kind, report(kind.toUpperCase() + ' - SUPPLIED EVIDENCE', rows), null, null, original.status);
    }
    evidence('airflow', options.airflow);
    evidence('light', options.light);
    append('coordination', report('COORDINATION FINDINGS', findings.length ? findings.map(f => JSON.stringify(f)) : ['No source findings supplied. Not an engineering pass.']));
    for (const entry of entries) {
      const discipline = entry.type.startsWith('plumbing') ? 'plumbing' : entry.type.startsWith('drainage') ? 'drainage' : entry.type;
      entry.findingIds = [...new Set([...entry.findingIds, ...findings.filter(f =>
        (f.discipline === discipline || f.discipline === 'projection') &&
        (entry.floorId === null || f.floorId === null || f.floorId === entry.floorId)).map(f => f.id)])];
    }
    // Fixed-point index pagination: page numbers depend on the complete index's own length.
    let indexCount = 1, indexSheets, ordered;
    for (let attempt = 0; attempt < MAX_PAGES; attempt++) {
      const stubs = Array.from({ length: indexCount }, () => ({ type: 'index', floorId: null, viewId: null, status: 'available' }));
      ordered = [...entries.slice(0, cover.length), ...stubs, ...entries.slice(cover.length)];
      const rows = ordered.map((e, i) => 'PAGE ' + (i + 1) + ' | ' + e.type + ' | ' + e.status +
        ' | floor ' + (e.floorId ?? '-') + ' | view ' + (e.viewId ?? '-') +
        ' | scale 1:' + (e.sheet?.metadata.scaleDenominator ?? config.scaleDenominator) +
        ' | ' + (e.sheet?.metadata.title ?? 'COMPLETE PACKAGE INDEX'));
      indexSheets = report('COMPLETE PACKAGE INDEX', rows);
      if (indexSheets.length === indexCount) break;
      indexCount = indexSheets.length;
      if (attempt === MAX_PAGES - 1) fail('Index pagination failed to converge.');
    }
    if (ordered.length > MAX_PAGES) fail('100-page limit exceeded; no partial package.');
    ordered.splice(cover.length, indexCount, ...indexSheets.map(sheet => ({
      sheet, type: 'index', floorId: null, viewId: null, status: 'available', findingIds: []
    })));
    const pages = ordered.map((e, i) => {
      // Use the outer right margin, not the shared renderers' two-line identity footers.
      text(e.sheet, widthMm - 4, 14, 'PAGE ' + (i + 1) + '/' + ordered.length, 2);
      e.sheet.primitives[e.sheet.primitives.length - 1].rotationDeg = 90;
      Drawing.validateSheet(e.sheet);
      return { page: i + 1, number: 'P' + String(i + 1).padStart(3, '0'), type: e.type,
        title: e.sheet.metadata.title, floorId: e.floorId, viewId: e.viewId,
        widthMm: e.sheet.widthMm, heightMm: e.sheet.heightMm, scaleDenominator: e.sheet.metadata.scaleDenominator,
        status: e.status, findingIds: e.findingIds };
    });
    return freeze({ version: 1, sheets: ordered.map(e => e.sheet), manifest: {
      version: 1, source: sourceIdentity, settings: copy(config), floorIds, pages, analyses: analysis,
      electrical, siteDatum: scene.siteDatum ?? null,
      limitations: ['Conceptual only; not certified or engineered.', 'No terrain, discharge, circuit or analysis inputs inferred.',
        'Plumbing risers and drainage profiles retain shared per-selected-floor scope; cross-floor routes may appear on both endpoint floors.']
    }, findings, attachments });
  }
  return Object.freeze({ defaults, normalizeSettings, build });
});
