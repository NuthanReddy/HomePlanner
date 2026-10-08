async (page) => {
  const context = await page.context().browser().newContext();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    const legacy = await context.newPage();
    await legacy.goto('http://127.0.0.1:5175/index.html', { waitUntil: 'domcontentloaded' });
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms?.length > 0);
    const project = await legacy.evaluate(() => JSON.parse(window.HomePlanner.exportProject()));
    const native = await context.newPage();
    native.on('dialog', dialog => dialog.accept());
    const errors = [];
    native.on('pageerror', error => errors.push(error.message));
    await native.goto('http://127.0.0.1:5175/platform.html', { waitUntil: 'domcontentloaded' });
    const response = await native.request.get('http://127.0.0.1:5175/classic/planner-3d.js');
    check(response.ok() && !(await response.text()).includes('injectQuery'), 'Classic 3D was transformed into ESM.');
    await native.evaluate(async project => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { NativeDesign } = await import('/src/platform/NativeDesign.tsx');
      const host = document.createElement('div');
      document.body.append(host);
      window.nativeCache = { document: null };
      window.nativeRoot = DOM.createRoot(host);
      window.renderDesign = baseline => window.nativeRoot.render(React.createElement(NativeDesign, {
        cache: window.nativeCache, savedDocumentText: baseline,
      }));
      window.renderDesign(null);
    }, project);
    await native.locator('.native-design input[type="file"]').setInputFiles({
      name: 'isolated-room-planner.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await native.waitForFunction(() => document.querySelector('#roomPlan')?.innerHTML.length > 100);
    const before = await native.evaluate(() => ({
      id: window.nativeCache.document.id, revision: window.nativeCache.document.revision,
      room: window.nativeCache.document.legacy.context.plan.placed.find(item => item.req.id === 'bed-1'),
    }));
    check(before.id === project.id, 'Mount changed the project identity.');
    const incompatible = structuredClone(project);
    delete incompatible.legacy.context.cfg.corridors;
    await native.locator('.native-design input[type="file"]').setInputFiles({
      name:'drawing-only.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incompatible)),
    });
    await native.locator('.native-design > [role="alert"]').waitFor();
    check(await native.evaluate(()=>window.nativeCache.document.id)===before.id,'Drawing-only import replaced live Design.');
    await native.evaluate(()=>window.renderDesign(JSON.stringify(window.nativeCache.document)));
    await native.waitForTimeout(100);
    check(await native.evaluate(()=>{
      const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return !event.defaultPrevented;
    }),'Successful saved baseline still warned for committed edits.');
    await native.locator('#hp-editor-object-select').selectOption(JSON.stringify({
      kind: 'room', id: `${project.activeFloorId}:bed-1`,
    }));
    const width = native.locator('#hp-editor-room-w');
    await width.fill(String(before.room.carpet.w - .03));
    check(await native.evaluate(()=>{
      const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
    }),'Saved baseline suppressed pending inspector draft protection.');
    check(await native.evaluate(() => window.nativeCache.document.revision) === before.revision,
      'Typing in the existing inspector committed its draft.');
    await width.press('Escape');
    await native.getByRole('button',{name:'Rooms & settings',exact:true}).click();
    await native.getByRole('button',{name:'Expand Bedroom settings',exact:true}).click();
    await native.locator('#bedMaxW').fill('-');
    check(await native.evaluate(()=>{
      const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
    }),'Saved baseline suppressed programme draft protection.');
    await native.locator('#bedMaxW').press('Escape');
    await native.getByRole('button',{name:'Rooms & settings',exact:true}).click();
    check(await native.evaluate(() => window.nativeCache.document.revision) === before.revision,
      'Inspector Escape changed geometry.');
    await native.locator('.native-design input[type="file"]').setInputFiles({
      name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid'),
    });
    await native.locator('.native-design > [role="alert"]').waitFor();
    check(await native.evaluate(() => window.nativeCache.document.id) === before.id,
      'An invalid JSON open replaced the current project.');
    const grip = native.locator('#roomPlan [data-room-id="bed-1"][data-action="resize"][data-edge="S"]').first();
    await native.getByRole('button',{name:'Zoom in',exact:true}).click();
    await native.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await native.waitForFunction(()=>!!document.fullscreenElement);
    await grip.scrollIntoViewIfNeeded();
    const box = await grip.boundingBox();
    check(box, 'The actual incumbent resize grip is absent.');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await native.evaluate(point => document.elementFromPoint(point.x,point.y)?.outerHTML, point);
    await native.mouse.move(point.x, point.y);
    await native.mouse.down();
    await native.mouse.move(point.x + 12, point.y, { steps: 3 });
    await native.waitForTimeout(60);
    check(await native.evaluate(() => window.nativeCache.document.revision) === before.revision,
      'A pointer preview committed the project.');
    await native.keyboard.press('Escape');
    await native.mouse.up();
    check(await native.evaluate(() => window.nativeCache.document.revision) === before.revision,
      'Escape committed the cancelled gesture.');
    await native.mouse.move(point.x, point.y);
    await native.mouse.down();
    await native.mouse.move(point.x + 12, point.y, { steps: 3 });
    await native.mouse.up();
    await native.waitForTimeout(100);
    const after = await native.evaluate(() => ({
      revision: window.nativeCache.document.revision,
      room: window.nativeCache.document.legacy.context.plan.placed.find(item => item.req.id === 'bed-1'),
      hint: document.querySelector('#roomEditHint').textContent,
      status: document.querySelector('#componentStatus').textContent,
    }));
    check(after.revision === before.revision + 1, `Release revision ${before.revision}→${after.revision}: ${after.hint}; ${after.status}; hit ${hit}`);
    check(after.room.carpet.h !== before.room.carpet.h || after.room.carpet.w !== before.room.carpet.w,
      'The real editor did not resize the room.');
    check(await native.evaluate(()=>{
      const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
    }),'A prior Save baseline marked a later edit clean.');
    await native.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
    await native.waitForFunction(()=>!document.fullscreenElement);
    await native.getByRole('button',{name:'Fit plan',exact:true}).click();
    await native.locator('.native-design-toolbar').getByRole('button', { name: 'Undo', exact: true }).click();
    const restored = await native.evaluate(() => window.nativeCache.document.legacy.context.plan.placed
      .find(item => item.req.id === 'bed-1').carpet);
    check(JSON.stringify(restored) === JSON.stringify(before.room.carpet), 'Undo did not restore the exact room.');
    await native.locator('.native-design-toolbar').getByRole('button', { name: 'Redo', exact: true }).click();
    await native.getByRole('button', { name: 'Open 3D', exact: true }).click();
    await native.waitForFunction(() => !!document.querySelector('[data-native-three] canvas'));
    await native.waitForTimeout(1500);
    const status = await native.locator('[data-hp3d="status"]').textContent();
    check(status.includes('Showing 1 storey'), `3D did not finish its real mount: ${status}`);
    await native.locator('.native-design summary').filter({hasText:'Floors & history'}).click();
    await native.getByRole('button', { name: 'Duplicate active floor', exact: true }).click();
    const duplicated = await native.evaluate(() => ({
      floors: window.nativeCache.document.floors.length,
      active: window.nativeCache.document.activeFloorId,
      rooms: window.nativeCache.document.legacy.context.plan.placed.length,
    }));
    check(duplicated.floors === 2 && duplicated.active !== project.activeFloorId &&
      duplicated.rooms === project.legacy.context.plan.placed.length, 'Independent floor duplication failed.');
    await native.locator('#hp-editor-floor-select').selectOption(project.activeFloorId);
    check(await native.evaluate(() => window.nativeCache.document.activeFloorId) === project.activeFloorId,
      'Selecting the original floor did not restore its identity.');
    check(!errors.length, `Browser errors: ${errors.join('; ')}`);
    await native.evaluate(() => window.nativeRoot.unmount());
    check(await native.locator('[data-native-three] canvas').count() === 0, 'Unmount left the 3D canvas alive.');
    return { rooms: project.legacy.context.plan.placed.length, identityPreserved: true,
      previewUnchanged: true, escapeCancelled: true, releaseRevisions: 1,
      undoExact: true, redo: true, inspectorDraftCancelled: true, invalidImportPreserved: true,
      drawingOnlyImportPreserved:true,savedBaseline:true,pendingDraftWarning:true,fullscreenZoomGestures:true,
      independentFloors: true, three: status, teardown: true, errors };
  } finally {
    await context.close();
  }
}
