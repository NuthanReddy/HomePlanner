(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./planner-model.js') : root.HomePlannerModel,
    common ? require('./planner-regions.js') : root.HomePlannerRegions);
  if (common) module.exports = api;
  else root.HomePlannerCFD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model, Regions) {
  'use strict';
  const PROFILE = 'single-room-cht-v1', EPS = 1e-7;
  const SIDES = ['N', 'E', 'S', 'W'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const canonical = value => Model.stableStringify(value);
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const FIELDS = Object.freeze([
    ['floorThicknessM', 'Floor slab thickness (m)', 'Solid', .005, 2],
    ['ceilingThicknessM', 'Ceiling slab thickness (m)', 'Solid', .005, 2],
    ['solid.conductivityWmK', 'Solid conductivity (W/m K)', 'Solid', .001, 1000],
    ['solid.densityKgM3', 'Solid density (kg/m3)', 'Solid', .01, 30000],
    ['solid.cpJkgK', 'Solid specific heat (J/kg K)', 'Solid', 1, 20000],
    ['solid.initialC', 'Initial solid temperature (C)', 'Solid', -100, 200],
    ['air.initialC', 'Initial air temperature (C)', 'Air', -100, 200],
    ['air.pressurePa', 'Reference absolute pressure (Pa)', 'Air', 1000, 2000000],
    ['air.molarMassGmol', 'Gas molar mass (g/mol)', 'Air', 1, 300],
    ['air.cpJkgK', 'Gas specific heat (J/kg K)', 'Air', 1, 20000],
    ['air.muPaS', 'Dynamic viscosity (Pa s)', 'Air', 1e-8, .1],
    ['air.prandtl', 'Prandtl number', 'Air', .01, 100],
    ...[...SIDES, 'floor', 'ceiling'].map(side =>
      [`boundaries.${side}`, `${side.length === 1 ? side + ' wall' : side} outer-face temperature (C)`, 'Boundaries', -100, 200]),
    ['sampling.heightM', 'Receiver height above room floor (m)', 'Sampling', .001, 20],
    ['sampling.columns', 'Sample columns', 'Sampling', 1, 64, true, 8],
    ['sampling.rows', 'Sample rows', 'Sampling', 1, 64, true, 8],
    ['numerics.spacingM', 'Maximum air-cell spacing (m)', 'Numerics', .01, 2, false, .25],
    ['numerics.solidCells', 'Minimum cells through each solid layer', 'Numerics', 2, 20, true, 2],
    ['numerics.deltaTSeconds', 'Initial time step (s)', 'Numerics', .0001, 10, false, .1],
    ['numerics.endTimeSeconds', 'Simulation duration (s)', 'Numerics', .001, 86400, false, 10],
    ['numerics.writeIntervalSeconds', 'Output interval (s)', 'Numerics', .001, 86400, false, 1],
    ['numerics.maxCo', 'Maximum Courant number', 'Numerics', .01, 1, false, .5],
    ['numerics.maxRuntimeSeconds', 'Wall-clock run limit (s)', 'Numerics', 1, 1800, true, 300]
  ].map(([path, label, group, min, max, integer = false, initial = null]) =>
    Object.freeze({ path, label, group, min, max, integer, initial })));
  function getPath(value, path) { return path.split('.').reduce((item, part) => item?.[part], value); }
  function setPath(value, path, input) {
    const parts = path.split('.'), last = parts.pop();
    let target = value;
    for (const part of parts) target = target[part] ||= {};
    target[last] = input;
  }
  function numeric(value, label) {
    if (value === null || value === '' || typeof value === 'string' && !value.trim()) return null;
    if (!['number', 'string'].includes(typeof value) ||
        typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
      throw new Error(`${label}: enter a finite decimal number; blank means unknown.`);
    const result = Number(value);
    if (!finite(result)) throw new Error(`${label}: enter a finite decimal number.`);
    return result;
  }
  function defaultOpening(opening) {
    return { id: opening.id, mode: opening.openFraction === 0 ? 'closed' : null,
      temperatureC: null, speedMps: null, gaugePressurePa: null };
  }
  function draft(geometry) {
    const result = { sourceNote: '', acknowledgeGeometry: false, acknowledgeEmptyRoom: false,
      acknowledgeModel: false, openings: (geometry?.openings || []).map(defaultOpening) };
    for (const field of FIELDS) setPath(result, field.path, field.initial);
    return result;
  }
  function inspect(drawing, floorId, roomId) {
    if (drawing?.kind !== 'DrawingScene' || drawing.version !== 1)
      throw new Error('CFD requires the shared DrawingScene, not renderer geometry.');
    const floor = drawing.scenes.find(item => item.floorId === floorId);
    const findings = [], notes = [];
    const issue = message => findings.push(message);
    const rooms = (floor?.rooms || []).map(room => ({ id: room.id, label: room.label || room.id,
      service: !!room.service }));
    const room = floor?.rooms.find(item => item.id === roomId);
    if (!floor || !room) return freeze({ rooms, geometry: null, source: null, findings: [
      floor ? 'Choose a room on the current active floor.' :
        'The active floor has no registered site geometry. Resolve its plot and floor geometry first.'
    ], notes, geometryFingerprint: null });
    if (floor.coordinateSpace !== 'site-local') throw new Error('CFD expects registered site-local geometry.');
    if (room.service || ['lift', 'staircase'].includes(room.type))
      issue('Lift and stair outlines do not establish a closed CFD air volume. Choose an ordinary room.');
    if (![room.rect.x, room.rect.y, room.rect.w, room.rect.h, floor.floorElevationM, floor.headingDeg].every(finite) ||
        room.rect.w <= 0 || room.rect.h <= 0) throw new Error('The selected room has invalid physical coordinates.');
    const clearArea = room.rect.w * room.rect.h;
    if (Object.hasOwn(room, 'usableRegions') &&
        (Math.abs(Regions.area(room.usableRegions) - clearArea) > EPS ||
         room.usableRegions.some(region => Regions.subtractRectangle(region, [room.rect]).length)))
      issue('This room has reserved or excluded floor regions. The first CFD profile cannot replace them with a bounding box.');
    if (room.reservedAreaM2 > EPS) issue('A lift/stair reservation prevents an unobstructed rectangular CFD domain.');
    const walls = floor.walls.filter(wall => wall.roomIds?.includes(room.id));
    const bySide = Object.fromEntries(SIDES.map(side => [side, []]));
    const cx = room.rect.x + room.rect.w / 2, cy = room.rect.y + room.rect.h / 2;
    const wallSides = new Map();
    for (const wall of walls) {
      if (![wall.start?.x, wall.start?.y, wall.end?.x, wall.end?.y, wall.thicknessM,
        wall.heightM, wall.baseM].every(finite) || wall.thicknessM <= 0 || wall.heightM <= 0) {
        issue('A perimeter wall has missing or invalid thickness, height or endpoints.'); continue;
      }
      let side, lo, hi, face;
      if (Math.abs(wall.start.y - wall.end.y) <= EPS && Math.abs(wall.start.x - wall.end.x) > EPS) {
        side = wall.start.y < cy ? 'N' : 'S';
        [lo, hi] = [Math.min(wall.start.x, wall.end.x), Math.max(wall.start.x, wall.end.x)];
        face = wall.start.y + (side === 'N' ? 1 : -1) * wall.thicknessM / 2;
      } else if (Math.abs(wall.start.x - wall.end.x) <= EPS && Math.abs(wall.start.y - wall.end.y) > EPS) {
        side = wall.start.x < cx ? 'W' : 'E';
        [lo, hi] = [Math.min(wall.start.y, wall.end.y), Math.max(wall.start.y, wall.end.y)];
        face = wall.start.x + (side === 'W' ? 1 : -1) * wall.thicknessM / 2;
      } else { issue('A perimeter wall is not axis-aligned. This profile does not repair or approximate wall topology.'); continue; }
      bySide[side].push({ wall, lo, hi, face });
      wallSides.set(wall.id, side);
      if (Math.abs(wall.baseM - floor.floorElevationM) > EPS)
        issue('Perimeter wall bases must match the selected room floor.');
    }
    for (const side of SIDES) {
      const items = bySide[side], first = items[0];
      if (!first) { issue(`${side} has no resolved enclosing wall. A closed volume cannot be inferred.`); continue; }
      if (items.some(item => Math.abs(item.face - first.face) > EPS ||
          Math.abs(item.wall.thicknessM - first.wall.thicknessM) > EPS))
        issue(`${side} has stepped wall faces or varying thickness, unsupported by the first profile.`);
    }
    if (SIDES.some(side => !bySide[side].length))
      return freeze({ rooms, geometry: null, source: null, findings, notes, geometryFingerprint: null });
    const faces = Object.fromEntries(SIDES.map(side => [side, bySide[side][0].face]));
    const rect = { x: faces.W, y: faces.N, w: faces.E - faces.W, h: faces.S - faces.N };
    if (rect.w <= EPS || rect.h <= EPS || rect.x > room.rect.x + EPS || rect.y > room.rect.y + EPS ||
        rect.x + rect.w < room.rect.x + room.rect.w - EPS || rect.y + rect.h < room.rect.y + room.rect.h - EPS)
      issue('The actual inner wall faces do not enclose the complete selected clear-room rectangle.');
    const heightM = bySide.N[0].wall.heightM;
    for (const side of SIDES) {
      const start = side === 'N' || side === 'S' ? rect.x : rect.y;
      const end = start + (side === 'N' || side === 'S' ? rect.w : rect.h);
      let reached = start;
      for (const item of bySide[side].slice().sort((a, b) => a.lo - b.lo)) {
        if (item.lo > reached + EPS && item.lo < end - EPS) issue(`${side} has a gap between wall hosts; no filler wall is invented.`);
        if (item.lo <= reached + EPS) reached = Math.max(reached, item.hi);
        if (Math.abs(item.wall.heightM - heightM) > EPS) issue('Perimeter wall heights differ; a level ceiling cannot be inferred.');
        if (item.wall.removed && !item.wall.openings?.length)
          issue(`${side} has removed masonry without a resolved aperture boundary.`);
      }
      if (reached < end - EPS) issue(`${side} wall hosts do not span the complete inner enclosure.`);
    }
    if (Math.abs(rect.w * rect.h - clearArea) > EPS)
      notes.push(`CFD uses actual inner wall faces (${rect.w.toFixed(3)} x ${rect.h.toFixed(3)} m), not the distinct ${room.rect.w.toFixed(3)} x ${room.rect.h.toFixed(3)} m carpet rectangle.`);
    const openings = [];
    for (const opening of floor.openings.filter(item => wallSides.has(item.wallId))) {
      const wall = walls.find(item => item.id === opening.wallId), side = wallSides.get(wall.id);
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      if (![opening.offsetM, opening.widthM, opening.heightM, opening.sillM].every(finite) ||
          opening.widthM <= 0 || opening.heightM <= 0 || opening.offsetM < 0 ||
          opening.offsetM + opening.widthM > length + EPS || opening.sillM < 0 ||
          opening.sillM + opening.heightM > heightM + EPS || !wall.openings.some(item => item.id === opening.id)) {
        issue('An opening has unresolved host geometry or lies outside the room height.'); continue;
      }
      const a = Model.wallPoint(wall, opening.offsetM), b = Model.wallPoint(wall, opening.offsetM + opening.widthM);
      const offsetM = side === 'N' || side === 'S' ? Math.min(a.x, b.x) - rect.x : Math.min(a.y, b.y) - rect.y;
      if (offsetM < -EPS || offsetM + opening.widthM > (side === 'N' || side === 'S' ? rect.w : rect.h) + EPS)
        issue(`${side} contains an aperture extending beyond this room's inner enclosure; it is not silently clipped.`);
      if (![0, 1].includes(opening.openFraction))
        issue(`${side} ${opening.kind === 'window' ? 'window' : 'opening'} is partly open or its operation is unknown. Set its actual operation to fully open or closed for this profile.`);
      const known = wall.roomIds?.length === 1 && wall.exterior === true && opening.exterior === true;
      const adjacent = known ? 'outside' : wall.roomIds?.length === 2 && wall.exterior === false &&
        wall.roomIds.every(id => floor.rooms.some(item => item.id === id)) ? 'adjacent-room' : 'unknown';
      if (adjacent === 'unknown')
        notes.push('An aperture has an unmapped neighbour. Its explicitly supplied boundary condition truncates the CFD domain; it is not inferred outdoor air.');
      openings.push({ id: opening.id, wallId: wall.id, side, offsetM, widthM: opening.widthM,
        sillM: opening.sillM, heightM: opening.heightM, openFraction: opening.openFraction ?? null,
        kind: opening.kind, adjacent });
    }
    if (floor.unresolvedOpenings?.length)
      issue('Resolve the active floor\'s unresolved opening records before preparing a CFD enclosure.');
    const relevant = new Set([room.id, ...walls.map(wall => wall.id), ...openings.map(opening => opening.id)]);
    for (const diagnostic of floor.diagnostics || [])
      if (diagnostic.level === 'error' && (!diagnostic.ids?.length || diagnostic.ids.some(id => relevant.has(id))))
        issue(diagnostic.message);
    for (const obstacle of floor.obstacles || []) {
      if (Regions.intersection(rect, obstacle) && obstacle.baseM < floor.floorElevationM + heightM &&
          obstacle.baseM + obstacle.heightM > floor.floorElevationM)
        issue('A modeled obstacle intersects this room. Obstructed air volumes are not supported by this profile.');
    }
    for (const other of floor.rooms)
      if (other.id !== room.id && other.reservationFootprint && Regions.intersection(rect, other.reservationFootprint))
        issue('A full service reservation intersects the actual inner-wall air domain; it cannot be omitted.');
    for (const record of drawing.authored || []) {
      if (record.floorId !== floorId || !['structural', 'stairs', 'fixtures'].includes(record.collection) ||
          record.record.kind === 'grid') continue;
      const points = record.anchors.map(anchor => anchor.point).filter(Boolean);
      const pad = Math.max(record.record.widthM || 0, record.record.depthM || 0) / 2;
      const intersects = !points.length || Math.min(...points.map(point => point.x)) - pad <= rect.x + rect.w &&
        Math.max(...points.map(point => point.x)) + pad >= rect.x &&
        Math.min(...points.map(point => point.y)) - pad <= rect.y + rect.h &&
        Math.max(...points.map(point => point.y)) + pad >= rect.y;
      if (record.anchorStatus !== 'resolved' || intersects)
        issue('An authored structural, fixture or stair object may occupy this room; its solid/void geometry needs a later CFD profile.');
    }
    const geometry = { coordinateSpace: 'site-local', rect, sourceRoomRect: copy(room.rect),
      floorElevationM: floor.floorElevationM, headingDeg: floor.headingDeg, heightM,
      walls: SIDES.map(side => ({ side, thicknessM: bySide[side][0].wall.thicknessM,
        sourceIds: bySide[side].map(item => item.wall.id).sort() })),
      openings: openings.sort((a, b) => a.id.localeCompare(b.id)) };
    const geometryFingerprint = canonical({ profile: PROFILE, geometry, findings: [...new Set(findings)] });
    notes.push('The existing schematic dimensions remain unverified. No room, wall, opening or furnishing is moved.');
    notes.push('Furniture and small services are omitted only under the explicit empty-room acknowledgement.');
    if (openings.some(opening => opening.adjacent === 'adjacent-room'))
      notes.push('Connections to other rooms terminate at supplied boundary conditions. Adjacent rooms are not simulated.');
    return freeze({ rooms, geometry, source: { projectId: drawing.projectId, floorId, roomId,
      revision: drawing.revision, inputFingerprint: drawing.inputFingerprint, geometryFingerprint },
      findings: [...new Set(findings)], notes, geometryFingerprint });
  }
  function scenario(value, geometry, complete = true) {
    Model.assertJSON(value);
    const result = copy(value);
    for (const field of FIELDS) {
      const number = numeric(getPath(result, field.path), field.label);
      if (number === null && complete) throw new Error(`${field.label} is required.`);
      if (number !== null && (number < field.min || number > field.max || field.integer && !Number.isInteger(number)))
        throw new Error(`${field.label} must be ${field.integer ? 'an integer ' : ''}between ${field.min} and ${field.max}.`);
      setPath(result, field.path, number);
    }
    if (typeof result.sourceNote !== 'string' || result.sourceNote.length > 4096 ||
        complete && !result.sourceNote.trim()) throw new Error('Record the sources and assumptions for these inputs (up to 4096 characters).');
    for (const name of ['acknowledgeGeometry', 'acknowledgeEmptyRoom', 'acknowledgeModel'])
      if (typeof result[name] !== 'boolean' || complete && !result[name])
        throw new Error('Review and acknowledge the geometry, empty-room assumption and supported physics before preparing a case.');
    if (complete && result.sampling.heightM >= geometry.heightM)
      throw new Error('Receiver height must be strictly inside the current room height.');
    if (result.sampling.columns * result.sampling.rows > 512)
      throw new Error('Use at most 512 sampling points; the grid is not silently reduced.');
    const current = new Set(geometry?.openings.map(opening => opening.id) || []);
    result.openings = result.openings.filter(item => !complete || current.has(item.id)).map(item => {
      const opening = geometry?.openings.find(opening => opening.id === item.id);
      const row = { ...item };
      for (const name of ['temperatureC', 'speedMps', 'gaugePressurePa'])
        row[name] = numeric(row[name], `${opening?.side || 'Saved'} opening ${name}`);
      if (complete) {
        if (!['inlet', 'outlet', 'closed'].includes(row.mode)) throw new Error('Choose an inlet, outlet or closed-surface condition for every opening.');
        if ((row.mode === 'closed') !== (opening.openFraction === 0) || ![0, 1].includes(opening.openFraction))
          throw new Error(`${opening.side} opening condition disagrees with its actual saved operating state.`);
        if (row.temperatureC === null || row.temperatureC < -100 || row.temperatureC > 200)
          throw new Error(`${opening.side} opening requires a temperature between -100 and 200 C.`);
        if (row.mode === 'inlet' && !(row.speedMps > 0 && row.speedMps <= 100))
          throw new Error(`${opening.side} inlet requires an inward normal speed greater than zero and at most 100 m/s.`);
        if (row.mode === 'outlet' && (row.gaugePressurePa === null || result.air.pressurePa + row.gaugePressurePa <= 0))
          throw new Error(`${opening.side} outlet requires an explicit gauge pressure with positive absolute pressure.`);
        if (row.mode !== 'inlet') row.speedMps = null;
        if (row.mode !== 'outlet') row.gaugePressurePa = null;
      }
      return row;
    });
    if (complete && (result.openings.length !== current.size || new Set(result.openings.map(row => row.id)).size !== current.size))
      throw new Error('Every current opening needs exactly one boundary condition.');
    if (complete && result.openings.some(row => row.mode === 'inlet') && !result.openings.some(row => row.mode === 'outlet'))
      throw new Error('A case with an inlet also needs a pressure outlet.');
    return result;
  }
  function request(inventory, form) {
    if (inventory.findings.length || !inventory.geometry) throw new Error(inventory.findings.join(' '));
    return freeze({ version: 1, profile: PROFILE, source: copy(inventory.source),
      geometry: copy(inventory.geometry), scenario: scenario(form, inventory.geometry) });
  }
  function currentKey(inventory, form) {
    return canonical({ owner: inventory.source ? [inventory.source.projectId, inventory.source.floorId, inventory.source.roomId] : null,
      geometryFingerprint: inventory.geometryFingerprint, scenario: form });
  }
  return Object.freeze({ PROFILE, SIDES, FIELDS, inspect, draft, defaultOpening, scenario, request, currentKey,
    canonical, numeric, getPath, setPath, freeze });
});
