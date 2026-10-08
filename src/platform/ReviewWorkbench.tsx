import { useEffect, useState } from 'react'
import type { PlannerApi } from '../domain/project/planner-api'

interface ReviewRow {
  label: string; detail: string; result: string; status: 'pass' | 'warn' | 'fail'
  score?: number; key?: string; fixAction?: string; fixLabel?: string
}
type ReviewScope = 'science' | 'green' | 'vastu'
interface ReviewState {
  projectId: string; floorId: string; revision: number; fingerprint: string
  scopes: Record<ReviewScope, ReviewRow[]>
  enabled: Record<ReviewScope, boolean>
  pendingInputs: number; canUndoFix: boolean; undoLabel: string | null
  wind: string | null; placed: number
}
interface ReviewOwner {
  getState(): ReviewState
  fix(scope: ReviewScope, key: string): string
  fixAll(): string
  undoFix(): string
}
const titles: Record<ReviewScope, string> = {
  science: 'Science · daylight & ventilation',
  green: 'Green-building comparison',
  vastu: 'Vastu · optional cultural preferences',
}

export function ReviewWorkbench({ planner, onLayout }: { planner: PlannerApi; onLayout?: () => void }) {
  const [, rerender] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setMessage(''); setError('')
    return planner.subscribe(() => rerender(value => value + 1))
  }, [planner])
  const registry = (window as unknown as {
    HomePlannerDesignRuntime?: { getReview?(planner: PlannerApi): ReviewOwner | null }
  }).HomePlannerDesignRuntime
  const owner = registry?.getReview?.(planner)
  const state = owner?.getState()
  const action = (run: () => string) => {
    setError('')
    try { setMessage(run()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    rerender(value => value + 1)
  }
  if (!owner || !state) return <p role="status">Review needs the current native Layout controller. Open or apply a layout first; no substitute scorecard is computed.</p>
  const available = Object.values(state.scopes).flat().some(row =>
    row.fixAction && row.status !== 'pass' && (row.score ?? 0) < 1 - 1e-6)
  const diagnostics = planner.getScene()?.diagnostics
  return <section className="native-review" aria-label="Current layout placement review">
    <h2>Placement review</h2>
    <p>Existing schematic scorecards for the current floor, not measured light, solved airflow, certification or approval.
      Vastu is optional, cultural and non-statutory; it never overrides safety or technical requirements.</p>
    <div className="native-review-actions">
      <button disabled={!available || !!state.pendingInputs} onClick={() => action(() => owner.fixAll())}>Fix all feasible</button>
      <button disabled={!state.canUndoFix || !!state.pendingInputs} onClick={() => action(() => owner.undoFix())}>Undo last fix</button>
      <button onClick={onLayout}>Inspect in Layout</button>
    </div>
    {!!state.pendingInputs && <p role="status">Apply or discard the {state.pendingInputs} pending Layout input draft(s) before applying fixes. Review reads committed geometry only.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!!state.undoLabel && !state.canUndoFix && <p>Later project changes are protected. Use shared Undo in order rather than overwriting those edits.</p>}
    <p className="discipline-source">Revision {state.revision} · {state.placed} placed rooms · selected heuristic wind {state.wind ?? 'unknown'}.
      Preferences and opening settings are the existing Layout controls. Saved weather is not pressure forcing.</p>
    {(['science', 'green', 'vastu'] as const).map(scope => {
      const rows = state.scopes[scope]
      return <details key={scope} className="native-review-lens" open={scope === 'science'}>
        <summary>{titles[scope]} · {!state.enabled[scope] ? 'Off' : `${rows.filter(row => row.status !== 'pass').length} review items`}</summary>
        {!state.enabled[scope] ? <p>Enable this optional comparison in Layout → planning preferences. Navigation does not enable it.</p> :
          !state.placed ? <p>Waiting for placed rooms. Unplaced rooms cannot be assessed.</p> :
            <div className="native-review-table" tabIndex={0} role="region" aria-label={`${titles[scope]} scrollable checklist`}>
              <table><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Action</th></tr></thead>
                <tbody>{rows.map((row, index) => <tr key={row.key || `${row.label}-${index}`}>
                  <th scope="row">{row.label}<details><summary>Basis &amp; limits</summary><p>{row.detail}</p></details></th>
                  <td><span data-review-status={row.status}>{row.result}</span></td>
                  <td>{row.status !== 'pass' && row.fixAction && row.key && (row.score ?? 0) < 1 - 1e-6 ?
                    <button disabled={!!state.pendingInputs} onClick={() => action(() => owner.fix(scope, row.key!))}>{row.fixLabel || 'Fix'}</button>
                    : row.status !== 'pass' ? 'Manual step' : 'No schematic action'}</td>
                </tr>)}</tbody>
              </table>
            </div>}
      </details>
    })}
    <details><summary>Method, sources &amp; limitations</summary>
      <p>The unchanged incumbent science/green/Vastu scoring and fix strategies run on the actual active-floor context.
        Window fractions and side-light reach remain geometric proxies, not lux, annual daylight metrics, ventilation rates or measured performance.
        IGBC/LEED rows retain their edition and applicability notes under Basis &amp; limits. No points or approval are awarded.</p>
      <p>Fixes retain a change only after the incumbent target or aggregate heuristic improves; otherwise they roll back.
        Fix all is one shared Undo step. Undo last fix is available only while that exact post-fix project remains current, so it cannot discard later unrelated work.</p>
      <p><a href="https://ecbc.in/econiwas.html" target="_blank" rel="noopener noreferrer">BEE Eco-Niwas Samhita</a> ·{' '}
        <a href="https://www.igbc.in/igbcgreenhomes" target="_blank" rel="noopener noreferrer">IGBC Green Homes</a> ·{' '}
        <a href="https://www.usgbc.org/node/12006706" target="_blank" rel="noopener noreferrer">LEED Residential daylight/views</a></p>
    </details>
    {Array.isArray(diagnostics) && diagnostics.length > 0 && <details><summary>Additional shared-model diagnostics · {diagnostics.length}</summary>
      <ul>{diagnostics.map((item, index) => <li key={index}>{typeof item === 'object' && item ? String(item.message || item.code || 'Model diagnostic') : String(item)}</li>)}</ul>
    </details>}
  </section>
}
