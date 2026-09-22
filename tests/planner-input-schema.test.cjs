'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Inputs = require('../planner-input-schema.js');

const root = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'inputs.schema.json'), 'utf8'));
const exampleText = fs.readFileSync(path.join(root, 'configs', 'inputs.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');
const example = JSON.parse(exampleText);
const copy = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const plotPlanner = {
  version: 1,
  source: 'plot-planner',
  plot: {
    grossWidthM: 13.716, grossDepthM: 18.288,
    netWidthM: 13.716, netDepthM: 18.288,
    facing: 'SW', frontEdge: 'S', roadsM: { S: 9, W: 12 },
    category: 'B', use: 'res'
  },
  regulation: {
    selectedHeightM: 10, highRise: false, tdrEnabled: false,
    deviationEnabled: false, floorToFloorM: 3, plannedFloors: 2,
    maximumFloors: 3, stilt: false
  },
  plate: {
    id: 'whole', label: 'Whole plot', widthM: 12, depthM: 15,
    rawDepthM: 15, areaM2: 120.3094368, frontEdge: 'S',
    floorIndex: 1, floorElevationM: 0, customSetbacks: true,
    nonCompliant: false, setbacksM: { N: 1, E: 1, S: 1, W: 1 },
    requiredSetbacksM: { N: 1, E: 1, S: 1, W: 1 }
  }
};

test('pinned schema and JSONC example form one valid LayoutInputsV1 contract', () => {
  assert.equal(Inputs.assertSchema(schema).$id, Inputs.SCHEMA_ID);
  const result = Inputs.validateInputs(example, schema);
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(example, 'plot'), false);
  assert.equal(Object.hasOwn(example, 'buildup'), false);
  assert.equal(example.programme.lift, 1);
  assert.equal(example.programme.staircase, 1);
  assert.deepEqual(example.requirements.find(item => item.type === 'kitchen').details,
    { size: 'standard', layoutType: 'open' });
});

test('normalization reuses the Plot Planner snapshot and retains canonical provenance', () => {
  const brief = Inputs.normalize(example, schema, { reviewedAt: 42, plotPlanner });
  assert.equal(brief.source.schemaId, Inputs.SCHEMA_ID);
  assert.equal(brief.source.schemaVersion, 1);
  assert.equal(brief.source.reviewedAt, 42);
  close(brief.plot.widthM, 13.716);
  close(brief.plot.depthM, 18.288);
  close(brief.plot.setbacks.valuesM.N, 1);
  close(brief.buildup.targetM2, 120.3094368);
  assert.equal(brief.buildup.toleranceM2, null);
  assert.equal(brief.buildup.sourcePlateId, 'whole');
  const master = brief.requirements.find(item => item.id === 'bedroom-1');
  close(master.constraints.area.minM2, 14.95738944);
  close(master.constraints.area.maxM2, 19.9741536);
  close(master.constraints.dimensions.minWidthM, 2.1336);
  assert.equal(JSON.parse(brief.source.inputFingerprint).inputs.projectName, example.projectName);
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(Object.isFrozen(brief.plot), true);
});

test('schema rejects repeated Plot Planner fields and other unsupported values', () => {
  const extra = copy(example);
  extra.plot = { widthFt: 45 };
  assert.equal(Inputs.validateInputs(extra, schema).issues.some(issue => issue.path === '/plot'), true);

  const repeated = copy(example);
  repeated.buildup = { type: 'custom', areaFt2: 1295 };
  assert.equal(Inputs.validateInputs(repeated, schema).issues.some(issue => issue.path === '/buildup'), true);

  assert.throws(() => Inputs.normalize(example, schema, { reviewedAt: 42 }), {
    code: 'InvalidPlotPlannerSnapshotError'
  });
});

test('domain validation rejects inconsistent ranges, duplicate IDs and misplaced details', () => {
  const invalid = copy(example);
  invalid.requirements[0].id = invalid.requirements[1].id;
  invalid.requirements[1].constraints.area = { minAreaFt2: 220, maxAreaFt2: 100 };
  invalid.requirements[1].constraints.dimensions = {
    minWidthFt: 12, minDepthFt: 16, maxWidthFt: 10, maxDepthFt: 15
  };
  invalid.requirements[1].details = { size: 'standard' };
  const result = Inputs.validateInputs(invalid, schema);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some(issue => /unique/.test(issue.message)), true);
  assert.equal(result.issues.some(issue => /Minimum area/.test(issue.message)), true);
  assert.equal(result.issues.some(issue => /Minimum width/.test(issue.message)), true);
  assert.equal(result.issues.some(issue => /only for kitchen/.test(issue.message)), true);
  assert.throws(() => Inputs.normalize(invalid, schema, { plotPlanner }), { code: 'InvalidLayoutInputsError' });
});

test('default generation follows required fields and selected oneOf branches without inventing optional values', () => {
  const value = Inputs.defaultValue(schema, schema);
  assert.equal(value.version, 1);
  assert.equal(Object.hasOwn(value, 'plot'), false);
  assert.equal(Object.hasOwn(value, 'buildup'), false);
  assert.equal(value.requirements.length, 1);
  assert.deepEqual(value.programme, {});
  assert.equal(Object.hasOwn(value, 'unsupported'), false);
});
