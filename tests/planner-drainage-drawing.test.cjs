const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Drainage = require('../planner-drainage.js');
const Drawing = require('../planner-drawing.js');
const Renderer = require('../planner-drainage-drawing.js');
const Export = require('../planner-drawing-export.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const id = (floor, name) => `${floor}:authored:${name}`;
const ref = (floor, name) => ({ floorId: floor, entityId: id(floor, name) });
const at = (floor, x, y, z = 2) => ({ kind: 'point', floorId: floor, point: { x, y, z } });
const node = (floor, name, x, y, invertM = 2, extra = {}) => ({
  id: id(floor, name), system: 'waste', kind: 'junction', anchor: at(floor, x, y),
  diameterMm: 100, invertM, circuit: 'soil', ...extra
});
const route = (floor, name, from, to, extra = {}) => ({
  id: id(floor, name), system: 'waste', from, to, via: [], diameterMm: 100,
  slope: .02, circuit: 'soil', clearanceM: .05, ...extra
});
function project() {
  const p = createFixture('multiple-floors').project;
  for (const f of p.floors) {
    f.legacy.context.plate.sitePlot = { x: -1, y: -2, w: 12, h: 12 };
    f.authored = Model.emptyAuthored();
  }
  p.legacy = copy(p.floors[0].legacy);
  p.floors[0].authored.serviceNodes = [
    node('ground', 'a', 0, 0, 2, { kind: 'fixture', role: 'floor-trap' }),
    node('ground', 'b', 10, 0, 1.8, { kind: 'outlet', role: 'outfall' })
  ];
  p.floors[0].authored.serviceRoutes = [route('ground', 'ab', ref('ground', 'a'), ref('ground', 'b'))];
  return p;
}
const options = { floorId: 'ground', paper: 'A3', orientation: 'landscape', scaleDenominator: 100, units: 'metric' };
const render = (p, opt = {}) => Renderer.createSheets(Projection.build(p), { ...options, ...opt });
const texts = pages => pages.flatMap(s => s.primitives.filter(p => p.type === 'text').map(p => p.text.replace(/^\| /, ''))).join('');
const bodyLines = pages => pages.flatMap(s => s.primitives.filter(p => p.type === 'text' && p.text.startsWith('| ')).map(p => p.text.slice(2))).join('');
const axes = sheet => sheet.primitives.filter(p => p.type === 'path' && p.strokeWidthMm === .3 && p.stroke === '#795439');
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function freeze(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
const rendererSource = fs.readFileSync(require.resolve('../planner-drainage-drawing.js'), 'utf8');

test('frozen exact shared API, browser parity, one build, deterministic output and no mutation', () => {
  assert.deepEqual(Object.keys(Renderer), ['createSheets', 'createSheet', 'toSVG']);
  assert.ok(Object.isFrozen(Renderer));
  const p = freeze(project()), beforeP = JSON.stringify(p), scene = freeze(Projection.build(p)), before = JSON.stringify(scene);
  let builds = 0;
  const sandbox = { HomePlannerModel: Model, HomePlannerDrainage: { build: (...args) => {
    builds++; assert.deepEqual(copy(args[1]), { systems: ['waste', 'rain'] }); return Drainage.build(...args);
  } }, scene };
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-drawing.js'), 'utf8'), sandbox);
  vm.runInNewContext(rendererSource, sandbox);
  const browser = vm.runInNewContext('HomePlannerDrainageDrawing.createSheets(scene, {floorId:"ground"})', sandbox);
  const pages = Renderer.createSheets(scene, options);
  assert.equal(builds, 1); assert.deepEqual(copy(browser), pages);
  assert.deepEqual(Renderer.createSheets(scene, options), pages);
  assert.equal(JSON.stringify(scene), before); assert.equal(JSON.stringify(p), beforeP);
  assert.ok(Object.isFrozen(pages) && Object.isFrozen(pages[0].primitives[0]));
  for (const page of pages) {
    assert.deepEqual(Object.keys(page), ['version', 'widthMm', 'heightMm', 'metadata', 'primitives']);
    assert.deepEqual(Object.keys(page.metadata), ['projectId', 'revision', 'floorId', 'floorName', 'title',
      'paper', 'orientation', 'scaleDenominator', 'units', 'assumptions']);
    assert.equal(Drawing.validateSheet(page), page);
    assert.equal(Renderer.toSVG(page), Drawing.toSVG(page));
    assert.ok(page.primitives.filter(p => p.type === 'text').every(p => p.fontSizeMm >= 2));
    for (const note of ['AUTHORED DRAINAGE INTENT', 'selected-floor-owned', 'Anchor z is NEVER invert', 'systems waste, rain'])
      assert.ok(texts([page]).includes(note), note);
  }
  assert.throws(() => Renderer.createSheet(scene, options), /createSheets.*No automatic shrink/);
  assert.throws(() => Renderer.toSVG(scene, options), /createSheets/);
  const empty = {};
  vm.runInNewContext(rendererSource, empty);
  assert.throws(() => empty.HomePlannerDrainageDrawing.createSheets(scene), /Load HomePlannerDrawing and HomePlannerDrainage/);
});

test('strict options and floor identity; no arbitrary rescale, unknown keys, nulls or sparse selections', () => {
  for (const opt of [
    { floorId: 'missing' }, { floorId: '' }, { view: 'riser' }, { view: 'section' }, { view: undefined },
    { systems: ['water'] }, { systems: ['waste', 'waste'] }, { systems: [undefined] }, { systems: Array(1) },
    { systems: null }, { systems: undefined }, { systems: 'rain' }, { layers: {} }, { maxPages: 5 },
    { scaleDenominator: 20 }, { scaleDenominator: 0 }, { units: 'meters' }, { paper: 'A0' },
    { paper: 'toString' }, { orientation: 'square' }, { title: null }, { title: '' }, { floorName: '\n' }
  ]) assert.throws(() => render(project(), opt), undefined, JSON.stringify(opt));
  const scene = Projection.build(project());
  for (const opt of [null, [], 3]) assert.throws(() => Renderer.createSheets(scene, opt));
  assert.throws(() => Renderer.createSheets({ ...scene, kind: 'fake' }, options), /DrawingScene/);
  const p = project(); p.floors[1].legacy.context = null;
  assert.throws(() => render(p, { floorId: 'upper' }), /missing selected geometry/);
  assert.throws(() => Renderer.createSheets({ ...scene, scenes: [...scene.scenes, scene.scenes[0]] }, options), /registered/);
});

test('10 m run and independently supplied .2 m fall plot at exactly 100 mm / 2 mm at 1:100', () => {
  for (const units of ['metric', 'imperial']) {
    const p = project(), pages = render(p, { view: 'profile', units }), lines = axes(pages[0]);
    assert.equal(lines.length, 1);
    const [a, b] = lines[0].commands;
    approx(b[1] - a[1], 100); approx(b[2] - a[2], 2);
    assert.ok(texts(pages).includes('Horizontal XY chainage 1:100; vertical independent invert 1:100'));
    assert.ok(texts(pages).includes('Measured endpoint fall:'));
    assert.ok(texts(pages).includes('Supplied slope intention fall/run: 0.02'));
    assert.ok(texts(pages).includes('axis z 2.45 m') || units === 'imperial');
    p.floors[0].authored.serviceNodes[0].anchor.point.z = 90;
    assert.deepEqual(axes(render(p, { view: 'profile', units })[0]), lines, 'axis z cannot alter invert profile');
  }
  for (const scaleDenominator of [50, 75, 100]) {
    const [a, b] = axes(render(project(), { view: 'profile', scaleDenominator, paper: 'A2' })[0])[0].commands;
    approx(b[1] - a[1], 10000 / scaleDenominator); approx(b[2] - a[2], 200 / scaleDenominator);
  }
});

test('null invert gaps never interpolate, even if endpoint fall and intent agree', () => {
  const p = project(), r = p.floors[0].authored.serviceRoutes[0];
  r.via = [at('ground', 2, 0), at('upper', 8, 0, 20)];
  r.viaInvertsM = [1.96, null];
  const pages = render(p, { view: 'profile' }), lines = axes(pages[0]);
  assert.equal(lines.length, 1);
  approx(lines[0].commands[1][1] - lines[0].commands[0][1], 20);
  approx(lines[0].commands[1][2] - lines[0].commands[0][2], .4);
  assert.ok(bodyLines(pages).includes('Cumulative chainage: 8 m; independently supplied invert: unknown'));
  assert.ok(bodyLines(pages).includes('Measured endpoint fall: 0.2 m'));
  assert.ok(bodyLines(pages).includes('profile complete: false'));
  assert.ok(!pages[0].primitives.some(p => p.type === 'text' && /^R1\.[23]$/.test(p.text)));
});

test('later local run/fall survives unknown cumulative station in schedule, never restarts geometry', () => {
  const p = project(), r = p.floors[0].authored.serviceRoutes[0];
  r.via = [at('ground', 2, 0), null, at('ground', 8, 0)];
  r.viaInvertsM = [1.96, 1.9, 1.84];
  const pages = render(p, { view: 'profile' }), content = bodyLines(pages);
  assert.equal(axes(pages[0]).length, 1);
  assert.ok(content.includes('Cumulative chainage: unknown; independently supplied invert: 1.84 m'));
  assert.ok(content.includes('local horizontal run: 2 m'));
  assert.ok(content.includes('Measured fall: 0.04 m'));
  assert.ok(content.includes('"fromIndex":3,"toIndex":4,"horizontalRunM":2'));
  assert.ok(!pages[0].primitives.some(p => p.type === 'text' && /R1\.(4|p[34])$/.test(p.text)));
  const plan = render(p);
  assert.equal(axes(plan[0]).length, 2, 'plan can draw independently known later XY segment');
});

test('vertical drop has same chainage and known levels; no synthetic gradient', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceNodes[1].anchor = at('ground', 0, 0, 2);
  const pages = render(p, { view: 'profile' }), [a, b] = axes(pages[0])[0].commands;
  approx(a[1], b[1]); approx(b[2] - a[2], 2);
  assert.ok(bodyLines(pages).includes('measured gradient: unknown; vertical drop: true'));
  assert.ok(bodyLines(pages).includes('Full XY horizontal run: 0 m'));
  assert.ok(!texts(pages).includes('Infinity'));
});

test('vent, unresolved gravity and absent adjacent known levels remain explicitly unavailable, retaining inputs', () => {
  for (const circuit of ['vent', null, 'soil']) {
    const p = project(), g = p.floors[0].authored;
    g.serviceNodes.forEach(n => { n.circuit = circuit; });
    g.serviceRoutes[0].circuit = circuit;
    g.serviceRoutes[0].slopeSource = 'engineer-provided';
    g.serviceRoutes[0].slopeReference = 'RAW REFERENCE KEEP';
    if (circuit === 'soil') { g.serviceRoutes[0].via = [at('ground', 5, 0)]; g.serviceRoutes[0].viaInvertsM = [null]; }
    const pages = render(p, { view: 'profile' }), content = bodyLines(pages);
    assert.equal(axes(pages[0]).length, 0);
    assert.ok(texts([pages[0]]).includes('PROFILE UNAVAILABLE:'));
    assert.ok(content.includes('RAW REFERENCE KEEP'));
    assert.ok(content.includes('"invertM":2'));
    assert.ok(content.includes('Supplied slope intention fall/run: 0.02'));
    assert.ok(content.includes(circuit === 'vent' ? 'vent intent' : circuit === null ? 'unknown or contradictory' : 'no adjacent known'));
  }
});

test('multiple mixed-floor profiles include all own and endpoint-touching routes, full foreign spans, stable identities', () => {
  const p = project(), g = p.floors[0].authored, u = p.floors[1].authored;
  u.serviceNodes = [node('upper', 'c', 8, 2, 1.5), node('upper', 'd', 9, 2, 1.4)];
  g.serviceRoutes.push(route('ground', 'foreign-owned', ref('upper', 'c'), ref('upper', 'd')));
  u.serviceRoutes.push(route('upper', 'incoming', ref('upper', 'd'), ref('ground', 'b'), {
    via: [at('upper', 10, 3, 15)], viaInvertsM: [1.3]
  }));
  const model = Drainage.build(Projection.build(p));
  for (const view of ['plan', 'profile']) {
    const pages = render(p, { view }), content = bodyLines(pages);
    for (const r of model.routes) {
      assert.ok(content.includes(`ID: ${r.id}; owner floor:`));
      assert.ok(content.includes(JSON.stringify(r.from)));
      assert.ok(content.includes(JSON.stringify(r.to)));
      assert.ok(content.includes(`Full XY horizontal run: ${Number(r.profile.horizontalLengthM.toFixed(6))} m`));
    }
    assert.ok(content.includes('FOREIGN referenced endpoint'));
    assert.ok(content.includes('REFERENCED incoming/outgoing route'));
    assert.ok(content.includes('"floorId":"upper","point":{"x":10,"y":3,"z":15}'));
    if (view === 'profile') assert.equal(pages.filter(s => texts([s]).includes(' PROFILE / ')).length, 3);
  }
  const upper = bodyLines(render(p, { floorId: 'upper', view: 'profile' }));
  assert.ok(!upper.includes('ID: ground:authored:ab; owner floor:'));
  assert.ok(upper.includes('ID: ground:authored:foreign-owned; owner floor:'));
});

test('sanitary/storm selection is explicit, unrelated project warnings survive floor scoping', () => {
  const p = project(), u = p.floors[1].authored;
  u.serviceNodes = [node('upper', 'rain-in', 1, 2, 2, { system: 'rain', circuit: 'storm', kind: 'fixture', role: 'roof-outlet' }),
    node('upper', 'rain-out', 2, 2, 1.9, { system: 'rain', circuit: 'storm', kind: 'outlet', role: 'outfall' })];
  u.serviceRoutes = [route('upper', 'rain-route', ref('upper', 'rain-in'), ref('upper', 'rain-out'), { system: 'rain', circuit: 'storm' })];
  const rain = render(p, { systems: ['rain'], view: 'profile' }), rainText = bodyLines(rain);
  assert.ok(!rainText.includes('ground:authored:ab'));
  assert.ok(rainText.includes('upper:authored:rain-route'), 'project-wide findings outside diagram remain printed');
  assert.ok(texts([rain[0]]).includes('no scoped route'));
  const sanitary = bodyLines(render(p, { systems: ['waste'] }));
  assert.ok(!sanitary.includes('upper:authored:rain-route'));
  assert.ok(sanitary.includes('engineering-not-assessed'));
  assert.ok(sanitary.includes('coordination-incomplete'));
  const upper = render(p, { floorId: 'upper', systems: ['rain'] });
  assert.ok(upper[0].primitives.some(p => p.type === 'path' && p.stroke === '#246DA0' && p.strokeWidthMm === .3));
  assert.ok(texts([upper[0]]).includes('[RO]'));
  assert.ok(!texts(upper).includes('rain-coordination-deferred'));
});

test('actual plot boundary, physical wall underlay and off-plot route geometry are not setback-clipped', () => {
  const p = project(), scene = Projection.build(p), pages = render(p), plot = scene.scenes[0].plot;
  const rectangle = pages[0].primitives.find(p => p.type === 'path' && p.fill === null &&
    p.stroke === '#D4DADC' && p.commands.length === 5);
  approx(rectangle.commands[1][1] - rectangle.commands[0][1], plot.w * 10);
  approx(rectangle.commands[2][2] - rectangle.commands[1][2], plot.h * 10);
  assert.ok(pages[0].primitives.some(p => p.type === 'path' && p.fill === '#D4DADC'));
  assert.ok(!bodyLines(pages).includes('outside-property-boundary'));
  p.floors[0].authored.serviceNodes[1].anchor = at('ground', 13, 0);
  const outside = render(p);
  approx(axes(outside[0])[0].commands[1][1] - axes(outside[0])[0].commands[0][1], 130);
  assert.ok(bodyLines(outside).includes('outside-property-boundary'));
  p.floors[0].authored.serviceNodes[1].anchor = at('ground', 200, 0);
  assert.throws(() => render(p), /Fixed scale.*foreign\/off-plot.*No automatic shrink/);
  assert.throws(() => render(p, { view: 'profile' }), /Fixed scale/);
});

test('dense paginated schedules retain complete provenance, findings, components and qualified references', () => {
  const p = project(), g = p.floors[0].authored;
  const source = 'Survey source ' + 'ABCDEFGHIJ'.repeat(950) + ' END SOURCE';
  Object.assign(g.serviceNodes[1], { groundM: 3, finishedFloorM: 3.1, levelSource: 'surveyed',
    levelReference: source, accessRadiusM: .5, discharge: { kind: 'sewer', reference: 'UNVERIFIED EXTERNAL REFERENCE' } });
  g.serviceRoutes[0].slopeReference = 'Unvalidated slope claim';
  const model = Drainage.build(Projection.build(p)), pages = render(p), content = bodyLines(pages);
  assert.ok(pages.length > 5);
  assert.ok(content.includes(source));
  assert.ok(content.includes('UNVERIFIED EXTERNAL REFERENCE'));
  assert.ok(content.includes('Unvalidated slope claim'));
  assert.ok(content.includes('nominal diameter: 100 mm; access review radius: 0.5 m'));
  for (const f of model.findings) {
    assert.ok(content.includes(f.message), f.code);
    assert.ok(content.includes(`qualified entityRefs: ${JSON.stringify(f.entityRefs)}`));
    if (f.componentId) assert.ok(content.includes(f.componentId));
  }
  assert.ok(texts([pages.at(-1)]).includes(`Page ${pages.length}/${pages.length}`));
});

test('short labels have collision-free measured paper boxes and never overlay raw UUID-like IDs', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceNodes.push(node('ground', 'coincident-long-identity'.repeat(5), 10, 0, 1.8, { role: 'cleanout' }));
  g.serviceRoutes.push(route('ground', 'duplicate', ref('ground', 'a'),
    { floorId: 'ground', entityId: g.serviceNodes[2].id }));
  for (const view of ['plan', 'profile']) {
    const pages = render(p, { view });
    for (const page of pages.filter(p => !texts([p]).includes('FULL SCHEDULE / PROJECT WARNINGS'))) {
      const labels = page.primitives.filter(p => p.type === 'text' && /^(N\d+\[|R\d+\.)/.test(p.text));
      assert.ok(labels.length);
      assert.ok(!page.primitives.some(p => p.type === 'text' && p.text.includes('ground:authored:')));
      for (let i = 0; i < labels.length; i++) for (let j = 0; j < i; j++) {
        const a = labels[i], b = labels[j], width = p => Array.from(p.text).length * p.fontSizeMm * 1.1;
        assert.ok(a.xMm + width(a) <= b.xMm || b.xMm + width(b) <= a.xMm ||
          a.yMm + .3 * a.fontSizeMm <= b.yMm - b.fontSizeMm ||
          b.yMm + .3 * b.fontSizeMm <= a.yMm - a.fontSizeMm, `${a.text}/${b.text}`);
      }
    }
  }
});

test('empty/unknown profiles remain visible and all paper/orientation presets keep shared sheet validation', () => {
  const p = project();
  p.floors.forEach(f => { f.authored = Model.emptyAuthored(); });
  for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
    const pages = render(p, { view: 'profile', paper, orientation, systems: [] });
    assert.ok(texts(pages).includes('PROFILE UNAVAILABLE'));
    pages.forEach(page => Drawing.validateSheet(page));
  }
  const scene = Projection.build(p), singleOptions = { ...options, view: 'profile', systems: [], paper: 'A2' };
  const single = Renderer.createSheet(scene, singleOptions);
  assert.deepEqual([single], Renderer.createSheets(scene, singleOptions));
  assert.equal(Renderer.toSVG(scene, singleOptions), Drawing.toSVG(single));
  const q = project();
  q.floors[0].authored.serviceNodes.forEach(n => { n.anchor = null; n.invertM = null; });
  assert.ok(texts(render(q, { view: 'profile' })).includes('PROFILE UNAVAILABLE:'));
});

test('excessive schedules hit bounded pages or explicit text budget without returning partial output', () => {
  const p = project(), g = p.floors[0].authored;
  g.serviceNodes = [node('ground', 'a', 0, 0, null, { anchor: null })];
  g.serviceRoutes = Array.from({ length: 7 }, (_, i) => route('ground', `r${i}`, ref('ground', 'a'), ref('ground', 'a'),
    { label: 'W'.repeat(16384) }));
  assert.throws(() => render(p, { view: 'profile', paper: 'A4', orientation: 'portrait' }), /100 pages/);
  g.serviceRoutes = Array.from({ length: 18 }, (_, i) => route('ground', `r${i}`, ref('ground', 'a'), ref('ground', 'a'),
    { label: 'W'.repeat(16384) }));
  assert.throws(() => render(p, { view: 'profile' }), /500000 source characters/);
});

test('PDF preserves exact shared multi-page physical media, vector geometry, complete warning text and profile dimensions', async () => {
  const pages = render(project(), { view: 'profile' }), before = JSON.stringify(pages), bytes = await Export.pdfBytes(pages);
  const pdf = await PDF.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), pages.length);
  let extracted = '';
  for (const page of pdf.getPages()) {
    approx(page.getWidth(), 420 * 72 / 25.4); approx(page.getHeight(), 297 * 72 / 25.4);
    const contents = page.node.Contents();
    const stream = Array.from({ length: contents.size() }, (_, i) =>
      Buffer.from(PDF.decodePDFRawStream(pdf.context.lookup(contents.get(i))).decode()).toString('latin1')).join('');
    assert.ok(stream.includes('Tj')); assert.ok(!/\bDo\b/.test(stream), 'not raster PDF');
    extracted += [...stream.matchAll(/<([0-9a-f]+)>\s*Tj/gi)]
      .map(m => Buffer.from(m[1], 'hex').toString('latin1').replace(/^\| /, '')).join('');
  }
  assert.ok(extracted.includes('R1.p0'));
  assert.ok(extracted.includes('engineering-not-assessed'));
  assert.ok(extracted.includes('Horizontal XY chainage 1:100'));
  assert.ok(Renderer.toSVG(pages[0]).includes('width="420mm"'));
  assert.equal(JSON.stringify(pages), before);
});

test('UTF source is retained in SVG; shared PDF fails explicitly rather than losing text', async () => {
  const p = project();
  p.floors[0].authored.serviceNodes[1].levelReference = '測量 источник स्रोत';
  const pages = render(p), svgs = pages.map(Renderer.toSVG).join('');
  assert.ok(svgs.includes('測量'));
  assert.ok(bodyLines(pages).includes('測量 источник स्रोत'));
  await assert.rejects(Export.pdfBytes(pages), /Helvetica\/WinAnsi cannot encode.*Use SVG or PNG.*No text was replaced/);
});

test('shared PNG adapter consumes the exact shared SVG sheet and physical dpi size without a drainage-specific backend', async () => {
  const sheet = render(project(), { view: 'profile' })[0], seen = [], sizes = [];
  const context = {
    Blob, setTimeout, clearTimeout,
    HomePlannerDrawing: { validateSheet: Drawing.validateSheet, toSVG: value => { seen.push(value); return Drawing.toSVG(copy(value)); } },
    URL: { createObjectURL: () => 'blob:drainage', revokeObjectURL() {} },
    Image: class { set src(v) { if (v) queueMicrotask(() => this.onload?.()); } },
    document: { createElement: name => {
      assert.equal(name, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, type) { sizes.push([this.width, this.height]); callback(new Blob(['png'], { type })); } };
    } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-drawing-export.js'), 'utf8'), context);
  const blob = await context.HomePlannerDrawingExport.pngBlob(sheet, { pixelsPerMm: 96 / 25.4 });
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(copy(seen[0]), sheet);
  assert.deepEqual(sizes, [[Math.floor(sheet.widthMm * (96 / 25.4)), Math.floor(sheet.heightMm * (96 / 25.4))]]);
});
