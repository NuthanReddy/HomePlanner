'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

async function editorInteractionSmoke(browser, url) {
  const results = [];
  for (const touch of [false, true]) {
    const mode = touch ? 'touch' : 'mouse';
    const context = await browser.newContext({
      viewport: { width: touch ? 430 : 1440, height: 1100 }, hasTouch: touch, isMobile: touch,
      serviceWorkers: 'block'
    });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
        ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.HomePlannerEditorInstance && !!window.HomePlanner?.getScene());
      const fixture = await page.evaluate(() => {
        HomePlannerWorkspace.navigate('design/layout');
        document.getElementById('face').value = 'N'; buildRoadInputs();
        for (const [id, value] of Object.entries({
          dunit: '1', pEW: '30', pNS: '30', livingCount: '1', bedCount: '0', kitchenCount: '0',
          bathCount: '0', poojaCount: '0', balconyCount: '0', liftCount: '0', stairCount: '0'
        })) {
          const input = document.getElementById(id);
          if (input.hasAttribute('data-room-setting')) HomePlannerRoomInputs.writeCommitted(input, value);
          else input.value = value;
        }
        render();
        let ctx = window.__roomPlanner;
        const core = ctx.g.core;
        if (core.x + INT_WALL / 2 > 1 || core.x + core.w < 5)
          throw new Error('The isolated fixture needs space for a living room starting at X = 1 m.');
        roomSaveManualLayout(ctx);
        const saved = roomManualLayouts.get(ctx.signature);
        saved.rooms = { 'living-1': { x: 1, y: core.y + .4, w: 4, h: 4 } };
        saved.preserveRooms = true; saved.furniture = {}; saved.openings = []; saved.wallOpenings = [];
        renderRoomPlanner(window.__last);
        ctx = window.__roomPlanner;
        roomSaveManualLayout(ctx);
        const retained = roomManualLayouts.get(ctx.signature);
        retained.furniture = {}; retained.hiddenFurniture = ctx.plan.furniture.map(item => item.id);
        renderRoomPlanner(window.__last); HomePlanner.acceptLegacy();
        const room = HomePlanner.getScene().rooms.find(item => item.sourceId === 'living-1');
        if (!room || room.rect.x !== 1 || HomePlanner.getScene().furniture.length)
          throw new Error('The controlled room/furniture fixture did not survive the production adapter.');
        HomePlanner.select({ kind: 'room', id: room.id });
        HomePlannerEditorInstance.requestEditSelection();
        window.__editorNativeEvents = [];
        for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'change', 'blur', 'click'])
          document.addEventListener(type, event => {
            if (event.target.id === 'hp-editor-room-x' || event.target.dataset?.hpEditorAction) {
              window.__editorNativeEvents.push({
                type, pointerType: event.pointerType || null, trusted: event.isTrusted,
                target: event.target.id || event.target.dataset.hpEditorAction
              });
            }
          }, true);
        return { roomId: room.id, text: HomePlanner.exportProject() };
      });
      const inspector = page.locator('#plannerInspector');
      const action = name => inspector.locator(`[data-hp-editor-action="${name}"]`);
      const press = (locator, options = {}) => touch ? locator.tap(options) : locator.click(options);
      const reset = async () => {
        await page.evaluate(({ text, roomId }) => {
          HomePlanner.importProject(text);
          HomePlanner.select({ kind: 'room', id: roomId });
          HomePlannerEditorInstance.requestEditSelection();
        }, fixture);
        await page.locator('#hp-editor-room-x').press('Escape');
        await page.evaluate(() => { window.__editorNativeEvents = []; });
      };
      const state = () => page.evaluate(roomId => {
        const room = HomePlanner.getScene().rooms.find(item => item.id === roomId);
        const pending = HomePlannerEditorInstance.getPendingDrafts().find(item => item.collection === 'rooms' && item.entityId === roomId);
        return {
          x: room?.rect.x ?? null, revision: HomePlanner.getProject().revision,
          raw: pending?.draft.fields?.x?.raw ?? null, undo: HomePlanner.canUndo(),
          focusId: document.activeElement?.id || null, focusAction: document.activeElement?.dataset?.hpEditorAction || null
        };
      }, fixture.roomId);
      const check = async (name, work) => {
        try {
          await reset();
          const detail = await work();
          results.push({ mode, name, passed: true, ...detail });
        } catch (error) { results.push({ mode, name, passed: false, error: error.message }); }
      };

      await check('navigation parks the draft through native compatibility events', async () => {
        const before = await state(), input = page.locator('#hp-editor-room-x');
        await input.fill('1.25');
        await press(action('delete-room'));
        const events = await page.evaluate(() => window.__editorNativeEvents);
        const down = events.find(item => item.type === 'pointerdown' && item.target === 'delete-room');
        assert.equal(down?.trusted, true, 'Exercise trusted native pointer input, not dispatched DOM events.');
        assert.equal(down.pointerType, mode);
        if (touch) {
          const up = events.findIndex(item => item.type === 'pointerup' && item.target === 'delete-room');
          const mouse = events.findIndex(item => item.type === 'mousedown' && item.target === 'delete-room');
          assert.ok(up >= 0 && mouse > up, 'The regression must exercise touchend followed by compatibility mouse/focus events.');
        }
        const requested = await state();
        assert.deepEqual({ x: requested.x, revision: requested.revision, raw: requested.raw },
          { x: 1, revision: before.revision, raw: '1.25' }, 'Requesting deletion must not commit an input during compatibility focus.');
        await press(action('cancel-confirmation'));
        const cancelled = await state();
        assert.deepEqual({ x: cancelled.x, revision: cancelled.revision, raw: cancelled.raw, undo: cancelled.undo },
          { x: 1, revision: before.revision, raw: '1.25', undo: before.undo });
        assert.equal(cancelled.focusAction, 'delete-room');
        await input.press('Enter'); await input.press('Tab');
        const committed = await state();
        assert.equal(committed.x, 1.25);
        assert.equal(committed.revision, before.revision + 1, 'A genuine keyboard commit is not suppressed or repeated.');
        assert.equal(committed.raw, null);
        await input.fill('1.5');
        await press(page.locator('#hp-editor-room-y'));
        const ordinaryBlur = await state();
        assert.equal(ordinaryBlur.x, 1.5, 'Normal field-to-field change/blur still commits.');
        assert.equal(ordinaryBlur.revision, before.revision + 2);
        assert.equal(ordinaryBlur.raw, null);
        return { trustedPointer: down.pointerType, nativeOrder: events.filter(item => item.target === 'delete-room').map(item => item.type) };
      });

      await check('confirmed room deletion returns focus to the persistent inspector heading', async () => {
        const before = await state();
        await press(action('delete-room'));
        assert.equal((await state()).focusAction, 'confirm');
        await press(action('confirm'));
        const deleted = await state();
        assert.equal(deleted.x, null);
        assert.equal(deleted.revision, before.revision + 1);
        assert.equal(await action('confirm').count(), 0);
        assert.equal(deleted.focusId, 'hp-editor-inspector-heading', 'Successful deletion must not strand focus on BODY.');
        await page.evaluate(() => HomePlanner.undo());
        assert.equal((await state()).x, 1);
      });

      await check('confirmed opening deletion returns focus without erasing its source', async () => {
        const opening = await page.evaluate(() => {
          const scene = HomePlanner.getScene();
          const wall = scene.walls.find(wall => !wall.removed && wall.heightM >= 2.1
            && ['unknown', 'non-structural'].includes(wall.structuralRole)
            && Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) > 1
            && !scene.openings.some(opening => opening.wallId === wall.id));
          if (!wall) throw new Error('Choose an unoccupied canonical wall for the isolated opening fixture.');
          HomePlanner.execute({
            type: 'add-window', wallId: wall.id, offsetM: .1, widthM: .3,
            sillM: .9, heightM: 1.2, openFraction: 0
          });
          HomePlannerEditorInstance.requestEditSelection();
          const selection = HomePlanner.getSelection();
          return { id: selection.id, revision: HomePlanner.getProject().revision };
        });
        await press(action('delete-opening'));
        assert.equal((await state()).focusAction, 'confirm');
        await press(action('confirm'));
        const after = await page.evaluate(id => ({
          present: HomePlanner.getScene().openings.some(item => item.id === id),
          revision: HomePlanner.getProject().revision,
          suppressed: HomePlanner.getProject().windowEdits[id]?.suppressed,
          focus: document.activeElement?.id || document.activeElement?.tagName
        }), opening.id);
        assert.deepEqual(after, { present: false, revision: opening.revision + 1, suppressed: true, focus: 'hp-editor-inspector-heading' });
        await page.evaluate(() => HomePlanner.undo());
        assert.equal(await page.evaluate(id => HomePlanner.getScene().openings.some(item => item.id === id), opening.id), true);
      });

      await check('failed source fence keeps confirmation focus and Cancel returns to its trigger', async () => {
        await press(action('delete-room'));
        await page.evaluate(() => HomePlanner.execute({ type: 'rename-project', name: 'Changed during review' }));
        const before = await page.evaluate(() => HomePlanner.exportProject());
        await press(action('confirm'), { force: true });
        assert.ok(await page.evaluate(text => HomePlanner.exportProject() === text, before), 'A stale confirmation must not execute deletion.');
        assert.match(await page.locator('#hp-editor-inspector-error').innerText(), /plan changed/i);
        assert.equal((await state()).focusAction, 'confirm');
        assert.equal(await action('confirm').count(), 1);
        await press(action('cancel-confirmation'));
        assert.equal((await state()).focusAction, 'delete-room');
        assert.equal((await state()).x, 1);
      });
      assert.deepEqual(errors, [], `${mode}: production page errors`);
      assert.deepEqual(await page.evaluate(() => HomePlanner.getObserverErrors()), [], `${mode}: observer errors`);
    } finally { await context.close(); }
  }
  const failures = results.filter(result => !result.passed);
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  return results;
}

module.exports = editorInteractionSmoke;

if (require.main === module) {
  (async () => {
    const { chromium } = require(process.env.HOMEPLANNER_PLAYWRIGHT_MODULE || 'playwright');
    const root = path.resolve(__dirname, '..');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
    const server = http.createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, name === '/' ? 'index.html' : name.slice(1).replaceAll('/', path.sep));
      if (!file.startsWith(root + path.sep) || !/\.(html|js|css|svg|png|ico|json|woff2)$/.test(file) || !fs.existsSync(file)) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).on('error', error => response.destroy(error)).pipe(response);
    });
    let browser;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/?workspace=design&section=layout`;
      assert.equal((await fetch(url)).status, 200);
      browser = await chromium.launch({ channel: process.env.HOMEPLANNER_BROWSER_CHANNEL || 'chrome', headless: true });
      const results = await editorInteractionSmoke(browser, url);
      console.log(JSON.stringify(results, null, 2));
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
