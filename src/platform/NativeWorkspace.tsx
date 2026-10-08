import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, errorMessage } from './api'
import { nativeApi, parseWorkspace, rect, type Costs, type Evaluation, type EvaluationPart, type Site, type WorkspaceRecord } from './native-api'
import { SurroundingsCanvas } from './SurroundingsCanvas'
import { PlotInputs, plotNumericKeys, convertLengthDraft } from './PlotInputs'
import { Utilization } from './Utilization'
import { CostResults } from './CostResults'
import { SolarStudy, emptySolarDraft, type SolarDraft } from './SolarStudy'
import { CostInputs, costDraft, costCommand, normalizeCostDraft } from './CostInputs'
import { MaterialsStudy, materialsDraft, materialsDirty, type MaterialsDraft } from './MaterialsStudy'
import type { MaterialsDocument } from './materials-api'
import './materials-study.css'
import { WindStudy, emptyWindDraft, type WindDraft } from './WindStudy'
import './wind-study.css'
import type { PlannerApi } from '../domain/project/planner-api'
import { sharedMaterialsCommand, sharedWeatherCommand } from './shared-environment'
import type { SolarResult } from './solar-api'

type Draft = Record<string, string>
export type NativeDraftCache = Map<string, {record: WorkspaceRecord; site: Draft; costs: Draft; solar?:SolarDraft; materials?:MaterialsDraft; wind?:WindDraft}>
export type AppliedWorkspaceState={record:WorkspaceRecord|null;evaluation:Evaluation|null;blocked:boolean}
const siteNumbers = plotNumericKeys
function draft(value: Site | Costs): Draft {
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['roads','road_units','obstacles'].includes(key)).map(([key,value])=>[key,value===null?'':String(value)]))
}
function siteDraft(site: Site): Draft {
  return {...draft(site),
    ...Object.fromEntries(Object.entries(site.roads).map(([key,value])=>['road'+key,value===null?'':String(value/(site.road_units[key as keyof Site['roads']]==='ft'?.3048:1))])),
    ...Object.fromEntries(Object.entries(site.road_units).map(([key,value])=>['roadUnit'+key,value]))}
}
function number(value: string): number | null {
  if(value.trim()==='') return null
  if(!Number.isFinite(Number(value))) throw new Error('Enter finite numbers, or leave unknown values blank.')
  return Number(value)
}
function dirtyKeys(value: Draft, base: Draft) { return Object.keys(value).filter(key=>value[key]!==base[key]) }
function reconcile(value: Draft, before: Draft, after: Draft, applied: string[]) {
  return {...after,...Object.fromEntries(dirtyKeys(value,before).filter(key=>!applied.includes(key)).map(key=>[key,value[key]]))}
}
function Findings({value}: {value: EvaluationPart | undefined}) {
  if(!value) return <p role="status">Waiting for the applied Python evaluation.</p>
  const numbers = Object.entries(value).filter((entry): entry is [string,number] => typeof entry[1]==='number')
  return <div>
    <p><strong>{value.status === 'computed' ? 'Computed scenario — not approval' : value.status}</strong></p>
    {value.non_compliant===true&&<p role="status" className="error">Non-compliant custom setbacks are active. This scenario is not permission to construct.</p>}
    <dl className="native-results">{numbers.map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{value.toLocaleString(undefined,{maximumFractionDigits:2})}</dd></div>)}</dl>
    {value.lines_inr !== null && typeof value.lines_inr==='object' && <dl className="native-results">{Object.entries(value.lines_inr).map(([label,amount])=><div key={label}><dt>{label}</dt><dd>{typeof amount==='number'?amount.toLocaleString('en-IN',{style:'currency',currency:'INR'}):'unknown'}</dd></div>)}</dl>}
    {value.messages.map((message,index)=><p key={index}>{message}</p>)}
  </div>
}

export function NativeWorkspace({id,csrf,workspace,study,cache,planner,onAppliedChange,onSolarResultChange}: {
  id:string;csrf:string;workspace:string;study:string;cache:NativeDraftCache;planner?:PlannerApi|null
  onAppliedChange?:(state:AppliedWorkspaceState)=>void
  onSolarResultChange?:(result:SolarResult|null)=>void
}) {
  const [record,setRecord] = useState<WorkspaceRecord|null>(null)
  const [site,setSite] = useState<Draft>({})
  const [costState,setCostState] = useState<Draft>({})
  const costs=normalizeCostDraft(costState)
  function setCosts(next:Draft|((previous:Draft)=>Draft)) {
    setCostState(previous=>typeof next==='function'?next(normalizeCostDraft(previous)):next)
  }
  const [solar,setSolar] = useState<SolarDraft>(()=>cache.get(id)?.solar??{...emptySolarDraft})
  const [wind,setWind] = useState<WindDraft>(()=>cache.get(id)?.wind??{...emptyWindDraft,months:[]})
  const [materials,setMaterials] = useState<MaterialsDraft>(()=>cache.get(id)?.materials??materialsDraft())
  const [section,setSection] = useState('Plot & Feasibility')
  const [options,setOptions] = useState<Awaited<ReturnType<typeof nativeApi.options>>|null>(null)
  const [evaluation,setEvaluation] = useState<Evaluation|null>(null)
  const [weather,setWeather] = useState<Record<string,unknown>|null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [status,setStatus] = useState('Loading native workspace...')
  const [sharedStatus,setSharedStatus] = useState('')
  const [conflict,setConflict] = useState(false)
  const [locating,setLocating] = useState(false)
  const generation = useRef(0), locationGeneration=useRef(0)
  const current = useRef(record);current.current=record
  const currentPlanner=useRef(planner);currentPlanner.current=planner
  const weatherGeneration = useRef(0)
  const lock = useRef(false)
  const draftState = useRef({record,site,costs,solar,materials,wind});draftState.current={record,site,costs,solar,materials,wind}
  useEffect(()=>{
    let active=true
    Promise.all([nativeApi.get(id),nativeApi.options()]).then(([next,choices])=>{
      if(!active)return
      const retained=cache.get(id)
      if(retained) {
        setRecord(parseWorkspace(retained.record));setSite(retained.site);setCosts(retained.costs)
        setMaterials(retained.materials??materialsDraft(next.document.materials))
        if(retained.record.version!==next.version){setConflict(true);setError('Saved workspace changed while away. Reload and review retained drafts.')}
      } else {setRecord(next);setSite(siteDraft(next.document.site));setCosts(costDraft(next.document.costs));setMaterials(materialsDraft(next.document.materials))}
      setOptions(choices)
      setStatus(`Saved workspace revision ${next.version}`)
    }).catch(failure=>{if(active){setError(errorMessage(failure));setStatus('Workspace could not be loaded.')}})
    return ()=>{
      active=false;generation.current++;locationGeneration.current++;weatherGeneration.current++
      const state=draftState.current
      if(state.record)cache.set(id,{record:state.record,site:state.site,costs:state.costs,solar:state.solar,materials:state.materials,wind:state.wind})
    }
  },[id,cache])
  useEffect(()=>{
    if(!record)return
    const token=++generation.current
    setEvaluation(null);setWeather(null);weatherGeneration.current++
    nativeApi.evaluate(id).then(result=>{
      if(token!==generation.current)return
      if(result.project_id!==id||result.version!==record.version) {setError('Site changed during evaluation. Reload before evaluating again.');setConflict(true);return}
      setEvaluation(result)
    }).catch(failure=>{if(token===generation.current)setError(errorMessage(failure))})
    return ()=>{generation.current++}
  },[id,record])
  const hasSiteDraft = record ? dirtyKeys(site,siteDraft(record.document.site)).length>0 : false
  const hasCostDraft = record ? dirtyKeys(costs,costDraft(record.document.costs)).length>0 : false
  const hasMaterialsDraft = record ? materialsDirty(materials,record.document.materials) : false
  const hasDraft = hasSiteDraft||hasCostDraft||hasMaterialsDraft
  useEffect(()=>{
    onAppliedChange?.({record,evaluation:evaluation?.version===record?.version?evaluation:null,
      blocked:busy||conflict||hasSiteDraft||!record})
  },[record,evaluation,busy,conflict,hasSiteDraft,onAppliedChange])
  useEffect(()=>{
    if(!hasDraft)return
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return ()=>window.removeEventListener('beforeunload',warn)
  },[hasDraft])
  async function commit(action:'site'|'costs'|'materials'|'undo'|'redo',value:Partial<Site>|Costs|MaterialsDocument|null,applied:string[]=[]):Promise<WorkspaceRecord|null> {
    if(!record||lock.current||conflict)return null
    lock.current=true;setBusy(true);setError('')
    const before=record
    const submittedMaterials=materials
    try {
      const next=await nativeApi.command(before,action,value,csrf)
      setRecord(next)
      setSite(previous=>reconcile(previous,siteDraft(before.document.site),siteDraft(next.document.site),action==='site'?applied:[]))
      setCosts(previous=>reconcile(previous,costDraft(before.document.costs),costDraft(next.document.costs),action==='costs'?Object.keys(costs):[]))
      setMaterials(previous=>(action==='materials'&&previous===submittedMaterials)||!materialsDirty(previous,before.document.materials)
        ?materialsDraft(next.document.materials):previous)
      setStatus(`Saved workspace revision ${next.version}`);return next
    } catch(failure) {
      setError(errorMessage(failure));setStatus('Not saved; draft retained')
      if(failure instanceof ApiError&&failure.status===409)setConflict(true)
      return null
    } finally {lock.current=false;setBusy(false)}
  }
  async function reload() {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {
      const next=await nativeApi.get(id)
      setRecord(next)
      if(record) {
        setSite(previous=>reconcile(previous,siteDraft(record.document.site),siteDraft(next.document.site),[]))
        setCosts(previous=>reconcile(previous,costDraft(record.document.costs),costDraft(next.document.costs),[]))
        setMaterials(previous=>materialsDirty(previous,record.document.materials)?previous:materialsDraft(next.document.materials))
      } else {setSite(siteDraft(next.document.site));setCosts(costDraft(next.document.costs));setMaterials(materialsDraft(next.document.materials))}
      setOptions(await nativeApi.options());setConflict(false);setStatus('Server reloaded. Review retained drafts before Apply.')
    } catch(failure){setError(errorMessage(failure))}
    finally{lock.current=false;setBusy(false)}
  }
  function change(key:string,value:string) {
    setSite(previous=>({...previous,[key]:value}))
    if(key==='latitude'||key==='longitude') {
      locationGeneration.current++;setLocating(false);weatherGeneration.current++;setWeather(null)
      setSite(previous=>({...previous,location_source:'manual',location_accuracy_m:''}))
    }
  }
  async function applyPlot(event:FormEvent) {
    event.preventDefault()
    try {
      const numeric=Object.fromEntries(siteNumbers.map(key=>[key,number(site[key])]))
      const value = {
        ...numeric,units:site.units,facing:site.facing,category:site.category,use:site.use,
        stilt:site.stilt==='true',tdr:site.tdr==='true',compounding:site.compounding==='true',custom_setbacks:site.custom_setbacks==='true',
        roads:Object.fromEntries(['N','E','S','W'].map(edge=>{
          const width=number(site['road'+edge]);return [edge,width===null?null:width*(site['roadUnit'+edge]==='ft'?.3048:1)]
        })),
        road_units:Object.fromEntries(['N','E','S','W'].map(edge=>[edge,site['roadUnit'+edge]])),
        location_source:site.location_source,location_accuracy_m:number(site.location_accuracy_m),
      } as Partial<Site>
      await commit('site',value,[...siteNumbers,'units','facing','category','use','stilt','tdr','compounding','custom_setbacks',
        'roadN','roadE','roadS','roadW','roadUnitN','roadUnitE','roadUnitS','roadUnitW','location_source','location_accuracy_m'])
    } catch(failure){setError(errorMessage(failure))}
  }
  function changeUnits(key:string,unit:string) {
    try {
      const keys=key==='units'?['width','depth']:['road'+key.slice(-1)]
      const converted=Object.fromEntries(keys.map(field=>[field,convertLengthDraft(site[field],site[key],unit)]))
      setSite(previous=>({...previous,...converted,[key]:unit}))
    } catch(failure){setError(errorMessage(failure))}
  }
  function detect() {
    if(!navigator.geolocation){setError('Device geolocation is unavailable. Enter coordinates manually.');return}
    const token=++locationGeneration.current
    setLocating(true);setError('')
    navigator.geolocation.getCurrentPosition(position=>{
      if(token!==locationGeneration.current)return
      setSite(previous=>({...previous,latitude:String(position.coords.latitude),longitude:String(position.coords.longitude),
        location_source:'device',location_accuracy_m:String(position.coords.accuracy)}))
      weatherGeneration.current++;setWeather(null);setLocating(false);setStatus('Device coordinates are a draft; Apply plot inputs to save.')
    },failure=>{if(token===locationGeneration.current){setError(failure.message);setLocating(false)}},{timeout:15000,maximumAge:0})
  }
  async function fetchWeather() {
    if(!record||busy)return
    const token=++weatherGeneration.current
    setBusy(true);setError('');setWeather(null)
    try {
      const result=await nativeApi.weather(record,csrf)
      if(token===weatherGeneration.current&&current.current?.version===record.version)setWeather(result)
    } catch(failure){if(token===weatherGeneration.current)setError(errorMessage(failure))}
    finally {setBusy(false)}
  }
  async function shareEnvironment(kind:'materials'|'weather') {
    if(!planner||!record||busy||conflict)return
    setBusy(true);setError('');setSharedStatus('')
    const owner=planner,revision=record.version,submittedWind=wind
    try {
      const command=kind==='materials'?sharedMaterialsCommand(record.document.materials):
        await sharedWeatherCommand(owner,wind.format,wind.text)
      if(currentPlanner.current!==owner||current.current?.version!==revision||
        (kind==='weather'&&draftState.current.wind!==submittedWind))
        throw new Error('Shared inputs changed while preparing. Nothing was applied; review and try again.')
      owner.execute(command)
      setSharedStatus(`${kind==='materials'?'Saved materials':'Imported weather'} applied to the shared Design and studies. One Design Undo reverses it; Save Design makes it durable.`)
    } catch(failure){setError(errorMessage(failure))}
    finally{setBusy(false)}
  }
  const visible=workspace==='Site'||workspace==='Analyze'&&['Costs','Utilization','Solar','Materials','Wind & windows'].includes(study)
  const appliedEvaluation=evaluation?.version===record?.version&&evaluation?.project_id===id?evaluation:null
  const envelope=appliedEvaluation?rect(appliedEvaluation.feasibility.envelope):null
  function numericField(key:string,label:string) {
    return <label key={key}>{label}<input type="number" step="any" value={site[key]??''} onChange={e=>change(key,e.target.value)}/></label>
  }
  return <div hidden={!visible} className="native-workspace">
    <div className="actions">
      <span role="status">{status}{hasDraft?' · Unapplied drafts':''}</span>
      <button disabled={busy||hasDraft||conflict||!record?.can_undo} onClick={()=>commit('undo',null)}>Undo</button>
      <button disabled={busy||hasDraft||conflict||!record?.can_redo} onClick={()=>commit('redo',null)}>Redo</button>
      <button disabled={busy} onClick={reload}>Reload server; keep drafts</button>
      {hasDraft&&<button disabled={busy} onClick={()=>{if(record){setSite(siteDraft(record.document.site));setCosts(costDraft(record.document.costs));setMaterials(materialsDraft(record.document.materials))}}}>Discard unapplied drafts</button>}
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {sharedStatus&&<p role="status">{sharedStatus}</p>}
    {conflict&&<p>Saving is blocked until you reload the server version and review your retained draft.</p>}
    {hasDraft&&<p>Results and drawings below use the last <strong>applied</strong> revision, not these drafts. Apply or discard drafts before Undo/Redo.</p>}
    {workspace==='Site'&&<nav className="local-tabs" aria-label="Site sections">{['Plot & Feasibility','Environment','Regulatory sources'].map(item=><button key={item} aria-current={item===section?'page':undefined} onClick={()=>setSection(item)}>{item}</button>)}</nav>}
    {record&&<>
      <section hidden={workspace!=='Analyze'||study!=='Wind & windows'}>
        <button disabled={!planner||busy||conflict||!wind.text.trim()} onClick={()=>shareEnvironment('weather')}>Use imported weather in all Design studies</button>
        <p>Reuses this selected file without re-entry. Current model weather samples are not a time series.</p>
        <WindStudy record={record} csrf={csrf} draft={wind} onChange={setWind} blocked={busy||conflict||hasSiteDraft}/>
      </section>
      <section hidden={workspace!=='Analyze'||study!=='Materials'}>
        <button disabled={!planner||busy||conflict||hasMaterialsDraft} onClick={()=>shareEnvironment('materials')}>Use saved Materials in all Design studies</button>
        <MaterialsStudy record={record} csrf={csrf} draft={materials} onChange={setMaterials}
          onCommit={value=>commit('materials',value)} blocked={busy||conflict}/>
      </section>
      <section hidden={workspace!=='Analyze'||study!=='Solar'}>
        <SolarStudy record={record} csrf={csrf} draft={solar} onChange={setSolar} blocked={busy||conflict||hasSiteDraft} planner={planner} onCurrentResultChange={onSolarResultChange}/>
      </section>
      <section hidden={workspace!=='Site'||section!=='Plot & Feasibility'}>
        <h2>Plot & Feasibility</h2>
        <p>GHMC / HMDA rectangular scenarios using retained GO 168 and GO 95 rules. Reference scenarios, not a sanctioned plan. Dimensions and location remain explicit; no room layout is generated or replaced.</p>
        <div className="plot-layout">
        <PlotInputs id={id} csrf={csrf} value={site} disabled={busy||conflict} locating={locating} onChange={change} onUnits={changeUnits} onSubmit={applyPlot} onDetect={detect}/>
        <div className="plot-output">
        <h2>Applied site plan</h2>
        {envelope&&<svg className="site-plan" viewBox={`-2 -3 ${(rect(appliedEvaluation?.feasibility.gross)?.width??0)+4} ${(rect(appliedEvaluation?.feasibility.gross)?.depth??0)+5}`} role="img" aria-label="Gross plot, net boundary and required setback envelope">
          <title>North-up rectangular site scenario; not a building layout</title>
          {(['gross','net','envelope'] as const).map((key,index)=>{
            const box=rect(appliedEvaluation?.feasibility[key]);return box&&<rect key={key} x={box.x} y={box.y} width={box.width} height={box.depth} fill={index===2?'#dbeafe':'none'} stroke={['#475569','#a16207','#2563eb'][index]} strokeWidth=".15"/>
          })}
          <text x={0} y={-1} fontSize="1">North ↑ · envelope, not a building</text>
        </svg>}
        <Findings value={appliedEvaluation?.feasibility}/>
        </div></div>
      </section>
      <section hidden={workspace!=='Site'||section!=='Environment'}>
        <h2>Environment</h2><p>Latitude, longitude and device detection are under Plot & Feasibility.</p>
        <form onSubmit={e=>{e.preventDefault();void commit('site',{weather_source:site.weather_source as Site['weather_source']},['weather_source'])}}>
          <fieldset disabled={busy||conflict}><legend>Time and weather source</legend><div className="native-fields">
            <p>Site time zone: <strong>{record.document.site.latitude===null||record.document.site.longitude===null
              ? 'Apply latitude and longitude to determine the time zone'
              : record.document.site.time_zone ? options?.time_zone_labels[record.document.site.time_zone]??record.document.site.time_zone : 'Unknown — apply plot inputs to resolve'}</strong></p>
            <label>Weather source<select aria-label="Weather source" value={site.weather_source} onChange={e=>{change('weather_source',e.target.value);weatherGeneration.current++;setWeather(null)}}><option value="location">From applied location (default)</option><option value="manual">Imported weather time series</option></select></label>
          </div><p>The time zone is determined offline from geographic boundaries when you apply plot coordinates. Existing saved zones remain unchanged until Apply. Offsets shown are current; studies use the IANA zone for their actual date, including daylight saving.</p><button>Apply weather settings</button></fieldset>
        </form>
        <p>Location weather is the default source, not automatic background access. Fetch sends only your applied coordinates to Open-Meteo. The current model sample is session-only, not measured or an annual weather dataset. Free endpoint use is non-commercial; provider terms apply. Imported legacy EPW/JSON data is untouched.</p>
        <button disabled={busy||hasSiteDraft||record.document.site.weather_source!=='location'||record.document.site.latitude===null||record.document.site.longitude===null}
          onClick={fetchWeather}>Fetch current weather — send saved coordinates to Open-Meteo</button>
        {weather&&<pre className="analysis-result">{JSON.stringify(weather,null,2)}</pre>}
        <p>Weather file: {wind.filename||'none selected in Analyze > Wind & windows'}. Imported records can be reused by all Design studies.</p>
        <button disabled={!planner||busy||conflict||!wind.text.trim()} onClick={()=>shareEnvironment('weather')}>Use imported weather in all Design studies</button>
        <SurroundingsCanvas site={record.document.site} envelope={envelope} busy={busy||conflict}
          onAdd={async object=>!!await commit('site',{obstacles:record.document.site.obstacles.some(item=>item.id===object.id)
            ?record.document.site.obstacles.map(item=>item.id===object.id?object:item)
            :[...record.document.site.obstacles,object]})}
          onRemove={objectId=>{void commit('site',{obstacles:record.document.site.obstacles.filter(object=>object.id!==objectId)})}}/>
      </section>
      <section hidden={workspace!=='Site'||section!=='Regulatory sources'}><h2>Regulatory sources</h2>
        <p>The native calculation preserves a bounded subset of the incumbent rules, not a complete current amendment review. Confirm category, land use, access, fire, parking, widening and approval with the competent authority.</p>
        <ul>{options?.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
      </section>
      <section hidden={workspace!=='Analyze'||study!=='Costs'}><h2>Costs</h2>
        <p>Supply rates explicitly. Blank is unknown; zero is intentional. Retained schedules reproduce legacy estimates, not a current fee demand or tax advice.</p>
        <CostInputs value={costs} disabled={busy||conflict}
          onChange={(key,value)=>setCosts(previous=>({...previous,[key]:value}))}
          onSubmit={e=>{e.preventDefault();try{void commit('costs',costCommand(costs,record.document.costs))}
            catch(failure){setError(errorMessage(failure))}}}/>
        <CostResults value={appliedEvaluation?.costs}/>
      </section>
      <section hidden={workspace!=='Analyze'||study!=='Utilization'}><h2>Utilization</h2>
        <form onSubmit={e=>{e.preventDefault();try{void commit('site',{split_edge:(site.split_edge||null) as Site['split_edge'],split_fraction:number(site.split_fraction)},['split_edge','split_fraction'])}catch(failure){setError(errorMessage(failure))}}}>
          <fieldset disabled={busy||conflict}><legend>Split scenario</legend><div className="native-fields">
            <label>Both halves front this road<select aria-label="Split road" value={site.split_edge} onChange={e=>change('split_edge',e.target.value)}><option value="">No split</option>{record.document.site.facing.split('').map(edge=><option key={edge} value={edge}>{edge} road</option>)}
              {site.split_edge&&!record.document.site.facing.includes(site.split_edge)&&<option value={site.split_edge}>{site.split_edge} road — no longer abutting; review</option>}
            </select></label>
            {numericField('split_fraction','First share of frontage (0.15–0.85)')}
          </div>
            <p>Fraction and road are drafts until Apply; the diagrams below always show the saved scenario. Both halves retain direct frontage. This does not split a project or edit rooms.</p>
            <button type="button" onClick={()=>change('split_fraction','0.5')}>Draft equal halves</button>{' '}
            <button>Apply split scenario</button></fieldset>
        </form>
        <Findings value={appliedEvaluation?.utilization}/><Utilization value={appliedEvaluation?.utilization}
          disabled={busy||conflict} onSplitDraft={fraction=>change('split_fraction',String(fraction))}/>
      </section>
    </>}
  </div>
}
