(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const EPS = 1e-7;
  const DIRECTIONS = { N: 0, E: 90, S: 180, W: 270 };
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_JSON_LENGTH = 32 * 1024 * 1024;
  const FLOOR_FIELDS = ['wallEdits', 'doorEdits', 'windowEdits', 'furnitureEdits', 'obstacles', 'electrical'];
  let sequence = 0;

  function fail(message) { throw new Error(message); }
  function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
    return value;
  }
  function number(value, path, min = -Infinity, max = Infinity, exclusiveMin = false) {
    if (!Number.isFinite(value) || value < min || value > max || (exclusiveMin && value === min))
      fail(`${path} must be a finite number ${exclusiveMin ? 'greater than' : 'between'} ${min}${exclusiveMin ? '' : ` and ${max}`}.`);
    return value;
  }
  function text(value, path, limit = 512) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value))
      fail(`${path} must be nonempty text of at most ${limit} characters.`);
    return value;
  }
  function identity(value, path) {
    text(value, path);
    if (FORBIDDEN.has(value)) fail(`${path} is a reserved identifier.`);
    return value;
  }
  function enumValue(value, allowed, path) {
    if (!allowed.includes(value)) fail(`${path} must be one of ${allowed.join(', ')}.`);
  }
  function bool(value, path) {
    if (typeof value !== 'boolean') fail(`${path} must be true or false.`);
  }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function encoded(value) { return encodeURIComponent(String(value)); }
  function entityId(floorId, sourceId) { return `${floorId}:${sourceId}`; }
  function positive(value) { return Number.isFinite(value) && value > EPS; }
  function near(a, b) { return Math.abs(a - b) <= EPS; }
  function unique(values) { return [...new Set(values)].sort(); }

  // Inspect descriptors before values: imported/accessor-bearing objects must not execute code.
  function assertJSON(value) {
    const seen = new Set();
    let nodes = 0;
    function visit(item, path, depth) {
      if (++nodes > 1000000 || depth > 64) fail('The project is too large or deeply nested.');
      if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) fail(`${path} contains a non-finite number.`);
        return;
      }
      if (!item || typeof item !== 'object') fail(`${path} is not JSON data.`);
      if (seen.has(item)) fail(`${path} contains a circular reference.`);
      const prototype = Object.getPrototypeOf(item);
      if (Array.isArray(item)) {
        if (prototype !== Array.prototype || item.length > 200000) fail(`${path} is not a supported JSON array.`);
      } else if (prototype !== Object.prototype && prototype !== null) {
        fail(`${path} must contain plain JSON objects, not runtime instances.`);
      }
      seen.add(item);
      const keys = Reflect.ownKeys(item);
      if (Array.isArray(item) && keys.length !== item.length + 1) fail(`${path} contains a sparse or extended array.`);
      for (const key of keys) {
        if (typeof key !== 'string' || FORBIDDEN.has(key)) fail(`${path} contains a forbidden prototype key.`);
        if (Array.isArray(item) && key === 'length') continue;
        if (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))
          fail(`${path} contains a sparse or extended array.`);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor.enumerable || !own(descriptor, 'value')) fail(`${path}.${key} must be a JSON value, not an accessor.`);
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
      seen.delete(item);
    }
    visit(value, 'Project', 0);
  }

  function validateEdits(edits, kind, path) {
    object(edits, path);
    for (const [id, edit] of Object.entries(edits)) {
      text(id, `${path} identifier`, 16384);
      object(edit, `${path}.${id}`);
      const here = `${path}.${id}`;
      if (kind === 'wall') {
        bool(edit.full, `${here}.full`);
        if (!edit.full || own(edit, 'offsetM')) number(edit.offsetM, `${here}.offsetM`, 0);
        if (!edit.full || own(edit, 'widthM')) number(edit.widthM, `${here}.widthM`, 0, Infinity, true);
      } else if (kind === 'furniture') {
        if (own(edit, 'headLocal')) enumValue(edit.headLocal, Object.keys(DIRECTIONS), `${here}.headLocal`);
        if (own(edit, 'pinned')) bool(edit.pinned, `${here}.pinned`);
      } else {
        if (own(edit, 'widthM')) number(edit.widthM, `${here}.widthM`, 0, Infinity, true);
        if (own(edit, 'openFraction')) number(edit.openFraction, `${here}.openFraction`, 0, 1);
        if (kind === 'door') {
          if (own(edit, 'hinge')) enumValue(edit.hinge, ['start', 'end'], `${here}.hinge`);
          if (own(edit, 'swing')) enumValue(edit.swing, ['left', 'right'], `${here}.swing`);
        } else {
          if (own(edit, 'heightM')) number(edit.heightM, `${here}.heightM`, 0, Infinity, true);
          if (own(edit, 'sillM')) number(edit.sillM, `${here}.sillM`, 0);
        }
      }
    }
  }

  function validateLegacy(legacy, path) {
    object(legacy, path);
    object(legacy.controls, `${path}.controls`);
    if (!Array.isArray(legacy.manualLayouts)) fail(`${path}.manualLayouts must be an array.`);
    for (const entry of legacy.manualLayouts) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')
        fail(`${path}.manualLayouts must contain [signature, layout] records.`);
      object(entry[1], `${path}.manualLayouts layout`);
    }
    if (legacy.context != null) {
      object(legacy.context, `${path}.context`);
      for (const key of ['plate', 'g', 'plan', 'cfg']) object(legacy.context[key], `${path}.context.${key}`);
    }
  }

  function validateObstacles(items, path) {
    if (!Array.isArray(items)) fail(`${path} must be an array.`);
    const ids = new Set();
    for (const item of items) {
      object(item, path);
      identity(item.id, `${path} id`);
      if (ids.has(item.id)) fail(`${path} has duplicate identifier ${item.id}.`);
      ids.add(item.id);
      enumValue(item.type, ['building', 'tree'], `${path}.${item.id}.type`);
      for (const key of ['x', 'y', 'baseM']) number(item[key], `${path}.${item.id}.${key}`);
      for (const key of ['w', 'h', 'heightM']) number(item[key], `${path}.${item.id}.${key}`, 0, Infinity, true);
      number(item.transmittance, `${path}.${item.id}.transmittance`, 0, 1);
      if (own(item, 'label')) text(item.label, `${path}.${item.id}.label`);
    }
  }

  function validateFloorFields(record, path, required) {
    for (const key of FLOOR_FIELDS) {
      if (!required && !own(record, key)) continue;
      if (key.endsWith('Edits')) validateEdits(record[key], key.slice(0, -5), `${path}.${key}`);
      else if (key === 'obstacles') validateObstacles(record[key], `${path}.${key}`);
      else {
        if (!Array.isArray(record[key])) fail(`${path}.${key} must be an array.`);
        const ids = new Set();
        for (const item of record[key]) {
          object(item, `${path}.${key} record`);
          if (own(item, 'id')) {
            identity(item.id, `${path}.${key} id`);
            if (ids.has(item.id)) fail(`${path}.${key} has duplicate identifier ${item.id}.`);
            ids.add(item.id);
          }
        }
      }
    }
  }

  function validateProject(project) {
    assertJSON(project);
    object(project, 'Project');
    if (project.schemaVersion !== 1) fail('Unsupported project schemaVersion. This version reads schema 1 only.');
    identity(project.id, 'Project id');
    if (!Number.isSafeInteger(project.revision) || project.revision < 0) fail('Project revision must be a nonnegative safe integer.');
    if (own(project, 'name')) text(project.name, 'Project name', 150);
    object(project.site, 'Site');
    number(project.site.latitude, 'Latitude', -90, 90);
    number(project.site.longitude, 'Longitude', -180, 180);
    text(project.site.timeZone, 'Time zone', 100);
    try { new Intl.DateTimeFormat('en', { timeZone: project.site.timeZone }); }
    catch (_) { fail('Time zone must be a supported IANA time-zone identifier.'); }
    object(project.building, 'Building');
    number(project.building.wallHeightM, 'Wall height', 0, 1000, true);
    number(project.building.floorElevationM, 'Building base elevation', -1000000, 1000000);
    number(project.building.roofThicknessM, 'Roof thickness', 0, 1000);
    object(project.environment, 'Environment');
    validateFloorFields(project, 'Project', true);
    validateLegacy(project.legacy, 'Active legacy layout');
    if (!Array.isArray(project.floors) || !project.floors.length || project.floors.length > 100)
      fail('A project must contain between 1 and 100 floors.');
    const ids = new Set();
    for (const floor of project.floors) {
      object(floor, 'Floor');
      identity(floor.id, 'Floor id');
      if (floor.id.includes(':')) fail('Floor IDs cannot contain the ":" scene-namespace separator.');
      if (ids.has(floor.id)) fail(`Duplicate floor id ${floor.id}.`);
      ids.add(floor.id);
      text(floor.name, 'Floor name', 100);
      number(floor.heightM, 'Storey height', 0, 1000, true);
      if (own(floor, 'wallHeightM')) number(floor.wallHeightM, 'Floor wall height', 0, 1000, true);
      validateLegacy(floor.legacy, `Floor ${floor.id} legacy layout`);
      validateFloorFields(floor, `Floor ${floor.id}`, false);
    }
    if (!ids.has(project.activeFloorId)) fail('activeFloorId must identify an existing floor.');
    return project;
  }

  function parseProject(input) {
    if (typeof input !== 'string' || !input.trim()) fail('Choose a nonempty project JSON document.');
    if (input.length > MAX_JSON_LENGTH) fail('The project JSON exceeds the 32 MiB import limit.');
    let result;
    try {
      result = JSON.parse(input, (key, value) => {
        if (FORBIDDEN.has(key)) fail('Project JSON contains a forbidden prototype key.');
        return value;
      });
    } catch (error) {
      fail(`Cannot read project JSON: ${error.message}`);
    }
    return validateProject(result);
  }

  function createProject() {
    const id = root.crypto && typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
    const emptyLegacy = () => ({ controls: {}, manualLayouts: [], context: null });
    const emptyEdits = () => ({ wallEdits: {}, doorEdits: {}, windowEdits: {}, furnitureEdits: {}, obstacles: [], electrical: [] });
    return {
      schemaVersion: 1, id: `project-${id}`, name: 'Untitled project', revision: 0,
      site: { latitude: 17.385, longitude: 78.4867, timeZone: 'Asia/Kolkata' },
      building: { wallHeightM: 2.7432, floorElevationM: 0, roofThicknessM: 0.15 },
      ...emptyEdits(), environment: {}, activeFloorId: 'floor-1',
      floors: [{ id: 'floor-1', name: 'Ground floor', heightM: 3, legacy: emptyLegacy(), ...emptyEdits() }],
      legacy: emptyLegacy()
    };
  }

  function heading(scene) {
    return number(scene.headingDeg, 'Scene heading') * Math.PI / 180;
  }
  function localToWorld(point, scene) {
    const angle = heading(scene), c = Math.cos(angle), s = Math.sin(angle);
    const dx = number(point.x, 'Local x') - number(scene.floor.w, 'Floor width', 0, Infinity, true) / 2;
    const dy = number(point.y, 'Local y') - number(scene.floor.h, 'Floor depth', 0, Infinity, true) / 2;
    return {
      east: dx * c - dy * s,
      north: -(dx * s + dy * c),
      up: number(point.z === undefined ? (scene.floorElevationM === undefined ? 0 : scene.floorElevationM) : point.z, 'Elevation')
    };
  }
  function worldVectorToLocal(vector, scene) {
    const angle = heading(scene), c = Math.cos(angle), s = Math.sin(angle);
    const east = number(vector.east, 'East vector'), north = number(vector.north, 'North vector');
    return { x: east * c - north * s, y: -east * s - north * c, z: number(vector.up === undefined ? 0 : vector.up, 'Up vector') };
  }
  function wallLength(wall) {
    number(wall.start.x, 'Wall start x'); number(wall.start.y, 'Wall start y');
    number(wall.end.x, 'Wall end x'); number(wall.end.y, 'Wall end y');
    return number(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y), 'Wall length', 0, Infinity, true);
  }
  function wallPoint(wall, offsetM) {
    const length = wallLength(wall);
    number(offsetM, 'Wall offset', -EPS, length + EPS);
    const t = offsetM / length;
    return { x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t };
  }
  function doorGeometry(opening, wall) {
    if (opening.kind && opening.kind !== 'hinged') fail('Only a hinged door has a quarter-circle swing.');
    enumValue(opening.hinge, ['start', 'end'], 'Door hinge');
    enumValue(opening.swing, ['left', 'right'], 'Door swing');
    const length = wallLength(wall), width = number(opening.widthM, 'Door aperture width', 0, Infinity, true);
    number(opening.offsetM, 'Door offset', 0, length);
    if (opening.offsetM + width > length + EPS) fail('The door aperture extends beyond its wall.');
    const radius = number(opening.nominalLeafWidthM === undefined ? width : opening.nominalLeafWidthM, 'Nominal leaf width', 0, Infinity, true);
    const tx = (wall.end.x - wall.start.x) / length, ty = (wall.end.y - wall.start.y) / length;
    const hingeAtStart = opening.hinge === 'start';
    const pivot = wallPoint(wall, opening.offsetM + (hingeAtStart ? 0 : width));
    const closed = { x: pivot.x + tx * radius * (hingeAtStart ? 1 : -1), y: pivot.y + ty * radius * (hingeAtStart ? 1 : -1) };
    const side = opening.swing === 'left' ? 1 : -1;
    const open = { x: pivot.x + ty * radius * side, y: pivot.y - tx * radius * side };
    const cross = (closed.x - pivot.x) * (open.y - pivot.y) - (closed.y - pivot.y) * (open.x - pivot.x);
    return { hinge: pivot, closedEnd: closed, openEnd: open, arcSweep: cross > 0 ? 1 : 0, radiusM: radius };
  }

  function rect(value, label) {
    object(value, label);
    const result = {};
    for (const key of ['x', 'y', 'w', 'h']) result[key] = number(value[key], `${label}.${key}`, key === 'w' || key === 'h' ? 0 : -Infinity, Infinity, key === 'w' || key === 'h');
    if (![result.x + result.w, result.y + result.h, result.w * result.h].every(Number.isFinite)) fail(`${label} exceeds the supported coordinate range.`);
    return result;
  }
  function inside(a, b) {
    return a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
  }
  function edgeData(box, edge) {
    const horizontal = edge === 'N' || edge === 'S';
    return {
      axis: horizontal ? 'x' : 'y',
      fixed: edge === 'N' ? box.y : edge === 'S' ? box.y + box.h : edge === 'W' ? box.x : box.x + box.w,
      lo: horizontal ? box.x : box.y,
      hi: horizontal ? box.x + box.w : box.y + box.h
    };
  }
  function rangeUnion(ranges) {
    const sorted = ranges.filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const result = [];
    for (const interval of sorted) {
      const last = result[result.length - 1];
      if (last && interval[0] <= last[1] + EPS) last[1] = Math.max(last[1], interval[1]);
      else result.push(interval.slice());
    }
    return result;
  }
  function complement(length, ranges) {
    const result = [];
    let position = 0;
    for (const [start, end] of rangeUnion(ranges)) {
      if (start - position > EPS) result.push({ startM: position, endM: start });
      position = Math.max(position, end);
    }
    if (length - position > EPS) result.push({ startM: position, endM: length });
    return result;
  }
  function rectangleUnionArea(rectangles) {
    if (!rectangles.length) return 0;
    const xs = unique(rectangles.flatMap(r => [r.x, r.x + r.w])).map(Number).sort((a, b) => a - b);
    let area = 0;
    for (let i = 1; i < xs.length; i++) {
      const x = (xs[i - 1] + xs[i]) / 2;
      const intervals = rangeUnion(rectangles.filter(r => x > r.x && x < r.x + r.w).map(r => [r.y, r.y + r.h]));
      area += (xs[i] - xs[i - 1]) * intervals.reduce((sum, [a, b]) => sum + b - a, 0);
    }
    return area;
  }

  function solidSections(length, height, openings) {
    const cuts = unique([0, length, ...openings.flatMap(opening => [opening.offsetM, opening.offsetM + opening.widthM])]).sort((a, b) => a - b);
    const result = [];
    for (let i = 1; i < cuts.length; i++) {
      const startM = cuts[i - 1], endM = cuts[i], midpoint = (startM + endM) / 2;
      if (endM - startM <= EPS) continue;
      const holes = openings.filter(opening => midpoint > opening.offsetM && midpoint < opening.offsetM + opening.widthM)
        .map(opening => [opening.sillM, opening.sillM + opening.heightM]);
      for (const band of complement(height, holes)) {
        const sillM = band.startM, heightM = band.endM - band.startM;
        const prior = result.find(section => near(section.endM, startM) && near(section.sillM, sillM) && near(section.heightM, heightM));
        if (prior) prior.endM = endM;
        else result.push({ startM, endM, sillM, heightM });
      }
    }
    return result;
  }

  function normalizeOpposingWalls(segments, diagnostic) {
    const pairs = new Map(segments.map(segment => [segment, []]));
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (a.exterior || b.exterior || a.axis !== b.axis || !a.roomEdge || !b.roomEdge || a.roomEdge.roomId === b.roomEdge.roomId) continue;
      if ({ N: 'S', S: 'N', E: 'W', W: 'E' }[a.edge] !== b.edge) continue;
      if (near(a.fixed, b.fixed) && near(a.thicknessM, b.thicknessM)) continue;
      const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
      if (hi - lo <= EPS || Math.abs(a.fixed - b.fixed) > (a.thicknessM + b.thicknessM) / 2 + EPS) continue;
      const low = a.edge === 'E' || a.edge === 'S' ? a : b, high = low === a ? b : a;
      const lowFace = low.fixed - low.thicknessM / 2, highFace = high.fixed + high.thicknessM / 2;
      if (highFace - lowFace <= EPS) continue;
      const fixed = (lowFace + highFace) / 2, thicknessM = highFace - lowFace;
      pairs.get(a).push({ other: b, lo, hi, fixed, thicknessM });
      pairs.get(b).push({ other: a, lo, hi, fixed, thicknessM });
      diagnostic('info', 'Overlapping opposing legacy wall allowances are consolidated between unchanged clear-carpet faces, not extruded twice.',
        [a.roomEdge.roomId, b.roomEdge.roomId]);
    }
    const result = [];
    for (const segment of segments) {
      const matches = pairs.get(segment);
      if (!matches.length) { result.push(segment); continue; }
      const events = [
        { at: segment.lo, token: `${segment.token}:start` },
        { at: segment.hi, token: `${segment.token}:end` }
      ];
      for (const pair of matches) {
        events.push({ at: pair.lo, token: `${pair.other.token}:${near(pair.lo, pair.other.lo) ? 'start' : 'span-start'}` });
        events.push({ at: pair.hi, token: `${pair.other.token}:${near(pair.hi, pair.other.hi) ? 'end' : 'span-end'}` });
      }
      const cuts = [];
      for (const event of events.sort((a, b) => a.at - b.at || a.token.localeCompare(b.token))) {
        const last = cuts[cuts.length - 1];
        if (last && near(last.at, event.at)) last.tokens.push(event.token);
        else cuts.push({ at: event.at, tokens: [event.token] });
      }
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1], end = cuts[i], midpoint = (start.at + end.at) / 2;
        if (end.at - start.at <= EPS) continue;
        const active = matches.filter(pair => midpoint > pair.lo && midpoint < pair.hi);
        if (active.length > 1) {
          diagnostic('error', 'Multiple opposing rooms claim overlapping wall allowances; this ambiguous span is not assigned invented construction.', segment.roomIds);
          continue;
        }
        const pair = active[0];
        result.push({ ...segment, lo: start.at, hi: end.at, loTokens: unique(start.tokens), hiTokens: unique(end.tokens),
          fixed: pair ? pair.fixed : segment.fixed, thicknessM: pair ? pair.thicknessM : segment.thicknessM });
      }
    }
    return result;
  }

  function buildScene(context, project) {
    validateProject(project);
    object(context, 'Legacy context');
    const { plate = {}, g, plan, cfg = {} } = context;
    object(g, 'Room geometry'); object(plan, 'Room plan');
    if (g.error) fail(`Cannot compile the floor: ${g.error}`);
    const floorId = project.activeFloorId;
    const floorIndex = project.floors.findIndex(floor => floor.id === floorId);
    const floorElevationM = context.floorElevationM === undefined
      ? project.building.floorElevationM + project.floors.slice(0, floorIndex).reduce((sum, floor) => sum + floor.heightM, 0)
      : number(context.floorElevationM, 'Explicit floor elevation');
    const wallHeightM = project.building.wallHeightM;
    const front = plate.frontEdge || g.frontEdge || cfg.frontEdge || 'N';
    enumValue(front, Object.keys(DIRECTIONS), 'Road/front direction');
    const floor = rect({ x: 0, y: 0, w: g.W, h: g.D }, 'Floor');
    const building = rect({ x: g.outerX, y: g.outerY, w: g.outerW, h: g.outerD }, 'Building');
    if (!inside(building, floor)) fail('The building envelope extends outside the supplied floor plate.');
    const diagnostics = [];
    const diagnostic = (level, message, ids = []) => diagnostics.push({ level, message, ids: unique(ids) });
    const scene = {
      revision: project.revision, floorId, headingDeg: DIRECTIONS[front], floorElevationM, wallHeightM,
      roofThicknessM: project.building.roofThicknessM,
      floor, building, rooms: [], walls: [], openings: [], furniture: [],
      regulatory: {
        allowedFloors: Number.isSafeInteger(plate.floors) && plate.floors >= 0 ? plate.floors : null,
        basis: 'Legacy Plot Optimizer estimate for the selected plate, height, road-cap and TDR inputs; habitable floors exclude stilt parking. Not independently validated planning permission.',
        source: 'legacy-optimizer',
        plateId: typeof plate.id === 'string' ? plate.id : null,
        selectedHeightM: positive(plate.selectedHeight) ? plate.selectedHeight : null,
        floorToFloorM: positive(plate.ffh) ? plate.ffh : null,
        stiltParking: typeof plate.stilt === 'boolean' ? plate.stilt : null
      },
      obstacles: project.obstacles.map(source => ({
        ...copy(source), sourceId: source.id,
        id: source.id.startsWith(`${floorId}:`) ? source.id : entityId(floorId, source.id)
      })),
      electrical: copy(project.electrical), diagnostics,
      unresolvedOpenings: [], metrics: { wallFootprintM2: 0, solidWallFaceAreaM2: 0, roomCarpetM2: 0 }
    };
    diagnostic('info', 'Schematic preview: dimensions are not a construction survey; wall structural roles, materials and assemblies are unverified.');
    if (wallHeightM + project.building.roofThicknessM > project.floors[floorIndex].heightM + EPS)
      diagnostic('warning', 'The assumed wall height plus roof thickness exceeds this storey height; stacked floors may overlap.', [floorId]);

    const external = cfg.walls && cfg.walls.external !== undefined ? number(cfg.walls.external, 'External wall thickness', 0, Infinity, true)
      : Number.isFinite(g.coreX) && g.coreX > building.x ? g.coreX - building.x : 0.254;
    const internal = cfg.walls && cfg.walls.internal !== undefined ? number(cfg.walls.internal, 'Internal wall thickness', 0, Infinity, true) : 0.127;
    if (!cfg.walls || cfg.walls.external === undefined || cfg.walls.internal === undefined)
      diagnostic('warning', 'Missing wall thickness is inferred from the legacy core or assumed as 0.254 m external / 0.127 m internal.');
    if (external * 2 >= building.w || external * 2 >= building.h) fail('External walls consume the complete building envelope.');
    const core = rect({
      x: Number.isFinite(g.coreX) ? g.coreX : building.x + external,
      y: Number.isFinite(g.coreY) ? g.coreY : building.y + external,
      w: Number.isFinite(g.coreW) ? g.coreW : building.w - 2 * external,
      h: Number.isFinite(g.coreD) ? g.coreD : building.h - 2 * external
    }, 'Room core');
    const roomBySource = new Map();
    const placed = plan.placed || [];
    if (!Array.isArray(placed)) fail('Placed rooms must be an array.');
    for (const placedRoom of placed) {
      const req = placedRoom.req || placedRoom;
      const sourceId = req.id || placedRoom.id || (Number.isSafeInteger(req.seq) ? `room-${req.type || 'space'}-seq-${req.seq}` : null);
      if (!sourceId) {
        diagnostic('error', 'A legacy room has no stable id or sequence; the coordinator must assign an identity before it can be modelled.');
        continue;
      }
      identity(sourceId, 'Room source id');
      if (roomBySource.has(sourceId)) fail(`Duplicate room source id ${sourceId}.`);
      const carpet = rect(placedRoom.carpet || placedRoom.rect, `Room ${sourceId} carpet`);
      const module = placedRoom.module
        ? rect(placedRoom.module, `Room ${sourceId} module`)
        : { x: carpet.x - internal / 2, y: carpet.y - internal / 2, w: carpet.w + internal, h: carpet.h + internal };
      if (!inside(carpet, module)) fail(`Room ${sourceId} carpet extends outside its module.`);
      const room = {
        id: entityId(floorId, sourceId), sourceId, label: String(req.label || sourceId), type: String(req.type || 'room'),
        rect: carpet, module, service: !!(placedRoom.corridorService || placedRoom.anchorZone === 'service' || ['lift', 'staircase'].includes(req.type))
      };
      scene.rooms.push(room); roomBySource.set(sourceId, room);
    }
    scene.rooms.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < scene.rooms.length; i++) for (let j = i + 1; j < scene.rooms.length; j++) {
      const a = scene.rooms[i], b = scene.rooms[j];
      if (Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x) > EPS &&
          Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y) > EPS)
        diagnostic('error', 'Clear room carpets overlap; this floor is not a valid physical enclosure.', [a.id, b.id]);
    }
    if (scene.rooms.some(room => room.service))
      diagnostic('warning', 'Service-room outlines are schematic only; shaft, stair, slab openings and structural construction are not established.',
        scene.rooms.filter(room => room.service).map(room => room.id));

    let raw = [];
    const shell = {};
    const addRaw = data => {
      if (data.hi - data.lo > EPS) raw.push({ ...data, roomIds: data.roomIds || [], exterior: !!data.exterior });
    };
    for (const edge of Object.keys(DIRECTIONS)) {
      const data = edgeData(building, edge);
      data.fixed += (edge === 'N' || edge === 'W' ? 1 : -1) * external / 2;
      // Horizontal strips include corners; vertical strips meet them without duplicate corner area.
      if (data.axis === 'y') { data.lo += external; data.hi -= external; }
      shell[edge] = data;
      addRaw({ ...data, token: `shell:${edge}`, thicknessM: external, exterior: true, edge });
    }
    let perimeterAllowance = false;
    for (const room of scene.rooms) {
      for (const edge of Object.keys(DIRECTIONS)) {
        const moduleEdge = edgeData(room.module, edge), coreEdge = edgeData(core, edge);
        const carpetEdge = edgeData(room.rect, edge);
        const token = `room:${encoded(room.sourceId)}:${edge}`;
        const roomEdge = { roomId: room.id, sourceId: room.sourceId, edge };
        const touchesShell = near(moduleEdge.fixed, coreEdge.fixed) &&
          moduleEdge.lo >= coreEdge.lo - EPS && moduleEdge.hi <= coreEdge.hi + EPS;
        if (touchesShell && !room.service) {
          perimeterAllowance = perimeterAllowance || !near(moduleEdge.fixed, carpetEdge.fixed);
          addRaw({ ...shell[edge], lo: Math.max(moduleEdge.lo, shell[edge].lo), hi: Math.min(moduleEdge.hi, shell[edge].hi),
            token, roomEdge, roomIds: [room.id], thicknessM: external, exterior: true, edge });
          continue;
        }
        const margin = Math.abs(carpetEdge.fixed - moduleEdge.fixed);
        if (margin <= EPS) {
          diagnostic('error', 'This room edge has no wall allowance. A positive wall cannot be inferred without consuming the specified clear carpet.', [room.id]);
          continue;
        }
        const thickness = margin * 2;
        const data = { ...moduleEdge };
        addRaw({ ...data, token, roomEdge, roomIds: [room.id], thicknessM: thickness, exterior: false, edge });
      }
    }
    if (perimeterAllowance)
      diagnostic('info', 'Room clear-carpet rectangles are preserved. Legacy half-internal-wall perimeter allowances are not a second external wall or added carpet.');

    // Coordinate comparisons are used only to find topology, never as persistent identity.
    raw = normalizeOpposingWalls(raw, diagnostic);
    raw.sort((a, b) => a.axis.localeCompare(b.axis) || a.fixed - b.fixed || a.token.localeCompare(b.token));
    const groups = [];
    for (const segment of raw) {
      let group = groups.find(item => item.axis === segment.axis && near(item.fixed, segment.fixed));
      if (!group) { group = { axis: segment.axis, fixed: segment.fixed, members: [], cuts: [] }; groups.push(group); }
      group.members.push(segment);
      group.cuts.push(...(segment.loTokens || [`${segment.token}:start`]).map(token => ({ at: segment.lo, token })),
        ...(segment.hiTokens || [`${segment.token}:end`]).map(token => ({ at: segment.hi, token })));
    }
    for (const horizontal of groups.filter(group => group.axis === 'x')) {
      for (const vertical of groups.filter(group => group.axis === 'y')) {
        const h = horizontal.members.filter(item => vertical.fixed >= item.lo - EPS && vertical.fixed <= item.hi + EPS);
        const v = vertical.members.filter(item => horizontal.fixed >= item.lo - EPS && horizontal.fixed <= item.hi + EPS);
        if (!h.length || !v.length) continue;
        for (const item of v) horizontal.cuts.push({ at: vertical.fixed, token: `join:${item.token}` });
        for (const item of h) vertical.cuts.push({ at: horizontal.fixed, token: `join:${item.token}` });
      }
    }
    const wallData = new Map();
    for (const group of groups) {
      const cuts = [];
      for (const cut of group.cuts.sort((a, b) => a.at - b.at || a.token.localeCompare(b.token))) {
        const last = cuts[cuts.length - 1];
        if (last && near(last.at, cut.at)) last.tokens.push(cut.token);
        else cuts.push({ at: cut.at, tokens: [cut.token] });
      }
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1], end = cuts[i];
        if (end.at - start.at <= EPS) continue;
        const mid = (start.at + end.at) / 2;
        const members = group.members.filter(item => mid > item.lo - EPS && mid < item.hi + EPS);
        if (!members.length) continue;
        const lineage = `${unique(members.map(item => item.token)).join('~')}[${unique(start.tokens).join('~')}][${unique(end.tokens).join('~')}]`;
        const id = entityId(floorId, `wall:${lineage}`);
        const wall = {
          id, start: group.axis === 'x' ? { x: start.at, y: group.fixed } : { x: group.fixed, y: start.at },
          end: group.axis === 'x' ? { x: end.at, y: group.fixed } : { x: group.fixed, y: end.at },
          thicknessM: Math.max(...members.map(item => item.thicknessM)), heightM: wallHeightM, baseM: floorElevationM,
          exterior: members.some(item => item.exterior), structuralRole: 'unknown',
          roomIds: unique(members.flatMap(item => item.roomIds)), openings: [],
          solidSegments: [{ startM: 0, endM: end.at - start.at }], removed: false
        };
        if (wall.roomIds.length > 2)
          diagnostic('error', 'More than two rooms claim a wall span; enclosure adjacency is unresolved.', [wall.id, ...wall.roomIds]);
        if (members.some(item => Math.abs(item.thicknessM - wall.thicknessM) > EPS))
          diagnostic('warning', 'Different legacy wall allowances meet at this interface; the wider schematic allowance is used.', [wall.id]);
        scene.walls.push(wall);
        wallData.set(id, { axis: group.axis, fixed: group.fixed, lo: start.at, hi: end.at,
          edges: members.filter(item => item.roomEdge).map(item => item.roomEdge) });
      }
    }
    scene.walls.sort((a, b) => a.id.localeCompare(b.id));
    const wallsById = new Map(scene.walls.map(wall => [wall.id, wall]));
    const roomFor = id => roomBySource.get(id) || scene.rooms.find(room => room.id === id);
    const unresolved = (record, reason, level = 'warning') => {
      const item = { id: record.id, sourceId: record.sourceId, kind: record.kind, wallId: record.wallId || null, reason };
      scene.unresolvedOpenings.push(item);
      diagnostic(level, reason, [record.id].filter(Boolean));
    };
    const passageCandidates = [], ordinaryCandidates = [], sourceOpeningIds = new Set(), seenInput = new Map(), openingPriority = new Map();
    const records = [];
    const collect = (list, kind) => {
      if (!Array.isArray(list)) return;
      for (const source of list) if (source && !source.projectOverlay) records.push({ source, kind });
    };
    collect(plan.openings && plan.openings.doors, 'hinged');
    collect(plan.openings && plan.openings.windows, 'window');
    collect(plan.wallOpenings, 'passage');
    collect(plan.customOpenings, null);
    records.sort((a, b) => Number(!!b.source.custom) - Number(!!a.source.custom) || String(a.source.id || '').localeCompare(String(b.source.id || '')));
    if (plan.openings && plan.openings.entrance)
      diagnostic('info', 'The legacy frontage entrance marker is not a verified wall aperture. Hosted room-access doors define physical entry openings.');

    for (const { source, kind: collectionKind } of records) {
      const kind = collectionKind === 'passage' || source.type === 'wall-opening' || source.kind === 'passage' ? 'passage'
        : collectionKind === 'window' || source.type === 'window' || source.kind === 'window' ? 'window'
        : /slid/i.test(source.kind || '') ? 'sliding' : 'hinged';
      const room = roomFor(source.roomId);
      let target = roomFor(source.targetRoomId || (source.target && source.target.req && source.target.req.id));
      const edge = source.edge;
      if (!target && !source.id && room && own(DIRECTIONS, edge) && source.segment) {
        const axis = edgeData(room.module, edge).axis, segment = source.segment;
        const lo = Math.min(segment[axis === 'x' ? 'x1' : 'y1'], segment[axis === 'x' ? 'x2' : 'y2']);
        const hi = Math.max(segment[axis === 'x' ? 'x1' : 'y1'], segment[axis === 'x' ? 'x2' : 'y2']);
        const targetIds = unique(scene.walls.filter(wall => {
          const data = wallData.get(wall.id);
          return data.edges.some(item => item.roomId === room.id && item.edge === edge) && lo >= data.lo - EPS && hi <= data.hi + EPS;
        }).flatMap(wall => wall.roomIds.filter(id => id !== room.id)));
        if (targetIds.length === 1) target = roomFor(targetIds[0]);
      }
      const targetKey = target ? target.sourceId : source.balconyId || source.targetType || 'unresolved';
      const sourceId = source.id || (room && own(DIRECTIONS, edge) ? `${kind}-${room.sourceId}-${edge}-${targetKey}` : null);
      if (!sourceId) {
        diagnostic('error', 'An opening lacks a stable source id and room/edge identity; it cannot be attached safely.');
        continue;
      }
      identity(sourceId, 'Opening source id');
      const id = entityId(floorId, sourceId);
      const inputIdentity = JSON.stringify({
        kind, roomId: source.roomId, edge: source.edge, targetRoomId: source.targetRoomId, wallId: source.wallId,
        offsetM: source.offsetM, fraction: source.fraction, width: source.width, widthM: source.widthM,
        sillM: source.sillM, height: source.height, heightM: source.heightM, segment: source.segment, full: source.full
      });
      if (seenInput.has(id)) {
        if (seenInput.get(id) !== inputIdentity) fail(`Duplicate opening source id ${sourceId} has conflicting geometry or ownership.`);
        continue;
      }
      seenInput.set(id, inputIdentity); sourceOpeningIds.add(id);
      const editSet = kind === 'window' ? project.windowEdits : project.doorEdits;
      const edit = kind === 'passage' ? {} : editSet[id] || {};
      openingPriority.set(id, (own(editSet, id) ? 2 : 0) + (source.custom ? 1 : 0));
      let sourceSegment = source.segment;
      let axis = own(DIRECTIONS, edge) ? edgeData(room ? room.module : building, edge).axis : null;
      if (sourceSegment && [sourceSegment.x1, sourceSegment.y1, sourceSegment.x2, sourceSegment.y2].every(Number.isFinite)) {
        if (near(sourceSegment.y1, sourceSegment.y2) && !near(sourceSegment.x1, sourceSegment.x2)) axis = 'x';
        else if (near(sourceSegment.x1, sourceSegment.x2) && !near(sourceSegment.y1, sourceSegment.y2)) axis = 'y';
        else axis = null;
      } else sourceSegment = null;
      const segmentWidth = sourceSegment && axis ? Math.hypot(sourceSegment.x2 - sourceSegment.x1, sourceSegment.y2 - sourceSegment.y1) : undefined;
      const originalWidth = source.widthM ?? segmentWidth ?? source.width;
      const width = edit.widthM ?? originalWidth;
      const basis = { id, sourceId, kind, wallId: source.wallId || null };
      if (!positive(width) || (!axis && !source.wallId)) {
        unresolved(basis, 'Opening geometry is missing, non-orthogonal or nonpositive.', 'error');
        continue;
      }
      let candidates = scene.walls.filter(wall => {
        const data = wallData.get(wall.id);
        if (source.wallId) return wall.id === source.wallId || wall.id === entityId(floorId, source.wallId);
        if (axis !== data.axis) return false;
        if (room) return data.edges.some(item => item.roomId === room.id && (!own(DIRECTIONS, edge) || item.edge === edge));
        return sourceSegment && near(data.fixed, axis === 'x' ? sourceSegment.y1 : sourceSegment.x1);
      });
      if (target) candidates = candidates.filter(wall => wall.roomIds.includes(target.id));
      if (kind === 'passage' && source.full && !target && room && candidates.some(wall => wall.roomIds.length === 2)) {
        const shared = candidates.filter(wall => wall.roomIds.length === 2);
        if (sourceSegment) candidates = shared.filter(wall => {
          const data = wallData.get(wall.id);
          const lo = Math.min(sourceSegment[axis === 'x' ? 'x1' : 'y1'], sourceSegment[axis === 'x' ? 'x2' : 'y2']);
          return lo < data.hi - EPS && lo + segmentWidth > data.lo + EPS;
        });
      }
      const resolved = [];
      for (const wall of candidates) {
        const data = wallData.get(wall.id), length = data.hi - data.lo;
        let lo;
        if (source.wallId && Number.isFinite(source.offsetM)) lo = data.lo + source.offsetM;
        else if (sourceSegment) lo = Math.min(sourceSegment[data.axis === 'x' ? 'x1' : 'y1'], sourceSegment[data.axis === 'x' ? 'x2' : 'y2']);
        else if (room && own(DIRECTIONS, edge) && Number.isFinite(source.fraction) && source.fraction >= 0 && source.fraction <= 1) {
          const span = edgeData(room.module, edge);
          lo = span.lo + (span.hi - span.lo) * source.fraction - originalWidth / 2;
        }
        if (!Number.isFinite(lo)) continue;
        let end = lo + width;
        if (kind === 'passage' && source.full) {
          if (target || wall.roomIds.length === 2) { lo = data.lo; end = data.hi; }
          else if (room) {
            const moduleEdge = edgeData(room.module, edge);
            const passages = (plan.flexSpaces || []).filter(space =>
              [space.x, space.y, space.w, space.h].every(Number.isFinite) && positive(space.w) && positive(space.h));
            const spans = passages.map(space => {
              const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' }[edge];
              if (!opposite) return null;
              const passageEdge = edgeData(space, opposite);
              if (!near(passageEdge.fixed, moduleEdge.fixed)) return null;
              const start = Math.max(moduleEdge.lo, passageEdge.lo), stop = Math.min(moduleEdge.hi, passageEdge.hi);
              return stop > start + EPS && lo < stop && end > start ? [start, stop] : null;
            }).filter(Boolean).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
            if (spans.length) [lo, end] = spans[0];
          }
        }
        if (kind === 'passage') { lo = Math.max(lo, data.lo); end = Math.min(end, data.hi); }
        if (lo < data.lo - EPS || end > data.hi + EPS || end - lo <= EPS) continue;
        const offsetM = Math.max(0, lo - data.lo), widthM = kind === 'passage' ? Math.min(length, end - data.lo) - offsetM : width;
        const sillM = kind === 'passage' ? 0 : edit.sillM ?? source.sillM ?? (kind === 'window' ? (room && room.type === 'bathroom' ? 1.5 : 0.9) : 0);
        const heightM = kind === 'passage' ? wall.heightM : edit.heightM ?? source.heightM ?? source.height ?? (kind === 'window' ? 1.2 : 2.1);
        const openFraction = kind === 'passage' ? 1 : edit.openFraction ?? source.openFraction ?? 0;
        if (!Number.isFinite(sillM) || sillM < 0 || !positive(heightM) || sillM + heightM > wall.heightM + EPS ||
            !Number.isFinite(openFraction) || openFraction < 0 || openFraction > 1) continue;
        const roomId = room ? room.id : wall.roomIds[0] || null;
        const inferredTarget = target ? target.id : wall.roomIds.find(item => item !== roomId);
        const midpoint = wallPoint(wall, offsetM + widthM / 2);
        const left = data.axis === 'x' ? { x: 0, y: -1 } : { x: 1, y: 0 };
        const towardsRoom = room ? (room.rect.x + room.rect.w / 2 - midpoint.x) * left.x + (room.rect.y + room.rect.h / 2 - midpoint.y) * left.y : 0;
        const hinge = edit.hinge ?? source.hinge ?? 'start';
        const swing = edit.swing ?? source.swing ?? (towardsRoom >= 0 ? 'left' : 'right');
        if (!['start', 'end'].includes(hinge) || !['left', 'right'].includes(swing)) continue;
        const start = wallPoint(wall, offsetM), finish = wallPoint(wall, offsetM + widthM);
        const opening = {
          id, sourceId, wallId: wall.id, roomId, kind, offsetM, widthM, sillM, heightM,
          hinge, swing, openFraction, exterior: wall.exterior,
          segment: { x1: start.x, y1: start.y, x2: finish.x, y2: finish.y }
        };
        if (inferredTarget) opening.targetRoomId = inferredTarget;
        if (source.label) opening.label = String(source.label);
        if (kind === 'hinged' || kind === 'sliding') {
          opening.requestedClearWidthM = edit.widthM ?? source.requestedClearWidthM ?? source.widthM ?? source.width ?? widthM;
          opening.nominalLeafWidthM = source.nominalLeafWidthM ?? widthM;
          opening.dimensionConvention = 'schematic-proxy';
          opening.clearWidthVerified = false;
          opening.leafWidthAssumed = source.nominalLeafWidthM === undefined;
          // Reprojected legacy glyph fields are not evidence of confirmed handing.
          opening.handingAssumed = !own(edit, 'hinge') || !own(edit, 'swing');
          if (!positive(opening.requestedClearWidthM) || !positive(opening.nominalLeafWidthM)) continue;
          if (kind === 'hinged' && opening.nominalLeafWidthM > opening.widthM + EPS)
            diagnostic('warning', 'The supplied nominal hinged leaf exceeds the schematic aperture span; frame/leaf fit is unresolved.', [id]);
        }
        if (kind === 'window' && Number.isFinite(source.operability) && source.operability >= 0 && source.operability <= 1)
          opening.operableFraction = source.operability;
        resolved.push(opening);
      }
      if (!resolved.length) {
        unresolved(basis, 'The opening has no unique valid host interval, or exceeds its wall length/height. Its source record is retained for review.');
        continue;
      }
      if (kind === 'passage' && !source.full && !near(resolved.reduce((sum, opening) => sum + opening.widthM, 0), width)) {
        unresolved(basis, 'The complete requested passage interval is not supported by its current host walls. The record is retained without a partial cut.');
        continue;
      }
      if (kind !== 'passage' && resolved.length > 1) {
        unresolved(basis, 'The opening has ambiguous physical wall hosts. Its source record is retained for review.');
        continue;
      }
      for (const opening of resolved) {
        if (resolved.length > 1) opening.id = `${id}:part:${opening.wallId.slice(floorId.length + 1)}`;
        if (kind === 'passage') passageCandidates.push(opening);
        else ordinaryCandidates.push(opening);
      }
    }

    for (const [id, edit] of Object.entries(project.wallEdits)) {
      const wall = wallsById.get(id);
      if (!wall) { diagnostic('warning', 'A saved wall edit has no current host; it is retained for review.', [id]); continue; }
      if (wall.exterior || wall.structuralRole !== 'unknown') {
        diagnostic('error', 'Exterior or structurally protected walls cannot be removed.', [id]); continue;
      }
      const length = wallLength(wall), offsetM = edit.full ? 0 : edit.offsetM, widthM = edit.full ? length : edit.widthM;
      if (offsetM + widthM > length + EPS) {
        diagnostic('warning', 'A saved partition opening exceeds its current wall span; the edit is retained without cutting the wall.', [id]); continue;
      }
      const start = wallPoint(wall, offsetM), end = wallPoint(wall, offsetM + widthM);
      const opening = {
        id: `${id}:passage`, sourceId: `${id.slice(floorId.length + 1)}:passage`, wallId: id, roomId: wall.roomIds[0] || null,
        kind: 'passage', offsetM, widthM, sillM: 0, heightM: wall.heightM,
        hinge: 'start', swing: 'left', openFraction: 1, exterior: false,
        segment: { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
      };
      if (wall.roomIds[1]) opening.targetRoomId = wall.roomIds[1];
      passageCandidates.push(opening);
      diagnostic('warning', 'Internal wall opening is conceptual only. Unknown structural role is not permission to demolish.', [id]);
    }
    const overlaps = (a, b) => a.wallId === b.wallId &&
      a.offsetM < b.offsetM + b.widthM - EPS && b.offsetM < a.offsetM + a.widthM - EPS &&
      a.sillM < b.sillM + b.heightM - EPS && b.sillM < a.sillM + a.heightM - EPS;
    const addOpening = opening => {
      scene.openings.push(opening);
      wallsById.get(opening.wallId).openings.push(opening);
    };
    const mergedPassages = [];
    for (const opening of passageCandidates.sort((a, b) => a.wallId.localeCompare(b.wallId) || a.offsetM - b.offsetM || a.id.localeCompare(b.id))) {
      const wall = wallsById.get(opening.wallId);
      if (wall.exterior || wall.structuralRole !== 'unknown') {
        unresolved(opening, 'An open passage cannot remove an exterior or structurally protected wall.', 'error'); continue;
      }
      const prior = mergedPassages[mergedPassages.length - 1];
      if (prior && prior.wallId === opening.wallId && opening.offsetM <= prior.offsetM + prior.widthM + EPS) {
        const lo = Math.min(prior.offsetM, opening.offsetM), hi = Math.max(prior.offsetM + prior.widthM, opening.offsetM + opening.widthM);
        prior.sourceIds = unique([...(prior.sourceIds || [prior.sourceId]), opening.sourceId]);
        if (opening.id < prior.id) {
          prior.id = opening.id; prior.sourceId = opening.sourceId;
          prior.roomId = opening.roomId;
          if (opening.targetRoomId) prior.targetRoomId = opening.targetRoomId;
        }
        prior.offsetM = lo; prior.widthM = hi - lo;
        const start = wallPoint(wall, lo), end = wallPoint(wall, hi);
        prior.segment = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      } else mergedPassages.push(opening);
    }
    mergedPassages.forEach(addOpening);
    for (const opening of ordinaryCandidates.sort((a, b) => openingPriority.get(b.id) - openingPriority.get(a.id) || a.id.localeCompare(b.id))) {
      const wall = wallsById.get(opening.wallId);
      const prior = wall.openings.find(item => overlaps(item, opening));
      if (prior) {
        if (prior.kind === opening.kind && near(prior.offsetM, opening.offsetM) && near(prior.widthM, opening.widthM) &&
            near(prior.sillM, opening.sillM) && near(prior.heightM, opening.heightM)) {
          prior.sourceIds = unique([...(prior.sourceIds || [prior.sourceId]), opening.sourceId]);
          diagnostic('info', 'Duplicate legacy aperture proposals share one physical opening.', [prior.id, opening.id]);
        } else unresolved(opening, prior.kind === 'passage'
          ? 'This door/window overlaps a removed partition. Its attachment is unresolved; its source and edits are retained.'
          : 'This aperture overlaps another physical opening. Its source and edits are retained for review.');
      } else addOpening(opening);
    }
    for (const key of ['doorEdits', 'windowEdits']) for (const id of Object.keys(project[key])) {
      if (!sourceOpeningIds.has(id)) diagnostic('warning', 'A saved opening edit has no current source; it is retained for review.', [id]);
    }
    if (scene.openings.some(opening => opening.kind === 'hinged' || opening.kind === 'sliding'))
      diagnostic('info', 'Door requested clear width is unverified. Aperture and nominal leaf spans are schematic proxies; frames, hinge offsets and clearance allowances are not specified. The 90-degree glyph is not operating state.');
    if (scene.openings.some(opening => opening.kind === 'window'))
      diagnostic('info', 'Window operability is potential capacity, not current opening. Glazing is closed unless an explicit openFraction is supplied; window sill/head defaults are assumed.');

    const footprint = [];
    for (const wall of scene.walls) {
      const length = wallLength(wall), data = wallData.get(wall.id);
      wall.openings.sort((a, b) => a.offsetM - b.offsetM || a.sillM - b.sillM || a.id.localeCompare(b.id));
      wall.solidSegments = complement(length, wall.openings.map(opening => [opening.offsetM, opening.offsetM + opening.widthM]));
      wall.solidSections = solidSections(length, wall.heightM, wall.openings);
      const fullHeight = wall.openings.filter(opening => opening.sillM <= EPS && opening.sillM + opening.heightM >= wall.heightM - EPS);
      wall.removed = complement(length, fullHeight.map(opening => [opening.offsetM, opening.offsetM + opening.widthM])).length === 0;
      const baseSolid = complement(length, wall.openings.filter(opening => opening.sillM <= EPS).map(opening => [opening.offsetM, opening.offsetM + opening.widthM]));
      for (const span of baseSolid) {
        const start = wallPoint(wall, span.startM), width = span.endM - span.startM;
        footprint.push(data.axis === 'x'
          ? { x: start.x, y: start.y - wall.thicknessM / 2, w: width, h: wall.thicknessM }
          : { x: start.x - wall.thicknessM / 2, y: start.y, w: wall.thicknessM, h: width });
      }
      const apertureArea = rectangleUnionArea(wall.openings.map(opening => ({ x: opening.offsetM, y: opening.sillM, w: opening.widthM, h: opening.heightM })));
      scene.metrics.solidWallFaceAreaM2 += Math.max(0, length * wall.heightM - apertureArea);
    }
    scene.metrics.wallFootprintM2 = rectangleUnionArea(footprint);
    scene.metrics.roomCarpetM2 = rectangleUnionArea(scene.rooms.map(room => room.rect));

    const furnitureIds = new Set();
    for (const source of plan.furniture || []) {
      const room = roomFor(source.roomId);
      const sourceId = source.id || (Number.isSafeInteger(source.seq) && room ? `furniture-${source.type || 'item'}-${room.sourceId}-seq-${source.seq}` : null);
      if (!sourceId || !room) {
        diagnostic('warning', 'Furniture has no stable id or parent room; its source record is retained.');
        continue;
      }
      identity(sourceId, 'Furniture source id');
      const id = entityId(floorId, sourceId);
      if (furnitureIds.has(id)) fail(`Duplicate furniture source id ${sourceId}.`);
      furnitureIds.add(id);
      const bounds = rect(source.rect || source, `Furniture ${sourceId}`);
      const edit = project.furnitureEdits[id] || {};
      const headLocal = edit.headLocal ?? source.headLocal ?? (bounds.w <= bounds.h ? 'N' : 'W');
      enumValue(headLocal, Object.keys(DIRECTIONS), 'Furniture head direction');
      const pinned = edit.pinned ?? source.pinned ?? false;
      bool(pinned, 'Furniture pinned state');
      const furniture = {
        id, sourceId, roomId: room.id, type: String(source.type || 'furniture'), label: String(source.label || sourceId),
        rect: bounds, headLocal, pinned,
        headDirectionAssumed: edit.headLocal === undefined && source.headLocal === undefined
      };
      if (!inside(bounds, room.rect)) diagnostic('warning', 'Furniture extends outside its clear room carpet.', [id, room.id]);
      if (furniture.type === 'bed' && furniture.headDirectionAssumed)
        diagnostic('warning', 'Legacy bed polarity was not recorded; N/W follows the old drawing convention only. Confirm the actual head end.', [id]);
      scene.furniture.push(furniture);
    }
    scene.furniture.sort((a, b) => a.id.localeCompare(b.id));
    for (const id of Object.keys(project.furnitureEdits)) {
      if (!furnitureIds.has(id)) diagnostic('warning', 'A saved furniture edit has no current source; it is retained for review.', [id]);
    }
    for (const item of scene.electrical) {
      const wallId = item.wallId || item.anchor && item.anchor.wallId || item.mount && item.mount.wallId;
      if (wallId && (!wallsById.has(wallId) || wallsById.get(wallId).removed))
        diagnostic('warning', 'An electrical attachment has no surviving wall host; retain and review the point before installation.', [item.id, wallId].filter(Boolean));
    }
    scene.openings.sort((a, b) => a.id.localeCompare(b.id));
    return scene;
  }

  return Object.freeze({ createProject, validateProject, parseProject, buildScene, localToWorld, worldVectorToLocal, wallPoint, doorGeometry });
});
