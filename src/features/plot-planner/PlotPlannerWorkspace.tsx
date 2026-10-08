import type { PlotPlannerInputContract, PlotPlannerWorkspaceInput } from './types'

function statusLabel(input: PlotPlannerInputContract) {
  switch (input.status) {
    case 'unavailable':
      return 'Unavailable'
    case 'legacy-handoff':
      return 'Legacy handoff'
    case 'future-control':
      return 'Future migration'
  }
}

function InputStatus({ input }: { input: PlotPlannerInputContract }) {
  return (
    <li className={`plot-planner-input plot-planner-input--${input.status}`}>
      <div className="plot-planner-input-heading">
        <h3>{input.label}</h3>
        <span className="plot-planner-status">{statusLabel(input)}</span>
      </div>
      {input.status === 'unavailable' ? (
        <p>{input.reason}</p>
      ) : (
        <p>{input.description}</p>
      )}
      {input.status === 'legacy-handoff' && input.href ? (
        <a className="preview-link plot-planner-input-link" href={input.href}>
          Open legacy input
        </a>
      ) : null}
    </li>
  )
}

export function PlotPlannerWorkspace({
  inputs,
}: PlotPlannerWorkspaceInput) {
  return (
    <section
      className="workspace-preview plot-planner-workspace"
      aria-labelledby="plot-planner-title"
    >
      <p className="preview-eyebrow">Phase 8 · Site boundary</p>
      <h2 id="plot-planner-title">Site / Plot Planner</h2>
      <p>
        This focused migration boundary owns the future Plot Planner surface.
        It does not read or duplicate legacy project state, calculate
        regulations, or author plot geometry.
      </p>

      <ul className="plot-planner-inputs" aria-label="Plot Planner input status">
        {inputs.map((input) => (
          <InputStatus key={input.id} input={input} />
        ))}
      </ul>

      <p className="preview-note">
        Existing Plot Planner calculations and saved inputs remain authoritative
        in the legacy planner until an explicit migration contract is added.
      </p>
    </section>
  )
}
