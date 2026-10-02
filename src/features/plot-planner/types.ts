import type { ProjectSnapshot } from '../../domain/project/types'

export type PlotPlannerInputId =
  | 'plot-boundary'
  | 'setbacks'
  | 'floor-count'
  | 'regulatory-sources'

export type PlotPlannerInputContract =
  | Readonly<{
      id: PlotPlannerInputId
      label: string
      status: 'unavailable'
      reason: string
    }>
  | Readonly<{
      id: PlotPlannerInputId
      label: string
      status: 'legacy-handoff'
      description: string
      href?: string
    }>
  | Readonly<{
      id: PlotPlannerInputId
      label: string
      status: 'future-control'
      description: string
    }>

export type PlotPlannerWorkspaceInput = Readonly<{
  inputs: readonly PlotPlannerInputContract[]
  legacyPlannerHref?: string
  project?: ProjectSnapshot
}>
