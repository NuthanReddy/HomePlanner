const Model = require('../../planner-model.js');
const { createController } = require('../../planner-bridge.js');

const clone = value => JSON.parse(JSON.stringify(value));
const floorFields = ['wallEdits', 'doorEdits', 'windowEdits', 'furnitureEdits', 'obstacles', 'electrical'];

function room(id, type, label, module, seq) {
  return {
    req: { id, type, label, seq },
    module,
    carpet: { x: module.x + .05, y: module.y + .05, w: module.w - .1, h: module.h - .1 }
  };
}

function context(width = 10, depth = 8) {
  return {
    plate: { frontEdge: 'N', width, depth },
    g: {
      W: width, D: depth, outerX: .5, outerY: .5, outerW: width - 1, outerD: depth - 1,
      coreX: .7, coreY: .7, coreW: width - 1.4, coreD: depth - 1.4,
      frontEdge: 'N', corridors: [], balconies: []
    },
    cfg: { walls: { external: .2, internal: .1 }, ceilingHeight: 2.8, window: { operability: .5 } },
    plan: {
      placed: [], furniture: [], flexSpaces: [],
      openings: { doors: [], windows: [] }, wallOpenings: [], customOpenings: []
    }
  };
}

function floor(id, name, ctx, heightM = 3.2, wallHeightM = 2.8) {
  return {
    id, name, heightM, wallHeightM,
    legacy: { controls: {}, manualLayouts: [], context: ctx },
    wallEdits: {}, doorEdits: {}, windowEdits: {}, furnitureEdits: {}, obstacles: [], electrical: []
  };
}

function syncActive(project) {
  const active = project.floors.find(item => item.id === project.activeFloorId);
  project.legacy = clone(active.legacy);
  project.building.wallHeightM = active.wallHeightM;
  for (const key of floorFields) project[key] = clone(active[key]);
  return project;
}

function projectFor(name, floors) {
  const project = Model.createProject();
  // Replace the only generated identity; do not patch clocks, randomness or production APIs.
  project.id = `fixture-${name}`;
  project.name = `Synthetic acceptance: ${name}`;
  project.floors = floors;
  project.activeFloorId = floors[0].id;
  project.building.floorElevationM = .45;
  return syncActive(project);
}

function furniture(id, roomId, type, x, y, w, h, headLocal = 'N') {
  return { id, roomId, type, label: id, x, y, w, h, headLocal, pinned: false };
}

function furnishedContext() {
  const ctx = context();
  ctx.plan.placed = [
    room('living', 'living', 'Living / dining', { x: .7, y: .7, w: 4.3, h: 3.3 }, 0),
    room('kitchen', 'kitchen', 'Kitchen', { x: 5, y: .7, w: 4.3, h: 3.3 }, 1),
    room('bedroom', 'bedroom', 'Bedroom', { x: .7, y: 4, w: 4.3, h: 3.3 }, 2),
    room('bathroom', 'bathroom', 'Bath / utility', { x: 5, y: 4, w: 4.3, h: 3.3 }, 3)
  ];
  ctx.plan.furniture = [
    furniture('sofa', 'living', 'sofa', 1, 1, 2, .85, 'S'),
    furniture('dining', 'living', 'table', 3.3, 2.4, 1.2, .9),
    furniture('counter', 'kitchen', 'counter', 6, 1, 2.6, .6),
    furniture('bed', 'bedroom', 'bed', 1.1, 4.5, 1.6, 2, 'S'),
    furniture('wardrobe', 'bedroom', 'wardrobe', 3.6, 5, .65, 1.8, 'W'),
    furniture('basin', 'bathroom', 'basin', 7.8, 5, .7, .5)
  ];
  ctx.plan.openings.doors = [
    { id: 'entry', roomId: 'living', edge: 'N', width: .9, segment: { x1: 3.5, y1: .7, x2: 4.4, y2: .7 } },
    { id: 'kitchen-access', roomId: 'kitchen', targetRoomId: 'living', edge: 'W', width: .9,
      segment: { x1: 5, y1: 2.6, x2: 5, y2: 3.5 } },
    { id: 'bedroom-access', roomId: 'bedroom', targetRoomId: 'living', edge: 'N', width: .9,
      segment: { x1: 3.3, y1: 4, x2: 4.2, y2: 4 } },
    { id: 'bathroom-access', roomId: 'bathroom', targetRoomId: 'kitchen', edge: 'N', width: .8,
      segment: { x1: 5.7, y1: 4, x2: 6.5, y2: 4 } }
  ];
  ctx.plan.openings.windows = [
    { id: 'living-window', roomId: 'living', edge: 'N', width: 1.2, heightM: 1.2, sillM: .9,
      segment: { x1: 1.4, y1: .7, x2: 2.6, y2: .7 } },
    { id: 'kitchen-window', roomId: 'kitchen', edge: 'N', width: 1.2, heightM: 1.2, sillM: 1,
      segment: { x1: 6.3, y1: .7, x2: 7.5, y2: .7 } },
    { id: 'bedroom-window', roomId: 'bedroom', edge: 'S', width: 1.2, heightM: 1.2, sillM: .9,
      segment: { x1: 2, y1: 7.3, x2: 3.2, y2: 7.3 } },
    { id: 'bathroom-window', roomId: 'bathroom', edge: 'S', width: .8, heightM: .6, sillM: 1.5,
      segment: { x1: 7, y1: 7.3, x2: 7.8, y2: 7.3 } }
  ];
  return ctx;
}

function furnished(name = 'furnished-single') {
  const ground = floor('ground', 'Ground floor', furnishedContext());
  ground.furnitureEdits['ground:bed'] = { headLocal: 'E', pinned: true };
  ground.doorEdits['ground:bedroom-access'] = { hinge: 'end', swing: 'right', openFraction: .25 };
  ground.windowEdits['ground:living-window'] = { openFraction: .4 };
  return { id: name, project: projectFor(name, [ground]), annotationInputs: [], limitations: [] };
}

function multipleFloors() {
  const fixture = furnished('multiple-floors');
  const upperContext = context();
  upperContext.cfg.ceilingHeight = 2.6;
  upperContext.plan.placed = [
    room('living', 'living', 'Upper studio', { x: .7, y: .7, w: 5.3, h: 6.6 }, 0),
    room('study', 'study', 'Quiet study', { x: 6, y: .7, w: 3.3, h: 6.6 }, 1)
  ];
  upperContext.plan.furniture = [furniture('desk', 'study', 'desk', 7, 2, 1.5, .8, 'E')];
  upperContext.plan.openings.doors = [{
    id: 'study-access', roomId: 'study', targetRoomId: 'living', edge: 'W', width: .9,
    segment: { x1: 6, y1: 3, x2: 6, y2: 3.9 }
  }];
  const upper = floor('upper', 'Upper studio floor', upperContext, 3, 2.6);
  upper.furnitureEdits['upper:desk'] = { headLocal: 'W', pinned: true };
  fixture.project.floors.push(upper);
  const groundScene = Model.buildScene(fixture.project.legacy.context, fixture.project);
  fixture.project.floors[0].electrical = [{
    id: 'ground:point', wallId: groundScene.walls.find(wall => wall.roomIds.includes('ground:living')).id
  }];
  syncActive(fixture.project);
  const upperScene = buildScenes(fixture.project)[1];
  upper.electrical = [{ id: 'upper:point', wallId: upperScene.walls.find(wall => wall.roomIds.includes('upper:study')).id }];
  return fixture;
}

function setbackPlot() {
  const fixture = furnished('setback-plot');
  const ctx = fixture.project.floors[0].legacy.context;
  ctx.plate.frontEdge = ctx.g.frontEdge = 'E';
  Object.assign(ctx.plate, {
    rawDepth: 8, localSetbacks: { N: 3, E: 2, S: 4, W: 1 },
    requiredSetbacks: { N: 3, E: 2, S: 2, W: 2 },
    customSetbacks: true, nonCompliant: true, maxFloors: 4, floors: 3,
    floorElevation: 90
  });
  fixture.project.floors[0].obstacles = [{
    id: 'neighbor', label: 'Assumed neighboring mass', type: 'building',
    x: -4, y: 1, w: 2, h: 3, heightM: 6, baseM: 0, transmittance: 0
  }];
  syncActive(fixture.project);
  fixture.limitations = ['Setbacks and neighbor dimensions are synthetic assumptions, not a survey or planning permission.'];
  return fixture;
}

function sparseUnknown() {
  const ctx = context(6, 5);
  ctx.cfg = {};
  const fixture = {
    id: 'sparse-unknown', project: projectFor('sparse-unknown', [floor('ground', 'Unprogrammed floor', ctx)]),
    annotationInputs: [],
    limitations: [
      'Empty environment and absent plot are unknown, not zero exposure or confirmed empty surroundings.',
      'Schema 1 requires finite site coordinates; default site coordinates are assumptions, not a surveyed location.',
      'Wall thickness uses the existing model fallback; structural role remains unknown.'
    ]
  };
  return fixture;
}

function missingContext() {
  return {
    id: 'missing-context', project: projectFor('missing-context', [floor('ground', 'Not drawn', null)]),
    annotationInputs: [], limitations: ['A saved blank floor is valid schema 1 but has no drawable scene.']
  };
}

function invalidAttachments() {
  const fixture = furnished('invalid-attachments');
  const ground = fixture.project.floors[0];
  const initial = Model.buildScene(ground.legacy.context, fixture.project);
  const removed = initial.walls.find(wall =>
    !wall.exterior && wall.roomIds.includes('ground:living') && wall.roomIds.includes('ground:kitchen'));
  ground.wallEdits[removed.id] = { full: true };
  ground.wallEdits['ground:deleted-wall'] = { full: true };
  ground.doorEdits['ground:deleted-door'] = { widthM: .9 };
  ground.windowEdits['ground:deleted-window'] = { sillM: 1 };
  ground.furnitureEdits['ground:deleted-bed'] = { pinned: true };
  ground.electrical = [
    { id: 'ground:on-removed-wall', wallId: removed.id },
    { id: 'ground:on-missing-wall', anchor: { wallId: 'ground:deleted-wall' } }
  ];
  ground.legacy.context.plan.customOpenings = [
    { id: 'missing-host-window', kind: 'window', wallId: 'ground:deleted-wall', offsetM: 1, widthM: 1 },
    { id: 'diagonal-window', kind: 'window', roomId: 'living', edge: 'N', widthM: 1,
      segment: { x1: 1, y1: 1, x2: 2, y2: 2 } }
  ];
  ground.legacy.context.plan.furniture.push(furniture('orphan-chair', 'deleted-room', 'chair', 1, 1, .5, .5));
  syncActive(fixture.project);
  fixture.limitations = ['References are schema-valid but unresolved; retaining a record does not validate its host.'];
  return fixture;
}

function denseAnnotations() {
  const ctx = context(20, 14);
  const columns = 6, rows = 4, width = ctx.g.coreW / columns, depth = ctx.g.coreD / rows;
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    for (let column = 0; column < columns; column++) {
      const index = rowIndex * columns + column;
      const id = `room-${String(index + 1).padStart(2, '0')}`;
      const module = { x: .7 + column * width, y: .7 + rowIndex * depth, w: width, h: depth };
      ctx.plan.placed.push(room(id, 'study', `Study ${index + 1} — long coordination label / review required`, module, index));
      ctx.plan.furniture.push(furniture(`desk-${index + 1}`, id, 'desk', module.x + .4, module.y + .4, 1.2, .6));
      if (column > 0) ctx.plan.openings.doors.push({
        id: `door-${index + 1}`, roomId: id, targetRoomId: `room-${String(index).padStart(2, '0')}`,
        edge: 'W', widthM: .8,
        segment: { x1: module.x, y1: module.y + 1.8, x2: module.x, y2: module.y + 2.6 }
      });
      if (rowIndex === 0) ctx.plan.openings.windows.push({
        id: `window-${index + 1}`, roomId: id, edge: 'N', widthM: 1, sillM: .9, heightM: 1.2,
        segment: { x1: module.x + 1, y1: module.y, x2: module.x + 2, y2: module.y }
      });
    }
  }
  const project = projectFor('dense-annotations', [floor('ground', 'Annotation stress floor', ctx)]);
  const scene = Model.buildScene(ctx, project);
  project.floors[0].electrical = scene.rooms.map((item, index) => ({
    id: `ground:point-${index + 1}`,
    wallId: scene.walls.find(wall => wall.roomIds.includes(item.id)).id,
    label: `Unspecified electrical intent ${index + 1}`
  }));
  syncActive(project);
  const annotationInputs = scene.rooms.flatMap(item => {
    const { x, y, w, h } = item.rect;
    const anchor = { x: x + w / 2, y: y + h / 2 };
    return [
      { id: `${item.id}:label`, kind: 'label', targetId: item.id, text: item.label, anchor: clone(anchor) },
      { id: `${item.id}:note`, kind: 'label', targetId: item.id, text: 'Assumed dimensions — verify on site', anchor: clone(anchor) },
      { id: `${item.id}:width`, kind: 'dimension-input', targetId: item.id, start: { x, y }, end: { x: x + w, y }, valueM: w },
      { id: `${item.id}:depth`, kind: 'dimension-input', targetId: item.id, start: { x, y }, end: { x, y: y + h }, valueM: h }
    ];
  });
  return {
    id: 'dense-annotations', project, annotationInputs,
    limitations: [
      'annotationInputs is test-only source data outside the project schema, not an annotation or exporter API.',
      'Coincident label anchors intentionally challenge later placement; no collision solver, sheet scale or rendering is supplied.',
      'Electrical records are annotated intent, not designed circuits.'
    ]
  };
}

function nonCardinalRequest() {
  const fixture = furnished('non-cardinal-request');
  fixture.requestedBearingDeg = 32.5;
  fixture.support = 'unsupported-authoring';
  fixture.limitations = [
    'buildScene accepts N/E/S/W frontEdge only. The project remains a valid north-facing baseline.',
    'localToWorld supports numeric scene headings mathematically; that is not arbitrary-bearing project authoring.'
  ];
  return fixture;
}

const factories = {
  'furnished-single': furnished,
  'multiple-floors': multipleFloors,
  'setback-plot': setbackPlot,
  'sparse-unknown': sparseUnknown,
  'missing-context': missingContext,
  'invalid-attachments': invalidAttachments,
  'dense-annotations': denseAnnotations,
  'non-cardinal-request': nonCardinalRequest
};

function createFixture(id) {
  if (!Object.hasOwn(factories, id)) throw new Error(`Unknown drawing fixture: ${id}`);
  return factories[id]();
}

function controllerFor(project) {
  let legacy = clone(project.legacy);
  // The adapter only stores authored contexts; all scene geometry comes from the real model.
  const controller = createController({
    capture: () => clone(legacy),
    restore: value => { legacy = clone(value); },
    render() {}
  }, Model);
  controller.importProject(JSON.stringify(project));
  return controller;
}

function buildScenes(project) {
  return controllerFor(project).getScenes();
}

module.exports = { fixtureIds: Object.freeze(Object.keys(factories)), createFixture, controllerFor, buildScenes };
