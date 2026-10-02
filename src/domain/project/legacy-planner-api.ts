import type { PlannerApi } from './planner-api'

export type LegacyPlannerIntegrationErrorCode =
  | 'LegacyPlannerGlobalUnavailableError'
  | 'LegacyPlannerApiIncompleteError'

export class LegacyPlannerIntegrationError extends Error {
  readonly code: LegacyPlannerIntegrationErrorCode
  readonly missingMethods: readonly string[]

  constructor(
    code: LegacyPlannerIntegrationErrorCode,
    message: string,
    missingMethods: readonly string[] = [],
  ) {
    super(message)
    this.name = 'LegacyPlannerIntegrationError'
    this.code = code
    this.missingMethods = Object.freeze([...missingMethods])
  }
}

type RequiredPlannerApiMethod = {
  [Method in keyof PlannerApi]-?: undefined extends PlannerApi[Method]
    ? never
    : PlannerApi[Method] extends (...args: never[]) => unknown
      ? Method
      : never
}[keyof PlannerApi]

const requiredMethods = {
  getProject: true,
  getScene: true,
  getScenes: true,
  getDrawingScene: true,
  getSelection: true,
  execute: true,
  select: true,
  subscribe: true,
  canUndo: true,
  canRedo: true,
  undo: true,
  redo: true,
  inputFingerprint: true,
  createSnapshot: true,
  exportProject: true,
  importProject: true,
  replaceProject: true,
  newProject: true,
  isBusy: true,
} as const satisfies Record<RequiredPlannerApiMethod, true>

const requiredMethodNames = Object.keys(
  requiredMethods,
) as RequiredPlannerApiMethod[]

type LegacyPlannerWindow = Window &
  Readonly<{
    HomePlanner?: unknown
  }>

export function hasLegacyPlannerGlobal(
  browserWindow: Window = window,
): boolean {
  const authority = (browserWindow as LegacyPlannerWindow).HomePlanner
  return authority !== undefined && authority !== null
}

function assertPlannerApi(value: unknown): asserts value is PlannerApi {
  const candidate =
    (typeof value === 'object' && value !== null) || typeof value === 'function'
      ? (value as Record<PropertyKey, unknown>)
      : null
  const invalidMethods: string[] = requiredMethodNames.filter(
    (method) => typeof candidate?.[method] !== 'function',
  )

  if (
    candidate &&
    'getObserverErrors' in candidate &&
    candidate.getObserverErrors !== undefined &&
    typeof candidate.getObserverErrors !== 'function'
  ) {
    invalidMethods.push('getObserverErrors')
  }

  if (invalidMethods.length === 0) return

  throw new LegacyPlannerIntegrationError(
    'LegacyPlannerApiIncompleteError',
    `window.HomePlanner is incomplete. Expected callable planner methods: ${invalidMethods.join(', ')}.`,
    invalidMethods,
  )
}

/**
 * Creates a typed facade over the existing browser authority.
 *
 * Snapshot-returning methods deliberately return the legacy controller's exact
 * read-only view objects. The adapter does not clone, freeze, cache, or own
 * project state; callers must treat returned values as authority-owned.
 */
export const createLegacyPlannerApi: () => PlannerApi = () => {
  if (typeof window === 'undefined') {
    throw new LegacyPlannerIntegrationError(
      'LegacyPlannerGlobalUnavailableError',
      'window.HomePlanner is unavailable because the legacy planner adapter can only be created in a browser.',
    )
  }

  const authority = (window as LegacyPlannerWindow).HomePlanner

  if (authority === undefined || authority === null) {
    throw new LegacyPlannerIntegrationError(
      'LegacyPlannerGlobalUnavailableError',
      'window.HomePlanner is unavailable. Load the existing planner bridge before creating the typed adapter.',
    )
  }

  assertPlannerApi(authority)

  const getObserverErrors = authority.getObserverErrors

  return {
    getProject: () => authority.getProject(),
    getScene: () => authority.getScene(),
    getScenes: () => authority.getScenes(),
    getDrawingScene: () => authority.getDrawingScene(),
    getSelection: () => authority.getSelection(),
    execute: (command) => authority.execute(command),
    select: (selection) => authority.select(selection),
    subscribe: (observer) => authority.subscribe(observer),
    ...(getObserverErrors
      ? {
          getObserverErrors: () => getObserverErrors.call(authority),
        }
      : {}),
    canUndo: () => authority.canUndo(),
    canRedo: () => authority.canRedo(),
    undo: () => authority.undo(),
    redo: () => authority.redo(),
    inputFingerprint: (inputs) => authority.inputFingerprint(inputs),
    createSnapshot: (options) => authority.createSnapshot(options),
    exportProject: () => authority.exportProject(),
    importProject: (json) => authority.importProject(json),
    replaceProject: (project) => authority.replaceProject(project),
    newProject: () => authority.newProject(),
    isBusy: () => authority.isBusy(),
  }
}
