import test from 'node:test'
import assert from 'node:assert/strict'
import { designSiteSource } from '../src/platform/design-site-adapter'
import type { Evaluation, WorkspaceRecord } from '../src/platform/native-api'

function fixture(front: 'N' | 'E' | 'S' | 'W' = 'N') {
  const record = {
    project_id: 'account-1', version: 5,
    document: { site: { width: 20, depth: 30, units: 'm', facing: front,
      floor_height_m: 3, height_m: 10, floors: 3, stilt: true, custom_setbacks: true,
      latitude: null, longitude: null, time_zone: null, obstacles: [] } },
  } as unknown as WorkspaceRecord
  const evaluation = {
    project_id: 'account-1', version: 5,
    feasibility: { status: 'computed', gross: { x: 0, y: 0, width: 20, depth: 30 },
      net: { x: 1, y: 2, width: 19, depth: 28 },
      envelope: { x: 3, y: 5, width: 15, depth: 23 }, front, usable_m2: 340,
      setbacks_m: { N: 3, E: 2, S: 2, W: 2 }, required_setbacks_m: { N: 4, E: 3, S: 3, W: 3 },
      non_compliant: true, floors: 3, max_floors: 4, high_rise: false },
    utilization: { status: 'computed', split: null },
  } as unknown as Evaluation
  return { record, evaluation }
}
test('native Site adapter preserves required versus applied geometry and scenario ownership', () => {
  const { record, evaluation } = fixture()
  const before = JSON.stringify({ record, evaluation })
  const source = designSiteSource(record, evaluation)
  assert.equal(source.accountProjectId, record.project_id)
  assert.equal(source.workspaceVersion, record.version)
  assert.deepEqual(source.result.F, { bw: 15, bd: 23 })
  assert.equal(source.result.usable, 340)
  assert.equal(source.result.customSetbacks, true)
  assert.equal(source.result.nonCompliant, true)
  assert.equal(source.site.latitude, null)
  assert.deepEqual(source.result.requiredE, { N: 4, E: 3, S: 3, W: 3 })
  assert.equal(JSON.stringify({ record, evaluation }), before)
})
test('known gross-NW origin includes net road-widening offsets in every cardinal frame', () => {
  for (const [front, x, y] of [['N', -1, -2], ['E', -2, 20], ['S', 20, 30], ['W', 30, -1]] as const) {
    const { record, evaluation } = fixture(front)
    const source = designSiteSource(record, evaluation)
    assert.deepEqual(source.registration, { grossNorthWestX: x, grossNorthWestY: y, baseOffsetM: 0, acknowledged: true })
    assert.equal(source.result.W, front === 'N' || front === 'S' ? 19 : 28)
    assert.equal(source.result.D, front === 'N' || front === 'S' ? 28 : 19)
  }
})
test('stale, foreign, missing and non-computed Site geometry cannot initialize Design', () => {
  const { record, evaluation } = fixture()
  assert.throws(() => designSiteSource(record, { ...evaluation, version: 4 }), /current Site/)
  assert.throws(() => designSiteSource(record, { ...evaluation, project_id: 'other' }), /current Site/)
  assert.throws(() => designSiteSource(record, { ...evaluation, feasibility: { ...evaluation.feasibility, status: 'infeasible' } }), /current Site/)
  assert.throws(() => designSiteSource(record, { ...evaluation, feasibility: { ...evaluation.feasibility, envelope: null } }), /rectangular geometry/)
})
test('split adapter retains local setback axes, road-widening and both origin registrations', () => {
  const { record, evaluation } = fixture('E')
  record.document.site.split_edge = 'E'
  const part = (frontage: number) => ({
    frontage_m: frontage, depth_m: 18, widening_m: 2,
    envelope: { x: 2, y: 5, width: frontage - 4, depth: 13 },
    usable_m2: (frontage - 4) * 13, floors: 2, max_floors: 3, height_m: 10,
    non_compliant: false,
    applied_setbacks_m: { front: 3, right: 2, rear: 2, left: 2 },
    required_setbacks_m: { front: 3, right: 2, rear: 2, left: 2 },
  })
  evaluation.utilization.split = { edge: 'E', selected: { a: part(12), b: part(18) } }
  const source = designSiteSource(record, evaluation)
  assert.deepEqual(source.plateRegistrations?.A,
    { grossNorthWestX: 0, grossNorthWestY: 18, baseOffsetM: 0, acknowledged: true })
  assert.deepEqual(source.plateRegistrations?.B,
    { grossNorthWestX: -12, grossNorthWestY: 18, baseOffsetM: 0, acknowledged: true })
  assert.equal(source.result.splitOn, true)
  assert.deepEqual((source.result.split as { A: { requiredSetbacks: unknown } }).A.requiredSetbacks,
    { N: 3, E: 2, S: 2, W: 2 })
  evaluation.utilization.split = { edge: 'E', selected: { a: part(10), b: part(20) } }
  assert.notEqual(source.fingerprint, designSiteSource(record, evaluation).fingerprint)
})
