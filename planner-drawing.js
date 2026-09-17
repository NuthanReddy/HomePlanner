(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./planner-model.js') : root.HomePlannerModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
  'use strict';
  const PAPER_SIZES = Object.freeze({
    A4: Object.freeze({ widthMm: 210, heightMm: 297 }),
    A3: Object.freeze({ widthMm: 297, heightMm: 420 }),
    A2: Object.freeze({ widthMm: 420, heightMm: 594 })
  });
  const INK = '#263238', GREY = '#647078', LIGHT = '#E8ECEE', WALL = '#354047';
  const EPS = 1e-7, MAX_PRIMITIVES = 30000, MAX_COMMANDS = 250000;
  const fail = message => { throw new Error(`Architectural drawing: ${message}`); };
  const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const plain = value => value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const dense = value => Array.isArray(value) && Object.keys(value).length === value.length &&
    Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
  function keys(value, names, label) {
    if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) fail(`Invalid ${label} structure.`);
  }
  function string(value, label, max = 16384) {
    if (typeof value !== 'string' || !value.trim() || value.length > max ||
        /[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/u.test(value) ||
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) fail(`Invalid ${label} text.`);
    return value;
  }
  function choice(value, values, label) {
    if (!values.includes(value)) fail(`Unsupported ${label}: ${String(value)}.`);
    return value;
  }
  const textWidth = (text, size) => Array.from(text).reduce((n, char) =>
    n + (/[ilI1 .,:;'|!]/.test(char) ? .38 : /[MW@%]/.test(char) ? 1 : char.codePointAt(0) > 255 ? 1.05 : .76) * size, 0);
  function textBounds(p) {
    const width = textWidth(p.text, p.fontSizeMm), a = p.rotationDeg * Math.PI / 180;
    const left = p.align === 'middle' ? -width / 2 : p.align === 'end' ? -width : 0;
    const corners = [[left, -p.fontSizeMm], [left + width, -p.fontSizeMm],
      [left, .3 * p.fontSizeMm], [left + width, .3 * p.fontSizeMm]]
      .map(([x, y]) => ({ x: p.xMm + x * Math.cos(a) - y * Math.sin(a), y: p.yMm + x * Math.sin(a) + y * Math.cos(a) }));
    return bounds(corners);
  }
  function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const overlaps = (a, b, gap = .65) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  const contains = (outer, inner) => inner.x >= outer.x - EPS && inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS && inner.y + inner.h <= outer.y + outer.h + EPS;
  function strokedSegmentIntersectsBox(a, b, width, r) {
    const radius = width / 2 + EPS;
    if (!overlaps(bounds([a, b]), r, radius)) return false;
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    let enter = 0, exit = 1;
    for (const [start, delta, low, high] of [[a.x, dx, r.x, r.x + r.w], [a.y, dy, r.y, r.y + r.h]]) {
      if (Math.abs(delta) < EPS) {
        if (start < low || start > high) { enter = 1; exit = 0; break; }
      } else {
        const first = (low - start) / delta, last = (high - start) / delta;
        enter = Math.max(enter, Math.min(first, last));
        exit = Math.min(exit, Math.max(first, last));
      }
    }
    if (enter <= exit) return true;
    // Round stroke caps and slanted edges need Euclidean distance, not an inflated AABB.
    const pointToBox = p => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w),
      Math.max(r.y - p.y, 0, p.y - r.y - r.h));
    if (Math.min(pointToBox(a), pointToBox(b)) <= radius) return true;
    return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].some(([x, y]) => {
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
      return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= radius;
    });
  }
  function cubicValues(a, b, c, d) {
    const A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a;
    const ts = [0, 1], disc = B * B - 4 * A * C;
    if (Math.abs(A) < EPS) { if (Math.abs(B) > EPS) ts.push(-C / B); }
    else if (disc >= 0) ts.push((-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A));
    return ts.filter(t => t >= 0 && t <= 1).map(t =>
      (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d);
  }
  function validateSheet(sheet) {
    keys(sheet, ['version', 'widthMm', 'heightMm', 'metadata', 'primitives'], 'sheet');
    if (sheet.version !== 1 || !finite(sheet.widthMm) || !finite(sheet.heightMm) ||
        sheet.widthMm <= 0 || sheet.heightMm <= 0 || sheet.widthMm > 1000 || sheet.heightMm > 1000) fail('Invalid sheet media box.');
    const m = sheet.metadata;
    keys(m, ['projectId', 'revision', 'floorId', 'floorName', 'title', 'paper', 'orientation', 'scaleDenominator', 'units', 'assumptions'], 'metadata');
    ['projectId', 'floorId', 'floorName', 'title'].forEach(key => string(m[key], key));
    if (!Number.isSafeInteger(m.revision) || m.revision < 0) fail('Invalid revision.');
    choice(m.paper, Object.keys(PAPER_SIZES), 'paper');
    choice(m.orientation, ['portrait', 'landscape'], 'orientation');
    choice(m.scaleDenominator, [50, 75, 100], 'scale');
    choice(m.units, ['metric', 'imperial'], 'units');
    const size = PAPER_SIZES[m.paper];
    if (sheet.widthMm !== size[m.orientation === 'portrait' ? 'widthMm' : 'heightMm'] ||
        sheet.heightMm !== size[m.orientation === 'portrait' ? 'heightMm' : 'widthMm']) fail('Media box does not match paper and orientation.');
    if (!Array.isArray(m.assumptions) || m.assumptions.length > 200 || !dense(m.assumptions)) fail('Invalid assumptions.');
    m.assumptions.forEach(value => string(value, 'assumption'));
    if (!Array.isArray(sheet.primitives) || sheet.primitives.length > MAX_PRIMITIVES || !dense(sheet.primitives)) fail('Primitive limit exceeded or sparse primitives.');
    const media = { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm };
    let total = 0;
    for (const p of sheet.primitives) {
      if (!plain(p)) fail('Invalid primitive.');
      if (p.type === 'text') {
        keys(p, ['type', 'xMm', 'yMm', 'text', 'fontSizeMm', 'align', 'rotationDeg', 'color'], 'text primitive');
        string(p.text, 'primitive');
        if (![p.xMm, p.yMm, p.fontSizeMm, p.rotationDeg].every(finite) ||
            p.fontSizeMm <= 0 || p.fontSizeMm > 100 || Math.abs(p.rotationDeg) > 360) fail('Invalid text metrics.');
        choice(p.align, ['start', 'middle', 'end'], 'text alignment');
        if (typeof p.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(p.color)) fail('Invalid text color.');
        if (!contains(media, textBounds(p))) fail('Text exceeds sheet media box.');
      } else if (p.type === 'path') {
        keys(p, ['type', 'commands', 'fill', 'stroke', 'strokeWidthMm'], 'path primitive');
        for (const color of [p.fill, p.stroke]) if (color !== null && (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color))) fail('Invalid path color.');
        if (!finite(p.strokeWidthMm) || p.strokeWidthMm < 0 || p.strokeWidthMm > 10 ||
            !Array.isArray(p.commands) || !p.commands.length || p.commands.length > MAX_COMMANDS || !dense(p.commands)) fail('Invalid path metrics.');
        total += p.commands.length;
        if (total > MAX_COMMANDS) fail('Path command limit exceeded.');
        let current = null, start = null;
        const check = (x, y) => {
          const half = p.stroke === null ? 0 : p.strokeWidthMm / 2;
          if (x < half - EPS || y < half - EPS || x > sheet.widthMm - half + EPS || y > sheet.heightMm - half + EPS) fail('Path exceeds sheet media box.');
        };
        for (const cmd of p.commands) {
          if (!Array.isArray(cmd) || !dense(cmd) || !Object.hasOwn({ M: 3, L: 3, C: 7, Z: 1 }, cmd[0]) ||
              cmd.length !== ({ M: 3, L: 3, C: 7, Z: 1 })[cmd[0]] || !cmd.slice(1).every(finite)) fail('Invalid path command.');
          if (cmd[0] !== 'M' && !current) fail('A path must begin with M.');
          if (cmd[0] === 'C') {
            // Controls can legitimately leave the media; only the actual curve extrema constrain its ink.
            cubicValues(current[0], cmd[1], cmd[3], cmd[5]).forEach(x => check(x, current[1]));
            cubicValues(current[1], cmd[2], cmd[4], cmd[6]).forEach(y => check(current[0], y));
            current = [cmd[5], cmd[6]];
          } else if (cmd[0] === 'Z') current = start;
          else { current = [cmd[1], cmd[2]]; check(...current); if (cmd[0] === 'M') start = current; }
        }
      } else fail(`Unsupported primitive type: ${p.type}.`);
    }
    return sheet;
  }
  function wrap(text, width, size) {
    const words = text.split(/\s+/u), lines = [];
    let line = '';
    for (const word of words) {
      if (textWidth(word, size) > width) return null;
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) > width) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function wrapAssumption(value, width, size) {
    const wrapped = wrap(value, width, size);
    if (wrapped) return wrapped;
    const lines = [];
    let line = '', lineWidth = 0;
    for (const word of value.split(/\s+/u)) {
      const joinedWidth = lineWidth + textWidth(' ', size) + textWidth(word, size);
      if (line && joinedWidth <= width) { line += ` ${word}`; lineWidth = joinedWidth; continue; }
      if (line) { lines.push(line); line = ''; lineWidth = 0; }
      for (const char of word) {
        const charWidth = textWidth(char, size);
        if (lineWidth + charWidth > width) {
          if (!line) fail('Assumption character does not fit the readable text width.');
          lines.push(line); line = ''; lineWidth = 0;
        }
        line += char; lineWidth += charWidth;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function lengthLabel(m, units) {
    if (units === 'metric') return `${m.toFixed(2)} m`;
    const inches = Math.round(m / .0254), feet = Math.floor(inches / 12);
    return `${feet}'-${inches % 12}"`;
  }
  const rectangleCommands = r => [['M', r.x, r.y], ['L', r.x + r.w, r.y],
    ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['Z']];
  function mergedRanges(ranges) {
    const result = [];
    ranges.sort((a, b) => a[0] - b[0]);
    for (const [a, b] of ranges) {
      const last = result[result.length - 1];
      if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
      else result.push([a, b]);
    }
    return result;
  }
  function wallUnion(rects) {
    if (rects.length > 2000) fail('Wall complexity exceeds the bounded sheet renderer (2000 cut rectangles).');
    const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.w]))].sort((a, b) => a - b);
    const result = [], active = new Map();
    for (let i = 0; i < xs.length - 1; i++) {
      const x = xs[i], end = xs[i + 1];
      if (end - x < EPS) continue;
      const ranges = mergedRanges(rects.filter(r => r.x < end - EPS && r.x + r.w > x + EPS).map(r => [r.y, r.y + r.h]));
      const next = new Map();
      for (const [a, b] of ranges) {
        const key = `${a},${b}`, previous = active.get(key);
        if (previous && Math.abs(previous.x + previous.w - x) < EPS) { previous.w = end - previous.x; next.set(key, previous); }
        else { const r = { x, y: a, w: end - x, h: b - a }; result.push(r); next.set(key, r); }
      }
      active.clear(); for (const [key, value] of next) active.set(key, value);
    }
    return result;
  }
  function createSheet(drawingScene, options = {}) {
    return render(drawingScene, options, false)[0];
  }
  function createSheets(drawingScene, options = {}) {
    return render(drawingScene, options, true);
  }
  function render(drawingScene, options, paginate) {
    if (!Model || typeof Model.doorGeometry !== 'function') fail('HomePlannerModel must be loaded before HomePlannerDrawing.');
    keys(options, ['floorId', 'paper', 'orientation', 'scaleDenominator', 'units', 'title', 'floorName', 'layers'], 'options');
    if (!plain(drawingScene) || drawingScene.version !== 1 || drawingScene.kind !== 'DrawingScene' ||
        !Array.isArray(drawingScene.scenes) || !Array.isArray(drawingScene.diagnostics) || !Array.isArray(drawingScene.authored)) fail('A real HomePlannerProjection DrawingScene is required.');
    string(options.floorId, 'selected floor');
    const scene = drawingScene.scenes.find(item => item.floorId === options.floorId);
    if (!scene) {
      const issues = drawingScene.diagnostics.filter(d => d.ownerId === options.floorId).map(d => d.code);
      fail(`Floor "${options.floorId}" has no registered drawing geometry (${issues.join(', ') || 'unknown floor'}). Resolve its floor/plot prerequisites.`);
    }
    if (drawingScene.scenes.filter(item => item.floorId === options.floorId).length !== 1 ||
        scene.coordinateSpace !== 'site-local' || !scene.plot) fail('Selected floor requires a unique, registered site-local scene.');
    const fatal = drawingScene.diagnostics.filter(d => d.ownerId === options.floorId &&
      ['missing-geometry', 'invalid-geometry', 'missing-plot', 'inconsistent-site-frame', 'unresolved-site-frame'].includes(d.code));
    if (fatal.length) fail(`Selected floor prerequisites: ${fatal.map(d => d.code).join(', ')}.`);
    if ((scene.unresolvedOpenings || []).length || (scene.diagnostics || []).some(d => d.level === 'error')) fail('Resolve rejected openings or geometry errors before producing a sheet.');
    const paper = choice(options.paper === undefined ? 'A3' : options.paper, Object.keys(PAPER_SIZES), 'paper');
    const orientation = choice(options.orientation === undefined ? 'landscape' : options.orientation, ['portrait', 'landscape'], 'orientation');
    const scale = choice(options.scaleDenominator === undefined ? 100 : options.scaleDenominator, [50, 75, 100], 'scale');
    const units = choice(options.units === undefined ? 'metric' : options.units, ['metric', 'imperial'], 'units');
    const layers = { furniture: true, fixtures: true, dimensions: true, site: true };
    if (options.layers !== undefined) {
      keys(options.layers, Object.keys(layers), 'layers');
      for (const [key, value] of Object.entries(options.layers)) {
        if (typeof value !== 'boolean') fail(`Layer ${key} must be boolean.`);
        layers[key] = value;
      }
    }
    const size = PAPER_SIZES[paper], widthMm = size[orientation === 'portrait' ? 'widthMm' : 'heightMm'];
    const heightMm = size[orientation === 'portrait' ? 'heightMm' : 'widthMm'];
    const hasReservations = scene.rooms.some(room => room.reservesSpace);
    const assumptions = [
      'CONCEPTUAL ONLY - not for construction. Dimensions and compliance require professional review and site verification.',
      'Schematic horizontal plan cut: 1.20 m above this floor; wall bases, heights, thicknesses and window sill/head defaults are model inputs or assumptions.',
      'Door arcs show nominal 90-degree handing, not current operation or verified clear width. Furniture interiors are symbolic.',
      hasReservations
        ? 'Unreserved CLEAR sizes use model carpet rectangles. NET excludes reserved service footprints including their full wall allowance; service clear carpet is separate. BUILDING / PLOT are outside extents, not surveyed.'
        : 'Room CLEAR sizes use model carpet rectangles; BUILDING uses outside extent; PLOT uses supplied boundary. None are surveyed.',
      'Setbacks / open strips are model allowances, not measured or certified setbacks. No road, paving or landscape is inferred.'
    ];
    const sheet = { version: 1, widthMm, heightMm, metadata: {
      projectId: string(drawingScene.projectId, 'projectId'), revision: drawingScene.revision,
      floorId: options.floorId, floorName: string(options.floorName === undefined ? options.floorId : options.floorName, 'floorName'),
      title: string(options.title === undefined ? 'ARCHITECTURAL FLOOR PLAN' : options.title, 'title'),
      paper, orientation, scaleDenominator: scale, units, assumptions
    }, primitives: [] };
    const p = sheet.primitives, obstacles = [], labels = [];
    const path = (commands, stroke = INK, strokeWidthMm = .18, fill = null) => {
      p.push({ type: 'path', commands, fill, stroke, strokeWidthMm });
      if (p.length > MAX_PRIMITIVES) fail('Primitive limit exceeded.');
    };
    const line = (a, b, color = INK, width = .18) => path([['M', a.x, a.y], ['L', b.x, b.y]], color, width);
    const rect = (r, stroke = INK, width = .18, fill = null) => path(rectangleCommands(r), stroke, width, fill);
    const text = (x, y, value, fontSizeMm = 2.5, align = 'start', rotationDeg = 0, color = INK) => {
      const item = { type: 'text', xMm: x, yMm: y, text: string(value, 'label'), fontSizeMm, align, rotationDeg, color };
      p.push(item); return item;
    };
    const note = value => { if (!assumptions.includes(value)) assumptions.push(value); };
    const factor = 1000 / scale, sourceRect = layers.site ? scene.plot : scene.building;
    for (const key of ['x', 'y', 'w', 'h']) if (!finite(sourceRect[key])) fail('Invalid scene extent.');
    const footerHeight = widthMm < 250 ? 96 : 70;
    const viewport = { x: 35, y: 49, w: widthMm - 70, h: heightMm - 68 - footerHeight };
    if (sourceRect.w <= 0 || sourceRect.h <= 0 || sourceRect.w * factor > viewport.w + EPS || sourceRect.h * factor > viewport.h + EPS)
      fail(`Fixed scale 1:${scale} does not fit ${paper} ${orientation}. Choose a larger paper or a different explicit scale; no automatic shrink is performed.`);
    const schedule = viewport.w - sourceRect.w * factor >= 85
      ? { x: widthMm - 91, y: 62, w: 72, h: viewport.h - 13 } : null;
    if (schedule) viewport.w -= 85;
    const origin = { x: viewport.x + (viewport.w - sourceRect.w * factor) / 2 - sourceRect.x * factor,
      y: viewport.y + (viewport.h - sourceRect.h * factor) / 2 - sourceRect.y * factor };
    const point = a => {
      if (!a || !finite(a.x) || !finite(a.y)) fail('Unresolved or invalid projected point.');
      return { x: origin.x + a.x * factor, y: origin.y + a.y * factor };
    };
    const box = r => ({ ...point(r), w: r.w * factor, h: r.h * factor });
    const siteBox = box(sourceRect), buildingBox = box(scene.building);
    rect({ x: 8, y: 8, w: widthMm - 16, h: heightMm - 16 }, INK, .4);
    const titleLines = wrap(sheet.metadata.title, widthMm - 62, 4);
    if (!titleLines || titleLines.length > 2) fail('Title layout overflow; shorten the title.');
    titleLines.forEach((value, i) => text(13, 16 + i * 5, value, 4));
    text(widthMm - 13, 16, `1:${scale}`, 3.2, 'end');
    line({ x: 8, y: 25 }, { x: widthMm - 8, y: 25 }, INK, .3);
    if (layers.site) rect(siteBox, GREY, .28);
    if (layers.site) for (const item of scene.obstacles || []) {
      const footprint = box(item);
      if (contains(siteBox, footprint)) {
        rect(footprint, GREY, .16); obstacles.push(footprint);
        note('Thin site outlines represent supplied obstacle footprints; their roof profiles and construction details are not inferred.');
      } else note('Off-plot or boundary-crossing obstacle footprints are omitted; the architectural sheet is limited to the supplied plot.');
    }

    const cutZ = scene.floorElevationM + 1.2, wallRects = [], walls = new Map();
    for (const wall of scene.walls) {
      walls.set(wall.id, wall);
      if (wall.removed) continue;
      const horizontal = Math.abs(wall.start.y - wall.end.y) < EPS;
      if (!horizontal && Math.abs(wall.start.x - wall.end.x) >= EPS) fail('Non-orthogonal wall geometry is not supported by this plan cut.');
      if (![wall.thicknessM, wall.baseM, wall.heightM].every(finite) || wall.thicknessM <= 0) fail('Invalid physical wall geometry.');
      for (const section of wall.solidSections) {
        if (cutZ < wall.baseM + section.sillM - EPS || cutZ >= wall.baseM + section.sillM + section.heightM - EPS) continue;
        const a = Model.wallPoint(wall, section.startM), b = Model.wallPoint(wall, section.endM);
        wallRects.push(box(horizontal
          ? { x: Math.min(a.x, b.x), y: a.y - wall.thicknessM / 2, w: Math.abs(a.x - b.x), h: wall.thicknessM }
          : { x: a.x - wall.thicknessM / 2, y: Math.min(a.y, b.y), w: wall.thicknessM, h: Math.abs(a.y - b.y) }));
      }
    }
    const solids = wallUnion(wallRects);
    const wallPrimitiveStart = p.length;
    if (solids.length) path(solids.flatMap(rectangleCommands), null, 0, WALL);
    obstacles.push(...solids);
    for (const opening of scene.openings) {
      const wall = walls.get(opening.wallId);
      if (!wall || wall.removed) fail(`Opening "${opening.id}" has an unresolved wall.`);
      const low = wall.baseM + opening.sillM, high = low + opening.heightM;
      if (cutZ < low - EPS || cutZ >= high - EPS) {
        note('Openings wholly above or below the 1.20 m cut are not shown as cut apertures (including high-level windows).');
        continue;
      }
      const a = point(Model.wallPoint(wall, opening.offsetM)), b = point(Model.wallPoint(wall, opening.offsetM + opening.widthM));
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
      const edge = wall.thicknessM * factor / 2;
      line({ x: a.x - nx * edge, y: a.y - ny * edge }, { x: a.x + nx * edge, y: a.y + ny * edge }, INK, .25);
      line({ x: b.x - nx * edge, y: b.y - ny * edge }, { x: b.x + nx * edge, y: b.y + ny * edge }, INK, .25);
      if (opening.kind === 'hinged') {
        const g = Model.doorGeometry(opening, wall), h = point(g.hinge), c = point(g.closedEnd), o = point(g.openEnd), k = .5522847498307936;
        line(h, o, INK, .25);
        path([['M', c.x, c.y], ['C', c.x + k * (o.x - h.x), c.y + k * (o.y - h.y),
          o.x + k * (c.x - h.x), o.y + k * (c.y - h.y), o.x, o.y]], GREY, .13);
        obstacles.push(bounds([h, c, o]));
      } else if (opening.kind === 'window') {
        for (const distance of [-edge * .65, 0, edge * .65])
          line({ x: a.x + nx * distance, y: a.y + ny * distance }, { x: b.x + nx * distance, y: b.y + ny * distance }, INK, .13);
        obstacles.push({ x: Math.min(a.x, b.x) - edge, y: Math.min(a.y, b.y) - edge,
          w: Math.abs(dx) + 2 * edge, h: Math.abs(dy) + 2 * edge });
      } else {
        line(a, b, GREY, .1);
        note('Non-hinged openings use a schematic threshold only; no unsupported operating mechanism is inferred.');
      }
    }
    const wallPrimitiveCount = p.length - wallPrimitiveStart;
    function furnishing(r, type, head = 'N') {
      rect(r, GREY, .16, LIGHT); obstacles.push(r);
      const inset = Math.min(r.w, r.h) * .12;
      if (type === 'bed') {
        const eastWest = head === 'E' || head === 'W', end = head === 'S' || head === 'E';
        const pillow = eastWest
          ? { x: end ? r.x + r.w * .76 : r.x + inset, y: r.y + inset, w: r.w * .16, h: r.h - 2 * inset }
          : { x: r.x + inset, y: end ? r.y + r.h * .76 : r.y + inset, w: r.w - 2 * inset, h: r.h * .16 };
        rect(pillow, GREY, .13, '#FFFFFF');
        if (eastWest) line({ x: r.x + r.w / 2, y: r.y + inset }, { x: r.x + r.w / 2, y: r.y + r.h - inset }, GREY, .12);
        else line({ x: r.x + inset, y: r.y + r.h / 2 }, { x: r.x + r.w - inset, y: r.y + r.h / 2 }, GREY, .12);
      } else if (['sofa', 'wardrobe', 'counter', 'desk', 'table'].includes(type)) {
        rect({ x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset }, GREY, .12);
        if (type === 'sofa') for (const t of [1 / 3, 2 / 3])
          line({ x: r.x + r.w * t, y: r.y + inset }, { x: r.x + r.w * t, y: r.y + r.h - inset }, GREY, .12);
      }
    }
    for (const item of scene.furniture) {
      if (['basin', 'sink', 'toilet', 'shower'].includes(item.type)) {
        if (layers.fixtures) furnishing(box(item.rect), item.type);
      } else if (layers.furniture) furnishing(box(item.rect), item.type, item.headLocal);
    }
    const authoredLabels = [];
    for (const entry of drawingScene.authored.filter(item => item.floorId === options.floorId)) {
      const record = entry.record;
      if (!['annotations', 'dimensions', 'fixtures', 'stairs'].includes(entry.collection)) continue;
      if ((['fixtures', 'stairs'].includes(entry.collection) && !layers.fixtures) ||
          (entry.collection === 'dimensions' && !layers.dimensions)) continue;
      if (entry.anchorStatus !== 'resolved' || entry.anchors.some(a => a.status !== 'resolved')) {
        note(`INCOMPLETE ${entry.collection}: ${record.id} has unresolved anchors; no geometry has been invented.`);
        continue;
      }
      const anchors = entry.anchors.map(a => point(a.point));
      if (entry.collection === 'annotations') authoredLabels.push({ anchor: anchors[0], text: record.text, id: record.id });
      else if (entry.collection === 'fixtures') {
        if (record.widthM === null || record.depthM === null) {
          authoredLabels.push({ anchor: anchors[0], text: `${record.kind}: size unknown`, id: record.id });
          note(`INCOMPLETE fixture ${record.id}: footprint sizes are unknown.`);
        } else {
          furnishing({ x: anchors[0].x - record.widthM * factor / 2, y: anchors[0].y - record.depthM * factor / 2,
            w: record.widthM * factor, h: record.depthM * factor }, record.kind);
          note('Authored fixture footprints are schematic, centred on resolved anchors and aligned to the site axes; mounting/orientation is unspecified.');
        }
      } else if (entry.collection === 'stairs') {
        const [a, b] = anchors, length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < EPS || record.widthM === null) {
          authoredLabels.push({ anchor: a, text: 'STAIR: geometry incomplete', id: record.id });
        } else {
          const nx = -(b.y - a.y) / length * record.widthM * factor / 2, ny = (b.x - a.x) / length * record.widthM * factor / 2;
          const corners = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
            { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
          path([['M', corners[0].x, corners[0].y], ...corners.slice(1).map(q => ['L', q.x, q.y]), ['Z']], GREY, .18);
          line(a, b, GREY, .13); obstacles.push(bounds(corners));
        }
        note(`INCOMPLETE stair ${record.id}: intent only; treads, landings, clearance and stair profile are not supplied.`);
      } else {
        const [a, b] = anchors, length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < EPS) { note(`Dimension ${record.id} has zero plan span; no horizontal dimension drawn.`); continue; }
        const offset = record.offsetM * factor, nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
        const c = { x: a.x + nx * offset, y: a.y + ny * offset }, d = { x: b.x + nx * offset, y: b.y + ny * offset };
        const dimensionBox = bounds([a, b, c, d]);
        if (obstacles.some(r => overlaps(dimensionBox, r, .065 + EPS) &&
          (strokedSegmentIntersectsBox(a, c, .1, r) || strokedSegmentIntersectsBox(b, d, .1, r) ||
            strokedSegmentIntersectsBox(c, d, .13, r)))) fail(`Authored dimension "${record.id}" crosses plan geometry; revise its offset.`);
        line(a, c, GREY, .1); line(b, d, GREY, .1); line(c, d, GREY, .13);
        authoredLabels.push({ anchor: { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 - 2 },
          text: `AUTHORED 3D ${lengthLabel(entry.distanceM, units)}`, id: record.id });
        obstacles.push(dimensionBox); // Keep the conservative enclosure reserved for text layout.
      }
    }
    // A supplied footprint can clash with a wall. It must never visually erase
    // the physical cut or the hosted opening glyph during that coordination clash.
    p.push(...p.splice(wallPrimitiveStart, wallPrimitiveCount));
    if (layers.site) labels.push({ x: widthMm - 34, y: 30, w: 26, h: 22 });
    function placeLabel(value, region, anchor, id, detail, optional = false) {
      for (const font of [2.6, 2.3, 2]) {
        const lines = wrap(value, Math.max(0, region.w - 3), font);
        if (!lines) continue;
        const all = [...lines, ...(Array.isArray(detail) ? detail : detail ? [detail] : [])], height = all.length * font * 1.45;
        const width = Math.max(...all.map(t => textWidth(t, font)));
        const candidates = [anchor];
        for (const fy of [.2, .8, .5, .35, .65]) for (const fx of [.5, .25, .75])
          candidates.push({ x: region.x + region.w * fx, y: region.y + region.h * fy });
        for (let y = region.y + height / 2 + .5; y < region.y + region.h - height / 2; y += 1.5)
          for (let x = region.x + width / 2 + .5; x < region.x + region.w - width / 2; x += 1.5) candidates.push({ x, y });
        for (const at of candidates) {
          const r = { x: at.x - width / 2, y: at.y - height / 2, w: width, h: height };
          if (!contains(region, r) || [...obstacles, ...labels].some(other => overlaps(r, other))) continue;
          all.forEach((t, i) => text(at.x, r.y + font + i * font * 1.45, t, font, 'middle', 0, i >= lines.length ? GREY : INK));
          labels.push(r); return true;
        }
      }
      if (optional) return false;
      fail(`Label layout overflow for "${id}". Choose larger paper / a larger explicit drawing scale, shorten the label, move authored annotations, or hide furniture; labels are never painted over geometry.`);
    }
    // Authored annotation anchors are stable overrides: placement is local and never modifies the record.
    for (const item of authoredLabels) {
      const region = { x: item.anchor.x - 22, y: item.anchor.y - 10, w: 44, h: 20 };
      if (!contains({ x: 11, y: 28, w: widthMm - 22, h: heightMm - footerHeight - 34 }, region)) fail(`Authored annotation "${item.id}" is outside the drawable sheet region.`);
      if (schedule && overlaps(region, schedule)) fail(`Authored annotation "${item.id}" overlaps the reserved room schedule; revise its anchor.`);
      placeLabel(item.text, region, item.anchor, item.id);
    }
    let scheduleY = schedule ? schedule.y + 7 : 0, scheduleCount = 0;
    const areaLabel = value => {
      if (!finite(value) || value < 0) fail('Reserved rooms require a finite, nonnegative usable/reserved area.');
      return units === 'metric' ? `${value.toFixed(2)} m2` : `${(value / .09290304).toFixed(2)} ft2`;
    };
    for (const [index, room] of scene.rooms.entries()) {
      const available = room.usableRegions === undefined ? [room.rect] : room.usableRegions;
      if (!dense(available) || available.some(r => !r || ![r.x, r.y, r.w, r.h].every(finite) || r.w <= 0 || r.h <= 0))
        fail(`Invalid usable regions for "${room.id}"; no bounding-rectangle fallback is supplied.`);
      if (room.usableRegions !== undefined && ['grossAreaM2', 'usableAreaM2', 'reservedAreaM2']
        .some(key => !finite(room[key]) || room[key] < 0))
        fail(`Reserved room "${room.id}" needs explicit finite gross, usable and reserved areas.`);
      const regions = available.map(box).sort((a, b) => b.w * b.h - a.w * a.h || a.x - b.x || a.y - b.y);
      const detail = room.reservedAreaM2 > 0
        ? [`NET ${areaLabel(room.usableAreaM2)}`, `RESERVED ${areaLabel(room.reservedAreaM2)}`]
        : layers.dimensions ? `CLEAR ${lengthLabel(room.rect.w, units)} x ${lengthLabel(room.rect.h, units)}` : null;
      const detailLines = Array.isArray(detail) ? detail : detail ? [detail] : [];
      const placeInRoom = (value, details) => regions.some(r =>
        placeLabel(value, r, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, room.id, details, true));
      if (placeInRoom(room.label, detail)) continue;
      if (!regions.length) fail(`Label layout overflow for "${room.id}": no usable region remains outside reserved service footprints.`);
      if (!schedule) fail(`Label layout overflow for "${room.id}"; choose larger paper for a keyed room schedule, enlarge the explicit scale, or hide furniture.`);
      const tag = `R${String(index + 1).padStart(2, '0')}`;
      const rowLines = wrap(`${tag}  ${room.label}`, schedule.w - 4, 2.4);
      if (!rowLines || scheduleY + (rowLines.length + detailLines.length) * 3.6 > schedule.y + schedule.h)
        fail(`Room schedule layout overflow for "${room.id}"; enlarge the page or shorten labels.`);
      if (!placeInRoom(tag)) fail(`Label layout overflow for "${room.id}"; no readable key fits its usable regions.`);
      if (!scheduleCount++) {
        text(schedule.x, schedule.y, hasReservations ? 'ROOM KEY / USABLE AREAS' : 'ROOM KEY / CLEAR SIZES', 2.6);
        line({ x: schedule.x, y: schedule.y + 2 }, { x: schedule.x + schedule.w, y: schedule.y + 2 }, GREY, .18);
      }
      for (const value of [...rowLines, ...detailLines]) {
        const item = text(schedule.x, scheduleY, value, 2.4);
        labels.push(textBounds(item)); scheduleY += 3.6;
      }
      scheduleY += 3;
    }
    function dimension(a, b, offset, label, vertical = false) {
      const c = vertical ? { x: offset, y: a.y } : { x: a.x, y: offset };
      const d = vertical ? { x: offset, y: b.y } : { x: b.x, y: offset };
      line(a, c, GREY, .1); line(b, d, GREY, .1); line(c, d, GREY, .13);
      for (const q of [c, d]) line({ x: q.x - .8, y: q.y + .8 }, { x: q.x + .8, y: q.y - .8 }, INK, .2);
      const labelItem = vertical ? text(offset - 1.5, (a.y + b.y) / 2, label, 2.1, 'middle', -90)
        : text((a.x + b.x) / 2, offset - 1.5, label, 2.1, 'middle');
      const r = textBounds(labelItem);
      if ([...labels, ...obstacles].some(other => overlaps(r, other, .3))) fail('Exterior dimension label collision; choose a larger explicit scale or page.');
      labels.push(r);
    }
    if (layers.dimensions) {
      dimension({ x: buildingBox.x, y: buildingBox.y }, { x: buildingBox.x + buildingBox.w, y: buildingBox.y },
        siteBox.y - 8, `BUILDING ${lengthLabel(scene.building.w, units)}`);
      dimension({ x: buildingBox.x, y: buildingBox.y }, { x: buildingBox.x, y: buildingBox.y + buildingBox.h },
        siteBox.x - 8, `BUILDING ${lengthLabel(scene.building.h, units)}`, true);
      if (layers.site) {
        dimension({ x: siteBox.x, y: siteBox.y }, { x: siteBox.x + siteBox.w, y: siteBox.y },
          siteBox.y - 17, `PLOT ${lengthLabel(scene.plot.w, units)}`);
        dimension({ x: siteBox.x, y: siteBox.y }, { x: siteBox.x, y: siteBox.y + siteBox.h },
          siteBox.x - 17, `PLOT ${lengthLabel(scene.plot.h, units)}`, true);
      }
      const divisions = [...new Set(scene.rooms.filter(room => !room.reservesSpace).flatMap(room => [room.module.x, room.module.x + room.module.w]))]
        .filter(x => x > scene.building.x + .5 && x < scene.building.x + scene.building.w - .5).sort((a, b) => a - b)
        .filter((x, i, values) => i === 0 || x - values[i - 1] > EPS);
      const stations = [scene.building.x, ...divisions, scene.building.x + scene.building.w];
      if (stations.length > 2) {
        for (let i = 1; i < stations.length; i++) {
          const label = `BAY ${lengthLabel(stations[i] - stations[i - 1], units)}`;
          if ((stations[i] - stations[i - 1]) * factor < textWidth(label, 2.1) + 2)
            fail('Building dimension chain label overflow; enlarge the explicit drawing scale or hide dimensions.');
          dimension(point({ x: stations[i - 1], y: scene.building.y + scene.building.h }),
            point({ x: stations[i], y: scene.building.y + scene.building.h }), siteBox.y + siteBox.h + 10, label);
        }
        note('BAY chains locate model room-module divisions within the building outside extent, not surveyed structural grid lines.');
      }
      if (hasReservations) note('Reserved services are local floor cutouts, not building-wide BAY divisions. Their net host deductions include the full wall allowance; no shaft or stair construction is specified.');
    }
    if (layers.site) {
      const strips = [
        { x: siteBox.x, y: siteBox.y, w: siteBox.w, h: buildingBox.y - siteBox.y },
        { x: siteBox.x, y: buildingBox.y + buildingBox.h, w: siteBox.w, h: siteBox.y + siteBox.h - buildingBox.y - buildingBox.h }
      ];
      for (const strip of strips) if (strip.h >= 8 && strip.w >= 50) {
        const t = { type: 'text', xMm: strip.x + strip.w / 2, yMm: strip.y + strip.h / 2,
          text: 'OPEN STRIP - MODEL ALLOWANCE', fontSizeMm: 2, align: 'middle', rotationDeg: 0, color: GREY };
        const r = textBounds(t);
        if (![...obstacles, ...labels].some(other => overlaps(r, other))) { p.push(t); labels.push(r); }
      }
      if (!finite(scene.headingDeg)) fail('North heading is unresolved.');
      const a = scene.headingDeg * Math.PI / 180, n = { x: -Math.sin(a), y: -Math.cos(a) };
      const start = { x: widthMm - 21, y: 43 }, end = { x: start.x + n.x * 9, y: start.y + n.y * 9 };
      line(start, end, INK, .3);
      path([['M', end.x, end.y], ['L', end.x - n.x * 3 - n.y, end.y - n.y * 3 + n.x],
        ['L', end.x - n.x * 3 + n.y, end.y - n.y * 3 - n.x], ['Z']], null, 0, INK);
      text(start.x, 49, 'N', 2.8, 'middle');
    }
    for (const diagnostic of drawingScene.diagnostics) {
      if (diagnostic.ownerId === options.floorId || drawingScene.authored.some(a => a.floorId === options.floorId && a.record.id === diagnostic.ownerId))
        note(`Input diagnostic: ${diagnostic.code} (${diagnostic.ownerId}).`);
    }
    if ((scene.diagnostics || []).some(d => d.level === 'warning')) note('Model warnings are present; review source geometry and unresolved attachments before relying on this conceptual sheet.');
    if (scene.regulatory?.nonCompliantSetbacks) note('WARNING: model flags non-compliant setback inputs; this sheet does not certify planning compliance.');
    note('Legend: dark fill = wall cut; three lines = glazing at cut; light footprints = supplied furniture / fixtures. Unspecified stairs have no treads.');
    const footer = heightMm - footerHeight;
    line({ x: 8, y: footer }, { x: widthMm - 8, y: footer }, INK, .35);
    const identity = `${sheet.metadata.floorName} | ${sheet.metadata.projectId} | Revision ${sheet.metadata.revision}`;
    if (textWidth(identity, 2.8) > widthMm - 26) fail('Title-block identity overflow; shorten floor/project labels.');
    text(13, footer + 6, identity, 2.8);
    text(13, footer + 11, `${paper} ${orientation} | ${units} | Scale 1:${scale} at actual size (100% print)`, 2.3);
    const barM = scale === 50 ? 2 : 5, barWidth = barM * factor, barX = widthMm - 16 - barWidth;
    // The scale bar occupies its own title-block row, separate from identity and notes.
    for (let i = 0; i < 5; i++) rect({ x: barX + i * barWidth / 5, y: footer + 15, w: barWidth / 5, h: 1.8 }, INK, .12, i % 2 ? '#FFFFFF' : INK);
    text(barX, footer + 21, '0', 2);
    text(barX + barWidth, footer + 21, lengthLabel(barM, units), 2, 'end');
    text(13, footer + 20, 'PLAN / A-01', 2.8);
    const drawingRegion = { x: 9, y: 26, w: widthMm - 18, h: footer - 27 };
    for (const r of obstacles) if (!contains(drawingRegion, r)) fail('Fixed-scale geometry exceeds the plan region; select larger paper or include the site layer.');
    // Validate the complete metadata budget before allocating any continuation text.
    validateSheet({ ...sheet, primitives: [] });
    const noteLines = assumptions.flatMap(value => wrapAssumption(value, widthMm - 28, 2.05));
    const firstY = footer + 27, capacity = Math.floor((heightMm - 11 - firstY) / 3) + 1;
    if (noteLines.length <= capacity) {
      noteLines.forEach((value, i) => text(13, firstY + i * 3, value, 2.05, 'start', 0, GREY));
      return [validateSheet(sheet)];
    }
    if (!paginate) fail('Assumptions require continuation pages; use createSheets to retain all notes without changing the plan or its scale.');
    const firstCount = capacity - 1;
    const contextLines = wrap(sheet.metadata.title, widthMm - 26, 2.5);
    const identityY = 30 + contextLines.length * 3.6, continuationY = identityY + 20;
    const continuationCapacity = Math.floor((heightMm - 23 - continuationY) / 3) + 1;
    const count = 1 + Math.ceil((noteLines.length - firstCount) / continuationCapacity);
    if (count > 100) fail('Assumption continuations exceed the 100-page limit; no partial sheets are returned.');
    noteLines.slice(0, firstCount).forEach((value, i) => text(13, firstY + i * 3, value, 2.05, 'start', 0, GREY));
    text(13, firstY + firstCount * 3, `ASSUMPTIONS CONTINUE - page 2 of ${count}; retain all pages.`, 2);
    const sheets = [sheet];
    for (let i = 1, offset = firstCount; i < count; i++, offset += continuationCapacity) {
      const continuation = { ...sheet, metadata: { ...sheet.metadata,
        title: `${sheet.metadata.title} / ASSUMPTIONS ${i + 1} OF ${count}`,
        assumptions: assumptions.slice() }, primitives: [] };
      const add = (x, y, value, size = 2.05, color = GREY) => continuation.primitives.push({
        type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size, align: 'start', rotationDeg: 0, color
      });
      continuation.primitives.push({ type: 'path',
        commands: rectangleCommands({ x: 8, y: 8, w: widthMm - 16, h: heightMm - 16 }),
        fill: null, stroke: INK, strokeWidthMm: .4 });
      add(13, 16, 'ARCHITECTURAL ASSUMPTIONS - CONTINUATION', 3, INK);
      contextLines.forEach((value, j) => add(13, 25 + j * 3.6, value, 2.5, INK));
      add(13, identityY, identity, 2.8, INK);
      add(13, identityY + 5, `${paper} ${orientation} | ${units} | Original plan scale 1:${scale}`, 2.3, INK);
      add(13, identityY + 11, `PLAN / A-01 | PAGE ${i + 1}/${count} | Read with the original floor plan.`, 2, INK);
      noteLines.slice(offset, offset + continuationCapacity)
        .forEach((value, j) => add(13, continuationY + j * 3, value));
      add(13, heightMm - 17, i + 1 < count
        ? `ASSUMPTIONS CONTINUE - page ${i + 2} of ${count}; retain all pages.`
        : 'END OF ASSUMPTIONS - retain with the architectural floor plan.', 2, INK);
      add(13, heightMm - 11, 'CONCEPTUAL ONLY - NOT FOR CONSTRUCTION. Print the original plan at actual size.', 2, INK);
      sheets.push(continuation);
    }
    return sheets.map(validateSheet);
  }
  function xml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
  }
  function toSVG(sheet) {
    validateSheet(sheet);
    const number = n => Object.is(n, -0) ? '0' : String(n);
    const elements = sheet.primitives.map(p => p.type === 'path'
      ? `<path d="${p.commands.map(c => c.map(v => typeof v === 'number' ? number(v) : v).join(' ')).join(' ')}" fill="${p.fill || 'none'}" stroke="${p.stroke || 'none'}" stroke-width="${number(p.strokeWidthMm)}" stroke-linejoin="round" stroke-linecap="round"/>`
      : `<text x="${number(p.xMm)}" y="${number(p.yMm)}" font-size="${number(p.fontSizeMm)}" text-anchor="${p.align}" fill="${p.color}" transform="rotate(${number(p.rotationDeg)} ${number(p.xMm)} ${number(p.yMm)})">${xml(p.text)}</text>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}" font-family="sans-serif"><title>${xml(sheet.metadata.title)}</title><metadata>${xml(JSON.stringify(sheet.metadata))}</metadata>${elements.join('')}</svg>`;
  }
  // Preserve enumeration of the original exports while adding the continuation API.
  return Object.freeze(Object.defineProperty({ createSheet, validateSheet, toSVG, PAPER_SIZES },
    'createSheets', { value: createSheets }));
});
