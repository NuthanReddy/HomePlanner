(function (root) {
  'use strict';
  async function runWorkspaceSmoke() {
    const checks = [], document = root.document, planner = root.HomePlanner, workspace = root.HomePlannerWorkspace;
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
      checks.push(message);
    };
    const nextFrame = () => new Promise(resolve => root.requestAnimationFrame(resolve));
    const by = id => document.getElementById(id);
    const initial = planner.getProject(), fingerprint = root.HomePlannerStorage.fingerprint(initial);
    const mounts = ['plannerPersistence', 'plannerProjectTools', 'plannerInspector', 'roomPlanWorkspace',
      'environmentWorkspace', 'electricalWorkspace', 'prohibitedWorkspace'];
    const nodes = new Map(mounts.map(id => [id, by(id)]));
    const networkStart = root.performance.getEntriesByType('resource').length;
    for (const [destination, metadata] of Object.entries(workspace.destinations)) {
      for (const section of Object.keys(metadata.sections)) {
        workspace.navigate({ destination, section }, { scroll: false });
        await nextFrame();
        check(workspace.getRoute().destination === destination && workspace.getRoute().section === section,
          `route ${destination}/${section}`);
      }
    }
    check(root.performance.getEntriesByType('resource').length === networkStart, 'navigation alone starts no resource requests');
    check(root.HomePlannerStorage.fingerprint(planner.getProject()) === fingerprint, 'all routes preserve authored state');
    check(planner.getProject().revision === initial.revision, 'all routes preserve authored revision');
    check(mounts.every(id => nodes.get(id) === by(id)), 'legacy mounts retain node identity');
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    check(new Set(ids).size === ids.length, 'no duplicate live IDs');
    check(document.querySelectorAll('.hp-storage-status').length === 1, 'one save status');
    check(document.querySelectorAll('#hp-editor-floor-select').length === 1, 'one shared editable-floor control');
    check(document.querySelector('[data-elec-floor]').closest('label').hidden, 'electrical uses shared floor control');

    workspace.navigate('site/context');
    by('env-lat').click();
    check(workspace.getRoute().section === 'context', 'ordinary control clicks do not trigger route delegation');
    by('workspaceProjectMenu').querySelector('summary').click();
    check(by('workspaceProjectMenu').open, 'project menu retains native keyboard/click behavior');
    by('workspaceProjectMenu').open = false;
    by('env-lat').value = '19.123';
    by('env-lat').dispatchEvent(new root.Event('input', { bubbles: true }));
    workspace.navigate('environment/solar');
    check(document.querySelector('.env-context').hidden, 'environment analysis does not expose site editors');
    workspace.navigate('site/context');
    check(!document.querySelector('.env-context').hidden && by('env-lat').value === '19.123', 'site draft survives route changes');
    check(by('env-solar-section').hidden, 'site context does not expose downstream analysis controls');

    const projectLatitude = planner.getProject().site.latitude;
    workspace.navigate('environment/sun');
    by('sunLatitude').value = '20.125';
    by('sunLatitude').dispatchEvent(new root.Event('input', { bubbles: true }));
    workspace.navigate('design/layout');
    document.body.homePlannerWorkspace.setMode('expert');
    document.body.homePlannerWorkspace.setMode('homeowner');
    workspace.navigate('environment/sun');
    check(by('sunLatitude').value === '20.125', 'exploratory sun draft survives modes and navigation');
    check(planner.getProject().site.latitude === projectLatitude, 'sun exploration does not silently author project location');
    check(planner.getProject().revision === initial.revision, 'draft and mode changes are revision-neutral');

    workspace.navigate('site/prohibited');
    workspace.navigate('environment/sun');
    const travel = direction => new Promise((resolve, reject) => {
      const timeout = root.setTimeout(() => reject(new Error('History navigation did not complete')), 2000);
      root.addEventListener('popstate', () => { root.clearTimeout(timeout); resolve(); }, { once: true });
      root.history[direction]();
    });
    await travel('back');
    check(workspace.getRoute().destination === 'site' && workspace.getRoute().section === 'prohibited', 'Back restores grouped property route');
    await travel('forward');
    check(workspace.getRoute().destination === 'environment' && workspace.getRoute().section === 'sun', 'Forward restores Sun Path route');

    workspace.navigate('design/layout');
    const drawing = by('roomPlanWorkspace'), requestFullscreen = drawing.requestFullscreen;
    drawing.requestFullscreen = () => Promise.reject(new Error('Smoke-test pseudo fullscreen'));
    try {
      await root.roomToggleFullscreen();
      check(drawing.classList.contains('room-plan-maximized'), '2D pseudo fullscreen remains available');
      check(by('plannerInspector').parentElement === document.querySelector('.component-pane'), 'shared inspector docks with fullscreen palette');
      workspace.navigate('site/plot');
      check(!drawing.classList.contains('room-plan-maximized'), 'navigation exits pseudo fullscreen');
      check(by('plannerInspector').parentElement === document.querySelector('.hp-design-layout'), 'inspector returns to original design grid');
    } finally {
      drawing.requestFullscreen = requestFullscreen;
      root.roomExitPseudoFullscreen();
    }
    check(root.HomePlannerStorage.fingerprint(planner.getProject()) === fingerprint, 'fullscreen and history preserve authored state');
    workspace.navigate('design/layout');
    await nextFrame();
    const rect = by('roomPlan').getBoundingClientRect();
    return { checks, count: checks.length, canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      route: workspace.getRoute(), revision: planner.getProject().revision };
  }
  if (typeof module === 'object' && module.exports) module.exports = runWorkspaceSmoke;
  else root.runHomePlannerWorkspaceSmoke = runWorkspaceSmoke;
})(typeof globalThis !== 'undefined' ? globalThis : this);
