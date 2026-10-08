import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { nativeApi, parseWorkspace, rect, type WorkspaceRecord } from '../src/platform/native-api.ts'
import { footprint, resizeFootprint } from '../src/platform/SurroundingsCanvas.tsx'
import { convertLengthDraft } from '../src/platform/PlotInputs.tsx'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CostResults } from '../src/platform/CostResults.tsx'
import { Utilization, curveSegments } from '../src/platform/Utilization.tsx'
import { parseSolar, calculateSolar, type SolarResult } from '../src/platform/solar-api.ts'
import { SolarPlot, solarInputs, emptySolarDraft } from '../src/platform/SolarStudy.tsx'
import { CostInputs, costDraft, costCommand, normalizeCostDraft } from '../src/platform/CostInputs.tsx'
import { emptyMaterials } from '../src/platform/materials-api'

const originalFetch=globalThis.fetch
afterEach(()=>{globalThis.fetch=originalFetch})
function fixture():WorkspaceRecord {
  return {
    project_id:'native-project',version:3,can_undo:true,can_redo:false,
    document:{schema_version:1,materials:emptyMaterials(),site:{
      width:null,depth:null,units:'m',facing:'N',roads:{N:null,E:null,S:null,W:null},
      road_units:{N:'m',E:'m',S:'m',W:'m'},tdr:false,compounding:false,custom_setbacks:false,
      setback_front_m:null,setback_rear_m:null,setback_left_m:null,setback_right_m:null,split_edge:null,split_fraction:null,
      category:'B',use:'res',height_m:null,floor_height_m:null,floors:null,stilt:false,
      latitude:null,longitude:null,time_zone:null,location_source:'unknown',location_accuracy_m:null,
      weather_source:'location',obstacles:[],
    },costs:{land_inr_m2:null,construction_inr_m2:null,stilt_inr_m2:null,
      land_sro_inr_m2:null,registration_percent:null,gst_percent:null,estimate_scope:'partial',flat_sro_inr_m2:null,
      lrs_mode:null,lrs_rebate:null,brs_mode:null,brs_violated_m2:null,stilt_rate_mode:'explicit'}},
  }
}
test('native commands preserve scope, CSRF and expected workspace revision',async()=>{
  const saved=fixture()
  globalThis.fetch=async(input,init)=>{
    assert.equal(input,'/api/v1/projects/native-project/workspace/commands')
    assert.equal(init?.credentials,'same-origin')
    assert.deepEqual(init?.headers,{'Content-Type':'application/json','X-CSRF-Token':'csrf'})
    assert.deepEqual(JSON.parse(String(init?.body)),{action:'site',expected_version:3,value:{width:12}})
    return Response.json({...saved,version:4})
  }
  assert.equal((await nativeApi.command(saved,'site',{width:12},'csrf')).version,4)
  assert.equal(saved.document.site.width,null)
})
test('road/plot display conversions preserve physical dimensions and unknown values',()=>{
  assert.equal(convertLengthDraft('30','ft','m'),'9.144')
  assert.equal(Number(convertLengthDraft('9.144','m','ft')),30)
  assert.equal(convertLengthDraft('','m','ft'),'')
  assert.throws(()=>convertLengthDraft('invalid','m','ft'),/valid length/)
})
test('native parser preserves nulls and rejects malformed documents',()=>{
  assert.deepEqual(parseWorkspace(fixture()),fixture())
  assert.throws(()=>parseWorkspace({...fixture(),version:NaN}),/Invalid/)
  const broken=fixture()
  broken.document.site.obstacles=[{id:'x',kind:'tree',name:'Canopy',x:Infinity,y:0,
    width_m:1,depth_m:1,height_m:null,base_m:null,transmission:null}]
  assert.throws(()=>parseWorkspace(broken),/Invalid/)
  assert.throws(()=>rect({x:0,y:0,width:undefined,depth:1}),/Invalid/)
})
test('two-corner footprints support every direction and across-road negative coordinates',()=>{
  assert.deepEqual(footprint({x:5,y:-20},{x:1,y:-12}),{x:1,y:-20,width:4,depth:8})
  assert.deepEqual(footprint({x:1,y:-12},{x:5,y:-20}),{x:1,y:-20,width:4,depth:8})
})
test('resizing all corners keeps the opposite corner fixed, including crossing it',()=>{
  const box={x:-20,y:-10,width:8,depth:6}
  assert.deepEqual(resizeFootprint(box,'nw',{x:-25,y:-15}),{x:-25,y:-15,width:13,depth:11})
  assert.deepEqual(resizeFootprint(box,'ne',{x:-8,y:-12}),{x:-20,y:-12,width:12,depth:8})
  assert.deepEqual(resizeFootprint(box,'sw',{x:-22,y:0}),{x:-22,y:-10,width:10,depth:10})
  assert.deepEqual(resizeFootprint(box,'se',{x:-5,y:2}),{x:-20,y:-10,width:15,depth:12})
  assert.deepEqual(resizeFootprint(box,'se',{x:-25,y:-15}),{x:-25,y:-15,width:5,depth:5})
  assert.deepEqual(box,{x:-20,y:-10,width:8,depth:6})
})
test('weather uses only saved workspace identity and explicit acknowledgement',async()=>{
  globalThis.fetch=async(input,init)=>{
    assert.equal(input,'/api/v1/projects/native-project/workspace/weather')
    assert.deepEqual(JSON.parse(String(init?.body)),{inputs:{expected_version:3,acknowledgeOpenMeteo:true}})
    return Response.json({project_id:'native-project',version:2,result:{weather:{}}})
  }
  await assert.rejects(nativeApi.weather(fixture(),'csrf'),/Stale weather/)
})

test('cost breakdown omits onward-sale data, preserves zero and exposes BRS treatment',()=>{
  const html=renderToStaticMarkup(createElement(CostResults,{value:{
    status:'computed',messages:['Permit fees excluded'],estimate_scope:'legacy-schedule',
    subtotal_inr:0,non_compliant:true,costed_built_up_m2:100,inr_per_built_ft2:0,inr_per_built_m2:0,
    onward_sale_basis:'Not included in subtotal',onward_sale_sro_inr:1000,onward_sale_duty_inr:null,
    line_items:[{label:'Betterment',amount_inr:0,state:'included-in-BRS',basis:'No double charge'}],
  }}))
  assert.match(html,/Included in BRS — not added again/)
  assert.match(html,/Non-compliant/)
  const table=html.slice(html.indexOf('<table>'),html.indexOf('</table>'))
  assert.doesNotMatch(table,/1,000/)
  assert.doesNotMatch(html,/Onward-sale|Finished-area SRO|Indicative buyer duty/)
  assert.match(html,/Unknown/)
  assert.match(html,/₹0.00/)
  const invalid=renderToStaticMarkup(createElement(CostResults,{value:{status:'computed',messages:[],subtotal_inr:100}}))
  assert.match(invalid,/Invalid cost breakdown response/)
})

test('utilization curves never connect across unknown samples or drop intentional zero',()=>{
  const samples=[1,0,null,3,null,null,4]
  assert.deepEqual(curveSegments(samples,value=>value),[[1,0],[3],[4]])
  assert.deepEqual(curveSegments([null,null],value=>value),[])
})

test('utilization shows split provenance, custom setbacks and full diagrams',()=>{
  const envelope={
    frontage_m:10,gross_depth_m:20,depth_m:18.5,widening_m:1.5,
    envelope:{x:1,y:3.5,width:8,depth:15.5},net_area_m2:185,height_m:10,
    usable_m2:124,floors:3,built_up_m2:372,lost_percent:33,built_up_per_net_m2:2,
    required_setbacks_m:{front:2,rear:1,left:1,right:1},
    applied_setbacks_m:{front:1,rear:1,left:1,right:1},non_compliant:true,
  }
  const pair={a:envelope,b:envelope,fraction:.5,net_area_m2:370,usable_m2:248,built_up_m2:744,lost_percent:33}
  const value={status:'computed' as const,messages:[],series:[{aspect:1,samples:[{...envelope,sample_area_m2:185,inr_per_built_ft2:null}]}],
    split:{edge:'E',whole:envelope,selected:pair,best_sampled:pair,sample_count:281}}
  const html=renderToStaticMarkup(createElement(Utilization,{value}))
  assert.match(html,/not geographic north/)
  assert.match(html,/Best of 281 tested splits/)
  assert.match(html,/Non-compliant/)
  assert.match(html,/Required setbacks/)
  assert.match(html,/Unknown/)
  assert.equal((html.match(/<figure>/g)||[]).length,3)
  assert.match(html,/<polyline/)
})

function solarFixture():SolarResult {
  const path=Array.from({length:25},(_,hour)=>{
    const instant=new Date(Date.UTC(2026,5,21,hour)).toISOString()
    return {instantUTC:instant,localTime:instant,azimuthDeg:180,
      geometricElevationDeg:hour===12?80:-30,apparentElevationDeg:hour===12?80.1:-30,aboveHorizon:hour===12}
  })
  return {project_id:'native-project',version:3,scope:'site-solar-position-not-shading',result:{
    status:'ok',kind:'solar-position',inputs:{timeZone:'UTC'},
    output:{selected:path[0],path,day:{startUTC:path[0].instantUTC,endUTC:path[24].instantUTC,
      durationHours:24,sampleMinutes:60,sampleCount:25,sampling:'UTC elapsed'}},
    engine:{name:'pvlib',version:'test-fixture',method:'synthetic-contract-only'},assumptions:['Not measured'],
  }}
}
test('native solar validates time intervals and keeps night as a real result',()=>{
  const result=solarFixture()
  assert.deepEqual(parseSolar(result),result)
  const html=renderToStaticMarkup(createElement(SolarPlot,{result}))
  assert.match(html,/night\/horizon/)
  assert.match(html,/24 elapsed hours/)
  assert.match(html,/-30.00/)
  assert.match(html,/elapsed UTC hours/)
  const bad=solarFixture();bad.result.output.path[1].instantUTC=bad.result.output.path[0].instantUTC
  assert.throws(()=>parseSolar(bad),/time intervals/)
  const badDay=solarFixture();badDay.result.output.day.durationHours=23
  assert.throws(()=>parseSolar(badDay),/time intervals/)
})
test('native solar sends no coordinate override and rejects stale workspace results',async()=>{
  const inputs=solarInputs({...emptySolarDraft,date:'2026-06-21',local_time:'12:00',temperature_c:'0'})
  assert.equal(inputs.temperature_c,0)
  assert.equal(inputs.altitude_m,null)
  assert.equal(inputs.acknowledge_reference,false)
  globalThis.fetch=async(input,init)=>{
    assert.equal(input,'/api/v1/projects/native-project/workspace/solar')
    assert.deepEqual(JSON.parse(String(init?.body)),{...inputs,expected_version:3})
    return Response.json({...solarFixture(),version:2})
  }
  await assert.rejects(calculateSolar(fixture(),inputs,'csrf'),/Stale Solar/)
})

test('legacy cost rate units preserve saved values and convert authored rates exactly once',()=>{
  const before={...fixture().document.costs,land_inr_m2:50000/.83612736,land_sro_inr_m2:3000/.83612736,
    construction_inr_m2:2200/.09290304,stilt_inr_m2:1210/.09290304,flat_sro_inr_m2:2500/.09290304,
    brs_violated_m2:100*.09290304}
  const displayed=costDraft(before)
  assert.equal(displayed.land_inr_m2,'50000')
  assert.equal(displayed.land_sro_inr_m2,'3000')
  assert.equal(displayed.construction_inr_m2,'2200')
  assert.equal(displayed.stilt_inr_m2,'1210')
  assert.equal(displayed.flat_sro_inr_m2,undefined)
  assert.equal(displayed.brs_violated_m2,'100')
  assert.deepEqual(costCommand(displayed,before),before)
  const changed=costCommand({...displayed,land_inr_m2:'60000',construction_inr_m2:'2400',brs_violated_m2:'200'},before)
  assert.equal(changed.land_inr_m2,60000/.83612736)
  assert.equal(changed.construction_inr_m2,2400/.09290304)
  assert.equal(changed.flat_sro_inr_m2,before.flat_sro_inr_m2)
  assert.ok(Math.abs(changed.brs_violated_m2!-200*.09290304)<1e-12)
  const old=Object.fromEntries(Object.entries(before).map(([key,value])=>[key,value===null?'':String(value)]))
  const retained=normalizeCostDraft({...old,construction_inr_m2:'12345'})
  assert.equal(Number(retained.construction_inr_m2),Number((12345*.09290304).toPrecision(15)))
  assert.deepEqual(normalizeCostDraft(retained),retained)
  assert.equal(costCommand({...displayed,land_inr_m2:'',construction_inr_m2:'0'},before).land_inr_m2,null)
  assert.equal(costCommand({...displayed,construction_inr_m2:'0'},before).construction_inr_m2,0)
})
test('cost controls expose legacy units, GST choices and nullable applicability',()=>{
  const html=renderToStaticMarkup(createElement(CostInputs,{value:costDraft({...fixture().document.costs,gst_percent:12}),
    disabled:false,onChange:()=>{},onSubmit:()=>{}}))
  assert.match(html,/Plot purchase rate \(INR\/sq yd\)/)
  assert.match(html,/Construction cost \(INR\/sq ft built-up\)/)
  assert.match(html,/Violated built-up area \(sq ft; all floors\)/)
  assert.match(html,/works contract/)
  assert.match(html,/12% — retained custom rate/)
  assert.match(html,/Unknown eligibility/)
  assert.doesNotMatch(html,/<label>Flat \/ built-up SRO/)
  assert.doesNotMatch(html,/INR\/m²/)
})
