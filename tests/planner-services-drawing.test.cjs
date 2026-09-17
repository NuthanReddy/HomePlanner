const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Services = require('../planner-services.js');
const Drawing = require('../planner-drawing.js');
const Renderer = require('../planner-services-drawing.js');
const Export = require('../planner-drawing-export.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const id = (f, n) => `${f}:authored:${n}`;
const ref = (f, n) => ({ floorId: f, entityId: id(f, n) });
const at = (f, x = 2, y = 2, z = 1) => ({ kind: 'point', floorId: f, point: { x, y, z } });
function node(f, n, kind = 'junction', extra = {}) {
  return { id: id(f, n), system: 'water', kind, anchor: at(f), diameterMm: null, invertM: null,
    circuit: 'cold', label: n, role: null, ...extra };
}
function route(f, n, from, to, extra = {}) {
  return { id: id(f, n), system: 'water', from, to, via: [], diameterMm: null, slope: null,
    circuit: 'cold', label: n, ...extra };
}
function project() {
  const p = createFixture('multiple-floors').project;
  for (const f of p.floors) {
    f.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
    f.authored = Model.emptyAuthored();
  }
  p.floors[0].heightM = 4.1;
  p.floors[1].heightM = 2.7;
  p.legacy = copy(p.floors[0].legacy);
  const g = p.floors[0].authored, u = p.floors[1].authored;
  g.serviceNodes = [node('ground', 'source', 'supply', { anchor: at('ground', 2, 2), role: 'supply' }),
    node('ground', 'valve', 'junction', { anchor: at('ground', 4, 2), role: 'valve' })];
  u.fixtures = [{ id: id('upper', 'basin'), kind: 'basin', anchor: at('upper', 6, 3),
    widthM: .6, depthM: .4, heightM: null }];
  u.serviceNodes = [node('upper', 'port', 'fixture', {
    role: 'port', anchor: { kind: 'entity', entityKind: 'fixture', ...ref('upper', 'basin') }
  })];
  g.serviceRoutes = [
    route('ground', 'local', ref('ground', 'source'), ref('ground', 'valve')),
    route('ground', 'riser', ref('ground', 'valve'), ref('upper', 'port'), {
      via: [at('ground', 5, 2, 2), at('upper', 5, 2, .5)]
    })
  ];
  return p;
}
const options = { floorId: 'ground', paper: 'A2', orientation: 'landscape', scaleDenominator: 100, units: 'metric' };
const render = (p, opt = {}) => Renderer.createSheets(Projection.build(p), { ...options, ...opt });
const texts = sheets => sheets.flatMap(s => s.primitives.filter(p => p.type === 'text').map(p => p.text.replace(/^\| /, ''))).join('');
const paths = (sheet, color) => sheet.primitives.filter(p => p.type === 'path' && p.stroke === color);
function freeze(v) { Object.values(v).forEach(x => { if (x && typeof x === 'object') freeze(x); }); return Object.freeze(v); }

test('exact frozen API, deterministic global/CommonJS output and one graph build per render', () => {
  assert.deepEqual(Object.keys(Renderer).sort(), ['createSheet', 'createSheets', 'toSVG']);
  const scene = freeze(Projection.build(project())), before = JSON.stringify(scene);
  let count = 0;
  const sandbox = { HomePlannerModel: Model, HomePlannerServices: {
    build: (...args) => { count++; assert.deepEqual(copy(args[1].systems), ['water', 'waste']); return Services.build(...args); }
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-drawing.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-services-drawing.js'), 'utf8'), sandbox);
  // Options are created in the renderer realm because strict plain-object validation is intentional.
  sandbox.input = scene;
  const browser = vm.runInNewContext('HomePlannerServicesDrawing.createSheets(input, {floorId:"ground",paper:"A2"})', sandbox);
  const sheets = Renderer.createSheets(scene, options);
  assert.equal(count, 1);
  assert.deepEqual(copy(browser), sheets);
  assert.deepEqual(Renderer.createSheets(scene, options), sheets);
  assert.equal(JSON.stringify(scene), before);
  assert.ok(Object.isFrozen(sheets) && Object.isFrozen(sheets[0].primitives[0]));
  for (const sheet of sheets) {
    assert.equal(Drawing.validateSheet(sheet), sheet);
    assert.equal(Renderer.toSVG(sheet), Drawing.toSVG(sheet));
    assert.ok(sheet.primitives.filter(p => p.type === 'text').every(p => p.fontSizeMm >= 2));
  }
  assert.throws(() => Renderer.createSheet(scene, options), /createSheets/);
});

test('real unequal floors: same node identity, full route point schedules and 3D length in both views', () => {
  const p = project(), graph = Services.build(Projection.build(p), { systems: ['water', 'waste'] });
  const plan = render(p), riser = render(p, { view: 'riser' });
  const a = texts(plan), b = texts(riser);
  assert.equal(graph.nodes.find(n => n.floorId === 'upper').anchor.z, 5.55);
  for (const n of graph.nodes) for (const content of [a, b]) assert.ok(content.includes(n.id));
  for (const r of graph.routes) for (const content of [a, b]) {
    assert.ok(content.includes(r.id));
    assert.ok(content.includes(`Full 3D geometric length: ${Number(r.lengthM.toFixed(6))} m`));
    r.points.forEach((p, i) => assert.ok(content.includes(`Point ${i}`) && content.includes(`z ${Number(p.z.toFixed(6))} m`)));
  }
  assert.ok(b.includes('NONSPATIAL'));
  assert.ok(b.includes('floor ground; true project level 0.45 m'));
  assert.ok(b.includes('floor upper; true project level 4.55 m'));
  assert.ok(a.includes('FOREIGN referenced endpoint'));
  assert.ok(a.includes('supplied invert: unknown'));
  const planKeys = plan[0].primitives.filter(p => p.type === 'text' && /^N\d+\[/.test(p.text)).map(p => p.text).sort();
  const riserKeys = riser[0].primitives.filter(p => p.type === 'text' && /^N\d+\[/.test(p.text)).map(p => p.text).sort();
  assert.deepEqual(planKeys, riserKeys);
});

test('true plan length and riser waypoint heights maintain fixed physical scale, imperial changes only labels', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceRoutes = [route('ground', 'measure', ref('ground', 'source'), ref('ground', 'valve'), {
    via: [at('ground', 3, 2, 3)]
  })];
  g.serviceNodes[1].anchor = at('ground', 4, 2, 2);
  for (const units of ['metric', 'imperial']) {
    const plan = render(p, { units })[0], riser = render(p, { units, view: 'riser' })[0];
    const planAxes = paths(plan, '#246DA0').filter(p => p.commands.length === 2);
    assert.equal(planAxes.length, 2);
    assert.ok(Math.abs(planAxes[0].commands[1][1] - planAxes[0].commands[0][1] - 10) < 1e-8);
    const riserAxes = paths(riser, '#246DA0').filter(p => p.commands.length === 2 &&
      Math.abs(p.commands[1][2] - p.commands[0][2]) > 5);
    assert.equal(riserAxes.length, 2);
    assert.ok(Math.abs(riserAxes[0].commands[1][2] - riserAxes[0].commands[0][2] + 20) < 1e-8);
    assert.ok(Math.abs(riserAxes[1].commands[1][2] - riserAxes[1].commands[0][2] - 10) < 1e-8);
  }
});

test('incoming cross-floor routes are printed on receiving floor, without silently rendering unrelated routes', () => {
  const p = project(), sheets = render(p, { floorId: 'upper' }), content = texts(sheets);
  assert.ok(content.includes('ground:authored:riser'));
  assert.ok(content.includes('REFERENCED incoming/outgoing route'));
  assert.ok(content.includes('ground:authored:valve'));
  // Project-wide warnings may mention a route, but its full schedule is not rendered.
  assert.ok(!content.includes('ID: ground:authored:local; owner floor:'));
  assert.ok(paths(sheets[0], '#964A82').length > 0);
  p.floors[1].authored.serviceNodes.push(node('upper', 'other', 'junction', { anchor: at('upper', 8, 3) }));
  p.floors[0].authored.serviceRoutes = [route('ground', 'foreign-run', ref('upper', 'port'), ref('upper', 'other'))];
  const foreign = render(p);
  assert.ok(foreign[0].primitives.some(p => p.type === 'text' && /^R1\.1\*$/.test(p.text)));
});

test('riser includes intermediate actual level bars without inventing intermediate nodes or route landings', () => {
  const p = project(), middle = copy(p.floors[1]);
  Object.assign(middle, { id: 'middle', name: 'Middle', heightM: 1.7, authored: Model.emptyAuthored() });
  p.floors.splice(1, 0, middle);
  const graph = Services.build(Projection.build(p), { systems: ['water', 'waste'] });
  const sheets = render(p, { view: 'riser' }), content = texts(sheets);
  assert.ok(content.includes('floor middle; true project level 4.55 m'));
  assert.ok(content.includes('floor upper; true project level 6.25 m'));
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.routes[1].points.length, 4);
});

test('null waypoint and missing endpoint preserve ordered gaps and never create a phantom length/connection', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceRoutes = [route('ground', 'gap', ref('ground', 'source'), ref('upper', 'missing'), {
    via: [null, at('ground', 5, 3, 2), at('ground', 6, 3, 2)]
  })];
  const graph = Services.build(Projection.build(p), { systems: ['water', 'waste'] });
  assert.equal(graph.routes[0].lengthM, null);
  for (const view of ['plan', 'riser']) {
    const sheets = render(p, { view }), content = texts(sheets);
    assert.ok(content.includes('Point 1 (via 1): unknown (gap'));
    assert.ok(content.includes('Full 3D geometric length: unknown'));
    assert.ok(content.includes('MISSING NODE'));
    assert.ok(content.includes('ground:authored:gap'));
    assert.ok(sheets[0].primitives.some(p => p.type === 'text' && p.text === 'R1.p0?'));
    assert.ok(!sheets[0].primitives.some(p => p.type === 'text' && /^R1\.[124]\*/.test(p.text)));
    assert.ok(sheets[0].primitives.some(p => p.type === 'text' && p.text === 'R1.3*'));
  }
});

test('unregistered foreign floor warns with gaps; unregistered selected floor fails', () => {
  const p = project();
  p.floors[1].legacy.context = null;
  const sheets = render(p), content = texts(sheets);
  assert.ok(content.includes('unresolved floor geometry'));
  assert.ok(content.includes('unknown-level'));
  assert.ok(content.includes('Full 3D geometric length: unknown'));
  assert.throws(() => render(p, { floorId: 'upper' }), /missing selected geometry/);
});

test('separate cold/hot/soil/waste/vent intents retain circuits and all distinct purpose keys', () => {
  const p = project(), g = p.floors[0].authored, u = p.floors[1].authored;
  g.serviceNodes = []; g.serviceRoutes = []; u.serviceNodes = []; u.fixtures = [];
  ['cold', 'hot', 'soil', 'waste', 'vent'].forEach((circuit, i) => {
    const system = i < 2 ? 'water' : 'waste', purpose = ['port', 'valve', 'trap', 'cleanout', 'stack'][i];
    g.serviceNodes.push(node('ground', `n${i}`, i === 0 ? 'fixture' : 'junction',
      { system, circuit, role: purpose, anchor: at('ground', 2 + i, 3) }));
    u.serviceNodes.push(node('upper', `root${i}`, i < 2 ? 'supply' : 'outlet',
      { system, circuit, anchor: at('upper', 2 + i, 4) }));
    g.serviceRoutes.push(route('ground', `r${i}`, ref('ground', `n${i}`), ref('upper', `root${i}`), { system, circuit }));
  });
  for (const view of ['plan', 'riser']) {
    const sheets = render(p, { view }), content = texts(sheets);
    for (const circuit of ['cold', 'hot', 'soil', 'waste', 'vent']) assert.ok(content.includes(`circuit: ${circuit}`));
    for (const purpose of ['P', 'V', 'T', 'C', 'S']) assert.ok(sheets[0].primitives.some(p => p.type === 'text' && p.text.includes(`[${purpose}]`)));
    assert.ok(content.includes('NOT physical pipe widths or fitting internals'));
  }
  const water = texts(render(p, { systems: ['water'] }));
  assert.ok(!water.includes('circuit: soil'));
  assert.throws(() => render(p, { systems: ['rain'] }), /rain is deferred/);
});

test('fixture footprint requires supplied width/depth; no guessed fixture ports or fitting internals', () => {
  const p = project();
  const withSize = render(p, { floorId: 'upper' });
  assert.ok(texts(withSize).includes('Supplied W / D / H: 0.6 m / 0.4 m / unknown'));
  const f = p.floors[1].authored.fixtures[0];
  f.widthM = null;
  const missing = render(p, { floorId: 'upper' });
  assert.ok(texts(missing).includes('Missing-size marker only'));
  assert.ok(missing[0].primitives.some(p => p.type === 'text' && /^F\d+\?/.test(p.text)));
  assert.equal(Services.build(Projection.build(p)).nodes.length, 3);
});

test('wall underlay uses physical solid sections at 1.2 m and does not refill door/window cuts', () => {
  const scene = copy(Projection.build(project()));
  scene.scenes[0].walls = [{ id: 'cut-wall', start: { x: 1, y: 7 }, end: { x: 11, y: 7 },
    thicknessM: .2, baseM: .45, heightM: 3, solidSections: [
      { startM: 0, endM: 2, sillM: 0, heightM: 3 },
      { startM: 2, endM: 4, sillM: 2.2, heightM: .8 },
      { startM: 4, endM: 6, sillM: 0, heightM: 3 },
      { startM: 6, endM: 8, sillM: 0, heightM: .9 },
      { startM: 6, endM: 8, sillM: 2.1, heightM: .9 },
      { startM: 8, endM: 10, sillM: 0, heightM: 3 }
    ] }];
  const sheet = Renderer.createSheets(scene, options)[0];
  const solids = sheet.primitives.filter(p => p.type === 'path' && p.fill === '#D4DADC');
  assert.equal(solids.length, 3);
  for (const p of solids) assert.ok(Math.abs(p.commands[1][1] - p.commands[0][1] - 20) < 1e-8);
  const ranges = solids.map(p => [p.commands[0][1], p.commands[1][1]]);
  assert.ok(Math.abs(ranges[1][0] - ranges[0][1] - 20) < 1e-8);
  assert.ok(Math.abs(ranges[2][0] - ranges[1][1] - 20) < 1e-8);
});

test('ordinary five-node four-route network prints all warnings on readable A2 continuation pages', () => {
  const p = project(), g = p.floors[0].authored;
  p.floors[1].authored = Model.emptyAuthored();
  g.serviceNodes = Array.from({ length: 5 }, (_, i) => node('ground', `n${i}`, 'junction',
    { anchor: at('ground', 2 + i, 3), circuit: null }));
  g.serviceRoutes = Array.from({ length: 4 }, (_, i) =>
    route('ground', `r${i}`, ref('ground', `n${i}`), ref('ground', `n${i + 1}`), { circuit: null }));
  const model = Services.build(Projection.build(p), { systems: ['water', 'waste'] });
  assert.ok(model.findings.length >= 14);
  const sheets = render(p), content = texts(sheets);
  assert.ok(sheets.length > 1 && sheets.length <= 100);
  for (const f of model.findings) assert.ok(content.includes(f.code) && content.includes(f.message), f.code);
  assert.ok(content.includes('Unknown field/point count'));
  assert.ok(content.includes('NOT a procurement estimate'));
  assert.ok(content.includes('No assumed terrain, drain falls'));
});

test('long full IDs and label text are retained across dense continuation pages', () => {
  const p = project(), label = 'Full fixture route claim ' + 'ABCDEFGHIJ'.repeat(300);
  p.floors[0].authored.serviceRoutes[0].label = label;
  const sheets = render(p);
  assert.ok(sheets.length > 2);
  assert.ok(texts(sheets).includes(label));
});

test('off-plot foreign geometry fails rather than fitting, clipping or dropping it', () => {
  const p = project();
  p.floors[1].authored.fixtures[0].anchor = at('upper', 200, 3);
  assert.throws(() => render(p), /Fixed scale.*off-plot\/foreign.*No automatic shrink/);
  p.floors[1].authored.fixtures[0].anchor = at('upper', 6, 3, 100);
  assert.throws(() => render(p, { view: 'riser' }), /Fixed vertical scale/);
  for (const bad of [{ view: 'section' }, { layers: {} }, { maxPages: 3 }, { systems: ['water', 'water'] },
    { scaleDenominator: 20 }, { view: undefined }, { systems: null }, { title: null }]) assert.throws(() => render(project(), bad));
});

test('all media/orientations retain readable continuation and never shrink riser scale', () => {
  const p = project();
  p.floors.forEach(f => { f.authored = Model.emptyAuthored(); });
  for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
    const sheets = render(p, { view: 'riser', paper, orientation });
    assert.ok(sheets.length > 0);
    for (const sheet of sheets) {
      Drawing.validateSheet(sheet);
      assert.equal(sheet.metadata.scaleDenominator, 100);
      assert.ok(sheet.primitives.filter(p => p.type === 'text').every(p => p.fontSizeMm >= 2));
    }
  }
});

test('projected overlaps keep separate stable keys and explicit warnings without lateral offsets', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceNodes.push(node('ground', 'same-place', 'junction', { role: 'cleanout', anchor: at('ground', 4, 2) }));
  g.serviceRoutes = [
    route('ground', 'a', ref('ground', 'source'), ref('ground', 'valve')),
    route('ground', 'b', ref('ground', 'source'), ref('ground', 'same-place'))
  ];
  const sheets = render(p), content = texts(sheets), axes = paths(sheets[0], '#246DA0').filter(p => p.commands.length === 2);
  assert.ok(content.includes('Projected glyphs overlap or coincide'));
  assert.ok(content.includes('Projected axes overlap'));
  assert.deepEqual(axes[0].commands, axes[1].commands);
  const labels = sheets[0].primitives.filter(p => p.type === 'text' && /^(N\d+\[|R\d+\.)/.test(p.text));
  for (let i = 0; i < labels.length; i++) for (let j = 0; j < i; j++) {
    const a = labels[i], b = labels[j], w = s => Array.from(s.text).length * s.fontSizeMm * 1.1;
    assert.ok(a.xMm + w(a) <= b.xMm || b.xMm + w(b) <= a.xMm ||
      a.yMm + .3 * a.fontSizeMm <= b.yMm - b.fontSizeMm ||
      b.yMm + .3 * b.fontSizeMm <= a.yMm - a.fontSizeMm, `${a.text}/${b.text}`);
  }
});

test('100-page cap rejects excessive real long-label schedules instead of partially returning pages', () => {
  const p = project(), g = p.floors[0].authored;
  p.floors[1].authored = Model.emptyAuthored();
  g.serviceNodes = [node('ground', 'n0', 'junction', { anchor: null })];
  g.serviceRoutes = Array.from({ length: 24 }, (_, i) => route('ground', `r${i}`,
    ref('ground', 'n0'), ref('ground', 'n0'), { label: 'W'.repeat(16384) }));
  assert.throws(() => render(p, { view: 'riser', paper: 'A4', orientation: 'portrait' }), /100 pages/);
});

test('physical PDF media, complete page count, labels and searchable warning text survive export', async () => {
  const sheets = render(project()), bytes = await Export.pdfBytes(sheets);
  const pdf = await PDF.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), sheets.length);
  let extracted = '';
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 594 * 72 / 25.4) < .01);
    assert.ok(Math.abs(page.getHeight() - 420 * 72 / 25.4) < .01);
    const contents = page.node.Contents();
    const content = Array.from({ length: contents.size() }, (_, i) =>
      Buffer.from(PDF.decodePDFRawStream(pdf.context.lookup(contents.get(i))).decode()).toString('latin1')).join('');
    assert.ok(content.includes('Tj'));
    assert.ok(!/\bDo\b/.test(content), 'PDF must remain vector/text, not a raster diagram');
    extracted += [...content.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map(m => Buffer.from(m[1], 'hex').toString('latin1').replace(/^\| /, '')).join('');
  }
  assert.ok(Renderer.toSVG(sheets[0]).includes('width="594mm"'));
  assert.ok(texts(sheets).includes('N1[I]'));
  assert.ok(texts(sheets).includes('NOT ENGINEERED'));
  assert.ok(extracted.includes('N1[I]'));
  assert.ok(extracted.includes('ID: ground:authored:riser'));
  assert.ok(extracted.includes('NOT ENGINEERED / NOT FOR CONSTRUCTION'));
});
