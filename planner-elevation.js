(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./planner-drawing.js') : root.HomePlannerDrawing,
    common ? require('./planner-structure.js') : root.HomePlannerStructure,
    common ? require('./planner-model.js') : root.HomePlannerModel,
    common ? require('./planner-projection.js') : root.HomePlannerProjection);
  if (common) module.exports = api;
  else root.HomePlannerElevation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Drawing, Structure, Model, Projection) {
  'use strict';
  const EPS = 1e-7, FONT = 2.2, STEP = 3.6;
  const MAX_VOLUMES = 4000, MAX_WORK = 500000, MAX_FRAGMENTS = 20000, MAX_TEXT = 500000, MAX_PAGES = 100;
  const INK = '#263238', WALL = '#E1E5E7', POCHE = '#354047';
  const COLORS = { column: '#ADB9C0', beam: '#A6B9C9', slab: '#B9C5B5', footing: '#C9B5A8' };
  const NOTES = [
    'CONCEPTUAL ONLY - NOT FOR CONSTRUCTION. Dimensions and structural adequacy are not verified.',
    'All floors share the registered site frame. Levels use project vertical zero, not an assumed storey height.',
    'Only compiled wall solids, supplied building obstacles and exact HomePlannerStructure solids are drawn.',
    'No inferred roof, parapet, canopy, slab, foundation or stair. Roof thickness alone is not a roof volume.',
    'Openings are apertures in compiled solids; glazing, frames and door leaves are omitted, not an optical simulation.',
    'Trees, furniture, fixtures and services have no supported physical elevation representation and are omitted.',
    'Structural aperture conflicts are reported separately; an opening never erases an independent structural member.'
  ];
  const fail = message => { throw new Error(`Elevation/section: ${message}`); };
  const overflow = message => fail(`${message} Use createSheets for notes continuation, larger paper or a supported saved scale for geometry. No automatic shrink or truncation.`);
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  function keys(v, allowed, label) {
    if (!plain(v) || Object.keys(v).some(k => !allowed.includes(k))) fail(`Invalid ${label} fields.`);
  }
  function text(v, label) {
    if (typeof v !== 'string' || !v.trim() || v.length > 16384 ||
        /[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/u.test(v) ||
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(v)) fail(`Invalid ${label} text.`);
    return v;
  }
  function list(v, max, label) {
    if (!Array.isArray(v) || v.length > max || Object.keys(v).length !== v.length ||
        !Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i)).every(Boolean)) fail(`Invalid or excessive ${label}.`);
    return v;
  }
  function xyz(p, label) {
    if (!p || !['x', 'y', 'z'].every(k => finite(p[k]))) fail(`Invalid ${label} coordinates.`);
    return p;
  }
  function box(r, label) {
    if (!r || !['x', 'y', 'w', 'h'].every(k => finite(r[k])) || r.w <= EPS || r.h <= EPS) fail(`Invalid ${label} bounds.`);
    return r;
  }
  function freeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
    return v;
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const corners = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  function strip(a, b, width) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!finite(len) || len <= EPS || !finite(width) || width <= EPS) fail('Degenerate physical strip.');
    const x = -(b.y - a.y) / len * width / 2, y = (b.x - a.x) / len * width / 2;
    return [{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y },
      { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }];
  }
  const measure = (n, units) => units === 'metric' ? `${Number(n.toFixed(6))} m` : `${Number((n / .3048).toFixed(6))} ft`;
  const bearing = (east, north) => Number(((Math.atan2(east, north) * 180 / Math.PI + 360) % 360).toFixed(6));

  function prepare(scene, options) {
    if (!Drawing || !Structure || !Model || !Projection) fail('Load Drawing, Structure, Model and Projection first.');
    keys(options, ['viewId', 'paper', 'orientation', 'scaleDenominator', 'units', 'title', 'floorName'], 'options');
    for (const [k, v] of Object.entries(options)) if (v === undefined) fail(`Option ${k} must not be undefined.`);
    text(options.viewId, 'viewId');
    if (!plain(scene) || scene.version !== 1 || scene.kind !== 'DrawingScene') fail('Expected a version 1 DrawingScene.');
    list(scene.scenes, 1000, 'floors'); list(scene.authored, 70000, 'authored records');
    list(scene.diagnostics, 20000, 'source diagnostics');
    if (!scene.scenes.length) fail('No registered floors.');
    if (!scene.documentation || scene.documentation.version !== 1) fail('Saved documentation views are required.');
    const views = list(scene.documentation.views, 10000, 'saved views').filter(v => {
      if (!plain(v)) fail('Invalid saved view.');
      return v.id === options.viewId;
    });
    if (views.length !== 1) fail('viewId must identify exactly one persisted view.');
    const view = views[0];
    keys(view, ['id', 'name', 'kind', 'floorId', 'scaleDenominator', 'direction', 'cut'], 'saved view');
    text(view.name, 'view name'); text(view.floorId, 'view floor');
    if (!['elevation', 'section'].includes(view.kind)) fail('Select a persisted elevation or section, not a plan.');
    if (![null, 'N', 'E', 'S', 'W'].includes(view.direction)) fail('Invalid saved direction.');
    if (view.kind === 'elevation' && view.direction === null) fail('Elevation requires a saved geographic direction.');
    list(view.cut, 2, 'cut anchors');
    if (view.cut.length !== (view.kind === 'section' ? 2 : 0)) fail('A section requires exactly two cut anchors.');
    const scale = view.scaleDenominator === null ? options.scaleDenominator : view.scaleDenominator;
    if (view.scaleDenominator !== null && options.scaleDenominator !== undefined && options.scaleDenominator !== scale)
      fail('Options scale conflicts with persisted view scale; update the saved view first.');
    if (![50, 75, 100].includes(scale)) fail('A supported scale (50, 75 or 100) is required; supply options scale when saved scale is null.');
    const paper = options.paper === undefined ? 'A3' : options.paper;
    const orientation = options.orientation === undefined ? 'landscape' : options.orientation;
    const units = options.units === undefined ? 'metric' : options.units;
    if (!Object.hasOwn(Drawing.PAPER_SIZES, paper) || !['portrait', 'landscape'].includes(orientation)) fail('Unsupported paper or orientation.');
    const media = Drawing.PAPER_SIZES[paper];
    const template = { version: 1, widthMm: media[orientation === 'portrait' ? 'widthMm' : 'heightMm'],
      heightMm: media[orientation === 'portrait' ? 'heightMm' : 'widthMm'], metadata: {
        projectId: scene.projectId, revision: scene.revision, floorId: view.floorId,
        floorName: options.floorName === undefined ? view.floorId : options.floorName,
        title: options.title === undefined ? view.name : options.title,
        paper, orientation, scaleDenominator: scale, units, assumptions: NOTES.slice()
      }, primitives: [] };
    Drawing.validateSheet(template);
    const fatal = new Set(['missing-geometry', 'invalid-geometry', 'missing-plot', 'inconsistent-site-frame', 'unresolved-site-frame']);
    for (const d of scene.diagnostics) if (fatal.has(d.code)) fail(`Whole-project prerequisites: ${d.code} (${d.ownerId}). No partial floor rendering.`);
    const floors = new Map(), indices = new Map(), first = scene.scenes[0];
    if (!plain(first)) fail('Invalid physical floor.');
    box(first.plot, 'site plot');
    let count = 0;
    for (const f of scene.scenes) {
      if (!plain(f)) fail('Invalid physical floor.');
      text(f.floorId, 'floor ID');
      if (floors.has(f.floorId)) fail('Duplicate floor identity.');
      if (f.coordinateSpace !== 'site-local' || !finite(f.floorElevationM) || !finite(f.headingDeg) ||
          !f.sourcePlotOrigin || ![f.sourcePlotOrigin.x, f.sourcePlotOrigin.y].every(finite)) fail(`Unregistered physical floor ${f.floorId}.`);
      box(f.plot, 'site plot');
      if (Math.abs(f.plot.x) > EPS || Math.abs(f.plot.y) > EPS ||
          Math.abs(f.plot.w - first.plot.w) > EPS || Math.abs(f.plot.h - first.plot.h) > EPS ||
          Math.abs(f.headingDeg - first.headingDeg) > EPS) fail('Inconsistent whole-project site frame.');
      floors.set(f.floorId, f);
      const byKind = {};
      for (const [kind, field] of Object.entries({ wall: 'walls', opening: 'openings', room: 'rooms', furniture: 'furniture', obstacle: 'obstacles' })) {
        const items = list(f[field], 20000, `${field} on ${f.floorId}`);
        count += items.length;
        if (count > 70000) fail('Physical record limit exceeded (70000).');
        const map = new Map();
        for (const item of items) {
          if (!plain(item)) fail(`Invalid ${kind} record.`);
          text(item.id, `${kind} ID`);
          if (map.has(item.id)) fail(`Ambiguous ${kind} identity ${item.id}.`);
          map.set(item.id, item);
        }
        byKind[kind] = map;
      }
      indices.set(f.floorId, byKind);
      list(f.unresolvedOpenings, 10000, 'unresolved openings');
      list(f.diagnostics, 20000, 'floor diagnostics');
      if (f.unresolvedOpenings.length || f.diagnostics.some(d => d.level === 'error'))
        fail(`Resolve rejected openings or geometry errors on ${f.floorId}; no partial floor rendering.`);
    }
    if (!floors.has(view.floorId)) fail('Saved view has a missing-floor attachment.');
    const authored = new Map();
    for (const e of scene.authored) {
      if (!plain(e)) fail('Invalid authored record.');
      if (!floors.has(e.floorId)) fail(`Authored geometry has a missing-floor: ${e.floorId}.`);
      text(e.record?.id, 'authored ID');
      const key = `${e.floorId}|${e.record.id}`;
      if (authored.has(key)) fail('Ambiguous authored host identity.');
      authored.set(key, e);
    }
    return { scene, view, template, floors, indices, authored, heading: first.headingDeg };
  }

  // Projected authored anchor results already contain the bounded dependency resolution.
  // Never recurse into raw records, recompile a project, or guess a replacement host.
  function resolve(ref, ctx) {
    if (!plain(ref)) fail('Unresolved cut: unknown-anchor.');
    const f = ctx.floors.get(ref.floorId), hosts = ctx.indices.get(ref.floorId);
    if (!f) fail('Unresolved cut: missing-floor.');
    let result;
    if (ref.kind === 'point') {
      keys(ref, ['kind', 'floorId', 'point'], 'point cut anchor');
      keys(ref.point, ['x', 'y', 'z'], 'cut point'); xyz(ref.point, 'cut point');
      result = { x: ref.point.x - f.sourcePlotOrigin.x, y: ref.point.y - f.sourcePlotOrigin.y,
        z: f.floorElevationM + ref.point.z };
    } else if (ref.kind === 'wall') {
      keys(ref, ['kind', 'floorId', 'entityId', 'offsetM', 'heightM'], 'wall cut anchor');
      const w = hosts.wall.get(ref.entityId);
      if (!w) fail('Unresolved cut: missing-host.');
      if (w.removed) fail('Unresolved cut: removed-host.');
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      if (![ref.offsetM, ref.heightM].every(finite) || ref.offsetM < 0 || ref.heightM < 0 ||
          ref.offsetM > len + EPS || ref.heightM > w.heightM + EPS) fail('Unresolved cut: host-bounds.');
      const apertures = f.openings.filter(o => o.wallId === w.id);
      if (apertures.some(o => ref.offsetM > o.offsetM + EPS && ref.offsetM < o.offsetM + o.widthM - EPS &&
          ref.heightM > o.sillM + EPS && ref.heightM < o.sillM + o.heightM - EPS)) fail('Unresolved cut: host-void.');
      // The foundation treats aperture boundaries as valid anchor surfaces,
      // including a door sill at floor zero with no sill solid beneath it.
      const boundary = apertures.some(o => ref.offsetM >= o.offsetM - EPS && ref.offsetM <= o.offsetM + o.widthM + EPS &&
        ref.heightM >= o.sillM - EPS && ref.heightM <= o.sillM + o.heightM + EPS &&
        [ref.offsetM - o.offsetM, ref.offsetM - o.offsetM - o.widthM, ref.heightM - o.sillM,
          ref.heightM - o.sillM - o.heightM].some(d => Math.abs(d) <= EPS));
      if (!boundary && !w.solidSections.some(s => ref.offsetM >= s.startM - EPS && ref.offsetM <= s.endM + EPS &&
          ref.heightM >= s.sillM - EPS && ref.heightM <= s.sillM + s.heightM + EPS)) fail('Unresolved cut: host-void.');
      result = { ...Model.wallPoint(w, Math.min(len, ref.offsetM)), z: w.baseM + ref.heightM };
    } else if (ref.kind === 'entity') {
      keys(ref, ['kind', 'floorId', 'entityKind', 'entityId'], 'entity cut anchor');
      text(ref.entityId, 'cut host');
      if (['room', 'opening', 'furniture', 'obstacle'].includes(ref.entityKind)) {
        const e = hosts[ref.entityKind].get(ref.entityId);
        if (!e) fail('Unresolved cut: missing-host.');
        if (ref.entityKind === 'opening') {
          const w = hosts.wall.get(e.wallId);
          if (!w || w.removed) fail('Unresolved cut: removed-host.');
          result = { ...Model.wallPoint(w, e.offsetM + e.widthM / 2), z: w.baseM + e.sillM + e.heightM / 2 };
        } else {
          const r = box(e.rect || e, 'cut host');
          result = { x: r.x + r.w / 2, y: r.y + r.h / 2,
            z: ref.entityKind === 'obstacle' ? e.baseM + e.heightM / 2 : f.floorElevationM };
        }
      } else {
        const collections = { fixture: 'fixtures', stair: 'stairs', structural: 'structural', serviceNode: 'serviceNodes' };
        const e = ctx.authored.get(`${ref.floorId}|${ref.entityId}`);
        if (!Object.hasOwn(collections, ref.entityKind) || !e || e.collection !== collections[ref.entityKind]) fail('Unresolved cut: missing-host.');
        const anchors = list(e.anchors, 2, 'projected host anchors');
        if (!anchors.length || e.anchorStatus !== 'resolved' || anchors.some(a => a?.status !== 'resolved'))
          fail('Unresolved cut: unresolved-host (including cyclic/depth-limited hosts).');
        result = { x: 0, y: 0, z: 0 };
        for (const a of anchors) {
          xyz(a.point, 'projected host');
          for (const axis of ['x', 'y', 'z']) result[axis] += a.point[axis] / anchors.length;
        }
      }
    } else fail('Unsupported cut anchor kind.');
    return xyz(result, 'resolved cut');
  }

  function frame(ctx) {
    const world = p => Projection.siteToWorld({ ...p, z: p.z === undefined ? 0 : p.z }, ctx.heading);
    if (ctx.view.kind === 'elevation') {
      const axes = { N: [1, 0, 0, 1, 'E', 'S'], E: [0, -1, 1, 0, 'S', 'W'],
        S: [-1, 0, 0, -1, 'W', 'N'], W: [0, 1, -1, 0, 'N', 'E'] };
      const [ux, uy, vx, vy, right, look] = axes[ctx.view.direction];
      return { project(p) { const w = world(p); return { u: w.east * ux + w.north * uy, v: w.east * vx + w.north * vy }; },
        label: `VIEW ${ctx.view.direction} | RIGHT ${right} | LOOK ${look} | site heading ${ctx.heading} deg`,
        notes: ['Elevation: nearer physical faces hide farther faces. Apertures can reveal supplied geometry behind them; no X-ray overlays.'] };
    }
    const a = resolve(ctx.view.cut[0], ctx), b = resolve(ctx.view.cut[1], ctx);
    if (Math.abs(a.z - b.z) > EPS) fail('Unsupported sloping cut: endpoints must have equal project-relative z.');
    const aw = world(a), bw = world(b), length = Math.hypot(bw.east - aw.east, bw.north - aw.north);
    if (!finite(length) || length <= EPS) fail('Section needs distinct horizontal endpoints.');
    const ux = (bw.east - aw.east) / length, uy = (bw.north - aw.north) / length;
    return { length,
      project(p) { const w = world(p), x = w.east - aw.east, y = w.north - aw.north; return { u: x * ux + y * uy, v: -x * uy + y * ux }; },
      label: `SECTION A -> B | RIGHT bearing ${bearing(ux, uy)} deg | LOOK bearing ${bearing(uy, -ux)} deg`,
      notes: [
        'Section: finite vertical plane through A -> B. Viewer stands left of A -> B in geographic east/north coordinates; reversing endpoints mirrors the cut.',
        'Cut solids only (wall poche); ALL geometry beyond the plane is omitted. Closed-volume boundary contacts are included. No sliced interior is inferred.',
        `Cut A site-local metres: ${a.x}, ${a.y}, ${a.z}; B: ${b.x}, ${b.y}, ${b.z}; length ${length} m.`,
        `Saved section direction ${ctx.view.direction ?? 'null'} does not override endpoint order.`
      ] };
  }

  function collect(ctx, add) {
    const volumes = [], levels = [], extentPoints = [];
    function volume(polygon, z, h, color, id) {
      if (volumes.length >= MAX_VOLUMES) fail(`Geometry limit exceeded (${MAX_VOLUMES} volumes). Simplify the complete project explicitly.`);
      if (!finite(z) || !finite(h) || h <= EPS || !finite(z + h) ||
          polygon.some(p => !finite(p.x) || !finite(p.y))) fail(`Unknown or invalid physical volume: ${id}.`);
      volumes.push({ polygon, z, top: z + h, color, id });
      extentPoints.push(...polygon.map(p => ({ ...p, z })), ...polygon.map(p => ({ ...p, z: z + h })));
    }
    for (const f of ctx.floors.values()) {
      levels.push({ z: f.floorElevationM, floorId: f.floorId });
      for (const d of f.diagnostics) add(`${f.floorId} source ${d.level || 'diagnostic'}: ${text(d.message, 'source diagnostic')}`);
      for (const w of f.walls) {
        if (!w.start || !w.end || ![w.start.x, w.start.y, w.end.x, w.end.y, w.baseM, w.heightM, w.thicknessM].every(finite) ||
            w.heightM <= EPS || w.thicknessM <= EPS) fail(`Wall ${w.id} requires physical base, height and thickness.`);
        const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        if (!finite(len) || len <= EPS) fail(`Degenerate wall ${w.id}.`);
        list(w.solidSections, MAX_VOLUMES, 'wall solidSections');
        if (w.removed && w.solidSections.length) fail(`Removed wall ${w.id} has inconsistent solidSections.`);
        // Keep true wall envelope extents even when a full-height aperture removes all solids.
        const footprint = strip(w.start, w.end, w.thicknessM);
        extentPoints.push(...footprint.map(p => ({ ...p, z: w.baseM })), ...footprint.map(p => ({ ...p, z: w.baseM + w.heightM })));
        for (const [i, s] of w.solidSections.entries()) {
          if (![s.startM, s.endM, s.sillM, s.heightM].every(finite) || s.startM < -EPS ||
              s.endM > len + EPS || s.endM - s.startM <= EPS || s.sillM < -EPS || s.heightM <= EPS ||
              s.sillM + s.heightM > w.heightM + EPS) fail(`Invalid physical wall solidSections: ${w.id}.`);
          volume(strip(Model.wallPoint(w, s.startM), Model.wallPoint(w, s.endM), w.thicknessM),
            w.baseM + s.sillM, s.heightM, WALL, `${f.floorId}|wall|${w.id}|${i}`);
        }
      }
      for (const o of f.openings) {
        const w = ctx.indices.get(f.floorId).wall.get(o.wallId);
        if (!w || ![o.offsetM, o.widthM, o.sillM, o.heightM].every(finite) ||
            o.offsetM < -EPS || o.widthM <= EPS || o.sillM < -EPS || o.heightM <= EPS ||
            o.sillM + o.heightM > w.heightM + EPS) fail(`Missing physical aperture information: ${o.id}.`);
        const a = Model.wallPoint(w, o.offsetM), b = Model.wallPoint(w, o.offsetM + o.widthM), s = o.segment;
        if (!s || ![s.x1, s.y1, s.x2, s.y2].every(finite) ||
            Math.hypot(s.x1 - a.x, s.y1 - a.y) > EPS || Math.hypot(s.x2 - b.x, s.y2 - b.y) > EPS)
          fail(`Unresolved aperture segment: ${o.id}.`);
        add(`${f.floorId} aperture ${o.id}: sill ${measure(w.baseM + o.sillM, ctx.template.metadata.units)}; head ${measure(w.baseM + o.sillM + o.heightM, ctx.template.metadata.units)} (project zero).`);
      }
      for (const o of f.obstacles) {
        if (o.type !== 'building') { add(`OMITTED obstacle ${o.id} (${o.type}): no supported physical elevation representation.`); continue; }
        box(o, 'building obstacle');
        if (!finite(o.transmittance) || o.transmittance < 0 || o.transmittance > 1) fail(`Unknown building transmittance: ${o.id}.`);
        volume(corners(o), o.baseM, o.heightM, o.transmittance > 0 ? '#CCD9E2' : '#B9BEC1', `${f.floorId}|obstacle|${o.id}`);
        add(`Building obstacle ${o.id}: base ${measure(o.baseM, ctx.template.metadata.units)}; top ${measure(o.baseM + o.heightM, ctx.template.metadata.units)}; supplied transmittance ${o.transmittance}. ${o.transmittance > 0 ? 'Transparent input represented as an opaque diagram mass, NOT ray tracing.' : 'Opaque physical mass.'}`);
      }
    }
    const model = Structure.build(ctx.scene);
    for (const e of model.elements) {
      const g = e.geometry;
      if (!g) add(`OMITTED incomplete structural ${e.id} (${e.kind}): ${e.issues.join(', ')}. No volume guessed.`);
      else if (g.kind === 'grid') add(`Grid ${e.id}: reference only, no physical volume.`);
      else {
        const poly = g.kind === 'box' ? corners({ x: g.x, y: g.y, w: g.w, h: g.d }) : strip(g.start, g.end, g.widthM);
        const z = g.kind === 'box' ? g.z : g.start.z, h = g.kind === 'box' ? g.h : g.depthM;
        volume(poly, z, h, COLORS[e.kind], `${e.floorId}|structure|${e.id}`);
        add(`${e.kind} ${e.id}: bottom ${measure(z, ctx.template.metadata.units)}; top ${measure(z + h, ctx.template.metadata.units)}; sizeSource ${e.sizeSource}; material ${e.material ?? 'unknown'}; reference ${e.reference ?? 'unknown'}.`);
      }
    }
    for (const f of model.findings) add(`${f.code} [${f.elementIds.join(', ') || 'project'}]: ${f.message}`);
    for (const d of ctx.scene.diagnostics) add(`Source ${text(d.code, 'diagnostic code')} [${d.ownerId ?? 'project'}]${d.causeCode ? ` (${d.causeCode})` : ''}${d.message ? `: ${d.message}` : ''}${d.reference ? `; reference ${JSON.stringify(d.reference)}` : ''}`);
    return { volumes, levels, extentPoints };
  }

  const depth = (f, u) => f.va + (f.vb - f.va) * (u - f.a) / (f.b - f.a);
  function facesFor(volume, transform, section) {
    const p = volume.polygon.map(transform.project), faces = [];
    if (section) {
      const hits = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if (Math.abs(a.v) <= EPS) hits.push(a.u);
        if ((a.v < -EPS && b.v > EPS) || (a.v > EPS && b.v < -EPS)) hits.push(a.u + (b.u - a.u) * -a.v / (b.v - a.v));
      }
      if (hits.length >= 2) {
        const a = Math.max(0, Math.min(...hits)), b = Math.min(transform.length, Math.max(...hits));
        if (b - a > EPS) faces.push({ a, b, va: 0, vb: 0, z: volume.z, top: volume.top,
          color: volume.color === WALL ? POCHE : volume.color, id: volume.id });
      }
      return faces;
    }
    const edges = p.map((a, i) => {
      const b = p[(i + 1) % p.length];
      return a.u < b.u ? { a: a.u, b: b.u, va: a.v, vb: b.v } : { a: b.u, b: a.u, va: b.v, vb: a.v };
    }).filter(e => e.b - e.a > EPS);
    for (const [i, e] of edges.entries()) {
      const u = (e.a + e.b) / 2, v = depth(e, u);
      if (edges.some(other => u > other.a - EPS && u < other.b + EPS && depth(other, u) > v + EPS)) continue;
      faces.push({ ...e, z: volume.z, top: volume.top, color: volume.color, id: `${volume.id}|${i}` });
    }
    return faces;
  }

  const meets = (a, b) => a.a < b.b - EPS && a.b > b.a + EPS && a.z < b.top - EPS && a.top > b.z + EPS;
  function index(faces) {
    if (!faces.length) return null;
    const node = { a: Infinity, b: -Infinity, z: Infinity, top: -Infinity };
    for (const f of faces) { node.a = Math.min(node.a, f.a); node.b = Math.max(node.b, f.b); node.z = Math.min(node.z, f.z); node.top = Math.max(node.top, f.top); }
    if (faces.length <= 8) return { ...node, faces };
    const horizontal = node.b - node.a >= node.top - node.z;
    faces.sort((a, b) => horizontal ? (a.a + a.b) - (b.a + b.b) : (a.z + a.top) - (b.z + b.top));
    const mid = Math.floor(faces.length / 2);
    return { ...node, left: index(faces.slice(0, mid)), right: index(faces.slice(mid)) };
  }
  function visible(faces) {
    const tree = index(faces.slice()), output = [];
    let work = 0, fragments = 0;
    const consume = () => { if (++work > MAX_WORK) fail(`Visibility work limit exceeded (${MAX_WORK}); simplify overlapping complete-project geometry.`); };
    function query(node, f, visit) {
      if (!node) return;
      consume();
      if (!meets(node, f)) return;
      if (node.faces) { for (const other of node.faces) { consume(); if (other !== f && meets(f, other)) visit(other); } }
      else { query(node.left, f, visit); query(node.right, f, visit); }
    }
    for (const f of faces) {
      let pieces = [{ a: f.a, b: f.b, z: f.z, top: f.top }];
      query(tree, f, other => {
        if (!pieces.length) return;
        let a = Math.max(f.a, other.a), b = Math.min(f.b, other.b);
        const da = depth(other, a) - depth(f, a), db = depth(other, b) - depth(f, b);
        if (Math.abs(da) <= EPS && Math.abs(db) <= EPS) { if (compare(other.id, f.id) >= 0) return; }
        else {
          if (da <= 0 && db <= 0) return;
          if (da < 0) a += (b - a) * -da / (db - da);
          else if (db < 0) b = a + (b - a) * da / (da - db);
        }
        const next = [];
        for (const p of pieces) {
          consume();
          const left = Math.max(p.a, a), right = Math.min(p.b, b), bottom = Math.max(p.z, other.z), top = Math.min(p.top, other.top);
          if (right - left <= EPS || top - bottom <= EPS) { next.push(p); continue; }
          for (const r of [{ a: p.a, b: left, z: p.z, top: p.top }, { a: right, b: p.b, z: p.z, top: p.top },
            { a: left, b: right, z: p.z, top: bottom }, { a: left, b: right, z: top, top: p.top }]) {
            if (r.b - r.a > EPS && r.top - r.z > EPS) {
              if (++fragments > MAX_FRAGMENTS) fail(`Visibility fragment limit exceeded (${MAX_FRAGMENTS}).`);
              next.push(r);
            }
          }
        }
        pieces = next;
      });
      for (const p of pieces) {
        if (output.length >= MAX_FRAGMENTS) fail(`Visible fragment limit exceeded (${MAX_FRAGMENTS}).`);
        output.push({ ...p, color: f.color });
      }
    }
    return output;
  }

  function wrap(value, width, size = FONT) {
    const limit = Math.floor(width / (size * 1.1));
    if (limit < 1) overflow('Readable text cannot fit.');
    const chars = Array.from(value), lines = [];
    for (let i = 0; i < chars.length; i += limit) lines.push(chars.slice(i, i + limit).join(''));
    return lines;
  }
  function render(scene, options, paginate) {
    const ctx = prepare(scene, options), notes = [];
    let textCount = 0;
    const add = value => {
      if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/u.test(value)) fail('Invalid schedule text.');
      textCount += value.length;
      if (textCount > MAX_TEXT) overflow(`Notes exceed the ${MAX_TEXT}-character budget.`);
      notes.push(value);
    };
    const physical = collect(ctx, add), transform = frame(ctx), section = ctx.view.kind === 'section';
    add(`Saved ${ctx.view.kind} view ID: ${ctx.view.id}; floor attachment: ${ctx.view.floorId}.`);
    const assumptions = [...NOTES, ...transform.notes];
    const datum = scene.siteDatum?.elevationM;
    if (datum !== undefined && datum !== null && !finite(datum)) fail('Invalid site datum.');
    assumptions.push(datum === undefined || datum === null ? 'Absolute datum is unknown; all printed levels are relative to project zero.' :
      `Supplied absolute datum at project zero: ${measure(datum, ctx.template.metadata.units)}; no geodetic reference inferred.`);
    assumptions.forEach(add);
    const floorLevels = physical.levels.sort((a, b) => a.z - b.z || compare(a.floorId, b.floorId));
    for (const [i, l] of floorLevels.entries()) add(`L${i + 1} FLOOR ${l.floorId}: ${measure(l.z, ctx.template.metadata.units)} above project zero${datum !== undefined && datum !== null ? `; absolute ${measure(datum + l.z, ctx.template.metadata.units)}` : ''}.`);
    const faces = physical.volumes.flatMap(v => facesFor(v, transform, section));
    faces.sort((a, b) => compare(a.id, b.id));
    const geometry = visible(faces), all = physical.extentPoints;
    if (!all.length) fail('No physical wall or supplied volume extents; cannot produce an empty successful drawing.');
    let minU = section ? 0 : Infinity, maxU = section ? transform.length : -Infinity;
    let minZ = Math.min(...floorLevels.map(l => l.z)), maxZ = Math.max(...floorLevels.map(l => l.z));
    for (const p of all) {
      const q = transform.project(p);
      if (![q.u, q.v, p.z].every(finite)) fail('Projected geometry exceeds the supported coordinate range.');
      if (!section) { minU = Math.min(minU, q.u); maxU = Math.max(maxU, q.u); }
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    if (maxU - minU <= EPS || maxZ - minZ <= EPS) fail('Degenerate physical drawing extents.');
    if (!geometry.length) add(section ? 'No supplied solid intersects this finite cut. Level references and cut extent only.' :
      'No remaining wall solids or supplied masses; wall aperture envelope and level references only.');
    const base = ctx.template, width = base.widthMm, height = base.heightMm, factor = 1000 / base.metadata.scaleDenominator;
    const drawingW = (maxU - minU) * factor, drawingH = (maxZ - minZ) * factor;
    const viewport = { x: 15, y: 58, w: width - 88, h: height - 114 };
    if (drawingW > viewport.w - 2 || drawingH > viewport.h - 2) overflow(`Fixed scale 1:${base.metadata.scaleDenominator} physical extents do not fit ${base.metadata.paper} ${base.metadata.orientation}.`);
    const x0 = viewport.x + (viewport.w - drawingW) / 2, y0 = viewport.y;
    const project = (u, z) => ({ x: x0 + (u - minU) * factor, y: y0 + (maxZ - z) * factor });
    function newPage() { return { ...base, metadata: { ...base.metadata, assumptions: assumptions.slice() }, primitives: [] }; }
    function label(sheet, x, y, value, size = FONT) {
      sheet.primitives.push({ type: 'text', xMm: x, yMm: y, text: value, fontSizeMm: size,
        align: 'start', rotationDeg: 0, color: INK });
    }
    function path(sheet, points, fill = null, closed = false, stroke = INK, lineWidth = .18) {
      sheet.primitives.push({ type: 'path', commands: points.map((p, i) => [i ? 'L' : 'M', p.x, p.y]).concat(closed ? [['Z']] : []),
        fill, stroke, strokeWidthMm: lineWidth });
    }
    const sheet = newPage();
    for (const r of geometry) path(sheet, [project(r.a, r.top), project(r.b, r.top), project(r.b, r.z), project(r.a, r.z)],
      r.color, true, null, 0);
    // Outlines belong only to visible fragments; hidden face edges never survive on top.
    for (const r of geometry) path(sheet, [project(r.a, r.top), project(r.b, r.top), project(r.b, r.z), project(r.a, r.z)], null, true, INK, .12);
    const barX = viewport.x + viewport.w + 4;
    const sortedLevels = floorLevels.map((l, i) => ({ ...l, key: `L${i + 1}`, y: project(minU, l.z).y }))
      .sort((a, b) => a.y - b.y || compare(a.key, b.key));
    let lastY = viewport.y - 4;
    for (const l of sortedLevels) {
      const y = Math.max(l.y, lastY + 4);
      if (y > viewport.y + viewport.h) overflow('Floor-level reference labels cannot fit at readable spacing.');
      path(sheet, [{ x: barX, y: l.y }, { x: barX + 4, y: l.y }, { x: barX + 7, y }]);
      label(sheet, barX + 8, y + .7, l.key);
      lastY = y;
    }
    const bottom = Math.max(viewport.y + drawingH, lastY);
    if (section) {
      const y = viewport.y + drawingH + 5;
      path(sheet, [{ x: x0, y }, { x: x0 + drawingW, y }]);
      label(sheet, x0, y + 4, 'A'); label(sheet, x0 + drawingW, y + 4, 'B');
    }
    const noteLines = ['LEVELS / APERTURES / PHYSICAL INTENT / CAVEATS', ...notes].flatMap(n => wrap(n, width - 30));
    const sheets = [sheet];
    let y = bottom + 16;
    for (const line of noteLines) {
      if (y > height - 17) {
        if (!paginate) overflow('Full notes do not fit one sheet.');
        if (sheets.length >= MAX_PAGES) overflow(`Notes exceed ${MAX_PAGES} pages.`);
        sheets.push(newPage()); y = 58;
      }
      if (line.trim()) label(sheets.at(-1), 15, y, line);
      y += STEP;
    }
    const title = wrap(base.metadata.title, width - 85, 3.5);
    const subtitle = wrap(`${base.metadata.floorName} | ${base.metadata.units} | ${scene.projectId} | revision ${scene.revision}`, width - 30);
    const orientation = wrap(transform.label, width - 30);
    if (title.length > 2 || subtitle.length > 2 || orientation.length > 2) overflow('Title, floor/project identity or orientation exceeds the readable header.');
    for (const [i, page] of sheets.entries()) {
      title.forEach((t, j) => label(page, 15, 15 + j * 4.5, t, 3.5));
      label(page, width - 63, 15, `1:${base.metadata.scaleDenominator}`, 3.5);
      subtitle.forEach((t, j) => label(page, 15, 29 + j * STEP, t));
      orientation.forEach((t, j) => label(page, 15, 40 + j * STEP, t));
      label(page, 15, 50, i ? 'NOTES CONTINUATION - no additional geometry' : section ? 'FINITE CUT SOLIDS / WALL POCHE' : 'OPAQUE PHYSICAL ELEVATION');
      label(page, 15, height - 8, `Page ${i + 1}/${sheets.length} | NOT FOR CONSTRUCTION | print at 100%`);
      Drawing.validateSheet(page);
    }
    return freeze(sheets);
  }
  return Object.freeze({
    createSheets: (scene, options = {}) => render(scene, options, true),
    createSheet: (scene, options = {}) => render(scene, options, false)[0],
    toSVG: sheet => Drawing.toSVG(sheet)
  });
});
