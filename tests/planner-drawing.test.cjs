const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Drawing = require('../planner-drawing.js');
const Projection = require('../planner-projection.js');
const Model = require('../planner-model.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');

function registeredProject(id = 'furnished-single') {
  const project = createFixture(id).project;
  // These fixtures intentionally omit plots. Author explicit synthetic boundaries,
  // rather than bypassing the projection's registration requirements.
  for (const floor of project.floors) {
    const context = floor.legacy.context;
    if (context && !context.plate.localSetbacks) {
      context.plate.sitePlot = { x: 0, y: 0, w: context.plate.width, h: context.plate.depth };
    }
  }
  project.legacy = structuredClone(project.floors[0].legacy);
  return project;
}
function drawing(id = 'furnished-single') { return Projection.build(registeredProject(id)); }
function sheet(options = {}, scene = drawing()) { return Drawing.createSheet(scene, { floorId: 'ground', ...options }); }
const texts = value => value.primitives.filter(p => p.type === 'text').map(p => p.text);
function plotBox(value) {
  const path = value.primitives.find(p => p.type === 'path' && p.strokeWidthMm === .28);
  return { x: path.commands[0][1], y: path.commands[0][2],
    w: path.commands[1][1] - path.commands[0][1], h: path.commands[2][2] - path.commands[0][2] };
}
function wallBoxes(value) {
  const commands = value.primitives.find(p => p.type === 'path' && p.fill === '#354047').commands;
  const result = [];
  for (let i = 0; i < commands.length; i += 5) result.push({
    x: commands[i][1], y: commands[i][2], w: commands[i + 1][1] - commands[i][1],
    h: commands[i + 2][2] - commands[i][2]
  });
  return result;
}
function onWall(value, x, y) {
  return wallBoxes(value).some(r => x > r.x + 1e-8 && y > r.y + 1e-8 && x < r.x + r.w - 1e-8 && y < r.y + r.h - 1e-8);
}
function minimalSheet(primitives = []) {
  return { version: 1, widthMm: 210, heightMm: 297, metadata: {
    projectId: 'p', revision: 0, floorId: 'ground', floorName: 'Ground', title: 'Plan',
    paper: 'A4', orientation: 'portrait', scaleDenominator: 100, units: 'metric', assumptions: []
  }, primitives };
}

test('pure module exposes the exact shared API and classic browser global', () => {
  assert.deepEqual(Object.keys(Drawing).sort(), ['PAPER_SIZES', 'createSheet', 'toSVG', 'validateSheet'].sort());
  const context = vm.createContext({ HomePlannerModel: Model });
  vm.runInContext(fs.readFileSync(require.resolve('../planner-drawing.js'), 'utf8'), context);
  assert.equal(typeof context.HomePlannerDrawing.createSheet, 'function');
  assert.equal(typeof context.HomePlannerDrawing.toSVG, 'function');
  assert.ok(Object.isFrozen(Drawing.PAPER_SIZES.A4));
});

test('real bridge projection is accepted without changing project, scene, options or sheet', () => {
  const project = registeredProject(), controller = controllerFor(project);
  const before = JSON.stringify(controller.getProject()), scene = controller.getDrawingScene();
  const source = JSON.stringify(scene), options = { floorId: 'ground', layers: { site: true } };
  const optionCopy = JSON.stringify(options), first = Drawing.createSheet(scene, options), second = Drawing.createSheet(scene, options);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(scene), source);
  assert.equal(JSON.stringify(options), optionCopy);
  assert.equal(JSON.stringify(controller.getProject()), before);
  const rendered = JSON.stringify(first);
  assert.equal(Drawing.validateSheet(first), first);
  assert.equal(Drawing.toSVG(first), Drawing.toSVG(second));
  assert.equal(JSON.stringify(first), rendered);
});

for (const denominator of [50, 75, 100]) {
  test(`physical scale 10 m = ${10000 / denominator} mm at 1:${denominator}`, () => {
    const value = sheet({ paper: 'A2', scaleDenominator: denominator });
    assert.ok(Math.abs(plotBox(value).w - 10000 / denominator) < 1e-10);
    assert.equal(value.metadata.scaleDenominator, denominator);
    assert.ok(texts(value).includes('PLOT 10.00 m'));
  });
}

for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
  test(`supported physical ${paper} ${orientation} media and self-contained SVG`, () => {
    const source = drawing('sparse-unknown');
    const value = sheet({ paper, orientation, layers: { furniture: false } }, source);
    const dimensions = Drawing.PAPER_SIZES[paper];
    assert.equal(value.widthMm, dimensions[orientation === 'portrait' ? 'widthMm' : 'heightMm']);
    assert.equal(value.heightMm, dimensions[orientation === 'portrait' ? 'heightMm' : 'widthMm']);
    const svg = Drawing.toSVG(value);
    assert.ok(svg.includes(`width="${value.widthMm}mm" height="${value.heightMm}mm"`));
    assert.ok(svg.includes(`viewBox="0 0 ${value.widthMm} ${value.heightMm}"`));
    assert.doesNotMatch(svg, /<image|<foreignObject|href=|@import|url\(|<script/);
    assert.equal(Drawing.validateSheet(value), value);
  });
}

test('room CLEAR, BUILDING, PLOT and BAY dimensions retain distinct conventions', () => {
  const value = sheet();
  const all = texts(value).join('\n');
  assert.match(all, /CLEAR 4\.20 m x 3\.20 m/);
  assert.match(all, /BUILDING 9\.00 m/);
  assert.match(all, /BUILDING 7\.00 m/);
  assert.match(all, /PLOT 10\.00 m/);
  assert.match(all, /BAY 4\.50 m/);
  assert.match(all, /professional review/);
  assert.match(all, /1\.20 m above this floor/);
  assert.doesNotMatch(all, /certified setback dimensions|verified clear width:/);
});

test('imperial dimension rounding carries feet correctly and never changes geometry', () => {
  const metric = sheet(), imperial = sheet({ units: 'imperial' });
  assert.deepEqual(plotBox(metric), plotBox(imperial));
  assert.deepEqual(wallBoxes(metric), wallBoxes(imperial));
  assert.ok(texts(imperial).includes('PLOT 32\'-10"'));
  assert.match(texts(imperial).join('\n'), /CLEAR 13'-9" x 10'-6"/);
  assert.match(Drawing.toSVG(imperial), /32&apos;-10&quot;/);
});

test('plan poche has physical thickness, disjoint junction solids and real aperture voids', () => {
  const source = drawing(), value = sheet({}, source), plot = plotBox(value), scene = source.scenes[0];
  const boxes = wallBoxes(value);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) < 1e-7 ||
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) < 1e-7, 'union rectangles must not duplicate physical wall solids');
  }
  assert.ok(boxes.some(r => Math.abs(r.w - 2) < 1e-7 || Math.abs(r.h - 2) < 1e-7), '200 mm wall prints as 2 mm at 1:100');
  for (const opening of scene.openings) {
    const wall = scene.walls.find(w => w.id === opening.wallId);
    const middle = Model.wallPoint(wall, opening.offsetM + opening.widthM / 2);
    const actual = onWall(value, plot.x + middle.x * 10, plot.y + middle.y * 10);
    assert.equal(actual, opening.sillM > 1.2, `${opening.sourceId}: aperture is void iff the cut crosses it`);
  }
});

test('hinged door leaves and cubic quarter arcs use the model doorGeometry, not operating fractions', () => {
  const source = drawing(), scene = source.scenes[0], value = sheet({}, source), plot = plotBox(value);
  const door = scene.openings.find(o => o.sourceId === 'bedroom-access');
  assert.equal(door.openFraction, .25);
  const g = Model.doorGeometry(door, scene.walls.find(w => w.id === door.wallId));
  const curves = value.primitives.filter(p => p.type === 'path' && p.commands.some(c => c[0] === 'C'));
  assert.equal(curves.length, scene.openings.filter(o => o.kind === 'hinged').length);
  const arc = curves.find(p => Math.abs(p.commands[0][1] - (plot.x + g.closedEnd.x * 10)) < 1e-7 &&
    Math.abs(p.commands[0][2] - (plot.y + g.closedEnd.y * 10)) < 1e-7);
  assert.ok(arc);
  assert.ok(Math.abs(arc.commands[1][5] - (plot.x + g.openEnd.x * 10)) < 1e-7);
  assert.ok(Math.abs(arc.commands[1][6] - (plot.y + g.openEnd.y * 10)) < 1e-7);
});

test('window glazing is drawn only at the explicit cut and high windows remain wall poche', () => {
  const value = sheet();
  assert.equal(value.primitives.filter(p => p.type === 'path' && p.commands.length === 2 &&
    p.commands[1][0] === 'L' && p.stroke === '#263238' && p.strokeWidthMm === .13).length, 9);
  assert.match(texts(value).join('\n'), /high-level windows/);
});

test('layers are strict booleans, suppress geometry and preserve physical wall cut', () => {
  const full = sheet(), bare = sheet({ layers: { furniture: false, fixtures: false, dimensions: false, site: false } });
  assert.ok(bare.primitives.length < full.primitives.length);
  assert.ok(!bare.primitives.some(p => p.fill === '#E8ECEE'));
  assert.doesNotMatch(texts(bare).join('\n'), /\nPLOT |\nCLEAR |\nBUILDING |\nBAY /);
  assert.equal(texts(bare).includes('N'), false);
  assert.equal(wallBoxes(full).length, wallBoxes(bare).length);
  assert.throws(() => sheet({ layers: { site: 1 } }), /must be boolean/);
  assert.throws(() => sheet({ layers: { plumbing: true } }), /layers structure/);
  assert.equal(sheet({ layers: { furniture: false } }).primitives.filter(p => p.fill === '#E8ECEE').length, 1,
    'a supplied basin is controlled independently by the fixtures layer');
  assert.equal(sheet({ layers: { fixtures: false } }).primitives.filter(p => p.fill === '#E8ECEE').length, 5);
});

test('selected upper floor only uses its own rooms, elevation and explicit floor identity', () => {
  const source = drawing('multiple-floors');
  const value = sheet({ floorId: 'upper', floorName: 'Upper studio floor' }, source);
  assert.equal(value.metadata.floorId, 'upper');
  assert.equal(value.metadata.floorName, 'Upper studio floor');
  assert.ok(texts(value).includes('Upper studio'));
  assert.ok(texts(value).includes('Quiet study'));
  assert.ok(!texts(value).includes('Bedroom'));
  assert.ok(value.primitives.some(p => p.fill === '#354047'), 'cut uses upper-floor project-relative elevation');
});

test('unregistered, absent and unknown floors fail descriptively instead of silently disappearing', () => {
  assert.throws(() => sheet({}, Projection.build(createFixture('missing-context').project)), /missing-geometry/);
  assert.throws(() => sheet({}, Projection.build(createFixture('furnished-single').project)), /missing-plot/);
  assert.throws(() => sheet({ floorId: 'ghost' }), /unknown floor/);
  assert.throws(() => Drawing.createSheet(drawing()), /selected floor/);
  assert.throws(() => Drawing.createSheet({ scenes: [] }, { floorId: 'ground' }), /DrawingScene/);
});

test('inconsistent site frame and rejected openings cannot produce apparently complete sheets', () => {
  const project = registeredProject('multiple-floors');
  project.floors[1].legacy.context.plate.sitePlot.w += 1;
  assert.throws(() => sheet({ floorId: 'upper' }, Projection.build(project)), /inconsistent-site-frame/);
  assert.throws(() => sheet({}, drawing('invalid-attachments')), /rejected openings|geometry errors/);
});

test('fixed-scale fit fails instead of silently shrinking; dense long labels have a bounded fallback', () => {
  assert.throws(() => sheet({ paper: 'A4', orientation: 'landscape', scaleDenominator: 50 }), /Fixed scale 1:50 does not fit/);
  assert.throws(() => sheet({}, drawing('dense-annotations')), /schedule layout overflow|Label layout overflow/);
  const dense = sheet({ paper: 'A2', scaleDenominator: 50 }, drawing('dense-annotations'));
  assert.ok(texts(dense).some(t => t.includes('coordination label')));
  assert.ok(dense.primitives.length > 250);
  assert.equal(Drawing.validateSheet(dense), dense);
});

test('occupied rooms get deterministic keyed labels instead of labels over doors or furniture', () => {
  const value = sheet();
  assert.ok(texts(value).includes('ROOM KEY / CLEAR SIZES'));
  assert.ok(texts(value).includes('R04'));
  assert.ok(texts(value).some(t => t.includes('R04 Living / dining')));
  assert.deepEqual(sheet(), value);
});

test('site heading and allowances are shown without inferred road, paving or certified setbacks', () => {
  const value = sheet({}, drawing('setback-plot'));
  assert.ok(texts(value).includes('N'));
  assert.ok(texts(value).includes('OPEN STRIP - MODEL ALLOWANCE'));
  assert.match(texts(value).join('\n'), /non-compliant setback inputs/);
  assert.match(texts(value).join('\n'), /Off-plot/);
  assert.ok(!texts(value).some(t => /^ROAD|^PAVING/.test(t)));
  const arrow = value.primitives.find(p => p.type === 'path' && p.strokeWidthMm === .3 && p.commands.length === 2 &&
    p.commands[0][1] === value.widthMm - 21 && p.commands[0][2] === 43);
  assert.ok(arrow.commands[1][1] < arrow.commands[0][1], 'east-facing site north points left');
});

test('explicit authored footprints and stair intent do not infer plumbing internals or treads', () => {
  const project = registeredProject('sparse-unknown'), floor = project.floors[0];
  floor.authored = Model.emptyAuthored();
  const anchor = (x, y, z = 0) => ({ kind: 'point', floorId: 'ground', point: { x, y, z } });
  floor.authored.fixtures.push({ id: 'ground:authored:basin', kind: 'basin', anchor: anchor(2, 2), widthM: .6, depthM: .45, heightM: .8 });
  floor.authored.stairs.push({ id: 'ground:authored:stairs', start: anchor(3, 2), end: anchor(3, 4, 3), widthM: .9, riserCount: 16 });
  const value = sheet({ paper: 'A2' }, Projection.build(project));
  assert.match(texts(value).join('\n'), /INCOMPLETE stair/);
  assert.match(texts(value).join('\n'), /mounting\/orientation is unspecified/);
  assert.equal(value.primitives.filter(p => p.fill === '#E8ECEE').length, 1, 'only the authored fixture footprint is filled');
  const suppressed = sheet({ paper: 'A2', layers: { fixtures: false } }, Projection.build(project));
  assert.ok(!suppressed.primitives.some(p => p.fill === '#E8ECEE'));
});

test('unresolved authored fixtures remain explicit incomplete notes, never fabricated geometry', () => {
  const project = registeredProject('sparse-unknown');
  project.floors[0].authored = Model.emptyAuthored();
  project.floors[0].authored.fixtures.push({ id: 'ground:authored:unknown', kind: 'toilet', anchor: null, widthM: null, depthM: null, heightM: null });
  const value = sheet({ paper: 'A2' }, Projection.build(project));
  assert.match(texts(value).join('\n'), /INCOMPLETE fixtures/);
  assert.ok(!value.primitives.some(p => p.fill === '#E8ECEE'));
});

test('authored annotations use resolved anchors and nonhorizontal dimensions retain their 3D convention', () => {
  const project = registeredProject('setback-plot'), authored = Model.emptyAuthored();
  const anchor = (x, y, z = 0) => ({ kind: 'point', floorId: 'ground', point: { x, y, z } });
  project.floors[0].authored = authored;
  authored.annotations.push({ id: 'ground:authored:note', text: 'Review <entry> & clearance', anchor: anchor(5, -1) });
  authored.dimensions.push({ id: 'ground:authored:dim', start: anchor(1, -2), end: anchor(4, -2, 4), offsetM: -.5 });
  const source = Projection.build(project), value = sheet({ paper: 'A2' }, source);
  assert.ok(texts(value).includes('AUTHORED 3D 5.00 m'));
  assert.match(Drawing.toSVG(value), /Review &lt;entry&gt; &amp;/);
  assert.deepEqual(sheet({ paper: 'A2' }, source), value);
  const hidden = sheet({ paper: 'A2', layers: { dimensions: false } }, source);
  assert.ok(!texts(hidden).some(t => t.startsWith('AUTHORED 3D')));
});

test('authored fixture clashes cannot paint out the physical wall cut or door glyph', () => {
  const project = registeredProject('sparse-unknown'), source = Projection.build(project), wall = source.scenes[0].walls[0];
  project.floors[0].authored = Model.emptyAuthored();
  project.floors[0].authored.fixtures.push({ id: 'ground:authored:wall-equipment', kind: 'equipment',
    anchor: { kind: 'wall', floorId: 'ground', entityId: wall.id, offsetM: 1, heightM: 1 },
    widthM: .8, depthM: .6, heightM: .5 });
  const value = sheet({ paper: 'A2' }, Projection.build(project));
  const footprint = value.primitives.findIndex(p => p.fill === '#E8ECEE');
  const cut = value.primitives.findIndex(p => p.fill === '#354047');
  assert.ok(footprint >= 0 && cut > footprint, 'wall and opening ink is always above schematic footprints');
});

function dimensionFixture(footprint, start = [1, 1], end = [5, 1], offsetM = 2) {
  const project = registeredProject('sparse-unknown'), floor = project.floors[0];
  const anchor = ([x, y]) => ({ kind: 'point', floorId: floor.id, point: { x, y, z: 0 } });
  floor.authored = Model.emptyAuthored();
  floor.authored.dimensions.push({ id: 'ground:authored:dimension', start: anchor(start), end: anchor(end), offsetM });
  floor.legacy.context.plan.placed = [{
    req: { id: 'room', type: 'living', label: 'Room', seq: 0 },
    module: { x: .7, y: .7, w: 4.6, h: 3.6 }, carpet: { x: .75, y: .75, w: 4.5, h: 3.5 }
  }];
  floor.legacy.context.plan.furniture = [{
    id: 'dimension-table', roomId: 'room', type: 'table', label: 'Table', headLocal: 'N', ...footprint
  }];
  project.legacy = structuredClone(floor.legacy);
  return Projection.build(project);
}

test('authored dimension enclosure is not occupied ink in a real Model/Projection fixture', () => {
  const scene = dimensionFixture({ x: 2.8, y: 1.8, w: .4, h: .4 });
  assert.deepEqual(scene.scenes[0].furniture[0].rect, { x: 2.8, y: 1.8, w: .4, h: .4 });
  assert.equal(scene.authored[0].anchorStatus, 'resolved');
  const value = sheet({ paper: 'A2' }, scene), plot = plotBox(value);
  const commands = [[1, 1, 1, 3], [5, 1, 5, 3], [1, 3, 5, 3]];
  for (const [i, [ax, ay, bx, by]] of commands.entries()) {
    assert.ok(value.primitives.some(p => p.type === 'path' && p.strokeWidthMm === (i === 2 ? .13 : .1) &&
      JSON.stringify(p.commands) === JSON.stringify([
        ['M', plot.x + ax * 10, plot.y + ay * 10], ['L', plot.x + bx * 10, plot.y + by * 10]
      ])), 'shared path primitives retain exact extension and dimension lines');
  }
  assert.ok(texts(value).includes('AUTHORED 3D 4.00 m'));
  const label = value.primitives.find(p => p.type === 'text' && p.text === 'AUTHORED 3D 4.00 m');
  assert.ok(label.yMm - label.fontSizeMm > plot.y + 30, 'text stays outside the reserved dimension enclosure');
  assert.equal(Drawing.validateSheet(value), value);
  assert.deepEqual(sheet({ paper: 'A2' }, scene), value);
});

for (const [name, footprint] of [
  ['first extension crossing', { x: .8, y: 1.8, w: .4, h: .4 }],
  ['second extension crossing', { x: 4.8, y: 1.8, w: .4, h: .4 }],
  ['dimension line crossing', { x: 2.8, y: 2.8, w: .4, h: .4 }],
  ['extension touching', { x: 1, y: 1.8, w: .4, h: .4 }],
  ['dimension touching', { x: 2.8, y: 3, w: .4, h: .4 }],
  ['extension stroke touching', { x: 1.005, y: 1.8, w: .4, h: .4 }],
  ['dimension stroke touching', { x: 2.8, y: 3.0065, w: .4, h: .4 }],
  ['round extension cap touching', { x: 1, y: .895, w: .1, h: .1 }]
]) {
  test(`authored dimension rejects ${name}`, () => {
    assert.throws(() => sheet({ paper: 'A2' }, dimensionFixture(footprint)), /Authored dimension .* crosses plan geometry/);
  });
}

test('authored dimension accepts clearance immediately beyond its stroke', () => {
  assert.doesNotThrow(() => sheet({ paper: 'A2' },
    dimensionFixture({ x: 1.006, y: 1.8, w: .4, h: .4 })));
});

test('slanted authored dimensions test actual segments rather than their bounding rectangles', () => {
  const start = [1.5, 1], end = [4.5, 1.4], offset = 1.5;
  assert.doesNotThrow(() => sheet({ paper: 'A2' },
    dimensionFixture({ x: 2.8, y: 1.8, w: .4, h: .4 }, start, end, offset)));
  assert.throws(() => sheet({ paper: 'A2' },
    dimensionFixture({ x: 2.4, y: 2.5, w: .4, h: .4 }, start, end, offset)),
  /Authored dimension .* crosses plan geometry/);
  assert.doesNotThrow(() => sheet({ paper: 'A2' },
    dimensionFixture({ x: 1.45, y: 1.8, w: .1, h: .1 }, start, end, offset)),
  'the empty corner of a slanted extension bounding box is not a collision');
  const length = Math.hypot(3, .4), nx = -.4 / length, ny = 3 / length;
  for (const [clearance, touching] of [[.0065, true], [.0066, false]]) {
    const footprint = { x: 3 + nx * (offset + clearance) - .4,
      y: 1.2 + ny * (offset + clearance), w: .4, h: .4 };
    const render = () => sheet({ paper: 'A2' }, dimensionFixture(footprint, start, end, offset));
    if (touching) assert.throws(render, /Authored dimension .* crosses plan geometry/);
    else assert.doesNotThrow(render, 'diagonal stroke clearance uses Euclidean distance');
  }
});

test('vertical and reversed dimensions retain segment collision behavior', () => {
  for (const [start, end, offset, collisionY] of [[[1, 1.5], [1, 2.5], -2, 2.3], [[5, 1], [1, 1], -2, 2.8]]) {
    assert.doesNotThrow(() => sheet({ paper: 'A2' },
      dimensionFixture({ x: 1.8, y: 1.8, w: .4, h: .4 }, start, end, offset)));
    assert.throws(() => sheet({ paper: 'A2' },
      dimensionFixture({ x: 2.8, y: collisionY, w: .4, h: .4 }, start, end, offset)),
    /Authored dimension .* crosses plan geometry/);
  }
});

test('resolved authored text preserves exact Unicode and escapes all XML markup and metadata', () => {
  const value = sheet({ title: '<Plan> & "Study" — café', floorName: "Floor 'A' & B" });
  const svg = Drawing.toSVG(value);
  assert.match(svg, /&lt;Plan&gt; &amp; &quot;Study&quot; — café/);
  assert.match(svg, /Floor &apos;A&apos; &amp; B/);
  assert.doesNotMatch(svg, /<Plan>|<script/);
  assert.ok(value.metadata.title.includes('— café'));
});

test('unsupported options, invalid strings and oversized labels fail instead of accepting malformed input', () => {
  for (const options of [{ paper: 'A1' }, { orientation: 'sideways' }, { units: 'feet' }, { scaleDenominator: 0 }, { scaleDenominator: 99 },
    { scaleDenominator: NaN }, { title: '' }, { title: 'bad\u0000title' }, { title: '\ud800' }, { extra: true }]) {
    assert.throws(() => sheet(options), /Architectural drawing/);
  }
  assert.throws(() => sheet({ title: 'X'.repeat(1000) }), /Title layout overflow/);
});

test('validator rejects all malformed schema shapes, nonfinite values and media clipping', () => {
  const path = { type: 'path', commands: [['M', 10, 10], ['L', 30, 30]], fill: null, stroke: '#123456', strokeWidthMm: .2 };
  const valid = minimalSheet([path]);
  assert.equal(Drawing.validateSheet(valid), valid);
  const edits = [
    s => { s.extra = true; }, s => { s.version = 2; }, s => { s.widthMm = 211; },
    s => { delete s.metadata.floorName; }, s => { s.metadata.revision = Infinity; },
    s => { s.metadata.extra = {}; }, s => { s.metadata.assumptions = [null]; },
    s => { s.primitives[0].commands[0][1] = NaN; }, s => { s.primitives[0].commands[0][1] = -1; },
    s => { s.primitives[0].commands[0][1] = 0; }, s => { s.primitives[0].commands = [['L', 10, 10]]; },
    s => { s.primitives[0].commands = [['M', 10, 10], ['Q', 1, 2, 3, 4]]; },
    s => { s.primitives[0].stroke = 'red'; }, s => { s.primitives[0].fill = 'url(http://example.test)'; },
    s => { s.primitives[0].type = 'image'; }, s => { s.primitives[0].transform = 'scale(2)'; },
    s => { delete s.primitives[0].commands[0][1]; }, s => { delete s.primitives[0]; }
  ];
  for (const edit of edits) {
    const bad = structuredClone(valid); edit(bad);
    assert.throws(() => Drawing.validateSheet(bad), /Architectural drawing/);
  }
  assert.throws(() => Drawing.validateSheet(minimalSheet(Array(30001).fill(path))), /limit/);
});

test('validator checks actual cubic extrema rather than incorrectly clipping valid control handles', () => {
  const curve = { type: 'path', commands: [['M', 10, 20], ['C', -1, 30, -1, 40, 10, 50]],
    fill: null, stroke: '#123456', strokeWidthMm: .2 };
  assert.doesNotThrow(() => Drawing.validateSheet(minimalSheet([curve])));
  curve.commands[1][1] = -100;
  assert.throws(() => Drawing.validateSheet(minimalSheet([curve])), /media box/);
});

test('validator includes rotated text ink, baseline descent and strict colors', () => {
  const text = { type: 'text', xMm: 20, yMm: 20, text: 'Valid', fontSizeMm: 3, align: 'middle', rotationDeg: 90, color: '#123456' };
  assert.doesNotThrow(() => Drawing.validateSheet(minimalSheet([text])));
  for (const mutation of [{ xMm: 0 }, { yMm: 0 }, { rotationDeg: Infinity }, { fontSizeMm: -1 }, { align: 'center' }, { color: null }])
    assert.throws(() => Drawing.validateSheet(minimalSheet([{ ...text, ...mutation }])), /Architectural drawing/);
});
