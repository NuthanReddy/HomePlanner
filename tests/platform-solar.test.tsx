import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SolarPlot, SolarStudy, emptySolarDraft, normalizeSolarDraft, currentSolarClock, solarInputs, solarSegments, solarCSV } from '../src/platform/SolarStudy'
import { calculateSolar, parseSolar, type SolarResult, type SolarPosition } from '../src/platform/solar-api'
import type { WorkspaceRecord } from '../src/platform/native-api'

let cached:SolarResult
test('current Solar defaults use the site civil date and clock, including fractional offsets and DST',()=>{
  const now=new Date('2026-10-08T20:45:00Z')
  assert.deepEqual(currentSolarClock('Asia/Kolkata',now),{date:'2026-10-09',local_time:'02:15'})
  assert.deepEqual(currentSolarClock('Asia/Kathmandu',now),{date:'2026-10-09',local_time:'02:30'})
  assert.deepEqual(currentSolarClock('America/New_York',new Date('2026-03-08T07:30:00Z')),{date:'2026-03-08',local_time:'03:30'})
})
function fixture() {
  if(!cached){
    const program=[
      'import json',
      'from backend.solar import calculate_site_solar,SolarInput',
      'from backend.workspace import Site',
      "r=calculate_site_solar(Site(latitude=40.7128,longitude=-74.006,time_zone='America/New_York'),SolarInput(expected_version=3,date='2026-03-08',local_time='03:30',acknowledge_reference=True,pole_height_m=.3048))",
      "print(json.dumps({'project_id':'solar-test','version':3,'scope':'site-solar-position-not-shading','result':r}))",
    ].join('\n')
    const output=spawnSync('.\\.venv-platform\\Scripts\\python.exe',['-B','-c',program],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:30000})
    assert.equal(output.status,0,output.stderr)
    cached=parseSolar(JSON.parse(output.stdout))
  }
  return structuredClone(cached)
}
function record():WorkspaceRecord {
  return {project_id:'solar-test',version:3,document:{site:{latitude:40.7128,longitude:-74.006,time_zone:'America/New_York'}}} as WorkspaceRecord
}
test('native Solar renders restored charts from real Python pvlib evidence, never a sample house',()=>{
  const result=fixture(),html=renderToStaticMarkup(<SolarPlot result={result}/>)
  for(const label of ['Equidistant solar sky diagram','Annual apparent and geometric solar elevation',
    'Pole shadow length in metres','Monthly solar angles at 09 12 and 15','Astronomical daylight duration',
    'Solar light phase crossings','Civil twilight','Nautical twilight','Astronomical twilight','Golden hour',
    'Day min','Day max','March 20 / September 22','Download annual same-clock CSV',
    'actual open Design model','not inferred from sun hours','23 elapsed hours'])assert.ok(html.includes(label),label)
  assert.equal(result.result.output.charts!.references.length,14)
  assert.equal(result.result.output.charts!.hourly.length,24)
  assert.equal(result.result.output.charts!.monthly.length,12)
  assert.ok(html.includes('Repeated annual times: none at this clock'))
  assert.ok(html.includes('no length clipping'))
  assert.ok(!html.includes('iframe'))
  assert.ok(html.includes('solar-sky-chart'))
  assert.ok(!html.includes('class="utilization-chart"'))
  assert.match(html,/role="region" aria-label="Scrollable solar sky diagram"/)
  assert.match(html,/Explore time of day/)
  assert.match(html,/type="range" min="0" max="92" step="1"/)
  assert.ok(html.includes('Return to calculated time'))
})
test('bounded chart parser rejects missing or inconsistent samples, events, pole geometry and scope',()=>{
  fixture()
  for(const mutate of [
    (r:SolarResult)=>{r.result.output.charts!.sampleCount=14001},
    (r:SolarResult)=>{r.result.output.charts!.annual.rows.pop()},
    (r:SolarResult)=>{r.result.output.charts!.references.pop()},
    (r:SolarResult)=>{r.result.output.charts!.hourly[2].rows.find(row=>row.date==='2026-03-08')!.position=r.result.output.selected},
    (r:SolarResult)=>{r.result.output.charts!.summary.daylight.durationHours=1},
    (r:SolarResult)=>{r.result.output.charts!.pole.path[0]={status:'available',lengthM:0,bearingDeg:0}},
    (r:SolarResult)=>{r.result.output.charts!.pole.selected.lengthM=0},
    (r:SolarResult)=>{r.result.output.charts!.monthly[0].times[0].position!.apparentElevationDeg=NaN},
    (r:SolarResult)=>{r.result.output.charts!.references[0].samples[1].instantUTC=r.result.output.charts!.references[0].samples[0].instantUTC},
  ]) {
    const result=fixture();mutate(result)
    assert.throws(()=>parseSolar(result),/solar chart evidence/)
  }
})
test('CSV retains UTC, geometry/apparent distinction, site provenance and skipped-clock unknowns',()=>{
  const result=fixture()
  const skipped=result.result.output.charts!.hourly[2].rows.find(row=>row.date==='2026-03-08')!
  assert.equal(skipped.position,null)
  const original=result.result.output.charts!.annual
  result.result.output.charts!.annual=result.result.output.charts!.hourly[2]
  const csv=solarCSV(result)
  assert.equal(csv.split('\r\n').length,366)
  assert.match(csv,/geometric_elevation_deg.*apparent_elevation_deg/)
  assert.match(csv,/"America\/New_York"/)
  assert.match(csv,/"2026-03-08","02:00"[^\n]*"skipped local time"/)
  assert.match(csv,/"solar-test","3"/)
  result.result.output.charts!.annual=original
})
test('sky paths interpolate horizon on short azimuth arc and break DST, unknown and night sections',()=>{
  const point=(elevation:number,azimuth:number,localTime:string):SolarPosition=>({
    instantUTC:new Date(localTime).toISOString(),localTime,apparentElevationDeg:elevation,
    geometricElevationDeg:elevation,azimuthDeg:azimuth,aboveHorizon:elevation>0,
  })
  const a=point(-1,359,'2026-03-01T08:00:00-05:00'),b=point(1,1,'2026-03-02T08:00:00-05:00')
  const segment=solarSegments([a,b])[0]
  assert.equal(segment[0].azimuthDeg,0)
  assert.equal(segment[0].apparentElevationDeg,0)
  assert.equal(solarSegments([b,point(2,2,'2026-03-08T08:00:00-04:00')]).length,2)
  assert.equal(solarSegments([b,point(2,2,'2026-03-08T08:00:00-04:00')],true,false).length,1)
  assert.equal(solarSegments([b,null,b]).length,2)
  assert.equal(solarSegments([a,a]).length,0)
  assert.equal(solarSegments([b,a,b]).length,2)
})
test('old cached drafts normalize only added study fields, preserving nullable input and no project edits',()=>{
  const {pole_height_m: _pole,low_sun_cutoff_deg:_cutoff,...legacy}=emptySolarDraft
  const normalized=normalizeSolarDraft({...legacy,date:'2026-06-21',local_time:'12:00',temperature_c:'0'})
  assert.equal(normalized.pole_height_m,'')
  assert.equal(normalized.low_sun_cutoff_deg,'1')
  const inputs=solarInputs(normalized)
  assert.equal(inputs.temperature_c,0)
  assert.equal(inputs.pole_height_m,null)
  assert.equal(inputs.low_sun_cutoff_deg,1)
  const html=renderToStaticMarkup(<SolarStudy record={record()} csrf="fixture" draft={legacy} onChange={()=>{throw new Error('render must not author edits')}} blocked={false}/>)
  assert.match(html,/Calculate site solar charts &amp; analysis/)
  assert.match(html,/14 fixed reference paths, 24 hourly/)
  assert.match(html,/does not substitute a building envelope or example house/)
  assert.match(html,/No automatic analysis on navigation/)
})
test('explicit request sends bounded settings and revision only, rejecting late version and wrong-owner responses',async()=>{
  const original=globalThis.fetch,inputs=solarInputs({...emptySolarDraft,date:'2026-03-08',local_time:'03:30'})
  try {
    globalThis.fetch=async(path,options)=>{
      assert.equal(path,'/api/v1/projects/solar-test/workspace/solar')
      const body=JSON.parse(String(options?.body))
      assert.equal(body.expected_version,3)
      assert.equal(body.pole_height_m,null)
      assert.equal(body.low_sun_cutoff_deg,1)
      assert.equal(body.latitude,undefined)
      assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'fixture-csrf')
      return Response.json({...fixture(),version:4})
    }
    await assert.rejects(calculateSolar(record(),inputs,'fixture-csrf'),/Stale Solar/)
    globalThis.fetch=async()=>Response.json({...fixture(),project_id:'different-project'})
    await assert.rejects(calculateSolar(record(),inputs,'fixture-csrf'),/Stale Solar/)
    globalThis.fetch=async()=>Response.json(fixture())
    await assert.rejects(calculateSolar(record(),inputs,'fixture-csrf'),/Mismatched Solar/)
    const matchingInputs=solarInputs({...emptySolarDraft,date:'2026-03-08',local_time:'03:30',pole_height_m:'.3048',acknowledge_reference:true})
    assert.equal((await calculateSolar(record(),matchingInputs,'fixture-csrf')).result.output.charts!.annual.rows.length,365)
  }finally{globalThis.fetch=original}
})
