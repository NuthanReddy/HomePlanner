import React, { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from './api'
import type { WorkspaceRecord } from './native-api'
import { calculateWind, MAX_WEATHER_BYTES, type WindInputs, type WindResult } from './wind-api'

export type WindDraft={
  format:'epw'|'json';text:string;filename:string;calm_threshold_mps:string;months:number[]
  daytime:'all'|'day'|'night';day_start_hour:string;day_end_hour:string;clock:'source'|'site'
}
export const emptyWindDraft:WindDraft={
  format:'epw',text:'',filename:'',calm_threshold_mps:'0.5',months:[],daytime:'all',day_start_hour:'6',day_end_hour:'18',clock:'source',
}
export function windInputs(draft:WindDraft):WindInputs {
  const numeric=(value:string)=>{
    if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('Supply finite calm threshold and clock hours; blank is not zero.')
    return Number(value)
  }
  if(!draft.text.trim())throw new Error('Choose a nonempty EPW or supported JSON weather file first.')
  return {format:draft.format,text:draft.text,months:draft.months,daytime:draft.daytime,clock:draft.clock,
    calm_threshold_mps:numeric(draft.calm_threshold_mps),day_start_hour:numeric(draft.day_start_hour),
    day_end_hour:numeric(draft.day_end_hour)}
}
const directions=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
const quantity=(value:number|null,unit:string)=>value===null?'Unknown':`${value.toFixed(2)} ${unit}`
export function WindPlot({response}:{response:WindResult}) {
  const {rose,weather,preview}=response.result
  const percentage=(count:number)=>rose.total?100*count/rose.total:0
  const max=Math.max(1,...rose.bins.map(bin=>percentage(bin.count)))
  const polar=(bearing:number,radius:number)=>[160+Math.sin(bearing*Math.PI/180)*radius,160-Math.cos(bearing*Math.PI/180)*radius]
  const label=typeof weather.source.label==='string'?weather.source.label:'Source label not supplied'
  return <>
    <p role="status">{response.result.status==='empty-filter'?'No records match the selected clock/month filters.':
      response.result.status==='missing-wind'?'Selected records have no usable wind evidence. Missing data are not zero wind.':
      'Imported weather statistics calculated; not a window or ventilation study.'}</p>
    <dl className="native-results">
      <div><dt>Source / classification</dt><dd>{label} / {weather.kind}</dd></div>
      <div><dt>UTC coverage</dt><dd>{weather.coverage.startUTC} → {weather.coverage.endUTC}</dd></div>
      <div><dt>Imported / selected / excluded records</dt><dd>{weather.coverage.recordCount} / {rose.total} / {rose.excludedCount}</dd></div>
      <div><dt>Calm / unusable wind records</dt><dd>{rose.calmCount} / {rose.missingCount}</dd></div>
      <div><dt>Mean / maximum valid record speed</dt><dd>{quantity(rose.speedStatistics.meanSpeedMps,'m/s')} / {quantity(rose.speedStatistics.maxSpeedMps,'m/s')}</dd></div>
      <div><dt>Filter clock</dt><dd>{rose.timeBasis}; interval-end timestamps</dd></div>
    </dl>
    <p>{rose.speedStatistics.basis}. Calm: zero speed or speed below {rose.calmThresholdMps} m/s. Direction is not required for calm.</p>
    <div className="wind-evidence">
      <svg viewBox="0 0 320 320" role="img" aria-label="16-sector wind rose; FROM true north; percent of all selected records">
        <title>Wind FROM bearings, percent of all selected records including calm and missing in the denominator</title>
        {[.25,.5,.75,1].map(f=><g key={f}><circle cx="160" cy="160" r={110*f} fill="none" stroke="#d0d7de"/>
          <text x="166" y={160-110*f+12} fontSize="10">{(max*f).toFixed(1)}%</text></g>)}
        {rose.bins.map(bin=>{
          const radius=percentage(bin.count)/max*110
          const a=polar(bin.directionDeg-9,radius),b=polar(bin.directionDeg+9,radius)
          return bin.count>0?<path key={bin.directionDeg} d={`M160,160 L${a.join(',')} A${radius},${radius} 0 0 1 ${b.join(',')} Z`} fill="#0969da" opacity=".65"/>:null
        })}
        {directions.map((name,index)=>{const [x,y]=polar(index*22.5,140);return <text key={name} x={x} y={y+4} textAnchor="middle" fontSize="11">{name}</text>})}
      </svg>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Wind direction frequencies"><table>
        <thead><tr><th>FROM true north</th><th>Records</th><th>% selected records</th><th>Mean speed m/s</th></tr></thead>
        <tbody>{rose.bins.map((bin,index)=><tr key={bin.directionDeg}><th scope="row">{directions[index]} {bin.directionDeg}°</th>
          <td>{bin.count}</td><td>{rose.total?percentage(bin.count).toFixed(2):'Not evaluated'}</td><td>{quantity(bin.meanSpeedMps,'')}</td></tr>)}
          <tr><th scope="row">Calm</th><td>{rose.calmCount}</td><td>{rose.total?percentage(rose.calmCount).toFixed(2):'Not evaluated'}</td><td>—</td></tr>
          <tr><th scope="row">Unusable wind</th><td>{rose.missingCount}</td><td>{rose.total?percentage(rose.missingCount).toFixed(2):'Not evaluated'}</td><td>Unknown</td></tr>
        </tbody></table></div>
    </div>
    <p>{rose.frequencyBasis}. Day/night is a clock-hour filter, not astronomical daylight.</p>
    {weather.warnings.length>0&&<details open><summary>Weather quality and provenance warnings ({weather.warnings.length})</summary><ul>{weather.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
    <details><summary>Selected weather intervals: first {preview.length} of {response.result.selectedRecordCount}</summary>
      <p>{weather.timestampMeaning} No interpolation, resampling or TMY year remapping.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Imported weather interval preview"><table><thead><tr>
        <th>UTC interval end</th><th>Duration s</th><th>Wind m/s</th><th>FROM °</th><th>Air °C</th><th>RH %</th><th>Pressure Pa</th><th>DNI W/m²</th><th>DHI W/m²</th><th>GHI W/m²</th>
      </tr></thead><tbody>{preview.map(row=><tr key={row.timestamp}><th scope="row">{row.timestamp}</th><td>{row.durationSeconds}</td>
        {(['windSpeedMps','windFromDeg','temperatureC','rhPct','pressurePa','dniWm2','dhiWm2','ghiWm2'] as const).map(key=><td key={key}>{quantity(row[key],'')}</td>)}
      </tr>)}</tbody></table></div>
    </details>
    <details><summary>Method, source metadata and limitations</summary>
      <p>{response.result.method.implementation}</p><ul>{response.result.limitations.map(item=><li key={item}>{item}</li>)}</ul>
      <pre>{JSON.stringify({method:response.result.method,source:weather.source,coverage:weather.coverage,inputFingerprint:response.result.inputFingerprint},null,2)}</pre>
    </details>
  </>
}
export function WindStudy({record,csrf,draft,onChange,blocked}:{
  record:WorkspaceRecord;csrf:string;draft:WindDraft;onChange:(value:WindDraft)=>void;blocked:boolean
}) {
  const [result,setResult]=useState<{response:WindResult;draft:WindDraft}|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0)
  const latest=useRef({id:record.project_id,version:record.version,draft,blocked})
  latest.current={id:record.project_id,version:record.version,draft,blocked}
  useEffect(()=>{
    generation.current++;setResult(null);setBusy(false);setError('')
    return ()=>{generation.current++}
  },[record.project_id,record.version,draft,blocked])
  function change(value:WindDraft) {
    generation.current++;setResult(null);setBusy(false);setError('');onChange(value)
  }
  async function load(file:File|undefined) {
    if(!file)return
    const token=++generation.current,captured=latest.current
    setResult(null);setBusy(false);setError('')
    try {
      if(file.size>MAX_WEATHER_BYTES)throw new Error('Weather file exceeds 6 MiB. Keep the original; select a smaller supported series.')
      const text=await file.text()
      if(token!==generation.current||latest.current.id!==captured.id||latest.current.version!==captured.version
        ||latest.current.draft!==captured.draft||latest.current.blocked)return
      change({...draft,text,filename:file.name,format:file.name.toLowerCase().endsWith('.epw')?'epw':'json'})
    } catch(failure){if(token===generation.current)setError(errorMessage(failure))}
  }
  async function run(event:FormEvent) {
    event.preventDefault()
    if(busy||blocked)return
    const token=++generation.current
    setBusy(true);setResult(null);setError('')
    try {
      const response=await calculateWind(record,windInputs(draft),csrf)
      if(token!==generation.current||latest.current.id!==record.project_id||latest.current.version!==record.version
        ||latest.current.draft!==draft||latest.current.blocked)return
      setResult({response,draft})
    } catch(failure){if(token===generation.current)setError(errorMessage(failure))}
    finally{if(token===generation.current)setBusy(false)}
  }
  const current=result?.response.project_id===record.project_id&&result.response.version===record.version&&result.draft===draft&&!blocked?result.response:null
  return <section className="wind-study" aria-label="Imported weather wind study">
    <h2>Wind & windows — imported weather</h2>
    <p>Explicit local Python weather import and 16-sector wind statistics for workspace revision {record.version}.
      No automatic fetch, site changes, window invention or ventilation performance claim. A current weather sample is not annual climate.</p>
    {blocked&&<p role="status">Apply/discard Site drafts and resolve workspace conflicts before calculating Wind.</p>}
    <form onSubmit={run}><fieldset disabled={blocked}><legend>Session weather file and wind filters</legend>
      <label>Choose local EPW or JSON (up to 6 MiB)<input type="file" accept=".epw,.json" onChange={e=>{void load(e.target.files?.[0]);e.target.value=''}}/></label>
      <p>{draft.filename||'No file selected'}. Selecting a file reads it locally only; Calculate sends it to this application's Python API, not a weather provider.</p>
      <div className="native-fields">
        <label>File format<select value={draft.format} onChange={e=>change({...draft,format:e.target.value as WindDraft['format']})}><option value="epw">EPW</option><option value="json">Normalized / Open-Meteo hourly JSON</option></select></label>
        <label>Calm threshold (m/s)<input type="number" step="any" min="0" max="150" required value={draft.calm_threshold_mps} onChange={e=>change({...draft,calm_threshold_mps:e.target.value})}/></label>
        <label>Filter clock<select value={draft.clock} onChange={e=>change({...draft,clock:e.target.value as WindDraft['clock']})}>
          <option value="source">Declared source fixed UTC offset</option><option value="site">Applied Site IANA clock ({record.document.site.time_zone??'unknown'})</option>
        </select></label>
        <label>Clock-hour filter<select value={draft.daytime} onChange={e=>change({...draft,daytime:e.target.value as WindDraft['daytime']})}>
          <option value="all">All times</option><option value="day">Inside clock window</option><option value="night">Outside clock window</option>
        </select></label>
        <label>Window start (hour, 0–23.99)<input type="number" step="any" min="0" max="23.99" required value={draft.day_start_hour} onChange={e=>change({...draft,day_start_hour:e.target.value})}/></label>
        <label>Window end (hour, 0–24)<input type="number" step="any" min="0" max="24" required value={draft.day_end_hour} onChange={e=>change({...draft,day_end_hour:e.target.value})}/></label>
      </div>
      <fieldset className="wind-months"><legend>Months (none selected = all; interval-end local month)</legend>
        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((label,index)=><label key={label}><input type="checkbox" checked={draft.months.includes(index+1)}
          onChange={e=>change({...draft,months:e.target.checked?[...draft.months,index+1]:draft.months.filter(month=>month!==index+1)})}/>{label}</label>)}
      </fieldset>
      <p>EPW timestamps use source standard-time offset, not DST. JSON needs explicit UTC/offset timestamps and durations.
        Source years are preserved; frequencies count records, not elapsed hours. Start/end may wrap midnight.</p>
      <button className="primary" disabled={busy||!draft.text.trim()}>{busy?'Calculating imported weather…':'Calculate imported wind & weather'}</button>{' '}
      <button type="button" onClick={()=>{generation.current++;setBusy(false);setResult(null);setError('')}}>Clear result / ignore pending calculation</button>{' '}
      <button type="button" onClick={()=>change({...draft,text:'',filename:''})}>Clear weather draft</button>
    </fieldset></form>
    <p>Draft files and results are session-only, not durably saved. Navigation does not run a study. Window proposal integration is not included.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {current&&<WindPlot response={current}/>}
  </section>
}
