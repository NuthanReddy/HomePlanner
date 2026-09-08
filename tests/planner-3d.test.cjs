const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../planner-3d.js');
const Model = require('../planner-model.js');

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `Expected ${actual} ≈ ${expected}`);
const area = grid => grid.cells.reduce((sum, c) => sum + (c.endM - c.startM) * (c.topM - c.bottomM), 0);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function fixture() {
  return {
    scene: {
      floorId: 'ground', headingDeg: 0, floorElevationM: 0, wallHeightM: 3,
      floor: { x: 0, y: 0, w: 10, h: 8 }, building: { x: 1, y: 1, w: 8, h: 6 },
      rooms: [], furniture: [], walls: [], openings: [], obstacles: [], diagnostics: []
    },
    wall: {
      id: 'ground:wall', start: { x: 1, y: 2 }, end: { x: 9, y: 2 },
      thicknessM: .2, heightM: 3, baseM: 0, removed: false,
      solidSegments: [{ startM: 0, endM: 2 }, { startM: 4, endM: 8 }]
    },
    opening: {
      id: 'ground:window', wallId: 'ground:wall', kind: 'window',
      offsetM: 2, widthM: 2, sillM: 1, heightM: 1, openFraction: 0
    }
  };
}

function stackedFixture() {
  const { scene, wall, opening } = fixture();
  wall.end.x = 7;
  wall.solidSegments = [{ startM: 0, endM: 2 }, { startM: 3, endM: 6 }];
  const holes = [
    { ...opening, kind: 'hinged', widthM: 1, sillM: 0, heightM: 1.6 },
    { ...opening, widthM: 1, sillM: 2, heightM: .8 }
  ];
  const exact = { ...wall, solidSections: [
    { startM: 0, endM: 2, sillM: 0, heightM: 3 },
    { startM: 3, endM: 6, sillM: 0, heightM: 3 },
    { startM: 2, endM: 3, sillM: 1.6, heightM: .4 },
    { startM: 2, endM: 3, sillM: 2.8, heightM: .2 }
  ] };
  return { scene, wall, holes, exact };
}

async function checkWallRays(wall, openings, scene, samples) {
  const THREE = await import('../vendor/three/three.module.min.js');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(View.wallSurfaceData(wall, openings, scene), 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  try {
    for (const [x, height, expected] of samples) {
      const p = View.toThree({ x, y: 1 }, scene, height);
      ray.set(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, 0, 1));
      assert.equal(ray.intersectObject(mesh).length > 0, expected, `Ray at local x=${x}, elevation=${height}`);
    }
  } finally { View.disposeObject(mesh); }
}

test('local-to-Three coordinates agree with model ENU at every cardinal heading', () => {
  const { scene } = fixture();
  for (const headingDeg of [0, 90, 180, 270]) {
    for (const point of [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 6, y: 4 }]) {
      const frame = { ...scene, headingDeg, floorElevationM: 7 };
      const actual = View.toThree(point, frame, 7);
      const world = Model.localToWorld({ ...point, z: 7 }, frame);
      close(actual.x, world.east); close(actual.y, world.up); close(actual.z, -world.north);
    }
  }
});

test('window intervals retain sills and lintels while leaving the aperture empty', () => {
  const { wall, opening, scene } = fixture();
  const grid = View.wallGrid(wall, [opening]);
  close(area(grid), 22);
  assert.ok(!grid.cells.some(c => c.startM < 3 && c.endM > 3 && c.bottomM < 1.5 && c.topM > 1.5));
  assert.ok(grid.cells.some(c => c.startM < 3 && c.endM > 3 && c.topM === 1));
  assert.ok(grid.cells.some(c => c.startM < 3 && c.endM > 3 && c.bottomM === 2));
  assert.ok(View.wallSurfaceData(wall, [opening], scene).every(Number.isFinite));
});

test('removed walls and full-height gaps do not acquire infill', () => {
  const { wall, opening, scene } = fixture();
  assert.equal(View.wallSurfaceData({ ...wall, removed: true }, [opening], scene).length, 0);
  close(area(View.wallGrid(wall, [])), 18);
  close(area(View.wallGrid(wall, [{ ...opening, kind: 'passage', sillM: 0, heightM: 3 }])), 18);
});

test('edge and full-width windows retain their sill/head bands', () => {
  const { wall, opening } = fixture();
  close(area(View.wallGrid({ ...wall, solidSegments: [] }, [{ ...opening, offsetM: 0, widthM: 8 }])), 16);
  close(area(View.wallGrid({ ...wall, solidSegments: [{ startM: 2, endM: 8 }] }, [{ ...opening, offsetM: 0 }])), 22);
});

test('overlapping aperture rectangles are subtracted once as a union', () => {
  const { wall, opening } = fixture();
  close(area(View.wallGrid({ ...wall, solidSegments: [{ startM: 0, endM: 8 }] },
    [opening, { ...opening, offsetM: 3 }])), 21);
});

test('exact solidSections and legacy union cuts preserve vertically stacked holes', () => {
  const { wall, exact, holes, scene } = freeze(stackedFixture());
  close(area(View.wallGrid(exact, holes)), 15.6);
  close(area(View.wallGrid(wall, holes)), 15.6);
  assert.deepEqual(View.wallSurfaceData(exact, holes, scene), View.wallSurfaceData(wall, holes, scene));
});

test('solidSections take precedence, including an empty set, without duplicating overlapping solids', () => {
  const { wall, exact, holes, scene } = stackedFixture();
  close(area(View.wallGrid(exact, [])), 15.6);
  assert.equal(View.wallSurfaceData({ ...wall, solidSections: [] }, holes, scene).length, 0);
  const duplicate = { ...exact, solidSections: [...exact.solidSections, exact.solidSections[0]] };
  close(area(View.wallGrid(duplicate, holes)), 15.6);
  assert.deepEqual(View.wallSurfaceData(duplicate, holes, scene), View.wallSurfaceData(exact, holes, scene));
});

test('real Three.js rays pass through a window but hit its sill, lintel and piers', async () => {
  const { wall, opening, scene } = fixture();
  await checkWallRays(wall, [opening], scene, [[4, 1.5, false], [4, .5, true], [4, 2.5, true], [7, 1.5, true]]);
});

test('real Three.js rays pass through both stacked holes but hit their separating solid', async () => {
  const { exact, holes, scene } = stackedFixture();
  await checkWallRays(exact, holes, scene, [[3.5, .8, false], [3.5, 1.8, true], [3.5, 2.4, false], [3.5, 2.9, true]]);
});

test('bed pillows follow all four head polarities, independently of footprint shape', () => {
  for (const rect of [{ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 2, w: 2, h: 3 }, { x: 1, y: 2, w: 3, h: 2 }]) {
    for (const head of ['N', 'E', 'S', 'W']) {
      const pillows = View.bedPillows(freeze(rect), head);
      assert.equal(pillows.length, 2);
      for (const p of pillows) {
        assert.ok(p.x >= rect.x && p.y >= rect.y && p.x + p.w <= rect.x + rect.w && p.y + p.h <= rect.y + rect.h);
        if (head === 'N') assert.ok(p.y + p.h / 2 < rect.y + rect.h / 2);
        if (head === 'S') assert.ok(p.y + p.h / 2 > rect.y + rect.h / 2);
        if (head === 'W') assert.ok(p.x + p.w / 2 < rect.x + rect.w / 2);
        if (head === 'E') assert.ok(p.x + p.w / 2 > rect.x + rect.w / 2);
      }
    }
    assert.deepEqual(View.bedPillows(rect, undefined), []);
  }
});

test('door handing uses the model pivot and nominal leaf, applying operating fraction exactly once', () => {
  const { wall, opening } = fixture();
  const model = {
    doorGeometry(input, host) {
      assert.equal(input.openFraction, 1, 'Ask the model for full swing before applying the operating fraction');
      return Model.doorGeometry(input, host);
    }
  };
  for (const hinge of ['start', 'end']) for (const swing of ['left', 'right']) {
    const door = { ...opening, kind: 'hinged', widthM: 1, nominalLeafWidthM: .85, hinge, swing };
    const geometry = Model.doorGeometry(door, wall);
    const dx = geometry.closedEnd.x - geometry.hinge.x, dy = geometry.closedEnd.y - geometry.hinge.y;
    for (const openFraction of [0, .5, 1]) {
      const input = freeze({ ...door, openFraction }), before = JSON.stringify(input);
      const leaf = View.doorLeaf(input, wall, model);
      assert.deepEqual(leaf.hinge, geometry.hinge);
      const x = leaf.end.x - leaf.hinge.x, y = leaf.end.y - leaf.hinge.y;
      close(Math.hypot(x, y), .85);
      close(Math.abs(Math.atan2(dx * y - dy * x, dx * x + dy * y)), openFraction * Math.PI / 2);
      if (openFraction !== .5) {
        const endpoint = openFraction ? geometry.openEnd : geometry.closedEnd;
        close(leaf.end.x, endpoint.x); close(leaf.end.y, endpoint.y);
      }
      assert.equal(JSON.stringify(input), before);
    }
  }
});

test('saved sun direction remains geographic, with labelled below-horizon and neutral fallbacks', () => {
  const project = freeze({ site: { timeZone: 'UTC' }, environment: { sunSelection: { date: '2026-01-01', time: '00:00' } } });
  const vector = freeze({ east: 0, north: 1, up: -.1 });
  const result = View.resolveSun(project, { calculate: () => ({ vector }) });
  assert.equal(result.vector, vector);
  assert.match(result.label, /below the horizon/);
  assert.match(View.resolveSun(project, { calculate() { throw new Error('Invalid date'); } }).label, /Neutral inspection light/);
  assert.match(View.resolveSun({ environment: {} }).label, /Neutral inspection light/);
});

test('storeys stack once with namespaced selection and presentation-only caps/filtering on frozen scenes', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const { scene, wall, opening } = fixture();
  const ground = { ...scene, walls: [wall, wall], openings: [opening],
    rooms: [{ id: 'ground:room', label: 'Living', rect: { x: 1, y: 1, w: 3, h: 3 } }] };
  const upper = { ...scene, floorId: 'upper', floorElevationM: 3,
    rooms: [{ id: 'upper:room', label: 'Bedroom', rect: { x: 1, y: 1, w: 3, h: 3 } }] };
  const project = freeze({ activeFloorId: 'upper', building: { roofThicknessM: .15 },
    floors: [{ id: 'ground', name: 'Ground' }, { id: 'upper', name: 'Upper' }] });
  const scenes = freeze([ground, upper]), before = JSON.stringify([scenes, project]);
  const all = View.buildContent(THREE, scenes, project, Model, { cutaway: true });
  let active;
  try {
    active = View.buildContent(THREE, scenes, project, Model, { activeOnly: true, cutaway: false });
    assert.equal(all.floors.length, 2); assert.equal(all.roofs.length, 2);
    assert.ok(all.roofs.every(roof => !roof.visible));
    assert.equal(all.refs.get('wall\0ground:wall').objects.length, 1);
    close(all.refs.get('room\0ground:room').objects[0].position.y, .01);
    close(all.refs.get('room\0upper:room').objects[0].position.y, 3.01);
    assert.equal(active.floors.length, 1); assert.equal(active.floors[0].id, 'upper');
    assert.ok(active.roofs[0].visible);
    all.roofs.forEach(roof => { roof.visible = true; });
    assert.equal(JSON.stringify([scenes, project]), before);
  } finally { View.disposeObject(all.group); if (active) View.disposeObject(active.group); }
});

for (const kind of ['hinged', 'sliding', 'window']) {
  test(`canonical full-wall ${kind} infill survives removed masonry`, async () => {
    const THREE = await import('../vendor/three/three.module.min.js');
    const { scene, wall, opening } = fixture();
    const host = { ...wall, removed: true, solidSegments: [], solidSections: [] };
    const full = { ...opening, kind, offsetM: 0, widthM: 8, sillM: 0, heightM: 3,
      hinge: 'start', swing: 'left', openFraction: 0 };
    const scenes = freeze([{ ...scene, walls: [host], openings: [full] }]);
    const project = freeze({ activeFloorId: 'ground', building: { roofThicknessM: .15 },
      floors: [{ id: 'ground', name: 'Ground' }] });
    const content = View.buildContent(THREE, scenes, project, Model, { cutaway: true });
    try {
      assert.equal(content.refs.has(`wall\0${wall.id}`), false);
      const entry = content.refs.get(`${kind === 'window' ? 'window' : 'door'}\0${full.id}`);
      assert.ok(entry, 'A canonical opening must retain its infill even when no masonry survives');
      const infill = entry.objects.filter(mesh => kind === 'hinged' ?
        mesh.geometry.parameters.depth === View.PREVIEW.doorLeafM : mesh.material.transparent);
      assert.equal(infill.length, 1);
      assert.ok(content.pickables.includes(infill[0]));
      const p = View.toThree({ x: 5, y: 1 }, scene, 1.5);
      const ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, 0, 1));
      assert.ok(ray.intersectObject(infill[0]).length > 0, 'The closed leaf/glass still forms a pickable barrier');
    } finally { View.disposeObject(content.group); }
  });
}

test('partition passages do not resurrect their unresolved door/window attachments', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const { scene, wall, opening } = fixture();
  const host = { ...wall, removed: true, solidSegments: [], solidSections: [] };
  const passage = { ...opening, kind: 'passage', offsetM: 0, widthM: 8, sillM: 0, heightM: 3, openFraction: 1 };
  const scenes = freeze([{ ...scene, walls: [host], openings: [passage],
    unresolvedOpenings: [opening, { ...opening, id: 'ground:door', kind: 'hinged' }] }]);
  const project = { activeFloorId: 'ground', building: { roofThicknessM: .15 }, floors: [{ id: 'ground', name: 'Ground' }] };
  const content = View.buildContent(THREE, scenes, project, Model, { cutaway: true });
  try { assert.equal(content.refs.size, 0); }
  finally { View.disposeObject(content.group); }
});

test('model-emitted solidSections agree with model wall areas and legacy fallback geometry', () => {
  const project = Model.createProject();
  const placed = (id, x) => ({ req: { id, type: 'living', label: id },
    module: { x, y: .7, w: 4.3, h: 6.6 }, carpet: { x: x + .05, y: .75, w: 4.2, h: 6.5 } });
  const context = {
    plate: { frontEdge: 'N' },
    g: { W: 10, D: 8, outerX: .5, outerY: .5, outerW: 9, outerD: 7, coreX: .7, coreY: .7, coreW: 8.6, coreD: 6.6 },
    cfg: { walls: { external: .2, internal: .1 } },
    plan: { placed: [placed('a', .7), placed('b', 5)], furniture: [], wallOpenings: [], customOpenings: [],
      openings: { doors: [], windows: [{ id: 'win-a-N', roomId: 'a', edge: 'N', width: 1, height: 1.2,
        segment: { x1: 2, y1: .7, x2: 3, y2: .7 } }] } }
  };
  const scene = freeze(Model.buildScene(freeze(context), freeze(project)));
  let total = 0;
  for (const wall of scene.walls) {
    assert.ok(Array.isArray(wall.solidSections));
    const openings = scene.openings.filter(o => o.wallId === wall.id), legacy = { ...wall };
    delete legacy.solidSections;
    const exactArea = area(View.wallGrid(wall, openings));
    close(exactArea, area(View.wallGrid(legacy, openings)));
    total += exactArea;
  }
  close(total, scene.metrics.solidWallFaceAreaM2);
});

test('disposal releases shared geometries, materials and textures exactly once', async () => {
  const THREE = await import('../vendor/three/three.module.min.js');
  const geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const counts = new Map([geometry, material, texture].map(resource => [resource, 0]));
  counts.forEach((_, resource) => resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)));
  View.disposeObject(group);
  counts.forEach(count => assert.equal(count, 1));
});
