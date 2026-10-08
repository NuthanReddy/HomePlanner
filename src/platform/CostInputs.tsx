import type { FormEvent } from 'react'
import type { Costs } from './native-api'

type Draft=Record<string,string>
const SQYD_M2=.83612736, SQFT_M2=.09290304
const factors={
  land_inr_m2:SQYD_M2,land_sro_inr_m2:SQYD_M2,
  construction_inr_m2:SQFT_M2,stilt_inr_m2:SQFT_M2,
  brs_violated_m2:1/SQFT_M2,
}
const marker='legacy-area-v1'
function converted(value:string,factor:number) {
  if(value.trim()===''||!Number.isFinite(Number(value)))return value
  return String(Number((Number(value)*factor).toPrecision(15)))
}
export function normalizeCostDraft(value:Draft):Draft {
  const {flat_sro_inr_m2:unusedFlatSro,...retained}=value
  if(value.display_units===marker)return retained
  return {...retained,...Object.fromEntries(Object.entries(factors).filter(([key])=>key in value)
    .map(([key,factor])=>[key,converted(value[key],factor)])),display_units:marker}
}
export function costDraft(costs:Costs):Draft {
  return normalizeCostDraft(Object.fromEntries(Object.entries(costs).map(([key,value])=>[key,value===null?'':String(value)])))
}
export function costCommand(input:Draft,before:Costs):Costs {
  const value=normalizeCostDraft(input),baseline=costDraft(before)
  function numeric(key:keyof typeof factors|'registration_percent'|'gst_percent',factor=1):number|null {
    if(value[key]===baseline[key])return before[key]
    if(value[key].trim()==='')return null
    const parsed=Number(value[key])/factor
    if(!Number.isFinite(parsed))throw new Error('Enter finite cost rates, or leave unknown values blank.')
    return parsed
  }
  return {
    land_inr_m2:numeric('land_inr_m2',SQYD_M2),land_sro_inr_m2:numeric('land_sro_inr_m2',SQYD_M2),
    construction_inr_m2:numeric('construction_inr_m2',SQFT_M2),stilt_inr_m2:numeric('stilt_inr_m2',SQFT_M2),
    flat_sro_inr_m2:before.flat_sro_inr_m2,brs_violated_m2:numeric('brs_violated_m2',1/SQFT_M2),
    registration_percent:numeric('registration_percent'),gst_percent:numeric('gst_percent'),
    estimate_scope:value.estimate_scope as Costs['estimate_scope'],stilt_rate_mode:value.stilt_rate_mode as Costs['stilt_rate_mode'],
    lrs_mode:(value.lrs_mode||null) as Costs['lrs_mode'],brs_mode:(value.brs_mode||null) as Costs['brs_mode'],
    lrs_rebate:value.lrs_rebate===''?null:value.lrs_rebate==='true',
  }
}
export function CostInputs({value,disabled,onChange,onSubmit}:{
  value:Draft;disabled:boolean;onChange:(key:string,value:string)=>void;onSubmit:(event:FormEvent)=>void
}) {
  function number(key:keyof Costs,label:string,step:string) {
    return <label>{label}<input type="number" min="0" step={step} value={value[key]??''} onChange={e=>onChange(key,e.target.value)}/></label>
  }
  function select(key:keyof Costs,label:string,options:string[][]) {
    return <label>{label}<select aria-label={label} value={value[key]??''} onChange={e=>onChange(key,e.target.value)}>
      {options.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select></label>
  }
  const gstOptions=[['','Unknown — select'],['0','0% — no GST included / self-managed materials'],['18','18% — works contract with a contractor'],
    ['5','5% — under-construction purchase from a builder'],['1','1% — affordable housing']]
  if(value.gst_percent&&!gstOptions.some(([key])=>key===value.gst_percent))gstOptions.push([value.gst_percent,`${value.gst_percent}% — retained custom rate`])
  return <form onSubmit={onSubmit}><fieldset disabled={disabled}><legend>Cost inputs — legacy Plot Planner</legend>
    <p>Land rates are INR per <strong>sq yd</strong>; construction and stilt rates are INR per <strong>sq ft</strong>. Saved square-metre rates are converted for display without changing their physical value. Blank is unknown; zero is intentional.</p>
    <div className="native-fields">
      {select('estimate_scope','Estimate scope',[['partial','Supplied-rate subtotal only'],['legacy-schedule','Include retained LRS/BRS/impact/betterment/cess schedules']])}
    </div>
    <div className="native-fields">
      {number('land_inr_m2','Plot purchase rate (INR/sq yd)','any')}
      {number('land_sro_inr_m2','Land / plot SRO value (INR/sq yd)','any')}
      {number('construction_inr_m2','Construction cost (INR/sq ft built-up)','any')}
      {number('stilt_inr_m2','Stilt / parking cost (INR/sq ft)','any')}
      {select('stilt_rate_mode','Stilt rate basis',[['explicit','Explicit rate — blank remains unknown'],['legacy-55-percent','Use legacy 55% construction-rate assumption']])}
      {number('registration_percent','Stamp duty + transfer + registration (% of SRO value)','any')}
      {select('gst_percent','GST on construction',gstOptions)}
    </div>
    <p>Land purchase uses gross registered extent, including any widening strip. Registration/LRS/BRS use land SRO, not purchase price. Construction uses only the construction rate above; no flat SRO or onward-sale registration input is needed. Tax labels are scenarios, not eligibility findings.</p>
    <div className="native-fields">
      {select('lrs_mode','LRS — layout regularisation',[['','Unknown — select'],['na','Not required — approved layout'],['paid','Already paid'],['due','Payable — unapproved layout']])}
      {select('lrs_rebate','Apply 25% early-payment rebate',[['','Unknown eligibility'],['false','No rebate'],['true','Apply rebate — eligibility confirmed by user']])}
      {select('brs_mode','BRS — building regularisation',[['','Unknown — select'],['na','Not applicable'],['dev','Deviation from a sanctioned plan'],['unauth','Unauthorised — no permission taken'],['paid','Already paid']])}
      {number('brs_violated_m2','Violated built-up area (sq ft; all floors)','any')}
    </div>
    <p>{value.estimate_scope==='partial'?'LRS/BRS values are retained but excluded in supplied-rate scope. Select retained schedules to include applicable charges.':'Retained GO 131/135 and legacy GO 152/2015 schedules require current eligibility review. Already-paid charges are excluded, not refunded.'}
      {' '}Unlike the legacy blank-stilt shortcut, the 55% assumption requires explicit selection; no rate is silently invented.</p>
    <button className="primary">Apply cost inputs</button>
  </fieldset></form>
}
