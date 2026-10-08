import assert from 'node:assert/strict'
import test from 'node:test'
import { sharedMaterialsCommand, sharedWeatherCommand } from '../src/platform/shared-environment'
import { emptyMaterials } from '../src/platform/materials-api'

test('shared Materials preserves supplied zero, unknowns and source without assigning a room',()=>{
  const materials=emptyMaterials()
  materials.glazing.shgc=0
  materials.films.inside=0
  materials.layers=[{id:'kept',label:'Layer',source:'Explicit source',condition:'dry',
    thicknessM:0.2,conductivityW_MK:null,densityKgM3:1200,specificHeatJ_KgK:null}]
  const before=JSON.stringify(materials),command=sharedMaterialsCommand(materials)
  assert.equal(command.type,'set-environment')
  assert.match(JSON.stringify(command),/"shgc":0/)
  assert.match(JSON.stringify(command),/"conductivityW_MK":null/)
  assert.match(JSON.stringify(command),/"id":"kept"/)
  assert.equal(JSON.stringify(materials),before)
  assert.ok(!('rooms' in command))
})

test('shared weather uses full incumbent normalized records and rejects changes while loading',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window')
  const weather={id:'file',records:[{timestamp:'2026-01-01T01:00:00Z',durationSeconds:3600,windSpeedMps:0}],
    source:{label:'Synthetic fixture'}}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{EnvironmentData:{
    parseEPW:()=>weather,parseWeatherJSON:()=>weather,
  }}})
  let snapshot='before'
  const planner={exportProject:()=>snapshot}
  try {
    const command=await sharedWeatherCommand(planner,'json','synthetic text')
    assert.deepEqual(command,{type:'set-environment',patch:{schemaVersion:1,weather}})
    assert.equal(snapshot,'before')
    const pending=sharedWeatherCommand(planner,'epw','synthetic text')
    snapshot='changed'
    await assert.rejects(pending,/Design changed/)
    await assert.rejects(sharedWeatherCommand(planner,'epw',''),/Choose a weather file/)
  } finally {
    if(original)Object.defineProperty(globalThis,'window',original)
    else Reflect.deleteProperty(globalThis,'window')
  }
})
