(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./planner-drawing.js') : root.HomePlannerDrawing,
    common ? require('./planner-drainage.js') : root.HomePlannerDrainage);
  if (common) module.exports = api;
  else root.HomePlannerDrainageDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Drawing, Drainage) {
  'use strict';
  const FONT = 2.2, STEP = 3.5, EPS = 1e-7;
  const INK = '#263238', FAINT = '#D4DADC', LEADER = '#71828A';
  const COLORS = { soil: '#795439', waste: '#527B48', storm: '#246DA0', vent: '#8063A0', unknown: '#626B70' };
  const PURPOSE = { port: 'P', fixture: 'F', trap: 'T', 'floor-trap': 'FT', 'gully-trap': 'GT',
    'roof-outlet': 'RO', junction: 'J', stack: 'S', valve: 'V', cleanout: 'C', chamber: 'CH',
    downpipe: 'DP', supply: 'I', outlet: 'O', outfall: 'OF' };
  const NOTES = [
    'AUTHORED DRAINAGE INTENT - NOT ENGINEERED / NOT FOR CONSTRUCTION. No hydraulic capacity, sizing, compliance, infiltration, septic design, cover or flood safety is assessed.',
    'Scope: selected-floor-owned routes PLUS endpoint-touching routes, including full known foreign spans. All selected-system project findings are scheduled, even outside the diagram. Read ALL pages.',
    'Plan: actual rectangular plot frame, not buildable setbacks or a surveyed legal boundary. Faint wall solids at floor +1.20 m. Paper-sized centerlines/purpose markers are NOT pipe widths or measured fittings.',
    'Profile: physical XY horizontal chainage versus independently supplied invert levels, SAME fixed horizontal/vertical scale. Anchor z is NEVER invert. Unknown points/levels stay gaps; no interpolation or bridging.',
    'Arrows mean authored from-to order ONLY, not hydraulic flow. Measured fall and supplied slope intention are distinct, unvalidated inputs. Vent/unresolved gravity intent remains explicitly unavailable.',
    'N/R short keys and ordered point numbers resolve to full qualified references in schedules. Coincident marks remain coincident; proximity/crossings do not invent connections. No fittings, terrain, shafts or procurement allowances.'
  ];
  const fail = message => { throw new Error(`Drainage drawing: ${message}`); };
  const overflow = message => fail(`${message} Use createSheets for complete continuations, larger paper or another explicit scale for geometry. No automatic shrink, clipping or truncation.`);
  const finite = v => Number.isFinite(v) && Math.abs(v) <= 1e9;
  const plain = v => v && typeof v === 'object' && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const key = (floorId, id) => JSON.stringify([floorId, id]);
  const entityKey = e => key(e.floorId, e.id);
  const refKey = r => key(r.floorId, r.entityId);
  const order = (a, b) => entityKey(a) < entityKey(b) ? -1 : entityKey(a) > entityKey(b) ? 1 : 0;
  const widthOf = (text, size = FONT) => Array.from(text).length * size * 1.1;
  const corners = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  function bounds(points) {
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) {
      x = Math.min(x, p.x); y = Math.min(y, p.y);
      right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
    }
    return { x, y, w: right - x, h: bottom - y };
  }
  const overlaps = (a, b, gap = .7) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  function intersects(a, b, box) {
    let low = 0, high = 1;
    for (const [s, d, min, max] of [[a.x, b.x - a.x, box.x - .7, box.x + box.w + .7],
      [a.y, b.y - a.y, box.y - .7, box.y + box.h + .7]]) {
      if (Math.abs(d) < EPS) { if (s < min || s > max) return false; }
      else {
        low = Math.max(low, Math.min((min - s) / d, (max - s) / d));
        high = Math.min(high, Math.max((min - s) / d, (max - s) / d));
      }
    }
    return low <= high;
  }
  function freeze(root) {
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) pending.push(child);
      }
    }
    return root;
  }
  function wrap(value, width, size = FONT) {
    const capacity = Math.floor(width / (size * 1.1)), lines = [];
    if (capacity < 1) overflow('No readable text width.');
    let line = '', count = 0;
    for (const char of value) {
      if (count === capacity) { lines.push(line); line = ''; count = 0; }
      line += char; count++;
    }
    if (line) lines.push(line);
    return lines;
  }
  function dimension(value, units) {
    if (!finite(value)) return 'unknown';
    return units === 'metric' ? `${Number(value.toFixed(6))} m` : `${Number((value / .3048).toFixed(6))} ft`;
  }
  function text(sheet, x, y, value, size = FONT, color = INK) {
    sheet.primitives.push({ type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size,
      align: 'start', rotationDeg: 0, color });
  }
  function path(sheet, points, color = INK, stroke = .3, fill = null, closed = false) {
    sheet.primitives.push({ type: 'path', commands: points.map((p, i) => [i ? 'L' : 'M', p.x, p.y])
      .concat(closed ? [['Z']] : []), stroke: color, strokeWidthMm: stroke, fill });
  }
  function createSheets(scene, options = {}) { return render(scene, options, true); }
  function createSheet(scene, options = {}) { return render(scene, options, false)[0]; }
  function render(scene, options, paginate) {
    if (!Drawing?.validateSheet || !Drainage?.build) fail('Load HomePlannerDrawing and HomePlannerDrainage first.');
    const allowed = ['floorId', 'view', 'systems', 'paper', 'orientation', 'scaleDenominator', 'units', 'title', 'floorName'];
    if (!plain(options) || Object.keys(options).some(k => !allowed.includes(k)) ||
      Object.values(options).some(v => v === null || v === undefined)) fail('Invalid options: unknown keys and explicit null/undefined are not supported.');
    const view = options.view ?? 'plan', systems = options.systems ?? ['waste', 'rain'];
    if (!['plan', 'profile'].includes(view)) fail('view must be plan or profile.');
    if (!Array.isArray(systems) || Object.keys(systems).length !== systems.length ||
      Array.from(systems).some(s => !['waste', 'rain'].includes(s)) || new Set(systems).size !== systems.length)
      fail('systems must be a unique dense array of waste and/or rain.');
    if (!scene || scene.version !== 1 || scene.kind !== 'DrawingScene' || !Array.isArray(scene.scenes) ||
      !Array.isArray(scene.authored)) fail('A version 1 DrawingScene is required.');
    const floors = scene.scenes.filter(f => f.floorId === options.floorId);
    if (floors.length !== 1 || floors[0].coordinateSpace !== 'site-local') fail('Select one registered site-local floor; missing selected geometry cannot be printed.');
    const floor = floors[0], selected = floor.floorId, scale = options.scaleDenominator ?? 100, units = options.units ?? 'metric';
    if (!finite(floor.floorElevationM)) fail('Selected floor elevation is unknown.');
    const paper = options.paper ?? 'A3', orientation = options.orientation ?? 'landscape';
    if (!Object.hasOwn(Drawing.PAPER_SIZES, paper) || !['portrait', 'landscape'].includes(orientation))
      fail('Unsupported paper or orientation.');
    const media = Drawing.PAPER_SIZES[paper];
    const template = { version: 1, widthMm: media[orientation === 'portrait' ? 'widthMm' : 'heightMm'],
      heightMm: media[orientation === 'portrait' ? 'heightMm' : 'widthMm'],
      metadata: { projectId: scene.projectId, revision: scene.revision, floorId: selected,
        floorName: options.floorName ?? selected, title: options.title ?? `DRAINAGE ${view.toUpperCase()} - AUTHORED INTENT`,
        paper, orientation, scaleDenominator: scale, units, assumptions: NOTES.slice() }, primitives: [] };
    Drawing.validateSheet(template);
    const model = Drainage.build(scene, { systems });
    const raw = new Map(scene.authored.filter(e => ['serviceNodes', 'serviceRoutes'].includes(e.collection))
      .map(e => [key(e.floorId, e.record.id), e.record]));
    const allNodes = model.nodes.slice().sort(order), allRoutes = model.routes.slice().sort(order);
    const nodeKeys = new Map(allNodes.map((n, i) => [entityKey(n), `N${i + 1}`]));
    const routeKeys = new Map(allRoutes.map((r, i) => [entityKey(r), `R${i + 1}`]));
    const routes = allRoutes.filter(r => r.floorId === selected || r.from.floorId === selected || r.to.floorId === selected);
    const referenced = new Set(routes.flatMap(r => [refKey(r.from), refKey(r.to)]));
    const nodes = allNodes.filter(n => n.floorId === selected || referenced.has(entityKey(n)));
    const dim = value => dimension(value, units);
    const position = p => p ? `x ${dim(p.x)}, y ${dim(p.y)}, axis z ${dim(p.z)}` : 'unknown (gap)';
    const color = e => COLORS[e.circuit] || COLORS.unknown;
    const foreign = r => r.floorId !== selected || r.from.floorId !== selected || r.to.floorId !== selected ||
      raw.get(entityKey(r)).via.some(a => a?.floorId && a.floorId !== selected);
    const blocks = [];
    let sourceCharacters = 0, geometryItems = 0, comparisons = 0;
    const check = () => { if (++comparisons > 2000000) overflow('2000000 text/geometry comparison budget exceeded.'); };
    const geometry = () => { if (++geometryItems > 20000) overflow('20000 geometry item budget exceeded.'); };
    function block(heading, lines) {
      sourceCharacters += heading.length;
      for (const line of lines) sourceCharacters += line.length;
      if (sourceCharacters > 500000) overflow('Complete schedule exceeds 500000 source characters.');
      blocks.push({ heading, lines });
    }
    const profileReason = r => r.gravityStatus === 'not-applicable' ? 'vent intent: gravity profile not applicable' :
      r.gravityStatus !== 'applicable' ? 'unknown or contradictory gravity intent' :
        'no adjacent known cumulative stations and independently supplied inverts';
    const profilePoints = r => r.profile.stationsM.map((station, i) =>
      finite(station) && finite(r.profile.invertsM[i]) ? { x: station, y: -r.profile.invertsM[i] } : null);
    const hasProfile = r => r.gravityStatus === 'applicable' &&
      profilePoints(r).some((p, i, points) => i > 0 && p && points[i - 1]);
    block('SCOPE / LEGEND', [
      `View: ${view}; selected systems: ${systems.join(', ') || 'none'}; engineeringStatus: not-assessed.`,
      `Selected floor: ${selected}; scoped nodes: ${nodes.length}; scoped routes: ${routes.length}.`,
      'Own-floor routes PLUS endpoint-touching routes; full known foreign spans are retained, never clipped to a floor or plot.',
      'Project findings include selected-system entities OUTSIDE diagram scope. Qualified entityRefs are authoritative; raw related IDs without refs are not assigned guessed floors.',
      'Sanitary = waste system (soil brown / waste green); storm = rain system (storm blue). Vent purple and unknown grey remain separate intent.',
      'N = node, R = route; R1.2 = ordered segment 2; R1.p2 = ordered point 2. * = foreign/cross-floor. Arrow = authored order, NOT flow.',
      `Explicit purpose codes: ${Object.entries(PURPOSE).map(([name, code]) => `${code} ${name}`).join('; ')}.`,
      'Neutral cross marks locate supplied nodes/points only; bracketed purpose is authored role or base kind, not invented fitting geometry.',
      'Measured fall = supplied invert A minus B. Supplied slope = unvalidated fall/run intention; expected fall is not a measured level.',
      ...scene.scenes.map(f => `Registered floor ${f.floorId}: project level ${dim(f.floorElevationM)} (not ground, FF or invert).`)
    ]);
    for (const n of nodes) block(`${nodeKeys.get(entityKey(n))} NODE`, [
      `ID: ${n.id}; floor: ${n.floorId}; ${n.floorId === selected ? 'selected owner' : 'FOREIGN referenced endpoint'}.`,
      `System: ${n.system}; circuit: ${n.circuit ?? 'unknown'}; kind: ${n.kind}; role: ${n.role ?? 'unknown'}; label: ${n.label ?? 'unknown'}.`,
      `Physical anchor: ${position(n.anchor)}; supplied invert: ${dim(n.invertM)}.`,
      `Ground: ${dim(n.groundM)}; finished floor: ${dim(n.finishedFloorM)}; nominal diameter: ${n.diameterMm ?? 'unknown'} mm; access review radius: ${dim(n.accessRadiusM)}.`,
      `Level source: ${n.levelSource ?? 'unknown'}; level reference: ${n.levelReference ?? 'unknown'}; discharge: ${JSON.stringify(n.discharge)} (unverified; null = unknown).`,
      `Invert below ground: ${dim(n.invertBelowGroundM)} (NOT cover); FF above ground: ${dim(n.finishedFloorAboveGroundM)}.`,
      `Component qualified key: ${n.componentId ?? 'unknown'}; issues: ${JSON.stringify(n.issues)}.`,
      `Complete authored record (null = unknown): ${JSON.stringify(raw.get(entityKey(n)))}`
    ]);
    for (const r of routes) {
      const name = routeKeys.get(entityKey(r));
      block(`${name} ROUTE`, [
        `ID: ${r.id}; owner floor: ${r.floorId}; ${r.floorId === selected ? 'selected owner route' : 'REFERENCED incoming/outgoing route'}.`,
        `System: ${r.system}; circuit: ${r.circuit ?? 'unknown'}; label: ${r.label ?? 'unknown'}; gravity status: ${r.gravityStatus}.`,
        `Proposed from: ${nodeKeys.get(refKey(r.from)) || 'MISSING NODE'} ${JSON.stringify(r.from)}; to: ${nodeKeys.get(refKey(r.to)) || 'MISSING NODE'} ${JSON.stringify(r.to)}.`,
        `Profile ${hasProfile(r) ? 'geometry available (completeness below is separate)' : `UNAVAILABLE: ${profileReason(r)}`}.`,
        `Nominal diameter: ${r.diameterMm ?? 'unknown'} mm; clearance review radius: ${dim(r.clearanceM)}.`,
        `Supplied slope intention fall/run: ${r.slope ?? 'unknown'}; slope source: ${r.slopeSource ?? 'unknown'}; slope reference: ${r.slopeReference ?? 'unknown'}.`,
        `Measured endpoint fall: ${dim(r.profile.measuredFallM)}; measured endpoint gradient: ${r.profile.measuredGradient ?? 'unknown'}. NOT internal completeness.`,
        `Expected fall from intention: ${dim(r.profile.expectedFallM)}; measured minus expected: ${dim(r.profile.slopeDifferenceM)}.`,
        `Full XY horizontal run: ${dim(r.profile.horizontalLengthM)}; full XYZ axis length: ${dim(r.profile.axisLengthM)}; riser intent: ${r.isRiser}.`,
        `Plan complete: ${r.profile.planComplete}; invert profile complete: ${r.profile.invertProfileComplete}; profile complete: ${r.profile.profileComplete}; endpoint fall available: ${r.profile.invertFallAvailable}.`,
        `Component qualified key: ${r.componentId ?? 'unknown'}; issues: ${JSON.stringify(r.issues)}.`,
        `Complete authored record (ordered via / supplied viaInvertsM retained): ${JSON.stringify(raw.get(entityKey(r)))}`
      ]);
      r.points.forEach((p, i) => block(`${name}.p${i} POINT`, [
        `Ordered point ${i} (${i === 0 ? 'from' : i === r.points.length - 1 ? 'to' : `via ${i}`}): ${position(p)}.`,
        `Cumulative chainage: ${dim(r.profile.stationsM[i])}; independently supplied invert: ${dim(r.profile.invertsM[i])}.`,
        'Unknown cumulative station stays schedule-only even when later local run/fall is known. No station restart or interpolation.'
      ]));
      r.profile.segments.forEach((s, i) => block(`${name}.${i + 1} SEGMENT`, [
        `Ordered indices ${s.fromIndex} -> ${s.toIndex}; local horizontal run: ${dim(s.horizontalRunM)}; local XYZ axis length: ${dim(s.axisLengthM)}.`,
        `Measured fall: ${dim(s.measuredFallM)}; measured gradient: ${s.measuredGradient ?? 'unknown'}; vertical drop: ${s.verticalDrop}.`,
        `Expected fall from supplied intention: ${dim(s.expectedFallM)}; measured minus expected: ${dim(s.slopeDifferenceM)}.`,
        `Exact foundation segment (null = unknown): ${JSON.stringify(s)}`
      ]));
    }
    model.findings.forEach((f, i) => block(`W${i + 1} PROJECT FINDING`, [
      `${f.severity}: ${f.code}; owner floor: ${f.floorId ?? 'project'}; ${f.message}`,
      `Component qualified key: ${f.componentId ?? 'unknown'}; qualified entityRefs: ${JSON.stringify(f.entityRefs)}; original entityIds: ${JSON.stringify(f.entityIds)}.`
    ]));
    [...(scene.diagnostics || []), ...scene.scenes.flatMap(f => (f.diagnostics || []).map(d => ({ floorId: f.floorId, ...d })))]
      .forEach((d, i) => block(`D${i + 1} SOURCE DIAGNOSTIC`, [JSON.stringify(d)]));
    const width = template.widthMm, height = template.heightMm;
    const scopeLines = wrap(`View ${view}; systems ${systems.join(', ') || 'none'}; floor ${selected}; owned + endpoint-touching routes; complete foreign spans.`, width - 28);
    const footerLines = [...scopeLines, ...NOTES.flatMap(n => wrap(n, width - 28))];
    const footerTop = height - 12 - footerLines.length * STEP;
    const top = 53, bottom = footerTop - 8;
    const viewport = { x: 20, y: top + 12, w: width - 40, h: bottom - top - 22 };
    if (viewport.w < 30 || viewport.h < 20) overflow('No readable geometry area after mandatory scope/caveats.');
    const rows = Math.floor((bottom - top) / STEP), columnW = width / 2 - 23;
    if (rows < 4) overflow('No readable schedule continuation area.');
    const compactEmpty = view === 'profile' && routes.length === 0 && blocks.reduce((count, b) =>
      count + wrap(b.heading, columnW).length + 1 +
      b.lines.reduce((n, line) => n + wrap(line, columnW - widthOf('| ')).length, 0), 0) <= rows;
    const titleLines = wrap(template.metadata.title, width - 95, 3.5);
    const identityLines = wrap(`${template.metadata.floorName} | ${units} | project ${scene.projectId} | floor ${selected} | revision ${scene.revision}`, width - 28);
    if (titleLines.length > 2 || identityLines.length > 3) overflow('Title or identity exceeds readable header area.');
    const factor = 1000 / scale, pages = [];
    function newPage(heading) {
      if (pages.length >= 100) overflow('Complete set exceeds 100 pages.');
      const sheet = { ...template, metadata: { ...template.metadata, assumptions: NOTES.slice() }, primitives: [] };
      pages.push(sheet);
      text(sheet, 14, 46, heading, 2.5);
      return sheet;
    }
    function projection(points) {
      const b = bounds(points);
      if (b.w * factor > viewport.w - 24 || b.h * factor > viewport.h - 24)
        overflow(`Fixed scale 1:${scale} ${view} including all known foreign/off-plot geometry does not fit ${paper} ${orientation}.`);
      const x = viewport.x + (viewport.w - b.w * factor) / 2 - b.x * factor;
      const y = viewport.y + (viewport.h - b.h * factor) / 2 - b.y * factor;
      return p => ({ x: x + p.x * factor, y: y + p.y * factor });
    }
    function diagram(sheet) {
      const solids = [], obstacles = [], labels = [], leaders = [], boxes = [];
      function segment(a, b, ink = INK, stroke = .3) {
        geometry(); path(sheet, [a, b], ink, stroke); obstacles.push({ a, b });
      }
      function mark(p, label, ink) {
        geometry();
        path(sheet, [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }], ink, .22);
        path(sheet, [{ x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }], ink, .22);
        solids.push({ x: p.x - 1.3, y: p.y - 1.3, w: 2.6, h: 2.6 });
        labels.push({ p, label, ink });
      }
      function routeLine(a, b, label, ink) {
        segment(a, b, ink);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, len = Math.hypot(b.x - a.x, b.y - a.y);
        labels.push({ p: mid, label, ink });
        if (len > 4) {
          const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
          const arrow = [{ x: mid.x - ux * 1.5 - uy * .7, y: mid.y - uy * 1.5 + ux * .7 },
            mid, { x: mid.x - ux * 1.5 + uy * .7, y: mid.y - uy * 1.5 - ux * .7 }];
          path(sheet, arrow, ink, .22); solids.push(bounds(arrow));
        }
      }
      function shape(points, fill) {
        geometry(); path(sheet, points, FAINT, .16, fill, true);
        if (fill) solids.push(bounds(points));
        else for (let i = 0; i < points.length; i++) obstacles.push({ a: points[i], b: points[(i + 1) % points.length] });
      }
      function placeLabels() {
        if (labels.length > 2000) overflow('Diagram exceeds 2000 keyed positions.');
        const any = (items, predicate) => items.some(item => { check(); return predicate(item); });
        for (const item of labels) {
          const { p, label, ink } = item, w = widthOf(label), h = FONT * 1.3;
          function* candidates() {
            const cols = Math.floor((viewport.w - w) / 4), rows = Math.floor((viewport.h - h) / 4);
            const cx = Math.max(0, Math.min(cols, Math.round((p.x - w / 2 - viewport.x) / 4)));
            const cy = Math.max(0, Math.min(rows, Math.round((p.y - h / 2 - viewport.y) / 4)));
            for (let radius = 0; radius <= Math.max(cols, rows); radius++) {
              for (let dy = -radius; dy <= radius; dy++) {
                const dxs = Math.abs(dy) === radius ? Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius) : [-radius, radius];
                for (const dx of dxs) {
                  check();
                  const x = cx + dx, y = cy + dy;
                  if (x >= 0 && x <= cols && y >= 0 && y <= rows)
                    yield { x: viewport.x + x * 4, y: viewport.y + y * 4, w, h };
                }
              }
            }
          }
          let placed = false;
          for (const box of candidates()) {
            check();
            if (any(solids, s => overlaps(box, s)) || any(boxes, s => overlaps(box, s)) ||
              any(obstacles, o => intersects(o.a, o.b, box)) || any(leaders, l => intersects(l.a, l.b, box))) continue;
            const b = { x: Math.max(box.x, Math.min(p.x, box.x + w)), y: Math.max(box.y, Math.min(p.y, box.y + h)) };
            if (any(boxes, box => intersects(p, b, box))) continue;
            path(sheet, [p, b], LEADER, .12); text(sheet, box.x, box.y + FONT, label, FONT, ink);
            boxes.push(box); leaders.push({ a: p, b }); placed = true; break;
          }
          if (!placed) overflow(`No collision-free keyed label for ${label}.`);
        }
      }
      return { segment, mark, routeLine, shape, placeLabels };
    }
    if (view === 'plan') {
      const sheet = newPage('PLAN / physical site XY; sanitary and storm authored intent');
      const plot = floor.plot;
      if (!plot || ![plot.x, plot.y, plot.w, plot.h].every(finite) || plot.w <= 0 || plot.h <= 0)
        fail('Selected plan requires actual common-origin plot bounds.');
      const shapes = [{ points: corners(plot), fill: null }], extents = corners(plot);
      const cut = floor.floorElevationM + 1.2;
      for (const wall of floor.walls) {
        if (wall.removed) continue;
        if (!wall.start || !wall.end || ![wall.start.x, wall.start.y, wall.end.x, wall.end.y,
          wall.thicknessM, wall.baseM, wall.heightM].every(finite) || wall.thicknessM <= 0 ||
          wall.heightM <= 0 || !Array.isArray(wall.solidSections)) fail('Wall underlay requires compiled physical solidSections.');
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        if (length < EPS) fail('Degenerate underlay wall.');
        const ux = (wall.end.x - wall.start.x) / length, uy = (wall.end.y - wall.start.y) / length;
        for (const section of wall.solidSections) {
          geometry();
          if (![section.startM, section.endM, section.sillM, section.heightM].every(finite) ||
            section.startM < -EPS || section.endM > length + EPS || section.endM <= section.startM ||
            section.heightM <= 0) fail('Invalid wall solid section.');
          if (cut < wall.baseM + section.sillM - EPS || cut >= wall.baseM + section.sillM + section.heightM - EPS) continue;
          const at = (t, side) => ({ x: wall.start.x + ux * t - uy * side * wall.thicknessM / 2,
            y: wall.start.y + uy * t + ux * side * wall.thicknessM / 2 });
          const points = [at(section.startM, 1), at(section.endM, 1), at(section.endM, -1), at(section.startM, -1)];
          shapes.push({ points, fill: FAINT }); extents.push(...points);
        }
      }
      for (const n of nodes) if (n.anchor) extents.push(n.anchor);
      for (const r of routes) for (const p of r.points) if (p) extents.push(p);
      const project = projection(extents), ink = diagram(sheet);
      for (const shape of shapes) ink.shape(shape.points.map(project), shape.fill);
      for (const r of routes) {
        const points = r.points.map(p => p ? project(p) : null), name = routeKeys.get(entityKey(r)), star = foreign(r) ? '*' : '';
        points.forEach((p, i) => {
          if (i > 0 && p && points[i - 1]) ink.routeLine(points[i - 1], p, `${name}.${i}${star}`, color(r));
          if (p && ((!points[i - 1] && !points[i + 1]) || (i > 0 && i < points.length - 1)))
            ink.mark(p, `${name}.p${i}${star}`, color(r));
        });
      }
      for (const n of nodes) if (n.anchor)
        ink.mark(project(n.anchor), `${nodeKeys.get(entityKey(n))}[${PURPOSE[n.role || n.kind]}]${n.floorId !== selected ? '*' : ''}`, color(n));
      ink.placeLabels();
      text(sheet, 14, top + 2, `Fixed physical XY scale 1:${scale}. * foreign / cross-floor; keys and complete warnings follow.`);
      if (!nodes.length && !routes.length) text(sheet, 14, bottom, 'No scoped nodes or routes in the selected systems. Project findings still follow.');
      else text(sheet, 14, bottom, 'Centerlines / explicit-purpose location marks only. No fittings or dimensions invented.');
    } else {
      for (const r of routes) {
        const name = routeKeys.get(entityKey(r)), sheet = newPage(`${name} PROFILE / ${r.system} / ${r.circuit ?? 'unknown'}${foreign(r) ? ' / FOREIGN SPANS RETAINED' : ''}`);
        text(sheet, 14, top + 2, `Horizontal XY chainage 1:${scale}; vertical independent invert 1:${scale}; NO vertical exaggeration.`);
        if (!hasProfile(r)) {
          wrap(`PROFILE UNAVAILABLE: ${profileReason(r)}. Raw levels, ordered vias, local measurements and warnings are retained in the complete schedule.`, width - 40)
            .forEach((line, i) => text(sheet, 20, viewport.y + 6 + i * STEP, line));
          continue;
        }
        const points = profilePoints(r), project = projection(points.filter(Boolean)), ink = diagram(sheet);
        points.forEach((p, i) => {
          if (!p) return;
          const a = project(p);
          ink.mark(a, `${name}.p${i}`, color(r));
          if (i > 0 && points[i - 1]) ink.routeLine(project(points[i - 1]), a, `${name}.${i}`, color(r));
        });
        ink.placeLabels();
        text(sheet, 14, bottom, `Chainage increases right; invert increases up. Point values scheduled. Complete profile: ${r.profile.profileComplete}.`);
      }
      if (!routes.length) {
        const sheet = newPage('PROFILE UNAVAILABLE / no scoped route');
        wrap('No scoped drainage routes for the selected systems. Complete scope and project findings follow.',
          compactEmpty ? columnW - 10 : width - 40)
          .forEach((line, i) => text(sheet, 20, viewport.y + 6 + i * STEP, line));
      }
    }
    let sheet = null, column = 0, row = 0;
    function nextColumn() {
      if (!sheet || column === 1) { sheet = newPage('FULL SCHEDULE / PROJECT WARNINGS - READ ENTIRE SET'); column = 0; }
      else column = 1;
      row = 0;
    }
    function emit(value) {
      text(sheet, 14 + column * (width / 2 - 9), top + 3 + row * STEP, value);
      row++;
    }
    if (compactEmpty) { sheet = pages[0]; column = 1; }
    else nextColumn();
    for (const b of blocks) {
      const heading = wrap(b.heading, columnW);
      if (heading.length > rows - 2) overflow('Record heading cannot fit schedule column.');
      if (row + heading.length + 1 > rows) nextColumn();
      heading.forEach(emit);
      for (const line of b.lines) for (const part of wrap(line, columnW - widthOf('| '))) {
        if (row >= rows) { nextColumn(); heading.forEach(emit); }
        emit(`| ${part}`);
      }
      if (row < rows) row++;
    }
    if (!paginate && pages.length !== 1) overflow('Complete diagrams, schedules and warnings require multiple sheets.');
    let outputCharacters = 0;
    pages.forEach((sheet, i) => {
      titleLines.forEach((line, j) => text(sheet, 14, 16 + j * 4.7, line, 3.5));
      text(sheet, width - 78, 16, `${view === 'profile' ? 'H/V ' : 'XY '}1:${scale}`, 3.5);
      text(sheet, width - 78, 24, `Page ${i + 1}/${pages.length}`);
      identityLines.forEach((line, j) => text(sheet, 14, 30 + j * STEP, line));
      path(sheet, [{ x: 14, y: footerTop }, { x: width - 14, y: footerTop }], INK, .2);
      footerLines.forEach((line, j) => text(sheet, 14, footerTop + 5 + j * STEP, line));
      for (const p of sheet.primitives) if (p.type === 'text') outputCharacters += p.text.length;
      if (outputCharacters > 1000000) overflow('Complete set exceeds 1000000 output characters.');
      Drawing.validateSheet(sheet);
    });
    return freeze(pages);
  }
  function toSVG(value, options) {
    if (!Drawing?.toSVG) fail('Load HomePlannerDrawing first.');
    return Drawing.toSVG(value?.kind === 'DrawingScene' ? createSheet(value, options) : value);
  }
  return Object.freeze({ createSheets, createSheet, toSVG });
});
