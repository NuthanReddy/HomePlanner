async (page) => {
  const context = await page.context().browser().newContext({ acceptDownloads: true });
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    const legacy = await context.newPage();
    await legacy.goto('http://127.0.0.1:5174/index.html');
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms?.length);
    const fixture = await legacy.evaluate(() => JSON.parse(window.HomePlanner.exportProject()));
    const native = await context.newPage(), errors = [];
    native.on('pageerror', error => errors.push(error.message));
    native.on('dialog', dialog => dialog.accept());
    await native.goto('http://127.0.0.1:5174/platform.html');
    // This fixture mounts components, not an account workspace or live user data.
    await native.evaluate(async fixture => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { loadDesignRuntime } = await import('/src/platform/design-runtime.ts');
      const { DesignDisciplineTabs } = await import('/src/platform/DesignDisciplineTabs.tsx');
      const runtime = await loadDesignRuntime();
      const layout = document.createElement('div');
      layout.innerHTML = runtime.Controls.settings + runtime.Controls.palette +
        '<p id="roomEditHint"></p><button id="roomReset"></button><p id="componentStatus"></p><svg id="roomPlan" viewBox="0 0 800 560"></svg>';
      const container = document.createElement('div')
      document.body.replaceChildren(layout, container);
      window.disciplineFixture = runtime.Design.mount(layout.querySelector('svg'), layout, fixture, {
        Model: runtime.Model, Bridge: runtime.Bridge, Regions: runtime.Regions, Layout: runtime.Layout,
        Generator: runtime.Generator, RoomInputs: runtime.RoomInputs,
      });
      layout.hidden = true;
      window.disciplineRoot = DOM.createRoot(container);
      window.disciplineShow = tab => window.disciplineRoot.render(React.createElement(DesignDisciplineTabs, {
        planner: window.disciplineFixture.planner, activeTab: tab, onNavigate: window.disciplineShow,
      }));
      window.disciplineShow('structure');
    }, fixture);
    await native.locator('#hp-structure-label').waitFor();
    const original = await native.evaluate(() => window.disciplineFixture.planner.exportProject());
    for (const [key, value] of Object.entries({ label: 'Browser column', startX: '1', startY: '1', startZ: '0', widthM: '.2', depthM: '.2', heightM: '2.4' }))
      await native.locator(`#hp-structure-${key}`).fill(value);
    check(await native.evaluate(() => window.disciplineFixture.planner.exportProject()) === original, 'Typing authored structural draft');
    await native.evaluate(() => window.disciplineShow('plumbing'));
    await native.locator('#hp-service-x').waitFor();
    await native.locator('#hp-service-x').fill('2');
    await native.evaluate(() => window.disciplineShow('structure'));
    check(await native.locator('#hp-structure-label').inputValue() === 'Browser column', 'Structure draft lost on navigation');
    await native.getByRole('button', { name: 'Save structural intent', exact: true }).click();
    const structural = await native.evaluate(() => window.disciplineFixture.planner.getProject().floors[0].authored.structural);
    check(structural.length === 1 && structural[0].label === 'Browser column', 'Structure Save did not author incumbent record');
    await native.locator('#hp-structure-preview-paper').selectOption('A2');
    await native.getByRole('button', { name: 'Refresh coordination & 2D preview', exact: true }).click();
    const structureError = await native.locator('.hp-structure-error').textContent();
    check(!structureError, `Structure preview: ${structureError}`);
    await native.locator('.hp-structure-preview img').waitFor();
    await native.locator('.discipline-drawings > summary').click();
    await native.locator('.hp-drawing-print-settings > summary').click();
    await native.locator('#hp-drawing-paper').selectOption('A2');
    await native.locator('[data-drawing-export="svg"]').click();
    await native.locator('.hp-drawing-outputs a').first().waitFor();
    await native.locator('[data-drawing-export="pdf"]').click();
    await native.locator('.hp-drawing-outputs a[download$=".pdf"]').first().waitFor();
    check(await native.evaluate(async () => {
      const href = document.querySelector('.hp-drawing-outputs a[download$=".pdf"]').href;
      return new TextDecoder().decode((await (await fetch(href)).arrayBuffer()).slice(0, 4)) === '%PDF';
    }), 'PDF bytes were not encoded by the source exporter');
    await native.locator('#hp-drawing-pngDpi').selectOption('72');
    await native.locator('[data-drawing-export="png"]').click();
    await native.locator('.hp-drawing-outputs a[download$=".png"]').first().waitFor();
    check(await native.evaluate(async () => {
      const image = new Image();
      image.src = document.querySelector('.hp-drawing-outputs a[download$=".png"]').href;
      await image.decode();
      return image.naturalWidth > 100 && image.naturalHeight > 100;
    }), 'PNG did not decode into a real rendered sheet');
    await native.evaluate(() => window.disciplineShow('elevations'));
    await native.locator('#hp-view-name').waitFor();
    await native.locator('#hp-view-name').fill('North reference');
    await native.locator('#hp-view-direction').selectOption('N');
    await native.getByRole('button', { name: 'Save view', exact: true }).click();
    await native.locator('#hp-view-preview-paper').selectOption('A2');
    await native.locator('#workspaceViews').getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await native.locator('.hp-view-preview img').waitFor();
    for (const [key, value] of Object.entries({ label: 'Canopy reference', x: '1', y: '1', w: '1', h: '.5', baseM: '2', heightM: '.1', transmittance: '0' }))
      await native.locator(`#hp-facade-${key}`).fill(value);
    await native.getByRole('button', { name: 'Save physical box', exact: true }).click();
    check(await native.evaluate(() => window.disciplineFixture.planner.getProject().obstacles.filter(item => item.facade).length) === 1, 'Facade not saved');
    await native.evaluate(() => window.disciplineShow('plumbing'));
    check(await native.locator('#hp-service-x').inputValue() === '2', 'Plumbing draft lost');
    for (const [key, value] of Object.entries({ x: '2', y: '2', z: '0' }))
      await native.locator(`#hp-service-${key}`).fill(value);
    await native.getByRole('button', { name: 'Save fixture', exact: true }).click();
    await native.locator('#hp-service-preview-paper').selectOption('A2');
    await native.locator('#hp-service-refresh').click();
    await native.locator('.hp-service-preview img').waitFor();
    await native.evaluate(() => window.disciplineShow('drainage'));
    await native.locator('#hp-drainage-refresh').waitFor();
    await native.locator('#workspaceDrainage').getByText(/^View & print settings/).click();
    await native.locator('#workspaceDrainage .hp-service-print-settings > summary').click();
    await native.locator('#hp-drainage-preview-paper').selectOption('A2');
    await native.locator('#hp-drainage-refresh').click();
    await native.locator('.hp-service-preview img:visible').waitFor();
    await native.evaluate(() => window.disciplineShow('electrical'));
    await native.locator('[data-elec-form]').waitFor();
    await native.locator('#elec-point-label').fill('Light draft');
    await native.locator('#elec-point-purpose').fill('User requested ceiling point');
    await native.locator('#elec-point-type').selectOption('light');
    await native.locator('#elec-point-anchorKind').selectOption('ceiling');
    const room = await native.evaluate(() => window.disciplineFixture.planner.getScene().rooms[0]);
    await native.locator('#elec-point-roomId').selectOption(room.id);
    await native.locator('#elec-point-x').fill(String(room.rect.x + room.rect.w / 2));
    await native.locator('#elec-point-y').fill(String(room.rect.y + room.rect.h / 2));
    await native.getByRole('button', { name: 'Use nominal ceiling height — my assumption', exact: true }).click();
    await native.locator('[data-elec-form]').getByRole('button', { name: 'Add point', exact: true }).click();
    check(await native.evaluate(() => window.disciplineFixture.planner.getProject().electrical.length) === 1, 'Electrical point not saved');
    await native.getByRole('button', { name: 'Undo project edit', exact: true }).click();
    check(await native.evaluate(() => window.disciplineFixture.planner.getProject().electrical.length) === 0, 'Electrical shared Undo failed');
    await native.evaluate(() => window.disciplineShow('review'));
    await native.getByRole('heading', { name: 'Placement review', exact: true }).waitFor();
    check((await native.getByText('Science · daylight & ventilation', { exact: false }).count()) > 0, 'Incumbent Review scorecard missing');
    await native.setViewportSize({ width: 390, height: 844 });
    await native.evaluate(() => window.disciplineShow('drainage'));
    check(await native.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile viewport overflow');
    check(await native.evaluate(() => !window.HomePlanner), 'Native mount claimed global authority');
    check(!errors.length, errors.join('; '));
    await native.evaluate(() => { window.disciplineRoot.unmount(); window.disciplineFixture.destroy(); });
    return { structureSave: true, structurePreview: true, svgExport: true, pdfBytes: true, pngDecoded: true, savedElevation: true,
      facadeSave: true, plumbingSave: true, drainagePreview: true, electricalSaveUndo: true,
      routeDrafts: true, mobileOverflow: false, noGlobalAuthority: true, errors, review: 'incumbent scorecards mounted' };
  } finally { await context.close(); }
}
