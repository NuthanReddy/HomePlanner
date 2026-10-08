import { useState } from 'react'
import type { EvaluationPart, Rect } from './native-api'

type Setbacks = Record<'front'|'rear'|'left'|'right',number>
type Envelope = {
  frontage_m:number; gross_depth_m:number; depth_m:number; widening_m:number; envelope:Rect
  net_area_m2:number; height_m:number; usable_m2:number; floors:number; built_up_m2:number
  lost_percent:number; built_up_per_net_m2:number; required_setbacks_m:Setbacks; applied_setbacks_m:Setbacks; non_compliant:boolean
}
type Sample = Envelope & {sample_area_m2:number;inr_per_built_ft2:number|null}
type Series = {aspect:number;samples:Sample[]}
type Pair = {a:Envelope;b:Envelope;fraction:number;net_area_m2:number;usable_m2:number;built_up_m2:number;lost_percent:number}
type Split = {edge:string;whole:Envelope;selected:Pair;best_sampled:Pair;sample_count:number}
const labels={lost_percent:'Setback / open-space loss (%)',built_up_m2:'Built-up area (m²)',built_up_per_net_m2:'Built-up / net area',inr_per_built_ft2:'Cost (INR/ft² built-up)'}
type Metric=keyof typeof labels
const colors=['#9b2460','#11717b','#1c58bb','#237b46','#57606a','#916215','#854db8','#c53a36','#a55515']
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const format=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:2})
function isObject(value:unknown):value is Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function isSetbacks(value:unknown):value is Setbacks {
  return isObject(value)&&['front','rear','left','right'].every(key=>finite(value[key])&&value[key]>=0)
}
function isEnvelope(value:unknown):value is Envelope {
  return isObject(value)&&['frontage_m','gross_depth_m','depth_m','widening_m','net_area_m2','height_m','usable_m2','floors',
    'built_up_m2','lost_percent','built_up_per_net_m2'].every(key=>finite(value[key]))
    &&Number(value.frontage_m)>0&&Number(value.gross_depth_m)>0
    &&typeof value.non_compliant==='boolean'&&isSetbacks(value.required_setbacks_m)&&isSetbacks(value.applied_setbacks_m)
    &&isObject(value.envelope)&&['x','y','width','depth'].every(key=>isObject(value.envelope)&&finite(value.envelope[key]))
}
function isSeries(value:unknown):value is Series {
  return isObject(value)&&finite(value.aspect)&&value.aspect>0&&Array.isArray(value.samples)&&value.samples.length>0
    &&value.samples.every(sample=>isObject(sample)&&finite(sample.sample_area_m2)&&sample.sample_area_m2>0
      &&(sample.inr_per_built_ft2===null||finite(sample.inr_per_built_ft2))&&isEnvelope(sample))
}
function isPair(value:unknown):value is Pair {
  return isObject(value)&&isEnvelope(value.a)&&isEnvelope(value.b)
    &&['fraction','net_area_m2','usable_m2','built_up_m2','lost_percent'].every(key=>finite(value[key]))
}
function isSplit(value:unknown):value is Split {
  return isObject(value)&&typeof value.edge==='string'&&'NESW'.includes(value.edge)&&value.edge.length===1
    &&isEnvelope(value.whole)&&isPair(value.selected)&&isPair(value.best_sampled)&&finite(value.sample_count)
}
export function curveSegments<T>(samples:T[],value:(sample:T)=>number|null):T[][] {
  const segments:T[][]=[]
  let segment:T[]=[]
  for(const sample of samples) {
    if(value(sample)===null){if(segment.length)segments.push(segment);segment=[]}
    else segment.push(sample)
  }
  if(segment.length)segments.push(segment)
  return segments
}
function SplitDrawing({title,plots,edge}:{title:string;plots:Envelope[];edge:string}) {
  const width=plots.reduce((sum,plot)=>sum+plot.frontage_m,0)
  const depth=Math.max(...plots.map(plot=>plot.gross_depth_m))
  const pad=Math.max(width,depth)*.12
  return <figure>
    <svg viewBox={`${-pad} ${-pad*1.6} ${width+2*pad} ${depth+pad*2.2}`} role="img" aria-label={title}>
      <title>{`${title}: frontage-aligned schematic, ${edge} road at top; not geographic north`}</title>
      <rect x={0} y={-pad} width={width} height={pad*.6} fill="#c7cdd3"/>
      <text x={width/2} y={-pad*1.2} textAnchor="middle" fontSize={pad*.4}>{edge} road · shared direct frontage</text>
      {plots.map((plot,index)=>{
        const offset=index===0?0:plots[0].frontage_m
        return <g key={index} transform={`translate(${offset} 0)`}>
          <rect width={plot.frontage_m} height={plot.gross_depth_m} fill="none" stroke="#475569" strokeWidth={pad*.04}/>
          {plot.widening_m>0&&<rect width={plot.frontage_m} height={plot.widening_m} fill="#fef3c7"/>}
          <rect x={plot.envelope.x} y={plot.envelope.y} width={plot.envelope.width} height={plot.envelope.depth}
            fill={plot.non_compliant?'#fee2e2':'#dbeafe'} stroke={plot.non_compliant?'#b42318':'#2563eb'} strokeWidth={pad*.03}/>
          <text x={plot.frontage_m/2} y={depth+pad*.45} textAnchor="middle" fontSize={pad*.35}>{plots.length>1?`${index===0?'A':'B'} · `:''}{format(plot.frontage_m)} m</text>
        </g>
      })}
    </svg>
    <figcaption><strong>{title}</strong>. {edge} road at top, not geographic north. Gross boundaries, widening strips (amber) and applied setback envelopes. Open-space deductions are numeric, not positioned in these envelopes.</figcaption>
  </figure>
}
function setbackText(value:Setbacks) {return `${format(value.front)} / ${format(value.right)} / ${format(value.rear)} / ${format(value.left)}`}

export function Utilization({value,onSplitDraft,disabled=false}:{
  value:EvaluationPart|undefined;onSplitDraft?:(fraction:number)=>void;disabled?:boolean
}) {
  const [metric,setMetric]=useState<Metric>('lost_percent')
  const [aspect,setAspect]=useState(1)
  if(!value||value.status!=='computed')return null
  if(!Array.isArray(value.series)||!value.series.every(isSeries)||value.series.length===0
    ||(value.split!==null&&!isSplit(value.split)))return <p role="alert">Invalid utilization response. Reload the current API; comparisons are not displayed.</p>
  const series=value.series
  const values=series.flatMap(item=>item.samples.map(p=>p[metric]).filter((v):v is number=>v!==null))
  const max=metric==='lost_percent'?100:Math.max(1,...values)*1.05
  const sx=(m2:number)=>55+(Math.log10(m2/.83612736)-Math.log10(50))/2*620
  const sy=(n:number)=>265-n/max*230
  const selected=series.find(item=>item.aspect===aspect)
  const split=isSplit(value.split)?value.split:null
  const groups:{label:string;value:Envelope|Pair}[]=split?[
    {label:'Whole plot (highest Table III)',value:split.whole},
    ...([['Selected split',split.selected],['Best sampled split',split.best_sampled]] as const).flatMap(([label,pair])=>[
      {label:`${label} A`,value:pair.a},{label:`${label} B`,value:pair.b},{label:`${label} total`,value:pair},
    ]),
  ]:[]
  return <section aria-label="Utilization comparisons">
    <h3>Area and aspect-ratio comparisons</h3>
    <p>Aspect ratios are <strong>frontage : depth</strong>. Each line is a hypothetical net-area series, not your selected plot or generated rooms. Required/applied setbacks are retained for every sample.</p>
    <div className="comparison-controls"><label>Chart metric<select aria-label="Chart metric" value={metric} onChange={e=>setMetric(e.target.value as Metric)}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <svg viewBox="0 0 710 310" role="img" aria-label={`${labels[metric]} versus hypothetical net plot area in square yards`} className="utilization-chart">
      <title>{`${labels[metric]} — hypothetical net-area plots; no authored plan changes`}</title>
      {[0,.25,.5,.75,1].map(f=><g key={f}><line x1="55" y1={sy(f*max)} x2="675" y2={sy(f*max)} stroke="#d0d7de"/><text x="50" y={sy(f*max)+4} textAnchor="end" fontSize="10">{(f*max).toFixed(metric==='built_up_per_net_m2'?1:0)}</text></g>)}
      {[50,100,200,500,1000,2000,5000].map(area=><text key={area} x={sx(area*.83612736)} y="285" textAnchor="middle" fontSize="11">{area}</text>)}
      {series.flatMap((item,index)=>curveSegments(item.samples,p=>p[metric]).map((segment,part)=><polyline key={`${item.aspect}-${part}`}
        fill="none" stroke={colors[index%colors.length]} strokeWidth={item.aspect===aspect?3:1.4}
        strokeDasharray={item.aspect===aspect?undefined:'5 3'}
        points={segment.map(p=>`${sx(p.sample_area_m2)},${sy(p[metric]!)}`).join(' ')}/>))}
      <text x="360" y="305" textAnchor="middle" fontSize="11">Net plot area (yd²), logarithmic scale</text>
    </svg>
    {values.length===0&&<p role="status">Cost rates or applicability inputs are missing. No zero-cost curve is inferred; supply rates under Analyze → Costs.</p>}
    <p>Solid line: selected aspect. Dashed lines: other aspects. Gaps are unknown/uncomputable values, not interpolated estimates.</p>
    <div className="comparison-legend">{series.map((item,index)=><button key={item.aspect} aria-pressed={aspect===item.aspect} onClick={()=>setAspect(item.aspect)}><span aria-hidden="true" style={{color:colors[index%colors.length]}}>●</span> 1:{item.aspect}</button>)}</div>
    <details><summary>Sample values for selected aspect ratio (1:{aspect})</summary>
      <p>Setbacks: front / right / rear / left in metres. “No below-minimum setbacks” is only a numeric check against the retained model, not compliance certification.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Utilization sample values"><table><thead><tr>
        {['Net m²','Frontage × depth m','Loss %','Height m','Floors','Built-up m²','Built / net','INR/ft²','Required setbacks m','Applied setbacks m','Setback check'].map(label=><th scope="col" key={label}>{label}</th>)}
      </tr></thead><tbody>{selected?.samples.map(row=><tr key={row.sample_area_m2}>
        <td>{format(row.sample_area_m2)}</td><td>{format(row.frontage_m)} × {format(row.depth_m)}</td>
        <td>{format(row.lost_percent)}</td><td>{format(row.height_m)}</td><td>{row.floors}</td><td>{format(row.built_up_m2)}</td>
        <td>{format(row.built_up_per_net_m2)}</td><td>{row.inr_per_built_ft2===null?'Unknown':format(row.inr_per_built_ft2)}</td>
        <td>{setbackText(row.required_setbacks_m)}</td><td>{setbackText(row.applied_setbacks_m)}</td>
        <td>{row.non_compliant?'Non-compliant':'No below-minimum setbacks'}</td>
      </tr>)}</tbody></table></div>
    </details>
    {split&&<><h3>Whole versus split — {split.edge} road</h3>
      <p>Best of {split.sample_count} tested splits: {format(split.best_sampled.fraction*100)}% / {format((1-split.best_sampled.fraction)*100)}%. Objective: usable footprint, not maximum built-up or minimum cost. This is not subdivision approval.</p>
      {onSplitDraft&&<div className="comparison-controls">
        <button type="button" disabled={disabled} onClick={()=>onSplitDraft(split.best_sampled.fraction)}>Copy best sampled split to draft</button>
        <button type="button" disabled={disabled} onClick={()=>onSplitDraft(1-split.best_sampled.fraction)}>Copy mirrored split to draft</button>
        <span>Review and Apply split scenario above to save. No room layout changes.</span>
      </div>}
      <dl className="native-results">
        <div><dt>Selected split footprint change vs whole</dt><dd>{format(split.selected.usable_m2-split.whole.usable_m2)} m²</dd></div>
        <div><dt>Selected split built-up change vs whole</dt><dd>{format(split.selected.built_up_m2-split.whole.built_up_m2)} m²</dd></div>
        <div><dt>Loss reduction vs whole</dt><dd>{format(split.whole.lost_percent-split.selected.lost_percent)} percentage points</dd></div>
      </dl>
      <div className="split-previews">
        <SplitDrawing title="Whole plot" plots={[split.whole]} edge={split.edge}/>
        <SplitDrawing title="Applied selected split" plots={[split.selected.a,split.selected.b]} edge={split.edge}/>
        <SplitDrawing title="Best sampled split" plots={[split.best_sampled.a,split.best_sampled.b]} edge={split.edge}/>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Whole versus split comparison"><table><thead><tr>
        {['Scenario','Net m²','Height m','Usable m²','Floors','Built-up m²','Loss %','Required setbacks m (F/R/B/L)','Applied setbacks m (F/R/B/L)','Setback check'].map(label=><th scope="col" key={label}>{label}</th>)}
      </tr></thead><tbody>{groups.map(({label,value:row})=><tr key={label}><th scope="row">{label}</th>
        <td>{format(row.net_area_m2)}</td><td>{'height_m' in row?format(row.height_m):'—'}</td><td>{format(row.usable_m2)}</td>
        <td>{'floors' in row?row.floors:'—'}</td><td>{format(row.built_up_m2)}</td><td>{format(row.lost_percent)}</td>
        <td>{'required_setbacks_m' in row?setbackText(row.required_setbacks_m):'See A/B'}</td>
        <td>{'applied_setbacks_m' in row?setbackText(row.applied_setbacks_m):'See A/B'}</td>
        <td>{('non_compliant' in row?row.non_compliant:row.a.non_compliant||row.b.non_compliant)?'Non-compliant':'No below-minimum setbacks'}</td>
      </tr>)}</tbody></table></div>
    </>}
  </section>
}
