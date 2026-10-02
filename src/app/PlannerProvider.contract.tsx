import type { ReactElement } from 'react'
import type { PlannerApi } from '../domain/project/planner-api'
import { PlannerProvider, usePlanner } from './PlannerProvider'

function PlannerConsumerExample() {
  const planner = usePlanner()

  return (
    <output aria-live="polite">
      {planner.project.name ?? planner.project.id}
      {planner.busy ? ' is busy' : ' is ready'}
    </output>
  )
}

export function PlannerProviderExample({
  plannerApi,
}: {
  plannerApi: PlannerApi
}): ReactElement {
  return (
    <PlannerProvider plannerApi={plannerApi}>
      <PlannerConsumerExample />
    </PlannerProvider>
  )
}
