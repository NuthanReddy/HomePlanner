(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./planner-drawing.js') : root.HomePlannerDrawing,
    common ? require('./planner-services.js') : root.HomePlannerServices);
  if (common) module.exports = api;
  else root.HomePlannerServicesDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Drawing, Services) {
  'use strict';
  const FONT = 2.2, STEP = 3.5, EPS = 1e-7, MAX_PAGES = 100;
  const INK = '#263238', FAINT = '#D4DADC', LEADER = '#71828A', FOREIGN = '#964A82';
  const COLORS = { cold: '#246DA0', hot: '#B34B36', soil: '#795439', waste: '#527B48', vent: '#8063A0', unknown: '#626B70' };
  const PURPOSE = { port: 'P', valve: 'V', trap: 'T', cleanout: 'C', stack: 'S',
    junction: 'J', fixture: 'F', supply: 'I', outlet: 'O' };
  const NOTES = [
    'AUTHORED PLUMBING INTENT - NOT ENGINEERED / NOT FOR CONSTRUCTION. No hydraulic flow, pressure, demand, sizing, capacity, drainage fall, code compliance or coordination pass is assessed.',
    'Route arrows indicate proposed from-to order ONLY, not hydraulic flow. Centerlines and purpose glyphs use paper-sized ink, NOT physical pipe widths or fitting internals. Diameters and independent inverts are scheduled as supplied.',
    'Geometric lengths use full ordered 3D axes and exclude fittings, sockets, bends, allowances and purchase waste. NOT a procurement estimate. Unknown points remain gaps; no partial sum is a total.',
    'No assumed terrain, drain falls, shafts, penetrations, intermediate landings, pumps, tanks or roof vent terminals. Cross-floor links are proposals. Supplied slope is UNVALIDATED; anchor z is not invert.',
    'Plan: common site x/y, faint physical wall solids at floor +1.20 m; apertures crossing the cut stay empty. Fixtures show supplied W/D only, otherwise a missing-size marker. Other heights remain unknown.',
    'Riser: horizontal node lanes are NONSPATIAL topology columns; no scaled plan length or lateral offset is claimed. Vertical project z alone is at the selected fixed scale; waypoint heights are preserved.',
    'N/R/F keys retain full IDs in the schedule. Foreign floor locations and cross-floor proposals are dashed. Coincident projected axes/glyphs remain coincident, explicitly keyed, never displaced to imply geometry. Read ALL pages and warnings.'
  ];
  const fail = message => { throw new Error(`Plumbing drawing: ${message}`); };
  const overflow = message => fail(`${message} Use createSheets for full schedule continuation, larger paper or another explicit scale for geometry. No automatic shrink, clipping or truncation.`);
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
  const key = (floor, id) => JSON.stringify([floor, id]);
  const refKey = ref => key(ref.floorId, ref.entityId);
  const order = (a, b) => key(a.floorId, a.id) < key(b.floorId, b.id) ? -1 : key(a.floorId, a.id) > key(b.floorId, b.id) ? 1 : 0;
  const plain = v => v && typeof v === 'object' && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const widthOf = (s, size = FONT) => Array.from(s).length * size * 1.1;
  const bounds = points => {
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
    return { x, y, w: right - x, h: bottom - y };
  };
  const corners = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  const overlap = (a, b, gap = .7) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  function intersects(a, b, box, gap = .7) {
    let lo = 0, hi = 1;
    for (const [s, d, min, max] of [[a.x, b.x - a.x, box.x - gap, box.x + box.w + gap],
      [a.y, b.y - a.y, box.y - gap, box.y + box.h + gap]]) {
      if (Math.abs(d) < EPS) { if (s < min || s > max) return false; }
      else { lo = Math.max(lo, Math.min((min - s) / d, (max - s) / d)); hi = Math.min(hi, Math.max((min - s) / d, (max - s) / d)); }
    }
    return lo <= hi;
  }
  function freeze(root) {
    const pending = [root];
    while (pending.length) {
      const v = pending.pop();
      if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); pending.push(...Object.values(v)); }
    }
    return root;
  }
  function wrap(value, width, size = FONT) {
    const capacity = Math.floor(width / (size * 1.1)), result = [];
    if (capacity < 1) overflow('No readable text width.');
    let line = '', count = 0;
    for (const char of value) {
      if (count === capacity) { result.push(line); line = ''; count = 0; }
      line += char; count++;
    }
    if (line) result.push(line);
    return result;
  }
  function dimension(value, units) {
    if (!finite(value)) return 'unknown';
    if (units === 'metric') return `${Number(value.toFixed(6))} m`;
    return `${Number((value / .3048).toFixed(6))} ft`;
  }
  function text(sheet, x, y, value, size = FONT, color = INK) {
    sheet.primitives.push({ type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size,
      align: 'start', rotationDeg: 0, color });
  }
  function path(sheet, points, color = INK, stroke = .25, fill = null, closed = false) {
    sheet.primitives.push({ type: 'path', commands: points.map((p, i) => [i ? 'L' : 'M', p.x, p.y])
      .concat(closed ? [['Z']] : []), stroke: color, strokeWidthMm: stroke, fill });
  }
  function line(sheet, a, b, color, dashed = false, stroke = .3) {
    if (!dashed) { path(sheet, [a, b], color, stroke); return; }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS) { path(sheet, [a, b], color, stroke); return; }
    for (let start = 0; start < len; start += 3.2) {
      const at = t => ({ x: a.x + (b.x - a.x) * t / len, y: a.y + (b.y - a.y) * t / len });
      path(sheet, [at(start), at(Math.min(len, start + 1.8))], color, stroke);
    }
  }
  function glyph(sheet, p, purpose, color, dashed = false) {
    const points = offsets => offsets.map(([x, y]) => ({ x: p.x + x, y: p.y + y }));
    const strokes = {
      P: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
      V: [[[-1.2, -1], [1.2, 1], [1.2, -1], [-1.2, 1], [-1.2, -1]]],
      T: [[[-1.2, -1], [-1.2, 1], [1.2, 1], [1.2, -1]]],
      C: [[[0, -1.4], [1.4, 0], [0, 1.4], [-1.4, 0], [0, -1.4]], [[-1, 0], [1, 0]]],
      S: [[[-.7, -1.5], [-.7, 1.5]], [[.7, -1.5], [.7, 1.5]]],
      I: [[[-1.2, 1], [0, -1.2], [1.2, 1], [-1.2, 1]]],
      O: [[[-1.2, -1], [0, 1.2], [1.2, -1], [-1.2, -1]]],
      F: [[[-1, -1], [1, 1]], [[-1, 1], [1, -1]]],
      J: [[[-1.2, 0], [1.2, 0]], [[0, -1.2], [0, 1.2]]]
    };
    for (const offsets of strokes[purpose] || strokes.J) path(sheet, points(offsets), color, .25);
    if (dashed) {
      const c = corners({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
      for (let i = 0; i < 4; i++) line(sheet, c[i], c[(i + 1) % 4], FOREIGN, true, .18);
    }
  }
  function createSheets(scene, options = {}) { return render(scene, options, true); }
  function createSheet(scene, options = {}) { return render(scene, options, false)[0]; }
  function render(scene, options, paginate) {
    if (!Drawing || !Services) fail('Load HomePlannerDrawing and HomePlannerServices first.');
    const allowed = ['floorId', 'view', 'paper', 'orientation', 'scaleDenominator', 'units', 'title', 'floorName', 'systems'];
    if (!plain(options) || Object.keys(options).some(k => !allowed.includes(k)) ||
      Object.values(options).some(v => v === undefined || v === null)) fail('Invalid options; explicit null/undefined and unknown keys are not supported.');
    const view = options.view ?? 'plan', systems = options.systems ?? ['water', 'waste'];
    if (!['plan', 'riser'].includes(view)) fail('view must be plan or riser.');
    if (Object.hasOwn(options, 'systems') && (!Array.isArray(options.systems) ||
      Array.from(options.systems).some(s => !['water', 'waste'].includes(s)) || new Set(options.systems).size !== options.systems.length))
      fail('systems must be a unique array of water and/or waste; rain is deferred.');
    if (!scene || !Array.isArray(scene.scenes)) fail('A version 1 DrawingScene is required.');
    const floors = scene.scenes.filter(f => f.floorId === options.floorId);
    if (floors.length !== 1 || floors[0].coordinateSpace !== 'site-local') fail('Select one registered site-local floor; missing selected geometry cannot be printed.');
    const floor = floors[0], scale = options.scaleDenominator ?? 100, units = options.units ?? 'metric';
    if (!finite(floor.floorElevationM)) fail('Selected floor elevation is unknown.');
    const paper = options.paper ?? 'A3', orientation = options.orientation ?? 'landscape', media = Drawing.PAPER_SIZES[paper];
    if (!media || !['portrait', 'landscape'].includes(orientation)) fail('Unsupported paper or orientation.');
    const sheet = { version: 1, widthMm: media[orientation === 'portrait' ? 'widthMm' : 'heightMm'],
      heightMm: media[orientation === 'portrait' ? 'heightMm' : 'widthMm'],
      metadata: { projectId: scene.projectId, revision: scene.revision, floorId: options.floorId,
        floorName: options.floorName ?? options.floorId, title: options.title ?? `PLUMBING ${view.toUpperCase()} - AUTHORED INTENT`,
        paper, orientation, scaleDenominator: scale, units, assumptions: NOTES.slice() }, primitives: [] };
    Drawing.validateSheet(sheet);
    // One shared graph build: neither view resolves anchors or fabricates a second network.
    const model = Services.build(scene, { systems });
    const selected = options.floorId, raw = new Map(scene.authored.map(e => [key(e.floorId, e.record.id), e.record]));
    const allNodes = model.nodes.slice().sort(order), allRoutes = model.routes.slice().sort(order);
    const nodeKeys = new Map(allNodes.map((n, i) => [key(n.floorId, n.id), `N${i + 1}`]));
    const routeKeys = new Map(allRoutes.map((r, i) => [key(r.floorId, r.id), `R${i + 1}`]));
    const routes = allRoutes.filter(r => r.floorId === selected || r.from.floorId === selected || r.to.floorId === selected);
    const referenced = new Set(routes.flatMap(r => [refKey(r.from), refKey(r.to)]));
    const nodes = allNodes.filter(n => n.floorId === selected || referenced.has(key(n.floorId, n.id)));
    const fixtureRefs = new Set();
    for (const n of nodes) {
      const a = raw.get(key(n.floorId, n.id))?.anchor;
      if (a?.kind === 'entity' && a.entityKind === 'fixture') fixtureRefs.add(refKey(a));
    }
    const allFixtures = model.fixtures.slice().sort(order);
    const fixtureKeys = new Map(allFixtures.map((f, i) => [key(f.floorId, f.id), `F${i + 1}`]));
    const fixtures = allFixtures.filter(f => f.floorId === selected || fixtureRefs.has(key(f.floorId, f.id)));
    const relevantFloors = new Set([selected, ...nodes.map(n => n.floorId)]);
    for (const r of routes) {
      relevantFloors.add(r.floorId); relevantFloors.add(r.from.floorId); relevantFloors.add(r.to.floorId);
      for (const a of raw.get(key(r.floorId, r.id)).via) if (a?.floorId) relevantFloors.add(a.floorId);
    }
    if (view === 'riser') {
      const zs = [...scene.scenes.filter(f => relevantFloors.has(f.floorId)).map(f => f.floorElevationM),
        ...routes.flatMap(r => r.points.map(p => p?.z)), ...nodes.map(n => n.anchor?.z)].filter(finite);
      const low = Math.min(...zs), high = Math.max(...zs);
      for (const f of scene.scenes) if (finite(f.floorElevationM) && f.floorElevationM >= low && f.floorElevationM <= high)
        relevantFloors.add(f.floorId);
    }
    const levels = [...relevantFloors].sort().map(id => ({ id, z: scene.scenes.find(f => f.floorId === id)?.floorElevationM }));
    const dim = n => dimension(n, units), pos = p => p ? `x ${dim(p.x)}, y ${dim(p.y)}, z ${dim(p.z)}` : 'unknown (gap; no location invented)';
    const nodeKey = n => nodeKeys.get(key(n.floorId, n.id));
    const routeKey = r => routeKeys.get(key(r.floorId, r.id));
    const fixtureKey = f => fixtureKeys.get(key(f.floorId, f.id));
    const reference = r => `${nodeKeys.get(refKey(r)) || 'MISSING NODE / unresolved in selected systems'} ${JSON.stringify(r)}`;
    const blocks = [];
    const block = (heading, texts) => blocks.push({ heading, texts });
    block('SCOPE / GRAPH IDENTITY', [
      `View: ${view}; systems: ${systems.join(', ') || 'none'}; engineeringStatus: not-assessed.`,
      'Routes owned by the selected floor PLUS incoming/outgoing routes whose endpoint references touch it. Foreign endpoint nodes retain exact pair identity. Findings below are project-wide for the selected systems.',
      `Selected owner floor: ${selected}; nodes ${nodes.length}; routes ${routes.length}; fixtures ${fixtures.length}.`,
      'Plan and riser use identical N/R keys and ordered route points. Crossings, proximity and coincident diagram lanes do not create connections.',
      ...levels.map(l => `Referenced floor ${l.id}: project level ${dim(l.z)}${finite(l.z) ? '' : '; unresolved floor geometry - links may have gaps'}.`)
    ]);
    for (const n of nodes) block(`${nodeKey(n)} - NODE`, [
      `ID: ${n.id}; floor: ${n.floorId}; ${n.floorId === selected ? 'selected owner' : 'FOREIGN referenced endpoint'}.`,
      `Name: ${n.label ?? 'unknown'}; system: ${n.system}; circuit: ${n.circuit ?? 'unknown'}; kind: ${n.kind}; role: ${n.role ?? 'unknown'}.`,
      `Purpose key: ${PURPOSE[n.role || n.kind] || 'J'} (diagram only); diameter: ${finite(n.diameterMm) ? `${n.diameterMm} mm` : 'unknown'}.`,
      `Anchor: ${pos(n.anchor)}; supplied invert: ${dim(n.invertM)} (independent, unvalidated).`,
      `Authored anchor reference: ${JSON.stringify(raw.get(key(n.floorId, n.id)).anchor)}.`,
      `Issues: ${n.issues.join(', ') || 'none recorded; NOT an engineering pass'}.`
    ]);
    for (const r of routes) block(`${routeKey(r)} - ROUTE`, [
      `ID: ${r.id}; owner floor: ${r.floorId}; ${r.floorId === selected ? 'selected owner route' : 'REFERENCED incoming/outgoing route'}.`,
      `Name: ${r.label ?? 'unknown'}; system: ${r.system}; circuit: ${r.circuit ?? 'unknown'}.`,
      `Proposed from: ${reference(r.from)}; proposed to: ${reference(r.to)}. NOT hydraulic flow.`,
      `Via references (ordered, complete): ${JSON.stringify(raw.get(key(r.floorId, r.id)).via)}.`,
      ...r.points.map((p, i) => `Point ${i} (${i === 0 ? 'from' : i === r.points.length - 1 ? 'to' : `via ${i}`}): ${pos(p)}.`),
      `Diameter: ${finite(r.diameterMm) ? `${r.diameterMm} mm` : 'unknown'}; supplied slope fall/run: ${r.slope ?? 'unknown'} - UNVALIDATED.`,
      `Full 3D geometric length: ${dim(r.lengthM)}; riser intent: ${r.isRiser ? 'yes' : 'no (not a design verdict)'}. Excludes fittings; NOT procurement.`,
      `Issues: ${r.issues.join(', ') || 'none recorded; NOT an engineering pass'}.`
    ]);
    for (const f of fixtures) block(`${fixtureKey(f)} - FIXTURE`, [
      `ID: ${f.id}; floor: ${f.floorId}; kind: ${f.kind}; anchor: ${pos(f.anchor)}.`,
      `Supplied W / D / H: ${dim(f.widthM)} / ${dim(f.depthM)} / ${dim(f.heightM)}.`,
      `${finite(f.widthM) && finite(f.depthM) ? 'Supplied footprint only' : 'Missing-size marker only'}; no inferred ports or fitting internals.`,
      `Issues: ${f.issues.join(', ') || 'none recorded; NOT an engineering pass'}.`
    ]);
    const unknowns = nodes.reduce((n, e) => n + ['anchor', 'diameterMm', 'invertM', 'circuit'].filter(k => e[k] === null).length, 0) +
      routes.reduce((n, e) => n + ['diameterMm', 'slope', 'lengthM', 'circuit'].filter(k => e[k] === null).length + e.points.filter(p => !p).length, 0) +
      fixtures.reduce((n, e) => n + ['anchor', 'widthM', 'depthM', 'heightM'].filter(k => e[k] === null).length, 0);
    block('UNKNOWN / DISCONNECTED SUMMARY', [
      `Unknown field/point count in scoped nodes/routes/fixtures: ${unknowns} (includes inapplicable but unsupplied slopes; not a completeness score).`,
      `Project-wide selected-system disconnected findings: ${model.findings.filter(f => f.code.startsWith('disconnected-')).length}. No safe-pass status.`,
      'Any unresolved anchor is schedule-only. Known points separated by a gap are never connected. Foreign level labels are project-relative, not inferred terrain.'
    ]);
    model.findings.forEach((f, i) => block(`W${i + 1} - PROJECT FINDING`, [
      `${f.severity}: ${f.code}; owner floor: ${f.floorId ?? 'project'}; IDs: ${JSON.stringify(f.entityIds)}; ${f.message}`
    ]));
    const diagnostics = [...(scene.diagnostics || []), ...scene.scenes.flatMap(f => (f.diagnostics || []).map(d => ({ floorId: f.floorId, ...d })))];
    diagnostics.forEach((d, i) => block(`D${i + 1} - SOURCE DIAGNOSTIC`, [JSON.stringify(d)]));

    const width = sheet.widthMm, height = sheet.heightMm, panelX = Math.round(width * .72), panelW = width - panelX - 14;
    const noteLines = NOTES.flatMap(n => wrap(n, width - 28));
    const footerTop = height - 16 - noteLines.length * STEP, top = 43, bottom = footerTop - 9;
    const viewport = { x: 15, y: top + 8, w: panelX - 27, h: bottom - top - 14 };
    if (viewport.w < 30 || viewport.h < 20) overflow('Paper has no readable geometry area after mandatory notes.');
    const factor = 1000 / scale, shapes = [], positions = [], segments = [], extents = [];
    const color = e => COLORS[e.circuit] || COLORS.unknown;
    const crossFloor = r => r.from.floorId !== selected || r.to.floorId !== selected || r.floorId !== selected ||
      r.points.some((_, i) => raw.get(key(r.floorId, r.id)).via[i - 1]?.floorId &&
        raw.get(key(r.floorId, r.id)).via[i - 1].floorId !== selected);
    let project, routePositions;
    if (view === 'plan') {
      const plot = floor.plot;
      if (!plot || !['x', 'y', 'w', 'h'].every(k => finite(plot[k])) || plot.w <= 0 || plot.h <= 0)
        fail('Selected plan requires its actual common-origin plot bounds.');
      extents.push(...corners(plot));
      const addShape = (points, fill = null) => { shapes.push({ points, fill }); extents.push(...points); };
      const plotCorners = corners(plot);
      for (let i = 0; i < 4; i++) addShape([plotCorners[i], plotCorners[(i + 1) % 4]]);
      const cut = floor.floorElevationM + 1.2;
      for (const w of floor.walls) {
        if (w.removed) continue;
        if (!w.start || !w.end || ![w.start.x, w.start.y, w.end.x, w.end.y, w.thicknessM, w.baseM, w.heightM].every(finite) ||
          w.thicknessM <= 0 || w.heightM <= 0 || !Array.isArray(w.solidSections))
          fail('Wall underlay requires compiled solidSections and physical dimensions.');
        const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        if (len < EPS) fail('Degenerate underlay wall.');
        const ux = (w.end.x - w.start.x) / len, uy = (w.end.y - w.start.y) / len;
        for (const s of w.solidSections) {
          if (![s.startM, s.endM, s.sillM, s.heightM].every(finite) || s.startM < -EPS ||
            s.endM > len + EPS || s.endM <= s.startM || s.heightM <= 0) fail('Invalid wall solid section.');
          if (cut < w.baseM + s.sillM - EPS || cut >= w.baseM + s.sillM + s.heightM - EPS) continue;
          const at = (t, side) => ({ x: w.start.x + ux * t - uy * side * w.thicknessM / 2,
            y: w.start.y + uy * t + ux * side * w.thicknessM / 2 });
          addShape([at(s.startM, 1), at(s.endM, 1), at(s.endM, -1), at(s.startM, -1)], FAINT);
        }
      }
      for (const f of fixtures) if (f.anchor && finite(f.widthM) && finite(f.depthM)) {
        const points = corners({ x: f.anchor.x - f.widthM / 2, y: f.anchor.y - f.depthM / 2, w: f.widthM, h: f.depthM });
        shapes.push({ points, fixture: f, fill: null }); extents.push(...points);
      }
      extents.push(...nodes.map(n => n.anchor).filter(Boolean), ...fixtures.map(f => f.anchor).filter(Boolean),
        ...routes.flatMap(r => r.points.filter(Boolean)));
      const b = bounds(extents);
      if (b.w * factor > viewport.w - 20 || b.h * factor > viewport.h - 20)
        overflow(`Fixed scale 1:${scale} plan including off-plot/foreign geometry does not fit ${paper} ${orientation}.`);
      const origin = { x: viewport.x + (viewport.w - b.w * factor) / 2 - b.x * factor,
        y: viewport.y + (viewport.h - b.h * factor) / 2 - b.y * factor };
      project = p => ({ x: origin.x + p.x * factor, y: origin.y + p.y * factor });
      routePositions = r => r.points.map(p => p ? project(p) : null);
    } else {
      const lanes = [...new Set([...nodes.map(n => key(n.floorId, n.id)), ...referenced])].sort();
      const laneMap = new Map(lanes.map((k, i) => [k, i * 12]));
      const values = [...nodes.map(n => n.anchor?.z), ...routes.flatMap(r => r.points.map(p => p?.z)),
        ...levels.map(l => l.z), ...fixtures.map(f => f.anchor?.z)].filter(finite);
      const min = Math.min(...values), max = Math.max(...values);
      const diagramW = Math.max(12, (lanes.length - 1) * 12);
      if (diagramW > viewport.w - 22 || (max - min) * factor > viewport.h - 20)
        overflow(`Fixed vertical scale 1:${scale} or nonspatial topology columns do not fit ${paper} ${orientation}.`);
      const x0 = viewport.x + (viewport.w - diagramW) / 2;
      const y0 = viewport.y + (viewport.h - (max - min) * factor) / 2 + max * factor;
      project = (p, k) => ({ x: x0 + (laneMap.get(k) ?? diagramW / 2), y: y0 - p.z * factor });
      routePositions = r => r.points.map((p, i) => p ? {
        x: x0 + laneMap.get(refKey(r.from)) + (laneMap.get(refKey(r.to)) - laneMap.get(refKey(r.from))) * i / (r.points.length - 1),
        y: y0 - p.z * factor
      } : null);
      for (const l of levels) if (finite(l.z)) {
        const y = y0 - l.z * factor, a = { x: viewport.x + 4, y }, b = { x: viewport.x + viewport.w - 4, y };
        line(sheet, a, b, FAINT, true, .15);
        positions.push({ anchor: a, label: `L${levels.indexOf(l) + 1}`, color: INK });
      }
      block('RISER LEVEL KEYS', levels.map((l, i) => `L${i + 1}: floor ${l.id}; true project level ${dim(l.z)}.`));
    }
    const obstacles = [], solids = [], markers = [];
    for (const s of shapes) {
      const points = s.points.map(project);
      if (s.fixture && s.fixture.floorId !== selected) {
        for (let i = 0; i < points.length; i++) line(sheet, points[i], points[(i + 1) % points.length], FOREIGN, true, .18);
      } else path(sheet, points, FAINT, s.fill ? 0 : .16, s.fill, points.length > 2);
      if (s.fill || s.fixture) solids.push(bounds(points));
      else obstacles.push({ a: points[0], b: points[1] });
    }
    for (const r of routes) {
      const points = routePositions(r), dashed = crossFloor(r);
      let drawn = false;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!a || !b) continue;
        drawn = true;
        line(sheet, a, b, color(r), dashed);
        const len = Math.hypot(b.x - a.x, b.y - a.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const label = `${routeKey(r)}.${i}${dashed ? '*' : ''}`;
        positions.push({ anchor: mid, label, color: color(r) });
        if (len > 4) {
          const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
          const arrow = [{ x: mid.x - ux * 1.5 - uy * .7, y: mid.y - uy * 1.5 + ux * .7 }, mid,
            { x: mid.x - ux * 1.5 + uy * .7, y: mid.y - uy * 1.5 - ux * .7 }];
          path(sheet, arrow, color(r), .22);
          solids.push(bounds(arrow));
        } else if (len < EPS) {
          glyph(sheet, mid, 'F', color(r));
          solids.push({ x: mid.x - 1.5, y: mid.y - 1.5, w: 3, h: 3 });
        }
        obstacles.push({ a, b }); segments.push({ a, b, label });
      }
      for (let i = 0; i < points.length; i++) if (points[i] &&
        (!points[i - 1] && !points[i + 1] || !drawn)) {
        glyph(sheet, points[i], 'F', color(r));
        solids.push({ x: points[i].x - 1.5, y: points[i].y - 1.5, w: 3, h: 3 });
        positions.push({ anchor: points[i], label: `${routeKey(r)}.p${i}?`, color: color(r) });
      }
    }
    for (const n of nodes) if (n.anchor) {
      const p = project(n.anchor, key(n.floorId, n.id)), purpose = PURPOSE[n.role || n.kind] || 'J';
      glyph(sheet, p, purpose, color(n), n.floorId !== selected);
      const label = `${nodeKey(n)}[${purpose}]${n.floorId !== selected ? '*' : ''}`;
      positions.push({ anchor: p, label, color: color(n) }); markers.push({ p, label });
      solids.push({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
    }
    if (view === 'plan') for (const f of fixtures) if (f.anchor) {
      const p = project(f.anchor), missing = !finite(f.widthM) || !finite(f.depthM);
      if (missing) {
        glyph(sheet, p, 'F', LEADER, f.floorId !== selected);
        solids.push({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
      }
      positions.push({ anchor: p, label: `${fixtureKey(f)}${missing ? '?' : ''}${f.floorId !== selected ? '*' : ''}`, color: LEADER });
    }
    let checks = 0;
    for (let i = 0; i < markers.length; i++) for (let j = 0; j < i; j++) {
      if (++checks > 500000) overflow('Diagram overlap-check budget exceeded.');
      if (Math.hypot(markers[i].p.x - markers[j].p.x, markers[i].p.y - markers[j].p.y) < 4)
        block(`OVERLAP ${markers[i].label} / ${markers[j].label}`, ['Projected glyphs overlap or coincide. Separate keyed leaders identify each node; no fitting or connection is inferred.']);
    }
    for (let i = 0; i < segments.length; i++) for (let j = 0; j < i; j++) {
      if (++checks > 500000) overflow('Diagram overlap-check budget exceeded.');
      const a = segments[i], b = segments[j];
      const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, len = Math.hypot(dx, dy);
      if (len < EPS) continue;
      const on = p => Math.abs((p.x - a.a.x) * dy - (p.y - a.a.y) * dx) / len < .3;
      const t = p => ((p.x - a.a.x) * dx + (p.y - a.a.y) * dy) / len;
      if (on(b.a) && on(b.b) && Math.min(len, Math.max(t(b.a), t(b.b))) - Math.max(0, Math.min(t(b.a), t(b.b))) > .3)
        block(`OVERLAP ${a.label} / ${b.label}`, ['Projected axes overlap. Both original segment keys remain labeled at their true projection; horizontal riser columns are nonspatial. No new connection or offset is inferred.']);
    }
    if (positions.length > 2000) overflow('Diagram exceeds 2000 keyed positions.');
    const labelBoxes = [], leaders = [];
    let placementChecks = 0;
    for (const p of positions) {
      const a = p.anchor, w = widthOf(p.label), h = FONT * 1.3, candidates = [];
      for (let y = viewport.y; y + h <= viewport.y + viewport.h; y += 4)
        for (let x = viewport.x; x + w <= viewport.x + viewport.w; x += 4)
          candidates.push({ x, y, w, h });
      candidates.sort((u, v) => Math.hypot(u.x + w / 2 - a.x, u.y + h / 2 - a.y) -
        Math.hypot(v.x + w / 2 - a.x, v.y + h / 2 - a.y) || u.y - v.y || u.x - v.x);
      let placed = false;
      for (const r of candidates) {
        if (++placementChecks > 2000000) overflow('Label placement budget exceeded.');
        if (solids.some(o => overlap(r, o)) || labelBoxes.some(o => overlap(r, o)) ||
          obstacles.some(o => intersects(o.a, o.b, r)) || leaders.some(l => intersects(l.a, l.b, r))) continue;
        const b = { x: Math.max(r.x, Math.min(a.x, r.x + w)), y: Math.max(r.y, Math.min(a.y, r.y + h)) };
        if (labelBoxes.some(o => intersects(a, b, o))) continue;
        path(sheet, [a, b], LEADER, .12); text(sheet, r.x, r.y + FONT, p.label, FONT, p.color);
        labelBoxes.push(r); leaders.push({ a, b }); placed = true; break;
      }
      if (!placed) overflow(`No collision-free keyed label for ${p.label}.`);
    }
    const legend = [
      `${view === 'plan' ? 'Site x/y plan' : 'NONSPATIAL horizontal columns; true z vertical'}; fixed ${view === 'riser' ? 'vertical ' : ''}scale 1:${scale}.`,
      `Systems: ${systems.join(', ') || 'none'}. N nodes / R routes / F fixtures / L levels.`,
      'R1.2 = segment 2 of R1; R1.p0? = isolated known point; ? = incomplete size/location.',
      'P port; V valve; T trap; C cleanout; S stack; J junction; F fixture; I supply; O outlet. Purpose glyphs are NOT measured fittings.',
      '* dashed foreign location / cross-floor proposal. Exact floor labels, full IDs and elevations are in the keyed schedules.',
      'Blue cold; red hot; brown soil; green waste; purple vent; grey unknown circuit. Arrows = proposed order, NOT flow.',
      `${nodes.length} nodes; ${routes.length} routes; ${unknowns} unknown fields/points; ${model.findings.length} project findings. NOT ENGINEERED.`,
      ...levels.map((l, i) => `L${i + 1}: ${l.id}, level ${dim(l.z)}.`)
    ];
    blocks.unshift({ heading: 'DIAGRAM KEY LEGEND', texts: legend });
    const sourceSize = blocks.reduce((n, b) => n + b.heading.length + b.texts.reduce((m, t) => m + t.length, 0), 0);
    if (sourceSize > 500000) overflow('Complete schedule exceeds 500000 source characters.');
    const inline = [...legend, ...blocks.flatMap(b => [b.heading, ...b.texts])].flatMap(t => wrap(t, panelW));
    const capacity = Math.floor((bottom - top - 6) / STEP);
    const continuation = inline.length > capacity;
    if (continuation && !paginate) overflow('Full schedule and warnings do not fit one sheet.');
    let panelLines = (continuation ? [...legend, 'Complete schedules / warnings continue on subsequent pages. Review the entire set.'].flatMap(t => wrap(t, panelW)) : inline);
    if (continuation && panelLines.length > capacity) panelLines = [
      'N node; R route; F fixture.',
      'P port; V valve; T trap;',
      'C cleanout; S stack;',
      'J junction; I supply;',
      'O outlet; F fixture.',
      '* foreign / cross-floor.',
      '? incomplete; L level.',
      'Arrows: proposal, NOT flow.',
      'Full keys, IDs, levels and',
      'warnings on following pages.',
      'READ ENTIRE SET.'
    ].flatMap(t => wrap(t, panelW));
    if (panelLines.length > capacity) overflow('Key legend cannot fit the selected paper.');
    panelLines.forEach((t, i) => text(sheet, panelX, top + 6 + i * STEP, t));
    const pages = [sheet];
    if (continuation) {
      const columnW = width / 2 - 23, rows = Math.floor((bottom - top - 6) / STEP), columns = [];
      if (rows < 4) overflow('No readable continuation area.');
      let lines = [];
      columns.push(lines);
      const next = () => {
        if (1 + Math.ceil((columns.length + 1) / 2) > MAX_PAGES) overflow('Complete set exceeds 100 pages.');
        lines = []; columns.push(lines);
      };
      for (const b of blocks) {
        const body = b.texts.flatMap(t => wrap(t, columnW - widthOf('| '))).map(t => `| ${t}`);
        const heading = wrap(b.heading, columnW);
        if (heading.length > rows - 2) overflow('Record heading cannot fit a continuation column.');
        if (lines.length && (lines.length + heading.length + 2 > rows ||
          (body.length + heading.length + 1 <= rows && lines.length + body.length + heading.length + 1 > rows))) next();
        lines.push(...heading);
        for (const line of body) {
          if (lines.length >= rows) { next(); lines.push(...heading); }
          lines.push(line);
        }
        if (lines.length < rows) lines.push('');
      }
      for (let i = 0; i < columns.length; i += 2) {
        const page = { ...sheet, metadata: { ...sheet.metadata, assumptions: NOTES.slice() }, primitives: [] };
        for (let c = 0; c < 2; c++) (columns[i + c] || []).forEach((t, row) => {
          if (t) text(page, 14 + c * (width / 2 - 9), top + 6 + row * STEP, t);
        });
        pages.push(page);
      }
    }
    const title = wrap(sheet.metadata.title, width - 85, 3.5);
    const subtitle = wrap(`${sheet.metadata.floorName} | ${view} | ${units} | revision ${scene.revision}`, width - 28);
    const identity = wrap(`Project: ${scene.projectId} | Floor: ${selected}`, width - 28);
    if (title.length > 2 || subtitle.length > 2 || identity.length > 2) overflow('Title, floor name or identity exceeds two readable lines.');
    pages.forEach((page, i) => {
      title.forEach((t, j) => text(page, 14, 16 + j * 4.7, t, 3.5));
      text(page, width - 68, 16, `${view === 'riser' ? 'z ' : ''}1:${scale}`, 3.5);
      text(page, width - 68, 24, `Page ${i + 1}/${pages.length}`);
      subtitle.forEach((t, j) => text(page, 14, 30 + j * STEP, t));
      text(page, 14, top, i ? 'FULL SCHEDULE / WARNINGS - NOT ENGINEERED' : view === 'plan' ? 'PLUMBING / SITE AXES' : 'RISER / TRUE z; NONSPATIAL x', 2.5);
      path(page, [{ x: 14, y: footerTop }, { x: width - 14, y: footerTop }], INK, .2);
      noteLines.forEach((t, j) => text(page, 14, footerTop + 5 + j * STEP, t));
      identity.forEach((t, j) => text(page, 14, height - 7 + j * STEP, t));
    });
    const x = viewport.x + 2, y = bottom + 2;
    if (view === 'plan') {
      path(sheet, [{ x, y }, { x: x + factor, y }], INK, .35);
      text(sheet, x + factor + 3, y + .7, `${dim(1)} at 1:${scale}`, 2);
    }
    if (pages.reduce((n, p) => n + p.primitives.reduce((s, v) => s + (v.type === 'text' ? v.text.length : 0), 0), 0) > 1000000)
      overflow('Complete set exceeds 1000000 output characters.');
    try { pages.forEach(page => Drawing.validateSheet(page)); }
    catch (e) { overflow(`Shared sheet validation rejected output: ${e.message}`); }
    return freeze(pages);
  }
  function toSVG(sheet) {
    if (!Drawing) fail('Load HomePlannerDrawing first.');
    return Drawing.toSVG(sheet);
  }
  return Object.freeze({ createSheets, createSheet, toSVG });
});
