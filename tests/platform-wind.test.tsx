import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WindStudy, WindPlot, emptyWindDraft, windInputs } from '../src/platform/WindStudy'
import { calculateWind, parseWind, type WindResult } from '../src/platform/wind-api'
import type { WorkspaceRecord } from '../src/platform/native-api'

function fixture():WindResult {
  return {
    project_id:'wind-project',version:4,scope:'imported-weather-not-ventilation',
    result:{
      status:'ok',kind:'weather-wind-rose',inputFingerprint:'a'.repeat(64),
      method:{name:'Retained HomePlanner method',version:'python-weather-v1',implementation:'Python standard library; not CFD',reference:'environment-data.js'},
      weather:{
        kind:'scenario',source:{label:'Synthetic test only'},latitude:null,longitude:null,timeZoneOffsetHours:0,
        timestampMeaning:'Interval end UTC',units:{windSpeedMps:'m/s',windFromDeg:'deg'},warnings:['Partial record is not annual climate.'],
        coverage:{startUTC:'2024-01-01T00:00:00.000Z',endUTC:'2024-01-01T01:00:00.000Z',recordCount:1,intervalHours:1,
          gaps:0,overlaps:0,duplicates:0,chronological:true},
      },
      rose:{
        bins:Array.from({length:16},(_,index)=>({directionDeg:index*22.5,count:index===0?1:0,meanSpeedMps:index===0?2:null})),
        calmCount:0,missingCount:0,total:1,excludedCount:0,unknownTimeCount:0,calmThresholdMps:.5,
        directionConvention:'Meteorological FROM, clockwise from true north',frequencyBasis:'Record count, not duration-weighted',timeBasis:'UTC',
        daytimeDefinition:{mode:'all',startHour:6,endHour:18,meaning:'Clock-hour filter, not astronomical daylight'},
        speedStatistics:{validSpeedCount:1,meanSpeedMps:2,maxSpeedMps:2,basis:'Valid speed records, including calm and missing direction'},
      },
      preview:[{timestamp:'2024-01-01T01:00:00.000Z',durationSeconds:3600,windSpeedMps:2,windFromDeg:0,
        temperatureC:null,rhPct:null,pressurePa:null,dniWm2:null,dhiWm2:null,ghiWm2:null,missing:['temperatureC']}],
      previewCount:1,selectedRecordCount:1,limitations:['No window proposal or ventilation claim.'],
    },
  }
}
test('strict wind adapter preserves null and rejects inconsistent/invalid evidence',()=>{
  const response=fixture()
  assert.equal(parseWind(response).result.preview[0].temperatureC,null)
  assert.throws(()=>parseWind({...response,scope:'CFD'}))
  for(const mutate of [
    (data:WindResult)=>{data.result.rose.bins[0].count=2},
    (data:WindResult)=>{data.result.rose.bins[0].meanSpeedMps=null},
    (data:WindResult)=>{data.result.preview[0].windSpeedMps=NaN},
    (data:WindResult)=>{data.result.rose.total=0},
    (data:WindResult)=>{data.result.inputFingerprint='unsafe'},
    (data:WindResult)=>{data.result.previewCount=5},
  ]) {
    const data=fixture();mutate(data);assert.throws(()=>parseWind(data))
  }
})
test('wind request carries workspace version, explicit file and CSRF; stale owner rejected',async()=>{
  const original=globalThis.fetch
  try {
    globalThis.fetch=async(path,options)=>{
      assert.equal(path,'/api/v1/projects/wind-project/workspace/wind')
      assert.equal(options?.cache,'no-store')
      assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'test-csrf')
      const body=JSON.parse(String(options?.body))
      assert.equal(body.expected_version,4)
      assert.equal(body.text,'{"records":[]}')
      assert.equal(body.filename,undefined)
      return new Response(JSON.stringify(fixture()),{status:200,headers:{'content-type':'application/json'}})
    }
    const input=windInputs({...emptyWindDraft,text:'{"records":[]}',format:'json'})
    assert.equal((await calculateWind({project_id:'wind-project',version:4},input,'test-csrf')).version,4)
    globalThis.fetch=async()=>new Response(JSON.stringify({...fixture(),project_id:'other-project'}),{status:200})
    await assert.rejects(calculateWind({project_id:'wind-project',version:4},input,'test-csrf'),/Stale Wind/)
    globalThis.fetch=async()=>new Response(JSON.stringify({...fixture(),version:5}),{status:200})
    await assert.rejects(calculateWind({project_id:'wind-project',version:4},input,'test-csrf'),/Stale Wind/)
    globalThis.fetch=async()=>new Response(JSON.stringify({detail:'No valid weather intervals'}),{status:422})
    await assert.rejects(calculateWind({project_id:'wind-project',version:4},input,'test-csrf'),/No valid weather/)
  } finally {globalThis.fetch=original}
})
test('wind draft rejects blank numeric and missing file; native UI shows explicit method, units and uncertainty',()=>{
  assert.throws(()=>windInputs(emptyWindDraft),/nonempty/)
  assert.throws(()=>windInputs({...emptyWindDraft,text:'{}',calm_threshold_mps:''}),/blank is not zero/)
  const markup=renderToStaticMarkup(<WindPlot response={fixture()}/>)
  assert.match(markup,/FROM true north/)
  assert.match(markup,/Mean speed m\/s/)
  assert.match(markup,/Unknown/)
  assert.match(markup,/not annual climate/)
  assert.match(markup,/No window proposal/)
  const record={project_id:'wind-project',version:4,document:{site:{time_zone:null}}} as WorkspaceRecord
  const ui=renderToStaticMarkup(<WindStudy record={record} csrf="synthetic" draft={emptyWindDraft} onChange={()=>{}} blocked/>)
  assert.match(ui,/disabled/)
  assert.match(ui,/Apply\/discard Site drafts/)
  assert.match(ui,/No automatic fetch/)
  assert.match(ui,/not durably saved/)
})
test('empty-filter and missing-wind remain different from valid calm zero',()=>{
  for(const status of ['empty-filter','missing-wind','ok'] as const) {
    const response=fixture(),result=response.result
    result.status=status;result.rose.bins.forEach(bin=>{bin.count=0;bin.meanSpeedMps=null})
    if(status==='empty-filter') {
      result.rose.total=0;result.rose.excludedCount=1;result.rose.speedStatistics.validSpeedCount=0
      result.rose.speedStatistics.meanSpeedMps=null;result.rose.speedStatistics.maxSpeedMps=null
      result.preview=[];result.previewCount=0;result.selectedRecordCount=0
    } else if(status==='missing-wind') {
      result.rose.missingCount=1;result.preview[0].windSpeedMps=null
      result.rose.speedStatistics.validSpeedCount=0;result.rose.speedStatistics.meanSpeedMps=null;result.rose.speedStatistics.maxSpeedMps=null
    } else {
      result.rose.calmCount=1;result.preview[0].windSpeedMps=0;result.preview[0].windFromDeg=null
      result.rose.speedStatistics.meanSpeedMps=0;result.rose.speedStatistics.maxSpeedMps=0
    }
    parseWind(response)
    const output=renderToStaticMarkup(<WindPlot response={response}/>)
    assert.match(output,status==='empty-filter'?/No records match/:status==='missing-wind'?/Missing data are not zero/:/0.00 m\/s/)
  }
})
