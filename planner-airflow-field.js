(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./planner-regions.js') : root.HomePlannerRegions);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerAirflowField = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Regions) {
  'use strict';
  const LIMITS = Object.freeze({ cells: 4096, coordinateLines: 256, regionTests: 1000000, iterations: 4096 });
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const finite = (value, label) => {
    if (!Number.isFinite(value)) throw new RangeError(`${label} exceeds the finite numerical range.`);
    return value;
  };
  const positive = (value, label) => {
    finite(value, label); if (!(value > 0)) throw new RangeError(`${label} must be positive.`); return value;
  };
  const sum = values => values.reduce((total, value) => total + value, 0);
  const near = (a, b) => Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  const sameRef = (a, b) => a?.floorId === b?.floorId && a?.entityId === b?.entityId;
  const sides = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

  function grid(zone, ports, spacing, budget, walls = []) {
    const bounds = zone.geometry?.rect, regions = zone.geometry?.usableRegions || (bounds ? [bounds] : []);
    if (!Regions?.area || !Regions?.subtractRectangle) throw new Error('Load planner-regions.js for the 2D usable-region mesh.');
    Regions.area([bounds]);
    const area = positive(Regions.area(regions), 'Usable zone area');
    if (regions.some(region => Regions.subtractRectangle(region, [bounds]).length))
      throw new Error('A usable region leaves its supplied room bounds.');
    const depth = positive(zone.volumeM3 / area, 'Declared clear volume / usable area');
    const module = zone.geometry.module;
    if (module) {
      Regions.area([module]);
      if (Regions.subtractRectangle(bounds, [module]).length) throw new Error('The supplied wall module does not contain the clear room bounds.');
    }
    const floorWalls = walls.filter(wall => wall.ref.floorId === zone.roomRef.floorId && !wall.removed);
    budget.regionTests += floorWalls.length * regions.length;
    if (budget.regionTests > LIMITS.regionTests) throw new RangeError('2D wall/air-region validation budget exceeded.');
    for (const wall of floorWalls) {
      const { start, end } = wall, thickness = positive(wall.thicknessM, 'Physical wall thickness');
      if (!start || !end) throw new Error('Physical wall coordinates are unavailable for the 2D air-region check.');
      let footprint;
      if (near(start.x, end.x) && !near(start.y, end.y))
        footprint = { x: start.x - thickness / 2, y: Math.min(start.y, end.y), w: thickness, h: Math.abs(end.y - start.y) };
      else if (near(start.y, end.y) && !near(start.x, end.x))
        footprint = { x: Math.min(start.x, end.x), y: start.y - thickness / 2, w: Math.abs(end.x - start.x), h: thickness };
      else throw new Error('The 2D air-region model needs axis-aligned wall footprints.');
      if (regions.some(region => Regions.intersection(region, footprint)))
        throw new Error('A physical wall occupies supplied usable air area. Region-aware wall partitioning is required; this field will not pass through it. The pressure-network tables remain available.');
    }
    function lines(axis, length) {
      const start = bounds[axis], size = bounds[length], count = Math.ceil(size / spacing);
      if (!Number.isSafeInteger(count) || count + 1 > LIMITS.coordinateLines)
        throw new RangeError('2D mesh coordinate budget exceeded; increase the numerical spacing.');
      const values = Array.from({ length: count + 1 }, (_, i) => start + size * i / count);
      for (const region of regions) values.push(region[axis], region[axis] + region[length]);
      for (const port of ports) for (const point of [port.geometry.start, port.geometry.end])
        if (point[axis] > start && point[axis] < start + size) values.push(point[axis]);
      values.sort((a, b) => a - b);
      const unique = values.filter((value, i) => !i || !near(value, values[i - 1]));
      if (unique.length > LIMITS.coordinateLines) throw new RangeError('2D mesh boundary budget exceeded; simplify the selected network.');
      return unique;
    }
    const xs = lines('x', 'w'), ys = lines('y', 'h');
    budget.regionTests += (xs.length - 1) * (ys.length - 1) * regions.length;
    if (budget.regionTests > LIMITS.regionTests) throw new RangeError('2D region/mesh test budget exceeded; increase spacing or reduce selected rooms.');
    const cells = [], indices = new Map();
    for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
      const rect = { x: xs[x], y: ys[y], w: xs[x + 1] - xs[x], h: ys[y + 1] - ys[y] };
      const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      if (!regions.some(r => center.x > r.x && center.x < r.x + r.w && center.y > r.y && center.y < r.y + r.h)) continue;
      if (++budget.cells > LIMITS.cells) throw new RangeError('2D mesh cell budget exceeded; increase spacing or reduce selected rooms. No cells were truncated.');
      positive(rect.w * rect.h, 'Mesh cell area');
      indices.set(`${x},${y}`, cells.length);
      cells.push({ rect, center, x, y, neighbors: [], boundary: [0, 0, 0, 0], potential: 0 });
    }
    if (!cells.length) throw new Error('No usable air cells remain in this room.');
    for (const cell of cells) for (let side = 0; side < sides.length; side++) {
      const dir = sides[side], id = indices.get(`${cell.x + dir.x},${cell.y + dir.y}`);
      if (id === undefined) continue;
      const other = cells[id], length = dir.x ? cell.rect.h : cell.rect.w;
      const distance = dir.x ? Math.abs(cell.center.x - other.center.x) : Math.abs(cell.center.y - other.center.y);
      cell.neighbors.push({ id, side, conductance: positive(depth * length / distance, 'Face conductance') });
    }
    const mappedPorts = [];
    for (const port of ports) {
      const { start, end } = port.geometry;
      const vertical = near(start.x, end.x), horizontal = near(start.y, end.y);
      if (vertical === horizontal) throw new Error('The potential-flow mesh requires a nonzero axis-aligned physical aperture.');
      const thickness = positive(port.geometry.wallThicknessM, 'Supplied aperture wall thickness');
      const lower = vertical ? Math.min(start.y, end.y) : Math.min(start.x, end.x);
      const upper = vertical ? Math.max(start.y, end.y) : Math.max(start.x, end.x);
      const faces = [];
      for (let id = 0; id < cells.length; id++) {
        const cell = cells[id];
        for (const side of vertical ? [0, 1] : [2, 3]) {
          if (cell.neighbors.some(edge => edge.side === side)) continue;
          const dir = sides[side], face = vertical ? cell.rect.x + (side === 1 ? cell.rect.w : 0)
            : cell.rect.y + (side === 3 ? cell.rect.h : 0);
          const wall = vertical ? start.x : start.y;
          const projection = dir.x * (start.x - cell.center.x) + dir.y * (start.y - cell.center.y);
          const margin = !module ? 0 : side === 0 ? bounds.x - module.x : side === 1
            ? module.x + module.w - bounds.x - bounds.w : side === 2 ? bounds.y - module.y
              : module.y + module.h - bounds.y - bounds.h;
          if (!(projection > 0) || Math.abs(face - wall) > thickness / 2 + margin + 1e-7) continue;
          const lo = vertical ? cell.rect.y : cell.rect.x, hi = lo + (vertical ? cell.rect.h : cell.rect.w);
          const length = Math.min(hi, upper) - Math.max(lo, lower);
          if (length > 1e-9) faces.push({ id, side, length, projectionM: Math.abs(face - wall) });
        }
      }
      const covered = sum(faces.map(face => face.length));
      if (!faces.length || Math.abs(covered - (upper - lower)) > 1e-7 * Math.max(1, upper - lower))
        throw new Error(`Opening ${port.id} does not map uniquely onto its room's usable boundary. No source was moved or invented.`);
      for (const face of faces) cells[face.id].boundary[face.side] -= port.inflowM3s * face.length / covered;
      mappedPorts.push({ linkId: port.id, inflowM3s: port.inflowM3s, coveredWidthM: covered,
        faces: faces.map(face => ({ cell: face.id, side: face.side, widthM: face.length, normalProjectionM: face.projectionM })) });
    }
    return { cells, area, depth, mappedPorts };
  }

  function solve(mesh) {
    const { cells } = mesh, unseen = new Set(cells.map((_, i) => i));
    const components = [];
    let iterations = 0, maximumResidualM3s = 0;
    while (unseen.size) {
      const ids = [unseen.values().next().value]; unseen.delete(ids[0]);
      for (let cursor = 0; cursor < ids.length; cursor++)
        for (const edge of cells[ids[cursor]].neighbors) if (unseen.delete(edge.id)) ids.push(edge.id);
      const rhs = new Map(ids.map(id => [id, -sum(cells[id].boundary)]));
      const totalForcing = sum(ids.map(id => sum(cells[id].boundary.map(Math.abs))));
      const tolerance = totalForcing ? positive(totalForcing * 1e-8, 'Potential solver relative tolerance') : 1e-12;
      const imbalance = sum([...rhs.values()]);
      if (Math.abs(imbalance) > tolerance)
        throw new Error('A disconnected usable air region has unbalanced inlet/outlet flow. The field cannot cross a reserved footprint or a closed wall.');
      const free = ids.slice(1), local = new Map(free.map((id, i) => [id, i]));
      const diagonal = free.map(id => sum(cells[id].neighbors.map(edge => edge.conductance)));
      const multiply = vector => free.map((id, i) => diagonal[i] * vector[i] -
        sum(cells[id].neighbors.map(edge => local.has(edge.id) ? edge.conductance * vector[local.get(edge.id)] : 0)));
      const dot = (a, b) => finite(a.reduce((total, value, i) => total + value * b[i], 0), 'Potential solver dot product');
      const phi = new Array(free.length).fill(0), residual = free.map(id => rhs.get(id));
      let z = residual.map((value, i) => value / positive(diagonal[i], 'Potential solver diagonal'));
      let direction = [...z], rz = dot(residual, z), step = 0;
      while (residual.some(value => Math.abs(value) > tolerance / Math.max(1, ids.length))) {
        if (step++ >= LIMITS.iterations) throw new Error('2D potential solver did not converge within its iteration budget. No velocity field was published for this room.');
        const applied = multiply(direction), denominator = dot(direction, applied);
        if (!(denominator > 0) || !(rz > 0)) throw new Error('2D potential solver lost numerical conditioning; refine the geometry or spacing.');
        const alpha = finite(rz / denominator, 'Potential solver step');
        for (let i = 0; i < phi.length; i++) { phi[i] += alpha * direction[i]; residual[i] -= alpha * applied[i]; }
        z = residual.map((value, i) => value / diagonal[i]);
        const next = dot(residual, z), beta = finite(next / rz, 'Potential solver direction');
        direction = z.map((value, i) => value + beta * direction[i]); rz = next;
      }
      iterations += step;
      free.forEach((id, i) => { cells[id].potential = finite(phi[i], 'Potential'); });
      let maximum = 0;
      for (const id of ids) {
        const cell = cells[id], flux = [...cell.boundary];
        for (const edge of cell.neighbors)
          flux[edge.side] = finite(edge.conductance * (cell.potential - cells[edge.id].potential), 'Face flow');
        const residualM3s = finite(sum(flux), 'Cell conservation residual');
        maximum = Math.max(maximum, Math.abs(residualM3s));
        cell.velocity = {
          x: finite((flux[1] - flux[0]) / (2 * mesh.depth * cell.rect.h), 'Cell x velocity'),
          y: finite((flux[3] - flux[2]) / (2 * mesh.depth * cell.rect.w), 'Cell y velocity')
        };
        cell.residualM3s = residualM3s;
      }
      if (maximum > tolerance * 2) throw new Error('2D face-flow conservation tolerance was not met; no velocity field was published for this room.');
      maximumResidualM3s = Math.max(maximumResidualM3s, maximum);
      components.push({ cells: ids.length, netBoundaryFlowM3s: -imbalance, toleranceM3s: tolerance, maximumResidualM3s: maximum });
    }
    return { iterations, maximumResidualM3s, components };
  }

  function run(network, settings) {
    if (network?.kind !== 'AirflowResult' || network.version !== 1) throw new TypeError('Use a version 1 selected-network AirflowResult.');
    const output = { version: 1, kind: 'AirflowPlanField', engineId: 'HomePlannerAirflowField',
      method: 'finite-volume potential flow', units: 'm/s', coordinateSpace: 'site-local',
      inputFingerprint: network.provenance?.inputFingerprint ?? null,
      status: 'unavailable', cells: [], rooms: [], findings: [],
      assumptions: [
        'Uncalibrated 2D depth-averaged potential-flow estimate, not validated CFD or measured occupant-level velocity.',
        'Each room uses uniform model depth = explicitly declared clear volume / supplied usable floor area.',
        'Actual solved opening fluxes are projected across their supplied boundary spans; no wind or forcing is invented.',
        'Aperture-to-carpet normal projection is bounded by supplied wall thickness and the supplied module/carpet allowance; each offset is recorded.',
        'No viscosity, turbulence, buoyancy, jet entrainment, furniture drag, vertical mixing or single-sided exchange.',
        'Reserved footprints and walls bounding usable regions are impermeable. Only selected-network connections supply flux.'
      ] };
    const finish = () => freeze(copy(output));
    if (network.status !== 'converged' || network.balanced !== true || network.solver?.converged !== true) {
      output.findings.push({ code: 'network-unavailable', message: 'A converged balanced selected network is required for a velocity estimate.' }); return finish();
    }
    if (settings?.enabled !== true || !Number.isFinite(settings.spacingM) || settings.spacingM <= 0) {
      output.findings.push({ code: 'field-settings', message: 'Explicitly enable the 2D estimate and supply positive numerical mesh spacing.' }); return finish();
    }
    const budget = { cells: 0, regionTests: 0 };
    for (const zone of network.zones) {
      const room = { zoneId: zone.id, roomRef: copy(zone.roomRef), status: 'unavailable' };
      output.rooms.push(room);
      try {
        const ports = [];
        for (const flow of network.flowResults) {
          if (flow.from !== zone.id && flow.to !== zone.id || flow.m3s === 0) continue;
          finite(flow.m3s, 'Opening volume flow');
          if (flow.kind !== 'opening' || !flow.geometry ||
              !network.inventory.openings.some(opening => sameRef(opening.ref, flow.openingRef)))
            throw new Error('A nonzero manual connection has no verified aperture boundary for this field. Its network result remains in the tables.');
          ports.push({ id: flow.id, geometry: flow.geometry, inflowM3s: flow.to === zone.id ? flow.m3s : -flow.m3s });
        }
        const mesh = grid(zone, ports, settings.spacingM, budget, network.inventory.walls || []), solved = solve(mesh);
        Object.assign(room, { status: 'complete', usableAreaM2: mesh.area, modelDepthM: mesh.depth,
          cellCount: mesh.cells.length, ports: mesh.mappedPorts, ...solved });
        mesh.cells.forEach((cell, index) => output.cells.push({
          id: JSON.stringify([zone.id, index]), zoneId: zone.id, floorId: zone.roomRef.floorId, roomRef: copy(zone.roomRef),
          rect: cell.rect, point: cell.center, velocityMps: cell.velocity,
          speedMps: finite(Math.hypot(cell.velocity.x, cell.velocity.y), 'Velocity magnitude'),
          conservationResidualM3s: cell.residualM3s
        }));
      } catch (error) {
        room.message = error.message;
        output.findings.push({ code: 'room-field-unavailable', roomRef: copy(zone.roomRef), message: error.message });
      }
    }
    output.status = output.rooms.length && output.rooms.every(room => room.status === 'complete') ? 'complete'
      : output.cells.length ? 'partial' : 'unavailable';
    output.maximumSpeedMps = output.cells.length ? Math.max(...output.cells.map(cell => cell.speedMps)) : null;
    output.spacingM = settings.spacingM;
    return finish();
  }
  return Object.freeze({ LIMITS, run });
});
