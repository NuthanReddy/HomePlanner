const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../planner-3d.js');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Drainage = require('../planner-drainage.js');
const Services = require('../planner-services.js');
const Structure = require('../planner-structure.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
const id = (floor, name) => `${floor}:authored:${name}`;
const ref = (floor, name) => ({ floorId: floor, entityId: id(floor, name) });
const at = (floor, x, y, z) => ({ kind: 'point', floorId: floor, point: { x, y, z } });
function fixture() {
  const project = createFixture('multiple-floors').project;
  project.floors.forEach((floor, index) => {
    floor.authored = Model.emptyAuthored();
    floor.legacy.context.plate.sitePlot = { x: -1 - 2 * index, y: -2 - 2 * index, w: 16, h: 16 };
  });
  const upper = project.floors[1].legacy.context;
  upper.g.W = upper.plate.width = 12;
  upper.g.D = upper.plate.depth = 10;
  const ground = project.floors[0].authored, up = project.floors[1].authored;
  for (const [system, circuit] of [['water', 'cold'], ['waste', 'soil'], ['rain', 'storm']]) {
    ground.serviceNodes.push({
      id: id('ground', system), system, circuit, kind: 'outlet', role: 'outfall',
      anchor: at('ground', 4, 3, .75), diameterMm: 110.125, invertM: -1.23456789,
      groundM: 2.3456789, finishedFloorM: 3.456789, levelSource: 'surveyed',
      levelReference: 'Unverified <benchmark>', accessRadiusM: .125,
      discharge: { kind: 'surface-outfall', reference: 'Unverified destination' }
    });
    up.serviceNodes.push({
      id: id('upper', system), system, circuit, kind: 'junction', role: null,
      anchor: at('upper', 2, 3, 1.25), diameterMm: null, invertM: 1.87654321
    });
    up.serviceRoutes.push({
      id: id('upper', `${system}-route`), system, circuit, from: ref('upper', system), to: ref('ground', system),
      via: [at('upper', 4, 3, 1), null, at('ground', 4, 3, 1)], viaInvertsM: [1.5, null, -.5],
      diameterMm: 99.987654, slope: .012345, slopeSource: 'assumed', slopeReference: 'Not a design',
      clearanceM: .0123
    });
  }
  up.serviceNodes.push({
    id: id('upper', 'unknown'), system: 'rain', circuit: 'storm', kind: 'junction',
    anchor: null, diameterMm: null, invertM: null
  });
  ground.structural.push({ id: id('ground', 'column'), kind: 'column', anchors: [at('ground', 4, 3, 0)],
    widthM: .4, depthM: .5, heightM: 3, material: null, sizeSource: 'authored' });
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project), drawing = planner.getDrawingScene();
  return { planner, project: planner.getProject(), drawing, drainage: Drainage.build(drawing),
    services: Services.build(drawing, { systems: ['water', 'waste'] }), structure: Structure.build(drawing) };
}
function build(THREE, f, extra = {}) {
  return View.buildContent(THREE, f.drawing.scenes, f.project, Model,
    { drainageIntent: true, drainage: f.drainage, cutaway: true, ...extra });
}
function assertPosition(attribute, index, expected) {
  for (const [key, method] of [['x', 'getX'], ['y', 'getY'], ['z', 'getZ']])
    assert.ok(Math.abs(attribute[method](index) - expected[key]) < 1e-6);
}
function disposal(objects) {
  const resources = new Map();
  for (const o of objects) for (const r of [o.geometry, o.material].filter(Boolean)) {
    if (resources.has(r)) continue;
    resources.set(r, 0);
    r.addEventListener('dispose', () => resources.set(r, resources.get(r) + 1));
  }
  assert.ok(resources.size);
  return () => { for (const count of resources.values()) assert.equal(count, 1); };
}

test('real projection drainage follows site registration and true elevation; null spans never bridge or use invert levels', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const before = JSON.stringify([f.project, f.drawing, f.drainage]);
  for (const headingDeg of [0, 37, 90, 180, 270]) {
    const drawing = { ...f.drawing, scenes: f.drawing.scenes.map(s => ({ ...s, headingDeg })) };
    const c = build(THREE, { ...f, drawing });
    try {
      assert.equal(c.plumbing, undefined);
      assert.equal(c.drainage.routes, 2);
      assert.equal(c.drainage.segments, 4);
      assert.equal(c.drainage.gaps, 4);
      assert.equal(c.drainage.missing, 1);
      assert.equal(c.drainage.solids, 0);
      for (const object of c.drainage.objects) {
        const isRoute = object.userData.plumbingKind === 'route';
        const record = f.drainage[isRoute ? 'routes' : 'nodes'].find(e => e.id === object.userData.drainageId);
        const points = isRoute ? [record.points[0], record.points[1], record.points[3], record.points[4]] : [record.anchor];
        assert.equal(object.geometry.attributes.position.count, points.length);
        points.forEach((p, index) => {
          const world = Projection.siteToWorld({ x: p.x - 8, y: p.y - 8, z: p.z }, headingDeg);
          assertPosition(object.geometry.attributes.position, index, { x: world.east, y: world.up, z: -world.north });
        });
        assert.ok(isRoute ? object.isLineSegments : object.isPoints);
        assert.ok(!object.isMesh && !object.castShadow && !object.receiveShadow);
        assert.ok(!c.pickables.includes(object) && !object.userData.entityRef);
      }
      const outlet = c.drainage.schedule.find(e => e.kind === 'node' && e.floorId === 'ground');
      assert.equal(outlet.groundM, 2.3456789);
      assert.equal(outlet.finishedFloorM, 3.456789);
      assert.equal(outlet.invertM, -1.23456789);
      assert.deepEqual(outlet.discharge, { kind: 'surface-outfall', reference: 'Unverified destination' });
      assert.equal(outlet.accessRadiusM, .125);
      const r = c.drainage.schedule.find(e => e.kind === 'route');
      assert.deepEqual(r.viaInvertsM, [1.5, null, -.5]);
      assert.equal(r.clearanceM, .0123);
      assert.equal(r.diameterMm, 99.987654);
      assert.equal(c.drainage.findings, f.drainage.findings);
      assert.ok(c.drainage.findings.some(f => f.code === 'engineering-not-assessed'));
    } finally { View.disposeObject(c.group); }
  }
  assert.equal(JSON.stringify([f.project, f.drawing, f.drainage]), before);
});

test('rain-only renders storm and active floor keeps full foreign routes/endpoints without unknown unrelated nodes', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const c = build(THREE, f, { drainage: Drainage.build(f.drawing, { systems: ['rain'] }), activeOnly: true });
  try {
    assert.equal(c.drainage.routes, 1);
    assert.equal(c.drainage.nodes, 2);
    assert.equal(c.drainage.foreignNodes, 1);
    assert.equal(c.drainage.foreignRoutes, 1);
    assert.equal(c.drainage.segments, 2);
    assert.ok(c.drainage.objects.every(o => o.userData.system === 'rain' && o.material.color.getHex() === 0x32a7a0));
    assert.ok(!c.drainage.objects.some(o => o.userData.drainageId.endsWith('unknown')));
  } finally { View.disposeObject(c.group); }
});

test('three independent layers form one union: common waste objects and architectural/structural solids never duplicate', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const c = build(THREE, f, { plumbingIntent: true, services: f.services, structuralIntent: true, structure: f.structure });
  try {
    assert.equal(c.structural.solids, 1);
    assert.equal(c.plumbing.routes, 2);
    assert.equal(c.drainage.routes, 2);
    const shared = c.plumbing.objects.filter(o => c.drainage.objects.includes(o));
    assert.equal(shared.length, 3, 'one waste route and two waste nodes');
    assert.equal(c.group.children.filter(o => o.userData.plumbingId || o.userData.drainageId).length, 9);
    assert.equal(c.drainage.solids, 0);
    assert.equal(new Set(c.group.children).size, c.group.children.length);
    const disposed = disposal([...c.plumbing.objects, ...c.drainage.objects]);
    View.disposeObject(c.group); disposed();
  } catch (error) { View.disposeObject(c.group); throw error; }
  const off = View.buildContent(THREE, f.planner.getScenes(), f.project, Model, { drainage: f.drainage });
  assert.equal(off.drainage, undefined); View.disposeObject(off.group);
  assert.throws(() => build(THREE, f, { drainage: null }), /Drainage coordination output is unavailable/);
  assert.throws(() => build(THREE, { ...f, drawing: { ...f.drawing, scenes: f.drawing.scenes.slice(0, 1) } }), /exactly all registered floors/);
});

function domHarness() {
  let document, sequence = 0;
  const nodes = {}, frames = new Map(), contexts = [];
  class Element {
    constructor(tag) {
      this.tag = tag; this.ownerDocument = document; this.children = []; this.listeners = new Map();
      this.dataset = {}; this.style = {}; this.checked = false; this.attributes = {};
      this.clientWidth = 800; this.clientHeight = 600; this.classList = { add() {}, toggle() {} };
    }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<[^>]+data-hp3d="([^"]+)"[^>]*>/g)) {
        const el = new Element('element'); el.dataset.hp3d = match[1];
        el.checked = /\schecked(?:\s|>)/.test(match[0]); el.hidden = /\shidden(?:\s|>)/.test(match[0]); nodes[match[1]] = el;
      }
    }
    querySelectorAll() { return Object.values(nodes); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    async dispatch(type, extra = {}) { for (const fn of this.listeners.get(type) || []) await fn({ preventDefault() {}, ...extra }); }
    setAttribute(k, v) { this.attributes[k] = v; } removeAttribute(k) { delete this.attributes[k]; }
    prepend(el) { el.parent = this; this.children.unshift(el); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); }
    replaceChildren() { this.children = []; } focus() {}
    getContext() { contexts.push(this); return { getExtension() { return null; } }; }
  }
  const window = new Element('window');
  Object.assign(window, {
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame(n) { frames.delete(n); },
    queueMicrotask, getComputedStyle() { return { getPropertyValue() { return ''; } }; }
  });
  document = new Element('document'); document.defaultView = window; document.createElement = tag => new Element(tag);
  return { host: new Element('host'), nodes, contexts, frames,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } };
}
async function engineHarness() {
  const THREE = await import('../vendor/three/three.module.min.js'), renderers = [];
  class Renderer {
    constructor() { renderers.push(this); this.shadowMap = {}; this.renderLists = { dispose() {} }; }
    setPixelRatio() {} setSize() {} render(world, camera) { this.world = world; this.camera = camera; }
    dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  class Controls extends THREE.EventDispatcher {
    constructor() { super(); this.target = new THREE.Vector3(); }
    listenToKeyEvents() {} update() {} dispose() {}
  }
  return { engine: { THREE: { ...THREE, WebGLRenderer: Renderer }, OrbitControls: Controls }, renderers };
}
function objects(renderer) {
  const result = []; renderer.world.traverse(o => { if (o.userData.drainageId) result.push(o); }); return result;
}

test('mounted default off stays lazy; metadata/findings collapsed below canvas, rebuilds dispose once and camera remains stable', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let loads = 0, builds = 0, drawing = f.drawing, notify;
  const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => drawing,
    subscribe(fn) { notify = fn; return () => { notify = null; }; } }, Model, {
    loadEngine: async () => { loads++; return engine.engine; },
    drainageModel: { build(scene, options) { builds++; assert.deepEqual(options, { systems: ['waste', 'rain'] }); return Drainage.build(scene, options); } },
    servicesModel: Services, structureModel: Structure
  });
  const before = JSON.stringify(f.planner.getProject());
  try {
    assert.equal(dom.nodes.drainage.checked, false); assert.equal(builds, 0); assert.equal(loads, 0);
    assert.equal(dom.contexts.length, 0);
    await ui.open(); dom.flush();
    assert.equal(builds, 0);
    const renderer = engine.renderers[0], camera = renderer.camera.position.toArray();
    dom.nodes.drainage.checked = true; await dom.nodes.drainage.dispatch('change'); dom.flush();
    assert.equal(builds, 1);
    assert.match(dom.host.html, /<\/div>\s*<details class="hp3d-assumptions" data-hp3d="services-details"/);
    assert.match(dom.host.html, /<details class="hp3d-assumptions" data-hp3d="drainage-details" hidden>/);
    assert.ok(dom.host.html.indexOf('data-hp3d="drainage-details"') > dom.host.html.indexOf('data-hp3d="viewport"'));
    assert.equal(dom.nodes['drainage-details'].hidden, false);
    const schedule = dom.nodes['drainage-schedule'].textContent.split('\n').map(JSON.parse);
    assert.equal(schedule.find(e => e.groundM != null).groundM, 2.3456789);
    assert.equal(schedule.find(e => e.levelReference).levelReference, 'Unverified <benchmark>');
    assert.match(dom.nodes['intent-findings-list'].textContent, /drainage:.*engineering-not-assessed/);
    assert.doesNotMatch(dom.nodes['drainage-note'].textContent, /authored:|UUID|benchmark/);
    for (const layer of ['services', 'structure', 'active']) {
      const disposed = disposal(objects(renderer));
      dom.nodes[layer].checked = true; await dom.nodes[layer].dispatch('change'); dom.flush(); disposed();
      assert.deepEqual(renderer.camera.position.toArray(), camera);
    }
    let disposed = disposal(objects(renderer));
    drawing = copy(drawing);
    const n = drawing.authored.find(e => e.record.id === id('ground', 'rain') && e.record.kind === 'outlet');
    n.anchors[0].point.z += 2;
    notify({ type: 'project' }); dom.flush(); disposed();
    assert.ok(Math.abs(objects(renderer).find(o => o.userData.drainageId === n.record.id).geometry.attributes.position.getY(0) - n.anchors[0].point.z) < 1e-6);
    disposed = disposal(objects(renderer)); ui.close(); disposed();
    assert.ok(renderer.disposed && renderer.lost);
    assert.equal(dom.frames.size, 0); assert.equal(notify, null);
    assert.equal(dom.nodes['drainage-schedule'].textContent, '');
    assert.match(dom.nodes['drainage-note'].textContent, /not displayed/);
    assert.equal(JSON.stringify(f.planner.getProject()), before);
  } finally { ui.destroy(); }
});

test('drainage-only missing module fails before GPU load; explicit off recovery works without dependency', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let loads = 0;
  const ui = View.mount(dom.host, f.planner, Model, { drainageModel: {},
    loadEngine: async () => { loads++; return engine.engine; } });
  try {
    dom.nodes.drainage.checked = true; await dom.nodes.drainage.dispatch('change');
    await ui.open();
    assert.equal(loads, 0); assert.equal(ui.isOpen, false); assert.equal(dom.contexts.length, 0);
    assert.match(dom.nodes.status.textContent, /Load planner-drainage.js/);
    assert.equal(dom.nodes['drainage-off'].hidden, false);
    await dom.nodes['drainage-off'].dispatch('click');
    await ui.open(); dom.flush();
    assert.equal(ui.isOpen, true); assert.equal(loads, 1);
  } finally { ui.destroy(); }
});

test('drainage failure disposes stale geometry; dependency recovery and WebGL context loss remain explicit', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness(), drainageModel = { build: Drainage.build };
  const ui = View.mount(dom.host, f.planner, Model, { drainageModel, loadEngine: async () => engine.engine });
  try {
    dom.nodes.drainage.checked = true; await dom.nodes.drainage.dispatch('change');
    await ui.open(); dom.flush();
    const first = engine.renderers.at(-1), disposed = disposal(objects(first));
    drainageModel.build = () => { throw new Error('Drainage bounded workload rejected'); };
    dom.nodes.active.checked = true; await dom.nodes.active.dispatch('change'); disposed();
    assert.equal(ui.isOpen, false); assert.ok(first.disposed && first.lost);
    assert.match(dom.nodes.status.textContent, /Drainage bounded workload rejected/);
    assert.equal(dom.nodes['drainage-schedule'].textContent, '');
    drainageModel.build = Drainage.build;
    await ui.open(); dom.flush(); assert.equal(ui.isOpen, true);
    const second = engine.renderers.at(-1), secondDisposed = disposal(objects(second));
    await dom.contexts.at(-1).dispatch('webglcontextlost'); await Promise.resolve(); secondDisposed();
    assert.equal(ui.isOpen, false); assert.ok(second.disposed && second.lost);
    assert.equal(dom.frames.size, 0);
    assert.match(dom.nodes.status.textContent, /graphics context/);
  } finally { ui.destroy(); }
});
