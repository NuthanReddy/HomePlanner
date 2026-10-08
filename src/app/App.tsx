import { useEffect, useState } from 'react'
import type { LegacyPlannerIntegrationError } from '../domain/project/legacy-planner-api'
import type { PlannerApi } from '../domain/project/planner-api'
import { PlotPlannerWorkspace } from '../features/plot-planner/PlotPlannerWorkspace'
import type { PlotPlannerWorkspaceInput } from '../features/plot-planner/types'
import { PlannerProvider } from './PlannerProvider'
import {
  prohibitedWorkspace,
  workspaceDestinations,
  workspaceDetails,
  workspaceFromSearch,
  workspaceURL,
  canonicalWorkspaceURL,
  type WorkspaceSelection,
} from './workspace'

export type AppProps = Readonly<{
  plannerApi?: PlannerApi
  integrationDiagnostic?: LegacyPlannerIntegrationError
}>

const legacyPlotPlannerHref = import.meta.env.DEV
  ? './index.html?workspace=optimizer&section=plot'
  : undefined

const standalonePlotPlannerBoundary: PlotPlannerWorkspaceInput = {
  inputs: [
    {
      id: 'plot-boundary',
      label: 'Plot boundary and orientation',
      status: 'unavailable',
      reason:
        'No shared project view is connected to this preview boundary.',
    },
    {
      id: 'setbacks',
      label: 'Setbacks and buildable plate',
      status: 'legacy-handoff',
      description:
        'Continue using the existing Plot Planner for authored site inputs.',
      href: legacyPlotPlannerHref,
    },
    {
      id: 'floor-count',
      label: 'Floor count and feasibility',
      status: 'future-control',
      description:
        'A migrated control will be introduced only with an explicit typed contract.',
    },
    {
      id: 'regulatory-sources',
      label: 'Regulatory sources',
      status: 'future-control',
      description:
        'Source-backed references will be connected here without inventing calculations.',
    },
  ],
}

export function App({ plannerApi, integrationDiagnostic }: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceSelection>(() =>
    workspaceFromSearch(window.location.search),
  )
  const selectedWorkspace = workspaceDetails(workspace)

  useEffect(() => {
    const syncWorkspaceFromURL = () => {
      const canonicalURL = canonicalWorkspaceURL(window.location.search)
      if (canonicalURL) window.history.replaceState(null, '', canonicalURL)
      setWorkspace(workspaceFromSearch(window.location.search))
    }

    syncWorkspaceFromURL()
    window.addEventListener('popstate', syncWorkspaceFromURL)
    return () => window.removeEventListener('popstate', syncWorkspaceFromURL)
  }, [])

  const selectWorkspace = (selection: WorkspaceSelection) => {
    if (selection === workspace) return
    window.history.pushState(null, '', workspaceURL(selection))
    setWorkspace(selection)
  }

  const preview = (
    <main className="migration-shell">
      <header className="migration-header">
        <div className="migration-identity">
          <p className="preview-eyebrow">Phase 8 · Migration preview</p>
          <h1>HomePlanner</h1>
        </div>

        <div className="migration-status" role="status">
          <span className="preview-status-dot" aria-hidden="true" />
          {plannerApi
            ? 'React shell connected to the existing planner authority'
            : 'Standalone React shell preview — legacy workspaces remain active'}
        </div>
      </header>

      {integrationDiagnostic ? (
        <section
          className="integration-diagnostic"
          role="alert"
          aria-labelledby="integration-diagnostic-title"
        >
          <p className="preview-eyebrow">Legacy integration unavailable</p>
          <h2 id="integration-diagnostic-title">
            The React shell is continuing without planner integration
          </h2>
          <p>{integrationDiagnostic.message}</p>
          <p className="preview-note">
            The legacy global was detected but did not pass the typed adapter
            validation. No planner provider was created and the standalone
            migration preview remains available.
          </p>
        </section>
      ) : null}

      <nav className="workspace-nav" aria-label="Migration preview workspaces">
        <ul>
          {workspaceDestinations.map((destination) => (
            <li key={destination.id}>
              <button
                type="button"
                aria-current={workspace === destination.id ? 'page' : undefined}
                onClick={() => selectWorkspace(destination.id)}
              >
                {destination.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {workspace === 'site' ? (
        <PlotPlannerWorkspace {...standalonePlotPlannerBoundary} />
      ) : (
        <section
          className="workspace-preview"
          aria-labelledby="workspace-preview-title"
        >
          <p className="preview-eyebrow">
            {workspace === prohibitedWorkspace.id
              ? 'Compatibility destination'
              : 'Workspace destination'}
          </p>
          <h2 id="workspace-preview-title">{selectedWorkspace.label}</h2>
          <p>{selectedWorkspace.description}.</p>
          <p className="preview-note">
            This destination is navigation-only in the React migration preview.
            It does not load planner data, saved state, or legacy workspace UI.
          </p>
        </section>
      )}

    </main>
  )

  if (!plannerApi) return preview

  return <PlannerProvider plannerApi={plannerApi}>{preview}</PlannerProvider>
}
