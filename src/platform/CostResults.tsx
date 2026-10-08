import type { EvaluationPart } from './native-api'

const states = {
  included:'Included', 'already-paid':'Already paid — excluded', 'not-applicable':'Declared not applicable',
  'not-selected':'Not selected', 'included-in-BRS':'Included in BRS — not added again',
}
type CostLine = {label:string; amount_inr:number; state:keyof typeof states; basis:string}
function finite(value:unknown):value is number { return typeof value==='number'&&Number.isFinite(value) }
function isLine(value:unknown):value is CostLine {
  if(!value||typeof value!=='object')return false
  const line=value as Record<string,unknown>
  return typeof line.label==='string'&&finite(line.amount_inr)&&typeof line.basis==='string'
    &&typeof line.state==='string'&&Object.hasOwn(states,line.state)
}
const money=(value:unknown)=>finite(value)?value.toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}):'Unknown'
const area=(value:unknown)=>finite(value)?`${(value/.09290304).toLocaleString(undefined,{maximumFractionDigits:2})} sq ft`:'Unknown'

export function CostResults({value}:{value:EvaluationPart|undefined}) {
  if(!value)return <p role="status">Waiting for the applied Python cost estimate.</p>
  if(value.status!=='computed')return <section aria-label="Cost prerequisites"><h3>Cost inputs needed</h3>
    {value.messages.map((message,index)=><p key={index}>{message}</p>)}</section>
  if(!Array.isArray(value.line_items)||!value.line_items.every(isLine)||!finite(value.subtotal_inr))
    return <p role="alert">Invalid cost breakdown response. Reload the current API; no estimate is displayed.</p>
  return <section aria-label="Applied cost estimate">
    <h3>{value.estimate_scope==='legacy-schedule'?'Retained-schedule estimate':'Supplied-rate subtotal'}</h3>
    <p>Applied inputs only. This is a bounded estimate, not an all-in quote, current fee demand or tax advice.</p>
    {value.non_compliant===true&&<p className="error" role="status">Non-compliant custom-setback scenario. These costs do not establish eligibility to build or regularise.</p>}
    <dl className="native-results">
      <div><dt>Estimated subtotal</dt><dd>{money(value.subtotal_inr)}</dd></div>
      <div><dt>Costed usable built-up</dt><dd>{area(value.costed_built_up_m2)}</dd></div>
      <div><dt>Cost per built-up sq ft</dt><dd>{money(value.inr_per_built_ft2)}</dd></div>
      <div><dt>Costed usable footprint</dt><dd>{area(value.costed_footprint_m2)}</dd></div>
    </dl>
    <div className="table-scroll cost-table" tabIndex={0} role="region" aria-label="Cost breakdown and calculation basis">
      <table><caption>Included subtotal: land, construction and selected charges</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Amount (INR)</th><th scope="col">Treatment and basis</th></tr></thead>
        <tbody>{value.line_items.map(line=><tr key={line.label}>
          <th scope="row">{line.label}</th><td>{money(line.amount_inr)}</td>
          <td><strong>{states[line.state]}</strong><br/>{line.basis}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Estimated subtotal</th><td>{money(value.subtotal_inr)}</td><td>Only the rows above are included.</td></tr></tfoot>
      </table>
    </div>
    <details><summary>Sources, assumptions and excluded charges</summary>
      {value.messages.map((message,index)=><p key={index}>{message}</p>)}
      <p><a href="https://buildnow.telangana.gov.in/go-and-act/" target="_blank" rel="noreferrer">Verify current GOs and amendments at BuildNow</a>.
        Retained schedule editions are identified per line; no fresh legal-eligibility check is implied.</p>
    </details>
  </section>
}
