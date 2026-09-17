const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../planner-3d.js');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Services = require('../planner-services.js');
const Structure = require('../planner-structure.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
const id = (floor, name) => `${floor}:authored:${name}`;
const ref = (floor, name) => ({ floorId: floor, entityId: id(floor, name) });
const at = (floor, x = 2, y = 3, z = 1) => ({ kind: 'point', floorId: floor, point: { x, y, z } });
const node = (floor, name, system = 'water', circuit = 'cold') => ({
  id: id(floor, name), system, circuit, kind: 'junction', role: null,
  anchor: at(floor), diameterMm: null, invertM: null
});
const route = (floor, name, from, to, system = 'water', circuit = 'cold') => ({
  id: id(floor, name), system, circuit, from, to, via: [], diameterMm: null, slope: null
});
function fixture() {
  const project = createFixture('multiple-floors').project;
  project.floors.forEach((floor, i) => {
    floor.legacy.context.plate.sitePlot = { x: -1 - i * 2, y: -2 - i * 2, w: 16, h: 16 };
    floor.authored = Model.emptyAuthored();
  });
  const upper = project.floors[1].legacy.context;
  upper.g.W = upper.plate.width = 12;
  upper.g.D = upper.plate.depth = 10;
  const ground = project.floors[0].authored, up = project.floors[1].authored;
  ground.structural = [{ id: id('ground', 'column'), kind: 'column', anchors: [at('ground')],
    widthM: .4, depthM: .6, heightM: 3, material: null, sizeSource: 'authored' }];
  ground.fixtures = [
    { id: id('ground', 'basin'), kind: 'basin', anchor: at('ground', 4, 5, .2), widthM: .6, depthM: .4, heightM: .85 },
    { id: id('ground', 'unknown-fixture'), kind: 'toilet', anchor: at('ground'), widthM: .7, depthM: .5, heightM: null }
  ];
  up.fixtures = [{ id: id('upper', 'basin'), kind: 'basin', anchor: at('upper', 1, 2, .3),
    widthM: .5, depthM: .3, heightM: .7 }];
  ground.serviceNodes = [
    { ...node('ground', 'source'), kind: 'supply', diameterMm: 20.25 },
    { ...node('ground', 'unknown-level'), anchor: null },
    node('ground', 'outlet', 'waste', 'soil')
  ];
  up.serviceNodes = [
    { ...node('upper', 'port'), kind: 'fixture', role: 'port', anchor: {
      kind: 'entity', entityKind: 'fixture', ...ref('upper', 'basin')
    } },
    { ...node('upper', 'waste', 'waste', 'soil'), anchor: at('upper', 6, 7, 1.1) },
    { ...node('upper', 'unrelated', 'water', 'hot'), anchor: at('upper', 9, 8, 2) },
    node('upper', 'rain', 'rain', 'storm')
  ];
  ground.serviceRoutes = [
    { ...route('ground', 'riser', ref('ground', 'source'), ref('upper', 'port')),
      via: [at('ground', 5, 6, 1), at('upper', 5, 6, 1)], diameterMm: 25.125 },
    { ...route('ground', 'gapped', ref('ground', 'source'), ref('upper', 'port')),
      via: [at('ground', 4, 4, 1), null, at('upper', 4, 4, 1)] }
  ];
  up.serviceRoutes = [
    { ...route('upper', 'waste-drop', ref('upper', 'waste'), ref('ground', 'outlet'), 'waste', 'soil'),
      diameterMm: 110 },
    route('upper', 'unrelated-run', ref('upper', 'port'), ref('upper', 'unrelated'), 'water', 'hot')
  ];
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project), drawing = planner.getDrawingScene();
  return { planner, project: planner.getProject(), drawing, services: Services.build(drawing, { systems: ['water', 'waste'] }),
    structure: Structure.build(drawing) };
}
function build(THREE, f, options = {}) {
  return View.buildContent(THREE, f.drawing.scenes, f.project, Model,
    { plumbingIntent: true, services: f.services, cutaway: true, ...options });
}
function signature(content) {
  const result = [];
  content.group.traverse(o => result.push([o.type, o.position.toArray(), o.rotation.toArray(),
    o.geometry?.parameters, o.geometry?.attributes.position && Array.from(o.geometry.attributes.position.array)]));
  return result;
}
function assertPosition(attribute, index, point) {
  close(attribute.getX(index), point.x); close(attribute.getY(index), point.y); close(attribute.getZ(index), point.z);
}

test('real Three routes, node points, fixture boxes and architectural base share the exact registered site frame at all headings', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const before = JSON.stringify([f.project, f.drawing, f.services]);
  assert.notEqual(f.drawing.scenes[0].floor.w, f.drawing.scenes[1].floor.w);
  assert.notEqual(f.drawing.scenes[0].sourcePlotOrigin.x, f.drawing.scenes[1].sourcePlotOrigin.x);
  for (const headingDeg of [0, 45, 90, 135, 180, 225, 270, 315, 37]) {
    const scenes = f.drawing.scenes.map(s => ({ ...s, headingDeg }));
    const content = build(THREE, { ...f, drawing: { ...f.drawing, scenes } });
    const world = p => {
      const v = Projection.siteToWorld({ x: p.x - 8, y: p.y - 8, z: p.z }, headingDeg);
      return { x: v.east, y: v.up, z: -v.north };
    };
    try {
      assert.equal(content.structural, undefined, 'Coordination must not promote structural records to visible solids');
      assert.ok(!content.group.children.some(o => o.userData.structuralId));
      for (const object of content.plumbing.objects) {
        const kind = object.userData.plumbingKind, objectId = object.userData.plumbingId;
        if (kind === 'route') {
          const r = f.services.routes.find(r => r.id === objectId);
          const expected = [];
          for (let i = 1; i < r.points.length; i++) {
            if (r.points[i - 1] && r.points[i]) expected.push(r.points[i - 1], r.points[i]);
          }
          assert.ok(object.isLineSegments);
          assert.equal(object.geometry.attributes.position.count, expected.length);
          expected.forEach((p, i) => assertPosition(object.geometry.attributes.position, i, world(p)));
          assert.equal(object.material.linewidth, 1);
          assert.equal(object.userData.diameterMm, r.diameterMm);
        } else if (kind === 'node') {
          const n = f.services.nodes.find(n => n.id === objectId);
          assert.ok(object.isPoints);
          assertPosition(object.geometry.attributes.position, 0, world(n.anchor));
          assert.equal(object.material.sizeAttenuation, false);
          assert.equal(object.userData.role, n.role);
        } else {
          const fxt = f.services.fixtures.find(f => f.id === objectId);
          const g = object.geometry.parameters;
          assert.deepEqual([g.width, g.height, g.depth], [fxt.widthM, fxt.heightM, fxt.depthM]);
          const bottomCenter = object.localToWorld(new THREE.Vector3(0, -fxt.heightM / 2, 0));
          const expected = world(fxt.anchor);
          close(bottomCenter.x, expected.x); close(bottomCenter.y, expected.y); close(bottomCenter.z, expected.z);
          const corner = object.localToWorld(new THREE.Vector3(-fxt.widthM / 2, -fxt.heightM / 2, -fxt.depthM / 2));
          const expectedCorner = world({ x: fxt.anchor.x - fxt.widthM / 2, y: fxt.anchor.y - fxt.depthM / 2, z: fxt.anchor.z });
          close(corner.x, expectedCorner.x); close(corner.y, expectedCorner.y); close(corner.z, expectedCorner.z);
        }
      }
      for (const scene of scenes) {
        const room = scene.rooms[0], mesh = content.refs.get(`room\0${room.id}`).objects[0];
        const expected = world({ x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2, z: scene.floorElevationM + .01 });
        close(mesh.position.x, expected.x); close(mesh.position.y, expected.y); close(mesh.position.z, expected.z);
        const slab = content.group.children.find(o => o.name === scene.floorId).children[0];
        const footprint = scene.building || scene.floor;
        const slabCenter = world({ x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2,
          z: scene.floorElevationM - View.PREVIEW.slabM / 2 });
        close(slab.position.x, slabCenter.x); close(slab.position.y, slabCenter.y); close(slab.position.z, slabCenter.z);
      }
    } finally { View.disposeObject(content.group); }
  }
  assert.equal(JSON.stringify([f.project, f.drawing, f.services]), before);
});

test('ordered null gaps never join; unknown sizes and levels invent no volumes, diameter schedule is exact, findings retained', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture(), content = build(THREE, f);
  try {
    const p = content.plumbing;
    assert.deepEqual([p.total, p.shown, p.routes, p.nodes, p.fixtures, p.segments, p.gaps, p.points, p.solids, p.missing],
      [13, 13, 4, 6, 3, 7, 2, 5, 2, 2]);
    assert.equal(p.findings, f.services.findings);
    assert.ok(p.findings.some(f => f.code === 'engineering-not-assessed'));
    assert.ok(p.findings.some(f => f.code === 'coordination-incomplete'));
    assert.ok(!p.objects.some(o => /unknown-fixture|unknown-level|rain/.test(o.userData.plumbingId)));
    const gapped = p.objects.find(o => o.userData.plumbingId === id('ground', 'gapped'));
    assert.equal(gapped.geometry.attributes.position.count, 4, 'two disjoint pairs, not a connected polyline');
    assert.deepEqual(p.schedule.filter(e => e.kind === 'route').map(e => e.diameterMm), [25.125, null, 110, null]);
    assert.ok(p.objects.filter(o => o.userData.plumbingKind === 'route').every(o => !o.isMesh));
    assert.ok(p.objects.every(o => !o.castShadow && !o.receiveShadow && !o.userData.entityRef && !content.pickables.includes(o)));
    const fixtureBox = p.objects.find(o => o.isMesh);
    const ray = new THREE.Raycaster(fixtureBox.position.clone().add(new THREE.Vector3(0, 20, 0)), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObjects(p.objects, false).length, 0, 'even explicit raycasts cannot pick or be blocked by the overlay');
    assert.ok(ray.intersectObjects(content.pickables, false).length > 0, 'architecture underneath remains raycastable');
    assert.ok(![...content.refs.values()].some(r => ['serviceNode', 'serviceRoute', 'fixture'].includes(r.ref.kind)));
    const source = p.objects.find(o => o.userData.plumbingId === id('ground', 'source'));
    assert.equal(source.userData.role, null, 'unknown purpose is not a default valve');
    assert.equal(source.material.color.getHex(), 0x368cdb);
    assert.ok(p.objects.every(o => o.visible), 'cutaway hides only architectural caps');
    assert.ok(content.roofs.every(o => !o.visible));
  } finally { View.disposeObject(content.group); }
});

test('active-only includes owned and endpoint-touching routes, entire foreign spans and endpoint nodes, not unrelated network', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  for (const activeFloorId of ['ground', 'upper']) {
    const content = build(THREE, { ...f, project: { ...f.project, activeFloorId } }, { activeOnly: true });
    try {
      const p = content.plumbing;
      assert.equal(p.routes, activeFloorId === 'ground' ? 3 : 4);
      assert.equal(p.foreignRoutes, 3);
      assert.equal(p.foreignNodes, 2);
      assert.equal(p.fixtures, activeFloorId === 'ground' ? 2 : 1);
      assert.equal(p.findings, f.services.findings, 'findings remain global, not a subset clearance pass');
      const riser = p.objects.find(o => o.userData.plumbingId === id('ground', 'riser'));
      const points = f.services.routes.find(r => r.id === id('ground', 'riser')).points;
      assert.equal(riser.geometry.attributes.position.count, 6, 'the full route is retained regardless of owner');
      assertPosition(riser.geometry.attributes.position, 5, View.toThree(points.at(-1), f.drawing.scenes[0], points.at(-1).z));
      assert.equal(p.objects.some(o => o.userData.plumbingId === id('upper', 'unrelated-run')), activeFloorId === 'upper');
    } finally { View.disposeObject(content.group); }
  }
});

test('both layers remain independent; both off preserves legacy byte-equivalent geometry despite supplied intent results', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const legacy = f.planner.getScenes();
  const plain = View.buildContent(THREE, legacy, f.project, Model);
  const ignored = View.buildContent(THREE, legacy, f.project, Model, { services: f.services, structure: f.structure });
  const both = build(THREE, f, { structuralIntent: true, structure: f.structure });
  try {
    assert.equal(plain.plumbing, undefined); assert.equal(ignored.plumbing, undefined);
    assert.equal(ignored.structural, undefined);
    assert.deepEqual(signature(plain), signature(ignored));
    assert.equal(both.structural.solids, 1);
    assert.equal(both.plumbing.segments, 7);
    assert.equal(both.plumbing.solids, 2);
    assert.ok(both.structural.objects.every(o => !both.plumbing.objects.includes(o)));
  } finally { [plain, ignored, both].forEach(c => View.disposeObject(c.group)); }
});

test('plumbing-only rejects incomplete or incompatible registrations even when active-only and rejects missing services', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture(), scenes = f.drawing.scenes;
  for (const invalid of [
    scenes.slice(0, 1), [scenes[0], scenes[0]],
    [scenes[0], { ...scenes[1], coordinateSpace: 'floor-local' }],
    [scenes[0], { ...scenes[1], headingDeg: 23 }],
    [scenes[0], { ...scenes[1], plot: { ...scenes[1].plot, w: 17 } }]
  ]) assert.throws(() => build(THREE, { ...f, drawing: { ...f.drawing, scenes: invalid } }, { activeOnly: true }), /exactly all registered floors/);
  assert.throws(() => build(THREE, f, { services: undefined }), /Plumbing services output is unavailable/);
});

function domHarness() {
  let document, sequence = 0;
  const frames = new Map(), nodes = {}, contexts = [];
  class Element {
    constructor(tag) {
      this.tag = tag; this.ownerDocument = document; this.children = []; this.listeners = new Map();
      this.dataset = {}; this.style = {}; this.attributes = {}; this.checked = false;
      this.clientWidth = 800; this.clientHeight = 600; this.classList = { add() {}, toggle() {} };
    }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<[^>]+data-hp3d="([^"]+)"[^>]*>/g)) {
        const el = new Element('element'); el.dataset.hp3d = match[1];
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
    getContext() { contexts.push(this); return { getExtension() { return null; } }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  }
  const window = new Element('window');
  Object.assign(window, {
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); }, queueMicrotask,
    getComputedStyle() { return { getPropertyValue() { return ''; } }; }
  });
  document = new Element('document'); document.defaultView = window;
  document.createElement = tag => new Element(tag);
  const host = new Element('host');
  return { host, nodes, contexts, frames, flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } };
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
    constructor(camera) { super(); this.target = new THREE.Vector3(); this.camera = camera; controls.push(this); }
    listenToKeyEvents() {} update() {} dispose() { this.disposed = true; }
  }
  return { engine: { THREE: { ...THREE, WebGLRenderer: Renderer }, OrbitControls: Controls }, renderers, controls };
}
function watchDisposal(objects) {
  const resources = new Map();
  for (const object of objects) {
    for (const resource of [object.geometry, ...[object.material].flat()].filter(Boolean)) {
      if (resources.has(resource)) continue;
      resources.set(resource, 0);
      resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
    }
  }
  assert.ok(resources.size > 0);
  return () => { for (const count of resources.values()) assert.equal(count, 1, 'each geometry/material disposed exactly once'); };
}
function plumbingObjects(renderer) {
  const result = [];
  renderer.world.traverse(o => { if (o.userData.plumbingId) result.push(o); });
  return result;
}

test('mounted lazy opt-in, services-only and both toggles, live edit, camera retention and exact disposal across repeated rebuilds', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let drawings = 0, builds = 0, structureBuilds = 0, loads = 0, selected = 0, notify, drawing = f.drawing;
  const bridge = { ...f.planner, getDrawingScene() { drawings++; return drawing; }, select() { selected++; },
    subscribe(fn) { notify = fn; return () => { notify = null; }; } };
  const ui = View.mount(dom.host, bridge, Model, {
    loadEngine: async () => { loads++; return engine.engine; },
    servicesModel: { build(d, options) { builds++; assert.equal(d, drawing); assert.deepEqual(options, { systems: ['water', 'waste'] }); return Services.build(d, options); } },
    structureModel: { build(d) { structureBuilds++; assert.equal(d, drawing); return Structure.build(d); } }
  });
  try {
    assert.equal(dom.nodes.services.checked, false);
    assert.equal(dom.nodes.structure.checked, false);
    assert.match(dom.host.html, /Plumbing engineering is not assessed/);
    assert.equal(loads, 0); assert.equal(dom.contexts.length, 0);
    await ui.open(); dom.flush();
    assert.equal(loads, 1); assert.equal(drawings, 0); assert.equal(builds, 0);
    const renderer = engine.renderers[0], camera = renderer.camera.position.toArray();
    const allResources = [];
    renderer.world.traverse(o => { if (o.geometry && o.type !== 'Box3Helper') allResources.push(o); });
    const initialDisposed = watchDisposal(allResources);
    dom.nodes.services.checked = true; await dom.nodes.services.dispatch('change'); dom.flush();
    initialDisposed();
    assert.equal(drawings, 1); assert.equal(builds, 1); assert.equal(structureBuilds, 0);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    assert.match(dom.nodes['services-note'].textContent, /7 segments.*2 gaps need review/);
    assert.match(dom.nodes['services-schedule'].textContent, /diameter 25.125 mm/);
    assert.match(dom.nodes['services-schedule'].textContent, /width 0.6, depth 0.4, height 0.85 m/);
    assert.doesNotMatch(dom.nodes['services-note'].textContent, /diameter 25.125 mm/);
    assert.equal(dom.nodes['services-details'].hidden, false);
    assert.match(dom.host.html, /<details class="hp3d-assumptions" data-hp3d="services-details" hidden>/);
    assert.ok(dom.host.html.indexOf('data-hp3d="services-details"') > dom.host.html.indexOf('data-hp3d="viewport"'));
    assert.match(dom.nodes['services-scope-detail'].textContent, /not velocity, hydraulics/);
    assert.doesNotMatch(dom.nodes.status.textContent, /Plumbing engineering is not assessed/);
    assert.match(dom.host.html, /Plumbing engineering is not assessed/);
    let previous = plumbingObjects(renderer), disposed = watchDisposal(previous);
    dom.nodes.structure.checked = true; await dom.nodes.structure.dispatch('change'); dom.flush(); disposed();
    assert.equal(structureBuilds, 1); assert.equal(builds, 2); assert.equal(drawings, 2);
    let structuralCount = 0;
    renderer.world.traverse(o => { if (o.userData.structuralId) structuralCount++; });
    assert.equal(structuralCount, 1);
    dom.nodes.structure.checked = false; await dom.nodes.structure.dispatch('change'); dom.flush();
    for (let i = 0; i < 3; i++) {
      previous = plumbingObjects(renderer); disposed = watchDisposal(previous);
      drawing = copy(drawing);
      const source = drawing.authored.find(e => e.record.id === id('ground', 'source'));
      source.anchors[0].point.z += 1;
      notify({ type: 'project' }); dom.flush(); disposed();
      const sourceObject = plumbingObjects(renderer).find(o => o.userData.plumbingId === source.record.id);
      close(sourceObject.geometry.attributes.position.getY(0), source.anchors[0].point.z);
      assert.deepEqual(renderer.camera.position.toArray(), camera);
    }
    dom.nodes.active.checked = true; await dom.nodes.active.dispatch('change'); dom.flush();
    assert.match(dom.nodes['services-scope-detail'].textContent, /owned or endpoint-touching routes in full/);
    assert.match(dom.nodes['services-scope-detail'].textContent, /3 foreign-floor spans\/routes and 2 foreign endpoint nodes/);
    assert.match(dom.nodes['services-scope-detail'].textContent, /findings across all floors/);
    previous = plumbingObjects(renderer);
    dom.nodes.cutaway.checked = false; await dom.nodes.cutaway.dispatch('change'); dom.flush();
    assert.ok(previous.every(o => o.visible));
    for (let i = 0; i < 3; i++) {
      disposed = watchDisposal(plumbingObjects(renderer));
      const draws = drawings;
      dom.nodes.services.checked = false; await dom.nodes.services.dispatch('change'); dom.flush(); disposed();
      assert.equal(drawings, draws); assert.equal(plumbingObjects(renderer).length, 0);
      assert.equal(dom.nodes['services-note'].hidden, true);
      dom.nodes.services.checked = true; await dom.nodes.services.dispatch('change'); dom.flush();
      assert.deepEqual(renderer.camera.position.toArray(), camera);
    }
    assert.equal(selected, 0, 'overlays do not change architectural selection');
    disposed = watchDisposal(plumbingObjects(renderer));
    ui.close(); disposed();
    assert.equal(notify, null);
    assert.ok(renderer.disposed && renderer.lost && engine.controls[0].disposed);
    assert.equal(dom.frames.size, 0);
    assert.match(dom.nodes['services-note'].textContent, /not displayed/);
    assert.match(dom.host.html, /Plumbing engineering is not assessed/);
  } finally { ui.destroy(); }
});

test('module missing fails explicitly before engine load; recovery button leaves 2D and legacy usable', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let loads = 0;
  const ui = View.mount(dom.host, f.planner, Model, { loadEngine: async () => { loads++; return engine.engine; }, servicesModel: {} });
  try {
    dom.nodes.services.checked = true; await dom.nodes.services.dispatch('change');
    assert.equal(loads, 0); assert.equal(dom.contexts.length, 0);
    await ui.open();
    assert.equal(ui.isOpen, false); assert.equal(loads, 0);
    assert.match(dom.nodes.status.textContent, /Load planner-services.js.*2D/);
    assert.equal(dom.nodes['services-off'].hidden, false);
    await dom.nodes['services-off'].dispatch('click');
    assert.equal(dom.nodes.services.checked, false);
    await ui.open(); dom.flush(); assert.equal(ui.isOpen, true);
  } finally { ui.destroy(); }
});

test('bad registration, missing module and service build errors dispose an open preview without stale overlays', async () => {
  const f = fixture(), engine = await engineHarness();
  for (const mode of ['registration', 'module', 'build']) {
    const dom = domHarness(), serviceModel = { build: Services.build };
    let drawing = f.drawing;
    const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => drawing }, Model,
      { loadEngine: async () => engine.engine, servicesModel: serviceModel });
    try {
      await ui.open(); dom.flush();
      dom.nodes.services.checked = true; await dom.nodes.services.dispatch('change'); dom.flush();
      const renderer = engine.renderers.at(-1), disposed = watchDisposal(plumbingObjects(renderer));
      if (mode === 'registration') drawing = { ...drawing, scenes: drawing.scenes.slice(0, 1) };
      if (mode === 'module') delete serviceModel.build;
      if (mode === 'build') serviceModel.build = () => { throw new Error('Services invalid'); };
      dom.nodes.active.checked = true; await dom.nodes.active.dispatch('change'); disposed();
      assert.equal(ui.isOpen, false); assert.ok(renderer.disposed && renderer.lost);
      assert.match(dom.nodes.status.textContent, /2D/);
      assert.match(dom.nodes['services-note'].textContent, /not displayed/);
      assert.match(dom.host.html, /Plumbing engineering is not assessed/);
      assert.equal(dom.frames.size, 0);
    } finally { ui.destroy(); }
  }
});

test('pending engine load rechecks the latest plumbing registration and close invalidates loading', async () => {
  const f = fixture(), engine = await engineHarness();
  for (const mode of ['invalid', 'close']) {
    const dom = domHarness();
    let drawing = f.drawing, resolve;
    const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => drawing }, Model, {
      loadEngine: () => new Promise(done => { resolve = done; }), servicesModel: Services
    });
    try {
      dom.nodes.services.checked = true; await dom.nodes.services.dispatch('change');
      const opened = ui.open();
      if (mode === 'invalid') drawing = { ...drawing, scenes: drawing.scenes.slice(0, 1) };
      else ui.close();
      resolve(engine.engine); await opened;
      assert.equal(ui.isOpen, false); assert.equal(dom.frames.size, 0);
      if (mode === 'invalid') {
        assert.ok(engine.renderers.at(-1).disposed);
        assert.match(dom.nodes.status.textContent, /exactly all registered floors/);
      } else assert.equal(dom.contexts.length, 0);
    } finally { ui.destroy(); }
  }
});
