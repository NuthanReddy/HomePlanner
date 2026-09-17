const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../planner-3d.js');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Structure = require('../planner-structure.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
const point = (x, y, z = 0, floorId = 'ground') => ({ kind: 'point', floorId, point: { x, y, z } });
function fixture() {
  const project = createFixture('multiple-floors').project;
  project.floors.forEach((floor, i) => {
    floor.legacy.context.plate.sitePlot = { x: -1 - i * 2, y: -2 - i * 2, w: 16, h: 16 };
    floor.authored = Model.emptyAuthored();
  });
  const upper = project.floors[1].legacy.context;
  upper.g.W = upper.plate.width = 12;
  upper.g.D = upper.plate.depth = 10;
  project.floors[0].authored.structural = [
    { id: 'ground:authored:column', kind: 'column', anchors: [point(2, 3)], widthM: .4, depthM: .6,
      heightM: 3, material: 'Claimed concrete', sizeSource: 'authored' },
    { id: 'ground:authored:beam', kind: 'beam', anchors: [point(2, 3, 3), point(5, 7, 3)],
      widthM: .25, depthM: .45, material: 'Claimed steel', sizeSource: 'assumed' },
    { id: 'ground:authored:slab', kind: 'slab', anchors: [point(4, 4, 3)], widthM: 4, depthM: 5,
      heightM: .22, material: null, sizeSource: 'engineer-provided', reference: 'Unverified S-1' },
    { id: 'ground:authored:unknown', kind: 'footing', anchors: [point(1, 1)], widthM: 2, depthM: 2, material: null },
    { id: 'ground:authored:grid', kind: 'grid', anchors: [point(0, 0), point(8, 6)],
      widthM: null, depthM: null, material: null },
    { id: 'ground:authored:unresolved', kind: 'column', anchors: [null], widthM: 1, depthM: 1,
      heightM: 2, material: null }
  ];
  project.floors[1].authored.structural = [
    { id: 'upper:authored:column', kind: 'column', anchors: [point(0, 1, 0, 'upper')],
      widthM: .4, depthM: .6, heightM: 2.5, material: null }
  ];
  project.legacy = copy(project.floors[0].legacy);
  const planner = controllerFor(project), drawing = planner.getDrawingScene();
  return { project: planner.getProject(), planner, drawing, structure: Structure.build(drawing) };
}
function build(THREE, f, options = {}) {
  return View.buildContent(THREE, f.drawing.scenes, f.project, Model,
    { structuralIntent: true, structure: f.structure, cutaway: true, ...options });
}

test('real Three boxes and diagonal beams exactly use projected bottom centers and authored dimensions at all headings', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const f = fixture(), before = JSON.stringify(f.drawing);
  for (const headingDeg of [0, 90, 180, 270, 37]) {
    const frame = { ...f, drawing: { ...f.drawing, scenes: f.drawing.scenes.map(s => ({ ...s, headingDeg })) } };
    const content = build(THREE, frame);
    try {
      for (const object of content.structural.objects.filter(o => o.isMesh)) {
        const element = f.structure.elements.find(e => e.id === object.userData.structuralId), g = element.geometry;
        const scene = frame.drawing.scenes.find(s => s.floorId === element.floorId);
        const dimensions = object.geometry.parameters;
        const center = g.kind === 'box' ? { x: g.x + g.w / 2, y: g.y + g.d / 2, z: g.z + g.h / 2 } :
          { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2, z: g.start.z + g.depthM / 2 };
        const expected = Projection.siteToWorld({ x: center.x - 8, y: center.y - 8, z: center.z }, headingDeg);
        close(object.position.x, expected.east); close(object.position.y, expected.up); close(object.position.z, -expected.north);
        close(dimensions.width, g.kind === 'box' ? g.w : 5);
        close(dimensions.height, g.kind === 'box' ? g.h : g.depthM);
        close(dimensions.depth, g.kind === 'box' ? g.d : g.widthM);
        if (g.kind === 'box') {
          const corner = object.localToWorld(new THREE.Vector3(-g.w / 2, -g.h / 2, -g.d / 2));
          const expectedCorner = View.toThree({ x: g.x, y: g.y }, scene, g.z);
          close(corner.x, expectedCorner.x); close(corner.y, expectedCorner.y); close(corner.z, expectedCorner.z);
        }
        if (g.kind === 'beam') {
          for (const [sign, endpoint] of [[-1, g.start], [1, g.end]]) {
            const end = object.localToWorld(new THREE.Vector3(sign * 2.5, -g.depthM / 2, 0));
            const p = View.toThree(endpoint, scene, endpoint.z);
            close(end.x, p.x); close(end.y, p.y); close(end.z, p.z);
          }
        }
      }
    } finally { View.disposeObject(content.group); }
  }
  assert.equal(JSON.stringify(f.drawing), before);
});

test('unequal floors, setbacks and architectural geometry share the site origin with structural intent', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  assert.notEqual(f.drawing.scenes[0].floor.w, f.drawing.scenes[1].floor.w);
  assert.notEqual(f.drawing.scenes[0].sourcePlotOrigin.x, f.drawing.scenes[1].sourcePlotOrigin.x);
  for (const headingDeg of [0, 90, 180, 270]) {
    const scenes = f.drawing.scenes.map(s => ({ ...s, headingDeg }));
    const content = build(THREE, { ...f, drawing: { ...f.drawing, scenes } });
    try {
      const columns = content.structural.objects.filter(o => o.userData.structuralId.endsWith(':column'));
      close(columns[0].position.x, columns[1].position.x);
      close(columns[0].position.z, columns[1].position.z);
      for (const scene of scenes) {
        const room = scene.rooms[0], mesh = content.refs.get(`room\0${room.id}`).objects[0];
        const center = { x: room.rect.x + room.rect.w / 2 - 8, y: room.rect.y + room.rect.h / 2 - 8, z: scene.floorElevationM + .01 };
        const expected = Projection.siteToWorld(center, headingDeg);
        close(mesh.position.x, expected.east); close(mesh.position.y, expected.up); close(mesh.position.z, -expected.north);
      }
    } finally { View.disposeObject(content.group); }
  }
});

test('unknown heights/hosts stay count-only markers; grids are unshadowed nonpickable lines, provenance never verifies', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture(), content = build(THREE, f);
  try {
    const s = content.structural;
    assert.deepEqual([s.total, s.shown, s.solids, s.grids, s.missing], [7, 7, 4, 1, 2]);
    assert.equal(s.findings, f.structure.findings);
    assert.ok(s.findings.some(f => f.code === 'engineering-not-assessed'));
    assert.ok(s.objects.every(o => !o.castShadow && !o.receiveShadow && !content.pickables.includes(o)));
    assert.ok(s.objects.every(o => !o.userData.entityRef));
    assert.equal([...content.refs.values()].some(r => r.ref.kind === 'structural'), false);
    assert.ok(!s.objects.some(o => /unknown|unresolved/.test(o.userData.structuralId)));
    const grid = s.objects.find(o => o.isLine);
    assert.equal(grid.material.type, 'LineBasicMaterial');
    assert.equal(grid.geometry.attributes.position.count, 2);
    const geometry = f.structure.elements.find(e => e.kind === 'grid').geometry;
    [geometry.start, geometry.end].forEach((endpoint, i) => {
      const expected = View.toThree(endpoint, f.drawing.scenes[0], endpoint.z);
      const positions = grid.geometry.attributes.position;
      close(positions.getX(i), expected.x); close(positions.getY(i), expected.y); close(positions.getZ(i), expected.z);
    });
    const colors = s.objects.filter(o => o.isMesh).map(o => o.material.color.getHex());
    assert.equal(new Set(colors).size, 4);
    const slab = s.objects.find(o => o.userData.structuralId.endsWith(':slab'));
    assert.equal(slab.visible, true);
    assert.ok(!content.roofs.includes(slab));
    assert.ok(content.roofs.every(roof => !roof.visible));
  } finally { View.disposeObject(content.group); }
  const active = build(THREE, { ...f, project: { ...f.project, activeFloorId: 'upper' } }, { activeOnly: true });
  try {
    assert.deepEqual([active.structural.total, active.structural.shown, active.structural.solids, active.structural.missing], [7, 1, 1, 0]);
  } finally { View.disposeObject(active.group); }
});

test('opt-in rejects partial, duplicate or incompatible registration even with activeOnly; default stays legacy', async () => {
  const THREE = await import('../vendor/three/three.module.min.js'), f = fixture();
  const scenes = f.drawing.scenes;
  for (const invalid of [
    scenes.slice(0, 1), [scenes[0], scenes[0]],
    [scenes[0], { ...scenes[1], coordinateSpace: 'floor-local' }],
    [scenes[0], { ...scenes[1], headingDeg: 20 }],
    [scenes[0], { ...scenes[1], plot: { ...scenes[1].plot, w: 19 } }]
  ]) assert.throws(() => build(THREE, { ...f, drawing: { ...f.drawing, scenes: invalid } }, { activeOnly: true }), /exactly all registered floors/);
  const legacy = f.planner.getScenes();
  const plain = View.buildContent(THREE, legacy, f.project, Model);
  const ignored = View.buildContent(THREE, legacy, f.project, Model, { structure: f.structure });
  try {
    assert.equal(plain.structural, undefined); assert.equal(ignored.structural, undefined);
    const signature = content => content.group.children.map(o => ({
      position: o.position.toArray(), children: o.children.map(c => [c.type, c.position.toArray(), c.geometry?.parameters])
    }));
    assert.deepEqual(signature(plain), signature(ignored));
    const p = { x: 2, y: 3 }, scene = legacy[1];
    const actual = View.toThree(p, scene, 4), expected = Model.localToWorld({ ...p, z: 4 }, scene);
    close(actual.x, expected.east); close(actual.z, -expected.north);
  } finally { View.disposeObject(plain.group); View.disposeObject(ignored.group); }
});

// Same minimal event/element approach as the storage/UI DOM harnesses; no browser dependency.
function domHarness(webgl = true) {
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
    getContext() { contexts.push(this); return webgl ? { getExtension() { return null; } } : null; }
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
    constructor() {
      renderers.push(this); this.shadowMap = {}; this.renderLists = { dispose: () => { this.listDisposals = (this.listDisposals || 0) + 1; } };
    }
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
test('mounted default OFF never requests projection; toggles rebuild and dispose without moving camera or changing selection', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let drawings = 0, builds = 0, selected = 0;
  const bridge = { ...f.planner, getDrawingScene() { drawings++; return f.planner.getDrawingScene(); }, select() { selected++; } };
  const ui = View.mount(dom.host, bridge, Model, {
    loadEngine: async () => engine.engine, structureModel: { build(d) { builds++; return Structure.build(d); } }
  });
  try {
    assert.equal(dom.nodes.structure.checked, false);
    assert.equal(dom.contexts.length, 0);
    await ui.open(); dom.flush();
    assert.equal(ui.isOpen, true); assert.equal(drawings, 0); assert.equal(builds, 0);
    const renderer = engine.renderers[0], camera = renderer.camera.position.toArray();
    let oldDisposed = 0;
    renderer.world.traverse(o => { if (o.geometry) o.geometry.addEventListener('dispose', () => oldDisposed++); });
    dom.nodes.structure.checked = true;
    await dom.nodes.structure.dispatch('change'); dom.flush();
    assert.equal(drawings, 1); assert.equal(builds, 1); assert.ok(oldDisposed > 0);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    assert.match(dom.nodes['structure-note'].textContent, /4 members and 1 grid lines shown; 2 records need positions or sizes/);
    assert.match(dom.host.html, /Structural engineering is not assessed/);
    assert.match(dom.host.html, /Design → Structure \(2D\)/);
    assert.equal(dom.nodes['structure-setup'].textContent, 'Edit structure');
    const structural = [];
    renderer.world.traverse(o => { if (o.userData.structuralId) structural.push(o); });
    let disposed = 0;
    structural.forEach(o => o.geometry.addEventListener('dispose', () => disposed++));
    dom.nodes.cutaway.checked = false; await dom.nodes.cutaway.dispatch('change'); dom.flush();
    dom.nodes.cutaway.checked = true; await dom.nodes.cutaway.dispatch('change'); dom.flush();
    assert.ok(structural.every(o => o.visible));
    dom.nodes.structure.checked = false; await dom.nodes.structure.dispatch('change'); dom.flush();
    assert.equal(disposed, structural.length); assert.equal(drawings, 1); assert.equal(builds, 1);
    assert.equal(dom.nodes['structure-note'].hidden, true); assert.equal(selected, 0);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    ui.close();
    assert.ok(renderer.disposed && renderer.lost && engine.controls[0].disposed);
    assert.equal(dom.frames.size, 0);
  } finally { ui.destroy(); }
});

test('registration failure closes stale geometry with explicit 2D fallback, even with Active floor only', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => ({ ...f.drawing, scenes: f.drawing.scenes.slice(0, 1) }) },
    Model, { loadEngine: async () => engine.engine, structureModel: Structure });
  try {
    await ui.open(); dom.flush();
    dom.nodes.active.checked = true; dom.nodes.structure.checked = true;
    await dom.nodes.structure.dispatch('change');
    assert.equal(ui.isOpen, false);
    assert.ok(engine.renderers[0].disposed);
    assert.match(dom.nodes.status.textContent, /exactly all registered floors.*2D/);
    assert.equal(dom.nodes['structure-note'].hidden, false);
    assert.equal(dom.nodes['structure-off'].hidden, false);
    await dom.nodes['structure-off'].dispatch('click');
    assert.equal(dom.nodes.structure.checked, false);
    await ui.open(); dom.flush();
    assert.equal(ui.isOpen, true, 'A failed opt-in must not trap the user away from the working legacy preview');
  } finally { ui.destroy(); }
});

test('pending engine load is invalidated by close/destroy and WebGL unavailable retains 2D', async () => {
  const f = fixture(), engine = await engineHarness();
  for (const action of ['close', 'destroy']) {
    const dom = domHarness(); let resolve;
    const ui = View.mount(dom.host, f.planner, Model, { loadEngine: () => new Promise(done => { resolve = done; }), structureModel: Structure });
    dom.nodes.structure.checked = true; await dom.nodes.structure.dispatch('change');
    const opened = ui.open(); ui[action](); resolve(engine.engine); await opened;
    assert.equal(dom.contexts.length, 0); assert.equal(ui.isOpen, false); ui.destroy();
  }
  const dom = domHarness(false), ui = View.mount(dom.host, f.planner, Model, { loadEngine: async () => engine.engine });
  try {
    await ui.open(); assert.equal(ui.isOpen, false);
    assert.match(dom.nodes.status.textContent, /WebGL2 is unavailable.*2D/);
  } finally { ui.destroy(); }
});

test('pending load refreshes registration instead of rendering an obsolete structural snapshot', async () => {
  const f = fixture(), dom = domHarness(), engine = await engineHarness();
  let drawing = f.drawing, resolve;
  const ui = View.mount(dom.host, { ...f.planner, getDrawingScene: () => drawing }, Model,
    { loadEngine: () => new Promise(done => { resolve = done; }), structureModel: Structure });
  try {
    dom.nodes.structure.checked = true; await dom.nodes.structure.dispatch('change');
    const opened = ui.open();
    drawing = { ...drawing, scenes: drawing.scenes.slice(0, 1) };
    resolve(engine.engine); await opened;
    assert.equal(ui.isOpen, false); assert.ok(engine.renderers[0].disposed);
    assert.match(dom.nodes.status.textContent, /exactly all registered floors/);
    assert.match(dom.nodes['structure-note'].textContent, /not displayed/);
    assert.match(dom.host.html, /Structural engineering is not assessed/);
    assert.equal(dom.frames.size, 0);
  } finally { ui.destroy(); }
});
