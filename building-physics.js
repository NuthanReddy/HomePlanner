(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuildingPhysics = api;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const radians = Math.PI / 180;
  const rayEpsilon = 1e-7;

  function object(value, name) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
      throw new TypeError(name + ' must be an object.');
    }
    return value;
  }

  function keys(value, allowed, name) {
    object(value, name);
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw new TypeError(name + '.' + key + ' is not supported.');
    }
  }

  function array(value, name, nonempty) {
    if (!Array.isArray(value) || (nonempty && value.length === 0)) {
      throw new TypeError(name + ' must be ' + (nonempty ? 'a nonempty' : 'an') + ' array.');
    }
    return value;
  }

  function finite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(name + ' must be a finite number in the documented units.');
    }
    return value;
  }

  function positive(value, name) {
    finite(value, name);
    if (value <= 0) throw new RangeError(name + ' must be positive.');
    return value;
  }

  function nonnegative(value, name) {
    finite(value, name);
    if (value < 0) throw new RangeError(name + ' must be nonnegative.');
    return value;
  }

  function fraction(value, name) {
    nonnegative(value, name);
    if (value > 1) throw new RangeError(name + ' must be between 0 and 1.');
    return value;
  }

  function identifier(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a nonempty string.');
    return value;
  }

  function temperature(value, name) {
    finite(value, name);
    if (value < -273.15) throw new RangeError(name + ' is below absolute zero in degrees Celsius.');
    return value;
  }

  function computed(value, name) {
    if (!Number.isFinite(value)) throw new RangeError(name + ' exceeds the finite numerical range; rescale the inputs.');
    return value;
  }

  function extentEnd(start, extent, name) {
    const end = computed(start + extent, name);
    if (end <= start) throw new RangeError(name + ' is below the coordinate numerical resolution.');
    return end;
  }

  function sum(values) {
    let result = 0;
    let correction = 0;
    for (const value of values) {
      const adjusted = value - correction;
      const next = result + adjusted;
      correction = (next - result) - adjusted;
      result = next;
    }
    return computed(result, 'Sum');
  }

  function assemblyProperties(layers, films) {
    array(layers, 'layers', true);
    const assumedFilms = films === undefined;
    if (assumedFilms) films = { inside: 0.13, outside: 0.04 };
    keys(films, ['inside', 'outside'], 'films');
    const resistances = [
      nonnegative(films.inside, 'films.inside'),
      nonnegative(films.outside, 'films.outside')
    ];
    const capacities = [];
    layers.forEach((layer, index) => {
      const name = 'layers[' + index + ']';
      keys(layer, ['thicknessM', 'conductivityW_MK', 'densityKgM3', 'specificHeatJ_KgK', 'label', 'source'], name);
      const d = positive(layer.thicknessM, name + '.thicknessM');
      const k = positive(layer.conductivityW_MK, name + '.conductivityW_MK');
      const density = positive(layer.densityKgM3, name + '.densityKgM3');
      const capacity = positive(layer.specificHeatJ_KgK, name + '.specificHeatJ_KgK');
      resistances.push(positive(computed(d / k, name + ' resistance'), name + ' resistance'));
      capacities.push(positive(computed(density * capacity * d, name + ' capacity'), name + ' capacity'));
    });
    const resistance = positive(sum(resistances), 'Assembly resistance');
    return {
      resistanceM2K_W: resistance,
      uValueW_M2K: positive(computed(1 / resistance, 'Assembly U-value'), 'Assembly U-value'),
      arealHeatCapacityJ_M2K: positive(sum(capacities), 'Assembly heat capacity'),
      films: { inside: films.inside, outside: films.outside },
      warnings: [
        assumedFilms
          ? 'ASSUMED fixed surface films: inside 0.13 and outside 0.04 m2 K/W; not universal boundary coefficients.'
          : 'Supplied surface films are fixed resistances, not a dynamic convection/radiation calculation.',
        'One-dimensional homogeneous layers only; no thermal bridges, moisture, contact resistance or dynamic time lag.'
      ]
    };
  }

  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function add(a, b, scale) { return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }; }
  function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  const upVector = { x: 0, y: 0, z: 1 };
  const xVector = { x: 1, y: 0, z: 0 };
  const yVector = { x: 0, y: 1, z: 0 };

  function rectangle(value, name) {
    object(value, name);
    const result = {
      x: finite(value.x, name + '.x'), y: finite(value.y, name + '.y'),
      w: positive(value.w, name + '.w'), h: positive(value.h, name + '.h')
    };
    if (!(computed(result.x + result.w, name + ' right edge') > result.x) ||
        !(computed(result.y + result.h, name + ' rear edge') > result.y)) {
      throw new RangeError(name + ' is below the coordinate numerical resolution.');
    }
    return result;
  }

  function point2(value, name) {
    object(value, name);
    return { x: finite(value.x, name + '.x'), y: finite(value.y, name + '.y'), z: 0 };
  }

  function shadowOptions(value) {
    if (value === undefined) value = {};
    keys(value, ['samplesPerAxis', 'groundElevationM', 'minSunAltitudeDeg', 'maxShadowDistanceM', 'windowTransmittance'], 'options');
    const result = {
      samplesPerAxis: value.samplesPerAxis === undefined ? 16 : positive(value.samplesPerAxis, 'options.samplesPerAxis'),
      groundElevationM: value.groundElevationM === undefined ? 0 : finite(value.groundElevationM, 'options.groundElevationM'),
      minSunAltitudeDeg: value.minSunAltitudeDeg === undefined ? 1 : positive(value.minSunAltitudeDeg, 'options.minSunAltitudeDeg'),
      maxShadowDistanceM: value.maxShadowDistanceM === undefined ? 1000 : positive(value.maxShadowDistanceM, 'options.maxShadowDistanceM'),
      windowTransmittance: value.windowTransmittance === undefined ? 1 : fraction(value.windowTransmittance, 'options.windowTransmittance')
    };
    if (!Number.isInteger(result.samplesPerAxis) || result.samplesPerAxis > 128) throw new RangeError('samplesPerAxis must be an integer from 1 to 128.');
    if (result.minSunAltitudeDeg >= 90) throw new RangeError('minSunAltitudeDeg must be greater than 0 and less than 90.');
    return result;
  }

  function localSunVector(sunENU, headingDeg) {
    keys(sunENU, ['east', 'north', 'up'], 'sunENU');
    const east = finite(sunENU.east, 'sunENU.east');
    const north = finite(sunENU.north, 'sunENU.north');
    const up = finite(sunENU.up, 'sunENU.up');
    const norm = Math.hypot(east, north, up);
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-6) throw new RangeError('sunENU must be a unit ENU vector toward the sun, not angles or a light-travel vector.');
    const angle = (headingDeg % 360) * radians;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // This is the inverse of the contract's local -> east/north matrix.
    // Geometry stays LOCAL; the ENU direction is transformed exactly once.
    return { x: (east * c - north * s) / norm, y: -(east * s + north * c) / norm, z: up / norm };
  }

  function panel(origin, u, v, width, height) {
    positive(computed(width * height, 'Panel area'), 'Panel area');
    return { origin, u, v, width, height };
  }

  function receiver(id, type, normal, patches, spanU, spanV, interior) {
    return {
      id, type, normal, patches, spanU, spanV, interior: !!interior,
      areaM2: positive(sum(patches.map(patch => patch.width * patch.height)), 'Receiver area')
    };
  }

  function box(id, center, axes, halves, transmittance) {
    for (const axis of ['x', 'y', 'z']) computed(center[axis], 'Box center');
    halves.forEach(value => positive(value, 'Box half extent'));
    return { kind: 'box', id, center, axes, halves, transmittance };
  }

  function cuts(start, end, values) {
    return [...new Set([start, end, ...values.filter(value => value > start && value < end)])].sort((a, b) => a - b);
  }

  function rectangularRemainder(rect, exclusions, z) {
    const relevant = exclusions.filter(other => other.x < rect.x + rect.w && other.x + other.w > rect.x &&
      other.y < rect.y + rect.h && other.y + other.h > rect.y);
    const xs = cuts(rect.x, rect.x + rect.w, relevant.flatMap(other => [other.x, other.x + other.w]));
    const ys = cuts(rect.y, rect.y + rect.h, relevant.flatMap(other => [other.y, other.y + other.h]));
    const result = [];
    for (let x = 0; x < xs.length - 1; x++) {
      for (let y = 0; y < ys.length - 1; y++) {
        const middleX = xs[x] / 2 + xs[x + 1] / 2;
        const middleY = ys[y] / 2 + ys[y + 1] / 2;
        if (relevant.some(other => middleX > other.x && middleX < other.x + other.w && middleY > other.y && middleY < other.y + other.h)) continue;
        result.push(panel({ x: xs[x], y: ys[y], z }, xVector, yVector, xs[x + 1] - xs[x], ys[y + 1] - ys[y]));
      }
    }
    return result;
  }

  function sceneGeometry(scene, options) {
    object(scene, 'scene');
    finite(scene.headingDeg, 'scene.headingDeg');
    const floor = rectangle(scene.floor, 'scene.floor');
    const building = rectangle(scene.building, 'scene.building');
    const floorElevation = finite(scene.floorElevationM, 'scene.floorElevationM');
    const height = positive(scene.wallHeightM, 'scene.wallHeightM');
    const roofThickness = scene.roofThicknessM === undefined ? 0 : nonnegative(scene.roofThicknessM, 'scene.roofThicknessM');
    if (floorElevation < options.groundElevationM) throw new RangeError('Below-ground floors/terrain are not supported by this above-ground shadow model.');
    if (scene.building.roofType !== undefined && scene.building.roofType !== 'flat') throw new RangeError('Only a flat rectangular building roof is supported.');
    array(scene.walls, 'scene.walls');
    array(scene.openings, 'scene.openings');
    array(scene.obstacles, 'scene.obstacles');
    const surfaces = [];
    const casters = [];
    const warnings = [
      'Geometry-only midpoint ray sampling of vertical walls, rectangular prisms and one opaque flat roof; not a rendered shadow map.',
      'Only this scene is modeled. No other storeys, terrain, overhangs, sashes or door leaves are inferred.'
    ];
    const wallMap = new Map();
    for (const source of scene.walls) {
      object(source, 'wall');
      identifier(source.id, 'wall.id');
      if (wallMap.has(source.id)) throw new RangeError('Duplicate wall ID: ' + source.id);
      const start = point2(source.start, 'wall.start');
      const end = point2(source.end, 'wall.end');
      const length = positive(computed(Math.hypot(end.x - start.x, end.y - start.y), 'Wall length'), 'Wall length');
      const wallHeight = positive(source.heightM, 'wall.heightM');
      const base = finite(source.baseM, 'wall.baseM');
      const thickness = positive(source.thicknessM, 'wall.thicknessM');
      if (base < options.groundElevationM) throw new RangeError('Below-ground wall bases are not supported.');
      extentEnd(base, wallHeight, 'Wall top elevation');
      if (typeof source.removed !== 'boolean' || typeof source.exterior !== 'boolean') throw new TypeError('Walls must explicitly declare removed and exterior booleans.');
      const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length, z: 0 };
      const normal = { x: -tangent.y, y: tangent.x, z: 0 };
      wallMap.set(source.id, {
        source, start, end, length, height: wallHeight, base, thickness, tangent, normal, openings: []
      });
    }
    const openingIds = new Set();
    for (const source of scene.openings) {
      object(source, 'opening');
      identifier(source.id, 'opening.id');
      if (openingIds.has(source.id)) throw new RangeError('Duplicate opening ID: ' + source.id);
      openingIds.add(source.id);
      if (!wallMap.has(source.wallId)) throw new RangeError('Opening references an unknown wall: ' + source.wallId);
      const wall = wallMap.get(source.wallId);
      if (!['hinged', 'sliding', 'window', 'passage'].includes(source.kind)) throw new RangeError('Unsupported opening kind: ' + source.kind);
      const offset = nonnegative(source.offsetM, 'opening.offsetM');
      const width = positive(source.widthM, 'opening.widthM');
      const sill = nonnegative(source.sillM, 'opening.sillM');
      const openingHeight = positive(source.heightM, 'opening.heightM');
      const open = fraction(source.openFraction, 'opening.openFraction');
      if (offset + width > wall.length + 1e-9 || sill + openingHeight > wall.height + 1e-9) {
        throw new RangeError('Opening extends outside its physical wall: ' + source.id);
      }
      if (wall.openings.some(other => offset < other.offset + other.width - 1e-9 && offset + width > other.offset + 1e-9 &&
          sill < other.sill + other.height - 1e-9 && sill + openingHeight > other.sill + 1e-9)) {
        throw new RangeError('Overlapping openings on one wall are ambiguous; merge them in the scene.');
      }
      wall.openings.push({
        source, offset, width, sill, height: openingHeight,
        transmittance: source.kind === 'window' ? open + (1 - open) * options.windowTransmittance : open
      });
    }
    if (scene.openings.some(opening => opening.kind === 'window')) {
      warnings.push('ASSUMED closed-window beam transmittance = ' + options.windowTransmittance +
        '; open fraction is ideal clear area. This is geometric transmission, NOT SHGC, VLT, heat gain or an airflow opening.');
    }
    if (scene.openings.some(opening => opening.kind !== 'window')) {
      warnings.push('Door/passage openFraction is spatially averaged beam transmission across the aperture; closed door area is opaque. Hinged leaf and sash positions are not reconstructed.');
    }
    for (const wall of wallMap.values()) {
      const us = cuts(0, wall.length, wall.openings.flatMap(opening => [opening.offset, opening.offset + opening.width]));
      const zs = cuts(0, wall.height, wall.openings.flatMap(opening => [opening.sill, opening.sill + opening.height]));
      const solidPatches = [];
      for (let u = 0; u < us.length - 1; u++) {
        for (let z = 0; z < zs.length - 1; z++) {
          const middleU = us[u] / 2 + us[u + 1] / 2;
          const middleZ = zs[z] / 2 + zs[z + 1] / 2;
          const aperture = wall.openings.find(opening => middleU > opening.offset && middleU < opening.offset + opening.width &&
            middleZ > opening.sill && middleZ < opening.sill + opening.height);
          const width = us[u + 1] - us[u];
          const patchHeight = zs[z + 1] - zs[z];
          const origin = add({ x: wall.start.x, y: wall.start.y, z: wall.base + zs[z] }, wall.tangent, us[u]);
          if (aperture) {
            if (aperture.transmittance < 1) {
              casters.push({
                kind: 'panel', id: aperture.source.id, transmittance: aperture.transmittance,
                panel: panel(origin, wall.tangent, upVector, width, patchHeight)
              });
            }
          } else if (!wall.source.removed) {
            solidPatches.push(panel(origin, wall.tangent, upVector, width, patchHeight));
            casters.push(box(wall.source.id, add(add(origin, wall.tangent, width / 2), upVector, patchHeight / 2),
              [wall.tangent, wall.normal, upVector], [width / 2, wall.thickness / 2, patchHeight / 2], 0));
          }
        }
      }
      let sides;
      if (wall.source.exterior) {
        let interiorPoint = { x: building.x + building.w / 2, y: building.y + building.h / 2, z: 0 };
        if (Array.isArray(scene.rooms) && Array.isArray(wall.source.roomIds) && wall.source.roomIds.length === 1) {
          const room = scene.rooms.find(value => value.id === wall.source.roomIds[0]);
          if (room) {
            const rect = rectangle(room.rect, 'room.rect');
            interiorPoint = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, z: 0 };
          }
        }
        const inward = dot(subtract(interiorPoint, wall.start), wall.normal);
        if (Math.abs(inward) <= rayEpsilon) throw new RangeError('Cannot determine the exterior side of wall ' + wall.source.id + '; provide its adjacent room or a valid rectangular envelope.');
        const sign = inward > 0 ? -1 : 1;
        sides = [{ suffix: '', normal: { x: wall.normal.x * sign, y: wall.normal.y * sign, z: 0 } }];
      } else {
        sides = [
          { suffix: ':side-a', normal: wall.normal },
          { suffix: ':side-b', normal: { x: -wall.normal.x, y: -wall.normal.y, z: 0 } }
        ];
      }
      for (const side of sides) {
        if (solidPatches.length) {
          const patches = solidPatches.map(patch => ({
            ...patch, origin: add(patch.origin, side.normal, wall.thickness / 2)
          }));
          surfaces.push(receiver(wall.source.id + side.suffix, 'wall', side.normal, patches, wall.length, wall.height, !wall.source.exterior));
        }
        for (const opening of wall.openings) {
          const origin = add(add({ x: wall.start.x, y: wall.start.y, z: wall.base + opening.sill }, wall.tangent, opening.offset), side.normal, wall.thickness / 2);
          surfaces.push(receiver(opening.source.id + side.suffix, opening.source.kind === 'window' ? 'window' : 'opening',
            side.normal, [panel(origin, wall.tangent, upVector, opening.width, opening.height)], opening.width, opening.height, !wall.source.exterior));
        }
      }
    }

    const prefix = scene.floorId === undefined ? '' : identifier(scene.floorId, 'scene.floorId') + ':';
    const roofUnderside = extentEnd(floorElevation, height, 'Roof underside elevation');
    const roofTop = roofThickness > 0 ? extentEnd(roofUnderside, roofThickness, 'Roof top elevation') : roofUnderside;
    const roofPanel = panel({ x: building.x, y: building.y, z: roofTop },
      xVector, yVector, building.w, building.h);
    surfaces.push(receiver(prefix + 'roof', 'roof', upVector, [roofPanel], building.w, building.h));
    if (roofThickness > 0) {
      casters.push(box(prefix + 'roof', {
        x: building.x + building.w / 2, y: building.y + building.h / 2, z: roofUnderside + roofThickness / 2
      }, [xVector, yVector, upVector], [building.w / 2, building.h / 2, roofThickness / 2], 0));
      warnings.push('Building roof is an opaque flat slab using supplied roofThicknessM = ' + roofThickness +
        ' m; underside = floorElevationM + wallHeightM, roof receiver on the geometric top. No thermal assembly properties are inferred.');
    } else {
      casters.push({ kind: 'panel', id: prefix + 'roof', panel: roofPanel, transmittance: 0 });
      warnings.push((scene.roofThicknessM === undefined ? 'Roof thickness unavailable: ASSUMED ' : 'Explicit roofThicknessM = 0: ') +
        'opaque zero-thickness plane at floorElevationM + wallHeightM. No roof slope/thickness/thermal properties are inferred.');
    }

    const exclusions = [building];
    const obstacleIds = new Set();
    for (const obstacle of scene.obstacles) {
      object(obstacle, 'obstacle');
      identifier(obstacle.id, 'obstacle.id');
      if (obstacleIds.has(obstacle.id) || wallMap.has(obstacle.id) || openingIds.has(obstacle.id)) throw new RangeError('Obstacle IDs must be unique across geometry: ' + obstacle.id);
      obstacleIds.add(obstacle.id);
      if (!['building', 'tree'].includes(obstacle.type)) throw new RangeError('Only rectangular building/tree obstacles are supported; no terrain or mesh obstacles.');
      const rect = rectangle(obstacle, 'obstacle');
      const obstacleHeight = positive(obstacle.heightM, 'obstacle.heightM');
      const base = finite(obstacle.baseM, 'obstacle.baseM');
      if (base < options.groundElevationM) throw new RangeError('Below-ground obstacle bases are not supported.');
      const top = extentEnd(base, obstacleHeight, 'Obstacle top');
      const transmittance = fraction(obstacle.transmittance, 'obstacle.transmittance');
      casters.push(box(obstacle.id, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, z: base + obstacleHeight / 2 },
        [xVector, yVector, upVector], [rect.w / 2, rect.h / 2, obstacleHeight / 2], transmittance));
      if (obstacle.type === 'building' && base === options.groundElevationM) exclusions.push(rect);
      const faces = [
        { name: 'roof', normal: upVector, patch: panel({ x: rect.x, y: rect.y, z: top }, xVector, yVector, rect.w, rect.h) },
        { name: 'west', normal: { x: -1, y: 0, z: 0 }, patch: panel({ x: rect.x, y: rect.y, z: base }, yVector, upVector, rect.h, obstacleHeight) },
        { name: 'east', normal: xVector, patch: panel({ x: rect.x + rect.w, y: rect.y, z: base }, yVector, upVector, rect.h, obstacleHeight) },
        { name: 'front', normal: { x: 0, y: -1, z: 0 }, patch: panel({ x: rect.x, y: rect.y, z: base }, xVector, upVector, rect.w, obstacleHeight) },
        { name: 'rear', normal: yVector, patch: panel({ x: rect.x, y: rect.y + rect.h, z: base }, xVector, upVector, rect.w, obstacleHeight) }
      ];
      for (const face of faces) {
        surfaces.push(receiver(obstacle.id + ':' + face.name,
          obstacle.type === 'tree' ? 'canopy' : face.name === 'roof' ? 'obstacle-roof' : 'obstacle-wall',
          face.normal, [face.patch], face.patch.width, face.patch.height));
      }
    }
    if (scene.obstacles.some(obstacle => obstacle.type === 'tree')) warnings.push('Trees are rectangular canopy envelopes with supplied, angle-independent beam transmittance, applied once per intersected object. No foliage, evapotranspiration or cooling prediction.');
    const groundPatches = rectangularRemainder(floor, exclusions, options.groundElevationM);
    if (groundPatches.length) surfaces.push(receiver(prefix + 'ground', 'ground', upVector, groundPatches, floor.w, floor.h));
    warnings.push('Ground receiver is the plot rectangle minus the building footprint and ground-touching building obstacles, on the declared flat ground plane.');
    const receiverIds = new Set();
    for (const surface of surfaces) {
      if (receiverIds.has(surface.id)) throw new RangeError('Generated receiver ID collision: ' + surface.id);
      receiverIds.add(surface.id);
    }
    return { surfaces, casters, warnings };
  }

  function intersectsPanel(origin, direction, patch) {
    const normal = cross(patch.u, patch.v);
    const denominator = dot(direction, normal);
    if (Math.abs(denominator) <= 1e-12) return false;
    const distance = computed(dot(subtract(patch.origin, origin), normal) / denominator, 'Ray/plane distance');
    if (distance <= rayEpsilon) return false;
    const relative = subtract(add(origin, direction, distance), patch.origin);
    const u = dot(relative, patch.u);
    const v = dot(relative, patch.v);
    return u >= -rayEpsilon && u <= patch.width + rayEpsilon && v >= -rayEpsilon && v <= patch.height + rayEpsilon;
  }

  function intersectsBox(origin, direction, obstacle) {
    const relative = subtract(origin, obstacle.center);
    let entry = 0;
    let exit = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const position = computed(dot(relative, obstacle.axes[axis]), 'Ray/box coordinate');
      const velocity = dot(direction, obstacle.axes[axis]);
      const half = obstacle.halves[axis];
      if (Math.abs(velocity) <= 1e-12) {
        if (position < -half - rayEpsilon || position > half + rayEpsilon) return false;
      } else {
        const first = computed((-half - position) / velocity, 'Ray/box entry');
        const second = computed((half - position) / velocity, 'Ray/box exit');
        entry = Math.max(entry, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (exit < entry) return false;
      }
    }
    return exit > rayEpsilon && exit >= entry;
  }

  function beamTransmission(origin, direction, casters) {
    let transmission = 1;
    const crossed = new Set();
    for (const caster of casters) {
      if (caster.transmittance === 1 || crossed.has(caster.id)) continue;
      const intersects = caster.kind === 'box'
        ? intersectsBox(origin, direction, caster) : intersectsPanel(origin, direction, caster.panel);
      if (intersects) {
        transmission *= caster.transmittance;
        crossed.add(caster.id);
        if (transmission === 0) break;
      }
    }
    return transmission;
  }

  function sampledFraction(surface, direction, casters, samplesPerAxis) {
    if (dot(surface.normal, direction) <= 1e-12) return 0;
    const contributions = [];
    for (const patch of surface.patches) {
      const columns = Math.max(1, Math.ceil(samplesPerAxis * patch.width / surface.spanU));
      const rows = Math.max(1, Math.ceil(samplesPerAxis * patch.height / surface.spanV));
      const weight = patch.width * patch.height / (rows * columns);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const point = add(add(add(patch.origin, patch.u, patch.width * (column + 0.5) / columns),
            patch.v, patch.height * (row + 0.5) / rows), surface.normal, 4 * rayEpsilon);
          contributions.push(weight * beamTransmission(point, direction, casters));
        }
      }
    }
    return Math.max(0, Math.min(1, sum(contributions) / surface.areaM2));
  }

  function convexHull(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
      .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
    if (sorted.length < 3) return [];
    const turn = (a, b, c) => computed((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), 'Projected polygon orientation');
    const lower = [];
    const upper = [];
    for (const point of sorted) {
      while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
      lower.push(point);
    }
    for (const point of sorted.slice().reverse()) {
      while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
      upper.push(point);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  function casterVertices(caster) {
    if (caster.kind === 'panel') {
      const patch = caster.panel;
      return [patch.origin, add(patch.origin, patch.u, patch.width),
        add(add(patch.origin, patch.u, patch.width), patch.v, patch.height), add(patch.origin, patch.v, patch.height)];
    }
    const result = [];
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        for (const c of [-1, 1]) {
          result.push(add(add(add(caster.center, caster.axes[0], a * caster.halves[0]),
            caster.axes[1], b * caster.halves[1]), caster.axes[2], c * caster.halves[2]));
        }
      }
    }
    return result;
  }

  function calculateShadows(scene, sunENU, inputOptions) {
    const options = shadowOptions(inputOptions);
    const geometry = sceneGeometry(scene, options);
    const direction = localSunVector(sunENU, scene.headingDeg);
    const warnings = geometry.warnings.slice();
    let directSunStatus = 'daylight';
    if (direction.z <= 0) {
      directSunStatus = 'below-horizon';
      warnings.push('Sun is at/below the horizon: direct beam fractions are zero and no ground shadow polygons are projected.');
    } else if (direction.z <= Math.sin(options.minSunAltitudeDeg * radians)) {
      directSunStatus = 'near-horizon-suppressed';
      warnings.push('Direct beam/shadows are deliberately suppressed at or below ' + options.minSunAltitudeDeg + ' degrees altitude; zero is a cutoff, not a resolved low-sun estimate.');
    }
    const receivers = geometry.surfaces.map(surface => ({
      id: surface.id, type: surface.type, areaM2: surface.areaM2,
      sunlitFraction: directSunStatus === 'daylight' ? sampledFraction(surface, direction, geometry.casters, options.samplesPerAxis) : 0
    }));
    const groundPolygons = [];
    const omitted = new Set();
    if (directSunStatus === 'daylight') {
      for (const caster of geometry.casters) {
        if (caster.transmittance === 1) continue;
        const vertices = casterVertices(caster);
        if (vertices.every(point => point.z <= options.groundElevationM)) continue;
        const projected = [];
        let bounded = true;
        for (const point of vertices) {
          const distance = computed((point.z - options.groundElevationM) / direction.z, 'Ground projection distance');
          const dx = computed(distance * direction.x, 'Ground shadow x offset');
          const dy = computed(distance * direction.y, 'Ground shadow y offset');
          if (Math.hypot(dx, dy) > options.maxShadowDistanceM) {
            bounded = false;
            break;
          }
          projected.push({ x: computed(point.x - dx, 'Ground shadow x'), y: computed(point.y - dy, 'Ground shadow y') });
        }
        if (!bounded) {
          omitted.add(caster.id);
          continue;
        }
        const points = convexHull(projected);
        if (points.length >= 3) groundPolygons.push({ obstacleId: caster.id, points, transmittance: caster.transmittance });
      }
    }
    if (omitted.size) warnings.push('Ground projection omitted beyond ' + options.maxShadowDistanceM +
      ' m displacement for: ' + [...omitted].join(', ') + '. Receiver rays are still evaluated; no truncated/fake polygon is substituted.');
    warnings.push('Ground polygons are un-unioned caster supports; overlap/partial transmission is resolved by receiver rays, not by summing polygon areas.');
    return {
      geometry, direction,
      result: {
        receivers, groundPolygons, directSunStatus,
        sampling: { method: 'area-weighted midpoint rays', samplesPerAxis: options.samplesPerAxis },
        warnings
      }
    };
  }

  function shadowAt(scene, sunENU, options) {
    return calculateShadows(scene, sunENU, options).result;
  }

  function surfaceExposure(scene, sunENU, radiation) {
    keys(radiation, ['dniWm2', 'dhiWm2', 'ghiWm2', 'groundAlbedo'], 'radiation');
    const dni = nonnegative(radiation.dniWm2, 'radiation.dniWm2');
    const dhi = nonnegative(radiation.dhiWm2, 'radiation.dhiWm2');
    const ghi = nonnegative(radiation.ghiWm2, 'radiation.ghiWm2');
    const albedo = radiation.groundAlbedo === undefined ? 0.2 : fraction(radiation.groundAlbedo, 'radiation.groundAlbedo');
    const calculation = calculateShadows(scene, sunENU);
    const warnings = calculation.result.warnings.slice();
    warnings.push('Isotropic diffuse/ground screening assumes UNOBSTRUCTED hemispheres with tilt view factors, independently of beam shadows. Urban sky occlusion, shaded ground and multiple reflections are not solved; these components are upper-access assumptions.');
    if (radiation.groundAlbedo === undefined) warnings.push('ASSUMED ground albedo = 0.2; supply a site/scenario value when known.');
    if (calculation.geometry.surfaces.some(surface => surface.interior)) warnings.push('Interior receiver irradiance is unavailable: aperture-to-interior diffuse view factors are not modeled. Interior beam fractions remain available from shadowAt.');
    const surfaces = [];
    calculation.geometry.surfaces.forEach((surface, i) => {
      if (surface.interior) return;
      const base = calculation.result.receivers[i];
      const cosine = Math.max(0, Math.min(1, dot(surface.normal, calculation.direction)));
      const skyViewFactor = (1 + surface.normal.z) / 2;
      const groundViewFactor = (1 - surface.normal.z) / 2;
      const beam = computed(dni * cosine * base.sunlitFraction, 'Direct irradiance');
      const diffuse = computed(dhi * skyViewFactor, 'Sky diffuse irradiance');
      const reflected = computed(ghi * albedo * groundViewFactor, 'Ground-reflected irradiance');
      surfaces.push({
        ...base,
        incidentWm2: sum([beam, diffuse, reflected]),
        beamWm2: beam, skyDiffuseWm2: diffuse, groundReflectedWm2: reflected,
        skyViewFactor, groundViewFactor
      });
    });
    return { surfaces, directSunStatus: calculation.result.directSunStatus, warnings };
  }

  function solveAirflow(input) {
    keys(input, ['zones', 'links', 'outsideId', 'densityKgM3'], 'input');
    array(input.zones, 'zones', true);
    array(input.links, 'links');
    const outsideId = input.outsideId === undefined ? 'outside' : identifier(input.outsideId, 'outsideId');
    const density = input.densityKgM3 === undefined ? 1.2 : positive(input.densityKgM3, 'densityKgM3');
    const ids = [outsideId];
    const indexes = new Map([[outsideId, 0]]);
    input.zones.forEach((zone, i) => {
      keys(zone, ['id', 'volumeM3'], 'zones[' + i + ']');
      identifier(zone.id, 'zone.id');
      positive(zone.volumeM3, 'zone.volumeM3');
      if (indexes.has(zone.id)) throw new RangeError('Zone IDs must be unique and must not equal outsideId: ' + zone.id);
      indexes.set(zone.id, ids.length);
      ids.push(zone.id);
    });

    const adjacency = ids.map(() => []);
    const linkIds = new Set();
    const links = input.links.map((link, i) => {
      const name = 'links[' + i + ']';
      keys(link, ['id', 'from', 'to', 'freeAreaM2', 'cd', 'pressurePa'], name);
      identifier(link.id, name + '.id');
      if (linkIds.has(link.id)) throw new RangeError('Duplicate link ID: ' + link.id);
      linkIds.add(link.id);
      if (!indexes.has(link.from) || !indexes.has(link.to)) throw new RangeError(name + ' references an unknown pressure node.');
      if (link.from === link.to) throw new RangeError(name + ' is a self-link; two-way/single-sided exchange is not supported.');
      const area = nonnegative(link.freeAreaM2, name + '.freeAreaM2');
      const cd = positive(link.cd, name + '.cd');
      if (cd > 1) throw new RangeError(name + '.cd must be at most 1 for the supported orifice definition.');
      const forcing = finite(link.pressurePa, name + '.pressurePa');
      const coefficient = computed(cd * area * Math.sqrt(2 / density), name + ' flow coefficient');
      if (area > 0 && coefficient === 0) throw new RangeError(name + ' flow coefficient underflows the numerical range.');
      const from = indexes.get(link.from);
      const to = indexes.get(link.to);
      if (area > 0) {
        adjacency[from].push({ other: to, forcing, coefficient });
        adjacency[to].push({ other: from, forcing: -forcing, coefficient });
      }
      return { id: link.id, from, to, forcing, coefficient };
    });

    const warnings = [
      'Steady, one-way orifice links with one constant air density; not CFD, room airspeed or large-opening two-way exchange.',
      input.densityKgM3 === undefined
        ? 'ASSUMED constant density: 1.2 kg/m3. Cd, free area and signed forcing are supplied, not inferred.'
        : 'The supplied density is constant on every link; mass conservation is density times volume-flow conservation.'
    ];
    const visited = new Set();
    const references = [];
    const unknowns = [];
    for (let start = 0; start < ids.length; start++) {
      if (visited.has(start)) continue;
      const component = [start];
      visited.add(start);
      for (let cursor = 0; cursor < component.length; cursor++) {
        for (const edge of adjacency[component[cursor]]) {
          if (!visited.has(edge.other)) {
            visited.add(edge.other);
            component.push(edge.other);
          }
        }
      }
      if (component.length === 1 && start === 0 && adjacency[start].length === 0) continue;
      const reference = component.includes(0) ? 0 : component[0];
      references.push({ id: ids[reference], pressurePa: 0, connectedToOutside: reference === 0 });
      if (reference !== 0) {
        warnings.push(component.length === 1
          ? 'Sealed zone ' + ids[reference] + ': zero flow and an arbitrary 0 Pa reference; no leakage was added.'
          : 'Disconnected component referenced to ' + ids[reference] + ' = 0 Pa; no outside connection or artificial leakage.');
      }
      unknowns.push(...component.filter(node => node !== reference));
    }
    if (adjacency.slice(1).some(edges => edges.length === 1)) {
      warnings.push('A single-link/dead-end zone has zero steady net exchange; turbulence-driven single-sided ventilation is outside this model.');
    }

    const pressures = ids.map(() => 0);
    const signedRoot = value => Math.sign(value) * Math.sqrt(Math.abs(value));
    function evaluate() {
      const nodeTerms = ids.map(() => []);
      const flows = links.map(link => {
        let flow = 0;
        if (link.coefficient !== 0) {
          const difference = computed(pressures[link.from] - pressures[link.to] + link.forcing, 'Link pressure difference');
          flow = computed(link.coefficient * signedRoot(difference), 'Link volume flow');
        }
        nodeTerms[link.from].push(flow);
        nodeTerms[link.to].push(-flow);
        return flow;
      });
      const residuals = nodeTerms.map(terms => sum(terms));
      return { flows, residuals, maximum: Math.max(0, ...residuals.slice(1).map(Math.abs)) };
    }

    function balanceNode(node) {
      const edges = adjacency[node].map(edge => ({
        target: computed(pressures[edge.other] - edge.forcing, 'Nodal bracket pressure'),
        coefficient: edge.coefficient
      }));
      let low = Math.min(...edges.map(edge => edge.target));
      let high = Math.max(...edges.map(edge => edge.target));
      if (low === high) return low;
      const residual = value => sum(edges.map(edge => computed(
        edge.coefficient * signedRoot(computed(value - edge.target, 'Nodal pressure difference')), 'Nodal volume flow'
      )));
      let best = low;
      let bestResidual = Math.abs(residual(low));
      // The nodal residual is continuous and monotone. Bracketing avoids the
      // singular d(sqrt(|dp|))/dp derivative at a zero-pressure opening.
      for (let iteration = 0; iteration < 110; iteration++) {
        const middle = low / 2 + high / 2;
        const value = residual(middle);
        if (Math.abs(value) < bestResidual) {
          best = middle;
          bestResidual = Math.abs(value);
        }
        if (value === 0) return middle;
        if (middle === low || middle === high) break;
        if (value > 0) high = middle;
        else low = middle;
      }
      const highResidual = Math.abs(residual(high));
      return highResidual < bestResidual ? high : best;
    }

    let evaluated = evaluate();
    const flowScale = Math.max(0, ...evaluated.flows.map(Math.abs));
    const tolerance = computed(1e-9 + 1e-10 * flowScale, 'Airflow convergence tolerance');
    let iterations = 0;
    let status = 'converged';
    let bestResidual = evaluated.maximum;
    let lastImprovement = 0;
    const maximumIterations = 4096;
    while (evaluated.maximum > tolerance && iterations < maximumIterations) {
      iterations++;
      let changed = false;
      for (const node of unknowns) {
        const next = balanceNode(node);
        changed = changed || next !== pressures[node];
        pressures[node] = next;
      }
      evaluated = evaluate();
      if (evaluated.maximum < bestResidual * (1 - 1e-12)) {
        bestResidual = evaluated.maximum;
        lastImprovement = iterations;
      }
      if (evaluated.maximum > tolerance && (!changed || iterations - lastImprovement >= 256)) {
        status = 'stalled';
        break;
      }
    }
    const converged = evaluated.maximum <= tolerance;
    if (!converged) {
      if (status !== 'stalled') status = 'iteration-limit';
      warnings.push('Pressure solver ' + status + ': residual ' + evaluated.maximum + ' m3/s exceeds ' + tolerance + ' m3/s. Do not treat these flows as a balanced solution.');
    }
    return {
      converged,
      pressures: Object.fromEntries(ids.map((id, i) => [id, pressures[i]])),
      flows: links.map((link, i) => ({ id: link.id, from: ids[link.from], to: ids[link.to], m3s: evaluated.flows[i] })),
      residualM3s: evaluated.maximum,
      zoneResidualsM3s: Object.fromEntries(ids.slice(1).map((id, i) => [id, evaluated.residuals[i + 1]])),
      toleranceM3s: tolerance,
      iterations,
      status,
      references,
      warnings
    };
  }

  function utcTimestamp(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
      throw new TypeError(name + ' must be a UTC ISO timestamp, including seconds and Z.');
    }
    const time = Date.parse(value);
    const canonical = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits) => '.' + digits.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
    if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) throw new RangeError(name + ' is not a valid calendar instant.');
    return time;
  }

  function choleskySolve(matrix, right) {
    const n = right.length;
    const lower = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        const products = [];
        for (let k = 0; k < j; k++) products.push(lower[i][k] * lower[j][k]);
        const value = computed(matrix[i][j] - sum(products), 'Thermal factorization');
        if (i === j) {
          if (value <= Number.EPSILON * n * matrix[i][i]) {
            throw new RangeError('Thermal matrix is numerically ill-conditioned; rescale capacities/conductances or shorten the timestep.');
          }
          lower[i][j] = Math.sqrt(value);
        } else lower[i][j] = computed(value / lower[j][j], 'Thermal factorization');
      }
    }
    const forward = [];
    for (let i = 0; i < n; i++) {
      forward[i] = computed((right[i] - sum(forward.map((value, j) => lower[i][j] * value))) / lower[i][i], 'Thermal forward solve');
    }
    const result = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      const products = [];
      for (let j = i + 1; j < n; j++) products.push(lower[j][i] * result[j]);
      result[i] = computed((forward[i] - sum(products)) / lower[i][i], 'Thermal backward solve');
    }
    return result;
  }

  function simulateThermal(input) {
    keys(input, ['zones', 'links', 'steps'], 'input');
    array(input.zones, 'zones', true);
    array(input.links, 'links');
    array(input.steps, 'steps');
    const indexes = new Map();
    const zones = input.zones.map((zone, i) => {
      const name = 'zones[' + i + ']';
      keys(zone, ['id', 'capacityJ_K', 'initialC', 'outsideConductanceW_K'], name);
      identifier(zone.id, name + '.id');
      if (indexes.has(zone.id)) throw new RangeError('Duplicate thermal zone ID: ' + zone.id);
      indexes.set(zone.id, i);
      return {
        id: zone.id,
        capacity: positive(zone.capacityJ_K, name + '.capacityJ_K'),
        initial: temperature(zone.initialC, name + '.initialC'),
        outside: nonnegative(zone.outsideConductanceW_K, name + '.outsideConductanceW_K')
      };
    });
    const links = input.links.map((link, i) => {
      keys(link, ['from', 'to', 'conductanceW_K'], 'links[' + i + ']');
      if (!indexes.has(link.from) || !indexes.has(link.to)) throw new RangeError('Thermal link references an unknown zone.');
      if (link.from === link.to) throw new RangeError('Thermal self-links are not supported.');
      return {
        from: indexes.get(link.from), to: indexes.get(link.to),
        conductance: nonnegative(link.conductanceW_K, 'link.conductanceW_K')
      };
    });
    let expectedTimestamp = null;
    const timestamped = input.steps.length > 0 && own(object(input.steps[0], 'steps[0]'), 'timestamp');
    const steps = input.steps.map((step, i) => {
      const name = 'steps[' + i + ']';
      keys(step, ['durationSeconds', 'outdoorC', 'gainsW', 'timestamp'], name);
      const duration = positive(step.durationSeconds, name + '.durationSeconds');
      const outdoor = temperature(step.outdoorC, name + '.outdoorC');
      object(step.gainsW, name + '.gainsW');
      for (const id of Object.keys(step.gainsW)) {
        if (!indexes.has(id)) throw new RangeError(name + '.gainsW contains an unknown zone: ' + id);
      }
      const gains = zones.map(zone => {
        if (!own(step.gainsW, zone.id)) throw new TypeError(name + '.gainsW must explicitly supply ' + zone.id + ' (use 0 for no gains).');
        return finite(step.gainsW[zone.id], name + '.gainsW.' + zone.id);
      });
      if (own(step, 'timestamp') !== timestamped) throw new TypeError('Supply an interval-start timestamp for every thermal step, or for none.');
      let timestamp = null;
      if (timestamped) {
        timestamp = utcTimestamp(step.timestamp, name + '.timestamp');
        if (!Number.isSafeInteger(duration * 1000)) throw new RangeError('Timestamped durations must be representable in whole milliseconds.');
        if (expectedTimestamp !== null && timestamp !== expectedTimestamp) throw new RangeError('Thermal timestamps must be contiguous interval starts; gaps/overlap are not filled.');
        expectedTimestamp = timestamp + duration * 1000;
        if (!Number.isFinite(expectedTimestamp) || Math.abs(expectedTimestamp) > 8640000000000000) throw new RangeError('Thermal interval end exceeds the timestamp range.');
      }
      return { duration, outdoor, gains, timestamp };
    });

    const warnings = [
      'Uncalibrated lumped sensible-heat RC scenario using backward Euler; not an empirically validated indoor-temperature prediction.',
      'Initial temperatures and effective capacities are supplied explicitly. No warmup is performed; repeat a suitable schedule and check convergence externally if warmup is needed.',
      'Gains and conductances are piecewise constant per interval. No automatic solar gains, air heat capacity, ventilation cooling, HVAC, moisture or comfort model is added.'
    ];
    if (!steps.length) warnings.push('No thermal intervals supplied; only the initial condition is returned.');
    const temperatures = zones.map(zone => zone.initial);
    let elapsed = 0;
    function sample(timestamp) {
      const value = { elapsedSeconds: elapsed, temperaturesC: Object.fromEntries(zones.map((zone, i) => [zone.id, temperatures[i]])) };
      if (timestamp !== null) value.timestamp = new Date(timestamp).toISOString();
      return value;
    }
    const samples = [sample(timestamped ? steps[0].timestamp : null)];
    const balances = [];
    let maximumZoneResidual = 0;
    const unresolvedEnergy = new Set();
    const runResiduals = [];
    for (const step of steps) {
      const previous = temperatures.slice();
      const rates = zones.map(zone => positive(computed(zone.capacity / step.duration, 'Capacity/timestep'), 'Capacity/timestep'));
      const matrix = zones.map((zone, i) => zones.map((_, j) => i === j ? computed(rates[i] + zone.outside, 'Thermal diagonal') : 0));
      const rightTerms = zones.map((zone, i) => [step.gains[i], computed(zone.outside * (step.outdoor - previous[i]), 'Outdoor heat rate')]);
      for (const link of links) {
        const { from, to, conductance } = link;
        matrix[from][from] = computed(matrix[from][from] + conductance, 'Thermal diagonal');
        matrix[to][to] = computed(matrix[to][to] + conductance, 'Thermal diagonal');
        matrix[from][to] = computed(matrix[from][to] - conductance, 'Thermal off-diagonal');
        matrix[to][from] = computed(matrix[to][from] - conductance, 'Thermal off-diagonal');
        const heat = computed(conductance * (previous[to] - previous[from]), 'Interzone heat rate');
        rightTerms[from].push(heat);
        rightTerms[to].push(-heat);
      }
      // Solve increments rather than absolute Celsius values: equal-temperature,
      // adiabatic states have an exactly zero right-hand side.
      const changes = choleskySolve(matrix, rightTerms.map(sum));
      zones.forEach((zone, i) => {
        temperatures[i] = temperature(computed(previous[i] + changes[i], 'Thermal temperature'), 'Temperature for ' + zone.id);
      });
      const stored = zones.map((zone, i) => computed(zone.capacity * (temperatures[i] - previous[i]), 'Stored heat'));
      const outdoorEnergy = zones.map((zone, i) => computed(step.duration * zone.outside * (step.outdoor - temperatures[i]), 'Outdoor heat'));
      const gainsEnergy = step.gains.map(gain => computed(step.duration * gain, 'Gain energy'));
      const interzone = zones.map(() => []);
      const transfers = links.map(link => {
        const energy = computed(step.duration * link.conductance * (temperatures[link.from] - temperatures[link.to]), 'Interzone energy');
        interzone[link.from].push(-energy);
        interzone[link.to].push(energy);
        return { from: zones[link.from].id, to: zones[link.to].id, energyJ: energy };
      });
      const residuals = zones.map((_, i) => sum([stored[i], -outdoorEnergy[i], -gainsEnergy[i], -sum(interzone[i])]));
      residuals.forEach((residual, i) => {
        const scale = Math.max(Math.abs(stored[i]), Math.abs(outdoorEnergy[i]), Math.abs(gainsEnergy[i]), ...interzone[i].map(Math.abs));
        if (Math.abs(residual) > 1e-6 + 1e-10 * scale) unresolvedEnergy.add(zones[i].id);
      });
      maximumZoneResidual = Math.max(maximumZoneResidual, ...residuals.map(Math.abs));
      const residual = sum(residuals);
      runResiduals.push(residual);
      const nextElapsed = computed(elapsed + step.duration, 'Elapsed thermal time');
      if (nextElapsed <= elapsed) throw new RangeError('Thermal duration is below the elapsed-time numerical resolution.');
      elapsed = nextElapsed;
      balances.push({
        elapsedSeconds: elapsed,
        storedEnergyChangeJ: sum(stored),
        outdoorEnergyJ: sum(outdoorEnergy),
        gainsEnergyJ: sum(gainsEnergy),
        interzoneTransfers: transfers,
        residualJ: residual,
        zoneResidualsJ: Object.fromEntries(zones.map((zone, i) => [zone.id, residuals[i]]))
      });
      samples.push(sample(timestamped ? step.timestamp + step.duration * 1000 : null));
    }
    if (unresolvedEnergy.size) {
      warnings.push('Numerical energy-balance accuracy is unresolved for ' + [...unresolvedEnergy].join(', ') +
        '; temperature outputs are diagnostic, not a balanced thermal solution. Review the energy ledger and input scales.');
    }
    return {
      samples,
      energyResidualJ: sum(runResiduals),
      maxZoneEnergyResidualJ: maximumZoneResidual,
      energyBalances: balances,
      warnings
    };
  }

  return Object.freeze({ assemblyProperties, shadowAt, surfaceExposure, solveAirflow, simulateThermal });
}));
