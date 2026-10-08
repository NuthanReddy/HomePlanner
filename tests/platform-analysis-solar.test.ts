import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { nativeSolarSelection, type AnalysisSolarSource } from '../src/platform/analysis-solar'
import type { PlannerApi } from '../src/domain/project/planner-api'
import type { WorkspaceRecord } from '../src/platform/native-api'
import type { SolarResult } from '../src/platform/solar-api'
const require = createRequire(import.meta.url)
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs')
const Light = require('../planner-light-ui.js')
const Foundation = require('../planner-light.js')
const Sun = require('../sun-model.js')
function fixture(date='2026-11-01',clock='01:30',occurrence:'earlier'|'later'|null='later') {
  const planner:PlannerApi=controllerFor(createFixture('multiple-floors').project)
  planner.execute({type:'update-site',patch:{latitude:40.7,longitude:-74,timeZone:'America/New_York'}})
  const record={project_id:'account-one',version:7,document:{site:{latitude:40.7,longitude:-74,time_zone:'America/New_York'}}} as WorkspaceRecord
  const instant=Sun.resolveLocal(date,clock,'America/New_York',occurrence??'').instant.toISOString()
  const offset=date==='2026-11-01'&&occurrence==='later'?'-05:00':'-04:00'
  const result={project_id:'account-one',version:7,scope:'site-solar-position-not-shading',
    result:{inputs:{latitude:40.7,longitude:-74,timeZone:'America/New_York',date,localClock:clock,occurrence},
      output:{selected:{instantUTC:instant,localTime:`${date}T${clock}:00${offset}`}},
      engine:{name:'pvlib',version:'fixture',method:'fixture'}}} as SolarResult
  return {planner,source:{record,result,blocked:false} satisfies AnalysisSolarSource}
}
test('native computed Solar copies current civil selection through HomeSun without authorship, analysis or optical changes',()=>{
  const {planner,source}=fixture()
  const ui=Light.createController(planner,{HomePlannerLight:Foundation,HomeSun:Sun})
  ui.setDraft({windowOptics:{mode:'ideal-clear'}})
  ui.setSelection({endDate:'2026-11-03',endTime:'16:00',strideMinutes:15})
  const before=planner.exportProject()
  assert.equal(ui.useNativeSolarSelection(()=>nativeSolarSelection(planner,source)),true,ui.getState().error)
  const state=ui.getState()
  assert.equal(state.selection.date,'2026-11-01')
  assert.equal(state.selection.startTime,'01:30')
  assert.equal(state.selection.startOccurrence,'later')
  assert.equal(state.selection.endTime,'')
  assert.equal(state.selection.strideMinutes,15)
  assert.equal(state.draft.period,null)
  assert.deepEqual(state.draft.samples,[])
  assert.equal(state.draft.windowOptics.mode,'ideal-clear')
  assert.match(state.siteSource,/pvlib.*Only Site.*HomeSun/)
  assert.equal(state.result,null)
  assert.equal(planner.exportProject(),before)
  ui.setSelection({endTime:'02:30'})
  const intervals=ui.prepareSunIntervals()
  assert.ok(intervals,ui.getState().error)
  assert.equal(intervals.period.startUTC,'2026-11-01T06:30:00.000Z')
  assert.equal(intervals.period.endUTC,'2026-11-01T07:30:00.000Z')
  ui.dispose()
})
test('null, blocked, stale version/account, changed Site and inconsistent result are rejected before drafts change',()=>{
  const {planner,source}=fixture()
  const ui=Light.createController(planner,{HomePlannerLight:Foundation,HomeSun:Sun})
  ui.setSelection({date:'2026-05-01',endTime:'18:00'})
  const before=JSON.stringify(ui.getState().draft),selection=JSON.stringify(ui.getState().selection)
  const cases:(AnalysisSolarSource|null)[]=[null,{...source,blocked:true},{...source,result:null},
    {...source,result:{...source.result!,version:6}},
    {...source,result:{...source.result!,project_id:'other'}},
    {...source,record:{...source.record,document:{...source.record.document,site:{...source.record.document.site,latitude:0}}}},
    {...source,result:{...source.result!,result:{...source.result!.result,inputs:{...source.result!.result.inputs,longitude:0}}}}]
  for(const value of cases){
    assert.equal(ui.useNativeSolarSelection(()=>nativeSolarSelection(planner,value)),null)
    assert.equal(JSON.stringify(ui.getState().draft),before)
    assert.equal(JSON.stringify(ui.getState().selection),selection)
  }
  ui.dispose()
})
test('wrong repeated-time UTC, DST gap, and missing occurrence cannot enter a Light draft',()=>{
  const {planner,source}=fixture(),selection=nativeSolarSelection(planner,source)
  const ui=Light.createController(planner,{HomePlannerLight:Foundation,HomeSun:Sun})
  for(const value of [
    {...selection,instantUTC:'2026-11-01T05:30:00Z'},
    {...selection,startOccurrence:''},
    {...selection,date:'2026-03-08',startTime:'02:30'},
  ]){
    assert.equal(ui.useNativeSolarSelection(()=>value),null)
    assert.equal(ui.getState().draft.site,undefined)
    assert.equal(ui.getState().draft.period,null)
  }
  ui.dispose()
})
