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
  const mounts = new WeakMap();
  let enginePromise;
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const refKey = ref => ref ? `${ref.kind}\u0000${ref.id}` : '';
  const validRect = r => r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) &&
    r.w > EPS && r.h > EPS;

  function toThree(point, scene, up = 0) {
    const a = finite(scene.headingDeg) * Math.PI / 180;
    const dx = point.x - scene.floor.w / 2, dy = point.y - scene.floor.h / 2;
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

  function buildContent(THREE, scenes, project, model, options = {}) {
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
    const localBox = (owner, scene, rect, base, height, mat, ref, detail) => {
      if (!validRect(rect) || height <= EPS) return null;
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
      const plot = groundScene.floor;
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
          const type = String(room.type || '').toLowerCase();
          const color = /bath|toilet|utility/.test(type) ? 0xb4c7cc : /kitchen/.test(type) ? 0xcac6ad :
            /bed/.test(type) ? 0xc4c5d6 : 0xd4c6b2;
          localBox(owner, scene, room.rect, base, PREVIEW.finishM, material(color),
            { kind: 'room', id: room.id }, detail(room.label || 'Room'));
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
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      return { group, refs, pickables, roofs, bounds, floors, warnings: [...new Set(warnings)], obstacleCount: seenObstacles.size };
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
          <p>Inspect the shared plan in 3D. All storeys are stacked; editing stays in the 2D workspace.</p></div>
        <div class="hp3d-actions"><button type="button" data-hp3d="open" aria-expanded="false">Open 3D</button>
          <button type="button" data-hp3d="close" hidden>Close 3D</button></div>
      </div>
      <p class="hp3d-status" data-hp3d="status" role="status" aria-live="polite">3D is off. No graphics library or GPU context is loaded until you choose Open 3D.</p>
      <div data-hp3d="workspace" hidden>
        <div class="hp3d-toolbar" data-hp3d="toolbar">
          <label><input type="checkbox" data-hp3d="active"> Active floor only</label>
          <label><input type="checkbox" data-hp3d="cutaway" checked> Cutaway: hide roof / ceiling caps</label>
          <div class="hp3d-actions"><button type="button" data-hp3d="in" aria-label="Zoom in">Zoom +</button>
            <button type="button" data-hp3d="out" aria-label="Zoom out">Zoom −</button>
            <button type="button" data-hp3d="reset">Reset view</button></div>
        </div>
        <div class="hp3d-viewport" data-hp3d="viewport">
          <div class="hp3d-compass" aria-label="True north, oriented to the camera">
            <span class="hp3d-needle" data-hp3d="north" aria-hidden="true">N<br>↑</span><small>True north</small>
          </div>
        </div>
        <p class="hp3d-help">Drag to orbit · right-drag or Shift-drag to pan · wheel to zoom. Touch: one finger orbits; two pan/zoom.
          Focus the canvas: arrows pan, + / − zoom, R resets, Escape closes. Click an object to share its 2D selection.</p>
        <p class="hp3d-selection" data-hp3d="selection" role="status" aria-live="polite"></p>
        <p class="hp3d-light" data-hp3d="light"></p>
        <p class="hp3d-diagnostics" data-hp3d="diagnostics"></p>
      </div>
      <details class="hp3d-assumptions"><summary>Preview assumptions &amp; limitations</summary>
        <p>Wall heights, storey elevations and roof thickness use project inputs, which may be defaults rather than surveyed values.
          Slabs are assumed 0.14 m thick; furniture heights, door leaves, frames and glazing thickness are schematic.
          No stairs, structural members, terrain or construction assemblies are inferred.</p>
        <p>Cutaway hides only presentation caps; real walls, openings and operating inputs are unchanged. Lower floors may be
          obscured by upper slabs: choose Active floor only to inspect them. Glass remains a barrier; window and sliding-pane
          motion is unspecified, not an unobstructed airflow aperture.</p>
        <p>Only user-provided context boxes / tree ellipsoids appear. Tree porosity and optical transmission are not simulated.
          Sunlight and shadows are illustrative, not sun-hours, temperature, airflow, energy, structural or compliance results.</p>
      </details>`;
    const ui = {};
    host.querySelectorAll('[data-hp3d]').forEach(el => { ui[el.dataset.hp3d] = el; });
    let runtime = null, ticket = 0, phase = 'closed', savedCamera = null, destroyed = false;
    const bridge = () => suppliedBridge || root.HomePlanner;
    const model = () => suppliedModel || root.HomePlannerModel;
    const permanentListeners = [];
    const listen = (target, event, fn, settings, cleanup = permanentListeners) => {
      target.addEventListener(event, fn, settings);
      cleanup.push(() => target.removeEventListener(event, fn, settings));
    };
    const message = (text, error = false) => {
      ui.status.textContent = text;
      ui.status.classList.toggle('hp3d-error', error);
    };
    function snapshot() {
      const api = bridge();
      if (!api || !['getProject', 'getScene', 'getScenes', 'getSelection', 'select', 'subscribe'].every(k => typeof api[k] === 'function')) {
        throw new Error('The shared planner bridge is unavailable or lacks getScenes(). Keep planner-model.js and planner-bridge.js before planner-3d.js. The existing 2D planner remains available.');
      }
      const scenes = api.getScenes();
      if (!Array.isArray(scenes)) throw new Error('The shared planner did not provide its storey scenes.');
      return { project: api.getProject(), active: api.getScene(), scenes, selection: api.getSelection() };
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
      const r = runtime;
      if (!r?.content) return;
      const entry = r.content.refs.get(refKey(selection));
      r.outline.visible = !!entry;
      if (entry) {
        r.outline.box.makeEmpty();
        entry.objects.forEach(object => r.outline.box.expandByObject(object));
        const active = bridge().getScene();
        ui.selection.textContent = `${entry.label} · ${entry.floorName}. ${entry.note || ''}${entry.floorId !== active?.floorId ? ' Choose this floor in the 2D floor selector to edit it.' : ' Use the shared 2D inspector to edit.'}`;
      } else ui.selection.textContent = selection ?
        'The selected object is not in the displayed geometry. Choose its floor or turn off Active floor only.' :
        'No object selected. Click a room floor, wall, door, window or furniture solid.';
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
          activeOnly: ui.active.checked, cutaway: ui.cutaway.checked
        });
        if (r.content) {
          r.world.remove(r.content.group);
          disposeObject(r.content.group);
          r.renderer.renderLists.dispose();
        }
        r.content = content;
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
          if (event.ctrlKey || event.metaKey || event.altKey) return;
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
    listen(ui.active, 'change', rebuild);
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
    buildContent, disposeObject, resolveSun, mount };
});
