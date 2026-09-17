'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../planner-model.js');
const Editor = require('../planner-editor.js');
const Three = require('../planner-3d.js');
const { createController, remapFloor } = require('../planner-bridge.js');
const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const length = wall => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
const partition = scene => scene.walls.find(wall => !wall.exterior && wall.roomIds.length === 2 && wall.start.x === wall.end.x);

function fixture(options = {}) {
  const module = (id, type, x) => ({
    req: { id, type, label: id }, module: { x, y: .7, w: 4.3, h: 3.7255 },
    carpet: { x: x + .05, y: .75, w: 4.2, h: 3.6255 }
  });
  const context = {
    plate: { frontEdge: 'N', sitePlot: { x: -1, y: -1, w: 12, h: 10 } },
    cfg: { walls: { external: .2, internal: .1 }, ceilingHeight: 2.7432 },
    g: { W: 10, D: 8, outerX: .5, outerY: .5, outerW: 9, outerD: 7,
      coreX: .7, coreY: .7, coreW: 8.6, coreD: 6.6,
      balconies: [1, 2, 3].map((n, index) => ({
        id: `balcony-${n}`, type: 'balcony', label: `Balcony ${n}`, x: 1 + index * 2.5, y: 0, w: 2, h: .5,
        attachedRoomId: index < 2 ? 'living-1' : 'kitchen-1'
      })) },
    plan: { placed: [module('living-1', 'living', .7), module('kitchen-1', 'kitchen', 5)],
      furniture: [{ id: 'chair-kept', roomId: 'living-1', type: 'chair', label: 'Keep', x: 1, y: 2, w: .6, h: .6 }],
      openings: { doors: [], windows: [] }, wallOpenings: [], customOpenings: [], flexSpaces: [] }
  };
  if (options.stair) context.plan.placed.push({
    req: { id: 'stair-1', type: 'staircase', label: 'Staircase', reserveFootprint: true },
    carpet: { x: 2, y: 1.5, w: 1, h: 1.4 }, module: { x: 1.95, y: 1.45, w: 1.1, h: 1.5 }
  });
  let live = { controls: { livingCount: { value: '1' }, kitchenCount: { value: '1' }, balconyCount: { value: '3' } },
    roomIdentities: { balcony: { next: 4, ids: ['balcony-1', 'balcony-2', 'balcony-3'] } },
    manualLayouts: [], context: clone(context) };
  let next = 1;
  const adapter = {
    capture: () => clone(live),
    restore: value => { live = clone(value); },
    render() {
      if (!live.context) {
        live.context = clone(context);
        live.context.plan.placed = [];
        live.context.plan.furniture = [];
        live.context.g.balconies = [];
      }
    },
    addOpening(command, wall) {
      const id = `added-${next++}`;
      if (options.dropFurniture) live.context.plan.furniture = [];
      live.context.plan.customOpenings.push({
        id, custom: true, type: command.kind === 'window' ? 'window' : 'door', kind: command.kind,
        wallId: options.loseHost ? 'missing-wall' : wall.id,
        offsetM: command.offsetM, widthM: command.widthM, sillM: command.sillM,
        heightM: command.heightM, openFraction: command.openFraction,
        ...(command.kind === 'hinged' ? { hinge: command.hinge, swing: command.swing } : {})
      });
      return id;
    },
    deleteOpening(opening) {
      live.context.plan.customOpenings = live.context.plan.customOpenings.filter(item => item.id !== opening.sourceId);
    },
    deleteBalcony(entity) {
      live.context.g.balconies = live.context.g.balconies.filter(item => item.id !== entity.sourceId);
      if (options.renumberBalconies) live.context.g.balconies.forEach((item, index) => { item.id = `balcony-${index + 1}`; });
      live.roomIdentities.balcony.ids = live.roomIdentities.balcony.ids.filter(id => id !== entity.sourceId);
      live.controls.balconyCount.value = String(Number(live.controls.balconyCount.value) - 1);
    },
    restoreWall() { return false; },
    edit(command, entity) {
      const room = live.context.plan.placed.find(item => item.req.id === entity.sourceId);
      room.module = { x: command.rect.x - .05, y: command.rect.y - .05,
        w: command.rect.w + .1, h: command.rect.h + .1 };
      room.carpet = clone(command.rect);
      if (options.relayout) {
        const other = live.context.plan.placed.find(item => item !== room);
        other.carpet.y += .2; other.module.y += .2;
      }
    }
  };
  const model = options.role ? { ...Model, buildScene(ctx, project) {
    const scene = Model.buildScene(ctx, project);
    partition(scene).structuralRole = options.role;
    return scene;
  } } : Model;
  return { controller: createController(adapter, model), context, adapter };
}
const doorCommand = wallId => ({ type: 'add-door', wallId, offsetM: 1, widthM: .8,
  heightM: 2.1, openFraction: 0, hinge: 'start', swing: 'left' });
const windowCommand = wallId => ({ type: 'add-window', wallId, offsetM: 2, widthM: .6,
  heightM: 1, sillM: .9, openFraction: .25 });

test('a direct staircase move preserves every other room and creates one shared Undo entry despite render notifications', () => {
  const { controller, adapter } = fixture({ stair: true });
  const before = controller.getScene(), stairs = before.rooms.find(room => room.type === 'staircase');
  const render = adapter.render;
  adapter.render = () => { render(); controller.acceptLegacy('Nested rendering notification'); };
  const destination = { ...stairs.rect, x: 3.2, y: 2 };
  controller.execute({ type: 'update-room', id: stairs.id, rect: destination });
  assert.equal(controller.getProject().revision, 1);
  assert.deepEqual(controller.getScene().rooms.find(room => room.id === stairs.id).rect, destination);
  for (const room of before.rooms.filter(room => room.id !== stairs.id)) {
    const after = controller.getScene().rooms.find(item => item.id === room.id);
    assert.deepEqual(after.rect, room.rect);
    assert.deepEqual(after.module, room.module);
  }
  controller.undo();
  assert.deepEqual(controller.getScene().rooms, before.rooms);
  assert.equal(controller.canUndo(), false, 'One completed command must not leave a hidden render Undo entry');
  controller.redo();
  assert.deepEqual(controller.getScene().rooms.find(room => room.id === stairs.id).rect, destination);
});

test('a staircase gesture records one complete layout and restores exact sibling footprints with Undo and Redo', () => {
  const { controller, adapter } = fixture({ stair: true });
  const before = controller.getScene(), stairs = before.rooms.find(room => room.type === 'staircase');
  const destination = { ...stairs.rect, x: 3.2, y: 2 };
  controller.beginLegacyGesture();
  assert.equal(controller.getProject().revision, 0);
  adapter.edit({ type: 'update-room', rect: destination }, stairs);
  controller.endLegacyGesture();
  assert.equal(controller.getProject().revision, 1);
  const moved = controller.getScene().rooms;
  controller.undo();
  assert.deepEqual(controller.getScene().rooms, before.rooms);
  assert.equal(controller.canUndo(), false);
  controller.redo();
  assert.deepEqual(controller.getScene().rooms, moved);
});

test('a direct move that repacks another room is rejected and preserves the project and selection', () => {
  const { controller } = fixture({ stair: true, relayout: true });
  const stairs = controller.getScene().rooms.find(room => room.type === 'staircase');
  controller.select({ kind: 'room', id: stairs.id });
  const before = controller.exportProject();
  assert.throws(() => controller.execute({ type: 'update-room', id: stairs.id,
    rect: { ...stairs.rect, x: 3.2, y: 2 } }), /re-layout unrelated rooms/);
  assert.equal(controller.exportProject(), before);
  assert.deepEqual(controller.getSelection(), { kind: 'room', id: stairs.id });
  assert.equal(controller.canUndo(), false);
});

test('history refuses a repacked restore without consuming its entry or overwriting current work', () => {
  const { controller, adapter } = fixture({ stair: true });
  const original = controller.getScene(), stairs = original.rooms.find(room => room.type === 'staircase');
  controller.execute({ type: 'update-room', id: stairs.id, rect: { ...stairs.rect, x: 3.2, y: 2 } });
  controller.select({ kind: 'room', id: stairs.id });
  const before = controller.exportProject(), restore = adapter.restore;
  let corrupt = true;
  adapter.restore = value => {
    restore(value);
    if (corrupt) {
      corrupt = false;
      const candidate = adapter.capture(), room = candidate.context.plan.placed.find(item => item.req.id === 'kitchen-1');
      room.carpet.y += .2; room.module.y += .2;
      restore(candidate);
    }
  };
  assert.throws(() => controller.undo(), /re-layout unrelated rooms/);
  assert.equal(controller.exportProject(), before);
  assert.deepEqual(controller.getSelection(), { kind: 'room', id: stairs.id });
  assert.equal(controller.canUndo(), true);
  assert.equal(controller.canRedo(), false);
  controller.undo();
  assert.deepEqual(controller.getScene().rooms, original.rooms);
});

test('to-wall-end is exact while deliberately entered partial widths retain small fragments', () => {
  const { controller } = fixture();
  const wall = partition(controller.getScene());
  close(length(wall), 3.7255);
  controller.execute({ type: 'open-wall', id: wall.id, full: false, offsetM: 1, widthM: 2.7, confirmConceptual: true });
  const partial = partition(controller.getScene());
  close(partial.solidSegments.at(-1).endM - partial.solidSegments.at(-1).startM, .0255);
  const command = Editor.wallOpeningCommand(wall, { full: false, toEnd: true, offsetM: '1' });
  assert.equal(Object.hasOwn(command, 'widthM'), false);
  controller.execute(command);
  const exact = partition(controller.getScene());
  assert.deepEqual(exact.solidSegments, [{ startM: 0, endM: 1 }]);
  assert.equal(exact.openings[0].widthM, length(wall) - 1);
  assert.equal(exact.openings[0].segment.y2, wall.end.y);
  controller.undo();
  close(partition(controller.getScene()).solidSegments.at(-1).endM - 3.7, .0255);
  controller.redo();
  assert.deepEqual(partition(controller.getScene()).solidSegments, [{ startM: 0, endM: 1 }]);
});

test('to-wall-end intent survives JSON and follows a changed host span without rebasing its start', () => {
  const { controller } = fixture();
  const original = partition(controller.getScene());
  controller.execute(Editor.wallOpeningCommand(original, { full: false, toEnd: true, offsetM: 1 }));
  const project = Model.parseProject(controller.exportProject());
  const context = clone(project.legacy.context);
  for (const room of context.plan.placed) { room.module.h += .4; room.carpet.h += .4; }
  const changed = Model.buildScene(context, project);
  const wall = partition(changed);
  assert.equal(wall.id, original.id);
  assert.deepEqual(wall.solidSegments, [{ startM: 0, endM: 1 }]);
  assert.equal(wall.openings[0].widthM, length(wall) - 1);
  assert.equal(project.wallEdits[wall.id].toEnd, true);
  assert.equal(Object.hasOwn(project.wallEdits[wall.id], 'widthM'), false);
});

test('retained-end trim removes real material, retains host origins and diagnoses cut-away attachments', () => {
  const { controller } = fixture();
  const wall = partition(controller.getScene()), rooms = controller.getScene().rooms;
  controller.execute({ ...doorCommand(wall.id), offsetM: .1 });
  const door = controller.getScene().openings.find(item => item.kind === 'hinged');
  controller.execute({ type: 'upsert-authored', collection: 'annotations', value: {
    id: 'floor-1:authored:keep-note', text: 'Do not delete', anchor: { kind: 'wall', floorId: 'floor-1',
      entityId: wall.id, offsetM: .2, heightM: 2.5 }
  } });
  controller.execute({ type: 'set-electrical', value: [{ id: 'keep-point', wallId: wall.id, offsetM: .2 }] });
  controller.execute(Editor.wallTrimCommand(wall, '.4', '3'));
  const after = partition(controller.getScene());
  assert.deepEqual(after.start, wall.start);
  assert.deepEqual(after.end, wall.end);
  assert.deepEqual(controller.getScene().rooms, rooms);
  assert.deepEqual(after.solidSegments, [{ startM: .4, endM: 3 }]);
  assert.deepEqual(after.solidSections, [{ startM: .4, endM: 3, sillM: 0, heightM: wall.heightM }]);
  assert.ok(controller.getScene().unresolvedOpenings.some(item => item.id === door.id));
  assert.ok(controller.getProject().legacy.context.plan.customOpenings.some(item => item.id === door.sourceId));
  assert.equal(controller.getProject().electrical[0].id, 'keep-point');
  assert.equal(controller.getDrawingScene().authored.find(item => item.record.id === 'floor-1:authored:keep-note').anchorStatus, 'unresolved');
  const cells = Three.wallGrid(after, after.openings).cells;
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    assert.ok(cell.startM >= .4 && cell.endM <= 3, '3D material must respect trimmed ends');
  }
  controller.execute({ type: 'restore-wall', id: wall.id, confirmConceptual: true });
  assert.ok(controller.getScene().openings.some(item => item.id === door.id), 'Source aperture is restored, not recreated');
  assert.equal(controller.getDrawingScene().authored.find(item => item.record.id === 'floor-1:authored:keep-note').anchorStatus, 'resolved');
});

test('retained-end changes reject outside-original or inverted spans and preserve every authored record', () => {
  const { controller } = fixture(), wall = partition(controller.getScene());
  const before = controller.exportProject();
  for (const [startM, endM] of [[-.1, 3], [0, 4], [3, 2], [0, 0], ['1', 3], [0, '3'], [0, undefined]]) {
    assert.throws(() => controller.execute({ type: 'trim-wall', id: wall.id, startM, endM, confirmConceptual: true }));
    assert.equal(controller.exportProject(), before);
  }
  assert.throws(() => controller.execute({ type: 'trim-wall', id: wall.id, startM: .3, endM: 3 }), /Confirm/);
  assert.equal(controller.canUndo(), false);
});

test('trim-only edits and a retained end that follows the host round-trip without inventing an opening', () => {
  const { controller } = fixture(), wall = partition(controller.getScene());
  controller.execute(Editor.wallTrimCommand(wall, '.25', String(length(wall))));
  const edit = controller.getProject().wallEdits[wall.id];
  assert.deepEqual(edit, { retainedSpan: { startM: .25, endM: null } });
  assert.equal(Model.parseProject(controller.exportProject()).wallEdits[wall.id].retainedSpan.endM, null);
  controller.execute(Editor.wallOpeningCommand(partition(controller.getScene()), { full: false, toEnd: true, offsetM: 1 }));
  assert.deepEqual(partition(controller.getScene()).solidSegments, [{ startM: .25, endM: 1 }]);
});

test('exterior and protected partitions reject direct removal, trim and inappropriate opening placement', () => {
  const { controller } = fixture(), wall = controller.getScene().walls.find(wall => wall.exterior);
  for (const type of ['open-wall', 'restore-wall', 'trim-wall']) {
    assert.throws(() => controller.execute({ type, id: wall.id, full: true, startM: 0, endM: 1, confirmConceptual: true }), /Exterior/);
  }
  for (const role of ['structural', 'fire-separating', 'unclassified']) {
    const { controller: protectedController } = fixture({ role });
    const protectedWall = partition(protectedController.getScene());
    assert.throws(() => protectedController.execute(Editor.wallTrimCommand({ ...protectedWall, structuralRole: 'unknown' }, 0, 1)), /protected/);
    assert.throws(() => protectedController.execute({ type: 'open-wall', id: protectedWall.id, full: true, confirmConceptual: true }), /protected/);
    assert.throws(() => protectedController.execute(doorCommand(protectedWall.id)), /protected/);
    assert.equal(protectedController.canUndo(), false);
  }
});

test('typed opening and to-end commands reject malformed inputs rather than clamping them', () => {
  const { controller } = fixture(), wall = partition(controller.getScene()), before = controller.exportProject();
  for (const patch of [{ offsetM: '' }, { offsetM: -1 }, { widthM: '1' }, { widthM: .2 }, { widthM: 4 },
    { heightM: 0 }, { heightM: 3 }, { openFraction: null }, { openFraction: 2 }, { hinge: 'north' }, { swing: 'in' }]) {
    assert.throws(() => controller.execute({ ...doorCommand(wall.id), ...patch }));
    assert.equal(controller.exportProject(), before);
  }
  assert.throws(() => controller.execute({ type: 'open-wall', id: wall.id, full: 'true', confirmConceptual: true }));
  assert.throws(() => controller.execute({ type: 'open-wall', id: wall.id, full: false, toEnd: true,
    offsetM: 1, widthM: 100, confirmConceptual: true }), /exact width/);
  assert.equal(controller.canUndo(), false);
});

test('new door and window commands produce true cutouts, distinct operating state and stable identities', () => {
  const { controller } = fixture(), wall = partition(controller.getScene()), furniture = controller.getScene().furniture;
  controller.execute(doorCommand(wall.id));
  const door = controller.getScene().openings.find(item => item.kind === 'hinged');
  assert.equal(door.hosted, true);
  assert.equal(door.handingAssumed, false);
  assert.equal(door.clearWidthVerified, false);
  assert.equal(controller.getSelection().id, door.id);
  controller.execute(windowCommand(wall.id));
  const after = partition(controller.getScene()), window = after.openings.find(item => item.kind === 'window');
  assert.equal(after.openings.length, 2);
  assert.equal(window.openFraction, .25);
  assert.equal(window.widthM, .6);
  assert.ok(after.solidSections.some(section => section.sillM === 0 && section.heightM === .9), 'Window retains its sill material');
  for (const section of after.solidSections) for (const opening of after.openings) {
    assert.ok(!(section.startM < opening.offsetM + opening.widthM - 1e-7 && section.endM > opening.offsetM + 1e-7 &&
      section.sillM < opening.sillM + opening.heightM - 1e-7 && section.sillM + section.heightM > opening.sillM + 1e-7));
  }
  assert.deepEqual(controller.getScene().furniture, furniture);
  const serialized = controller.exportProject();
  const restored = fixture().controller;
  restored.importProject(serialized);
  assert.deepEqual(restored.getScene().openings, controller.getScene().openings);
  controller.undo();
  assert.deepEqual(controller.getScene().openings.map(item => item.id), [door.id]);
  controller.redo();
  assert.equal(controller.getScene().openings.find(item => item.kind === 'window').id, window.id);
});

test('new openings reject wall ends, existing apertures, missing hosts and trimmed material atomically', () => {
  const { controller } = fixture(), wall = partition(controller.getScene());
  controller.execute(doorCommand(wall.id));
  controller.execute(Editor.wallTrimCommand(wall, '.5', '3.5'));
  const before = controller.exportProject();
  for (const command of [
    { ...doorCommand(wall.id), offsetM: 1.1 },
    { ...windowCommand(wall.id), offsetM: 3.2 },
    { ...windowCommand(wall.id), offsetM: .1 },
    windowCommand('floor-other:missing'),
    { ...windowCommand(wall.id), sillM: 2.5 }
  ]) {
    assert.throws(() => controller.execute(command));
    assert.equal(controller.exportProject(), before);
  }
  const { controller: broken } = fixture({ loseHost: true });
  assert.throws(() => broken.execute(doorCommand(partition(broken.getScene()).id)), /rolled back/);
  assert.equal(broken.getProject().legacy.context.plan.customOpenings.length, 0);
  assert.equal(broken.canUndo(), false);
  const { controller: displacing } = fixture({ dropFurniture: true });
  const beforeDisplacement = displacing.exportProject();
  assert.throws(() => displacing.execute(doorCommand(partition(displacing.getScene()).id)), /displace existing furniture/);
  assert.equal(displacing.exportProject(), beforeDisplacement);
});

test('new wall-edit forms are strictly validated, including inactive-floor imports', () => {
  const { controller } = fixture(), original = JSON.parse(controller.exportProject()), wall = partition(controller.getScene());
  for (const invalid of [
    { full: false, offsetM: 1, toEnd: 'true' },
    { full: false, offsetM: 1, toEnd: true, widthM: 4 },
    { full: true, toEnd: true },
    { retainedSpan: { startM: -1, endM: 3 } },
    { retainedSpan: { startM: 3, endM: 2 } },
    { retainedSpan: { startM: 0 } },
    { retainedSpan: { startM: 0, endM: '3' } },
    {}
  ]) {
    const candidate = clone(original);
    candidate.floors.push(remapFloor(candidate.floors[0], 'floor-1', 'floor-upper'));
    candidate.floors[1].wallEdits[wall.id.replace('floor-1:', 'floor-upper:')] = invalid;
    assert.throws(() => Model.parseProject(JSON.stringify(candidate)));
  }
  const candidate = clone(original);
  candidate.wallEdits[wall.id] = { retainedSpan: { startM: .2, endM: 100 } };
  const context = candidate.legacy.context;
  Model.validateProject(candidate);
  const compiled = Model.buildScene(context, candidate), unchanged = partition(compiled);
  assert.deepEqual(unchanged.solidSegments, wall.solidSegments);
  assert.ok(compiled.diagnostics.some(item => item.ids.includes(wall.id) && /retained without cutting/.test(item.message)));
});

test('door offset and height edits use the exact canonical host; wall-end apertures need no legacy glyph margin', () => {
  const { controller } = fixture(), wall = partition(controller.getScene());
  controller.execute({ ...doorCommand(wall.id), offsetM: length(wall) - .8 });
  const door = controller.getScene().openings[0];
  assert.equal(door.offsetM + door.widthM, length(wall));
  controller.execute(Editor.openingCommand('door', door, 'offsetM', '0', wall));
  controller.execute(Editor.openingCommand('door', controller.getScene().openings[0], 'heightM', '2.4', wall));
  const edited = controller.getScene().openings[0];
  assert.equal(edited.offsetM, 0);
  assert.equal(edited.heightM, 2.4);
  assert.equal(edited.segment.y1, wall.start.y);
  const before = controller.exportProject();
  assert.throws(() => controller.execute({ type: 'update-window', id: edited.id, heightM: 1 }), /no longer/);
  assert.equal(controller.exportProject(), before);
});

test('balcony deletion uses shared source and model selection, preserves siblings and is one reversible edit', () => {
  const { controller } = fixture(), before = controller.getScene().balconies;
  controller.selectSource('balcony', 'balcony-2');
  assert.deepEqual(controller.getSelection(), { kind: 'balcony', id: 'floor-1:balcony-2' });
  assert.equal(Editor.selectionEntity(controller.getScene(), controller.getSelection()).sourceId, 'balcony-2');
  controller.select({ kind: 'balcony', id: 'floor-1:balcony-2' });
  assert.equal(controller.getProject().revision, 0, 'The 3D shared selection is not a transaction');
  assert.throws(() => controller.execute({ type: 'delete-balcony', id: 'floor-1:balcony-2' }), /Confirm/);
  controller.execute({ type: 'delete-balcony', id: 'floor-1:balcony-2', confirmRemoval: true });
  assert.deepEqual(controller.getScene().balconies, before.filter(item => item.sourceId !== 'balcony-2'));
  assert.deepEqual(controller.getProject().legacy.roomIdentities.balcony, { next: 4, ids: ['balcony-1', 'balcony-3'] });
  assert.equal(controller.getProject().legacy.controls.balconyCount.value, '2');
  assert.equal(controller.getProject().revision, 1);
  assert.equal(controller.getSelection(), null);
  controller.undo();
  assert.deepEqual(controller.getScene().balconies, before);
  controller.redo();
  const restored = fixture().controller;
  restored.importProject(controller.exportProject());
  assert.deepEqual(restored.getScene().balconies, controller.getScene().balconies);
  assert.deepEqual(restored.getProject().legacy.roomIdentities.balcony, controller.getProject().legacy.roomIdentities.balcony);
});

test('an adapter that renumbers a surviving balcony rolls back instead of deleting by pixels or array index', () => {
  const { controller } = fixture({ renumberBalconies: true });
  const selection = { kind: 'balcony', id: 'floor-1:balcony-2' };
  controller.select(selection);
  const before = controller.exportProject();
  assert.throws(() => controller.execute({ type: 'delete-balcony', id: selection.id, confirmRemoval: true }), /rolled back/);
  assert.equal(controller.exportProject(), before);
  assert.deepEqual(controller.getSelection(), selection);
  assert.equal(controller.canUndo(), false);
});

test('floor duplication remaps explicit opening hosts, retains balcony source identities and leaves empty floors empty', () => {
  const { controller } = fixture(), original = controller.getScene(), wall = partition(original);
  controller.execute(doorCommand(wall.id));
  controller.execute({ type: 'delete-balcony', id: 'floor-1:balcony-2', confirmRemoval: true });
  controller.execute({ type: 'add-floor', copyFromId: 'floor-1' });
  const upper = controller.getProject().activeFloorId;
  assert.deepEqual(controller.getScene().balconies.map(item => item.sourceId), ['balcony-1', 'balcony-3']);
  assert.ok(controller.getScene().balconies.every(item => item.id.startsWith(upper + ':')));
  assert.ok(controller.getScene().openings.every(item => item.wallId.startsWith(upper + ':')));
  const before = controller.exportProject();
  for (const command of [
    { type: 'delete-balcony', id: original.balconies[0].id, confirmRemoval: true },
    { type: 'open-wall', id: wall.id, full: true, confirmConceptual: true },
    doorCommand(wall.id), windowCommand(wall.id)
  ]) assert.throws(() => controller.execute(command), /no longer on this floor/);
  assert.equal(controller.exportProject(), before);
  controller.select({ kind: 'wall', id: wall.id });
  assert.equal(Editor.selectionFloor(controller.getScenes(), controller.getSelection(), upper), 'floor-1');
  controller.execute({ type: 'add-floor' });
  assert.equal(controller.getScene().balconies.length, 0);
  assert.equal(controller.getScene().rooms.length, 0);
  assert.equal(controller.getProject().legacy.roomIdentities, undefined);
  assert.equal(controller.getProject().legacy.controls.balconyCount.value, '0');
});

test('balcony identity validation and opaque source remapping follow existing room identity rules', () => {
  const project = Model.createProject();
  for (const invalid of [{ next: 3, ids: ['balcony-3'] }, { next: 4, ids: ['balcony-1', 'balcony-1'] },
    { next: 2, ids: ['balcony-01'] }, { next: 2, ids: ['bed-1'] }]) {
    project.legacy.roomIdentities = { balcony: invalid };
    assert.throws(() => Model.validateProject(project), /invalid|duplicate/);
  }
  const source = { legacy: { context: { plan: { placed: [] }, g: { balconies: [{ id: 'a:legacy-balcony' }] } },
    manualLayouts: [['key', { balconies: { 'a:legacy-balcony': { x: 1, y: 1, w: 1, h: 1 } },
      openings: [{ id: 'door-1', balconyId: 'a:legacy-balcony', wallId: 'a:wall' }] }]] } };
  const result = remapFloor(source, 'a', 'b');
  assert.equal(result.legacy.context.g.balconies[0].id, 'a:legacy-balcony');
  assert.ok(result.legacy.manualLayouts[0][1].balconies['a:legacy-balcony']);
  assert.equal(result.legacy.manualLayouts[0][1].openings[0].wallId, 'b:wall');
  assert.equal(result.legacy.manualLayouts[0][1].openings[0].balconyId, 'a:legacy-balcony');
});
