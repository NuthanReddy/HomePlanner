export const workspaceDestinations = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Project summary and starting points',
  },
  {
    id: 'site',
    label: 'Site / Plot Planner',
    description: 'Plot, setbacks, and site context',
  },
  {
    id: 'design',
    label: 'Design',
    description: 'Layout and coordinated design tools',
  },
  {
    id: 'environment',
    label: 'Environment',
    description: 'Sun, envelope, airflow, and light studies',
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Scenario and option comparisons',
  },
  {
    id: 'report',
    label: 'Report',
    description: 'Drawings, schedules, and exports',
  },
] as const

export type WorkspaceDestination = (typeof workspaceDestinations)[number]['id']
export type WorkspaceSelection = WorkspaceDestination | 'prohibited'

export const prohibitedWorkspace = {
  id: 'prohibited',
  label: 'Prohibited Properties',
  description: 'Legacy Site / Plot Planner compatibility destination',
} as const

const workspaceIds = new Set<string>(
  workspaceDestinations.map(({ id }) => id),
)

export function workspaceFromSearch(search: string): WorkspaceSelection {
  const requested = new URLSearchParams(search).get('workspace')

  if (requested === prohibitedWorkspace.id) return prohibitedWorkspace.id
  if (requested && workspaceIds.has(requested)) {
    return requested as WorkspaceDestination
  }

  return 'overview'
}

export function canonicalWorkspaceURL(
  search: string,
  currentURL = window.location.href,
) {
  const url = new URL(currentURL)
  const requested = url.searchParams.getAll('workspace')
  if (requested.length === 0) return null
  const selection = workspaceFromSearch(search)
  if (requested.length === 1 && requested[0] === selection) return null
  url.searchParams.delete('workspace')
  url.searchParams.set('workspace', selection)
  return `${url.pathname}${url.search}${url.hash}`
}

export function workspaceDetails(selection: WorkspaceSelection) {
  if (selection === prohibitedWorkspace.id) return prohibitedWorkspace

  return workspaceDestinations.find(({ id }) => id === selection)!
}

export function workspaceURL(
  selection: WorkspaceSelection,
  currentURL = window.location.href,
) {
  const url = new URL(currentURL)
  url.searchParams.set('workspace', selection)
  return `${url.pathname}${url.search}${url.hash}`
}
