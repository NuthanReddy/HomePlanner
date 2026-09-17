(function (root, factory) {
  'use strict';
  const scriptURL = root.document?.currentScript?.src;
  const api = factory(root, scriptURL);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.HomePlanner3D = api;
    if (!root.document) return;
    const start = () => {
      const host = root.document.getElementById('planner3d');
      if (host) api.instance = api.mount(host);
    };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, scriptURL) {
  'use strict';

  const THREE_VERSION = '0.185.1';
  const EPS = 1e-7;
  const PREVIEW = Object.freeze({
    slabM: 0.14, finishM: 0.02, doorLeafM: 0.035, glassM: 0.012, frameM: 0.045
  });
  const STRUCTURE_COLORS = Object.freeze({
    unspecified: 0x777777, assumed: 0xd99b38, authored: 0x367fbd, 'engineer-provided': 0x9567bd
  });
  const STRUCTURE_CAVEAT = 'Structural engineering is not assessed. Colors identify provenance claims only: assumed (amber), authored (blue), engineer-provided (purple), unspecified (gray); none are verified. No safety, capacity or shadow analysis is provided. Full findings and edits are available in Design → Structure (2D).';
  const PLUMBING_COLORS = Object.freeze({
    cold: 0x368cdb, hot: 0xe76b53, soil: 0x986744, waste: 0xc89832, vent: 0x946ac4, storm: 0x32a7a0, unknown: 0x888888
  });
  const DRAINAGE_CAVEAT = 'Drainage engineering is not assessed. Sanitary waste and storm intent are nonphysical centerlines and screen-space nodes; storm is teal, sanitary circuits retain plumbing colors. No pipe sizes, fittings, chambers, shafts, terrain, safe access volumes or invert-to-axis conversion are inferred. Ground, finished floor, invert, discharge and provenance are supplied unverified metadata, not verified connection, cover, capacity or compliance. Null geometry gaps are never bridged. No hydraulic flow is calculated. Review coordination findings in 2D.';
  const PLUMBING_CAVEAT = 'Plumbing engineering is not assessed. Colors identify proposed circuits only: cold (blue), hot (red), soil (brown), waste (amber), vent (purple), unknown (gray); not velocity, hydraulics or verified flow. All routes are nonphysical centerlines with screen-space linewidth, regardless of supplied diameter. Diameter values are recorded exactly, not interpreted as outer diameter or wall thickness. Gaps and missing levels remain unknown, never bridged or defaulted. Nodes are screen-space points, not valves or fittings. Fixture boxes show only explicit extents, not internals. No sizing, pressure, capacity, fall, clearance, penetration, compliance or shadow analysis is performed. Review findings and edit in 2D.';
  const mounts = new WeakMap();
  const LIGHT_CAVEAT = 'NOT LUX. Display-only midpoint workplane cells, not a continuous lighting field or an area-average measurement. Gray outlines mean unavailable, not zero shade. Modeled values require explicit 2D opt-in; SUBTOTAL hours are not complete-period results. Sky access is dimensionless geometric access, independent of night. No photometry, adequacy or approval is assessed. Active-floor inspection filters sensors only: analysis still uses all floors and foreign occluders, even when hidden here.';
  let enginePromise;
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const refKey = ref => ref ? `${ref.kind}\u0000${ref.id}` : '';
  const validRect = r => r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) &&
    r.w > EPS && r.h > EPS;

  function roomFloorRegions(room) {
    if (!Object.hasOwn(room, 'usableRegions')) return validRect(room.rect) ? [room.rect] : [];
    const regions = typeof module === 'object' && module.exports ? require('./planner-regions.js') : root.HomePlannerRegions;
    if (!regions?.area || !regions?.subtractRectangle)
      throw new Error('Load planner-regions.js to inspect supplied usable room-floor regions.');
    regions.area(room.usableRegions);
    if (!validRect(room.rect) || room.usableRegions.some(region => regions.subtractRectangle(region, [room.rect]).length))
      throw new Error(`Room ${room.id} has invalid or unrepresentable usable floor regions; no bounding-box floor was substituted.`);
    return room.usableRegions;
  }

  function toThree(point, scene, up = 0) {
    const a = finite(scene.headingDeg) * Math.PI / 180;
    const frame = scene.coordinateSpace === 'site-local' ? scene.plot : scene.floor;
    const dx = point.x - frame.w / 2, dy = point.y - frame.h / 2;
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a),
      y: up,
      z: dx * Math.sin(a) + dy * Math.cos(a)
    };
  }

  function wallGrid(wall, openings) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const height = finite(wall.heightM);
    if (wall.removed || length < EPS || height < EPS) return { x: [], y: [], filled: [], cells: [] };
    const sections = Array.isArray(wall.solidSections) ? wall.solidSections
      .filter(s => [s.startM, s.endM, s.sillM, s.heightM].every(Number.isFinite))
      .map(s => ({
        start: clamp(s.startM, 0, length), end: clamp(s.endM, 0, length),
        bottom: clamp(s.sillM, 0, height), top: clamp(s.sillM + s.heightM, 0, height)
      })).filter(s => s.end - s.start > EPS && s.top - s.bottom > EPS) : null;
    const cuts = (sections ? [] : openings || []).filter(o => !o.unresolved && o.resolved !== false &&
      [o.offsetM, o.widthM, o.sillM, o.heightM].every(Number.isFinite))
      .map(o => ({
        start: clamp(o.offsetM, 0, length), end: clamp(o.offsetM + o.widthM, 0, length),
        bottom: clamp(o.sillM, 0, height), top: clamp(o.sillM + o.heightM, 0, height)
      })).filter(o => o.end - o.start > EPS && o.top - o.bottom > EPS);
    const segments = Array.isArray(wall.solidSegments) ? wall.solidSegments : [{ startM: 0, endM: length }];
    const support = segments.filter(s => Number.isFinite(s.startM) && Number.isFinite(s.endM))
      .map(s => ({ start: clamp(s.startM, 0, length), end: clamp(s.endM, 0, length) }))
      .filter(s => s.end - s.start > EPS);
    // Exact model sections take precedence. Older scenes need a union cut,
    // not independent sill/lintel boxes that could refill a stacked opening.
    support.push(...cuts);
    const stops = values => values.sort((a, b) => a - b)
      .filter((v, i, list) => !i || v - list[i - 1] > EPS);
    const x = stops([0, length, ...(sections || support).flatMap(s => [s.start, s.end])]);
    const y = stops([0, height, ...(sections || cuts).flatMap(s => [s.bottom, s.top])]);
    const cells = [], filled = [];
    for (let i = 0; i < x.length - 1; i++) {
      filled[i] = [];
      for (let j = 0; j < y.length - 1; j++) {
        const u = (x[i] + x[i + 1]) / 2, v = (y[j] + y[j + 1]) / 2;
        const contains = s => u > s.start && u < s.end && v > s.bottom && v < s.top;
        const solid = sections ? sections.some(contains) : support.some(s => u > s.start && u < s.end) &&
          !cuts.some(contains);
        filled[i][j] = solid;
        if (solid) cells.push({ startM: x[i], endM: x[i + 1], bottomM: y[j], topM: y[j + 1] });
      }
    }
    return { x, y, filled, cells };
  }

  function wallSurfaceData(wall, openings, scene) {
    const grid = wallGrid(wall, openings), positions = [];
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (length < EPS) return positions;
    const ux = (wall.end.x - wall.start.x) / length, uy = (wall.end.y - wall.start.y) / length;
    const half = finite(wall.thicknessM) / 2;
    if (half < EPS) return positions;
    const base = finite(wall.baseM, scene.floorElevationM);
    const point = (u, v, side) => toThree({
      x: wall.start.x + ux * u - uy * side,
      y: wall.start.y + uy * u + ux * side
    }, scene, base + v);
    const quad = corners => {
      const points = corners.map(c => point(...c));
      [0, 1, 2, 0, 2, 3].forEach(i => positions.push(points[i].x, points[i].y, points[i].z));
    };
    grid.filled.forEach((column, i) => column.forEach((solid, j) => {
      if (!solid) return;
      const a = grid.x[i], b = grid.x[i + 1], lo = grid.y[j], hi = grid.y[j + 1], d = half;
      quad([[a, lo, d], [b, lo, d], [b, hi, d], [a, hi, d]]);
      quad([[b, lo, -d], [a, lo, -d], [a, hi, -d], [b, hi, -d]]);
      if (!grid.filled[i - 1]?.[j]) quad([[a, lo, -d], [a, lo, d], [a, hi, d], [a, hi, -d]]);
      if (!grid.filled[i + 1]?.[j]) quad([[b, lo, d], [b, lo, -d], [b, hi, -d], [b, hi, d]]);
      if (!column[j - 1]) quad([[a, lo, -d], [b, lo, -d], [b, lo, d], [a, lo, d]]);
      if (!column[j + 1]) quad([[a, hi, d], [b, hi, d], [b, hi, -d], [a, hi, -d]]);
    }));
    return positions;
  }

  function bedPillows(rect, headLocal) {
    if (!validRect(rect) || !['N', 'E', 'S', 'W'].includes(headLocal)) return [];
    return [0, 1].map(i => {
      if (headLocal === 'N' || headLocal === 'S') {
        const depth = Math.min(0.42, rect.h * 0.22);
        return {
          x: rect.x + rect.w * (0.05 + 0.5 * i),
          y: headLocal === 'N' ? rect.y + rect.h * 0.05 : rect.y + rect.h * 0.95 - depth,
          w: rect.w * 0.4, h: depth
        };
      }
      const depth = Math.min(0.42, rect.w * 0.22);
      return {
        x: headLocal === 'W' ? rect.x + rect.w * 0.05 : rect.x + rect.w * 0.95 - depth,
        y: rect.y + rect.h * (0.05 + 0.5 * i),
        w: depth, h: rect.h * 0.4
      };
    });
  }

  function doorLeaf(opening, wall, model) {
    if (typeof model?.doorGeometry !== 'function') throw new Error('The shared model doorGeometry API is unavailable.');
    // Request the full swing to avoid applying an operating fraction twice.
    const geometry = model.doorGeometry({ ...opening, openFraction: 1 }, wall);
    const { hinge, closedEnd, openEnd } = geometry;
    if (![hinge, closedEnd, openEnd].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
      throw new Error('The shared model returned an invalid door pivot.');
    }
    const dx = closedEnd.x - hinge.x, dy = closedEnd.y - hinge.y;
    const ox = openEnd.x - hinge.x, oy = openEnd.y - hinge.y;
    const angle = Math.atan2(dx * oy - dy * ox, dx * ox + dy * oy) *
      clamp(finite(opening.openFraction), 0, 1);
    return {
      hinge,
      end: {
        x: hinge.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: hinge.y + dx * Math.sin(angle) + dy * Math.cos(angle)
      }
    };
  }

  function disposeObject(object) {
    if (!object) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      const list = Array.isArray(node.material) ? node.material : [node.material];
      list.filter(Boolean).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      });
      if (node.isLight) {
        if (typeof node.dispose === 'function') node.dispose();
        else node.shadow?.dispose();
      }
    });
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
  }

  function requireSiteScenes(scenes, project) {
    const ids = new Set(Array.isArray(scenes) ? scenes.map(scene => scene?.floorId) : []);
    const first = scenes?.[0];
    if (!Array.isArray(scenes) || !project.floors?.length || scenes.length !== project.floors.length ||
      ids.size !== scenes.length || project.floors.some(floor => !ids.has(floor.id)) ||
      scenes.some(scene => !scene || scene.coordinateSpace !== 'site-local' || !validRect(scene.plot) ||
        scene.plot.x !== 0 || scene.plot.y !== 0 || !Number.isFinite(scene.headingDeg) ||
        Math.abs(scene.headingDeg - first.headingDeg) > EPS ||
        Math.abs(scene.plot.w - first.plot.w) > EPS || Math.abs(scene.plot.h - first.plot.h) > EPS ||
        !validRect(scene.floor) || !Number.isFinite(scene.floorElevationM) || !Number.isFinite(scene.wallHeightM))) {
      throw new Error('3D intent requires exactly all registered floors in one common site frame. Repair missing geometry / plot registration in 2D; no partial or floor-centered overlay is shown.');
    }
  }

  function structureObject(THREE, element, scene) {
    const g = element.geometry;
    if (!g) return null;
    let object;
    if (g.kind === 'grid') {
      const points = [g.start, g.end].map(p => {
        const v = toThree(p, scene, p.z);
        return new THREE.Vector3(v.x, v.y, v.z);
      });
      object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: STRUCTURE_COLORS[element.sizeSource] ?? STRUCTURE_COLORS.unspecified }));
    } else if (g.kind === 'box' || g.kind === 'beam') {
      const mat = new THREE.MeshStandardMaterial({
        color: STRUCTURE_COLORS[element.sizeSource] ?? STRUCTURE_COLORS.unspecified, roughness: 0.82, metalness: 0
      });
      if (g.kind === 'box') {
        object = new THREE.Mesh(new THREE.BoxGeometry(g.w, g.h, g.d), mat);
        const p = toThree({ x: g.x + g.w / 2, y: g.y + g.d / 2 }, scene, g.z + g.h / 2);
        object.position.set(p.x, p.y, p.z);
        object.rotation.y = -scene.headingDeg * Math.PI / 180;
      } else {
        const p = toThree(g.start, scene, g.start.z + g.depthM / 2);
        const q = toThree(g.end, scene, g.start.z + g.depthM / 2);
        object = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(q.x - p.x, q.z - p.z), g.depthM, g.widthM), mat);
        object.position.set((p.x + q.x) / 2, p.y, (p.z + q.z) / 2);
        object.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
      }
    }
    if (!object) return null;
    object.name = element.label;
    object.userData.structuralId = element.id;
    object.castShadow = object.receiveShadow = false;
    return object;
  }

  function currentLight(drawing, project, state, foundation) {
    if (typeof foundation?.discover !== 'function') throw new Error('Load planner-light.js to inspect an already computed light result. Continue in 2D.');
    requireSiteScenes(drawing?.scenes, project);
    let inventory;
    try { inventory = foundation.discover(drawing); }
    catch (error) {
      return { result: null, inventory: null, visualization: state?.visualization || {},
        error: `Light study unavailable: ${error.message}. Architectural inspection remains available.` };
    }
    const result = state?.result;
    const valid = !state?.stale && result?.kind === 'RoomLightStudy' &&
      ['complete', 'incomplete'].includes(result.status) && Array.isArray(result.sensors) &&
      drawing.projectId === project.id && result.provenance?.projectId === project.id &&
      inventory.projectId === project.id &&
      result.provenance?.scenePhysicalFingerprint === inventory.physicalFingerprint;
    return { result: valid ? result : null, inventory, visualization: state?.visualization || {} };
  }

  function buildLight(THREE, scenes, project, data, activeOnly = false) {
    const result = data?.result, view = data?.visualization || {};
    const metric = ['direct', 'presence-hours', 'equivalent-hours', 'sky'].includes(view.metric) ? view.metric : 'direct';
    const index = Number.isInteger(view.intervalIndex) && view.intervalIndex >= 0 ? view.intervalIndex : 0;
    const mask = result?.direct?.masks?.[index], modeled = view.modeled === true;
    const units = metric.endsWith('hours') ? 'hours' : 'dimensionless 0–1';
    const time = metric === 'sky' ? 'geometry-only; not day/night' : metric === 'direct' ?
      `${mask?.sampleUTC || 'interval unavailable'} UTC` :
      `${result?.config?.period?.startUTC || '?'} – ${result?.config?.period?.endUTC || '?'} UTC`;
    const layer = { objects: [], schedule: [], averages: [], metric, units,
      label: `${metric} · ${time} · ${result ? result.status : data?.error || 'unavailable: compute a current result in 2D'} · ${modeled ? 'MODELED / hours SUBTOTAL' : 'primary known values only'} · ${units} · NOT LUX.` };
    if (!result) return layer;
    const sceneById = new Map(scenes.map(s => [s.floorId, s]));
    const roomKey = ref => JSON.stringify([ref?.floorId, ref?.entityId]);
    const rooms = new Map((data.inventory?.rooms || []).map(r => [roomKey(r.ref), r]));
    const groups = new Map();
    const sky = new Map((result.sky?.sensorResults || []).map(s => [s.sensorId, s]));
    const direct = new Map((result.direct?.sensorResults || []).map(s => [s.sensorId, s]));
    const hasPoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
    const attach = (object, metadata) => {
      object.userData = metadata;
      object.castShadow = object.receiveShadow = false;
      object.raycast = () => {};
      layer.objects.push(object);
    };
    try {
      result.sensors.forEach((sensor, sensorIndex) => {
        if (activeOnly && sensor.room?.floorId !== project.activeFloorId) return;
        const scene = sceneById.get(sensor.room?.floorId);
        const rect = rooms.get(roomKey(sensor.room))?.geometry?.rect;
        let value = null, status = 'unavailable';
        if (metric === 'direct') value = (modeled ? mask?.modeledDirectPathWeights : mask?.directPathWeights)?.[sensorIndex];
        else if (metric === 'sky') {
          const row = sky.get(sensor.id);
          value = modeled ? row?.modeledCosineWeightedSkyAccess : row?.cosineWeightedSkyAccess;
        } else {
          const row = direct.get(sensor.id), presence = metric === 'presence-hours';
          if (modeled) value = row?.[presence ? 'modeledProcessedPositivePathPresenceHours' : 'modeledProcessedTransmittedEquivalentSunHours'];
          else if (result.direct?.complete === true) value = row?.[presence ? 'positivePathPresenceHours' : 'transmittedEquivalentSunHours'];
        }
        value = Number.isFinite(value) && value >= 0 ? value : null;
        if (value !== null) status = modeled ? metric.endsWith('hours') ? 'MODELED SUBTOTAL' : 'MODELED' : 'known';
        const record = { sensorId: sensor.id, workplaneId: sensor.workplaneId, room: sensor.room, point: sensor.point, metric, value, units, status,
          grid: sensor.grid, areaWeightM2: sensor.areaWeightM2, geometryStatus: 'unavailable' };
        layer.schedule.push(record);
        const key = JSON.stringify([sensor.workplaneId, roomKey(sensor.room)]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
        if (!scene || !hasPoint(sensor.point) || !validRect(rect) ||
          !['columns', 'rows'].every(k => Number.isInteger(sensor.grid?.[k]) && sensor.grid[k] > 0)) return;
        if (sensor.cell && !validRect(sensor.cell)) return;
        const w = sensor.cell?.w ?? rect.w / sensor.grid.columns, h = sensor.cell?.h ?? rect.h / sensor.grid.rows;
        const geometry = new THREE.PlaneGeometry(w, h);
        const fraction = value === null ? 0 : clamp(value / (metric.endsWith('hours') ? Math.max(EPS, finite(result.direct?.periodHours, 1)) : 1), 0, 1);
        const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          color: value === null ? 0x999999 : value === 0 ? 0x234b78 : 0xf0b43c,
          transparent: true, opacity: value === null ? 0.8 : 0.3 + fraction * 0.4,
          depthWrite: false, toneMapped: false, side: THREE.DoubleSide, wireframe: value === null
        }));
        const p = toThree(sensor.point, scene, sensor.point.z);
        object.position.set(p.x, p.y, p.z);
        object.rotation.set(-Math.PI / 2, 0, -scene.headingDeg * Math.PI / 180);
        record.geometryStatus = 'midpoint-cell';
        attach(object, { lightSensorId: sensor.id, floorId: sensor.room.floorId, value, status, metric });
      });
      for (const records of groups.values()) {
        const known = records.every(r => r.value !== null && Number.isFinite(r.areaWeightM2) && r.areaWeightM2 > 0);
        const area = records.reduce((sum, r) => sum + r.areaWeightM2, 0);
        const average = known ? records.reduce((sum, r) => sum + r.value * (r.areaWeightM2 / area), 0) : null;
        layer.averages.push({ kind: 'numerical-area-weighted-midpoint-average', workplaneId: records[0].workplaneId,
          room: records[0].room, metric, units, value: Number.isFinite(average) ? average : null,
          status: known ? records[0].status : 'unavailable; not a partial-room average',
          meaning: 'Numerical midpoint approximation, not measured continuous area illumination.' });
      }
      if (view.showElectrical === true) for (const e of data.inventory?.electrical || []) {
        if (activeOnly && e.floorId !== project.activeFloorId) continue;
        const scene = sceneById.get(e.floorId), known = scene && hasPoint(e.point);
        layer.schedule.push({ electrical: e, geometryStatus: known ? 'explicit-point' : 'unavailable; schedule only', photometry: 'not calculated' });
        if (!known) continue;
        const p = toThree(e.point, scene, e.point.z);
        attach(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, p.y, p.z)]),
          new THREE.PointsMaterial({ color: 0xc996e8, size: 7, sizeAttenuation: false, depthWrite: false, toneMapped: false })),
        { lightElectricalId: e.record.id, floorId: e.floorId });
      }
      return layer;
    } catch (error) {
      layer.objects.forEach(disposeObject);
      throw error;
    }
  }

  function buildContent(THREE, scenes, project, model, options = {}) {
    if (options.structuralIntent || options.plumbingIntent || options.drainageIntent || options.lightStudy) requireSiteScenes(scenes, project);
    if (options.structuralIntent) {
      if (!options.structure?.elements || !options.structure?.findings) throw new Error('Structural coordination output is unavailable.');
    }
    if (options.plumbingIntent && !['nodes', 'routes', 'fixtures', 'findings'].every(k => Array.isArray(options.services?.[k]))) {
      throw new Error('Plumbing services output is unavailable. Load planner-services.js and continue in 2D.');
    }
    if (options.drainageIntent && !['nodes', 'routes', 'findings'].every(k => Array.isArray(options.drainage?.[k]))) {
      throw new Error('Drainage coordination output is unavailable. Load planner-drainage.js and continue in 2D.');
    }
    const group = new THREE.Group(), refs = new Map(), pickables = [], roofs = [], warnings = [];
    const validScenes = scenes.filter(scene => scene && validRect(scene.floor) &&
      Number.isFinite(scene.floorElevationM) && Number.isFinite(scene.wallHeightM));
    const shown = options.activeOnly ? validScenes.filter(s => s.floorId === project.activeFloorId) : validScenes;
    if (!shown.length) throw new Error('There is no valid floor plate to inspect. Generate or select a valid layout in 2D.');
    const floorNames = new Map((project.floors || []).map(f => [f.id, f.name || f.id]));
    const material = (color, more) => new THREE.MeshStandardMaterial({
      color, roughness: 0.82, metalness: 0, ...more
    });
    const floors = [];
    const add = (owner, geometry, mat, ref, detail) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      if (ref) {
        mesh.userData.entityRef = ref;
        const key = refKey(ref);
        if (!refs.has(key)) refs.set(key, { ...detail, ref, objects: [] });
        refs.get(key).objects.push(mesh);
      }
      owner.add(mesh);
      pickables.push(mesh);
      return mesh;
    };
    const localBox = (owner, scene, rect, base, height, mat, ref, detail, minimumSpan = EPS) => {
      if (!rect || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) ||
          rect.w <= minimumSpan || rect.h <= minimumSpan || height <= EPS) return null;
      const mesh = add(owner, new THREE.BoxGeometry(rect.w, height, rect.h), mat, ref, detail);
      const p = toThree({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, scene, base + height / 2);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = -finite(scene.headingDeg) * Math.PI / 180;
      return mesh;
    };
    const bar = (owner, scene, a, b, thickness, base, height, mat, ref, detail) => {
      const p = toThree(a, scene, base + height / 2), q = toThree(b, scene, base + height / 2);
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length <= EPS || height <= EPS) return null;
      const mesh = add(owner, new THREE.BoxGeometry(length, height, thickness), mat, ref, detail);
      mesh.position.set((p.x + q.x) / 2, p.y, (p.z + q.z) / 2);
      mesh.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
      return mesh;
    };
    try {
      const groundScene = validScenes.reduce((a, b) => a.floorElevationM < b.floorElevationM ? a : b);
      const plot = groundScene.coordinateSpace === 'site-local' ? groundScene.plot : groundScene.floor;
      localBox(group, groundScene, { x: plot.x - 0.5, y: plot.y - 0.5, w: plot.w + 1, h: plot.h + 1 },
        groundScene.floorElevationM - PREVIEW.slabM - 0.06, 0.04, material(0xb1b5a1));
      const seenWalls = new Set(), seenObstacles = new Set();
      for (const scene of shown) {
        const owner = new THREE.Group();
        owner.name = scene.floorId;
        group.add(owner);
        const floorName = floorNames.get(scene.floorId) || scene.floorId || 'Floor';
        floors.push({ id: scene.floorId, name: floorName, elevationM: scene.floorElevationM });
        const detail = (label, note = '') => ({ label, note, floorId: scene.floorId, floorName });
        const base = scene.floorElevationM;
        const footprint = validRect(scene.building) ? scene.building : scene.floor;
        localBox(owner, scene, footprint, base - PREVIEW.slabM, PREVIEW.slabM, material(0x929ca5));
        const roofThickness = finite(project.building?.roofThicknessM, 0.15);
        if (roofThickness > EPS) {
          const roof = localBox(owner, scene, footprint, base + scene.wallHeightM, roofThickness, material(0xadb6be));
          roof.visible = !options.cutaway;
          roofs.push(roof);
        }
        for (const room of scene.rooms || []) {
          const regions = roomFloorRegions(room);
          if (!regions.length) continue;
          const type = String(room.type || '').toLowerCase();
          const color = /bath|toilet|utility/.test(type) ? 0xb4c7cc : /kitchen/.test(type) ? 0xcac6ad :
            /bed/.test(type) ? 0xc4c5d6 : 0xd4c6b2;
          const mat = material(color), ref = { kind: 'room', id: room.id }, info = detail(room.label || 'Room');
          // Valid clipping fragments can be thinner than the legacy full-box cutoff.
          for (const region of regions)
            localBox(owner, scene, region, base, PREVIEW.finishM, mat, ref, info, 0);
        }
        for (const balcony of scene.balconies || []) {
          if (!validRect(balcony.rect) || typeof balcony.id !== 'string' || !balcony.id) {
            warnings.push('A supplied balcony has unavailable geometry or identity; no replacement footprint was inferred.');
            continue;
          }
          localBox(owner, scene, balcony.rect, base - PREVIEW.slabM, PREVIEW.slabM, material(0xb7b9a8),
            { kind: 'balcony', id: balcony.id }, detail(balcony.label || 'Balcony',
              'Supplied balcony footprint; the 0.14 m slab thickness is schematic, not a designed slab or verified support. No railing is inferred. '));
        }
        const walls = new Map((scene.walls || []).map(wall => [wall.id, wall]));
        const hosted = new Map();
        for (const opening of scene.openings || []) {
          if (opening.unresolved || opening.resolved === false) continue;
          if (!hosted.has(opening.wallId)) hosted.set(opening.wallId, []);
          hosted.get(opening.wallId).push(opening);
        }
        for (const wall of walls.values()) {
          const key = `${scene.floorId}\u0000${wall.id}`;
          if (seenWalls.has(key)) continue;
          seenWalls.add(key);
          const positions = wallSurfaceData(wall, hosted.get(wall.id), scene);
          if (!positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geometry.computeVertexNormals();
          add(owner, geometry, material(wall.exterior ? 0xddd6c6 : 0xe9e4d9),
            { kind: 'wall', id: wall.id }, detail(wall.exterior ? 'Exterior wall' : 'Shared partition',
              'Structural role is not verified.'));
        }
        for (const opening of scene.openings || []) {
          const wall = walls.get(opening.wallId);
          // A full-wall aperture can remove all masonry while retaining its leaf/glass.
          if (!wall || opening.unresolved || opening.resolved === false) continue;
          if (!['hinged', 'sliding', 'window'].includes(opening.kind)) continue;
          const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
          if (length <= EPS || opening.widthM <= EPS || opening.heightM <= EPS) continue;
          const at = offset => ({
            x: wall.start.x + (wall.end.x - wall.start.x) * offset / length,
            y: wall.start.y + (wall.end.y - wall.start.y) * offset / length
          });
          const left = at(opening.offsetM), right = at(opening.offsetM + opening.widthM);
          const low = finite(wall.baseM, base) + opening.sillM;
          const ref = { kind: opening.kind === 'window' ? 'window' : 'door', id: opening.id };
          const operation = `${Math.round(clamp(finite(opening.openFraction), 0, 1) * 100)}% operating input.`;
          const info = detail(opening.kind === 'window' ? 'Window' : `${opening.kind === 'hinged' ? 'Hinged' : 'Sliding'} door`,
            opening.kind === 'hinged' ? `${operation} Leaf and frame dimensions are schematic.` :
              `${operation} Pane/track motion is unspecified; the glazing shown is not a measured free opening.`);
          const frame = material(0x6b7e83);
          const frameWidth = Math.min(PREVIEW.frameM, opening.widthM / 6, opening.heightM / 6);
          bar(owner, scene, left, right, frameWidth, low + opening.heightM - frameWidth, frameWidth, frame, ref, info);
          if (opening.kind !== 'hinged') {
            bar(owner, scene, left, right, frameWidth, low, frameWidth, frame, ref, info);
          }
          for (const offset of [opening.offsetM + frameWidth / 2, opening.offsetM + opening.widthM - frameWidth / 2]) {
            const p = at(offset);
            localBox(owner, scene, { x: p.x - frameWidth / 2, y: p.y - frameWidth / 2, w: frameWidth, h: frameWidth },
              low, opening.heightM, frame, ref, info);
          }
          if (opening.kind === 'hinged') {
            const leaf = doorLeaf(opening, wall, model);
            bar(owner, scene, leaf.hinge, leaf.end, PREVIEW.doorLeafM, low + 0.015,
              Math.max(EPS, opening.heightM - 0.03), material(0xb39770), ref, info);
          } else {
            const glass = material(0x73bed2, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
            bar(owner, scene, at(opening.offsetM + frameWidth), at(opening.offsetM + opening.widthM - frameWidth),
              PREVIEW.glassM, low + frameWidth, opening.heightM - 2 * frameWidth, glass, ref, info);
          }
        }
        for (const item of scene.furniture || []) {
          if (!validRect(item.rect)) continue;
          const ref = { kind: 'furniture', id: item.id }, type = String(item.type || '').toLowerCase();
          const info = detail(item.label || item.type || 'Furniture', 'Furniture height and detailing are assumed preview dimensions.');
          if (type === 'bed') {
            localBox(owner, scene, item.rect, base + 0.04, 0.22, material(0x837465), ref, info);
            const inset = { x: item.rect.x + item.rect.w * 0.03, y: item.rect.y + item.rect.h * 0.03,
              w: item.rect.w * 0.94, h: item.rect.h * 0.94 };
            localBox(owner, scene, inset, base + 0.26, 0.2, material(0xc0c8d2), ref, info);
            const pillows = bedPillows(item.rect, item.headLocal), pillowMaterial = material(0xf3eee1);
            if (!pillows.length) warnings.push(`${item.label || 'Bed'} has no known head direction; no pillows were inferred.`);
            pillows.forEach(rect => localBox(owner, scene, rect, base + 0.46, 0.09, pillowMaterial, ref, info));
            if (!pillows.length) pillowMaterial.dispose();
          } else {
            const height = /cupboard|wardrobe|fridge/.test(type) ? 1.9 : /counter|kitchen|sink|basin/.test(type) ? 0.88 :
              /table|desk|dining/.test(type) ? 0.75 : /sofa|chair|toilet|wc/.test(type) ? 0.48 : 0.6;
            localBox(owner, scene, item.rect, base + PREVIEW.finishM, height, material(0x9aa6a4), ref, info);
          }
        }
        for (const obstacle of scene.obstacles || []) {
          if (!validRect(obstacle) || !Number.isFinite(obstacle.heightM) || obstacle.heightM <= 0 ||
            !['building', 'tree'].includes(obstacle.type)) continue;
          const obstacleBase = finite(obstacle.baseM, base);
          const p = toThree({ x: obstacle.x + obstacle.w / 2, y: obstacle.y + obstacle.h / 2 }, scene, obstacleBase);
          const key = JSON.stringify([obstacle.type, p.x, p.y, p.z, obstacle.w, obstacle.h, obstacle.heightM, scene.headingDeg]);
          if (seenObstacles.has(key)) continue;
          seenObstacles.add(key);
          if (obstacle.type === 'tree') {
            const mesh = add(owner, new THREE.SphereGeometry(1, 12, 8), material(0x7c936d));
            mesh.scale.set(obstacle.w / 2, obstacle.heightM / 2, obstacle.h / 2);
            mesh.position.set(p.x, obstacleBase + obstacle.heightM / 2, p.z);
            mesh.rotation.y = -finite(scene.headingDeg) * Math.PI / 180;
          } else {
            localBox(owner, scene, obstacle, obstacleBase, obstacle.heightM, material(0x9b9d97));
          }
        }
        (scene.diagnostics || []).filter(d => ['warning', 'error'].includes(d.level))
          .forEach(d => warnings.push(d.message));
      }
      let structural = null;
      if (options.structuralIntent) {
        const result = options.structure, sceneById = new Map(shown.map(scene => [scene.floorId, scene]));
        const elements = result.elements.filter(e => sceneById.has(e.floorId));
        structural = { total: result.elements.length, shown: elements.length, solids: 0, grids: 0, missing: 0,
          findings: result.findings, objects: [] };
        for (const element of elements) {
          const object = structureObject(THREE, element, sceneById.get(element.floorId));
          if (!object) { structural.missing++; continue; }
          // Structural records are not part of the shared architectural selection schema.
          group.add(object);
          structural.objects.push(object);
          if (object.isLine) structural.grids++; else structural.solids++;
        }
      }
      const intentLayers = {}, sharedObjects = new Map();
      for (const domain of ['plumbing', 'drainage']) {
        if (!options[`${domain}Intent`]) continue;
        const isDrainage = domain === 'drainage';
        const result = isDrainage ? { ...options.drainage, fixtures: [] } : options.services;
        const sceneById = new Map(validScenes.map(scene => [scene.floorId, scene]));
        const selectedSystem = e => (isDrainage ? ['waste', 'rain'] : ['water', 'waste']).includes(e.system);
        const allRoutes = result.routes.filter(selectedSystem), allNodes = result.nodes.filter(selectedSystem);
        const ownsFloor = e => !options.activeOnly || e.floorId === project.activeFloorId;
        const routes = allRoutes.filter(e => ownsFloor(e) ||
          [e.from, e.to].some(ref => ref?.floorId === project.activeFloorId));
        const endpointKey = ref => JSON.stringify([ref?.floorId, ref?.entityId]);
        const endpoints = new Set(routes.flatMap(e => [endpointKey(e.from), endpointKey(e.to)]));
        const nodes = allNodes.filter(e => ownsFloor(e) || endpoints.has(endpointKey({ floorId: e.floorId, entityId: e.id })));
        const fixtures = result.fixtures.filter(ownsFloor);
        const hasPoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
        const vector = (p, scene) => {
          const v = toThree(p, scene, p.z);
          return new THREE.Vector3(v.x, v.y, v.z);
        };
        const color = e => PLUMBING_COLORS[e.circuit] ?? PLUMBING_COLORS.unknown;
        const plumbing = intentLayers[domain] = {
          total: allRoutes.length + allNodes.length + result.fixtures.length,
          shown: routes.length + nodes.length + fixtures.length,
          routes: routes.length, nodes: nodes.length, fixtures: fixtures.length,
          segments: 0, gaps: 0, solids: 0, points: 0, missing: 0,
          foreignRoutes: options.activeOnly ? routes.filter(e => [e.floorId, e.from?.floorId, e.to?.floorId]
            .some(id => id && id !== project.activeFloorId)).length : 0,
          foreignNodes: options.activeOnly ? nodes.filter(e => e.floorId !== project.activeFloorId).length : 0,
          findings: result.findings, objects: [], schedule: []
        };
        const attach = (object, e, kind) => {
          const key = JSON.stringify([e.floorId, kind, e.id]);
          if (sharedObjects.has(key)) {
            disposeObject(object);
            const existing = sharedObjects.get(key);
            existing.userData[`${domain}Id`] = e.id;
            plumbing.objects.push(existing);
            return;
          }
          object.name = e.label || e.kind || e.id;
          object.userData = { [`${domain}Id`]: e.id, floorId: e.floorId, plumbingKind: kind, system: e.system ?? null,
            circuit: e.circuit ?? null, role: e.role ?? null, diameterMm: e.diameterMm ?? null };
          object.castShadow = object.receiveShadow = false;
          object.raycast = () => {};
          group.add(object);
          sharedObjects.set(key, object);
          plumbing.objects.push(object);
        };
        const metadata = e => isDrainage ? Object.fromEntries([
          'system', 'circuit', 'role', 'invertM', 'groundM', 'finishedFloorM', 'levelSource',
          'levelReference', 'accessRadiusM', 'discharge', 'invertBelowGroundM', 'finishedFloorAboveGroundM',
          'viaInvertsM', 'slope', 'slopeSource', 'slopeReference', 'clearanceM', 'gravityStatus'
        ].filter(key => Object.hasOwn(e, key)).map(key => [key, e[key]])) : {};
        for (const route of routes) {
          const scene = sceneById.get(route.floorId), vertices = [], points = route.points || [];
          plumbing.schedule.push({ kind: 'route', id: route.id, floorId: route.floorId, diameterMm: route.diameterMm ?? null, ...metadata(route) });
          for (let i = 1; i < points.length; i++) {
            if (!hasPoint(points[i - 1]) || !hasPoint(points[i])) { plumbing.gaps++; continue; }
            if (scene) vertices.push(vector(points[i - 1], scene), vector(points[i], scene));
          }
          if (!vertices.length) { plumbing.missing++; continue; }
          plumbing.segments += vertices.length / 2;
          attach(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vertices),
            new THREE.LineBasicMaterial({ color: color(route), linewidth: 1, toneMapped: false })), route, 'route');
        }
        for (const node of nodes) {
          const scene = sceneById.get(node.floorId);
          plumbing.schedule.push({ kind: 'node', id: node.id, floorId: node.floorId, diameterMm: node.diameterMm ?? null, ...metadata(node) });
          if (!scene || !hasPoint(node.anchor)) { plumbing.missing++; continue; }
          attach(new THREE.Points(new THREE.BufferGeometry().setFromPoints([vector(node.anchor, scene)]),
            new THREE.PointsMaterial({ color: color(node), size: 7, sizeAttenuation: false, toneMapped: false })), node, 'node');
          plumbing.points++;
        }
        for (const fixture of fixtures) {
          const scene = sceneById.get(fixture.floorId);
          plumbing.schedule.push({ kind: 'fixture', id: fixture.id, floorId: fixture.floorId,
            widthM: fixture.widthM ?? null, depthM: fixture.depthM ?? null, heightM: fixture.heightM ?? null });
          if (!scene || !hasPoint(fixture.anchor) ||
            !['widthM', 'depthM', 'heightM'].every(k => Number.isFinite(fixture[k]) && fixture[k] > 0)) {
            plumbing.missing++; continue;
          }
          const object = new THREE.Mesh(new THREE.BoxGeometry(fixture.widthM, fixture.heightM, fixture.depthM),
            new THREE.MeshBasicMaterial({ color: 0x87b6b0, transparent: true, opacity: 0.35, depthWrite: false }));
          const p = toThree(fixture.anchor, scene, fixture.anchor.z + fixture.heightM / 2);
          object.position.set(p.x, p.y, p.z);
          object.rotation.y = -scene.headingDeg * Math.PI / 180;
          attach(object, fixture, 'fixture');
          plumbing.solids++;
        }
      }
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      if (options.lightStudy) {
        intentLayers.lightStudy = buildLight(THREE, scenes, project, options.lightData, options.activeOnly);
        intentLayers.lightStudy.objects.forEach(object => group.add(object));
        group.updateMatrixWorld(true);
      }
      return { group, refs, pickables, roofs, bounds, floors, warnings: [...new Set(warnings)], obstacleCount: seenObstacles.size,
        ...(structural ? { structural } : {}), ...intentLayers };
    } catch (error) {
      disposeObject(group);
      throw error;
    }
  }

  function resolveSun(project, sunModel) {
    const selection = project.environment?.sunSelection;
    if (!selection || !sunModel?.calculate) return {
      vector: { east: 0.5, north: -0.4, up: 0.8 },
      label: 'Neutral inspection light. Choose site, date and time in SunCalc for a sun-direction preview.'
    };
    try {
      const result = sunModel.calculate({ ...project.site, ...selection });
      const vector = result.vector;
      if (!vector || ![vector.east, vector.north, vector.up].every(Number.isFinite)) throw new Error('Invalid sun direction.');
      return {
        vector,
        label: vector.up > 0 ?
          `Illustrative sun direction for ${selection.date} ${selection.time} (${project.site.timeZone}); shadows are not analysis results.` :
          'The saved sun is below the horizon. Neutral fill remains so the model can still be inspected.'
      };
    } catch (error) {
      return {
        vector: { east: 0.5, north: -0.4, up: 0.8 },
        label: `Neutral inspection light: saved solar inputs could not be used. ${String(error.message).slice(0, 180)}`
      };
    }
  }

  function loadEngine() {
    if (root.location?.protocol === 'file:') return Promise.reject(new Error(
      '3D needs HTTP or HTTPS: browsers block these local ES modules on file://. Serve the complete HomePlanner folder with a local static server, then open its localhost address. The 2D plan still works here.'
    ));
    if (!enginePromise) {
      const base = new URL('.', scriptURL || root.document.baseURI);
      enginePromise = Promise.all([
        import(new URL('vendor/three/three.module.min.js', base).href),
        import(new URL('vendor/three/OrbitControls.js', base).href)
      ]).then(([THREE, controls]) => ({ THREE, OrbitControls: controls.OrbitControls })).catch(error => {
        enginePromise = null;
        throw new Error(`The local Three.js modules could not load. Keep vendor/three beside index.html, include the local "three" import map, and serve JavaScript MIME types over HTTP/HTTPS. 2D is unaffected. ${String(error.message).slice(0, 180)}`);
      });
    }
    return enginePromise;
  }

  function mount(host, suppliedBridge, suppliedModel, options = {}) {
    if (mounts.has(host)) return mounts.get(host);
    const document = host.ownerDocument, window = document.defaultView || root;
    host.classList.add('hp3d');
    host.innerHTML = `
      <div class="hp3d-heading">
        <div><h3>3D inspection <span class="hp3d-badge">Optional · schematic</span></h3>
          <p>Inspect the shared plan in 3D. Active-floor actions use the same numeric inspector and project history without leaving this view.</p></div>
        <div class="hp3d-actions"><button type="button" data-hp3d="open" aria-expanded="false">Open 3D</button>
          <button type="button" data-hp3d="close" hidden>Close 3D</button></div>
      </div>
      <p class="hp3d-status" data-hp3d="status" role="status" aria-live="polite">3D is off. No graphics library or GPU context is loaded until you choose Open 3D. Plumbing engineering is not assessed.</p>
      <p class="hp3d-diagnostics" data-hp3d="structure-note" role="status" aria-live="polite" hidden></p>
      <button type="button" data-hp3d="structure-off" hidden>Turn off structural intent</button>
      <p class="hp3d-diagnostics" data-hp3d="services-note" role="status" aria-live="polite" hidden></p>
      <button type="button" data-hp3d="services-off" hidden>Turn off plumbing intent</button>
      <p class="hp3d-diagnostics" data-hp3d="drainage-note" role="status" aria-live="polite" hidden></p>
      <button type="button" data-hp3d="drainage-off" hidden>Turn off drainage intent</button>
      <p class="hp3d-diagnostics" data-hp3d="lightStudy-note" role="status" aria-live="polite" hidden></p>
      <button type="button" data-hp3d="lightStudy-off" hidden>Turn off light study</button>
      <div data-hp3d="workspace" hidden>
        <div class="hp3d-toolbar" data-hp3d="toolbar">
          <label><input type="checkbox" data-hp3d="active"> Active floor only</label>
          <label><input type="checkbox" data-hp3d="structure"> Structural intent</label>
          <label><input type="checkbox" data-hp3d="services"> Plumbing intent</label>
          <label><input type="checkbox" data-hp3d="drainage"> Drainage intent</label>
          <label><input type="checkbox" data-hp3d="lightStudy"> Light study (computed 2D result)</label>
          <label><input type="checkbox" data-hp3d="cutaway" checked> Cutaway: hide roof / ceiling caps</label>
          <div class="hp3d-actions"><button type="button" data-hp3d="in" aria-label="Zoom in">Zoom +</button>
            <button type="button" data-hp3d="out" aria-label="Zoom out">Zoom −</button>
            <button type="button" data-hp3d="reset">Reset view</button></div>
        </div>
        <div class="hp3d-edit-toolbar hp3d-actions" data-hp3d="edit-toolbar" role="group" aria-label="Shared model actions on the active floor">
          <button type="button" data-hp3d="undo" disabled>Undo</button>
          <button type="button" data-hp3d="redo" disabled>Redo</button>
          <button type="button" data-hp3d="edit-selection" disabled>Selection properties</button>
          <button type="button" data-hp3d="add-door" disabled>Add door…</button>
          <button type="button" data-hp3d="add-window" disabled>Add window…</button>
          <button type="button" data-hp3d="edit-wall-span" disabled>Retained wall ends…</button>
          <button type="button" data-hp3d="delete-selection" disabled>Delete selection…</button>
          <button type="button" data-hp3d="choose-floor" disabled>Choose active floor</button>
        </div>
        <p class="hp3d-help" data-hp3d="edit-note" role="status" aria-live="polite"></p>
        <p class="hp3d-action-error" data-hp3d="action-error" role="alert" hidden></p>
        <div class="hp3d-viewport" data-hp3d="viewport">
          <div class="hp3d-compass" aria-label="True north, oriented to the camera">
            <span class="hp3d-needle" data-hp3d="north" aria-hidden="true">N<br>↑</span><small>True north</small>
          </div>
        </div>
          <details class="hp3d-assumptions" data-hp3d="services-details" hidden>
            <summary>Supplied plumbing dimensions &amp; identifiers</summary>
            <p class="hp3d-dimension-schedule" data-hp3d="services-schedule" tabindex="0"
              role="region" aria-label="Supplied plumbing dimension schedule"></p>
          </details>
        <details class="hp3d-assumptions hp3d-light-study" data-hp3d="lightStudy-details" hidden>
          <summary>Light study: sensor values, coordinates &amp; electrical intent</summary>
          <p>${LIGHT_CAVEAT} Known zero is blue; positive values are amber with metric-scaled alpha.
            Numerical cells use the exact room/grid extent at the supplied project-relative workplane z.
            Numerical area-weighted midpoint averages require every cell value and area; unknowns are never omitted.
            Electrical intent is a separate purple point inventory only when enabled in 2D; missing xyz stays schedule-only.
            No ceiling heights, emitters or electrical illumination are inferred.</p>
          <p class="hp3d-dimension-schedule" data-hp3d="lightStudy-schedule" tabindex="0"
            role="region" aria-label="Exact light sensor and electrical inventory schedule"></p>
        </details>
        <details class="hp3d-assumptions" data-hp3d="drainage-details" hidden>
          <summary>Drainage intent: supplied levels, discharge &amp; review metadata</summary>
          <p>${DRAINAGE_CAVEAT} Levels are project-relative metres, independently supplied; diameter is nominal mm.
            Access radius and clearance are supplied review distances in metres, not safe zones.
            Empty records do not establish a complete design. Cutaway retains centerlines; active-floor scope includes
            owned or endpoint-touching routes in full and foreign endpoint nodes, not a clipped network.</p>
          <p class="hp3d-dimension-schedule" data-hp3d="drainage-schedule" tabindex="0"
            role="region" aria-label="Exact supplied drainage metadata schedule"></p>
        </details>
        <details class="hp3d-assumptions" data-hp3d="intent-findings">
          <summary>Model warnings &amp; enabled intent coordination findings — engineering not assessed</summary>
          <p class="hp3d-dimension-schedule" data-hp3d="intent-findings-list" tabindex="0"
            role="region" aria-label="Model and intent coordination findings"></p>
        </details>
        <p class="hp3d-help">Drag to orbit · right-drag or Shift-drag to pan · wheel to zoom. Touch: one finger orbits; two pan/zoom.
          Focus the canvas: arrows pan, + / − zoom, R resets, Escape closes. Click an object to share its 2D selection.</p>
        <p class="hp3d-selection" data-hp3d="selection" role="status" aria-live="polite"></p>
        <p class="hp3d-light" data-hp3d="light"></p>
        <p class="hp3d-diagnostics" data-hp3d="diagnostics"></p>
      </div>
      <details class="hp3d-assumptions"><summary>Preview assumptions &amp; limitations</summary>
        <p>Wall heights, storey elevations and roof thickness use project inputs, which may be defaults rather than surveyed values.
          Presentation slabs, including supplied balcony footprints, are assumed 0.14 m thick; furniture heights, door leaves, frames and glazing thickness are schematic.
          No stairs, structural members, terrain or construction assemblies are inferred.</p>
        <p>Structural intent is off by default. When enabled, only complete authored coordination geometry is shown;
          unknown extents are counted without invented volumes. Structural solids are not selectable here and do not cast
          or receive shadows; grids are nonphysical lines. Authored slabs are not roof caps and remain in cutaway.
          Structural engineering is not assessed; even engineer-provided provenance is an unverified claim.
          Review full findings and edit in Design → Structure (2D).</p>
        <p>Plumbing intent is off by default and independent of Structural intent. ${PLUMBING_CAVEAT}
          Unknown fixture dimensions or anchors are count-only missing-geometry markers; inspect them in 2D.
          Active floor only includes routes owned by or ending on that floor, their entire known spans (including foreign
          floors), and their endpoint nodes; fixtures are limited to the active floor. It is not a clipped network or a
          complete network assessment. Cutaway does not hide plumbing.</p>
        <p>Drainage intent is off by default and independent of plumbing and structure.
          Shared waste nodes and routes render once when both service layers are enabled.
          ${DRAINAGE_CAVEAT}</p>
        <p>Cutaway hides only presentation caps; real walls, openings and operating inputs are unchanged. Lower floors may be
          obscured by upper slabs: choose Active floor only to inspect them. Glass remains a barrier; window and sliding-pane
          motion is unspecified, not an unobstructed airflow aperture.</p>
        <p>Only user-provided context boxes / tree ellipsoids appear. Tree porosity and optical transmission are not simulated.
          Sunlight and shadows are illustrative, not sun-hours, temperature, airflow, energy, structural or compliance results.</p>
      </details>`;
    const ui = {};
    host.querySelectorAll('[data-hp3d]').forEach(el => { ui[el.dataset.hp3d] = el; });
    let runtime = null, ticket = 0, phase = 'closed', savedCamera = null, destroyed = false, lightInvalidated = false;
    const bridge = () => suppliedBridge || root.HomePlanner;
    const model = () => suppliedModel || root.HomePlannerModel;
    const editor = () => options.editor || root.HomePlannerEditorInstance;
    const permanentListeners = [];
    const listen = (target, event, fn, settings, cleanup = permanentListeners) => {
      target.addEventListener(event, fn, settings);
      cleanup.push(() => target.removeEventListener(event, fn, settings));
    };
    const message = (text, error = false) => {
      ui.status.textContent = `${text} Plumbing engineering is not assessed. Drainage engineering is not assessed.`;
      ui.status.classList.toggle('hp3d-error', error);
    };
    function updateActions() {
      const api = bridge(), inspector = editor();
      let state = {}, reason = '';
      try {
        if (typeof inspector?.getActionState === 'function') state = inspector.getActionState();
        else reason = 'The shared selection inspector is unavailable. Load planner-drafts.js and planner-editor.js to enable model actions; 3D inspection is still available.';
        for (const [control, capability] of [
          ['edit-selection', 'canEdit'], ['add-door', 'canAddDoor'], ['add-window', 'canAddWindow'],
          ['edit-wall-span', 'canEditWallSpan'], ['delete-selection', 'canDelete']
        ]) ui[control].disabled = !state[capability];
        ui.undo.disabled = typeof api?.undo !== 'function' || !api.canUndo?.();
        ui.redo.disabled = typeof api?.redo !== 'function' || !api.canRedo?.();
        ui['choose-floor'].disabled = typeof inspector?.requestChooseFloor !== 'function';
        ui['edit-note'].textContent = reason || state.reason
          || 'Actions use the shared inspector and active floor. Delete requires confirmation. Picking another storey does not change the active floor.';
      } catch (error) {
        for (const control of ['edit-selection', 'add-door', 'add-window', 'edit-wall-span', 'delete-selection', 'undo', 'redo', 'choose-floor'])
          ui[control].disabled = true;
        ui['edit-note'].textContent = `Shared actions are unavailable: ${error.message}. The displayed geometry has not been changed.`;
      }
    }
    function modelAction(action) {
      try {
        const accepted = action();
        if (accepted === false) throw new Error('The request was not applied. Review the shared inspector message and active-floor selection.');
        ui['action-error'].hidden = true;
        ui['action-error'].textContent = '';
      } catch (error) {
        ui['action-error'].hidden = false;
        ui['action-error'].textContent = error.message || 'The shared model action could not be completed.';
      }
      updateActions();
    }
    function inspectorRequest(method, ...args) {
      return modelAction(() => {
        const inspector = editor();
        if (typeof inspector?.[method] !== 'function') throw new Error('The shared selection inspector is unavailable; no edit was made.');
        return inspector[method](...args);
      });
    }
    function lightSnapshot(drawing, project) {
      const state = document.getElementById?.('workspaceLightStudy')?.homePlannerLight?.getState?.();
      return currentLight(drawing, project, lightInvalidated ? { ...state, result: null } : state,
        options.lightModel || root.HomePlannerLight);
    }
    function lightDetails(layer) {
      ui['lightStudy-note'].hidden = !ui.lightStudy.checked;
      ui['lightStudy-note'].textContent = layer?.label || '';
      ui['lightStudy-details'].hidden = !layer;
      ui['lightStudy-schedule'].textContent = layer ?
        [...layer.schedule, ...layer.averages].map(record => JSON.stringify(record)).join('\n') || 'No current sensor values available. Compute a study in 2D; 3D never runs analysis.' : '';
    }
    function refreshLight() {
      const r = runtime;
      if (!r?.content || !ui.lightStudy.checked || destroyed) return;
      const previous = r.content.lightStudy;
      previous?.objects.forEach(object => {
        r.content.group.remove(object);
        disposeObject(object);
      });
      delete r.content.lightStudy;
      lightDetails(null);
      try {
        const project = bridge().getProject(), drawing = bridge().getDrawingScene();
        const data = lightSnapshot(drawing, project);
        const layer = buildLight(r.THREE, drawing.scenes, project, data, ui.active.checked);
        layer.objects.forEach(object => r.content.group.add(object));
        r.content.lightStudy = layer;
        r.content.group.updateMatrixWorld(true);
        lightDetails(layer);
        requestRender();
      } catch (error) { fail(`3D light inspection could not update: ${error.message} 2D is still available.`); }
    }
    function snapshot() {
      const api = bridge();
      if (!api || !['getProject', 'getScene', 'getScenes', 'getSelection', 'select', 'subscribe'].every(k => typeof api[k] === 'function')) {
        throw new Error('The shared planner bridge is unavailable or lacks getScenes(). Keep planner-model.js and planner-bridge.js before planner-3d.js. The existing 2D planner remains available.');
      }
      const project = api.getProject();
      let scenes, structure, services, drainage, lightData;
      if (ui.structure.checked || ui.services.checked || ui.drainage.checked || ui.lightStudy.checked) {
        if (typeof api.getDrawingScene !== 'function') throw new Error('3D intent needs getDrawingScene() and registered site geometry. Continue in 2D.');
        const drawing = api.getDrawingScene();
        requireSiteScenes(drawing?.scenes, project);
        if (ui.structure.checked) {
          const structuralModel = options.structureModel || root.HomePlannerStructure;
          if (typeof structuralModel?.build !== 'function') throw new Error('Load planner-structure.js to inspect structural intent. Continue in 2D.');
          structure = structuralModel.build(drawing);
        }
        if (ui.services.checked) {
          const servicesModel = options.servicesModel || root.HomePlannerServices;
          if (typeof servicesModel?.build !== 'function') throw new Error('Load planner-services.js to inspect plumbing intent. Continue in 2D.');
          services = servicesModel.build(drawing, { systems: ['water', 'waste'] });
        }
        if (ui.drainage.checked) {
          const drainageModel = options.drainageModel || root.HomePlannerDrainage;
          if (typeof drainageModel?.build !== 'function') throw new Error('Load planner-drainage.js to inspect drainage intent. Continue in 2D.');
          drainage = drainageModel.build(drawing, { systems: ['waste', 'rain'] });
        }
        if (ui.lightStudy.checked) lightData = lightSnapshot(drawing, project);
        scenes = drawing.scenes;
      } else scenes = api.getScenes();
      if (!Array.isArray(scenes)) throw new Error('The shared planner did not provide its storey scenes.');
      return { project, active: api.getScene(), scenes, structure, services, drainage, lightData, selection: api.getSelection() };
    }
    function requestRender() {
      const r = runtime;
      if (!r || r.frame !== null || document.hidden) return;
      r.frame = window.requestAnimationFrame(() => {
        r.frame = null;
        if (r !== runtime) return;
        const width = ui.viewport.clientWidth, height = ui.viewport.clientHeight;
        if (!width || !height) return;
        try {
          if (r.width !== width || r.height !== height) {
            r.width = width; r.height = height;
            r.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
            r.renderer.setSize(width, height, false);
            r.camera.aspect = width / height;
            r.camera.updateProjectionMatrix();
          }
          r.renderer.render(r.world, r.camera);
          const north = new r.THREE.Vector3(0, 0, -1).applyQuaternion(r.camera.quaternion.clone().invert());
          if (Math.hypot(north.x, north.y) > 0.01) {
            ui.north.style.transform = `rotate(${Math.atan2(north.x, north.y) * 180 / Math.PI}deg)`;
          }
        } catch (error) { fail(`3D rendering stopped: ${error.message}. Close and reopen 3D to retry; 2D is still available.`); }
      });
    }
    function selectionChanged(selection) {
      updateActions();
      const r = runtime;
      if (!r?.content) return;
      const entry = r.content.refs.get(refKey(selection));
      r.outline.visible = !!entry;
      if (entry) {
        r.outline.box.makeEmpty();
        entry.objects.forEach(object => r.outline.box.expandByObject(object));
        const active = bridge().getScene();
        ui.selection.textContent = `${entry.label} · ${entry.floorName}. ${entry.note || ''}${entry.floorId !== active?.floorId
          ? ' Choose this floor explicitly with Choose active floor before editing; picking has not switched it.'
          : ' Use Selection properties or the shared actions above to edit while staying in 3D.'}`;
      } else ui.selection.textContent = selection ?
        'The selected object is not in the displayed geometry. Choose its floor or turn off Active floor only.' :
        'No object selected. Click a room floor, balcony, wall, door, window or furniture solid.';
      requestRender();
    }
    function lightScene(project) {
      const r = runtime, sun = resolveSun(project, options.sunModel || root.HomeSun);
      ui.light.textContent = sun.label;
      const center = r.content.bounds.getCenter(new r.THREE.Vector3());
      const radius = Math.max(1, r.content.bounds.getSize(new r.THREE.Vector3()).length() / 2);
      const direction = new r.THREE.Vector3(sun.vector.east, sun.vector.up, -sun.vector.north).normalize();
      r.sun.position.copy(center).addScaledVector(direction, radius * 3);
      r.sun.target.position.copy(center);
      r.sun.intensity = sun.vector.up > 0 ? 2.4 : 0;
      r.sun.castShadow = sun.vector.up > 0;
      const camera = r.sun.shadow.camera;
      camera.left = camera.bottom = -radius * 1.2;
      camera.right = camera.top = radius * 1.2;
      camera.near = 0.1; camera.far = radius * 7;
      camera.updateProjectionMatrix();
      r.sun.shadow.bias = -0.00015;
      r.sun.shadow.normalBias = 0.015;
    }
    function rebuild() {
      const r = runtime;
      if (!r) return;
      try {
        const data = snapshot();
        const content = buildContent(r.THREE, data.scenes, data.project, model(), {
          activeOnly: ui.active.checked, cutaway: ui.cutaway.checked,
          structuralIntent: ui.structure.checked, structure: data.structure,
          plumbingIntent: ui.services.checked, services: data.services,
          drainageIntent: ui.drainage.checked, drainage: data.drainage,
          lightStudy: ui.lightStudy.checked, lightData: data.lightData
        });
        if (r.content) {
          r.world.remove(r.content.group);
          disposeObject(r.content.group);
          r.renderer.renderLists.dispose();
        }
        r.content = content;
        lightDetails(content.lightStudy);
        r.world.add(content.group);
        const radius = content.bounds.getSize(new r.THREE.Vector3()).length();
        r.camera.far = Math.max(100, radius * 25, r.camera.position.distanceTo(r.controls.target) * 5);
        r.camera.updateProjectionMatrix();
        r.controls.maxDistance = Math.max(r.controls.maxDistance, radius * 20);
        lightScene(data.project);
        selectionChanged(data.selection);
        const activeName = content.floors.find(f => f.id === data.active?.floorId)?.name ||
          data.project.floors?.find(f => f.id === data.project.activeFloorId)?.name || 'none';
        message(`Showing ${content.floors.length} storey${content.floors.length === 1 ? '' : 's'} · active floor: ${activeName}. Camera is retained after edits; Reset view fits the displayed geometry.`);
        if (content.structural) {
          const s = content.structural;
          ui['structure-note'].textContent = `Structural intent: ${s.shown} of ${s.total} records in displayed floors; ${s.solids} solids, ${s.grids} nonphysical grid lines, ${s.missing} missing-geometry markers (count only; no volume guessed). ${s.findings.length} coordination findings across all floors (including the engineering caveat). ${STRUCTURE_CAVEAT}`;
        }
        if (content.plumbing) {
          const p = content.plumbing;
          const schedule = p.schedule.map(e => e.kind === 'fixture' ?
            `${e.floorId}/${e.id}: width ${e.widthM ?? 'unknown'}, depth ${e.depthM ?? 'unknown'}, height ${e.heightM ?? 'unknown'} m` :
            `${e.floorId}/${e.id}: diameter ${e.diameterMm ?? 'unknown'} mm`).join('\n');
          ui['services-schedule'].textContent = schedule || 'No supplied plumbing records.';
          ui['services-note'].textContent = `Plumbing intent: ${p.shown} of ${p.total} records; ${p.routes} routes, ${p.segments} known consecutive centerline segments, ${p.gaps} unknown segment gaps, ${p.points} node points, ${p.solids} explicit fixture boxes, ${p.missing} missing-geometry markers (count only; inspect in 2D). ${
            ui.active.checked ? `Active-floor scope includes owned or endpoint-touching routes in full, including ${p.foreignRoutes} foreign-floor spans/routes and ${p.foreignNodes} foreign endpoint nodes; fixtures are active-floor only. Other routes and nodes are omitted, not absent.` :
              'All registered floors included.'} ${p.findings.length} findings across all floors (not just this subset). ${PLUMBING_CAVEAT} Supplied dimensions and identifiers are available below the preview.`;
        }
        ui['services-details'].hidden = !content.plumbing;
        ui['drainage-details'].hidden = !content.drainage;
        if (content.drainage) {
          const d = content.drainage;
          ui['drainage-note'].textContent = `Drainage intent: ${d.shown} of ${d.total} records; ${d.segments} known consecutive centerline segments, ${d.gaps} unknown segment gaps, ${d.points} node points, ${d.missing} missing-geometry records. ${
            ui.active.checked ? `${d.foreignRoutes} foreign-floor routes and ${d.foreignNodes} foreign endpoint nodes included in full; unrelated networks omitted. ` : ''}${
            content.plumbing ? 'Shared sanitary geometry is drawn once with plumbing. ' : ''}Drainage engineering is not assessed. Exact metadata and coordination findings are collapsed below the canvas.`;
          ui['drainage-schedule'].textContent = d.schedule.map(e => JSON.stringify(e)).join('\n') ||
            'No drainage records in this scope. This does not establish a complete or assessed design.';
        } else ui['drainage-schedule'].textContent = '';
        ui['intent-findings-list'].textContent = [
          ...content.warnings.map(text => `Model: ${text}`),
          ...['structural', 'plumbing', 'drainage'].flatMap(domain =>
            (content[domain]?.findings || []).map(f => `${domain}: ${JSON.stringify(f)}`))
        ].join('\n') || 'No listed findings; engineering remains not assessed.';
        const warnings = content.warnings.slice(0, 3).join(' ');
        ui.diagnostics.textContent = [
          content.floors.map(f => `${f.name}: elevation ${f.elevationM.toFixed(2)} m`).join(' · '),
          content.obstacleCount ? `${content.obstacleCount} supplied context solid(s); details and optical behavior are simplified.` :
            'No context geometry supplied: surrounding obstructions are unknown, not absent.',
          warnings, content.warnings.length > 3 ? `${content.warnings.length - 3} additional model warnings are available in the 2D inspector.` : ''
        ].filter(Boolean).join(' ');
        requestRender();
      } catch (error) { fail(`3D could not update: ${error.message} 2D is still available.`); }
    }
    function resetView() {
      const r = runtime;
      if (!r?.content) return;
      const sphere = r.content.bounds.getBoundingSphere(new r.THREE.Sphere());
      const aspect = Math.max(0.2, ui.viewport.clientWidth / Math.max(1, ui.viewport.clientHeight));
      const vertical = r.camera.fov * Math.PI / 180, horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
      const distance = Math.max(2, sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12);
      const direction = new r.THREE.Vector3(1, 0.85, 1).normalize();
      r.controls.target.copy(sphere.center);
      r.camera.position.copy(sphere.center).addScaledVector(direction, distance);
      r.camera.far = Math.max(100, distance * 6);
      r.camera.updateProjectionMatrix();
      r.controls.update();
      requestRender();
    }
    function zoom(factor) {
      const r = runtime;
      if (!r) return;
      const distance = r.camera.position.distanceTo(r.controls.target);
      const wanted = clamp(distance * factor, r.controls.minDistance, r.controls.maxDistance);
      r.camera.position.sub(r.controls.target).multiplyScalar(wanted / Math.max(EPS, distance)).add(r.controls.target);
      r.controls.update();
      requestRender();
    }
    function close({ preserveMessage = false, focus = true } = {}) {
      ticket++;
      phase = 'closed';
      const r = runtime;
      runtime = null;
      if (r) {
        if (r.camera && r.controls) savedCamera = {
          position: r.camera.position.toArray(), target: r.controls.target.toArray()
        };
        if (r.frame !== null) window.cancelAnimationFrame(r.frame);
        r.cleanup.forEach(fn => fn());
        r.controls?.dispose();
        if (r.world) disposeObject(r.world);
        r.renderer?.dispose();
        if (r.renderer) r.renderer.forceContextLoss();
        else r.context?.getExtension('WEBGL_lose_context')?.loseContext();
        r.canvas.remove();
      }
      ui.workspace.hidden = true;
      ui.close.hidden = true;
      ui.open.hidden = false;
      ui.open.disabled = false;
      ui.open.textContent = 'Open 3D';
      ui.open.setAttribute('aria-expanded', 'false');
      host.removeAttribute('aria-busy');
      ui['structure-off'].hidden = !ui.structure.checked;
      if (ui.structure.checked) ui['structure-note'].textContent = `Structural intent is not displayed. ${STRUCTURE_CAVEAT}`;
      ui['services-off'].hidden = !ui.services.checked;
      if (ui.services.checked) ui['services-note'].textContent = `Plumbing intent is not displayed. ${PLUMBING_CAVEAT}`;
      ui['drainage-off'].hidden = !ui.drainage.checked;
      if (ui.drainage.checked) ui['drainage-note'].textContent = 'Drainage intent is not displayed. Drainage engineering is not assessed.';
      ui['drainage-schedule'].textContent = '';
      ui['drainage-details'].hidden = true;
      ui['lightStudy-off'].hidden = !ui.lightStudy.checked;
      lightDetails(null);
      if (ui.lightStudy.checked) ui['lightStudy-note'].textContent = 'Light study is not displayed. NOT LUX; no analysis runs in 3D.';
      ui['intent-findings-list'].textContent = '';
      if (!preserveMessage) message('3D is closed. Its GPU resources and view listeners have been released; the 2D plan is unchanged.');
      if (focus) ui.open.focus({ preventScroll: true });
    }
    function fail(text) {
      close({ preserveMessage: true, focus: false });
      message(text, true);
    }
    function pick(event) {
      const r = runtime;
      if (!r?.content) return;
      const rect = r.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const point = new r.THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2
      );
      r.world.updateMatrixWorld(true);
      r.camera.updateMatrixWorld(true);
      r.raycaster.setFromCamera(point, r.camera);
      const visible = object => {
        for (let node = object; node; node = node.parent) if (!node.visible) return false;
        return true;
      };
      const hit = r.raycaster.intersectObjects(r.content.pickables.filter(visible), false)[0];
      try { bridge().select(hit?.object.userData.entityRef || null); }
      catch (error) { message(`Selection could not be shared: ${error.message}`, true); }
    }
    async function open() {
      if (destroyed || phase !== 'closed') return;
      const current = ++ticket;
      phase = 'loading';
      ui['structure-off'].hidden = true;
      ui['services-off'].hidden = true;
      ui['drainage-off'].hidden = true;
      ui['lightStudy-off'].hidden = true;
      ui.open.disabled = true;
      ui.open.textContent = 'Loading 3D…';
      ui.close.hidden = false;
      host.setAttribute('aria-busy', 'true');
      message('Loading the local graphics modules. No project data is sent anywhere.');
      try {
        snapshot();
        const { THREE, OrbitControls } = await (options.loadEngine || loadEngine)();
        if (current !== ticket || destroyed) return;
        const canvas = document.createElement('canvas');
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Interactive 3D floor plan. Drag to orbit, arrow keys to pan, plus or minus to zoom, R to reset, Escape to close.');
        const r = runtime = {
          THREE, canvas, frame: null, cleanup: [], content: null, width: 0, height: 0
        };
        listen(canvas, 'webglcontextlost', event => {
          event.preventDefault();
          window.queueMicrotask(() => {
            if (runtime === r) fail('The browser lost its 3D graphics context. Close other GPU-heavy tabs, then choose Open 3D to retry. Your 2D plan and edits are unchanged.');
          });
        }, false, r.cleanup);
        r.context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' });
        if (!r.context) throw new Error('WebGL2 is unavailable or blocked. Enable hardware acceleration or try a WebGL2-capable browser/device. Continue planning in 2D.');
        r.renderer = new THREE.WebGLRenderer({ canvas, context: r.context, antialias: true });
        r.renderer.outputColorSpace = THREE.SRGBColorSpace;
        r.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        r.renderer.toneMappingExposure = 1;
        r.renderer.shadowMap.enabled = true;
        r.renderer.shadowMap.type = THREE.PCFShadowMap;
        r.world = new THREE.Scene();
        const theme = () => {
          const bg = window.getComputedStyle(host).getPropertyValue('--panel2').trim();
          r.world.background = new THREE.Color(bg || 0x1c2430);
          if (r.outline) {
            const accent = window.getComputedStyle(host).getPropertyValue('--acc').trim();
            r.outline.material.color.set(accent || 0x2f81f7);
          }
          requestRender();
        };
        r.camera = new THREE.PerspectiveCamera(42, 1, 0.03, 2000);
        r.camera.position.set(15, 20, 18);
        r.controls = new OrbitControls(r.camera, canvas);
        r.controls.enableDamping = false;
        r.controls.autoRotate = false;
        r.controls.minDistance = 0.25;
        r.controls.maxDistance = 2000;
        r.controls.maxPolarAngle = Math.PI / 2 - 0.025;
        r.controls.listenToKeyEvents(canvas);
        r.controls.addEventListener('change', requestRender);
        r.cleanup.push(() => r.controls.removeEventListener('change', requestRender));
        r.world.add(new THREE.HemisphereLight(0xe7efff, 0x77705c, 1.65));
        r.sun = new THREE.DirectionalLight(0xfff2da, 2.4);
        r.sun.shadow.mapSize.set(1024, 1024);
        r.world.add(r.sun, r.sun.target);
        r.outline = new THREE.Box3Helper(new THREE.Box3(), 0x2f81f7);
        r.outline.material.depthTest = false;
        r.outline.material.toneMapped = false;
        r.outline.renderOrder = 10;
        r.outline.visible = false;
        r.world.add(r.outline);
        r.raycaster = new THREE.Raycaster();
        let pointer = null;
        const down = new Set();
        listen(canvas, 'pointerdown', event => {
          down.add(event.pointerId);
          pointer = down.size === 1 && event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey ?
            { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
          canvas.focus({ preventScroll: true });
        }, false, r.cleanup);
        listen(canvas, 'pointermove', event => {
          if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.moved = true;
        }, false, r.cleanup);
        listen(canvas, 'pointerup', event => {
          if (pointer?.id === event.pointerId && !pointer.moved &&
            Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= 5) pick(event);
          down.delete(event.pointerId);
          pointer = null;
        }, false, r.cleanup);
        listen(canvas, 'pointercancel', event => { down.delete(event.pointerId); pointer = null; }, false, r.cleanup);
        listen(canvas, 'keydown', event => {
          if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (['+', '=', '-', '_', 'r', 'R', 'Escape'].includes(event.key)) event.preventDefault();
          if (event.key === '+' || event.key === '=') zoom(0.8);
          if (event.key === '-' || event.key === '_') zoom(1.25);
          if (event.key.toLowerCase() === 'r') resetView();
          if (event.key === 'Escape') close();
        }, false, r.cleanup);
        if (window.ResizeObserver) {
          const resize = new window.ResizeObserver(requestRender);
          resize.observe(ui.viewport);
          r.cleanup.push(() => resize.disconnect());
        }
        listen(window, 'resize', requestRender, false, r.cleanup);
        listen(document, 'visibilitychange', requestRender, false, r.cleanup);
        if (window.MutationObserver) {
          const observer = new window.MutationObserver(theme);
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
          r.cleanup.push(() => observer.disconnect());
        }
        r.cleanup.push(bridge().subscribe(event => {
          if (event.type === 'selection') selectionChanged(event.selection);
          else rebuild();
        }));
        ui.viewport.prepend(canvas);
        ui.workspace.hidden = false;
        ui.open.hidden = true;
        ui.open.setAttribute('aria-expanded', 'true');
        host.removeAttribute('aria-busy');
        phase = 'open';
        theme();
        rebuild();
        if (runtime !== r) return;
        if (savedCamera) {
          r.camera.position.fromArray(savedCamera.position);
          r.controls.target.fromArray(savedCamera.target);
          r.camera.far = Math.max(r.camera.far, r.camera.position.distanceTo(r.controls.target) * 5);
          r.camera.updateProjectionMatrix();
          r.controls.update();
        } else resetView();
        canvas.focus({ preventScroll: true });
        requestRender();
      } catch (error) {
        if (current === ticket) fail(`Could not open 3D. ${error.message}`);
      }
    }
    listen(ui.open, 'click', open);
    listen(ui.close, 'click', () => close());
    for (const action of ['undo', 'redo']) listen(ui[action], 'click', () => modelAction(() => {
      const api = bridge();
      if (typeof api?.[action] !== 'function' || !api[action === 'undo' ? 'canUndo' : 'canRedo']?.())
        throw new Error(`No shared ${action} action is available.`);
      api[action]();
    }));
    listen(ui['edit-selection'], 'click', () => inspectorRequest('requestEditSelection'));
    listen(ui['add-door'], 'click', () => inspectorRequest('requestAddOpening', 'door'));
    listen(ui['add-window'], 'click', () => inspectorRequest('requestAddOpening', 'window'));
    listen(ui['edit-wall-span'], 'click', () => inspectorRequest('requestEditSelection', { section: 'wall-span' }));
    listen(ui['delete-selection'], 'click', () => inspectorRequest('requestDeleteSelection'));
    listen(ui['choose-floor'], 'click', () => inspectorRequest('requestChooseFloor'));
    listen(ui.active, 'change', rebuild);
    listen(document, 'homeplanner:light-result', event => {
      if (destroyed) return;
      // Events are notifications, never a replacement for the current 2D controller.
      lightInvalidated = event.detail?.stale === true || event.detail?.result == null;
      refreshLight();
    });
    listen(ui.lightStudy, 'change', () => {
      lightDetails(null);
      rebuild();
    });
    listen(ui['lightStudy-off'], 'click', () => {
      ui.lightStudy.checked = false;
      ui['lightStudy-off'].hidden = true;
      lightDetails(null);
      message('Light study is off. Open 3D to inspect remaining layers. 2D is unchanged.');
    });
    listen(ui.structure, 'change', () => {
      ui['structure-note'].hidden = !ui.structure.checked;
      ui['structure-note'].textContent = ui.structure.checked ? STRUCTURE_CAVEAT : '';
      rebuild();
    });
    listen(ui['structure-off'], 'click', () => {
      ui.structure.checked = false;
      ui['structure-off'].hidden = ui['structure-note'].hidden = true;
      ui['structure-note'].textContent = '';
      message('Structural intent is off. Open 3D to inspect the remaining enabled layers; with all intent layers off the legacy schematic preview is used. 2D is unchanged.');
    });
    listen(ui.services, 'change', () => {
      ui['services-note'].hidden = !ui.services.checked;
      ui['services-note'].textContent = ui.services.checked ? PLUMBING_CAVEAT : '';
      rebuild();
    });
    listen(ui['services-off'], 'click', () => {
      ui.services.checked = false;
      ui['services-off'].hidden = ui['services-note'].hidden = true;
      ui['services-note'].textContent = '';
      message('Plumbing intent is off. Open 3D to inspect the remaining enabled layers; with all intent layers off the legacy schematic preview is used. 2D is unchanged.');
    });
    listen(ui.drainage, 'change', () => {
      ui['drainage-note'].hidden = !ui.drainage.checked;
      ui['drainage-note'].textContent = ui.drainage.checked ? 'Drainage engineering is not assessed. Refreshing intent…' : '';
      rebuild();
    });
    listen(ui['drainage-off'], 'click', () => {
      ui.drainage.checked = false;
      ui['drainage-off'].hidden = ui['drainage-note'].hidden = true;
      ui['drainage-note'].textContent = '';
      message('Drainage intent is off. Open 3D to inspect remaining enabled layers. 2D is unchanged.');
    });
    listen(ui.cutaway, 'change', () => {
      runtime?.content?.roofs.forEach(roof => { roof.visible = !ui.cutaway.checked; });
      requestRender();
    });
    listen(ui.reset, 'click', resetView);
    listen(ui.in, 'click', () => zoom(0.8));
    listen(ui.out, 'click', () => zoom(1.25));
    const controller = {
      open, close, resetView,
      get isOpen() { return phase === 'open'; },
      destroy() {
        destroyed = true;
        close({ focus: false });
        permanentListeners.forEach(fn => fn());
        mounts.delete(host);
        host.replaceChildren();
      }
    };
    mounts.set(host, controller);
    return controller;
  }

  return { THREE_VERSION, PREVIEW, toThree, wallGrid, wallSurfaceData, bedPillows, doorLeaf,
    buildContent, buildLight, currentLight, disposeObject, resolveSun, mount };
});
