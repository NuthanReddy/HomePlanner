import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from './api'
import type { PlannerApi } from '../domain/project/planner-api'
import { HouseSunStudy } from './HouseSunStudy'
import type { WorkspaceRecord } from './native-api'
import { calculateSolar, type SolarInputs, type SolarResult, type SolarPosition, type SolarCharts } from './solar-api'

export type SolarDraft={date:string;local_time:string;occurrence:''|'earlier'|'later';altitude_m:string;pressure_pa:string;temperature_c:string;acknowledge_reference:boolean;sample_minutes:string;pole_height_m?:string;low_sun_cutoff_deg?:string}
export const emptySolarDraft:SolarDraft={date:'',local_time:'',occurrence:'',altitude_m:'',pressure_pa:'',temperature_c:'',acknowledge_reference:false,sample_minutes:'15',pole_height_m:'',low_sun_cutoff_deg:'1'}
export function normalizeSolarDraft(draft:SolarDraft):SolarDraft {
  return {...draft,pole_height_m:draft.pole_height_m??'',low_sun_cutoff_deg:draft.low_sun_cutoff_deg??'1'}
}
export function currentSolarClock(timeZone:string,now=new Date()):Pick<SolarDraft,'date'|'local_time'> {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
  const part=(type:string)=>parts.find(value=>value.type===type)!.value
  return {date:`${part('year')}-${part('month')}-${part('day')}`,local_time:`${part('hour')}:${part('minute')}`}
}
export function solarInputs(draft:SolarDraft):SolarInputs {
  draft=normalizeSolarDraft(draft)
  const numeric=(value:string)=>{
    if(value.trim()==='')return null
    if(!Number.isFinite(Number(value)))throw new Error('Supply finite atmosphere values or leave unknown values blank.')
    return Number(value)
  }
  return {date:draft.date,local_time:draft.local_time,occurrence:draft.occurrence||null,
    altitude_m:numeric(draft.altitude_m),pressure_pa:numeric(draft.pressure_pa),temperature_c:numeric(draft.temperature_c),
    acknowledge_reference:draft.acknowledge_reference,sample_minutes:Number(draft.sample_minutes),
    pole_height_m:numeric(draft.pole_height_m??''),low_sun_cutoff_deg:numeric(draft.low_sun_cutoff_deg??'1')??1}
}
function offset(point:SolarPosition) {return point.localTime.slice(-6)}
export function solarSegments(points:(SolarPosition|null)[],daylightOnly=true,breakOffsets=true):SolarPosition[][] {
  const segments:SolarPosition[][]=[]
  let segment:SolarPosition[]=[],previous:SolarPosition|null=null
  const finish=()=>{if(segment.length)segments.push(segment);segment=[]}
  for(const point of points) {
    if(!point){finish();previous=null;continue}
    if(breakOffsets&&previous&&offset(previous)!==offset(point)){finish();previous=null}
    if(daylightOnly&&previous&&(previous.apparentElevationDeg<0)!==(point.apparentElevationDeg<0)){
      const fraction=previous.apparentElevationDeg/(previous.apparentElevationDeg-point.apparentElevationDeg)
      const azimuthChange=(point.azimuthDeg-previous.azimuthDeg+540)%360-180
      const utc=new Date(Date.parse(previous.instantUTC)+fraction*(Date.parse(point.instantUTC)-Date.parse(previous.instantUTC))).toISOString()
      segment.push({...point,instantUTC:utc,azimuthDeg:(previous.azimuthDeg+fraction*azimuthChange+360)%360,
        apparentElevationDeg:0,geometricElevationDeg:0,aboveHorizon:false})
      if(point.apparentElevationDeg<0)finish()
    }
    if(!daylightOnly||point.apparentElevationDeg>=0)segment.push(point)
    previous=point
  }
  finish();return segments
}
export function solarCSV(result:SolarResult) {
  const charts=result.result.output.charts
  if(!charts)return ''
  const quote=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`
  const input=result.result.inputs
  return [['date','local_clock','time_zone','latitude_deg','longitude_deg','instant_utc','local_time_with_offset','azimuth_deg_from_true_north',
    'geometric_elevation_deg','apparent_elevation_deg','status','engine','project_id','version'],
  ...charts.annual.rows.map(row=>[row.date,charts.annual.time,input.timeZone,input.latitude,input.longitude,row.position?.instantUTC,row.position?.localTime,
    row.position?.azimuthDeg,row.position?.geometricElevationDeg,row.position?.apparentElevationDeg,row.status,
    `${result.result.engine.name} ${result.result.engine.version}`,result.project_id,result.version])].map(row=>row.map(quote).join(',')).join('\r\n')
}
const skyPoint=(point:SolarPosition)=>{
  const radius=(90-point.apparentElevationDeg)/90*245,angle=point.azimuthDeg*Math.PI/180
  return [325+radius*Math.sin(angle),325-radius*Math.cos(angle)]
}
const skyPath=(points:(SolarPosition|null)[],breakOffsets=true)=>solarSegments(points,true,breakOffsets).map(segment=>segment.map((point,index)=>{
  const [x,y]=skyPoint(point);return `${index?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`
}).join(' ')).join(' ')
function monthLabels(charts:SolarCharts,showMonths:boolean) {
  const labels=charts.references.filter(curve=>curve.date.endsWith('-21')&&(showMonths||curve.kind!=='monthly')).flatMap(curve=>{
    const month=Number(curve.date.slice(5,7)),side=month<=6?1:-1
    const candidates=solarSegments(curve.samples,true,false).flat().filter(point=>(skyPoint(point)[0]-325)*side>=0)
    if(!candidates.length)return []
    const point=candidates.reduce((lowest,row)=>row.apparentElevationDeg<lowest.apparentElevationDeg?row:lowest)
    const [x,y]=skyPoint(point)
    return [{date:curve.date,month,side,x,y,labelY:y}]
  })
  for(const side of [-1,1]){
    const group=labels.filter(label=>label.side===side).sort((a,b)=>a.y-b.y)
    group.forEach((label,index)=>{label.labelY=Math.max(100,Math.min(550,label.y),index?group[index-1].labelY+22:100)})
    if(group.length&&group.at(-1)!.labelY>550){
      group.at(-1)!.labelY=550
      for(let index=group.length-2;index>=0;index--)group[index].labelY=Math.min(group[index].labelY,group[index+1].labelY-22)
    }
  }
  return labels.map(label=>{
    const x=label.side>0?625:25,text=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][label.month-1]
    return <g key={label.date}><path d={`M${label.x},${label.y}L${x-label.side*8},${label.labelY}`} fill="none" stroke="#94a3b8"/>
      <text x={x} y={label.labelY+4} fontSize="11" textAnchor={label.side>0?'start':'end'}>{text} 21</text></g>
  })
}
export function SeasonalSolarPlots({result,charts}:{result:SolarResult;charts:SolarCharts}) {
  const [months,setMonths]=useState(true),[hours,setHours]=useState(true)
  const {selected,path,day}=result.result.output
  const lat=Number(result.result.inputs.latitude),annual=charts.annual.rows
  const x=(index:number)=>50+index/(annual.length-1)*640,y=(degrees:number)=>180-degrees/90*140
  const annualPath=(key:'apparentElevationDeg'|'geometricElevationDeg')=>{
    let previous:SolarPosition|null=null
    return annual.map((row,index)=>{
      const point=row.position
      if(!point){previous=null;return ''}
      const move=!previous||offset(previous)!==offset(point);previous=point
      return `${move?'M':'L'}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`
    }).join(' ')
  }
  const event=(instant:string|null)=>instant??'No crossing'
  const pole=charts.pole
  const shadowLabel=(shadow:typeof pole.selected)=>shadow.status==='available'?`${shadow.lengthM!.toFixed(3)} m (${(shadow.lengthM!/.3048).toFixed(3)} ft); bearing ${shadow.bearingDeg!.toFixed(2)}°`:
    shadow.status==='unknown-height'?'Unknown: supply a pole height':shadow.status==='low-sun'?`Excluded below ${pole.lowSunCutoffDeg}° cutoff (not zero)`:'No direct sun / no finite horizon estimate'
  const finiteLengths=pole.path.flatMap(p=>p.lengthM===null?[]:[p.lengthM]),maximum=Math.max(...finiteLengths,0)
  const poleX=(point:SolarPosition)=>50+(Date.parse(point.instantUTC)-Date.parse(day.startUTC))/(Date.parse(day.endUTC)-Date.parse(day.startUTC))*640
  let prior=false
  const polePath=pole.path.map((shadow,index)=>{
    if(shadow.lengthM===null){prior=false;return ''}
    const move=!prior;prior=true
    return `${move?'M':'L'}${poleX(path[index]).toFixed(2)},${(190-shadow.lengthM/(maximum||1)*150).toFixed(2)}`
  }).join(' ')
  function download() {
    const url=URL.createObjectURL(new Blob([solarCSV(result)],{type:'text/csv;charset=utf-8'}))
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`solar-${charts.year}-same-clock.csv`;anchor.click()
    setTimeout(()=>URL.revokeObjectURL(url),0)
  }
  return <>
    <h3>Azimuth / elevation sky diagram</h3>
    <div className="solar-chart-controls">
    <label><input type="checkbox" checked={months} onChange={e=>setMonths(e.target.checked)}/> Monthly paths</label>{' '}
    <label><input type="checkbox" checked={hours} onChange={e=>setHours(e.target.checked)}/> Hourly civil-clock guides</label>
    </div>
    <div className="solar-sky-layout">
    <div className="solar-chart-scroll" tabIndex={0} role="region" aria-label="Scrollable solar sky diagram">
    <svg viewBox="-40 30 730 590" className="solar-chart solar-sky-chart" role="img" aria-label="Equidistant solar sky diagram with monthly, solstice, equinox and same-clock paths">
      <title>Equidistant apparent-elevation sky diagram, true north up; not stereographic</title>
      {[0,10,20,30,40,50,60,70,80].map(elevation=><g key={elevation}><circle cx="325" cy="325" r={(90-elevation)/90*245} fill="none" stroke="#d0d7de"/>
        <text x="328" y={325-(90-elevation)/90*245} fontSize="10">{elevation}°</text></g>)}
      {Array.from({length:24},(_,index)=>index*15).map(azimuth=>{
        const a=azimuth*Math.PI/180;return <g key={azimuth}><line x1="325" y1="325" x2={325+245*Math.sin(a)} y2={325-245*Math.cos(a)} stroke="#d0d7de"/>
          <text x={325+270*Math.sin(a)} y={325-270*Math.cos(a)} textAnchor="middle" fontSize="11">{({0:'N',90:'E',180:'S',270:'W'} as Record<number,string>)[azimuth]??`${azimuth}°`}</text></g>
      })}
      {hours&&charts.hourly.filter(curve=>curve.time!==charts.annual.time).map(curve=>{
        const points=curve.rows.map(row=>row.position),visible=points.filter((point):point is SolarPosition=>point!==null&&point.aboveHorizon)
        const peak=visible.length?visible.reduce((highest,row)=>row.apparentElevationDeg>highest.apparentElevationDeg?row:highest):null
        return <g key={curve.time}><path d={skyPath(points)} fill="none" stroke="#64748b" strokeOpacity=".5" strokeDasharray="3 4"><title>{curve.time} civil clock across {charts.year}</title></path>
          {peak&&<text x={skyPoint(peak)[0]+5} y={skyPoint(peak)[1]-7} fontSize="10" fill="#64748b">{curve.time}</text>}</g>
      })}
      {charts.references.filter(curve=>months||curve.kind!=='monthly').map(curve=>{
        const solstice=curve.kind.endsWith('solstice'),longest=lat>0?curve.kind==='june-solstice':curve.kind==='december-solstice'
        const color=solstice?(longest?'#15803d':'#7e22ce'):curve.kind.endsWith('equinox')?'#c0266a':'#94a3b8'
        return <path key={curve.date} d={skyPath(curve.samples,false)} fill="none" stroke={color} strokeWidth={solstice?2.5:1.5}
          strokeDasharray={curve.kind.endsWith('equinox')?'7 4':undefined}><title>{curve.date}: {curve.kind}; {curve.durationHours} elapsed civil hours</title></path>
      })}
      <path d={skyPath(annual.map(row=>row.position))} fill="none" stroke="#b45309" strokeWidth="2"/>
      <path d={skyPath(path,false)} fill="none" stroke="#0969da" strokeWidth="2.5"/>
      {charts.references.map(curve=>{
        const point=annual.find(row=>row.date===curve.date)?.position
        if(!point||!point.aboveHorizon)return null
        const [cx,cy]=skyPoint(point);return <circle key={curve.date} cx={cx} cy={cy} r="3" fill="#b45309"><title>{curve.date} at {charts.annual.time}</title></circle>
      })}
      {selected.aboveHorizon&&<circle cx={skyPoint(selected)[0]} cy={skyPoint(selected)[1]} r="5" fill="#0969da"/>}
      {charts.extrema&&(['min','max'] as const).map(key=>{
        const point=charts.extrema![key], [cx,cy]=skyPoint(point)
        return <g key={key}><circle cx={cx} cy={cy} r="4" fill="#0969da"/>
          <text x="-15" y={key==='min'?50:70} fontSize="11">Day {key} {point.apparentElevationDeg.toFixed(1)}°</text></g>
      })}
      {monthLabels(charts,months)}
    </svg>
    </div>
    <div className="solar-chart-notes">
    <p>Blue: selected civil date. Amber: {charts.annual.time} across {charts.year}. Grey: 21st of each month.
      Green/purple: {lat===0?'December / June reference paths (no longest-day assertion at equator)':`longest / shortest fixed solstice references (${lat>0?'June / December':'December / June'})`}.
      Pink dashed: March 20 / September 22 equinox references, not calculated event dates. Fixed paths use 5-minute UTC samples.
      Horizon crossings are interpolated; night and skipped clocks remain gaps. Annual civil-clock curves disconnect at UTC-offset jumps; daily paths follow continuous elapsed UTC.</p>
    <p>{charts.extrema?`Sampled above-horizon minimum ${charts.extrema.min.apparentElevationDeg.toFixed(2)}° at ${charts.extrema.min.localTime}; maximum ${charts.extrema.max.apparentElevationDeg.toFixed(2)}° at ${charts.extrema.max.localTime}. Not exact horizon crossings.`:'No above-horizon daily samples; sampled extrema unavailable.'}
      {' '}Below-horizon reference dates: {charts.references.filter(curve=>curve.samples.length&&!curve.samples.some(point=>point.aboveHorizon)).map(curve=>curve.date).join(', ')||'none'}.
      {' '}Unsupported civil reference dates: {charts.references.filter(curve=>curve.status!=='available').map(curve=>curve.date).join(', ')||'none'}.</p>
    </div>
    </div>
    <h3>Annual elevation at the same local clock</h3>
    <div className="solar-chart-scroll solar-series" tabIndex={0} role="region" aria-label="Scrollable annual solar elevation chart">
    <svg viewBox="0 0 730 365" className="solar-chart" role="img" aria-label="Annual apparent and geometric solar elevation at selected civil clock">
      <title>One sample per calendar date at {charts.annual.time}, not annual energy</title>
      {[-90,-45,0,45,90].map(deg=><g key={deg}><line x1="50" x2="690" y1={y(deg)} y2={y(deg)} stroke="#d0d7de"/><text x="43" y={y(deg)+4} textAnchor="end" fontSize="11">{deg}°</text></g>)}
      {annual.filter(row=>row.date.endsWith('-01')).map(row=><text key={row.date} x={x(annual.indexOf(row))} y="345" fontSize="11" textAnchor="middle">{row.date.slice(5,7)}</text>)}
      <path d={annualPath('apparentElevationDeg')} fill="none" stroke="#0969da" strokeWidth="2"/>
      <path d={annualPath('geometricElevationDeg')} fill="none" stroke="#b45309" strokeDasharray="5 3"/>
      {annual.map((row,index)=>row.date===selected.localTime.slice(0,10)&&row.position?
        <circle key={row.date} cx={x(index)} cy={y(row.position.apparentElevationDeg)} r="4" fill="#0969da"/>:null)}
    </svg>
    </div>
    <p>{annual.length} calendar dates in {String(result.result.inputs.timeZone)}; {annual.filter(row=>!row.position).length} skipped clocks.
      Repeated annual times: {annual.find(row=>row.status.includes('repeated'))?.status??'none at this clock'}.
      Blue: apparent; dashed amber: geometric. Same civil clock is not same UTC or solar time. No 8760-hour/weather energy calculation.</p>
    <button type="button" onClick={download}>Download annual same-clock CSV</button>
    <h3>Daylight & light phases</h3>
    <dl className="native-results">
      {(['sunrise','solarNoon','sunset'] as const).map(key=><div key={key}><dt>{key}</dt><dd>{event(charts.summary.events[key])}</dd></div>)}
      <div><dt>Astronomical daylight duration</dt><dd>{charts.summary.daylight.status==='polar-day'?'Continuous daylight (polar day); no invented 24 h duration':
        charts.summary.daylight.status==='polar-night'?'0 h (polar night)':charts.summary.daylight.durationHours===null?'Not available':`${charts.summary.daylight.durationHours.toFixed(3)} elapsed UTC hours`}</dd></div>
    </dl>
    <p>{charts.summary.method}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Solar light phase crossings"><table><thead><tr><th>Phase</th><th>Geometric elevation</th><th>Morning boundary</th><th>Evening boundary</th></tr></thead>
      <tbody>{charts.summary.phases.map(phase=><tr key={phase.name}><th scope="row">{phase.name}</th><td>{phase.thresholdDeg}°</td><td>{event(phase.morning)}</td><td>{event(phase.evening)}</td></tr>)}</tbody></table></div>
    <p>{charts.summary.phaseMethod} Astronomical daylight is not measured sunshine or neighbour-clear sun hours.</p>
    <h3>Level-ground pole shadow analysis</h3>
    <p>Pole height: {pole.heightM===null?'unknown':`${pole.heightM} m`}. Selected shadow: {shadowLabel(pole.selected)}.
      Apparent elevation; height / tan(elevation). True-north bearing is opposite the sun. No slopes, trees or buildings.</p>
    {pole.heightM!==null&&<div className="solar-chart-scroll solar-series" tabIndex={0} role="region" aria-label="Scrollable pole shadow chart"><svg viewBox="0 0 730 225" className="solar-chart" role="img" aria-label="Pole shadow length in metres versus elapsed UTC hours">
      <title>Level-ground pole shadow lengths; night and low-sun samples omitted, no length clipping</title>
      <line x1="50" x2="690" y1="190" y2="190" stroke="#64748b"/><text x="50" y="25" fontSize="12">Maximum plotted length {maximum.toFixed(3)} m; cutoff {pole.lowSunCutoffDeg}°</text>
      <path d={polePath} fill="none" stroke="#7e22ce" strokeWidth="2"/>
      {[0,.25,.5,.75,1].map(f=><text key={f} x={50+640*f} y="215" textAnchor="middle" fontSize="11">{(day.durationHours*f).toFixed(2)} h</text>)}
    </svg></div>}
    <p>{pole.path.filter(p=>p.status==='low-sun').length} low-sun samples excluded; {pole.path.filter(p=>p.status==='night').length} night/horizon samples have no finite daytime shadow. Omitted is not zero.</p>
    <h3>Monthly same-clock snapshots</h3>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Monthly solar angles at 09 12 and 15 local time"><table><thead><tr><th>Reference date</th><th>Clock</th><th>Azimuth °</th><th>Apparent elevation °</th><th>UTC / availability</th></tr></thead>
      <tbody>{charts.monthly.flatMap(month=>month.times.map(row=><tr key={`${month.date}-${row.time}`}><th scope="row">{month.date}</th><td>{row.time}</td>
        <td>{row.position?.azimuthDeg.toFixed(2)??'Unknown'}</td><td>{row.position?.apparentElevationDeg.toFixed(2)??'Unknown'}</td><td>{row.position?.instantUTC??row.status}</td></tr>))}</tbody></table></div>
    <p>These astronomical charts do not include building shade. Use the separate house direct-sun study with the actual open Design model for shaded sunlight hours.
      Weather irradiance additionally requires explicit interval-matched DNI/DHI/GHI; it is not inferred from sun hours.</p>
  </>
}
export function SolarPlot({result}:{result:SolarResult}) {
  const [preview,setPreview]=useState<{result:SolarResult;index:number}|null>(null)
  const {path,day}=result.result.output
  const previewIndex=preview?.result===result?preview.index:null
  const selected=previewIndex===null?result.result.output.selected:path[previewIndex]
  const charts=result.result.output.charts
  const displayedResult:SolarResult={...result,result:{...result.result,output:{...result.result.output,selected,
    charts:charts&&previewIndex!==null?{...charts,pole:{...charts.pole,selected:charts.pole.path[previewIndex]}}:charts}}}
  const closestIndex=path.reduce((best,point,index)=>
    Math.abs(Date.parse(point.instantUTC)-Date.parse(selected.instantUTC))<
    Math.abs(Date.parse(path[best].instantUTC)-Date.parse(selected.instantUTC))?index:best,0)
  const start=Date.parse(day.startUTC),end=Date.parse(day.endUTC)
  const x=(instant:string)=>50+(Date.parse(instant)-start)/(end-start)*640
  const y=(degrees:number)=>185-degrees/90*145
  return <>
    <div className="solar-time-control">
      <label>Explore time of day
        <input type="range" min="0" max={path.length-1} step="1" value={previewIndex??closestIndex}
          aria-valuetext={selected.localTime} onChange={event=>setPreview({result,index:Number(event.target.value)})}/>
      </label>
      <output>{selected.localTime}</output>
      <button type="button" disabled={previewIndex===null} onClick={()=>setPreview(null)}>Return to calculated time</button>
      <p>Scrub calculated samples to update the sun position and pole shadow. Local times include UTC offsets through daylight-saving changes.
        Daily totals and annual same-clock curves remain at their calculated inputs; this does not run another study.</p>
    </div>
    <dl className="native-results">
      <div><dt>Selected local time</dt><dd>{selected.localTime}</dd></div>
      <div><dt>Azimuth clockwise from true north</dt><dd>{selected.azimuthDeg.toFixed(2)}°</dd></div>
      <div><dt>Geometric elevation</dt><dd>{selected.geometricElevationDeg.toFixed(2)}°</dd></div>
      <div><dt>Apparent elevation</dt><dd>{selected.apparentElevationDeg.toFixed(2)}°</dd></div>
      <div><dt>Apparent zenith</dt><dd>{(90-selected.apparentElevationDeg).toFixed(2)}°</dd></div>
    </dl>
    <p>{selected.aboveHorizon?'Above the apparent horizon; obstructions are not evaluated.':'At or below the apparent horizon (night/horizon), not a missing result.'}
      {' '}Civil day: {day.durationHours} elapsed hours; {day.sampleCount} samples. Final sample is the next-day boundary.</p>
    <div className="solar-chart-scroll solar-series" tabIndex={0} role="region" aria-label="Scrollable daily solar elevation chart">
    <svg viewBox="0 0 730 365" className="solar-chart" role="img" aria-label="pvlib solar elevations versus elapsed UTC hours">
      <title>Solar elevations: elapsed UTC hours from civil-day start, including night</title>
      {[-90,-45,0,45,90].map(deg=><g key={deg}><line x1="50" x2="690" y1={y(deg)} y2={y(deg)} stroke={deg===0?'#475569':'#d0d7de'}/><text x="43" y={y(deg)+4} textAnchor="end" fontSize="11">{deg}°</text></g>)}
      {[0,.25,.5,.75,1].map(f=><text key={f} x={50+640*f} y="347" textAnchor="middle" fontSize="11">{(day.durationHours*f).toFixed(2)} h</text>)}
      <polyline fill="none" stroke="#0969da" strokeWidth="2" points={path.map(p=>`${x(p.instantUTC)},${y(p.apparentElevationDeg)}`).join(' ')}/>
      <polyline fill="none" stroke="#b45309" strokeWidth="2" strokeDasharray="5 3" points={path.map(p=>`${x(p.instantUTC)},${y(p.geometricElevationDeg)}`).join(' ')}/>
      <circle cx={x(selected.instantUTC)} cy={y(selected.apparentElevationDeg)} r="4" fill="#0969da"/>
      <text x="370" y="363" textAnchor="middle" fontSize="11">Elapsed UTC hours since {day.startUTC}</text>
    </svg>
    </div>
    <p>Blue solid: apparent elevation (refraction included). Amber dashed: geometric elevation. Dot: selected instant.
      Azimuth uses N=0°, E=90° and appears in the table, without connecting across its 360° wrap.</p>
    <details><summary>Solar samples with local time and UTC offsets</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Solar sample values"><table><thead><tr>
        <th>Local time and offset</th><th>UTC</th><th>Azimuth °</th><th>Geometric elevation °</th><th>Apparent elevation °</th>
      </tr></thead><tbody>{path.map(p=><tr key={p.instantUTC}><th scope="row">{p.localTime}</th><td>{p.instantUTC}</td><td>{p.azimuthDeg.toFixed(2)}</td><td>{p.geometricElevationDeg.toFixed(2)}</td><td>{p.apparentElevationDeg.toFixed(2)}</td></tr>)}</tbody></table></div>
    </details>
    {displayedResult.result.output.charts&&<SeasonalSolarPlots result={displayedResult} charts={displayedResult.result.output.charts}/>}
  </>
}
export function SolarStudy({record,csrf,draft,onChange,blocked,planner,onCurrentResultChange}:{
  record:WorkspaceRecord;csrf:string;draft:SolarDraft;onChange:(value:SolarDraft)=>void;blocked:boolean;planner?:PlannerApi|null
  onCurrentResultChange?:(result:SolarResult|null)=>void
}) {
  const [result,setResult]=useState<{response:SolarResult;draft:SolarDraft}|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0)
  const initializedClock=useRef<string|null>(null)
  useEffect(()=>{
    if(initializedClock.current===record.project_id||!record.document.site.time_zone)return
    initializedClock.current=record.project_id
    if(draft.date||draft.local_time)return
    try { onChange({...draft,...currentSolarClock(record.document.site.time_zone)}) }
    catch(failure) { setError(errorMessage(failure)) }
  },[record.project_id,record.document.site.time_zone,draft,onChange])
  const latest=useRef({version:record.version,id:record.project_id,draft,blocked})
  latest.current={version:record.version,id:record.project_id,draft,blocked}
  useEffect(()=>{
    generation.current++;setResult(null);setBusy(false)
    return ()=>{generation.current++}
  },[record.version,record.project_id,draft,blocked])
  function change<K extends keyof SolarDraft>(key:K,value:SolarDraft[K]) {
    generation.current++;setResult(null);setBusy(false);setError('');onChange({...draft,[key]:value})
  }
  async function run(event:FormEvent) {
    event.preventDefault()
    if(busy||blocked)return
    const token=++generation.current
    setBusy(true);setResult(null);setError('')
    try {
      const result=await calculateSolar(record,solarInputs(draft),csrf)
      if(token!==generation.current||latest.current.version!==record.version||latest.current.id!==record.project_id
        ||latest.current.draft!==draft||latest.current.blocked)return
      setResult({response:result,draft})
    } catch(failure){if(token===generation.current)setError(errorMessage(failure))}
    finally{if(token===generation.current)setBusy(false)}
  }
  const site=record.document.site
  const ready=site.latitude!==null&&site.longitude!==null&&site.time_zone!==null
  const current=result?.response.version===record.version&&result.response.project_id===record.project_id
    &&result.draft===draft&&!blocked?result.response:null
  useEffect(()=>{
    onCurrentResultChange?.(current)
    return ()=>onCurrentResultChange?.(null)
  },[current,onCurrentResultChange])
  return <section aria-label="Site solar position and daily path">
    <h2>Solar paths, seasons & site analysis</h2>
    <p>Runs Python pvlib for the <strong>applied Site</strong>, revision {record.version}: {site.latitude??'unknown latitude'}, {site.longitude??'unknown longitude'}; {site.time_zone??'unknown time zone'}.
      No geolocation or weather retrieval is triggered. No building/tree shadows, irradiance or room-light result is implied.</p>
    <p>The house section below uses the actual imported Design working copy, independently of the applied account Site.
      It does not substitute a building envelope or example house, overwrite a saved legacy study, or claim weather-irradiance parity.</p>
    {!ready&&<p role="status">Apply latitude and longitude in Site → Plot & Feasibility first.</p>}
    {blocked&&<p role="status">Apply or discard Site drafts and resolve any workspace conflict before calculating Solar.</p>}
    <form onSubmit={run}><fieldset disabled={blocked}><legend>Solar clock and atmosphere</legend>
      <div className="native-fields">
        <label>Civil date<input type="date" min="1900-01-01" max="2100-12-31" required value={draft.date} onChange={e=>change('date',e.target.value)}/></label>
        <label>Local clock time<input type="time" required value={draft.local_time} onChange={e=>change('local_time',e.target.value)}/></label>
        <label>Repeated-time occurrence<select aria-label="Repeated-time occurrence" value={draft.occurrence} onChange={e=>change('occurrence',e.target.value as SolarDraft['occurrence'])}>
          <option value="">Require a choice if time repeats</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
        </select></label>
        <label>Sample interval (minutes)<input type="number" min="5" max="60" step="1" required value={draft.sample_minutes} onChange={e=>change('sample_minutes',e.target.value)}/></label>
        <label>Vertical pole height (m; blank unknown)<input type="number" min=".000001" max="1000" step="any" value={draft.pole_height_m??''} onChange={e=>change('pole_height_m',e.target.value)}/></label>
        <label>Pole low-sun cutoff (degrees)<input type="number" min="0" max="10" step="any" required value={draft.low_sun_cutoff_deg??'1'} onChange={e=>change('low_sun_cutoff_deg',e.target.value)}/></label>
        {([['altitude_m','Altitude above sea level (m; blank unknown)'],['pressure_pa','Absolute station pressure (Pa; blank unknown)'],['temperature_c','Air temperature (°C; blank unknown)']] as const).map(([key,label])=><label key={key}>{label}
          <input type="number" step="any" value={draft[key]} onChange={e=>change(key,e.target.value)}/></label>)}
      </div>
      <button type="button" disabled={!site.time_zone} onClick={()=>{
        try {if(site.time_zone)onChange({...draft,...currentSolarClock(site.time_zone),occurrence:''})}
        catch(failure){setError(errorMessage(failure))}
      }}>Use current date and time</button>
      <p>Date and time initially use the current clock in the applied Site time zone. You can change either; your changes are retained.</p>
      <button type="button" onClick={()=>change('pole_height_m','0.3048')}>Use explicit 1 ft pole (0.3048 m)</button>
      {['03-20','06-21','09-22','12-21'].map(reference=><button key={reference} type="button" disabled={!/^\d{4}-/.test(draft.date)}
        onClick={()=>change('date',`${draft.date.slice(0,4)}-${reference}`)}>{reference} reference date</button>)}
      <label className="plot-check"><input type="checkbox" checked={draft.acknowledge_reference} onChange={e=>change('acknowledge_reference',e.target.checked)}/>
        Use reference values only for missing atmosphere inputs: 0 m above sea level, 101325 Pa, 15 °C. These are not measured site values.</label>
      <p>Skipped local times are rejected; repeated times require earlier/later. Pressure and temperature are held constant for this path, not treated as a daily weather series.</p>
      <p>One explicit calculation includes 14 fixed reference paths, 24 hourly civil-clock guides and the selected annual curve (at most 14000 seasonal positions), plus event crossings. No automatic analysis on navigation or draft changes.</p>
      <button className="primary" disabled={busy||!ready}>{busy?'Calculating pvlib...':'Calculate site solar charts & analysis'}</button>{' '}
      <button type="button" onClick={()=>{generation.current++;setResult(null);setBusy(false);setError('')}}>Clear result / ignore pending calculation</button>
    </fieldset></form>
    <p>Study settings and results are session-only. Navigation does not run an analysis or edit the project.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    <HouseSunStudy planner={planner} record={record} date={draft.date} blocked={blocked}/>
    {current&&<>
      <p role="status">pvlib {current.result.engine.version} result for applied workspace revision {current.version}.</p>
      <SolarPlot result={current}/>
      <details><summary>Engine, inputs and assumptions</summary>
        <p>{current.result.engine.method}</p>
        {current.result.assumptions.map((text,index)=><p key={index}>{text}</p>)}
        <pre>{JSON.stringify({engine:current.result.engine,inputs:current.result.inputs,day:current.result.output.day,
          charts:current.result.output.charts?{schemaVersion:current.result.output.charts.schemaVersion,
            year:current.result.output.charts.year,sampleCount:current.result.output.charts.sampleCount,
            referenceSampleMinutes:current.result.output.charts.referenceSampleMinutes,geometry:current.result.output.charts.geometry}:undefined},null,2)}</pre>
      </details>
    </>}
  </section>
}
