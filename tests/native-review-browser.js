async (page) => {
  const context = await page.context().browser().newContext();
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    const legacy = await context.newPage();
    await legacy.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'domcontentloaded' });
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms?.length);
    await legacy.evaluate(() => {
      const project = window.HomePlanner.getProject();
      window.HomePlanner.execute({ type: 'update-room-controls', projectId: project.id, floorId: project.activeFloorId,
        patch: { windowHeadHeight: 4 }, expected: { windowHeadHeight: project.legacy.controls.windowHeadHeight.value } });
      document.querySelector('#vastuMode').checked = true;
      document.querySelector('#vastuMode').dispatchEvent(new Event('change', { bubbles: true }));
      for (const opening of window.HomePlanner.getScene().openings.filter(item => item.kind === 'window'))
        window.HomePlanner.execute({ type: 'delete-opening', id: opening.id });
    });
    const fixture = await legacy.evaluate(() => {
      const ctx = window.__roomPlanner;
      return { project: JSON.parse(window.HomePlanner.exportProject()),
        scores: Object.fromEntries(['science','green','vastu'].map(scope =>
          [scope, roomChecklistItemsFor(scope, ctx)])) };
    });
    const native = await context.newPage(), errors = [];
    native.on('pageerror', error => errors.push(error.message));
    await native.goto('http://127.0.0.1:5174/platform.html', { waitUntil: 'domcontentloaded' });
    await native.evaluate(async fixture => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { loadDesignRuntime } = await import('/src/platform/design-runtime.ts');
      const { DesignDisciplineTabs } = await import('/src/platform/DesignDisciplineTabs.tsx');
      const runtime = await loadDesignRuntime();
      const layout = document.createElement('div'), container = document.createElement('div');
      layout.id = 'review-layout-fixture';
      layout.innerHTML = runtime.Controls.settings + runtime.Controls.palette +
        '<p id="roomEditHint"></p><button id="roomReset"></button><p id="componentStatus"></p><svg id="roomPlan" viewBox="0 0 800 560"></svg>';
      document.body.replaceChildren(layout, container);
      window.reviewMount = runtime.Design.mount(layout.querySelector('svg'), layout, fixture.project, {
        Model: runtime.Model, Bridge: runtime.Bridge, Regions: runtime.Regions, Layout: runtime.Layout,
        Generator: runtime.Generator, RoomInputs: runtime.RoomInputs,
      });
      window.reviewApi = window.HomePlannerDesignRuntime.getReview(window.reviewMount.planner);
      const fixAll = window.reviewApi.fixAll;
      window.reviewApi.fixAll = () => {
        try { window.reviewFixResult = fixAll(); return window.reviewFixResult; }
        catch (error) { window.reviewFixError = error.stack; throw error; }
      };
      window.reviewOriginal = window.reviewMount.planner.exportProject();
      window.reviewExpected = fixture.scores;
      window.reviewRoot = DOM.createRoot(container);
      window.reviewRoot.render(React.createElement(DesignDisciplineTabs, {
        planner: window.reviewMount.planner, activeTab: 'review',
      }));
      layout.hidden = true;
    }, fixture);
    await native.getByRole('button', { name: 'Fix all feasible', exact: true }).waitFor();
    await native.waitForFunction(() => window.HomePlannerElectrical?.mount);
    const initial = await native.evaluate(() => ({
      state: window.reviewApi.getState(),
      scoresEqual: JSON.stringify(window.reviewApi.getState().scopes) === JSON.stringify(window.reviewExpected),
      project: window.reviewMount.planner.exportProject(),
    }));
    check(initial.scoresEqual, 'Native Review scores differ from incumbent scores on identical current geometry');
    await native.getByRole('button', { name: 'Fix all feasible', exact: true }).click();
    await native.waitForTimeout(30);
    const fixed = await native.evaluate(() => ({
      state: window.reviewApi.getState(), project: window.reviewMount.planner.exportProject(),
      status: document.querySelector('.native-review [role="status"]')?.textContent,
      error: window.reviewFixError,
      result: window.reviewFixResult,
    }));
    if (fixed.error) {
      const trace = await native.evaluate(() => {
        try { return window.reviewApi.fixAll(); } catch (error) { return error.stack; }
      });
      check(false, `Fix all error: ${fixed.error}; retry ${trace}`);
    }
    check(fixed.state.revision <= initial.state.revision + 1, 'Fix all emitted more than one revision');
    if (fixed.state.revision > initial.state.revision) {
      check(fixed.state.canUndoFix, 'Successful fix missing Undo last fix');
      await native.getByRole('button', { name: 'Undo last fix', exact: true }).click();
      check(await native.evaluate(() => {
        const before = JSON.parse(window.reviewOriginal), after = window.reviewMount.planner.getProject();
        delete before.revision; delete before.updatedAt;
        const copy = JSON.parse(JSON.stringify(after)); delete copy.revision; delete copy.updatedAt;
        return JSON.stringify(before) === JSON.stringify(copy);
      }).catch(() => false), 'Undo did not restore original authored state');
    } else check(fixed.project === initial.project, 'Unimproved fix changed project');
    check(fixed.state.revision === initial.state.revision + 1, 'Degraded fixture did not exercise a successful fix');
    const rowRevision = await native.evaluate(() => window.reviewMount.planner.getProject().revision);
    await native.locator('.native-review-table tr').filter({ hasText: 'Exterior daylight opening' })
      .getByRole('button', { name: 'Fix', exact: true }).click();
    await native.waitForTimeout(30);
    check(await native.evaluate(() => window.reviewMount.planner.getProject().revision) === rowRevision + 1,
      'Individual row fix did not make exactly one authored revision');
    const protectedUndo = await native.evaluate(() => {
      window.reviewMount.planner.execute({ type: 'rename-project', name: 'Later independent edit' });
      const before = window.reviewMount.planner.exportProject();
      let message;
      try { window.reviewApi.undoFix(); } catch (error) { message = error.message; }
      return { unchanged: before === window.reviewMount.planner.exportProject(), message,
        disabled: !window.reviewApi.getState().canUndoFix };
    });
    check(protectedUndo.unchanged && protectedUndo.disabled && protectedUndo.message.includes('changed after'),
      'Undo last fix discarded later independent work');
    await native.evaluate(() => { window.reviewMount.planner.undo(); window.reviewMount.planner.undo(); });
    const parityAfter = await native.evaluate(() => window.reviewApi.getState());
    // Pending numeric drafts must not be absorbed by a checklist mutation.
    await native.evaluate(() => {
      document.querySelector('#review-layout-fixture').hidden = false;
      let node = document.querySelector('#bedCount');
      while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; }
    });
    const count = native.locator('#bedCount');
    await count.fill('7');
    const pending = await native.evaluate(() => window.reviewApi.getState());
    check(pending.pendingInputs > 0, 'Numeric draft was not registered');
    const draftResult = await native.evaluate(() => {
      const before = window.reviewMount.planner.exportProject();
      let message = '';
      try { window.reviewApi.fixAll(); } catch (error) { message = error.message; }
      return { unchanged: before === window.reviewMount.planner.exportProject(), message };
    });
    check(draftResult.unchanged && draftResult.message.includes('pending'), 'Fix consumed an unrelated input draft');
    await count.press('Escape');
    await native.evaluate(() => { document.querySelector('#review-layout-fixture').hidden = true; });
    await native.setViewportSize({ width: 390, height: 844 });
    check(await native.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Review overflowed mobile viewport');
    check(!errors.length, errors.join('; '));
    await native.evaluate(() => { window.reviewRoot.unmount(); const planner = window.reviewMount.planner; window.reviewMount.destroy(); window.reviewRegistryCleared = window.HomePlannerDesignRuntime.getReview(planner) === null; });
    check(await native.evaluate(() => window.reviewRegistryCleared), 'Disposed planner retained Review registry');
    return { incumbentScoreParity: true, revisionDelta: fixed.state.revision - initial.state.revision,
      status: fixed.result || fixed.status, undo: fixed.state.canUndoFix, pendingDraftProtected: true,
      reviewItems: Object.fromEntries(Object.entries(parityAfter.scopes).map(([key, rows]) => [key, rows.length])),
      individualFix: true, laterEditProtected: true, mobileOverflow: false, registryDisposed: true, errors };
  } finally { await context.close(); }
}
