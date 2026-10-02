declare const identityBrand: unique symbol

export type OpaqueString<Name extends string> = string & {
  readonly [identityBrand]: Name
}

export type ProjectId = OpaqueString<'ProjectId'>
export type FloorId = OpaqueString<'FloorId'>
export type SceneEntityId = OpaqueString<'SceneEntityId'>
export type StudyRequestId = OpaqueString<'StudyRequestId'>
export type ContentFingerprint = OpaqueString<'ContentFingerprint'>

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

declare const revisionBrand: unique symbol

export type ProjectRevision = number & {
  readonly [revisionBrand]: 'ProjectRevision'
}

export function isProjectRevision(value: number): value is ProjectRevision {
  return Number.isSafeInteger(value) && value >= 0
}

export function toProjectRevision(value: number): ProjectRevision {
  if (!isProjectRevision(value)) {
    throw new Error('Project revision must be a nonnegative safe integer.')
  }
  return value
}

export type LegacySnapshot = Readonly<{
  controls: JsonObject
  manualLayouts: readonly JsonValue[]
  context: JsonObject | null
  roomIdentities?: JsonObject
}> &
  JsonObject

export type FloorSnapshot = Readonly<{
  id: FloorId
  name: string
  heightM: number
  wallHeightM?: number
  legacy: LegacySnapshot
}> &
  JsonObject

/**
 * The validated schema-1 document returned by HomePlanner.getProject().
 * Known authority fields are named here; feature-owned same-schema JSON remains
 * available through the open JsonObject contract.
 */
export type ProjectSnapshot = Readonly<{
  schemaVersion: 1
  id: ProjectId
  name?: string
  revision: ProjectRevision
  updatedAt?: string
  site: JsonObject
  building: JsonObject
  environment: JsonObject
  activeFloorId: FloorId
  floors: readonly FloorSnapshot[]
  legacy: LegacySnapshot
}> &
  JsonObject

export type SceneReference<Kind extends string = string> = Readonly<{
  kind: Kind
  id: SceneEntityId
}>

export type OwnedSceneReference<Kind extends string = string> = Readonly<{
  projectId: ProjectId
  floorId: FloorId
  reference: SceneReference<Kind>
}>

export type PlannerSelection = SceneReference | null

export type PlannerSceneSnapshot = Readonly<{
  revision: ProjectRevision
  floorId: FloorId
}> &
  JsonObject

export type DrawingSceneDiagnostic = Readonly<{
  code: string
  reference: JsonValue
}> &
  JsonObject

export type DrawingSceneSnapshot = Readonly<{
  version: 1
  kind: 'DrawingScene'
  projectId: ProjectId
  revision: ProjectRevision
  inputFingerprint: ContentFingerprint
  siteDatum: JsonObject
  scenes: readonly JsonValue[]
  authored: readonly JsonValue[]
  documentation: JsonObject
  diagnostics: readonly DrawingSceneDiagnostic[]
}> &
  JsonObject

export type SnapshotPurpose = 'drawing' | 'analysis' | 'export'

export type SnapshotProvenance = Readonly<{
  projectId: ProjectId
  revision: ProjectRevision
  inputFingerprint: ContentFingerprint
  engineId: string
  engineVersion: string
}>

export type PlannerSnapshot = Readonly<{
  version: 1
  purpose: SnapshotPurpose
  provenance: SnapshotProvenance
  inputs: JsonObject
  drawing: DrawingSceneSnapshot
}> &
  JsonObject

export type PlannerCommand<Type extends string = string> = Readonly<{
  type: Type
  [key: string]: JsonValue
}>

export type PlannerEventType =
  | 'change'
  | 'navigation'
  | 'project'
  | 'restore'
  | 'selection'

export type PlannerEvent<
  Type extends PlannerEventType = PlannerEventType,
> = Readonly<{
  type: Type
  project: ProjectSnapshot
  scene: PlannerSceneSnapshot | null
  selection: PlannerSelection
}>

export type PlannerObserver = (
  event: PlannerEvent,
) => void | PromiseLike<void>

export type Unsubscribe = () => void

export type PersistenceStatus =
  | 'busy'
  | 'error'
  | 'saved'
  | 'saving'
  | 'unsaved'

export type PlannerErrorStatus = Readonly<{
  code: string
  message: string
}>

export type PlannerObserverErrorStatus = PlannerErrorStatus &
  Readonly<{
    eventType?: PlannerEventType
    projectId?: ProjectId
    revision?: ProjectRevision
    observer?: number
    errorName?: string
  }>

export type SavedProjectSummary = Readonly<{
  id: ProjectId
  name: string
  revision: ProjectRevision | null
  updatedAt: string | null
  unreadable: boolean
  error: PlannerErrorStatus | null
}>

export type PersistenceState = Readonly<{
  available: boolean
  connecting: boolean
  initialized: boolean
  autosave: boolean
  paused: boolean
  saving: boolean
  savingRevision: ProjectRevision | null
  busy: boolean
  current: Readonly<{
    id: ProjectId
    name: string
    revision: ProjectRevision
  }>
  dirty: boolean
  draftCount: number
  projects: readonly SavedProjectSummary[]
  selectedId: ProjectId | ''
  pendingRestoreId: ProjectId | null
  lastSavedAt: string | null
  error: PlannerErrorStatus | null
  observerError: PlannerErrorStatus | null
  notice: string
  status: PersistenceStatus
}>

/**
 * Revision is retained as provenance, while freshness is owned by the project,
 * floor, engine contract, input fingerprint, and current request.
 */
export type StudyRequestIdentity = Readonly<{
  projectId: ProjectId
  floorId: FloorId | null
  revision: ProjectRevision
  inputFingerprint: ContentFingerprint
  engineId: string
  engineVersion: string
  requestId: StudyRequestId
}>

export type AsyncStudyRequest<
  Inputs extends JsonValue = JsonValue,
> = Readonly<{
  identity: StudyRequestIdentity
  inputs: Inputs
}>

export type AsyncStudyResult<
  Result extends JsonValue = JsonValue,
  Status extends string = string,
> = Readonly<{
  identity: StudyRequestIdentity
  status: Status
  result: Result | null
  error: PlannerErrorStatus | null
}>

export type StudyResultGuard = (
  completed: StudyRequestIdentity,
  current: StudyRequestIdentity,
) => boolean
