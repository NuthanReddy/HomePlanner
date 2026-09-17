const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Drawing = require('../planner-drawing.js');
const Structure = require('../planner-structure.js');
const Renderer = require('../planner-structure-drawing.js');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const PDFExport = require('../planner-drawing-export.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
const point = (x, y, z = 0) => ({ x, y, z });
function entry(kind, id = kind, extra = {}, anchors) {
  const positions = anchors || (['grid', 'beam'].includes(kind) ? [point(2, 2), point(6, 4)] : [point(4, 4)]);
  return { collection: 'structural', floorId: 'ground',
    record: { id: `ground:authored:${id}`, kind, anchors: [], widthM: kind === 'grid' ? null : .4,
      depthM: kind === 'grid' ? null : .6, heightM: ['grid', 'beam'].includes(kind) ? null : 1,
      material: kind === 'grid' ? null : 'Concrete', sizeSource: 'authored', ...extra },
    anchors: positions.map(p => p ? { status: 'resolved', point: p } : { status: 'unresolved', point: null }) };
}
function floor(id = 'ground', z = 0, size = 10) {
  return { floorId: id, floorElevationM: z, coordinateSpace: 'site-local', plot: { x: 0, y: 0, w: size, h: size },
    building: { x: 0, y: 0, w: size, h: size }, walls: [], openings: [], diagnostics: [], unresolvedOpenings: [] };
}
function scene(entries = [], floors = [floor()]) {
  return { version: 1, kind: 'DrawingScene', projectId: 'structural-print', revision: 7,
    inputFingerprint: 'captured-input', authored: entries, scenes: floors, diagnostics: [] };
}
const options = { floorId: 'ground', paper: 'A2', orientation: 'landscape', scaleDenominator: 100, units: 'metric' };
const create = (s, opt = {}) => Renderer.createSheet(s, { ...options, ...opt });
const createSet = (s, opt = {}) => Renderer.createSheets(s, { ...options, ...opt });
const texts = sheet => sheet.primitives.filter(p => p.type === 'text').map(p => p.text).join('');
const paths = (sheet, color) => sheet.primitives.filter(p => p.type === 'path' && p.stroke === color);
const segmentLength = p => Math.hypot(p.commands[1][1] - p.commands[0][1], p.commands[1][2] - p.commands[0][2]);
function deepFreeze(v) { Object.values(v).forEach(x => { if (x && typeof x === 'object') deepFreeze(x); }); return Object.freeze(v); }

test('global and CommonJS expose only the shared sheet API; SVG is the common serializer', () => {
  assert.deepEqual(Object.keys(Renderer).sort(), ['createSheet', 'createSheets', 'toSVG']);
  const sandbox = { HomePlannerDrawing: Drawing, HomePlannerStructure: Structure };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'planner-structure-drawing.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.HomePlannerStructureDrawing.createSheet, 'function');
  assert.equal(typeof sandbox.HomePlannerStructureDrawing.createSheets, 'function');
  const sheet = create(scene());
  assert.equal(Renderer.toSVG(sheet), Drawing.toSVG(sheet));
  assert.equal(Drawing.validateSheet(sheet), sheet);
  assert.ok(Object.isFrozen(sheet) && Object.isFrozen(sheet.primitives));
});

test('all five kinds and every relevant finding are printed without truncation', () => {
  const input = scene(['column', 'beam', 'slab', 'footing', 'grid'].map(kind => entry(kind)));
  const sheet = create(input), content = texts(sheet);
  for (const e of Structure.build(input).elements) {
    assert.ok(content.includes(e.id), e.id);
    assert.ok(content.includes(`| ${e.kind}`));
  }
  for (const f of Structure.build(input).findings) {
    assert.ok(content.includes(f.code), f.code);
    assert.ok(content.includes(f.message), f.message);
  }
  for (const phrase of ['sizeSource: authored', 'Reference: unknown', 'Material: Concrete', 'Bottom anchor elevations',
    'Top elevation', 'Rectangular footprint intent only', 'no volume', 'NOT ENGINEERED', 'seismic', 'rebar',
    'Soil, loads', 'not certification']) assert.ok(content.includes(phrase), phrase);
  for (const p of sheet.primitives.filter(p => p.type === 'text')) assert.ok(p.fontSizeMm >= 2);
  assert.equal(paths(sheet, '#263238').filter(p => p.commands.at(-1)[0] === 'Z').length, 1);
  assert.equal(paths(sheet, '#345C79').length, 1);
  assert.equal(paths(sheet, '#728571').length, 1);
  assert.equal(paths(sheet, '#8B6854').length, 1);
  assert.equal(paths(sheet, '#687B86')[0].commands.length, 2);
});

test('metric and imperial schedule use supplied dimensions and signed site elevations', () => {
  const input = scene([entry('column', 'metric', { widthM: .3048, depthM: .6096, heightM: .9144,
    label: 'C unit', reference: 'Claim only' }, [point(4, 4, -.3048)])]);
  const metric = texts(create(input)), imperial = texts(create(input, { units: 'imperial' }));
  assert.ok(metric.includes('0.3048 m / 0.6096 m / 0.9144 m'));
  assert.ok(metric.includes('Bottom anchor elevations: -0.3048 m'));
  assert.ok(imperial.includes(`1'-0" / 2'-0" / 3'-0"`));
  assert.ok(imperial.includes(`Bottom anchor elevations: -1'-0"`));
  assert.ok(imperial.includes(`Top elevation: 2'-0"`));
  assert.ok(imperial.includes('Claim only'));
});

test('a 10 m grid measures 100 mm at 1:100, same physical scale in both unit systems', () => {
  const input = scene([entry('grid', 'ten', {}, [point(0, 5), point(10, 5)])]);
  for (const units of ['metric', 'imperial']) {
    const sheet = create(input, { units });
    assert.equal(segmentLength(paths(sheet, '#687B86')[0]), 100);
    assert.ok(Renderer.toSVG(sheet).includes('width="594mm"'));
  }
  for (const scaleDenominator of [50, 75]) {
    const sheet = create(input, { scaleDenominator });
    assert.ok(Math.abs(segmentLength(paths(sheet, '#687B86')[0]) - 10000 / scaleDenominator) < 1e-9);
  }
});

test('beam footprint follows true diagonal site endpoints, not its AABB or depth', () => {
  const input = scene([entry('beam', 'diagonal', { widthM: .4, depthM: 2 }, [point(2, 2, 4), point(6, 5, 4)])]);
  const p = paths(create(input), '#345C79')[0], [a, b, c] = p.commands;
  assert.equal(p.commands.at(-1)[0], 'Z');
  assert.ok(Math.abs(b[1] - a[1] - 40) < 1e-9);
  assert.ok(Math.abs(b[2] - a[2] - 30) < 1e-9);
  assert.ok(Math.abs(Math.hypot(c[1] - b[1], c[2] - b[2]) - 4) < 1e-9);
  assert.ok(Math.abs((b[1] - a[1]) * (c[1] - b[1]) + (b[2] - a[2]) * (c[2] - b[2])) < 1e-8);
});

test('missing height means markers only, no invented column volume or top elevation', () => {
  const e = entry('column', 'missing', { heightM: null }), input = scene([e]);
  const sheet = create(input), content = texts(sheet);
  assert.equal(paths(sheet, '#263238').filter(p => p.commands.at(-1)[0] === 'Z').length, 0);
  assert.equal(paths(sheet, '#984921').length, 2);
  assert.ok(content.includes('S1?'));
  assert.ok(content.includes('Top elevation: unknown'));
  assert.ok(content.includes('unknown-dimensions'));
  assert.ok(content.includes('no geometry'));
  const unresolved = create(scene([entry('column', 'missing', { heightM: null }, [null])]));
  assert.equal(paths(unresolved, '#984921').length, 0);
  assert.ok(texts(unresolved).includes('location unknown, schedule only'));
});

test('selected floors do not leak another floor geometry or unrelated warnings', () => {
  const a = entry('grid', 'ground', {}, [point(1, 2), point(3, 2)]);
  const b = entry('grid', 'upper', {}, [point(4, 5, 8), point(9, 5, 8)]);
  b.floorId = 'upper'; b.record.id = 'upper:authored:grid';
  const input = scene([a, b], [floor(), floor('upper', 8)]);
  const lower = create(input), upper = create(input, { floorId: 'upper' });
  assert.equal(segmentLength(paths(lower, '#687B86')[0]), 20);
  assert.equal(segmentLength(paths(upper, '#687B86')[0]), 50);
  assert.ok(!texts(lower).includes(b.record.id));
  assert.ok(!texts(upper).includes(a.record.id));
  assert.ok(texts(upper).includes('elevation 8 m'));
});

test('vertical cut uses true solidSections and leaves door/window apertures faint and empty', () => {
  const input = scene();
  input.scenes[0].walls.push({ id: 'wall', start: point(0, 5), end: point(10, 5), thicknessM: .2, baseM: 0, heightM: 3,
    solidSections: [
      { startM: 0, endM: 2, sillM: 0, heightM: 3 },
      { startM: 2, endM: 4, sillM: 2.2, heightM: .8 },
      { startM: 4, endM: 6, sillM: 0, heightM: 3 },
      { startM: 6, endM: 8, sillM: 0, heightM: .9 },
      { startM: 6, endM: 8, sillM: 2.1, heightM: .9 },
      { startM: 8, endM: 10, sillM: 0, heightM: 3 }
    ] });
  const solids = paths(create(input), '#D4DADC').filter(p => p.fill);
  assert.equal(solids.length, 3);
  for (const p of solids) assert.ok(Math.abs(segmentLength(p) - 20) < 1e-9);
  const ranges = solids.map(p => [p.commands[0][1], p.commands[1][1]]);
  assert.ok(Math.abs(ranges[1][0] - ranges[0][1] - 20) < 1e-9);
  assert.ok(Math.abs(ranges[2][0] - ranges[1][1] - 20) < 1e-9);
  input.scenes[0].walls[0].removed = true;
  assert.equal(paths(create(input), '#D4DADC').filter(p => p.fill).length, 0);
  delete input.scenes[0].walls[0].removed;
  delete input.scenes[0].walls[0].solidSections;
  assert.throws(() => create(input), /solidSections/);
});

test('real Model/Projection fixture renders without mutating captured input', () => {
  const project = createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot = { x: 0, y: 0, w: 10, h: 8 };
  project.legacy = copy(project.floors[0].legacy);
  project.floors[0].authored = Model.emptyAuthored();
  project.floors[0].authored.structural = [{ id: 'ground:authored:column', kind: 'column',
    anchors: [{ kind: 'point', floorId: 'ground', point: point(2, 2) }],
    widthM: .4, depthM: .5, heightM: 2.8, material: 'Concrete', sizeSource: 'authored' }];
  const projected = Projection.build(project), before = JSON.stringify(projected);
  deepFreeze(projected);
  const result = create(projected, { floorId: project.floors[0].id });
  assert.equal(Drawing.validateSheet(result), result);
  assert.equal(JSON.stringify(projected), before);
});

test('A4/A3/A2 portrait/landscape fit only at explicitly selected physical scales', () => {
  for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
    const sheet = create(scene([], [floor('ground', 0, 1)]), { paper, orientation });
    assert.equal(sheet.metadata.paper, paper);
    assert.equal(sheet.metadata.orientation, orientation);
    assert.equal(Drawing.validateSheet(sheet), sheet);
  }
  assert.throws(() => create(scene([], [floor('ground', 0, 100)])), /Fixed scale.*larger paper.*No automatic shrink/i);
  const offPlot = scene([entry('grid', 'outside', {}, [point(2, 2), point(100, 2)])]);
  assert.throws(() => create(offPlot), /including off-plot geometry/);
});

test('dense schedules and long references fail actionably instead of dropping any warning', () => {
  const dense = scene(Array.from({ length: 35 }, (_, i) => entry('column', `c${i}`)));
  assert.throws(() => create(dense), /Full schedule.*createSheets.*fewer elements.*No automatic shrink or truncation/i);
  assert.throws(() => create(scene([entry('column', 'long', { reference: 'W'.repeat(12000) })])),
    /Full schedule|bounded readable/);
});

test('stable keyed labels are outside structural footprints and other labels', () => {
  const input = scene([entry('slab', 'z', { widthM: 6, depthM: 6 }), entry('column', 'a')]);
  const sheet = create(input);
  const labels = sheet.primitives.filter(p => p.type === 'text' && /^S\d+$/.test(p.text));
  assert.equal(labels.length, 2);
  const slabs = paths(sheet, '#728571')[0].commands.slice(0, 4);
  const x = Math.min(...slabs.map(c => c[1])), right = Math.max(...slabs.map(c => c[1]));
  const y = Math.min(...slabs.map(c => c[2])), bottom = Math.max(...slabs.map(c => c[2]));
  for (const l of labels) {
    const w = l.text.length * 2.2 * 1.1;
    assert.ok(l.xMm + w < x || l.xMm > right || l.yMm + .66 < y || l.yMm - 2.2 > bottom);
  }
  const reverse = create({ ...input, authored: input.authored.slice().reverse() });
  assert.deepEqual(reverse.primitives.filter(p => p.type === 'text' && /^S\d+$/.test(p.text)), labels);
  assert.ok(texts(sheet).includes('S1 | ground:authored:a | column'));
});

test('adversarial labels/references are fully wrapped and SVG escaped, never interpreted as markup', () => {
  const label = '<script>alert("x")</script>& label', reference = '<img src="x" onerror="bad"> & reference';
  const sheet = create(scene([entry('column', 'escape', { label, reference })]));
  assert.ok(texts(sheet).includes(label));
  assert.ok(texts(sheet).includes(reference));
  const svg = Renderer.toSVG(sheet);
  assert.ok(!svg.includes('<script>') && !svg.includes('<img'));
  assert.ok(svg.includes('&lt;script&gt;') && svg.includes('&amp;'));
});

test('options mirror architectural keys and never hide structural schedules/findings', () => {
  const input = scene([entry('grid')]);
  assert.throws(() => create(input, { scaleDenominator: 200 }), /Unsupported scale/);
  assert.throws(() => create(input, { paper: 'A1' }), /Unsupported paper/);
  assert.throws(() => create(input, { layers: { structural: false } }), /Invalid layers/);
  assert.throws(() => create(input, { layers: { site: 'no' } }), /must be boolean/);
  assert.throws(() => create(input, { anything: true }), /Invalid options/);
  const sheet = create(input, { layers: { site: false, dimensions: false, fixtures: false, furniture: false } });
  assert.equal(paths(sheet, '#687B86').length, 1);
  assert.ok(texts(sheet).includes('engineering-not-assessed'));
});

test('common validation rejects clipping even for sheets handed directly to toSVG', () => {
  const sheet = copy(create(scene()));
  sheet.primitives.push({ type: 'text', xMm: sheet.widthMm - 1, yMm: 20, text: 'Clipped',
    fontSizeMm: 2.2, align: 'start', rotationDeg: 0, color: '#263238' });
  assert.throws(() => Renderer.toSVG(sheet), /exceeds sheet media box/);
});

function browserAcceptanceScene() {
  // Transcribed from phase4-browser-acceptance.json. The capture retains the exact
  // UI fields but not random IDs; fixed v4 UUIDs reproduce the UI identity shape.
  const records = [
    { kind: 'grid', label: 'Grid A', start: [1, 2, 0], end: [6, 2, 0],
      widthM: null, depthM: null, heightM: null, material: null, reference: null, sizeSource: 'unspecified' },
    { kind: 'column', label: 'Column C1', start: [2, 3, 0],
      widthM: .3, depthM: .4, heightM: 3, material: 'User concrete', reference: 'Intent C1', sizeSource: 'authored' },
    { kind: 'beam', label: 'Beam B1', start: [2, 3, 3], end: [6, 3, 3],
      widthM: .25, depthM: .45, heightM: null, material: null, reference: null, sizeSource: 'assumed' },
    { kind: 'slab', label: 'Slab S1', start: [4, 5, 3],
      widthM: 4, depthM: 3, heightM: .2, material: null, reference: 'Unverified sketch S1', sizeSource: 'engineer-provided' },
    { kind: 'footing', label: 'Footing F1', start: [2, 3, -.5],
      widthM: 1.2, depthM: 1.4, heightM: .5, material: null, reference: null, sizeSource: 'unspecified' }
  ];
  return scene(records.map(({ start, end, ...record }, i) => {
    const e = entry(record.kind, '', record, [point(...start), ...(end ? [point(...end)] : [])]);
    e.floorId = 'floor-1';
    e.record.id = `floor-1:authored:fc63de31-a13c-4a70-8d94-183d7029344${i}`;
    return e;
  }), [floor('floor-1')]);
}

function continuationRecords(sheets) {
  const records = new Map();
  let current;
  for (const page of sheets.slice(1)) for (const primitive of page.primitives) {
    if (primitive.type !== 'text') continue;
    const value = primitive.text;
    const heading = value.match(/^([SFD]\d+) - (?:ELEMENT SCHEDULE|COORDINATION FINDING|SOURCE DIAGNOSTIC)(?: \(continued\))?$/);
    if (heading) {
      current = heading[1];
      if (!records.has(current)) records.set(current, '');
    } else if (value.startsWith('| ')) {
      assert.ok(current, 'every wrapped line has an unambiguous record heading');
      records.set(current, records.get(current) + value.slice(2));
    }
  }
  return records;
}

function assertComplete(input, sheets, floorId = 'ground') {
  const model = Structure.build(input);
  const elements = model.elements.filter(e => e.floorId === floorId).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(elements.map(e => e.id));
  const findings = model.findings.filter(f => f.floorId === null || f.floorId === floorId || f.elementIds.some(id => ids.has(id)));
  const records = continuationRecords(sheets);
  elements.forEach((e, i) => {
    const value = records.get(`S${i + 1}`);
    assert.ok(value.includes(`S${i + 1} | ${e.label} | ${e.kind}ID: ${e.id}`), e.id);
    assert.ok(value.includes(`Reference: ${e.reference ?? 'unknown'}`));
    assert.ok(value.includes(`Material: ${e.material ?? 'unknown'}; sizeSource: ${e.sizeSource}`));
  });
  findings.forEach((f, i) => assert.equal(records.get(`F${i + 1}`),
    `${f.code} [${f.elementIds.join(', ') || 'project'}]: ${f.message}`));
  assert.equal([...records.keys()].filter(key => key.startsWith('S')).length, elements.length);
  assert.equal([...records.keys()].filter(key => key.startsWith('F')).length, findings.length);
  return records;
}

test('exact five acceptance record fields with UI-shaped UUIDs retain all 14 findings', () => {
  const input = browserAcceptanceScene();
  const model = Structure.build(input);
  assert.equal(model.findings.length, 14);
  const sheets = createSet(input, { floorId: 'floor-1' });
  assert.equal(sheets.length, 1, 'the record-only reproduction fits without the uncaptured browser diagnostics');
  const content = texts(sheets[0]);
  for (const e of model.elements) {
    assert.ok(content.includes(e.id));
    assert.ok(content.includes(e.label));
    if (e.reference) assert.ok(content.includes(e.reference));
  }
  for (const f of model.findings) assert.ok(content.includes(`${f.code} [${f.elementIds.join(', ') || 'project'}]: ${f.message}`));
});

function diagnosticHeavyAcceptanceScene() {
  const input = browserAcceptanceScene();
  input.diagnostics.push({ ownerId: null, code: 'retained-source',
    message: 'Retained source diagnostic. '.repeat(250) });
  return input;
}

test('five UUID records, 14 findings and overflowing source diagnostics export as a complete A2 set', async () => {
  const input = diagnosticHeavyAcceptanceScene(), before = JSON.stringify(input);
  assert.equal(Structure.build(input).findings.length, 14);
  assert.throws(() => create(input, { floorId: 'floor-1' }), /Full schedule and 14 coordination findings/);
  const sheets = createSet(deepFreeze(input), { floorId: 'floor-1', floorName: 'Ground floor' });
  assert.equal(sheets.length, 2, 'one plan plus one two-column schedule/findings page');
  assert.ok(Object.isFrozen(sheets));
  const records = assertComplete(input, sheets, 'floor-1');
  assert.ok(records.get('S2').includes('Dimensions W / D / H: 0.3 m / 0.4 m / 3 m'));
  assert.ok(records.get('S5').includes('Bottom anchor elevations: -0.5 mTop elevation: 0 m'));
  const first = texts(sheets[0]);
  assert.ok(first.includes('Schedule and findings continue on pages 2-2; review complete set'));
  assert.ok(!first.includes('ID: floor-1:authored:'), 'no misleading partial plan-page schedule');
  assert.equal(segmentLength(paths(sheets[0], '#687B86')[0]), 50, '5 m remains exactly 50 mm at 1:100');
  sheets.forEach((sheet, i) => {
    assert.equal(Drawing.validateSheet(sheet), sheet);
    assert.ok(Object.isFrozen(sheet.metadata) && Object.isFrozen(sheet.primitives[0]));
    assert.deepEqual(sheet.metadata, sheets[0].metadata, 'exact v1 metadata schema and snapshot identity');
    assert.equal(sheet.widthMm, 594); assert.equal(sheet.heightMm, 420);
    assert.equal(sheet.metadata.scaleDenominator, 100);
    for (const value of [`Page ${i + 1}/${sheets.length}`, 'Ground floor', 'revision 7',
      'Project: structural-print', 'Floor: floor-1', ...sheet.metadata.assumptions])
      assert.ok(texts(sheet).includes(value), value);
    assert.ok(sheet.primitives.filter(p => p.type === 'text').every(p => p.fontSizeMm >= 2));
    assert.ok(Renderer.toSVG(sheet).includes('width="594mm"'));
    if (i) assert.equal(paths(sheet, '#687B86').length, 0);
  });
  const bytes = await PDFExport.pdfBytes(sheets);
  const pdf = await PDF.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), sheets.length);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 594 * 72 / 25.4) < 1e-8);
    assert.ok(Math.abs(page.getHeight() - 420 * 72 / 25.4) < 1e-8);
    const contents = page.node.Contents();
    const stream = Array.from({ length: contents.size() }, (_, i) =>
      Buffer.from(PDF.decodePDFRawStream(pdf.context.lookup(contents.get(i))).decode()).toString('latin1')).join('');
    assert.match(stream, / Tj/);
    assert.doesNotMatch(stream, /\bDo\b/);
  }
  assert.equal(JSON.stringify(input), before);
});

test('fitting content stays on one page with identical legacy drawing and visible page identity', () => {
  const input = scene([entry('grid', 'ten', {}, [point(0, 5), point(10, 5)])]);
  const single = create(input), sheets = createSet(input);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].metadata, single.metadata);
  assert.deepEqual(sheets[0].primitives.slice(0, single.primitives.length), single.primitives);
  assert.ok(texts(sheets[0]).includes('Page 1/1'));
  assert.equal(segmentLength(paths(sheets[0], '#687B86')[0]), 100);
  assert.ok(!texts(sheets[0]).includes('continue on pages'));
});

test('twenty columns with long identities paginate completely with stable S keys and one build', () => {
  const input = scene(Array.from({ length: 20 }, (_, i) =>
    entry('column', `9e899bbc-705a-4358-8ae1-${String(i).padStart(12, '0')}-${'long-id-'.repeat(10)}`,
      { label: `Column ${i}`, reference: `Document ${i}: ${'reference-'.repeat(30)}` },
      [point(1 + i % 5 * 1.8, 1 + Math.floor(i / 5) * 2)])));
  let builds = 0;
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(path.join(__dirname, '..', 'planner-structure-drawing.js'), 'utf8'))(
    name => name === './planner-drawing.js' ? Drawing : {
      build(s) { builds++; assert.equal(s, input); return Structure.build(s); }
    }, module);
  const before = JSON.stringify(input);
  const sheets = module.exports.createSheets(deepFreeze(input), options);
  assert.equal(builds, 1);
  assert.ok(sheets.length > 2 && sheets.length <= 12, `sensible page count: ${sheets.length}`);
  assertComplete(input, sheets);
  assert.equal(JSON.stringify(input), before);
  sheets.forEach(sheet => assert.equal(Drawing.validateSheet(sheet), sheet));
  const reversed = createSet({ ...input, authored: input.authored.slice().reverse() });
  const labels = sheet => sheet.primitives.filter(p => p.type === 'text' && /^S\d+$/.test(p.text));
  assert.equal(labels(sheets[0]).length, 20);
  assert.deepEqual(labels(reversed[0]), labels(sheets[0]));
  const elementRecords = pages => [...continuationRecords(pages)].filter(([key]) => key.startsWith('S'));
  assert.deepEqual(elementRecords(reversed), elementRecords(sheets));
  assertComplete({ ...input, authored: input.authored.slice().reverse() }, reversed);
});

test('long references, labels, IDs and diagnostics reconstruct across bounded column/page continuations', () => {
  const reference = `${'AB <&> '.repeat(1500)}${' '.repeat(300)}${'end'.repeat(1700)}`;
  const label = 'Long label '.repeat(300), id = 'long-id-'.repeat(500);
  const input = scene([entry('column', id, { label, reference })]);
  input.diagnostics.push({ ownerId: null, code: 'source-long', message: 'diagnostic & <data> '.repeat(500) });
  const sheets = createSet(input), records = assertComplete(input, sheets);
  assert.ok(records.get('S1').includes(reference));
  assert.ok(records.get('S1').includes(label));
  assert.equal(records.get('D1'), `Source diagnostic: source-long; ${input.diagnostics[0].message}`);
  assert.ok(sheets.some(s => texts(s).includes('S1 - ELEMENT SCHEDULE (continued)')));
  assert.ok(sheets.some(s => texts(s).includes('F1 - COORDINATION FINDING')));
  for (const sheet of sheets) {
    assert.equal(Drawing.validateSheet(sheet), sheet);
    assert.ok(!Renderer.toSVG(sheet).includes('<data>'));
  }
  assert.throws(() => create(input), /Full schedule|bounded readable/);
});

test('all media/orientations paginate without clipping or changing physical scale', () => {
  const input = scene([entry('grid', 'small', { reference: '0123456789'.repeat(1600) },
    [point(.2, .5), point(.8, .5)])], [floor('ground', 0, 1)]);
  for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
    const sheets = createSet(input, { paper, orientation });
    assert.ok(sheets.length > 1);
    assertComplete(input, sheets);
    for (const sheet of sheets) {
      assert.equal(Drawing.validateSheet(sheet), sheet);
      assert.equal(sheet.metadata.scaleDenominator, 100);
    }
    assert.ok(Math.abs(segmentLength(paths(sheets[0], '#687B86')[0]) - 6) < 1e-9);
  }
});

test('UUID project and floor identity, custom title and imperial units repeat without header collisions', () => {
  const floorId = 'f551481f-5914-4ffb-a26c-42b9735ad1ae';
  const input = scene([entry('grid', 'ten', { reference: 'Drawing reference '.repeat(1000) },
    [point(0, 5), point(10, 5)])], [floor(floorId)]);
  input.projectId = '8a471b34-c6d8-4e83-a47c-53bc254e56ad';
  input.authored[0].floorId = floorId;
  const sheets = createSet(input, { floorId, title: 'Review set', floorName: 'Ground floor', units: 'imperial' });
  assert.ok(sheets.length > 1);
  assertComplete(input, sheets, floorId);
  assert.equal(segmentLength(paths(sheets[0], '#687B86')[0]), 100);
  for (const sheet of sheets) {
    assert.equal(Drawing.validateSheet(sheet), sheet);
    assert.equal(sheet.metadata.title, 'Review set');
    assert.equal(sheet.metadata.units, 'imperial');
    assert.ok(texts(sheet).includes(`Project: ${input.projectId} | Floor: ${floorId}`));
  }
  const small = copy(input);
  small.scenes = [floor(floorId, 0, 1)];
  small.authored[0].anchors = [point(.1, .5), point(.9, .5)].map(p => ({ status: 'resolved', point: p }));
  for (const sheet of createSet(small, { floorId, paper: 'A4', orientation: 'portrait' }))
    assert.equal(Drawing.validateSheet(sheet), sheet);
});

test('page/text budgets and physical-plan failures are explicit and never return a subset', () => {
  const input = diagnosticHeavyAcceptanceScene(), opts = { floorId: 'floor-1' };
  for (const maxPages of [0, 101, 1.5, '3', null]) {
    assert.throws(() => createSet(input, { ...opts, maxPages }), /maxPages must be an integer/);
  }
  assert.throws(() => createSet(input, { ...opts, maxPages: 1 }), /exceeds maxPages=1/);
  assert.equal(createSet(input, { ...opts, maxPages: 2 }).length, 2);
  assert.throws(() => create(input, { ...opts, maxPages: 3 }), /Invalid options/);
  const oversized = scene([entry('column', 'large', { reference: 'a'.repeat(500001) })]);
  assert.throws(() => createSet(oversized), /500000-character source text budget/);
  const tooManyPages = scene([entry('column', 'many', { reference: 'a'.repeat(450000) })],
    [floor('ground', 0, 1)]);
  assert.throws(() => createSet(tooManyPages, { paper: 'A4', orientation: 'portrait' }), /exceeds maxPages=100/);
  assert.throws(() => createSet(scene([], [floor('ground', 0, 100)])), /Fixed scale 1:100/);
  const noLabelRoom = scene([entry('slab', 'cover', { widthM: 32, depthM: 32, heightM: .2 },
    [point(16, 16)])], [floor('ground', 0, 32)]);
  assert.throws(() => createSet(noLabelRoom), /Fixed scale|No collision-free keyed label/);
});

test('continuation selection retains cross-floor findings, excludes unrelated records and diagnostics', () => {
  const input = diagnosticHeavyAcceptanceScene();
  const unrelated = entry('column', 'upper-only', { reference: 'DO NOT PRINT' });
  unrelated.floorId = 'upper'; unrelated.record.id = 'upper:authored:only';
  input.authored.push(unrelated); input.scenes.push(floor('upper', 8));
  input.diagnostics.push({ ownerId: unrelated.record.id, code: 'unrelated', message: 'OTHER FLOOR DIAGNOSTIC' },
    { ownerId: null, code: 'project', message: 'PROJECT DIAGNOSTIC RETAINED' });
  const sheets = createSet(input, { floorId: 'floor-1' });
  assertComplete(input, sheets, 'floor-1');
  const content = [...continuationRecords(sheets).values()].join('');
  assert.ok(content.includes('engineering-not-assessed'));
  assert.ok(content.includes('PROJECT DIAGNOSTIC RETAINED'));
  assert.ok(!content.includes('DO NOT PRINT') && !content.includes('OTHER FLOOR DIAGNOSTIC'));
});
