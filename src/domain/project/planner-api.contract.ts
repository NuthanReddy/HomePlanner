import { isCurrentStudyResult, type PlannerApi } from './planner-api'
import type {
  AsyncStudyResult,
  FloorId,
  PlannerCommand,
  ProjectId,
  StudyRequestIdentity,
} from './types'

const rename = {
  type: 'rename-project',
  name: 'Typed project',
} satisfies PlannerCommand<'rename-project'>

function exercisePlannerApi(
  authority: PlannerApi,
  result: AsyncStudyResult,
  currentStudy: StudyRequestIdentity,
) {
  const project = authority.getProject()
  const activeFloor = project.floors.find(
    (floor) => floor.id === project.activeFloorId,
  )
  const inactiveFloors = project.floors.filter(
    (floor) => floor.id !== project.activeFloorId,
  )

  authority.execute(rename)
  const unsubscribe = authority.subscribe((event) => {
    if (event.type === 'selection' && event.selection) {
      event.selection.id
    }
  })

  return {
    projectId: project.id,
    activeFloorId: project.activeFloorId,
    activeFloor,
    inactiveFloors,
    acceptedResult: isCurrentStudyResult(result.identity, currentStudy),
    unsubscribe,
  }
}

type ExerciseResult = ReturnType<typeof exercisePlannerApi>

export type ContractExamples = ExerciseResult &
  Readonly<{
    projectId: ProjectId
    activeFloorId: FloorId
  }>
