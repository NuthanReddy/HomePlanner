const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Regions = require('../planner-regions.js');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('rectangle kernel is frozen, dependency-free and identical in browser and CommonJS', () => {
  assert.deepEqual(Object.keys(Regions), ['intersection', 'subtractRectangle', 'area', 'reservationBounds']);
  assert.ok(Object.isFrozen(Regions));
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-regions.js'), 'utf8'), sandbox);
  assert.ok(Object.isFrozen(sandbox.HomePlannerRegions));
  const base = { x: -2, y: 1, w: 10, h: 8 }, cuts = [{ x: 0, y: 3, w: 2, h: 3 }];
  assert.equal(JSON.stringify(sandbox.HomePlannerRegions.subtractRectangle(base, cuts)),
    JSON.stringify(Regions.subtractRectangle(base, cuts)));
});

test('intersection only returns positive-area detached rectangles, not edge or corner contact', () => {
  const a = freeze({ x: 0, y: 0, w: 4, h: 3 }), b = freeze({ x: 2, y: 1, w: 4, h: 3 });
  assert.deepEqual(Regions.intersection(a, b), { x: 2, y: 1, w: 2, h: 2 });
  assert.ok(Object.isFrozen(Regions.intersection(a, a)));
  assert.notEqual(Regions.intersection(a, a), a);
  assert.equal(Regions.intersection(a, { x: 4, y: 0, w: 1, h: 1 }), null);
  assert.equal(Regions.intersection(a, { x: 4, y: 3, w: 1, h: 1 }), null);
  assert.equal(Regions.intersection(a, { x: 10, y: 10, w: 1, h: 1 }), null);
});

test('contained, partial, disjoint, duplicate and overlapping cutters conserve the base minus their union', () => {
  const base = freeze({ x: 0, y: 0, w: 10, h: 8 });
  const cases = [
    [[], 80],
    [[{ x: 2, y: 2, w: 3, h: 4 }], 68],
    [[{ x: -2, y: 2, w: 4, h: 4 }], 72],
    [[{ x: 20, y: 20, w: 1, h: 1 }], 80],
    [[{ x: -1, y: -1, w: 12, h: 10 }], 0],
    [[{ x: 1, y: 1, w: 4, h: 3 }, { x: 3, y: 2, w: 4, h: 3 }], 60],
    [[{ x: 1, y: 1, w: 4, h: 3 }, { x: 1, y: 1, w: 4, h: 3 }], 68]
  ];
  for (const [cutters, expected] of cases) {
    freeze(cutters);
    const before = JSON.stringify({ base, cutters }), pieces = Regions.subtractRectangle(base, cutters);
    close(Regions.area(pieces), expected);
    assert.ok(Object.isFrozen(pieces));
    for (const piece of pieces) {
      assert.ok(Object.isFrozen(piece));
      assert.deepEqual(Regions.intersection(piece, base), piece);
      assert.ok(cutters.every(cutter => Regions.intersection(piece, cutter) === null));
    }
    assert.deepEqual(Regions.subtractRectangle(base, [...cutters].reverse()), pieces);
    assert.equal(JSON.stringify({ base, cutters }), before);
  }
  assert.equal(Regions.area([]), 0);
});

test('subtraction works across multiple host rectangles with no duplicate service or wall area', () => {
  const hosts = [{ x: 0, y: 0, w: 5, h: 8 }, { x: 5, y: 0, w: 5, h: 8 }];
  const service = { x: 4, y: 2, w: 2, h: 3 };
  const usable = hosts.flatMap(host => Regions.subtractRectangle(host, [service]));
  close(Regions.area(usable), 74);
  close(Regions.area([...usable, service]), 80);
});

test('roundoff contacts do not produce phantom slivers, while small origin-relative geometry remains supported', () => {
  const base = { x: .7, y: .7, w: 5, h: 6.6 }, cut = { x: .7, y: 2.94, w: 5, h: 2.12 };
  const regions = Regions.subtractRectangle(base, [cut]);
  assert.ok(regions.every(region => Regions.intersection(region, cut) === null));
  close(Regions.area(regions), 5 * (6.6 - 2.12));
  const tiny = { x: 0, y: 0, w: 1e-20, h: 2e-20 };
  assert.deepEqual(Regions.intersection(tiny, tiny), tiny);
  assert.throws(() => Regions.intersection({ x: 5, y: 0, w: Number.EPSILON * 5, h: 1 }, base), /resolution/);
});

test('fractional-coordinate differences conserve area with deterministic union subtraction', () => {
  let seed = 271828;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let n = 0; n < 100; n++) {
    const base = { x: -3.1 + random() * 2, y: -1.7 + random(), w: 8 + random() * 4, h: 7 + random() * 4 };
    const cuts = Array.from({ length: 6 }, () => ({ x: -4 + random() * 14, y: -3 + random() * 14,
      w: .1 + random() * 3, h: .1 + random() * 3 }));
    const free = Regions.subtractRectangle(base, cuts), removed = Regions.subtractRectangle(base, free);
    close(Regions.area(free) + Regions.area(removed), Regions.area([base]));
    assert.deepEqual(Regions.subtractRectangle(base, [...cuts].reverse()), free);
  }
});

test('reservation bounds expand each centreline edge by its own clear-to-module margin', () => {
  const carpet = freeze({ x: 2, y: 3, w: 1.5, h: 2 });
  const module = freeze({ x: 1.94, y: 2.9, w: 1.62, h: 2.25 });
  const result = Regions.reservationBounds(carpet, module);
  close(result.x, 1.88); close(result.y, 2.8); close(result.w, 1.74); close(result.h, 2.5);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(Regions.reservationBounds(carpet, carpet), carpet);
  assert.throws(() => Regions.reservationBounds(carpet, { ...module, x: 2.01 }), /contain/);
  assert.throws(() => Regions.reservationBounds(carpet, { ...module, w: 1.5 }), /contain/);
});

test('invalid, non-finite, unrepresentable and overlapping area inputs fail rather than invent dimensions', () => {
  const base = { x: 0, y: 0, w: 4, h: 4 };
  const invalid = [null, {}, { ...base, w: 0 }, { ...base, h: -1 },
    ...[NaN, Infinity, -Infinity, '1'].map(x => ({ ...base, x })),
    { ...base, x: 1e308, w: 1e308 }, { ...base, w: 1e308, h: 1e308 },
    { ...base, x: 1e20, w: 1 }, { ...base, w: 1e-200, h: 1e-200 }];
  for (const bad of invalid) {
    assert.throws(() => Regions.intersection(base, bad), /rectangle|finite|positive|range|resolution/);
    assert.throws(() => Regions.subtractRectangle(base, [bad]));
    assert.throws(() => Regions.area([bad]));
    assert.throws(() => Regions.reservationBounds(base, bad));
  }
  assert.throws(() => Regions.area([base, base]), /non-overlapping/);
  assert.throws(() => Regions.subtractRectangle(base, null), /array/);
  assert.throws(() => Regions.area(new Array(1)), /missing/);
  let read = false;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'x', { get() { read = true; return 0; } });
  assert.throws(() => Regions.intersection(base, accessor), /supplied finite/);
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, '0', { get() { read = true; return base; } });
  assert.throws(() => Regions.area(arrayAccessor), /accessors/);
  assert.equal(read, false);
  assert.throws(() => Regions.area([
    { x: 0, y: 0, w: 1e154, h: 1e154 }, { x: 1e154, y: 0, w: 1e154, h: 1e154 }
  ]), /Total area/);
});
