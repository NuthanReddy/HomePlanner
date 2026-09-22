'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../planner-requirements-ui.js');

const root = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'inputs.schema.json'), 'utf8'));
const example = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'inputs.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''));
const copy = value => JSON.parse(JSON.stringify(value));
const plotPlanner = {
  version: 1, source: 'plot-planner',
  plot: {
    grossWidthM: 13.716, grossDepthM: 18.288, netWidthM: 13.716, netDepthM: 18.288,
    facing: 'SW', frontEdge: 'S', roadsM: { S: 9 }, category: 'B', use: 'res'
  },
  regulation: {
    selectedHeightM: 10, highRise: false, tdrEnabled: false, deviationEnabled: false,
    floorToFloorM: 3, plannedFloors: 2, maximumFloors: 3, stilt: false
  },
  plate: {
    id: 'whole', label: 'Whole plot', widthM: 12, depthM: 15, rawDepthM: 15,
    areaM2: 120.3, frontEdge: 'S', floorIndex: 1, floorElevationM: 0,
    customSetbacks: false, nonCompliant: false,
    setbacksM: { N: 1, E: 1, S: 1, W: 1 },
    requiredSetbacksM: { N: 1, E: 1, S: 1, W: 1 }
  }
};

test('requirements controller keeps drafts detached until review and confirmation', () => {
  const controller = UI.createController(schema, { initial: example, plotPlanner });
  const events = [];
  controller.subscribe(event => events.push(event.type));
  assert.equal(controller.getState().confirmed, null);
  controller.update('/projectName', 'Reviewed house');
  assert.equal(controller.getState().draft.projectName, 'Reviewed house');
  assert.equal(controller.getState().reviewed, null);
  assert.equal(controller.review(), true);
  assert.equal(controller.getState().reviewed.projectName, 'Reviewed house');
  const brief = controller.confirm();
  assert.equal(brief.request.projectName, 'Reviewed house');
  assert.equal(controller.getState().confirmed, brief);
  assert.deepEqual(events, ['draft', 'review', 'confirm']);
});

test('AI Plan defaults are parsed from configs/inputs.json and remain editable drafts', () => {
  const text = fs.readFileSync(path.join(root, 'configs', 'inputs.json'), 'utf8');
  const defaults = UI.parseDefaults(text);
  assert.deepEqual(defaults, example);
  const controller = UI.createController(schema, { initial: defaults, plotPlanner });
  controller.update('/style', 'User override', 'User override');
  assert.equal(controller.getState().draft.style, 'User override');
  assert.equal(defaults.style, 'Modern');
});

test('AI Plan loads JSONC defaults through the runtime fetch path', async () => {
  const text = fs.readFileSync(path.join(root, 'configs', 'inputs.json'), 'utf8');
  const defaults = await UI.loadDefaults('configs/inputs.json', async url => ({
    ok: url === 'configs/inputs.json',
    status: 200,
    text: async () => text
  }));
  assert.deepEqual(defaults, example);
});

test('changing a reviewed field invalidates confirmation and retains review errors', () => {
  const controller = UI.createController(schema, { initial: example, plotPlanner });
  assert.equal(controller.review(), true);
  assert.ok(controller.confirm());
  controller.update('/style', '');
  assert.equal(controller.getState().confirmed, null);
  assert.equal(controller.review(), false);
  assert.equal(controller.getState().issues.some(issue => issue.path === '/style'), true);
  assert.equal(controller.confirm(), null);
});

test('oneOf selection and repeatable requirements are controlled schema drafts', () => {
  const controller = UI.createController(schema, { initial: example, plotPlanner });
  const requirements = schema.properties.requirements;
  const before = controller.value('/requirements').length;
  controller.add('/requirements', requirements);
  assert.equal(controller.value('/requirements').length, before + 1);
  controller.remove('/requirements', before);
  assert.equal(controller.value('/requirements').length, before);
});

test('discard restores the last reviewed snapshot rather than mutating confirmed input', () => {
  const controller = UI.createController(schema, { initial: example, plotPlanner });
  assert.equal(controller.review(), true);
  const reviewed = copy(controller.getState().reviewed);
  controller.update('/style', 'Draft style');
  controller.discard();
  assert.deepEqual(controller.getState().draft, reviewed);
  assert.equal(controller.getState().confirmed, null);
});

test('a changed Plot Planner snapshot invalidates the reviewed brief without editing requirements', () => {
  let current = copy(plotPlanner);
  const controller = UI.createController(schema, {
    initial: example,
    plotPlannerProvider: () => current
  });
  assert.equal(controller.review(), true);
  assert.ok(controller.confirm());
  current.plate.areaM2 = 118;
  assert.equal(controller.refreshPlotPlanner(), true);
  assert.equal(controller.getState().confirmed, null);
  assert.equal(controller.getState().reviewed, null);
  assert.equal(controller.getState().draft.projectName, example.projectName);
});

test('project-owned metadata overrides imported hidden metadata before review', () => {
  const controller = UI.createController(schema, {
    initial: { ...example, projectName: 'Imported name', requestId: 'imported-request' },
    plotPlanner,
    metadataProvider: () => ({
      version: 1,
      userId: 'local-browser',
      projectId: 'active-project',
      projectName: 'Active project',
      requestId: 'active-request',
      timestamp: 123
    })
  });
  assert.equal(controller.review(), true);
  const reviewed = controller.getState().reviewed;
  assert.equal(reviewed.projectName, 'Active project');
  assert.equal(reviewed.requestId, 'active-request');
  assert.equal(reviewed.timestamp, 123);
});

test('index loads the schema UI locally and exposes one requirements host', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal((html.match(/id="plannerRequirements"/g) || []).length, 1);
  assert.equal((html.match(/src="planner-input-schema\.js"/g) || []).length, 1);
  assert.equal((html.match(/src="planner-requirements-ui\.js"/g) || []).length, 1);
  assert.equal((html.match(/href="planner-requirements-ui\.css"/g) || []).length, 1);
  assert.ok(html.indexOf('src="planner-input-schema.js"') < html.indexOf('src="planner-requirements-ui.js"'));
  assert.match(html, /window\.HomePlannerPlotInputs=plotPlannerRequirementSnapshot/);
});
