const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Workspace = require('../planner-workspace.js');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('six implemented task destinations own their tools; no standalone sun or property destination', () => {
  assert.deepEqual(Object.keys(Workspace.destinations), ['overview', 'site', 'design', 'environment', 'compare', 'report']);
  assert.ok(Workspace.destinations.site.sections.prohibited);
  assert.ok(Workspace.destinations.environment.sections.sun);
  assert.ok(Workspace.destinations.environment.sections.light);
  assert.equal(Workspace.destinations.design.sections.structure, 'Structure');
  assert.equal(Workspace.viewFor('design/structure'), 'structure');
  assert.equal(Workspace.viewFor('design/elevations'), 'elevations');
  assert.equal(Workspace.viewFor('design/plumbing'), 'plumbing');
  assert.equal(Workspace.viewFor('design/drainage'), 'drainage');
  assert.equal(Workspace.viewFor('report/package'), 'package');
  assert.equal(Workspace.viewFor('report'), 'drawings', 'existing default stays unchanged');
  for (const destination of Object.values(Workspace.destinations)) assert.ok(Object.keys(destination.sections).length);
});

for (const [old, expected] of Object.entries({
  optimizer: ['site', 'plot'], rooms: ['design', 'layout'], prohibited: ['site', 'prohibited'],
  sun: ['environment', 'sun'], electrical: ['design', 'electrical'], analyze: ['environment', 'solar']
})) test(`legacy ${old} entry resolves to the implemented task section`, () => {
  assert.deepEqual(Workspace.normalizeRoute(`?workspace=${old}`), { destination: expected[0], section: expected[1] });
});

test('every supported route round-trips through URL and has a nonempty view', () => {
  for (const [destination, item] of Object.entries(Workspace.destinations)) {
    for (const section of Object.keys(item.sections)) {
      const route = { destination, section };
      assert.deepEqual(Workspace.normalizeRoute(Workspace.routeURL(route)), route);
      assert.ok(Workspace.viewFor(route));
      assert.ok(Object.isFrozen(Workspace.normalizeRoute(route)));
    }
  }
});

test('unknown and prototype-like routes fail safely to real content', () => {
  for (const value of [null, undefined, '', 'missing', '__proto__', 'constructor', '?workspace=toString'])
    assert.deepEqual(Workspace.normalizeRoute(value), { destination: 'design', section: 'layout' });
  assert.deepEqual(Workspace.normalizeRoute('?workspace=site&section=constructor'), { destination: 'site', section: 'plot' });
  assert.deepEqual(Workspace.normalizeRoute({ destination: 'environment', section: 'pdf' }), { destination: 'environment', section: 'sun' });
});

test('canonical URLs retain unrelated parameters but replace obsolete fragments and routes', () => {
  const url = new URL(Workspace.routeURL('site/prohibited', 'https://example.test/planner?foo=one&workspace=rooms#old'));
  assert.equal(url.pathname, '/planner');
  assert.equal(url.searchParams.get('foo'), 'one');
  assert.equal(url.searchParams.get('workspace'), 'site');
  assert.equal(url.searchParams.get('section'), 'prohibited');
  assert.equal(url.hash, '');
  assert.equal(new URL(Workspace.routeURL('design', 'file:///C:/HomePlanner/index.html')).protocol, 'file:');
});

test('existing environment section anchors navigate to their new owner', () => {
  for (const [anchor, expected] of Object.entries({
    'env-site-section': 'site/context', 'env-weather-section': 'site/context',
    'env-envelope-section': 'compare/envelope', 'env-export-section': 'report/exports',
    'env-wind-section': 'environment/airflow', 'env-models-section': 'environment/models'
  })) assert.deepEqual(Workspace.normalizeRoute(`#${anchor}`), Workspace.normalizeRoute(expected));
});

test('markup has one legacy mount per module, one shell nav and no old tab handler', () => {
  const html = source('index.html');
  for (const id of ['plannerPersistence', 'plannerProjectTools', 'plannerInspector', 'roomPlan', 'environmentWorkspace',
    'electricalWorkspace', 'prohibitedWorkspace', 'sunForm', 'sunUseProject', 'sunApplyProject', 'workspaceStructure',
    'workspaceElevations', 'workspaceViews', 'workspaceFacades', 'workspacePlumbing', 'workspaceDrainage', 'workspaceReportOverview', 'workspaceAirflow', 'workspaceLightStudy', 'workspaceLightGuidance', 'workspacePackage'])
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  const nav = html.match(/<nav class="tabs primary-tabs hp-project-nav"[^]*?<\/nav>/)[0];
  assert.equal((nav.match(/data-workspace=/g) || []).length, 6);
  assert.doesNotMatch(nav, /data-page|>Sun Path<|>Prohibited Properties</);
  assert.doesNotMatch(html, /querySelectorAll\('\.primary-tabs button'\)/);
  assert.ok(html.indexOf('src="planner-workspace.js"') > html.indexOf('src="planner-persistence.js"'));
  assert.ok(html.indexOf('src="planner-structure.js"') < html.indexOf('src="planner-3d.js"'));
  assert.ok(html.indexOf('src="planner-services.js"') < html.indexOf('src="planner-3d.js"'));
  assert.ok(html.indexOf('src="planner-services.js"') < html.indexOf('src="planner-drainage.js"'));
  assert.ok(html.indexOf('src="planner-drainage.js"') < html.indexOf('src="planner-3d.js"'));
  assert.ok(html.indexOf('src="planner-drainage-drawing.js"') < html.indexOf('src="planner-drawing-ui.js"'));
  assert.ok(html.indexOf('src="planner-services-ui.js"') < html.indexOf('src="planner-drainage-ui.js"'));
  assert.ok(html.indexOf('src="planner-drainage-drawing.js"') < html.indexOf('src="planner-drainage-ui.js"'));
  assert.ok(html.indexOf('src="building-physics.js"') < html.indexOf('src="planner-airflow.js"'));
  for (const script of ['planner-airflow.js', 'planner-airflow-runner.js', 'planner-airflow-display.js'])
    assert.ok(html.indexOf(`src="${script}"`) < html.indexOf('src="planner-airflow-ui.js"'));
  for (const script of ['sun-model.js', 'planner-projection.js', 'building-physics.js', 'planner-light.js', 'planner-light-runner.js', 'planner-light-display.js'])
    assert.ok(html.indexOf(`src="${script}"`) < html.indexOf('src="planner-light-ui.js"'));
  assert.ok(html.indexOf('src="planner-services-drawing.js"') < html.indexOf('src="planner-services-ui.js"'));
  assert.ok(html.indexOf('src="planner-structure-drawing.js"') < html.indexOf('src="planner-structure-ui.js"'));
  for (const script of ['planner-drawing-export.js', 'planner-elevation.js', 'planner-drainage-drawing.js', 'planner-light-ui.js'])
    assert.ok(html.indexOf(`src="${script}"`) < html.indexOf('src="planner-package.js"'));
  assert.ok(html.indexOf('src="planner-package.js"') < html.indexOf('src="planner-package-ui.js"'));
  assert.ok(html.indexOf('src="electrical-planner.js"') < html.indexOf('src="planner-projection.js"'));
});

test('routing does not invoke project editing, remount consumers, or initiate requests', () => {
  const shell = source('planner-workspace.js');
  assert.doesNotMatch(shell, /HomePlanner\.execute|HomePlanner\.select|renderRoomPlanner\(|fetch\(|getCurrentPosition\(|\.cloneNode\(/);
  assert.match(shell, /popstate/);
  assert.match(shell, /homeplanner:workspace-change/);
  assert.match(shell, /homePlannerWorkspace\) return document\.body\.homePlannerWorkspace/);
  assert.match(shell, /closest\?\.\('button\[data-workspace\], a\[data-workspace\]/,
    'The body data-workspace CSS hook must not intercept ordinary form/button clicks');
});

test('property startup is explicit, not coupled to navigation or legacy deep-link clicks', () => {
  const properties = source('prohibited-properties.js');
  assert.doesNotMatch(properties, /tab\.addEventListener|tab\.click|else if\(tab/);
  assert.match(properties, /\$\('propRetrySetup'\)\.addEventListener\('click',boot\)/);
  assert.match(properties, /opening this section makes no request/);
});

test('sun bridge only authors on explicit apply; copying defaults preserves the project', () => {
  const bridge = source('planner-bridge.js');
  const start = bridge.indexOf('  const solarIds=');
  const end = bridge.indexOf('  controller.subscribe(event=>', start);
  assert.ok(start > 0 && end > start);
  const fields = Object.fromEntries(['sunLatitude', 'sunLongitude', 'sunTimeZone', 'sunDate', 'sunTime', 'sunOccurrence',
    'sunUseProject', 'sunApplyProject', 'sunProjectStatus'].map(id => [id, {
      value: '', valueAsNumber: 0, events: {},
      addEventListener(name, handler) { this.events[name] = handler; },
      dispatchEvent(event) { this.events[event.type]?.(event); }
    }]));
  Object.assign(fields.sunLatitude, { value: '12', valueAsNumber: 12 });
  Object.assign(fields.sunLongitude, { value: '34', valueAsNumber: 34 });
  fields.sunTimeZone.value = 'UTC'; fields.sunDate.value = '2026-09-16'; fields.sunTime.value = '12:00';
  const commands = [], project = { site: { latitude: 17.385, longitude: 78.4867, timeZone: 'Asia/Kolkata' }, environment: {} };
  vm.runInNewContext(bridge.slice(start, end), {
    document: { getElementById: id => fields[id] }, Event: class { constructor(type) { this.type = type; } },
    root: { HomeSun: { calculate(config) { if (config.latitude === 99) throw new Error('Invalid latitude'); } } },
    controller: { getProject: () => project, execute: command => commands.push(command) }
  });
  assert.equal(commands.length, 0);
  assert.equal(fields.sunLatitude.events.input, undefined, 'Exploration must not register an authoring input handler');
  fields.sunUseProject.events.click();
  assert.equal(commands.length, 0);
  assert.equal(fields.sunTimeZone.value, 'Asia/Kolkata');
  fields.sunApplyProject.events.click();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'update-solar-inputs');
  fields.sunLatitude.valueAsNumber = 99;
  fields.sunApplyProject.events.click();
  assert.equal(commands.length, 1);
  assert.match(fields.sunProjectStatus.textContent, /Not applied: Invalid latitude/);
});
