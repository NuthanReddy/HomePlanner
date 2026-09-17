(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerRegions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const fail = message => { throw new Error(`Planner regions: ${message}`); };
  const resolution = (a, b) => 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
  const positiveSpan = (a, b) => b - a > resolution(a, b);
  function rectangle(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a rectangle.`);
    const result = {};
    for (const key of ['x', 'y', 'w', 'h']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Number.isFinite(descriptor.value))
        fail(`${label}.${key} must be a supplied finite number.`);
      result[key] = descriptor.value;
    }
    if (!(result.w > 0 && result.h > 0)) fail(`${label} dimensions must be positive.`);
    const right = result.x + result.w, bottom = result.y + result.h, size = result.w * result.h;
    if (![right, bottom, size].every(Number.isFinite)) fail(`${label} exceeds the finite coordinate/area range.`);
    if (!(positiveSpan(result.x, right) && positiveSpan(result.y, bottom) && size > 0))
      fail(`${label} is below the supported numerical resolution.`);
    return result;
  }
  function rectangles(values, label) {
    if (!Array.isArray(values)) fail(`${label} must be an array of rectangles.`);
    return Array.from({ length: values.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(values, index);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} must not contain missing rectangles or accessors.`);
      return rectangle(descriptor.value, `${label}[${index}]`);
    });
  }
  const order = (a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h;
  const frozen = value => Object.freeze(rectangle(value, 'Result'));
  function overlap(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
    return positiveSpan(x, right) && positiveSpan(y, bottom) ? frozen({ x, y, w: right - x, h: bottom - y }) : null;
  }
  function intersection(a, b) {
    return overlap(rectangle(a, 'First rectangle'), rectangle(b, 'Second rectangle'));
  }
  function subtractRectangle(base, cutters) {
    let pieces = [rectangle(base, 'Base rectangle')];
    const cuts = rectangles(cutters, 'Cutters').sort(order);
    for (const cutter of cuts) {
      const next = [];
      for (const piece of pieces) {
        const cut = overlap(piece, cutter);
        if (!cut) { next.push(piece); continue; }
        const right = piece.x + piece.w, bottom = piece.y + piece.h;
        const cutRight = cut.x + cut.w, cutBottom = cut.y + cut.h;
        if (positiveSpan(piece.y, cut.y)) next.push(frozen({ x: piece.x, y: piece.y, w: piece.w, h: cut.y - piece.y }));
        if (positiveSpan(cutBottom, bottom)) next.push(frozen({ x: piece.x, y: cutBottom, w: piece.w, h: bottom - cutBottom }));
        if (positiveSpan(piece.x, cut.x)) next.push(frozen({ x: piece.x, y: cut.y, w: cut.x - piece.x, h: cut.h }));
        if (positiveSpan(cutRight, right)) next.push(frozen({ x: cutRight, y: cut.y, w: right - cutRight, h: cut.h }));
      }
      pieces = next;
    }
    return Object.freeze(pieces.sort(order).map(frozen));
  }
  function area(values) {
    const items = rectangles(values, 'Area rectangles');
    let total = 0, compensation = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < i; j++) if (overlap(items[i], items[j]))
        fail('Area rectangles must be non-overlapping; subtract their union first.');
      const corrected = items[i].w * items[i].h - compensation, next = total + corrected;
      if (!Number.isFinite(next)) fail('Total area exceeds the finite numerical range.');
      compensation = (next - total) - corrected;
      total = next;
    }
    return total;
  }
  function reservationBounds(carpet, module) {
    const clear = rectangle(carpet, 'Carpet'), centreline = rectangle(module, 'Module');
    const west = clear.x - centreline.x, north = clear.y - centreline.y;
    const east = centreline.x + centreline.w - (clear.x + clear.w);
    const south = centreline.y + centreline.h - (clear.y + clear.h);
    if ([west, north, east, south].some(margin => margin < 0)) fail('Module must contain the complete carpet rectangle.');
    const result = frozen({ x: centreline.x - west, y: centreline.y - north,
      w: centreline.w + west + east, h: centreline.h + north + south });
    if ((west > 0 && result.x >= centreline.x) || (north > 0 && result.y >= centreline.y) ||
        (east > 0 && result.x + result.w <= centreline.x + centreline.w) ||
        (south > 0 && result.y + result.h <= centreline.y + centreline.h))
      fail('Reservation wall allowance is below the supported numerical resolution.');
    return result;
  }
  return Object.freeze({ intersection, subtractRectangle, area, reservationBounds });
});
