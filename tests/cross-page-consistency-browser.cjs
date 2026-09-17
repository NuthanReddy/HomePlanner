const assert = require('node:assert/strict');

// Run against a fresh browser context. This fixture deliberately edits only that disposable project.
module.exports = async function crossPageConsistency(page, { atomic = true } = {}) {
  const checks = [], errors = [];
  let accept = false;
  const dialog = async item => accept ? item.accept() : item.dismiss();
  page.on('dialog', dialog);
  page.on('pageerror', error => errors.push(error.message));
  const route = name => page.evaluate(name => HomePlannerWorkspace.navigate(name), name);
  const fresh = async () => {
    await page.evaluate(() => {
      HomePlanner.newProject();
      const original = HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({ type: 'add-floor', name: 'Ground test floor' });
      HomePlanner.execute({ type: 'delete-floor', id: original });
    });
    await route('overview/summary');
  };
  const open = async selector => {
    const details = page.locator(selector);
    if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
  };
  const undo = () => page.locator('#plannerProjectTools [data-hp-editor-action="undo"]').click();
  const record = name => { checks.push(name); console.log(`PASS ${name}`); };
  try {
    await fresh();
    await route('design/structure'); await page.locator('#hp-structure-label').fill('Pending column');
    await page.locator('#hp-structure-startX').fill('1.25');
    await route('design/plumbing'); await page.locator('#hp-service-x').fill('2.75');
    await route('design/drainage'); await page.locator('#hp-drainage-x').fill('3.75');
    await route('design/elevations'); await page.locator('#hp-view-name').fill('Pending elevation');
    await page.locator('#hp-facade-label').fill('Pending canopy');
    const draftValues = () => page.evaluate(() => ({
      structure: document.getElementById('workspaceStructure').homePlannerStructure.getState().draft.label,
      plumbing: document.getElementById('workspacePlumbing').homePlannerServices.getState().draft.x,
      drainage: document.getElementById('workspaceDrainage').homePlannerDrainage.getState().draft.x,
      view: document.getElementById('workspaceViews').homePlannerViews.getState().draft.name,
      facade: document.getElementById('workspaceFacades').homePlannerFacades.getState().draft.label
    }));
    const drafts = await draftValues();
    await route('overview/summary');
    await open('#workspaceProjectMenu');
    await page.locator('#hp-storage-project-name').fill('Renamed only');
    await page.locator('#plannerPersistence').getByRole('button', { name: 'Rename', exact: true }).click();
    assert.deepEqual(await draftValues(), drafts);
    await page.evaluate(() => { document.getElementById('workspaceProjectMenu').open = false; });
    const ground = await page.evaluate(() => {
      const id = HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({ type: 'add-floor', name: 'Other floor', copyFromId: id });
      return id;
    });
    await page.locator('#hp-editor-floor-select').selectOption(ground);
    assert.deepEqual(await draftValues(), drafts);
    record('F1 workbench drafts survive rename and floor round-trip');

    await fresh();
    const floors = await page.evaluate(() => {
      const ground = HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({ type: 'add-floor', name: 'Upper', copyFromId: ground });
      const upper = HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({ type: 'select-floor', id: ground });
      return { ground, upper };
    });
    await route('site/context');
    await page.locator('#env-storey-form').locator('..').evaluate(node => { node.open = true; });
    await page.locator('#env-storey').fill('4.2');
    await page.locator('#env-wall-height').fill('3.1');
    await page.locator('#hp-editor-floor-select').selectOption(floors.upper);
    assert.equal(await page.locator('#env-storey').inputValue(), '3');
    assert.notEqual(await page.locator('#env-wall-height').inputValue(), '3.1');
    await page.locator('#hp-editor-floor-select').selectOption(floors.ground);
    assert.equal(await page.locator('#env-storey').inputValue(), '4.2');
    assert.equal(await page.locator('#env-wall-height').inputValue(), '3.1');
    await page.locator('#env-storey-form button[type="submit"]').click();
    const heights = await page.evaluate(() => HomePlanner.getProject().floors.map(floor => floor.heightM));
    assert.deepEqual(heights, [4.2, 3]);
    record('F2 storey/building drafts remain owned by the original floor');

    await fresh(); await route('compare/envelope');
    const thickness = page.locator('[data-layer-field="thicknessM"]').first();
    await thickness.fill('0.2'); await page.locator('#env-material-form button[type="submit"]').click();
    const first = await page.locator('#env-material-results').innerText();
    assert.match(first, /3\.025/);
    await thickness.fill('0.4'); await page.locator('#env-material-form button[type="submit"]').click();
    assert.match(await page.locator('#env-material-results').innerText(), /2\.036/);
    await undo(); await undo();
    assert.equal(await thickness.inputValue(), '0.2');
    assert.equal(await page.locator('#env-material-results').innerText(), first);
    record('F3 Undo restores the matching assembly result');

    await fresh(); await route('design/structure');
    for (const [name, value] of Object.entries({ label: 'Source column', startX: '1', startY: '1', startZ: '0' }))
      await page.locator(`#hp-structure-${name}`).fill(value);
    await page.locator('#workspaceStructure button[type="submit"]').click();
    const columnId = await page.evaluate(() => document.getElementById('workspaceStructure').homePlannerStructure.getState().selectedId);
    assert.ok(columnId);
    await page.locator('#hp-structure-selectedId').selectOption('');
    await route('report/package'); await open('.hp-package-settings');
    await page.locator('#hp-package-paper').selectOption('A2');
    await page.locator('#hp-package-scaleDenominator').selectOption('75');
    await page.locator('#hp-package-refresh').click();
    const index = await page.evaluate(id => {
      const state = document.getElementById('workspacePackage').homePlannerPackage.getState();
      if (state.error) throw new Error(state.error);
      return state.package.findings.findIndex(f => f.entityId === id && f.discipline === 'structure');
    }, columnId);
    assert.ok(index >= 0); await open('.hp-package-findings');
    await page.locator(`#hp-package-finding-${index}`).click();
    assert.equal(await page.locator('#hp-structure-selectedId').inputValue(), columnId);
    assert.deepEqual(await page.evaluate(() => HomePlanner.getSelection()), { kind: 'structural', id: columnId });
    record('F4 package source selects the real authored record');

    await fresh(); await route('design/electrical');
    const wall = await page.evaluate(() => HomePlanner.getScene().walls.find(wall => !wall.removed).id);
    await page.locator('#elec-point-label').fill('Scoped socket');
    await page.locator('#elec-point-purpose').fill('Synthetic device intent');
    await page.locator('#elec-point-wallId').selectOption(wall);
    await page.locator('#elec-point-face').selectOption('left');
    await page.locator('#elec-point-offsetM').fill('1');
    await page.locator('#elec-point-elevationM').fill('1');
    await page.locator('[data-elec-form] button[type="submit"]').click();
    const point = await page.evaluate(() => HomePlanner.getProject().electrical[0]);
    assert.ok(point, await page.locator('[data-elec-error]').innerText());
    await page.locator('#elec-point-label').fill('Pending socket name');
    await page.evaluate(() => HomePlanner.execute({ type: 'rename-project', name: 'Another unrelated rename' }));
    assert.equal(await page.locator('#elec-point-label').inputValue(), 'Pending socket name');
    await page.locator('[data-elec-action="delete"]').press('Enter');
    assert.equal(await page.evaluate(() => HomePlanner.getProject().electrical.length), 1);
    accept = true; await page.locator('[data-elec-action="delete"]').press('Enter'); accept = false;
    assert.equal(await page.evaluate(() => HomePlanner.getProject().electrical.length), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'elec-editor-title');
    await undo();
    assert.deepEqual(await page.evaluate(() => HomePlanner.getProject().electrical[0]), point);
    await route('site/context'); await open('#env-obstacle-editor');
    await page.locator('#env-obstacle-label').fill('Scoped tree');
    await page.locator('#env-obstacle-form button[type="submit"]').click();
    assert.equal(await page.locator('[data-env-obstacle-remove]').count(), 1);
    await page.locator('[data-env-obstacle-remove]').press('Enter');
    assert.equal(await page.evaluate(() => HomePlanner.getProject().obstacles.length), 1);
    accept = true; await page.locator('[data-env-obstacle-remove]').press('Enter'); accept = false;
    assert.equal(await page.evaluate(() => document.activeElement.id), 'env-obstacle-heading');
    assert.equal(await page.evaluate(() => HomePlanner.getProject().obstacles.length), 0);
    record('F5 named electrical/obstacle confirmation, cancellation, focus and Undo');

    if (atomic) {
      await fresh(); await route('site/context');
      const before = await page.evaluate(() => HomePlanner.getProject());
      await page.locator('#env-lat').fill('19.5'); await page.locator('#env-site-verified').check();
      await page.locator('#env-site-form button[type="submit"]').click();
      const after = await page.evaluate(() => HomePlanner.getProject());
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.environment.siteProvenance.buildingSiteConfirmed, true);
      assert.equal(after.site.latitude, 19.5);
      await undo();
      const restored = await page.evaluate(() => HomePlanner.getProject());
      assert.deepEqual(restored.site, before.site);
      assert.deepEqual(restored.environment, before.environment);
      await page.locator('#env-building-form').locator('..').evaluate(node => { node.open = true; });
      await page.locator('#env-wall-height').fill('3.1'); await page.locator('#env-geometry-ack').check();
      const prior = await page.evaluate(() => HomePlanner.getProject());
      await page.locator('#env-building-form button[type="submit"]').click();
      const applied = await page.evaluate(() => HomePlanner.getProject());
      assert.equal(applied.revision, prior.revision + 1);
      assert.equal(applied.environment.buildingAssumptions.wallHeightM, 3.1);
      await undo();
      assert.deepEqual(await page.evaluate(() => HomePlanner.getProject().building), prior.building);
      record('F6 atomic site/building provenance and one-step Undo');
    }

    await fresh();
    await page.evaluate(() => {
      const floorId = HomePlanner.getProject().activeFloorId, authored = HomePlannerModel.emptyAuthored();
      authored.structural = Array.from({ length: 25 }, (_, i) => ({
        id: `${floorId}:authored:column-${i}`, kind: 'column', anchors: [null], widthM: null, depthM: null, material: null
      }));
      HomePlanner.execute({ type: 'set-authored', value: authored });
    });
    await route('report/drawings'); await open('.hp-drawing-print-settings');
    await page.locator('#hp-drawing-paper').selectOption('A2');
    await page.locator('#hp-drawing-discipline').selectOption('structural');
    await page.locator('[data-drawing-export="svg"]').click();
    const links = await page.locator('.hp-drawing-outputs a').evaluateAll(nodes => nodes.map(node => node.href));
    assert.ok(links.length > 1); await page.locator('#hp-drawing-pageIndex').selectOption('1');
    assert.deepEqual(await page.locator('.hp-drawing-outputs a').evaluateAll(nodes => nodes.map(node => node.href)), links);
    record('F7 prepared multipage SVG links survive preview-page selection');

    await route('design/structure');
    await page.locator('[data-workspace-action="save"]').click();
    await page.waitForFunction(() => document.querySelector('.hp-storage-status').dataset.state === 'saved');
    const original = await page.evaluate(() => HomePlanner.getProject());
    await page.locator('#hp-structure-label').fill('Pending before JSON import');
    const download = page.waitForEvent('download');
    await page.evaluate(() => document.getElementById('plannerPersistence').homePlannerPersistence.requestExportJSON());
    const file = await download; assert.match(file.suggestedFilename(), /\.homeplanner\.json$/); await file.cancel();
    const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => document.getElementById('plannerPersistence').homePlannerPersistence.requestImportJSON());
    await (await chooser).setFiles({ name: 'complete-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
    await page.waitForFunction(() => !document.querySelector('.hp-storage-confirm').hidden);
    assert.equal(await page.locator('#workspaceProjectMenu').evaluate(node => node.open), true);
    assert.equal(await page.evaluate(() => HomePlanner.getProject().id), original.id);
    await page.locator('.hp-storage-confirm').getByRole('button', { name: 'Import JSON as a separate project', exact: true }).click();
    await page.waitForFunction(id => HomePlanner.getProject().id !== id, original.id);
    const imported = await page.evaluate(() => HomePlanner.getProject());
    assert.deepEqual({ ...imported, id: original.id, name: original.name }, original);
    assert.equal(await page.evaluate(id => document.getElementById('plannerPersistence').homePlannerPersistence.getState().projects.some(p => p.id === id), original.id), true);
    record('Reusable complete-project JSON picker/download flows guard drafts and preserve original saved IDs');
    assert.deepEqual(errors, []);
    return { checks, count: checks.length };
  } finally { page.removeListener('dialog', dialog); }
};
