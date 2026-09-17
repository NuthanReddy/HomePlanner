(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./planner-drawing.js') : root.HomePlannerDrawing,
    common ? require('./planner-structure.js') : root.HomePlannerStructure);
  if (common) module.exports = api;
  else root.HomePlannerStructureDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Drawing, Structure) {
  'use strict';
  const EPS = 1e-7, FONT = 2.2, STEP = 3.4;
  const MAX_PAGES = 100, MAX_SOURCE_TEXT = 500000, MAX_OUTPUT_TEXT = 1000000;
  const INK = '#263238', FAINT = '#D4DADC', LEADER = '#527080', MISSING = '#984921';
  const COLORS = { grid: '#687B86', column: '#263238', beam: '#345C79', slab: '#728571', footing: '#8B6854' };
  const NOTES = [
    'CONCEPTUAL ONLY - NOT ENGINEERED / NOT FOR CONSTRUCTION. Qualified structural review is required.',
    'Soil, loads, seismic actions, reinforcement/rebar, connections and capacity are NOT ASSESSED. Sourced inputs and engineer-provided claims are not certification.',
    'Slab and footing footprints are rectangular intent only. No hidden structure, member sizing or support system is inferred.',
    'Faint walls: horizontal cut 1.20 m above floor using supplied solid sections; openings above/below the cut remain solid. Structural footprints show supplied intents at their scheduled elevations, not a structural cut.',
    'S-number leaders key the full schedule; ? marks incomplete geometry at known anchors. Unknown location is schedule-only. All dimensions are supplied intent, not surveyed.'
  ];
  const fail = message => { throw new Error(`Structural drawing: ${message}`); };
  const overflow = detail => fail(`${detail} Use createSheets for schedule continuation, larger paper, another explicit scale for plan fit, or fewer elements in an explicitly scoped input; retain cross-floor coordination context. No automatic shrink or truncation.`);
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
  const plain = v => v && typeof v === 'object' && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  function keys(value, allowed, label) {
    if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(`Invalid ${label}.`);
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  // Deliberately conservative advance, including wide Unicode glyphs; shared validation is final.
  const textWidth = (s, size = FONT) => Array.from(s).length * size * 1.1;
  function wrap(value, width, size = FONT, maxChars = 16384) {
    const chars = Array.from(value), limit = Math.floor(width / (size * 1.1));
    if (!limit || !chars.length || chars.length > maxChars) overflow('Text cannot fit the bounded readable layout.');
    const lines = [];
    let line = '';
    for (const char of chars) {
      if (Array.from(line).length === limit) { lines.push(line); line = ''; }
      line += char;
    }
    if (line) lines.push(line);
    return lines;
  }
  const bounds = points => {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const corners = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  function strip(a, b, width) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!finite(length) || length <= EPS || !finite(width) || width <= 0) fail('Invalid projected segment footprint.');
    const x = -(b.y - a.y) / length * width / 2, y = (b.x - a.x) / length * width / 2;
    return [{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y },
      { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }];
  }
  const overlap = (a, b, gap = 1) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  const contains = (a, b) => b.x >= a.x && b.y >= a.y &&
    b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  function intersects(a, b, box) {
    let enter = 0, exit = 1;
    for (const [s, d, lo, hi] of [[a.x, b.x - a.x, box.x - 1, box.x + box.w + 1],
      [a.y, b.y - a.y, box.y - 1, box.y + box.h + 1]]) {
      if (Math.abs(d) < EPS) { if (s < lo || s > hi) return false; }
      else {
        enter = Math.max(enter, Math.min((lo - s) / d, (hi - s) / d));
        exit = Math.min(exit, Math.max((lo - s) / d, (hi - s) / d));
      }
    }
    return enter <= exit;
  }
  function length(m, units) {
    if (m === null || m === undefined || !finite(m)) return 'unknown';
    if (units === 'metric') return `${Number(m.toFixed(6))} m`;
    const inches = Math.round(Math.abs(m) / .0254 * 10000) / 10000;
    return `${m < 0 ? '-' : ''}${Math.floor(inches / 12)}'-${Number((inches % 12).toFixed(4))}"`;
  }
  function createSheet(scene, options = {}) {
    return render(scene, options, false)[0];
  }
  function createSheets(scene, options = {}) {
    return render(scene, options, true);
  }
  function render(scene, options, paginate) {
    if (!Drawing || !Structure) fail('Load HomePlannerDrawing and HomePlannerStructure first.');
    keys(options, ['floorId', 'paper', 'orientation', 'scaleDenominator', 'units', 'title', 'floorName', 'layers',
      ...(paginate ? ['maxPages'] : [])], 'options');
    const maxPages = options.maxPages === undefined ? MAX_PAGES : options.maxPages;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) fail('maxPages must be an integer from 1 to 100.');
    const layers = { furniture: true, fixtures: true, dimensions: true, site: true };
    if (options.layers !== undefined) {
      keys(options.layers, Object.keys(layers), 'layers');
      for (const [key, value] of Object.entries(options.layers)) {
        if (typeof value !== 'boolean') fail(`Layer ${key} must be boolean.`);
        layers[key] = value;
      }
    }
    const model = Structure.build(scene);
    const floors = scene.scenes.filter(s => s.floorId === options.floorId);
    if (floors.length !== 1 || floors[0].coordinateSpace !== 'site-local') fail('Select one registered site-local floor.');
    const floor = floors[0];
    if (!finite(floor.floorElevationM)) fail('Selected floor elevation is unknown.');
    const paper = options.paper === undefined ? 'A3' : options.paper;
    const orientation = options.orientation === undefined ? 'landscape' : options.orientation;
    const scale = options.scaleDenominator === undefined ? 100 : options.scaleDenominator;
    const units = options.units === undefined ? 'metric' : options.units;
    const media = Drawing.PAPER_SIZES[paper];
    if (!media || !['portrait', 'landscape'].includes(orientation)) fail('Unsupported paper or orientation.');
    const sheet = { version: 1, widthMm: media[orientation === 'portrait' ? 'widthMm' : 'heightMm'],
      heightMm: media[orientation === 'portrait' ? 'heightMm' : 'widthMm'], metadata: {
        projectId: scene.projectId, revision: scene.revision, floorId: options.floorId,
        floorName: options.floorName === undefined ? options.floorId : options.floorName,
        title: options.title === undefined ? 'CONCEPTUAL STRUCTURAL FLOOR PLAN' : options.title,
        paper, orientation, scaleDenominator: scale, units, assumptions: NOTES.slice()
      }, primitives: [] };
    Drawing.validateSheet(sheet);
    const elements = model.elements.filter(e => e.floorId === options.floorId)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const ids = new Set(elements.map(e => e.id));
    const findings = model.findings.filter(f => f.floorId === null || f.floorId === options.floorId ||
      f.elementIds.some(id => ids.has(id)));
    const texts = [], blocks = [];
    const dim = m => length(m, units);
    elements.forEach((e, i) => {
      const start = texts.length;
      const g = e.geometry, key = `S${i + 1}`;
      texts.push(`${key} | ${e.label} | ${e.kind}`, `ID: ${e.id}`,
        `Dimensions W / D / H: ${dim(e.widthM)} / ${dim(e.depthM)} / ${dim(e.heightM)}`);
      if (e.kind === 'beam' || e.kind === 'grid') texts.push(`Endpoint length: ${dim(g ? Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) : null)}`);
      texts.push(`Bottom anchor elevations: ${e.anchors.map(a => dim(a?.z)).join(' / ') || 'unknown'}`,
        `Top elevation: ${g?.kind === 'box' ? dim(g.z + g.h) : g?.kind === 'beam' ? dim(g.start.z + g.depthM) : 'unknown'}`,
        `Material: ${e.material ?? 'unknown'}; sizeSource: ${e.sizeSource}`,
        `Reference: ${e.reference ?? 'unknown'}`);
      if (e.kind === 'grid') texts.push('Reference segment only; no volume, sizes or material applicable.');
      else if (e.kind === 'slab' || e.kind === 'footing') texts.push('Rectangular footprint intent only.');
      if (!g) texts.push(`? INCOMPLETE: no geometry; ${e.anchors.some(Boolean) ? 'markers at known anchors only' : 'location unknown, schedule only'}.`);
      blocks.push({ heading: `${key} - ELEMENT SCHEDULE`, texts: texts.slice(start) });
      texts.push('');
    });
    if (!elements.length) {
      const empty = 'No structural elements supplied for this floor. Absence is not a structural assessment.';
      texts.push(empty, '');
      blocks.push({ heading: 'ELEMENT SCHEDULE', texts: [empty] });
    }
    texts.push('COORDINATION FINDINGS - ALL RELEVANT WARNINGS');
    for (const [i, f] of findings.entries()) {
      const value = `${f.code} [${f.elementIds.join(', ') || 'project'}]: ${f.message}`;
      texts.push(value);
      blocks.push({ heading: `F${i + 1} - COORDINATION FINDING`, texts: [value] });
    }
    const diagnostics = [...(floor.diagnostics || []), ...(scene.diagnostics || []).filter(d =>
      d.ownerId === options.floorId || ids.has(d.ownerId) || d.ownerId === null)];
    for (const [i, d] of diagnostics.entries()) {
      const value = `Source diagnostic: ${d.code || 'unknown'}; ${d.message || JSON.stringify(d)}`;
      texts.push(value);
      blocks.push({ heading: `D${i + 1} - SOURCE DIAGNOSTIC`, texts: [value] });
    }
    if (paginate && texts.reduce((n, t) => n + t.length, 0) > MAX_SOURCE_TEXT)
      overflow(`Full schedule exceeds the ${MAX_SOURCE_TEXT}-character source text budget.`);

    const width = sheet.widthMm, height = sheet.heightMm;
    const panelX = Math.round(width * .55), panelWidth = width - panelX - 14;
    const notes = NOTES.flatMap(n => wrap(n, width - 28));
    const footerTop = height - 15 - notes.length * STEP;
    const top = 39, bottom = footerTop - 7;
    const scheduleLines = texts.flatMap(t => t ? wrap(t, panelWidth, FONT, paginate ? MAX_SOURCE_TEXT : 16384) : ['']);
    const needsContinuation = top + 7 + scheduleLines.length * STEP > bottom;
    if (needsContinuation && !paginate) overflow(`Full schedule and ${findings.length} coordination findings do not fit ${paper} ${orientation} at readable ${FONT} mm text.`);
    const continuation = needsContinuation ? paginateBlocks(blocks, width, top, bottom, maxPages) : [];
    const pageCount = 1 + continuation.length;
    const viewport = { x: 15, y: top + 8, w: panelX - 28, h: bottom - top - 13 };
    const title = wrap(sheet.metadata.title, width - 75, 3.5);
    if (title.length > 2) fail('Title exceeds two lines; shorten title.');
    const subtitle = wrap(`${sheet.metadata.floorName} | ${units} | elevation ${dim(floor.floorElevationM)} | revision ${scene.revision}`, width - 28);
    if (subtitle.length > 2) fail('Floor name/header exceeds two lines; shorten floorName.');

    const shapes = [], positions = [], extents = [];
    function shape(points, color, fill = null, stroke = .22) {
      if (!points.length || points.some(p => !p || !finite(p.x) || !finite(p.y))) fail('Invalid site-local footprint.');
      shapes.push({ points, color, fill, stroke }); extents.push(...points);
    }
    const source = layers.site ? floor.plot : floor.building;
    if (!source || !['x', 'y', 'w', 'h'].every(k => finite(source[k])) || source.w <= 0 || source.h <= 0)
      fail('Selected floor needs a known plot/building extent.');
    extents.push(...corners(source));
    if (layers.site) {
      const c = corners(source);
      for (let i = 0; i < 4; i++) shape([c[i], c[(i + 1) % 4]], FAINT, null, .15);
    }
    const cut = floor.floorElevationM + 1.2;
    for (const wall of floor.walls) {
      if (wall.removed) continue;
      if (!wall.start || !wall.end || ![wall.start.x, wall.start.y, wall.end.x, wall.end.y,
        wall.thicknessM, wall.baseM, wall.heightM].every(finite) || wall.thicknessM <= 0 ||
        wall.heightM <= 0 || !Array.isArray(wall.solidSections)) fail('Wall underlay requires true compiled solidSections and physical wall dimensions.');
      const wallLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      if (wallLength <= EPS) fail('Degenerate underlay wall.');
      for (const s of wall.solidSections) {
        if (![s.startM, s.endM, s.sillM, s.heightM].every(finite) || s.startM < -EPS ||
            s.endM > wallLength + EPS || s.endM <= s.startM || s.heightM <= 0) fail('Invalid compiled wall solid section.');
        if (cut < wall.baseM + s.sillM - EPS || cut >= wall.baseM + s.sillM + s.heightM - EPS) continue;
        const at = t => ({ x: wall.start.x + (wall.end.x - wall.start.x) * t / wallLength,
          y: wall.start.y + (wall.end.y - wall.start.y) * t / wallLength });
        shape(strip(at(s.startM), at(s.endM), wall.thicknessM), FAINT, FAINT, 0);
      }
    }
    elements.forEach((e, i) => {
      const g = e.geometry;
      if (g?.kind === 'box') shape(corners({ x: g.x, y: g.y, w: g.w, h: g.d }), COLORS[e.kind]);
      else if (g?.kind === 'beam') shape(strip(g.start, g.end, g.widthM), COLORS.beam);
      else if (g?.kind === 'grid') shape([g.start, g.end], COLORS.grid, null, .15);
      const anchors = g ? [g.kind === 'box' ? e.anchors[0] : g.start] : e.anchors.filter(Boolean);
      anchors.forEach((anchor, j) => {
        extents.push(anchor); positions.push({ anchor, label: `S${i + 1}${g ? '' : '?'}${j ? `/${j + 1}` : ''}`, missing: !g });
      });
    });
    const sourceBounds = bounds(extents), factor = 1000 / scale, padding = 9;
    if (viewport.w <= 2 * padding || viewport.h <= 2 * padding ||
        sourceBounds.w * factor > viewport.w - 2 * padding || sourceBounds.h * factor > viewport.h - 2 * padding)
      overflow(`Fixed scale 1:${scale} plan (including off-plot geometry) does not fit ${paper} ${orientation}.`);
    const origin = { x: viewport.x + (viewport.w - sourceBounds.w * factor) / 2 - sourceBounds.x * factor,
      y: viewport.y + (viewport.h - sourceBounds.h * factor) / 2 - sourceBounds.y * factor };
    const project = p => ({ x: origin.x + p.x * factor, y: origin.y + p.y * factor });
    const path = (points, color, stroke = .22, fill = null, closed = false) => sheet.primitives.push({
      type: 'path', commands: points.map((p, i) => [i ? 'L' : 'M', p.x, p.y]).concat(closed ? [['Z']] : []),
      stroke: color, strokeWidthMm: stroke, fill
    });
    const text = (x, y, value, size = FONT, color = INK) => sheet.primitives.push({
      type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size, align: 'start', rotationDeg: 0, color
    });
    title.forEach((t, i) => text(14, 17 + i * 4.6, t, 3.5));
    text(width - 53, 17, `1:${scale}`, 3.5);
    subtitle.forEach((t, i) => text(14, 29 + i * STEP, t));
    text(15, top + 2, 'STRUCTURAL INTENT / SITE AXES', 2.5);
    text(panelX, top + 2, needsContinuation ? 'COMPLETE SET / KEY LEGEND' : 'ELEMENT SCHEDULE', 2.5);
    const panelLines = needsContinuation ? [
      `Schedule and findings continue on pages 2-${pageCount}; review complete set`,
      `${elements.length} structural records; ${findings.length} coordination findings; ${diagnostics.length} source diagnostics.`,
      'S1, S2, ... identify elements in ID order. Full labels, IDs, dimensions and references are on the schedule pages.',
      '? marks incomplete geometry; /2 etc. identify additional known anchors. Unknown locations are schedule-only.',
      'F1, F2, ... identify coordination findings; D1, D2, ... identify source diagnostics.',
      'Read continuation pages left column then right column. Repeated S/F/D headings identify the same record across columns and pages.',
      'NOT ENGINEERED / NOT FOR CONSTRUCTION. No engineering pass or certification is provided.'
    ].flatMap(t => wrap(t, panelWidth)) : scheduleLines;
    if (top + 7 + panelLines.length * STEP > bottom) overflow('Plan navigation legend does not fit at readable text size.');
    panelLines.forEach((t, i) => { if (t) text(panelX, top + 7 + i * STEP, t); });
    path([{ x: panelX - 5, y: top - 2 }, { x: panelX - 5, y: bottom }], FAINT, .15);
    path([{ x: 14, y: footerTop }, { x: width - 14, y: footerTop }], INK);
    notes.forEach((t, i) => text(14, footerTop + 5 + i * STEP, t));
    const obstacles = [], labelBoxes = [], leaders = [];
    for (const s of shapes) {
      const points = s.points.map(project);
      path(points, s.color, s.stroke, s.fill, points.length > 2);
      obstacles.push(bounds(points));
    }
    for (const p of positions.filter(p => p.missing)) {
      const a = project(p.anchor);
      path([{ x: a.x - 1.2, y: a.y - 1.2 }, { x: a.x + 1.2, y: a.y + 1.2 }], MISSING);
      path([{ x: a.x - 1.2, y: a.y + 1.2 }, { x: a.x + 1.2, y: a.y - 1.2 }], MISSING);
      obstacles.push({ x: a.x - 1.3, y: a.y - 1.3, w: 2.6, h: 2.6 });
    }
    for (const p of positions) {
      const a = project(p.anchor), w = textWidth(p.label), h = FONT * 1.3, candidates = [];
      for (let y = viewport.y; y + h <= viewport.y + viewport.h; y += 4)
        for (let x = viewport.x; x + w <= viewport.x + viewport.w; x += 4) candidates.push({ x, y, w, h });
      candidates.sort((u, v) => Math.hypot(u.x + w / 2 - a.x, u.y + h / 2 - a.y) -
        Math.hypot(v.x + w / 2 - a.x, v.y + h / 2 - a.y) || u.y - v.y || u.x - v.x);
      let placed = false;
      for (const r of candidates) {
        if (!contains(viewport, r) || obstacles.some(o => overlap(r, o)) || labelBoxes.some(o => overlap(r, o)) ||
            leaders.some(l => intersects(l.a, l.b, r))) continue;
        const b = { x: Math.max(r.x, Math.min(a.x, r.x + w)), y: Math.max(r.y, Math.min(a.y, r.y + h)) };
        if (labelBoxes.some(o => intersects(a, b, o))) continue;
        path([a, b], LEADER, .12);
        text(r.x, r.y + FONT, p.label, FONT, p.missing ? MISSING : INK);
        labelBoxes.push(r); leaders.push({ a, b }); placed = true; break;
      }
      if (!placed) overflow(`No collision-free keyed label position for ${p.label}.`);
    }
    if (layers.dimensions) {
      const x = viewport.x, y = bottom + 2, bar = factor;
      if (bar > viewport.w) overflow('One-metre physical scale reference does not fit.');
      path([{ x, y }, { x: x + bar, y }], INK, .35);
      text(x + bar + 3, y + .7, `${dim(1)} at 1:${scale}`, 2);
    }
    const sheets = [sheet];
    for (const columns of continuation) {
      const page = { ...sheet, metadata: { ...sheet.metadata, assumptions: NOTES.slice() }, primitives: [] };
      const addText = (x, y, value, size = FONT) => page.primitives.push({
        type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size, align: 'start', rotationDeg: 0, color: INK
      });
      title.forEach((t, i) => addText(14, 17 + i * 4.6, t, 3.5));
      addText(width - 53, 17, `1:${scale}`, 3.5);
      subtitle.forEach((t, i) => addText(14, 29 + i * STEP, t));
      addText(14, top + 2, 'FULL SCHEDULE / FINDINGS - NOT ENGINEERED', 2.5);
      columns.forEach((lines, column) => lines.forEach((t, row) => {
        if (t) addText(14 + column * (width / 2 - 9), top + 7 + row * STEP, t);
      }));
      page.primitives.push({ type: 'path', commands: [['M', 14, footerTop], ['L', width - 14, footerTop]],
        stroke: INK, strokeWidthMm: .22, fill: null });
      notes.forEach((t, i) => addText(14, footerTop + 5 + i * STEP, t));
      sheets.push(page);
    }
    if (paginate) {
      const identity = `Project: ${sheet.metadata.projectId} | Floor: ${sheet.metadata.floorId}`;
      const identityLines = wrap(identity, width - 28);
      if (identityLines.length > 2) overflow('Project/floor identity exceeds two readable footer lines.');
      sheets.forEach((page, i) => {
        const add = (x, y, value) => page.primitives.push({
          type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: FONT, align: 'start', rotationDeg: 0, color: INK
        });
        identityLines.forEach((line, j) => add(14, height - 7 + j * STEP, line));
        add(width - 53, 24, `Page ${i + 1}/${pageCount}`);
      });
      const outputText = sheets.reduce((n, page) => n + page.primitives.reduce((sum, p) =>
        sum + (p.type === 'text' ? p.text.length : 0), 0), 0);
      if (outputText > MAX_OUTPUT_TEXT) overflow(`Complete set exceeds the ${MAX_OUTPUT_TEXT}-character output text budget.`);
    }
    try { sheets.forEach(page => Drawing.validateSheet(page)); }
    catch (error) { overflow(`Shared sheet validation rejected output: ${error.message}`); }
    return freeze(sheets);
  }
  function paginateBlocks(blocks, width, top, bottom, maxPages) {
    const columnWidth = width / 2 - 23;
    const capacity = Math.floor((bottom - top - 7) / STEP) + 1;
    const pages = [];
    let columns, lines;
    function nextColumn() {
      if (columns && columns.length === 1) { lines = []; columns.push(lines); }
      else {
        if (pages.length + 1 >= maxPages) overflow(`Complete set exceeds maxPages=${maxPages} (including the plan page).`);
        lines = []; columns = [lines]; pages.push(columns);
      }
    }
    if (capacity < 4) overflow('Continuation columns have no readable content area.');
    nextColumn();
    for (const block of blocks) {
      // A printed delimiter preserves even whitespace-only wrapped fragments.
      const body = block.texts.flatMap(t => wrap(t, columnWidth - textWidth('| '), FONT, MAX_SOURCE_TEXT)).map(t => `| ${t}`);
      if (lines.length && (lines.length + 3 > capacity ||
          (body.length + 2 <= capacity && lines.length + body.length + 2 > capacity))) nextColumn();
      lines.push(block.heading);
      for (const line of body) {
        if (lines.length === capacity) { nextColumn(); lines.push(`${block.heading} (continued)`); }
        lines.push(line);
      }
      if (lines.length < capacity) lines.push('');
    }
    return pages;
  }
  function toSVG(sheet) {
    if (!Drawing) fail('Load HomePlannerDrawing first.');
    return Drawing.toSVG(sheet);
  }
  return Object.freeze({ createSheet, createSheets, toSVG });
});
