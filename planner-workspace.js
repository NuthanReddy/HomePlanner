(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerWorkspace = api;
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const destinations = Object.freeze({
    overview: Object.freeze({ label: 'Overview', sections: Object.freeze({ summary: 'Project readiness' }) }),
    site: Object.freeze({ label: 'Site · Plot Planner', sections: Object.freeze({
      plot: 'Plot & feasibility', context: 'Location, surroundings & weather', prohibited: 'Prohibited Properties', references: 'Regulatory sources'
    }) }),
    design: Object.freeze({ label: 'Design', sections: Object.freeze({ layout: 'Layout · 2D / 3D', structure: 'Structure', elevations: 'Elevations & sections', plumbing: 'Plumbing', drainage: 'Drainage', electrical: 'Electrical', review: 'Issues & guidance' }) }),
    environment: Object.freeze({ label: 'Environment', sections: Object.freeze({
      sun: 'Sun Path & shading', solar: 'Solar exposure', airflow: 'Airflow & windows', cfd: 'Thermal / CFD', light: 'Light · sunlight & sky access', models: 'Reduced models'
    }) }),
    compare: Object.freeze({ label: 'Compare', sections: Object.freeze({ plot: 'Plot comparisons', envelope: 'Envelope comparisons' }) }),
    report: Object.freeze({ label: 'Report', sections: Object.freeze({ drawings: 'Drawings', package: 'Document package', schedules: 'Room schedule', electrical: 'Point schedule', exports: 'JSON & analysis exports' }) })
  });
  const aliases = Object.freeze({
    optimizer: ['site', 'plot'], rooms: ['design', 'layout'], sun: ['environment', 'sun'],
    electrical: ['design', 'electrical'], prohibited: ['site', 'prohibited'], analyze: ['environment', 'solar']
  });
  const anchors = Object.freeze({
    'env-site-section': ['site', 'context'], 'env-weather-section': ['site', 'context'],
    'env-solar-section': ['environment', 'solar'], 'env-envelope-section': ['compare', 'envelope'],
    'env-wind-section': ['environment', 'airflow'], 'env-models-section': ['environment', 'models'],
    'env-export-section': ['report', 'exports']
  });
  const ROUTE_KEY = 'homeplanner.workspace.route.v1', MODE_KEY = 'homeplanner.workspace.mode.v1';
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function normalizeRoute(input) {
    let destination, section;
    if (typeof input === 'string') {
      if (input.includes('?') || input.startsWith('#') || input.includes('://')) {
        const url = new URL(input, 'https://homeplanner.invalid/');
        destination = url.searchParams.get('workspace');
        section = url.searchParams.get('section');
        const anchor = url.hash.slice(1);
        if (owns(anchors, anchor)) [destination, section] = anchors[anchor];
      } else [destination, section] = input.split('/');
    } else if (input && typeof input === 'object') {
      destination = input.destination || input.workspace;
      section = input.section;
    }
    if (owns(aliases, destination)) {
      const alias = aliases[destination];
      destination = alias[0];
      section = section || alias[1];
    }
    if (!owns(destinations, destination)) destination = 'design';
    if (!owns(destinations[destination].sections, section))
      section = Object.keys(destinations[destination].sections)[0];
    return Object.freeze({ destination, section });
  }

  function routeURL(input, currentURL = 'https://homeplanner.invalid/') {
    const route = normalizeRoute(input), url = new URL(currentURL, 'https://homeplanner.invalid/');
    url.searchParams.set('workspace', route.destination);
    url.searchParams.set('section', route.section);
    url.hash = '';
    return url.href;
  }

  function viewFor(input) {
    const { destination, section } = normalizeRoute(input);
    if (destination === 'site') return section === 'context' ? 'site-context' :
      section === 'prohibited' ? 'prohibited' : 'optimizer';
    if (destination === 'design') return section === 'layout' ? 'rooms' : section;
    if (destination === 'environment') return section === 'sun' ? 'sun' : `env-${section}`;
    if (destination === 'compare') return section === 'plot' ? 'optimizer' : 'env-envelope';
    if (destination === 'report') return section === 'package' ? 'package' : section === 'drawings' ? 'drawings' : section === 'exports' ? 'env-exports' :
      section === 'electrical' ? 'electrical-schedule' : 'schedules';
    return 'overview';
  }

  function mount(document = root.document) {
    if (!document?.body.classList.contains('hp-workspace')) return null;
    if (document.body.homePlannerWorkspace) return document.body.homePlannerWorkspace;
    const by = id => document.getElementById(id);
    const query = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const move = (node, target) => { if (node && target) target.appendChild(node); };
    const show = (node, visible) => { if (node) node.hidden = !visible; };
    const create = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const details = (label, className) => {
      const node = create('details', className);
      node.append(create('summary', '', label));
      return node;
    };
    const preference = (key, value) => {
      try {
        if (value === undefined) return root.localStorage.getItem(key);
        root.localStorage.setItem(key, value);
      } catch (_) { /* File/private origins may disallow presentation preferences. */ }
      return null;
    };

    // Move live nodes once. Module roots and delegated event ancestors remain intact.
    move(by('plannerPersistence'), by('workspaceProjectControls'));
    by('workspaceProjectIdentity').setAttribute('aria-label', 'Current project');
    move(by('workspaceModeHint'), by('workspaceProjectMenu'));
    move(query('[data-workspace-action="save"]'), by('workspaceSaveActions'));
    move(query('.hp-storage-status'), by('workspaceSaveStatus'));
    const exportButton = query('[data-workspace-action="export-project"]');
    if (exportButton) by('workspaceExportProject').replaceWith(exportButton);
    move(by('plannerProjectTools'), by('workspaceTools'));
    const tools = by('plannerProjectTools'), toolsBody = tools?.querySelector('.hp-editor-body');
    if (toolsBody) {
      const compact = create('div', 'hp-workspace-tool-row hp-editor-actions');
      const floor = by('hp-editor-floor-select');
      move(toolsBody.querySelector(`label[for="${floor.id}"]`), compact);
      move(floor, compact);
      move(toolsBody.querySelector('.hp-editor-history'), compact);
      const more = details('Floor management & properties');
      [...toolsBody.children].forEach(node => move(node, more));
      toolsBody.append(compact, more);
      show(tools.querySelector('.hp-editor-heading'), false);
    }
    show(query('#plannerInspector .hp-editor-history'), false);
    show(query('[data-elec-floor]')?.closest('label'), false);
    show(query('[data-elec-action="undo"]'), false);
    show(query('[data-elec-action="redo"]'), false);

    const layout = query('.room-wrap'), palette = query('.component-pane');
    const canvas = query('.room-output-pane'), inspector = by('plannerInspector');
    layout?.classList.add('hp-design-layout');
    palette?.classList.add('hp-design-palette');
    canvas?.classList.add('hp-design-canvas');
    inspector?.classList.add('hp-design-inspector');
    move(inspector, layout);
    inspector?.prepend(create('summary', '', 'Selection properties'));
    // Canvas comes first in reading order; desktop CSS places the two live panes beside it.
    layout?.prepend(canvas);
    const settings = details('Floor plate & planning preferences', 'hp-workspace-settings');
    move(query('.room-settings-pane'), settings);
    palette?.append(settings);
    const planCard = by('roomPlanWorkspace')?.closest('.card');
    if (planCard) {
      canvas.prepend(planCard);
      const metrics = details('Area summary & legend');
      move(by('roomStats'), metrics);
      move(by('roomLegend'), metrics);
      planCard.append(metrics);
    }
    move(by('roomTable')?.closest('.card'), by('workspaceSchedules'));
    ['scienceChecklist', 'roomGuidance'].forEach(id =>
      move(by(id)?.closest('.card'), by('workspaceReview')));
    move(by('greenChecklist')?.closest('.card'), by('workspaceLightGuidance'));
    move(by('plannerBridgeStatus'), canvas);
    move(by('roomAlerts'), canvas);
    by('plannerBridgeStatus')?.classList.add('hp-workspace-status');
    by('roomAlerts')?.classList.add('hp-workspace-status');
    const issueLink = create('a', '', 'Review placement issues & guidance');
    issueLink.href = '?workspace=design&section=review';
    issueLink.dataset.workspace = 'design'; issueLink.dataset.section = 'review';
    canvas?.append(issueLink);
    show(query('#page-optimizer .sub-tabs'), false);
    show(query('#environmentWorkspace .env-nav'), false);

    const env = by('environmentWorkspace');
    const envHeading = env?.querySelector('.env-heading h2');
    const context = env?.querySelector('.env-context');
    const envLayout = env?.querySelector('.env-layout');
    const envAnalysis = env?.querySelector('.env-analysis');
    const siteLink = create('p', 'env-help');
    const link = create('a', '', 'Site owns location, cardinal road bearing, surroundings and weather. Review these inputs in Site.');
    link.href = '?workspace=site&section=context';
    link.dataset.workspace = 'site'; link.dataset.section = 'context';
    siteLink.append(link);
    env?.insertBefore(siteLink, envLayout);
    const bearingLink = create('p', 'env-help');
    const bearing = create('a', '', 'Set road-facing cardinal bearing and plot dimensions in Plot & feasibility');
    bearing.href = '?workspace=site&section=plot'; bearing.dataset.workspace = 'site'; bearing.dataset.section = 'plot';
    bearingLink.append(bearing, document.createTextNode('. Arbitrary surveyed bearings are not supported by this editor.'));
    context?.prepend(bearingLink);
    const exportLinks = create('p', '', '');
    const csv = create('a', '', 'Sun Path CSV exports and whole-house exposure');
    csv.href = '?workspace=environment&section=sun'; csv.dataset.workspace = 'environment'; csv.dataset.section = 'sun';
    exportLinks.append(csv);
    by('workspaceReport').append(exportLinks);
    const electrical = by('electricalWorkspace');
    const electricalSchedule = electrical?.querySelector('[data-elec-schedule]')?.closest('section');
    const electricalHidden = new Map();
    let route = null, inspectorDocked = false, drawerState = null;
    const memories = new Map();
    const wide = root.matchMedia('(min-width: 80rem)');
    function adaptDrawers() {
      if (inspectorDocked) return;
      palette.open = wide.matches; inspector.open = wide.matches;
    }
    adaptDrawers();
    wide.addEventListener('change', adaptDrawers);
    for (const [drawer, other] of [[palette, inspector], [inspector, palette]]) {
      drawer.addEventListener('toggle', () => {
        if (!wide.matches && !inspectorDocked && drawer.open) other.open = false;
      });
    }
    const drawers = create('div', 'hp-editor-actions hp-workspace-drawer-controls');
    for (const [drawer, label] of [[palette, 'Tools & rooms'], [inspector, 'Selection properties']]) {
      const button = create('button', '', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        navigate('design/layout');
        drawer.open = true;
        if (!wide.matches) (drawer === palette ? inspector : palette).open = false;
        drawer.querySelector('summary').focus({ preventScroll: true });
        drawer.scrollIntoView({ block: 'nearest' });
      });
      drawers.append(button);
    }
    toolsBody?.querySelector('.hp-workspace-tool-row')?.append(drawers);

    function dockInspector(active) {
      if (active && !inspectorDocked) {
        drawerState = { palette: palette.open, inspector: inspector.open };
        inspectorDocked = true;
        palette.append(inspector); palette.open = true; inspector.open = true;
      } else if (!active && inspectorDocked) {
        move(inspector, layout);
        palette.open = drawerState.palette; inspector.open = drawerState.inspector;
        inspectorDocked = false;
      }
    }
    function setMode(value) {
      const mode = value === 'expert' ? 'expert' : 'homeowner';
      by('workspaceMode').value = mode;
      document.body.dataset.hpMode = mode;
      by('workspaceModeHint').textContent = mode === 'expert'
        ? 'Expert view: direct controls over the same project. This is not a professional credential.'
        : 'Homeowner view: start with your plot or add rooms directly. Optional settings expand without changing your design.';
      settings.open = mode === 'expert';
      preference(MODE_KEY, mode);
      return mode;
    }
    function renderReadiness() {
      const project = root.HomePlanner?.getProject(), scene = root.HomePlanner?.getScene();
      if (!project) { by('workspaceReadiness').textContent = 'Shared project unavailable. Check that the local planner scripts loaded.'; return; }
      by('workspaceProjectIdentity').textContent = project.name || 'Untitled project';
      by('workspaceProjectIdentity').title = project.name || 'Untitled project';
      const site = project.site || {}, provenance = project.environment?.siteProvenance;
      const confirmed = provenance?.buildingSiteConfirmed === true &&
        provenance.latitude === site.latitude && provenance.longitude === site.longitude;
      by('workspaceReadiness').textContent = `${project.floors.length} editable floor(s); ${scene?.rooms?.length || 0} rooms on the active floor. ` +
        `${scene ? 'Current scene available.' : 'No valid active-floor scene; review plot inputs.'} ` +
        `${confirmed ? 'Site coordinates verified by the user.' : 'Site verification is missing or assumed; review Site.'} ` +
        `${project.environment?.weather ? 'Weather attached; review its source and coverage.' : 'No weather attached; offline geometry and manual scenarios remain available.'}`;
    }
    function sectionNav(next) {
      const nav = by('workspaceSubnav'), sectionEntries = Object.entries(destinations[next.destination].sections);
      nav.replaceChildren(...sectionEntries.map(([section, label]) => {
        const button = create('button', '', label);
        button.type = 'button'; button.dataset.workspace = next.destination; button.dataset.section = section;
        button.classList.toggle('on', section === next.section);
        if (section === next.section) button.setAttribute('aria-current', 'page');
        return button;
      }));
      nav.setAttribute('aria-label', `${destinations[next.destination].label} sections`);
      show(nav, sectionEntries.length > 1);
    }
    function apply(next, focus) {
      const view = viewFor(next);
      all('.app-page').forEach(page => { page.classList.remove('on'); page.hidden = true; });
      const page = ['optimizer', 'rooms', 'sun', 'prohibited'].includes(view) ? view :
        view === 'electrical' || view === 'electrical-schedule' ? 'electrical' :
          (view.startsWith('env-') && view !== 'env-light' && view !== 'env-cfd') || view === 'site-context' ? 'environment' : null;
      if (page) { by(`page-${page}`).hidden = false; by(`page-${page}`).classList.add('on'); }
      show(by('workspaceOverview'), view === 'overview');
      show(by('workspaceReport'), next.destination === 'report');
      show(by('workspaceReportOverview'), view !== 'drawings' && view !== 'package');
      show(by('workspaceDrawings'), view === 'drawings');
      show(by('workspacePackage'), view === 'package');
      show(by('workspaceSchedules'), view === 'schedules');
      show(by('workspaceReview'), view === 'review');
      show(by('workspaceStructure'), view === 'structure');
      show(by('workspacePlumbing'), view === 'plumbing');
      show(by('workspaceDrainage'), view === 'drainage');
      show(by('workspaceAirflow'), view === 'env-airflow');
      show(by('workspaceCfd'), view === 'env-cfd');
      show(by('python-density-analysis'), view === 'env-airflow');
      show(by('workspaceElevations'), view === 'elevations');
      show(by('workspaceLight'), view === 'env-light');
      show(by('plotSources'), view === 'optimizer');
      if (view === 'optimizer') {
        const pane = next.destination === 'compare' ? 'insights' : next.section === 'references' ? 'refs' : 'calc';
        all('#plotResults .pane').forEach(node => {
          node.classList.toggle('on', node.id === `pane-${pane}`); node.hidden = node.id !== `pane-${pane}`;
        });
      }
      const site = view === 'site-context', solar = view === 'env-solar', envelope = view === 'env-envelope';
      show(context, site); show(envAnalysis, solar || envelope); show(envLayout, site || solar || envelope);
      envLayout?.classList.toggle('hp-workspace-single-column', true);
      show(siteLink, !site);
      if (envHeading) envHeading.textContent = site ? 'Site · location, surroundings & weather' :
        envelope ? 'Compare · envelope assemblies' : view === 'env-exports' ? 'Report · analytical exports' : 'Environment';
      ['solar', 'envelope', 'wind', 'models', 'export'].forEach(section => {
        const active = ({ solar, envelope, wind: view === 'env-airflow', models: view === 'env-models', export: view === 'env-exports' })[section];
        show(by(`env-${section}-section`), active);
      });
      if (electrical) [...electrical.children].forEach(node => {
        if (node === electricalSchedule || node.classList.contains('elec-heading') || node.classList.contains('elec-footnote')) return;
        if (view === 'electrical-schedule') {
          if (!electricalHidden.has(node)) electricalHidden.set(node, node.hidden);
          node.hidden = true;
        } else if (electricalHidden.has(node)) {
          node.hidden = electricalHidden.get(node); electricalHidden.delete(node);
        }
      });
      // Do not overwrite nested controls' own validation/hidden state.
      all('.hp-project-nav [data-workspace]').forEach(button => {
        const active = button.dataset.workspace === next.destination;
        button.classList.toggle('on', active);
        if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      });
      sectionNav(next);
      by('workspaceHeading').textContent = `${destinations[next.destination].label} · ${destinations[next.destination].sections[next.section]}`;
      document.body.dataset.workspace = next.destination;
      document.body.dataset.workspaceSection = next.section;
      if (focus) by('workspaceHeading').focus({ preventScroll: true });
      root.dispatchEvent(new root.Event('resize'));
      document.dispatchEvent(new root.CustomEvent('homeplanner:workspace-change', { detail: next }));
    }
    function navigate(input, options = {}) {
      const next = normalizeRoute(input), key = `${next.destination}/${next.section}`;
      const oldKey = route && `${route.destination}/${route.section}`;
      if (oldKey === key && !options.force) return next;
      if (route) memories.set(oldKey, { x: root.scrollX, y: root.scrollY });
      if (viewFor(next) !== 'rooms') {
        root.roomExitPseudoFullscreen?.();
        if (document.fullscreenElement === by('roomPlanWorkspace'))
          document.exitFullscreen().catch(() => {});
        if (root.HomePlanner3D?.instance) root.HomePlanner3D.instance.close({ focus: false });
      }
      route = next;
      if (options.history !== false) {
        const method = options.replace ? 'replaceState' : 'pushState';
        try { root.history[method]({ ...root.history.state, homePlannerWorkspace: next }, '', routeURL(next, root.location.href)); }
        catch (_) { /* Some file origins reject History API writes; local navigation still works. */ }
      }
      preference(ROUTE_KEY, key);
      apply(next, options.focus !== false);
      if (options.scroll !== false) {
        const position = memories.get(key) || { x: 0, y: 0 };
        root.scrollTo(position.x, position.y);
      }
      return next;
    }
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const control = event.target.closest?.('button[data-workspace], a[data-workspace], a[href^="#env-"]');
      if (!control) return;
      const anchor = control.getAttribute('href')?.slice(1);
      if (!control.dataset.workspace && !owns(anchors, anchor)) return;
      event.preventDefault();
      const target = control.dataset.workspace ? { destination: control.dataset.workspace, section: control.dataset.section } :
        { destination: anchors[anchor][0], section: anchors[anchor][1] };
      navigate(target);
      by('workspaceProjectMenu').open = false;
    });
    by('workspaceMode').addEventListener('change', event => setMode(event.target.value));
    by('workspaceProjectMenu').addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        by('workspaceProjectMenu').open = false;
        by('workspaceProjectMenu').querySelector('summary').focus();
      }
    });
    by('workspaceSubnav').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    root.addEventListener('popstate', () => navigate(root.location.href, { history: false, force: true }));
    root.addEventListener('hashchange', () => {
      if (owns(anchors, root.location.hash.slice(1)))
        navigate(root.location.href, { history: false, force: true });
    });
    root.HomePlanner?.subscribe(event => { if (event.type !== 'selection') renderReadiness(); });
    setMode(preference(MODE_KEY));
    renderReadiness();
    const controller = { navigate, setMode, dockInspector, getRoute: () => ({ ...route }) };
    document.body.homePlannerWorkspace = controller;
    const explicit = new URL(root.location.href).searchParams.has('workspace') || owns(anchors, root.location.hash.slice(1));
    navigate(explicit ? root.location.href : preference(ROUTE_KEY) || 'design', { replace: true, focus: false, scroll: false });
    return controller;
  }

  return { destinations, normalizeRoute, routeURL, viewFor, mount,
    navigate: (input, options) => mount()?.navigate(input, options),
    getRoute: () => mount()?.getRoute(),
    dockInspector: active => mount()?.dockInspector(active) };
});
