(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root.document) return;
  root.HomePlannerElectrical = api;
  const start = () => {
    const host = root.document.getElementById('electricalWorkspace');
    if (host && !host.dataset.elecMounted) {
      if (root.HomePlanner) api.mount(host, root.HomePlanner, root.HomePlannerModel);
      else host.textContent = 'Electrical planning is unavailable until the shared project model is ready.';
    }
  };
  start();
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-8;
  const TYPES = Object.freeze({ socket: 'Socket', switch: 'Switch / control', light: 'Light', appliance: 'Appliance intent', data: 'Data / communication' });
  const SYMBOLS = Object.freeze({ socket: 'S', switch: 'W', light: 'L', appliance: 'A', data: 'D' });
  const REFERENCES = Object.freeze({
    'plate-centre': 'Plate centre',
    'plate-bottom': 'Plate bottom',
    'operable-part-centre': 'Operable-part centre',
    'mounting-point': 'Mounting point'
  });
  const LOADS = Object.freeze({ unknown: 'Unknown', low: 'Low (qualitative)', ordinary: 'Ordinary (qualitative)', high: 'High — professional review' });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const xy = value => value && finite(value.x) && finite(value.y);
  const copy = value => JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const format = value => finite(value) ? Number(value.toFixed(3)).toString() : 'Unknown';
  const length = wall => xy(wall?.start) && xy(wall?.end) ? Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) : NaN;
  const finding = (category, status, code, message) => ({ category, status, code, message });
  const rectValid = rect => rect && [rect.x, rect.y, rect.w, rect.h].every(finite) && rect.w > 0 && rect.h > 0;
  const contains = (rect, point) => rectValid(rect) && xy(point) && point.x >= rect.x - EPS && point.x <= rect.x + rect.w + EPS &&
    point.y >= rect.y - EPS && point.y <= rect.y + rect.h + EPS;
  const oppositeFace = face => face === 'left' ? 'right' : 'left';
  const basisFor = wall => ({ start: { ...wall.start }, end: { ...wall.end } });

  function wallPoint(wall, offsetM, model) {
    const size = length(wall);
    if (!finite(size) || size <= EPS || !finite(offsetM) || offsetM < 0 || offsetM > size) {
      throw new Error('Along-wall offset must be within the actual wall length; it is not clamped.');
    }
    if (typeof model?.wallPoint === 'function') {
      const point = model.wallPoint(wall, offsetM);
      if (!xy(point)) throw new Error('The shared wall coordinate helper returned an invalid point.');
      return { x: point.x, y: point.y };
    }
    const t = offsetM / size;
    return { x: wall.start.x + t * (wall.end.x - wall.start.x), y: wall.start.y + t * (wall.end.y - wall.start.y) };
  }

  function wallFrame(wall, face) {
    const size = length(wall);
    if (!finite(size) || size <= EPS || !['left', 'right'].includes(face)) return null;
    const tangent = { x: (wall.end.x - wall.start.x) / size, y: (wall.end.y - wall.start.y) / size };
    const sign = face === 'left' ? 1 : -1;
    return { tangent, normal: { x: sign * tangent.y, y: -sign * tangent.x } };
  }

  function verticalBand(point) {
    if (!finite(point?.elevationM)) return null;
    const height = point.envelope?.heightM;
    if (!finite(height) || height <= 0) return null;
    let below;
    if (point.elevationReference === 'plate-centre') below = height / 2;
    else if (point.elevationReference === 'plate-bottom') below = 0;
    else below = point.envelope?.referenceOffsetM;
    if (!finite(below) || below < 0 || below > height) return null;
    return { minM: point.elevationM - below, maxM: point.elevationM - below + height };
  }

  function verticalOverlap(a, b) {
    if (!a || !b || ![a.minM, a.maxM, b.minM, b.maxM].every(finite) || a.maxM < a.minM || b.maxM < b.minM) return null;
    return a.minM <= b.maxM + EPS && b.minM <= a.maxM + EPS;
  }

  function validatePoint(point, floorId) {
    const errors = [];
    if (!point || typeof point !== 'object' || Array.isArray(point)) return ['A point must be an object.'];
    const ownFloor = floorId || point.floorId;
    if (typeof point.floorId !== 'string' || !point.floorId || point.floorId !== ownFloor) errors.push('The point must belong to the active floor.');
    if (typeof point.id !== 'string' || !ownFloor || !point.id.startsWith(`${ownFloor}:`)) errors.push('Point IDs must be namespaced by their floor.');
    if (!Object.hasOwn(TYPES, point.type)) errors.push('Choose a supported point type.');
    if (typeof point.label !== 'string' || !point.label.trim()) errors.push('Give the point a name.');
    if (typeof point.purpose !== 'string' || !point.purpose.trim()) errors.push('Describe the device or purpose you need.');
    if (point.roomId != null && typeof point.roomId !== 'string') errors.push('The associated room ID must be a string, or unassigned.');
    if (!Object.hasOwn(LOADS, point.loadCategory)) errors.push('Choose a qualitative load category, or Unknown.');
    if (!Object.hasOwn(REFERENCES, point.elevationReference)) errors.push('Choose the elevation measurement datum.');
    if (point.elevationM != null && (!finite(point.elevationM) || point.elevationM < 0)) errors.push('Elevation must be a non-negative finite metre value, or unset.');
    const anchor = point.anchor;
    if (anchor?.kind === 'wall') {
      if (typeof anchor.wallId !== 'string' || !anchor.wallId) errors.push('Choose a wall host.');
      if (!['left', 'right'].includes(anchor.face)) errors.push('Choose the oriented wall face.');
      if (!finite(anchor.offsetM) || anchor.offsetM < 0) errors.push('Along-wall offset must be a non-negative finite metre value.');
      if (anchor.basis && (!xy(anchor.basis.start) || !xy(anchor.basis.end) || length(anchor.basis) <= EPS)) errors.push('The anchor orientation reference is invalid.');
    } else if (anchor?.kind === 'ceiling' || anchor?.kind === 'floor') {
      if (point.type !== 'light') errors.push('Only lights use ceiling or floor surface anchors in this slice.');
      if (!xy(anchor)) errors.push('Surface anchors need finite local x and y coordinates in metres.');
      if (point.elevationReference !== 'mounting-point') errors.push('Surface lights use the mounting-point elevation datum.');
    } else errors.push('Choose a wall, ceiling or floor anchor.');
    for (const key of ['widthM', 'heightM', 'depthM']) {
      const value = point.envelope?.[key];
      if (value != null && (!finite(value) || value <= 0)) errors.push(`Envelope ${key} must be positive, or unset.`);
    }
    const referenceOffset = point.envelope?.referenceOffsetM;
    if (referenceOffset != null && (!finite(referenceOffset) || referenceOffset < 0 ||
      (finite(point.envelope?.heightM) && referenceOffset > point.envelope.heightM))) errors.push('The datum offset must lie within the entered plate height.');
    for (const key of ['reachMinM', 'reachMaxM', 'furnitureBaseM', 'headboardBaseM']) {
      const value = point.inputs?.[key];
      if (value != null && (!finite(value) || value < 0)) errors.push(`${key} must be non-negative, or unset.`);
    }
    for (const key of ['approachWidthM', 'approachDepthM', 'furnitureHeightM', 'headboardHeightM', 'headboardDepthM']) {
      const value = point.inputs?.[key];
      if (value != null && (!finite(value) || value <= 0)) errors.push(`${key} must be positive, or unset.`);
    }
    if (finite(point.inputs?.reachMinM) && finite(point.inputs?.reachMaxM) && point.inputs.reachMinM > point.inputs.reachMaxM) errors.push('The chosen reach minimum cannot exceed its maximum.');
    if (point.inputs?.wetArea != null && !['unknown', 'dry', 'wet'].includes(point.inputs.wetArea)) errors.push('Wet-area context must be Unknown, Dry assumption or Wet.');
    return errors;
  }

  function mapWallAnchor(anchor, scene) {
    const walls = list(scene?.walls);
    let wall = walls.find(item => item.id === anchor?.wallId);
    if (wall && !wall.removed) {
      const mapped = { ...anchor };
      let mapping = 'identity';
      const old = anchor.basis;
      if (xy(old?.start) && xy(old?.end) && length(old) > EPS && length(wall) > EPS) {
        const ox = old.end.x - old.start.x, oy = old.end.y - old.start.y;
        const nx = wall.end.x - wall.start.x, ny = wall.end.y - wall.start.y;
        if (Math.abs(ox * ny - oy * nx) < EPS * length(old) * length(wall) && ox * nx + oy * ny < 0) {
          mapped.offsetM = length(wall) - anchor.offsetM;
          mapped.face = oppositeFace(anchor.face);
          mapping = 'reversed';
        }
      }
      mapped.basis = basisFor(wall);
      return { wall, anchor: mapped, mapping };
    }
    // Rehosting is permitted only with explicit lineage, never by geometric proximity.
    const candidates = list(scene?.wallLineage).filter(link =>
      link.sourceWallId === anchor?.wallId && [link.sourceStartM, link.sourceEndM, link.targetStartM, link.targetEndM].every(finite) &&
      link.sourceEndM > link.sourceStartM && anchor.offsetM >= link.sourceStartM && anchor.offsetM <= link.sourceEndM
    ).map(link => ({ link, wall: walls.find(item => item.id === link.targetWallId && !item.removed) })).filter(item => item.wall);
    if (candidates.length !== 1) return { wall: null, anchor, mapping: candidates.length ? 'ambiguous-lineage' : 'missing' };
    const target = candidates[0];
    wall = target.wall;
    const link = target.link;
    const fraction = (anchor.offsetM - link.sourceStartM) / (link.sourceEndM - link.sourceStartM);
    return {
      wall,
      anchor: {
        ...anchor, wallId: wall.id,
        offsetM: link.targetStartM + fraction * (link.targetEndM - link.targetStartM),
        face: link.targetEndM < link.targetStartM ? oppositeFace(anchor.face) : anchor.face,
        basis: basisFor(wall)
      },
      mapping: 'lineage'
    };
  }

  function openingsFor(scene, wall) {
    const byId = new Map();
    list(scene?.openings).filter(opening => opening.wallId === wall.id).forEach(opening => byId.set(opening.id, opening));
    list(wall.openings).forEach(opening => {
      if (opening && typeof opening === 'object' && !byId.has(opening.id)) byId.set(opening.id, opening);
    });
    return [...byId.values()];
  }

  function covers(intervals, start, end) {
    let cursor = start;
    for (const interval of intervals.filter(item => finite(item.startM) && finite(item.endM) && item.endM >= item.startM)
      .slice().sort((a, b) => a.startM - b.startM)) {
      if (interval.endM < cursor - EPS) continue;
      if (interval.startM > cursor + EPS) return false;
      cursor = Math.max(cursor, interval.endM);
      if (cursor >= end - EPS) return true;
    }
    return false;
  }

  function solidSectionsCover(sections, startM, endM, band) {
    if (!Array.isArray(sections) || !finite(startM) || !finite(endM) || startM > endM || verticalOverlap(band, band) === null) return null;
    if (sections.some(section => !section || ![section.startM, section.endM, section.sillM, section.heightM].every(finite) ||
      section.startM < 0 || section.endM <= section.startM || section.heightM <= 0)) return null;
    const cuts = [...new Set([startM, endM, ...sections.flatMap(section => [section.startM, section.endM])
      .filter(value => value > startM && value < endM)])].sort((a, b) => a - b);
    const samples = [...cuts, ...cuts.slice(1).map((value, index) => (cuts[index] + value) / 2)];
    return samples.every(along => covers(sections.filter(section => along >= section.startM - EPS && along <= section.endM + EPS)
      .map(section => ({ startM: section.sillM, endM: section.sillM + section.heightM })), band.minM, band.maxM));
  }

  function resolveAnchor(point, scene, model) {
    const checks = [];
    const result = { status: 'draft', drawable: false, position: null, band: verticalBand(point), checks };
    if (!scene || !scene.floorId) {
      checks.push(finding('incomplete', 'unknown', 'scene-unknown', 'No effective floor scene. The point remains a reviewable draft.'));
      return result;
    }
    const errors = validatePoint(point, scene.floorId);
    if (errors.length) {
      checks.push(...errors.map(message => finding('incomplete', 'unknown', 'invalid-record', message)));
      return result;
    }
    if (!finite(scene.floorElevationM)) checks.push(finding('incomplete', 'unknown', 'floor-datum-unknown', 'The floor elevation is unknown; absolute elevation is not evaluated.'));
    if (!finite(point.elevationM)) checks.push(finding('incomplete', 'unknown', 'height-unknown', 'Elevation is unset, not zero. Vertical fit and usable reach are not established.'));
    const band = result.band;
    const referenceBand = finite(point.elevationM) ? { minM: point.elevationM, maxM: point.elevationM } : null;
    if (!band) checks.push(finding('incomplete', 'unknown', 'plate-envelope-unknown', 'The full vertical device envelope is unknown. A reference point is not the whole plate or fixture.'));
    const anchor = point.anchor;
    if (anchor.kind !== 'wall') {
      if (!contains(scene.floor, anchor) || !contains(scene.building || scene.floor, anchor)) {
        checks.push(finding('geometry', 'conflict', 'surface-outside', 'The surface coordinate is outside the supplied floor/building footprint; it is not clamped.'));
        return result;
      }
      const room = list(scene.rooms).find(item => item.id === point.roomId);
      if (!room || !contains(room.rect, anchor)) {
        checks.push(finding('incomplete', 'unknown', 'surface-room-unknown', 'Choose a room containing this surface point; a ceiling or floor surface here is not established.'));
        return result;
      }
      const surfaceHeight = anchor.kind === 'floor' ? 0 : scene.wallHeightM;
      if (finite(point.elevationM) && finite(surfaceHeight) && Math.abs(point.elevationM - surfaceHeight) > EPS) {
        checks.push(finding('geometry', 'conflict', 'surface-height-mismatch', `This ${anchor.kind} mounting point must match its supplied surface elevation (${format(surfaceHeight)} m above finished floor). No value is changed automatically.`));
        return result;
      }
      if (!finite(surfaceHeight) || !finite(point.elevationM)) {
        checks.push(finding('incomplete', 'unknown', 'surface-height-unknown', 'The mounting surface elevation has not been confirmed; no supported surface icon is drawn.'));
        return result;
      }
      result.status = 'located';
      result.drawable = true;
      result.position = { x: anchor.x, y: anchor.y, z: finite(scene.floorElevationM) ? scene.floorElevationM + point.elevationM : null };
      checks.push(finding('incomplete', 'unknown', 'surface-construction-review', 'The room outline supplies a conceptual surface only; slab openings, fixture support and construction need confirmation.'));
      return result;
    }
    const mapping = mapWallAnchor(anchor, scene);
    result.mapping = mapping;
    const wall = mapping.wall, mapped = mapping.anchor;
    if (!wall) {
      checks.push(finding('geometry', 'conflict', 'orphan-wall', mapping.mapping === 'ambiguous-lineage' ?
        'More than one explicit wall lineage matches. Choose a host; none was selected automatically.' :
        'The host wall is missing or removed. This is an orphan draft, not a floating valid point. Rehost or delete it explicitly.'));
      return result;
    }
    const size = length(wall);
    const halfWidth = finite(point.envelope?.widthM) ? point.envelope.widthM / 2 : 0;
    if (!finite(size) || size <= EPS || mapped.offsetM < 0 || mapped.offsetM > size || mapped.offsetM - halfWidth < 0 || mapped.offsetM + halfWidth > size) {
      checks.push(finding('geometry', 'conflict', 'offset-out-of-range', 'The offset or entered plate width extends beyond the actual wall. It is retained for review, never clamped.'));
      return result;
    }
    if (!finite(wall.thicknessM) || wall.thicknessM <= 0) {
      checks.push(finding('incomplete', 'unknown', 'wall-face-unknown', 'Wall thickness is unknown, so the actual wall face cannot be located.'));
      return result;
    }
    const relativeBase = finite(wall.baseM) && finite(scene.floorElevationM) ? wall.baseM - scene.floorElevationM : null;
    if (relativeBase === null || !finite(wall.heightM) || wall.heightM <= 0) {
      checks.push(finding('incomplete', 'unknown', 'wall-height-unknown', 'The wall base/height is unknown. Vertical wall support needs review.'));
    } else if (referenceBand && ((band || referenceBand).minM < relativeBase - EPS || (band || referenceBand).maxM > relativeBase + wall.heightM + EPS)) {
      checks.push(finding('geometry', 'conflict', 'elevation-out-of-range', 'The elevation or full plate envelope is outside this wall’s vertical extent. It is not clamped.'));
      return result;
    }
    const exactSections = wall.solidSections !== undefined;
    if (!Array.isArray(wall.solidSegments) && !exactSections) {
      checks.push(finding('incomplete', 'unknown', 'solid-wall-unknown', 'Surviving wall segments are not supplied; the host is not assumed solid.'));
      return result;
    }
    const start = mapped.offsetM - halfWidth, end = mapped.offsetM + halfWidth;
    const support = list(wall.solidSegments).slice();
    let unknownAperture = false;
    for (const opening of openingsFor(scene, wall)) {
      if (!finite(opening.offsetM) || !finite(opening.widthM)) {
        unknownAperture = true;
        continue;
      }
      if (end < opening.offsetM - EPS || start > opening.offsetM + opening.widthM + EPS) continue;
      const aperture = finite(opening.sillM) && finite(opening.heightM) && opening.heightM > 0 ?
        { minM: opening.sillM, maxM: opening.sillM + opening.heightM } : null;
      const overlap = verticalOverlap(band || referenceBand, aperture);
      if (overlap === true) {
        checks.push(finding('geometry', 'conflict', 'aperture-overlap', `The ${opening.kind || 'opening'} overlaps this point’s ${band ? 'vertical envelope' : 'reference height'}. No supported wall icon is drawn.`));
        return result;
      }
      if (overlap === false) {
        support.push({ startM: opening.offsetM, endM: opening.offsetM + opening.widthM });
        checks.push(finding(band ? 'geometry' : 'incomplete', band ? 'clear' : 'unknown', 'aperture-vertical-separation',
          band ? `The supplied device band does not overlap the ${opening.kind} aperture vertically. Plan overlap alone is not a collision.` :
            `The reference height is outside the ${opening.kind} aperture, but the whole plate envelope remains unknown.`));
      } else unknownAperture = true;
    }
    if (unknownAperture) {
      checks.push(finding('incomplete', 'unknown', 'aperture-band-unknown', 'A relevant aperture or mounting height is incomplete; wall material at this elevation is not established.'));
      return result;
    }
    const supportBand = band || referenceBand || (finite(relativeBase) && finite(wall.heightM) ?
      { minM: relativeBase, maxM: relativeBase + wall.heightM } : null);
    const exactSupport = exactSections ? solidSectionsCover(wall.solidSections, start, end, supportBand) : null;
    if (exactSections && exactSupport !== true) {
      const incomplete = exactSupport === null || !referenceBand;
      checks.push(finding(incomplete ? 'incomplete' : 'geometry', incomplete ? 'unknown' : 'conflict',
        incomplete ? 'solid-sections-unknown' : 'solid-section-gap',
        incomplete ? 'The exact solid wall sections or mounting height do not establish support. A full-height column is required to locate an unset-height reference.' :
          'The supplied exact solid wall sections do not support the full entered device band/width here. No infill is invented from another aperture.'));
      return result;
    }
    if (!exactSections && !covers(support, start, end)) {
      checks.push(finding('geometry', 'conflict', 'open-wall-segment', 'This offset lies on an open or unsupported wall segment. The point remains an orphan draft.'));
      return result;
    }
    const centre = wallPoint(wall, mapped.offsetM, model), frame = wallFrame(wall, mapped.face);
    result.position = {
      x: centre.x + frame.normal.x * wall.thicknessM / 2,
      y: centre.y + frame.normal.y * wall.thicknessM / 2,
      z: finite(point.elevationM) && finite(scene.floorElevationM) ? scene.floorElevationM + point.elevationM : null
    };
    result.frame = frame;
    result.status = 'located';
    result.drawable = true;
    if (!finite(point.envelope?.widthM)) checks.push(finding('incomplete', 'unknown', 'plate-width-unknown', 'Plate width is unset; along-wall fit is checked only at the reference point.'));
    if (mapping.mapping !== 'identity') checks.push(finding('geometry', 'clear', 'anchor-remapped', `The anchor is resolved by ${mapping.mapping}; this read-only mapping has not edited the saved point.`));
    const room = list(scene.rooms).find(item => item.id === point.roomId);
    if (!room) checks.push(finding('incomplete', 'unknown', 'room-unknown', 'The associated room is missing or unassigned; intended approach and wet-area context are unknown.'));
    else {
      const mid = { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
      if ((mid.x - centre.x) * frame.normal.x + (mid.y - centre.y) * frame.normal.y < -EPS) {
        checks.push(finding('ergonomic', 'warning', 'room-face-mismatch', 'The chosen wall face points away from the associated room. Confirm which side should serve the device.'));
      }
    }
    return result;
  }

  function rectanglePolygon(rect) {
    return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
      if (Math.abs(cross) <= EPS && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS &&
        point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function polygonsOverlap(a, b) {
    if (!a?.length || !b?.length) return false;
    for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const normal = { x: q.y - p.y, y: p.x - q.x };
      const pa = a.map(value => value.x * normal.x + value.y * normal.y);
      const pb = b.map(value => value.x * normal.x + value.y * normal.y);
      if (Math.max(...pa) < Math.min(...pb) - EPS || Math.max(...pb) < Math.min(...pa) - EPS) return false;
    }
    return true;
  }

  function faceRectangle(position, frame, widthM, depthM) {
    if (!xy(position) || !frame || !finite(widthM) || widthM <= 0 || !finite(depthM) || depthM <= 0) return null;
    return [[-widthM / 2, 0], [widthM / 2, 0], [widthM / 2, depthM], [-widthM / 2, depthM]].map(([along, away]) => ({
      x: position.x + frame.tangent.x * along + frame.normal.x * away,
      y: position.y + frame.tangent.y * along + frame.normal.y * away
    }));
  }

  function headboardRect(furniture, depthM) {
    if (!rectValid(furniture?.rect) || !finite(depthM) || depthM <= 0) return null;
    const r = furniture.rect;
    if (['N', 'S'].includes(furniture.headLocal) && depthM <= r.h) return { x: r.x, y: furniture.headLocal === 'N' ? r.y : r.y + r.h - depthM, w: r.w, h: depthM };
    if (['E', 'W'].includes(furniture.headLocal) && depthM <= r.w) return { x: furniture.headLocal === 'W' ? r.x : r.x + r.w - depthM, y: r.y, w: depthM, h: r.h };
    return null;
  }

  function sectorContains(point, geometry) {
    if (!xy(point) || !xy(geometry?.hinge) || !xy(geometry.closedEnd) || !xy(geometry.openEnd) || !finite(geometry.radiusM) || geometry.radiusM <= 0 ||
      ![0, 1].includes(geometry.arcSweep) || Math.hypot(geometry.closedEnd.x - geometry.hinge.x, geometry.closedEnd.y - geometry.hinge.y) <= EPS ||
      Math.hypot(geometry.openEnd.x - geometry.hinge.x, geometry.openEnd.y - geometry.hinge.y) <= EPS) return null;
    const h = geometry.hinge, dx = point.x - h.x, dy = point.y - h.y;
    if (Math.hypot(dx, dy) > geometry.radiusM + EPS) return false;
    if (Math.hypot(dx, dy) <= EPS) return true;
    const tau = 2 * Math.PI, norm = angle => ((angle % tau) + tau) % tau;
    const begin = Math.atan2(geometry.closedEnd.y - h.y, geometry.closedEnd.x - h.x);
    const end = Math.atan2(geometry.openEnd.y - h.y, geometry.openEnd.x - h.x);
    const angle = Math.atan2(dy, dx), sign = geometry.arcSweep === 1 ? 1 : -1;
    return norm(sign * (angle - begin)) <= norm(sign * (end - begin)) + EPS;
  }

  function sectorTouchesPolygon(geometry, polygon) {
    if (!polygon?.length || sectorContains(polygon[0], geometry) === null) return null;
    if (polygon.some(point => sectorContains(point, geometry)) || pointInPolygon(geometry.hinge, polygon) ||
      pointInPolygon(geometry.closedEnd, polygon) || pointInPolygon(geometry.openEnd, polygon)) return true;
    const h = geometry.hinge;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const dx = b.x - a.x, dy = b.y - a.y, x = a.x - h.x, y = a.y - h.y;
      const aa = dx * dx + dy * dy, bb = 2 * (x * dx + y * dy), cc = x * x + y * y - geometry.radiusM * geometry.radiusM;
      const disc = bb * bb - 4 * aa * cc;
      if (aa > EPS && disc >= 0) for (const t of [(-bb - Math.sqrt(disc)) / (2 * aa), (-bb + Math.sqrt(disc)) / (2 * aa)]) {
        if (t >= 0 && t <= 1 && sectorContains({ x: a.x + t * dx, y: a.y + t * dy }, geometry)) return true;
      }
      for (const end of [geometry.closedEnd, geometry.openEnd]) {
        const ux = end.x - h.x, uy = end.y - h.y, divisor = dx * uy - dy * ux;
        if (Math.abs(divisor) <= EPS) continue;
        const t = ((h.x - a.x) * uy - (h.y - a.y) * ux) / divisor;
        const u = ((h.x - a.x) * dy - (h.y - a.y) * dx) / divisor;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
      }
    }
    return false;
  }

  function geometryFingerprint(scene) {
    if (!scene) return 'no-scene';
    return JSON.stringify({
      floorId: scene.floorId, floor: scene.floor, building: scene.building, floorElevationM: scene.floorElevationM, wallHeightM: scene.wallHeightM,
      rooms: list(scene.rooms).map(({ id, rect, type }) => ({ id, rect, type })),
      walls: list(scene.walls).map(({ id, start, end, thicknessM, heightM, baseM, removed, solidSegments, solidSections, roomIds, openings }) =>
        ({ id, start, end, thicknessM, heightM, baseM, removed, solidSegments, solidSections, roomIds, openings })),
      openings: scene.openings, wallLineage: scene.wallLineage,
      furniture: list(scene.furniture).map(({ id, roomId, type, rect, headLocal, baseM, heightM, headboard }) => ({ id, roomId, type, rect, headLocal, baseM, heightM, headboard }))
    });
  }

  function reviewPoint(point, scene, model) {
    const resolved = resolveAnchor(point, scene, model), checks = resolved.checks.slice();
    const inputs = point?.inputs || {}, room = list(scene?.rooms).find(item => item.id === point?.roomId);
    const wetRoom = /bath|toilet|shower|washroom|wet.?room|\bwc\b/i.test(`${room?.type || ''} ${room?.label || ''}`);
    if (wetRoom || inputs.wetArea !== 'dry') checks.push(finding('professional', 'review', 'wet-area-review', wetRoom || inputs.wetArea === 'wet' ?
      'Bathroom/wet-area placement requires qualified professional review. Fixtures, zones, protection and local rules are not established here.' :
      'Wet-area context is unknown. Have a qualified professional review fixtures, water exposure and applicable requirements; Unknown is not Dry.'));
    else checks.push(finding('professional', 'review', 'dry-area-assumption', 'Dry area is your explicit assumption, not a verified electrical-safety classification.'));
    if (point?.loadCategory === 'high' || point?.type === 'appliance') checks.push(finding('professional', 'review', 'circuit-protection-review',
      'Appliance/high-load intent needs qualified circuit, protection, isolation and service-access review. No breaker, cable or electrical rating is assigned.'));
    if (point?.loadCategory === 'unknown') checks.push(finding('incomplete', 'unknown', 'load-unknown', 'Intended load category is unknown; device requirements must be supplied, not inferred from this symbol.'));
    if (point?.type === 'light') checks.push(finding('incomplete', 'unknown', 'lighting-unknown', 'A light point does not establish illuminance, glare, fixture support or lighting adequacy.'));
    if (!finite(point?.elevationM) || !finite(inputs.reachMinM) || !finite(inputs.reachMaxM) || point.elevationReference !== 'operable-part-centre') {
      checks.push(finding('incomplete', 'unknown', 'reach-unknown', 'Operable reach is not evaluated: enter an operable-part datum, actual height and your own contextual reach interval. There is no universal India preset.'));
    } else checks.push(finding('ergonomic', point.elevationM < inputs.reachMinM || point.elevationM > inputs.reachMaxM ? 'warning' : 'clear', 'chosen-reach-interval',
      `Operable reference height ${format(point.elevationM)} m is ${point.elevationM < inputs.reachMinM || point.elevationM > inputs.reachMaxM ? 'outside' : 'within'} your chosen ${format(inputs.reachMinM)}–${format(inputs.reachMaxM)} m interval. This is not a standards or approach-space pass.`));
    if (point?.origin?.kind === 'suggestion' && point.origin.geometryFingerprint !== geometryFingerprint(scene)) checks.push(finding('ergonomic', 'warning', 'suggestion-stale',
      'Geometry has changed since this suggestion was accepted (including bed head, door or wall state). Reassess it; the accepted point has not moved with furniture.'));
    const approach = resolved.drawable ? faceRectangle(resolved.position, resolved.frame, inputs.approachWidthM, inputs.approachDepthM) : null;
    const envelope = resolved.drawable ? faceRectangle(resolved.position, resolved.frame, point.envelope?.widthM, point.envelope?.depthM) : null;
    if (!approach) checks.push(finding('incomplete', 'unknown', 'approach-unknown', 'A usable approach has not been established. Enter a contextual approach width/depth on a supported wall face; height alone cannot pass accessibility.'));
    else {
      const obstructing = list(scene?.furniture).filter(item => rectValid(item.rect) && polygonsOverlap(approach, rectanglePolygon(item.rect)));
      checks.push(finding('ergonomic', obstructing.length ? 'warning' : 'clear', 'approach-footprints', obstructing.length ?
        `Your approach footprint intersects: ${obstructing.map(item => item.label || item.type || item.id).join(', ')}. Actual knee/under-furniture clearance is not established.` :
        'No supplied furniture footprint intersects your chosen approach rectangle. This does not establish a usable walking route or knee clearance.'));
      checks.push(finding('incomplete', 'unknown', 'approach-route-unknown', 'Continuous access routes, user reach, cabinetry motion and knee space are not supplied; full approach usability remains unassessed.'));
    }
    if (resolved.drawable) {
      for (const furniture of list(scene?.furniture).filter(item => rectValid(item.rect))) {
        const hit = envelope ? polygonsOverlap(envelope, rectanglePolygon(furniture.rect)) : contains(furniture.rect, resolved.position);
        const related = furniture.id === inputs.furnitureId;
        const base = related && finite(inputs.furnitureBaseM) ? inputs.furnitureBaseM : furniture.baseM;
        const height = related && finite(inputs.furnitureHeightM) ? inputs.furnitureHeightM : furniture.heightM;
        const furnitureBand = finite(base) && finite(height) ? { minM: base, maxM: base + height } : null;
        if (hit) {
          const overlap = verticalOverlap(resolved.band, furnitureBand);
          checks.push(finding(overlap === null ? 'incomplete' : 'ergonomic', overlap === null ? 'unknown' : overlap ? 'warning' : 'clear',
            /counter|worktop/i.test(`${furniture.type} ${furniture.label}`) ? 'counter-envelope' : 'furniture-envelope',
            `${furniture.label || furniture.type || 'Furniture'} overlaps in plan. ${overlap === null ? 'Its actual base/height or the full device envelope is missing; vertical obstruction is not evaluated.' :
              overlap ? 'The supplied vertical envelopes overlap; check obstruction and access.' : 'The supplied vertical envelopes do not overlap; reach over/around it still needs review.'}`));
        }
        if (/bed/i.test(furniture.type || '') && (related || hit || (approach && polygonsOverlap(approach, rectanglePolygon(furniture.rect))))) {
          const head = headboardRect(furniture, (related ? inputs.headboardDepthM : null) ?? furniture.headboard?.depthM);
          const hbBase = (related ? inputs.headboardBaseM : null) ?? furniture.headboard?.baseM;
          const hbHeight = (related ? inputs.headboardHeightM : null) ?? furniture.headboard?.heightM;
          const headBand = finite(hbBase) && finite(hbHeight) ? { minM: hbBase, maxM: hbBase + hbHeight } : null;
          const overlap = verticalOverlap(resolved.band, headBand);
          if (!head || overlap === null || !envelope) checks.push(finding('incomplete', 'unknown', 'headboard-unknown',
            'Headboard obstruction is incomplete: actual N/E/S/W head, headboard depth/base/height and full device envelope are required.'));
          else {
            const blocked = polygonsOverlap(envelope, rectanglePolygon(head)) && overlap;
            checks.push(finding('ergonomic', blocked ? 'warning' : 'clear', 'headboard-overlap', blocked ?
              `The supplied headboard at the actual ${furniture.headLocal} head end overlaps this device envelope.` :
              `No overlap with the supplied headboard envelope at the actual ${furniture.headLocal} head end. Bedside functional reach is still unverified.`));
          }
        }
      }
      if (!envelope) checks.push(finding('incomplete', 'unknown', point.anchor.kind === 'wall' ? 'plug-envelope-unknown' : 'surface-envelope-unknown',
        point.anchor.kind === 'wall' ? 'Plate/plug width and projection depth are incomplete; furniture clearance is not fully evaluated.' :
          'The full surface-fixture footprint is not established. Reference-point comparisons do not prove furniture clearance.'));
      if (inputs.furnitureId && !list(scene?.furniture).some(item => item.id === inputs.furnitureId)) checks.push(finding('incomplete', 'unknown', 'related-furniture-missing', 'The associated furniture is missing. Its measurements and access assumptions need review.'));
      const doors = list(scene?.openings).filter(item => item.kind === 'hinged');
      for (const door of doors) {
        const wall = list(scene?.walls).find(item => item.id === door.wallId && !item.removed);
        let geometry = null;
        if (wall && ['start', 'end'].includes(door.hinge) && ['left', 'right'].includes(door.swing) && typeof model?.doorGeometry === 'function') {
          try { geometry = model.doorGeometry(door, wall); } catch (_) { /* Missing shared geometry is an incomplete check, not a pass. */ }
        }
        if (!geometry || sectorContains(resolved.position, geometry) === null) {
          if (!point.roomId || door.roomId === point.roomId || door.targetRoomId === point.roomId || door.wallId === resolved.mapping?.wall?.id) {
            checks.push(finding('incomplete', 'unknown', 'door-swing-unknown', 'A relevant door’s hinge/swing geometry is incomplete; its sweep and latch approach are not evaluated.'));
          }
          continue;
        }
        const pointHit = envelope ? sectorTouchesPolygon(geometry, envelope) : sectorContains(resolved.position, geometry);
        const approachHit = approach ? sectorTouchesPolygon(geometry, approach) : false;
        const overlap = verticalOverlap(resolved.band, finite(door.sillM) && finite(door.heightM) ? { minM: door.sillM, maxM: door.sillM + door.heightM } : null);
        if (pointHit || approachHit) checks.push(finding(overlap === null && !approachHit ? 'incomplete' : 'ergonomic', overlap === null && !approachHit ? 'unknown' : 'warning', 'door-swing-overlap',
          approachHit ? 'Your chosen approach rectangle intersects a supplied door sweep. Recheck latch-side access and operating position.' :
            overlap === null ? 'The door sweep overlaps in plan, but device/door vertical data are incomplete; obstruction is not established.' :
              overlap ? 'The supplied door sweep and device vertical envelope overlap. Check door-leaf obstruction.' :
                'The device is vertically separated from the supplied door leaf, but door-operation access still needs review.'));
      }
    }
    const status = !resolved.drawable ? 'draft' : checks.some(item => item.status === 'conflict' || item.status === 'warning') ? 'conflict / review' : 'needs review';
    return { ...resolved, status, checks, approach, envelope };
  }

  function pointId(floorId, suffix) {
    if (!floorId || typeof floorId !== 'string' || !suffix || typeof suffix !== 'string') throw new Error('A floor and unique point suffix are required.');
    return `${floorId}:electrical:${suffix}`;
  }

  function savePoint(planner, point, model) {
    const project = planner.getProject(), scene = planner.getScene(), existing = list(project.electrical).find(item => item.id === point.id);
    const errors = validatePoint(point, project.activeFloorId);
    if (errors.length) throw new Error(errors.join(' '));
    if (!scene || scene.floorId !== project.activeFloorId) throw new Error('A valid active-floor scene is required to save a point.');
    const resolved = resolveAnchor(point, scene, model);
    const mountState = item => [item.anchor, item.elevationM ?? null, item.elevationReference, item.roomId || null,
      ...['widthM', 'heightM', 'depthM', 'referenceOffsetM'].map(key => item.envelope?.[key] ?? null)];
    const unchangedMount = existing && JSON.stringify(mountState(existing)) === JSON.stringify(mountState(point));
    if (!resolved.drawable && !unchangedMount) throw new Error((resolved.checks.find(item => item.status === 'conflict') ||
      resolved.checks.find(item => item.status === 'unknown'))?.message || 'Choose a supported physical host.');
    if (list(project.electrical).filter(item => item.id === point.id).length > 1) throw new Error('Duplicate imported point IDs need repair before editing.');
    const points = existing ? project.electrical.map(item => item.id === point.id ? copy(point) : item) : [...list(project.electrical), copy(point)];
    planner.execute({ type: 'set-electrical', value: points });
    planner.select({ kind: 'electrical', id: point.id });
    return point;
  }

  function deletePoint(planner, id) {
    const project = planner.getProject();
    if (!list(project.electrical).some(item => item.id === id)) throw new Error('This point no longer exists.');
    planner.execute({ type: 'set-electrical', value: project.electrical.filter(item => item.id !== id) });
    if (planner.getSelection()?.kind === 'electrical' && planner.getSelection().id === id) planner.select(null);
  }

  function faceForRoom(wall, room) {
    if (!rectValid(room?.rect)) return null;
    const frame = wallFrame(wall, 'left');
    if (!frame) return null;
    const dx = room.rect.x + room.rect.w / 2 - wall.start.x, dy = room.rect.y + room.rect.h / 2 - wall.start.y;
    return dx * frame.normal.x + dy * frame.normal.y >= 0 ? 'left' : 'right';
  }

  function suggestPoints(scene, request, model) {
    if (!scene?.floorId) throw new Error('Choose a valid active-floor layout first.');
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > 32) throw new Error('Request 1–32 points per preview, based on your actual devices, not room area.');
    if (!finite(request.gapM) || request.gapM <= 0) throw new Error('Enter your own positive positioning gap in metres; no standard setback is assumed.');
    if (!['bedside', 'door-latch', 'passage', 'desk'].includes(request.kind)) throw new Error('Choose a suggestion context.');
    if (!Object.hasOwn(TYPES, request.type) || !request.purpose?.trim()) throw new Error('Specify the point type and device need.');
    const room = list(scene.rooms).find(item => item.id === request.roomId);
    if (!room || !rectValid(room.rect)) throw new Error('Choose the room the points should serve.');
    if (/bath|toilet|shower|washroom|\bwc\b/i.test(`${room.type} ${room.label}`)) throw new Error('Automatic bathroom/wet-room suggestions are disabled. Use manual annotations with qualified wet-area review.');
    const fingerprint = geometryFingerprint(scene), candidates = [], messages = [], used = new Set();
    const target = ['bedside', 'desk'].includes(request.kind) ? list(scene.furniture).find(item => item.id === request.targetId && item.roomId === room.id) :
      list(scene.openings).find(item => item.id === request.targetId && (item.roomId === room.id || item.targetRoomId === room.id));
    if (!target) throw new Error('Choose an existing contextual furniture item or opening in this room.');
    if (request.kind === 'bedside' && (!/bed/i.test(target.type || '') || !['N', 'E', 'S', 'W'].includes(target.headLocal))) throw new Error('Bedside suggestions require an actual bed with a known N/E/S/W head end.');
    if (['bedside', 'desk'].includes(request.kind) && !rectValid(target.rect)) throw new Error('The selected furniture footprint is incomplete.');
    if (request.kind === 'door-latch' && (target.kind !== 'hinged' || !['start', 'end'].includes(target.hinge) || !['left', 'right'].includes(target.swing))) throw new Error('Latch-side suggestions require a real hinged door with known hinge/swing. A permanent portal has no latch.');
    if (request.kind === 'passage' && target.kind !== 'passage') throw new Error('Choose a permanent passage, not an operable door or window.');
    const host = list(scene.walls).find(wall => wall.id === target.wallId);
    let latch = null;
    if (request.kind === 'door-latch') {
      if (!host || host.removed || typeof model?.doorGeometry !== 'function') throw new Error('The actual door host and shared closed-leaf geometry are required; a latch position is not inferred.');
      const geometry = model.doorGeometry(target, host), frame = wallFrame(host, 'left');
      if (!frame || sectorContains(geometry?.hinge, geometry) !== true) throw new Error('The actual closed-leaf/latch geometry is incomplete; no door-control position is inferred.');
      const travel = (geometry.closedEnd.x - geometry.hinge.x) * frame.tangent.x + (geometry.closedEnd.y - geometry.hinge.y) * frame.tangent.y;
      const offLine = (geometry.closedEnd.x - host.start.x) * frame.normal.x + (geometry.closedEnd.y - host.start.y) * frame.normal.y;
      if (Math.abs(travel) <= EPS || Math.abs(offLine) > EPS) throw new Error('The supplied closed-leaf endpoint is not aligned with its wall. Review the door before suggesting a control.');
      latch = {
        offsetM: (geometry.closedEnd.x - host.start.x) * frame.tangent.x + (geometry.closedEnd.y - host.start.y) * frame.tangent.y,
        direction: Math.sign(travel)
      };
    }
    const walls = list(scene.walls).filter(wall => !wall.removed && list(wall.roomIds).includes(room.id) && length(wall) > EPS);
    const base = {
      version: 1, floorId: scene.floorId, roomId: room.id, type: request.type, purpose: request.purpose.trim(),
      loadCategory: request.loadCategory || 'unknown', elevationM: request.elevationM ?? null,
      elevationReference: request.elevationReference || 'plate-centre',
      envelope: { widthM: null, heightM: null, depthM: null, referenceOffsetM: null },
      inputs: { wetArea: request.wetArea || 'unknown', furnitureId: ['bedside', 'desk'].includes(request.kind) ? target.id : null },
      origin: { kind: 'suggestion', context: request.kind, targetId: target.id, geometryFingerprint: fingerprint, sourceIds: ['mohua-2021', 'product-heuristic'],
        assumptions: [`Positioning gap ${request.gapM} m is user chosen, not a national rule.`, 'Functional reach, approach and full device/furniture envelopes need review.'] }
    };
    for (let index = 0; index < request.count; index++) {
      const options = [], step = Math.floor(index / 2) + 1, side = index % 2 === 0 ? -1 : 1;
      let aim;
      if (request.kind === 'bedside') {
        const r = target.rect, gap = step * request.gapM;
        aim = ['N', 'S'].includes(target.headLocal) ?
          { x: side < 0 ? r.x - gap : r.x + r.w + gap, y: target.headLocal === 'N' ? r.y : r.y + r.h } :
          { x: target.headLocal === 'W' ? r.x : r.x + r.w, y: side < 0 ? r.y - gap : r.y + r.h + gap };
      } else if (request.kind === 'desk') {
        const r = target.rect;
        aim = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      } else if (request.kind === 'passage') {
        if (!host || !finite(target.offsetM) || !finite(target.widthM)) throw new Error('Passage endpoints and their original wall geometry are required.');
        aim = wallPoint(host, side < 0 ? target.offsetM : target.offsetM + target.widthM, model);
      }
      for (const wall of request.kind === 'door-latch' ? [host].filter(Boolean) : walls) {
        if (wall.removed || !list(wall.roomIds).includes(room.id)) continue;
        const frame = wallFrame(wall, faceForRoom(wall, room));
        if (!frame) continue;
        let offset;
        if (request.kind === 'door-latch') {
          offset = latch.offsetM + latch.direction * (index + 1) * request.gapM;
        } else {
          offset = (aim.x - wall.start.x) * frame.tangent.x + (aim.y - wall.start.y) * frame.tangent.y;
          if (request.kind === 'desk') offset += (index - (request.count - 1) / 2) * request.gapM;
          if (request.kind === 'passage' && wall.id === host.id) offset += side * step * request.gapM;
        }
        if (!finite(offset) || offset < 0 || offset > length(wall)) continue;
        const point = { ...copy(base), id: pointId(scene.floorId, `preview-${index}`), label: `${request.purpose.trim()} ${index + 1}`,
          anchor: { kind: 'wall', wallId: wall.id, face: faceForRoom(wall, room), offsetM: offset, basis: basisFor(wall) } };
        const resolved = resolveAnchor(point, scene, model);
        if (!resolved.drawable) continue;
        const key = `${wall.id}|${point.anchor.face}|${offset.toFixed(8)}`;
        if (used.has(key)) continue;
        const distance = aim ? Math.hypot(resolved.position.x - aim.x, resolved.position.y - aim.y) : (index + 1) * request.gapM;
        options.push({ point, distance, key });
      }
      options.sort((a, b) => a.distance - b.distance || a.point.anchor.wallId.localeCompare(b.point.anchor.wallId));
      if (!options.length) {
        messages.push(`Need ${index + 1}: no unambiguous surviving wall face at the requested position/height. Change your inputs or place it manually; no offset was clamped.`);
        continue;
      }
      const chosen = options[0];
      used.add(chosen.key);
      const context = request.kind === 'bedside' ? `beside the actual ${target.headLocal} head end` : request.kind === 'door-latch' ? 'beyond the real closed-door latch end' :
        request.kind === 'passage' ? 'on a surviving wall near a permanent passage (no latch assumed)' : 'near the selected desk/counter footprint';
      const reason = `Candidate ${context}; ${format(chosen.distance)} m from the positioning target. This distance is not a proven functional reach.`;
      chosen.point.origin.reason = reason;
      candidates.push({ id: `proposal-${index}`, point: chosen.point, reason, geometryFingerprint: fingerprint,
        alternatives: options.slice(1, 3).map(option => ({ wallId: option.point.anchor.wallId, face: option.point.anchor.face, offsetM: option.point.anchor.offsetM, distanceM: option.distance })),
        review: reviewPoint(chosen.point, scene, model) });
    }
    return { candidates, requestedCount: request.count, messages, geometryFingerprint: fingerprint };
  }

  function acceptSuggestion(planner, candidate, suffix, model) {
    const scene = planner.getScene();
    if (!candidate || candidate.geometryFingerprint !== geometryFingerprint(scene)) throw new Error('This suggestion is stale. Preview again after wall, floor, door or furniture changes.');
    const point = { ...copy(candidate.point), id: pointId(scene.floorId, suffix) };
    savePoint(planner, point, model);
    return point;
  }

  function activePoints(project) {
    return list(project?.electrical).filter(point => !point.floorId || point.floorId === project.activeFloorId);
  }

  function anchorDescription(point, resolved) {
    const anchor = resolved?.mapping?.wall ? resolved.mapping.anchor : point?.anchor;
    if (anchor?.kind === 'wall') return `${anchor.wallId} · ${anchor.face || '?'} face · ${format(anchor.offsetM)} m from oriented start`;
    if (anchor?.kind === 'floor' || anchor?.kind === 'ceiling') return `${anchor.kind} · local (${format(anchor.x)}, ${format(anchor.y)}) m`;
    return 'Unresolved anchor';
  }

  function renderDiagram(scene, points, selectedId, options = {}) {
    if (!rectValid(scene?.floor)) return '<p class="elec-empty">No valid active-floor geometry. Saved points remain in the list and project.</p>';
    const floor = scene.floor, size = Math.max(floor.w, floor.h), margin = Math.max(0.4, size * 0.035);
    const radius = Math.max(0.12, size * 0.012), font = Math.max(0.16, size * 0.015);
    let body = `<rect class="elec-floor-outline" x="${floor.x}" y="${floor.y}" width="${floor.w}" height="${floor.h}"/>`;
    for (const room of list(scene.rooms).filter(item => rectValid(item.rect))) {
      const r = room.rect;
      body += `<rect class="elec-room-outline" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
        <text class="elec-room-name" x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="${font}" text-anchor="middle">${escape(room.label || room.type || room.id)}</text>`;
    }
    for (const wall of list(scene.walls).filter(item => !item.removed && length(item) > EPS)) {
      for (const segment of list(wall.solidSegments)) {
        if (![segment.startM, segment.endM].every(finite) || segment.startM < 0 || segment.endM > length(wall) || segment.endM < segment.startM) continue;
        const a = wallPoint(wall, segment.startM, options.model), b = wallPoint(wall, segment.endM, options.model);
        body += `<line class="elec-wall" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${finite(wall.thicknessM) ? Math.max(wall.thicknessM, 0.01) : 0.01}"/>`;
      }
      for (const opening of openingsFor(scene, wall)) {
        if (![opening.offsetM, opening.widthM].every(finite) || opening.offsetM < 0 || opening.widthM < 0 || opening.offsetM + opening.widthM > length(wall)) continue;
        const a = wallPoint(wall, opening.offsetM, options.model), b = wallPoint(wall, opening.offsetM + opening.widthM, options.model);
        body += `<line class="elec-opening ${opening.kind === 'window' ? 'elec-window' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${font * 0.22}"><title>${escape(opening.kind)} aperture; sill ${format(opening.sillM)} m, height ${format(opening.heightM)} m</title></line>`;
      }
    }
    let hidden = 0;
    for (const point of points) {
      const review = reviewPoint(point, scene, options.model);
      if (!review.drawable) { hidden++; continue; }
      if (options.showPoints === false) continue;
      const p = review.position, selected = selectedId === point.id;
      if (selected && review.approach) body += `<polygon class="elec-approach" points="${review.approach.map(v => `${v.x},${v.y}`).join(' ')}"><title>Your chosen approach footprint, not a certified access route</title></polygon>`;
      const label = `${point.label}, ${TYPES[point.type]}, ${review.status}, local ${format(p.x)}, ${format(p.y)} metres; elevation ${format(point.elevationM)} metres above finished floor`;
      const shape = point.type === 'socket' || point.type === 'data' ?
        `<rect x="${-radius}" y="${-radius}" width="${2 * radius}" height="${2 * radius}" rx="${point.type === 'data' ? radius * 0.4 : 0}"/>` :
        point.type === 'appliance' ? `<path d="M 0 ${-radius * 1.25} L ${radius * 1.25} 0 L 0 ${radius * 1.25} L ${-radius * 1.25} 0 Z"/>` :
          `<circle r="${radius}"/>`;
      body += `<g class="elec-point ${selected ? 'elec-selected' : ''}" data-elec-select="${escape(point.id)}" data-elec-focus="diagram" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${escape(label)}" transform="translate(${p.x} ${p.y})">
        <title>${escape(label)}</title>${selected ? `<circle class="elec-selection-ring" r="${radius * 1.65}"/>` : ''}
        ${shape}<text class="elec-symbol" text-anchor="middle" dominant-baseline="central" font-size="${radius * 1.35}">${SYMBOLS[point.type]}</text>
        <text class="elec-state-symbol" x="${radius * 1.35}" y="${-radius}" font-size="${radius * 1.25}">${review.status === 'needs review' ? '?' : '!'}</text>
      </g>`;
    }
    return `<svg class="elec-diagram" viewBox="${floor.x - margin} ${floor.y - margin} ${floor.w + 2 * margin} ${floor.h + 2 * margin}" role="group" aria-label="Active floor electrical plan. Local metre coordinates; named point buttons also appear in the list.">
      <title>Electrical point anchors on the actual active-floor wall faces and surfaces</title>${body}</svg>
      <p class="elec-caption">Local x →, y ↓; metres, not a geographic north arrow. Floor datum ${format(scene.floorElevationM)} m. ${hidden} unsupported draft${hidden === 1 ? '' : 's'} omitted from the diagram; review them in the named list. Dashed aperture lines are not solid hosts at every height.</p>`;
  }

  function renderPointList(points, scene, selection, model) {
    if (!points.length) return '<p class="elec-empty">No points on this floor. Add only the devices you need; quantities are not derived from room area.</p>';
    return `<ul class="elec-point-list">${points.map(point => {
      const review = reviewPoint(point, scene, model);
      return `<li><button type="button" data-elec-select="${escape(point.id)}" data-elec-focus="list" aria-pressed="${selection === point.id}">
        <strong>${escape(point.label || 'Unnamed imported point')}</strong>
        <span>${escape(TYPES[point.type] || 'Unknown type')} · ${escape(review.status)}</span>
        <span>${escape(anchorDescription(point, review))}</span></button></li>`;
    }).join('')}</ul>`;
  }

  function renderSchedule(points, scene, floorName, model) {
    return `<div class="elec-table-wrap" tabindex="0" role="region" aria-label="Electrical point schedule, horizontally scrollable">
      <table class="elec-schedule"><caption>${escape(floorName)} · ${points.length} user-requested point${points.length === 1 ? '' : 's'} · annotations, not a wiring schedule</caption>
        <thead><tr><th scope="col">Point / type</th><th scope="col">Device / qualitative load</th><th scope="col">Room / physical anchor</th><th scope="col">Height / datum</th><th scope="col">Review</th></tr></thead>
        <tbody>${points.length ? points.map(point => {
          const review = reviewPoint(point, scene, model), room = list(scene?.rooms).find(item => item.id === point.roomId);
          return `<tr><th scope="row"><button type="button" data-elec-select="${escape(point.id)}" data-elec-focus="schedule">${escape(point.label || 'Unnamed')}</button><span>${escape(TYPES[point.type] || 'Unknown')}</span></th>
            <td>${escape(point.purpose || 'Unknown')}<span>${escape(LOADS[point.loadCategory] || 'Unknown')}</span></td>
            <td>${escape(room?.label || room?.type || 'Room unknown')}<span>${escape(anchorDescription(point, review))}</span></td>
            <td>${point.elevationM == null ? 'Unset — not zero' : `${format(point.elevationM)} m above finished floor`}<span>${escape(REFERENCES[point.elevationReference] || 'Datum unknown')}</span>
              <span>Absolute z: ${finite(review.position?.z) ? `${format(review.position.z)} m` : 'not established'}</span></td>
            <td>${escape(review.status)}<span>${review.checks.filter(item => item.status !== 'clear').length} review / missing-data finding(s)</span></td></tr>`;
        }).join('') : '<tr><td colspan="5">No points on this floor.</td></tr>'}</tbody>
      </table></div>`;
  }

  function optionList(entries, selected, emptyLabel) {
    const rows = emptyLabel == null ? [] : [[null, emptyLabel]];
    rows.push(...entries);
    if (selected != null && selected !== '' && !rows.some(([id]) => String(id ?? '') === String(selected))) rows.push([selected, `Missing / draft: ${selected}`]);
    return rows.map(([id, label]) => `<option value="${escape(id ?? '')}"${String(id ?? '') === String(selected ?? '') ? ' selected' : ''}>${escape(label)}</option>`).join('');
  }

  function inputField(prefix, label, name, value, settings = {}) {
    const id = `${prefix}-${name}`, help = settings.help ? `<small id="${id}-help">${escape(settings.help)}</small>` : '';
    const attributes = `id="${id}" name="${name}"${settings.required ? ' required' : ''}${settings.help ? ` aria-describedby="${id}-help"` : ''}`;
    let control;
    if (settings.entries) control = `<select ${attributes}>${optionList(settings.entries, value, settings.empty)}</select>`;
    else if (settings.textarea) control = `<textarea ${attributes} rows="2">${escape(value || '')}</textarea>`;
    else control = `<input ${attributes} type="${settings.number ? 'number' : 'text'}" value="${escape(value ?? '')}"${settings.number ? ' step="any"' : ''}${settings.min != null ? ` min="${settings.min}"` : ''}>`;
    return `<div class="elec-field"><label for="${id}">${escape(label)}</label>${control}${help}</div>`;
  }

  function roomEntries(scene) {
    return list(scene?.rooms).map(room => [room.id, room.label || room.type || room.id]);
  }

  function wallEntries(scene, currentId) {
    return list(scene?.walls).filter(wall => !wall.removed || wall.id === currentId).map(wall => [
      wall.id,
      `${wall.removed ? 'REMOVED — draft · ' : ''}${list(wall.roomIds).map(id => list(scene.rooms).find(room => room.id === id)?.label || id).join(' / ') || wall.id} · ${format(length(wall))} m · ${wall.id}`
    ]);
  }

  function renderPointForm(point, scene) {
    const p = point || {}, resolved = point && scene ? mapWallAnchor(point.anchor, scene) : null;
    const anchor = p.anchor?.kind === 'wall' && resolved?.wall ? resolved.anchor : p.anchor || { kind: 'wall' };
    const envelope = p.envelope || {}, inputs = p.inputs || {};
    const field = (label, name, value, settings) => inputField('elec-point', label, name, value, settings);
    const num = (label, name, value, help) => field(label, name, value, { number: true, help });
    return `<fieldset class="elec-fieldset"><legend>${point ? `Edit ${escape(p.label || 'point')}` : 'Add one needed point'}</legend>
      <div class="elec-fields">
        ${field('Point name', 'label', p.label, { required: true })}
        ${field('Point type', 'type', p.type || 'socket', { entries: Object.entries(TYPES) })}
        ${field('Device / purpose you need', 'purpose', p.purpose, { required: true, help: 'Connection intent only. Each saved record is one requested point.' })}
        ${field('Qualitative load — not an electrical rating', 'loadCategory', p.loadCategory || 'unknown', { entries: Object.entries(LOADS) })}
        ${field('Room served', 'roomId', p.roomId, { entries: roomEntries(scene), empty: 'Unassigned — needs review' })}
        ${field('Physical mounting surface', 'anchorKind', anchor.kind, { entries: [['wall', 'Wall face'], ['ceiling', 'Ceiling — light only'], ['floor', 'Floor — light only']] })}
      </div>
      <div class="elec-fields" data-elec-wall-fields${anchor.kind !== 'wall' ? ' hidden' : ''}>
        ${field('Host wall', 'wallId', anchor.wallId, { entries: wallEntries(scene, anchor.wallId), empty: 'Choose an actual wall' })}
        ${field('Face looking from oriented start → end', 'face', anchor.face, { entries: [['left', 'Left in the local plan'], ['right', 'Right in the local plan']], empty: 'Choose the physical face' })}
        ${num('Along-wall offset (m)', 'offsetM', anchor.offsetM, 'Measured from the displayed oriented start. Invalid offsets are not clamped.')}
      </div>
      <p class="elec-hint" data-elec-wall-hint></p>
      <div class="elec-fields" data-elec-surface-fields${anchor.kind === 'wall' ? ' hidden' : ''}>
        ${num('Local x (m)', 'x', anchor.x, 'Same building-local metre frame as the room plan.')}
        ${num('Local y (m)', 'y', anchor.y, 'Choose a coordinate inside the selected room and floor.')}
      </div>
      <div class="elec-fields">
        ${num('Elevation above finished floor (m)', 'elevationM', p.elevationM, 'Blank means unknown, never zero. Surface lights need a confirmed mounting-surface height.')}
        ${field('Elevation reference datum', 'elevationReference', p.elevationReference || 'plate-centre', { entries: Object.entries(REFERENCES) })}
      </div>
      <div class="elec-actions">
        <button type="button" data-elec-action="height-ceiling">Use nominal ceiling height — my assumption</button>
        <button type="button" data-elec-action="height-floor">Use 0 m floor mounting point — my assumption</button>
      </div>
      <details class="elec-details"><summary>Plate / plug / fixture envelope (optional measured inputs)</summary>
        <p>Without these dimensions, checks concern a reference point only. Missing measurements never become a clearance pass.</p>
        <div class="elec-fields">
          ${num('Plate / fixture width along wall (m)', 'widthM', envelope.widthM)}
          ${num('Plate / fixture height (m)', 'heightM', envelope.heightM)}
          ${num('Projection from wall face, including plug (m)', 'depthM', envelope.depthM)}
          ${num('Datum above bottom of envelope (m)', 'referenceOffsetM', envelope.referenceOffsetM, 'Required for operable-part or mounting-point envelopes; not needed for plate centre/bottom.')}
        </div>
      </details>
      <details class="elec-details"><summary>Approach, furniture and wet-area review inputs</summary>
        <p>All dimensions below are your contextual measurements/assumptions, not a standards preset. Heights use this floor’s finished-floor datum.</p>
        <div class="elec-fields">
          ${field('Water / wet-area context', 'wetArea', inputs.wetArea || 'unknown', { entries: [['unknown', 'Unknown — professional review'], ['dry', 'Dry — explicit user assumption'], ['wet', 'Wet — professional review']] })}
          ${num('Your operable reach minimum (m)', 'reachMinM', inputs.reachMinM)}
          ${num('Your operable reach maximum (m)', 'reachMaxM', inputs.reachMaxM)}
          ${num('Your approach width (m)', 'approachWidthM', inputs.approachWidthM)}
          ${num('Your approach depth from face (m)', 'approachDepthM', inputs.approachDepthM)}
          ${field('Related furniture / headboard / counter', 'furnitureId', inputs.furnitureId, { entries: list(scene?.furniture).map(item => [item.id, item.label || item.type || item.id]), empty: 'None / unknown' })}
          ${num('Related furniture base above floor (m)', 'furnitureBaseM', inputs.furnitureBaseM)}
          ${num('Related furniture height above its base (m)', 'furnitureHeightM', inputs.furnitureHeightM)}
          ${num('Headboard base above floor (m)', 'headboardBaseM', inputs.headboardBaseM)}
          ${num('Headboard height above its base (m)', 'headboardHeightM', inputs.headboardHeightM)}
          ${num('Headboard depth inside bed footprint (m)', 'headboardDepthM', inputs.headboardDepthM)}
        </div>
      </details>
      ${field('Measurement / assumption / service-access notes', 'note', inputs.note, { textarea: true })}
      <p class="elec-hint" data-elec-stale-form hidden>Geometry changed while these fields were being edited. Reload fields and review the current wall orientation before saving.</p>
      <div class="elec-actions">
        <button class="elec-primary" type="submit"${!scene ? ' disabled' : ''}>${point ? 'Save point' : 'Add point'}</button>
        <button type="button" data-elec-action="reload">Reload fields</button>
        ${point ? '<button class="elec-danger" type="button" data-elec-action="delete">Delete selected point</button>' : ''}
      </div>
    </fieldset>`;
  }

  function controlText(form, name) {
    return String(form.elements.namedItem(name)?.value ?? '').trim();
  }

  function controlNumber(form, name) {
    const control = form.elements.namedItem(name), text = controlText(form, name);
    if (control?.validity?.badInput) throw new Error(`${name} must be a finite metre value, or blank.`);
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite; it will not be clamped.`);
    return value;
  }

  function readPointForm(form, scene, existing, suffix) {
    const kind = controlText(form, 'anchorKind'), id = controlText(form, 'wallId');
    const wall = list(scene.walls).find(item => item.id === id), face = controlText(form, 'face'), offsetM = kind === 'wall' ? controlNumber(form, 'offsetM') : null;
    let anchor;
    if (kind === 'wall') {
      const mapping = existing?.anchor?.kind === 'wall' ? mapWallAnchor(existing.anchor, scene) : null;
      const displayed = mapping?.wall ? mapping.anchor : existing?.anchor;
      const same = displayed?.kind === 'wall' && displayed.wallId === id && displayed.face === face && displayed.offsetM === offsetM;
      anchor = same ? copy(existing.anchor) : { kind, wallId: id, face, offsetM, ...(wall ? { basis: basisFor(wall) } : {}) };
    } else anchor = { kind, x: controlNumber(form, 'x'), y: controlNumber(form, 'y') };
    const envelope = { ...existing?.envelope }, inputs = { ...existing?.inputs };
    for (const key of ['widthM', 'heightM', 'depthM', 'referenceOffsetM']) envelope[key] = controlNumber(form, key);
    for (const key of ['reachMinM', 'reachMaxM', 'approachWidthM', 'approachDepthM', 'furnitureBaseM', 'furnitureHeightM', 'headboardBaseM', 'headboardHeightM', 'headboardDepthM']) inputs[key] = controlNumber(form, key);
    inputs.wetArea = controlText(form, 'wetArea') || 'unknown';
    inputs.furnitureId = controlText(form, 'furnitureId') || null;
    inputs.note = controlText(form, 'note');
    return {
      ...existing, version: 1, id: existing?.id || pointId(scene.floorId, suffix), floorId: scene.floorId,
      roomId: controlText(form, 'roomId') || null, label: controlText(form, 'label'), type: controlText(form, 'type'),
      purpose: controlText(form, 'purpose'), loadCategory: controlText(form, 'loadCategory'), anchor,
      elevationM: controlNumber(form, 'elevationM'), elevationReference: controlText(form, 'elevationReference'),
      envelope, inputs, origin: existing?.origin ? { ...existing.origin, manuallyEdited: true } : { kind: 'manual' }
    };
  }

  function renderSuggestionForm(scene) {
    const field = (label, name, value, settings) => inputField('elec-suggest', label, name, value, settings);
    return `<div class="elec-fields">
      ${field('Suggestion context', 'kind', 'bedside', { entries: [['bedside', 'Actual bed head end'], ['door-latch', 'Real hinged-door latch side'], ['passage', 'Surviving wall near permanent passage'], ['desk', 'Desk / counter access']] })}
      ${field('Room served', 'roomId', '', { entries: roomEntries(scene), empty: 'Choose a room', required: true })}
      ${field('Context object', 'targetId', '', { entries: [], empty: 'Choose room and context first', required: true })}
      ${field('Point type', 'type', 'socket', { entries: Object.entries(TYPES) })}
      ${field('Needed device / purpose', 'purpose', '', { required: true })}
      ${field('Number you need (1–32 per preview)', 'count', 1, { number: true, min: 1, required: true, help: 'This is your requested device count, not an area formula or minimum standard.' })}
      ${field('Your positioning gap / spacing (m)', 'gapM', '', { number: true, required: true, help: 'An explicit geometric assumption, not a prescribed corner or latch setback.' })}
      ${field('Elevation above finished floor (m)', 'elevationM', '', { number: true, help: 'Blank stays unknown. A window band may require a height before a supported candidate exists.' })}
      ${field('Elevation reference', 'elevationReference', 'plate-centre', { entries: Object.entries(REFERENCES) })}
      ${field('Qualitative load', 'loadCategory', 'unknown', { entries: Object.entries(LOADS) })}
    </div><button type="submit">Preview only — do not add points yet</button>`;
  }

  // The browser workspace owns only transient forms/proposals. HomePlanner is the sole point store.
  function mount(host, planner, model) {
    if (!host || !planner?.getProject || !planner?.getScene || !planner?.execute || !planner?.subscribe) throw new Error('The electrical workspace requires the shared HomePlanner API.');
    if (host.dataset.elecMounted) return host.elecWorkspace;
    const doc = host.ownerDocument, win = doc.defaultView;
    host.dataset.elecMounted = 'true';
    host.classList.add('elec-workspace');
    host.innerHTML = `<header class="elec-heading"><div><h2>Electrical point planning</h2>
      <p>Place and review connection intents on the active floor. This is not wiring design, electrical certification, a lighting calculation or an accessibility pass.</p></div></header>
      <div class="elec-toolbar">
        <label class="elec-floor-label" for="elec-active-floor">Active floor <select id="elec-active-floor" data-elec-floor></select></label>
        <span class="elec-floor-status" data-elec-floor-status></span>
        <div class="elec-actions"><button type="button" data-elec-action="new">New point</button><button type="button" data-elec-action="undo">Undo project edit</button><button type="button" data-elec-action="redo">Redo</button></div>
      </div>
      <p class="elec-notice">No universal India mounting-height preset is applied. Enter an actual height and its datum, or leave it explicitly unknown. Wet areas and appliance/high-load intents need qualified professional review.</p>
      <p class="elec-error" data-elec-error role="alert" hidden></p>
      <p class="elec-status" data-elec-status role="status" aria-live="polite"></p>
      <div class="elec-layout">
        <section class="elec-panel elec-plan-panel" aria-labelledby="elec-plan-title"><div class="elec-section-heading"><h3 id="elec-plan-title">Active-floor diagram</h3>
          <label class="elec-checkbox"><input type="checkbox" data-elec-show checked> Show point overlay</label></div>
          <div data-elec-diagram></div>
          <p class="elec-legend"><span>□ S Socket</span><span>○ W Switch</span><span>○ L Light</span><span>◇ A Appliance intent</span><span>▢ D Data</span><span>? Needs review</span><span>! Conflict / review</span><span>Unsupported drafts: list only</span></p>
        </section>
        <section class="elec-panel elec-list-panel" aria-labelledby="elec-list-title"><h3 id="elec-list-title">Named points</h3><div data-elec-list></div></section>
        <section class="elec-panel elec-editor-panel" aria-labelledby="elec-editor-title"><h3 id="elec-editor-title">Point fields</h3><form data-elec-form></form></section>
        <section class="elec-panel elec-review-panel" aria-labelledby="elec-review-title"><h3 id="elec-review-title">Selected point review</h3><div data-elec-review></div></section>
      </div>
      <section class="elec-panel" aria-labelledby="elec-suggestion-title"><details class="elec-details"><summary id="elec-suggestion-title">Optional, explainable placement suggestions</summary>
        <p>Preview and accept or reject each candidate. Accepted points stay on their physical wall when furniture moves. Changed geometry invalidates a preview; shared Undo reverses acceptance. No latch is invented for a permanent portal.</p>
        <form data-elec-suggest-form></form><div data-elec-proposals></div></details></section>
      <section class="elec-panel" aria-labelledby="elec-schedule-title"><h3 id="elec-schedule-title">Point schedule — active floor</h3><div data-elec-schedule></div></section>
      <p class="elec-footnote">Points and provenance use the shared project’s floor slices, Undo/Redo and JSON backups. Local IndexedDB saving follows the project’s explicit autosave opt-in; this panel does not start storage or network access.
      <a href="docs/electrical-planning.md">Sources, measurement meanings and limitations</a>.</p>`;
    const query = selector => host.querySelector(selector);
    const form = query('[data-elec-form]'), suggestionForm = query('[data-elec-suggest-form]');
    let floorSeen, formKey, pointSeen, geometrySeen, forceForm = true, disposed = false, proposals = [], proposalMessages = [];
    const suffix = () => win?.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const error = message => { const box = query('[data-elec-error]'); box.textContent = message || ''; box.hidden = !message; };
    const status = message => { query('[data-elec-status]').textContent = message; };
    const focusSnapshot = () => {
      const element = doc.activeElement;
      if (!element || !host.contains(element)) return null;
      return { id: element.id, pointId: element.dataset?.elecSelect, region: element.dataset?.elecFocus, action: element.dataset?.elecAction, proposal: element.dataset?.elecProposal,
        start: element.selectionStart, end: element.selectionEnd };
    };
    const restoreFocus = saved => {
      if (!saved) return;
      let element = saved.id ? doc.getElementById(saved.id) : null;
      if (!element && saved.pointId) {
        const points = [...host.querySelectorAll('[data-elec-select]')].filter(item => item.dataset.elecSelect === saved.pointId);
        element = points.find(item => item.dataset.elecFocus === saved.region) || points.find(item => item.dataset.elecFocus === 'list');
      }
      if (!element && saved.action) element = [...host.querySelectorAll('[data-elec-action]')].find(item => item.dataset.elecAction === saved.action && item.dataset.elecProposal === saved.proposal);
      if (!element || element.disabled) return;
      element.focus({ preventScroll: true });
      if (typeof saved.start === 'number' && (element.tagName === 'TEXTAREA' || ['text', 'search', 'url', 'tel', 'password'].includes(element.type))) element.setSelectionRange(saved.start, saved.end);
    };
    function updateFormHints(scene) {
      const kind = controlText(form, 'anchorKind');
      query('[data-elec-wall-fields]').hidden = kind !== 'wall';
      query('[data-elec-surface-fields]').hidden = kind === 'wall';
      const wall = list(scene?.walls).find(item => item.id === controlText(form, 'wallId'));
      query('[data-elec-wall-hint]').textContent = kind === 'wall' ? wall ?
        `Oriented start (${format(wall.start?.x)}, ${format(wall.start?.y)}) → end (${format(wall.end?.x)}, ${format(wall.end?.y)}) m; length ${format(length(wall))} m; thickness ${format(wall.thicknessM)} m. Left/right uses this local plan direction.` :
        'Select a physical host. Missing/removed walls remain drafts; changing selection never chooses a replacement.' :
        'Surface anchors are light mounting points, not fictional wall hosts. Confirm the nominal surface height explicitly.';
    }
    function updateSuggestionTargets(scene) {
      const kind = controlText(suggestionForm, 'kind'), roomId = controlText(suggestionForm, 'roomId'), target = suggestionForm.elements.namedItem('targetId');
      const entries = ['bedside', 'desk'].includes(kind) ?
        list(scene?.furniture).filter(item => item.roomId === roomId && (kind !== 'bedside' || /bed/i.test(item.type || ''))).map(item => [item.id, `${item.label || item.type} ${item.headLocal ? `· head ${item.headLocal}` : ''}`]) :
        list(scene?.openings).filter(item => (item.roomId === roomId || item.targetRoomId === roomId) && item.kind === (kind === 'passage' ? 'passage' : 'hinged')).map(item => [item.id, `${item.kind} · ${item.id}`]);
      target.innerHTML = optionList(entries, target.value, 'Choose the actual contextual object');
    }
    function renderProposals(scene) {
      query('[data-elec-proposals]').innerHTML = `${proposalMessages.length ? `<ul class="elec-findings">${proposalMessages.map(message => `<li>${escape(message)}</li>`).join('')}</ul>` : ''}
        ${proposals.length ? `<ol class="elec-proposals">${proposals.map(candidate => {
          const stale = candidate.geometryFingerprint !== geometryFingerprint(scene);
          return `<li><h4>${escape(candidate.point.label)}</h4><p>${escape(candidate.reason)}</p><p>${escape(anchorDescription(candidate.point))} · ${format(candidate.point.elevationM)} m above finished floor · ${escape(candidate.review.status)}</p>
            <p>${escape(candidate.point.origin.assumptions.join(' '))}</p>
            <p>${candidate.alternatives.length ? `Other candidate surfaces: ${candidate.alternatives.map(item => `${escape(item.wallId)} (${format(item.offsetM)} m, ${escape(item.face)})`).join('; ')}. Preview another arrangement or place it manually.` : 'No other supported candidate surface was found for this positioning target.'}</p>
            ${stale ? '<p class="elec-stale">Stale: geometry changed. Preview again; this candidate cannot be accepted.</p>' : ''}
            <div class="elec-actions"><button type="button" data-elec-action="accept" data-elec-proposal="${escape(candidate.id)}"${stale ? ' disabled' : ''}>Accept this point — still needs review</button>
            <button type="button" data-elec-action="reject" data-elec-proposal="${escape(candidate.id)}">Reject</button></div></li>`;
        }).join('')}</ol>` : '<p class="elec-hint">A preview does not edit the project. No unreviewed candidate is added automatically.</p>'}`;
    }
    function render() {
      if (disposed) return;
      const savedFocus = focusSnapshot(), project = planner.getProject();
      const suppliedScene = planner.getScene(), scene = suppliedScene?.floorId === project.activeFloorId ? suppliedScene : null;
      const points = activePoints(project), selection = planner.getSelection?.();
      const selected = selection?.kind === 'electrical' ? points.find(point => point.id === selection.id) : null;
      const floor = list(project.floors).find(item => item.id === project.activeFloorId);
      if (floorSeen !== project.activeFloorId) {
        proposals = []; proposalMessages = []; forceForm = true; error('');
        suggestionForm.innerHTML = renderSuggestionForm(scene);
        floorSeen = project.activeFloorId;
        status(`Editing ${floor?.name || floorSeen}. Other floors’ points remain in their project slices.`);
      }
      query('[data-elec-floor]').innerHTML = optionList(list(project.floors).map(item => [item.id, item.name || item.id]), project.activeFloorId);
      query('[data-elec-floor-status]').textContent = scene ? `${points.length} point(s) · finished-floor datum ${format(scene.floorElevationM)} m` : 'No valid active-floor scene — unsupported drafts remain saved.';
      query('[data-elec-action="undo"]').disabled = !planner.canUndo?.();
      query('[data-elec-action="redo"]').disabled = !planner.canRedo?.();
      query('[data-elec-diagram]').innerHTML = renderDiagram(scene, points, selected?.id, { model, showPoints: query('[data-elec-show]').checked });
      query('[data-elec-list]').innerHTML = renderPointList(points, scene, selected?.id, model);
      query('[data-elec-schedule]').innerHTML = renderSchedule(points, scene, floor?.name || project.activeFloorId, model);
      const key = `${project.activeFloorId}|${selected?.id || 'new'}`, signature = JSON.stringify(selected || null), geometry = geometryFingerprint(scene);
      if (forceForm || key !== formKey || signature !== pointSeen || (geometry !== geometrySeen && form.dataset.elecDirty !== 'true')) {
        const details = key === formKey ? [...form.querySelectorAll('details')].map(item => item.open) : [];
        form.innerHTML = renderPointForm(selected, scene);
        [...form.querySelectorAll('details')].forEach((item, index) => { item.open = !!details[index]; });
        form.dataset.elecPointId = selected?.id || '';
        form.dataset.elecDirty = 'false';
        form.dataset.elecGeometry = geometry;
        formKey = key; pointSeen = signature; geometrySeen = geometry; forceForm = false;
      }
      query('[data-elec-stale-form]').hidden = form.dataset.elecGeometry === geometry;
      updateFormHints(scene);
      updateSuggestionTargets(scene);
      if (selected) {
        const review = reviewPoint(selected, scene, model);
        query('[data-elec-review]').innerHTML = `<h4>${escape(selected.label || 'Unnamed point')} — ${escape(review.status)}</h4>
          <p>${escape(anchorDescription(selected, review))}</p>
          ${review.position ? `<p>Local face/surface coordinate: (${format(review.position.x)}, ${format(review.position.y)}) m. Absolute z: ${format(review.position.z)} m.</p>` : '<p>No supported marker is drawn. Explicitly rehost or retain/delete this reviewable draft.</p>'}
          <ul class="elec-findings">${review.checks.map(item => `<li class="elec-finding-${item.status === 'clear' ? 'specific' : 'review'}"><strong>${escape(item.category)} · ${escape(item.status)}</strong> ${escape(item.message)}</li>`).join('')}</ul>
          ${selected.origin?.kind === 'suggestion' ? `<details class="elec-details"><summary>Suggestion provenance</summary><p>${escape(selected.origin.reason || '')}</p><p>${escape(list(selected.origin.assumptions).join(' '))}</p><p>Sources: ${escape(list(selected.origin.sourceIds).join(', '))}. This is a product heuristic, not a prescribed placement rule.</p></details>` : ''}
          <p class="elec-hint">“Clear” applies only to the named supplied-geometry comparison. There is no overall electrical, wet-area or accessibility pass.</p>`;
      } else query('[data-elec-review]').innerHTML = '<p class="elec-empty">Select a named point or diagram symbol to review its actual anchor and missing inputs. Selection never edits the project.</p>';
      renderProposals(scene);
      restoreFocus(savedFocus);
    }
    function guarded(action) {
      error('');
      try { action(); } catch (failure) { error(failure?.message || String(failure)); }
    }
    function onClick(event) {
      const button = event.target.closest?.('[data-elec-select], [data-elec-action]');
      if (!button || !host.contains(button)) return;
      guarded(() => {
        if (button.dataset.elecSelect) { planner.select({ kind: 'electrical', id: button.dataset.elecSelect }); return; }
        const action = button.dataset.elecAction;
        if (action === 'new') { forceForm = true; planner.select(null); render(); status('New point: provide your needed device, actual host and measurement datum.'); }
        else if (action === 'reload') { forceForm = true; render(); status('Fields reloaded from the current project and geometry. Unsaved field edits were discarded.'); }
        else if (action === 'undo') { planner.undo(); status('Undid the last shared project edit.'); }
        else if (action === 'redo') { planner.redo(); status('Redid the shared project edit.'); }
        else if (action === 'delete') { deletePoint(planner, form.dataset.elecPointId); status('Point deleted. Shared Undo restores it.'); }
        else if (action === 'height-ceiling' || action === 'height-floor') {
          const scene = planner.getScene(), value = action === 'height-floor' ? 0 : scene?.wallHeightM;
          if (!finite(value)) throw new Error('The nominal ceiling height is unknown. Enter a measured mounting height instead.');
          form.elements.namedItem('elevationM').value = String(value);
          if (controlText(form, 'anchorKind') !== 'wall') form.elements.namedItem('elevationReference').value = 'mounting-point';
          const note = form.elements.namedItem('note');
          note.value = `${note.value ? `${note.value}\n` : ''}User assumption: ${action === 'height-floor' ? 'floor mounting point' : 'nominal ceiling height'} ${format(value)} m above finished floor; verify actual finished surface and datum.`;
          form.dataset.elecDirty = 'true';
          status('Height filled only by your explicit assumption action. Save to record it.');
        } else if (action === 'reject') {
          proposals = proposals.filter(candidate => candidate.id !== button.dataset.elecProposal);
          renderProposals(planner.getScene()); status('Candidate rejected. The project was not changed.');
        } else if (action === 'accept') {
          const candidate = proposals.find(item => item.id === button.dataset.elecProposal);
          acceptSuggestion(planner, candidate, suffix(), model);
          proposals = proposals.filter(item => item !== candidate);
          renderProposals(planner.getScene()); status('One candidate accepted as a point needing review. Shared Undo reverses this exact edit.');
        }
      });
    }
    function onChange(event) {
      if (event.target.matches?.('[data-elec-floor]')) guarded(() => {
        try { planner.execute({ type: 'select-floor', id: event.target.value }); } catch (failure) { render(); throw failure; }
      });
      else if (event.target.matches?.('[data-elec-show]')) render();
      else if (form.contains(event.target)) {
        form.dataset.elecDirty = 'true';
        if (event.target.name === 'anchorKind' && controlText(form, 'anchorKind') !== 'wall') form.elements.namedItem('elevationReference').value = 'mounting-point';
        updateFormHints(planner.getScene());
      } else if (suggestionForm.contains(event.target)) updateSuggestionTargets(planner.getScene());
    }
    function onInput(event) { if (form.contains(event.target)) form.dataset.elecDirty = 'true'; }
    function onKey(event) {
      const point = event.target.closest?.('g[data-elec-select]');
      if (point && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        guarded(() => planner.select({ kind: 'electrical', id: point.dataset.elecSelect }));
      }
    }
    function onSubmit(event) {
      if (event.target !== form && event.target !== suggestionForm) return;
      event.preventDefault();
      guarded(() => {
        const scene = planner.getScene(), project = planner.getProject();
        if (!scene || scene.floorId !== project.activeFloorId) throw new Error('A valid active-floor scene is required.');
        if (event.target === form) {
          if (form.dataset.elecGeometry !== geometryFingerprint(scene)) throw new Error('Geometry changed while editing. Reload fields and review the current physical host before saving.');
          const existing = list(project.electrical).find(point => point.id === form.dataset.elecPointId);
          if (form.dataset.elecPointId && !existing) throw new Error('The selected point was removed. Reload fields before saving.');
          const point = readPointForm(form, scene, existing, suffix());
          form.dataset.elecDirty = 'false';
          try { savePoint(planner, point, model); } catch (failure) { form.dataset.elecDirty = 'true'; throw failure; }
          status('Point saved to the active-floor project slice. Review missing inputs and use shared Undo if needed.');
        } else {
          const request = {};
          for (const key of ['kind', 'roomId', 'targetId', 'type', 'purpose', 'loadCategory', 'elevationReference']) request[key] = controlText(suggestionForm, key);
          for (const key of ['count', 'gapM', 'elevationM']) request[key] = controlNumber(suggestionForm, key);
          const preview = suggestPoints(scene, request, model);
          proposals = preview.candidates; proposalMessages = preview.messages;
          renderProposals(scene);
          status(`Preview only: ${proposals.length} candidate(s) for ${preview.requestedCount} user-requested device point(s). Nothing added yet.`);
        }
      });
    }
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    host.addEventListener('keydown', onKey);
    host.addEventListener('submit', onSubmit);
    const unsubscribe = planner.subscribe(render);
    const workspace = { render, destroy() {
      disposed = true; unsubscribe?.();
      for (const [name, handler] of [['click', onClick], ['change', onChange], ['input', onInput], ['keydown', onKey], ['submit', onSubmit]]) host.removeEventListener(name, handler);
      delete host.dataset.elecMounted; delete host.elecWorkspace; host.innerHTML = '';
    } };
    host.elecWorkspace = workspace;
    render();
    return workspace;
  }

  return { TYPES, REFERENCES, LOADS, wallPoint, wallFrame, verticalBand, verticalOverlap, solidSectionsCover, validatePoint, mapWallAnchor, resolveAnchor,
    headboardRect, sectorContains, sectorTouchesPolygon, geometryFingerprint, reviewPoint, pointId, savePoint, deletePoint,
    suggestPoints, acceptSuggestion, activePoints, renderDiagram, renderPointList, renderSchedule, renderPointForm, readPointForm, mount };
});
