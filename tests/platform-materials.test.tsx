import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MaterialsStudy, materialsCommand, materialsDirty, materialsDraft } from '../src/platform/MaterialsStudy'
import { emptyMaterials, evaluateMaterials, parseMaterials, parseMaterialsResult } from '../src/platform/materials-api'
import type { WorkspaceRecord } from '../src/platform/native-api'

test('Material drafts preserve explicit zero, unknowns, identities and sources',()=>{
  const saved=emptyMaterials()
  const draft=materialsDraft(saved)
  assert.equal(materialsDirty(draft,saved),false)
  draft.films.inside='0'
  draft.glazing.shgc='0'
  draft.glazing.vlt=''
  const authored=materialsCommand(draft)
  assert.equal(authored.films.inside,0)
  assert.equal(authored.glazing.shgc,0)
  assert.equal(authored.glazing.vlt,null)
  assert.equal(materialsDirty(draft,saved),true)
  assert.deepEqual(materialsDraft(authored),draft)
  draft.films.outside='not a number'
  assert.throws(()=>materialsCommand(draft),/finite SI/)
  assert.equal(materialsDirty(draft,saved),true)
  assert.deepEqual(parseMaterials(undefined),saved)
  assert.throws(()=>parseMaterials({...saved,glazing:{...saved.glazing,vlt:1.2}}))
  assert.throws(()=>parseMaterials({...saved,films:{...saved.films,inside:true}}))
})

function response() {
  return {project_id:'fixture',version:2,scope:'assembly-descriptors-not-zone-simulation',presets:[],
    result:{method:'explicit-film port',input_fingerprint:'fixture-key',inputs:emptyMaterials(),
      units:{resistanceM2K_W:'m²·K/W',uValueW_M2K:'W/(m²·K)',arealHeatCapacityJ_M2K:'J/(m²·K)'},
      selected:{status:'prerequisites',messages:['Supply explicit films'],output:null},comparisons:[],
      glazing:{status:'prerequisites',messages:['Supply product values'],inputs:emptyMaterials().glazing},warnings:[]}}
}

test('Assembly parser rejects nonfinite or success-shaped unknown outputs',()=>{
  assert.equal(parseMaterialsResult(response()).result.selected.output,null)
  assert.throws(()=>parseMaterialsResult({...response(),scope:'thermal-simulation'}))
  const value=response()
  assert.throws(()=>parseMaterialsResult({...value,result:{...value.result,selected:{status:'computed',messages:[],output:null}}}))
  assert.throws(()=>parseMaterialsResult({...value,result:{...value.result,selected:{status:'computed',messages:[],output:{
    resistanceM2K_W:1,uValueW_M2K:Infinity,arealHeatCapacityJ_M2K:100}}}}))
})

test('Study evaluation sends only applied version and CSRF, no draft values',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async(input,init)=>{
      assert.equal(input,'/api/v1/projects/fixture/workspace/materials')
      assert.equal(init?.method,'POST')
      assert.equal((init?.headers as Record<string,string>)['X-CSRF-Token'],'fixture-csrf')
      assert.deepEqual(JSON.parse(String(init?.body)),{expected_version:2})
      return new Response(JSON.stringify(response()),{status:200})
    }
    assert.equal((await evaluateMaterials({project_id:'fixture',version:2},'fixture-csrf')).version,2)
  } finally {globalThis.fetch=original}
})

test('Native material form renders unknown inputs and honest scope without fetching',()=>{
  const record={project_id:'fixture',version:2,document:{materials:emptyMaterials()}} as unknown as WorkspaceRecord
  const markup=renderToStaticMarkup(createElement(MaterialsStudy,{record,csrf:'fixture',draft:materialsDraft(),
    onChange:()=>{},onCommit:async()=>null,blocked:false}))
  assert.match(markup,/No assembly layers specified/)
  assert.match(markup,/blank means unknown/)
  assert.match(markup,/No material-to-room assignment/)
  assert.match(markup,/Apply material inputs/)
  assert.doesNotMatch(markup,/value="0.13"/)
})
