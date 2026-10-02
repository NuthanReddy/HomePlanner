import type {
  ContentFingerprint,
  DrawingSceneSnapshot,
  JsonObject,
  PlannerCommand,
  PlannerEvent,
  PlannerObserverErrorStatus,
  PlannerObserver,
  PlannerSceneSnapshot,
  PlannerSelection,
  PlannerSnapshot,
  PersistenceState,
  ProjectSnapshot,
  SnapshotPurpose,
  StudyRequestIdentity,
  StudyResultGuard,
  Unsubscribe,
} from './types'

export type SnapshotOptions = Readonly<{
  purpose: SnapshotPurpose
  engineId: string
  engineVersion: string
  inputs?: JsonObject
}>

/**
 * Type-only view of the existing window.HomePlanner authority.
 * The legacy bridge remains the runtime implementation.
 */
export interface PlannerApi {
  getProject(): ProjectSnapshot
  getScene(): PlannerSceneSnapshot | null
  getScenes(): readonly PlannerSceneSnapshot[]
  getDrawingScene(): DrawingSceneSnapshot
  getSelection(): PlannerSelection

  execute(command: PlannerCommand): ProjectSnapshot
  select(reference: PlannerSelection): void
  subscribe(observer: PlannerObserver): Unsubscribe
  getObserverErrors?(): readonly PlannerObserverErrorStatus[]

  canUndo(): boolean
  canRedo(): boolean
  undo(): boolean
  redo(): boolean

  inputFingerprint(inputs?: JsonObject): ContentFingerprint
  createSnapshot(options: SnapshotOptions): PlannerSnapshot

  exportProject(): string
  importProject(json: string): ProjectSnapshot
  replaceProject(project: ProjectSnapshot): ProjectSnapshot
  newProject(): ProjectSnapshot

  isBusy(): boolean
}

export interface PlannerPersistenceStatusApi {
  getState(): PersistenceState
  subscribe(observer: (state: PersistenceState) => void | PromiseLike<void>): Unsubscribe
  revisionToken(): string
}

export const isCurrentStudyResult: StudyResultGuard = (
  completed: StudyRequestIdentity,
  current: StudyRequestIdentity,
) =>
  completed.projectId === current.projectId &&
  completed.floorId === current.floorId &&
  completed.engineId === current.engineId &&
  completed.engineVersion === current.engineVersion &&
  completed.inputFingerprint === current.inputFingerprint &&
  completed.requestId === current.requestId

export type PlannerEventHandler<Type extends PlannerEvent['type']> = (
  event: PlannerEvent<Type>,
) => void | PromiseLike<void>
