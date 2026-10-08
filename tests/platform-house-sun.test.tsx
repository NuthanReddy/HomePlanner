import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { calculateHouseSun, calculateHouseIrradiance, houseSnapshot, emptyHouseNeighbours, registerSiteObstacles, linkedSiteRegistration, type HouseRuntime, type HouseNeighbours, type HouseSunConfig, type SiteEnvironment } from '../src/platform/house-sun-api'
import { HouseSunResults, HouseSunStudy, HouseIrradiance } from '../src/platform/HouseSunStudy'
import type { PlannerApi } from '../src/domain/project/planner-api'
import type { WorkspaceRecord } from '../src/platform/native-api'
const require=createRequire(import.meta.url)
const Model=require('../planner-model.js'),Sun=require('../sun-model.js'),Physics=require('../building-physics.js'),Exposure=require('../sun-exposure.js')
const runtime:HouseRuntime={sun:Sun,physics:Physics,exposure:Exposure}
const clear=():HouseNeighbours=>({front:{state:'clear'},right:{state:'clear'},rear:{state:'clear'},left:{state:'clear'}})
const config:HouseSunConfig={latitude:17.3262,longitude:78.5916,date:'2026-09-15',time:'12:00',timeZone:'Asia/Kolkata'}
function fixture(){
  const project=Model.createProject()
  const context={
    plate:{frontEdge:'E',width:10,depth:8,rawDepth:8,localSetbacks:{N:3,E:2,S:2,W:2}},
    g:{W:10,D:8,outerX:.5,outerY:.5,outerW:9,outerD:7,coreX:.7,coreY:.7,coreW:8.6,coreD:6.6},
    cfg:{walls:{external:.2,internal:.1}},plan:{placed:[],furniture:[],openings:{doors:[],windows:[]}},
  }
  let scene=Model.buildScene(context,project)
  const planner={getProject:()=>project,getScenes:()=>[scene]} as unknown as PlannerApi
  return {planner,project,get scene(){return scene},replace:(value:typeof scene)=>{scene=value}}
}
test('actual scenes translate net plot once, preserve source geometry and area-weight hours with real engines',async()=>{
  const data=fixture(),before=JSON.stringify(data.scene)
  const snapshot=houseSnapshot(data.planner,runtime,config,clear())
  assert.equal(snapshot.scenes[0].floor!.w,14)
  assert.notDeepEqual(snapshot.scenes[0].building,data.scene.building)
  assert.equal(JSON.stringify(data.scene),before)
  const result=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.equal(result.output.elapsedHours,24)
  assert.equal(result.output.sampling.intervalCount,288)
  assert.equal(result.output.sampling.samplesPerAxis,8)
  assert.equal(result.groups.length,5)
  assert.equal(result.trend.length,288)
  assert.deepEqual(result.trend.at(-1)!.groups,result.groups)
  assert.ok(result.groups.find(row=>row.type==='roof')!.averageHours>10)
  assert.ok(result.groups.every(row=>row.averageHours<=row.unobstructedHours&&row.blockedHours>=0))
  const html=renderToStaticMarkup(<HouseSunResults result={result}/>)
  for(const value of ['Average direct sun h','Point range h','Orientation opportunity h','Lost to shade h',
    'First / last sampled sun','Accumulated house direct sunlight','House direct sun time trend',
    'no rerun or invented instantaneous shade','separate shared-weather snapshot','Exposed roof / terrace'])assert.ok(html.includes(value),value)
  const blocks=Object.fromEntries(Object.keys(clear()).map(side=>[side,{state:'block',heightM:12,gapM:2}])) as HouseNeighbours
  const blocked=await calculateHouseSun(houseSnapshot(data.planner,runtime,config,blocks),runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.ok(blocked.groups.find(row=>row.type==='roof')!.averageHours<result.groups.find(row=>row.type==='roof')!.averageHours)
  assert.equal(JSON.stringify(data.scene),before)
})
function weatherFixture(data:ReturnType<typeof fixture>,timestamp='2026-09-15T07:00:00Z'){
  data.project.environment.weather={id:'explicit-source',kind:'tmy',source:{name:'Hypothetical fixture, not observed'},
    units:{dniWm2:'W/m2',dhiWm2:'W/m2',ghiWm2:'W/m2'},records:[
      {timestamp,durationSeconds:3600,dniWm2:800,dhiWm2:100,ghiWm2:700,missing:[]}]}
  data.project.environment.solar={groundAlbedo:.3}
  data.project.environment.glazing={shgc:.45,source:'Applied shared Materials hypothetical fixture'}
}
test('shared weather irradiance reuses exact actual-house kernel and preceding UTC interval, without TMY remap or energy inference',async()=>{
  const data=fixture();weatherFixture(data,'2001-09-15T07:00:00Z')
  const before=JSON.stringify(data.project),snapshot=houseSnapshot(data.planner,runtime,config,clear())
  const output=await calculateHouseIrradiance(snapshot,runtime,data.project,0)
  assert.equal(output.instantUTC,'2001-09-15T06:30:00.000Z')
  assert.equal(output.intervalStartUTC,'2001-09-15T06:00:00.000Z')
  assert.equal(output.intervalEndUTC,'2001-09-15T07:00:00.000Z')
  assert.equal(output.durationSeconds,3600)
  assert.equal(output.albedo,.3);assert.equal(output.shgc,.45)
  assert.equal(output.weather.kind,'tmy');assert.equal(output.weather.records,undefined)
  assert.deepEqual(output.floors[0].exposure,Physics.surfaceExposure(snapshot.scenes[0],
    Sun.position(new Date(output.instantUTC),config.latitude,config.longitude).vector,
    {dniWm2:800,dhiWm2:100,ghiWm2:700,groundAlbedo:.3}))
  assert.ok(output.floors[0].exposure.surfaces.some(surface=>surface.incidentWm2>100))
  assert.ok(output.floors[0].exposure.surfaces.every(surface=>
    Math.abs(surface.incidentWm2-surface.beamWm2-surface.skyDiffuseWm2-surface.groundReflectedWm2)<1e-8))
  assert.equal(JSON.stringify(data.project),before)
  const hours=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
  const html=renderToStaticMarkup(<HouseIrradiance result={hours} planner={data.planner} runtime={runtime}/>)
  for(const phrase of ['Shared weather source interval index','reference 0.2','Calculate shared-weather irradiance snapshot','preceding-interval mean','No duplicate weather upload'])
    assert.ok(html.includes(phrase),phrase)
})
test('radiation missing masks, units, unknown albedo and SHGC stay explicit; zero at night is valid',async()=>{
  const data=fixture();weatherFixture(data,'2026-09-15T19:00:00Z')
  const snapshot=houseSnapshot(data.planner,runtime,config,clear()),row=data.project.environment.weather.records[0]
  row.missing=['dniWm2']
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0),/missing dniWm2/)
  row.missing=[];row.dniWm2=null
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0),/missing dniWm2/)
  row.dniWm2=0;row.dhiWm2=0;row.ghiWm2=0
  data.project.environment.weather.units.dniWm2='Wh/m2'
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0),/normalized/)
  data.project.environment.weather.units.dniWm2='W/m2'
  data.project.environment.solar.groundAlbedo=null
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0),/albedo is unknown/)
  data.project.environment.glazing.shgc=null
  const output=await calculateHouseIrradiance(snapshot,runtime,data.project,0,true)
  assert.equal(output.albedo,.2);assert.equal(output.shgc,null)
  assert.ok(output.floors[0].exposure.surfaces.every(surface=>surface.incidentWm2===0&&surface.sunlitFraction===0))
  assert.equal(output.floors[0].exposure.directSunStatus,'below-horizon')
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,99,true),/unavailable/)
})
test('shared weather uses real fixed UTC durations across DST and stale weather/material changes are discarded across yields',async()=>{
  const data=fixture();weatherFixture(data,'2026-11-01T06:00:00Z')
  data.project.environment.weather.records.push({...data.project.environment.weather.records[0],timestamp:'2026-11-01T07:00:00Z'})
  const snapshot=houseSnapshot(data.planner,runtime,{...config,latitude:40.7,longitude:-74,timeZone:'America/New_York'},clear())
  const early=await calculateHouseIrradiance(snapshot,runtime,data.project,0),late=await calculateHouseIrradiance(snapshot,runtime,data.project,1)
  assert.equal(Date.parse(late.instantUTC)-Date.parse(early.instantUTC),3600000)
  assert.equal(early.durationSeconds,3600);assert.equal(late.durationSeconds,3600)
  for(const mutate of [()=>{data.project.environment.weather.records[0].dniWm2=100},
    ()=>{data.project.environment.glazing.shgc=.9}]){
    const captured=JSON.stringify(data.project)
    await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0,false,{
      current:()=>JSON.stringify(data.project)===captured,yieldControl:async()=>{mutate()}}),/Stale irradiance/)
  }
  await assert.rejects(calculateHouseIrradiance(snapshot,runtime,data.project,0,false,{maxMilliseconds:0}),/budget/)
  const blocked=clear();blocked.front={state:'block',heightM:9,gapM:1}
  await assert.rejects(calculateHouseIrradiance(houseSnapshot(data.planner,runtime,config,blocked),runtime,data.project,0),/screens/)
})
test('irradiance honors registered across-road Site objects with the same actual geometry and explicit receiver/prism semantics',async()=>{
  const data=fixture();weatherFixture(data,'2026-09-15T04:00:00Z')
  const surroundings=environment(),blocked=houseSnapshot(data.planner,runtime,config,clear(),surroundings)
  const without={...surroundings,record:{...surroundings.record,document:{...surroundings.record.document,
    site:{...surroundings.record.document.site,obstacles:[]}}}}
  const clearSnapshot=houseSnapshot(data.planner,runtime,config,clear(),without)
  const a=await calculateHouseIrradiance(clearSnapshot,runtime,data.project,0),b=await calculateHouseIrradiance(blocked,runtime,data.project,0)
  const roofs=(output:typeof a)=>output.floors[0].exposure.surfaces.filter(surface=>surface.type==='roof')
  assert.ok(roofs(b)[0].beamWm2<roofs(a)[0].beamWm2)
  assert.equal(roofs(b)[0].skyDiffuseWm2,roofs(a)[0].skyDiffuseWm2,'Legacy unobstructed diffuse is explicitly independent of beam shade.')
})
test('unknown neighbours, missing heights/plot and incomplete actual storeys remain prerequisites',async()=>{
  const data=fixture()
  const unknown=houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours())
  await assert.rejects(calculateHouseSun(unknown,runtime,{current:()=>true}),/front.*unknown/)
  const incomplete=clear();incomplete.front={state:'block',heightM:null,gapM:1}
  await assert.rejects(calculateHouseSun(houseSnapshot(data.planner,runtime,config,incomplete),runtime,{current:()=>true}),/height/)
  data.replace({...data.scene,wallHeightM:null})
  await assert.rejects(calculateHouseSun(houseSnapshot(data.planner,runtime,config,clear()),runtime,{current:()=>true}),/wallHeight/)
  data.replace({...data.scene,plot:null})
  assert.throws(()=>houseSnapshot(data.planner,runtime,config,clear()),/actual plot/)
  const next=fixture();next.project.floors.push({...next.project.floors[0],id:'uncompiled-floor',name:'Missing upper'})
  assert.throws(()=>houseSnapshot(next.planner,runtime,config,clear()),/Missing floor geometry/)
})
test('completed edits, imports, floor and source/date/neighbour changes discard results across yields; clock-only display is independent',async()=>{
  const data=fixture(),snapshot=houseSnapshot(data.planner,runtime,config,clear())
  assert.equal(houseSnapshot(data.planner,runtime,{...config,time:'15:00'},clear()).key,snapshot.key)
  for(const mutate of [
    ()=>{data.project.activeFloorId='other'},
    ()=>{data.project.id='imported-replacement'},
    ()=>{data.replace({...data.scene,building:{...data.scene.building,x:data.scene.building.x+.01}})},
  ]){
    const fresh=houseSnapshot(data.planner,runtime,config,clear())
    await assert.rejects(calculateHouseSun(fresh,runtime,{current:()=>houseSnapshot(data.planner,runtime,config,clear()).key===fresh.key,
      yieldControl:async()=>{mutate()}}),/Stale sunlight result/)
  }
  const latest=fixture(),initial=houseSnapshot(latest.planner,runtime,config,clear())
  assert.notEqual(houseSnapshot(latest.planner,runtime,{...config,date:'2026-09-16'},clear()).key,initial.key)
  assert.notEqual(houseSnapshot(latest.planner,runtime,{...config,latitude:18},clear()).key,initial.key)
  const block=clear();block.front={state:'block',heightM:9,gapM:1}
  assert.notEqual(houseSnapshot(latest.planner,runtime,config,block).key,initial.key)
  await assert.rejects(calculateHouseSun(initial,runtime,{current:()=>false}),/Stale sunlight result/)
  await assert.rejects(calculateHouseSun(initial,runtime,{current:()=>true,maxMilliseconds:0}),/budget/)
})
test('DST integrates actual 23/25-hour days and polar night is real zero, not unknown',async()=>{
  for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]] as const){
    const data=fixture(),snapshot=houseSnapshot(data.planner,runtime,{...config,date,latitude:40.7,longitude:-74,timeZone:'America/New_York'},clear())
    const result=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
    assert.equal(result.output.elapsedHours,hours)
    assert.equal(result.trend.length,hours*12)
  }
  const data=fixture(),snapshot=houseSnapshot(data.planner,runtime,{...config,date:'2026-12-21',latitude:78.2,longitude:15.6,timeZone:'Arctic/Longyearbyen'},clear())
  const result=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.equal(result.output.aboveHorizonHours,0)
  assert.ok(result.groups.every(row=>row.averageHours===0&&row.firstSunUTC===null))
})
test('actual stacked floors shade lower storeys, omit covered roof and never repeat permitted floors',async()=>{
  const data=fixture(),ground=data.scene
  const upperId='actual-upper'
  data.project.floors.push({...data.project.floors[0],id:upperId,name:'Actual upper'})
  const upper={...ground,floorId:upperId,floorElevationM:3,
    walls:ground.walls.map((wall:Record<string,unknown>)=>({...wall,id:`upper:${wall.id}`,baseM:Number(wall.baseM)+3})),
    openings:[],rooms:ground.rooms.map((room:Record<string,unknown>)=>({...room,id:`upper:${room.id}`}))}
  const planner={getProject:()=>data.project,getScenes:()=>[ground,upper]} as unknown as PlannerApi
  const result=await calculateHouseSun(houseSnapshot(planner,runtime,config,clear()),runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.equal(result.groups.filter(row=>row.type==='roof').length,1)
  assert.equal(result.groups.find(row=>row.type==='roof')!.floorId,upperId)
  assert.ok(result.output.warnings.some(text=>text.includes('fully covered')))
  assert.equal(result.snapshot.project.floors.length,2)
})
test('missing actual planner shows honest handoff; source controls never author imported project',()=>{
  const data=fixture(),before=JSON.stringify(data.project)
  const record={project_id:'account-workspace',version:3,document:{site:{latitude:null,longitude:null,time_zone:null}}} as unknown as WorkspaceRecord
  const missing=renderToStaticMarkup(<HouseSunStudy record={record} date="2026-09-15"/>)
  assert.match(missing,/Open the actual project JSON in Design first/)
  const html=renderToStaticMarkup(<HouseSunStudy record={record} date="2026-09-15" planner={data.planner}/>)
  for(const value of ['Saved Site location (default)','explicit alternative','not silently synchronized','I reviewed','Calculate house direct sun hours','unknown','empty surroundings are not surveyed clear space'])assert.ok(html.includes(value),value)
  assert.equal(JSON.stringify(data.project),before)
})
function environment():SiteEnvironment {
  return {record:{project_id:'applied-site',version:4,document:{site:{width:13,depth:14,units:'m',latitude:17.3262,longitude:78.5916,time_zone:'Asia/Kolkata',
    obstacles:[{id:'east-road-neighbour',kind:'cuboid',name:'Across east road',x:14,y:-2,width_m:3,depth_m:18,height_m:30,base_m:0,transmission:0}]}}} as WorkspaceRecord,
  registration:{grossNorthWestX:0,grossNorthWestY:13,baseOffsetM:0,acknowledged:true}}
}
test('generated native Site provenance supplies matching registration without manual origins and rejects stale/account-divergent links',()=>{
  const data=fixture(),env=environment(),site=env.record.document.site
  const source={version:1,accountProjectId:env.record.project_id,workspaceVersion:env.record.version,
    site:structuredClone(site),fingerprint:JSON.stringify({site,feasibility:{status:'computed'}}),registration:env.registration}
  data.project.nativeSiteSource=source
  assert.deepEqual(linkedSiteRegistration(data.project,env.record),env.registration)
  assert.equal(linkedSiteRegistration(data.project,{...env.record,project_id:'another-account'}),null)
  assert.equal(linkedSiteRegistration(data.project,{...env.record,document:{...env.record.document,site:{...site,width:20}}}),null)
  const html=renderToStaticMarkup(<HouseSunStudy planner={data.planner} record={env.record} date={config.date}/>)
  assert.match(html,/Registered automatically from matching generated\/applied Site source/)
  assert.ok(!html.includes('Site gross NW in Design net-plot-local x (m)'))
  data.project.floors[0].legacy.nativeSiteSource={...source,plateId:'B',registration:{...env.registration,grossNorthWestX:env.registration.grossNorthWestX-4}}
  assert.equal(linkedSiteRegistration(data.project,env.record),null)
  data.project.floors[0].legacy.nativeSiteSource={...source,plateId:'A'}
  assert.deepEqual(linkedSiteRegistration(data.project,env.record),env.registration)
  source.fingerprint='invalid'
  assert.equal(linkedSiteRegistration(data.project,env.record),null)
})
test('saved Site gross east/south surroundings map once into cardinal Design frame including across-road objects and applied revision',async()=>{
  const data=fixture(),before=JSON.stringify(data.scene),env=environment()
  const snapshot=houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours(),env)
  const object=(snapshot.scenes[0].obstacles as unknown as Record<string,unknown>[])[0]
  assert.deepEqual({x:object.x,y:object.y,w:object.w,h:object.h},{x:-2,y:-4,w:18,h:3})
  assert.equal(object.transmittance,0)
  assert.ok(Object.values(snapshot.neighbours).every(side=>side.state==='clear'))
  assert.equal(snapshot.surroundings!.version,4)
  const blocked=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
  env.record.document.site.obstacles=[]
  const noModeled=await calculateHouseSun(houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours(),env),runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.ok(blocked.groups.find(row=>row.type==='roof')!.averageHours<noModeled.groups.find(row=>row.type==='roof')!.averageHours)
  assert.ok(noModeled.output.warnings.some(text=>text.includes('not evidence that every side is clear')))
  assert.equal(JSON.stringify(data.scene),before)
  env.record.version++
  assert.notEqual(snapshot.key,houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours(),env).key)
})
test('Site registration refuses mismatched extents, unknown values, unacknowledged origins and unsupported noncardinal boxes',()=>{
  const data=fixture(),prepared=runtime.exposure.prepareScenes(data.project,[data.scene])
  const env=environment()
  assert.throws(()=>registerSiteObstacles(prepared,{...env,registration:{...env.registration,acknowledged:false}}),/Register/)
  assert.throws(()=>registerSiteObstacles(prepared,{...env,registration:{...env.registration,grossNorthWestY:0}}),/extents/)
  env.record.document.site.width=5
  assert.throws(()=>registerSiteObstacles(prepared,env),/extents/)
  env.record.document.site.width=13
  env.record.document.site.obstacles[0].height_m=null
  assert.throws(()=>registerSiteObstacles(prepared,env),/unknown height/)
  env.record.document.site.obstacles[0].height_m=30
  env.record.document.site.obstacles[0].base_m=null
  assert.throws(()=>registerSiteObstacles(prepared,env),/unknown height/)
  env.record.document.site.obstacles[0].base_m=0
  env.record.document.site.obstacles[0].transmission=null
  assert.throws(()=>registerSiteObstacles(prepared,env),/unknown height/)
  assert.throws(()=>registerSiteObstacles(prepared.map(scene=>({...scene,headingDeg:45})),environment()),/cardinal/)
})
test('tree canopy partial transmission and alternate unit gross dimensions survive without opaque defaults or double counting',async()=>{
  const data=fixture(),env=environment()
  env.record.document.site.units='ft';env.record.document.site.width=13/.3048;env.record.document.site.depth=14/.3048
  const obstacle=env.record.document.site.obstacles[0]
  obstacle.kind='tree';obstacle.name='Authored canopy';obstacle.transmission=.5;obstacle.base_m=2
  const snapshot=houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours(),env)
  const result=await calculateHouseSun(snapshot,runtime,{current:()=>true,yieldControl:async()=>{}})
  assert.equal((snapshot.scenes[0].obstacles as unknown as Record<string,unknown>[])[0].baseM,2)
  assert.ok(result.output.warnings.some(text=>text.includes('rectangular canopy prism')))
  assert.ok(result.output.warnings.some(text=>text.includes('partial-transmission')))
  assert.ok(result.groups.some(group=>group.blockedHours>0&&group.averageHours>0))
  const mapped=registerSiteObstacles([snapshot.scenes[0],{...snapshot.scenes[0],floorId:'actual-upper'}],env)
  const a=(mapped.scenes[0].obstacles as unknown as Record<string,unknown>[])[0],b=(mapped.scenes[1].obstacles as unknown as Record<string,unknown>[])[0]
  assert.equal(a.sourceId,b.sourceId)
  assert.notEqual(a.id,b.id)
  assert.equal(a.transmittance,.5)
  const oldKey=snapshot.key
  env.record.document.site.depth=15/.3048
  assert.notEqual(houseSnapshot(data.planner,runtime,config,emptyHouseNeighbours(),env).key,oldKey)
})
