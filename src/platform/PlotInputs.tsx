import { useEffect, useState, type FormEvent } from 'react'
import { nativeApi, type Site } from './native-api'
import { errorMessage } from './api'

export type InputDraft = Record<string,string>
const directions: Record<string,string> = {N:'North',E:'East',S:'South',W:'West'}
export const plotNumericKeys=['width','depth','height_m','floor_height_m','floors','latitude','longitude',
  'setback_front_m','setback_rear_m','setback_left_m','setback_right_m'] as const
export function convertLengthDraft(value:string, from:string, to:string):string {
  if(value.trim()===''||from===to)return value
  if(!Number.isFinite(Number(value)))throw new Error('Enter a valid length before switching units.')
  return String(Number(value)*(from==='ft'?.3048:1)/(to==='ft'?.3048:1))
}
export function plotOptionsInput(value:InputDraft):Partial<Site> {
  const n=(key:string)=>{
    if(!value[key]?.trim())return null
    if(!Number.isFinite(Number(value[key])))throw new Error('Enter a finite plot or road dimension.')
    return Number(value[key])
  }
  return {width:n('width'),depth:n('depth'),units:value.units as Site['units'],facing:value.facing as Site['facing'],
    category:value.category as Site['category'],height_m:n('height_m'),floor_height_m:n('floor_height_m'),tdr:value.tdr==='true',
    roads:Object.fromEntries(['N','E','S','W'].map(edge=>{const v=n('road'+edge);return [edge,v===null?null:v*(value['roadUnit'+edge]==='ft'?.3048:1)]})) as Site['roads']}
}
export function PlotInputs({value,disabled,locating,onChange,onUnits,onSubmit,onDetect,id,csrf}:{
  value:InputDraft;disabled:boolean;locating:boolean;id:string;csrf:string
  onChange:(key:string,value:string)=>void;onUnits:(key:string,unit:string)=>void
  onSubmit:(event:FormEvent)=>void;onDetect:()=>void
}) {
  const [choices,setChoices]=useState<Awaited<ReturnType<typeof nativeApi.plotOptions>>|null>(null)
  const [optionsError,setOptionsError]=useState('')
  const optionKey=JSON.stringify(Object.fromEntries(['width','depth','units','facing','category','height_m','floor_height_m','tdr',
    'roadN','roadE','roadS','roadW','roadUnitN','roadUnitE','roadUnitS','roadUnitW'].map(key=>[key,value[key]])))
  useEffect(()=>{
    let active=true
    setChoices(null);setOptionsError('')
    const timer=setTimeout(()=>{
      let inputs:Partial<Site>
      try{inputs=plotOptionsInput(JSON.parse(optionKey) as InputDraft)}catch(failure){setOptionsError(errorMessage(failure));return}
      nativeApi.plotOptions(id,inputs,csrf).then(result=>{if(active)setChoices(result)})
        .catch(failure=>{if(active)setOptionsError(errorMessage(failure))})
    },250)
    return ()=>{active=false;clearTimeout(timer)}
  },[id,csrf,optionKey])
  const numeric=(key:string,label:string)=><label key={key}>{label}<input type="number" step="any" value={value[key]??''} onChange={e=>onChange(key,e.target.value)}/></label>
  const check=(key:string,label:string)=><label className="plot-check" key={key}><input type="checkbox" checked={value[key]==='true'} onChange={e=>onChange(key,String(e.target.checked))}/><span>{label}</span></label>
  const heights=choices?.heights??[]
  const selectedInvalid=value.height_m!==''&&!heights.includes(Number(value.height_m))
  const maxFloors=choices?.max_floors??0
  const invalidFloors=value.floors!==''&&Number(value.floors)>maxFloors
  const floorHeights=[3,3.2,3.5,3.65,4]
  const hasOtherHeight=value.floor_height_m!==''&&!floorHeights.includes(Number(value.floor_height_m))
  return <form className="plot-inputs" onSubmit={onSubmit}>
    <fieldset disabled={disabled} className="plot-card"><legend>Plot</legend>
      <label>Plot facing <span className="field-hint">Which side the road is on</span>
        <select aria-label="Plot facing" value={value.facing} onChange={e=>onChange('facing',e.target.value)}>
          <optgroup label="Single road">{['E','W','N','S'].map(edge=><option key={edge} value={edge}>{directions[edge]} facing</option>)}</optgroup>
          <optgroup label="Corner plot — two roads">{['NE','SE','SW','NW'].map(face=><option key={face} value={face}>{face.split('').map(edge=>directions[edge]).join('–')} corner</option>)}</optgroup>
        </select>
      </label>
      <label>Plot units<select aria-label="Plot units" value={value.units} onChange={e=>onUnits('units',e.target.value)}><option value="ft">Feet</option><option value="m">Metres</option></select></label>
      <div className="native-fields">
        {numeric('width',`East–west dimension (${value.units})`)}
        {numeric('depth',`North–south dimension (${value.units})`)}
      </div>
      <p className="field-hint">East–west runs along the north/south sides; north–south runs along the east/west sides. Changing display units preserves physical lengths.</p>
    </fieldset>
    <fieldset disabled={disabled} className="plot-card"><legend>Roads</legend>
      {value.facing?.split('').map(edge=><div className="road-input" key={edge}><h3>{directions[edge]} road</h3><div className="road-fields">
        {numeric('road'+edge,`${directions[edge]} road width`)}
        <label>Units<select aria-label={`${directions[edge]} road width units`} value={value['roadUnit'+edge]??'m'} onChange={e=>onUnits('roadUnit'+edge,e.target.value)}><option value="m">Metres</option><option value="ft">Feet</option></select></label>
      </div></div>)}
      <p className="field-hint">Each road has independent units. Positive roads below 9 m trigger the retained widening scenario. Unknown road widths stay blank.</p>
    </fieldset>
    <fieldset disabled={disabled} className="plot-card"><legend>Site Category</legend>
      <label>Site category<select aria-label="Site category" value={value.category} onChange={e=>onChange('category',e.target.value)}>
        <option value="B">B — New area / approved layout</option><option value="A">A — Old / congested / gram kantam / abadi</option>
      </select></label>
      <details><summary>Which one is mine?</summary><p>Category B represents the new-area/approved-layout scenario. Category A requires the local body's notified old/built-up-area classification; do not infer it from a road's appearance. Confirm the applicable category with the authority. It changes the sub-9 m road limits.</p></details>
      <label>Use<select aria-label="Use" value={value.use} onChange={e=>onChange('use',e.target.value)}><option value="res">Individual residential</option><option value="apt">Apartment / group housing</option><option value="com">Commercial / office</option></select></label>
    </fieldset>
    <fieldset disabled={disabled} className="plot-card"><legend>Building</legend>
      <label>Floor-to-floor height<select aria-label="Floor-to-floor height" value={value.floor_height_m} onChange={e=>onChange('floor_height_m',e.target.value)}>
        <option value="">Unknown — select</option>{floorHeights.map(height=><option key={height} value={height}>{height.toFixed(2)} m</option>)}
        {hasOtherHeight&&<option value={value.floor_height_m}>{value.floor_height_m} m — saved custom value</option>}
      </select></label>
      <label>Height band<select aria-label="Height band" value={value.height_m} onChange={e=>onChange('height_m',e.target.value)}>
        <option value="">Select a band</option>{heights.map(height=><option key={height} value={height}>{height} m{height===20?' — TDR band':height>=21?' — high-rise':''}</option>)}
        {selectedInvalid&&<option value={value.height_m}>{value.height_m} m — {choices?'not applicable; review':'awaiting input check'}</option>}
      </select></label>
      <p className="field-hint">{optionsError||choices?.message||'Checking draft plot/road options...'}</p>
      <label>Floors to plan<select aria-label="Floors to plan" value={value.floors} onChange={e=>onChange('floors',e.target.value)}>
        <option value="">Use the maximum allowed</option>{Array.from({length:Math.min(maxFloors,100)},(_,index)=>index+1).map(count=><option key={count} value={count}>{count===1?'G':`G+${count-1}`} ({count} floor{count===1?'':'s'})</option>)}
        {invalidFloors&&<option value={value.floors}>{value.floors} floors — {choices?'not applicable; review':'awaiting input check'}</option>}
      </select></label>
      {check('stilt','Stilt parking floor — separate from Table III habitable height')}
      {check('tdr','Use TDR — GO 95 relaxations and qualifying extra floors')}
      {check('compounding','Show 10% side/rear compounding — Rule 26(d)')}
      {check('custom_setbacks','Allow setback violations — custom what-if scenario only')}
      {value.custom_setbacks==='true'&&<div className="native-fields">{['front','rear','left','right'].map(role=>numeric(`setback_${role}_m`,`${role[0].toUpperCase()+role.slice(1)} setback (m)`))}</div>}
      <p className="field-hint">Custom setbacks are relative to the elected road/front. Values below required minima remain non-compliant. TDR, compounding and regularisation are not permission to construct.</p>
    </fieldset>
    <fieldset disabled={disabled} className="plot-card"><legend>Location</legend><div className="native-fields">
      {numeric('latitude','Latitude (degrees)')}{numeric('longitude','Longitude (degrees)')}
      </div><button type="button" disabled={locating} onClick={onDetect}>{locating?'Detecting...':'Detect current location'}</button>
      <p className="field-hint">Detection fills drafts only. Accuracy: {value.location_accuracy_m||'unknown'} m. Applying coordinates automatically determines the IANA time zone offline; see Environment.</p>
    </fieldset>
    <button className="primary" disabled={disabled||locating}>Apply plot inputs</button>
  </form>
}
