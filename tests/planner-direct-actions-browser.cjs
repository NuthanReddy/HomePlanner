'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require(process.env.HOMEPLANNER_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'homeplanner-actions-'));
const runtime = path.join(workspace, 'runtime');
fs.mkdirSync(runtime, { recursive: true });
process.env.TEMP = process.env.TMP = runtime;

// Serve production bytes unchanged: missing loader or action hooks are failures.
function indexIntegration(source) {
  assert.ok(source.includes("balconyIds=roomStableIds('balcony'"), 'Production balcony IDs must use the stable identity registry.');
  assert.ok(source.includes('prepareHostedOpenings(g,plan,cfg)'), 'Production must prepare canonical hosted openings.');
  const scripts = [...source.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  const draftIndex = scripts.indexOf('planner-drafts.js');
  assert.ok(draftIndex >= 0, 'Production must load planner-drafts.js.');
  for (const consumer of ['electrical-planner.js', 'planner-editor.js', 'environment-ui.js', 'planner-persistence.js'])
    assert.ok(draftIndex < scripts.indexOf(consumer), `Draft registry must load before ${consumer}.`);
  return { source, staged: false, stages: [] };
}

async function run() {
  const integration = indexIntegration(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/' || name === '/index.html') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(integration.source);
      return;
    }
    const file = path.resolve(root, ...name.slice(1).split('/'));
    if (!file.startsWith(root + path.sep) || !/\.(?:js|css|svg|png|woff2|ico|json)$/.test(file) || !fs.existsSync(file)) {
      response.statusCode = 404; response.end(); return;
    }
    response.setHeader('content-type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css')
      ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status, 200, 'The isolated fixture server must be responsive');
  let browser, context;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => HomePlannerWorkspace.navigate('design/layout'));
    const fixture = await page.evaluate(() => {
      document.getElementById('face').value = 'N'; buildRoadInputs();
      for (const [id, value] of Object.entries({ dunit: '1', pEW: '24', pNS: '24', livingCount: '1',
        bedCount: '1', kitchenCount: '1', bathCount: '0', poojaCount: '0', liftCount: '0',
        stairCount: '1', balconyCount: '3' })) {
        const input = document.getElementById(id);
        if (input.hasAttribute('data-room-setting')) HomePlannerRoomInputs.writeCommitted(input, value);
        else input.value = value;
      }
      render();
      let ctx = window.__roomPlanner;
      roomSaveManualLayout(ctx);
      const saved = roomManualLayouts.get(ctx.signature), c = ctx.g.core, half = INT_WALL / 2;
      saved.rooms = {
        'living-1': { x: c.x + half, y: c.y + half, w: c.w - INT_WALL, h: 4 },
        'bed-1': { x: c.x + half, y: c.y + 4 + 3 * half, w: 4, h: 3.7255 - INT_WALL },
        'kitchen-1': { x: c.x + 4 + 3 * half, y: c.y + 4 + 3 * half, w: 4, h: 3.7255 - INT_WALL },
        'stair-1': { x: c.x + 7, y: c.y + 1, w: 1.4, h: 1.8 }
      };
      saved.preserveRooms = true; saved.furniture = {}; saved.openings = []; saved.wallOpenings = [];
      renderRoomPlanner(window.__last);
      ctx = window.__roomPlanner;
      roomSaveManualLayout(ctx);
      const retained = roomManualLayouts.get(ctx.signature);
      retained.hiddenFurniture = ctx.plan.furniture.map(item => item.id);
      retained.furniture = { 'fixture-sofa': { id: 'fixture-sofa', type: 'sofa', label: 'Fixture sofa',
        roomId: 'living-1', custom: true, ox: 10, oy: 2, w: 1.8, h: .75, headLocal: 'N', pinned: true } };
      renderRoomPlanner(window.__last); HomePlanner.acceptLegacy();
      const scene = HomePlanner.getScene();
      if (!scene.furniture.some(item => item.sourceId === 'fixture-sofa')) throw new Error('The fixture sofa must be retained.');
      const wall = scene.walls.find(wall => !wall.exterior && wall.roomIds.includes('floor-1:bed-1')
        && wall.roomIds.includes('floor-1:kitchen-1'));
      if (!wall) throw new Error('The controlled fixture needs the real shared bedroom/kitchen wall.');
      document.getElementById('plannerInspector').open = true;
      return { wallId: wall.id, balconies: scene.balconies, openings: scene.openings, rooms: scene.rooms,
        stairDestination: { x: c.x + 5.2, y: c.y + 1.3 } };
    });
    assert.equal(fixture.balconies.length, 3);
    const inspector = page.locator('#plannerInspector');
    const action = name => inspector.locator(`[data-hp-editor-action="${name}"]`);
    const history = name => page.locator(`#plannerProjectTools [data-hp-editor-action="${name}"]`);
    const footprints = () => page.evaluate(() => ({
      revision: HomePlanner.getProject().revision,
      rooms: HomePlanner.getScene().rooms.map(room => ({ id: room.id, sourceId: room.sourceId, rect: room.rect, module: room.module })),
      balconies: HomePlanner.getScene().balconies,
      furniture: HomePlanner.getScene().furniture
    }));
    const beforeStair = await footprints();
    const stairs = beforeStair.rooms.find(room => room.sourceId === 'stair-1');
    assert.ok(stairs, 'The reserved staircase must exist in the active model');
    await page.locator('#roomPlanViewport').scrollIntoViewIfNeeded();
    const gesture = await page.evaluate(({ rect, target }) => {
      const screen = point => {
        const box = window.__roomView.box({ x: point.x, y: point.y, w: 0, h: 0 });
        const transformed = new DOMPoint(box.x, box.y).matrixTransform(document.getElementById('roomPlan').getScreenCTM());
        return { x: transformed.x, y: transformed.y };
      };
      return {
        start: screen({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }),
        end: screen({ x: target.x + rect.w / 2, y: target.y + rect.h / 2 })
      };
    }, { rect: stairs.rect, target: fixture.stairDestination });
    await page.mouse.move(gesture.start.x, gesture.start.y);
    await page.mouse.down();
    await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 14 });
    await page.waitForFunction(() => document.querySelector('.room-move-preview')?.getAttribute('aria-invalid') === 'false');
    assert.deepEqual(await footprints(), beforeStair, 'A staircase preview must not mutate the project or other rooms');
    await page.mouse.up();
    const afterStair = await footprints(), movedStairs = afterStair.rooms.find(room => room.id === stairs.id);
    assert.equal(afterStair.revision, beforeStair.revision + 1, 'A completed staircase gesture has one shared history entry');
    assert.ok(Math.abs(movedStairs.rect.x - fixture.stairDestination.x) < 1e-5);
    assert.ok(Math.abs(movedStairs.rect.y - fixture.stairDestination.y) < 1e-5);
    assert.deepEqual(afterStair.rooms.filter(room => room.id !== stairs.id), beforeStair.rooms.filter(room => room.id !== stairs.id));
    assert.deepEqual(afterStair.balconies, beforeStair.balconies);
    assert.deepEqual(afterStair.furniture, beforeStair.furniture);
    assert.equal(await page.locator('#roomUndo').isVisible(), true);
    assert.equal(await page.locator('#roomUndo').isEnabled(), true);
    await page.locator('#roomUndo').click();
    assert.deepEqual((await footprints()).rooms, beforeStair.rooms, 'Canvas Undo restores the complete prior room layout');
    assert.equal(await page.locator('#roomRedo').isEnabled(), true);
    await page.locator('#roomRedo').click();
    assert.deepEqual((await footprints()).rooms, afterStair.rooms, 'Canvas Redo restores exactly the single staircase move');
    await page.locator('#roomUndo').click();
    const select2D = async (kind, id) => {
      await page.locator('#roomPlanViewport').scrollIntoViewIfNeeded();
      const point = await page.evaluate(id => {
        const wall = HomePlanner.getScene().walls.find(item => item.id === id);
        const part = wall.solidSegments[0], local = HomePlannerModel.wallPoint(wall, (part.startM + part.endM) / 2);
        const box = window.__roomView.box({ x: local.x, y: local.y, w: 0, h: 0 });
        const screen = new DOMPoint(box.x, box.y).matrixTransform(document.getElementById('roomPlan').getScreenCTM());
        return { x: screen.x, y: screen.y };
      }, id);
      await page.mouse.click(point.x, point.y);
      assert.deepEqual(await page.evaluate(() => HomePlanner.getSelection()), { kind, id });
    };
    await select2D('wall', fixture.wallId);
    await page.locator('#roomDeleteSelection').click(); await action('confirm').click();
    assert.equal(await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id).removed, fixture.wallId), true);
    await history('undo').click();
    await select2D('wall', fixture.wallId);
    await page.locator('#hp-editor-wall-span').selectOption('partial');
    await page.locator('#hp-editor-wall-offsetM').fill('1');
    await page.locator('#hp-editor-wall-widthM').fill('2.7');
    await action('review-open-wall').click();
    await action('confirm').click();
    let state = await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id), fixture.wallId);
    assert.ok(Math.abs(state.solidSegments.at(-1).endM - state.solidSegments.at(-1).startM - .0255) < 1e-8);
    await page.locator('#hp-editor-wall-span').selectOption('to-end');
    assert.ok((await inspector.locator('[data-hp-editor-readout="remaining-wall-span"]').innerText()).includes('2.7255 m'));
    await action('review-open-wall').click();
    await action('confirm').click();
    state = await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id), fixture.wallId);
    assert.deepEqual(state.solidSegments, [{ startM: 0, endM: 1 }]);
    assert.equal(await page.locator(`#roomPlan [data-planner-id=${JSON.stringify(fixture.wallId)}] line`).count(), 2,
      'The real 2D wall layer has one material interval and one transparent hit interval, not a ghost end');
    await action('review-restore-wall').click(); await action('confirm').click();
    await page.locator('#roomWallEnds').click();
    await page.locator('#hp-editor-retainedStartM').fill('.3');
    await page.locator('#hp-editor-retainedEndM').fill('3.4');
    await action('review-trim-wall').click(); await action('confirm').click();
    state = await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id), fixture.wallId);
    assert.deepEqual(state.solidSegments, [{ startM: .3, endM: 3.4 }]);
    await action('review-restore-wall').click(); await action('confirm').click();

    await page.locator('#roomAddDoor').click();
    for (const [key, value] of Object.entries({ offsetM: '.25', widthM: '.8', heightM: '2.1', openFraction: '0' }))
      await page.locator(`#hp-editor-new-opening-${key}`).fill(value);
    await page.locator('#hp-editor-new-opening-hinge').selectOption('start');
    await page.locator('#hp-editor-new-opening-swing').selectOption('left');
    await action('add-door').click();
    const door = await page.evaluate(() => {
      const ref = HomePlanner.getSelection();
      return ref?.kind === 'door' && HomePlanner.getScene().openings.find(item => item.id === ref.id);
    });
    assert.ok(door, await inspector.innerText());
    assert.equal(door.offsetM, .25);
    assert.equal(await page.locator(`#roomPlan [data-planner-kind="door"][data-planner-id=${JSON.stringify(door.id)}]`).count(), 1);
    const prior = await page.evaluate(() => ({ furniture: HomePlanner.getScene().furniture, openings: HomePlanner.getScene().openings }));

    // The public 3D builder is used only to locate a visible triangle. The actual
    // click below goes through the production canvas raycaster and shared selector.
    await page.locator('#planner3d [data-hp3d="open"]').click();
    await page.waitForFunction(() => HomePlanner3D.instance?.isOpen);
    const history3D = name => page.locator(`#planner3d [data-hp3d="${name}"]`);
    const visible3DHistory = await history3D('undo').isVisible() && await history3D('redo').isVisible();
    assert.equal(visible3DHistory, true, 'Production 3D must provide its shared Undo and Redo controls.');
    const undoFrom3D = () => history3D('undo').click();
    await page.locator('#planner3d [data-hp3d="reset"]').click();
    const pickPoint = id => page.evaluate(async id => {
      const THREE = await import('./vendor/three/three.module.min.js');
      const content = HomePlanner3D.buildContent(THREE, HomePlanner.getScenes(), HomePlanner.getProject(), HomePlannerModel, { cutaway: true });
      try {
        content.group.updateMatrixWorld(true);
        const viewport = document.querySelector('#planner3d [data-hp3d="viewport"]');
        const balcony3DPicks = HomePlanner.getScene().balconies.every(balcony =>
          content.pickables.some(mesh => mesh.userData.entityRef?.kind === 'balcony' && mesh.userData.entityRef.id === balcony.id));
        const sphere = content.bounds.getBoundingSphere(new THREE.Sphere());
        const aspect = Math.max(.2, viewport.clientWidth / Math.max(1, viewport.clientHeight));
        const camera = new THREE.PerspectiveCamera(42, aspect, .03, 2000);
        const vertical = 42 * Math.PI / 180, horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
        const distance = Math.max(2, sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12);
        camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, .85, 1).normalize(), distance);
        camera.lookAt(sphere.center); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
        const visible = mesh => { for (let p = mesh; p; p = p.parent) if (!p.visible) return false; return true; };
        const raycaster = new THREE.Raycaster();
        for (const mesh of content.pickables.filter(mesh => mesh.userData.entityRef?.id === id)) {
          const pos = mesh.geometry.getAttribute('position');
          for (let i = 0; i + 2 < pos.count; i += 3) {
            const point = new THREE.Vector3();
            for (let j = 0; j < 3; j++) point.add(new THREE.Vector3().fromBufferAttribute(pos, i + j));
            point.multiplyScalar(1 / 3); mesh.localToWorld(point); point.project(camera);
            if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1) continue;
            raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
            const first = raycaster.intersectObjects(content.pickables.filter(visible), false)[0];
            if (first?.object.userData.entityRef?.id === id)
              return { x: point.x, y: point.y, balcony3DPicks };
          }
        }
        return null;
      } finally { HomePlanner3D.disposeObject(content.group); }
    }, id);
    const pick = await pickPoint(fixture.wallId);
    assert.ok(pick, 'A real 3D wall triangle must be visible in the controlled fixture');
    const click3D = async (point = pick) => {
      const canvas = page.locator('#planner3d canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + (point.x + 1) * box.width / 2, box.y + (1 - point.y) * box.height / 2);
    };
    await click3D();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getSelection()), { kind: 'wall', id: fixture.wallId });
    await page.locator('#planner3d').getByRole('button', { name: /Delete selection/ }).click();
    await action('confirm').click();
    assert.equal(await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id).removed, fixture.wallId), true);
    await undoFrom3D();
    if (visible3DHistory) {
      assert.equal(await history3D('redo').isEnabled(), true);
      await history3D('redo').click();
      assert.equal(await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id).removed, fixture.wallId), true);
      await undoFrom3D();
    }
    await click3D();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getSelection()), { kind: 'wall', id: fixture.wallId });
    assert.equal(await page.locator('#planner3d').getByRole('button', { name: /Add window/ }).isEnabled(), true,
      'Shared wall-hosted authoring must preserve the existing internal-window capability');
    const windowHost = { id: fixture.wallId, offset: 1.5 };
    await page.locator('#planner3d').getByRole('button', { name: /Add window/ }).click();
    for (const [key, value] of Object.entries({ offsetM: String(windowHost.offset), widthM: '.6', sillM: '.9', headM: '1.9', openFraction: '.5' }))
      await page.locator(`#hp-editor-new-opening-${key}`).fill(value);
    await action('add-window').click();
    const window = await page.evaluate(() => {
      const ref = HomePlanner.getSelection();
      return ref?.kind === 'window' && HomePlanner.getScene().openings.find(item => item.id === ref.id);
    });
    assert.ok(window, await inspector.innerText());
    assert.equal(window.wallId, windowHost.id);
    assert.equal(await page.evaluate(() => HomePlanner3D.instance.isOpen), true);
    const after = await page.evaluate(() => ({ furniture: HomePlanner.getScene().furniture, openings: HomePlanner.getScene().openings }));
    assert.deepEqual(after.furniture, prior.furniture);
    for (const opening of prior.openings) assert.ok(after.openings.some(item => item.id === opening.id), 'Unrelated openings must survive');
    assert.equal(await page.locator(`#roomPlan [data-planner-kind="window"][data-planner-id=${JSON.stringify(window.id)}]`).count(), 1);

    await page.evaluate(id => HomePlanner.select({ kind: 'wall', id }), fixture.wallId);
    await action('delete-wall').click(); await action('confirm').click();
    assert.equal(await page.evaluate(id => HomePlanner.getScene().walls.find(item => item.id === id).removed, fixture.wallId), true);
    await undoFrom3D();
    assert.ok(await page.evaluate(id => HomePlanner.getScene().openings.some(item => item.id === id), door.id));
    await page.evaluate(() => HomePlanner3D.instance.close());
    await page.locator('#roomPlanViewport').scrollIntoViewIfNeeded();
    const balconyPoint = await page.evaluate(() => {
      const rect = HomePlanner.getScene().balconies.find(item => item.sourceId === 'balcony-2').rect;
      const box = window.__roomView.box({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w: 0, h: 0 });
      const point = new DOMPoint(box.x, box.y).matrixTransform(document.getElementById('roomPlan').getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(balconyPoint.x, balconyPoint.y);
    assert.deepEqual(await page.evaluate(() => HomePlanner.getSelection()), { kind: 'balcony', id: 'floor-1:balcony-2' });
    await action('delete-balcony').click(); await action('confirm').click();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getScene().balconies),
      fixture.balconies.filter(item => item.sourceId !== 'balcony-2'));
    assert.equal(await page.locator('#balconyCount').inputValue(), '2');
    await history('undo').click();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getScene().balconies), fixture.balconies);
    await history('redo').click();
    await page.evaluate(() => { const saved = HomePlanner.exportProject(); HomePlanner.newProject(); HomePlanner.importProject(saved); });
    assert.deepEqual(await page.evaluate(() => HomePlanner.getScene().balconies.map(item => item.sourceId)), ['balcony-1', 'balcony-3']);
    const generated = await page.evaluate(() => {
      const opening = HomePlanner.getScene().openings.find(item => !item.hosted && item.kind === 'window');
      if (opening) HomePlanner.select({ kind: 'window', id: opening.id });
      return opening;
    });
    assert.ok(generated, 'The fixture must retain a generated window for deletion parity');
    await page.locator('#roomDeleteSelection').click(); await action('confirm').click();
    assert.equal(await page.evaluate(id => HomePlanner.getScene().openings.some(item => item.id === id), generated.id), false);
    await history('undo').click();
    assert.ok(await page.evaluate(id => HomePlanner.getScene().openings.some(item => item.id === id), generated.id));
    await history('redo').click();
    await page.evaluate(() => { const saved = HomePlanner.exportProject(); HomePlanner.newProject(); HomePlanner.importProject(saved); });
    assert.equal(await page.evaluate(id => HomePlanner.getScene().openings.some(item => item.id === id), generated.id), false,
      'Generated-opening suppression must survive the real project JSON codec');
    await page.evaluate(() => HomePlanner.execute({ type: 'add-floor', copyFromId: 'floor-1' }));
    await page.evaluate(id => HomePlanner.select({ kind: 'wall', id }), fixture.wallId);
    assert.ok((await inspector.innerText()).includes('belongs to'));
    assert.equal(await action('delete-wall').count(), 0);
    assert.equal(await action('configure-door').count(), 0);
    await page.evaluate(() => {
      const wall = HomePlanner.getScene().walls.find(item => item.exterior && !item.removed);
      HomePlanner.select({ kind: 'wall', id: wall.id });
    });
    await action('configure-window').click();
    await page.locator('#hp-editor-new-opening-offsetM').fill('1');
    const revision = await page.evaluate(() => HomePlanner.getProject().revision);
    await page.setViewportSize({ width: 390, height: 950 });
    assert.equal(await page.locator('#hp-editor-new-opening-offsetM').inputValue(), '1');
    await page.locator('#hp-editor-new-opening-offsetM').press('Backspace');
    assert.equal(await page.evaluate(() => HomePlanner.getProject().revision), revision, 'Text editing must not remove geometry');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow opening controls must not overflow the page');
    assert.deepEqual(errors, []);
    const result = { stagedIndexIntegration: integration.staged, indexStaging: integration.stages,
      staircaseDragOneUndo: true, visibleCanvasHistory: true,
      visible3DHistory,
      noUnrelatedRoomRelayout: true, exactToEnd2D: true, retainedSpan2D: true,
      realCanvas3DPick: true, doorFrom2D: true, windowFrom3D: true, wallDelete2DAnd3D: true, wallDeleteUndo: true,
      balconyDeleteUndoRedoImport: true, balcony3DReady: pick.balcony3DPicks, inactiveFloorReadOnly: true,
      generatedOpeningDeleteUndoRedoImport: true, shared2DToolbar: true, shared3DToolbar: true,
      narrowOpeningControls: true, textSafeEditing: true, errors };
    console.log(JSON.stringify(result));
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
