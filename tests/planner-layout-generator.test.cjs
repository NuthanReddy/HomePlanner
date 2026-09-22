'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Generator = require('../planner-layout-generator.js');

const EPS = 1e-7, WALL = 0.1;
const intersects = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS &&
  a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
const inside = (rect, bounds) => rect.x >= bounds.x - EPS && rect.y >= bounds.y - EPS &&
  rect.x + rect.w <= bounds.x + bounds.w + EPS && rect.y + rect.h <= bounds.y + bounds.h + EPS;
function subtract(rects, used) {
  const result = [];
  for (const rect of rects) {
    if (!intersects(rect, used)) { result.push(rect); continue; }
    const right = rect.x + rect.w, bottom = rect.y + rect.h;
    const usedRight = used.x + used.w, usedBottom = used.y + used.h;
    if (used.x > rect.x + EPS) result.push({ x: rect.x, y: rect.y, w: used.x - rect.x, h: rect.h });
    if (usedRight < right - EPS) result.push({ x: usedRight, y: rect.y, w: right - usedRight, h: rect.h });
    if (used.y > rect.y + EPS) result.push({ x: rect.x, y: rect.y, w: rect.w, h: used.y - rect.y });
    if (usedBottom < bottom - EPS) result.push({ x: rect.x, y: usedBottom, w: rect.w, h: bottom - usedBottom });
  }
  return result.filter(rect => rect.w > EPS && rect.h > EPS);
}
const scoreLess = (a, b) => !b || a.some((value, index) => Math.abs(value - b[index]) > EPS &&
  a.slice(0, index).every((prior, priorIndex) => Math.abs(prior - b[priorIndex]) <= EPS) &&
  value < b[index]);

function fixture() {
  const context = { placed: null };
  const dependencies = {
    internalWallM: WALL,
    epsilon: EPS,
    subtractFree: subtract,
    occupiedBounds: item => item.module,
    serviceKeepClear: () => [],
    rectInside: inside,
    carpetModule: carpet => ({ x: carpet.x - WALL / 2, y: carpet.y - WALL / 2,
      w: carpet.w + WALL, h: carpet.h + WALL }),
    moduleClear(module, id, request, placement, geometry) {
      return inside(module, geometry.core) && !placement.placed.some(item => item.req.id !== id && intersects(item.module, module));
    },
    balconyTouches: () => false,
    balconyEligible: () => true,
    hardAdjacencyValid: () => true,
    servicePlacementRank: () => [0, 0, 0],
    directionPenalty: () => 0,
    adjacencyPenalty: () => 0,
    rolePenalty: () => 0,
    recalculatePlan(plan, geometry) {
      plan.carpetArea = plan.placed.reduce((sum, item) => sum + item.carpet.w * item.carpet.h, 0);
      plan.unassigned = geometry.core.w * geometry.core.h -
        plan.placed.reduce((sum, item) => sum + item.module.w * item.module.h, 0);
      return plan;
    },
    balconyAttachments: () => [],
    circulationAnalysis: () => ({ inaccessible: [] }),
    scoreLess,
    assignBalconies: () => {},
    optimizeLeftovers: plan => plan
  };
  context.generator = Generator.create(dependencies);
  return context;
}

const requests = [
  { id: 'living-1', type: 'living', priority: 0, seq: 0,
    range: { minW: 3, minD: 3, maxW: 4, maxD: 4 } },
  { id: 'bed-1', type: 'bedroom', priority: 1, seq: 1,
    range: { minW: 2.5, minD: 3, maxW: 3.5, maxD: 4 } }
];
const geometry = { core: { x: 0, y: 0, w: 8, h: 7 }, balconies: [] };

test('extracted generator produces deterministic non-overlapping plans', () => {
  const generator = fixture().generator;
  const first = generator.packProgram(geometry, {}, requests);
  const second = generator.packProgram(geometry, {}, requests);
  assert.deepEqual(second, first);
  assert.equal(first.unmet.length, 0);
  assert.equal(first.placed.length, 2);
  assert.equal(intersects(first.placed[0].module, first.placed[1].module), false);
  first.placed.forEach(item => assert.equal(inside(item.module, geometry.core), true));
});

test('request ordering keeps services first and ensuite bathrooms after their bedrooms', () => {
  const generator = fixture().generator;
  const ordered = generator.order([
    ...requests,
    { id: 'bath-2', type: 'bathroom', accessMode: 'ensuite', bedroomId: 'bed-1', priority: 4, seq: 2,
      range: { minW: 1, minD: 1, maxW: 2, maxD: 2 } },
    { id: 'stair-1', type: 'staircase', priority: 6, seq: 3,
      range: { minW: 2, minD: 1, maxW: 2, maxD: 1 } }
  ], 'large');
  assert.equal(ordered[0].id, 'stair-1');
  assert.ok(ordered.findIndex(item => item.id === 'bath-2') > ordered.findIndex(item => item.id === 'bed-1'));
});

test('missing generator dependencies fail explicitly', () => {
  assert.throws(() => Generator.create({ internalWallM: WALL, epsilon: EPS }), /dependency/);
});
