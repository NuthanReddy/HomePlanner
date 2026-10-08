import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from './api'
import type { WorkspaceRecord } from './native-api'
import { emptyMaterials, evaluateMaterials, materialNumbers, materialOptions,
  type MaterialLayer, type MaterialPreset, type MaterialsDocument, type MaterialsResult, type AssemblyResult } from './materials-api'

type LayerDraft = Omit<MaterialLayer,typeof materialNumbers[number]> & Record<typeof materialNumbers[number],string>
export type MaterialsDraft = {
  layers:LayerDraft[];films:{inside:string;outside:string;source:string}
  comparisonThicknessM:string
  glazing:{uValueW_M2K:string;shgc:string;vlt:string;source:string}
}
const text=(value:number|null)=>value===null?'':String(value)
export function materialsDraft(value:MaterialsDocument=emptyMaterials()):MaterialsDraft {
  return {layers:value.layers.map(l=>({...l,thicknessM:text(l.thicknessM),conductivityW_MK:text(l.conductivityW_MK),
    densityKgM3:text(l.densityKgM3),specificHeatJ_KgK:text(l.specificHeatJ_KgK)})),
    films:{inside:text(value.films.inside),outside:text(value.films.outside),source:value.films.source},
    comparisonThicknessM:text(value.comparisonThicknessM),glazing:{uValueW_M2K:text(value.glazing.uValueW_M2K),
      shgc:text(value.glazing.shgc),vlt:text(value.glazing.vlt),source:value.glazing.source}}
}
export function materialsCommand(draft:MaterialsDraft):MaterialsDocument {
  const numeric=(value:string)=>{
    if(!value.trim())return null
    const number=Number(value)
    if(!Number.isFinite(number))throw new Error('Material properties must be finite SI values; leave unknowns blank.')
    return number
  }
  return {version:1,layers:draft.layers.map(l=>({...l,thicknessM:numeric(l.thicknessM),conductivityW_MK:numeric(l.conductivityW_MK),
    densityKgM3:numeric(l.densityKgM3),specificHeatJ_KgK:numeric(l.specificHeatJ_KgK)})),
    films:{inside:numeric(draft.films.inside),outside:numeric(draft.films.outside),source:draft.films.source},
    comparisonThicknessM:numeric(draft.comparisonThicknessM),glazing:{uValueW_M2K:numeric(draft.glazing.uValueW_M2K),
      shgc:numeric(draft.glazing.shgc),vlt:numeric(draft.glazing.vlt),source:draft.glazing.source}}
}
export function materialsDirty(draft:MaterialsDraft,saved:MaterialsDocument=emptyMaterials()):boolean {
  try{return JSON.stringify(materialsCommand(draft))!==JSON.stringify(saved)}
  catch{return true}
}
function AssemblyValues({value}:{value:AssemblyResult}) {
  if(!value.output)return <ul>{value.messages.map((message,i)=><li key={i}>{message}</li>)}</ul>
  return <dl className="materials-results">
    <div><dt>Resistance R (m²·K/W)</dt><dd>{value.output.resistanceM2K_W.toPrecision(6)}</dd></div>
    <div><dt>Transmittance U (W/(m²·K))</dt><dd>{value.output.uValueW_M2K.toPrecision(6)}</dd></div>
    <div><dt>Areal heat capacity (J/(m²·K))</dt><dd>{value.output.arealHeatCapacityJ_M2K.toPrecision(6)}</dd></div>
  </dl>
}
const propertyLabels={thicknessM:'Thickness (m)',conductivityW_MK:'Conductivity (W/(m·K))',
  densityKgM3:'Density (kg/m³)',specificHeatJ_KgK:'Specific heat (J/(kg·K))'}
export function MaterialsStudy({record,csrf,draft,onChange,onCommit,blocked}:{
  record:WorkspaceRecord;csrf:string;draft:MaterialsDraft;onChange:(value:MaterialsDraft)=>void
  onCommit:(value:MaterialsDocument)=>Promise<WorkspaceRecord|null>;blocked:boolean
}) {
  const [result,setResult]=useState<MaterialsResult|null>(null)
  const [presets,setPresets]=useState<MaterialPreset[]>([])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0)
  const saved=(record.document as typeof record.document & {materials?:MaterialsDocument}).materials??emptyMaterials()
  const dirty=materialsDirty(draft,saved)
  const latest=useRef({id:record.project_id,version:record.version,draft,blocked})
  latest.current={id:record.project_id,version:record.version,draft,blocked}
  useEffect(()=>{
    generation.current++;setResult(null);setBusy(false);setError('')
    return ()=>{generation.current++}
  },[record.project_id,record.version,draft,blocked])
  useEffect(()=>{setPresets([])},[record.project_id])
  function change(value:MaterialsDraft) {
    generation.current++;setResult(null);setBusy(false);setError('');onChange(value)
  }
  function addLayer(preset?:MaterialPreset) {
    const layer:MaterialLayer=preset?{id:crypto.randomUUID(),label:preset.label,source:preset.source+' '+preset.url,
      condition:preset.condition,thicknessM:preset.thicknessM,conductivityW_MK:preset.conductivityW_MK,
      densityKgM3:preset.densityKgM3,specificHeatJ_KgK:preset.specificHeatJ_KgK}:
      {id:crypto.randomUUID(),label:'',source:'',condition:'',thicknessM:null,conductivityW_MK:null,densityKgM3:null,specificHeatJ_KgK:null}
    change({...draft,layers:[...draft.layers,...materialsDraft({...emptyMaterials(),layers:[layer]}).layers]})
  }
  async function loadExamples() {
    const id=record.project_id,token=++generation.current
    setBusy(true);setError('')
    try {
      const examples=await materialOptions(id)
      if(token===generation.current&&latest.current.id===id)setPresets(examples)
    } catch(failure){if(token===generation.current)setError(errorMessage(failure))}
    finally{if(token===generation.current)setBusy(false)}
  }
  async function save(event:FormEvent) {
    event.preventDefault()
    if(busy||blocked)return
    setError('')
    try{await onCommit(materialsCommand(draft))}
    catch(failure){setError(errorMessage(failure))}
  }
  async function evaluate() {
    if(busy||blocked||dirty)return
    const token=++generation.current
    setBusy(true);setError('');setResult(null)
    try {
      const response=await evaluateMaterials(record,csrf)
      if(token!==generation.current||latest.current.id!==record.project_id||latest.current.version!==record.version
        ||latest.current.draft!==draft||latest.current.blocked)return
      if(response.project_id!==record.project_id||response.version!==record.version)throw new Error('Materials response belongs to an outdated workspace.')
      setResult(response);setPresets(response.presets)
    } catch(failure){if(token===generation.current)setError(errorMessage(failure))}
    finally{if(token===generation.current)setBusy(false)}
  }
  const current=result?.project_id===record.project_id&&result.version===record.version&&!dirty&&!blocked?result:null
  return <section className="materials-study" aria-label="Material assembly descriptors">
    <h2>Materials & assemblies</h2>
    <p>Python calculates the existing homogeneous series-layer method: R = Rinside + Σ(d/k) + Routside,
      U = 1/R, areal heat capacity = Σ(ρ·c·d). Explicit SI properties only; blank means unknown.
      No material-to-room assignment, indoor temperature, energy use or comfort prediction.</p>
    <p>Inputs below are {dirty?'unsaved drafts':'applied'}; workspace revision {record.version}.
      Saving is one Undoable workspace command, independent of Site and other drafts.</p>
    {blocked&&<p role="status">Resolve the workspace conflict or wait for the current save. Your material draft is retained.</p>}
    <form onSubmit={save}><fieldset disabled={blocked||busy}><legend>Authored assembly and separate glazing inputs</legend>
      <div className="materials-actions">
        <button type="button" onClick={()=>addLayer()}>Add unknown layer</button>
        <button type="button" onClick={loadExamples}>Show sourced examples</button>
      </div>
      {presets.length>0&&<details open><summary>Sourced examples, not product recommendations</summary>
        <p>Adding an example is explicit and does not replace your layers. Its example thickness is an assumption;
          review product, moisture and temperature applicability. These are the incumbent Materials presets.</p>
        {presets.map(p=><div className="materials-example" key={p.id}><strong>{p.label}</strong>
          <p>{p.source} {p.condition}</p><a href={p.url} target="_blank" rel="noopener noreferrer">Read source</a>{' '}
          <button type="button" onClick={()=>addLayer(p)}>Add this example as a layer</button></div>)}
      </details>}
      {!draft.layers.length&&<p>No assembly layers specified. Add a layer or an explicitly selected sourced example.</p>}
      {draft.layers.map((layer,index)=><fieldset key={layer.id} className="materials-layer"><legend>Layer {index+1} · stable ID {layer.id}</legend>
        <div className="materials-fields">
          <label>Material / layer label<input value={layer.label} maxLength={200} onChange={e=>change({...draft,layers:draft.layers.map(l=>l.id===layer.id?{...l,label:e.target.value}:l)})}/></label>
          {materialNumbers.map(key=><label key={key}>{propertyLabels[key]}
            <input type="number" step="any" min="0" value={layer[key]} onChange={e=>change({...draft,layers:draft.layers.map(l=>l.id===layer.id?{...l,[key]:e.target.value}:l)})}/></label>)}
          <label>Property source / product / explicit hypothetical basis<textarea value={layer.source} maxLength={2000}
            onChange={e=>change({...draft,layers:draft.layers.map(l=>l.id===layer.id?{...l,source:e.target.value}:l)})}/></label>
          <label>Moisture / temperature / specimen conditions<textarea value={layer.condition} maxLength={1000}
            onChange={e=>change({...draft,layers:draft.layers.map(l=>l.id===layer.id?{...l,condition:e.target.value}:l)})}/></label>
        </div>
        <button type="button" onClick={()=>change({...draft,layers:draft.layers.filter(l=>l.id!==layer.id)})}>Remove layer {index+1}</button>{' '}
        <button type="button" disabled={index===0} onClick={()=>{
          const layers=[...draft.layers];[layers[index-1],layers[index]]=[layers[index],layers[index-1]];change({...draft,layers})
        }}>Move layer {index+1} earlier</button>
      </fieldset>)}
      <p>Specific heat must be in J/(kg·K): multiply a sourced kJ/(kg·K) value by 1000 before entering.
        Layer order is retained; this descriptor does not calculate dynamic lag.</p>
      <div className="materials-fields">
        {(['inside','outside'] as const).map(key=><label key={key}>{key==='inside'?'Inside':'Outside'} film R (m²·K/W; explicit zero allowed)
          <input type="number" min="0" step="any" value={draft.films[key]} onChange={e=>change({...draft,films:{...draft.films,[key]:e.target.value}})}/></label>)}
        <label>Film boundary / source / hypothetical assumption<textarea maxLength={2000} value={draft.films.source}
          onChange={e=>change({...draft,films:{...draft.films,source:e.target.value}})}/></label>
        <label>Equal-thickness example comparison (m; blank unknown)<input type="number" min="0" step="any" value={draft.comparisonThicknessM}
          onChange={e=>change({...draft,comparisonThicknessM:e.target.value})}/></label>
      </div>
      <details><summary>Separate whole-window glazing properties</summary>
        <p>Whole-window U, SHGC and VLT are independently supplied product/test values. Glass d/k is not whole-window U.
          SHGC is not VLT; neither creates a solar gain or a lux result here.</p>
        <div className="materials-fields">
          {([['uValueW_M2K','Whole-window U (W/(m²·K))'],['shgc','SHGC (0–1)'],['vlt','Visible transmittance / VLT (0–1)']] as const).map(([key,label])=>
            <label key={key}>{label}<input type="number" min="0" max={key==='uValueW_M2K'?undefined:1} step="any" value={draft.glazing[key]}
              onChange={e=>change({...draft,glazing:{...draft.glazing,[key]:e.target.value}})}/></label>)}
          <label>Glazing source / product / hypothetical basis<textarea maxLength={2000} value={draft.glazing.source}
            onChange={e=>change({...draft,glazing:{...draft.glazing,source:e.target.value}})}/></label>
        </div>
      </details>
      <button className="primary" disabled={!dirty}>Apply material inputs</button>
    </fieldset></form>
    <div className="materials-actions"><button type="button" disabled={blocked||busy||dirty} onClick={evaluate}>
      {busy?'Working…':'Evaluate applied assemblies in Python'}</button>
      <button type="button" onClick={()=>{generation.current++;setBusy(false);setResult(null);setError('')}}>Clear result / ignore pending study</button></div>
    {dirty&&<p role="status">Apply materials before evaluating. Other tabs' unsaved drafts are not consumed.</p>}
    {error&&<p role="alert">{error}</p>}
    {current&&<div aria-live="polite"><h3>Applied assembly descriptors · revision {current.version}</h3>
      <AssemblyValues value={current.result.selected}/>
      <h3>Equal-thickness sourced example comparisons</h3>
      {current.result.comparisons.map(c=><section key={c.id}><h4>{c.label} · {c.thicknessM??'unknown'} m</h4>
        <p>{c.source} <a href={c.url} target="_blank" rel="noopener noreferrer">Source</a></p><AssemblyValues value={c}/></section>)}
      <h3>Glazing: {current.result.glazing.status==='supplied'?'supplied values, not calculated':'prerequisites'}</h3>
      {current.result.glazing.status==='supplied'?<p>U: {current.result.glazing.inputs.uValueW_M2K} W/(m²·K);
        SHGC: {current.result.glazing.inputs.shgc}; VLT: {current.result.glazing.inputs.vlt}. {current.result.glazing.inputs.source}</p>:
        <ul>{current.result.glazing.messages.map((m,i)=><li key={i}>{m}</li>)}</ul>}
      <ul>{current.result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
      <details><summary>Method, exact applied inputs and fingerprint</summary><pre>{JSON.stringify(current.result,null,2)}</pre></details>
    </div>}
  </section>
}
