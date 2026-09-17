'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const View = require('../planner-3d.js'), Light = require('../planner-light.js');
const Model = require('../planner-model.js'), Projection = require('../planner-projection.js');
const Services = require('../planner-services.js'), Drainage = require('../planner-drainage.js');
const Structure = require('../planner-structure.js');
const Regions = require('../planner-regions.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function fixture() {
  const project = createFixture('multiple-floors').project;
  project.floors.forEach((f, i) => {
    f.legacy.context.plate.sitePlot = { x: -1 - 2 * i, y: -2 - i, w: 18, h: 18 };
    f.heightM = f.wallHeightM + project.building.roofThicknessM;
    f.authored = Model.emptyAuthored();
    f.authored.serviceNodes = [{
      id: `${f.id}:authored:soil`, system: 'waste', circuit: 'soil', kind: 'junction', role: null,
      anchor: { kind: 'point', floorId: f.id, point: { x: 2, y: 3, z: 1 } },
      diameterMm: null, invertM: null
    }];
  });
  project.floors[0].authored.serviceRoutes = [{
    id: 'ground:authored:drop', system: 'waste', circuit: 'soil',
    from: { floorId: 'upper', entityId: 'upper:authored:soil' },
    to: { floorId: 'ground', entityId: 'ground:authored:soil' }, via: [], diameterMm: null, slope: null
  }];
  project.floors[0].authored.structural = [{
    id: 'ground:authored:column', kind: 'column',
    anchors: [{ kind: 'point', floorId: 'ground', point: { x: 2, y: 3, z: 0 } }],
    widthM: .3, depthM: .4, heightM: 2, material: null, sizeSource: 'authored'
  }];
  const upper = project.floors[1].legacy.context;
  upper.g.W = upper.plate.width = 12;
  upper.g.D = upper.plate.depth = 10;
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project), drawing = planner.getDrawingScene();
  const inventory = Light.discover(drawing);
  const config = {
    version: 1, id: '3d-contract',
    workplanes: inventory.rooms.map((r, i) => ({ id: `plane-${i}`, room: r.ref, heightM: .8, spacingM: 3 })),
    sky: { enabled: true, radialBands: 2, azimuthSectors: 4 },
    minSunAltitudeDeg: 1, windowOptics: { mode: 'ideal-clear' },
    neighbors: Object.fromEntries(['front', 'right', 'rear', 'left'].map(s => [s, { state: 'clear' }])),
    neighborBoxes: [], roofContext: [],
    period: { startUTC: '2026-09-15T00:00:00Z', endUTC: '2026-09-15T02:00:00Z' },
    samples: [0, 1].map(i => ({
      startUTC: `2026-09-15T0${i}:00:00Z`, endUTC: `2026-09-15T0${i + 1}:00:00Z`,
      sampleUTC: `2026-09-15T0${i}:30:00Z`, sunENU: { east: 0, north: 0, up: i ? 1 : -1 }
    }))
  };
  const result = Light.run(drawing, config);
  return { planner, project: planner.getProject(), drawing, config, result };
}
const state = (result, visualization = {}) => ({ result,
  visualization: { metric: 'direct', intervalIndex: 0, modeled: false, showElectrical: false, ...visualization } });
const dataFor = (f, s = state(f.result)) => View.currentLight(f.drawing, f.project, s, Light);
const build = (THREE, f, s, extra = {}) => View.buildContent(THREE, f.drawing.scenes, f.project, Model,
  { lightStudy: true, lightData: dataFor(f, s), cutaway: true, ...extra });
const dispose = layer => layer.objects.forEach(View.disposeObject);

test('clipped 3D light cells use their exact areas and never cover reserved host floor', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const drawing = copy(f.drawing), room = drawing.scenes[0].rooms[0];
  const cut = { x: room.rect.x + room.rect.w / 4, y: room.rect.y + room.rect.h / 4, w: room.rect.w / 2, h: room.rect.h / 2 };
  room.usableRegions = Regions.subtractRectangle(room.rect, [cut]); room.reservedAreaM2 = cut.w * cut.h;
  const result = Light.run(drawing, f.config), data = View.currentLight(drawing, f.project, state(result), Light);
  assert.equal(data.result, result);
  const content = View.buildContent(THREE, drawing.scenes, f.project, Model, { lightStudy: true, lightData: data });
  try {
    for (const sensor of result.sensors.filter(sensor => sensor.room.entityId === room.id)) {
      assert.equal(Regions.intersection(sensor.cell, cut), null);
      const mesh = content.lightStudy.objects.find(object => object.userData.lightSensorId === sensor.id);
      assert.ok(mesh); near(mesh.geometry.parameters.width * mesh.geometry.parameters.height, sensor.areaWeightM2);
    }
    assert.ok(content.group.children.some(object => object.name === 'ground'));
  } finally { View.disposeObject(content.group); }
});

test('light-only discovery failure clears numerical light while valid architectural inspection remains available', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const drawing = copy(f.drawing);
  const unavailable = { discover() { throw new Error('Light inventory budget exceeded'); } };
  const data = View.currentLight(drawing, f.project, state(f.result), unavailable);
  assert.equal(data.result, null);
  assert.match(data.error, /Light inventory budget exceeded.*Architectural inspection remains available/);
  const content = View.buildContent(THREE, drawing.scenes, f.project, Model, { lightStudy: true, lightData: data });
  try {
    assert.equal(content.lightStudy.objects.length, 0);
    assert.match(content.lightStudy.label, /Light inventory budget exceeded/);
    assert.ok(content.group.children.some(object => object.name === 'ground'));
  } finally { View.disposeObject(content.group); }
});

test('real foundation fixture is complete and exact cells use registered unequal origins, heading and z once', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const f = fixture();
  assert.equal(f.result.status, 'complete', JSON.stringify(f.result.findings));
  assert.notEqual(f.drawing.scenes[0].sourcePlotOrigin.x, f.drawing.scenes[1].sourcePlotOrigin.x);
  assert.notEqual(f.drawing.scenes[0].floor.w, f.drawing.scenes[1].floor.w);
  const before = JSON.stringify(f.result);
  for (const headingDeg of [0, 37, 90, 180, 270]) {
    const drawing = copy(f.drawing);
    drawing.scenes.forEach(s => { s.headingDeg = headingDeg; });
    const result = Light.run(drawing, f.config), here = { ...f, drawing, result };
    const content = build(THREE, here);
    try {
      assert.equal(content.lightStudy.objects.length, result.sensors.length);
      for (const sensor of result.sensors) {
        const object = content.lightStudy.objects.find(o => o.userData.lightSensorId === sensor.id);
        const scene = drawing.scenes.find(s => s.floorId === sensor.room.floorId);
        const room = scene.rooms.find(r => r.id === sensor.room.entityId);
        const expected = p => {
          const v = Projection.siteToWorld({ x: p.x - scene.plot.w / 2, y: p.y - scene.plot.h / 2, z: p.z }, headingDeg);
          return [v.east, v.up, -v.north];
        };
        object.position.toArray().forEach((v, i) => near(v, expected(sensor.point)[i]));
        near(object.geometry.parameters.width, room.rect.w / sensor.grid.columns);
        near(object.geometry.parameters.height, room.rect.h / sensor.grid.rows);
        const corners = object.geometry.attributes.position;
        for (let i = 0; i < corners.count; i++) {
          const actual = object.localToWorld(new THREE.Vector3().fromBufferAttribute(corners, i));
          const p = { x: sensor.point.x + corners.getX(i), y: sensor.point.y - corners.getY(i), z: sensor.point.z };
          actual.toArray().forEach((v, n) => near(v, expected(p)[n]));
        }
        assert.equal(object.userData.value, 0, 'real night mask remains known zero');
        assert.equal(object.material.wireframe, false);
        assert.equal(object.material.depthWrite, false);
        assert.ok(object.material.isMeshBasicMaterial);
        assert.ok(!object.castShadow && !object.receiveShadow && !object.isLight);
        assert.ok(!content.pickables.includes(object) && !object.userData.entityRef);
        const ray = new THREE.Raycaster(object.position.clone().add(new THREE.Vector3(0, 20, 0)), new THREE.Vector3(0, -1, 0));
        assert.equal(ray.intersectObject(object).length, 0);
      }
      assert.ok(content.roofs.every(o => !o.visible));
      assert.ok(content.group.children.some(o => o.name === 'ground'));
    } finally { View.disposeObject(content.group); }
  }
  assert.equal(JSON.stringify(f.result), before);
});

test('all-floor physical provenance rejects replacement/clipping changes, null, stale, foreign and unfinished results', () => {
  const f = fixture();
  assert.equal(dataFor(f).result, f.result);
  for (const s of [state(null), { ...state(f.result), stale: true },
    ...['running', 'cancelled', 'blocked'].map(status => state({ ...f.result, status })),
    state({ ...f.result, provenance: { ...f.result.provenance, projectId: 'foreign' } }),
    state({ ...f.result, provenance: { ...f.result.provenance, scenePhysicalFingerprint: 'old' } })]) {
    assert.equal(dataFor(f, s).result, null);
  }
  for (const mutate of [
    d => { d.scenes[1].rooms[0].rect.x += .1; },
    d => { d.scenes[1].walls[0].solidSections = []; },
    d => { d.scenes[1].floorElevationM += .1; },
    d => { d.projectId = 'foreign'; }
  ]) {
    const drawing = copy(f.drawing); mutate(drawing);
    assert.equal(dataFor({ ...f, drawing }).result, null, 'same ID/revision must not substitute for actual content');
  }
  assert.throws(() => dataFor({ ...f, drawing: { ...f.drawing, scenes: f.drawing.scenes.slice(0, 1) } }), /all registered floors/);
});

test('real unknown-context masks, known night zero, sky and guarded hours never silently substitute modeled subtotals', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const config = copy(f.config); config.neighbors.front = { state: 'unknown' };
  f.result = Light.run(f.drawing, config);
  assert.equal(f.result.status, 'incomplete');
  for (const metric of ['direct', 'sky', 'presence-hours', 'equivalent-hours']) {
    const primary = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f, state(f.result, { metric, intervalIndex: 1 })));
    const modeled = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f, state(f.result, { metric, intervalIndex: 1, modeled: true })));
    try {
      assert.ok(primary.objects.length > 0);
      assert.ok(primary.objects.every(o => o.userData.value === null && o.material.wireframe && o.material.color.getHex() === 0x999999));
      assert.ok(modeled.objects.every(o => Number.isFinite(o.userData.value) && !o.material.wireframe));
      assert.ok(modeled.schedule.every(r => r.status === (metric.endsWith('hours') ? 'MODELED SUBTOTAL' : 'MODELED')));
      assert.ok(primary.averages.every(r => r.value === null));
      assert.ok(modeled.averages.every(r => Number.isFinite(r.value)));
    } finally { dispose(primary); dispose(modeled); }
  }
  const night = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f));
  assert.ok(night.objects.every(o => o.userData.value === 0 && o.material.color.getHex() !== 0x999999));
  dispose(night);
  const a = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f, state(f.result, { metric: 'sky', modeled: true })));
  const b = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f, state(f.result, { metric: 'sky', modeled: true, intervalIndex: 1 })));
  assert.deepEqual(a.schedule, b.schedule);
  dispose(a); dispose(b);
  const poisoned = copy(f.result);
  poisoned.direct.sensorResults.forEach(r => { r.positivePathPresenceHours = 100; });
  const guarded = View.buildLight(THREE, f.drawing.scenes, f.project, dataFor(f, state(poisoned, { metric: 'presence-hours' })));
  assert.ok(guarded.schedule.every(r => r.value === null));
  dispose(guarded);
});

test('real known open-roof upper workplane has positive primary sky/direct/hours and numerical midpoint averages', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  f.drawing = copy(f.drawing);
  const upper = f.drawing.scenes.find(s => s.floorId === 'upper');
  upper.roofThicknessM = null;
  upper.walls = []; upper.openings = []; upper.unresolvedOpenings = []; upper.diagnostics = [];
  f.config = copy(f.config);
  f.config.workplanes = f.config.workplanes.filter(w => w.room.floorId === 'upper');
  f.config.roofContext = [{ floorId: 'upper', state: 'none', source: 'Analytic open roof' }];
  f.result = Light.run(f.drawing, f.config);
  assert.equal(f.result.status, 'complete', JSON.stringify(f.result.findings));
  for (const metric of ['direct', 'sky', 'presence-hours', 'equivalent-hours']) {
    const content = build(THREE, f, state(f.result, { metric, intervalIndex: 1 }));
    try {
      assert.ok(content.lightStudy.schedule.every(r => r.value === 1 && r.status === 'known'));
      assert.ok(content.lightStudy.averages.every(r => Math.abs(r.value - 1) < 1e-10));
      assert.ok(content.lightStudy.objects.every(o => o.material.color.getHex() === 0xf0b43c));
      assert.ok(content.lightStudy.objects.every(o => o.material.transparent && o.material.opacity > .3));
    } finally { View.disposeObject(content.group); }
  }
});

test('active-floor sensors, explicit-only electrical xyz and layer union leave all-floor architecture and services intact', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  f.drawing = copy(f.drawing);
  f.drawing.scenes[0].electrical.push(
    { id: 'known', coordinateSpace: 'site-local', point: { x: 2, y: 3, z: 1.2 } },
    { id: 'unknown-z', coordinateSpace: 'site-local', point: { x: 2, y: 3, z: null } },
    { id: 'unprojected', point: { x: 2, y: 3, z: 1.2 }, heightM: 2.7 });
  f.result = Light.run(f.drawing, f.config);
  const plumbing = Services.build(f.drawing, { systems: ['water', 'waste'] });
  const drainage = Drainage.build(f.drawing, { systems: ['waste', 'rain'] });
  const structure = Structure.build(f.drawing);
  const extra = { structuralIntent: true, structure, plumbingIntent: true, services: plumbing, drainageIntent: true, drainage };
  const base = View.buildContent(THREE, f.drawing.scenes, f.project, Model, extra);
  const both = build(THREE, f, state(f.result, { showElectrical: true }), { ...extra, cutaway: false });
  const active = build(THREE, f, state(f.result, { showElectrical: true }), { activeOnly: true });
  try {
    assert.deepEqual(both.floors, base.floors);
    assert.equal(both.pickables.length, base.pickables.length);
    assert.equal(both.obstacleCount, base.obstacleCount);
    for (const domain of ['structural', 'plumbing', 'drainage']) assert.equal(both[domain].objects.length, base[domain].objects.length);
    assert.equal(both.structural.objects.length, 1);
    assert.equal(both.plumbing.objects.length, 3);
    assert.equal(both.drainage.objects.length, 3);
    for (const o of both.drainage.objects) assert.ok(both.plumbing.objects.includes(o), 'shared sanitary geometry is the same object, not a duplicate');
    for (const [key, entry] of base.refs) {
      const after = both.refs.get(key);
      assert.equal(after.objects.length, entry.objects.length);
      entry.objects.forEach((object, i) => {
        const other = after.objects[i];
        assert.deepEqual(other.position.toArray(), object.position.toArray());
        assert.deepEqual(other.geometry.attributes.position.array, object.geometry.attributes.position.array,
          'closed architectural walls and exact opening cuts do not change when light is enabled');
      });
    }
    assert.ok(active.lightStudy.objects.every(o => o.userData.floorId === f.project.activeFloorId));
    assert.equal(active.lightStudy.objects.filter(o => o.userData.lightSensorId).length,
      f.result.sensors.filter(s => s.room.floorId === f.project.activeFloorId).length);
    const electric = both.lightStudy.objects.filter(o => o.userData.lightElectricalId);
    assert.equal(electric.length, 1); assert.ok(electric[0].isPoints);
    near(electric[0].geometry.attributes.position.getY(0), 1.2);
    assert.ok(both.lightStudy.schedule.some(r => r.electrical?.record.id === 'unknown-z' && r.geometryStatus.includes('unavailable')));
    assert.ok(both.lightStudy.schedule.some(r => r.electrical?.record.id === 'unprojected' && r.geometryStatus.includes('unavailable')));
    assert.ok(!base.lightStudy);
  } finally { [base, both, active].forEach(c => View.disposeObject(c.group)); }
});

function harness() {
  let document, sequence = 0, snapshot = null;
  const frames = new Map(), nodes = {};
  class Element {
    constructor() {
      this.ownerDocument = document; this.children = []; this.listeners = new Map();
      this.dataset = {}; this.style = {}; this.checked = false; this.attributes = {};
      this.clientWidth = 800; this.clientHeight = 600; this.classList = { add() {}, toggle() {} };
    }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<[^>]+data-hp3d="([^"]+)"[^>]*>/g)) {
        const el = new Element(); el.dataset.hp3d = match[1];
        el.checked = /\schecked(?:\s|>)/.test(match[0]); el.hidden = /\shidden(?:\s|>)/.test(match[0]);
        nodes[match[1]] = el;
      }
    }
    querySelectorAll() { return Object.values(nodes); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    async dispatch(type, extra = {}) { for (const fn of this.listeners.get(type) || []) await fn({ preventDefault() {}, ...extra }); }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    prepend(el) { el.parent = this; this.children.unshift(el); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    replaceChildren() { this.children = []; }
    focus() {}
    getContext() { return { getExtension() { return null; } }; }
  }
  const window = new Element();
  Object.assign(window, {
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); }, queueMicrotask,
    getComputedStyle() { return { getPropertyValue() { return ''; } }; }
  });
  document = new Element(); document.defaultView = window;
  document.createElement = () => new Element();
  document.getElementById = id => id === 'workspaceLightStudy' ? { homePlannerLight: { getState: () => snapshot } } : null;
  return { host: new Element(), document, nodes, frames,
    setState(value) { snapshot = value; },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } };
}
async function engineHarness() {
  const THREE = await import('../vendor/three/three.module.min.js'), renderers = [], controls = [];
  class Renderer {
    constructor() { renderers.push(this); this.shadowMap = {}; this.renderLists = { dispose() {} }; }
    setPixelRatio() {} setSize() {}
    render(world, camera) { this.world = world; this.camera = camera; }
    dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  class Controls extends THREE.EventDispatcher {
    constructor() { super(); this.target = new THREE.Vector3(); controls.push(this); }
    listenToKeyEvents() {} update() {} dispose() { this.disposed = true; }
  }
  return { engine: { THREE: { ...THREE, WebGLRenderer: Renderer }, OrbitControls: Controls }, renderers, controls };
}
function objects(renderer) {
  const result = [];
  renderer.world.traverse(o => { if (o.userData.lightSensorId || o.userData.lightElectricalId) result.push(o); });
  return result;
}
function watch(objects) {
  const resources = new Map();
  objects.forEach(o => [o.geometry, o.material].forEach(r => {
    if (!resources.has(r)) { resources.set(r, 0); r.addEventListener('dispose', () => resources.set(r, resources.get(r) + 1)); }
  }));
  assert.ok(resources.size);
  return () => resources.forEach(count => assert.equal(count, 1));
}

test('mounted default off, notification/current controller boundary, date changes and invalidation retain camera/panels without analysis or ghost cells', async () => {
  const f = fixture(), dom = harness(), engine = await engineHarness();
  let discovery = 0, analysis = 0, notify, drawing = f.drawing;
  const foundation = { discover(d) { discovery++; return Light.discover(d); },
    run() { analysis++; throw Error('analysis forbidden'); }, createStudy() { analysis++; throw Error('analysis forbidden'); } };
  const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => drawing,
    subscribe(fn) { notify = fn; return () => { notify = null; }; } }, Model,
  { lightModel: foundation, loadEngine: async () => engine.engine });
  try {
    assert.equal(dom.nodes.lightStudy.checked, false); assert.equal(discovery, 0);
    await ui.open(); dom.flush(); assert.equal(discovery, 0);
    const renderer = engine.renderers[0], camera = renderer.camera.position.toArray();
    dom.setState(state(f.result));
    dom.nodes.lightStudy.checked = true; await dom.nodes.lightStudy.dispatch('change'); dom.flush();
    assert.ok(objects(renderer).length);
    assert.match(dom.nodes['lightStudy-note'].textContent, /direct.*UTC.*dimensionless.*NOT LUX/);
    assert.ok(dom.host.html.indexOf('data-hp3d="lightStudy-details"') > dom.host.html.indexOf('data-hp3d="viewport"'));
    assert.match(dom.host.html, /<details[^>]+data-hp3d="lightStudy-details" hidden>/);
    dom.nodes['lightStudy-details'].open = true;
    const architectural = renderer.world.children.find(o => o.type === 'Group');
    const sun = renderer.world.children.find(o => o.isDirectionalLight);
    const illumination = [sun.intensity, sun.position.toArray(), sun.target.position.toArray(), sun.color.getHex()];
    let disposed = watch(objects(renderer));
    dom.setState(state(f.result, { intervalIndex: 1 }));
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush();
    disposed();
    assert.match(dom.nodes['lightStudy-note'].textContent, /01:30/);
    assert.equal(renderer.world.children.find(o => o.type === 'Group'), architectural);
    assert.deepEqual([sun.intensity, sun.position.toArray(), sun.target.position.toArray(), sun.color.getHex()], illumination);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    assert.equal(dom.nodes['lightStudy-details'].open, true);
    assert.equal(engine.controls[0].disposed, undefined);
    const tomorrow = copy(f.config);
    tomorrow.period = Object.fromEntries(Object.entries(tomorrow.period).map(([k, v]) => [k, v.replace('09-15', '09-16')]));
    tomorrow.samples = tomorrow.samples.map(s => ({ ...s,
      startUTC: s.startUTC.replace('09-15', '09-16'), endUTC: s.endUTC.replace('09-15', '09-16'),
      sampleUTC: s.sampleUTC.replace('09-15', '09-16') }));
    const nextResult = Light.run(f.drawing, tomorrow);
    disposed = watch(objects(renderer));
    dom.setState(state(nextResult));
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush(); disposed();
    assert.match(dom.nodes['lightStudy-note'].textContent, /2026-09-16/);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    dom.setState(state(f.result));
    for (const detail of [{ ...state(f.result), stale: true }, state(null)]) {
      disposed = watch(objects(renderer));
      await dom.document.dispatch('homeplanner:light-result', { detail }); dom.flush(); disposed();
      assert.equal(objects(renderer).length, 0, 'null/stale clears even before controller catches up');
      assert.match(dom.nodes['lightStudy-note'].textContent, /unavailable/);
      await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush();
      assert.ok(objects(renderer).length);
    }
    dom.setState(state(null));
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush();
    assert.equal(objects(renderer).length, 0, 'event cannot resurrect a result missing from the current controller');
    dom.setState(state(f.result));
    drawing = copy(f.drawing); drawing.scenes[1].walls[0].solidSections = [];
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush();
    assert.equal(objects(renderer).length, 0, 'actual all-floor fingerprint overrides equal IDs and revision');
    drawing = f.drawing;
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) }); dom.flush();
    for (let i = 0; i < 2; i++) {
      disposed = watch(objects(renderer));
      dom.nodes.lightStudy.checked = false; await dom.nodes.lightStudy.dispatch('change'); dom.flush(); disposed();
      assert.equal(objects(renderer).length, 0);
      dom.nodes.lightStudy.checked = true; await dom.nodes.lightStudy.dispatch('change'); dom.flush();
      assert.deepEqual(renderer.camera.position.toArray(), camera);
    }
    disposed = watch(objects(renderer)); ui.close(); disposed();
    assert.equal(notify, null); assert.equal(dom.frames.size, 0);
    assert.ok(renderer.disposed && renderer.lost);
    ui.destroy();
    assert.equal(dom.document.listeners.get('homeplanner:light-result').size, 0);
    const before = discovery;
    await dom.document.dispatch('homeplanner:light-result', { detail: state(f.result) });
    assert.equal(discovery, before); assert.equal(analysis, 0);
  } finally { ui.destroy(); }
});

test('missing foundation has recover-to-off path and legacy remains usable; current-null needs no Worker', async () => {
  const f = fixture(), dom = harness(), engine = await engineHarness();
  let loads = 0;
  const ui = View.mount(dom.host, f.planner, Model, { lightModel: {},
    loadEngine: async () => { loads++; return engine.engine; } });
  try {
    dom.nodes.lightStudy.checked = true;
    await ui.open();
    assert.equal(loads, 0); assert.equal(ui.isOpen, false);
    assert.match(dom.nodes.status.textContent, /Load planner-light.js/);
    assert.equal(dom.nodes['lightStudy-off'].hidden, false);
    await dom.nodes['lightStudy-off'].dispatch('click');
    assert.equal(dom.nodes.lightStudy.checked, false);
    await ui.open(); dom.flush(); assert.equal(ui.isOpen, true);
  } finally { ui.destroy(); }
  const other = harness();
  const view = View.mount(other.host, f.planner, Model, { lightModel: Light, loadEngine: async () => engine.engine });
  try {
    other.nodes.lightStudy.checked = true;
    await view.open(); other.flush();
    assert.equal(view.isOpen, true);
    assert.equal(objects(engine.renderers.at(-1)).length, 0);
    assert.match(other.nodes['lightStudy-note'].textContent, /unavailable/);
  } finally { view.destroy(); }
});
