import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PlannerApi } from '../domain/project/planner-api'
import type { WorkspaceRecord } from './native-api'
import { errorMessage } from './api'
import { calculateHouseSun, calculateHouseIrradiance, sharedWeatherRows, emptyHouseNeighbours, houseSides, houseSnapshot, loadHouseRuntime, linkedSiteRegistration,
  type IrradianceResult,
  type HouseNeighbours, type HouseRuntime, type HouseSunConfig, type HouseSunResult, type HouseSide } from './house-sun-api'

type NeighbourDraft=Record<HouseSide,{state:'unknown'|'clear'|'block';height:string;gap:string}>
const emptyNeighbours=():NeighbourDraft=>Object.fromEntries(houseSides.map(side=>[side,{state:'unknown',height:'',gap:''}])) as NeighbourDraft
function savedNeighbours(planner:PlannerApi|null|undefined):NeighbourDraft {
  const result=emptyNeighbours()
  const sunlight=planner?.getProject().environment.sunlight
  if(sunlight&&typeof sunlight==='object'&&!Array.isArray(sunlight)){
    const neighbours=(sunlight as Record<string,unknown>).neighbors
    if(neighbours&&typeof neighbours==='object'&&!Array.isArray(neighbours)){
      for(const side of houseSides){
        const item=(neighbours as Record<string,unknown>)[side] as Record<string,unknown>|null
        if(item&&typeof item==='object'&&!Array.isArray(item)&&['unknown','clear','block'].includes(String(item.state)))
          result[side]={state:item.state as NeighbourDraft[HouseSide]['state'],height:item.heightM==null?'':String(item.heightM),gap:item.gapM==null?'':String(item.gapM)}
      }
    }
  }
  return result
}
function neighboursInput(draft:NeighbourDraft):HouseNeighbours {
  const result=emptyHouseNeighbours()
  for(const side of houseSides){
    const item=draft[side]
    result[side]={state:item.state,...(item.state==='block'?{heightM:item.height.trim()===''?null:Number(item.height),gapM:item.gap.trim()===''?null:Number(item.gap)}:{})}
  }
  return result
}
export function HouseIrradiance({result,planner,runtime}:{result:HouseSunResult;planner:PlannerApi;runtime:HouseRuntime}) {
    const [index,setIndex]=useState('0'),[reference,setReference]=useState(false),[output,setOutput]=useState<IrradianceResult|null>(null),[error,setError]=useState('')
    const [busy,setBusy]=useState(false),generation=useRef(0)
    const project=planner.getProject()
    let rows:Record<string,unknown>[]=[]
    try{rows=sharedWeatherRows(project)}catch{}
    const evidenceKey=JSON.stringify({weather:project.environment.weather,glazing:project.environment.glazing,solar:project.environment.solar})
    useEffect(()=>{generation.current++;setOutput(null);setBusy(false)},[evidenceKey,index,reference])
    useEffect(()=>()=>{generation.current++},[])
    return <section aria-label="Shared weather house irradiance"><h4>House irradiance from shared weather</h4>
      <p>Reuses full weather explicitly applied to this Design project and shared Materials glazing. No duplicate weather upload, plot inputs or year remapping.
        Select an actual source interval; calculate at its UTC midpoint using its preceding-interval mean DNI/DHI/GHI.</p>
      {!rows.length?<p role="status">Apply normalized EPW/JSON weather to the shared Design project first. No radiation is inferred from direct-sun hours.</p>:<>
        <label>Shared weather source interval index (0–{rows.length-1})<input type="number" min="0" max={rows.length-1} step="1" value={index}
          onChange={event=>{generation.current++;setOutput(null);setIndex(event.target.value)}}/></label>
        <p>Selected source interval end: {String(rows[Number(index)]?.timestamp??'Unavailable')};
          duration {String(rows[Number(index)]?.durationSeconds??'Unknown')} seconds. This source date is independent of the daily-hours date above; it is never shifted to match it.</p>
        <label><input type="checkbox" checked={reference} onChange={event=>setReference(event.target.checked)}/>
          If saved ground albedo is unknown, explicitly use hypothetical reference 0.2 (not measured). Saved known albedo takes precedence.</label>
        <button type="button" disabled={busy} onClick={async()=>{
          const token=++generation.current,captured=planner.exportProject()
          setOutput(null);setError('');setBusy(true)
          const current=()=>generation.current===token&&planner.exportProject()===captured
          try{
            if(!index.trim()||!Number.isInteger(Number(index)))throw new Error('Choose an integer source interval index.')
            const calculated=await calculateHouseIrradiance(result.snapshot,runtime,planner.getProject(),Number(index),reference,{current})
            if(current())setOutput(calculated)
          }catch(problem){if(current())setError(errorMessage(problem))}
          finally{if(generation.current===token)setBusy(false)}
        }}>{busy?'Calculating bounded snapshot…':'Calculate shared-weather irradiance snapshot'}</button>
      </>}
      {error&&<p role="alert">{error}</p>}
      {output&&<>
        <p>UTC midpoint {output.instantUTC}; interval {output.intervalStartUTC} → {output.intervalEndUTC}, {output.durationSeconds} seconds.
          Weather kind: {String(output.weather.kind)}; source: {JSON.stringify(output.weather.source)}. Ground albedo {output.albedo}.
          Incident values are W/m², not Wh/m²; this snapshot is not integrated energy.</p>
        <p>Weather station/location: {JSON.stringify(output.weather.location??'Unknown')}. Representative source weather is not measured weather at the modeled house.
          Solar rays use the reviewed house latitude {result.snapshot.config.latitude}, longitude {result.snapshot.config.longitude};
          local midpoint {new Intl.DateTimeFormat('en-GB',{timeZone:result.snapshot.config.timeZone,dateStyle:'medium',timeStyle:'long'}).format(new Date(output.instantUTC))}.
          Apparent-position engine: HomeSun / SunCalc 2.0.1. Geometry is the same registered actual Design/Site snapshot as the hours study.</p>
        {output.floors.map(floor=><p key={floor.floorId}>{floor.floorId}: direct-beam status {floor.exposure.directSunStatus}.</p>)}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Actual house weather irradiance by surface"><table><thead><tr>
          <th>Floor / surface</th><th>Area m²</th><th>Beam sunlit</th><th>Beam W/m²</th><th>Sky diffuse W/m²</th><th>Ground reflected W/m²</th><th>Incident W/m²</th><th>Constant-SHGC gain W</th>
        </tr></thead><tbody>{output.floors.flatMap(floor=>floor.exposure.surfaces.map(surface=><tr key={`${floor.floorId}-${surface.id}`}>
          <th scope="row">{result.snapshot.project.floors.find(item=>item.id===floor.floorId)?.name} / {surface.type} / {surface.id}</th>
          <td>{surface.areaM2.toFixed(2)}</td><td>{(surface.sunlitFraction*100).toFixed(1)}%</td>
          <td>{surface.beamWm2.toFixed(2)}</td><td>{surface.skyDiffuseWm2.toFixed(2)}</td><td>{surface.groundReflectedWm2.toFixed(2)}</td><td>{surface.incidentWm2.toFixed(2)}</td>
          <td>{output.shgc!==null&&surface.type==='window'
            ?(surface.incidentWm2*surface.areaM2*output.shgc).toFixed(2):'Not evaluated'}</td>
        </tr>))}</tbody></table></div>
        <p>Shared glazing SHGC: {output.shgc??'Unknown — no gain inferred'}; {output.shgcSource}. SHGC is not VLT; constant-SHGC screening has no angular/frame model, lux or temperature claim.</p>
        <p><strong>Legacy method limitation:</strong> each supplied floor is evaluated independently by surfaceExposure; other-storey mutual shade and full-side neighbour screens are not supplied to this snapshot.
          Diffuse/ground components assume unobstructed hemispheres; urban sky occlusion, multiple reflections and shaded ground are not solved.</p>
        <p>Rows retain incumbent exterior receiver semantics, including ground and authored obstacle faces when supplied; these are not extra house glazing or a summed building energy balance.</p>
        {[...new Set(output.floors.flatMap(floor=>floor.exposure.warnings))].map(text=><p key={text}>{text}</p>)}
      </>}
    </section>
  }
export function HouseSunResults({result}:{result:HouseSunResult}) {
  const [index,setIndex]=useState(result.trend.length-1)
  const bounded=Math.min(index,result.trend.length-1),point=result.trend[bounded],output=result.output
  const local=(instant:string|null)=>instant?new Intl.DateTimeFormat('en-GB',{timeZone:result.snapshot.config.timeZone,
    dateStyle:'medium',timeStyle:'short'}).format(new Date(instant)):'None'
  const name=(floorId:string)=>result.snapshot.project.floors.find(floor=>floor.id===floorId)?.name??floorId
  const label=(row:HouseSunResult['groups'][number])=>`${name(row.floorId)} — ${row.type==='roof'?'Exposed roof / terrace':`${row.bearing!.toFixed(1)}°-facing exterior wall`}`
  const colors=['#0969da','#15803d','#7e22ce','#b45309','#c0266a','#0891b2']
  const start=Date.parse(result.trend[0].endUTC)-300000,end=Date.parse(result.trend.at(-1)!.endUTC)
  return <div>
    <p role="status">Calculated direct sunlight on {result.snapshot.project.floors.length} actual modeled floor(s) for {result.snapshot.config.date};
      {' '}{output.elapsedHours.toFixed(3)} elapsed UTC hours, {output.sampling.intervalCount} intervals.
      Sun above 1° cutoff: {(output.aboveHorizonHours-output.nearHorizonExcludedHours).toFixed(3)} h; near-horizon excluded: {output.nearHorizonExcludedHours.toFixed(3)} h.</p>
    {result.snapshot.surroundings&&<p>Obstruction source: saved Site → Environment, workspace {result.snapshot.surroundings.projectId},
      applied version {result.snapshot.surroundings.version}; {result.snapshot.surroundings.count} authored objects. No additional full-side neighbour screens.
      Across-road and negative-coordinate objects remain ray casters.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="House sunlight hours by actual modeled surface"><table><thead><tr>
      <th>Surface</th><th>Area m²</th><th>Average direct sun h</th><th>Point range h</th><th>Orientation opportunity h</th><th>Lost to shade h</th><th>First / last sampled sun</th>
    </tr></thead><tbody>{result.groups.map((row,index)=><tr key={`${row.floorId}-${row.type}-${row.bearing}`}>
      <th scope="row"><span style={{color:colors[index%colors.length]}}>●</span> {label(row)}</th><td>{row.areaM2.toFixed(2)}</td><td>{row.averageHours.toFixed(3)}</td>
      <td>{row.minHours.toFixed(3)} – {row.maxHours.toFixed(3)}</td><td>{row.unobstructedHours.toFixed(3)}</td><td>{row.blockedHours.toFixed(3)}</td>
      <td>{local(row.firstSunUTC)} / {local(row.lastSunUTC)}</td>
    </tr>)}</tbody></table></div>
    <p>Hours are area/transmission-weighted direct-beam-equivalent hours, not measured sunshine. Opaque wall faces exclude openings.
      Opportunity is the same surface without obstructions, not a whole-day sun allowance for every wall. First/last interval bounds may contain shaded gaps.</p>
    <h4>House direct-sun time trend</h4>
    <svg viewBox="0 0 850 390" className="solar-chart" role="img" aria-label="Accumulated house direct sunlight hours by surface through the selected civil day">
      <title>Cumulative area-weighted direct sun hours from actual 5-minute midpoint calculations</title>
      {[0,.25,.5,.75,1].map(f=><g key={f}><line x1="65" x2="815" y1={330-f*280} y2={330-f*280} stroke="#d0d7de"/>
        <text x="58" y={334-f*280} textAnchor="end" fontSize="14">{(output.elapsedHours*f).toFixed(1)} h</text>
        <text x={65+750*f} y="365" textAnchor="middle" fontSize="14">{(output.elapsedHours*f).toFixed(1)} h UTC elapsed</text></g>)}
      {result.groups.map((row,index)=><polyline key={`${row.floorId}-${row.type}-${row.bearing}`} fill="none" stroke={colors[index%colors.length]} strokeWidth="2"
        points={result.trend.map(p=>{
          const value=p.groups.find(group=>group.floorId===row.floorId&&group.type===row.type&&group.bearing===row.bearing)?.averageHours??0
          return `${65+(Date.parse(p.endUTC)-start)/(end-start)*750},${330-value/output.elapsedHours*280}`
        }).join(' ')}><title>{label(row)}</title></polyline>)}
      {point&&<line x1={65+(Date.parse(point.endUTC)-start)/(end-start)*750} x2={65+(Date.parse(point.endUTC)-start)/(end-start)*750} y1="40" y2="330" stroke="#475569" strokeDasharray="4 4"/>}
    </svg>
    <label>House study time preview — accumulated hours through this interval<input type="range" min="0" max={result.trend.length-1} step="1" value={bounded}
      onChange={event=>setIndex(Number(event.target.value))} aria-label="House direct sun time trend"/></label>
    {point&&<><p>{local(point.endUTC)} ({point.endUTC}). Result-only preview; no rerun or invented instantaneous shade.</p>
      <ul>{point.groups.map(row=><li key={`${row.floorId}-${row.type}-${row.bearing}`}>{label(row)}: {row.averageHours.toFixed(3)} cumulative direct sun h;
        {' '}{row.blockedHours.toFixed(3)} cumulative shade-loss h.</li>)}</ul></>}
    <details><summary>Geometry method and limitations</summary><p>Incumbent HomeSun / SunCalc 2.0.1 + BuildingPhysics.createSunlightStudy.
      Interim client-side numerical ownership reuses the existing verified geometry kernel; this is not a new Python geometry solver.
      {output.sampling.samplesPerAxis}-axis area-weighted midpoint rays, {output.sampling.sampleCount} surface points; 5-minute UTC midpoint intervals and 1° cutoff.</p>
      {[...new Set([...output.assumptions,...output.warnings])].map(text=><p key={text}>{text}</p>)}</details>
    <p>Sun hours are not W/m², energy, PV yield, indoor lux or certified solar performance. The separate shared-weather snapshot below requires its own radiation evidence.</p>
  </div>
}
export function HouseSunStudy({planner,record,date,blocked=false}:{planner?:PlannerApi|null;record:WorkspaceRecord;date:string;blocked?:boolean}) {
  const [neighbours,setNeighbours]=useState(()=>savedNeighbours(planner)),[source,setSource]=useState<'design'|'native'>('native')
  const [obstructionSource,setObstructionSource]=useState<'site'|'legacy'>('site')
  const [registration,setRegistration]=useState({x:'',y:'',base:'',acknowledged:false})
  const [reviewed,setReviewed]=useState(false),[result,setResult]=useState<HouseSunResult|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[tick,setTick]=useState(0)
  const generation=useRef(0),runtime=useRef<HouseRuntime|null>(null),observed=useRef('')
  const projectId=useRef(planner?.getProject().id)
  const latest=useRef({planner,record,date,blocked,source,neighbours,obstructionSource,registration})
  latest.current={planner,record,date,blocked,source,neighbours,obstructionSource,registration}
  function invalidate(){generation.current++;setResult(null);setBusy(false)}
  const project=planner?.getProject(),raw=planner?.getScenes()??[]
  const linkedRegistration=project?linkedSiteRegistration(project,record):null
  const siteInputKey=JSON.stringify(record.document.site)
  function config():HouseSunConfig {
    const state=latest.current,site=state.source==='design'?state.planner?.getProject().site:state.record.document.site
    const latitude=site?.latitude,longitude=site?.longitude,timeZone=state.source==='design'?state.planner?.getProject().site.timeZone:state.record.document.site.time_zone
    if(typeof latitude!=='number'||typeof longitude!=='number'||typeof timeZone!=='string')throw new Error('Supply the explicitly selected source’s latitude, longitude and IANA zone before calculating house sun.')
    return {date:state.date,latitude,longitude,timeZone,time:'12:00',occurrence:'earlier'}
  }
  function snapshotKey():string {
    const state=latest.current
    if(!state.planner||!runtime.current)return ''
    return houseSnapshot(state.planner,runtime.current,config(),neighboursInput(state.neighbours),environment()).key
  }
  function environment(){
    const state=latest.current
    if(state.obstructionSource!=='site')return undefined
    const linked=state.planner?linkedSiteRegistration(state.planner.getProject(),state.record):null
    if(linked)return {record:state.record,registration:linked}
    if(state.planner?.getProject().nativeSiteSource)
      throw new Error('Generated Design Site link no longer matches the applied Site fingerprint/account. Review/apply Site in Design before studying its surroundings; stale registration is not reused.')
    if([state.registration.x,state.registration.y,state.registration.base].some(value=>value.trim()===''))
      throw new Error('Supply the Site gross NW x/y and vertical datum offset in metres; blank registration stays unknown.')
    return {record:state.record,registration:{grossNorthWestX:Number(state.registration.x),grossNorthWestY:Number(state.registration.y),
      baseOffsetM:Number(state.registration.base),acknowledged:state.registration.acknowledged}}
  }
  useEffect(()=>{
    invalidate();setReviewed(false);setNeighbours(savedNeighbours(planner));observed.current=''
    projectId.current=planner?.getProject().id
    return planner?.subscribe(()=>{
      setTick(value=>value+1)
      if(planner.getProject().id!==projectId.current){
        projectId.current=planner.getProject().id;setNeighbours(savedNeighbours(planner));setReviewed(false);setRegistration({x:'',y:'',base:'',acknowledged:false});invalidate();observed.current='';return
      }
      try {
        const key=snapshotKey()
        if(key!==observed.current){observed.current=key;setReviewed(false);invalidate()}
      }catch{invalidate()}
    })
  },[planner])
  useEffect(()=>{invalidate();observed.current=''},[date,source,neighbours,record.project_id,record.version,blocked,registration,obstructionSource,siteInputKey])
  useEffect(()=>{setReviewed(false);setRegistration(current=>({...current,acknowledged:false}))},[record.project_id,record.version,planner,siteInputKey])
  useEffect(()=>()=>{generation.current++},[])
  async function run(event:FormEvent){
    event.preventDefault()
    if(!planner||blocked||busy||!reviewed)return
    const token=++generation.current
    setBusy(true);setResult(null);setError('')
    try {
      runtime.current=await loadHouseRuntime()
      if(token!==generation.current)return
      const snapshot=houseSnapshot(planner,runtime.current,config(),neighboursInput(neighbours),environment())
      observed.current=snapshot.key
      const calculated=await calculateHouseSun(snapshot,runtime.current,{current:()=>token===generation.current&&!latest.current.blocked
        &&latest.current.planner===planner&&snapshotKey()===snapshot.key})
      if(token===generation.current)setResult(calculated)
    }catch(problem){if(token===generation.current)setError(errorMessage(problem))}
    finally{if(token===generation.current)setBusy(false)}
  }
  function change(side:HouseSide,key:keyof NeighbourDraft[HouseSide],value:string){
    invalidate();setError('');setNeighbours(current=>({...current,[side]:{...current[side],[key]:value}}))
  }
  const selectedSite=source==='design'?project?.site:record.document.site
  return <section aria-label="Whole house direct sunlight and shading" data-geometry-update={tick}>
    <h3>Direct sunlight on your actual house</h3>
    <p>Uses the imported schema-1 Design working copy’s actual raw floor scenes — no envelope or sample house.
      Its net plot, building placement, true-north heading, walls/openings and storey elevations stay authoritative.
      This explicit study does not write geometry, neighbour drafts, saved legacy studies or account storage.</p>
    {!planner&&<p role="status">Open the actual project JSON in Design first. A native Site envelope is not a substitute for a house layout.</p>}
    {project&&<><p>Design: {project.name??project.id}, revision {project.revision}; {project.floors.length} modeled floor(s).
      Native account workspace: {record.project_id}, revision {record.version}. These are independent snapshots, not silently synchronized.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="House modeled geometry and explicit heights"><table><thead><tr>
        <th>Floor</th><th>Actual net plot</th><th>Building dimensions / offsets m</th><th>Heading</th><th>Base / wall / roof thickness m</th>
      </tr></thead><tbody>{raw.map(scene=>{
        const plot=scene.plot as Record<string,unknown>|null,building=scene.building as Record<string,unknown>|null
        return <tr key={scene.floorId}><th scope="row">{project.floors.find(floor=>floor.id===scene.floorId)?.name??scene.floorId}</th>
          <td>{plot?`${plot.w} × ${plot.h} m; origin (${plot.x}, ${plot.y})`:'Unknown — required'}</td>
          <td>{building?`${building.w} × ${building.h}; (${building.x}, ${building.y})`:'Unknown — required'}</td><td>{String(scene.headingDeg??'Unknown')}°</td>
          <td>{String(scene.floorElevationM??'Unknown')} / {String(scene.wallHeightM??'Unknown')} / {String(scene.roofThicknessM??'Unknown')}</td></tr>
      })}</tbody></table></div>
      {raw.length!==project.floors.length&&<p role="status">Missing modeled floor geometry. Every actual floor must compile before a whole-house study.</p>}
      {raw.some(scene=>(scene.regulatory as Record<string,unknown>|null)?.nonCompliantSetbacks)&&<p role="status">NON-COMPLIANT SETBACK SCENARIO: sunlight is not permission or safety approval.</p>}
    </>}
    <form onSubmit={run}><fieldset disabled={!planner||blocked}><legend>Explicit house sunlight inputs</legend>
      <label>House study location source<select value={source} onChange={event=>{invalidate();setReviewed(false);setSource(event.target.value as typeof source)}}>
        <option value="native">Saved Site location (default)</option><option value="design">Imported Design project location (explicit alternative)</option>
      </select></label>
      <p>Civil date: {date||'Unknown — choose Solar civil date'}. Location: {String(selectedSite?.latitude??'unknown')}, {String(selectedSite?.longitude??'unknown')};
        {' '}{String(source==='design'?project?.site.timeZone??'unknown':record.document.site.time_zone??'unknown')}.
        Changing location does not change the Design geometry’s coordinate frame or plot origin; prepareScenes applies its own plot translation exactly once.</p>
      <label>House obstruction source<select value={obstructionSource} onChange={event=>{invalidate();setReviewed(false);setObstructionSource(event.target.value as typeof obstructionSource)}}>
        <option value="site">Saved Site → Environment buildings & trees (default)</option>
        <option value="legacy">Legacy Design obstacles & full-side neighbour screens (explicit alternative)</option>
      </select></label>
      {obstructionSource==='site'?<>
        <p>Using {record.document.site.obstacles?.length??0} applied Site Environment objects, version {record.version}, with gross NW origin, x east/y south in metres.
          Negative locations and objects across roads are included; no extra neighbour screen is added. Imported Design obstacles are replaced only in this derived study to avoid double counting.</p>
        <p>Gross Site: {String(record.document.site.width??'unknown')} × {String(record.document.site.depth??'unknown')} {record.document.site.units}.
          Design net-plot-local origin is the prepared plot corner (0,0), not necessarily geographic NW; its local axes rotate with the supplied heading. Register the geographic gross Site NW and base datum explicitly; gross and net origins need not coincide.
          Matching extents are checked, but matching dimensions alone do not establish surveyed alignment.</p>
        {linkedRegistration?<p role="status">Registered automatically from matching generated/applied Site source: gross NW ({linkedRegistration.grossNorthWestX}, {linkedRegistration.grossNorthWestY}) m,
          base offset {linkedRegistration.baseOffsetM} m. Account identity and stored Site fingerprint match; road widening and cardinal rotation are retained. No manual origin entry required.</p>:
        project?.nativeSiteSource?<p role="status">Generated Design linkage differs from the current applied Site. Use Design → Review/apply Site to update the reversible link; this study will not reuse stale registration or resize your rooms.</p>:<>
        <div className="native-fields">
          {([['x','Site gross NW in Design net-plot-local x (m)'],['y','Site gross NW in Design net-plot-local y (m)'],['base','Site base datum offset into Design ground (m)']] as const).map(([key,label])=><label key={key}>{label}
            <input type="number" step="any" value={registration[key]} onChange={event=>{invalidate();setRegistration(current=>({...current,[key]:event.target.value,acknowledged:false}))}}/></label>)}
        </div>
        <label><input type="checkbox" checked={registration.acknowledged} onChange={event=>{invalidate();setRegistration(current=>({...current,acknowledged:event.target.checked}))}}/>
          I registered these coordinate origins/datum and confirm only authored Site objects are modeled; empty surroundings are not surveyed clear space.</label>
        </>}
        {linkedRegistration&&<p>Only authored saved Site objects are modeled; empty surroundings do not establish surveyed clear space. The reviewed-input acknowledgement below also confirms this coverage limitation.</p>}
        <p>Exact rectangular-prism registration currently requires cardinal Design headings. Noncardinal Site-object rotations are rejected, not replaced with oversized boxes.
          Trees use supplied canopy bounding prisms and constant transmission, not species/growth/seasonal foliage.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Saved Site Environment objects for sunlight"><table><thead><tr><th>Object</th><th>Gross Site x/y m</th><th>Width/depth m</th><th>Height/base m</th><th>Transmission</th></tr></thead>
          <tbody>{(record.document.site.obstacles??[]).map(object=><tr key={object.id}><th scope="row">{object.name} ({object.kind})</th>
            <td>{object.x} / {object.y}</td><td>{object.width_m} / {object.depth_m}</td><td>{object.height_m??'Unknown'} / {object.base_m??'Unknown'}</td><td>{object.transmission??'Unknown'}</td></tr>)}</tbody></table></div>
        {(record.document.site.obstacles??[]).some(object=>object.height_m===null||object.base_m===null||object.transmission===null)&&
          <p role="status">Unknown object height/base/transmission blocks house hours. Complete those authored fields in Site → Environment; unknown values are never assumed.</p>}
      </>:<>
      <p>Neighbours are frontage-relative, conservative full-side opaque screens on the Design net plot boundary. Enter boundary gap including roads, not distance from the building.
        Unknown sides do not mean clear. Imported saved neighbour values are copied as study drafts; changes remain session-only.</p>
      <div className="native-fields">{houseSides.map((side,index)=><div key={side}>
        <label>{side} neighbour ({typeof raw[0]?.headingDeg==='number'?`${(raw[0].headingDeg+index*90)%360}°`:'unknown heading'})
          <select value={neighbours[side].state} onChange={event=>change(side,'state',event.target.value)} aria-label={`${side} neighbour state`}>
            <option value="unknown">Unknown</option><option value="clear">Clear / no block</option><option value="block">Neighbour block</option>
          </select></label>
        <label>{side} block height m<input type="number" min=".001" step="any" value={neighbours[side].height} disabled={neighbours[side].state!=='block'} onChange={event=>change(side,'height',event.target.value)}/></label>
        <label>{side} net-plot boundary gap m<input type="number" min="0" step="any" value={neighbours[side].gap} disabled={neighbours[side].state!=='block'} onChange={event=>change(side,'gap',event.target.value)}/></label>
      </div>)}</div>
      </>}
      <label><input type="checkbox" checked={reviewed} onChange={event=>{invalidate();setReviewed(event.target.checked)}}/> I reviewed the selected location, actual modeled storeys and supplied heights/roof thickness.
        Imported defaults are scenario assumptions, not measured or verified site dimensions.</label>
      <p>5-minute UTC midpoints, 8-axis surface sampling, 1° low-sun cutoff; up to 12 floors / 500 walls and a 30-second cooperative budget. Refine the original study for sampling convergence; no automatic calculation.</p>
      <button className="primary" disabled={busy||!reviewed||!date}>{busy?'Calculating actual house sunlight…':'Calculate house direct sun hours'}</button>{' '}
      <button type="button" onClick={()=>{invalidate();setError('')}}>Clear house result / cancel</button>
    </fieldset></form>
    {error&&<p className="error" role="alert">{error}</p>}
    {result&&<><HouseSunResults key={result.snapshot.key} result={result}/>
      {planner&&runtime.current&&<HouseIrradiance key={result.snapshot.key} result={result} planner={planner} runtime={runtime.current}/>}</>}
    {!result&&<p>Irradiance is not calculated without explicit interval weather and albedo. This section calculates geometric direct-sun hours and shade loss, not irradiance.</p>}
  </section>
}
