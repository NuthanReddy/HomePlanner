import type { PlannerApi } from '../domain/project/planner-api'
import type { PlannerSceneSnapshot, ProjectSnapshot } from '../domain/project/types'
import type { WorkspaceRecord } from './native-api'

export const houseSides=['front','right','rear','left'] as const
export type HouseSide=typeof houseSides[number]
export type Neighbour={state:'unknown'|'clear'|'block';heightM?:number|null;gapM?:number|null}
export type HouseNeighbours=Record<HouseSide,Neighbour>
export type HouseSunConfig={date:string;latitude:number;longitude:number;timeZone:string;time:string;occurrence?:string}
export type HouseSurface={id:string;floorId:string;type:'roof'|'wall';normal:{x:number;y:number;z:number};areaM2:number;
  averageHours:number;minHours:number;maxHours:number;unobstructedHours:number;blockedHours:number;firstSunUTC:string|null;lastSunUTC:string|null}
export type HouseGroup=Omit<HouseSurface,'id'|'normal'>&{bearing:number|null}
export type HouseOutput={elapsedHours:number;aboveHorizonHours:number;nearHorizonExcludedHours:number;
  sampling:{method:string;samplesPerAxis:number;sampleCount:number;intervalCount:number;minSunAltitudeDeg:number};
  assumptions:string[];warnings:string[];surfaces:HouseSurface[]}
export type HouseInterval={startUTC:string;endUTC:string;vector:{east:number;north:number;up:number}}
export interface HouseRuntime {
  exposure:{
    validateNeighbors(neighbours:HouseNeighbours,options?:{complete:boolean}):HouseNeighbours
    prepareScenes(project:ProjectSnapshot,scenes:readonly PlannerSceneSnapshot[]):PlannerSceneSnapshot[]
    inputKey(project:ProjectSnapshot,scenes:PlannerSceneSnapshot[],config:HouseSunConfig,neighbours:HouseNeighbours):string
    groupSurfaces(output:HouseOutput,scenes:PlannerSceneSnapshot[]):HouseGroup[]
  }
  sun:{
    calculate(config:HouseSunConfig):unknown
    position(instant:Date,latitude:number,longitude:number):{vector:HouseInterval['vector'];altitude:number;azimuth:number}
    dailyIntervals(config:HouseSunConfig,minutes:number):Iterable<HouseInterval>
  }
  physics:{surfaceExposure(scene:PlannerSceneSnapshot,sun:HouseInterval['vector'],radiation:Record<string,number>):{
    surfaces:{id:string;type:string;areaM2:number;sunlitFraction:number;incidentWm2:number;beamWm2:number;skyDiffuseWm2:number;groundReflectedWm2:number}[];warnings:string[];directSunStatus:string
  };createSunlightStudy(scenes:PlannerSceneSnapshot[],options:{neighbors:HouseNeighbours;samplesPerAxis:number}):{
    addInterval(interval:{startUTC:string;endUTC:string;sunENU:HouseInterval['vector']}):void;getResult():HouseOutput
  }}
}
export type SiteRegistration={grossNorthWestX:number;grossNorthWestY:number;baseOffsetM:number;acknowledged:boolean}
export type SiteEnvironment={record:WorkspaceRecord;registration:SiteRegistration}
export function linkedSiteRegistration(project:ProjectSnapshot,record:WorkspaceRecord):SiteRegistration|null {
  const value=project.nativeSiteSource as unknown as Record<string,unknown>|null
  if(!value||value.version!==1||value.accountProjectId!==record.project_id||typeof value.fingerprint!=='string')return null
  try {
    const evidence=JSON.parse(value.fingerprint) as {site:unknown;feasibility:unknown}
    if(JSON.stringify(evidence.site)!==JSON.stringify(value.site)||JSON.stringify(value.site)!==JSON.stringify(record.document.site)
      ||!evidence.feasibility)return null
  }catch{return null}
  const registration=value.registration as SiteRegistration|null
  if(!registration||registration.acknowledged!==true||![registration.grossNorthWestX,registration.grossNorthWestY,registration.baseOffsetM].every(Number.isFinite))return null
  for(const floor of project.floors){
    const floorSource=floor.legacy.nativeSiteSource as unknown as Record<string,unknown>|null
    if(!floorSource)continue
    const floorRegistration=floorSource.registration as SiteRegistration|null
    if(floorSource.accountProjectId!==record.project_id||floorSource.fingerprint!==value.fingerprint
      ||!floorRegistration||floorRegistration.grossNorthWestX!==registration.grossNorthWestX
      ||floorRegistration.grossNorthWestY!==registration.grossNorthWestY||floorRegistration.baseOffsetM!==registration.baseOffsetM)
      return null
  }
  return {...registration}
}
export type HouseSnapshot={project:ProjectSnapshot;scenes:PlannerSceneSnapshot[];config:HouseSunConfig;neighbours:HouseNeighbours;key:string;
  surroundings?:{projectId:string;version:number;count:number;registration:SiteRegistration;warnings:string[]}}
export type HouseSunResult={snapshot:HouseSnapshot;output:HouseOutput;groups:HouseGroup[];
  trend:{endUTC:string;groups:HouseGroup[]}[]}
export type IrradianceResult={inputKey:string;instantUTC:string;intervalStartUTC:string;intervalEndUTC:string;durationSeconds:number;weather:Record<string,unknown>;
  albedo:number;shgc:number|null;shgcSource:string;floors:{floorId:string;exposure:ReturnType<HouseRuntime['physics']['surfaceExposure']>}[]}
export function sharedWeatherRows(project:ProjectSnapshot):Record<string,unknown>[] {
  const weather=project.environment.weather as unknown as {records?:Record<string,unknown>[]}|null
  if(!weather||!Array.isArray(weather.records)||!weather.records.length)throw new Error('Apply the full normalized EPW/JSON weather to this Design project first; no current-weather or TMY-year substitution is used.')
  return weather.records
}
export async function calculateHouseIrradiance(snapshot:HouseSnapshot,runtime:HouseRuntime,project:ProjectSnapshot,recordIndex:number,referenceAlbedo=false,
  options:{current?:()=>boolean;yieldControl?:()=>Promise<void>;maxMilliseconds?:number}={}):Promise<IrradianceResult> {
  const started=Date.now()
  const check=()=>{
    if(options.current&&!options.current())throw new Error('Stale irradiance result discarded; current geometry/weather/materials/Site settings were retained.')
    if(Date.now()-started>=(options.maxMilliseconds??30000))throw new Error('Irradiance snapshot exceeded the cooperative 30-second budget; no result was published.')
  }
  check()
  if(snapshot.scenes.length>12||snapshot.scenes.some(scene=>
    !Array.isArray(scene.walls)||scene.walls.length>500||!Array.isArray(scene.openings)||scene.openings.length>500
    ||!Array.isArray(scene.obstacles)||scene.obstacles.length>100))
    throw new Error('Irradiance snapshot is bounded to 12 floors, 500 walls/openings and 100 obstacles per floor.')
  if(snapshot.surroundings===undefined&&Object.values(snapshot.neighbours).some(side=>side.state!=='clear'))
    throw new Error('Legacy surfaceExposure cannot consume full-side neighbour screens. Use registered saved Site objects for irradiance; screens will not be silently ignored.')
  const row=sharedWeatherRows(project)[recordIndex]
  if(!Number.isInteger(recordIndex)||!row)throw new Error('Selected shared weather interval is unavailable.')
  const end=Date.parse(String(row.timestamp)),duration=Number(row.durationSeconds)
  if(typeof row.timestamp!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(row.timestamp)
    ||!Number.isFinite(end)||typeof row.durationSeconds!=='number'||!Number.isFinite(duration)||duration<=0||duration>86400)
    throw new Error('Shared weather interval timing is invalid; explicit UTC/offset end and positive duration are required.')
  for(const field of ['dniWm2','dhiWm2','ghiWm2']){
    const units=(project.environment.weather as unknown as {units?:Record<string,unknown>}).units
    if(units?.[field]!=='W/m2')throw new Error('Apply normalized shared weather radiation in W/m2; raw EPW Wh/m2 is not an incident power input.')
    if(typeof row[field]!=='number'||!Number.isFinite(row[field])||Number(row[field])<0||(Array.isArray(row.missing)&&row.missing.includes(field)))
      throw new Error(`Shared weather interval has missing ${field}; missing radiation is not zero.`)
  }
  const solar=project.environment.solar as unknown as {groundAlbedo?:number|null}|null
  const savedAlbedo=solar?.groundAlbedo
  const albedo=typeof savedAlbedo==='number'?savedAlbedo:referenceAlbedo?0.2:null
  if(albedo===null||!Number.isFinite(albedo)||albedo<0||albedo>1)throw new Error('Shared project ground albedo is unknown. Supply a saved solar assumption or explicitly acknowledge the displayed 0.2 reference.')
  const instant=new Date(end-duration*500),sun=runtime.sun.position(instant,snapshot.config.latitude,snapshot.config.longitude)
  const glazing=project.environment.glazing as unknown as {shgc?:number|null;source?:string}|null
  const shgc=typeof glazing?.shgc==='number'&&Number.isFinite(glazing.shgc)&&glazing.shgc>=0&&glazing.shgc<=1?glazing.shgc:null
  const radiation={dniWm2:Number(row.dniWm2),dhiWm2:Number(row.dhiWm2),ghiWm2:Number(row.ghiWm2),groundAlbedo:albedo}
  const floors:IrradianceResult['floors']=[]
  for(const scene of snapshot.scenes){
    await (options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0))))()
    check()
    const exposure=runtime.physics.surfaceExposure(scene,sun.vector,radiation)
    for(const surface of exposure.surfaces){
      if(!['areaM2','sunlitFraction','incidentWm2','beamWm2','skyDiffuseWm2','groundReflectedWm2'].every(field=>
        Number.isFinite(surface[field as keyof typeof surface])&&Number(surface[field as keyof typeof surface])>=0)||surface.sunlitFraction>1)
        throw new Error('Invalid incumbent irradiance surface evidence.')
    }
    floors.push({floorId:scene.floorId,exposure})
    check()
  }
  const {records: _records,...weather}=project.environment.weather as unknown as Record<string,unknown>
  return {inputKey:JSON.stringify({snapshot:snapshot.key,weather,row,recordIndex,albedo,glazing}),
    instantUTC:instant.toISOString(),intervalStartUTC:new Date(end-duration*1000).toISOString(),intervalEndUTC:new Date(end).toISOString(),
    durationSeconds:duration,weather,albedo,shgc,shgcSource:glazing?.source??'',floors}
}
export const emptyHouseNeighbours=():HouseNeighbours=>Object.fromEntries(houseSides.map(side=>[side,{state:'unknown'}])) as HouseNeighbours
export function validateHouseOutput(output:HouseOutput) {
  if(!Number.isFinite(output.elapsedHours)||output.elapsedHours<20||output.elapsedHours>26
    ||!Number.isFinite(output.aboveHorizonHours)||output.aboveHorizonHours<0||output.aboveHorizonHours>output.elapsedHours
    ||!Number.isFinite(output.nearHorizonExcludedHours)||output.nearHorizonExcludedHours<0||output.nearHorizonExcludedHours>output.aboveHorizonHours
    ||!Array.isArray(output.surfaces)||!output.surfaces.length)throw new Error('Invalid whole-house sunlight evidence.')
  for(const surface of output.surfaces){
    if(!['areaM2','averageHours','minHours','maxHours','unobstructedHours','blockedHours'].every(key=>Number.isFinite(surface[key as keyof HouseSurface])&&Number(surface[key as keyof HouseSurface])>=0)
      ||surface.areaM2<=0||surface.minHours>surface.averageHours+1e-8||surface.averageHours>surface.maxHours+1e-8
      ||surface.maxHours>surface.unobstructedHours+1e-8||surface.unobstructedHours>output.elapsedHours+1e-8
      ||Math.abs(surface.blockedHours-(surface.unobstructedHours-surface.averageHours))>1e-8)
      throw new Error('Invalid area-weighted house sunlight hours.')
  }
}
let loading:Promise<HouseRuntime>|undefined
export function loadHouseRuntime():Promise<HouseRuntime> {
  if(loading)return loading
  loading=(async()=>{
    const base=new URL(`${import.meta.env.BASE_URL}classic/`,document.baseURI)
    for(const asset of ['vendor/suncalc-2.0.1.js','sun-model.js','building-physics.js','sun-exposure.js']){
      await new Promise<void>((resolve,reject)=>{
        const script=document.createElement('script');script.src=new URL(asset,base).href
        script.onload=()=>resolve()
        script.onerror=()=>{script.remove();reject(new Error(`House sunlight engine missing: ${asset}. Keep all local classic assets present.`))}
        document.head.append(script)
      })
    }
    const globals=window as unknown as {HomeSunExposure:HouseRuntime['exposure'];HomeSun:HouseRuntime['sun'];BuildingPhysics:HouseRuntime['physics']}
    return {exposure:globals.HomeSunExposure,sun:globals.HomeSun,physics:globals.BuildingPhysics}
  })().catch(error=>{loading=undefined;throw error})
  return loading
}
export function registerSiteObstacles(scenes:PlannerSceneSnapshot[],environment:SiteEnvironment) {
  const {record,registration}=environment,site=record.document.site
  if(!registration.acknowledged||![registration.grossNorthWestX,registration.grossNorthWestY,registration.baseOffsetM].every(Number.isFinite))
    throw new Error('Register the saved Site gross NW origin and vertical datum in the Design net-plot frame explicitly, then acknowledge registration.')
  const factor=site.units==='ft'?.3048:1
  if(site.width===null||site.depth===null||site.width*factor<=0||site.depth*factor<=0)
    throw new Error('Apply actual Site gross width and depth before registering surroundings.')
  if(site.obstacles.length>100)throw new Error('Site surroundings study is bounded to 100 explicit objects.')
  const heading=Number(scenes[0]?.headingDeg),normalized=((heading%360)+360)%360
  if(!Number.isFinite(heading)||Math.abs(normalized/90-Math.round(normalized/90))>1e-8)
    throw new Error('Site east/south rectangular objects require a cardinal Design heading for exact incumbent-prism registration. Noncardinal mapping is unsupported; no enlarged bounding boxes were invented.')
  if(scenes.some(scene=>scene.headingDeg!==heading))throw new Error('Design floors have mismatched headings; Site objects cannot be registered by guesswork.')
  const radians=normalized*Math.PI/180,c=Math.round(Math.cos(radians)),s=Math.round(Math.sin(radians))
  const map=(x:number,y:number)=>({x:registration.grossNorthWestX+x*c+y*s,y:registration.grossNorthWestY-x*s+y*c})
  for(const scene of scenes){
    const plot=scene.plot as Record<string,number>
    for(const point of [{x:0,y:0},{x:plot.w,y:0},{x:0,y:plot.h},{x:plot.w,y:plot.h}]){
      const dx=point.x-registration.grossNorthWestX,dy=point.y-registration.grossNorthWestY
      const east=dx*c-dy*s,south=dx*s+dy*c
      if(east< -1e-7||south< -1e-7||east>site.width*factor+1e-7||south>site.depth*factor+1e-7)
        throw new Error('Registered Site gross extents do not contain the actual Design net plot. Review dimensions/orientation/origin (including road widening); no alignment or geometry resize was inferred.')
    }
  }
  const warnings=[
    `Saved Site Environment version ${record.version}; gross NW at Design net-plot-local (${registration.grossNorthWestX}, ${registration.grossNorthWestY}) m, vertical datum offset ${registration.baseOffsetM} m. Explicit registration, not assumed origin equality.`,
    'Only authored Site objects are modeled. Empty or incomplete surveyed surroundings are not evidence that every side is clear; no unmodeled neighbourhood screens were added.',
    'Imported Design obstacles are replaced in this derived study by the selected saved Site Environment source, not added a second time. Actual Design project records are unchanged.',
  ]
  const obstacles=site.obstacles.map(object=>{
    if(object.height_m===null||object.base_m===null||object.transmission===null)
      throw new Error(`Site Environment object "${object.name}" has unknown height, base or transmission. Complete saved Site inputs; unknown is not zero or opaque.`)
    if(![object.x,object.y,object.width_m,object.depth_m,object.height_m,object.base_m,object.transmission].every(Number.isFinite)
      ||object.width_m<=0||object.depth_m<=0||object.height_m<=0||object.transmission<0||object.transmission>1)
      throw new Error(`Site Environment object "${object.name}" has invalid physical inputs.`)
    const corners=[map(object.x,object.y),map(object.x+object.width_m,object.y),
      map(object.x,object.y+object.depth_m),map(object.x+object.width_m,object.y+object.depth_m)]
    const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y))
    const base=object.base_m+registration.baseOffsetM
    if(base<0)throw new Error(`Site Environment object "${object.name}" maps below the supported flat ground datum; review vertical registration.`)
    if(object.kind==='tree')warnings.push(`Tree "${object.name}" is its supplied rectangular canopy prism with constant ${object.transmission} transmission, not a crown mesh, species, growth or seasonal foliage model.`)
    return {id:`site:${record.project_id}:${object.id}`,sourceId:`site:${record.project_id}:${object.id}`,type:object.kind==='tree'?'tree':'building',
      x,y,w:Math.max(...corners.map(p=>p.x))-x,h:Math.max(...corners.map(p=>p.y))-y,
      heightM:object.height_m,baseM:base,transmittance:object.transmission}
  })
  return {scenes:scenes.map((scene,index)=>({...scene,obstacles:obstacles.map(object=>({...object,id:`${scene.floorId}:${index}:${object.id}`}))})) as PlannerSceneSnapshot[],
    warnings,registration}
}
export function houseSnapshot(planner:PlannerApi,runtime:HouseRuntime,config:HouseSunConfig,neighbours:HouseNeighbours,environment?:SiteEnvironment):HouseSnapshot {
  const project=planner.getProject()
  let scenes=runtime.exposure.prepareScenes(project,planner.getScenes())
  runtime.sun.calculate(config)
  const mapped=environment?registerSiteObstacles(scenes,environment):null
  if(mapped)scenes=mapped.scenes
  const normalized=environment?Object.fromEntries(houseSides.map(side=>[side,{state:'clear'}])) as HouseNeighbours:runtime.exposure.validateNeighbors(neighbours)
  const surroundings=environment?{projectId:environment.record.project_id,version:environment.record.version,count:environment.record.document.site.obstacles.length,
    registration:environment.registration,warnings:mapped!.warnings}:undefined
  const key=JSON.stringify({key:runtime.exposure.inputKey(project,scenes,config,normalized),activeFloor:project.activeFloorId,surroundings,
    siteEnvironment:environment?{width:environment.record.document.site.width,depth:environment.record.document.site.depth,
      units:environment.record.document.site.units,objects:environment.record.document.site.obstacles}:undefined})
  return {project,scenes,config:{...config},neighbours:normalized,key,surroundings}
}
export async function calculateHouseSun(snapshot:HouseSnapshot,runtime:HouseRuntime,options:{
  current:()=>boolean;yieldControl?:()=>Promise<void>;maxMilliseconds?:number
}):Promise<HouseSunResult> {
  runtime.exposure.validateNeighbors(snapshot.neighbours,{complete:true})
  if(snapshot.scenes.length>12||snapshot.scenes.reduce((sum,scene)=>sum+(Array.isArray(scene.walls)?scene.walls.length:0),0)>500)
    throw new Error('House sunlight is limited to 12 modeled floors and 500 walls per explicit study; no simplified replacement was used.')
  const started=performance.now(),trend:HouseSunResult['trend']=[]
  const study=runtime.physics.createSunlightStudy(snapshot.scenes,{neighbors:snapshot.neighbours,samplesPerAxis:8})
  if(study.getResult().sampling.sampleCount>50000)throw new Error('House sunlight exceeds 50000 receiver points; no geometry was simplified.')
  const yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)))
  function current(){
    if(!options.current())throw new Error('House geometry or study inputs changed. Stale sunlight result discarded; calculate again.')
    if(performance.now()-started>(options.maxMilliseconds??30000))throw new Error('House sunlight exceeded the 30-second cooperative budget; no result attached.')
  }
  let count=0
  for(const interval of runtime.sun.dailyIntervals(snapshot.config,5)){
    current()
    if(++count>313)throw new Error('House sunlight civil-day interval bound exceeded.')
    study.addInterval({startUTC:interval.startUTC,endUTC:interval.endUTC,sunENU:interval.vector})
    trend.push({endUTC:interval.endUTC,groups:runtime.exposure.groupSurfaces(study.getResult(),snapshot.scenes)})
    if(count%4===0){await yieldControl();current()}
  }
  current()
  const output=study.getResult();validateHouseOutput(output)
  if(snapshot.surroundings)output.warnings.push(...snapshot.surroundings.warnings)
  return {snapshot,output,groups:runtime.exposure.groupSurfaces(output,snapshot.scenes),trend}
}
