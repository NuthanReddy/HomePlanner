const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../planner-model.js');
const Projection = require('../planner-projection.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const entry = (drawing, id) => drawing.authored.find(item => item.record.id === id);

for (const kind of ['window', 'hinged', 'sliding']) {
  test(`canonical ${kind} entity anchors survive empty masonry, while wall and removed-partition anchors do not`, () => {
    const { project } = createFixture('setback-plot');
    const initial = Model.buildScene(project.legacy.context, project);
    const wall = initial.walls.find(item => !item.exterior
      && Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) > 2
      && !initial.openings.some(opening => opening.wallId === item.id));
    assert.ok(wall);
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    project.legacy.context.plan.customOpenings.push({
      id: 'anchor-opening', type: kind === 'window' ? 'window' : 'door', kind, custom: true,
      wallId: wall.id, roomId: wall.roomIds[0], offsetM: 0, widthM: length,
      sillM: 0, heightM: wall.heightM - .2, openFraction: 0,
      ...(kind === 'hinged' ? { hinge: 'start', swing: 'left' } : {})
    });
    project.floors[0].legacy = copy(project.legacy);
    const planner = controllerFor(project);
    const opening = planner.getScene().openings.find(item => item.sourceId === 'anchor-opening');
    assert.ok(opening);
    const anchor = { kind: 'entity', floorId: 'ground', entityKind: 'opening', entityId: opening.id };
    const authored = Model.emptyAuthored();
    authored.annotations = [
      { id: 'ground:authored:opening-note', text: 'Canonical aperture reference', anchor },
      { id: 'ground:authored:wall-note', text: 'Actual masonry reference',
        anchor: { kind: 'wall', floorId: 'ground', entityId: wall.id, offsetM: length / 2, heightM: wall.heightM - .1 } }
    ];
    authored.dimensions = [{ id: 'ground:authored:opening-dimension', start: anchor,
      end: { kind: 'point', floorId: 'ground', point: { x: 1, y: 2, z: 0 } }, offsetM: .3 }];
    planner.execute({ type: 'set-authored', value: authored });
    const before = planner.getDrawingScene(), revision = planner.getProject().revision;
    for (const item of before.authored) assert.equal(item.anchorStatus, 'resolved');
    const beforeDimension = entry(before, 'ground:authored:opening-dimension').distanceM;
    planner.execute({ type: kind === 'window' ? 'update-window' : 'update-door', id: opening.id, heightM: wall.heightM });
    assert.equal(planner.getProject().revision, revision + 1);
    const scene = planner.getScene(), full = scene.openings.find(item => item.id === opening.id);
    assert.ok(full, 'The canonical aperture remains in the real model.');
    assert.equal(scene.walls.find(item => item.id === wall.id).removed, true);
    const source = planner.exportProject(), drawing = planner.getDrawingScene();
    const note = entry(drawing, 'ground:authored:opening-note');
    const dimension = entry(drawing, 'ground:authored:opening-dimension');
    assert.equal(note.anchorStatus, 'resolved');
    assert.equal(dimension.anchorStatus, 'resolved');
    const expectedPoint = Projection.localToSite({
      ...Model.wallPoint(wall, full.offsetM + full.widthM / 2), z: wall.baseM + full.sillM + full.heightM / 2
    }, scene);
    assert.deepEqual(note.anchors[0].point, expectedPoint, 'The aperture center is translated to the registered site frame once.');
    const end = Projection.localToSite({ x: 1, y: 2, z: scene.floorElevationM }, scene);
    assert.equal(dimension.distanceM, Math.hypot(...['x', 'y', 'z'].map(axis => expectedPoint[axis] - end[axis])));
    assert.notEqual(dimension.distanceM, beforeDimension);
    assert.equal(entry(drawing, 'ground:authored:wall-note').anchors[0].code, 'removed-host');
    assert.equal(planner.exportProject(), source, 'Projection cannot author the document or its references.');
    assert.deepEqual(planner.getProject().floors[0].authored, authored);
    planner.undo();
    assert.equal(entry(planner.getDrawingScene(), 'ground:authored:opening-dimension').distanceM, beforeDimension);
    assert.equal(entry(planner.getDrawingScene(), 'ground:authored:wall-note').anchorStatus, 'resolved');
    planner.redo();
    assert.equal(entry(planner.getDrawingScene(), 'ground:authored:opening-dimension').distanceM, dimension.distanceM);

    planner.execute({ type: 'open-wall', id: wall.id, full: true, confirmConceptual: true });
    const partition = planner.getScene();
    assert.equal(partition.openings.some(item => item.id === opening.id), false);
    assert.ok(partition.unresolvedOpenings.some(item => item.id === opening.id));
    const removed = planner.getDrawingScene();
    assert.equal(entry(removed, 'ground:authored:opening-note').anchors[0].code, 'missing-host');
    assert.equal(entry(removed, 'ground:authored:opening-dimension').distanceM, null);
    const passage = partition.openings.find(item => item.wallId === wall.id && item.kind === 'passage');
    assert.ok(passage);
    planner.execute({ type: 'upsert-authored', collection: 'annotations', value: {
      id: 'ground:authored:passage-note', text: 'A removed partition is not a canonical door/window',
      anchor: { ...anchor, entityId: passage.id }
    } });
    assert.equal(entry(planner.getDrawingScene(), 'ground:authored:passage-note').anchors[0].code, 'removed-host');
    planner.undo(); planner.undo();
    assert.equal(entry(planner.getDrawingScene(), 'ground:authored:opening-note').anchorStatus, 'resolved');
    assert.deepEqual(planner.getProject().floors[0].authored, authored);
  });
}
