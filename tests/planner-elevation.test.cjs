const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Renderer = require('../planner-elevation.js');
const Drawing = require('../planner-drawing.js');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const Structure = require('../planner-structure.js');
const Export = require('../planner-drawing-export.js');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const point = (x, y, z = 0) => ({ x, y, z });
const anchor = (x, y, z = 0, floorId = 'ground') => ({ kind: 'point', floorId, point: point(x, y, z) });
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function wall(id = 'wall', a = point(0, 0), b = point(10, 0), extra = {}) {
  return { id, start: a, end: b, baseM: 0, heightM: 3, thicknessM: .2, removed: false, openings: [],
    solidSections: [{ startM: 0, endM: Math.hypot(b.x - a.x, b.y - a.y), sillM: 0, heightM: 3 }], ...extra };
}
function floor(floorId = 'ground', elevation = 0, walls = [wall()]) {
  return { floorId, floorElevationM: elevation, headingDeg: 0, coordinateSpace: 'site-local',
    plot: { x: 0, y: 0, w: 20, h: 20 }, building: { x: 0, y: 0, w: 10, h: 10 },
    sourcePlotOrigin: { x: 0, y: 0 }, walls, openings: [], rooms: [], furniture: [], obstacles: [],
    unresolvedOpenings: [], diagnostics: [] };
}
function scene(floors = [floor()]) {
  return { version: 1, kind: 'DrawingScene', projectId: 'elevation-test', revision: 7, scenes: floors,
    inputFingerprint: 'captured', siteDatum: { version: 1, elevationM: null }, authored: [], diagnostics: [],
    documentation: { version: 1, sheets: [], views: [{ id: 'saved', name: 'North elevation', kind: 'elevation',
      floorId: 'ground', scaleDenominator: 100, direction: 'N', cut: [] }] } };
}
function section(input = scene(), a = anchor(0, -1), b = anchor(10, 1)) {
  Object.assign(input.documentation.views[0], { name: 'Section A-B', kind: 'section', direction: null, cut: [a, b] });
  return input;
}
function structural(id = 'column', kind = 'column', positions = [point(5, 0)], extra = {}) {
  return { floorId: 'ground', collection: 'structural', anchorStatus: 'resolved',
    record: { id: `ground:authored:${id}`, kind, anchors: [], widthM: 1, depthM: 1,
      heightM: 3, material: 'Concrete', sizeSource: 'authored', ...extra },
    anchors: positions.map(p => ({ status: 'resolved', point: p })) };
}
const options = { viewId: 'saved', paper: 'A3', orientation: 'landscape', units: 'metric' };
const sheets = (s = scene(), o = {}) => Renderer.createSheets(s, { ...options, ...o });
const single = (s = scene(), o = {}) => Renderer.createSheet(s, { ...options, ...o });
const content = pages => pages.flatMap(s => s.primitives.filter(p => p.type === 'text').map(p => p.text)).join('');
const solids = page => page.primitives.filter(p => p.type === 'path' && p.fill !== null);
function rect(p) {
  const coords = p.commands.filter(c => c.length === 3);
  const xs = coords.map(c => c[1]), ys = coords.map(c => c[2]);
  return { x: Math.min(...xs), right: Math.max(...xs), y: Math.min(...ys), bottom: Math.max(...ys), color: p.fill };
}
function area(page, color) {
  return solids(page).filter(p => !color || p.fill === color).map(rect).reduce((n, r) => n + (r.right - r.x) * (r.bottom - r.y), 0);
}
function opening(input, wallId, id, offset, width, sill, height) {
  const f = input.scenes[0], w = f.walls.find(w => w.id === wallId);
  const a = Model.wallPoint(w, offset), b = Model.wallPoint(w, offset + width);
  const o = { id, wallId, kind: 'window', offsetM: offset, widthM: width, sillM: sill, heightM: height,
    segment: { x1: a.x, y1: a.y, x2: b.x, y2: b.y } };
  w.openings.push(o); f.openings.push(o);
  return o;
}

test('global/CommonJS API, common validation/SVG, immutable deterministic output and input', () => {
  assert.deepEqual(Object.keys(Renderer).sort(), ['createSheet', 'createSheets', 'toSVG']);
  const context = { HomePlannerDrawing: Drawing, HomePlannerModel: Model, HomePlannerProjection: Projection, HomePlannerStructure: Structure };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'planner-elevation.js'), 'utf8'), context);
  assert.equal(typeof context.HomePlannerElevation.createSheets, 'function');
  const input = freeze(scene()), opt = freeze({ ...options }), before = JSON.stringify(input);
  const output = Renderer.createSheets(input, opt);
  assert.ok(Object.isFrozen(output) && Object.isFrozen(output[0].primitives[0].commands));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(output, Renderer.createSheets(input, opt));
  for (const page of output) {
    assert.equal(Drawing.validateSheet(page), page);
    assert.equal(Renderer.toSVG(page), Drawing.toSVG(page));
    for (const p of page.primitives.filter(p => p.type === 'text')) assert.ok(p.fontSizeMm >= 2);
  }
});

test('exact physical 10 m wall is 100 mm at 1:100; all scales and unit systems preserve geometry', () => {
  for (const scale of [50, 75, 100]) for (const units of ['metric', 'imperial']) {
    const input = scene();
    input.documentation.views[0].scaleDenominator = scale;
    const page = sheets(input, { units })[0], r = rect(solids(page)[0]);
    close(r.right - r.x, 10000 / scale);
    close(r.bottom - r.y, 3000 / scale);
    assert.equal(page.metadata.scaleDenominator, scale);
  }
});

test('persisted non-plan view required; strict options and saved scale precedence', () => {
  assert.throws(() => Renderer.createSheets(scene()), /viewId/);
  for (const key of ['floorId', 'direction', 'headingDeg', 'cut', 'layers', 'maxPages', 'madeUp'])
    assert.throws(() => sheets(scene(), { [key]: 'x' }), /options/);
  assert.throws(() => sheets(scene(), { title: undefined }), /undefined/);
  assert.throws(() => sheets(scene(), { scaleDenominator: 50 }), /conflicts/);
  for (const paper of ['A0', 'A1', 'constructor']) assert.throws(() => sheets(scene(), { paper }), /paper/);
  assert.throws(() => sheets(scene(), { units: 'pixels' }), /units/);
  const input = scene(), v = input.documentation.views[0];
  v.kind = 'plan'; assert.throws(() => sheets(input), /not a plan/);
  v.kind = 'elevation'; v.direction = null; assert.throws(() => sheets(input), /geographic direction/);
  v.direction = 'N'; v.scaleDenominator = null;
  assert.throws(() => sheets(input), /scale.*required/i);
  assert.equal(sheets(input, { scaleDenominator: 75 })[0].metadata.scaleDenominator, 75);
  v.scaleDenominator = 200; assert.throws(() => sheets(input), /supported scale/);
  v.scaleDenominator = 100; v.floorId = 'missing'; assert.throws(() => sheets(input), /missing-floor/);
  v.floorId = 'ground'; input.documentation.views.push(copy(v)); assert.throws(() => sheets(input), /exactly one/);
  assert.throws(() => sheets(scene(), { viewId: 'not-persisted' }), /persisted/);
});

test('fixed paper dimensions, no shrink and single-sheet continuation failure', () => {
  for (const paper of ['A4', 'A3', 'A2']) for (const orientation of ['portrait', 'landscape']) {
    const pages = sheets(scene(), { paper, orientation }), size = Drawing.PAPER_SIZES[paper];
    close(pages[0].widthMm, size[orientation === 'portrait' ? 'widthMm' : 'heightMm']);
    close(pages[0].heightMm, size[orientation === 'portrait' ? 'heightMm' : 'widthMm']);
  }
  const huge = scene([floor('ground', 0, [wall('huge', point(0, 0), point(100, 0))])]);
  assert.throws(() => sheets(huge), /Fixed scale.*No automatic shrink/);
  const annotated = scene();
  annotated.scenes[0].diagnostics = Array.from({ length: 30 }, () => ({ message: 'Review this supplied geometry before construction.' }));
  assert.throws(() => single(annotated, { paper: 'A4', orientation: 'portrait' }), /createSheets/);
  const page = single(scene(), { paper: 'A2' });
  assert.equal(page.metadata.floorId, 'ground');
});

test('geographic signs N right E, E right S, S right W, W right N', () => {
  const input = scene([floor('ground', 0, [wall('origin', point(0, 0), point(1, 0))])]);
  input.scenes[0].obstacles = [
    { id: 'a', type: 'building', x: 2, y: 2, w: 1, h: 1, baseM: 4, heightM: 1, transmittance: 0 },
    { id: 'b', type: 'building', x: 6, y: 6, w: 1, h: 1, baseM: 6, heightM: 1, transmittance: 1 }
  ];
  for (const direction of ['N', 'E', 'S', 'W']) {
    input.documentation.views[0].direction = direction;
    const page = sheets(input)[0], shapes = solids(page).map(rect);
    const a = shapes.find(r => r.color === '#B9BEC1'), b = shapes.find(r => r.color === '#CCD9E2');
    assert.equal(b.x > a.x, ['N', 'E'].includes(direction), direction);
    assert.ok(content([page]).includes(`RIGHT ${{ N: 'E', E: 'S', S: 'W', W: 'N' }[direction]}`));
  }
});

test('numeric headings use the shared geographic projection, including oblique face depth', () => {
  for (const heading of [0, 37, 90, 123.5, 180, 270, -42]) for (const direction of ['N', 'E', 'S', 'W']) {
    const input = scene();
    input.scenes[0].headingDeg = heading;
    input.documentation.views[0].direction = direction;
    const points = [point(0, -.1), point(10, -.1), point(10, .1), point(0, .1)];
    const u = points.map(p => Projection.siteToWorld(p, heading)).map(w =>
      ({ N: w.east, E: -w.north, S: -w.east, W: w.north })[direction]);
    const page = sheets(input)[0], r = solids(page).map(rect);
    close(Math.max(...r.map(r => r.right)) - Math.min(...r.map(r => r.x)), (Math.max(...u) - Math.min(...u)) * 10);
    close(area(page), (Math.max(...u) - Math.min(...u)) * 300);
  }
});

test('opaque near wall completely hides far solids, and visibility is independent of input order', () => {
  const near = wall('near', point(0, 0), point(10, 0));
  const far = wall('far', point(2, 4), point(8, 4));
  const input = scene([floor('ground', 0, [near, far])]);
  input.authored = [structural('behind', 'column', [point(5, 3)])];
  const page = sheets(input)[0];
  close(area(page), 3000); close(area(page, '#ADB9C0'), 0);
  assert.equal(solids(page).length, 1);
  input.scenes[0].walls.reverse();
  assert.deepEqual(sheets(input)[0].primitives, page.primitives);
  input.documentation.views[0].direction = 'S';
  assert.ok(area(sheets(input)[0], '#ADB9C0') === 0); // rear wall is in front of the column too
});

test('physical aperture exposes only geometry behind the void, never a X-ray structural overlay', () => {
  const w = wall();
  w.solidSections = [
    { startM: 0, endM: 4, sillM: 0, heightM: 3 },
    { startM: 4, endM: 6, sillM: 0, heightM: 1 },
    { startM: 4, endM: 6, sillM: 2, heightM: 1 },
    { startM: 6, endM: 10, sillM: 0, heightM: 3 }
  ];
  const input = scene([floor('ground', 0, [w])]);
  opening(input, 'wall', 'window', 4, 2, 1, 1);
  const empty = sheets(input);
  close(area(empty[0]), 2800);
  assert.ok(content(empty).includes('sill 1 m; head 2 m'));
  input.authored = [structural('back', 'column', [point(5, 2)], { widthM: 4, depthM: 1 })];
  const filled = sheets(input)[0];
  close(area(filled, '#ADB9C0'), 200);
  close(area(filled), 3000);
  input.authored[0].anchors[0].point.y = -2;
  close(area(sheets(input)[0], '#ADB9C0'), 1200);
});

test('independent ray oracle verifies oblique/crossing wall, beam and mass visibility for all views', () => {
  const input = scene();
  input.scenes[0].obstacles = [{ id: 'box', type: 'building', x: 3, y: -1, w: 3, h: 3,
    baseM: 0, heightM: 3.2, transmittance: 0 }];
  input.authored = [structural('diagonal', 'beam', [point(0, -2, .5), point(10, 4, .5)],
    { widthM: 1, depthM: 1.6, heightM: null })];
  const dx = -6 / Math.sqrt(136) / 2, dy = 10 / Math.sqrt(136) / 2;
  const volumes = [
    { points: [point(0, -.1), point(10, -.1), point(10, .1), point(0, .1)], z: 0, top: 3, color: '#E1E5E7' },
    { points: [point(3, -1), point(6, -1), point(6, 2), point(3, 2)], z: 0, top: 3.2, color: '#B9BEC1' },
    { points: [point(dx, -2 + dy), point(10 + dx, 4 + dy), point(10 - dx, 4 - dy), point(-dx, -2 - dy)],
      z: .5, top: 2.1, color: '#A6B9C9' }
  ];
  for (const heading of [0, 37, 123.5]) for (const direction of ['N', 'E', 'S', 'W']) {
    input.scenes[0].headingDeg = heading; input.documentation.views[0].direction = direction;
    const page = sheets(input)[0], rectangles = solids(page).map(rect);
    const projected = volumes.map(v => ({ ...v, points: v.points.map(p => {
      const w = Projection.siteToWorld(p, heading);
      return ({ N: [w.east, w.north], E: [-w.north, w.east], S: [-w.east, -w.north], W: [w.north, -w.east] })[direction];
    }) }));
    const us = projected.flatMap(v => v.points.map(p => p[0])), min = Math.min(...us), max = Math.max(...us);
    const x0 = 15 + (page.widthMm - 88 - (max - min) * 10) / 2;
    for (let u = min + .037; u < max; u += .193) for (let z = .031; z < 3.2; z += .179) {
      const hits = [];
      for (const v of projected) {
        if (z <= v.z || z >= v.top) continue;
        const distances = [];
        for (let i = 0; i < 4; i++) {
          const a = v.points[i], b = v.points[(i + 1) % 4];
          if (u < Math.min(a[0], b[0]) || u > Math.max(a[0], b[0]) || Math.abs(a[0] - b[0]) < 1e-9) continue;
          const t = (u - a[0]) / (b[0] - a[0]);
          distances.push(a[1] + t * (b[1] - a[1]));
        }
        if (distances.length) hits.push({ distance: Math.max(...distances), color: v.color });
      }
      hits.sort((a, b) => b.distance - a.distance);
      const x = x0 + (u - min) * 10, y = 58 + (3.2 - z) * 10;
      const painted = rectangles.filter(r => x > r.x && x < r.right && y > r.y && y < r.bottom);
      assert.equal(painted.length, hits.length ? 1 : 0, `overdraw/gap heading ${heading}, ${direction}, ${u}, ${z}`);
      assert.equal(painted[0]?.color, hits[0]?.color, `depth heading ${heading}, ${direction}, ${u}, ${z}`);
    }
  }
});

test('fully removed wall retains full-door aperture schedule and structural volume conflict', () => {
  const input = scene([floor('ground', 0, [wall('wall', point(0, 0), point(10, 0), { removed: true, solidSections: [] })])]);
  opening(input, 'wall', 'full-door', 0, 10, 0, 3);
  const empty = sheets(input);
  assert.equal(solids(empty[0]).length, 0);
  assert.ok(content(empty).includes('full-door: sill 0 m; head 3 m'));
  input.authored = [structural()];
  const pages = sheets(input);
  close(area(pages[0], '#ADB9C0'), 300);
  assert.ok(content(pages).includes('opening-volume-conflict'));
});

test('all floors and setbacks use true unequal 4.1 m stacking and exact wall heights', () => {
  const lower = floor('ground', .45, [wall('lower', point(0, 0), point(10, 0), { baseM: .45 })]);
  const upper = floor('upper', 4.55, [wall('upper', point(2, 2), point(8, 2),
    { baseM: 4.55, heightM: 2.6, solidSections: [{ startM: 0, endM: 6, sillM: 0, heightM: 2.6 }] })]);
  const input = scene([lower, upper]);
  input.documentation.views[0].floorId = 'upper';
  const pages = sheets(input, { floorName: 'Upper attachment' }), r = solids(pages[0]).map(rect).sort((a, b) => b.bottom - a.bottom);
  close(r[0].bottom - r[1].bottom, 41); close(r[1].right - r[1].x, 60); close(r[1].bottom - r[1].y, 26);
  assert.ok(content(pages).includes('FLOOR ground: 0.45 m') && content(pages).includes('FLOOR upper: 4.55 m'));
  assert.equal(pages[0].metadata.floorId, 'upper');
  assert.equal(pages[0].metadata.floorName, 'Upper attachment');
});

test('explicit slab/footing/beam boxes only, missing heights and legacy roof thickness never invent volumes', () => {
  const input = scene();
  input.scenes[0].roofThicknessM = 9;
  input.authored = [
    structural('slab', 'slab', [point(5, 0, 3.3)], { widthM: 10, depthM: 4, heightM: .2 }),
    structural('footing', 'footing', [point(5, 0, -1)], { widthM: 2, depthM: 2, heightM: .4 }),
    structural('beam', 'beam', [point(2, 0, 4), point(8, 0, 4)], { widthM: .3, depthM: .6, heightM: null }),
    structural('missing', 'column', [point(10, 0, 0)], { heightM: null })
  ];
  const pages = sheets(input);
  close(area(pages[0], '#B9C5B5'), 200); close(area(pages[0], '#C9B5A8'), 80); close(area(pages[0], '#A6B9C9'), 360);
  assert.ok(content(pages).includes('bottom -1 m; top -0.6 m'));
  assert.ok(content(pages).includes('OMITTED incomplete structural ground:authored:missing'));
  assert.ok(content(pages).includes('Roof thickness alone is not a roof volume'));
});

test('supplied facade/obstacle volumes occlude walls; transparent masses and trees are disclosed', () => {
  const input = scene();
  input.scenes[0].obstacles = [
    { id: 'facade', type: 'building', x: 4, y: -1, w: 2, h: .3, baseM: 0, heightM: 2, transmittance: .5, facade: { source: 'authored' } },
    { id: 'tree', type: 'tree', x: 0, y: -2, w: 20, h: 20, baseM: 0, heightM: 100, transmittance: 0 }
  ];
  const pages = sheets(input);
  close(area(pages[0], '#CCD9E2'), 400); close(area(pages[0], '#E1E5E7'), 2600);
  assert.ok(content(pages).includes('NOT ray tracing'));
  assert.ok(content(pages).includes('OMITTED obstacle tree (tree)'));
  assert.ok(content(pages).includes('supplied transmittance 0.5'));
});

test('finite sections: axis, oblique and reversed endpoint order, wall poche and no beyond geometry', () => {
  const input = section(scene([floor('ground', 0, [
    wall('cut', point(0, 0), point(10, 0)), wall('beyond', point(0, 5), point(10, 5))
  ])]), anchor(2, 0), anchor(8, 0));
  close(area(sheets(input)[0], '#354047'), 1800);
  assert.ok(content(sheets(input)).includes('ALL geometry beyond the plane is omitted'));
  input.documentation.views[0].cut = [anchor(5, -1), anchor(5, 1)];
  close(area(sheets(input)[0], '#354047'), 60);
  input.documentation.views[0].cut = [anchor(0, -1), anchor(10, 1)];
  close(area(sheets(input)[0], '#354047'), .2 / (2 / Math.sqrt(104)) * 300);
  input.documentation.views[0].cut.reverse();
  close(area(sheets(input)[0], '#354047'), .2 / (2 / Math.sqrt(104)) * 300);
  input.documentation.views[0].cut = [anchor(20, 0), anchor(21, 0)];
  const empty = sheets(input);
  assert.equal(solids(empty[0]).length, 0);
  assert.ok(content(empty).includes('No supplied solid intersects this finite cut'));
});

test('section direction derives from endpoint order and mirrors asymmetric solids with numeric headings', () => {
  for (const heading of [0, 37, 180, 270]) {
    const input = section(scene([floor('ground', 0, [wall('short', point(1, 0), point(3, 0))])]), anchor(0, 0), anchor(10, 0));
    input.scenes[0].headingDeg = heading;
    const a = sheets(input)[0], ar = rect(solids(a)[0]);
    input.documentation.views[0].cut.reverse();
    const b = sheets(input)[0], br = rect(solids(b)[0]);
    close(br.x - ar.x, 60);
    close(area(a), area(b));
    assert.notEqual(content([a]).match(/RIGHT bearing [\d.]+/)[0], content([b]).match(/RIGHT bearing [\d.]+/)[0]);
  }
});

test('section apertures have true sill/head voids, not a horizontal fallback cut', () => {
  const w = wall();
  w.solidSections = [{ startM: 0, endM: 10, sillM: 0, heightM: .9 },
    { startM: 0, endM: 10, sillM: 2.1, heightM: .9 }];
  const input = section(scene([floor('ground', 0, [w])]), anchor(5, -1), anchor(5, 1));
  opening(input, 'wall', 'window', 0, 10, .9, 1.2);
  const shapes = solids(sheets(input)[0]).map(rect).sort((a, b) => a.y - b.y);
  assert.equal(shapes.length, 2); close(shapes[1].y - shapes[0].bottom, 12);
  close(area(sheets(input)[0]), 36);
});

test('raw point cuts subtract each source plot origin and add floor-relative z', () => {
  const input = section(scene(), anchor(-3, -2, 1), anchor(7, -2, 1));
  input.scenes[0].sourcePlotOrigin = { x: -3, y: -2 };
  input.scenes[0].floorElevationM = 4.1;
  const pages = sheets(input);
  close(area(pages[0]), 3000);
  assert.ok(content(pages).includes('Cut A site-local metres: 0, 0, 5.1; B: 10, 0, 5.1'));
});

test('cross-floor cut anchors compare resolved project z rather than raw floor-relative heights', () => {
  const input = scene([floor(), floor('upper', 4.1, [wall('upper', point(2, 2), point(8, 2),
    { baseM: 4.1, solidSections: [{ startM: 0, endM: 6, sillM: 0, heightM: 3 }] })])]);
  input.scenes[1].sourcePlotOrigin = { x: -3, y: -2 };
  section(input, anchor(0, 0, 4.1), anchor(7, -2, 0, 'upper'));
  const pages = sheets(input);
  assert.ok(content(pages).includes('Cut A site-local metres: 0, 0, 4.1; B: 10, 0, 4.1'));
  close(area(pages[0], '#354047'), 3000);
  input.documentation.views[0].cut[0].point.z = 0;
  assert.throws(() => sheets(input), /sloping cut/);
});

test('equal floor levels keep readable distinct level keys, with physical values in the schedule', () => {
  const input = scene([floor(), floor('annex', 0, [wall('annex', point(11, 0), point(13, 0))])]);
  const pages = sheets(input), bars = pages[0].primitives.filter(p => p.type === 'text' && /^L\d+$/.test(p.text));
  assert.equal(bars.length, 2);
  assert.ok(Math.abs(bars[1].yMm - bars[0].yMm) >= 4);
  assert.ok(content(pages).includes('FLOOR annex: 0 m') && content(pages).includes('FLOOR ground: 0 m'));
  assert.ok(content(pages).includes('Saved elevation view ID: saved'));
});

test('wall/entity cut hosts resolve only exact projected identities and foundation anchor semantics', () => {
  const input = section(scene());
  const f = input.scenes[0];
  const wa = { kind: 'wall', floorId: 'ground', entityId: 'wall', offsetM: 2, heightM: 0 };
  f.rooms = [{ id: 'room', rect: { x: 6, y: -1, w: 2, h: 2 } }];
  const en = (entityKind, entityId) => ({ kind: 'entity', floorId: 'ground', entityKind, entityId });
  input.documentation.views[0].cut = [wa, en('room', 'room')];
  close(area(sheets(input)[0]), 1500);
  f.furniture = [{ id: 'chair', rect: { x: 6, y: -1, w: 2, h: 2 } }];
  input.documentation.views[0].cut[1] = en('furniture', 'chair');
  close(area(sheets(input)[0]), 1500);
  f.obstacles = [{ id: 'mass', type: 'building', x: 6, y: -1, w: 2, h: 2, baseM: -1, heightM: 2, transmittance: 0 }];
  input.documentation.views[0].cut[1] = en('obstacle', 'mass');
  assert.ok(content(sheets(input)).includes('B: 7, 0, 0'));
  input.authored = [structural('cut', 'grid', [point(6, 0), point(8, 0)], { widthM: null, depthM: null, heightM: null, material: null })];
  input.documentation.views[0].cut[1] = en('structural', 'ground:authored:cut');
  assert.ok(content(sheets(input)).includes('B: 7, 0, 0'));
  input.documentation.views[0].cut[1] = en('fixture', 'ground:authored:cut');
  assert.throws(() => sheets(input), /missing-host/);
});

test('opening entity cuts use aperture center; removed hosts and broken/cyclic authored results never snap', () => {
  const input = section(scene());
  opening(input, 'wall', 'door', 6, 2, 0, 2);
  const en = { kind: 'entity', floorId: 'ground', entityKind: 'opening', entityId: 'door' };
  input.documentation.views[0].cut = [anchor(0, 0, 1), en];
  assert.ok(content(sheets(input)).includes('B: 7, 0, 1'));
  input.scenes[0].walls[0].removed = true; input.scenes[0].walls[0].solidSections = [];
  assert.throws(() => sheets(input), /removed-host/);
  input.scenes[0].walls[0].removed = false;
  const cyclic = structural('cycle');
  cyclic.anchorStatus = 'unresolved'; cyclic.anchors = [{ status: 'unresolved', point: null, causeCode: 'cyclic-host' }];
  input.authored = [cyclic];
  input.documentation.views[0].cut[1] = { ...en, entityKind: 'structural', entityId: cyclic.record.id };
  assert.throws(() => sheets(input), /unresolved-host/);
});

test('door sill boundary cut anchors match the foundation even with no solid below the opening', () => {
  const input = section(scene(), anchor(0, 0),
    { kind: 'wall', floorId: 'ground', entityId: 'wall', offsetM: 5, heightM: 0 });
  input.scenes[0].walls[0].solidSections = [
    { startM: 0, endM: 4, sillM: 0, heightM: 3 },
    { startM: 4, endM: 6, sillM: 2, heightM: 1 },
    { startM: 6, endM: 10, sillM: 0, heightM: 3 }
  ];
  opening(input, 'wall', 'door', 4, 2, 0, 2);
  assert.ok(content(sheets(input)).includes('B: 5, 0, 0'));
  input.documentation.views[0].cut[0].point.z = 1;
  input.documentation.views[0].cut[1].heightM = 1;
  assert.throws(() => sheets(input), /host-void/);
});

test('invalid cuts explicitly reject sloping, degenerate, missing floor/host, unknown fields and wall voids', () => {
  for (const [a, b, pattern] of [
    [anchor(0, 0), anchor(10, 0, 1), /sloping cut/],
    [anchor(0, 0), anchor(0, 0), /distinct/],
    [anchor(0, 0), anchor(10, 0, 0, 'missing'), /missing-floor/],
    [null, anchor(10, 0), /unknown-anchor/],
    [anchor(0, 0), { kind: 'entity', floorId: 'ground', entityKind: 'room', entityId: 'no-host' }, /missing-host/],
    [anchor(0, 0), { ...anchor(10, 0), extra: true }, /fields/],
    [anchor(0, 0), { kind: 'wall', floorId: 'ground', entityId: 'wall', offsetM: -1, heightM: 0 }, /host-bounds/]
  ]) assert.throws(() => sheets(section(scene(), a, b)), pattern);
  const input = section(scene(), anchor(0, 0, 1),
    { kind: 'wall', floorId: 'ground', entityId: 'wall', offsetM: 5, heightM: 1 });
  input.scenes[0].walls[0].solidSections = [{ startM: 0, endM: 4, sillM: 0, heightM: 3 }];
  assert.throws(() => sheets(input), /host-void/);
});

test('whole-project registration and unknown required geometry failures cannot hide unselected floors', () => {
  for (const code of ['missing-geometry', 'invalid-geometry', 'missing-plot', 'inconsistent-site-frame', 'unresolved-site-frame']) {
    const input = scene(); input.diagnostics.push({ code, ownerId: 'hidden-floor' });
    assert.throws(() => sheets(input), /Whole-project prerequisites/);
  }
  for (const change of [
    f => { f.headingDeg = 37; }, f => { f.plot.w = 30; }, f => { f.sourcePlotOrigin = null; },
    f => { f.floorElevationM = null; }, f => { f.coordinateSpace = 'floor-local'; },
    f => { delete f.walls[0].solidSections; }, f => { f.walls[0].baseM = null; },
    f => { f.unresolvedOpenings = [{}]; }, f => { f.diagnostics.push({ level: 'error', message: 'Rejected geometry' }); }
  ]) {
    const input = scene([floor(), floor('upper')]); change(input.scenes[1]);
    assert.throws(() => sheets(input), /frame|floor|solidSections|physical|openings/i);
  }
  const input = scene(); input.scenes[0].obstacles = [{ id: 'bad', type: 'building', x: 0, y: 0, w: 1, h: 1, heightM: null, baseM: 0, transmittance: 0 }];
  assert.throws(() => sheets(input), /physical volume/);
});

test('continuations retain metadata and every diagnostic, levels, provenance and caveat', () => {
  const input = scene();
  input.siteDatum.elevationM = 123.45;
  input.scenes[0].diagnostics = Array.from({ length: 65 }, (_, i) => ({ level: 'warning', message: `Unique diagnostic ${i}: check supplied dimensions.` }));
  const pages = sheets(input, { paper: 'A4', orientation: 'portrait' }), all = content(pages);
  assert.ok(pages.length > 1);
  for (const page of pages) assert.deepEqual(page.metadata, pages[0].metadata);
  for (let i = 0; i < 65; i++) assert.ok(all.includes(`Unique diagnostic ${i}:`));
  assert.ok(all.includes('absolute 123.45 m'));
  assert.ok(all.includes('NOT FOR CONSTRUCTION'));
  for (const page of pages.slice(1)) assert.equal(solids(page).length, 0);
  assert.throws(() => single(input), /notes.*createSheets/i);
});

test('Unicode XML is preserved and escaped; invalid controls/surrogates rejected', () => {
  const title = '北面 <élevation> & "屋"';
  const pages = sheets(scene(), { title, floorName: 'Étage 北' });
  const svg = Renderer.toSVG(pages[0]);
  assert.ok(svg.includes('北面 &lt;élevation&gt; &amp;'));
  assert.ok(content(pages).includes(title));
  for (const value of ['bad\u0000', 'bad\ud800', 'bad\uffff']) assert.throws(() => sheets(scene(), { title: value }), /text/);
});

test('resource guards bound overlap work, physical volume count and note pagination', () => {
  const dense = scene();
  dense.scenes[0].walls = Array.from({ length: 1500 }, (_, i) => wall(`wall-${i}`, point(0, i / 100000), point(10, i / 100000)));
  assert.throws(() => sheets(dense), /work limit/);
  dense.scenes[0].walls = Array.from({ length: 4001 }, (_, i) => wall(`wall-${i}`));
  assert.throws(() => sheets(dense), /4000 volumes/);
  const textHeavy = scene();
  textHeavy.scenes[0].diagnostics = Array.from({ length: 40 }, () => ({ message: 'X'.repeat(16000) }));
  assert.throws(() => sheets(textHeavy), /character budget/);
  const pageHeavy = scene();
  pageHeavy.scenes[0].diagnostics = Array.from({ length: 30 }, () => ({ message: 'X'.repeat(16000) }));
  assert.throws(() => sheets(pageHeavy, { paper: 'A4', orientation: 'portrait' }), /100 pages/);
});

test('real Model/Projection saved elevation and hosted section render without mutations', () => {
  const p = createFixture('multiple-floors').project;
  p.floors[0].heightM = 4.1;
  for (const f of p.floors) f.legacy.context.plate.sitePlot = { x: -2, y: -3, w: 14, h: 14 };
  p.legacy = copy(p.floors[0].legacy);
  p.documentation = { version: 1, views: [{ id: 'saved', name: 'North saved', floorId: 'upper',
    kind: 'elevation', scaleDenominator: 100, direction: 'N', cut: [] }], sheets: [] };
  const input = Projection.build(p), before = JSON.stringify(input);
  const pages = sheets(input);
  assert.ok(content(pages).includes('FLOOR upper: 4.55 m'));
  assert.equal(JSON.stringify(input), before);
  Object.assign(p.documentation.views[0], { kind: 'section', cut: [anchor(0, 4), anchor(10, 4)], direction: null });
  const cut = Projection.build(p), cutBefore = JSON.stringify(cut);
  assert.ok(solids(sheets(cut)[0]).length > 0);
  assert.equal(JSON.stringify(cut), cutBefore);
});

test('actual PDF exports numeric physical media and vector section geometry', async () => {
  const pages = sheets(section(), { paper: 'A4', orientation: 'landscape' });
  const bytes = await Export.pdfBytes(pages);
  const doc = await PDF.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), pages.length);
  doc.getPages().forEach((p, i) => { close(p.getWidth(), pages[i].widthMm * 72 / 25.4); close(p.getHeight(), pages[i].heightMm * 72 / 25.4); });
  const p = doc.getPages()[0], streams = p.node.Contents();
  const source = Array.from({ length: streams.size() }, (_, i) =>
    Buffer.from(PDF.decodePDFRawStream(doc.context.lookup(streams.get(i))).decode()).toString('latin1')).join('\n');
  assert.match(source, /\bm\n/); assert.match(source, /\bl\n/); assert.match(source, /\bf\n/);
  assert.doesNotMatch(source, /NaN|Infinity|\/Subtype\s*\/Image/);
});
